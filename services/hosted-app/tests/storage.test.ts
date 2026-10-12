import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fixture } from './helpers.ts'
import { HostedDatabase } from '../src/storage/database.ts'
import { CreditLedger } from '../src/credits/ledger.ts'
import { IdentityService } from '../src/identity/identity-service.ts'
import { BookRegistry } from '../src/storage/books.ts'

test('reopened storage preserves identity, welcome grant, book ownership and unsettled calls', async t => {
  const f = fixture(t), user = await f.login(), id = user.me.user.id
  const book = f.books.create(id, { title: '持久化作品', operation: 'book_001' })
  f.credits.updatePrice('admin', 'model', { expectedVersion: 0, policy: { mode: 'request', points: 1000 } })
  const sent = f.credits.reserve(id, 'reserve_1', 'model', 1000, 1), unsent = f.credits.reserve(id, 'reserve_2', 'model', 1000, 1)
  f.credits.markSent(sent.id)
  const reopened = new HostedDatabase(f.root)
  try {
    const credits = new CreditLedger(reopened), identity = new IdentityService(reopened, f.config)
    credits.recoverAfterRestart()
    assert.equal(identity.get(id).id, id)
    assert.equal(identity.ensureUser({ subject: '123', username: 'renamed', name: '名字' }).id, id)
    assert.equal(credits.entries(id).filter(x => x.kind === 'welcome').length, 1)
    assert.equal(new BookRegistry(reopened).get(id, book.id).title, book.title)
    assert.equal(credits.get(sent.id).status, 'unknown'); assert.equal(credits.get(unsent.id).status, 'released')
    assert.deepEqual(credits.wallet(id), { balance: 10000, reserved: 1000, available: 9000 })
    credits.recoverAfterRestart(); assert.equal(credits.wallet(id).reserved, 1000)
  } finally { reopened.close() }
})
test('newer schema is rejected without rewriting the database', () => {
  const root = mkdtempSync(join(tmpdir(), 'lanjian-schema-test-')), path = join(root, 'hosted.sqlite')
  try {
    const db = new DatabaseSync(path); db.exec('CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES(\'preserved\'); PRAGMA user_version=99'); db.close()
    assert.throws(() => new HostedDatabase(root), /Unsupported hosted database version/)
    const after = new DatabaseSync(path)
    assert.equal(after.prepare('SELECT value FROM sentinel').get()?.value, 'preserved')
    assert.equal(after.prepare('PRAGMA user_version').get()?.user_version, 99); after.close()
  } finally { rmSync(root, { recursive: true, force: true }) }
})
