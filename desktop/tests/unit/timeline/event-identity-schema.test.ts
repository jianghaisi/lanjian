import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { type TestContext } from 'node:test'
import { storyEventSignature } from '../../../src/main/modules/timeline/domain/story-event'
import { WORKSPACE_DATABASE_SCHEMA_VERSION, type WorkspaceCanonicalEventRecord } from '../../../src/main/core/ports/workspace-database'
import { canonicalEventIdentityCopySql, canonicalEventIdentityGuardsSql, assertCanonicalEventIdentitySchema } from '../../../src/main/modules/timeline/adapters/canonical-event-identity-schema'
import { CanonicalEventVersions, canonicalEventVersionTables } from '../../../src/main/modules/timeline/adapters/canonical-event-versions'
import { LocalEventSourceSnapshotReader } from '../../../src/main/modules/timeline/adapters/event-source-snapshot'
import { canonicalDirectory } from '../../../src/main/platform/storage/project-path'
import { rebuildSqliteTable } from '../../../src/main/platform/storage/sqlite-table-rebuild'
import { SqliteWorkspaceDatabaseFactory, workspaceDatabaseMigrations } from '../../../src/main/platform/storage/workspace-database'

const stamp = '2026-09-12T06:00:00.000Z'
const sourceHash = 'a'.repeat(64)
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const event: WorkspaceCanonicalEventRecord = { id: 'event-a', time: '第一夜', characters: ['归与', '和光'], location: '旧钟楼',
  event: '钟声回响', result: '', confidence: 0.8, status: 'approved', createdAt: stamp, approvedAt: stamp,
  evidenceRefs: [{ sourceId: 'material-one', excerpt: '  原始摘录\r\n顺序及空白保留。  ' }] }
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"'
type Fixture = Awaited<ReturnType<typeof fixture>>

async function fixture(context: TestContext, version = 38) {
  const parent = await canonicalDirectory(tmpdir())
  const root = await canonicalDirectory(await mkdtemp(join(parent, 'novel-event-identity-')))
  context.after(async () => {
    assert.equal(dirname(root), parent); assert.ok(root.startsWith(join(parent, 'novel-event-identity-')))
    assert.equal(await canonicalDirectory(root), root)
    await rm(root, { recursive: true, force: true })
  })
  await mkdir(join(root, '.webnovel', 'research'), { recursive: true })
  await mkdir(join(root, '.webnovel', 'config'))
  await writeFile(join(root, '.webnovel', 'research', 'events.json'), '\ufeff{ "events": [{ "unknown": "完整保留" }] }\r\n')
  await writeFile(join(root, '.webnovel', 'config', 'timeline.json'), '{ "events": [] }\r\n')
  await writeFile(join(root, 'manuscript.md'), '# 隔离原稿\r\n未经采用不能改写。\r\n')
  const path = join(root, '.webnovel', 'workspace.sqlite')
  const factory = new SqliteWorkspaceDatabaseFactory(() => new Date(stamp))
  if (version === 0) (await factory.open(root)).close()
  const raw = new DatabaseSync(path)
  try {
    raw.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE')
    for (const migration of workspaceDatabaseMigrations.filter(item => item.version <= version)) {
      if (migration.version === 36 || migration.version === 37) {
        const split = migration.sql.indexOf(migration.version === 36 ? 'CREATE TRIGGER task_runs_writing_active_insert_guard' : 'DROP TRIGGER projects_schema_version_v36_after_insert')
        rebuildSqliteTable(raw, { table: migration.version === 36 ? 'task_runs' : 'workspace_config_documents',
          copySql: migration.sql.slice(0, split), guardsSql: migration.sql.slice(split), integrityMessage: '隔离夹具结构错误' })
      } else raw.exec(migration.sql)
      raw.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?, ?)').run(migration.version, migration.name, stamp, migration.checksum)
      raw.exec(`PRAGMA user_version = ${migration.version}`)
    }
    raw.exec('COMMIT; PRAGMA foreign_keys = ON')
    raw.prepare("INSERT INTO projects (id,name,status,legacy_manifest_hash,storage_mode,created_at,updated_at) VALUES ('book-one','隔离身份测试','active',?,'sqlite',?,?)").run(sourceHash, stamp, stamp)
    raw.exec('UPDATE projects SET material_sources_ready = 1, canonical_events_ready = 1')
    raw.prepare("INSERT INTO material_sources (id,project_id,provider,source_type,title,captured_at,excerpt,user_notes,content_hash) VALUES ('material-one','book-one','manual','manual','隔离资料',?,?,'',?)").run(stamp, event.evidenceRefs[0]!.excerpt, sourceHash)
  } finally { raw.close() }
  const capture = () => new LocalEventSourceSnapshotReader(factory).capture({ root, workItemId: root, generation: 1 })
  return { root, path, factory, capture }
}
function using<T>(f: Fixture, work: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(f.path)
  try { db.exec('PRAGMA foreign_keys = ON'); return work(db) } finally { db.close() }
}
function insertEvent(db: DatabaseSync, value = event, rowid = 11) {
  db.prepare(`INSERT INTO canonical_events (rowid,id,project_id,time_ref,location_text,event_text,result_text,confidence,status,conflict_group_id,event_signature,slot_signature,created_at,approved_at)
    VALUES (?,?,'book-one',?,?,?,?,?,?,?,?,?,?,?)`).run(rowid, value.id, value.time, value.location, value.event, value.result ?? null,
    value.confidence, value.status, value.conflictGroupId ?? null, storyEventSignature(value), 'retained-slot', value.createdAt, value.approvedAt ?? null)
  value.characters.forEach((name, ordinal) => db.prepare('INSERT INTO canonical_event_characters VALUES (?,?,?,?)').run(value.id, ordinal, name, name))
  value.evidenceRefs.forEach((ref, ordinal) => db.prepare('INSERT INTO canonical_event_evidence_refs VALUES (?,?,?,?)').run(value.id, ordinal, ref.sourceId, ref.excerpt))
}
function seed(f: Fixture, versioned = true) {
  using(f, db => {
    db.exec('BEGIN IMMEDIATE')
    try {
      insertEvent(db)
      const second: WorkspaceCanonicalEventRecord = { ...event, id: 'event-b', event: '次夜重访', result: undefined, status: 'candidate', approvedAt: undefined }
      insertEvent(db, second, 73)
      if (versioned) {
        let seq = 0; const versions = new CanonicalEventVersions(db, 'book-one', () => `version-${++seq}`)
        const first = versions.captureCreated(event, stamp)
        versions.append(event.id, first.id, { ...first, status: 'candidate', creator: 'model-candidate', content: { ...first.content, event: '未批准的扩展' } }, stamp)
        const candidate = versions.captureCreated(second, stamp)
        versions.append(second.id, candidate.id, { ...candidate, sources: [...candidate.sources, { relation: 'refines', source: { kind: 'event', id: event.id, revision: first.id } }] }, stamp)
      }
      db.prepare("INSERT INTO mirror_entries (id,project_id,source_type,source_id,source_version_id,relative_path,content_hash,observed_hash,status,last_error_code,updated_at) VALUES ('event-mirror','book-one','canonical_events_json','book-one',?,'research/events.json',?,?,'conflict','EXTERNAL_CHANGE',?)").run(sourceHash, sourceHash, 'b'.repeat(64), stamp)
      db.exec(`CREATE TABLE custom_links(id TEXT PRIMARY KEY, event_id TEXT REFERENCES canonical_events(id) ON DELETE CASCADE);
        INSERT INTO custom_links VALUES ('link-a','event-a');
        CREATE TABLE custom_audit(value TEXT);
        CREATE INDEX "custom event index" ON canonical_events(status,id);
        CREATE VIEW custom_event_view AS SELECT rowid AS original_rowid,id,status FROM canonical_events;
        CREATE VIEW custom_indirect_view AS SELECT * FROM custom_event_view;
        CREATE TRIGGER custom_event_update AFTER UPDATE ON canonical_events BEGIN INSERT INTO custom_audit VALUES (NEW.id); END;
        CREATE TRIGGER custom_external_trigger AFTER INSERT ON custom_audit BEGIN SELECT id FROM custom_indirect_view; END;`)
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
  })
}
function schema(db: DatabaseSync) { return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all() }
function state(f: Fixture) {
  return using(f, db => {
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    return { version: db.prepare('PRAGMA user_version').get()?.user_version, schema: schema(db),
      rows: Object.fromEntries(tables.map(({ name }) => [String(name), db.prepare(`SELECT * FROM ${quote(String(name))} ORDER BY rowid`).all()])),
      foreignKeys: Object.fromEntries(tables.map(({ name }) => [String(name), db.prepare('SELECT * FROM pragma_foreign_key_list(?) ORDER BY id,seq').all(name)])),
      eventRows: db.prepare('SELECT rowid,* FROM canonical_events ORDER BY rowid').all(),
      columns: db.prepare("PRAGMA table_xinfo('canonical_events')").all() }
  })
}
async function files(root: string, directory = root): Promise<Record<string, string>> {
  const values: Record<string, string> = {}
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) Object.assign(values, await files(root, path))
    else values[relative(root, path)] = hash(await readFile(path))
  }
  return values
}
const withoutDatabase = (manifest: Record<string, string>) => Object.fromEntries(Object.entries(manifest).filter(([path]) => !path.includes('workspace.sqlite')))
async function upgrade(f: Fixture) { const db = await f.factory.openExisting(f.root); assert.ok(db); db.close() }

test('fresh databases retain schema-39 identity guarantees without events, history or automatic module transition', async context => {
  const f = await fixture(context, 0)
  await upgrade(f)
  using(f, db => {
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, WORKSPACE_DATABASE_SCHEMA_VERSION)
    assert.equal(db.prepare('SELECT current_schema_version FROM projects').get()?.current_schema_version, WORKSPACE_DATABASE_SCHEMA_VERSION)
    for (const table of ['canonical_events', ...canonicalEventVersionTables]) assert.equal(db.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0)
    assertCanonicalEventIdentitySchema(db)
  })
  const emptyRoot = await fixture(context, 25)
  using(emptyRoot, db => { db.exec('UPDATE projects SET canonical_events_ready=0, material_sources_ready=0') })
  await upgrade(emptyRoot)
  using(emptyRoot, db => { assert.equal(db.prepare('SELECT canonical_events_ready FROM projects').get()?.canonical_events_ready, 0) })
})

test('schema-38 rebuild retains exact rowids, all rows/history, foreign keys, custom dependents and original files', async context => {
  const f = await fixture(context); seed(f)
  const before = state(f), originals = await files(f.root)
  await upgrade(f); const after = state(f)
  assert.equal(after.version, WORKSPACE_DATABASE_SCHEMA_VERSION)
  assert.deepEqual(after.columns, before.columns)
  for (const table of Object.keys(before.foreignKeys)) {
    const added = after.foreignKeys[table]!.filter(row => row.from === 'review_application_id')
    if (['body_versions', 'outline_versions'].includes(table)) {
      assert.equal(added.length, 1); assert.equal(added[0]!.table, 'document_review_applications'); assert.equal(added[0]!.to, 'id')
    } else assert.equal(added.length, 0)
    const semantic = (rows: typeof added) => rows.filter(row => row.from !== 'review_application_id').map(({ id, ...row }) => row)
    assert.deepEqual(semantic(after.foreignKeys[table]!), semantic(before.foreignKeys[table]!), table)
  }
  assert.deepEqual(after.eventRows, before.eventRows)
  for (const [table, rows] of Object.entries(before.rows)) {
    const expected = table === 'projects' ? rows.map(row => ({ ...row, current_schema_version: WORKSPACE_DATABASE_SCHEMA_VERSION, text_authority: 'legacy-sqlite' })) : ['body_versions', 'outline_versions'].includes(table) ? rows.map(row => ({ ...row, review_application_id: null })) : rows
    const actual = table === 'schema_migrations' ? after.rows[table]!.filter(row => Number(row.version) <= 38) : after.rows[table]!
    assert.deepEqual(actual.map(row => ({ ...row })), expected.map(row => ({ ...row })), table)
  }
  for (const definition of before.schema.filter(row => !['canonical_events', 'projects_schema_version_v38_after_insert'].includes(String(row.name)))) {
    const actual = after.schema.find(row => row.name === definition.name)
    if (definition.name === 'projects') {
      assert.equal(String(actual?.sql).replace(", text_authority TEXT NOT NULL DEFAULT 'legacy-sqlite'\n  CHECK(text_authority IN ('legacy-sqlite', 'files-v1'))", ''), definition.sql)
    } else if (['body_versions', 'outline_versions'].includes(String(definition.name))) {
      assert.equal(actual?.sql, String(definition.sql).replace(',\n  UNIQUE', ', review_application_id TEXT REFERENCES document_review_applications(id),\n  UNIQUE'))
    } else if (definition.name === 'body_versions_ai_task_reference_guard') {
      assert.equal(actual?.sql, String(definition.sql).replace('BEFORE INSERT ON body_versions\nBEGIN', 'BEFORE INSERT ON body_versions\nWHEN NEW.review_application_id IS NULL\nBEGIN'))
    } else assert.deepEqual(actual, definition, String(definition.name))
  }
  assert.deepEqual(withoutDatabase(await files(f.root)), withoutDatabase(originals))
  using(f, db => {
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal(db.prepare('PRAGMA quick_check').get()?.quick_check, 'ok')
    assert.deepEqual(db.prepare('SELECT original_rowid FROM custom_indirect_view ORDER BY original_rowid').all().map(row => row.original_rowid), [11, 73])
    db.exec("UPDATE canonical_events SET conflict_group_id='retained-conflict' WHERE id='event-a'")
    assert.equal(db.prepare('SELECT count(*) AS count FROM custom_audit').get()?.count, 1)
  })
})

test('schema-25 events upgrade without automatic version baselines, source conversion or mirror acknowledgements', async context => {
  const f = await fixture(context, 25); seed(f, false)
  const before = state(f), originals = await files(f.root)
  await upgrade(f)
  using(f, db => {
    assert.deepEqual(db.prepare('SELECT rowid,* FROM canonical_events ORDER BY rowid').all(), before.eventRows)
    assert.equal(db.prepare('SELECT count(*) AS count FROM canonical_event_versions').get()?.count, 0)
    assert.deepEqual(db.prepare('SELECT * FROM mirror_entries ORDER BY rowid').all(), before.rows.mirror_entries)
  })
  assert.deepEqual(withoutDatabase(await files(f.root)), withoutDatabase(originals))
})

test('independent equal-content identities and histories survive reopen without merging or approving candidates', async context => {
  const f = await fixture(context); seed(f); await upgrade(f)
  using(f, db => {
    db.exec('BEGIN IMMEDIATE')
    const duplicate = { ...event, id: 'separate-event', status: 'candidate' as const, approvedAt: undefined }
    insertEvent(db, duplicate, 104)
    new CanonicalEventVersions(db, 'book-one', () => 'duplicate-version').captureCreated(duplicate, stamp)
    db.exec('COMMIT')
  })
  const db = await f.factory.openExisting(f.root); assert.ok(db)
  try {
    assert.equal(db.listCanonicalEvents().length, 3)
    assert.equal(db.canonicalEventVersionHeads('separate-event')!.approvedVersionId, null)
    assert.equal(db.listCanonicalEventVersions('event-a').length, 2)
    assert.equal(db.canonicalEventVersionHeads('event-a')!.approvedVersionId, 'version-1')
    assert.equal(db.listCanonicalEventVersions('separate-event')[0]!.status, 'candidate')
  } finally { db.close() }
  const originals = await files(f.root), snapshot = await f.capture()
  assert.equal(snapshot.documents.events.occurrences.length, 3)
  assert.equal(snapshot.eventHistory.length, 3)
  assert.deepEqual(await files(f.root), originals)
})

test('read-only schema-38 acquisition preserves full version checks and does not install schema 39', async context => {
  const f = await fixture(context); seed(f)
  const before = await files(f.root), snapshot = await f.capture()
  assert.equal(snapshot.database!.schemaVersion, 38)
  assert.equal(snapshot.eventHistory.length, 2)
  assert.equal(snapshot.eventHistory[0]!.versions.length, 2)
  assert.deepEqual(await files(f.root), before)
  using(f, db => { db.exec('DROP TRIGGER canonical_event_version_heads_update_guard') })
  const damaged = await files(f.root)
  await assert.rejects(f.capture(), { code: 'DATABASE_MIGRATION_FAILED' })
  assert.deepEqual(await files(f.root), damaged)
})

test('legacy create and projection updates retain duplicate rejection with zero partial history or mirrors', async context => {
  const f = await fixture(context); seed(f); await upgrade(f)
  const db = await f.factory.openExisting(f.root); assert.ok(db)
  try {
    const before = state(f)
    assert.throws(() => db.createCanonicalEvent({ ...event, id: 'legacy-duplicate' }), { code: 'CONFLICT' })
    assert.deepEqual(state(f), before)
    const latest = db.listCanonicalEventVersions('event-b').at(-1)!
    assert.throws(() => db.appendCanonicalEventVersion({ ...latest, eventId: 'event-b', expectedVersionId: latest.id,
      status: 'approved', creator: 'author', content: { ...event } }), { code: 'CONFLICT' })
    assert.deepEqual(state(f), before)
  } finally { db.close() }
})

test('all immutable source/version/head guards and incoming event foreign keys remain enforced after rebuild', async context => {
  const f = await fixture(context); seed(f); await upgrade(f)
  using(f, db => {
    for (const sql of ["UPDATE canonical_event_versions SET content_hash='bad'", 'DELETE FROM canonical_event_versions',
      'DELETE FROM canonical_event_version_sources', 'DELETE FROM canonical_event_version_seals', 'DELETE FROM canonical_event_version_heads',
      "UPDATE canonical_event_version_heads SET approved_version_id='version-2' WHERE event_id='event-a'",
      "INSERT INTO canonical_event_version_sources VALUES ('version-1',1,'derived-from','material','material-one','x')",
      "DELETE FROM canonical_events WHERE id='event-a'", "UPDATE custom_links SET event_id='missing'"]) assert.throws(() => db.exec(sql), sql)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal(db.prepare('SELECT event_id FROM custom_links').get()?.event_id, 'event-a')
  })
})

for (const stage of ['copy', 'restore', 'guards', 'ledger', 'commit'] as const) test(`injected ${stage} failure rolls back all schema, rows and ledger and restores foreign_keys`, async context => {
  const f = await fixture(context); seed(f)
  const before = state(f), originals = withoutDatabase(await files(f.root))
  const originalExec = DatabaseSync.prototype.exec; let injected = false, disabled = false, restored = false
  DatabaseSync.prototype.exec = function (sql: string) {
    if (stage === 'commit' && sql === 'COMMIT' && this.prepare('PRAGMA user_version').get()?.user_version === 39) { injected = true; throw new Error('isolated commit failure') }
    const result = originalExec.call(this, sql)
    if (sql === 'PRAGMA foreign_keys = OFF') disabled = true
    if (disabled && sql === 'PRAGMA foreign_keys = ON') restored = this.prepare('PRAGMA foreign_keys').get()?.foreign_keys === 1
    if (!injected && ((stage === 'copy' && sql === canonicalEventIdentityCopySql)
      || (stage === 'restore' && sql.startsWith('CREATE TRIGGER canonical_event_version_heads_update_guard'))
      || (stage === 'guards' && sql === canonicalEventIdentityGuardsSql)
      || (stage === 'ledger' && sql === 'PRAGMA user_version = 39'))) { injected = true; throw new Error('isolated migration failure') }
    return result
  }
  try { await assert.rejects(upgrade(f), { code: 'DATABASE_MIGRATION_FAILED' }) } finally { DatabaseSync.prototype.exec = originalExec }
  assert.equal(injected, true); assert.equal(disabled, true); assert.equal(restored, true)
  assert.deepEqual(state(f), before)
  assert.deepEqual(withoutDatabase(await files(f.root)), originals)
})

test('foreign-key failure after copying cannot commit a partly rebuilt event authority', async context => {
  const f = await fixture(context); seed(f); const before = state(f)
  const originalExec = DatabaseSync.prototype.exec; let injected = false
  DatabaseSync.prototype.exec = function (sql: string) {
    const result = originalExec.call(this, sql)
    if (sql === canonicalEventIdentityCopySql) { injected = true; originalExec.call(this, "UPDATE custom_links SET event_id='missing'") }
    return result
  }
  try { await assert.rejects(upgrade(f), { code: 'DATABASE_INTEGRITY_FAILED' }) } finally { DatabaseSync.prototype.exec = originalExec }
  assert.equal(injected, true); assert.deepEqual(state(f), before)
})

for (const [label, sql, code] of [
  ['unknown column', "ALTER TABLE canonical_events ADD COLUMN author_extension TEXT DEFAULT '保留未知字段'", 'DATABASE_INTEGRITY_FAILED'],
  ['occupied rebuild table', "CREATE TABLE canonical_events_v39 (evidence TEXT); INSERT INTO canonical_events_v39 VALUES ('不要覆盖')", 'DATABASE_MIGRATION_FAILED'],
  ['index-name collision', 'CREATE INDEX idx_canonical_events_project_signature ON canonical_events(status)', 'DATABASE_MIGRATION_FAILED'],
  ['custom conflicting uniqueness', 'CREATE UNIQUE INDEX custom_signature ON canonical_events(project_id,event_signature)', 'DATABASE_INTEGRITY_FAILED'],
  ['missing source guard', 'DROP TRIGGER canonical_event_version_sources_scope_guard', 'DATABASE_MIGRATION_FAILED'],
  ['changed source checksum', `UPDATE schema_migrations SET checksum='${'0'.repeat(64)}' WHERE version=38`, 'DATABASE_INTEGRITY_FAILED']
] as const) test(`${label} rejects upgrade without deleting or repairing original evidence`, async context => {
  const f = await fixture(context); seed(f); using(f, db => { db.exec(sql) })
  const before = state(f)
  await assert.rejects(upgrade(f), { code })
  assert.deepEqual(state(f), before)
})

test('current-schema reads reject a missing or replaced nonunique signature index without repair', async context => {
  const f = await fixture(context); seed(f); await upgrade(f)
  using(f, db => { db.exec('DROP INDEX idx_canonical_events_project_signature') })
  const before = await files(f.root)
  await assert.rejects(f.capture(), { code: 'DATABASE_INTEGRITY_FAILED' })
  assert.deepEqual(await files(f.root), before)
  using(f, db => { db.exec('CREATE UNIQUE INDEX idx_canonical_events_project_signature ON canonical_events(project_id,event_signature)') })
  const replaced = await files(f.root)
  await assert.rejects(f.capture(), { code: 'DATABASE_INTEGRITY_FAILED' })
  assert.deepEqual(await files(f.root), replaced)
})

test('unknown current event table extensions are not silently read as a complete supported schema', async context => {
  const f = await fixture(context); await upgrade(f)
  using(f, db => { db.exec("ALTER TABLE canonical_events ADD COLUMN unreviewed_extension TEXT DEFAULT '保留'") })
  const before = await files(f.root)
  await assert.rejects(f.capture(), { code: 'DATABASE_INTEGRITY_FAILED' })
  assert.deepEqual(await files(f.root), before)
})

test('repeated schema preparation is idempotent and does not replay data or mirror operations', async context => {
  const f = await fixture(context); seed(f); await upgrade(f)
  const before = state(f), originals = withoutDatabase(await files(f.root))
  await upgrade(f); await upgrade(f)
  assert.deepEqual(state(f), before)
  assert.deepEqual(withoutDatabase(await files(f.root)), originals)
})

test('5,000 distinct retained events preserve cardinality, rowids and checksums through structural upgrade', async context => {
  const f = await fixture(context)
  using(f, db => {
    db.exec('BEGIN IMMEDIATE')
    for (let index = 0; index < 5_000; index++) insertEvent(db, { ...event, id: `event-${index}`, event: `保留事件-${index}` }, index * 2 + 1)
    db.exec('COMMIT')
  })
  const before = state(f), started = performance.now(); await upgrade(f)
  const elapsed = performance.now() - started, after = state(f)
  assert.equal(after.eventRows.length, 5_000)
  assert.deepEqual(after.eventRows, before.eventRows)
  assert.deepEqual(after.rows.canonical_event_characters, before.rows.canonical_event_characters)
  assert.deepEqual(after.rows.canonical_event_evidence_refs, before.rows.canonical_event_evidence_refs)
  assert.deepEqual(after.rows.canonical_event_versions, [])
  assert.deepEqual(after.rows.schema_migrations!.slice(0, 38), before.rows.schema_migrations)
  context.diagnostic(`5,000-event structural upgrade: ${Math.round(elapsed)} ms; no reviewed migration or Electron responsiveness claim`)
})

test('migrations 1–38 retain their frozen SQL checksums and migration 39 keeps its position', () => {
  const prior = workspaceDatabaseMigrations.filter(item => item.version <= 38)
  assert.equal(hash(JSON.stringify(prior.map(({ version, name, checksum }) => ({ version, name, checksum })))),
    'ab314148eeab108aeb9de3ae32cd4272f91916261d51883cc5b0581d0a047c0b')
  for (const migration of workspaceDatabaseMigrations) assert.equal(migration.checksum, hash(migration.sql))
  assert.equal(workspaceDatabaseMigrations.length, WORKSPACE_DATABASE_SCHEMA_VERSION)
  assert.equal(workspaceDatabaseMigrations[38]!.name, 'distinct-canonical-event-identities')
})

test('shared rebuild helper rejects enabled foreign keys before any destructive schema operation', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE canonical_events(id TEXT); BEGIN IMMEDIATE')
    assert.throws(() => rebuildSqliteTable(db, { table: 'canonical_events', copySql: 'DROP TABLE canonical_events', guardsSql: '', integrityMessage: '测试保护' }), { code: 'DATABASE_MIGRATION_FAILED' })
    assert.ok(db.prepare("SELECT name FROM sqlite_schema WHERE name='canonical_events'").get())
    db.exec('ROLLBACK')
  } finally { db.close() }
})
