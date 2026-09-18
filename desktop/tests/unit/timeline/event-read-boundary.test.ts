import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { type TestContext } from 'node:test'
import type { WorkspaceDatabaseFactory } from '../../../src/main/core/ports/workspace-database'
import { WORKSPACE_DATABASE_RELATIVE_PATH, WORKSPACE_DATABASE_SCHEMA_VERSION } from '../../../src/main/core/ports/workspace-database'
import { SqliteWorkspaceDatabaseFactory, workspaceDatabaseMigrations } from '../../../src/main/platform/storage/workspace-database'
import { eventReadSnapshot } from '../../../src/main/modules/timeline/adapters/event-read-snapshot'
import { WorkspaceWriteCoordinator } from '../../../src/main/core/application/workspace-write-coordinator'
import { ResearchLibraryService } from '../../../src/main/modules/library/application/research-library-service'
import { SqliteManuscriptService } from '../../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'
import { WorkspaceService } from '../../../src/main/modules/library/application/workspace-service'

const timestamp = '2026-09-11T08:00:00.000Z'
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const source = { id: 'source-one', provider: 'manual', sourceType: 'manual' as const, title: '逐字资料', capturedAt: timestamp, excerpt: '  在旧城发现回音。\r\n', userNotes: '', contentHash: 'a'.repeat(64) }
const canonical = { id: 'event-one', time: '第一夜', characters: ['和田', '林与舟'], location: '旧城', event: '发现回音', result: '', evidenceRefs: [{ sourceId: source.id, excerpt: source.excerpt }], confidence: 1, status: 'candidate' as const, createdAt: timestamp }
const direct = { id: 'direct-one', title: '  原标题  ', time: '第二夜', characters: '和田、林与舟', location: '旧城', event: '  追踪回音  ', result: '' }

async function fixture(context: TestContext, version: number | null = WORKSPACE_DATABASE_SCHEMA_VERSION) {
  const root = await mkdtemp(join(tmpdir(), 'novel-event-read-'))
  const handles: Array<{ close(): void }> = []
  context.after(async () => {
    for (const handle of handles.reverse()) handle.close()
    assert.ok(root.startsWith(join(tmpdir(), 'novel-event-read-')))
    await rm(root, { recursive: true, force: true })
  })
  const factory = new SqliteWorkspaceDatabaseFactory(() => new Date(timestamp))
  const originalRead = factory.openEventReadOnly.bind(factory)
  factory.openEventReadOnly = async (book) => { const reader = await originalRead(book); if (reader) handles.push(reader); return reader }
  const path = join(root, WORKSPACE_DATABASE_RELATIVE_PATH)
  await mkdir(join(root, '.webnovel', 'research'), { recursive: true })
  await mkdir(join(root, '.webnovel', 'config'), { recursive: true })
  await writeFile(join(root, '.webnovel', 'research', 'sources.json'), JSON.stringify({ version: 1, sources: [source] }))
  await writeFile(join(root, '.webnovel', 'research', 'events.json'), JSON.stringify({ version: 1, events: [canonical] }))
  await writeFile(join(root, '.webnovel', 'config', 'timeline.json'), JSON.stringify({ events: [direct, { ...direct, title: '另一个相同事件' }] }) + '\r\n')
  await writeFile(join(root, 'author-notes.md'), '作者手写内容，不能变。\r\n')
  if (version !== null) {
    if (version === WORKSPACE_DATABASE_SCHEMA_VERSION) (await factory.open(root)).close()
    const raw = new DatabaseSync(path, { allowExtension: false })
    try {
      raw.exec('PRAGMA foreign_keys = ON')
      for (const migration of workspaceDatabaseMigrations.filter((item) => version !== WORKSPACE_DATABASE_SCHEMA_VERSION && item.version <= version)) {
        raw.exec(migration.sql)
        raw.prepare('INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)').run(migration.version, migration.name, timestamp, migration.checksum)
        raw.exec(`PRAGMA user_version = ${migration.version}`)
      }
      raw.prepare("INSERT INTO projects (id, name, status, legacy_manifest_hash, storage_mode, created_at, updated_at) VALUES ('book-one', '隔离只读作品', 'active', ?, 'sqlite', ?, ?)").run('b'.repeat(64), timestamp, timestamp)
    } finally { raw.close() }
  }
  const settings = new SettingsStore(join(root, 'isolated-settings'), { available: () => false, encrypt: () => assert.fail('no credential access'), decrypt: () => assert.fail('no credential access') })
  await settings.setCurrentProject(root)
  const projects = new ProjectService(settings)
  const sqlite = new SqliteManuscriptService(factory)
  const library = new ResearchLibraryService(projects, sqlite)
  const workspace = new WorkspaceService(projects, undefined, library, undefined, undefined, undefined, sqlite)
  const open = async () => { const db = await factory.openExisting(root); assert.ok(db); handles.push(db); return db }
  const mutateRaw = (operation: (db: DatabaseSync) => void) => { const raw = new DatabaseSync(path); try { operation(raw) } finally { raw.close() } }
  return { root, path, factory, sqlite, library, workspace, projects, open, mutateRaw,
    track: (handle: { close(): void }) => handles.push(handle) }
}

async function authorFiles(root: string) {
  const values: Record<string, string> = {}
  const visit = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else values[relative(root, path)] = hash(await readFile(path))
    }
  }
  await visit(root)
  return values
}

test('missing database stays absent through real timeline, research and search reads', async (context) => {
  const f = await fixture(context, null)
  const before = await authorFiles(f.root)
  assert.equal(await f.factory.openEventReadOnly(f.root), null)
  assert.equal((await f.workspace.timeline()).events.length, 2)
  assert.deepEqual(await f.library.listSources(), { sources: [source] })
  assert.deepEqual(await f.library.listEvents(), { events: [canonical] })
  assert.deepEqual(await f.library.searchSources(['回音']), { sources: [source], formal: false })
  assert.deepEqual(await authorFiles(f.root), before)
})

test('old schema stays unchanged; unready modules are readable without import, baseline or mirror work', async (context) => {
  const f = await fixture(context, 25)
  const before = await authorFiles(f.root)
  assert.equal((await f.workspace.timeline()).events[0]?.title, direct.title)
  assert.deepEqual(await f.library.listEvents(), { events: [canonical] })
  assert.deepEqual(await f.library.searchSources(['回音']), { sources: [source], formal: false })
  const reader = await f.factory.openEventReadOnly(f.root)
  assert.ok(reader)
  assert.equal(reader.schemaVersion, 25)
  assert.equal(reader.formalCanonicalEventsReady(), false)
  assert.equal(reader.formalMaterialSourcesReady(), false)
  assert.equal(reader.formalWorkspaceConfigReady('timeline'), false)
  assert.equal('importCanonicalEvents' in reader, false)
  assert.equal('database' in reader, false)
  reader.close()
  assert.deepEqual(await authorFiles(f.root), before)
})

test('old approved canon is read without upgrading schema or inventing event versions', async (context) => {
  const f = await fixture(context, 25)
  f.mutateRaw((raw) => {
    raw.prepare("INSERT INTO material_sources (id, project_id, provider, source_type, title, captured_at, excerpt, user_notes, content_hash) VALUES (?, 'book-one', 'manual', 'manual', ?, ?, ?, '', ?)").run(source.id, source.title, timestamp, source.excerpt, source.contentHash)
    raw.prepare("INSERT INTO canonical_events (id, project_id, time_ref, location_text, event_text, result_text, confidence, status, event_signature, slot_signature, created_at) VALUES (?, 'book-one', ?, ?, ?, '', 1, 'approved', 'signature', 'slot', ?)").run(canonical.id, canonical.time, canonical.location, canonical.event, timestamp)
    canonical.characters.forEach((name, ordinal) => raw.prepare('INSERT INTO canonical_event_characters (event_id, ordinal, name, normalized_name) VALUES (?, ?, ?, ?)').run(canonical.id, ordinal, name, name))
    raw.prepare('INSERT INTO canonical_event_evidence_refs (event_id, ordinal, source_id, excerpt) VALUES (?, 0, ?, ?)').run(canonical.id, source.id, source.excerpt)
    raw.exec('UPDATE projects SET material_sources_ready = 1, canonical_events_ready = 1')
  })
  const before = await authorFiles(f.root)
  assert.deepEqual((await f.library.listEvents()).events, [{ ...canonical, status: 'approved' }])
  const reader = await f.factory.openEventReadOnly(f.root)
  assert.ok(reader)
  assert.deepEqual(reader.listCanonicalEventVersions(canonical.id), [])
  assert.equal(reader.canonicalEventVersionHeads(canonical.id), null)
  assert.throws(() => reader.listCanonicalEventVersions('missing'), { code: 'NOT_FOUND' })
  reader.close()
  assert.deepEqual(await authorFiles(f.root), before)
})

test('formal reads leave pending mirrors and externally changed files untouched', async (context) => {
  const f = await fixture(context)
  const db = await f.open()
  db.importMaterialSources([source])
  db.importCanonicalEvents([canonical])
  db.baselineCanonicalEventVersions()
  const timeline = JSON.stringify({ events: [direct] })
  db.importWorkspaceConfig('timeline', timeline, hash(timeline))
  db.close()
  await writeFile(join(f.root, '.webnovel', 'research', 'events.json'), '外部作者修改，不能覆盖')
  await writeFile(join(f.root, '.webnovel', 'config', 'timeline.json'), '外部作者修改，不能覆盖')
  const before = await authorFiles(f.root)
  assert.deepEqual((await f.library.listEvents()).events, [canonical])
  assert.deepEqual((await f.workspace.timeline()).events, [direct])
  assert.deepEqual(await f.library.searchSources(['回音']), { sources: [source], formal: true })
  const reader = await f.factory.openEventReadOnly(f.root)
  assert.ok(reader)
  assert.equal(reader.canonicalEventsMirror()?.status, 'pending')
  assert.equal(reader.workspaceConfigMirror('timeline')?.status, 'pending')
  assert.equal(reader.listCanonicalEventVersions(canonical.id).length, 1)
  reader.close()
  assert.deepEqual(await authorFiles(f.root), before)
})

test('malformed legacy timeline is not an empty success and cannot be overwritten by ordinary save', async (context) => {
  const f = await fixture(context, null)
  await writeFile(join(f.root, '.webnovel', 'config', 'timeline.json'), '{broken')
  const before = await authorFiles(f.root)
  await assert.rejects(f.workspace.timeline(), { code: 'INVALID_PROJECT_STATE' })
  await assert.rejects(f.workspace.saveTimeline([direct]), { code: 'INVALID_PROJECT_STATE' })
  assert.deepEqual(await authorFiles(f.root), before)
})

test('legacy timeline validates row types without normalizing duplicate IDs, whitespace or unknown metadata', async (context) => {
  const f = await fixture(context, null)
  const path = join(f.root, '.webnovel', 'config', 'timeline.json')
  const events = [direct, { ...direct, metadata: { preserved: ['扩展字段'] } }]
  await writeFile(path, JSON.stringify({ events }))
  assert.deepEqual((await f.workspace.timeline()).events, events)
  for (const row of [null, { ...direct, characters: ['和田'] }, { ...direct, result: 42 }]) {
    await writeFile(path, JSON.stringify({ events: [direct, row] }))
    const before = await authorFiles(f.root)
    await assert.rejects(f.workspace.timeline(), { code: 'INVALID_PROJECT_STATE' })
    await assert.rejects(f.workspace.saveTimeline([direct]), { code: 'INVALID_PROJECT_STATE' })
    assert.deepEqual(await authorFiles(f.root), before)
  }
})

test('inspection rejects schema corruption and newer schemas without migration', async (context) => {
  const f = await fixture(context, 25)
  f.mutateRaw((raw) => { raw.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 25').run('0'.repeat(64)) })
  let before = await authorFiles(f.root)
  await assert.rejects(f.factory.openEventReadOnly(f.root), { code: 'DATABASE_INTEGRITY_FAILED' })
  assert.deepEqual(await authorFiles(f.root), before)
  f.mutateRaw((raw) => { raw.exec(`PRAGMA user_version = ${WORKSPACE_DATABASE_SCHEMA_VERSION + 1}`) })
  before = await authorFiles(f.root)
  await assert.rejects(f.factory.openEventReadOnly(f.root), { code: 'UNSUPPORTED_PROJECT_VERSION' })
  assert.deepEqual(await authorFiles(f.root), before)
})

test('missing read capability never falls back to a mutating database open', async () => {
  const factory: WorkspaceDatabaseFactory = { open: async () => assert.fail('must not open'), openExisting: async () => assert.fail('must not open existing') }
  const sqlite = new SqliteManuscriptService(factory)
  await assert.rejects(sqlite.readCanonicalEvents('unused-book'), { code: 'FEATURE_UNAVAILABLE' })
})

test('book switch during a read rejects late timeline and research results', async (context) => {
  const f = await fixture(context, null)
  let current = f.root
  const projects = { currentPath: async () => current } as ProjectService
  const changing = new SqliteManuscriptService(f.factory)
  changing.readTimelineConfig = async () => { current = f.root + '-other'; return { content: JSON.stringify({ events: [direct] }), contentHash: 'a'.repeat(64) } }
  const workspace = new WorkspaceService(projects, undefined, undefined, undefined, undefined, undefined, changing)
  await assert.rejects(workspace.timeline(), { code: 'CONFLICT' })
  current = f.root
  changing.readMaterialSources = async () => { current = f.root + '-other'; return [source] }
  await assert.rejects(new ResearchLibraryService(projects, changing).listEvents(), { code: 'CONFLICT' })
})

test('live committed WAL is included while uncommitted data stays invisible and database/WAL bytes stay exact', async (context) => {
  const f = await fixture(context)
  const writer = new DatabaseSync(f.path)
  f.track(writer)
  writer.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0')
  const insert = writer.prepare("INSERT INTO material_sources (id, project_id, provider, source_type, title, captured_at, excerpt, user_notes, content_hash) VALUES (?, 'book-one', 'manual', 'manual', ?, ?, ?, '', ?)")
  insert.run(source.id, source.title, timestamp, source.excerpt, source.contentHash)
  writer.exec('UPDATE projects SET material_sources_ready = 1')
  assert.ok((await readFile(`${f.path}-wal`)).length > 0)
  writer.exec('BEGIN IMMEDIATE')
  insert.run('uncommitted', '不可见资料', timestamp, '还未提交', 'c'.repeat(64))
  // Windows locks the live SHM lock bytes against raw file reads. Keep full-byte
  // assertions for DB/WAL and record SHM metadata + directory membership here;
  // all non-live fixtures still hash every source file without exclusions.
  const inspectLive = async () => {
    const shm = await stat(`${f.path}-shm`)
    return { database: hash(await readFile(f.path)), wal: hash(await readFile(`${f.path}-wal`)),
      shm: { size: shm.size, modified: shm.mtimeMs }, entries: (await readdir(dirname(f.path))).sort() }
  }
  const before = await inspectLive()
  assert.deepEqual((await f.library.listSources()).sources.map((item) => item.id), [source.id])
  assert.deepEqual(await inspectLive(), before)
  assert.equal(writer.prepare('SELECT COUNT(*) AS count FROM material_sources').get()?.count, 2)
  writer.exec('ROLLBACK')
})

test('snapshot rejects source changes during copying and cleans only its own private copy', async (context) => {
  const f = await fixture(context, 25)
  let privatePath: string | undefined
  let changed: Record<string, string> | undefined
  await assert.rejects(eventReadSnapshot(f.root, async (path) => {
    privatePath = path
    f.mutateRaw((raw) => { raw.exec("UPDATE projects SET name = '外部更新'") })
    changed = await authorFiles(f.root)
  }), { code: 'CONFLICT' })
  assert.deepEqual(await authorFiles(f.root), changed)
  assert.ok(privatePath)
  await assert.rejects(readdir(dirname(privatePath)), { code: 'ENOENT' })
})

test('snapshot detects a sidecar appearing after the copy and preserves it', async (context) => {
  const f = await fixture(context, 25)
  await assert.rejects(eventReadSnapshot(f.root, () => writeFile(`${f.path}-wal`, '新出现的日志')), { code: 'CONFLICT' })
  assert.equal(await readFile(`${f.path}-wal`, 'utf8'), '新出现的日志')
})

test('orphan and hot recovery journals block inspection without source recovery or cleanup', async (context) => {
  const missing = await fixture(context, null)
  await writeFile(`${missing.path}-wal`, '孤立日志')
  let before = await authorFiles(missing.root)
  await assert.rejects(missing.factory.openEventReadOnly(missing.root), { code: 'CONFLICT' })
  assert.deepEqual(await authorFiles(missing.root), before)
  const present = await fixture(context, 25)
  await writeFile(`${present.path}-journal`, '需要由数据库恢复流程处理的日志')
  before = await authorFiles(present.root)
  await assert.rejects(present.factory.openEventReadOnly(present.root), { code: 'CONFLICT' })
  assert.deepEqual(await authorFiles(present.root), before)
})

test('snapshot dispose is idempotent and never deletes an unrelated temporary file', async (context) => {
  const f = await fixture(context, 25)
  const snapshot = await eventReadSnapshot(f.root)
  assert.ok(snapshot)
  const privateRoot = dirname(snapshot.path)
  await writeFile(join(privateRoot, 'unrelated.txt'), '保留')
  snapshot.dispose()
  assert.equal(await readFile(join(privateRoot, 'unrelated.txt'), 'utf8'), '保留')
  await writeFile(snapshot.path, '在关闭后出现的新文件')
  snapshot.dispose()
  assert.equal(await readFile(snapshot.path, 'utf8'), '在关闭后出现的新文件')
  context.after(async () => {
    assert.ok(privateRoot.startsWith(join(tmpdir(), 'lanjian-event-read-')))
    await rm(privateRoot, { recursive: true, force: true })
  })
})

test('database and sidecar junction escapes are rejected without touching the outside target', async (context) => {
  const f = await fixture(context, null)
  const outside = await mkdtemp(join(tmpdir(), 'novel-event-read-outside-'))
  context.after(async () => {
    assert.ok(outside.startsWith(join(tmpdir(), 'novel-event-read-outside-')))
    await rm(outside, { recursive: true, force: true })
  })
  await writeFile(join(outside, 'protected.txt'), '外部内容')
  const before = await authorFiles(outside)
  for (const suffix of ['', '-wal', '-journal']) {
    const link = `${f.path}${suffix}`
    await symlink(outside, link, 'junction')
    try { await assert.rejects(f.factory.openEventReadOnly(f.root), { code: 'PATH_ESCAPE' }) }
    finally { await rm(link) }
  }
  assert.deepEqual(await authorFiles(outside), before)
})

test('read snapshot waits for the same-book write lane without acquiring any write capability', async (context) => {
  const f = await fixture(context, null)
  const writes = new WorkspaceWriteCoordinator()
  let release!: () => void
  let entered!: () => void
  const ready = new Promise<void>((resolve) => { entered = resolve })
  const blocked = new Promise<void>((resolve) => { release = resolve })
  const write = writes.run(f.root, async () => { entered(); await blocked })
  await ready
  let opened = false
  const original = f.factory.openEventReadOnly.bind(f.factory)
  f.factory.openEventReadOnly = async (root) => { opened = true; return original(root) }
  const sqlite = new SqliteManuscriptService(f.factory, undefined, writes)
  const read = sqlite.readCanonicalEvents(f.root)
  await Promise.resolve()
  assert.equal(opened, false)
  release()
  await write
  assert.equal(await read, null)
  assert.equal(opened, true)
})

test('5000-row compatibility timelines preserve every occurrence in file and SQLite read snapshots', async (context) => {
  const f = await fixture(context)
  const events = Array.from({ length: 5_000 }, (_, index) => ({ ...direct, id: `duplicate-${index % 100}`, title: `原始顺序 ${index}`, metadata: { index } }))
  const content = JSON.stringify({ events })
  await writeFile(join(f.root, '.webnovel', 'config', 'timeline.json'), content)
  let started = performance.now()
  assert.deepEqual((await f.workspace.timeline()).events, events)
  const fileMs = performance.now() - started
  const db = await f.open()
  db.importWorkspaceConfig('timeline', content, hash(content))
  db.close()
  const before = await authorFiles(f.root)
  started = performance.now()
  assert.deepEqual((await f.workspace.timeline()).events, events)
  const sqliteMs = performance.now() - started
  assert.deepEqual(await authorFiles(f.root), before)
  context.diagnostic(JSON.stringify({ rows: events.length, databaseBytes: (await stat(f.path)).size,
    fileReadMs: Math.round(fileMs), sqliteReadMs: Math.round(sqliteMs) }))
})
