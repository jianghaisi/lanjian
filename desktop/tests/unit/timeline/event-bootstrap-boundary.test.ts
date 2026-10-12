import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { ShadowImportService } from '../../../src/main/modules/library/application/shadow-import-service'
import { WorkspaceWriteCoordinator } from '../../../src/main/core/application/workspace-write-coordinator'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'
import { BookImportService } from '../../../src/main/modules/library/application/book-import-service'
import { CharacterStateService } from '../../../src/main/modules/characters/application/character-state-service'
import { ContinuationAnalysisService } from '../../../src/main/modules/library/application/continuation-analysis-service'
import { DocumentService } from '../../../src/main/modules/manuscript/application/document-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../../src/main/modules/library/application/legacy-workspace-source'
import { OutlinePlanningService } from '../../../src/main/modules/planning/application/outline-planning-service'
import { PlanningPackageService } from '../../../src/main/modules/planning/application/planning-package-service'
import { ProjectAiService } from '../../../src/main/modules/models/application/project-ai-service'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { ResearchLibraryService } from '../../../src/main/modules/library/application/research-library-service'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'
import { SqliteManuscriptService } from '../../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { WorkspaceBootstrapService } from '../../../src/main/modules/library/application/workspace-bootstrap-service'
import { WorkspaceService } from '../../../src/main/modules/library/application/workspace-service'
import { createEventRuntime } from '../../../src/main/modules/timeline/runtime/event-runtime'
import { unwrapValidatedIpcResponse } from '../../../src/contracts/core/ipc-response'
import { FileBookModelSource } from '../../../src/main/modules/models/adapters/book-model-source'
import { BookModelsService } from '../../../src/main/modules/models/application/book-models-service'
import { AppError } from '../../../src/main/core/errors/app-error'

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const stamp = '2026-09-11T12:00:00.000Z'
const source = { id: 'source-one', provider: 'manual', sourceType: 'manual' as const, title: '原始资料', capturedAt: stamp,
  excerpt: '  旧城有一次回音。\r\n', userNotes: '', contentHash: 'a'.repeat(64) }
const event = { id: 'event-one', time: '第一夜', characters: ['和田'], location: '旧城', event: '听见回音', result: '',
  evidenceRefs: [{ sourceId: source.id, excerpt: source.excerpt }], confidence: 1, status: 'candidate' as const, createdAt: stamp }
const direct = { id: 'direct-one', title: '作者的标题', time: '第二夜', characters: '和田、林与舟', location: '旧城', event: '寻找回音', result: '' }

async function fixture(context: TestContext, sqliteMode = true, warm = false, productionModels = false) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'novel-event-bootstrap-'))
  context.after(async () => {
    assert.ok(temporaryRoot.startsWith(join(tmpdir(), 'novel-event-bootstrap-')))
    await rm(temporaryRoot, { recursive: true, force: true })
  })
  const settings = new SettingsStore(join(temporaryRoot, 'settings'), {
    available: () => false, encrypt: () => assert.fail('no credentials'), decrypt: () => assert.fail('no credentials')
  })
  const databases = new SqliteWorkspaceDatabaseFactory()
  // Match the desktop composition, including its database-backed book identity.
  const projects = new ProjectService(settings, undefined, async (path) => {
    const database = await databases.openExisting(path)
    if (!database) return null
    try {
      if (database.storageMode() !== 'sqlite') return null
      return { title: database.inspect().project.name, genre: database.projectWritingConfig().genreText }
    } finally { database.close() }
  })
  const created = await projects.create({ parentPath: temporaryRoot, name: '隔离开书事件', genre: '悬疑' })
  const root = created.project.path
  const files = new DocumentService(projects)
  await files.updateChapter(1, { title: '第一章', content: '作者正文不能被读取操作修改。' })
  const writes = new WorkspaceWriteCoordinator()
  const authority = new SqliteManuscriptService(databases, undefined, writes)
  if (sqliteMode) {
    const legacy = new CurrentProjectLegacyWorkspaceSource(projects, files)
    const importer = new ShadowImportService(legacy, databases, writes)
    await importer.import(await importer.preview())
    await authority.activate(root, await legacy.snapshot())
  }
  const documents = new DocumentService(projects, undefined, authority)
  const library = new ResearchLibraryService(projects, authority)
  const planning = new OutlinePlanningService(projects, documents, library, authority)
  const characters = new CharacterStateService(projects, authority)
  const workspace = new WorkspaceService(projects, planning, library, documents, characters, undefined, authority)
  const projectAi = new ProjectAiService(projects, settings, authority)
  const scope = { windowId: 'fixture', generation: 0, bookRoot: root }
  const modelReads = new BookModelsService(new FileBookModelSource(), {
    capture: async () => { throw new AppError('FEATURE_UNAVAILABLE', 'synthetic unconfigured key') }
  }, {} as never, {} as never, {} as never, async () => scope, () => scope)
  const packages = new PlanningPackageService(projects, planning, documents, undefined, characters, workspace)
  const imports = new BookImportService(projects, documents, library)
  const continuation = new ContinuationAnalysisService({ complete: async () => assert.fail('no model calls') }, projects, imports, workspace, characters, planning)
  const events = createEventRuntime(projects, databases, writes)
  const bootstrap = new WorkspaceBootstrapService({ projects, documents, workspace, researchLibrary: library,
    eventProjection: { read: () => events.projection.readForConsumer() as never },
    aiSettings: () => productionModels ? modelReads.get() : projectAi.get(), researchSettings: () => settings.researchSettings(),
    outlinePlanning: planning, characterStates: characters, planningDraft: () => packages.get(),
    importRecoveries: () => imports.recoverableManifests(), continuation: () => continuation.state() })
  // Exercise both the first aggregate load and already-initialized modules.
  // Other modules' own compatibility writes are outside this event boundary.
  if (warm) await bootstrap.load()
  const eventPaths = ['.webnovel/research/sources.json', '.webnovel/research/events.json', '.webnovel/config/timeline.json']
  const eventFiles = async () => Promise.all(eventPaths.map(async (relative) => {
    try { return await readFile(join(root, relative), 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }))
  const seedFiles = async () => {
    await mkdir(join(root, '.webnovel', 'research'), { recursive: true })
    const values = [{ version: 1, sources: [source] }, { version: 1, events: [event] }, { events: [direct, direct] }]
    for (let index = 0; index < eventPaths.length; index += 1) await writeFile(join(root, eventPaths[index]!), JSON.stringify(values[index]) + '\r\n')
  }
  const eventDatabase = async () => {
    const db = await databases.openEventReadOnly(root)
    if (!db) return null
    try {
      const sourcesReady = db.formalMaterialSourcesReady()
      const eventsReady = db.formalCanonicalEventsReady()
      const timelineReady = db.formalWorkspaceConfigReady('timeline')
      return { sourcesReady, eventsReady, timelineReady,
        sources: sourcesReady ? db.listMaterialSources() : null,
        events: eventsReady ? db.listCanonicalEvents() : null,
        versions: eventsReady ? db.listCanonicalEvents().map((item) => db.listCanonicalEventVersions(item.id)) : null,
        timeline: timelineReady ? db.workspaceConfig('timeline') : null,
        mirrors: [db.materialSourcesMirror(), db.canonicalEventsMirror(), db.workspaceConfigMirror('timeline')] }
    } finally { db.close() }
  }
  const seedFormal = async () => {
    await seedFiles()
    const [sourceBytes, eventBytes, timelineBytes] = await eventFiles()
    const db = await databases.openExisting(root)
    assert.ok(db)
    try {
      db.importMaterialSources([source], hash(sourceBytes!))
      db.importCanonicalEvents([event], hash(eventBytes!))
      db.baselineCanonicalEventVersions()
      db.importWorkspaceConfig('timeline', JSON.stringify({ events: [direct] }), hash(JSON.stringify({ events: [direct] })), hash(timelineBytes!))
    } finally { db.close() }
  }
  return { root, databases, authority, projects, documents, workspace, library, events, bootstrap, eventFiles, eventDatabase, seedFiles, seedFormal, eventPaths }
}

test('production book-model snapshot reader survives real cold and warm bootstrap maintenance', async context => {
  const f = await fixture(context, true, false, true)
  for (let read = 0; read < 3; read++) {
    const result = await f.bootstrap.load()
    assert.deepEqual(result.issues, [])
    assert.ok(result.aiSettings)
    assert.equal(result.eventProjection, null) // explicit unmigrated compatibility, not corruption
    assert.equal(result.chapters[0]?.content, '作者正文不能被读取操作修改。')
  }
  const before = await readFile(join(f.root, '.webnovel/workspace.sqlite'))
  const check = await f.bootstrap.recheck({ workItem: { id: f.root, path: f.root }, issueIds: ['modelSettingsUnreadable', 'unifiedEventsUnreadable'] })
  assert.deepEqual(check.issues, [])
  assert.ok(check.aiSettings)
  assert.deepEqual(await readFile(join(f.root, '.webnovel/workspace.sqlite')), before)
})

for (const warm of [false, true]) {
  test(`real ${warm ? 'warm' : 'cold'} bootstrap preserves pending event/source/timeline mirrors and immutable event state`, async (context) => {
    const f = await fixture(context, true, warm)
    const chapters = await f.documents.chapters()
    await f.seedFormal()
    const before = await f.eventDatabase()
    const files = await f.eventFiles()
    assert.ok(before?.mirrors.every((mirror) => mirror?.status === 'pending'))
    const result = await f.bootstrap.load()
    assert.deepEqual(result.events.events, [event])
    assert.deepEqual(result.sources.sources, [source])
    assert.deepEqual(result.timeline.events, [direct])
    assert.equal(result.eventProjection, null)
    assert.deepEqual(result.issues, [])
    assert.deepEqual(result.chapters, chapters)
    assert.deepEqual(await f.eventFiles(), files)
    assert.deepEqual(await f.eventDatabase(), before)
    await f.bootstrap.load()
    assert.deepEqual(await f.eventFiles(), files)
    assert.deepEqual(await f.eventDatabase(), before)
  })
}

test('real bootstrap exposes one unified projection after reviewed migration', async (context) => {
  const f = await fixture(context)
  await f.seedFiles()
  await writeFile(join(f.root, f.eventPaths[2]!), JSON.stringify({ events: [direct] }) + '\r\n')
  const preview = await f.events.reviews.preview()
  const inspection = await f.events.reviews.inspection(preview.previewId)
  const rows = inspection.rowsPage(0).items
  const groups = inspection.groupsPage(0).items
  const findings = inspection.planningFindingsPage(0).items
  const grant = await f.events.reviews.review(preview.previewId, {
    fingerprint: preview.fingerprint,
    rows: rows.map((row) => ({ rowIndex: row.index, disposition: row.ref.source === 'sources' ? 'retain-source' as const : 'keep-separate' as const })),
    acknowledgedGroups: groups.filter((group) => group.severity === 'review').map((group) => group.id),
    acknowledgedPlanningFindings: findings.flatMap((finding, index) => finding.severity === 'review' ? [index] : []),
    acknowledgedMirrors: [...preview.requiredMirrorAcknowledgements]
  })
  await f.events.migrations.commit(grant.token)

  const result = await f.bootstrap.load()
  assert.deepEqual(unwrapValidatedIpcResponse('workspace:bootstrap', { ok: true, value: result }), result)

  assert.ok(result.eventProjection)
  assert.equal(result.eventProjection.workItemId, f.root)
  assert.equal(result.eventProjection.approved.length, 1)
  assert.equal(result.eventProjection.candidates.length, 1)
  assert.equal(result.eventProjection.state.order.eventIds[0], event.id)
  assert.equal(result.eventProjection.approved[0]?.content.event, direct.event)
})

test('real bootstrap never recreates missing event mirrors or acknowledges external event edits', async (context) => {
  const f = await fixture(context)
  await f.seedFormal()
  await rm(join(f.root, f.eventPaths[0]!))
  await writeFile(join(f.root, f.eventPaths[1]!), '外部作者正在修改事件，原件必须保留。')
  await writeFile(join(f.root, f.eventPaths[2]!), '外部时间线，不能覆盖。')
  const files = await f.eventFiles()
  const before = await f.eventDatabase()
  const result = await f.bootstrap.load()
  assert.deepEqual(result.events.events, [event])
  assert.deepEqual(result.timeline.events, [direct])
  assert.deepEqual(result.issues, [])
  assert.deepEqual(await f.eventFiles(), files)
  assert.deepEqual(await f.eventDatabase(), before)
})

test('real bootstrap preserves existing event mirror conflict and failure states without retrying them', async (context) => {
  const f = await fixture(context)
  await f.seedFormal()
  const db = await f.databases.openExisting(f.root)
  assert.ok(db)
  try {
    const plans = db.pendingMirrorPlans()
    const sourcePlan = plans.find((plan) => plan.sourceType === 'material_sources_json')
    const eventPlan = plans.find((plan) => plan.sourceType === 'canonical_events_json')
    assert.ok(sourcePlan && eventPlan)
    db.acknowledgeMirror(sourcePlan, 'conflict', 'b'.repeat(64), 'MIRROR_EXTERNAL_CHANGE')
    db.acknowledgeMirror(eventPlan, 'failed', undefined, 'STORAGE_WRITE_FAILED')
  } finally { db.close() }
  const files = await f.eventFiles()
  const before = await f.eventDatabase()
  assert.deepEqual(before?.mirrors.map((mirror) => mirror?.status), ['conflict', 'failed', 'pending'])
  const result = await f.bootstrap.load()
  assert.deepEqual(result.issues, [])
  assert.deepEqual(result.events.events, [event])
  assert.deepEqual(await f.eventFiles(), files)
  assert.deepEqual(await f.eventDatabase(), before)
})

for (const sqliteMode of [false, true]) {
  test(`real bootstrap keeps ${sqliteMode ? 'unmigrated SQLite' : 'file'} events in their legacy authority`, async (context) => {
    const f = await fixture(context, sqliteMode)
    await f.seedFiles()
    const files = await f.eventFiles()
    const before = await f.eventDatabase()
    assert.ok(!before?.eventsReady && !before?.sourcesReady && !before?.timelineReady)
    const result = await f.bootstrap.load()
    assert.deepEqual(result.events.events, [event])
    assert.deepEqual(result.timeline.events, [direct, direct])
    assert.deepEqual(result.issues, [])
    assert.deepEqual(await f.eventFiles(), files)
    assert.deepEqual(await f.eventDatabase(), before)
  })

  test(`real bootstrap leaves absent ${sqliteMode ? 'unmigrated SQLite' : 'file'} event ledgers absent`, async (context) => {
    const f = await fixture(context, sqliteMode)
    const before = await f.eventDatabase()
    assert.deepEqual(await f.eventFiles(), [null, null, null])
    const result = await f.bootstrap.load()
    assert.deepEqual(result.events.events, [])
    assert.deepEqual(result.sources.sources, [])
    assert.deepEqual(result.timeline.events, [])
    assert.deepEqual(result.issues, [])
    assert.deepEqual(await f.eventFiles(), [null, null, null])
    assert.deepEqual(await f.eventDatabase(), before)
  })
}

test('real bootstrap reports malformed legacy event ledgers without importing or replacing them', async (context) => {
  const f = await fixture(context)
  await f.seedFiles()
  await writeFile(join(f.root, f.eventPaths[0]!), '{ incomplete sources')
  await writeFile(join(f.root, f.eventPaths[1]!), '{ incomplete events')
  const files = await f.eventFiles()
  const before = await f.eventDatabase()
  const result = await f.bootstrap.load()
  assert.deepEqual(result.issues.map((issue) => issue.id).sort(), ['researchEventsUnreadable', 'researchSourcesUnreadable'])
  assert.deepEqual(result.timeline.events, [direct, direct])
  assert.deepEqual(await f.eventFiles(), files)
  assert.deepEqual(await f.eventDatabase(), before)
})

test('explicit mirror retry still synchronizes pending event mirrors without creating event history', async (context) => {
  const f = await fixture(context)
  await f.seedFormal()
  const before = await f.eventDatabase()
  assert.deepEqual(await f.authority.retryMirrors(f.root), { pending: 0, conflicts: 0, failed: 0 })
  const after = await f.eventDatabase()
  assert.ok(after?.mirrors.every((mirror) => mirror?.status === 'synced'))
  assert.deepEqual(after?.versions, before?.versions)
  assert.deepEqual(after?.events, before?.events)
  assert.notDeepEqual(await f.eventFiles(), [null, null, null])
})
