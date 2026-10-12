import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdtemp, realpath, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CompositionEntry } from '@lanjian/writing-plugin-contracts'
import type { FactExtractionJob } from '../../src/contracts/index'
import { ProjectService } from '../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../src/main/platform/settings/settings-store'
import { DocumentService } from '../../src/main/modules/manuscript/application/document-service'
import { SqliteManuscriptService } from '../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../src/main/modules/library/application/legacy-workspace-source'
import { ShadowImportService } from '../../src/main/modules/library/application/shadow-import-service'
import { SqliteWorkspaceDatabaseFactory } from '../../src/main/platform/storage/workspace-database'
import { WorkspaceWriteCoordinator } from '../../src/main/core/application/workspace-write-coordinator'
import { FactExtractionService, decodeFactExtractionRecovery } from '../../src/main/modules/review/application/fact-extraction-service'
import { createFactExtractionRuntime } from '../../src/main/modules/review/runtime/fact-extraction-runtime'
import { createTaskContractSnapshot } from '../../src/main/modules/assistant/domain/task-template-contract'
import { registerReviewIpc } from '../../src/main/modules/review/runtime/commands'
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

class ObservedWrites extends WorkspaceWriteCoordinator {
  writeCalls = 0; private fromRead = false
  override read<T>(root: string, fn: () => T | Promise<T>): Promise<T> { const previous = this.fromRead; this.fromRead = true; try { return super.read(root, fn) } finally { this.fromRead = previous } }
  override run<T>(root: string, fn: () => T | Promise<T>): Promise<T> { if (!this.fromRead) this.writeCalls++; return super.run(root, fn) }
}
const body = '沈砚来到石桥。'
const proposal = JSON.stringify([{ character: '沈砚', field: 'location', value: '石桥', event: '抵达', evidence: body }, { character: '沈砚', field: 'power', value: '突破', event: '无依据', evidence: '沈砚突然突破。' }])
function gate() { let release!: () => void; const pending = new Promise<void>(r => { release = r }); return { pending, release } }
async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-fact-policy-'))), releases: Array<() => void> = []
  let cancel = async () => {}
  t.after(async () => { releases.forEach(r => r()); await cancel(); assert.equal(dirname(await realpath(root)), parent); await rm(root, { recursive: true, force: true }) })
  const projects = new ProjectService(new SettingsStore(join(root, 'profile'), { available: () => false, encrypt: () => assert.fail(), decrypt: () => assert.fail() }))
  const { project } = await projects.create({ parentPath: root, name: '事实方法隔离验证', genre: '悬疑' }), files = new DocumentService(projects)
  // Existing static import fixture only: no generated prose or outline confirmation.
  const old = await files.createChapter(); await files.updateChapter(old.id, { title: '旧资料', content: body, expectedRevision: old.revision })
  const databases = new SqliteWorkspaceDatabaseFactory(), legacy = new CurrentProjectLegacyWorkspaceSource(projects, files), importer = new ShadowImportService(legacy, databases)
  await importer.import(await importer.preview())
  const writes = new ObservedWrites(), authority = new SqliteManuscriptService(databases, undefined, writes)
  await authority.activate(project.path, await legacy.snapshot())
  await authority.updateChapterPlanning(project.path, { legacyChapterId: old.id, lifecycleStatus: 'REVIEWABLE' })
  await authority.updateChapterPlanning(project.path, { legacyChapterId: old.id, lifecycleStatus: 'CONFIRMED' })
  const original = await authority.factExtractionSource(project.path, old.id)
  let manager = new WritingPluginManager(new PluginPackageStore(root), async () => {})
  const drafts = new PluginDraftStore(root), authoring = new PluginAuthoringService(drafts, { build: buildPluginDraft, persist: b => drafts.persist(b), chooseExport: async () => null, choosePackage: async () => null, chooseSource: async () => null,
    installed: async (id, digest) => { const p = await manager.loadAuthorized((await projects.currentSummary()).id, id, digest); return { manifest: p.version.manifest, files: p.files } } }, manager)
  const bundled = new BundledPluginService(bundledPackagePorts(root), manager, authoring), pkg = (await bundled.list()).find(p => p.manifest.id === 'lanjian.official.creative-writing')!
  let draft = await bundled.derive({ pluginId: pkg.manifest.id, digest: pkg.digest }), manifest = JSON.parse(draft.manifestText)
  manifest.contributions = manifest.contributions.filter((c: { slot: string }) => c.slot === 'fact-extraction')
  const schema = { type: 'object', properties: { focus: { type: 'string', maxLength: 100 }, genre: { type: 'string', maxLength: 100 }, subgenre: { type: 'string', maxLength: 100 } }, required: ['focus'], additionalProperties: false }
  manifest.contributions[0].configSchema = schema; manifest.assets.push('fact-genre.md')
  manifest.contributions.push({ id: 'fact-genre', name: '事实题材', kind: 'creative-policy', slot: 'genre-guidance', mode: 'replace', asset: 'fact-genre.md', stages: ['planning'], configSchema: schema },
    { id: 'original-fragment', name: '原参考', kind: 'context-fragment', stages: ['review'], text: 'ORIGINAL_FRAGMENT', configSchema: { type: 'object', properties: {}, additionalProperties: false } })
  draft = await authoring.save({ id: draft.id, revision: draft.revision, manifestText: JSON.stringify(manifest), files: [...draft.files.map(f => f.path === 'fact-extraction.md' ? { ...f, content: 'ORIGINAL_FACT_METHOD {{focus}}' } : f), { path: 'fact-genre.md', content: 'ORIGINAL_GENRE {{focus}} {{genre}}' }] })
  async function install() {
    const built = await authoring.build({ id: draft.id, revision: draft.revision }), preview = await authoring.preview({ id: draft.id, revision: draft.revision })
    let index = await manager.install(preview.planId); index = await manager.setEnabled(draft.pluginId, true, [], index.revision); await manager.setBookEnabled(project.id, draft.pluginId, true, index.revision)
    return manifest.contributions.map((c: { id: string }) => ({ pluginId: draft.pluginId, digest: built.digest, contributionId: c.id, params: c.id === 'original-fragment' ? {} : { focus: 'ORIGINAL_PARAMS' } })) as CompositionEntry[]
  }
  async function select(entries: CompositionEntry[]) { const c = new PluginCompositionService(manager), plan = await c.preview(project.id, entries, (await manager.list()).revision, async () => {}); assert.deepEqual(plan.conflicts, []); await c.apply(plan.planId) }
  await select(await install())
  const capture = async () => manager.captureComposition((await projects.currentSummary()).id), policy = createCreativePolicyProvider(capture, async v => (await manager.loadAuthorized((await projects.currentSummary()).id, v.manifest.id, v.digest)).files,
    async ref => manager.loadAuthorized((await projects.currentSummary()).id, ref.pluginId, ref.digest)), fragments = createContributionContextProvider(capture)
  const calls: TextCompletionInput[] = []; let model = 'original-model', formal = 'AUTHOR_REQUIREMENT\n动态境界：原定义\n固定系统：[属性]', repairAttempts = 1, respond: () => Promise<string> = async () => proposal, contextHook: (() => Promise<void>) | undefined
  const ai = new AiClient({ resolve: async () => ({ kind: 'local', connectionId: LOCAL_CONNECTION_ID, connectionName: 'fixture', profile: { connectionId: LOCAL_CONNECTION_ID, model, temperature: 0, topP: 1, maxTokens: 2000 } }), resolveConnection: async () => ({ kind: 'local', connectionId: LOCAL_CONNECTION_ID, connectionName: 'fixture' }) }, {
    listModels: async () => ['original-model', 'changed-model'], ready: async () => true, limits: () => ({ contextTokens: 150000, systemReserveTokens: 1000, maxOutputTokens: 5000, recommendedOutputTokens: 2000 }), toolStep: async () => assert.fail('no prose/tools'), complete: async input => { calls.push(input); return { content: await respond() } }
  })
  let extraction: FactExtractionService
  const make = () => {
    extraction = new FactExtractionService(ai, async () => repairAttempts, { capturePolicy: policy, profile: async () => ({ genre: '悬疑', subgenre: '' }),
      context: async (_readOnly, p) => { p.resolve('genre-guidance', { genre: '悬疑', subgenre: '' }); const result = await writes.read(project.path, async () => `${formal}\n${JSON.stringify(await fragments('review'))}`); await contextHook?.(); return result } })
    return createFactExtractionRuntime({ sqliteManuscripts: authority, databases, factExtraction: extraction, projects, withWorkspaceDatabaseWrite: (root, fn, beforeWrite) => writes.run(root, async () => {
      await beforeWrite?.(); const db = await databases.openExisting(root); assert.ok(db); try { await beforeWrite?.(); return await fn(db) } finally { db.close() }
    }) }).factExtractionJobs
  }
  let jobs = make(); cancel = () => jobs.cancelAll()
  const ipc = async (channel: string, ...args: unknown[]) => {
    const handlers = new Map<string, (_event: unknown, ...args: unknown[]) => unknown>()
    registerReviewIpc({ handle: (c, h) => { handlers.set(c, h) } }, { projects, factExtractionJobs: jobs } as Parameters<typeof registerReviewIpc>[1])
    return handlers.get(channel)!(undefined, ...args) as Promise<{ ok: boolean; value: FactExtractionJob; error?: { message: string } }>
  }
  const read = async <T>(fn: (db: NonNullable<Awaited<ReturnType<typeof databases.openExisting>>>) => T) => { const db = await databases.openExisting(project.path); assert.ok(db); try { return fn(db) } finally { db.close() } }
  const start = () => projects.runInCurrentBook(() => jobs.start(project.path, old.id))
  const settled = async (id: string) => { const deadline = Date.now() + 30_000; let state = await jobs.status(id); while (state.status === 'running' && Date.now() < deadline) { await new Promise(r => setTimeout(r, 25)); state = await jobs.status(id) } assert.notEqual(state.status, 'running', 'task must reach a terminal state within the bounded deadline'); return state }
  return { root, project, projects, original, authority, databases, writes, calls, jobs: () => jobs, extraction: () => extraction, start, settled, ipc, read, select,
    respond: (fn: typeof respond) => { respond = fn }, contextHook: (fn?: () => Promise<void>) => { contextHook = fn }, track: (fn: () => void) => releases.push(fn),
    revoke: async () => manager.setBookEnabled(project.id, draft.pluginId, false, (await manager.list()).revision), changeModel: () => { model = 'changed-model' }, changeFormal: () => { formal += '\nchanged' }, repairs: (n: number) => { repairAttempts = n },
    clearConfirmation: async () => {
      await authority.updateChapterPlanning(project.path, { legacyChapterId: old.id, lifecycleStatus: 'REVISING' })
      await authority.updateChapter(project.path, old.id, { title: '作者调整的资料标题', expectedRevision: original.revision })
      await authority.updateChapterPlanning(project.path, { legacyChapterId: old.id, lifecycleStatus: 'REVIEWABLE' })
      await authority.updateChapterPlanning(project.path, { legacyChapterId: old.id, lifecycleStatus: 'CONFIRMED' })
    },
    history: async (extra: Record<string, unknown> = {}, contentHash = createHash('sha256').update(body).digest('hex')) => read(db => {
      const id = randomUUID(); db.createTaskRun({ id, legacyChapterId: old.id, taskType: 'fact_extraction', taskContract: createTaskContractSnapshot('fact_extraction'), idempotencyKey: id,
        baseBodyVersionId: original.bodyVersionId!, contentHash, checkpointJson: JSON.stringify({ version: 1, workItemId: project.path, chapterId: old.id, bodyVersionId: original.bodyVersionId!, phase: 'queued', ...extra }) })
      db.transitionTaskRun({ id, status: 'preparing' }); db.transitionTaskRun({ id, status: 'running' }); return db.transitionTaskRun({ id, status: 'failed' })
    }),
    reopen: async () => { await jobs.cancelAll(); manager = new WritingPluginManager(new PluginPackageStore(root), async () => {}); jobs = make(); await jobs.recent(project.path) },
    disable: async (slot: string) => { manifest.version = '2.0.0'; const c = manifest.contributions.find((c: { slot: string }) => c.slot === slot); c.mode = 'disabled'; delete c.asset; draft = await authoring.save({ id: draft.id, revision: draft.revision, manifestText: JSON.stringify(manifest), files: draft.files }); await select(await install()) },
    update: async () => { manifest.version = '2.0.0'; draft = await authoring.save({ id: draft.id, revision: draft.revision, manifestText: JSON.stringify(manifest), files: draft.files.map(f => f.path === 'fact-extraction.md' ? { ...f, content: 'UPDATED_FACT_METHOD {{focus}}' } : f) }); await select(await install()) }
  }
}

test('installed methods drive production fact IPC and actual SQLite candidates with exact static evidence and unchanged confirmed body', async t => {
  const f = await fixture(t), response = await f.ipc('workspace:start-fact-extraction', f.original.id); assert.equal(response.ok, true)
  const finished = await f.settled(response.value.id); assert.equal(finished.status, 'completed'); assert.equal(finished.batch?.changes.length, 1)
  const sent = JSON.stringify(f.calls[0].messages); assert.match(sent, /ORIGINAL_FACT_METHOD ORIGINAL_PARAMS/); assert.match(sent, /ORIGINAL_GENRE ORIGINAL_PARAMS 悬疑/); assert.match(sent, /ORIGINAL_FRAGMENT|AUTHOR_REQUIREMENT|固定系统/)
  assert.deepEqual(await f.authority.factExtractionSource(f.project.path, f.original.id), f.original)
  const task = await f.read(db => db.taskRun(response.value.id)!); assert.equal(JSON.parse(task.checkpointJson).recovery.format, 1)
  assert.equal(await f.read(db => db.approvedFactsBefore(f.original.id).length), 0)
})

test('production fact cancel captures the original current-book identity and persists cancellation before late output', async t => {
  const f = await fixture(t), pending = gate(), entered = gate(), returned = gate()
  f.track(pending.release)
  f.respond(async () => { entered.release(); await pending.pending; returned.release(); return proposal })
  const started = await f.ipc('workspace:start-fact-extraction', f.original.id)
  assert.equal(started.ok, true); await entered.pending
  // No test-created execution context around cancellation: exercise the actual IPC owner.
  const stopped = await f.ipc('workspace:cancel-fact-extraction', started.value.id)
  assert.equal(stopped.ok, true, stopped.error?.message || 'Production cancellation must succeed in the original book')
  assert.equal(stopped.value.status, 'cancelled')
  assert.equal(await f.read(db => db.taskRun(started.value.id)!.status), 'cancelled')
  pending.release(); await returned.pending
  assert.equal((await f.jobs().status(started.value.id)).status, 'cancelled')
  assert.equal(await f.read(db => db.listFactBatches().length), 0)
  assert.deepEqual(await f.authority.factExtractionSource(f.project.path, f.original.id), f.original)
})

test('production fact cancel still refuses a same-content physically replaced database and changes neither copy', async t => {
  const f = await fixture(t), pending = gate(), entered = gate()
  f.track(pending.release); f.respond(async () => { entered.release(); await pending.pending; return proposal })
  const started = await f.ipc('workspace:start-fact-extraction', f.original.id); assert.equal(started.ok, true); await entered.pending
  const original = await f.read(db => db.taskRun(started.value.id))
  const file = join(f.project.path, '.webnovel', 'workspace.sqlite'), saved = `${file}.cancel-original`, copy = `${file}.cancel-copy`
  await copyFile(file, copy); await rename(file, saved); await rename(copy, file)
  try {
    const rejected = await f.ipc('workspace:cancel-fact-extraction', started.value.id)
    assert.equal(rejected.ok, false)
    assert.deepEqual(await f.read(db => db.taskRun(started.value.id)), original)
    assert.equal(await f.read(db => db.listFactBatches().length), 0)
  } finally { await rename(file, copy); await rename(saved, file) }
  pending.release()
  assert.deepEqual(await f.read(db => db.taskRun(started.value.id)), original)
  assert.equal((await f.jobs().status(started.value.id)).status, 'interrupted')
})

test('explicit child retry reopens the actual original package after update and composition clearing without automatic requests or duplicate replay', async t => {
  const f = await fixture(t); f.respond(async () => { throw Error('synthetic original failure') }); const parent = await f.start(); assert.equal((await f.settled(parent.id)).status, 'failed')
  const before = await f.read(db => db.taskRun(parent.id)!); await f.update(); await f.select([]); await f.reopen(); assert.equal(f.calls.length, 1)
  f.respond(async () => proposal); const operation = randomUUID(), child = await f.projects.runInCurrentBook(() => f.jobs().retry(parent.id, operation)); assert.equal((await f.settled(child.id)).status, 'completed')
  assert.match(JSON.stringify(f.calls[1].messages), /ORIGINAL_FACT_METHOD|ORIGINAL_FRAGMENT/); assert.doesNotMatch(JSON.stringify(f.calls[1].messages), /UPDATED_FACT_METHOD/)
  await f.revoke(); assert.equal((await f.jobs().retry(parent.id, operation)).id, child.id); assert.equal(f.calls.length, 2); assert.deepEqual(await f.read(db => db.taskRun(parent.id)), before)
})

test('selected fact method or genre disabled rejects before a task or provider request', async t => {
  for (const slot of ['fact-extraction', 'genre-guidance']) { const f = await fixture(t); await f.disable(slot); await assert.rejects(f.start()); assert.equal(f.calls.length, 0); assert.equal(await f.read(db => db.recentTaskRuns('fact_extraction').length), 0) }
})

test('late withdrawal, model change and formal change preserve no new batch or raw artifact', async t => {
  for (const action of ['revoke', 'model', 'formal']) { const f = await fixture(t); f.respond(async () => { await ({ revoke: f.revoke, model: f.changeModel, formal: f.changeFormal }[action]!)(); return proposal }); const task = await f.start(); assert.equal((await f.settled(task.id)).status, 'failed'); assert.equal(f.calls.length, 1); assert.equal(await f.read(db => db.listFactBatches().length), 0); assert.equal(await f.read(db => db.generationArtifactForTask(task.id)), null) }
})

test('closed recovery rejects added method text and a copied opaque capture cannot prepare or authorize a run', async t => {
  const f = await fixture(t), task = await f.start(); await f.settled(task.id)
  const recovery = JSON.parse((await f.read(db => db.taskRun(task.id)!)).checkpointJson).recovery
  assert.throws(() => decodeFactExtractionRecovery({ ...recovery, text: 'UNTRUSTED' })); assert.throws(() => decodeFactExtractionRecovery({ ...recovery, modelIdentity: 'bad' }))
  const captured = await f.extraction().capture(); await assert.rejects(f.extraction().prepare(f.original, recovery.bookIdentity, async () => {}, JSON.parse(JSON.stringify(captured))))
  assert.equal(f.calls.length, 1)
})

test('valid and invalid candidate publication queued in the actual SQLite write lane rejects late withdrawal', async t => {
  for (const invalid of [false, true]) {
    const f = await fixture(t); f.repairs(0); f.respond(async () => invalid ? 'INVALID_JSON' : proposal)
    const post = gate(), reached = gate(), lane = gate(), entered = gate(); for (const g of [post, reached, lane, entered]) f.track(g.release)
    let contexts = 0; f.contextHook(async () => { if (++contexts === (invalid ? 6 : 7)) { reached.release(); await post.pending } })
    const task = await f.start(); await reached.pending
    const blocker = f.writes.run(f.project.path, async () => { entered.release(); await lane.pending }); await entered.pending
    const before = f.writes.writeCalls; post.release()
    for (let i = 0; f.writes.writeCalls === before && i < 400; i++) await new Promise(r => setTimeout(r, 10))
    assert.ok(f.writes.writeCalls > before, 'actual publication queued, not a read guard'); await f.revoke(); lane.release(); await blocker
    assert.equal((await f.settled(task.id)).status, 'failed'); assert.equal(f.calls.length, 1); assert.equal(await f.read(db => db.listFactBatches().length), 0); assert.equal(await f.read(db => db.generationArtifactForTask(task.id)), null)
  }
})

test('source confirmation and model are rechecked after asynchronous formal reads before any provider request', async t => {
  for (const action of ['model', 'source']) {
    const f = await fixture(t); let contexts = 0
    f.contextHook(async () => { if (++contexts === 5) await (action === 'model' ? f.changeModel() : f.clearConfirmation()) })
    const task = await f.start(); assert.equal((await f.settled(task.id)).status, 'failed'); assert.equal(f.calls.length, 0)
    assert.equal(await f.read(db => db.listFactBatches().length), 0); assert.equal(await f.read(db => db.generationArtifactForTask(task.id)), null)
  }
})

test('explicit original retry refuses changed authorization, model, formal basis, confirmation or repair budget without a new task or request', async t => {
  for (const action of ['revoke', 'model', 'formal', 'source', 'budget']) {
    const f = await fixture(t); f.respond(async () => { throw Error('original fixture outage') }); const parent = await f.start(); await f.settled(parent.id)
    const before = await f.read(db => db.taskRun(parent.id)), count = await f.read(db => db.recentTaskRuns('fact_extraction').length)
    await f.reopen(); await ({ revoke: f.revoke, model: f.changeModel, formal: f.changeFormal, source: f.clearConfirmation, budget: () => f.repairs(0) }[action]!)()
    await assert.rejects(f.projects.runInCurrentBook(() => f.jobs().retry(parent.id, randomUUID())), { code: /CONFLICT|FEATURE_UNAVAILABLE/ }, action)
    assert.equal(f.calls.length, 1); assert.equal(await f.read(db => db.recentTaskRuns('fact_extraction').length), count); assert.deepEqual(await f.read(db => db.taskRun(parent.id)), before)
  }
})

test('historical five-field checkpoints remain readable after restart but cannot replay without the original policy snapshot', async t => {
  const f = await fixture(t), legacy = await f.history(); await f.reopen()
  assert.equal((await f.jobs().status(legacy.id)).status, 'failed'); await assert.rejects(f.projects.runInCurrentBook(() => f.jobs().retry(legacy.id, randomUUID())))
  assert.equal(f.calls.length, 0); assert.deepEqual(await f.read(db => db.taskRun(legacy.id)), legacy)
  assert.equal((await f.settled((await f.start()).id)).status, 'completed')
})

test('closed checkpoints and original task body digest reject corrupt replay before sending', async t => {
  const f = await fixture(t); f.respond(async () => { throw Error('original fixture outage') }); const parent = await f.start(); await f.settled(parent.id)
  const recovery = JSON.parse((await f.read(db => db.taskRun(parent.id)!)).checkpointJson).recovery
  for (const extra of [{ recovery, text: 'UNTRUSTED' }, { recovery, chapterId: f.original.id + 1 }, { recovery, phase: 'streaming' }]) {
    const bad = await f.history(extra); await assert.rejects(f.projects.runInCurrentBook(() => f.jobs().retry(bad.id, randomUUID())))
  }
  await assert.rejects(f.history({ recovery }, 'f'.repeat(64)), /版本与指纹不匹配/)
  assert.equal(f.calls.length, 1)
})

test('format repair retains the original installed method, parameters and reference fragment after current composition changes', async t => {
  const f = await fixture(t); let replies = 0; f.respond(async () => { if (++replies === 1) { await f.update(); await f.select([]); return 'INVALID_JSON' } return proposal })
  const task = await f.start(); assert.equal((await f.settled(task.id)).status, 'completed'); assert.equal(f.calls.length, 2)
  for (const call of f.calls) { assert.match(JSON.stringify(call.messages), /ORIGINAL_FACT_METHOD ORIGINAL_PARAMS/); assert.match(JSON.stringify(call.messages), /ORIGINAL_FRAGMENT/); assert.doesNotMatch(JSON.stringify(call.messages), /UPDATED_FACT_METHOD/) }
})

test('legal invalid JSON is preserved privately for review and restart never sends or deletes prior candidates', async t => {
  const f = await fixture(t), legal = await f.start(); await f.settled(legal.id); const batches = await f.read(db => db.listFactBatches())
  f.repairs(0); f.respond(async () => 'INVALID_ORIGINAL_JSON'); const invalid = await f.start(); const finished = await f.settled(invalid.id)
  assert.equal(finished.status, 'failed'); assert.equal(finished.rawResult, 'INVALID_ORIGINAL_JSON')
  const artifact = await f.read(db => db.generationArtifactForTask(invalid.id)); await f.revoke(); await f.reopen()
  assert.equal(f.calls.length, 2); assert.equal((await f.jobs().status(invalid.id)).rawResult, 'INVALID_ORIGINAL_JSON')
  assert.deepEqual(await f.read(db => db.listFactBatches()), batches); assert.deepEqual(await f.read(db => db.generationArtifactForTask(invalid.id)), artifact)
})

test('same-content SQLite physical replacement rejects late results without unhandled failure or rewriting either database', async t => {
  const f = await fixture(t), waiting = gate(), response = gate(); f.track(response.release)
  f.respond(async () => { waiting.release(); await response.pending; return proposal })
  const task = await f.start(); await waiting.pending
  const originalTask = await f.read(db => db.taskRun(task.id)), file = join(f.project.path, '.webnovel', 'workspace.sqlite'), saved = `${file}.original`, copy = `${file}.replacement`
  await copyFile(file, copy); await rename(file, saved); await rename(copy, file)
  try {
    response.release(); const done = await f.settled(task.id); assert.equal(done.status, 'interrupted'); assert.equal(done.error?.code, 'STATUS_PERSISTENCE_FAILED')
    assert.deepEqual(await f.read(db => db.taskRun(task.id)), originalTask); assert.equal(await f.read(db => db.listFactBatches().length), 0); assert.equal(f.calls.length, 1)
  } finally { await rename(file, copy); await rename(saved, file) }
  assert.deepEqual(await f.read(db => db.taskRun(task.id)), originalTask); assert.equal(await f.read(db => db.listFactBatches().length), 0)
})
