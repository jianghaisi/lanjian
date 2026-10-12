import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CompositionEntry } from '@lanjian/writing-plugin-contracts'
import { SqliteWorkspaceDatabaseFactory } from '../../src/main/platform/storage/workspace-database'
import { ProjectService } from '../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../src/main/platform/settings/settings-store'
import { DocumentService } from '../../src/main/modules/manuscript/application/document-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../src/main/modules/library/application/legacy-workspace-source'
import { ShadowImportService } from '../../src/main/modules/library/application/shadow-import-service'
import { WritingAgentService } from '../../src/main/modules/assistant/application/writing-agent-service'
import { WritingAgentTaskService } from '../../src/main/modules/assistant/application/writing-agent-task-service'
import { AiClient } from '../../src/main/modules/models/application/ai-client'
import { ChapterDraftService } from '../../src/main/modules/manuscript/application/chapter-draft-service'
import { LOCAL_CONNECTION_ID } from '../../src/contracts/models/local-model-contracts'
import type { TextCompletionInput } from '../../src/main/modules/models/domain/model-provider'
import type { WritingAgentRequest, WritingAgentTask } from '../../src/contracts'
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
import { decodeWritingAgentRecovery } from '../../src/main/modules/assistant/domain/writing-agent-recovery'
import { creativePolicyRun, type CaptureCreativePolicy } from '../../src/main/modules/writing-plugins/domain/creative-policy'
import type { CreativePolicyReference } from '../../src/main/modules/writing-plugins/domain/creative-policy-snapshot'

const sentinel = Error('capture only; never return generated prose')
const request: WritingAgentRequest = { chapterId: 1, currentDraft: '已有原文。', message: '当前资料有什么依据？', preferredSkill: 'query' }
async function fixture(t: TestContext, initialReleased?: CreativePolicyReference[]) {
  const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-durable-policy-')))
  const projects = new ProjectService(new SettingsStore(join(root, 'profile'), { available: () => false, encrypt: () => assert.fail(), decrypt: () => assert.fail() }))
  const { project } = await projects.create({ parentPath: root, name: '助笔原方法隔离验证', genre: '悬疑' })
  const documents = new DocumentService(projects)
  await documents.updateChapter(1, { title: '已有静态章', content: request.currentDraft })
  const databases = new SqliteWorkspaceDatabaseFactory(), importer = new ShadowImportService(new CurrentProjectLegacyWorkspaceSource(projects, documents), databases)
  await importer.import(await importer.preview())
  const db = (await databases.openExisting(project.path))!
  let manager = new WritingPluginManager(new PluginPackageStore(root), async () => {})
  const store = new PluginDraftStore(root)
  const authoring = new PluginAuthoringService(store, { build: buildPluginDraft, persist: b => store.persist(b), chooseExport: async () => null, choosePackage: async () => null, chooseSource: async () => null,
    installed: async (id, digest) => { const loaded = await manager.loadAuthorized(project.id, id, digest); return { manifest: loaded.version.manifest, files: loaded.files } } }, manager)
  const bundled = new BundledPluginService(bundledPackagePorts(root), manager, authoring)
  const original = (await bundled.list()).find(p => p.manifest.id === 'lanjian.official.creative-writing')!
  let draft = await bundled.derive({ pluginId: original.manifest.id, digest: original.digest })
  const manifest = JSON.parse(draft.manifestText)
  for (const c of manifest.contributions) c.configSchema = { type: 'object', properties: { focus: { type: 'string', maxLength: 100 } }, required: ['focus'], additionalProperties: false }
  manifest.contributions.push({ id: 'original-fragment', kind: 'context-fragment', name: '原插件片段', stages: ['review', 'writing'], text: 'ORIGINAL_FRAGMENT', configSchema: { type: 'object', properties: {}, additionalProperties: false } })
  draft = await authoring.save({ id: draft.id, revision: draft.revision, manifestText: JSON.stringify(manifest), files: draft.files.map(f => f.path.endsWith('.md') ? { ...f, content: `ORIGINAL_${f.path} {{focus}}` } : f) })
  async function install() {
    const built = await authoring.build({ id: draft.id, revision: draft.revision }), preview = await authoring.preview({ id: draft.id, revision: draft.revision })
    let index = await manager.install(preview.planId); index = await manager.setEnabled(draft.pluginId, true, [], index.revision)
    await manager.setBookEnabled(project.id, draft.pluginId, true, index.revision)
    return manifest.contributions.map((c: { id: string }) => ({ pluginId: draft.pluginId, digest: built.digest, contributionId: c.id, params: c.id === 'original-fragment' ? {} : { focus: 'ORIGINAL_PARAMS' } })) as CompositionEntry[]
  }
  async function select(entries: CompositionEntry[]) {
    const composition = new PluginCompositionService(manager), preview = await composition.preview(project.id, entries, (await manager.list()).revision, async () => {})
    assert.deepEqual(preview.conflicts, []); await composition.apply(preview.planId)
  }
  const entries = await install(); await select(entries)
  let captures = 0, restores = 0, model = 'fixed-model', formal = 'AUTHOR_OVERRIDE\n正式事实：已有资料。\n境界：自定义。\n系统模板：[属性]。', ready = true, contract = 'confirmed-static', inputBudget = 120000
  const calls: TextCompletionInput[] = [], services: WritingAgentTaskService[] = []
  let respond: (input: TextCompletionInput, count: number) => Promise<string> = async () => '本次检索未找到足够依据。'
  const ai = new AiClient({ resolve: async () => ({ kind: 'local', connectionId: LOCAL_CONNECTION_ID, connectionName: 'fake', profile: { connectionId: LOCAL_CONNECTION_ID, model, temperature: 0, topP: 1, maxTokens: 2000 } }),
    resolveConnection: async () => ({ kind: 'local', connectionId: LOCAL_CONNECTION_ID, connectionName: 'fake' }) }, {
    listModels: async () => ['fixed-model', 'new-model'], ready: async () => true, limits: () => ({ contextTokens: 150000, systemReserveTokens: 1000, maxOutputTokens: 5000, recommendedOutputTokens: 2000 }), toolStep: async () => assert.fail(),
    complete: async input => { calls.push(input); if (input.messages.some(m => /唯一允许处理的原文|继续/.test(m.content)) && !input.messages.some(m => /只读写作 Agent/.test(m.content))) { await respond(input, calls.length); throw sentinel } return { content: await respond(input, calls.length) } }
  })
  const workspace = {
    bookProfile: async () => ({ genre: '悬疑', subgenre: '' }), foundationStatus: async () => ({ readyForProse: ready, missing: ready ? [] : ['当前大纲未确认'] }), chapterContractVersion: async () => ({ fingerprint: contract }),
    contextBudgetPreferences: async () => ({ version: 1 as const, inputBudgetTokens: inputBudget, modelContextLimit: 150000, outputReservePercent: 25, systemReserveTokens: 10000, structuredRepairAttempts: 1 }),
    currentChapterCardFingerprint: async () => 'card-fixture', currentWorldbookFingerprint: async () => null,
    promptContextCandidates: async (_id: number, _task: string, options: { policyManaged?: boolean }) => { assert.equal(options.policyManaged, true); return [{ id: 'formal', sourceId: 'formal', sourceType: 'formal', label: '正式依据与作者要求', content: formal, authority: 'required' as const, truncationPolicy: 'never' as const }] },
    contextFactPack: async () => ({ evidence: [] }), consistencyOverview: async () => ({ items: [] })
  }
  function make(released: CreativePolicyReference[] | null = initialReleased ?? null) {
    const capture = async () => { captures++; return manager.captureComposition((await projects.currentSummary()).id) }
    const currentProvider = createCreativePolicyProvider(capture, async v => (await manager.loadAuthorized((await projects.currentSummary()).id, v.manifest.id, v.digest)).files, async ref => { restores++; return manager.loadAuthorized((await projects.currentSummary()).id, ref.pluginId, ref.digest) })
    // Simulate an actually registered earlier release at capture; reopening uses today's provider.
    // Installed bytes and grants always come from the real manager, never fixture method text.
    const provider: CaptureCreativePolicy = released ? Object.assign(async () => {
      const current = await currentProvider(), snapshot = current.snapshot!(), bookId = (await projects.currentSummary()).id
      const packages = await Promise.all(snapshot.installed.map(async ref => {
        const source = await manager.loadAuthorized(bookId, ref.pluginId, ref.digest), decoder = new TextDecoder('utf-8', { fatal: true })
        return { manifest: source.version.manifest, digest: source.version.digest, files: new Map((source.version.manifest.assets ?? []).map(path => [path, decoder.decode(source.files.get(path)!)])) }
      }))
      return { ...creativePolicyRun(packages, snapshot.composition, snapshot.slotParams, released), assertAuthorized: current.assertAuthorized, withContext: current.withContext }
    }, { restore: currentProvider.restore }) : currentProvider
    const drafts = new ChapterDraftService(ai, documents, workspace as never, provider)
    const runner = new WritingAgentService(ai, projects, documents, workspace as never, drafts, undefined, createContributionContextProvider(capture), provider)
    const service = new WritingAgentTaskService(runner, projects, databases); services.push(service)
    return { runner, service }
  }
  const initial = make()
  t.after(async () => { services.forEach(s => s.abortForShutdown()); await new Promise(r => setTimeout(r, 20)); db.close(); assert.equal(dirname(await realpath(root)), parent); await rm(root, { recursive: true, force: true }) })
  return { ...initial, make, db, projects, documents, project, databases, importer, root, calls, entries, select, captures: () => captures, restores: () => restores,
    respond: (fn: typeof respond) => { respond = fn }, revoke: async () => { await manager.setBookEnabled(project.id, draft.pluginId, false, (await manager.list()).revision) },
    reopen: () => { manager = new WritingPluginManager(new PluginPackageStore(root), async () => {}); return make(null) },
    update: async () => { manifest.version = '1.1.1'; manifest.contributions.at(-1).text = 'NEW_FRAGMENT'; draft = await authoring.save({ id: draft.id, revision: draft.revision, manifestText: JSON.stringify(manifest), files: draft.files.map(f => f.path.endsWith('.md') ? { ...f, content: `NEW_${f.path} {{focus}}` } : f) }); const newer = await install(); await select(newer) },
    changeModel: () => { model = 'new-model' }, changeFormal: () => { formal += '\n正式事实发生变化。' }, changeBudget: () => { inputBudget -= 500 }, changeContract: () => { contract = 'changed' }, noConfirmation: () => { ready = false } }
}
async function finished(service: WritingAgentTaskService, id: string, expected = 'succeeded'): Promise<WritingAgentTask> {
  for (let i = 0; i < 400; i++) { const task = await service.status(id); if (!['queued', 'resuming', 'preparing', 'running', 'streaming'].includes(task.status)) { assert.equal(task.status, expected, task.error?.message ?? 'unexpected terminal status'); return task } await new Promise(r => setTimeout(r, 10)) }
  return assert.fail('task did not finish')
}
async function failed(t: TestContext) {
  const f = await fixture(t); f.respond(async () => { throw Error('controlled provider failure') })
  const task = await f.service.start({ request, operationId: randomUUID() }); await finished(f.service, task.id, 'failed')
  return { f, task }
}

test('an original registered release survives actual SQLite reopening and explicit retry alongside retained personal ZIP methods', async t => {
  const registry = JSON.parse(await readFile(new URL('../../../packages/writing-plugin-package/official-history/releases.json', import.meta.url), 'utf8')) as { sets: CreativePolicyReference[][] }
  const refs = registry.sets.find(set => set.some(ref => ref.pluginId.endsWith('story-planning') && ref.version === '1.5.0') && set.some(ref => ref.pluginId.endsWith('creative-writing') && ref.version === '1.2.0'))!
  const f = await fixture(t, refs)
  f.respond(async () => { throw Error('controlled old-release read-only request failure') })
  const parent = await f.service.start({ request, operationId: randomUUID() })
  await finished(f.service, parent.id, 'failed')
  const originalCheckpoint = f.db.taskRun(parent.id)!.checkpointJson
  const before = JSON.parse(originalCheckpoint).recovery
  assert.deepEqual(before.creativePolicy.released, refs)
  assert.equal(f.calls.length, 1); assert.equal(f.captures(), 1)
  await f.update()
  const { service } = f.reopen()
  assert.equal(f.calls.length, 1); assert.equal(f.db.taskRun(parent.id)!.checkpointJson, originalCheckpoint)
  f.respond(async () => '本次检索未找到足够依据。')
  const operation = randomUUID(), child = await service.retry(parent.id, operation)
  const done = await finished(service, child.id)
  assert.deepEqual(JSON.parse(f.db.taskRun(child.id)!.checkpointJson).recovery.creativePolicy, before.creativePolicy)
  assert.equal(done.parentTaskRunId, parent.id); assert.equal(f.captures(), 1); assert.ok(f.restores() > 0)
  const messages = JSON.stringify(f.calls.at(-1)!.messages)
  assert.match(messages, /ORIGINAL_work-query.md ORIGINAL_PARAMS/); assert.match(messages, /ORIGINAL_FRAGMENT/)
  assert.doesNotMatch(messages, /NEW_FRAGMENT|NEW_work-query/); assert.equal(done.turn?.candidate, undefined)
  await f.revoke()
  assert.equal((await service.retry(parent.id, operation)).id, child.id); assert.equal(f.calls.length, 2)
  const rejected = await service.retry(parent.id, randomUUID())
  await finished(service, rejected.id, 'failed')
  assert.equal(f.calls.length, 2)
  assert.equal((await f.documents.chapter(1)).content, request.currentDraft)
})

test('actual installed ZIP and SQLite retry after reopening retain original method, parameters and fragment despite version/composition edits', async t => {
  const { f, task } = await failed(t), before = JSON.parse(f.db.taskRun(task.id)!.checkpointJson).recovery
  assert.equal(f.captures(), 1); assert.ok(before.creativePolicy.installed.length)
  assert.ok(!JSON.stringify(before).includes('toolGrant')); assert.ok(!JSON.stringify(before).includes('apiKey'))
  await f.update(); const { service } = f.reopen(); f.respond(async () => '本次检索未找到足够依据。')
  const operation = randomUUID(), child = await service.retry(task.id, operation), done = await finished(service, child.id)
  assert.equal(done.parentTaskRunId, task.id); assert.equal(f.captures(), 1); assert.ok(f.restores() > 0)
  const messages = JSON.stringify(f.calls.at(-1)!.messages)
  assert.match(messages, /ORIGINAL_work-query.md ORIGINAL_PARAMS/); assert.match(messages, /ORIGINAL_FRAGMENT/); assert.doesNotMatch(messages, /NEW_FRAGMENT|NEW_work-query/)
  assert.match(messages, /AUTHOR_OVERRIDE/); assert.equal(done.turn?.candidate, undefined)
  await f.revoke(); f.changeModel()
  assert.equal((await service.retry(task.id, operation)).id, child.id); assert.equal(f.calls.length, 2)
  assert.equal((await f.documents.chapter(1)).content, request.currentDraft)
})

test('pause, restart and explicit resume preserve pre-stop partial and original policy, with zero automatic resend', async t => {
  const f = await fixture(t); let entered!: () => void
  const waiting = new Promise<void>(r => { entered = r })
  f.respond(async input => { await input.onDelta?.('只读问题分析。', '只读问题分析。'); entered(); await new Promise<void>(r => input.signal?.addEventListener('abort', () => r(), { once: true })); throw new DOMException('stopped', 'AbortError') })
  const task = await f.service.start({ request, operationId: randomUUID() }); await waiting
  const parent = await f.service.pause(task.id); assert.equal(parent.partial?.content, '只读问题分析。')
  await f.select([]); const { service } = f.reopen(); await service.status(task.id); assert.equal(f.calls.length, 1)
  f.respond(async () => '本次检索未找到足够依据。')
  const child = await service.resume(task.id, randomUUID()); await finished(service, child.id)
  assert.equal(f.captures(), 1); assert.match(JSON.stringify(f.calls[1].messages), /ORIGINAL_work-query.md/)
  assert.equal((await service.status(task.id)).partial?.content, parent.partial?.content)
  assert.equal((await f.documents.chapter(1)).content, request.currentDraft)
})

for (const change of ['revoke', 'changeModel', 'changeFormal', 'changeBudget'] as const) test(`${change} blocks original recovery without another send or successful artifact`, async t => {
  const { f, task } = await failed(t); await f[change](); const { service } = f.reopen(); f.respond(async () => '本次检索未找到足够依据。')
  const child = await service.retry(task.id, randomUUID()); const result = await finished(service, child.id, 'failed')
  assert.equal(result.artifact, undefined); assert.equal(f.calls.length, 1); assert.equal(f.captures(), 1)
  assert.equal((await f.documents.chapter(1)).content, request.currentDraft)
})

test('missing/corrupt private snapshots preserve history and reject fresh recovery; structured prepared JSON cannot grant access', async t => {
  const { f, task } = await failed(t), record = f.db.taskRun(task.id)!, checkpoint = JSON.parse(record.checkpointJson)
  const valid = checkpoint.recovery
  for (const invalid of [{ ...valid, toolGrant: {} }, { ...valid, modelIdentities: [] }, { ...valid, format: 2 }, { ...valid, sourceHash: 'bad' }]) assert.throws(() => decodeWritingAgentRecovery(invalid), { code: 'CONFLICT' })
  delete checkpoint.recovery; f.db.transitionTaskRun({ id: task.id, status: 'failed', checkpointJson: JSON.stringify(checkpoint) })
  const { service, runner } = f.reopen(); assert.equal((await service.status(task.id)).status, 'failed')
  await assert.rejects(service.retry(task.id, randomUUID()), /原创作快照/); assert.equal(f.calls.length, 1)
  const prepared = await runner.prepare(request)
  await assert.rejects(runner.run(request, undefined, structuredClone(prepared)), { code: 'CONFLICT' }); assert.equal(f.calls.length, 1)
})

test('preparation stop has no complete snapshot and requires a fresh task rather than recapturing methods', async t => {
  const f = await fixture(t); let entered!: () => void, release!: () => void
  const waiting = new Promise<void>(r => { entered = r })
  f.runner.prepare = async (_input, signal) => { entered(); await new Promise<void>(r => { release = r; signal?.addEventListener('abort', () => r(), { once: true }) }); signal?.throwIfAborted(); return assert.fail() }
  const task = await f.service.start({ request, operationId: randomUUID() }); await waiting; await f.service.pause(task.id); release()
  await assert.rejects(f.service.resume(task.id, randomUUID()), /原创作快照/); assert.equal(f.calls.length, 0)
})

test('selected prose durable request is captured then aborted, and changed original confirmation cannot resume; no prose returned', async t => {
  const f = await fixture(t), bodyRequest: WritingAgentRequest = { ...request, message: '润色选段', preferredSkill: 'polish', selection: { start: 0, end: request.currentDraft.length, text: request.currentDraft } }
  const task = await f.service.start({ request: bodyRequest, operationId: randomUUID() }); await finished(f.service, task.id, 'failed')
  assert.equal(f.calls.length, 1); assert.match(JSON.stringify(f.calls[0].messages), /ORIGINAL_selection-revision.md ORIGINAL_PARAMS/)
  assert.equal(JSON.parse(f.db.taskRun(task.id)!.checkpointJson).recovery.contractFingerprint, 'confirmed-static')
  f.changeContract(); const child = await f.service.retry(task.id, randomUUID()); await finished(f.service, child.id, 'failed'); assert.equal(f.calls.length, 1)
  assert.equal((await f.documents.chapter(1)).content, request.currentDraft)
  f.noConfirmation(); const fresh = await f.service.start({ request: bodyRequest, operationId: randomUUID() }); await finished(f.service, fresh.id, 'failed'); assert.equal(f.calls.length, 1)
})

test('withdrawal after a read-only response prevents late partial and final publication; original diagnostics remain', async t => {
  const f = await fixture(t)
  f.respond(async input => { await f.revoke(); await input.onDelta?.('迟到只读分析。', '迟到只读分析。'); return '迟到只读分析。' })
  const task = await f.service.start({ request, operationId: randomUUID() }); const result = await finished(f.service, task.id, 'failed')
  assert.equal(result.artifact, undefined); assert.equal(result.partial, undefined); assert.ok(result.contextPackage)
  assert.equal(f.calls.length, 1); assert.equal((await f.documents.chapter(1)).content, request.currentDraft)
})

test('original references never authorize another real book or load its stored task', async t => {
  const { f, task } = await failed(t), snapshot = JSON.parse(f.db.taskRun(task.id)!.checkpointJson).recovery
  await f.projects.create({ parentPath: f.root, name: '另一部隔离书', genre: '仙侠' })
  await f.importer.import(await f.importer.preview())
  const { service, runner } = f.make()
  await assert.rejects(service.status(task.id), { code: 'NOT_FOUND' })
  await assert.rejects(runner.restore(request, snapshot), { code: 'CONFLICT' })
  assert.equal(f.calls.length, 1)
  await f.projects.switch(f.project.path)
  assert.equal((await f.documents.chapter(1)).content, request.currentDraft)
})

test('confirmation changing between durable freeze and run rejects before the first prose request', async t => {
  const f = await fixture(t), run = f.runner.run.bind(f.runner)
  f.runner.run = async (...args) => { f.changeContract(); return run(...args) }
  const bodyRequest: WritingAgentRequest = { ...request, preferredSkill: 'polish', selection: { start: 0, end: request.currentDraft.length, text: request.currentDraft } }
  const task = await f.service.start({ request: bodyRequest, operationId: randomUUID() }); await finished(f.service, task.id, 'failed')
  assert.equal(f.calls.length, 0); assert.equal((await f.documents.chapter(1)).content, request.currentDraft)
})
