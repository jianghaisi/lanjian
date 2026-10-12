import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import { transformWithEsbuild } from 'vite'
import * as Vue from 'vue'
import type { DocumentAnnotation } from '../../../src/contracts/document-review/annotations'
import type { AnnotationRevisionSelection, AnnotationRevisionStart, AnnotationRevisionTask, RelatedRevisionAnalysis } from '../../../src/contracts/document-review/generation'
import type { DocumentRef } from '../../../src/contracts/document-review/types'
import { createAnnotationAnswerDrafts } from '../../../src/renderer/features/document-review/annotation-answer-drafts'
import type { AuthorQuestionDraft } from '../../../src/renderer/features/assistant/services/author-question-draft'
import type { AuthorAnswer, AuthorAnswerSubmission } from '../../../src/contracts/assistant/author-interaction-contracts'

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
async function mount(answerDrafts = createAnnotationAnswerDrafts()) {
  const source = await readFile(new URL('../../../src/renderer/features/document-review/AnnotationRevisionPanel.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  let code = compileScript(descriptor, { id: 'annotation-revision-panel-test' }).content
  code = code.replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/g, (_, names: string) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = Vue;`)
    .replace(/import AuthorQuestionCard[^\n]+/, 'const AuthorQuestionCard = {};')
    .replace(/import \{ annotationAnswerDrafts \}[^\n]+/, '')
  const compiled = await transformWithEsbuild(code, 'annotation-revision-panel-test.ts', { loader: 'ts' })
  const Component = new Function('Vue', 'annotationAnswerDrafts', compiled.code.replace('export default', 'return'))(Vue, answerDrafts)
  Component.render = () => null
  const document: DocumentRef = { workItemId: 'book-A', kind: 'body', documentId: 'body-A' }
  const snapshot = Vue.shallowRef({ ref: document })
  const annotations = Vue.shallowRef<DocumentAnnotation[]>(['first', 'second'].map(id => ({ id, document, body: id, status: 'open', revision: 1,
    anchor: { start: 0, end: 2, quote: '原文', before: '', after: '', documentHash: 'a'.repeat(64), versionId: 'v1' }, createdAt: '', updatedAt: '' })))
  const selectedIds = Vue.ref(['first']), disabled = Vue.ref(false), unsavedOpinion = Vue.ref(false)
  const analyses: AnnotationRevisionSelection[] = [], starts: AnnotationRevisionStart[] = [], records: AnnotationRevisionTask[] = []
  const calls: string[] = []
  const submissions: AuthorAnswerSubmission[] = []
  const hooks = { prepare: async () => {}, analyze: async () => {}, start: async () => {}, cancel: async () => {}, answer: async () => {}, recent: async () => {} }
  const review = { snapshot, annotations, reviews: Vue.shallowRef([]),
    prepareGeneration: async () => { calls.push('prepare'); const origin = snapshot.value.ref; await hooks.prepare(); return origin },
    refresh: async () => { calls.push('refresh') },
    generation: {
      recent: async (origin: DocumentRef) => { calls.push('recent'); await hooks.recent(); return records.filter(task => JSON.stringify(task.origin) === JSON.stringify(origin)) },
      answer: async (input: AuthorAnswerSubmission) => { submissions.push(input); await hooks.answer() },
      cancel: async (id: string) => {
        calls.push('cancel ' + id); await hooks.cancel()
        const index = records.findIndex(task => task.id === id)
        const next = { ...records[index]!, status: 'cancelled' as const }; records[index] = next; return next
      },
      resume: async ({ id }: { id: string }) => { calls.push('resume ' + id); return records.find(task => task.id === id)! },
      analyzeRelated: async (input: AnnotationRevisionSelection): Promise<RelatedRevisionAnalysis> => {
        assert.equal(Vue.isProxy(input), false); assert.equal(Vue.isProxy(input.annotations), false)
        analyses.push(input); await hooks.analyze()
        return { receipt: 'receipt', hasMore: false, targets: [input.origin, { ...input.origin, kind: 'total' as const, documentId: 'total-A' }, { ...input.origin, kind: 'volume' as const, documentId: 'volume-A' }].map(document => ({ document, title: document.kind, reason: '真实关联' })) }
      },
      start: async (input: AnnotationRevisionStart) => {
        assert.equal(Vue.isProxy(input), false); assert.equal(Vue.isProxy(input.targets), false)
        starts.push(input); await hooks.start()
        const result: AnnotationRevisionTask = { id: crypto.randomUUID(), workItemId: input.origin.workItemId, origin: input.origin, target: { document: input.target, title: input.target.kind, reason: '所选目标' }, status: 'succeeded', model: 'fixture', createdAt: '', error: null, stale: false, reviewId: null, pending: 1, committed: 0, staged: 0, question: null }
        records.push(result); return result
      }
    }
  }
  const renderer = Vue.createRenderer<object, object>({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, patchProp() {}, setElementText() {}, setText() {}, parentNode: () => null, nextSibling: () => null })
  const app = renderer.createApp({ render: () => Vue.h(Component, { review, selectedIds: selectedIds.value, disabled: disabled.value, unsavedOpinion: unsavedOpinion.value }) })
  const wrapper = app.mount({})
  type State = { analysis: RelatedRevisionAnalysis | null; selection: AnnotationRevisionSelection | null; targets: string[]; busy: boolean; error: string; taskReadError: string; tasks: AnnotationRevisionTask[]; reload: () => Promise<void>;
    answer: (task: AnnotationRevisionTask, answers: AuthorAnswer[]) => Promise<void>; answerDraft: (task: AnnotationRevisionTask) => ReturnType<typeof answerDrafts.get>; saveAnswerDraft: (task: AnnotationRevisionTask, value: AuthorQuestionDraft) => void;
    stopping: Set<string>; stopTask: (task: AnnotationRevisionTask) => Promise<void>; retryTask: (task: AnnotationRevisionTask) => Promise<void>;
    analyze: () => Promise<void>; generate: (mode: 'current' | 'related') => Promise<void>; operate: (action: () => Promise<void>, requiresSavedOpinion?: boolean) => Promise<void> }
  const state = (wrapper.$.subTree.component! as Vue.ComponentInternalInstance & { setupState: State }).setupState
  await state.reload()
  return { state, snapshot, annotations, selectedIds, disabled, unsavedOpinion, analyses, starts, records, calls, hooks, submissions, answerDrafts, unmount: () => app.unmount(), analyze: () => state.operate(state.analyze), generate: (mode: 'current' | 'related') => state.operate(() => state.generate(mode)) }
}

test('analysis binds the clicked annotations before waiting for the draft queue', async t => {
  const ctx = await mount(); t.after(ctx.unmount)
  const gate = deferred(), reached = deferred()
  ctx.hooks.prepare = async () => { reached.resolve(); await gate.promise }
  const pending = ctx.analyze(); await reached.promise
  ctx.selectedIds.value = ['second']; await Vue.nextTick(); gate.resolve(); await pending
  assert.equal(ctx.analyses.length, 0); assert.equal(ctx.starts.length, 0)
  assert.equal(ctx.state.analysis, null); assert.match(ctx.state.error, /已变化/)
})

for (const change of ['selection', 'revision', 'resolved', 'deleted', 'missing'] as const) test(`${change} changes during analysis discard its late response and cannot start current-document generation`, async t => {
  const ctx = await mount(); t.after(ctx.unmount)
  const gate = deferred(), reached = deferred()
  ctx.hooks.analyze = async () => { reached.resolve(); await gate.promise }
  const pending = ctx.generate('current'); await reached.promise
  if (change === 'selection') ctx.selectedIds.value = ['second']
  else if (change === 'missing') ctx.annotations.value = ctx.annotations.value.filter(item => item.id !== 'first')
  else ctx.annotations.value = ctx.annotations.value.map(item => item.id === 'first' ? { ...item, revision: item.revision + 1, status: change === 'revision' ? item.status : change } : item)
  await Vue.nextTick(); gate.resolve(); await pending
  assert.equal(ctx.starts.length, 0); assert.equal(ctx.state.analysis, null); assert.equal(ctx.state.selection, null)
  assert.deepEqual(ctx.state.targets, []); assert.match(ctx.state.error, /已变化/)
  assert.equal(ctx.state.busy, false)
})

test('editing a selected opinion invalidates ready targets; generation requests explicit reanalysis', async t => {
  const ctx = await mount(); t.after(ctx.unmount); await ctx.analyze()
  ctx.state.targets = ['total-A', 'volume-A']
  ctx.annotations.value = ctx.annotations.value.map(item => item.id === 'first' ? { ...item, body: '修改后的意见', revision: 2 } : item)
  await Vue.nextTick()
  assert.equal(ctx.state.analysis, null); assert.deepEqual(ctx.state.targets, [])
  await ctx.generate('related')
  assert.equal(ctx.starts.length, 0); assert.match(ctx.state.error, /重新/)
})

test('unrelated annotation refresh and selected-ID reordering preserve the ready target choices', async t => {
  const ctx = await mount(); t.after(ctx.unmount)
  ctx.selectedIds.value = ['first', 'second']; await Vue.nextTick(); await ctx.analyze()
  const analysis = ctx.state.analysis; ctx.state.targets = ['total-A']
  ctx.selectedIds.value = ['second', 'first']
  ctx.annotations.value = [...ctx.annotations.value.map(item => ({ ...item })), { ...ctx.annotations.value[0]!, id: 'unrelated', revision: 8 }]
  await Vue.nextTick()
  assert.equal(ctx.state.analysis, analysis); assert.deepEqual(ctx.state.targets, ['total-A'])
})

test('a failed reanalysis cannot leave the previous receipt available for generation', async t => {
  const ctx = await mount(); t.after(ctx.unmount); await ctx.analyze()
  ctx.hooks.analyze = async () => { throw new Error('关联读取失败') }
  await ctx.analyze()
  assert.equal(ctx.state.analysis, null); assert.equal(ctx.state.selection, null)
  assert.match(ctx.state.error, /关联读取失败/); assert.equal(ctx.starts.length, 0)
})

test('temporary editing lock during analysis invalidates the request even if editing is enabled again', async t => {
  const ctx = await mount(); t.after(ctx.unmount)
  const gate = deferred(), reached = deferred()
  ctx.hooks.analyze = async () => { reached.resolve(); await gate.promise }
  const pending = ctx.generate('current'); await reached.promise
  ctx.disabled.value = true; await Vue.nextTick(); ctx.disabled.value = false; await Vue.nextTick()
  gate.resolve(); await pending
  assert.equal(ctx.starts.length, 0); assert.equal(ctx.state.analysis, null)
  assert.match(ctx.state.error, /已变化|完成/)
})

for (const change of ['book', 'kind', 'unmount'] as const) test(`${change} changes suppress old analysis and its error in the new view`, async t => {
  const ctx = await mount()
  const gate = deferred(), reached = deferred()
  ctx.hooks.analyze = async () => { reached.resolve(); await gate.promise }
  const pending = ctx.generate('current'); await reached.promise
  if (change === 'unmount') ctx.unmount()
  else {
    t.after(ctx.unmount)
    ctx.snapshot.value = { ref: { ...ctx.snapshot.value.ref, ...(change === 'book' ? { workItemId: 'book-B' } : { kind: 'total' as const }) } }
    await Vue.nextTick()
  }
  gate.resolve(); await pending
  assert.equal(ctx.starts.length, 0); assert.equal(ctx.state.analysis, null)
  assert.equal(ctx.state.error, '')
})

test('valid current generation uses the original selected revisions, plain DTOs and only the current document', async t => {
  const ctx = await mount(); t.after(ctx.unmount)
  await ctx.generate('current')
  assert.equal(ctx.starts.length, 1)
  assert.deepEqual(ctx.starts[0]?.annotations, [{ id: 'first', revision: 1 }])
  assert.deepEqual(ctx.starts[0]?.targets, [ctx.snapshot.value.ref])
  assert.equal(ctx.starts[0]?.target.documentId, ctx.snapshot.value.ref.documentId)
  assert.equal(ctx.state.analysis, null); assert.equal(ctx.state.error, '')
  assert.equal(ctx.state.tasks.length, 1)
})

test('related generation waits for current draft synchronization and rechecks its annotation intent', async t => {
  const ctx = await mount(); t.after(ctx.unmount); await ctx.analyze()
  ctx.state.targets = ['total-A', 'volume-A']
  const gate = deferred(), reached = deferred()
  ctx.hooks.prepare = async () => { reached.resolve(); await gate.promise }
  const pending = ctx.generate('related')
  // Flushing microtasks also proves no model task starts before prepare resolves.
  await Vue.nextTick()
  assert.equal(ctx.starts.length, 0)
  await reached.promise
  ctx.selectedIds.value = ['second']; await Vue.nextTick(); gate.resolve(); await pending
  assert.equal(ctx.starts.length, 0); assert.match(ctx.state.error, /已变化/)
})

for (const change of ['selection', 'lock'] as const) test(`${change} after the first accepted target stops unsent targets while retaining the real task record`, async t => {
  const ctx = await mount(); t.after(ctx.unmount); await ctx.analyze()
  ctx.state.targets = ['total-A', 'volume-A']
  const gate = deferred(), reached = deferred()
  ctx.hooks.start = async () => { reached.resolve(); await gate.promise }
  const pending = ctx.generate('related'); await reached.promise
  if (change === 'selection') ctx.selectedIds.value = ['second']
  else ctx.disabled.value = true
  await Vue.nextTick(); gate.resolve(); await pending
  assert.equal(ctx.starts.length, 1); assert.equal(ctx.starts[0]?.target.documentId, 'total-A')
  assert.deepEqual(ctx.starts[0]?.annotations, [{ id: 'first', revision: 1 }])
  assert.equal(ctx.state.tasks.length, 1); assert.equal(ctx.state.tasks[0]?.target.document.documentId, 'total-A')
  assert.match(ctx.state.error, /已变化/)
})

test('a stale analysis failure does not replace the current selection-change explanation', async t => {
  const ctx = await mount(); t.after(ctx.unmount)
  const gate = deferred(), reached = deferred()
  ctx.hooks.analyze = async () => { reached.resolve(); await gate.promise; throw new Error('旧请求读取失败') }
  const pending = ctx.analyze(); await reached.promise
  ctx.selectedIds.value = ['second']; await Vue.nextTick(); gate.resolve(); await pending
  assert.match(ctx.state.error, /已变化/); assert.doesNotMatch(ctx.state.error, /旧请求/)
  assert.equal(ctx.state.analysis, null); assert.equal(ctx.starts.length, 0)
})

test('unsaved opinions prevent analysis and model actions while existing candidate viewing remains available', async t => {
  const ctx = await mount(); t.after(ctx.unmount)
  ctx.unsavedOpinion.value = true; await Vue.nextTick()
  await ctx.analyze(); await ctx.generate('current')
  assert.equal(ctx.analyses.length, 0); assert.equal(ctx.starts.length, 0)
  await ctx.state.operate(async () => { ctx.calls.push('view') }, false)
  assert.ok(ctx.calls.includes('view'))
})

test('typing an unsaved opinion invalidates both pending and ready analysis without automatically generating after clearing it', async t => {
  const ctx = await mount(); t.after(ctx.unmount)
  await ctx.analyze(); assert.ok(ctx.state.analysis)
  ctx.unsavedOpinion.value = true; await Vue.nextTick(); assert.equal(ctx.state.analysis, null)
  ctx.unsavedOpinion.value = false; await Vue.nextTick()
  const gate = deferred(), reached = deferred()
  ctx.hooks.analyze = async () => { reached.resolve(); await gate.promise }
  const pending = ctx.generate('current'); await reached.promise
  ctx.unsavedOpinion.value = true; await Vue.nextTick()
  ctx.unsavedOpinion.value = false; await Vue.nextTick(); gate.resolve(); await pending
  assert.equal(ctx.starts.length, 0); assert.equal(ctx.state.analysis, null)
})

function addRunningTask(ctx: Awaited<ReturnType<typeof mount>>) {
  const task: AnnotationRevisionTask = { id: crypto.randomUUID(), workItemId: ctx.snapshot.value.ref.workItemId, origin: ctx.snapshot.value.ref,
    target: { document: ctx.snapshot.value.ref, title: '当前正文', reason: '作者选择' }, status: 'running', model: 'fixture', createdAt: '', error: null, stale: false, reviewId: null, pending: 0, staged: 0, committed: 0, question: null }
  ctx.records.push(task); ctx.state.tasks = [...ctx.records]; return task
}

test('stop remains available during pending analysis, unsaved input and an editing lock', async t => {
  const ctx = await mount(); t.after(ctx.unmount); const task = addRunningTask(ctx)
  const gate = deferred(), reached = deferred()
  ctx.hooks.analyze = async () => { reached.resolve(); await gate.promise }
  const pending = ctx.analyze(); await reached.promise
  ctx.unsavedOpinion.value = true; ctx.disabled.value = true; await Vue.nextTick()
  try {
    await ctx.state.stopTask(task)
    assert.equal(ctx.state.tasks[0]?.status, 'cancelled')
    assert.equal(ctx.state.busy, true)
    assert.equal(ctx.unsavedOpinion.value, true)
    assert.equal(ctx.calls.filter(call => call.startsWith('cancel')).length, 1)
  } finally { gate.resolve(); await pending }
})

test('stopping a task suppresses duplicate clicks and leaves a different task independently stoppable', async t => {
  const ctx = await mount(); t.after(ctx.unmount); const first = addRunningTask(ctx), second = addRunningTask(ctx)
  const gate = deferred(), reached = deferred()
  ctx.hooks.cancel = async () => { reached.resolve(); await gate.promise }
  const pending = ctx.state.stopTask(first); await reached.promise
  assert.equal(ctx.state.stopping.has(first.id), true)
  await ctx.state.stopTask(first)
  const other = ctx.state.stopTask(second)
  assert.equal(ctx.calls.filter(call => call.startsWith('cancel')).length, 2)
  gate.resolve(); await Promise.all([pending, other])
  assert.equal(ctx.state.stopping.size, 0)
  assert.ok(ctx.state.tasks.every(task => task.status === 'cancelled'))
})

test('failed stopping preserves the task and permits an explicit stop retry', async t => {
  const ctx = await mount(); t.after(ctx.unmount); const task = addRunningTask(ctx)
  ctx.hooks.cancel = async () => { throw new Error('停止请求失败') }
  await ctx.state.stopTask(task)
  assert.equal(ctx.state.tasks[0]?.status, 'running'); assert.equal(ctx.state.stopping.size, 0)
  assert.match(ctx.state.error, /停止请求失败/)
  ctx.hooks.cancel = async () => {}; await ctx.state.stopTask(task)
  assert.equal(ctx.state.tasks[0]?.status, 'cancelled')
  assert.equal(ctx.calls.filter(call => call.startsWith('resume')).length, 0)
})

test('a late stop response cannot overwrite the next book task list or pending state', async t => {
  const ctx = await mount(); t.after(ctx.unmount); const task = addRunningTask(ctx)
  const gate = deferred(), reached = deferred()
  ctx.hooks.cancel = async () => { reached.resolve(); await gate.promise }
  const pending = ctx.state.stopTask(task); await reached.promise
  ctx.snapshot.value = { ref: { ...ctx.snapshot.value.ref, workItemId: 'book-B' } }; await Vue.nextTick()
  gate.resolve(); await pending
  assert.deepEqual(ctx.state.tasks, []); assert.equal(ctx.state.stopping.size, 0); assert.equal(ctx.state.error, '')
})

test('task retry observes unsaved opinions and editing locks, and requires a new explicit click after they clear', async t => {
  const ctx = await mount(); t.after(ctx.unmount)
  const task = { ...addRunningTask(ctx), status: 'cancelled' as const }
  ctx.unsavedOpinion.value = true; await Vue.nextTick(); await ctx.state.retryTask(task)
  ctx.unsavedOpinion.value = false; ctx.disabled.value = true; await Vue.nextTick(); await ctx.state.retryTask(task)
  assert.equal(ctx.calls.filter(call => call.startsWith('resume')).length, 0)
  ctx.disabled.value = false; await Vue.nextTick()
  assert.equal(ctx.calls.filter(call => call.startsWith('resume')).length, 0)
  await ctx.state.retryTask(task)
  assert.equal(ctx.calls.filter(call => call.startsWith('resume')).length, 1)
})

function waitingQuestion(ctx: Awaited<ReturnType<typeof mount>>) {
  const task: AnnotationRevisionTask = { ...addRunningTask(ctx), status: 'waiting-input', question: { id: 'question-1', version: 1,
    pluginId: 'builtin.core', toolId: 'ask_author', toolCallId: 'call-1', questions: [{ id: 'motive', prompt: '为何返回？', mode: 'text', required: true, options: [] }] } }
  const value: AuthorQuestionDraft = { runId: task.id, questionId: task.question!.id, questionVersion: 1, answers: [{ id: 'motive', chosenOptionIds: [], customText: '为了履行约定。', skipped: false }] }
  ctx.records[ctx.records.findIndex(record => record.id === task.id)] = task; ctx.state.tasks = [...ctx.records]
  return { task, value }
}

test('a remounted question restores unsubmitted input without answering or starting a model', async t => {
  const ctx = await mount(), { task, value } = waitingQuestion(ctx)
  ctx.state.saveAnswerDraft(task, value); ctx.unmount()
  const remount = await mount(ctx.answerDrafts); t.after(remount.unmount)
  assert.deepEqual(remount.state.answerDraft(task)?.draft, value)
  assert.equal(remount.submissions.length, 0); assert.equal(remount.starts.length, 0)
  remount.state.saveAnswerDraft(task, { ...value, questionVersion: 2 })
  assert.deepEqual(remount.state.answerDraft(task)?.draft, value)
})

test('failed answer submission preserves input and reuses the exact operation when explicitly retried', async t => {
  const ctx = await mount(); t.after(ctx.unmount); const { task, value } = waitingQuestion(ctx)
  ctx.state.saveAnswerDraft(task, value); ctx.hooks.answer = async () => { throw new Error('回答回执中断') }
  await ctx.state.operate(() => ctx.state.answer(task, value.answers))
  assert.equal(ctx.state.answerDraft(task)?.pending, false); assert.match(ctx.state.answerDraft(task)!.error, /回执中断/)
  assert.deepEqual(ctx.state.answerDraft(task)?.draft.answers, value.answers)
  ctx.hooks.answer = async () => {}; await ctx.state.operate(() => ctx.state.answer(task, value.answers))
  assert.deepEqual(ctx.submissions[0], ctx.submissions[1]); assert.equal(ctx.state.answerDraft(task)?.acknowledged, true)
})

test('pending answer survives unmount and cannot be submitted twice from its remounted editor', async t => {
  const ctx = await mount(), { task, value } = waitingQuestion(ctx), gate = deferred(), reached = deferred()
  ctx.hooks.answer = async () => { reached.resolve(); await gate.promise }
  const pending = ctx.state.operate(() => ctx.state.answer(task, value.answers)); await reached.promise; ctx.unmount()
  const remount = await mount(ctx.answerDrafts); t.after(remount.unmount)
  assert.equal(remount.state.answerDraft(task)?.pending, true)
  await remount.state.operate(() => remount.state.answer(task, value.answers)); assert.equal(remount.submissions.length, 0)
  gate.resolve(); await pending
  assert.equal(remount.state.answerDraft(task)?.acknowledged, true)
})

test('late answer acknowledgement seals the original draft without reading or altering the next book', async t => {
  const ctx = await mount(); t.after(ctx.unmount); const { task, value } = waitingQuestion(ctx)
  const gate = deferred(), reached = deferred(); ctx.hooks.answer = async () => { reached.resolve(); await gate.promise }
  const pending = ctx.state.operate(() => ctx.state.answer(task, value.answers)); await reached.promise
  const other = { ...task, origin: { ...task.origin, workItemId: 'book-B' } }
  ctx.snapshot.value = { ref: other.origin }; await Vue.nextTick()
  ctx.state.saveAnswerDraft(other, { ...value, answers: [{ ...value.answers[0]!, customText: '另一书的回答' }] })
  const reads = ctx.calls.filter(call => call === 'recent').length
  gate.resolve(); await pending
  assert.equal(ctx.calls.filter(call => call === 'recent').length, reads)
  assert.equal(ctx.state.answerDraft(task)?.acknowledged, true)
  assert.equal(ctx.state.answerDraft(other)?.draft.answers[0]?.customText, '另一书的回答')
  assert.equal(ctx.state.error, '')
})

test('unsaved opinions and editing locks prevent answer submission while preserving the answer draft', async t => {
  const ctx = await mount(); t.after(ctx.unmount); const { task, value } = waitingQuestion(ctx)
  ctx.state.saveAnswerDraft(task, value)
  ctx.unsavedOpinion.value = true; await Vue.nextTick(); await ctx.state.answer(task, value.answers)
  ctx.unsavedOpinion.value = false; ctx.disabled.value = true; await Vue.nextTick(); await ctx.state.answer(task, value.answers)
  assert.equal(ctx.submissions.length, 0); assert.deepEqual(ctx.state.answerDraft(task)?.draft, value)
})

test('confirmed answer triggers task reread and a failed reread never permits another submission', async t => {
  const ctx = await mount(); t.after(ctx.unmount); const { task, value } = waitingQuestion(ctx)
  const reached = deferred(); ctx.hooks.recent = async () => { reached.resolve(); throw new Error('后续任务回读失败') }
  await ctx.state.operate(() => ctx.state.answer(task, value.answers)); await reached.promise; await Vue.nextTick()
  assert.equal(ctx.state.answerDraft(task)?.acknowledged, true)
  assert.match(ctx.state.taskReadError, /回读失败/)
  ctx.hooks.recent = async () => {}; await ctx.state.reload()
  assert.equal(ctx.state.taskReadError, '')
  await ctx.state.operate(() => ctx.state.answer(task, value.answers))
  assert.equal(ctx.submissions.length, 1)
  const remount = await mount(ctx.answerDrafts); t.after(remount.unmount)
  const readsBefore = remount.calls.filter(call => call === 'recent').length
  remount.records.push(task); remount.state.tasks = [task]; await Vue.nextTick(); await Vue.nextTick()
  assert.equal(remount.calls.filter(call => call === 'recent').length, readsBefore + 1)
  await remount.state.operate(() => remount.state.answer(task, value.answers))
  assert.equal(remount.submissions.length, 0)
})
