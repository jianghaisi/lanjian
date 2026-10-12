import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer, nextTick, reactive } from 'vue'
import { useFieldAssistant } from '../../../src/renderer/features/assistant/composables/use-field-assistant'
import { fieldRegistry, fieldSourceIds, registerAssistantField, updateFieldScope } from '../../../src/renderer/features/assistant/services/assistant-field-registry'
import type { AssistantRunView } from '../../../src/contracts/assistant/assistant-run-contracts'
import type { FieldAssistantApi, FieldApplicationPermit, FieldCandidate, FieldTask } from '../../../src/contracts/assistant/field-assistant-contracts'

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
async function fixture() {
  updateFieldScope(null, 'library', '我的作品')
  updateFieldScope('candidate-A', 'profile', '作品定义')
  const draft = reactive({ value: '原书设想A' })
  let reveal = async () => true
  const field = registerAssistantField({ id: 'definition.bookProfile.coreIdea', read: () => draft.value, write: value => { draft.value = String(value) }, identity: () => draft, reveal: () => reveal() })
  const records = new Map<string, FieldCandidate>(), calls = { prepare: 0, applied: 0, undone: 0, reject: 0 }
  const unexpected = async (): Promise<never> => { throw new Error('Unexpected API call in field candidate fixture') }
  const api: FieldAssistantApi = {
    conversation: unexpected, cancelConversation: unexpected, applicationModel: unexpected, saveApplicationModel: unexpected, preview: unexpected, start: unexpected, task: unexpected, cancel: unexpected,
    recent: async () => [],
    prepareApplication: async input => { calls.prepare++; const value = records.get(input.candidateId)!; return { token: value.id, candidateId: value.id, target: input.target, value: value.after } },
    acknowledge: async input => { calls[input.action]++; return { ...records.get(input.token)!, status: input.action } },
    reject: async id => { calls.reject++; const value = records.get(id)!; return task({ ...value, status: 'rejected' }) }
  }
  function task(value: FieldCandidate): FieldTask { return { id: value.id, target: value.target, status: 'completed', candidate: value, createdAt: '', updatedAt: '' } }
  function candidate(id: string) {
    const target = { ...fieldRegistry.get(field.key)!.target }
    const value: FieldCandidate = { id, operationId: id, target, before: target.value, after: `候选内容${id}`, dependencyFingerprint: 'fingerprint', model: 'test', connectionId: 'test', createdAt: '', status: 'candidate' }
    records.set(id, value); return value
  }
  let assistant!: ReturnType<typeof useFieldAssistant>
  const renderer = createRenderer<object, object>({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {}, patchProp() {}, insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null })
  const app = renderer.createApp({ setup() { assistant = useFieldAssistant(api, { page: () => 'profile', chapterId: () => null, selectedCharacters: () => 0, proseSnapshot: () => '', requiresPreview: () => false, async prose() {} }); return () => null } })
  app.mount({}); await assistant.memory.ready(); await nextTick()
  const first = candidate('first'); assistant.viewTask(task(first))
  return { assistant, api, draft, field, calls, first, candidate, task, reveal: (fn: typeof reveal) => { reveal = fn }, dispose() { app.unmount(); field.dispose() } }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
async function bookB(f: Fixture) {
  updateFieldScope('candidate-B', 'profile', '作品定义'); await nextTick(); await f.assistant.memory.ready()
  assert.equal(f.assistant.applying.value, false, 'Old operation cannot block a new book')
  f.draft.value = '原书设想B'
  const value = f.candidate('second'); f.assistant.viewTask(f.task(value)); return value
}
function assertNewBook(f: Fixture, value: FieldCandidate, applying = false) {
  assert.equal(f.assistant.candidate.value?.id, value.id)
  assert.equal(f.assistant.error.value, '')
  assert.equal(f.assistant.applying.value, applying)
  assert.equal(f.draft.value, value.after)
  assert.equal(f.assistant.undo.value?.before, value.before)
  assert.deepEqual(fieldSourceIds('definition.'), [value.id])
}

test('apply and undo update the draft and provenance; composition temporarily disables undo', async t => {
  const f = await fixture(); t.after(f.dispose)
  await f.assistant.apply()
  assert.equal(f.draft.value, f.first.after); assert.equal(f.assistant.canUndo.value, true)
  assert.deepEqual(fieldSourceIds('definition.'), [f.first.id])
  f.field.composing(true); assert.equal(f.assistant.canUndo.value, false); assert.match(f.assistant.message.value, /正在输入/)
  f.field.composing(false); assert.equal(f.assistant.canUndo.value, true)
  await f.assistant.undoApply()
  assert.equal(f.draft.value, '原书设想A'); assert.equal(f.assistant.candidate.value?.status, 'undone')
  assert.equal(f.assistant.canUndo.value, false); assert.equal(f.assistant.applying.value, false); assert.deepEqual(fieldSourceIds('definition.'), [])
})

test('manual editing disables undo immediately and direct invocation preserves the new text', async t => {
  const f = await fixture(); t.after(f.dispose); await f.assistant.apply()
  f.draft.value = '作者接着写的内容'
  assert.equal(f.assistant.canUndo.value, false); assert.match(f.assistant.message.value, /当前输入或目标已变化/)
  await f.assistant.undoApply()
  assert.equal(f.draft.value, '作者接着写的内容'); assert.equal(f.calls.undone, 0)
})

for (const shared of [false, true]) test(`visible composition blocks only the same explicitly owned draft (shared=${shared})`, async t => {
  const f = await fixture(); t.after(f.dispose); await f.assistant.apply()
  const owner = shared ? f.draft : reactive({ value: '其他人物的内容' })
  const visible = registerAssistantField({ id: 'definition.bookProfile.coreIdea', read: () => owner.value, write: value => { owner.value = String(value) }, identity: () => owner })
  t.after(visible.dispose); visible.composing(true)
  assert.equal(f.assistant.canUndo.value, !shared)
  if (shared) {
    assert.match(f.assistant.message.value, /正在输入/)
    await f.assistant.undoApply(); assert.equal(f.calls.undone, 0); assert.equal(f.draft.value, f.first.after)
  }
  visible.composing(false); assert.equal(f.assistant.canUndo.value, true)
  await f.assistant.undoApply(); assert.equal(f.draft.value, '原书设想A')
})

test('visible input composition also blocks application through a persistent alias', async t => {
  const f = await fixture(); t.after(f.dispose)
  const visible = registerAssistantField({ id: 'definition.bookProfile.coreIdea', read: () => f.draft.value, write: value => { f.draft.value = String(value) }, identity: () => f.draft })
  t.after(visible.dispose); visible.composing(true)
  await f.assistant.apply()
  assert.equal(f.calls.prepare, 0); assert.equal(f.draft.value, '原书设想A')
  visible.composing(false); await f.assistant.apply(); assert.equal(f.draft.value, f.first.after)
})

for (const failure of [false, true]) test(`late preparation after book switch cannot write or unblock another apply (failure=${failure})`, async t => {
  const f = await fixture(); t.after(f.dispose)
  const original = f.api.prepareApplication, gate = deferred<FieldApplicationPermit>()
  f.api.prepareApplication = () => gate.promise
  const old = f.assistant.apply(), value = await bookB(f), second = deferred<FieldApplicationPermit>()
  f.api.prepareApplication = () => second.promise
  const current = f.assistant.apply()
  if (failure) gate.reject(new Error('旧作品准备失败'))
  else gate.resolve({ token: 'first', candidateId: 'first', target: f.first.target, value: f.first.after })
  await old
  assert.equal(f.draft.value, '原书设想B'); assert.equal(f.assistant.applying.value, true); assert.equal(f.assistant.error.value, ''); assert.equal(f.calls.applied, 0)
  second.resolve(await original({ candidateId: value.id, target: value.target })); await current
  assertNewBook(f, value)
})

test('changing candidate while reveal awaits prevents the old field write', async t => {
  const f = await fixture(); t.after(f.dispose)
  const entered = deferred<void>(), gate = deferred<boolean>()
  f.reveal(() => { entered.resolve(); return gate.promise })
  const applying = f.assistant.apply(); await entered.promise
  const value = f.candidate('replacement'); f.assistant.viewTask(f.task(value))
  gate.resolve(true); await applying
  assert.equal(f.draft.value, '原书设想A'); assert.equal(f.calls.applied, 0)
  assert.equal(f.assistant.candidate.value?.id, value.id); assert.equal(f.assistant.applying.value, false); assert.equal(f.assistant.error.value, '')
})

for (const action of ['applied', 'undone'] as const) for (const failure of [false, true]) test(`late ${action} receipt cannot overwrite new book state or rollback its input (failure=${failure})`, async t => {
  const f = await fixture(); t.after(f.dispose)
  if (action === 'undone') await f.assistant.apply()
  const original = f.api.acknowledge, entered = deferred<void>(), gate = deferred<FieldCandidate>()
  f.api.acknowledge = () => { entered.resolve(); return gate.promise }
  const pending = action === 'applied' ? f.assistant.apply() : f.assistant.undoApply(); await entered.promise
  const value = await bookB(f); f.api.acknowledge = original; await f.assistant.apply()
  // Another current operation is busy when the old finally executes.
  f.assistant.applying.value = true
  if (failure) gate.reject(new Error('旧作品确认失败')); else gate.resolve({ ...f.first, status: action })
  await pending; assertNewBook(f, value, true)
})

for (const failure of [false, true]) test(`late rejection cannot replace another book candidate (failure=${failure})`, async t => {
  const f = await fixture(); t.after(f.dispose)
  const gate = deferred<FieldTask>(); f.api.reject = () => gate.promise
  const pending = f.assistant.rejectCandidate(), value = await bookB(f)
  await f.assistant.apply(); f.assistant.applying.value = true
  if (failure) gate.reject(new Error('旧候选放弃失败')); else gate.resolve(f.task({ ...f.first, status: 'rejected' }))
  await pending; assertNewBook(f, value, true)
})

for (const edited of [false, true]) test(`unconfirmed apply keeps input; retry confirms only the record (edited=${edited})`, async t => {
  const f = await fixture(); t.after(f.dispose)
  const original = f.api.acknowledge, entered = deferred<void>(), gate = deferred<FieldCandidate>()
  f.api.acknowledge = () => { entered.resolve(); return gate.promise }
  const pending = f.assistant.apply(); await entered.promise
  if (edited) f.draft.value = '等待确认时继续写下的文字'
  gate.reject(new Error('确认失败')); await pending
  const text = edited ? '等待确认时继续写下的文字' : f.first.after
  assert.equal(f.draft.value, text); assert.equal(f.assistant.receiptPending.value, true)
  assert.equal(f.assistant.applying.value, false); assert.match(f.assistant.message.value, /操作记录尚未确认/)
  assert.equal(f.assistant.canUndo.value, false); assert.deepEqual(fieldSourceIds('definition.'), [])
  await f.assistant.apply(); await f.assistant.undoApply(); await f.assistant.rejectCandidate()
  assert.equal(f.calls.prepare, 1); assert.equal(f.calls.undone, 0); assert.equal(f.calls.reject, 0)
  // Repeated failure remains recoverable and never writes the field a second time.
  f.api.acknowledge = async () => { throw new Error('仍未确认') }; await f.assistant.retryReceipt()
  assert.equal(f.draft.value, text); assert.equal(f.assistant.receiptPending.value, true)
  f.api.acknowledge = original; await f.assistant.retryReceipt()
  assert.equal(f.draft.value, text); assert.equal(f.assistant.receiptPending.value, false)
  assert.equal(f.assistant.candidate.value?.status, 'applied'); assert.equal(f.assistant.canUndo.value, !edited)
  assert.deepEqual(fieldSourceIds('definition.'), [f.first.id]); assert.equal(f.assistant.error.value, '')
})

test('preparation failure never consumes an unrelated previous undo snapshot', async t => {
  const f = await fixture(); t.after(f.dispose); await f.assistant.apply()
  const previous = f.assistant.undo.value
  const value = f.candidate('next'); f.assistant.candidate.value = value
  f.api.prepareApplication = async () => { throw new Error('准备失败') }
  await f.assistant.apply()
  assert.equal(f.draft.value, f.first.after); assert.equal(f.assistant.undo.value, previous)
})

test('failed undo acknowledgment distinguishes restored input from unconfirmed receipt', async t => {
  const f = await fixture(); t.after(f.dispose); await f.assistant.apply()
  const original = f.api.acknowledge
  f.api.acknowledge = async () => { throw new Error('记录暂不可用') }
  await f.assistant.undoApply()
  assert.equal(f.draft.value, '原书设想A'); assert.equal(f.assistant.canUndo.value, false)
  assert.match(f.assistant.message.value, /本页输入已恢复，撤销记录尚未确认/); assert.equal(f.assistant.applying.value, false)
  f.draft.value = '撤销之后继续手写'
  f.api.acknowledge = original; await f.assistant.retryReceipt()
  assert.equal(f.draft.value, '撤销之后继续手写'); assert.equal(f.assistant.candidate.value?.status, 'undone')
  assert.equal(f.assistant.undo.value, null); assert.equal(f.assistant.receiptPending.value, false); assert.deepEqual(fieldSourceIds('definition.'), [])
})

for (const failure of [false, true]) test(`late retry result stays with its original book (failure=${failure})`, async t => {
  const f = await fixture(); t.after(f.dispose)
  const original = f.api.acknowledge
  f.api.acknowledge = async () => { throw new Error('待确认') }; await f.assistant.apply()
  const gate = deferred<FieldCandidate>(); f.api.acknowledge = () => gate.promise
  const retry = f.assistant.retryReceipt(), value = await bookB(f)
  f.api.acknowledge = original; await f.assistant.apply(); f.assistant.applying.value = true
  if (failure) gate.reject(new Error('旧重试失败')); else gate.resolve({ ...f.first, status: 'applied' })
  await retry; assertNewBook(f, value, true); assert.equal(f.assistant.receiptPending.value, false)
})

async function withRun(f: Fixture) {
  let handoffs = 0, fieldReads = 0
  const value: AssistantRunView = { id: 'receipt-run', operationId: 'receipt-op', workItemId: 'candidate-A', bookTitle: '作品A', page: 'profile', goal: '修改设想', status: 'waiting-adoption', revision: 1, step: 1, message: '等待采用', tools: [], createdAt: '', updatedAt: '', needsResume: false, handoff: { id: 'handoff', result: { kind: 'field', message: '候选', tools: [], task: f.task(f.first) } } }
  const unexpected = async (): Promise<never> => { throw new Error('Unexpected run command') }
  f.api.task = async () => { fieldReads++; return f.task(f.first) }
  f.api.runs = { recent: async () => [], status: async () => value, start: unexpected, resume: unexpected, cancel: unexpected, answer: unexpected, acknowledgeHandoff: async () => { handoffs++; return { ...value, status: 'completed', handoff: undefined } } }
  await f.assistant.viewRun(value)
  return { handoffs: () => handoffs, reads: () => fieldReads }
}

test('pending receipt blocks automatic handoff and new send; confirmation resumes the original run', async t => {
  const f = await fixture(); t.after(f.dispose); const run = await withRun(f)
  const original = f.api.acknowledge
  f.api.acknowledge = async () => { throw new Error('确认失败') }; await f.assistant.apply()
  f.assistant.instruction.value = '下一条要求'; await f.assistant.send()
  await new Promise(resolve => setTimeout(resolve, 900)); await f.assistant.refreshRunStatus()
  assert.equal(run.handoffs(), 0); assert.equal(run.reads(), 1)
  assert.equal(f.assistant.instruction.value, '下一条要求'); assert.equal(f.assistant.receiptPending.value, true)
  f.api.acknowledge = original; await f.assistant.retryReceipt()
  assert.equal(run.handoffs(), 1); assert.equal(f.assistant.run.value?.status, 'completed')
  assert.equal(f.assistant.receiptPending.value, false); assert.equal(f.draft.value, f.first.after)
})

test('field status read started before apply cannot replace its confirmed candidate', async t => {
  const f = await fixture(); t.after(f.dispose); await withRun(f)
  const entered = deferred<void>(), gate = deferred<FieldTask>()
  f.api.task = () => { entered.resolve(); return gate.promise }
  const reading = f.assistant.refreshRunStatus(); await entered.promise
  await f.assistant.apply(); gate.resolve(f.task(f.first)); await reading
  assert.equal(f.assistant.candidate.value?.status, 'applied'); assert.equal(f.draft.value, f.first.after)
  assert.deepEqual(fieldSourceIds('definition.'), [f.first.id])
})

test('receipt confirmation is independent of a failed run status read', async t => {
  const f = await fixture(); t.after(f.dispose); const run = await withRun(f)
  const original = f.api.acknowledge
  f.api.acknowledge = async () => { throw new Error('确认中断') }; await f.assistant.apply()
  f.api.runs!.status = async () => { throw new Error('进度暂时不可读') }
  await f.assistant.refreshRunStatus(); assert.ok(f.assistant.runStatusError.value)
  f.api.acknowledge = original; await f.assistant.retryReceipt()
  assert.equal(f.assistant.receiptPending.value, false); assert.equal(f.assistant.candidate.value?.status, 'applied')
  assert.equal(f.draft.value, f.first.after); assert.ok(f.assistant.runStatusError.value); assert.equal(run.handoffs(), 0)
})

test('automatic handoff also pauses while the local apply permit is still being prepared', async t => {
  const f = await fixture(); t.after(f.dispose); const run = await withRun(f)
  const original = f.api.prepareApplication, gate = deferred<FieldApplicationPermit>()
  f.api.prepareApplication = () => gate.promise
  const applying = f.assistant.apply()
  await new Promise(resolve => setTimeout(resolve, 900))
  assert.equal(run.handoffs(), 0); assert.equal(f.draft.value, '原书设想A')
  gate.resolve(await original({ candidateId: f.first.id, target: f.first.target })); await applying
  assert.equal(run.handoffs(), 1); assert.equal(f.assistant.run.value?.status, 'completed')
})

test('reject releases its local lock before resuming the original handoff', async t => {
  const f = await fixture(); t.after(f.dispose); const run = await withRun(f)
  await f.assistant.rejectCandidate()
  assert.equal(f.assistant.candidate.value?.status, 'rejected'); assert.equal(f.assistant.applying.value, false)
  assert.equal(run.handoffs(), 1); assert.equal(f.assistant.run.value?.status, 'completed')
})

test('stopping during local preparation releases the view lock and rejects the late permit', async t => {
  const f = await fixture(); t.after(f.dispose)
  const gate = deferred<FieldApplicationPermit>(); f.api.prepareApplication = () => gate.promise
  const applying = f.assistant.apply(); await f.assistant.cancel()
  assert.equal(f.assistant.applying.value, false)
  gate.resolve({ token: 'late', candidateId: f.first.id, target: f.first.target, value: f.first.after }); await applying
  assert.equal(f.draft.value, '原书设想A'); assert.equal(f.calls.applied, 0); assert.equal(f.assistant.receiptPending.value, false)
})
