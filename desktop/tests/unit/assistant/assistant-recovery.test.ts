import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer, nextTick } from 'vue'
import { useFieldAssistant } from '../../../src/renderer/features/assistant/composables/use-field-assistant'
import { updateFieldScope } from '../../../src/renderer/features/assistant/services/assistant-field-registry'
import type { AssistantRunView } from '../../../src/contracts/assistant/assistant-run-contracts'
import type { AuthorAnswerReceipt, AuthorAnswerSubmission, AuthorQuestionCard } from '../../../src/contracts/assistant/author-interaction-contracts'
import type { FieldAssistantApi } from '../../../src/contracts/assistant/field-assistant-contracts'

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const record = (overrides: Partial<AssistantRunView> = {}): AssistantRunView => ({ id: 'run-a', operationId: 'op-a', workItemId: 'recovery-A', bookTitle: '作品A', page: 'profile', goal: '讨论人物', status: 'running', revision: 1, step: 1, message: '正在回复', tools: [], createdAt: '', updatedAt: '', needsResume: false, ...overrides })
const question: AuthorQuestionCard = { id: 'question', version: 1, toolCallId: 'call-a', pluginId: 'builtin.core', toolId: 'ask', questions: [{ id: 'note', prompt: '人物想要什么？', mode: 'text', required: true, options: [] }] }
const answers = () => [{ id: 'note', chosenOptionIds: [], customText: '寻找旧物的主人', skipped: false }]
async function fixture() {
  updateFieldScope('recovery-A', 'profile', '作品定义')
  let status = async () => record(), cancel = async () => record({ status: 'cancelled' })
  let answer = async (input: AuthorAnswerSubmission): Promise<AuthorAnswerReceipt> => ({ runId: input.runId, questionId: input.questionId, answerSubmissionId: input.answerSubmissionId, acceptedAt: new Date().toISOString() })
  const calls = { start: 0, resume: 0, answer: 0, cancel: 0, handoff: 0, inputs: [] as string[] }
  const api = { recent: async () => [], runs: { recent: async () => [], status: () => status(),
    start: async (input: { message: string }) => { calls.start++; calls.inputs.push(input.message); return record({ status: 'completed', result: { kind: 'message', message: '已回复', tools: [] } }) },
    cancel: async () => { calls.cancel++; return cancel() }, resume: async () => { calls.resume++; return record() }, answer: async (input: AuthorAnswerSubmission) => { calls.answer++; return answer(input) },
    acknowledgeHandoff: async () => { calls.handoff++; return record({ status: 'completed' }) }
  } } as unknown as FieldAssistantApi
  let assistant!: ReturnType<typeof useFieldAssistant>
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null } as any)
  const app = renderer.createApp({ setup() { assistant = useFieldAssistant(api, { page: () => 'profile', chapterId: () => null, selectedCharacters: () => 0, proseSnapshot: () => '', requiresPreview: () => false, async prose() {} }); return () => null } })
  app.mount({}); await assistant.memory.ready(); await nextTick()
  return { assistant, app, calls, answer: (fn: typeof answer) => { answer = fn }, status: (fn: () => Promise<AssistantRunView>) => { status = fn }, cancel: (fn: () => Promise<AssistantRunView>) => { cancel = fn } }
}
async function switchBook(f: Awaited<ReturnType<typeof fixture>>) {
  updateFieldScope('recovery-B', 'profile', '作品定义'); await nextTick(); await f.assistant.memory.ready()
  f.assistant.instruction.value = '作品B未发送的要求'
  f.assistant.run.value = record({ id: 'run-b', workItemId: 'recovery-B' }); f.assistant.busy.value = true; f.assistant.progressText.value = '作品B正在回复'
}
function assertBookB(f: Awaited<ReturnType<typeof fixture>>) {
  assert.equal(f.assistant.instruction.value, '作品B未发送的要求'); assert.equal(f.assistant.run.value?.id, 'run-b'); assert.equal(f.assistant.busy.value, true); assert.equal(f.assistant.progressText.value, '作品B正在回复'); assert.equal(f.assistant.error.value, '')
}

test('sending clears only the captured draft; typing during fingerprint preparation survives', async t => {
  const f = await fixture(); t.after(() => f.app.unmount())
  const gate = deferred<ArrayBuffer>(); t.mock.method(crypto.subtle, 'digest', () => gate.promise)
  f.assistant.instruction.value = '已经点击发送的要求'
  const sending = f.assistant.send(); f.assistant.instruction.value = '等待时写下的下一条要求'
  gate.resolve(new ArrayBuffer(32)); await sending
  assert.deepEqual(f.calls.inputs, ['已经点击发送的要求']); assert.equal(f.assistant.instruction.value, '等待时写下的下一条要求')
  assert.equal(f.assistant.turns.value[0].content, '已经点击发送的要求')
})

for (const during of ['status', 'cancel'] as const) test(`stop completing after book switch during ${during} cannot clear the new book`, async t => {
  const f = await fixture(); t.after(() => f.app.unmount()); await f.assistant.viewRun(record())
  const gate = deferred<AssistantRunView>()
  if (during === 'status') f.status(() => gate.promise); else f.cancel(() => gate.promise)
  const stopping = f.assistant.cancel(); await nextTick(); await switchBook(f)
  gate.resolve(record({ status: during === 'status' ? 'running' : 'cancelled' })); await stopping
  assertBookB(f); assert.equal(f.calls.cancel, during === 'status' ? 0 : 1)
})

test('late stop error cannot replace the new book status', async t => {
  const f = await fixture(); t.after(() => f.app.unmount()); await f.assistant.viewRun(record())
  const gate = deferred<AssistantRunView>(); f.status(() => gate.promise)
  const stopping = f.assistant.cancel(); await switchBook(f); gate.reject(new Error('旧作品停止失败')); await stopping
  assertBookB(f)
})

for (const action of ['resume', 'answer'] as const) test(`book change during ${action} status read cannot dispatch another old action`, async t => {
  const f = await fixture(); t.after(() => f.app.unmount())
  const waiting = record({ status: 'waiting-input', needsResume: action === 'resume', question })
  f.status(async () => waiting); await f.assistant.viewRun(waiting)
  const gate = deferred<AssistantRunView>(); f.status(() => gate.promise)
  const pending = action === 'resume' ? f.assistant.resumeRun() : f.assistant.submitAnswers(answers())
  await nextTick(); await switchBook(f); f.assistant.answerBusy.value = true
  gate.resolve(waiting); await pending
  assertBookB(f); assert.equal(f.calls.resume, 0); assert.equal(f.calls.answer, 0); assert.equal(f.assistant.answerBusy.value, true)
})

test('status failures retain last-known partial and can be reread without resending', async t => {
  const f = await fixture(); t.after(() => f.app.unmount())
  f.status(async () => record({ partial: '已显示的半段文字' })); await f.assistant.viewRun(record())
  f.status(async () => { throw new Error('状态暂时不可读') })
  await f.assistant.refreshRunStatus(); await f.assistant.refreshRunStatus()
  assert.equal(f.assistant.run.value?.partial, '已显示的半段文字'); assert.equal(f.assistant.busy.value, true); assert.equal(f.assistant.waiting.value, true)
  assert.ok(f.assistant.runStatusError.value); assert.equal(f.assistant.refreshingRun.value, false)
  f.assistant.instruction.value = '正在准备的追问'
  f.status(async () => record({ status: 'completed', partial: undefined, result: { kind: 'message', message: '完整结果', tools: [] } }))
  await f.assistant.refreshRunStatus(); await f.assistant.refreshRunStatus()
  assert.equal(f.assistant.runStatusError.value, ''); assert.equal(f.assistant.waiting.value, false); assert.equal(f.assistant.instruction.value, '正在准备的追问')
  assert.equal(f.assistant.turns.value.filter(t => t.content === '完整结果').length, 1)
  assert.deepEqual([f.calls.start, f.calls.resume, f.calls.answer, f.calls.cancel], [0, 0, 0, 0])
})

test('older status response cannot overwrite a newer completed result', async t => {
  const f = await fixture(); t.after(() => f.app.unmount()); await f.assistant.viewRun(record())
  const gate = deferred<AssistantRunView>(); f.status(() => gate.promise)
  const older = f.assistant.refreshRunStatus()
  f.status(async () => record({ status: 'completed', result: { kind: 'message', message: '最新完整结果', tools: [] } }))
  await f.assistant.refreshRunStatus(); gate.resolve(record({ partial: '旧进度' })); await older
  assert.equal(f.assistant.run.value?.status, 'completed'); assert.equal(f.assistant.busy.value, false)
  assert.equal(f.assistant.turns.value.at(-1)?.content, '最新完整结果')
})

test('late failed status read is ignored after switching books', async t => {
  const f = await fixture(); t.after(() => f.app.unmount()); await f.assistant.viewRun(record())
  const gate = deferred<AssistantRunView>(); f.status(() => gate.promise)
  const reading = f.assistant.refreshRunStatus(); await switchBook(f); gate.reject(new Error('old read failure')); await reading
  assertBookB(f); assert.equal(f.assistant.runStatusError.value, '')
})

test('polling failure exposes recovery without converting a running task into a failed send', async t => {
  const f = await fixture(); t.after(() => f.app.unmount()); await f.assistant.viewRun(record({ partial: '已写下的段落' }))
  f.status(async () => { throw new Error('轮询读取失败') })
  await new Promise(resolve => setTimeout(resolve, 900))
  assert.ok(f.assistant.runStatusError.value); assert.equal(f.assistant.error.value, '')
  assert.equal(f.assistant.busy.value, true); assert.equal(f.calls.start, 0)
})

test('confirmed answer followed by a status failure is recovered with a read, never another answer', async t => {
  const f = await fixture(); t.after(() => f.app.unmount())
  const waiting = record({ status: 'waiting-input', question })
  f.status(async () => waiting); await f.assistant.viewRun(waiting)
  let reads = 0
  f.status(async () => { if (++reads === 1) return waiting; throw new Error('回答已收下，状态读取失败') })
  await f.assistant.submitAnswers(answers())
  assert.ok(f.assistant.runStatusError.value); assert.equal(f.assistant.answerBusy.value, false); assert.equal(f.assistant.error.value, '')
  assert.equal(f.assistant.turns.value.filter(turn => turn.answerSubmissionId).length, 1)
  assert.ok(f.assistant.context.value.history.some(turn => turn.content.includes('寻找旧物的主人')))
  f.status(async () => record({ status: 'completed', result: { kind: 'message', message: '回答后的结果', tools: [] } }))
  await f.assistant.refreshRunStatus()
  assert.equal(f.assistant.runStatusError.value, ''); assert.equal(f.assistant.run.value?.status, 'completed')
  assert.deepEqual([f.calls.start, f.calls.resume, f.calls.answer], [0, 1, 1])
})

test('failed submission keeps the draft and records nothing; retry reuses the same submission', async t => {
  const f = await fixture(); t.after(() => f.app.unmount())
  const waiting = record({ status: 'waiting-input', question })
  f.status(async () => waiting); await f.assistant.viewRun(waiting)
  f.assistant.memory.questionDraft.value = { runId: waiting.id, questionId: question.id, questionVersion: 1, answers: answers() }
  let previous: AuthorAnswerSubmission | undefined
  f.answer(async input => { previous = input; throw new Error('回答未提交') })
  await f.assistant.submitAnswers(answers())
  assert.equal(f.assistant.turns.value.filter(turn => turn.answerSubmissionId).length, 0)
  assert.equal(f.assistant.memory.questionDraft.value?.answers[0].customText, '寻找旧物的主人')
  f.answer(async input => {
    assert.deepEqual(input, previous)
    return { runId: input.runId, questionId: input.questionId, answerSubmissionId: input.answerSubmissionId, acceptedAt: '' }
  })
  await f.assistant.submitAnswers(answers())
  assert.equal(f.assistant.turns.value.filter(turn => turn.answerSubmissionId).length, 1)
  assert.equal(f.assistant.memory.questionDraft.value, null)
})

test('answer text and submitted payload are captured before asynchronous preparation', async t => {
  const f = await fixture(); t.after(() => f.app.unmount())
  const waiting = record({ status: 'waiting-input', question })
  f.status(async () => waiting); await f.assistant.viewRun(waiting)
  const gate = deferred<AssistantRunView>(); f.status(() => gate.promise)
  f.answer(async input => {
    assert.equal(input.answers[0].customText, '寻找旧物的主人')
    return { runId: input.runId, questionId: input.questionId, answerSubmissionId: input.answerSubmissionId, acceptedAt: '' }
  })
  const input = answers(), pending = f.assistant.submitAnswers(input)
  input[0].customText = '点击后又修改的内容'; await nextTick()
  gate.resolve(waiting); await pending
  const saved = f.assistant.turns.value.find(turn => turn.answerSubmissionId)!
  assert.ok(saved.content.includes('寻找旧物的主人')); assert.ok(!saved.content.includes('点击后'))
})

for (const failed of [false, true]) test(`late answer receipt/error cannot enter another book (failure=${failed})`, async t => {
  const f = await fixture(); t.after(() => f.app.unmount())
  const waiting = record({ status: 'waiting-input', question })
  f.status(async () => waiting); await f.assistant.viewRun(waiting)
  const gate = deferred<AuthorAnswerReceipt>(), started = deferred<AuthorAnswerSubmission>()
  f.answer(input => { started.resolve(input); return gate.promise })
  const pending = f.assistant.submitAnswers(answers()), input = await started.promise
  await switchBook(f)
  if (failed) gate.reject(new Error('旧书提交失败'))
  else gate.resolve({ runId: input.runId, questionId: input.questionId, answerSubmissionId: input.answerSubmissionId, acceptedAt: '' })
  await pending; assertBookB(f)
  assert.equal(f.assistant.turns.value.filter(turn => turn.answerSubmissionId).length, 0)
})

for (const action of ['answer', 'read'] as const) test(`${action} preserves its existing handoff authority`, async t => {
  const f = await fixture(); t.after(() => f.app.unmount())
  const waiting = record({ status: 'waiting-input', question })
  f.status(async () => waiting); await f.assistant.viewRun(waiting)
  let reads = 0
  f.status(async () => action === 'answer' && ++reads === 1 ? waiting : record({ status: 'waiting-adoption', handoff: { id: 'handoff-a', result: { kind: 'navigate', workspaceId: 'profile', message: '继续处理', tools: [] } } }))
  if (action === 'answer') await f.assistant.submitAnswers(answers()); else await f.assistant.refreshRunStatus()
  assert.equal(f.calls.handoff, action === 'answer' ? 1 : 0)
  assert.equal(f.assistant.error.value, '')
})
