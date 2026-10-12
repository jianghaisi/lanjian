import assert from 'node:assert/strict'
import test from 'node:test'
import { createAnnotationAnswerDrafts } from '../../../src/renderer/features/document-review/annotation-answer-drafts'
import type { DocumentRef } from '../../../src/contracts/document-review/types'
import type { AuthorQuestionDraft } from '../../../src/renderer/features/assistant/services/author-question-draft'

const document: DocumentRef = { workItemId: 'book-A', kind: 'body', documentId: 'chapter-1' }
const draft = (): AuthorQuestionDraft => ({ runId: 'run-1', questionId: 'question-1', questionVersion: 1, answers: [{ id: 'motive', chosenOptionIds: [], customText: '为了履行约定。', skipped: false }] })

test('answer drafts isolate book, kind, document, task and question version', () => {
  const store = createAnnotationAnswerDrafts(), value = draft(); store.set(document, value)
  for (const scope of [{ ...document, workItemId: 'book-B' }, { ...document, kind: 'chapter-outline' as const }, { ...document, documentId: 'chapter-2' }]) assert.equal(store.get(scope, value), undefined)
  for (const identity of [{ ...value, runId: 'run-2' }, { ...value, questionId: 'question-2' }, { ...value, questionVersion: 2 }]) assert.equal(store.get(document, identity), undefined)
  assert.equal(store.get(document, value)?.draft.answers[0]?.customText, '为了履行约定。')
})

test('input snapshots remain independent of the emitting card and identical values preserve retry identity', () => {
  const store = createAnnotationAnswerDrafts(), value = draft(); store.set(document, value)
  const original = store.get(document, value)!
  value.answers[0]!.customText = '卡片继续输入'; value.answers[0]!.chosenOptionIds.push('option')
  assert.equal(original.draft.answers[0]?.customText, '为了履行约定。'); assert.deepEqual(original.draft.answers[0]?.chosenOptionIds, [])
  store.set(document, draft()); assert.equal(store.get(document, draft())?.operation, original.operation)
})

test('pending answers survive a remount and suppress duplicate submission or overwriting input', () => {
  const store = createAnnotationAnswerDrafts(), value = draft(), pending = store.begin(document, value)!
  assert.equal(store.begin(document, value), null)
  store.set(document, { ...value, answers: [{ ...value.answers[0]!, customText: '不应覆盖' }] })
  assert.equal(store.get(document, value), pending); assert.equal(pending.pending, true)
  store.finish(document, pending, '暂时无法提交')
  assert.equal(store.get(document, value)?.pending, false)
  assert.equal(store.get(document, value)?.error, '暂时无法提交')
  assert.equal(store.begin(document, value)?.operation, pending.operation)
})

test('acknowledgement seals only the confirmed question against resubmission and leaves other books untouched', () => {
  const store = createAnnotationAnswerDrafts(), value = draft(), other = { ...document, workItemId: 'book-B' }
  store.set(other, value); const pending = store.begin(document, value)!
  store.finish(document, pending)
  assert.equal(store.get(document, value)?.acknowledged, true); assert.equal(store.begin(document, value), null)
  assert.equal(store.get(other, value)?.acknowledged, false)
})

test('editing after a failed submission starts a new operation that an old acknowledgement cannot clear', () => {
  const store = createAnnotationAnswerDrafts(), value = draft(), old = store.begin(document, value)!
  store.finish(document, old, '网络中断')
  value.answers[0]!.customText = '新的回答'; store.set(document, value)
  const next = store.get(document, value)!
  assert.notEqual(next.operation, old.operation)
  store.finish(document, old)
  assert.equal(store.get(document, value), next)
})
