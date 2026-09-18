import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { ShadowImportService } from '../../../src/main/modules/library/application/shadow-import-service'
import { WorkspaceWriteCoordinator } from '../../../src/main/core/application/workspace-write-coordinator'
import { SqliteWorkspaceDatabaseFactory, workspaceDatabaseMigrations } from '../../../src/main/platform/storage/workspace-database'
import { decodeWorldMapDocument, decodeWorldMapLayoutView, decodeWorldMapView, decodeWorldMapWriteInput, type WorldMapDocument } from '../../../src/contracts/world-map/world-map'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'
import { DocumentService } from '../../../src/main/modules/manuscript/application/document-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../../src/main/modules/library/application/legacy-workspace-source'
import { SqliteManuscriptService } from '../../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { WorldMapService } from '../../../src/main/modules/world-map/application/world-map-service'

const codec = { available: () => true, encrypt: (value: string) => value, decrypt: (value: string) => value }
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const doc = (x = 10): WorldMapDocument => ({ version: 1, markers: [{ location: '旧车站', x, y: 37.125 }] })
const illustratedDoc = (): WorldMapDocument => ({ version: 2, markers: doc().markers.map(marker => ({ ...marker, sourceLocations: ['旧码头、山城与电车'] })), background: {
  assetId: 'c'.repeat(64), format: 'png', width: 1536, height: 1024, stylePreset: 'future-industrial', model: 'gpt-image-1', generatedAt: '2026-09-09T08:00:00.000Z', sourceFingerprint: 'd'.repeat(64)
} })
const isConflict = (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'CONFLICT'

async function fixture(t: TestContext, formal = false) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-world-map-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const settings = new SettingsStore(join(root, 'settings'), codec)
  const projects = new ProjectService(settings)
  const created = await projects.create({ parentPath: root, name: '地图隔离书', genre: '都市' })
  const project = created.project
  const documents = new DocumentService(projects)
  await documents.updateChapter(90, { title: '原稿', content: '原稿不能因地图布局变化而改变。' })
  const factory = new SqliteWorkspaceDatabaseFactory()
  const authority = new SqliteManuscriptService(factory)
  const source = new CurrentProjectLegacyWorkspaceSource(projects, documents)
  const importer = new ShadowImportService(source, factory)
  const activate = async () => { const preview = await importer.preview(); await importer.import(preview); await authority.activate(project.path, await source.snapshot()) }
  if (formal) await activate()
  const service = new WorldMapService(projects, authority)
  const mapPath = join(project.path, '.webnovel', 'config', 'world-map.json')
  const save = async (document: WorldMapDocument) => { const current = await service.read(); return service.write({ workItemId: current.workItemId, expectedRevision: current.revision, document }) }
  return { root, projects, project, documents, factory, authority, service, mapPath, save, activate, importer }
}

test('map read is zero-create in file and SQLite modes', async t => {
  const f = await fixture(t)
  const files = await readdir(f.project.path, { recursive: true })
  assert.deepEqual((await f.service.read()).document, { version: 1, markers: [] })
  assert.deepEqual(await readdir(f.project.path, { recursive: true }), files)
  await assert.rejects(readFile(join(f.project.path, '.webnovel', 'workspace.sqlite')), { code: 'ENOENT' })
  await f.activate()
  // Opening an existing WAL database may materialize SQLite's own -wal/-shm
  // sidecars; the read must create no map document, directory or mirror record.
  const domainFiles = async () => (await readdir(f.project.path, { recursive: true })).filter(path => !/workspace\.sqlite-(wal|shm)$/.test(path))
  const before = await domainFiles()
  const current = await f.service.read()
  assert.equal(current.mirrorStatus, null)
  assert.deepEqual(current.document, { version: 1, markers: [] })
  assert.deepEqual(await domainFiles(), before)
  const database = await f.factory.openExisting(f.project.path)
  assert.equal(database!.formalWorkspaceConfigReady('world_map'), false)
  assert.equal(database!.workspaceConfigMirror('world_map'), null)
  database!.close()
})

test('file and shadow roundtrip retain exact marker precision and leave manuscripts unchanged', async t => {
  const f = await fixture(t), before = await f.documents.chapter(90)
  assert.deepEqual((await f.save(doc())).document, doc())
  const preview = await f.importer.preview(); await f.importer.import(preview)
  assert.deepEqual((await f.save(doc(65.123456))).document, doc(65.123456))
  assert.deepEqual(JSON.parse(await readFile(f.mapPath, 'utf8')), doc(65.123456))
  assert.deepEqual(await f.documents.chapter(90), before)
  const db = await f.factory.openExisting(f.project.path)
  assert.equal(db!.storageMode(), 'shadow'); db!.close()
})

test('version 2 map metadata roundtrips in file and SQLite authority modes', async t => {
  for (const formal of [false, true]) {
    const f = await fixture(t, formal)
    const saved = await f.save(illustratedDoc())
    assert.deepEqual(saved.document, illustratedDoc())
    assert.deepEqual((await f.service.read()).document, illustratedDoc())
    assert.deepEqual(JSON.parse(await readFile(f.mapPath, 'utf8')), illustratedDoc())
  }
})

test('SQLite first explicit save imports existing file into config mirror infrastructure and CAS updates only map', async t => {
  const f = await fixture(t)
  await f.save(doc())
  await f.activate()
  const bodyBefore = await f.authority.chapters(f.project.path)
  const first = await f.save(doc(33))
  assert.equal(first.mirrorStatus, 'synced')
  assert.deepEqual(first.document, doc(33))
  const second = await f.save(doc(48))
  assert.notEqual(first.revision, second.revision)
  assert.deepEqual(JSON.parse(await readFile(f.mapPath, 'utf8')), doc(48))
  assert.deepEqual(await f.authority.chapters(f.project.path), bodyBefore)
  const database = await f.factory.openExisting(f.project.path)
  assert.equal(database!.workspaceConfig('world_map').revision, 2)
  assert.equal(database!.workspaceConfigMirror('world_map')?.relativePath, '.webnovel/config/world-map.json')
  database!.close()
})

test('external readable-map modifications survive formal saves while SQLite commits new layout', async t => {
  const f = await fixture(t, true)
  const first = await f.save(doc())
  const external = '{ broken external map kept exactly'
  await writeFile(f.mapPath, external)
  const read = await f.service.read()
  assert.deepEqual(read.document, doc())
  assert.equal(read.mirrorStatus, 'conflict')
  assert.equal(read.revision, first.revision)
  const saved = await f.service.write({ workItemId: read.workItemId, expectedRevision: read.revision, document: doc(87) })
  assert.deepEqual(saved.document, doc(87))
  assert.equal(saved.mirrorStatus, 'conflict')
  assert.equal(await readFile(f.mapPath, 'utf8'), external)
})

test('damaged authoritative JSON blocks read and write without reset or manuscript changes', async t => {
  const f = await fixture(t), current = await f.service.read(), manuscript = await f.documents.chapter(90)
  await mkdir(join(f.project.path, '.webnovel', 'config'), { recursive: true })
  const corrupt = '{ damaged'; await writeFile(f.mapPath, corrupt)
  await assert.rejects(f.service.read(), { code: 'INVALID_PROJECT_STATE' })
  await assert.rejects(f.service.write({ workItemId: current.workItemId, expectedRevision: current.revision, document: doc() }), { code: 'INVALID_PROJECT_STATE' })
  assert.equal(await readFile(f.mapPath, 'utf8'), corrupt)
  assert.deepEqual(await f.documents.chapter(90), manuscript)
})

test('formal map remains readable and acknowledges DB saves when the mirror target is a directory', async t => {
  const f = await fixture(t, true)
  await f.save(doc())
  await unlink(f.mapPath); await mkdir(f.mapPath)
  const current = await f.service.read()
  assert.deepEqual(current.document, doc())
  assert.equal(current.mirrorStatus, 'failed')
  const saved = await f.service.write({ workItemId: current.workItemId, expectedRevision: current.revision, document: doc(92) })
  assert.deepEqual(saved.document, doc(92))
  assert.equal(saved.mirrorStatus, 'failed')
  assert.deepEqual((await f.service.read()).document, doc(92))
  assert.deepEqual(await readdir(f.mapPath), [])
})

test('normal composition uses a distinct service lane and retains the shared SQLite write coordinator', { timeout: 10_000 }, async t => {
  const f = await fixture(t, true)
  const sharedWrites = new WorkspaceWriteCoordinator()
  const authority = new SqliteManuscriptService(f.factory, undefined, sharedWrites)
  const service = new WorldMapService(f.projects, authority)
  const current = await service.read()
  const saved = await service.write({ workItemId: current.workItemId, expectedRevision: current.revision, document: doc(53) })
  assert.deepEqual(saved.document, doc(53))
  assert.equal(sharedWrites.pending(f.project.path), false)
})

test('concurrent stale writers produce one winner in both authority modes', async t => {
  for (const formal of [false, true]) {
    const f = await fixture(t, formal), current = await f.service.read()
    const results = await Promise.allSettled([20, 30].map(x => f.service.write({ workItemId: current.workItemId, expectedRevision: current.revision, document: doc(x) })))
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    const rejected = results.find(result => result.status === 'rejected')
    assert.ok(rejected?.status === 'rejected' && isConflict(rejected.reason))
    assert.ok([20, 30].includes((await f.service.read()).document.markers[0]!.x))
  }
})

test('switching books while a formal save waits in the shared lane rejects before any map commit', async t => {
  const f = await fixture(t, true)
  const writes = new WorkspaceWriteCoordinator()
  const authority = new SqliteManuscriptService(f.factory, undefined, writes)
  let release!: () => void, reached!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const queued = new Promise<void>(resolve => { reached = resolve })
  const service = new WorldMapService(f.projects, {
    active: root => authority.active(root),
    readWorldMapConfig: root => authority.readWorldMapConfig(root),
    saveWorldMapConfig: (root, input, guard) => { reached(); return authority.saveWorldMapConfig(root, input, guard) }
  })
  const current = await service.read()
  const occupied = writes.run(f.project.path, () => gate)
  const pending = service.write({ workItemId: current.workItemId, expectedRevision: current.revision, document: doc() })
  const rejected = assert.rejects(pending, isConflict)
  try {
    await queued
    const second = await f.projects.create({ parentPath: f.root, name: '等待中切换的书', genre: '都市' })
    release(); await occupied; await rejected
    await assert.rejects(readFile(join(second.project.path, '.webnovel', 'config', 'world-map.json')), { code: 'ENOENT' })
    await assert.rejects(readFile(f.mapPath), { code: 'ENOENT' })
    assert.equal(await authority.readWorldMapConfig(f.project.path), null)
  } finally { release(); await occupied }
})

test('opaque revision binds canonical path even when copied books report identical IDs and documents', async t => {
  const f = await fixture(t), first = await f.service.read()
  const second = await f.projects.create({ parentPath: f.root, name: '另一本隔离书', genre: '都市' })
  const aliasProjects = { currentPath: () => f.projects.currentPath(), currentSummary: async () => ({ ...(await f.projects.currentSummary()), id: first.workItemId }) }
  const aliased = new WorldMapService(aliasProjects, f.authority)
  const secondRead = await aliased.read()
  assert.equal(first.workItemId, secondRead.workItemId)
  assert.notEqual(first.revision, secondRead.revision)
  await assert.rejects(aliased.write({ workItemId: first.workItemId, expectedRevision: first.revision, document: doc() }), isConflict)
  await assert.rejects(readFile(join(second.project.path, '.webnovel', 'config', 'world-map.json')), { code: 'ENOENT' })
  await f.projects.switch(f.project.path)
  assert.deepEqual((await f.service.read()).document, { version: 1, markers: [] })
})

test('map decoders strictly reject extra keys, untrimmed/duplicate locations and invalid coordinates', () => {
  assert.deepEqual(decodeWorldMapDocument({ version: 1, markers: [{ location: 'tower', x: 0, y: 100 }, { location: 'Tower', x: 1, y: 2 }] }).markers.length, 2)
  for (const bad of [
    { ...doc(), baseMap: '/private/path' }, { version: 2, markers: [] },
    { version: 1, markers: [...doc().markers, ...doc().markers] },
    ...['', ' ', ' tower ', 'x'.repeat(501)].map(location => ({ version: 1, markers: [{ location, x: 2, y: 3 }] })),
    ...[-1, 101, Infinity, NaN, '30'].map(x => ({ version: 1, markers: [{ location: '塔', x, y: 3 }] })),
    { version: 1, markers: Array.from({ length: 2001 }, (_, i) => ({ location: `塔${i}`, x: 1, y: 2 })) }
  ]) assert.throws(() => decodeWorldMapDocument(bad), { code: 'VALIDATION_ERROR' })
  const input = { workItemId: 'book', expectedRevision: 'a'.repeat(64), document: doc() }
  assert.deepEqual(decodeWorldMapWriteInput(input), input)
  const longWorkItemId = 'x'.repeat(32_767)
  assert.equal(decodeWorldMapWriteInput({ ...input, workItemId: longWorkItemId }).workItemId, longWorkItemId)
  assert.throws(() => decodeWorldMapWriteInput({ ...input, workItemId: `${longWorkItemId}x` }))
  assert.throws(() => decodeWorldMapWriteInput({ ...input, expectedRevision: 'old' }))
  assert.throws(() => decodeWorldMapWriteInput({ ...input, path: 'wrong-book' }))
  const layout = { workItemId: 'book', revision: 'a'.repeat(64), document: doc(), mirrorStatus: null }
  assert.deepEqual(decodeWorldMapLayoutView(layout), layout)
  assert.equal(decodeWorldMapLayoutView({ ...layout, workItemId: longWorkItemId }).workItemId, longWorkItemId)
  assert.throws(() => decodeWorldMapLayoutView({ ...layout, workItemId: `${longWorkItemId}x` }))
  assert.throws(() => decodeWorldMapLayoutView({ ...layout, mirrorStatus: 'saved' }))
  assert.deepEqual(decodeWorldMapView({ ...layout, events: [], chapters: [] }), { ...layout, events: [], chapters: [] })
  assert.throws(() => decodeWorldMapView({ ...layout, events: [], chapters: [{ id: 1, position: 1, title: '' }, { id: 2, position: 1, title: '' }] }))
  const chapter = { id: 90, position: 1, title: '原稿' }
  const event = { id: 'canonical:fact-1', source: 'canonical', sourceId: 'fact-1', title: '到站', time: '清晨', characters: ['旅人'], location: '旧车站', event: '到达', result: '', chapterId: 90 }
  assert.deepEqual(decodeWorldMapView({ ...layout, events: [event], chapters: [chapter] }).events, [event])
  const direct = { ...event, id: 'direct:fact-1', source: 'direct', chapterId: null }
  assert.deepEqual(decodeWorldMapView({ ...layout, events: [direct], chapters: [] }).events, [direct])
  for (const invalidEvent of [
    { ...event, id: 'bare-id' }, { ...event, id: 'direct:fact-1' },
    { ...event, sourceId: 'different-fact' }, { ...event, chapterId: 91 },
    { ...direct, chapterId: 90 }
  ]) assert.throws(() => decodeWorldMapView({ ...layout, events: [invalidEvent], chapters: [chapter] }), { code: 'VALIDATION_ERROR' })
  assert.throws(() => decodeWorldMapView({ ...layout, events: [event], chapters: [] }), { code: 'VALIDATION_ERROR' })
})

test('a genuine v36 schema gains map support and reaches the current schema retaining config bytes, revision and custom dependents', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-map-v36-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, '.webnovel'))
  const path = join(root, '.webnovel', 'workspace.sqlite'), raw = new DatabaseSync(path)
  const timestamp = '2026-09-08T08:00:00.000Z'
  raw.exec('PRAGMA foreign_keys=OFF')
  for (const migration of workspaceDatabaseMigrations.filter(item => item.version <= 36)) {
    if (migration.version === 36) {
      const definitions = raw.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND (type IN ('trigger','view') OR (type='index' AND tbl_name='task_runs')) ORDER BY CASE type WHEN 'view' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid").all()
      for (const definition of [...definitions].reverse()) if (definition.type !== 'index') raw.exec(`DROP ${definition.type === 'view' ? 'VIEW' : 'TRIGGER'} "${String(definition.name).replaceAll('"', '""')}"`)
      const split = migration.sql.indexOf('CREATE TRIGGER task_runs_writing_active_insert_guard')
      raw.exec(migration.sql.slice(0, split))
      for (const definition of definitions) raw.exec(String(definition.sql))
      raw.exec(migration.sql.slice(split))
    } else raw.exec(migration.sql)
    raw.prepare('INSERT INTO schema_migrations VALUES (?,?,?,?)').run(migration.version, migration.name, timestamp, migration.checksum)
    raw.exec(`PRAGMA user_version=${migration.version}`)
  }
  raw.prepare("INSERT INTO projects(id,name,status,legacy_manifest_hash,storage_mode,created_at,updated_at) VALUES ('p','旧作品','active',?,'sqlite',?,?)").run(digest('manifest'), timestamp, timestamp)
  const content = '{ "events": [] }'
  raw.prepare("INSERT INTO workspace_config_documents VALUES ('p','timeline',4,?,?,?)").run(content, digest(content), timestamp)
  raw.exec("CREATE VIEW custom_map_config_view AS SELECT kind,revision FROM workspace_config_documents; CREATE INDEX custom_map_config_index ON workspace_config_documents(revision); CREATE TRIGGER custom_map_config_trigger AFTER UPDATE ON workspace_config_documents BEGIN SELECT 1; END;")
  const before = raw.prepare('SELECT * FROM workspace_config_documents').all()
  const migrations = raw.prepare('SELECT * FROM schema_migrations').all()
  raw.close()
  const upgraded = await new SqliteWorkspaceDatabaseFactory().openExisting(root)
  assert.equal(upgraded!.inspect().schemaVersion, workspaceDatabaseMigrations.at(-1)!.version)
  assert.equal(upgraded!.workspaceConfig('timeline').content, content)
  const inserted = upgraded!.importWorkspaceConfig('world_map', JSON.stringify(doc()), digest(JSON.stringify(doc())))
  assert.equal(inserted.document.revision, 1)
  upgraded!.close()
  const verify = new DatabaseSync(path, { readOnly: true })
  assert.deepEqual(verify.prepare("SELECT * FROM workspace_config_documents WHERE kind='timeline'").all(), before)
  assert.deepEqual(verify.prepare('SELECT * FROM schema_migrations WHERE version<=36').all(), migrations)
  for (const name of ['custom_map_config_view', 'custom_map_config_index', 'custom_map_config_trigger']) assert.ok(verify.prepare('SELECT name FROM sqlite_schema WHERE name=?').get(name))
  assert.equal(verify.prepare('PRAGMA foreign_key_check').all().length, 0)
  assert.equal(verify.prepare('SELECT current_schema_version FROM projects').get()?.current_schema_version, workspaceDatabaseMigrations.at(-1)!.version)
  verify.close()
})
