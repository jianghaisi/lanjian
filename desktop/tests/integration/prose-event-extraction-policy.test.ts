import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdtemp, readFile, realpath, rename, rm } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CompositionEntry } from '@lanjian/writing-plugin-contracts'
import { contextBudgetStartingSuggestions, type ContextBudgetPreferences } from '../../src/contracts/index'
import type { SettlementStartInput, SettlementTask } from '../../src/contracts/timeline/prose-event-settlement-contracts'
import { ProjectService } from '../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../src/main/platform/settings/settings-store'
import { DocumentService } from '../../src/main/modules/manuscript/application/document-service'
import { SqliteManuscriptService } from '../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../src/main/modules/library/application/legacy-workspace-source'
import { ShadowImportService } from '../../src/main/modules/library/application/shadow-import-service'
import { SqliteWorkspaceDatabaseFactory } from '../../src/main/platform/storage/workspace-database'
import { WorkspaceWriteCoordinator } from '../../src/main/core/application/workspace-write-coordinator'
import { decodeProseEventCheckpoint } from '../../src/main/modules/timeline/application/prose-event-extraction-service'
import { createEventRuntime } from '../../src/main/modules/timeline/runtime/event-runtime'
import { normalizeContextBudgetPreferences } from '../../src/main/modules/library/application/workspace-service'
import { createTaskContractSnapshot } from '../../src/main/modules/assistant/domain/task-template-contract'
import { registerTimelineIpc } from '../../src/main/modules/timeline/runtime/commands'
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
const candidate = { fields: { time: '', characters: ['沈砚'], location: '石桥', event: '来到石桥', result: '' }, quotes: [{ start: 0, end: body.length, quote: body }], supplements: [] }
const proposal = JSON.stringify([candidate])
function gate() { let release!: () => void; const pending = new Promise<void>(r => { release = r }); return { pending, release } }
async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-event-policy-'))), releases: Array<() => void> = []
  let shutdown = () => {}
  t.after(async () => { releases.forEach(r => r()); shutdown(); assert.equal(dirname(await realpath(root)), parent); await rm(root, { recursive: true, force: true }) })
  const projects = new ProjectService(new SettingsStore(join(root, 'profile'), { available: () => false, encrypt: () => assert.fail(), decrypt: () => assert.fail() }))
  const { project } = await projects.create({ parentPath: root, name: '事件方法隔离验证', genre: '悬疑' }), files = new DocumentService(projects)
  // Import the same pre-existing static material; no generated prose or outline confirmation.
  const old = await files.createChapter(); await files.updateChapter(old.id, { title: '旧资料', content: body, expectedRevision: old.revision })
  const databases = new SqliteWorkspaceDatabaseFactory(), legacy = new CurrentProjectLegacyWorkspaceSource(projects, files), importer = new ShadowImportService(legacy, databases)
  await importer.import(await importer.preview())
  const writes = new ObservedWrites(), authority = new SqliteManuscriptService(databases, undefined, writes)
  await authority.activate(project.path, await legacy.snapshot())
  const preparation = createEventRuntime(projects, databases, writes), preview = await preparation.reviews.preview()
  const grant = await preparation.reviews.review(preview.previewId, { fingerprint: preview.fingerprint, rows: [], acknowledgedGroups: [], acknowledgedPlanningFindings: [], acknowledgedMirrors: [] })
  await preparation.migrations.commit(grant.token)
  const manager = new WritingPluginManager(new PluginPackageStore(root), async () => {}), drafts = new PluginDraftStore(root)
  const authoring = new PluginAuthoringService(drafts, { build: buildPluginDraft, persist: b => drafts.persist(b), chooseExport: async () => null, choosePackage: async () => null, chooseSource: async () => null,
    installed: async (id, digest) => { const p = await manager.loadAuthorized((await projects.currentSummary()).id, id, digest); return { manifest: p.version.manifest, files: p.files } } }, manager)
  const bundled = new BundledPluginService(bundledPackagePorts(root), manager, authoring), pkg = (await bundled.list()).find(p => p.manifest.id === 'lanjian.official.creative-writing')!
  let draft = await bundled.derive({ pluginId: pkg.manifest.id, digest: pkg.digest }), manifest = JSON.parse(draft.manifestText)
  manifest.contributions = manifest.contributions.filter((c: { slot: string }) => c.slot === 'prose-event-extraction')
  const schema = { type: 'object', properties: { focus: { type: 'string', maxLength: 100 }, genre: { type: 'string', maxLength: 100 }, subgenre: { type: 'string', maxLength: 100 } }, required: ['focus'], additionalProperties: false }
  manifest.contributions[0].configSchema = schema; manifest.assets.push('event-genre.md')
  manifest.contributions.push({ id: 'event-genre', name: '事件题材', kind: 'creative-policy', slot: 'genre-guidance', mode: 'replace', asset: 'event-genre.md', stages: ['planning'], configSchema: schema },
    { id: 'original-fragment', name: '原参考', kind: 'context-fragment', stages: ['review'], text: 'ORIGINAL_FRAGMENT', configSchema: { type: 'object', properties: {}, additionalProperties: false } })
  draft = await authoring.save({ id: draft.id, revision: draft.revision, manifestText: JSON.stringify(manifest), files: [...draft.files.map(f => f.path === 'prose-event-extraction.md' ? { ...f, content: 'ORIGINAL_EVENT_METHOD {{focus}}' } : f), { path: 'event-genre.md', content: 'ORIGINAL_GENRE {{focus}} {{genre}}' }] })
  const built = await authoring.build({ id: draft.id, revision: draft.revision }), plan = await authoring.preview({ id: draft.id, revision: draft.revision })
  let index = await manager.install(plan.planId); index = await manager.setEnabled(draft.pluginId, true, [], index.revision); await manager.setBookEnabled(project.id, draft.pluginId, true, index.revision)
  const entries = manifest.contributions.map((c: { id: string }) => ({ pluginId: draft.pluginId, digest: built.digest, contributionId: c.id, params: c.id === 'original-fragment' ? {} : { focus: 'ORIGINAL_PARAMS' } })) as CompositionEntry[]
  async function select(next: CompositionEntry[]) { const composition = new PluginCompositionService(manager), p = await composition.preview(project.id, next, (await manager.list()).revision, async () => {}); assert.deepEqual(p.conflicts, []); await composition.apply(p.planId) }
  await select(entries)
  const capture = async () => manager.captureComposition((await projects.currentSummary()).id), policy = createCreativePolicyProvider(capture, async v => (await manager.loadAuthorized((await projects.currentSummary()).id, v.manifest.id, v.digest)).files,
    async ref => manager.loadAuthorized((await projects.currentSummary()).id, ref.pluginId, ref.digest)), fragments = createContributionContextProvider(capture)
  const calls: TextCompletionInput[] = []; let model = 'original-model', formal = 'AUTHOR_REQUIREMENT\n动态境界：原定义\n固定系统：[属性]', respond = async () => proposal
  let contextHook: (() => Promise<void>) | undefined, budgetHook: (() => Promise<void>) | undefined
  const ai = new AiClient({ resolve: async () => ({ kind: 'local', connectionId: LOCAL_CONNECTION_ID, connectionName: 'fixture', profile: { connectionId: LOCAL_CONNECTION_ID, model, temperature: 0, topP: 1, maxTokens: 2000 } }), resolveConnection: async () => ({ kind: 'local', connectionId: LOCAL_CONNECTION_ID, connectionName: 'fixture' }) }, {
    listModels: async () => ['original-model', 'changed-model'], ready: async () => true, limits: () => ({ contextTokens: 150000, systemReserveTokens: 1000, maxOutputTokens: 5000, recommendedOutputTokens: 2000 }), toolStep: async () => assert.fail('no prose/tools'), complete: async input => { calls.push(input); return { content: await respond() } }
  })
  const budget = async () => { const value = await writes.read(project.path, async () => normalizeContextBudgetPreferences(JSON.parse((await authority.readProjectWritingConfigForGuard(project.path)).configJson).contextBudgetPreferences)); await budgetHook?.(); return value }
  const make = () => createEventRuntime(projects, databases, writes, ai, { contextBudgetPreferences: budget }, undefined, { capturePolicy: policy, profile: async () => ({ genre: '悬疑', subgenre: '' }), budget,
    context: async (_readOnly, p) => { p.resolve('genre-guidance', { genre: '悬疑', subgenre: '' }); const result = await writes.read(project.path, async () => `${formal}\n${JSON.stringify(await fragments('review'))}`); await contextHook?.(); return result } })
  let runtime = make(); shutdown = () => runtime.extraction!.shutdown()
  const read = async <T>(fn: (db: NonNullable<Awaited<ReturnType<typeof databases.openExisting>>>) => T) => { const db = await databases.openExisting(project.path); assert.ok(db); try { return fn(db) } finally { db.close() } }
  const input = async (): Promise<SettlementStartInput> => ({ chapterId: old.id, expectedWorkItemId: project.id, operationId: randomUUID(), sourceFingerprint: (await runtime.settlements.page(old.id)).source.basis.fingerprint })
  const start = async (request?: SettlementStartInput) => runtime.extraction!.start(request ?? await input())
  const settled = async (id: string) => { const deadline = Date.now() + 30_000; let task = await runtime.extraction!.status(id); while (['queued', 'running'].includes(task.status) && Date.now() < deadline) { await new Promise(r => setTimeout(r, 25)); task = await runtime.extraction!.status(id) } assert.ok(!['queued', 'running'].includes(task.status), 'bounded terminal state'); return task }
  const ipc = async (channel: string, ...args: unknown[]) => {
    const handlers = new Map<string, (_event: unknown, ...args: unknown[]) => unknown>()
    registerTimelineIpc({ handle: (c, h) => { handlers.set(c, h) } }, { events: runtime } as Parameters<typeof registerTimelineIpc>[1])
    return handlers.get(channel)!(undefined, ...args) as Promise<{ ok: boolean; value: SettlementTask; error?: { message: string } }>
  }
  return { root, project, projects, old, authority, databases, writes, calls, input, start, settled, read, ipc, entries, select,
    runtime: () => runtime, reopen: () => { runtime.extraction!.shutdown(); runtime = make() }, respond: (fn: typeof respond) => { respond = fn },
    contextHook: (fn?: () => Promise<void>) => { contextHook = fn }, budgetHook: (fn?: () => Promise<void>) => { budgetHook = fn }, track: (fn: () => void) => releases.push(fn),
    revoke: async () => manager.setBookEnabled(project.id, draft.pluginId, false, (await manager.list()).revision), model: () => { model = 'changed-model' }, formal: () => { formal += '\nchanged' },
    budget: async () => { const current = await authority.readProjectWritingConfigForGuard(project.path); await authority.updateProjectWritingConfig(project.path, { configJson: JSON.stringify({ ...JSON.parse(current.configJson), contextBudgetPreferences: { ...contextBudgetStartingSuggestions, inputBudgetTokens: 4001 } }) }) },
    source: async () => { const current = await authority.chapter(project.path, old.id); await authority.updateChapter(project.path, old.id, { title: '新标题', expectedRevision: current.revision }) },
    disable: async (slot: string) => {
      manifest.version = '2.0.0'; const c = manifest.contributions.find((c: { slot: string }) => c.slot === slot); c.mode = 'disabled'; delete c.asset
      draft = await authoring.save({ id: draft.id, revision: draft.revision, manifestText: JSON.stringify(manifest), files: draft.files })
      const updated = await authoring.build({ id: draft.id, revision: draft.revision }), plan = await authoring.preview({ id: draft.id, revision: draft.revision })
      let index = await manager.install(plan.planId); index = await manager.setEnabled(draft.pluginId, true, [], index.revision); await manager.setBookEnabled(project.id, draft.pluginId, true, index.revision)
      await select(entries.map(e => ({ ...e, digest: updated.digest })))
    } }
}

test('actual installed event method reaches production IPC, exact static quotes and incomplete unknown fields stay non-canon', async t => {
  const f = await fixture(t), request = await f.input(), started = await f.ipc('events:settlement-start', request)
  assert.equal(started.ok, true, started.error?.message ?? 'production IPC'); const task = await f.settled(started.value.id)
  assert.equal(task.status, 'succeeded'); assert.equal(f.calls.length, 1); assert.equal(task.drafts.length, 1)
  assert.deepEqual(task.drafts[0]!.fields, candidate.fields); assert.deepEqual(task.drafts[0]!.quotes, candidate.quotes); assert.deepEqual(task.drafts[0]!.supplements, [])
  const text = f.calls[0]!.messages.map(m => m.content).join('\n')
  for (const required of ['ORIGINAL_EVENT_METHOD ORIGINAL_PARAMS', 'ORIGINAL_GENRE ORIGINAL_PARAMS 悬疑', 'ORIGINAL_FRAGMENT', 'AUTHOR_REQUIREMENT', '[属性]', body]) assert.ok(text.includes(required), required)
  assert.equal((await f.runtime().settlements.page(f.old.id)).history.length, 0); assert.equal((await f.authority.chapter(f.project.path, f.old.id)).content, body)
  const checkpoint = JSON.parse((await f.read(db => db.taskRun(task.id)!)).checkpointJson)
  assert.equal(Object.keys(checkpoint).length, 10); assert.ok(checkpoint.creativePolicy.installed.some((x: { pluginId: string }) => x.pluginId === f.entries[0]!.pluginId))
  await f.revoke(); f.reopen(); assert.equal((await f.start(request)).id, task.id); assert.equal((await f.settled(task.id)).drafts.length, 1); assert.equal(f.calls.length, 1)
})

test('disabled selected method or genre creates neither a task nor a provider request', async t => {
  for (const slot of ['prose-event-extraction', 'genre-guidance']) { const f = await fixture(t); await f.disable(slot); await assert.rejects(f.start()); assert.equal(f.calls.length, 0); assert.equal(await f.read(db => db.recentTaskRuns('prose_event_extraction').length), 0) }
})

test('changing current composition during preparation keeps the original method, parameters and review fragment', async t => {
  const f = await fixture(t); let changed = false
  f.contextHook(async () => { if (!changed) { changed = true; await f.select([]) } })
  const task = await f.start(); assert.equal((await f.settled(task.id)).status, 'succeeded')
  const text = f.calls[0]!.messages.map(m => m.content).join('\n'); assert.ok(text.includes('ORIGINAL_EVENT_METHOD ORIGINAL_PARAMS')); assert.ok(text.includes('ORIGINAL_FRAGMENT'))
})

test('model and saved source changing during asynchronous formal reads reject before sending', async t => {
  for (const action of ['model', 'source'] as const) { const f = await fixture(t); let changed = false; f.contextHook(async () => { if (!changed) { changed = true; await f[action]() } }); await assert.rejects(f.start()); assert.equal(f.calls.length, 0); assert.equal(await f.read(db => db.recentTaskRuns('prose_event_extraction').length), 0) }
})

test('late withdrawal, model, formal or budget drift discards both valid and invalid output', async t => {
  for (const action of ['revoke', 'model', 'formal', 'budget'] as const) for (const invalid of [false, true]) {
    const f = await fixture(t); f.respond(async () => { await f[action](); return invalid ? 'INVALID_EVENT_JSON' : proposal })
    const task = await f.start(); assert.equal((await f.settled(task.id)).status, 'failed'); assert.equal(f.calls.length, 1)
    assert.equal(await f.read(db => db.generationArtifactForTask(task.id)), null); assert.equal((await f.runtime().settlements.page(f.old.id)).drafts.length, 0)
  }
})

test('legal invalid raw output remains readable after withdrawal and reopening with zero automatic requests', async t => {
  const f = await fixture(t); f.respond(async () => 'INVALID_EVENT_JSON'); const request = await f.input(), task = await f.start(request)
  assert.equal((await f.settled(task.id)).rawOutput, 'INVALID_EVENT_JSON'); await f.revoke(); f.reopen()
  assert.equal((await f.runtime().extraction!.status(task.id)).rawOutput, 'INVALID_EVENT_JSON'); assert.equal((await f.start(request)).id, task.id); assert.equal(f.calls.length, 1)
})

test('closed history accepts original six fields without granting replay, rejects unpaired policy/text/digest and enforces UTF-8 byte budget', async t => {
  const f = await fixture(t), task = await f.start(); await f.settled(task.id)
  const modern = JSON.parse((await f.read(db => db.taskRun(task.id)!)).checkpointJson), { creativePolicy, methodHash, contextHash, modelIdentity, ...old } = modern
  assert.equal(Object.keys(decodeProseEventCheckpoint(old)).length, 6)
  assert.throws(() => decodeProseEventCheckpoint({ ...modern, methodText: 'FAKE_PERMISSION' })); assert.throws(() => decodeProseEventCheckpoint({ ...modern, methodHash: 'bad' }))
  assert.throws(() => decodeProseEventCheckpoint({ ...old, creativePolicy })); assert.throws(() => decodeProseEventCheckpoint({ ...modern, context: '中'.repeat(400_000) }))
  assert.doesNotThrow(() => decodeProseEventCheckpoint({ ...old, context: '中'.repeat(400_000) }))
  const id = randomUUID(), request = { ...old.request, operationId: id }
  await f.read(db => { db.createTaskRun({ id, taskType: 'prose_event_extraction', idempotencyKey: id, legacyChapterId: f.old.id, baseBodyVersionId: old.source.basis.bodyVersionId, contentHash: old.source.basis.bodyHash, taskContract: createTaskContractSnapshot('prose_event_extraction'), checkpointJson: JSON.stringify({ ...old, request }) }) })
  f.reopen(); assert.equal((await f.runtime().extraction!.status(id)).status, 'interrupted'); assert.equal((await f.start(request)).id, id); assert.equal(f.calls.length, 1)
})

test('actual queued artifact, candidate batch and succeeded writes recheck withdrawal and preserve previously legal stages', async t => {
  for (const [stage, budgetCount, artifactCount, draftCount] of [['artifact', 8, 0, 0], ['drafts', 10, 1, 0], ['succeeded', 12, 1, 1], ['invalid', 8, 0, 0]] as const) {
    const f = await fixture(t); if (stage === 'invalid') f.respond(async () => 'INVALID_EVENT_JSON')
    const reached = gate(), post = gate(), entered = gate(), lane = gate(); for (const g of [reached, post, entered, lane]) f.track(g.release)
    let budgets = 0; f.budgetHook(async () => { if (++budgets === budgetCount) { reached.release(); await post.pending } })
    const task = await f.start(); await reached.pending
    const blocker = f.writes.run(f.project.path, async () => { entered.release(); await lane.pending }), before = f.writes.writeCalls
    post.release(); await entered.pending
    const deadline = Date.now() + 10_000; while (f.writes.writeCalls === before && Date.now() < deadline) await new Promise(r => setTimeout(r, 10))
    assert.ok(f.writes.writeCalls > before, stage + ': actual mutation queued, not a read guard'); await f.revoke(); lane.release(); await blocker
    const final = await f.settled(task.id); assert.equal(final.status, 'failed', stage); assert.equal(final.drafts.length, draftCount, stage)
    assert.equal(await f.read(db => Number(Boolean(db.generationArtifactForTask(task.id)))), artifactCount, stage); assert.equal(f.calls.length, 1)
  }
})

test('identical-content SQLite replacement cannot receive any late artifact or task-state update', async t => {
  const f = await fixture(t), path = join(f.project.path, '.webnovel', 'workspace.sqlite'), retained = path + '.original'
  const identified = gate(), replaced = gate(); f.track(identified.release); f.track(replaced.release)
  let id = '', before: unknown
  f.respond(async () => {
    await identified.pending
    try { before = await f.read(db => db.taskRun(id)); await rename(path, retained); await copyFile(retained, path); return proposal }
    finally { replaced.release() }
  })
  const task = await f.start(); id = task.id; identified.release()
  // A read in the rename/copy gap correctly reports unavailable storage; inspect
  // the completed physical replacement, not that transient missing-file state.
  await replaced.pending
  assert.equal((await f.settled(task.id)).status, 'interrupted')
  for (const file of [path, retained]) { const db = new DatabaseSync(file, { readOnly: true }); try { assert.equal(db.prepare('SELECT COUNT(*) AS count FROM generation_artifacts').get()!.count, 0); assert.equal(db.prepare('SELECT COUNT(*) AS count FROM event_settlement_drafts').get()!.count, 0); const row = db.prepare('SELECT status FROM task_runs WHERE id=?').get(task.id)!; assert.equal(row.status, 'running') } finally { db.close() } }
  assert.ok(before)
  // Keep both identities until the fixture shuts down and removes its own root;
  // restoring the original while its late provider is settling reopens authority.
})

test('pure writing-budget snapshot exposes no mutation port and leaves database and mirrors unchanged', async t => {
  const f = await fixture(t), path = join(f.project.path, '.webnovel', 'workspace.sqlite'), before = await readFile(path), mirror = join(f.project.path, '.webnovel', 'config', 'project-writing.json')
  const mirrorBefore = await readFile(mirror).catch(() => null), port = await f.databases.openRecoveryReadOnly(f.project.path); assert.ok(port)
  assert.equal('writeProjectWritingConfig' in port, false); assert.equal('createTaskRun' in port, false); port.close()
  await f.authority.readProjectWritingConfigForGuard(f.project.path)
  assert.deepEqual(await readFile(path), before); assert.deepEqual(await readFile(mirror).catch(() => null), mirrorBefore); assert.equal(f.calls.length, 0)
})
