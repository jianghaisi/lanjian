import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer, nextTick, ref } from 'vue'
import { useDocumentReview } from '../../../src/renderer/features/document-review/use-document-review'
import type { DocumentReviewApi, ReviewDraftRecord } from '../../../src/contracts/document-review/api'
import type { DocumentSnapshot, PreparedReviewDecision } from '../../../src/contracts/document-review/types'

const renderer = createRenderer<object, object>({ patchProp() {}, insert() {}, remove() {}, setText() {}, setElementText() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), parentNode: () => null, nextSibling: () => null })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { resolve, promise } }
function snapshot(book: string): DocumentSnapshot {
  return { ref: { workItemId: book, kind: 'body', documentId: `${book}-chapter` }, legacyId: 1, title: book, content: `${book}原文`, versionId: 'v1', revision: 'r1', hash: 'hash' }
}
function draft(book: string): ReviewDraftRecord {
  const doc = snapshot(book)
  return { document: doc.ref, title: doc.title, content: doc.content, baseRevision: doc.revision, revision: 1, stagedDecisionIds: [], updatedAt: '', positions: {}, anchors: {} }
}
for (const stage of ['prepare', 'acknowledge', 'save'] as const) test(`late ${stage} reply cannot modify the next book's editor or status`, async t => {
  const book = ref('A'), content = ref('A原文'), gate = deferred<void>(), reached = deferred<void>()
  const calls: string[] = []
  const api = {
    readSnapshot: async (target: { workItemId: string }) => snapshot(target.workItemId),
    listReviews: async () => [], recoverDraft: async (doc: { workItemId: string }) => draft(doc.workItemId),
    annotations: { list: async () => ({ items: [], nextCursor: null }) },
    prepareDecision: async () => {
      calls.push('prepare A')
      if (stage === 'prepare') { reached.resolve(); await gate.promise }
      return { id: 'permit', document: snapshot('A').ref, blockId: 'block', start: 0, end: 1, replacement: '修改', expectedDraftHash: 'h', resultingDraftHash: 'h2', expiresAt: '' } satisfies PreparedReviewDecision
    },
    acknowledgeStage: async () => { calls.push('acknowledge A'); if (stage === 'acknowledge') { reached.resolve(); await gate.promise }; return draft('A') },
    saveReviewedDraft: async () => { calls.push('save A'); reached.resolve(); await gate.promise; return { snapshot: snapshot('A'), receipt: null } },
  } as unknown as DocumentReviewApi
  let controller!: ReturnType<typeof useDocumentReview>
  const app = renderer.createApp({ setup() {
    controller = useDocumentReview({ api, target: () => ({ workItemId: book.value, kind: 'body', legacyId: 1 }),
      current: () => ({ title: book.value, content: content.value }), readOnly: () => false, composing: () => false,
      apply: () => { calls.push(`apply ${book.value}`); return true }, restore: () => assert.fail('must not restore') })
    return () => null
  } })
  app.mount({}); t.after(() => app.unmount()); await controller.settled()
  const pending = stage === 'save' ? controller.save({ title: 'A', content: 'A原文' }).catch(() => null) : controller.decide('block', 'retain')
  await reached.promise
  book.value = 'B'; content.value = 'B原文'; await nextTick()
  gate.resolve(); await pending; await controller.settled()
  assert.equal(controller.snapshot.value?.ref.workItemId, 'B')
  assert.equal(controller.draft.value?.content, 'B原文')
  assert.equal(controller.busy.value, false); assert.equal(controller.error.value, '')
  assert.equal(content.value, 'B原文')
  assert.ok(!calls.includes('apply B'))
  if (stage === 'prepare') assert.deepEqual(calls, ['prepare A'])
})
