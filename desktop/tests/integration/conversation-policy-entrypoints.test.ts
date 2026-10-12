import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CompositionEntry } from '@lanjian/writing-plugin-contracts'
import { PluginPackageStore } from '../../src/main/modules/writing-plugins/adapters/package-store'
import { PluginDraftStore } from '../../src/main/modules/writing-plugins/adapters/draft-store'
import { buildPluginDraft } from '../../src/main/modules/writing-plugins/adapters/draft-builder'
import { bundledPackagePorts } from '../../src/main/modules/writing-plugins/adapters/bundled-packages'
import { PluginAuthoringService } from '../../src/main/modules/writing-plugins/application/authoring-service'
import { BundledPluginService } from '../../src/main/modules/writing-plugins/application/bundled-service'
import { PluginCompositionService } from '../../src/main/modules/writing-plugins/application/composition-service'
import { WritingPluginManager } from '../../src/main/modules/writing-plugins/application/plugin-manager'
import { createCreativePolicyProvider } from '../../src/main/modules/writing-plugins/runtime/creative-policy-provider'
import { withContributionSnapshot } from '../../src/main/modules/writing-plugins/runtime/contribution-context'
import { restoreCreativePolicy } from '../../src/main/modules/writing-plugins/domain/creative-policy-snapshot'
import { AssistantRunService, type AssistantRunPorts } from '../../src/main/modules/assistant/application/runs/service'
import { AssistantRunStore } from '../../src/main/modules/assistant/adapters/assistant-run-store'
import type { AssistantRunRecord } from '../../src/main/modules/assistant/application/runs/state'
import { createBuiltinRegistry } from '../../src/main/modules/writing-plugins/adapters/builtin'
import { authorInteractionCapabilities } from '../../src/main/modules/writing-plugins/adapters/builtin/author-interaction'
import { modelToolName } from '../../src/main/modules/writing-plugins/application/registry'
import type { AiToolMessage, AiToolStep, AssistantConversationRequest } from '../../src/contracts/assistant/assistant-conversation-contracts'
import type { AssistantRunView } from '../../src/contracts/assistant/assistant-run-contracts'
import { registerFieldAssistant } from '../../src/main/modules/assistant/runtime/field-assistant-runtime'
import { AiClient } from '../../src/main/modules/models/application/ai-client'
import { LOCAL_CONNECTION_ID } from '../../src/contracts/models/local-model-contracts'
import type { TextCompletionInput } from '../../src/main/modules/models/domain/model-provider'
import { draftAssistantSample } from '../../src/main/modules/assistant/application/assistant-sample-service'

const request: AssistantConversationRequest = { operationId: 'isolated', workItemId: 'book-A', page: 'world', message: '请核对资料后问我一个偏好问题。', targets: [], chapterId: null, selectedCharacters: 0, history: [] }
const refresh = { page: request.page, targets: [], chapterId: null, selectedCharacters: 0 }
const question = { questions: [{ id: 'tone', prompt: '希望采用哪种讨论语气？', mode: 'single', required: true, options: [{ id: 'plain', label: '平实', recommended: true }, { id: 'light', label: '轻松' }] }] }
const ask = (): AiToolStep => ({ content: '', toolCalls: [{ id: 'original-question', type: 'function', function: { name: modelToolName('builtin.core', 'ask_author'), arguments: JSON.stringify(question) } }] })
const answer = (view: AssistantRunView) => ({ runId: view.id, questionId: view.question!.id, questionVersion: view.question!.version, answerSubmissionId: 'original-answer', answers: [{ id: 'tone', chosenOptionIds: ['plain'], customText: '', skipped: false }] })
class CommitStore extends AssistantRunStore {
  hook?: (record: AssistantRunRecord) => Promise<void>
  override write(record: AssistantRunRecord, beforeCommit?: () => Promise<void>) {
    return super.write(record, beforeCommit ? async () => { await this.hook?.(record); await beforeCommit() } : undefined)
  }
}
async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-conversation-policy-')))
  let service: AssistantRunService, book = 'book-A', formal = 'formal-original', model = 'model-original', captures = 0, restores = 0
  const store = new CommitStore(root)
  let manager = new WritingPluginManager(new PluginPackageStore(root), (id, book) => service.revokePlugin(id, book))
  const drafts = new PluginDraftStore(root)
  const authoring = new PluginAuthoringService(drafts, { build: buildPluginDraft, persist: b => drafts.persist(b), chooseExport: async () => null, choosePackage: async () => null, chooseSource: async () => null,
    installed: async (id, digest) => { const loaded = await manager.loadAuthorized(book, id, digest); return { manifest: loaded.version.manifest, files: loaded.files } } }, manager)
  const bundled = new BundledPluginService(bundledPackagePorts(root), manager, authoring)
  const original = (await bundled.list()).find(p => p.manifest.id === 'lanjian.official.creative-writing')!
  let draft = await bundled.derive({ pluginId: original.manifest.id, digest: original.digest })
  const manifest = JSON.parse(draft.manifestText)
  const originalVersion = manifest.version
  manifest.contributions = manifest.contributions.filter((c: { slot: string }) => ['assistant-conversation', 'assistant-sample'].includes(c.slot))
  for (const c of manifest.contributions) c.configSchema = { type: 'object', properties: { focus: { type: 'string', maxLength: 100 } }, required: ['focus'], additionalProperties: false }
  draft = await authoring.save({ id: draft.id, revision: draft.revision, manifestText: JSON.stringify(manifest), files: draft.files.map(f => ['assistant-conversation.md', 'assistant-sample.md'].includes(f.path) ? { ...f, content: `ORIGINAL_${f.path} {{focus}}` } : f) })
  async function install() {
    const built = await authoring.build({ id: draft.id, revision: draft.revision }), preview = await authoring.preview({ id: draft.id, revision: draft.revision })
    let index = await manager.install(preview.planId); index = await manager.setEnabled(draft.pluginId, true, [], index.revision)
    await manager.setBookEnabled(book, draft.pluginId, true, index.revision)
    return manifest.contributions.map((c: { id: string }) => ({ pluginId: draft.pluginId, digest: built.digest, contributionId: c.id, params: { focus: 'ORIGINAL_PARAMS' } })) as CompositionEntry[]
  }
  async function select(entries: CompositionEntry[]) {
    const composition = new PluginCompositionService(manager), preview = await composition.preview(book, entries, (await manager.list()).revision, async () => {})
    assert.deepEqual(preview.conflicts, []); await composition.apply(preview.planId)
  }
  const entries = await install(); await select(entries)
  const seen: AiToolMessage[][] = [], services: AssistantRunService[] = []
  let respond: (messages: AiToolMessage[]) => Promise<AiToolStep> = async messages => messages.some(m => m.role === 'tool') ? { content: '本次偏好讨论已经完成。', toolCalls: [] } : ask()
  const provider = createCreativePolicyProvider(async () => { captures++; return manager.captureComposition(book) }, async v => (await manager.loadAuthorized(book, v.manifest.id, v.digest)).files, async ref => { restores++; return manager.loadAuthorized(book, ref.pluginId, ref.digest) })
  const ports: AssistantRunPorts = {
    async book() { return { id: book, title: '隔离讨论作品', physicalIdentity: book + '-physical' } }, async assertScope(id) { assert.equal(id, book) }, async context() { return '{"正式事实":"隔离资料"}' },
    async fingerprint() { return formal }, async modelIdentity() { return model }, async startField() { assert.fail('no draft generation') }, async cancelField() {}, async inspectHandoff() { assert.fail('no adoption') }, async candidateHandoff() { assert.fail('no candidate') },
    async prepare() { return { async step(messages) { seen.push(structuredClone(messages)); return respond(messages) } } },
    async creativePolicy(_input, snapshot) { const policy = snapshot ? await restoreCreativePolicy(provider, snapshot) : await provider(); policy.resolve('genre-guidance', { genre: '悬疑', subgenre: '' }); policy.resolve('assistant-conversation'); await policy.assertAuthorized?.(); return policy },
    async capturePluginState(id) { const captured = await manager.captureComposition(id); return { pins: captured.versions.map(v => ({ id: v.manifest.id, version: v.manifest.version, digest: v.digest, grants: v.grants })), effects: [], composition: captured.composition } },
    async assertPlugins(id, pins) { for (const pin of pins) await manager.authorize(id, pin.id, pin.digest) },
    async withPluginContext(id, state, operation) { const versions = await Promise.all(state.pins.map(pin => manager.authorize(id, pin.id, pin.digest))); return withContributionSnapshot({ versions, composition: state.composition! }, operation) }
  }
  const create = () => { service = new AssistantRunService(ports, store, input => createBuiltinRegistry(ports, input), new Set(authorInteractionCapabilities)); services.push(service); return service }
  create()
  t.after(async () => { services.forEach(s => s.abortForShutdown()); assert.equal(dirname(await realpath(root)), parent); await rm(root, { recursive: true, force: true }) })
  return { service: () => service, create, store, ports, entries, select, seen, root, captures: () => captures, restores: () => restores, provider,
    respond: (fn: typeof respond) => { respond = fn }, changeFormal: () => { formal = 'changed' }, changeModel: () => { model = 'changed' }, book: (value: string) => { book = value },
    grant: async () => { await manager.setBookEnabled(book, draft.pluginId, true, (await manager.list()).revision) },
    revoke: async () => { await manager.setBookEnabled(book, draft.pluginId, false, (await manager.list()).revision) },
    authorized: async () => { try { await manager.authorize(book, draft.pluginId, entries[0].digest); return true } catch { return false } },
    update: async () => { manifest.version = '1.2.1'; draft = await authoring.save({ id: draft.id, revision: draft.revision, manifestText: JSON.stringify(manifest), files: draft.files.map(f => ['assistant-conversation.md', 'assistant-sample.md'].includes(f.path) ? { ...f, content: `NEW_${f.path} {{focus}}` } : f) }); await select(await install()) },
    tamper: async () => { await writeFile(join(root, 'plugin-packages', draft.pluginId, `${originalVersion}-${entries[0].digest}`, 'assistant-conversation.md'), 'tampered bytes') },
    reopen: () => { manager = new WritingPluginManager(new PluginPackageStore(root), (id, book) => service.revokePlugin(id, book)); return create() } }
}
async function until(service: AssistantRunService, id: string, expected: string) {
  for (let i = 0; i < 300; i++) { const view = await service.status(id); if (view.status === expected) return view; if (['failed', 'cancelled'].includes(view.status)) assert.fail(view.message); await new Promise(r => setTimeout(r, 5)) }
  return assert.fail('run did not reach ' + expected)
}
async function bounded<T>(operation: Promise<T>, ms = 10000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('commit/revocation did not settle')), ms) })]) } finally { clearTimeout(timer!) }
}

test('real ZIP, normal store reopening and explicit answer retain the original method and parameters after a plugin update and composition clearing', async t => {
  const f = await fixture(t), start = await f.service().start(request), waiting = await until(f.service(), start.id, 'waiting-input')
  const before = JSON.stringify(await f.store.read('book-A'))
  assert.match(JSON.stringify(f.seen[0]), /ORIGINAL_assistant-conversation.md ORIGINAL_PARAMS/)
  assert.doesNotMatch(JSON.stringify(waiting), /creativePolicy|conversationMethodHash|ORIGINAL_PARAMS/)
  f.service().abortForShutdown(); await f.update(); await f.select([])
  const restarted = f.reopen(), visible = await restarted.status(start.id)
  assert.equal(JSON.stringify(await f.store.read('book-A')), before); assert.equal(f.seen.length, 1); assert.equal(visible.needsResume, true)
  const resumed = await restarted.resume({ runId: start.id, expectedRevision: visible.revision, context: refresh })
  assert.equal(f.seen.length, 1); await restarted.answer(answer(resumed)); await until(restarted, start.id, 'completed')
  assert.match(JSON.stringify(f.seen[1]), /ORIGINAL_assistant-conversation.md ORIGINAL_PARAMS/); assert.doesNotMatch(JSON.stringify(f.seen[1]), /NEW_assistant-conversation/)
  assert.equal(f.captures(), 0, 'original contribution scope supplies the capture; restore must never recapture current selection'); assert.ok(f.restores() > 0)
  assert.equal(f.seen[1].filter(m => m.tool_call_id === 'original-question').length, 1)
  await f.revoke(); f.changeModel(); assert.deepEqual(await restarted.answer(answer(resumed)), (await f.store.read('book-A'))[0].receipts[0].receipt); assert.equal(f.seen.length, 2)
})

test('production old records are readable without methods but cannot resume or send another model request', async t => {
  const f = await fixture(t), start = await f.service().start(request); await until(f.service(), start.id, 'waiting-input')
  f.service().abortForShutdown(); const old = (await f.store.read('book-A'))[0]; delete old.creativePolicy; delete old.conversationMethodHash; await f.store.write(old)
  const restarted = f.reopen(), visible = await restarted.status(start.id)
  assert.equal(visible.status, 'waiting-input'); await assert.rejects(restarted.resume({ runId: start.id, expectedRevision: visible.revision, context: refresh }), /原方法版本/); assert.equal(f.seen.length, 1)
})

test('restoring private methods rejects changed frozen system messages before a model or answer is sent', async t => {
  const f = await fixture(t), start = await f.service().start(request); await until(f.service(), start.id, 'waiting-input')
  f.service().abortForShutdown(); const old = (await f.store.read('book-A'))[0]; old.messages[0].content = 'altered method'; await f.store.write(old)
  const restarted = f.reopen(), visible = await restarted.status(start.id)
  await assert.rejects(restarted.resume({ runId: start.id, expectedRevision: visible.revision, context: refresh }), /方法版本或消息依据/); assert.equal(f.seen.length, 1)
})

test('ordinary book withdrawal is synchronous and does not cancel another book waiting on the same installed package', async t => {
  const f = await fixture(t), a = await f.service().start(request); await until(f.service(), a.id, 'waiting-input')
  f.book('book-B'); await f.grant(); await f.select(f.entries)
  const b = await f.service().start({ ...request, operationId: randomUUID(), workItemId: 'book-B' }); await until(f.service(), b.id, 'waiting-input')
  f.book('book-A'); await bounded(f.revoke())
  assert.equal((await f.store.read('book-A'))[0].view.status, 'cancelled'); assert.equal((await f.store.read('book-B'))[0].view.status, 'waiting-input'); assert.equal(f.seen.length, 2)
})

test('changed model and formal context independently prevent restoring a waiting original method', async t => {
  for (const change of ['model', 'formal'] as const) {
    const f = await fixture(t), start = await f.service().start(request); await until(f.service(), start.id, 'waiting-input'); f.service().abortForShutdown()
    change === 'model' ? f.changeModel() : f.changeFormal()
    const restarted = f.reopen(), visible = await restarted.status(start.id)
    await assert.rejects(restarted.resume({ runId: start.id, expectedRevision: visible.revision, context: refresh }), /写作依据或模型配置/); assert.equal(f.seen.length, 1)
  }
})

test('a question queued before rename is never published if ordinary withdrawal occurs during the queue wait', async t => {
  const f = await fixture(t); let entered!: () => void, release!: () => void
  const waiting = new Promise<void>(r => { entered = r }), blocked = new Promise<void>(r => { release = r })
  t.after(() => release())
  f.store.hook = async record => { if (record.view.status === 'waiting-input') { entered(); await blocked } }
  const start = await f.service().start(request); await bounded(waiting)
  const revoked = f.revoke()
  await bounded((async () => { while (await f.authorized()) await new Promise(r => setTimeout(r, 5)) })())
  release(); await bounded(revoked)
  const visible = await f.service().status(start.id)
  assert.equal(visible.status, 'cancelled'); assert.equal(visible.question, undefined); assert.equal(visible.handoff, undefined); assert.equal(f.seen.length, 1)
})

test('real package tampering during the queued store commit revokes without waiting on its own write or publishing the late result', async t => {
  const f = await fixture(t), a = await f.service().start(request); await until(f.service(), a.id, 'waiting-input')
  f.book('book-B'); await f.grant(); await f.select(f.entries); f.respond(async () => ({ content: '只读讨论结果。', toolCalls: [] }))
  let triggered = false
  f.store.hook = async record => { if (!triggered && record.view.status === 'completed') { triggered = true; await f.tamper() } }
  const started = await f.service().start({ ...request, operationId: randomUUID(), workItemId: 'book-B' })
  await bounded((async () => { for (let i = 0; i < 150; i++) { const records = await f.store.read('book-B'); if (records[0]?.view.status === 'cancelled') return records[0]; await new Promise(r => setTimeout(r, 5)) } assert.fail('revocation not durable: ' + JSON.stringify({ triggered, view: (await f.store.read('book-B'))[0]?.view })) })())
  const visible = await f.service().status(started.id)
  assert.equal(visible.status, 'cancelled'); assert.equal(visible.result, undefined); assert.equal(visible.question, undefined); assert.equal(visible.handoff, undefined); assert.equal(f.seen.length, 2)
  await bounded((async () => { for (let i = 0; i < 100; i++) { if ((await f.store.read('book-A'))[0].view.status === 'cancelled') return; await new Promise(r => setTimeout(r, 5)) } assert.fail('other-book cancellation did not settle') })())
})

async function runtimeFixture(t: TestContext) {
  const f = await fixture(t), handlers = new Map<string, (_event: unknown, ...args: unknown[]) => unknown>()
  let ready = false, contract = 'confirmed-fixture', constraints = 'formal-fixture', model = 'fixture-model', reads = 0, proseContexts = 0
  let onPrompt: () => void = () => {}, onTool: () => Promise<void> = async () => {}, requestSample = true
  const completions: TextCompletionInput[] = [], conversations: AiToolMessage[][] = [], tasks: string[] = []
  const ai = new AiClient({ resolve: async task => { tasks.push(task); return { kind: 'local', connectionId: LOCAL_CONNECTION_ID, connectionName: 'fixture', profile: { connectionId: LOCAL_CONNECTION_ID, model, temperature: 0, topP: 1, maxTokens: 2000 } } }, resolveConnection: async () => ({ kind: 'local', connectionId: LOCAL_CONNECTION_ID, connectionName: 'fixture' }) }, {
    listModels: async () => ['fixture-model', 'changed-model'], ready: async () => true, limits: () => ({ contextTokens: 150000, systemReserveTokens: 1000, maxOutputTokens: 5000, recommendedOutputTokens: 2000 }),
    toolStep: async (_model, _profile, messages) => { conversations.push(structuredClone(messages)); await onTool(); return requestSample ? { content: '', toolCalls: [{ id: 'sample', type: 'function', function: { name: 'write_sample', arguments: JSON.stringify({ instruction: '按当前章纲创作样稿。' }) } }] } : { content: '请在作品库选择作品，随后审阅大纲。', toolCalls: [] } },
    complete: async input => { completions.push(input); throw Error('capture only; never return generated prose') }
  })
  const workspace = {
    setDefinitionAssistantSources() {}, bookProfile: async () => { reads++; return { genre: '悬疑', subgenre: '' } }, foundation: async () => { reads++; return {} }, realms: async () => { reads++; return {} }, powerSystem: async () => { reads++; return {} }, cheatSystem: async () => { reads++; return {} }, systemTemplate: async () => { reads++; return '[属性]' },
    foundationStatus: async () => ({ readyForProse: ready, missing: ready ? [] : ['大纲尚未确认'] }), chapterContractVersion: async () => ({ fingerprint: contract }), currentRevisionConstraintsFingerprint: async () => constraints,
    promptContext: async (_chapter: number, task: string, options: { policyManaged?: boolean }) => { assert.equal(task, 'prose'); assert.equal(options.policyManaged, true); proseContexts++; onPrompt(); return '正式作者事实。境界：自定义。系统：[属性]。' }
  }
  const projects = { executionIdentity: { physicalIdentity: 'book-A-physical' }, currentSummary: async () => ({ id: 'book-A', title: '隔离作品' }), currentPath: async () => f.root, runInCurrentBook: async <T>(op: () => Promise<T>) => op() }
  const runtime = registerFieldAssistant({ handle: (channel, handler) => handlers.set(channel, handler) }, { projects, workspace, ai, applicationAi: ai, appRoot: f.root, creativePolicy: f.provider,
    settings: {}, domains: { workspace, research: { listSources: async () => [] }, documents: { chapter: async () => ({ id: 1, title: '静态测试章', content: '', revision: 1 }) } }, writing: {}, pluginRunner: { run: async () => assert.fail('no guest tools'), dispose: async () => {} } } as never)
  t.after(() => runtime.abortForShutdown())
  const invoke = async (input: AssistantConversationRequest) => handlers.get('assistant:conversation')!(null, input) as Promise<{ ok: boolean; value?: unknown; error?: { message: string } }>
  return { ...f, runtime, invoke, completions, conversations, tasks, reads: () => reads, proseContexts: () => proseContexts, ready: () => { ready = true }, plain: () => { requestSample = false },
    beforeTool: (fn: () => Promise<void>) => { onTool = fn },
    beforePrompt: (fn: () => void) => { onPrompt = fn }, changeContract: () => { contract = 'changed' }, changeFormal: () => { constraints = 'changed' }, changeModel: () => { model = 'changed-model' } }
}

test('production main no-book help uses released defaults and application model without reading the previous book or selected package', async t => {
  const f = await runtimeFixture(t); f.plain()
  const result = await f.invoke({ ...request, workItemId: null, page: 'library' })
  assert.equal(result.ok, true); assert.equal(f.reads(), 0); assert.equal(f.proseContexts(), 0); assert.equal(f.completions.length, 0); assert.equal(f.captures(), 0)
  assert.doesNotMatch(JSON.stringify(f.conversations), /ORIGINAL_assistant-conversation|ORIGINAL_PARAMS|正式作者事实/); assert.ok(f.tasks.every(task => task === 'outline'))
})

test('production sample tool with no chapter or unconfirmed outlines sends zero prose requests', async t => {
  for (const chapterId of [null, 1]) {
    const f = await runtimeFixture(t), result = await f.invoke({ ...request, operationId: randomUUID(), chapterId })
    assert.equal(result.ok, false); assert.match(result.error!.message, /确认|审阅/); assert.equal(f.completions.length, 0); assert.equal(f.proseContexts(), 0)
    assert.ok(f.tasks.every(task => task === 'outline'), 'ordinary tool dialogue must not require the prose model before confirmation')
  }
})

test('confirmed synthetic main sample consumes the selected original asset and formal context, then capture sentinel stops before producing prose', async t => {
  const f = await runtimeFixture(t); f.ready()
  const result = await f.invoke({ ...request, chapterId: 1 })
  assert.equal(result.ok, false); assert.equal(f.completions.length, 1)
  const messages = JSON.stringify(f.completions[0].messages)
  assert.match(messages, /ORIGINAL_assistant-sample.md ORIGINAL_PARAMS/); assert.match(messages, /正式作者事实|境界：自定义|系统：\[属性\]/)
  assert.doesNotMatch(messages, /独立故事，无需章纲|新主角|周文衡/); assert.equal(f.proseContexts(), 1)
})

test('confirmed sample revalidates original chapter contract, formal source and model immediately before sending', async t => {
  for (const change of ['contract', 'formal', 'model'] as const) {
    const f = await runtimeFixture(t); f.ready(); f.beforePrompt(() => change === 'contract' ? f.changeContract() : change === 'formal' ? f.changeFormal() : f.changeModel())
    const result = await f.invoke({ ...request, chapterId: 1 })
    assert.equal(result.ok, false); assert.equal(f.completions.length, 0); assert.equal(f.proseContexts(), 1)
  }
})

test('a nested sample keeps its original selected method when current composition changes during the conversation model call', async t => {
  const f = await runtimeFixture(t); f.ready(); f.beforeTool(() => f.select([]))
  const result = await f.invoke({ ...request, chapterId: 1 })
  assert.equal(result.ok, false); assert.equal(f.completions.length, 1); assert.match(JSON.stringify(f.completions[0].messages), /ORIGINAL_assistant-sample.md ORIGINAL_PARAMS/)
})

test('withdrawal during the conversation response blocks the sample before reading prose context or sending prose', async t => {
  const f = await runtimeFixture(t); f.ready(); f.beforeTool(() => f.revoke())
  const result = await f.invoke({ ...request, chapterId: 1 })
  assert.equal(result.ok, false); assert.equal(f.completions.length, 0); assert.equal(f.proseContexts(), 0); assert.equal(f.conversations.length, 1)
})

test('sample helper without main execution authority fails before any model call', async () => {
  await assert.rejects(draftAssistantSample(request, '讨论样稿', { model: 'fixture', complete: async () => assert.fail('no prose call') } as never, '', new AbortController().signal), /作者确认依据/)
})
