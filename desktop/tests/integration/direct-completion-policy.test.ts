import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CompositionEntry } from '@lanjian/writing-plugin-contracts'
import { SqliteWorkspaceDatabaseFactory } from '../../src/main/platform/storage/workspace-database'
import { ProjectService } from '../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../src/main/platform/settings/settings-store'
import { DocumentService } from '../../src/main/modules/manuscript/application/document-service'
import { SqliteManuscriptService } from '../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../src/main/modules/library/application/legacy-workspace-source'
import { ShadowImportService } from '../../src/main/modules/library/application/shadow-import-service'
import { WorkspaceWriteCoordinator } from '../../src/main/core/application/workspace-write-coordinator'
import { createEventRuntime } from '../../src/main/modules/timeline/runtime/event-runtime'
import { AiClient } from '../../src/main/modules/models/application/ai-client'
import { LOCAL_CONNECTION_ID } from '../../src/contracts/models/local-model-contracts'
import type { TextCompletionInput } from '../../src/main/modules/models/domain/model-provider'
import { PluginPackageStore } from '../../src/main/modules/writing-plugins/adapters/package-store'
import { PluginDraftStore } from '../../src/main/modules/writing-plugins/adapters/draft-store'
import { buildPluginDraft } from '../../src/main/modules/writing-plugins/adapters/draft-builder'
import { bundledPackagePorts } from '../../src/main/modules/writing-plugins/adapters/bundled-packages'
import { PluginAuthoringService } from '../../src/main/modules/writing-plugins/application/authoring-service'
import { BundledPluginService } from '../../src/main/modules/writing-plugins/application/bundled-service'
import { PluginCompositionService } from '../../src/main/modules/writing-plugins/application/composition-service'
import { WritingPluginManager } from '../../src/main/modules/writing-plugins/application/plugin-manager'
import { createCreativePolicyProvider } from '../../src/main/modules/writing-plugins/runtime/creative-policy-provider'
import { createContributionContextProvider } from '../../src/main/modules/writing-plugins/runtime/contribution-context'
import { EVENT_MODEL_CANDIDATE_ARTIFACT } from '../../src/main/modules/timeline/domain/event-model-candidates'
import { registerAssistantIpc } from '../../src/main/modules/assistant/runtime/commands'
import { decodeAiCompleteArgs } from '../../src/contracts/assistant/ipc'

function guardedIpc(ready = false) {
  const handlers = new Map<string, (_event: unknown, ...args: unknown[]) => unknown>()
  let calls = 0
  const workspace = {
    foundationStatus: async () => ({ readyForProse: ready, readyForChapterOutline: ready, missing: ['请作者确认当前总纲、卷纲和章纲'] }),
    promptContext: async () => 'controlled main context'
  }
  registerAssistantIpc({ handle: (channel, handler) => { handlers.set(channel, handler) } }, {
    workspace, projects: { runInCurrentBook: async (operation: () => unknown) => operation() },
    ai: { complete: async () => { calls++; throw Error('captured request; no prose is returned') } }
  } as unknown as Parameters<typeof registerAssistantIpc>[1])
  return { calls: () => calls, complete: (...args: unknown[]) => handlers.get('ai:complete')!(undefined, ...args) as Promise<{ ok: boolean; error: { message: string } }> }
}

test('production direct IPC treats omitted task as prose and rejects an unconfirmed chapter before any model call', async () => {
  const f = guardedIpc()
  const result = await f.complete('仅验证确认门禁。', '', undefined, 1)
  assert.equal(f.calls(), 0); assert.equal(result.ok, false); assert.match(result.error.message, /作者|确认|大纲/)
})

test('production direct prose IPC requires an explicit chapter even if an old generic readiness projection says ready', async () => {
  for (const task of [undefined, 'prose']) {
    const f = guardedIpc(true), result = await f.complete('仅验证章节绑定。', '', task, undefined)
    assert.equal(f.calls(), 0); assert.equal(result.ok, false); assert.match(result.error.message, /章节/)
  }
})

test('production explicit prose IPC retains the current unconfirmed-outline refusal with zero requests', async () => {
  const f = guardedIpc(), result = await f.complete('未确认大纲，不能写正文。', '', 'prose', 1)
  assert.equal(f.calls(), 0); assert.equal(result.ok, false); assert.match(result.error.message, /作者|确认|大纲/)
})

test('direct completion keeps the old four arguments and only accepts the explicit outline timeline operation', () => {
  assert.deepEqual(decodeAiCompleteArgs(['资料', '', 'outline', undefined]), ['资料', '', 'outline', undefined])
  assert.deepEqual(decodeAiCompleteArgs(['资料', '', 'outline', undefined, 'timeline']), ['资料', '', 'outline', undefined, 'timeline'])
  for (const operation of ['prose', 'events', null, { slot: 'timeline-events' }]) assert.throws(() => decodeAiCompleteArgs(['资料', '', 'outline', undefined, operation]))
  assert.throws(() => decodeAiCompleteArgs(['资料', '', 'prose', 1, 'timeline']))
  assert.throws(() => decodeAiCompleteArgs(['资料', '', undefined, undefined, 'timeline']))
})

const proposal = JSON.stringify([{ title: '方法候选', time: '次日', characters: ['资料员'], location: '档案室', event: '核对作者提供的记录', result: '等待作者审阅' }])
class ObservedWrites extends WorkspaceWriteCoordinator {
  calls = 0
  writeCalls = 0
  private fromRead = false
  override read<T>(root: string, operation: () => Promise<T> | T): Promise<T> {
    const previous = this.fromRead; this.fromRead = true
    try { return super.read(root, operation) } finally { this.fromRead = previous }
  }
  override run<T>(root: string, operation: () => Promise<T> | T): Promise<T> { this.calls++; if (!this.fromRead) this.writeCalls++; return super.run(root, operation) }
}
async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-direct-policy-')))
  const releases: Array<() => void> = []; let closeDatabase = () => {}, cancel = () => {}
  t.after(async () => { releases.forEach(r => r()); cancel(); closeDatabase(); assert.equal(dirname(await realpath(root)), parent); await rm(root, { recursive: true, force: true }) })
  const projects = new ProjectService(new SettingsStore(join(root, 'profile'), { available: () => false, encrypt: () => assert.fail(), decrypt: () => assert.fail() }))
  const { project } = await projects.create({ parentPath: root, name: '时间线方法隔离验证', genre: '悬疑' })
  const documents = new DocumentService(projects), databases = new SqliteWorkspaceDatabaseFactory()
  const legacy = new CurrentProjectLegacyWorkspaceSource(projects, documents), importer = new ShadowImportService(legacy, databases)
  await importer.import(await importer.preview())
  const writes = new ObservedWrites(), authority = new SqliteManuscriptService(databases, undefined, writes)
  await authority.activate(project.path, await legacy.snapshot())
  const db = (await databases.openExisting(project.path))!; closeDatabase = () => db.close()
  let manager = new WritingPluginManager(new PluginPackageStore(root), async () => {})
  const drafts = new PluginDraftStore(root), authoring = new PluginAuthoringService(drafts, { build: buildPluginDraft, persist: b => drafts.persist(b), chooseExport: async () => null, choosePackage: async () => null, chooseSource: async () => null,
    installed: async (id, packageDigest) => { const loaded = await manager.loadAuthorized((await projects.currentSummary()).id, id, packageDigest); return { manifest: loaded.version.manifest, files: loaded.files } } }, manager)
  const bundled = new BundledPluginService(bundledPackagePorts(root), manager, authoring)
  const official = (await bundled.list()).find(p => p.manifest.id === 'lanjian.official.story-planning')!
  let draft = await bundled.derive({ pluginId: official.manifest.id, digest: official.digest })
  const manifest = JSON.parse(draft.manifestText)
  const used = ['timeline-events', 'total-outline', 'chapter-outline', 'genre-guidance']
  manifest.contributions = manifest.contributions.filter((c: { slot: string }) => used.includes(c.slot))
  for (const slot of ['prose', 'review']) { manifest.assets.push(`${slot}.md`); manifest.contributions.push({ id: slot, kind: 'creative-policy', name: slot, stages: [slot === 'prose' ? 'writing' : 'review'], slot, mode: 'replace', asset: `${slot}.md` }) }
  for (const c of manifest.contributions) c.configSchema = { type: 'object', properties: { focus: { type: 'string', maxLength: 100 }, ...(c.slot === 'genre-guidance' ? { genre: { type: 'string', maxLength: 100 }, subgenre: { type: 'string', maxLength: 100 } } : {}) }, required: ['focus'], additionalProperties: false }
  manifest.contributions.push({ id: 'original-fragment', kind: 'context-fragment', name: '原参考', stages: ['planning'], text: 'ORIGINAL_FRAGMENT', configSchema: { type: 'object', properties: {}, additionalProperties: false } })
  const files = [...draft.files, ...['prose', 'review'].map(slot => ({ path: `${slot}.md`, content: '' }))].map(f => manifest.contributions.some((c: { asset?: string }) => c.asset === f.path) ? { ...f, content: `ORIGINAL_${f.path} {{focus}}${f.path === 'genre-guidance.txt' ? ' {{genre}}' : ''}` } : f)
  draft = await authoring.save({ id: draft.id, revision: draft.revision, manifestText: JSON.stringify(manifest), files })
  async function install() {
    const built = await authoring.build({ id: draft.id, revision: draft.revision }), preview = await authoring.preview({ id: draft.id, revision: draft.revision })
    let index = await manager.install(preview.planId); index = await manager.setEnabled(draft.pluginId, true, [], index.revision)
    await manager.setBookEnabled(project.id, draft.pluginId, true, index.revision)
    return manifest.contributions.map((c: { id: string }) => ({ pluginId: draft.pluginId, digest: built.digest, contributionId: c.id, params: c.id === 'original-fragment' ? {} : { focus: 'ORIGINAL_PARAMS' } })) as CompositionEntry[]
  }
  async function select(entries: CompositionEntry[]) { const composition = new PluginCompositionService(manager), preview = await composition.preview(project.id, entries, (await manager.list()).revision, async () => {}); assert.deepEqual(preview.conflicts, []); await composition.apply(preview.planId) }
  const entries = await install(); await select(entries)
  let formal = 'AUTHOR_REQUIREMENT\n正式境界：作者自定义。\n固定系统：[属性]。', genre = '悬疑', model = 'original-model', contract = 'confirmed-original', ready = true
  const calls: TextCompletionInput[] = []; let respond: () => Promise<string> = async () => proposal, contextHook: (() => Promise<void>) | undefined
  const ai = new AiClient({ resolve: async () => ({ kind: 'local', connectionId: LOCAL_CONNECTION_ID, connectionName: 'fixture', profile: { connectionId: LOCAL_CONNECTION_ID, model, temperature: 0, topP: 1, maxTokens: 2000 } }), resolveConnection: async () => ({ kind: 'local', connectionId: LOCAL_CONNECTION_ID, connectionName: 'fixture' }) }, {
    listModels: async () => ['original-model', 'changed-model'], ready: async () => true, limits: () => ({ contextTokens: 150000, systemReserveTokens: 1000, maxOutputTokens: 5000, recommendedOutputTokens: 2000 }), toolStep: async () => assert.fail('no tools'),
    complete: async input => { calls.push(input); return { content: await respond() } }
  })
  const capture = async () => manager.captureComposition((await projects.currentSummary()).id)
  const policy = createCreativePolicyProvider(capture, async v => (await manager.loadAuthorized((await projects.currentSummary()).id, v.manifest.id, v.digest)).files)
  const fragments = createContributionContextProvider(capture)
  const context = async () => { const result = await writes.read(project.path, async () => `${formal}\n${genre}\n原参考：${JSON.stringify(await fragments('planning'))}`); await contextHook?.(); return result }
  const workspace = { bookProfile: async () => ({ genre, subgenre: '' }), promptContext: context,
    foundationStatus: async () => ({ readyForProse: ready, readyForChapterOutline: ready, missing: ['待作者确认'] }), chapterContractVersion: async () => ({ fingerprint: contract }) }
  const handlers = new Map<string, (_event: unknown, ...args: unknown[]) => unknown>()
  registerAssistantIpc({ handle: (channel, handler) => { handlers.set(channel, handler) } }, { workspace, projects, ai, creativePolicy: policy } as unknown as Parameters<typeof registerAssistantIpc>[1])
  const runtime = createEventRuntime(projects, databases, writes, ai, undefined, { capturePolicy: policy,
    context: async (_readOnly, p) => { p.resolve('genre-guidance', { genre, subgenre: '' }); return context() }, runInBook: fn => projects.runInCurrentBook(fn),
    assertBook: async (path, id) => { assert.equal(path, await projects.currentPath()); assert.equal(id, (await projects.currentSummary()).id) } })
  cancel = () => runtime.clear()
  const preview = await runtime.reviews.preview(), inspection = await runtime.reviews.inspection(preview.previewId)
  const collect = <T>(read: (offset: number) => { items: readonly T[]; nextOffset: number | null }) => { const result: T[] = []; let offset: number | null = 0; while (offset !== null) { const page = read(offset); result.push(...page.items); offset = page.nextOffset } return result }
  const rows = collect(inspection.rowsPage), groups = collect(inspection.groupsPage), findings = collect(inspection.planningFindingsPage)
  const grant = await runtime.reviews.review(preview.previewId, { fingerprint: preview.fingerprint, rows: rows.map(row => ({ rowIndex: row.index, disposition: row.ref.source === 'sources' ? 'retain-source' : 'keep-separate' })), acknowledgedGroups: groups.filter(g => g.severity === 'review').map(g => g.id), acknowledgedPlanningFindings: findings.flatMap((f, index) => f.severity === 'review' ? [index] : []), acknowledgedMirrors: [...preview.requiredMirrorAcknowledgements] })
  await runtime.migrations.commit(grant.token)
  const request = { operationId: randomUUID(), context: { title: project.name, genre: '悬疑', subgenre: '', coreIdea: '', plannedVolumes: 0, chaptersPerVolume: 0, targetWordsPerChapter: 0, materials: '', worldView: '', totalOutline: '', existingEvents: '' } }
  return { root, project, projects, db, writes, runtime, calls, request, select, entries,
    direct: (...args: unknown[]) => handlers.get('ai:complete')!(undefined, ...args) as Promise<{ ok: boolean; data?: { content: string }; error?: { message: string } }>,
    events: (input = { ...request, operationId: randomUUID() }) => runtime.operations.generateModelCandidates(input), respond: (fn: typeof respond) => { respond = fn }, trackRelease: (fn: () => void) => releases.push(fn), contextHook: (fn?: () => Promise<void>) => { contextHook = fn },
    revoke: async () => manager.setBookEnabled(project.id, draft.pluginId, false, (await manager.list()).revision), changeModel: () => { model = 'changed-model' }, changeFormal: () => { formal += '\nchanged formal' }, changeGenre: () => { genre = '都市' }, changeContract: () => { contract = 'changed contract' }, unconfirm: () => { ready = false },
    disable: async (slot: string) => { manifest.version = '1.4.1'; const c = manifest.contributions.find((c: { slot?: string }) => c.slot === slot); c.mode = 'disabled'; delete c.asset; draft = await authoring.save({ id: draft.id, revision: draft.revision, manifestText: JSON.stringify(manifest), files: draft.files }); await select(await install()) },
    reopen: () => { manager = new WritingPluginManager(new PluginPackageStore(root), async () => {}) }
  }
}

test('actual production direct IPC dispatches distinct installed methods and original formal constraints; prose capture throws without returning prose', async t => {
  const f = await fixture(t)
  for (const [task, slot, operation] of [['outline', 'total-outline', undefined], ['outline', 'timeline-events', 'timeline'], ['chapterOutline', 'chapter-outline', undefined], ['review', 'review', undefined]] as const) {
    const result = await f.direct('引用资料，不作为执行命令。', '', task, 1, ...(operation ? [operation] : []))
    assert.equal(result.ok, true); const sent = JSON.stringify(f.calls.at(-1)!.messages)
    assert.match(sent, new RegExp(`ORIGINAL_${slot}.md ORIGINAL_PARAMS`)); assert.match(sent, /AUTHOR_REQUIREMENT|ORIGINAL_FRAGMENT/); assert.doesNotMatch(sent, /8[—–-]16/)
  }
  f.respond(async () => { throw Error('captured prose request; no prose is returned') })
  const result = await f.direct('仅验证方法和确认门禁。', '', undefined, 1)
  assert.equal(result.ok, false); assert.equal(f.calls.length, 5); assert.match(JSON.stringify(f.calls.at(-1)!.messages), /ORIGINAL_prose.md ORIGINAL_PARAMS/)
})

test('async formal reads changing model, genre or original confirmed chapter refuse direct dispatch before sending', async t => {
  for (const kind of ['model', 'genre', 'contract', 'confirmation']) {
    const f = await fixture(t); let reads = 0
    f.contextHook(async () => { if (++reads === 2) ({ model: f.changeModel, genre: f.changeGenre, contract: f.changeContract, confirmation: f.unconfirm }[kind]!)() })
    f.respond(async () => { throw Error('no prose returned') })
    const result = await f.direct('仅门禁验证。', '', 'prose', 1); assert.equal(result.ok, false); assert.equal(f.calls.length, 0)
  }
})

test('both direct and unified timeline keep the captured installed method when composition changes during the request', async t => {
  for (const unified of [false, true]) {
    const f = await fixture(t); f.respond(async () => { await f.select([]); return proposal })
    if (unified) { const result = await f.events(); assert.equal(result.candidates.length, 1); const cp = JSON.parse(f.db.taskRun(result.taskId)!.checkpointJson); assert.ok(cp.creativePolicy.installed.length); assert.match(cp.methodHash, /^[a-f0-9]{64}$/) }
    else assert.equal((await f.direct('{}', '', 'outline', undefined, 'timeline')).ok, true)
    assert.match(JSON.stringify(f.calls[0].messages), /ORIGINAL_timeline-events.md ORIGINAL_PARAMS/); assert.match(JSON.stringify(f.calls[0].messages), /ORIGINAL_FRAGMENT/)
  }
})

test('waiting direct or unified timeline output cannot be returned or persisted after installed method withdrawal', async t => {
  for (const unified of [false, true]) {
    const f = await fixture(t); f.respond(async () => { await f.revoke(); return proposal })
    if (unified) { await assert.rejects(f.events()); const task = f.db.recentTaskRuns('timeline_candidate_generation')[0]; assert.equal(task.status, 'failed'); assert.equal(f.db.generationArtifactForTask(task.id, EVENT_MODEL_CANDIDATE_ARTIFACT), null) }
    else assert.equal((await f.direct('{}', '', 'outline', undefined, 'timeline')).ok, false)
    assert.equal(f.calls.length, 1)
  }
})

test('unified valid and invalid raw output queued behind a real write lease is withheld after withdrawal', async t => {
  for (const output of [proposal, 'malformed synthetic event output']) {
    const f = await fixture(t); let releaseResponse!: () => void, entered!: () => void, releaseLane!: () => void, laneEntered!: () => void
    const responseGate = new Promise<void>(r => { releaseResponse = r }), atResponse = new Promise<void>(r => { entered = r }), laneGate = new Promise<void>(r => { releaseLane = r }), inLane = new Promise<void>(r => { laneEntered = r })
    f.trackRelease(releaseResponse); f.trackRelease(releaseLane)
    let reads = 0
    f.contextHook(async () => { if (++reads === 5) { entered(); await responseGate } })
    f.respond(async () => output)
    const pending = f.events().then(() => assert.fail('withdrawn output must not publish'), error => error); await atResponse
    const blocker = f.writes.run(f.project.path, async () => { laneEntered(); await laneGate }); await inLane
    const queuedBefore = f.writes.writeCalls; releaseResponse()
    for (let i = 0; f.writes.writeCalls === queuedBefore && i < 200; i++) await new Promise(r => setTimeout(r, 10))
    assert.ok(f.writes.writeCalls > queuedBefore, 'artifact must actually join the occupied write lane, independently of context reads')
    await f.revoke(); releaseLane(); await blocker; await pending
    const task = f.db.recentTaskRuns('timeline_candidate_generation')[0]; assert.equal(task.status, 'failed'); assert.equal(f.db.generationArtifactForTask(task.id, EVENT_MODEL_CANDIDATE_ARTIFACT), null); assert.equal(f.calls.length, 1)
  }
})

test('disabled timeline and genre policies reject both entrypoints before any model request', async t => {
  for (const slot of ['timeline-events', 'genre-guidance']) {
    const f = await fixture(t); await f.disable(slot)
    assert.equal((await f.direct('{}', '', 'outline', undefined, 'timeline')).ok, false); await assert.rejects(f.events()); assert.equal(f.calls.length, 0); assert.deepEqual(f.db.recentTaskRuns('timeline_candidate_generation'), [])
  }
})

test('unified receipt survives package withdrawal and service store reopen without replaying or adopting a candidate', async t => {
  const f = await fixture(t), before = await f.runtime.projection.read(), result = await f.events(f.request)
  await f.revoke(); f.reopen(); assert.deepEqual(await f.events(f.request), result); assert.equal(f.calls.length, 1); assert.deepEqual(await f.runtime.projection.read(), before)
})

test('formal facts and model changes during unified completion withhold both valid and invalid artifact publication', async t => {
  for (const change of ['formal', 'model']) {
    const f = await fixture(t); f.respond(async () => { (change === 'formal' ? f.changeFormal : f.changeModel)(); return proposal })
    await assert.rejects(f.events()); const task = f.db.recentTaskRuns('timeline_candidate_generation')[0]
    assert.equal(task.status, 'failed'); assert.equal(f.db.generationArtifactForTask(task.id, EVENT_MODEL_CANDIDATE_ARTIFACT), null); assert.equal(f.calls.length, 1)
  }
})

test('switching books cancels the old unified attempt and preserves its failure history only in the original physical book', async t => {
  const f = await fixture(t), before = await f.runtime.projection.read()
  f.respond(async () => { await f.projects.create({ parentPath: f.root, name: '第二本隔离作品', genre: '都市' }); f.runtime.clear(); return proposal })
  await assert.rejects(f.events()); const task = f.db.recentTaskRuns('timeline_candidate_generation')[0]
  assert.equal(task.status, 'cancelled'); assert.equal(f.db.generationArtifactForTask(task.id, EVENT_MODEL_CANDIDATE_ARTIFACT), null)
  await f.projects.switch(f.project.path); assert.deepEqual(await f.runtime.projection.read(), before)
})
