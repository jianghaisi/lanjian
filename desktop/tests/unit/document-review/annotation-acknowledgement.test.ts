import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer, nextTick, ref } from 'vue'
import { useDocumentReview } from '../../../src/renderer/features/document-review/use-document-review'
import type { DocumentReviewApi, ReviewDraftRecord } from '../../../src/contracts/document-review/api'
import type { AnnotationChangeInput, AnnotationCreateInput, AnnotationListInput, DocumentAnnotation } from '../../../src/contracts/document-review/annotations'
import type { DocumentRef, DocumentSnapshot } from '../../../src/contracts/document-review/types'

const renderer = createRenderer<object, object>({ patchProp() {}, insert() {}, remove() {}, setText() {}, setElementText() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), parentNode: () => null, nextSibling: () => null })
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
const selection = { start: 0, end: 2, text: '原文' }

function fixture() {
  const bookId: string = crypto.randomUUID(), writes: string[] = [], reads: DocumentRef[] = []
  const rows = new Map<string, DocumentAnnotation[]>()
  let checkpoint: ReviewDraftRecord | null = null
  const key = (document: DocumentRef) => JSON.stringify(document)
  const hooks = { beforeWrite: async () => {}, afterWrite: async () => {}, read: async (_input: AnnotationListInput) => {} }
  const snapshot = (kind: DocumentRef['kind'], workItemId = bookId): DocumentSnapshot => ({ ref: { workItemId, kind, documentId: 'same-document-id' }, legacyId: 1, title: '标题', content: '原文', revision: 'r1', versionId: 'v1', hash: 'h'.repeat(64) })
  function put(document: DocumentRef, entry: DocumentAnnotation) { rows.set(key(document), [entry, ...(rows.get(key(document)) || []).filter(item => item.id !== entry.id)]) }
  const annotation = (document: DocumentRef, body: string): DocumentAnnotation => ({ id: crypto.randomUUID(), document, body, status: 'open', revision: 1, anchor: { ...selection, quote: selection.text, before: '', after: '', versionId: 'v1', documentHash: 'h'.repeat(64) }, createdAt: '', updatedAt: '' })
  async function change(input: AnnotationChangeInput & { body?: string }, status?: DocumentAnnotation['status']) {
    writes.push('change'); await hooks.beforeWrite()
    const previous = rows.get(key(input.document))!.find(item => item.id === input.id)!
    assert.equal(input.expectedAnnotationRevision, previous.revision)
    const result = { ...previous, revision: previous.revision + 1, body: input.body ?? previous.body, status: status ?? previous.status }
    put(input.document, result); await hooks.afterWrite(); return result
  }
  const api = {
    readSnapshot: async (input: DocumentRef) => snapshot(input.kind, input.workItemId),
    listReviews: async () => [], recoverDraft: async (document: DocumentRef) => checkpoint && key(checkpoint.document) === key(document) ? checkpoint : null,
    annotations: {
      list: async (input: AnnotationListInput) => {
        reads.push(input.document)
        const items = [...(rows.get(key(input.document)) || [])]
        await hooks.read(input)
        return { items, nextCursor: null }
      },
      create: async (input: AnnotationCreateInput) => {
        writes.push('create'); await hooks.beforeWrite()
        const result = annotation(input.document, input.body)
        if (input.draftText !== '原文') checkpoint = { document: input.document, title: input.title, content: input.draftText,
          baseRevision: input.expectedRevision, revision: 1, stagedDecisionIds: [], updatedAt: '', positions: {}, anchors: {} }
        put(input.document, result); await hooks.afterWrite(); return result
      },
      update: change, reanchor: change,
      resolve: (input: AnnotationChangeInput) => change(input, 'resolved'),
      reopen: (input: AnnotationChangeInput) => change(input, 'open'),
      remove: (input: AnnotationChangeInput) => change(input, 'deleted')
    }
  } as unknown as DocumentReviewApi
  function mount(initialKind: DocumentRef['kind'] = 'total', initialBook = bookId) {
    const kind = ref(initialKind), book = ref(initialBook), content = ref('原文')
    let controller!: ReturnType<typeof useDocumentReview>
    const app = renderer.createApp({ setup() {
      controller = useDocumentReview({ api, target: () => ({ ...snapshot(kind.value, book.value).ref, legacyId: 1 }),
        current: () => ({ title: '标题', content: content.value }), readOnly: () => false, composing: () => false,
        apply: () => assert.fail('annotation writes must not replace text'), restore: () => assert.fail('annotation writes must not restore text') })
      return () => null
    } })
    app.mount({})
    return { controller, kind, book, content, unmount: () => app.unmount() }
  }
  return { mount, hooks, writes, reads, snapshot, rows, key, put, annotation }
}

test('a confirmed create remains successful when the following list read fails; retry only reads', async t => {
  const f = fixture(), current = f.mount(); t.after(current.unmount); await current.controller.settled()
  const previous = current.controller.annotations.value
  f.hooks.read = async () => { throw new Error('列表暂时不可读') }
  const saved = await current.controller.createAnnotation('补充动机', selection, crypto.randomUUID())
  assert.equal(saved.body, '补充动机')
  assert.equal(current.controller.annotations.value, previous)
  assert.match(current.controller.error.value, /批注已保存.*列表暂时不可读/)
  f.hooks.read = async () => {}
  await current.controller.retry()
  assert.deepEqual(current.controller.annotations.value, [saved])
  assert.equal(current.controller.error.value, '')
  assert.deepEqual(f.writes, ['create'])
})

for (const action of ['update', 'resolve', 'reopen', 'remove', 'reanchor'] as const) test(`confirmed ${action} is not reported as a failed write when refresh fails`, async t => {
  const f = fixture(), document = f.snapshot('total').ref
  const original = f.annotation(document, '原意见'); f.put(document, original)
  const current = f.mount(); t.after(current.unmount); await current.controller.settled()
  f.hooks.read = async () => { throw new Error('回读失败') }
  await current.controller.changeAnnotation(action, original, crypto.randomUUID(), '修改意见', selection)
  assert.equal(f.rows.get(f.key(document))?.[0]?.revision, 2)
  assert.match(current.controller.error.value, /批注已保存.*回读失败/)
  f.hooks.read = async () => {}; await current.controller.retry()
  assert.equal(current.controller.annotations.value[0]?.revision, 2)
  assert.deepEqual(f.writes, ['change'])
})

test('an unconfirmed write still rejects and preserves the visible comments', async t => {
  const f = fixture(), current = f.mount(); t.after(current.unmount); await current.controller.settled()
  f.hooks.beforeWrite = async () => { throw new Error('磁盘写入失败') }
  await assert.rejects(current.controller.createAnnotation('保留输入', selection, crypto.randomUUID()), /磁盘写入失败/)
  assert.deepEqual(current.controller.annotations.value, [])
  assert.equal(f.rows.size, 0)
  assert.match(current.controller.error.value, /磁盘写入失败/)
  assert.doesNotMatch(current.controller.error.value, /已保存/)
})

for (const initialReadPending of [false, true]) test(`a late confirmed write refreshes a remounted editor even when its initial read is ${initialReadPending ? 'pending' : 'complete'}`, async t => {
  const f = fixture(), first = f.mount(); await first.controller.settled()
  const writeGate = deferred(), writeReached = deferred()
  f.hooks.beforeWrite = async () => { writeReached.resolve(); await writeGate.promise }
  const saving = first.controller.createAnnotation('提交中的意见', selection, crypto.randomUUID())
  await writeReached.promise; first.unmount()
  const readGate = deferred(), readReached = deferred()
  if (initialReadPending) f.hooks.read = async () => { readReached.resolve(); await readGate.promise }
  const next = f.mount(); t.after(next.unmount)
  if (initialReadPending) await readReached.promise
  else { await next.controller.settled(); assert.deepEqual(next.controller.annotations.value, []) }
  writeGate.resolve()
  try { await saving } finally { readGate.resolve() }
  await next.controller.settled(); await nextTick(); await next.controller.settled()
  assert.equal(next.controller.annotations.value[0]?.body, '提交中的意见')
  assert.equal(next.controller.error.value, '')
  assert.deepEqual(f.writes, ['create'])
  assert.equal(f.reads.length, 3) // Old initial read, new initial read and one invalidation read.
})

test('a late save never refreshes another book or document kind with the same document ID', async t => {
  const f = fixture(), current = f.mount(); t.after(current.unmount); await current.controller.settled()
  const otherKind = f.mount('body'), otherBook = f.mount('total', 'different-book')
  t.after(otherKind.unmount); t.after(otherBook.unmount)
  await Promise.all([otherKind.controller.settled(), otherBook.controller.settled()])
  const gate = deferred(), reached = deferred()
  f.hooks.afterWrite = async () => { reached.resolve(); await gate.promise }
  const saving = current.controller.createAnnotation('总纲意见', selection, crypto.randomUUID())
  await reached.promise
  current.book.value = 'next-book'; await nextTick(); gate.resolve(); await saving; await current.controller.settled()
  assert.equal(current.controller.snapshot.value?.ref.workItemId, 'next-book')
  for (const instance of [current, otherKind, otherBook]) {
    await instance.controller.settled()
    assert.deepEqual(instance.controller.annotations.value, [])
    assert.equal(instance.controller.error.value, '')
  }
  assert.equal(f.reads.length, 4)
  current.book.value = f.snapshot('total').ref.workItemId; await nextTick(); await current.controller.settled()
  assert.equal(current.controller.annotations.value[0]?.body, '总纲意见')
  assert.equal(f.reads.length, 5) // Historical notifications do not add a redundant read on navigation.
})

test('a new editor exposes a truthful refresh warning after a late save and can reread without another write', async t => {
  const f = fixture(), first = f.mount(); await first.controller.settled()
  const gate = deferred(), reached = deferred()
  f.hooks.beforeWrite = async () => { reached.resolve(); await gate.promise }
  const saving = first.controller.createAnnotation('迟到回执', selection, crypto.randomUUID())
  await reached.promise; first.unmount()
  const next = f.mount(); t.after(next.unmount); await next.controller.settled()
  f.hooks.read = async () => { throw new Error('稍后读取') }
  gate.resolve(); await saving; await nextTick(); await next.controller.settled()
  assert.match(next.controller.error.value, /批注已保存.*稍后读取/)
  f.hooks.read = async () => {}; await next.controller.retry()
  assert.equal(next.controller.annotations.value[0]?.body, '迟到回执')
  assert.deepEqual(f.writes, ['create'])
})

test('late annotation checkpoints expose draft recovery without overwriting the remounted editor', async t => {
  const f = fixture(), first = f.mount(); await first.controller.settled()
  first.content.value = '原文中的未保存补充'
  const gate = deferred(), reached = deferred()
  f.hooks.beforeWrite = async () => { reached.resolve(); await gate.promise }
  const saving = first.controller.createAnnotation('针对未保存草稿的意见', selection, crypto.randomUUID())
  await reached.promise; first.unmount()
  const next = f.mount(); t.after(next.unmount); await next.controller.settled()
  gate.resolve(); await saving; await nextTick(); await next.controller.settled()
  assert.equal(next.controller.annotations.value[0]?.body, '针对未保存草稿的意见')
  assert.equal(next.controller.draft.value?.content, '原文中的未保存补充')
  assert.equal(next.content.value, '原文')
  assert.equal(next.controller.recovery.value, true)
  assert.deepEqual(f.writes, ['create'])
})
