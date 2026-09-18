import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import test, { type TestContext } from 'node:test'
import { WORKSPACE_DATABASE_SCHEMA_VERSION, type WorkspaceCanonicalEventRecord } from '../../../src/main/core/ports/workspace-database'
import { CanonicalEventVersions } from '../../../src/main/modules/timeline/adapters/canonical-event-versions'
import { canonicalEventIdentityCopySql, canonicalEventIdentityGuardsSql } from '../../../src/main/modules/timeline/adapters/canonical-event-identity-schema'
import { assertEventMigrationReceiptSchema, eventMigrationReceiptTables } from '../../../src/main/modules/timeline/adapters/event-migration-receipt-schema'
import { canonicalDirectory } from '../../../src/main/platform/storage/project-path'
import { rebuildSqliteTable } from '../../../src/main/platform/storage/sqlite-table-rebuild'
import { SqliteWorkspaceDatabaseFactory, workspaceDatabaseMigrations } from '../../../src/main/platform/storage/workspace-database'

const stamp = '2026-09-12T10:00:00.000Z'
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const sourceHash = 'a'.repeat(64)
// Storage fixtures only: not a trusted reviewed plan or a complete EventSourceSnapshot.
const snapshot = '{ "raw": "\\ufeff原始标题\\r\\n", "unknown": { "retained": true }, "emptyResult": "" }'
type Fixture = Awaited<ReturnType<typeof fixture>>
async function fixture(context: TestContext, version = 39) {
  const parent = await canonicalDirectory(tmpdir())
  const root = await canonicalDirectory(await mkdtemp(join(parent, 'novel-event-receipt-')))
  context.after(async () => {
    assert.equal(dirname(root), parent); assert.ok(root.startsWith(join(parent, 'novel-event-receipt-')))
    assert.equal(await canonicalDirectory(root), root)
    await rm(root, { recursive: true, force: true })
  })
  await mkdir(join(root, '.webnovel', 'config'), { recursive: true })
  await writeFile(join(root, '.webnovel', 'config', 'timeline.json'), '\ufeff{ "events": [] }\r\n')
  await writeFile(join(root, 'manuscript.md'), '# 原稿\r\n不能被结构升级改写。\r\n')
  const path = join(root, '.webnovel', 'workspace.sqlite')
  const factory = new SqliteWorkspaceDatabaseFactory(() => new Date(stamp))
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE')
    for (const migration of workspaceDatabaseMigrations.filter(item => item.version <= version)) {
      if (migration.version === 36 || migration.version === 37) {
        const split = migration.sql.indexOf(migration.version === 36 ? 'CREATE TRIGGER task_runs_writing_active_insert_guard' : 'DROP TRIGGER projects_schema_version_v36_after_insert')
        rebuildSqliteTable(db, { table: migration.version === 36 ? 'task_runs' : 'workspace_config_documents',
          copySql: migration.sql.slice(0, split), guardsSql: migration.sql.slice(split), integrityMessage: '隔离夹具结构错误' })
      } else if (migration.version === 39) rebuildSqliteTable(db, { table: 'canonical_events', copySql: canonicalEventIdentityCopySql,
        guardsSql: canonicalEventIdentityGuardsSql, integrityMessage: '隔离夹具结构错误' })
      else db.exec(migration.sql)
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?, ?)').run(migration.version, migration.name, stamp, migration.checksum)
      db.exec(`PRAGMA user_version=${migration.version}`)
    }
    db.exec('COMMIT; PRAGMA foreign_keys=ON')
    for (const project of ['book-one', 'book-two']) {
      db.prepare("INSERT INTO projects (id,name,status,legacy_manifest_hash,storage_mode,created_at,updated_at) VALUES (?,?,'active',?,'sqlite',?,?)")
        .run(project, '隔离回执测试', sourceHash, stamp, stamp)
      db.prepare("INSERT INTO material_sources (id,project_id,provider,source_type,title,captured_at,excerpt,user_notes,content_hash) VALUES (?,?,'manual','manual','真实夹具资料',?,'证据','',?)")
        .run(`material-${project}`, project, stamp, sourceHash)
    }
  } finally { db.close() }
  return { root, path, factory }
}
function using<T>(f: Fixture, action: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(f.path)
  try { db.exec('PRAGMA foreign_keys=ON'); return action(db) } finally { db.close() }
}
async function upgrade(f: Fixture) { const db = await f.factory.openExisting(f.root); assert.ok(db); db.close() }
async function singleBook(f: Fixture) { using(f, db => { db.exec("DELETE FROM material_sources WHERE project_id='book-two'; DELETE FROM projects WHERE id='book-two'") }) }
function receipt(db: DatabaseSync, overrides: Record<string, SQLInputValue> = {}) {
  const value: Record<string, SQLInputValue> = { operation_id: 'op-one', project_id: 'book-one', source_fingerprint: sourceHash,
    decision_fingerprint: 'b'.repeat(64), source_snapshot_hash: hash(snapshot), source_snapshot_json: snapshot, mapping_count: 1, committed_at: stamp, ...overrides }
  db.prepare(`INSERT INTO event_migration_receipts (${Object.keys(value).join(',')}) VALUES (${Object.keys(value).map(() => '?').join(',')})`).run(...Object.values(value))
}
function alias(db: DatabaseSync, overrides: Record<string, SQLInputValue> = {}) {
  const value: Record<string, SQLInputValue> = { operation_id: 'op-one', ordinal: 0, project_id: 'book-one', source_kind: 'sources', source_hash: sourceHash,
    source_ordinal: 0, original_id: 'repeated-original', disposition: 'retain-source', material_source_id: 'material-book-one', material_content_hash: sourceHash,
    event_id: null, event_version_id: null, ...overrides }
  db.prepare(`INSERT INTO event_migration_source_aliases (${Object.keys(value).join(',')}) VALUES (${Object.keys(value).map(() => '?').join(',')})`).run(...Object.values(value))
}
function seal(db: DatabaseSync, operation = 'op-one', project = 'book-one') { db.prepare('INSERT INTO event_migration_receipt_seals VALUES (?,?)').run(operation, project) }
function transition(db: DatabaseSync, operation = 'op-one', project = 'book-one') { db.prepare('INSERT INTO event_module_transitions VALUES (?,?)').run(project, operation) }
function event(db: DatabaseSync, id = 'event-one', project = 'book-one', status: 'candidate' | 'approved' = 'approved') {
  const record: WorkspaceCanonicalEventRecord = { id, time: '第一夜', characters: ['归与'], location: '旧钟楼', event: '钟声回响', result: '',
    confidence: 1, status, evidenceRefs: [{ sourceId: `material-${project}`, excerpt: '证据' }], createdAt: stamp, ...(status === 'approved' ? { approvedAt: stamp } : {}) }
  db.prepare(`INSERT INTO canonical_events (id,project_id,time_ref,location_text,event_text,result_text,confidence,status,event_signature,slot_signature,created_at,approved_at)
    VALUES (?,?,?,? ,?,?,1,?,'same-signature','same-slot',?,?)`).run(id, project, record.time, record.location, record.event, '', status, stamp, record.approvedAt ?? null)
  db.prepare('INSERT INTO canonical_event_characters VALUES (?,0,?,?)').run(id, '归与', '归与')
  db.prepare('INSERT INTO canonical_event_evidence_refs VALUES (?,0,?,?)').run(id, `material-${project}`, '证据')
  return new CanonicalEventVersions(db, project, () => `${id}-v1`).captureCreated(record, stamp)
}
function eventAlias(db: DatabaseSync, id = 'event-one', version = `${id}-v1`, overrides: Record<string, SQLInputValue> = {}) {
  alias(db, { source_kind: 'timeline', disposition: 'keep-separate', material_source_id: null, material_content_hash: null, event_id: id, event_version_id: version, ...overrides })
}
function allState(db: DatabaseSync) {
  return { version: db.prepare('PRAGMA user_version').get()?.user_version,
    schema: db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all(),
    rows: Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .map(({ name }) => [String(name), db.prepare(`SELECT * FROM "${String(name).replaceAll('"', '""')}" ORDER BY rowid`).all()])) }
}
async function files(root: string, dir = root): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) Object.assign(result, await files(root, path))
    else result[relative(root, path)] = hash(await readFile(path))
  }
  return result
}

test('current schema retains empty v40 receipt structures, legacy rows and original files', async context => {
  const f = await fixture(context); await singleBook(f)
  using(f, db => { event(db); db.exec("CREATE VIEW custom_events AS SELECT * FROM canonical_events; CREATE TABLE custom_notes(value TEXT); CREATE TRIGGER custom_note AFTER UPDATE ON material_sources BEGIN INSERT INTO custom_notes VALUES (NEW.id); END;") })
  const before = using(f, allState), originals = await files(f.root)
  await upgrade(f)
  using(f, db => {
    const after = allState(db)
    assert.equal(after.version, WORKSPACE_DATABASE_SCHEMA_VERSION)
    for (const [table, rows] of Object.entries(before.rows)) {
      const actual = table === 'schema_migrations' ? after.rows[table]!.filter(row => Number(row.version) <= 39) : after.rows[table]
      const expected = table === 'projects' ? rows.map(row => ({ ...row, current_schema_version: WORKSPACE_DATABASE_SCHEMA_VERSION, text_authority: 'legacy-sqlite' })) : rows
      assert.deepEqual(actual?.map(row => ({ ...row })), expected.map(row => ({ ...row })), table)
    }
    for (const item of before.schema.filter(row => row.name !== 'projects_schema_version_v39_after_insert')) {
      const expected = item.name === 'projects' ? { ...item,
        sql: String(item.sql).replace(/\)$/, ", text_authority TEXT NOT NULL DEFAULT 'legacy-sqlite'\n  CHECK(text_authority IN ('legacy-sqlite', 'files-v1')))") } : item
      assert.deepEqual({ ...after.schema.find(row => row.name === item.name) }, { ...expected })
    }
    for (const table of eventMigrationReceiptTables) assert.equal(after.rows[table]!.length, 0)
    assert.equal(db.prepare('SELECT canonical_events_ready FROM projects').get()?.canonical_events_ready, 0)
    assertEventMigrationReceiptSchema(db); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal(db.prepare('PRAGMA quick_check').get()?.quick_check, 'ok')
  })
  for (const [path, digest] of Object.entries(originals).filter(([path]) => !path.includes('workspace.sqlite'))) assert.equal(hash(await readFile(join(f.root, path))), digest)
})

test('fresh application database has no migration receipts or transitions', async context => {
  const f = await fixture(context); await singleBook(f)
  const fresh = join(f.root, 'fresh'); await mkdir(fresh)
  const db = await f.factory.open(fresh); db.close()
  const raw = new DatabaseSync(join(fresh, '.webnovel', 'workspace.sqlite'))
  try { assertEventMigrationReceiptSchema(raw); for (const table of eventMigrationReceiptTables) assert.equal(raw.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0) }
  finally { raw.close() }
})

test('read-only schema 39 validates history without installing schema 40 or writing files', async context => {
  const f = await fixture(context); await singleBook(f)
  const before = await files(f.root)
  const db = await f.factory.openEventReadOnly(f.root); assert.ok(db); db.close()
  assert.deepEqual(await files(f.root), before)
  using(f, db => { assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 39); assert.equal(db.prepare("SELECT name FROM sqlite_schema WHERE name='event_migration_receipts'").get(), undefined) })
})

test('complete sealed mapping and explicit empty receipt survive reopen, independently of legacy readiness', async context => {
  const f = await fixture(context, 40)
  using(f, db => {
    db.exec('BEGIN IMMEDIATE'); receipt(db); alias(db); seal(db); transition(db); db.exec('COMMIT')
    receipt(db, { operation_id: 'empty', project_id: 'book-two', mapping_count: 0 }); seal(db, 'empty', 'book-two'); transition(db, 'empty', 'book-two')
    assert.equal(db.prepare('SELECT canonical_events_ready FROM projects WHERE id=?').get('book-one')?.canonical_events_ready, 0)
  })
  using(f, db => {
    const retained = db.prepare('SELECT * FROM event_migration_receipts WHERE operation_id=?').get('op-one')!
    assert.equal(retained.source_snapshot_json, snapshot); assert.equal(hash(String(retained.source_snapshot_json)), retained.source_snapshot_hash)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM event_module_transitions').get()?.n, 2)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM event_migration_source_aliases').get()?.n, 1)
    assert.throws(() => receipt(db), /already exists/)
    assert.throws(() => receipt(db, { operation_id: 'second-operation' }), /project state/)
  })
})

test('missing mappings, ordinal gaps, wrong scope, premature transition and post-seal aliases are rejected', async context => {
  const f = await fixture(context, 40)
  using(f, db => {
    receipt(db, { mapping_count: 2 }); alias(db)
    assert.throws(() => seal(db), /incomplete/)
    assert.throws(() => transition(db), /sealed receipt/)
    assert.throws(() => alias(db, { ordinal: 2, source_ordinal: 2 }), /invalid or sealed/)
    assert.throws(() => alias(db, { ordinal: 1, source_ordinal: 1, project_id: 'book-two' }), /invalid or sealed/)
    alias(db, { ordinal: 1, source_ordinal: 1 }); seal(db)
    assert.throws(() => alias(db, { ordinal: 2, source_ordinal: 2 }), /invalid or sealed/)
    assert.throws(() => seal(db, 'op-one', 'book-two'), /already sealed/)
    assert.throws(() => transition(db, 'op-one', 'book-two'), /same-project/)
    transition(db)
  })
})

test('source tuples, not original IDs or text, distinguish every occurrence', async context => {
  const f = await fixture(context, 40)
  using(f, db => {
    receipt(db, { mapping_count: 3 }); alias(db); alias(db, { ordinal: 1, source_ordinal: 1 })
    assert.throws(() => alias(db, { ordinal: 2, original_id: 'changed-id' }), /already mapped/)
    alias(db, { ordinal: 2, source_hash: 'c'.repeat(64) }); seal(db)
    assert.deepEqual(db.prepare('SELECT original_id FROM event_migration_source_aliases ORDER BY ordinal').all().map(row => row.original_id), Array(3).fill('repeated-original'))
  })
})

test('receipt/seal/transition scope guards reject unknown projects, nonformal mode and foreign receipts', async context => {
  const f = await fixture(context, 40)
  using(f, db => {
    assert.throws(() => receipt(db, { project_id: 'missing' }), /project state/)
    db.exec("UPDATE projects SET storage_mode='shadow' WHERE id='book-one'")
    assert.throws(() => receipt(db), /project state/)
    db.exec("UPDATE projects SET storage_mode='sqlite' WHERE id='book-one'")
    receipt(db, { mapping_count: 0 })
    assert.throws(() => seal(db, 'op-one', 'book-two'), /incomplete/)
    assert.throws(() => seal(db, 'missing'), /incomplete/)
    seal(db)
    db.exec("UPDATE projects SET storage_mode='shadow' WHERE id='book-one'")
    assert.throws(() => transition(db), /same-project/)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM event_module_transitions').get()?.n, 0)
  })
})

test('material target must retain a same-book current hash; later source changes do not rewrite receipt history', async context => {
  const f = await fixture(context, 40)
  using(f, db => {
    receipt(db)
    const invalidTargets: Record<string, SQLInputValue>[] = [{ material_source_id: 'missing' }, { material_source_id: 'material-book-two' }, { material_content_hash: 'b'.repeat(64) }]
    for (const value of invalidTargets) assert.throws(() => alias(db, value), /material revision/)
    alias(db); seal(db); transition(db)
    db.prepare('UPDATE material_sources SET content_hash=? WHERE id=?').run('c'.repeat(64), 'material-book-one')
    assert.equal(db.prepare('SELECT material_content_hash FROM event_migration_source_aliases').get()?.material_content_hash, sourceHash)
    assert.throws(() => db.exec("DELETE FROM material_sources WHERE id='material-book-one'"), /FOREIGN KEY/)
  })
})

test('event mappings bind the same-book sealed selected version, never replacing approved content with a newer candidate', async context => {
  const f = await fixture(context, 40)
  using(f, db => {
    const approved = event(db); event(db, 'other', 'book-two'); event(db, 'candidate', 'book-one', 'candidate')
    new CanonicalEventVersions(db, 'book-one', () => 'new-candidate').append('event-one', approved.id, { ...approved, status: 'candidate', creator: 'model-candidate' }, stamp)
    receipt(db, { mapping_count: 2 })
    assert.throws(() => eventAlias(db, 'event-one', 'new-candidate'), /selected version/)
    assert.throws(() => eventAlias(db, 'other'), /selected version/)
    assert.throws(() => eventAlias(db, 'event-one', 'missing'), /selected version/)
    assert.throws(() => eventAlias(db, 'candidate', approved.id), /selected version/)
    eventAlias(db); eventAlias(db, 'candidate', 'candidate-v1', { ordinal: 1, source_ordinal: 1 }); seal(db); transition(db)
    assert.equal(db.prepare('SELECT approved_version_id FROM canonical_event_version_heads WHERE event_id=?').get('candidate')?.approved_version_id, null)
    new CanonicalEventVersions(db, 'book-one', () => 'next-approved').append('event-one', 'new-candidate', approved, stamp)
    assert.equal(db.prepare('SELECT event_version_id FROM event_migration_source_aliases WHERE ordinal=0').get()?.event_version_id, approved.id)
  })
})

test('unsealed event versions cannot become mapping targets', async context => {
  const f = await fixture(context, 40)
  using(f, db => {
    event(db); receipt(db)
    db.prepare(`INSERT INTO canonical_event_versions (id,project_id,event_id,version_no,previous_version_id,payload_json,content_hash,created_at)
      SELECT 'unsealed',project_id,event_id,2,id,payload_json,content_hash,created_at FROM canonical_event_versions WHERE id='event-one-v1'`).run()
    assert.throws(() => eventAlias(db, 'event-one', 'unsealed'), /selected version/)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM event_migration_source_aliases').get()?.n, 0)
  })
})

for (const table of eventMigrationReceiptTables) test(`${table} rejects UPDATE, DELETE and INSERT OR REPLACE even with recursive triggers off`, async context => {
  const f = await fixture(context, 40)
  using(f, db => {
    receipt(db); alias(db); seal(db); transition(db); db.exec('PRAGMA recursive_triggers=OFF')
    const before = allState(db)
    assert.throws(() => db.exec(`UPDATE ${table} SET project_id=project_id`), /append-only/)
    assert.throws(() => db.exec(`DELETE FROM ${table}`), /append-only/)
    assert.throws(() => db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`), /already/)
    assert.deepEqual(allState(db), before)
  })
})

test('alternate UNIQUE conflicts cannot replace an alias or another module transition', async context => {
  const f = await fixture(context, 40)
  using(f, db => {
    receipt(db, { mapping_count: 2 }); alias(db)
    assert.throws(() => db.exec("INSERT OR REPLACE INTO event_migration_source_aliases SELECT operation_id,1,project_id,source_kind,source_hash,source_ordinal,'different-id',disposition,material_source_id,material_content_hash,event_id,event_version_id FROM event_migration_source_aliases"), /already mapped/)
    alias(db, { ordinal: 1, source_ordinal: 1 }); seal(db); transition(db)
    assert.throws(() => db.exec("INSERT OR REPLACE INTO event_module_transitions VALUES ('book-two','op-one')"), /already transitioned/)
  })
})

test('malformed counts, hashes, snapshot envelopes, NULL keys and mixed targets never enter storage', async context => {
  const f = await fixture(context, 40)
  using(f, db => {
    const invalidReceipts: Record<string, SQLInputValue>[] = [{ operation_id: null }, { operation_id: '' }, { operation_id: 'op\u0000hidden' },
      { source_fingerprint: sourceHash + '\u0000bad' }, { decision_fingerprint: Buffer.from(sourceHash) }, { source_snapshot_hash: sourceHash + '\u0000' },
      { mapping_count: -1 }, { mapping_count: 100001 }, { mapping_count: 1.5 },
      { source_fingerprint: 'g'.repeat(64) }, { decision_fingerprint: 'A'.repeat(64) }, { source_snapshot_hash: 'bad' },
      { source_snapshot_json: '[]' }, { source_snapshot_json: 'null' }, { source_snapshot_json: '{' }]
    for (const value of invalidReceipts) assert.throws(() => receipt(db, value))
    receipt(db)
    const invalidAliases: Record<string, SQLInputValue>[] = [{ ordinal: -1 }, { ordinal: 0.5 }, { source_ordinal: 1.5 }, { source_ordinal: 100000 }, { original_id: null },
      { original_id: 'id\u0000hidden' }, { source_hash: sourceHash + '\u0000' }, { source_hash: Buffer.from(sourceHash) },
      { source_hash: 'G'.repeat(64) }, { disposition: 'link-existing' }, { event_id: 'mixed' }, { material_content_hash: null }]
    for (const value of invalidAliases) assert.throws(() => alias(db, value))
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM event_migration_source_aliases').get()?.n, 0)
  })
})

for (const stage of ['receipt', 'alias', 'seal', 'transition'] as const) test(`caller-owned transaction rollback after ${stage} retains all prior rows and history`, async context => {
  const f = await fixture(context, 40)
  using(f, db => {
    const before = allState(db)
    db.exec('BEGIN IMMEDIATE')
    assert.throws(() => {
      event(db); receipt(db); if (stage === 'receipt') throw new Error('injected')
      eventAlias(db); if (stage === 'alias') throw new Error('injected')
      seal(db); if (stage === 'seal') throw new Error('injected')
      transition(db); throw new Error('injected')
    }, /injected/)
    db.exec('ROLLBACK'); assert.deepEqual(allState(db), before)
  })
})

for (const stage of ['ddl', 'ledger', 'commit'] as const) test(`schema-40 ${stage} failure rolls back new structures, project versions and ledger`, async context => {
  const f = await fixture(context); await singleBook(f)
  const before = using(f, allState), exec = DatabaseSync.prototype.exec; let injected = false
  DatabaseSync.prototype.exec = function (sql: string) {
    if (stage === 'commit' && sql === 'COMMIT' && this.prepare('PRAGMA user_version').get()?.user_version === 40) { injected = true; throw new Error('isolated receipt migration failure') }
    const result = exec.call(this, sql)
    if ((stage === 'ddl' && sql.includes('CREATE TABLE event_migration_receipts')) || (stage === 'ledger' && sql === 'PRAGMA user_version = 40')) {
      injected = true; throw new Error('isolated receipt migration failure')
    }
    return result
  }
  try { await assert.rejects(upgrade(f)); assert.equal(injected, true) } finally { DatabaseSync.prototype.exec = exec }
  assert.deepEqual(using(f, allState), before); await upgrade(f)
})

test('missing or weakened schema-40 guards and indexes fail closed without readonly repair', async context => {
  const f = await fixture(context, 40); await singleBook(f)
  for (const sql of [
    'DROP TRIGGER event_migration_receipts_no_update',
    "DROP TRIGGER event_migration_source_aliases_insert_guard; CREATE TRIGGER event_migration_source_aliases_insert_guard BEFORE INSERT ON event_migration_source_aliases BEGIN SELECT 1; END;",
    'DROP INDEX idx_event_migration_alias_original; CREATE INDEX idx_event_migration_alias_original ON event_migration_source_aliases(original_id)'
  ]) {
    using(f, db => { db.exec('BEGIN IMMEDIATE'); db.exec(sql); assert.throws(() => assertEventMigrationReceiptSchema(db), { code: 'DATABASE_INTEGRITY_FAILED' }); db.exec('ROLLBACK') })
  }
  using(f, db => db.exec('DROP TRIGGER event_migration_receipts_no_delete'))
  const before = await files(f.root)
  await assert.rejects(f.factory.openEventReadOnly(f.root), { code: 'DATABASE_INTEGRITY_FAILED' })
  assert.deepEqual(await files(f.root), before)
})

test('damaged schema 39 cannot acquire schema-40 structures or a new migration ledger entry', async context => {
  const f = await fixture(context); await singleBook(f)
  using(f, db => db.exec('DROP TRIGGER canonical_event_version_heads_update_guard'))
  const before = using(f, allState)
  await assert.rejects(upgrade(f), { code: 'DATABASE_MIGRATION_FAILED' })
  assert.deepEqual(using(f, allState), before)
})

test('occupied receipt table is retained and prevents structural upgrade instead of being overwritten', async context => {
  const f = await fixture(context); await singleBook(f)
  using(f, db => db.exec("CREATE TABLE event_migration_receipts(original TEXT); INSERT INTO event_migration_receipts VALUES ('原件必须保留')"))
  const before = using(f, allState)
  await assert.rejects(upgrade(f), { code: 'DATABASE_MIGRATION_FAILED' })
  assert.deepEqual(using(f, allState), before)
})

test('5,000 repeated source IDs remain individually mapped with an indexed reverse lookup', async context => {
  const f = await fixture(context, 40), start = performance.now()
  using(f, db => {
    db.exec('BEGIN IMMEDIATE'); receipt(db, { mapping_count: 5000 })
    for (let ordinal = 0; ordinal < 5000; ordinal++) alias(db, { ordinal, source_ordinal: ordinal })
    seal(db); transition(db); db.exec('COMMIT')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM event_migration_source_aliases').get()?.n, 5000)
    assert.deepEqual(db.prepare('SELECT source_ordinal FROM event_migration_source_aliases ORDER BY ordinal').all().map(row => row.source_ordinal), Array.from({ length: 5000 }, (_, index) => index))
    assert.match(JSON.stringify(db.prepare("EXPLAIN QUERY PLAN SELECT * FROM event_migration_source_aliases WHERE project_id=? AND source_kind=? AND original_id=?").all('book-one', 'sources', 'repeated-original')), /idx_event_migration_alias_original/)
  })
  context.diagnostic(`5,000 aliases + receipt/seal/transition: ${Math.round(performance.now() - start)} ms; SQL structural fixture, not reviewed migration/UI acceptance`)
})

test('all migrations 1–39 remain byte-hash frozen as later schemas are appended', () => {
  assert.equal(hash(JSON.stringify(workspaceDatabaseMigrations.filter(item => item.version <= 39).map(({ version, name, checksum }) => ({ version, name, checksum })))),
    'a5259b00ce9d9961ed2d6b2b5b5cf3ee925fe29b0d9d43aded57f681b8ec8e1d')
  for (const migration of workspaceDatabaseMigrations) assert.equal(migration.checksum, hash(migration.sql))
  assert.equal(workspaceDatabaseMigrations.find(migration => migration.version === 40)?.checksum, '02c46ddbb0440c1ef6fa3daf3980c1cf02829d34b8272533c888acbed41ce3e0')
  assert.equal(workspaceDatabaseMigrations.find(migration => migration.version === 41)?.checksum, 'c58de1c169a3f4fe12a3f4c921599d3ac5b2cfa0b84dfd75cfa671fbecf780b7')
  assert.equal(workspaceDatabaseMigrations.length, WORKSPACE_DATABASE_SCHEMA_VERSION)
})
