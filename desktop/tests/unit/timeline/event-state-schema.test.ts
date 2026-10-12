import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { type TestContext } from 'node:test'
import { CanonicalEventVersions } from '../../../src/main/modules/timeline/adapters/canonical-event-versions'
import { canonicalEventIdentityCopySql, canonicalEventIdentityGuardsSql } from '../../../src/main/modules/timeline/adapters/canonical-event-identity-schema'
import { assertEventStateSchema, eventStateTables } from '../../../src/main/modules/timeline/adapters/event-state-schema'
import { WORKSPACE_DATABASE_SCHEMA_VERSION } from '../../../src/main/core/ports/workspace-database'
import { canonicalDirectory } from '../../../src/main/platform/storage/project-path'
import { rebuildSqliteTable } from '../../../src/main/platform/storage/sqlite-table-rebuild'
import { SqliteWorkspaceDatabaseFactory, workspaceDatabaseMigrations } from '../../../src/main/platform/storage/workspace-database'

const stamp = '2026-09-19T10:00:00.000Z'
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

async function fixture(t: TestContext, singleBook = false) {
  const parent = await canonicalDirectory(tmpdir())
  const root = await canonicalDirectory(await mkdtemp(join(parent, 'lanjian-event-state-')))
  t.after(async () => {
    assert.equal(dirname(root), parent)
    assert.ok(root.startsWith(join(parent, 'lanjian-event-state-')))
    assert.equal(await canonicalDirectory(root), root)
    await rm(root, { recursive: true, force: true })
  })
  await mkdir(join(root, '.webnovel'))
  await writeFile(join(root, 'original.md'), '# 原稿\r\n')
  const path = join(root, '.webnovel', 'workspace.sqlite')
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE')
    for (const migration of workspaceDatabaseMigrations.filter(item => item.version <= 42)) {
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
    for (const project of singleBook ? ['a'] : ['a', 'b', 'untransitioned']) {
      db.prepare("INSERT INTO projects (id,name,status,legacy_manifest_hash,storage_mode,created_at,updated_at) VALUES (?,?,'active',?,'sqlite',?,?)")
        .run(project, project, hash(project), stamp, stamp)
      if (project === 'untransitioned') continue
      // Schema-only evidence, deliberately not a trusted application migration receipt.
      db.prepare('INSERT INTO event_migration_receipts VALUES (?,?,?,?,?,?,0,?)')
        .run(`op-${project}`, project, hash('source'), hash('decisions'), hash('{}'), '{}', stamp)
      db.prepare('INSERT INTO event_migration_receipt_seals VALUES (?,?)').run(`op-${project}`, project)
      db.prepare('INSERT INTO event_module_transitions VALUES (?,?)').run(project, `op-${project}`)
    }
    seedEvent(db, 'a', 'one'); seedEvent(db, 'a', 'two')
    if (!singleBook) seedEvent(db, 'b', 'foreign')
  } finally { db.close() }
  const factory = new SqliteWorkspaceDatabaseFactory(() => new Date(stamp))
  return { root, path, factory, async upgrade() { const connection = await factory.open(root); connection.close() } }
}

function seedEvent(db: DatabaseSync, project: string, id: string) {
  db.prepare("INSERT INTO canonical_events (id,project_id,time_ref,location_text,event_text,result_text,confidence,status,event_signature,slot_signature,created_at,approved_at) VALUES (?,?,'第一夜','城门','事件',NULL,1,'approved','same','same',?,?)")
    .run(id, project, stamp, stamp)
  const versions = new CanonicalEventVersions(db, project, () => `${id}-v1`)
  db.prepare('INSERT INTO canonical_event_characters VALUES (?,0,?,?)').run(id, '甲', '甲')
  versions.append(id, null, { content: { time: '第一夜', characters: ['甲'], location: '城门', event: '事件', confidence: 1, evidenceRefs: [] },
    status: 'approved', phase: 'planned', granularity: 'macro', creator: 'author', sources: [] }, stamp)
}

function lifecycle(db: DatabaseSync, id: string, revision = 1, state = 'active', previous: string | null = null, project = 'a', event = 'one', version = `${event}-v1`) {
  db.prepare('INSERT INTO event_lifecycle_versions VALUES (?,?,?,?,?,?,?,?)').run(id, project, event, revision, previous, version, state, stamp)
}

function order(db: DatabaseSync, id: string, ids: unknown[] = ['one', 'two'], revision = 1, previous: string | null = null, project = 'a') {
  const json = JSON.stringify(ids)
  db.prepare('INSERT INTO event_display_order_versions VALUES (?,?,?,?,?,?,?)').run(id, project, revision, previous, json, hash(json), stamp)
}

function existingData(db: DatabaseSync) {
  return Object.fromEntries(['canonical_events', 'canonical_event_versions', 'canonical_event_version_heads', 'canonical_event_version_sources',
    'canonical_event_version_seals', 'event_migration_receipts', 'event_migration_source_aliases', 'event_migration_receipt_seals', 'event_module_transitions', 'mirror_entries']
    .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
}

test('42 → current prepares empty state histories, preserving event history, receipts, checksums and files', async t => {
  const f = await fixture(t)
  let db = new DatabaseSync(f.path)
  const before = existingData(db)
  const ledger = db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()
  db.exec('CREATE VIEW custom_event_names AS SELECT id FROM canonical_events')
  db.close()
  const original = await readFile(join(f.root, 'original.md'))
  await f.upgrade()
  db = new DatabaseSync(f.path)
  try {
    assertEventStateSchema(db)
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, WORKSPACE_DATABASE_SCHEMA_VERSION)
    assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE version <= 42 ORDER BY version').all(), ledger)
    assert.deepEqual(existingData(db), before)
    for (const table of eventStateTables) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM custom_event_names').get()!.n, 3)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    assert.deepEqual(await readFile(join(f.root, 'original.md')), original)
  } finally { db.close() }
  await f.upgrade()
})

test('schema 42 read-only acquisition does not prepare event state or change database bytes', async t => {
  const f = await fixture(t, true)
  const before = await readFile(f.path)
  const reader = await f.factory.openEventReadOnly(f.root)
  try { assert.equal(reader!.schemaVersion, 42) } finally { reader?.close() }
  assert.deepEqual(await readFile(f.path), before)
})

test('fresh storage prepares the same empty schema without authorizing event operations', async t => {
  const f = await fixture(t, true)
  const root = join(f.root, 'fresh')
  await mkdir(root)
  const fresh = await f.factory.open(root)
  fresh.close()
  const db = new DatabaseSync(join(root, '.webnovel', 'workspace.sqlite'))
  try {
    assertEventStateSchema(db)
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, WORKSPACE_DATABASE_SCHEMA_VERSION)
    for (const table of eventStateTables) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n, 0)
    assert.throws(() => order(db, 'no-book', []))
    assert.throws(() => lifecycle(db, 'no-book'))
  } finally { db.close() }
})

test('archive and restore append state while retaining event identity, approved head and history', async t => {
  const f = await fixture(t); await f.upgrade()
  const db = new DatabaseSync(f.path)
  try {
    const before = existingData(db)
    lifecycle(db, 'initial')
    lifecycle(db, 'archive', 2, 'archived', 'initial')
    lifecycle(db, 'restore', 3, 'active', 'archive')
    assert.deepEqual(db.prepare('SELECT state FROM event_lifecycle_versions ORDER BY revision').all().map(row => row.state), ['active', 'archived', 'active'])
    assert.deepEqual(existingData(db), before)
    assert.throws(() => lifecycle(db, 'stale', 2, 'archived', 'initial'))
    assert.throws(() => lifecycle(db, 'same', 4, 'active', 'restore'))
    assert.throws(() => lifecycle(db, 'skip', 5, 'archived', 'restore'))
    assert.throws(() => lifecycle(db, 'wrong-book', 4, 'archived', 'restore', 'b'))
    assert.throws(() => lifecycle(db, 'wrong-version', 4, 'archived', 'restore', 'a', 'one', 'foreign-v1'))
    assert.throws(() => lifecycle(db, 'missing', 1, 'active', null, 'a', 'missing'))
    assert.throws(() => lifecycle(db, 'initial-archive', 1, 'archived', null, 'a', 'two'))
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM event_lifecycle_versions').get()!.n, 3)
  } finally { db.close() }
})

test('a later content candidate invalidates a lifecycle operation read against the old latest version', async t => {
  const f = await fixture(t); await f.upgrade()
  const db = new DatabaseSync(f.path)
  try {
    lifecycle(db, 'initial')
    const versions = new CanonicalEventVersions(db, 'a', () => 'one-v2')
    const current = versions.list('one')[0]!
    versions.append('one', current.id, { ...current, status: 'candidate' }, stamp)
    assert.throws(() => lifecycle(db, 'stale', 2, 'archived', 'initial'))
    lifecycle(db, 'fresh', 2, 'archived', 'initial', 'a', 'one', 'one-v2')
    assert.equal(versions.heads('one')!.approvedVersionId, 'one-v1')
  } finally { db.close() }
})

test('display reorder uses independent history and preserves archived identities and content', async t => {
  const f = await fixture(t); await f.upgrade()
  const db = new DatabaseSync(f.path)
  try {
    const before = existingData(db)
    lifecycle(db, 'initial'); lifecycle(db, 'archive', 2, 'archived', 'initial')
    order(db, 'order-1')
    order(db, 'order-2', ['two', 'one'], 2, 'order-1')
    assert.equal(db.prepare('SELECT event_ids_json FROM event_display_order_versions WHERE revision = 2').get()!.event_ids_json, '["two","one"]')
    assert.deepEqual(existingData(db), before)
    for (const ids of [[], ['two'], ['one', 'one'], ['one', 'foreign'], ['one', 'missing'], ['one', 2]]) {
      assert.throws(() => order(db, 'invalid', ids, 3, 'order-2'))
    }
    assert.throws(() => order(db, 'stale', ['one', 'two'], 3, 'order-1'))
    assert.throws(() => order(db, 'skip', ['one', 'two'], 4, 'order-2'))
    assert.throws(() => order(db, 'wrong-book', ['one', 'two'], 1, null, 'b'))
    assert.throws(() => order(db, 'untransitioned', [], 1, null, 'untransitioned'))
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM event_display_order_versions').get()!.n, 2)
  } finally { db.close() }
})

test('both histories reject update, delete and every unique-key replacement even without recursive triggers', async t => {
  const f = await fixture(t); await f.upgrade()
  const db = new DatabaseSync(f.path)
  try {
    db.exec('PRAGMA recursive_triggers=OFF')
    lifecycle(db, 'initial'); order(db, 'order-1')
    for (const table of eventStateTables) {
      const before = db.prepare(`SELECT * FROM ${table}`).all()
      assert.throws(() => db.exec(`UPDATE ${table} SET created_at='changed'`))
      assert.throws(() => db.exec(`DELETE FROM ${table}`))
      assert.throws(() => db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`))
      const fields = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name)
      assert.throws(() => db.exec(`INSERT OR REPLACE INTO ${table} SELECT ${fields.map(field => field === 'id' ? "'new-id'" : field).join(',')} FROM ${table}`))
      assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(), before)
    }
  } finally { db.close() }
})

test('migration ledger failure rolls back all schema 43 structures and retains the schema 42 stamp', async t => {
  const f = await fixture(t)
  let db = new DatabaseSync(f.path)
  const before = existingData(db)
  db.exec("CREATE TRIGGER fail_43 BEFORE INSERT ON schema_migrations WHEN NEW.version = 43 BEGIN SELECT RAISE(ABORT, 'injected ledger failure'); END")
  db.close()
  await assert.rejects(f.upgrade())
  db = new DatabaseSync(f.path)
  try {
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 42)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version=43').get()!.n, 0)
    for (const table of eventStateTables) assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sqlite_schema WHERE name=?').get(table)!.n, 0)
    assert.deepEqual(existingData(db), before)
    assert.deepEqual(db.prepare('SELECT DISTINCT current_schema_version AS v FROM projects').all().map(row => row.v), [42])
    db.exec('DROP TRIGGER fail_43')
  } finally { db.close() }
  await f.upgrade()
})

test('missing predecessor guard blocks upgrade and a changed current guard blocks read-only acquisition', async t => {
  const f = await fixture(t, true)
  let db = new DatabaseSync(f.path)
  const sql = db.prepare("SELECT sql FROM sqlite_schema WHERE name='event_module_transitions_no_delete'").get()!.sql as string
  db.exec('DROP TRIGGER event_module_transitions_no_delete'); db.close()
  await assert.rejects(f.upgrade(), { code: 'DATABASE_INTEGRITY_FAILED' })
  db = new DatabaseSync(f.path)
  assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 42)
  db.exec(sql); db.close()
  await f.upgrade()
  db = new DatabaseSync(f.path)
  db.exec('DROP TRIGGER event_lifecycle_versions_insert_guard; CREATE TRIGGER event_lifecycle_versions_insert_guard BEFORE INSERT ON event_lifecycle_versions BEGIN SELECT 1; END')
  db.close()
  const bytes = await readFile(f.path)
  await assert.rejects(f.factory.openEventReadOnly(f.root), { code: 'DATABASE_INTEGRITY_FAILED' })
  assert.deepEqual(await readFile(f.path), bytes)
})

test('an existing schema name collision rolls back the upgrade without deleting unknown data', async t => {
  const f = await fixture(t, true)
  let db = new DatabaseSync(f.path)
  db.exec("CREATE TABLE event_display_order_versions(note TEXT); INSERT INTO event_display_order_versions VALUES ('preserve')")
  db.close()
  await assert.rejects(f.upgrade())
  db = new DatabaseSync(f.path)
  try {
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 42)
    assert.equal(db.prepare('SELECT note FROM event_display_order_versions').get()!.note, 'preserve')
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='event_lifecycle_versions'").get()!.n, 0)
  } finally { db.close() }
})

test('5,000 identities retain their exact order across an append and reopen', async t => {
  const f = await fixture(t, true); await f.upgrade()
  let db = new DatabaseSync(f.path)
  const ids = ['one', 'two']
  try {
    db.exec('BEGIN IMMEDIATE')
    for (let index = 2; index < 5_000; index++) {
      const id = `event-${index}`; ids.push(id); seedEvent(db, 'a', id)
    }
    order(db, 'initial-order', ids)
    order(db, 'reverse-order', [...ids].reverse(), 2, 'initial-order')
    db.exec('COMMIT')
  } finally { db.close() }
  db = new DatabaseSync(f.path)
  try {
    const rows = db.prepare('SELECT event_ids_json FROM event_display_order_versions ORDER BY revision').all()
    assert.deepEqual(JSON.parse(rows[0]!.event_ids_json as string), ids)
    assert.deepEqual(JSON.parse(rows[1]!.event_ids_json as string), [...ids].reverse())
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM canonical_event_versions').get()!.n, 5_000)
    assert.throws(() => order(db, 'over-limit', Array.from({ length: 100_001 }, (_, index) => `id-${index}`), 3, 'reverse-order'))
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM event_display_order_versions').get()!.n, 2)
  } finally { db.close() }
})
