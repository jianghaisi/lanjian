import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer, nextTick, ref } from 'vue'
import { useDocumentReview } from '../../../src/renderer/features/document-review/use-document-review'
import type { DocumentReviewApi, ReviewDraftRecord } from '../../../src/contracts/document-review/api'
import type { DocumentAnnotation, AnnotationListInput } from '../../../src/contracts/document-review/annotations'
import type { DocumentReview, DocumentSnapshot } from '../../../src/contracts/document-review/types'

const renderer = createRenderer<object, object>({ patchProp() {}, insert() {}, remove() {}, setText() {}, setElementText() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), parentNode: () => null, nextSibling: () => null })
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
function fixture(count = 70) {
  const book = ref('A'), readOnly = ref(false), composing = ref(false), content = ref('原文')
  const snapshot = (id: string): DocumentSnapshot => ({ ref: { workItemId: id, kind: 'body', documentId: `${id}-chapter` }, legacyId: 1, title: id, content: '原文', versionId: 'v1', revision: 'r1', hash: 'hash' })
  const draft = (id: string): ReviewDraftRecord => ({ document: snapshot(id).ref, title: id, content: '原文', baseRevision: 'r1', revision: 1, stagedDecisionIds: [], updatedAt: '', positions: {}, anchors: {} })
  let entries: DocumentAnnotation[] = Array.from({ length: count }, (_, i) => ({ id: `annotation-${i}`, document: snapshot('A').ref, revision: 1, body: `批注 ${i}`, status: 'open', anchor: { start: 0, end: 2, quote: '原文', before: '', after: '', versionId: 'v1', documentHash: 'hash' }, createdAt: '', updatedAt: '' }))
  const calls: string[] = []
  const hooks = { page: async (_input: AnnotationListInput) => {}, prepare: async () => {} }
  const api = {
    readSnapshot: async (input: { workItemId: string }) => snapshot(input.workItemId),
    listReviews: async () => [], recoverDraft: async (document: { workItemId: string }) => draft(document.workItemId),
    syncDraft: async (input: { changes: Array<{ from: number; to: number; insert: string }> }) => {
      calls.push('checkpoint')
      let text = controller.draft.value!.content
      for (const change of [...input.changes].reverse()) text = text.slice(0, change.from) + change.insert + text.slice(change.to)
      return { ...draft(book.value), content: text, revision: controller.draft.value!.revision + 1 }
    },
    annotations: {
      list: async (input: AnnotationListInput) => {
        calls.push(`list ${input.document.workItemId} ${input.cursor || 0}`)
        await hooks.page(input)
        const cursor = input.cursor || 0, rows = input.document.workItemId === 'A' ? entries : []
        return { items: rows.slice(cursor, cursor + 50), nextCursor: rows.length > cursor + 50 ? cursor + 50 : null }
      },
      resolve: async (input: { id: string }) => {
        calls.push('resolve')
        const previous = entries.find(item => item.id === input.id)!
        const updated = { ...previous, revision: previous.revision + 1, status: 'resolved' as const }
        entries = [updated, ...entries.filter(item => item.id !== input.id)]
        return updated
      },
      create: async () => { calls.push('create'); return entries[0] }
    },
    prepareDecision: async () => { calls.push('prepare'); await hooks.prepare(); return { id: 'permit', start: 0, end: 2, replacement: '修改', resultingDraftHash: 'next-hash' } },
    acknowledgeStage: async () => { calls.push('acknowledge'); return draft('A') },
    discardDecision: async () => { calls.push('discard'); return [] },
    useLatestDraft: async () => { calls.push('useLatest'); return draft('A') },
    saveReviewedDraft: async () => { calls.push('save'); return { snapshot: snapshot('A'), receipt: null } },
    recoveryHistory: async () => [],
  } as unknown as DocumentReviewApi
  let controller!: ReturnType<typeof useDocumentReview>
  const app = renderer.createApp({ setup() {
    const ports = { api, target: () => ({ workItemId: book.value, kind: 'body' as const, legacyId: 1 }), current: () => ({ title: book.value, content: content.value }), readOnly: () => readOnly.value, composing: () => composing.value,
      apply: () => { calls.push('apply'); content.value = '修改'; return true }, restore: (_title: string, value: string) => { calls.push('restore'); content.value = value } }
    controller = useDocumentReview(ports)
    return () => null
  } })
  app.mount({})
  return { app, controller, calls, hooks, book, readOnly, composing, content }
}

test('editing an older annotation preserves all expanded pages and its updated revision', async t => {
  const f = fixture(); t.after(() => f.app.unmount()); await f.controller.settled()
  await f.controller.loadMoreAnnotations()
  assert.equal(f.controller.annotations.value.length, 70)
  const older = f.controller.annotations.value[65]!
  await f.controller.changeAnnotation('resolve', older, 'resolve-operation')
  assert.equal(f.controller.annotations.value.length, 70)
  assert.equal(new Set(f.controller.annotations.value.map(item => item.id)).size, 70)
  assert.equal(f.controller.annotations.value.find(item => item.id === older.id)?.status, 'resolved')
  assert.equal(f.controller.annotationCursor.value, null)
})

test('repeated load-more clicks request only one page and leave the next page available', async t => {
  const f = fixture(120); t.after(() => f.app.unmount()); await f.controller.settled()
  const gate = deferred(), reached = deferred()
  f.hooks.page = async input => { if (input.cursor === 50) { reached.resolve(); await gate.promise } }
  const first = f.controller.loadMoreAnnotations(); await reached.promise
  assert.equal(f.controller.annotationsLoading.value, true)
  const second = f.controller.loadMoreAnnotations()
  gate.resolve(); await Promise.all([first, second])
  assert.equal(f.controller.annotations.value.length, 100)
  assert.equal(f.controller.annotationCursor.value, 100)
  assert.equal(f.controller.annotationsLoading.value, false)
  assert.equal(f.calls.filter(call => call.startsWith('list')).length, 2)
  await f.controller.loadMoreAnnotations()
  assert.equal(f.controller.annotations.value.length, 120)
})

test('failed expanded refresh keeps existing comments and cursor, then retries every expanded page', async t => {
  const f = fixture(120); t.after(() => f.app.unmount()); await f.controller.settled(); await f.controller.loadMoreAnnotations()
  const previous = f.controller.annotations.value
  f.hooks.page = async input => { if (input.cursor === 50) throw new Error('读取失败') }
  await assert.rejects(f.controller.refresh(), /读取失败/)
  assert.equal(f.controller.annotations.value, previous)
  assert.equal(f.controller.annotationCursor.value, 100)
  f.hooks.page = async () => {}
  await f.controller.retry()
  assert.equal(f.controller.error.value, '')
  assert.equal(f.controller.annotations.value.length, 100)
})

test('late annotation pages cannot enter another book or keep its load-more control busy', async t => {
  const f = fixture(120); t.after(() => f.app.unmount()); await f.controller.settled()
  const gate = deferred(), reached = deferred()
  f.hooks.page = async input => { if (input.cursor) { reached.resolve(); await gate.promise } }
  const pending = f.controller.loadMoreAnnotations(); await reached.promise
  f.book.value = 'B'; await nextTick(); gate.resolve(); await pending; await f.controller.settled()
  assert.equal(f.controller.snapshot.value?.ref.workItemId, 'B')
  assert.deepEqual(f.controller.annotations.value, [])
  assert.equal(f.controller.annotationCursor.value, null)
  assert.equal(f.controller.annotationsLoading.value, false)
})

test('author IME input still creates recovery checkpoints without replacing text or raising a review error', async t => {
  const f = fixture(); t.after(() => f.app.unmount()); await f.controller.settled()
  f.composing.value = true; f.content.value = '原文中'
  f.controller.changed({ before: '原文', content: '原文中', changes: [{ from: 2, to: 2, insert: '中' }], userEvent: 'input.type.compose' })
  await f.controller.settled()
  assert.equal(f.controller.draft.value?.content, '原文中')
  assert.equal(f.controller.error.value, '')
  assert.equal(f.content.value, '原文中')
  assert.ok(!f.calls.includes('restore'))
})

test('read-only documents disable red suggestions and cannot discard, restore or replace recovery drafts', async t => {
  const f = fixture(); t.after(() => f.app.unmount()); await f.controller.settled()
  f.controller.reviews.value = [{ blocks: [{ id: 'block', anchor: { start: 0, end: 2 } }] }] as DocumentReview[]
  f.readOnly.value = true
  assert.equal(f.controller.items.value[0]?.busy, true)
  await f.controller.decide('block', 'reject')
  f.controller.draft.value = { ...f.controller.draft.value!, content: '未保存修订' }
  f.controller.recovery.value = true
  f.controller.restore(); await f.controller.useLatest()
  assert.equal(f.content.value, '原文')
  assert.ok(!f.calls.some(call => ['discard', 'restore', 'useLatest'].includes(call)))
})

for (const lock of ['readOnly', 'composing'] as const) test(`${lock} starting during a prepare request prevents late review adoption`, async t => {
  const f = fixture(); t.after(() => f.app.unmount()); await f.controller.settled()
  const gate = deferred(), reached = deferred()
  f.hooks.prepare = async () => { reached.resolve(); await gate.promise }
  const pending = f.controller.decide('block', 'retain'); await reached.promise
  f[lock].value = true; gate.resolve(); await pending
  assert.equal(f.content.value, '原文')
  assert.ok(!f.calls.includes('apply')); assert.ok(!f.calls.includes('acknowledge'))
})

test('queued decisions and annotation/save writes recheck read-only state before calling the API', async t => {
  const f = fixture(); t.after(() => f.app.unmount()); await f.controller.settled()
  const pending = f.controller.decide('block', 'reject')
  f.readOnly.value = true; await pending
  assert.ok(!f.calls.includes('discard'))
  await assert.rejects(f.controller.createAnnotation('意见', { start: 0, end: 2, text: '原文' }, 'create-operation'), /只读|不可编辑/)
  await assert.rejects(f.controller.changeAnnotation('resolve', f.controller.annotations.value[0]!, 'resolve-operation'), /只读|不可编辑/)
  await assert.rejects(f.controller.prepareGeneration(), /只读|不可编辑/)
  await assert.rejects(f.controller.save({ title: 'A', content: '原文' }), /只读|不可编辑/)
  assert.ok(!f.calls.some(call => ['create', 'resolve', 'save'].includes(call)))
})
