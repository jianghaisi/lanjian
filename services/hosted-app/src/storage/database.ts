import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { fail } from '../http/errors.ts'

export function dbString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid stored string.')
  return value
}
export function dbNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('Invalid stored number.')
  return value
}
export function digest(value: string): string { return createHash('sha256').update(value).digest('hex') }
export class HostedDatabase {
  readonly connection: DatabaseSync
  constructor(readonly root: string, readonly now: () => number = Date.now) {
    mkdirSync(root, { recursive: true, mode: 0o700 })
    this.connection = new DatabaseSync(join(root, 'hosted.sqlite'), { allowExtension: false })
    const version = dbNumber(this.connection.prepare('PRAGMA user_version').get()?.user_version)
    if (version > 4) { this.connection.close(); throw new Error('Unsupported hosted database version.') }
    this.connection.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;')
    if (!version) this.transaction(() => {
      this.connection.exec([
        'CREATE TABLE users(id TEXT PRIMARY KEY, subject TEXT NOT NULL UNIQUE, username TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN (\'admin\',\'member\')), disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)), created_at INTEGER NOT NULL);',
        'CREATE TABLE sessions(hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);',
        'CREATE INDEX sessions_user ON sessions(user_id);',
        'CREATE TABLE oauth_states(hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, expires INTEGER NOT NULL);',
        'CREATE TABLE books(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);',
        'CREATE INDEX books_owner ON books(owner_id,updated_at);',
        'CREATE TABLE wallets(user_id TEXT PRIMARY KEY REFERENCES users(id), balance INTEGER NOT NULL DEFAULT 0 CHECK(balance BETWEEN 0 AND 1000000000000), reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=balance));',
        'CREATE TABLE ledger(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,amount INTEGER NOT NULL,note TEXT NOT NULL,actor TEXT NOT NULL,created_at INTEGER NOT NULL);',
        'CREATE INDEX ledger_owner ON ledger(user_id,created_at);',
        'CREATE TABLE receipts(scope TEXT NOT NULL,operation TEXT NOT NULL,payload_hash TEXT NOT NULL,result TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(scope,operation));',
        'CREATE TABLE prices(model_id TEXT NOT NULL,version INTEGER NOT NULL,policy TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(model_id,version));',
        'CREATE TABLE reservations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),model_id TEXT NOT NULL,price_version INTEGER NOT NULL,amount INTEGER NOT NULL CHECK(amount>=0),status TEXT NOT NULL CHECK(status IN (\'reserved\',\'sent\',\'unknown\',\'settled\',\'released\')),charged INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);',
        'CREATE INDEX reservations_owner ON reservations(user_id,status);',
        'CREATE TABLE audit(id TEXT PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,details TEXT NOT NULL,created_at INTEGER NOT NULL);',
        'CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,revision INTEGER NOT NULL);',
        'PRAGMA user_version=1;'
      ].join('\n'))
    })
    if (version < 2) this.transaction(() => {
      this.connection.exec(`
        CREATE TABLE jobs(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),book_id TEXT NOT NULL REFERENCES books(id),model_id TEXT NOT NULL,model_revision INTEGER NOT NULL,price_version INTEGER NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,request_json TEXT NOT NULL,core_task_id TEXT,result_json TEXT,error_code TEXT,request_reservation TEXT REFERENCES reservations(id),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
        CREATE INDEX jobs_owner_book ON jobs(owner_id,book_id,created_at);
        CREATE TABLE attempts(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),reservation_id TEXT REFERENCES reservations(id),status TEXT NOT NULL,input_tokens INTEGER,output_tokens INTEGER,created_at INTEGER NOT NULL);
        CREATE INDEX attempts_time ON attempts(created_at);
        PRAGMA user_version=2;
      `)
    })
    if (version < 3) this.transaction(() => {
      // Credentials now belong to Better Auth. Preserve stable business users,
      // manuscripts and ledger; old browser sessions must sign in again.
      this.connection.exec('DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS oauth_states; PRAGMA user_version=3;')
    })
    if (version < 4) this.transaction(() => {
      // Preparation has its own operational jobs; no placeholder book or change
      // to existing book/job foreign keys and author data is required.
      this.connection.exec(`
        CREATE TABLE group_model_jobs(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),session_id TEXT NOT NULL,book_id TEXT REFERENCES books(id),model_id TEXT NOT NULL,model_revision INTEGER NOT NULL,price_version INTEGER NOT NULL,status TEXT NOT NULL,request_reservation TEXT REFERENCES reservations(id),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
        CREATE INDEX group_jobs_owner ON group_model_jobs(owner_id,status);
        CREATE TABLE group_model_attempts(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES group_model_jobs(id),reservation_id TEXT REFERENCES reservations(id),status TEXT NOT NULL,input_tokens INTEGER,output_tokens INTEGER,created_at INTEGER NOT NULL);
        CREATE INDEX group_attempts_time ON group_model_attempts(created_at);
        PRAGMA user_version=4;
      `)
    })
  }
  get(sql: string, ...args: SQLInputValue[]) { return this.connection.prepare(sql).get(...args) }
  all(sql: string, ...args: SQLInputValue[]) { return this.connection.prepare(sql).all(...args) }
  run(sql: string, ...args: SQLInputValue[]) { return this.connection.prepare(sql).run(...args) }
  transaction<T>(work: () => T): T {
    this.connection.exec('BEGIN IMMEDIATE')
    try { const value = work(); this.connection.exec('COMMIT'); return value }
    catch (error) { this.connection.exec('ROLLBACK'); throw error }
  }
  operation<T>(scope: string, operation: string, payload: unknown, work: () => T): T {
    return this.transaction(() => {
      const hash = digest(JSON.stringify(payload)), old = this.get('SELECT payload_hash,result FROM receipts WHERE scope=? AND operation=?', scope, operation)
      if (old) {
        if (old.payload_hash !== hash) fail('conflict')
        return JSON.parse(dbString(old.result)) as T
      }
      const result = work()
      this.run('INSERT INTO receipts VALUES(?,?,?,?,?)', scope, operation, hash, JSON.stringify(result), this.now())
      return result
    })
  }
  audit(actor: string, action: string, target: string, details: unknown = {}) {
    this.run('INSERT INTO audit VALUES(?,?,?,?,?,?)', randomUUID(), actor, action, target, JSON.stringify(details), this.now())
  }
  close() { this.connection.close() }
}
