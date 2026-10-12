import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CompositionEntry } from '@lanjian/writing-plugin-contracts'
import { AppError } from '../../src/main/core/errors/app-error'
import { ProjectService } from '../../src/main/modules/library/application/project-service'
import { WorkspaceService } from '../../src/main/modules/library/application/workspace-service'
import { ResearchLibraryService } from '../../src/main/modules/library/application/research-library-service'
import { OutlinePlanningService } from '../../src/main/modules/planning/application/outline-planning-service'
import { createEventRuntime } from '../../src/main/modules/timeline/runtime/event-runtime'
import { SettingsStore } from '../../src/main/platform/settings/settings-store'
import { DocumentService } from '../../src/main/modules/manuscript/application/document-service'
import { SqliteManuscriptService } from '../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../src/main/modules/library/application/legacy-workspace-source'
import { ShadowImportService } from '../../src/main/modules/library/application/shadow-import-service'
import { SqliteWorkspaceDatabaseFactory } from '../../src/main/platform/storage/workspace-database'
import { WorkspaceWriteCoordinator } from '../../src/main/core/application/workspace-write-coordinator'
import { WorldMapService } from '../../src/main/modules/world-map/application/world-map-service'
import { WorldMapWorkspaceService } from '../../src/main/modules/world-map/application/world-map-workspace-service'
import { WorldMapGenerationService } from '../../src/main/modules/world-map/application/world-map-generation-service'
import { OpenAiCompatibleImageClient } from '../../src/main/modules/models/adapters/openai-compatible-image-client'
import { registerWorldMapIpc } from '../../src/main/modules/world-map/runtime/commands'
import type { WorldMapImageCandidate } from '../../src/contracts/world-map/world-map'
import { PluginPackageStore } from '../../src/main/modules/writing-plugins/adapters/package-store'
import { PluginDraftStore } from '../../src/main/modules/writing-plugins/adapters/draft-store'
import { buildPluginDraft } from '../../src/main/modules/writing-plugins/adapters/draft-builder'
import { bundledPackagePorts } from '../../src/main/modules/writing-plugins/adapters/bundled-packages'
import { PluginAuthoringService } from '../../src/main/modules/writing-plugins/application/authoring-service'
import { BundledPluginService } from '../../src/main/modules/writing-plugins/application/bundled-service'
import { PluginCompositionService } from '../../src/main/modules/writing-plugins/application/composition-service'
import { WritingPluginManager } from '../../src/main/modules/writing-plugins/application/plugin-manager'
import { createCreativePolicyProvider } from '../../src/main/modules/writing-plugins/runtime/creative-policy-provider'

const body = '沈砚来到石桥。'
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
const image = await readFile(new URL('../../src/renderer/assets/visuals/background-industrial-city.png', import.meta.url))
function gate() { let release!: () => void; const pending = new Promise<void>(r => { release = r }); return { pending, release } }
const error = (e: unknown) => e instanceof AppError
  ? ['CONFLICT', 'FEATURE_UNAVAILABLE', 'AI_RESPONSE_INVALID'].includes(e.code)
  : e instanceof Error && (e.name === 'AbortError' || e.message === '原接口已经变化')
async function fixture(t: TestContext, formal = true) {
  const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-map-policy-'))), releases: Array<() => void> = []
  t.after(async () => { releases.forEach(r => r()); assert.equal(dirname(await realpath(root)), parent); await rm(root, { recursive: true, force: true }) })
  const projects = new ProjectService(new SettingsStore(join(root, 'profile'), { available: () => false, encrypt: () => assert.fail(), decrypt: () => assert.fail() }))
  const { project } = await projects.create({ parentPath: root, name: '地图方法隔离验证', genre: '悬疑' }), files = new DocumentService(projects)
  const chapter = await files.createChapter(); await files.updateChapter(chapter.id, { title: '旧资料', content: body, expectedRevision: chapter.revision })
  const legacyContext = new WorkspaceService(projects)
  await legacyContext.saveTimeline([{ id: 'existing-event', title: '旧资料', time: '时间未标注', characters: '沈砚', location: '石桥', event: '来到石桥', result: '' }])
  const databases = new SqliteWorkspaceDatabaseFactory(), writes = new WorkspaceWriteCoordinator(), authority = new SqliteManuscriptService(databases, undefined, writes)
  if (formal) { const legacy = new CurrentProjectLegacyWorkspaceSource(projects, files), importer = new ShadowImportService(legacy, databases, writes); await importer.import(await importer.preview()); await authority.activate(project.path, await legacy.snapshot()) }
  const documents = new DocumentService(projects, undefined, authority)
  const research = new ResearchLibraryService(projects, authority)
  const events = createEventRuntime(projects, databases, writes)
  const planning = new OutlinePlanningService(projects, documents, research, authority, { read: () => events.projection.readForConsumer() })
  const context = new WorkspaceService(projects, planning, research, documents, undefined, undefined, authority, { read: () => events.projection.readForConsumer() })
  let saveHook: (() => Promise<void>) | undefined
  const map = new WorldMapService(projects, { active: r => authority.active(r), readWorldMapConfig: r => authority.readWorldMapConfig(r), saveWorldMapConfig: async (r, i, g) => { await saveHook?.(); return authority.saveWorldMapConfig(r, i, g) } })
  const workspace = new WorldMapWorkspaceService(projects, context, { chapters: async () => await authority.active(project.path) ? authority.worldMapChaptersForGuard(project.path) : documents.chapters() }, map)
  const manager = new WritingPluginManager(new PluginPackageStore(root), async () => {}), drafts = new PluginDraftStore(root)
  const authoring = new PluginAuthoringService(drafts, { build: buildPluginDraft, persist: b => drafts.persist(b), chooseExport: async () => null, choosePackage: async () => null, chooseSource: async () => null,
    installed: async (id, digest) => { const p = await manager.loadAuthorized(project.id, id, digest); return { manifest: p.version.manifest, files: p.files } } }, manager)
  const bundled = new BundledPluginService(bundledPackagePorts(root), manager, authoring), original = (await bundled.list()).find(p => p.manifest.id === 'lanjian.official.story-planning')!
  let draft = await bundled.derive({ pluginId: original.manifest.id, digest: original.digest }), manifest = JSON.parse(draft.manifestText)
  manifest.contributions = manifest.contributions.filter((c: { slot: string }) => c.slot === 'world-map-style')
  const schema = { type: 'object', properties: { focus: { type: 'string', maxLength: 100 } }, required: ['focus'], additionalProperties: false }
  manifest.contributions[0].configSchema = schema; manifest.assets.push('map-tail.md')
  manifest.contributions.push({ id: 'map-tail', name: '追加地图方法', kind: 'creative-policy', slot: 'world-map-style', mode: 'append', asset: 'map-tail.md', stages: ['worldbuilding'], configSchema: schema })
  draft = await authoring.save({ id: draft.id, revision: draft.revision, manifestText: JSON.stringify(manifest), files: [...draft.files.map(f => f.path === 'world-map-style.md' ? { ...f, content: 'PERSONAL_MAP_METHOD {{focus}}' } : f), { path: 'map-tail.md', content: 'APPEND_MAP_METHOD {{focus}}' }] })
  let built = await authoring.build({ id: draft.id, revision: draft.revision }), plan = await authoring.preview({ id: draft.id, revision: draft.revision })
  let index = await manager.install(plan.planId); index = await manager.setEnabled(draft.pluginId, true, [], index.revision); await manager.setBookEnabled(project.id, draft.pluginId, true, index.revision)
  let entries = manifest.contributions.map((c: { id: string }) => ({ pluginId: draft.pluginId, digest: built.digest, contributionId: c.id, params: { focus: 'ORIGINAL_PARAMS' } })) as CompositionEntry[]
  async function select(next: CompositionEntry[]) { const composition = new PluginCompositionService(manager), p = await composition.preview(project.id, next, (await manager.list()).revision, async () => {}); assert.deepEqual(p.conflicts, []); await composition.apply(p.planId) }
  await select(entries)
  let loadHook: (() => Promise<void>) | undefined, profileHook: (() => Promise<void>) | undefined, connectionHook: (() => Promise<void>) | undefined, version = 1
  let profileReads = 0
  const policy = createCreativePolicyProvider(() => manager.captureComposition(project.id), async v => { await loadHook?.(); return (await manager.loadAuthorized(project.id, v.manifest.id, v.digest)).files }, async ref => manager.loadAuthorized(project.id, ref.pluginId, ref.digest))
  const requests: Array<{ prompt: string; model: string }> = []
  let respond = async () => ({ data: [{ b64_json: image.toString('base64') }] }) as unknown
  const client = new OpenAiCompatibleImageClient({ resolveConnection: async () => { const captured = version; await connectionHook?.(); return { connectionName: '隔离图像服务', baseUrl: 'https://invalid.test/v1', apiKey: 'synthetic-only', requestGuard: { recheck: async () => { if (captured !== version) throw Error('原接口已经变化') }, assertActive: () => { if (captured !== version) throw Error('原接口已经变化') } } } } }, async (_url, init) => {
    const payload = JSON.parse(String(init!.body)); requests.push(payload); return new Response(JSON.stringify(await respond()), { headers: { 'Content-Type': 'application/json' } })
  })
  const make = () => new WorldMapGenerationService(projects, workspace, { bookProfile: async () => { profileReads++; const p = await context.bookProfile(); await profileHook?.(); return p }, foundation: r => context.foundation(r) }, map, client, undefined, policy)
  let generation = make()
  const input = async () => ({ workItemId: project.id, expectedRevision: (await workspace.read()).revision, operationId: 'abcdef0123456789', connectionId: 'image-connection', model: 'original-image-model', stylePreset: 'paper-atlas' as const })
  const ipc = async <T>(channel: string, ...args: unknown[]) => { const handlers = new Map<string, (_e: unknown, ...args: unknown[]) => unknown>(); registerWorldMapIpc({ handle: (c, h) => { handlers.set(c, h) } }, { worldMap: map, worldMapWorkspace: workspace, worldMapGeneration: generation }); return handlers.get(channel)!(undefined, ...args) as Promise<{ ok: boolean; value: T; error?: { message: string } }> }
  const assetPath = join(project.path, '.webnovel', 'assets', 'world-map', hash(image) + '.png')
  return { root, project, projects, files, documents, context, workspace, map, authority, writes, requests, input, ipc, assetPath, entries, select,
    generation: () => generation, reopen: () => { generation = make() }, reads: () => profileReads, track: (r: () => void) => releases.push(r),
    revoke: async () => manager.setBookEnabled(project.id, draft.pluginId, false, (await manager.list()).revision),
    loadHook: (h?: () => Promise<void>) => { loadHook = h }, profileHook: (h?: () => Promise<void>) => { profileHook = h }, connectionHook: (h?: () => Promise<void>) => { connectionHook = h }, saveHook: (h?: () => Promise<void>) => { saveHook = h }, respond: (h: typeof respond) => { respond = h }, connectionChanged: () => { version++ },
    changeSource: async () => context.saveFoundation({ ...await context.foundation(), worldView: '来源设定已修改' }),
    updateMethod: async (text: string, disabled = false) => {
      manifest.version = '2.0.0'; if (disabled) { manifest.contributions[0].mode = 'disabled'; delete manifest.contributions[0].asset }
      draft = await authoring.save({ id: draft.id, revision: draft.revision, manifestText: JSON.stringify(manifest), files: draft.files.map(f => f.path === 'world-map-style.md' ? { ...f, content: text } : f) })
      built = await authoring.build({ id: draft.id, revision: draft.revision }); plan = await authoring.preview({ id: draft.id, revision: draft.revision }); index = await manager.install(plan.planId); index = await manager.setEnabled(draft.pluginId, true, [], index.revision); await manager.setBookEnabled(project.id, draft.pluginId, true, index.revision)
      entries = entries.map(e => ({ ...e, digest: built.digest })); await select(entries)
    } }
}

test('installed replacement, append and params reach actual image IPC; explicit adoption persists the real asset and restart sends nothing', async t => {
  for (const formal of [false, true]) {
    const f = await fixture(t, formal), request = await f.input(), before = await f.documents.chapter(1)
    const result = await f.ipc<WorldMapImageCandidate>('workspace:generate-world-map-image', request); assert.equal(result.ok, true, result.error?.message ?? 'production IPC')
    assert.equal(f.requests.length, 1); assert.match(f.requests[0].prompt, /PERSONAL_MAP_METHOD ORIGINAL_PARAMS/); assert.match(f.requests[0].prompt, /APPEND_MAP_METHOD ORIGINAL_PARAMS/); assert.doesNotMatch(f.requests[0].prompt, /米白色纸张质感|2.5D战术沙盘/); assert.match(f.requests[0].prompt, /石桥/)
    await assert.rejects(readFile(f.assetPath), /ENOENT/)
    const adopted = await f.ipc('workspace:adopt-world-map-image', { workItemId: f.project.id, expectedRevision: request.expectedRevision, candidateId: result.value.candidateId }); assert.equal(adopted.ok, true, adopted.error?.message ?? 'adoption')
    assert.deepEqual(await readFile(f.assetPath), image); assert.deepEqual(await f.documents.chapter(1), before)
    f.reopen(); assert.equal((await f.generation().background())!.assetId, hash(image)); assert.equal(f.requests.length, 1)
    await assert.rejects(f.generation().adopt({ workItemId: f.project.id, expectedRevision: request.expectedRevision, candidateId: result.value.candidateId }), error)
  }
})

test('disabled map method stops before formal preparation and dispatch; oversized method never truncates or sends', async t => {
  for (const disabled of [true, false]) { const f = await fixture(t); await f.updateMethod(disabled ? 'disabled' : 'M'.repeat(11900), disabled); const input = await f.input(), reads = f.reads(); await assert.rejects(f.generation().generate(input), error); assert.equal(f.requests.length, 0); if (disabled) assert.equal(f.reads(), reads) }
})

test('composition changes during asynchronous preparation preserve the original method through image adoption', async t => {
  const f = await fixture(t); let changed = false; f.profileHook(async () => { if (!changed) { changed = true; await f.select([]) } })
  const input = await f.input(), candidate = await f.generation().generate(input)
  assert.match(f.requests[0].prompt, /PERSONAL_MAP_METHOD ORIGINAL_PARAMS/); assert.doesNotMatch(f.requests[0].prompt, /米白色纸张质感/)
  await f.generation().adopt({ workItemId: f.project.id, expectedRevision: input.expectedRevision, candidateId: candidate.candidateId }); assert.deepEqual(await readFile(f.assetPath), image)
})

test('withdrawal, source drift and frozen credential drift during real async connection resolution send zero image requests', async t => {
  for (const change of ['withdraw', 'source', 'credential']) { const f = await fixture(t); f.connectionHook(async () => { if (change === 'withdraw') await f.revoke(); else if (change === 'source') await f.changeSource(); else f.connectionChanged() }); await assert.rejects(f.generation().generate(await f.input()), error); assert.equal(f.requests.length, 0); await assert.rejects(readFile(f.assetPath), /ENOENT/) }
})

test('late valid and invalid withdrawn images never become candidates or assets', async t => {
  for (const invalid of [false, true]) { const f = await fixture(t); f.respond(async () => { await f.revoke(); return invalid ? { data: [] } : { data: [{ b64_json: image.toString('base64') }] } }); await assert.rejects(f.generation().generate(await f.input()), error); assert.equal(f.requests.length, 1); await assert.rejects(readFile(f.assetPath), /ENOENT/); assert.equal((await f.map.read()).document.version, 1) }
})

test('post-send source and credential drift refuse publication, and cancellation suppresses a provider ignoring abort', async t => {
  for (const change of ['source', 'credential', 'cancel']) { const f = await fixture(t), input = await f.input(); f.respond(async () => { if (change === 'source') await f.changeSource(); else if (change === 'credential') f.connectionChanged(); else assert.equal((await f.generation().cancel(input.operationId)).cancelled, true); return { data: [{ b64_json: image.toString('base64') }] } }); await assert.rejects(f.generation().generate(input), error); assert.equal(f.requests.length, 1); await assert.rejects(readFile(f.assetPath), /ENOENT/) }
})

test('same-content SQLite replacement rejects the late image and preserves both database byte sequences', async t => {
  const f = await fixture(t), path = join(f.project.path, '.webnovel', 'workspace.sqlite'), retained = path + '.original'; let original: Buffer | undefined
  f.respond(async () => { original = await readFile(path); await rename(path, retained); await copyFile(retained, path); return { data: [{ b64_json: image.toString('base64') }] } })
  await assert.rejects(f.generation().generate(await f.input()), error); assert.ok(original); assert.deepEqual(await readFile(path), original); assert.deepEqual(await readFile(retained), original); await assert.rejects(readFile(f.assetPath), /ENOENT/)
})

test('actual occupied SQLite save lane rechecks authorization and retains the legally written image without publishing a map', async t => {
  const f = await fixture(t), input = await f.input(), candidate = await f.generation().generate(input), reached = gate(), release = gate(); f.track(release.release)
  let blocked: Promise<void> | undefined
  f.saveHook(async () => { blocked = f.writes.run(f.project.path, async () => { reached.release(); await release.pending }); await reached.pending })
  const saving = f.generation().adopt({ workItemId: f.project.id, expectedRevision: input.expectedRevision, candidateId: candidate.candidateId }); const rejected = assert.rejects(saving, error)
  await reached.pending; await f.revoke(); release.release(); await blocked; await rejected
  assert.deepEqual(await readFile(f.assetPath), image); assert.equal((await f.map.read()).document.version, 1)
})

test('image atomic rename rechecks the original grant after the actual temporary image exists', async t => {
  const f = await fixture(t, false), input = await f.input(), candidate = await f.generation().generate(input); let reached = false
  f.loadHook(async () => { const names = await readdir(dirname(f.assetPath)).catch(() => []); if (!reached && names.some(n => n.endsWith('.tmp'))) { reached = true; await f.revoke() } })
  await assert.rejects(f.generation().adopt({ workItemId: f.project.id, expectedRevision: input.expectedRevision, candidateId: candidate.candidateId }), error)
  assert.equal(reached, true); await assert.rejects(readFile(f.assetPath), /ENOENT/); assert.deepEqual(await readdir(dirname(f.assetPath)), []); assert.equal((await f.map.read()).document.version, 1)
})

test('file map atomic rename keeps the original layout and a previously legal asset when its grant is withdrawn', async t => {
  const f = await fixture(t, false), input = await f.input(), candidate = await f.generation().generate(input), config = join(f.project.path, '.webnovel', 'config'); let reached = false
  f.loadHook(async () => { const names = await readdir(config); if (!reached && names.some(n => n.includes('world-map.json') && n.endsWith('.tmp'))) { reached = true; await f.revoke() } })
  await assert.rejects(f.generation().adopt({ workItemId: f.project.id, expectedRevision: input.expectedRevision, candidateId: candidate.candidateId }), error)
  assert.equal(reached, true); assert.equal((await f.map.read()).document.version, 1); assert.deepEqual(await readFile(f.assetPath), image); assert.equal((await readdir(config)).some(n => n.endsWith('.tmp')), false)
})

test('an older cancelled request cannot clear a newer owner using the same operation ID', async t => {
  const f = await fixture(t), input = await f.input(), first = gate(), second = gate(), reached = gate(); f.track(first.release); f.track(second.release); let count = 0
  f.respond(async () => { if (++count === 1) { reached.release(); await first.pending } else await second.pending; return { data: [{ b64_json: image.toString('base64') }] } })
  const older = f.generation().generate(input), rejected = assert.rejects(older, error); await reached.pending
  // Observe rejection immediately so a failed arrival assertion cannot leak an unhandled promise.
  const newer = f.generation().generate(input).then(value => ({ value }), error => ({ error }))
  const deadline = Date.now() + 60_000
  while (f.requests.length < 2 && Date.now() < deadline) await new Promise(r => setTimeout(r, 10))
  assert.equal(f.requests.length, 2, 'the newer request must reach the actual image adapter')
  first.release(); await rejected; second.release(); const result = await newer
  assert.ok('value' in result, 'the newer request must complete normally')
  const candidate = result.value
  await f.generation().adopt({ workItemId: f.project.id, expectedRevision: input.expectedRevision, candidateId: candidate.candidateId }); assert.equal(f.requests.length, 2); assert.deepEqual(await readFile(f.assetPath), image)
})

test('actual planning, research and chapter map sources reuse an owned read lease without writes or mirror changes', async t => {
  const f = await fixture(t), path = join(f.project.path, '.webnovel', 'workspace.sqlite'), before = await readFile(path)
  const chapters = await f.writes.run(f.project.path, () => f.authority.worldMapChaptersForGuard(f.project.path)); assert.deepEqual(chapters, [{ id: 1, position: 1, title: '旧资料' }]); assert.deepEqual(await readFile(path), before); assert.equal(f.requests.length, 0)
  const events = await f.writes.run(f.project.path, () => f.context.worldMapEvents())
  assert.equal(events.length, 1); assert.equal(events[0]!.location, '石桥'); assert.deepEqual(await readFile(path), before)
})

test('switching books during the initial real package capture rejects before reading a formal map source', async t => {
  const f = await fixture(t), input = await f.input(), originalPath = join(f.project.path, '.webnovel', 'workspace.sqlite'), before = await readFile(originalPath)
  const other = (await f.projects.create({ parentPath: f.root, name: '另一本隔离地图', genre: '悬疑' })).project
  await f.projects.switch(f.project.path); let switched = false
  f.loadHook(async () => { if (!switched) { switched = true; await f.projects.switch(other.path) } })
  await assert.rejects(f.generation().generate(input), error)
  assert.equal(switched, true); assert.equal(f.reads(), 0); assert.equal(f.requests.length, 0)
  assert.deepEqual(await readFile(originalPath), before)
})

test('a same-content database replacement during final package authorization cannot publish a late image candidate', async t => {
  const f = await fixture(t), input = await f.input(), original = join(f.project.path, '.webnovel', 'workspace.sqlite'), copy = join(f.root, 'late-copy.sqlite'), backup = join(f.root, 'original-identity.sqlite')
  const before = await readFile(original); let responded = false, readAfterResponse = false, replaced = false
  f.respond(async () => { responded = true; return { data: [{ b64_json: image.toString('base64') }] } })
  f.profileHook(async () => { if (responded) readAfterResponse = true })
  f.loadHook(async () => {
    if (readAfterResponse && !replaced) { replaced = true; await copyFile(original, copy); await rename(original, backup); await rename(copy, original) }
  })
  await assert.rejects(f.generation().generate(input), error)
  assert.equal(replaced, true); assert.equal(f.requests.length, 1)
  assert.deepEqual(await readFile(original), before); assert.deepEqual(await readFile(backup), before)
  assert.equal(await f.generation().background(), null)
  await assert.rejects(readFile(f.assetPath), { code: 'ENOENT' })
})
