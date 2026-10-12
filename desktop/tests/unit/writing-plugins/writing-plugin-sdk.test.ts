import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import JSZip from 'jszip'
import type { JsonValue, PluginManifest } from '@lanjian/writing-plugin-contracts'
import { WritingPluginManager } from '../../../src/main/modules/writing-plugins/application/plugin-manager'
import { PluginPackageStore } from '../../../src/main/modules/writing-plugins/adapters/package-store'
import { registerInstalledTools, installedPluginCapabilities } from '../../../src/main/modules/writing-plugins/adapters/installed-tools'
import { WritingPluginRegistry, modelToolName } from '../../../src/main/modules/writing-plugins/application/registry'
import { WritingPluginDispatcher } from '../../../src/main/modules/writing-plugins/application/dispatcher'
import { DurablePluginEffects } from '../../../src/main/modules/writing-plugins/application/effect-journal'
import { decodePluginRunState, type PluginEffectReceipt, type PluginVersionPin } from '../../../src/main/modules/writing-plugins/domain/plugin-run'
import type { GuestRunner } from '../../../src/main/modules/writing-plugins/domain/guest'
import { executeGuest } from '../../../src/main/modules/writing-plugins/runtime/guest-engine'
import { builtinTool } from '../../../src/main/modules/writing-plugins/adapters/builtin/fields'
import { objectSchema, textSchema } from '../../../src/main/modules/writing-plugins/domain/schema'
import { AssistantRunService, type AssistantRunPorts } from '../../../src/main/modules/assistant/application/runs/service'
import { AssistantRunStore } from '../../../src/main/modules/assistant/adapters/assistant-run-store'
import type { AssistantConversationRequest } from '../../../src/contracts/assistant/assistant-conversation-contracts'
import type { AssistantRunView } from '../../../src/contracts/assistant/assistant-run-contracts'

const wasm = readFile(createRequire(import.meta.url).resolve('@jitl/quickjs-wasmfile-release-sync/wasm')).then(b => new Uint8Array(b).buffer)
const detached = new AsyncResource('detached-plugin-worker')
const runner: GuestRunner = { async run(invocation, broker, signal) { const bytes = await wasm; return detached.runInAsyncScope(() => executeGuest(invocation, bytes, broker, signal, { sliceMs: 1000, invocationMs: 5000 })) }, async dispose() {} }
const id = 'author.rhythm', toolName = modelToolName(id, 'analyze'), scope = new AsyncLocalStorage<string>()
const question = { questions: [{ id: 'tone', prompt: '选择方向', mode: 'single', required: true, options: [{ id: 'warm', label: '温暖' }, { id: 'dark', label: '悬疑' }] }] }
const schema = objectSchema({ text: textSchema(10000) })
async function fixture(t: TestContext, revoke: (id: string, book?: string) => Promise<void> = async () => {}) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-sdk-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const manager = new WritingPluginManager(new PluginPackageStore(root), revoke)
  async function install(source: string, caps: string[] = [], overrides: Partial<PluginManifest> = {}) {
    const manifest: PluginManifest = { apiVersion: 1, id, name: '节奏插件', description: '节奏分析', version: '1.0.0', runtime: 'quickjs-js', entry: 'main.js', capabilities: caps, assets: ['notes.txt'], tools: [{ id: 'analyze', description: '分析节奏并询问作者', effect: caps.includes('planning.candidate') ? 'candidate' : 'derive', capabilities: caps, inputSchema: objectSchema({}), outputSchema: schema }], ...overrides }
    const path = join(root, `${manifest.version}.zip`)
    await writeFile(path, await new JSZip().file('lanjian-plugin.json', JSON.stringify(manifest)).file('main.js', source).file('notes.txt', '节奏资料').generateAsync({ type: 'nodebuffer' }))
    let index = await manager.install((await manager.preview(manager.chooseNativeFile(path))).planId)
    const current = index.plugins[0].versions.find(v => v.manifest.version === manifest.version)!
    index = await manager.selectVersion(id, current.digest, caps, index.revision)
    index = await manager.setEnabled(id, true, caps, index.revision)
    await manager.setBookEnabled('book-a', id, true, index.revision)
    return { id, version: manifest.version, digest: current.digest, grants: caps } satisfies PluginVersionPin
  }
  async function dispatcher(pin: PluginVersionPin, configure: (registry: WritingPluginRegistry) => void = () => {}, generate: () => Promise<string> = async () => '模型建议', records: PluginEffectReceipt[] = [], saved: PluginEffectReceipt[][] = []) {
    return scope.run('book-a', async () => {
      const registry = new WritingPluginRegistry(), captured = AsyncLocalStorage.snapshot()
      configure(registry)
      await registerInstalledTools(registry, 'book-a', [pin], new DurablePluginEffects(records, async () => { saved.push(structuredClone(records)) }), { manager, runner, scope: action => captured(action), generate })
      const result = new WritingPluginDispatcher(registry, { workItemId: 'book-a', signal: new AbortController().signal, allowedCapabilities: new Set(installedPluginCapabilities), async assertScope() { assert.equal(scope.getStore(), 'book-a') } })
      await result.execute('discover_tools', JSON.stringify({ query: id }))
      return { dispatcher: result, run: () => captured(() => result.execute(toolName, '{}', 'invocation-1')), resume: (checkpoint: Record<string, JsonValue>) => captured(() => result.resume(toolName, '{}', checkpoint, { choice: 'warm' }, 'invocation-1')) }
    })
  }
  return { root, manager, install, dispatcher }
}

test('installed guest discovers SDK tools and re-enters the original book for detached RPC', async t => {
  const f = await fixture(t)
  const pin = await f.install(`export async function execute(id,input,ctx){
    const book=await ctx.book.read({kind:'context'}), asset=await ctx.assets.readText({path:'notes.txt'});
    const suggestion=await ctx.model.generate({instruction:book.context+asset.text}); return {text:suggestion.text};
  }`, ['book.read', 'assets.read', 'model.generate'])
  let calls = 0
  const d = await f.dispatcher(pin, registry => registry.register(builtinTool('read_book_context', '作品资料', 'read', ['book.read'], objectSchema({}), objectSchema({ context: textSchema(100) }), async () => {
    assert.equal(scope.getStore(), 'book-a')
    return { kind: 'completed', value: { context: '本书境界与系统模板' }, evidence: [{ kind: 'book-context', id: 'saved-writing-context', revision: 'revision-a' }] }
  }), 'builtin'), async () => { assert.equal(scope.getStore(), 'book-a'); calls++; return '当前书模型建议' })
  const result = await scope.run('book-b', () => d.run())
  assert.equal(result.kind, 'completed')
  if (result.kind === 'completed') { assert.deepEqual(result.value, { text: '当前书模型建议' }); assert.equal(result.evidence[0].revision, 'revision-a') }
  assert.equal(calls, 1); assert.equal(d.dispatcher.budget.snapshot().steps, 1)
  assert.ok(d.dispatcher.budget.snapshot().calls >= 5)
})

test('guest cannot supply another book, provider credentials, asset path or undeclared capability', async t => {
  const f = await fixture(t)
  const pin = await f.install(`export async function execute(id,input,ctx){ let rejected=0;
    for(const call of [()=>ctx.book.read({kind:'context',workItemId:'book-b'}),()=>ctx.model.generate({instruction:'写作',apiKey:'fake'}),()=>ctx.assets.readText({path:'../book.md'}),()=>ctx.candidate.prepare({kind:'planning',key:'x',input:{}})]){try{await call()}catch{rejected++}}
    return {text:String(rejected)};
  }`, ['book.read', 'model.generate', 'assets.read'])
  const d = await f.dispatcher(pin, undefined, async () => assert.fail('invalid model call must never dispatch'))
  const result = await d.run(); assert.equal(result.kind, 'completed')
  if (result.kind === 'completed') assert.deepEqual(result.value, { text: '4' })
  await assert.rejects(registerInstalledTools(new WritingPluginRegistry(), 'book-b', [pin], new DurablePluginEffects([], async () => {}), { manager: f.manager, runner, scope: a => a(), async generate() { return '' } }), { code: 'CONFLICT' })
})

test('candidate receipts survive fresh VM resume and cannot be rebound to different parameters', async t => {
  const f = await fixture(t), records: PluginEffectReceipt[] = [], saves: PluginEffectReceipt[][] = []
  const pin = await f.install(`export async function execute(id,input,ctx){
    const receipt=await ctx.candidate.prepare({kind:'planning',key:'first',input:{}});
    await ctx.interaction.request({question:${JSON.stringify(question)},checkpoint:{task:receipt.taskId}}); return {};
  }
  export async function resume(id,checkpoint,answer,ctx){const receipt=await ctx.candidate.prepare({kind:'planning',key:'first',input:{}}); return {text:receipt.taskId};}`, ['planning.candidate', 'author.ask'])
  let candidates = 0
  const configure = (registry: WritingPluginRegistry) => registry.register(builtinTool('generate_planning', '启动候选', 'candidate', ['planning.candidate'], objectSchema({}), objectSchema({ taskId: textSchema(100) }), async (_input, host) => {
    assert.equal(saves[0][0].status, 'intent'); assert.match(host.invocationId!, /^[a-f0-9-]{36}$/)
    candidates++; return { kind: 'completed', value: { taskId: 'real-domain-task' }, evidence: [] }
  }), 'builtin')
  const d = await f.dispatcher(pin, configure, undefined, records, saves), waiting = await d.run()
  assert.equal(waiting.kind, 'waiting-input'); assert.equal(candidates, 1)
  if (waiting.kind !== 'waiting-input') return
  const next = await f.dispatcher(pin, configure, undefined, records, saves)
  const result = await next.resume(waiting.checkpoint!)
  assert.equal(result.kind, 'completed'); if (result.kind === 'completed') assert.deepEqual(result.value, { text: 'real-domain-task' })
  assert.equal(candidates, 1); assert.equal(records[0].status, 'completed')
  await assert.rejects(new DurablePluginEffects(records, async () => {}).once(records[0].key, { changed: true }, async () => assert.fail()), { code: 'CONFLICT' })
})

test('durable candidate intent prevents replay after unknown effects and failed receipt persistence', async () => {
  const records: PluginEffectReceipt[] = []; let writes = 0, effects = 0
  const journal = new DurablePluginEffects(records, async () => { if (++writes === 2) throw Error('disk failed') })
  await assert.rejects(journal.once('a'.repeat(64), {}, async () => { effects++; return { taskId: 'task' } }), /disk failed/)
  assert.equal(records[0].status, 'intent')
  await assert.rejects(new DurablePluginEffects(structuredClone(records), async () => {}).once('a'.repeat(64), {}, async () => { effects++; return {} }), { code: 'CONFLICT' })
  assert.equal(effects, 1)
  const empty: PluginEffectReceipt[] = []
  await assert.rejects(new DurablePluginEffects(empty, async () => { throw Error('disk failed') }).once('b'.repeat(64), {}, async () => assert.fail()), /disk failed/)
  assert.equal(empty.length, 0)
  assert.throws(() => decodePluginRunState({ pins: [], effects: [{ key: 'a'.repeat(64), requestHash: 'b'.repeat(64), status: 'completed' }] }))
})

const request: AssistantConversationRequest = { operationId: 'operation-a', workItemId: 'book-a', page: 'world', message: '按插件写作', targets: [], chapterId: null, selectedCharacters: 0, history: [] }
const refresh = { page: 'world', targets: [], chapterId: null, selectedCharacters: 0 }
const answer = (view: AssistantRunView, id = 'answer-1') => ({ runId: view.id, questionId: view.question!.id, questionVersion: view.question!.version, answerSubmissionId: id, answers: [{ id: 'tone', chosenOptionIds: ['warm'], customText: '', skipped: false }] })
async function until(service: AssistantRunService, id: string, status: string) {
  for (let i = 0; i < 500; i++) { const view = await service.status(id); if (view.status === status) return view; if (view.status === 'failed') assert.fail(view.message); await new Promise(r => setTimeout(r, 5)) }
  assert.fail('run did not reach ' + status)
}
async function runFixture(t: TestContext, configure: (registry: WritingPluginRegistry) => void = () => {}, generate: (signal: AbortSignal) => Promise<string> = async () => '') {
  let service: AssistantRunService, book = 'book-a', modelCalls = 0
  const f = await fixture(t, (id, book) => service.revokePlugin(id, book)), store = new AssistantRunStore(f.root)
  const ports: AssistantRunPorts = {
    async book() { return { id: book, title: '隔离作品', physicalIdentity: book + '-physical' } },
    async assertScope(id) { assert.equal(id, book) }, async context() { return '' }, async fingerprint() { return 'fixed' }, async modelIdentity() { return 'fixed' },
    async startField() { assert.fail() }, async cancelField() {}, async inspectHandoff() { assert.fail() }, async candidateHandoff() { assert.fail() },
    async capturePlugins(book) { return (await f.manager.capture(book)).map(v => ({ id, version: v.manifest.version, digest: v.digest, grants: v.grants })) },
    async assertPlugins(book, pins) { for (const pin of pins) await f.manager.authorize(book, pin.id, pin.digest) },
    async prepare() { return { async step(messages) {
      modelCalls++
      if (messages.some(m => m.role === 'tool' && m.tool_call_id === 'plugin-call')) return { content: '已根据回答完成', toolCalls: [] }
      const discovered = messages.some(m => m.role === 'tool')
      return { content: '', toolCalls: [{ id: discovered ? 'plugin-call' : 'discover', type: 'function', function: { name: discovered ? toolName : 'discover_tools', arguments: discovered ? '{}' : JSON.stringify({ query: id }) } }] }
    } } }
  }
  const create = () => service = new AssistantRunService(ports, store, async (_input, pins, journal) => {
    const registry = new WritingPluginRegistry(); configure(registry)
    await registerInstalledTools(registry, book, pins, journal, { manager: f.manager, runner, scope: a => a(), generate: (_instruction, _draft, signal) => generate(signal) })
    return registry
  }, new Set(installedPluginCapabilities))
  create()
  return { ...f, store, create, service: () => service, calls: () => modelCalls, book: (next: string) => { book = next } }
}
const waitingSource = `export async function execute(id,input,ctx){await ctx.interaction.request({question:${JSON.stringify(question)},checkpoint:{round:1}});return {}}
  export async function resume(id,checkpoint,answer,ctx){if(checkpoint.round===1){await ctx.interaction.request({question:${JSON.stringify(question)},checkpoint:{round:2}});return {}} return {text:'original-v1:'+answer.answers[0].chosenOptionIds[0]};}`

test('author answers resume the pinned guest after restart/update, repeated waits settle one original tool call', async t => {
  const f = await runFixture(t); const pin = await f.install(waitingSource, ['author.ask'])
  const start = await f.service().start(request), waiting = await until(f.service(), start.id, 'waiting-input')
  assert.equal(f.calls(), 2)
  await f.install('export function execute(){throw Error("new version must not replace old run")}', ['author.ask'], { version: '2.0.0' })
  f.service().abortForShutdown(); const restarted = f.create(), restored = await restarted.status(start.id)
  assert.equal(restored.needsResume, true)
  await restarted.resume({ runId: start.id, expectedRevision: restored.revision, context: refresh })
  const submitted = answer(waiting)
  const [first, duplicate] = await Promise.all([restarted.answer(submitted), restarted.answer(submitted)])
  assert.deepEqual(first, duplicate)
  const second = await until(restarted, start.id, 'waiting-input')
  assert.notEqual(second.question!.id, waiting.question!.id); assert.equal(f.calls(), 2)
  await restarted.answer(answer(second, 'answer-2')); await until(restarted, start.id, 'completed')
  const record = (await f.store.read('book-a'))[0]
  assert.equal(record.plugins!.pins[0].digest, pin.digest)
  const results = record.messages.filter(m => m.role === 'tool' && m.tool_call_id === 'plugin-call')
  assert.equal(results.length, 1); assert.match(results[0].content!, /original-v1:warm/)
  assert.equal(record.receipts.length, 2); assert.equal(record.waitingCall, undefined); assert.equal(f.calls(), 3)
})

test('revoking one book invalidates its persisted question across restart without cancelling another book', async t => {
  const f = await runFixture(t); await f.install(waitingSource, ['author.ask'])
  const a = await f.service().start(request), waitingA = await until(f.service(), a.id, 'waiting-input')
  f.book('book-b')
  await f.manager.setBookEnabled('book-b', id, true, (await f.manager.list()).revision)
  const b = await f.service().start({ ...request, workItemId: 'book-b', operationId: 'operation-b' })
  await until(f.service(), b.id, 'waiting-input')
  f.service().abortForShutdown(); f.create()
  await f.manager.setBookEnabled('book-a', id, false, (await f.manager.list()).revision)
  assert.equal((await f.store.read('book-a'))[0].view.status, 'cancelled')
  assert.equal((await f.service().status(b.id)).status, 'waiting-input')
  f.book('book-a'); await assert.rejects(f.service().answer(answer(waitingA)))
})

test('tampered waiting plugin cancels its run during explicit restore without a revocation deadlock', { timeout: 5000 }, async t => {
  const f = await runFixture(t); const pin = await f.install(waitingSource, ['author.ask'])
  const start = await f.service().start(request); await until(f.service(), start.id, 'waiting-input')
  f.service().abortForShutdown(); const restarted = f.create(), view = await restarted.status(start.id)
  await writeFile(join(f.root, 'plugin-packages', id, `${pin.version}-${pin.digest}`, 'main.js'), 'tampered')
  await assert.rejects(restarted.resume({ runId: start.id, expectedRevision: view.revision, context: refresh }))
  assert.equal((await f.store.read('book-a'))[0].view.status, 'cancelled')
})

test('parent run persists candidate effect receipts and reuses them after author answers', async t => {
  let candidates = 0
  const f = await runFixture(t, registry => registry.register(builtinTool('generate_planning', '启动候选', 'candidate', ['planning.candidate'], objectSchema({}), objectSchema({ taskId: textSchema(100) }), async () => {
    const before = (await f.store.read('book-a'))[0]
    assert.equal(before.intent, 'tool'); assert.equal(before.plugins!.effects[0].status, 'intent')
    candidates++; return { kind: 'completed', value: { taskId: 'task-1' }, evidence: [] }
  }), 'builtin'))
  await f.install(`export async function execute(id,input,ctx){await ctx.candidate.prepare({kind:'planning',key:'one',input:{}});await ctx.interaction.request({question:${JSON.stringify(question)},checkpoint:{step:1}});return {}}
    export async function resume(id,checkpoint,answer,ctx){const task=await ctx.candidate.prepare({kind:'planning',key:'one',input:{}});return {text:task.taskId}}`, ['planning.candidate', 'author.ask'])
  const start = await f.service().start(request), waiting = await until(f.service(), start.id, 'waiting-input')
  assert.equal((await f.store.read('book-a'))[0].plugins!.effects[0].status, 'completed')
  f.service().abortForShutdown(); const restarted = f.create(), view = await restarted.status(start.id)
  await restarted.resume({ runId: start.id, expectedRevision: view.revision, context: refresh })
  await restarted.answer(answer(waiting)); await until(restarted, start.id, 'completed')
  assert.equal(candidates, 1)
})

test('disabling an active plugin aborts the model SDK and discards its late result', async t => {
  let release!: (text: string) => void, signal: AbortSignal | undefined, entered!: () => void
  const began = new Promise<void>(resolve => { entered = resolve })
  const f = await runFixture(t, undefined, async current => { signal = current; entered(); return new Promise(resolve => { release = resolve }) })
  await f.install('export async function execute(id,input,ctx){const result=await ctx.model.generate({instruction:"写作"});return {text:result.text}}', ['model.generate'])
  const start = await f.service().start(request); await began
  await f.manager.setEnabled(id, false, [], (await f.manager.list()).revision)
  assert.equal(signal!.aborted, true); assert.equal((await f.service().status(start.id)).status, 'cancelled')
  release('迟到的内容'); await new Promise(resolve => setTimeout(resolve, 25))
  const record = (await f.store.read('book-a'))[0]
  assert.equal(record.view.status, 'cancelled'); assert.equal(JSON.stringify(record).includes('迟到的内容'), false)
})

test('SDK model steps share the parent budget even when guest catches limit errors', async t => {
  const f = await fixture(t); let generated = 0
  const pin = await f.install(`export async function execute(id,input,ctx){let accepted=0;for(let i=0;i<30;i++){try{await ctx.model.generate({instruction:'推导'});accepted++}catch{}}return {text:String(accepted)}}`, ['model.generate'])
  const d = await f.dispatcher(pin, undefined, async () => { generated++; return '建议' })
  d.dispatcher.budget.modelStep() // The parent already spent one model round selecting this tool.
  const result = await d.run(); assert.equal(result.kind, 'completed')
  assert.equal(generated, 23); assert.equal(d.dispatcher.budget.snapshot().steps, 24)
})

test('plugin membership accepts real canonical book identities without exposing them to guest inputs', async t => {
  const f = await fixture(t); await f.install('export function execute(){return {text:"ok"}}')
  const bookId = join(f.root, '作品目录', '雨夜旧案')
  await f.manager.setBookEnabled(bookId, id, true, (await f.manager.list()).revision)
  assert.equal((await f.manager.capture(bookId)).length, 1)
  await assert.rejects(f.manager.setBookEnabled('bad\u0000book', id, true, (await f.manager.list()).revision))
})

test('an answer persisted before shutdown resumes explicitly without replaying execute', async t => {
  const f = await runFixture(t); await f.install(waitingSource, ['author.ask'])
  const start = await f.service().start(request), waiting = await until(f.service(), start.id, 'waiting-input')
  f.service().abortForShutdown()
  await f.service().answer(answer(waiting)) // Accepted durably; shutdown prevents launch.
  const stored = (await f.store.read('book-a'))[0]
  assert.equal(stored.intent, 'idle'); assert.ok(stored.guestAnswer); assert.equal(stored.view.question, undefined)
  const restarted = f.create(), interrupted = await restarted.status(start.id)
  assert.equal(interrupted.status, 'interrupted'); assert.equal(f.calls(), 2)
  await restarted.resume({ runId: start.id, expectedRevision: interrupted.revision, context: refresh })
  const next = await until(restarted, start.id, 'waiting-input')
  assert.equal((await f.store.read('book-a'))[0].checkpoint!.round, 2)
  await restarted.answer(answer(next, 'answer-2')); await until(restarted, start.id, 'completed')
  assert.equal(f.calls(), 3)
})

test('revocation racing with answer session construction cannot republish a cancelled run', async t => {
  const f = await runFixture(t); await f.install(waitingSource, ['author.ask'])
  const start = await f.service().start(request), waiting = await until(f.service(), start.id, 'waiting-input')
  let entered!: () => void, release!: () => void
  const began = new Promise<void>(resolve => { entered = resolve }), hold = new Promise<void>(resolve => { release = resolve })
  const load = f.manager.loadAuthorized.bind(f.manager)
  f.manager.loadAuthorized = async (...args) => { const result = await load(...args); entered(); await hold; return result }
  const submission = f.service().answer(answer(waiting)); void submission.catch(() => {})
  await began
  await f.manager.setEnabled(id, false, [], (await f.manager.list()).revision)
  release(); await assert.rejects(submission)
  assert.equal((await f.store.read('book-a'))[0].view.status, 'cancelled')
})
