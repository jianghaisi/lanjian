import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer, nextTick, ref } from 'vue'
import { useDocumentReview } from '../../../src/renderer/features/document-review/use-document-review'
import type { DocumentReviewApi, ReviewDraftRecord, ReviewSaveResult } from '../../../src/contracts/document-review/api'
import type { DocumentRef, DocumentReview, DocumentSnapshot } from '../../../src/contracts/document-review/types'

const renderer = createRenderer<object, object>({ patchProp() {}, insert() {}, remove() {}, setText() {}, setElementText() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), parentNode: () => null, nextSibling: () => null })
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
function fixture(kind: DocumentRef['kind'] = 'body') {
  const book = ref('A'), content = ref('保留后的修改'), calls: string[] = []
  let written = false
  const snapshot = (workItemId = 'A'): DocumentSnapshot => ({ ref: { workItemId, kind, documentId: `${workItemId}-${kind}` }, legacyId: 1,
    title: '标题', content: workItemId === 'B' ? 'B 原稿' : written ? '保留后的修改' : '原稿', revision: written && workItemId === 'A' ? 'r2' : 'r1', versionId: written ? 'v2' : 'v1', hash: 'h'.repeat(64) })
  const draft = (document: DocumentRef): ReviewDraftRecord => ({ document, title: '标题', content: document.workItemId === 'A' ? '保留后的修改' : 'B 原稿',
    baseRevision: snapshot(document.workItemId).revision, revision: written ? 2 : 1, stagedDecisionIds: written ? [] : ['block'], updatedAt: '', positions: {}, anchors: {} })
  const review = (document: DocumentRef): DocumentReview => ({ id: 'review', document, source: { taskId: 'task', artifactId: 'artifact', artifactType: 'writing_agent_turn', artifactHash: 'a'.repeat(64) },
    baseVersionId: 'v1', baseRevision: 'r1', baseDraft: '原稿', createdAt: '', blocks: [{ id: 'block', sessionId: 'review', status: written ? 'committed' : 'staged', replacement: '保留后的修改', anchor: { start: 0, end: 2, quote: '原稿', before: '', after: '', versionId: 'v1', documentHash: 'h'.repeat(64) } }] })
  const hooks = { beforeSave: async () => {}, read: async (_kind: string) => {} }
  let result: ReviewSaveResult | null = null
  const api = {
    readSnapshot: async (document: DocumentRef) => snapshot(document.workItemId),
    listReviews: async (document: DocumentRef) => { await hooks.read('reviews'); return [review(document)] },
    recoverDraft: async (document: DocumentRef) => { await hooks.read('draft'); return draft(document) },
    annotations: { list: async () => { await hooks.read('annotations'); return { items: [], nextCursor: null } } },
    saveReviewedDraft: async () => {
      calls.push('save'); await hooks.beforeSave(); written = true
      result = { snapshot: snapshot(), receipt: { id: 'application', document: snapshot().ref, previousVersionId: 'v1', versionId: 'v2', revision: 'r2', contentHash: 'h'.repeat(64), sourceLinks: [{ ...review(snapshot().ref).source, blockIds: ['block'] }] } }
      return result
    }
  } as unknown as DocumentReviewApi
  let controller!: ReturnType<typeof useDocumentReview>
  const app = renderer.createApp({ setup() {
    controller = useDocumentReview({ api, target: () => ({ ...snapshot(book.value).ref, legacyId: 1 }), current: () => ({ title: '标题', content: content.value }),
      readOnly: () => false, composing: () => false, apply: () => assert.fail('saving must not replace author input'), restore: () => assert.fail('saving must not restore input') })
    return () => null
  } })
  app.mount({})
  return { controller, book, content, calls, hooks, unmount: () => app.unmount(), written: () => written, result: () => result }
}

for (const kind of ['body', 'total'] as const) for (const failed of ['reviews', 'draft', 'annotations']) test(`${kind}: confirmed save survives failed ${failed} refresh, and retry only rereads`, async t => {
  const f = fixture(kind); t.after(f.unmount); await f.controller.settled()
  const previous = f.controller.reviews.value
  // The preload bridge throws validated IPC error DTOs, while local failures
  // can be Error instances. Both must preserve a confirmed save receipt.
  const readFailure = kind === 'body' ? { code: 'STORAGE_ERROR', message: '读取中断', recoverable: true } : new Error('读取中断')
  f.hooks.read = async type => { if (type === failed) throw readFailure }
  const result = await f.controller.save({ title: '标题', content: f.content.value })
  assert.equal(result, f.result()); assert.equal(result?.receipt?.id, 'application'); assert.equal(f.written(), true)
  assert.equal(f.controller.snapshot.value?.revision, 'r2'); assert.equal(f.controller.reviews.value, previous)
  assert.match(f.controller.error.value, kind === 'body' ? /已保存.*读取暂不可用/ : /已保存.*读取中断/); assert.equal(f.content.value, '保留后的修改')
  await assert.rejects(f.controller.save({ title: '标题', content: f.content.value }), /已保存/)
  f.hooks.read = async () => {}; await f.controller.retry()
  assert.equal(f.controller.error.value, ''); assert.equal(f.controller.staged.value, 0)
  assert.equal(f.controller.reviews.value[0]?.blocks[0]?.status, 'committed')
  assert.deepEqual(f.calls, ['save'])
})

test('unconfirmed save failure preserves the staged draft and never reports it as saved', async t => {
  const f = fixture(); t.after(f.unmount); await f.controller.settled()
  f.hooks.beforeSave = async () => { throw new Error('写入失败') }
  await assert.rejects(f.controller.save({ title: '标题', content: f.content.value }), /写入失败/)
  assert.equal(f.written(), false); assert.equal(f.controller.snapshot.value?.revision, 'r1')
  assert.equal(f.controller.staged.value, 1); assert.equal(f.content.value, '保留后的修改')
  assert.doesNotMatch(f.controller.error.value, /已保存/)
})

for (const change of ['book', 'unmount'] as const) test(`confirmed save refreshing after ${change} does not return a receipt to an obsolete editor`, async t => {
  const f = fixture(), gate = deferred(), reached = deferred(); await f.controller.settled()
  if (change === 'book') t.after(f.unmount)
  f.hooks.read = async () => { reached.resolve(); await gate.promise; throw new Error('旧文档读取失败') }
  const pending = f.controller.save({ title: '标题', content: f.content.value }); await reached.promise
  if (change === 'book') { f.book.value = 'B'; f.content.value = 'B 原稿'; await nextTick() } else f.unmount()
  f.hooks.read = async () => {}; gate.resolve()
  await assert.rejects(pending, /切换/); await f.controller.settled()
  assert.equal(f.written(), true); assert.deepEqual(f.calls, ['save'])
  if (change === 'book') { assert.equal(f.controller.snapshot.value?.ref.workItemId, 'B'); assert.equal(f.controller.error.value, ''); assert.equal(f.content.value, 'B 原稿') }
})

test('new typing during a confirmed save refresh remains local and retry asks for recovery instead of replacing it', async t => {
  const f = fixture(); t.after(f.unmount); await f.controller.settled()
  const gate = deferred(), reached = deferred()
  f.hooks.read = async type => { if (type === 'reviews') { reached.resolve(); await gate.promise; throw new Error('读取中断') } }
  const pending = f.controller.save({ title: '标题', content: f.content.value }); await reached.promise
  f.content.value = '保存后继续写的新内容'; gate.resolve(); await pending
  assert.equal(f.controller.snapshot.value?.content, '保留后的修改'); assert.equal(f.content.value, '保存后继续写的新内容')
  f.hooks.read = async () => {}; await f.controller.retry()
  assert.equal(f.controller.recovery.value, true); assert.equal(f.content.value, '保存后继续写的新内容')
  assert.deepEqual(f.calls, ['save'])
})
