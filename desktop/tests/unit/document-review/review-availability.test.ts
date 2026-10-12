import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer, nextTick, ref } from 'vue'
import { useDocumentReview } from '../../../src/renderer/features/document-review/use-document-review'
import type { DocumentReviewApi } from '../../../src/contracts/document-review/api'
import type { DocumentSnapshot } from '../../../src/contracts/document-review/types'

const renderer = createRenderer<object, object>({ patchProp() {}, insert() {}, remove() {}, setText() {}, setElementText() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), parentNode: () => null, nextSibling: () => null })
const missing = (reason?: string) => ({ code: 'NOT_FOUND', message: '文档暂不可读取', details: { reason } })
function fixture(initial: unknown) {
  let failure = initial, reads = 0, lists = 0
  const book = ref('A')
  const api = {
    readSnapshot: async () => { reads++; if (failure) throw failure; return { ref: { workItemId: book.value, kind: 'total', documentId: 'total' }, title: '总纲', content: '', revision: 'r1' } as DocumentSnapshot },
    listReviews: async () => { lists++; return [] }, recoverDraft: async () => null,
    annotations: { list: async () => ({ items: [], nextCursor: null }) }
  } as unknown as DocumentReviewApi
  let review!: ReturnType<typeof useDocumentReview>
  const app = renderer.createApp({ setup() {
    review = useDocumentReview({ api, target: () => ({ workItemId: book.value, kind: 'total' }), current: () => ({ title: '总纲', content: '' }),
      readOnly: () => false, composing: () => false, apply: () => false, restore: () => assert.fail('read must not replace text') })
    return () => null
  } })
  app.mount({})
  return { app, review, book, setFailure: (value: unknown) => { failure = value }, counts: () => ({ reads, lists }) }
}

test('new outline has a truthful empty review state and retry discovers its first saved version', async t => {
  const f = fixture(missing('not-created')); t.after(() => f.app.unmount()); await f.review.settled()
  assert.equal(f.review.availability.value, 'absent'); assert.equal(f.review.error.value, '')
  assert.equal(Boolean(f.review.snapshot.value), false); assert.deepEqual(f.counts(), { reads: 1, lists: 0 })
  await f.review.retry(); assert.equal(f.review.error.value, '')
  f.setFailure(null); await f.review.retry()
  assert.equal(f.review.availability.value, 'ready'); assert.equal(f.review.snapshot.value?.content, '')
  assert.deepEqual(f.counts(), { reads: 3, lists: 1 })
})

for (const reason of ['removed', 'missing', undefined]) test(`missing document (${reason}) remains an error, including after retry`, async t => {
  const f = fixture(missing(reason)); t.after(() => f.app.unmount()); await f.review.settled()
  assert.equal(f.review.availability.value, 'error'); assert.equal(f.review.error.value, '文档暂不可读取')
  await f.review.retry(); assert.equal(f.review.error.value, '文档暂不可读取'); assert.equal(f.counts().lists, 0)
})

test('scope change resets absence and a saved empty document is still ready', async t => {
  const f = fixture(missing('not-created')); t.after(() => f.app.unmount()); await f.review.settled()
  f.setFailure(null); f.book.value = 'B'; await nextTick(); await f.review.settled()
  assert.equal(f.review.availability.value, 'ready'); assert.equal(f.review.snapshot.value?.ref.workItemId, 'B')
})
