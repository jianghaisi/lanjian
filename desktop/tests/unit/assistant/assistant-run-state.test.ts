import { consumeGeminiToolResponse, geminiToolBody } from '../../../src/main/modules/models/adapters/gemini-tool-conversation'
import type { ProviderToolContent } from '../../../src/contracts/models/provider-tool-content'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AssistantRunService, type AssistantRunPorts } from '../../../src/main/modules/assistant/application/runs/service'
import { decodeRunRecord, type AssistantRunRecord, type AssistantRunStorePort } from '../../../src/main/modules/assistant/application/runs/state'
import { AssistantRunStore } from '../../../src/main/modules/assistant/adapters/assistant-run-store'
import { createBuiltinRegistry } from '../../../src/main/modules/writing-plugins/adapters/builtin'
import { fieldCapabilities } from '../../../src/main/modules/writing-plugins/adapters/builtin/fields'
import { authorInteractionCapabilities } from '../../../src/main/modules/writing-plugins/adapters/builtin/author-interaction'
import { modelToolName } from '../../../src/main/modules/writing-plugins/application/registry'
import type { AssistantConversationRequest, AiToolMessage, AiToolStep } from '../../../src/contracts/assistant/assistant-conversation-contracts'
import type { AssistantRunView } from '../../../src/contracts/assistant/assistant-run-contracts'

const request: AssistantConversationRequest = { operationId: 'operation', workItemId: 'book-A', page: 'world', message: '写一个雨夜故事', targets: [], chapterId: null, selectedCharacters: 0, history: [] }
const refresh = { page: request.page, targets: [], chapterId: null, selectedCharacters: 0 }
const questions = { questions: [{ id: 'tone', prompt: '故事走向？', mode: 'single', required: true, options: [{ id: 'warm', label: '温暖', recommended: true }, { id: 'dark', label: '悬疑' }] }] }
const ask = (id = 'ask'): AiToolStep => ({ content: '', toolCalls: [{ id, type: 'function', function: { name: modelToolName('builtin.core', 'ask_author'), arguments: JSON.stringify(questions) } }] })
class MemoryStore implements AssistantRunStorePort {
  records: AssistantRunRecord[] = []; fail = false
  async read(book: string) { return structuredClone(this.records.filter(r => r.view.workItemId === book)) }
  async write(record: AssistantRunRecord) { if (this.fail) throw new Error('synthetic storage failure'); const value = decodeRunRecord(record); this.records = [structuredClone(value), ...this.records.filter(r => r.view.id !== value.view.id)] }
}
function fixture(step?: (messages: AiToolMessage[]) => Promise<AiToolStep>, store: AssistantRunStorePort = new MemoryStore()) {
  let book = 'book-A', fingerprint = 'original', model = 'original-model', calls = 0, adoption = 'pending'
  const seen: AiToolMessage[][] = []
  const ports: AssistantRunPorts = {
    async book() { return { id: book, title: '隔离作品', physicalIdentity: book + '-physical' } },
    async assertScope(scope) { assert.equal(scope, book) }, async context() { return 'original' },
    async prepare() { return { async step(messages) { calls++; seen.push(structuredClone(messages)); return step ? step(messages) : messages.some(m => m.role === 'tool') ? { content: '根据你的选择继续。', toolCalls: [] } : ask() } } },
    async startField() { throw new Error('not used') }, async cancelField() {}, async fingerprint() { return fingerprint }, async modelIdentity() { return model },
    async inspectHandoff() { return { status: adoption as 'pending' | 'adopted' } }, async candidateHandoff() { throw new Error('not used') }
  }
  const create = () => new AssistantRunService(ports, store, input => createBuiltinRegistry(ports, input), new Set([...fieldCapabilities, ...authorInteractionCapabilities]))
  const service = create()
  return { service, create, ports, store, seen, count: () => calls, book: (v: string) => { book = v }, fingerprint: (v: string) => { fingerprint = v }, model: (v: string) => { model = v }, adoption: () => { adoption = 'adopted' } }
}
async function until(service: AssistantRunService, id: string, state: string) {
  for (let i = 0; i < 300; i++) { const value = await service.status(id); if (value.status === state) return value; if (value.status === 'failed') assert.fail(value.message); await new Promise(r => setTimeout(r, 5)) }
  assert.fail('run did not reach ' + state)
}
const submission = (view: AssistantRunView) => ({ runId: view.id, questionId: view.question!.id, questionVersion: view.question!.version, answerSubmissionId: 'answer-1', answers: [{ id: 'tone', chosenOptionIds: ['warm'], customText: '', skipped: false }] })

test('provider reasoning envelopes survive durable run restart but never enter author views or Gemini requests', async () => {
  for (const providerContent of [
    { version: 1, scope: 'a'.repeat(64), protocol: 'anthropic-native', blocks: [{ type: 'thinking', thinking: 'private reasoning', signature: 'signed' }, { type: 'tool_use', id: 'ask', name: ask().toolCalls[0].function.name, input: questions }] },
    { version: 1, scope: 'b'.repeat(64), protocol: 'openai-responses', items: [{ type: 'reasoning', id: 'r1', summary: [], encrypted_content: 'ciphertext' }, { type: 'function_call', id: 'f1', call_id: 'ask', name: ask().toolCalls[0].function.name, arguments: JSON.stringify(questions) }] },
    { version: 1, scope: 'c'.repeat(64), protocol: 'openai-compatible', reasoningContent: 'private reasoning' }
  ] as ProviderToolContent[]) {
    const store = new MemoryStore(), f = fixture(async messages => {
      if (messages.some(m => m.role === 'tool')) { assert.deepEqual(messages.find(m => m.providerContent)!.providerContent, providerContent); return { content: '继续。', toolCalls: [] } }
      return { ...ask(), providerContent }
    }, store)
    const started = await f.service.start(request), waiting = await until(f.service, started.id, 'waiting-input')
    assert.doesNotMatch(JSON.stringify(waiting), /private reasoning|ciphertext|signed/)
    const saved = decodeRunRecord(JSON.parse(JSON.stringify(store.records[0])))
    assert.deepEqual(saved.messages.find(m => m.providerContent)!.providerContent, providerContent)
    assert.throws(() => geminiToolBody(saved.messages, [], {}))
    const restarted = f.create(), visible = await restarted.status(started.id)
    assert.equal(f.count(), 1)
    const resumed = await restarted.resume({ runId: started.id, expectedRevision: visible.revision, context: refresh })
    await restarted.answer(submission(resumed)); await until(restarted, started.id, 'completed'); assert.equal(f.count(), 2)
  }
})

test('question is durable before status; one submitted answer settles the original call once', async () => {
  const f = fixture(), started = await f.service.start(request), waiting = await until(f.service, started.id, 'waiting-input')
  assert.equal(waiting.step, 1); assert.equal(f.count(), 1)
  assert.equal((await f.store.read('book-A'))[0].view.question!.id, waiting.question!.id)
  assert.equal((await f.service.start(request)).id, started.id)
  const input = submission(waiting)
  const [a, b] = await Promise.all([f.service.answer(input), f.service.answer(input)])
  assert.deepEqual(a, b)
  const completed = await until(f.service, started.id, 'completed')
  assert.equal(completed.id, started.id); assert.equal(f.count(), 2)
  const answers = f.seen.at(-1)!.filter(m => m.role === 'tool')
  assert.deepEqual(f.seen.at(-1)!.flatMap(m => m.tool_calls ?? []).map(call => call.id), ['ask'], 'Draining the pending queue must preserve the original provider tool-call declaration')
  assert.equal(answers.length, 1); assert.equal(answers[0].tool_call_id, 'ask'); assert.deepEqual(JSON.parse(answers[0].content!).answers, input.answers)
  await assert.rejects(f.service.answer({ ...input, answers: [{ ...input.answers[0], chosenOptionIds: ['dark'] }] }), /另一份回答/)
})

test('restart reads are zero-write and no model is replayed until explicit restore and answer', async () => {
  const store = new MemoryStore(), f = fixture(undefined, store), start = await f.service.start(request)
  const waiting = await until(f.service, start.id, 'waiting-input'), before = JSON.stringify(store.records)
  const restored = f.create(), visible = await restored.status(start.id)
  assert.equal(visible.status, 'waiting-input'); assert.equal(visible.needsResume, true)
  assert.equal(JSON.stringify(store.records), before); assert.equal(f.count(), 1)
  await assert.rejects(restored.answer(submission(waiting)), /先恢复/)
  const resumed = await restored.resume({ runId: visible.id, expectedRevision: visible.revision, context: refresh })
  assert.equal(resumed.id, start.id); assert.equal(resumed.needsResume, false); assert.equal(f.count(), 1)
  await restored.answer(submission(resumed)); await until(restored, start.id, 'completed'); assert.equal(f.count(), 2)
})

test('scope, question version, changed sources/model and cancellation reject late answers', async () => {
  const f = fixture(), start = await f.service.start(request), waiting = await until(f.service, start.id, 'waiting-input'), input = submission(waiting)
  f.book('book-B'); await assert.rejects(f.service.answer(input), /不属于/); f.book('book-A')
  await assert.rejects(f.service.answer({ ...input, questionVersion: 2 }), /失效/)
  f.fingerprint('edited'); await assert.rejects(f.service.answer(input), /依据或模型/); f.fingerprint('original')
  f.model('changed'); await assert.rejects(f.service.answer(input), /依据或模型/); f.model('original-model')
  const cancelled = await f.service.cancel({ runId: start.id, expectedRevision: waiting.revision })
  assert.equal(cancelled.status, 'cancelled'); await assert.rejects(f.service.answer(input), /失效/); assert.equal(f.count(), 1)
})

test('failed answer persistence cannot trigger a new model request or emit an answer receipt', async () => {
  const store = new MemoryStore(), f = fixture(undefined, store), start = await f.service.start(request), waiting = await until(f.service, start.id, 'waiting-input')
  store.fail = true; await assert.rejects(f.service.answer(submission(waiting)), /storage failure/)
  assert.equal(f.count(), 1); assert.equal((await f.service.status(start.id)).status, 'waiting-input')
  store.fail = false; await f.service.answer(submission(waiting)); await until(f.service, start.id, 'completed'); assert.equal(f.count(), 2)
})

test('navigation stays in one run and appends a result to the original tool chain', async () => {
  const f = fixture(async messages => messages.some(m => m.role === 'tool') ? ask() : { content: '', toolCalls: [{ id: 'nav', type: 'function', function: { name: 'open_workspace', arguments: '{"workspaceId":"profile"}' } }] })
  const start = await f.service.start(request), waiting = await until(f.service, start.id, 'waiting-input')
  assert.equal(waiting.handoff!.result.kind, 'navigate')
  await f.service.acknowledgeHandoff({ runId: start.id, expectedRevision: waiting.revision, handoffId: waiting.handoff!.id, context: { ...refresh, page: 'profile' } })
  const next = await until(f.service, start.id, 'waiting-input')
  assert.equal(next.id, start.id); assert.ok(next.question)
  assert.equal(f.seen.at(-1)!.filter(m => m.role === 'user').length, 1)
  assert.equal(f.seen.at(-1)!.find(m => m.role === 'tool')!.tool_call_id, 'nav')
})

test('budget exhaustion is paused, explicit continue grants one segment without replay', async () => {
  const f = fixture(async messages => ({ content: '', toolCalls: [{ id: 'list-' + messages.length, type: 'function', function: { name: 'list_editable_fields', arguments: '{}' } }] }))
  const start = await f.service.start(request), paused = await until(f.service, start.id, 'paused-limit')
  assert.equal(f.count(), 24); assert.equal(paused.result, undefined)
  await f.service.resume({ runId: start.id, expectedRevision: paused.revision, context: refresh })
  const second = await until(f.service, start.id, 'paused-limit'); assert.equal(second.step, 48); assert.equal(f.count(), 48)
})

test('in-flight tool interruption never replays uncertain side effects', async () => {
  let release!: () => void
  const hold = new Promise<void>(r => { release = r }), store = new MemoryStore()
  const f = fixture(async () => { await hold; return ask() }, store)
  const start = await f.service.start(request)
  for (let i = 0; i < 100 && store.records[0].intent !== 'model'; i++) await new Promise(r => setTimeout(r, 5))
  const restored = f.create(), visible = await restored.status(start.id)
  assert.equal(visible.status, 'interrupted'); assert.equal(visible.needsResume, true)
  await assert.rejects(restored.resume({ runId: start.id, expectedRevision: visible.revision, context: refresh }), /不能重复/)
  f.service.abortForShutdown(); release(); await new Promise(r => setTimeout(r, 10)); assert.equal(f.count(), 1)
})

test('file store survives recreation and preserves malformed bytes with a visible error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'assistant-run-store-'))
  try {
    const store = new AssistantRunStore(root), f = fixture(undefined, store), start = await f.service.start(request)
    await until(f.service, start.id, 'waiting-input')
    const before = await new AssistantRunStore(root).read('book-A'); assert.equal(before[0].view.id, start.id)
    const partition = (await readdir(join(root, 'assistant-runs')))[0], file = join(root, 'assistant-runs', partition, 'runs.json')
    await writeFile(file, '{malformed'); await assert.rejects(store.read('book-A'), /原文件已保留/); assert.equal(await readFile(file, 'utf8'), '{malformed')
  } finally { await rm(root, { recursive: true, force: true }) }
})


test('candidate review waits for actual domain adoption, never a renderer preference', async () => {
  const f = fixture(async messages => messages.some(m => m.role === 'tool') ? { content: '已核对采用结果。', toolCalls: [] } : { content: '', toolCalls: [{ id: 'review', type: 'function', function: { name: modelToolName('builtin.core', 'request_candidate_review'), arguments: JSON.stringify({ candidateRef: { kind: 'field-task', id: 'existing-task' } }) } }] })
  f.ports.candidateHandoff = async () => ({ kind: 'field', message: '请核对候选', tools: [], task: { id: 'existing-task', status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), target: { fieldId: 'definition.bookProfile.coreIdea', instanceId: 'field', editorSessionId: 'editor', workItemId: 'book-A', pageId: 'profile', label: '核心设想', revision: 1, value: '旧设想' } } })
  const start = await f.service.start(request), waiting = await until(f.service, start.id, 'waiting-adoption')
  const ack = { runId: start.id, expectedRevision: waiting.revision, handoffId: waiting.handoff!.id, context: refresh }
  assert.equal((await f.service.acknowledgeHandoff(ack)).status, 'waiting-adoption'); assert.equal(f.count(), 1)
  await assert.rejects(f.service.answer({ runId: start.id, questionId: 'forged', questionVersion: 1, answerSubmissionId: 'preference', answers: [] }), /失效/)
  f.adoption(); await f.service.acknowledgeHandoff(ack); await until(f.service, start.id, 'completed')
  assert.deepEqual(JSON.parse(f.seen.at(-1)!.find(m => m.role === 'tool')!.content!), { decision: 'adopted' })
})

test('explicit stop interrupts a busy run even when progress advanced after the UI snapshot', async () => {
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  const f = fixture(async () => { await hold; return ask() }), start = await f.service.start(request)
  const cancelled = await f.service.cancel({ runId: start.id, expectedRevision: start.revision })
  assert.equal(cancelled.status, 'cancelled'); release(); await new Promise(resolve => setTimeout(resolve, 15))
  assert.equal((await f.service.status(start.id)).status, 'cancelled')
})

test('pending prose handoff refuses a changed unsaved draft before creating a domain task', async () => {
  const f = fixture(async () => ({ content: '', toolCalls: [{ id: 'prose', type: 'function', function: { name: 'manuscript_assistant', arguments: '{"instruction":"润色当前选段"}' } }] }))
  const input = { ...request, page: 'chapters', chapterId: 1, editorFingerprint: 'a'.repeat(64) }
  const start = await f.service.start(input), waiting = await until(f.service, start.id, 'waiting-adoption')
  assert.equal(waiting.editorFingerprint, input.editorFingerprint)
  const ack = { runId: start.id, expectedRevision: waiting.revision, handoffId: waiting.handoff!.id, context: { ...refresh, page: 'chapters', chapterId: 1, editorFingerprint: 'b'.repeat(64) } }
  await assert.rejects(f.service.acknowledgeHandoff(ack), /草稿已变化/)
  assert.equal((await f.service.status(start.id)).status, 'waiting-adoption'); assert.equal(f.count(), 1)
  assert.equal((await f.service.acknowledgeHandoff({ ...ack, context: { ...ack.context, editorFingerprint: input.editorFingerprint } })).status, 'waiting-adoption')
})

test('a status read overlapping durable wait publication does not invent an interruption', async () => {
  let releaseModel!: () => void, releaseRead!: () => void, readStarted!: () => void
  const modelHold = new Promise<void>(resolve => { releaseModel = resolve })
  const readHold = new Promise<void>(resolve => { releaseRead = resolve })
  const captured = new Promise<void>(resolve => { readStarted = resolve })
  const store = new MemoryStore(), read = store.read.bind(store)
  let delay = false
  store.read = async book => { const snapshot = await read(book); if (delay) { delay = false; readStarted(); await readHold }; return snapshot }
  const f = fixture(async () => { await modelHold; return ask() }, store), start = await f.service.start(request)
  delay = true
  const status = f.service.status(start.id)
  await captured; releaseModel()
  for (let i = 0; i < 100 && store.records[0].view.status !== 'waiting-input'; i++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(store.records[0].view.status, 'waiting-input')
  await new Promise(resolve => setTimeout(resolve, 5)); releaseRead()
  assert.equal((await status).status, 'waiting-input')
})

test('tool call budget pauses before the next invocation and retains pending calls for explicit resume', async () => {
  const f = fixture(async messages => ({ content: '', toolCalls: Array.from({ length: 8 }, (_, index) => ({ id: `list-${messages.length}-${index}`, type: 'function', function: { name: 'discover_tools', arguments: '{"query":"nonexistent-test-tool"}' } })) }))
  const start = await f.service.start(request), paused = await until(f.service, start.id, 'paused-limit')
  const record = (await f.store.read('book-A'))[0]
  assert.equal(record.dispatcher.budget.calls, 96); assert.equal(record.intent, 'idle'); assert.equal(record.pending.length, 8)
  await f.service.resume({ runId: start.id, expectedRevision: paused.revision, context: refresh })
  await until(f.service, start.id, 'paused-limit')
  assert.equal((await f.store.read('book-A'))[0].messages.filter(m => m.role === 'tool').length, 192)
})

test('persisted waiting calls cannot lose their declaration or invent another question binding', async () => {
  const f = fixture(), start = await f.service.start(request)
  await until(f.service, start.id, 'waiting-input')
  const [record] = await f.store.read('book-A')
  assert.doesNotThrow(() => decodeRunRecord(record))
  const missing = structuredClone(record)
  missing.messages.find(message => message.tool_calls)!.tool_calls = []
  assert.throws(() => decodeRunRecord(missing))
  const mismatched = structuredClone(record)
  mismatched.view.question!.toolCallId = 'another-call'
  assert.throws(() => decodeRunRecord(mismatched))
})


test('streaming projection is scoped and transient, while only the finished reply is persisted',async()=>{
  const f=fixture(),store=f.store as MemoryStore
  let publish!: (content:string)=>void,finish!:()=>void
  f.ports.prepare=async()=>({async step(_messages,_tools,_signal,onDelta){publish=onDelta!;await new Promise<void>(done=>finish=done);return {content:'最终回复',toolCalls:[]}}})
  const started=await f.service.start({...request,operationId:'stream'})
  for(let i=0;!publish&&i<100;i++)await new Promise(r=>setTimeout(r,5))
  publish('先读这一段');assert.equal((await f.service.status(started.id)).partial,'先读这一段')
  assert.equal(store.records[0].view.partial,undefined);assert.equal(store.records[0].view.result,undefined)
  f.book('book-B');await assert.rejects(f.service.status(started.id));f.book('book-A')
  finish();const done=await until(f.service,started.id,'completed');assert.equal(done.partial,undefined);assert.equal(done.result?.message,'最终回复');assert.equal(store.records[0].view.partial,undefined)
})


test('native signatures survive strict durable run decoding and explicit restart recovery without entering views', async () => {
  const nativeParts = [{ text: '', thoughtSignature: 'text-signature' }, { functionCall: { name: modelToolName('builtin.core', 'ask_author'), args: questions, id: 'native/original-id' }, thoughtSignature: 'call-signature' }]
  const store = new MemoryStore()
  const f = fixture(async messages => {
    if (messages.some(m => m.role === 'tool')) {
      const body = geminiToolBody(messages, [], {}), model = body.contents.find(c => c.role === 'model')
      assert.deepEqual(model!.parts, nativeParts)
      const result = body.contents.at(-1)!.parts[0] as { functionResponse: { id: string } }
      assert.equal(result.functionResponse.id, 'native/original-id')
      return { content: '继续原任务。', toolCalls: [] }
    }
    return consumeGeminiToolResponse(new Response(JSON.stringify({ candidates: [{ content: { parts: nativeParts }, finishReason: 'STOP' }] }), { headers: { 'content-type': 'application/json' } }), new AbortController().signal)
  }, store)
  const started = await f.service.start(request), waiting = await until(f.service, started.id, 'waiting-input')
  assert.ok(!JSON.stringify(waiting).includes('signature'))
  const saved = decodeRunRecord(JSON.parse(JSON.stringify(store.records[0])))
  assert.deepEqual(saved.messages.find(m => m.geminiParts)!.geminiParts, nativeParts)
  const bad = structuredClone(saved); bad.messages.find(m => m.geminiParts)!.geminiParts![1].functionCall!.name = 'different'
  assert.throws(() => decodeRunRecord(bad))
  const restored = f.create(), visible = await restored.status(started.id)
  assert.equal(f.count(), 1); assert.ok(visible.needsResume)
  const resumed = await restored.resume({ runId: started.id, expectedRevision: visible.revision, context: refresh })
  await restored.answer(submission(resumed))
  await until(restored, started.id, 'completed'); assert.equal(f.count(), 2)
})
