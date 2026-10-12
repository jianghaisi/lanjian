import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer, nextTick } from 'vue'
import { useFieldAssistant } from '../../../src/renderer/features/assistant/composables/use-field-assistant'
import { useAssistantHistoryPreview } from '../../../src/renderer/features/assistant/composables/use-assistant-history-preview'
import { updateFieldScope } from '../../../src/renderer/features/assistant/services/assistant-field-registry'
import type { FieldAssistantApi, FieldTask } from '../../../src/contracts/assistant/field-assistant-contracts'
import type { AssistantRunView } from '../../../src/contracts/assistant/assistant-run-contracts'

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const run = (id = 'run-A', book = 'history-A'): AssistantRunView => ({ id, workItemId: book, bookTitle: book, operationId: id, page: 'profile', goal: `要求${id}`, status: 'completed', revision: 1, step: 1, message: '已完成', tools: [], createdAt: '', updatedAt: '', needsResume: false, result: { kind: 'message', message: `完整回答${id}`, tools: [] } })
const field = (id = 'field-A', book = 'history-A'): FieldTask => ({ id, status: 'completed', target: { fieldId: 'definition.bookProfile.coreIdea', instanceId: id, editorSessionId: id, workItemId: book, pageId: 'profile', label: '核心设想', revision: 1, value: '原文' }, createdAt: '', updatedAt: '' })

async function fixture() {
  updateFieldScope(null, 'library', '我的作品'); updateFieldScope('history-A', 'profile', '作品定义')
  let readFields = async (): Promise<FieldTask[]> => [], readRuns = async (): Promise<AssistantRunView[]> => [], readStatus = async (id: string) => run(id)
  let commands = 0
  const unexpected = async (): Promise<never> => { commands++; throw new Error('History must not execute commands') }
  const api: FieldAssistantApi = {
    recent: () => readFields(), conversation: unexpected, cancelConversation: unexpected, applicationModel: unexpected, saveApplicationModel: unexpected,
    preview: unexpected, start: unexpected, task: unexpected, cancel: unexpected, prepareApplication: unexpected, acknowledge: unexpected,
    runs: { recent: () => readRuns(), status: id => readStatus(id), start: unexpected, resume: unexpected, answer: unexpected, cancel: unexpected, acknowledgeHandoff: unexpected }
  }
  let assistant!: ReturnType<typeof useFieldAssistant>, reader!: ReturnType<typeof useAssistantHistoryPreview>
  const renderer = createRenderer<object, object>({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {}, patchProp() {}, insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null })
  const app = renderer.createApp({ setup() { assistant = useFieldAssistant(api, { page: () => 'profile', chapterId: () => null, selectedCharacters: () => 0, proseSnapshot: () => '', requiresPreview: () => false, prose: unexpected }); reader = useAssistantHistoryPreview(api); return () => null } })
  app.mount({}); await assistant.memory.ready(); await nextTick(); await assistant.refreshHistory(); await assistant.refreshRuns()
  return { assistant, reader, fields(fn: typeof readFields) { readFields = fn }, runs(fn: typeof readRuns) { readRuns = fn }, status(fn: typeof readStatus) { readStatus = fn }, commands: () => commands, dispose: () => app.unmount() }
}

for (const kind of ['fields', 'runs'] as const) test(`${kind} read failure retains the list and draft; successful empty retry clears the list`, async t => {
  const f = await fixture(); t.after(f.dispose)
  const list = kind === 'fields' ? f.assistant.history : f.assistant.runHistory
  const state = kind === 'fields' ? f.assistant.historyState : f.assistant.runHistoryState
  const refresh = kind === 'fields' ? f.assistant.refreshHistory : f.assistant.refreshRuns
  f.fields(async () => [field()]); f.runs(async () => [run()]); await refresh()
  f.assistant.instruction.value = '未发送的长要求'; f.assistant.error.value = '原对话提示'
  const before = JSON.stringify(list.value)
  f[kind](async () => { throw new Error('read unavailable') }); await refresh()
  assert.equal(JSON.stringify(list.value), before); assert.equal(state.loaded, true); assert.equal(state.loading, false); assert.match(state.error, /暂时无法读取/)
  assert.equal(f.assistant.instruction.value, '未发送的长要求'); assert.equal(f.assistant.error.value, '原对话提示'); assert.deepEqual(f.assistant.turns.value, [])
  f[kind](async () => []); await refresh(); assert.deepEqual(list.value, []); assert.equal(state.error, ''); assert.equal(f.commands(), 0)
})

for (const kind of ['fields', 'runs'] as const) for (const staleFailure of [false, true]) test(`${kind} latest read owns list/error/loading (stale failure=${staleFailure})`, async t => {
  const f = await fixture(); t.after(f.dispose)
  const state = kind === 'fields' ? f.assistant.historyState : f.assistant.runHistoryState
  const refresh = kind === 'fields' ? f.assistant.refreshHistory : f.assistant.refreshRuns
  const oldFields = deferred<FieldTask[]>(), newFields = deferred<FieldTask[]>(), oldRuns = deferred<AssistantRunView[]>(), newRuns = deferred<AssistantRunView[]>()
  f.fields(() => oldFields.promise); f.runs(() => oldRuns.promise); const first = refresh()
  f.fields(() => newFields.promise); f.runs(() => newRuns.promise); const second = refresh()
  if (staleFailure) {
    (kind === 'fields' ? oldFields : oldRuns).reject(new Error('old failure')); await first
    assert.equal(state.loading, true); assert.equal(state.error, '')
    newFields.resolve([field('new')]); newRuns.resolve([run('new')]); await second
    assert.equal((kind === 'fields' ? f.assistant.history : f.assistant.runHistory).value[0]?.id, 'new')
  } else {
    (kind === 'fields' ? newFields : newRuns).reject(new Error('new failure')); await second
    oldFields.resolve([field('old')]); oldRuns.resolve([run('old')]); await first
    assert.deepEqual((kind === 'fields' ? f.assistant.history : f.assistant.runHistory).value, []); assert.match(state.error, /暂时无法读取/)
  }
  assert.equal(state.loading, false); assert.equal(f.commands(), 0)
})

test('book switch clears previous lists and rejects old successes and failures after returning', async t => {
  const f = await fixture(); t.after(f.dispose)
  f.fields(async () => [field()]); f.runs(async () => [run()]); await f.assistant.refreshHistory(); await f.assistant.refreshRuns()
  const fields = deferred<FieldTask[]>(), runs = deferred<AssistantRunView[]>()
  f.fields(() => fields.promise); f.runs(() => runs.promise)
  const first = f.assistant.refreshHistory(), second = f.assistant.refreshRuns()
  f.fields(async () => []); f.runs(async () => [])
  updateFieldScope('history-B', 'profile', '作品定义'); await nextTick(); await f.assistant.memory.ready()
  assert.deepEqual(f.assistant.history.value, []); assert.deepEqual(f.assistant.runHistory.value, [])
  updateFieldScope('history-A', 'profile', '作品定义'); await nextTick(); await f.assistant.memory.ready()
  fields.resolve([field('stale')]); runs.reject(new Error('old book failure')); await Promise.all([first, second])
  assert.deepEqual(f.assistant.history.value, []); assert.deepEqual(f.assistant.runHistory.value, [])
  assert.equal(f.assistant.historyState.error, ''); assert.equal(f.assistant.runHistoryState.error, ''); assert.equal(f.assistant.error.value, '')
})

test('book lists stay valid across a conversation selection change but do not restore the old run', async t => {
  const f = await fixture(); t.after(f.dispose)
  const fields = deferred<FieldTask[]>(), runs = deferred<AssistantRunView[]>()
  f.fields(() => fields.promise); f.runs(() => runs.promise)
  const first = f.assistant.refreshHistory(), second = f.assistant.refreshRuns()
  f.assistant.viewTask(field('selected')); fields.resolve([field()]); runs.resolve([{ ...run(), status: 'interrupted' }]); await Promise.all([first, second])
  assert.equal(f.assistant.history.value.length, 1); assert.equal(f.assistant.runHistory.value.length, 1)
  assert.equal(f.assistant.historyState.loading, false); assert.equal(f.assistant.runHistoryState.loading, false)
  assert.equal(f.assistant.task.value?.id, 'selected'); assert.equal(f.assistant.run.value, null); assert.equal(f.commands(), 0)
})

test('first read failure is not an empty success; unmount invalidates both pending lists', async () => {
  const f = await fixture()
  f.fields(async () => { throw new Error('unreadable') }); f.runs(async () => { throw new Error('unreadable') })
  updateFieldScope('history-B', 'profile', '作品定义'); await nextTick(); await f.assistant.memory.ready(); await f.assistant.refreshHistory(); await f.assistant.refreshRuns()
  assert.equal(f.assistant.historyState.loaded, false); assert.equal(f.assistant.runHistoryState.loaded, false)
  const fields = deferred<FieldTask[]>(), runs = deferred<AssistantRunView[]>()
  f.fields(() => fields.promise); f.runs(() => runs.promise); const first = f.assistant.refreshHistory(), second = f.assistant.refreshRuns(); f.dispose()
  fields.resolve([field('late', 'history-B')]); runs.resolve([run('late', 'history-B')]); await Promise.all([first, second])
  assert.deepEqual(f.assistant.history.value, []); assert.deepEqual(f.assistant.runHistory.value, []); assert.equal(f.assistant.historyState.loading, false); assert.equal(f.assistant.runHistoryState.loading, false)
})

test('preview failure keeps full snapshot; explicit retry is read-only and returns full fresh text', async t => {
  const f = await fixture(); t.after(f.dispose)
  f.assistant.instruction.value = '保留草稿'; f.status(async () => { throw new Error('read failed') })
  await f.reader.inspectRun(run()); assert.equal(f.reader.preview.value?.message, '完整回答run-A'); assert.match(f.reader.error.value, /保留上次读取/)
  const text = '全文段落。'.repeat(2000); f.status(async id => ({ ...run(id), result: { kind: 'message', message: text, tools: [] } }))
  await f.reader.refresh(); assert.equal(f.reader.preview.value?.message, text); assert.equal(f.reader.error.value, ''); assert.equal(f.reader.loading.value, false)
  assert.equal(f.assistant.instruction.value, '保留草稿'); assert.deepEqual(f.assistant.turns.value, []); assert.equal(f.commands(), 0)
})

for (const outcome of ['success', 'failure'] as const) test(`late preview ${outcome} cannot affect a newer selection or closed preview`, async t => {
  const f = await fixture(); t.after(f.dispose); const old = deferred<AssistantRunView>(), current = deferred<AssistantRunView>()
  f.status(id => id === 'old' ? old.promise : current.promise)
  const first = f.reader.inspectRun(run('old')), second = f.reader.inspectRun(run('new'))
  if (outcome === 'failure') old.reject(new Error('old error')); else old.resolve(run('old'))
  await first; assert.equal(f.reader.preview.value?.run?.id, 'new'); assert.equal(f.reader.loading.value, true); assert.equal(f.reader.error.value, '')
  f.reader.close(); current.reject(new Error('closed error')); await second
  assert.equal(f.reader.preview.value, null); assert.equal(f.reader.loading.value, false); assert.equal(f.reader.error.value, '')
})

test('preview same-ID retries ignore superseded replies; switching to a field record or book invalidates pending reads', async t => {
  const f = await fixture(); t.after(f.dispose)
  const old = deferred<AssistantRunView>(); f.status(() => old.promise); const first = f.reader.inspectRun(run())
  f.status(async () => ({ ...run(), message: 'new', result: undefined })); await f.reader.refresh()
  old.resolve(run()); await first; assert.equal(f.reader.preview.value?.message, 'new')
  const next = deferred<AssistantRunView>(); f.status(() => next.promise); const second = f.reader.refresh()
  f.reader.inspectTask(field()); next.reject(new Error('late run')); await second
  assert.equal(f.reader.preview.value?.task?.id, 'field-A'); assert.equal(f.reader.error.value, '')
  const last = deferred<AssistantRunView>(); f.status(() => last.promise); const third = f.reader.inspectRun(run())
  updateFieldScope('history-B', 'profile', '作品定义'); updateFieldScope('history-A', 'profile', '作品定义')
  last.resolve(run()); await third; assert.equal(f.reader.preview.value, null); assert.equal(f.reader.error.value, '')
})

test('out-of-book lists and mismatched detail identities never enter the visible history', async t => {
  const f = await fixture(); t.after(f.dispose)
  f.fields(async () => [field(), field('foreign', 'history-B')]); f.runs(async () => [run(), run('foreign', 'history-B')])
  await f.assistant.refreshHistory(); await f.assistant.refreshRuns()
  assert.deepEqual(f.assistant.history.value.map(item => item.id), ['field-A']); assert.deepEqual(f.assistant.runHistory.value.map(item => item.id), ['run-A'])
  f.status(async () => run('other', 'history-B')); await f.reader.inspectRun(run())
  assert.equal(f.reader.preview.value?.run?.id, 'run-A'); assert.match(f.reader.error.value, /暂时无法刷新/)
  f.reader.close(); await f.reader.inspectRun(run('foreign', 'history-B')); f.reader.inspectTask(field('foreign', 'history-B')); assert.equal(f.reader.preview.value, null)
})


test('explicit list-only refresh never attaches a pending run or changes the live conversation', async t => {
  const f = await fixture(); t.after(f.dispose)
  const pending = { ...run(), status: 'interrupted' as const, needsResume: true }
  f.runs(async () => [pending]); f.assistant.instruction.value = '新的草稿'
  await f.assistant.refreshRuns(false)
  assert.equal(f.assistant.runHistory.value[0]?.id, pending.id)
  assert.equal(f.assistant.run.value, null); assert.equal(f.assistant.instruction.value, '新的草稿')
  assert.deepEqual(f.assistant.turns.value, []); assert.equal(f.commands(), 0)
})
