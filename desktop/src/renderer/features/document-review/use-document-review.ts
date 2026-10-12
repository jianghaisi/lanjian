import { computed, onBeforeUnmount, ref, shallowReactive, shallowRef, watch } from 'vue'
import type { DocumentLocator, DocumentRef, DocumentReview, DocumentSnapshot } from '../../../contracts/document-review/types'
import type { DocumentReviewApi, ReviewDraftRecord, ReviewSaveResult } from '../../../contracts/document-review/api'
import type { TextChange } from '../../../contracts/document-review/anchors'
import { locateTextAnchor, mapAnchorProjection } from '../../../contracts/document-review/anchors'
import type { DocumentAnnotation } from '../../../contracts/document-review/annotations'
import { snapshotChange } from '../../../contracts/document-review/text-change'
import type { InlineReviewItem } from './inline-review'

type Edit = { before: string; content: string; changes: TextChange[]; userEvent: string }
type Ports = {
  api: DocumentReviewApi
  target: () => DocumentLocator
  current: () => { title: string; content: string }
  readOnly: () => boolean
  composing: () => boolean
  apply: (expected: string, start: number, end: number, replacement: string) => boolean
  restore: (title: string, content: string) => void
}
// Window-local invalidation only: a saved opinion may outlive its editor.
// Readers still obtain all annotation/checkpoint data from the main process.
const annotationChanges = shallowReactive(new Map<string, number>())
let annotationChangeSequence = 0
const annotationDocumentKey = (document: DocumentRef) => JSON.stringify([document.workItemId, document.kind, document.documentId])
const errorText = (cause: unknown, fallback: string) => cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string' ? cause.message : fallback
/** One document-scoped queue orders editor transactions, staging and saves. */
export function useDocumentReview(ports: Ports) {
  const snapshot = shallowRef<DocumentSnapshot | null>(null)
  const availability = ref<'loading' | 'absent' | 'ready' | 'error' | 'unavailable'>('loading')
  const draft = shallowRef<ReviewDraftRecord | null>(null)
  const reviews = shallowRef<DocumentReview[]>([])
  const annotations = shallowRef<DocumentAnnotation[]>([])
  const annotationCursor = ref<number | null>(null)
  const annotationsLoading = ref(false)
  const annotationOpen = ref(false)
  const recoveryHistory = shallowRef<ReviewDraftRecord[]>([])
  const baseChanged = computed(() => Boolean(draft.value && snapshot.value && draft.value.baseRevision !== snapshot.value.revision))
  const busy = ref(false), error = ref(''), recovery = ref(false)
  const inputLocked = computed(() => ports.readOnly() || ports.composing())
  let annotationPageCount = 1
  let seenAnnotationChange = annotationChangeSequence
  let epoch = 0, disposed = false, applying = false
  let queue: Promise<unknown> = Promise.resolve()
  const active = computed(() => reviews.value.length > 0 || Boolean(draft.value))
  function annotationPosition(annotation: DocumentAnnotation) {
    const content = ports.current().content, stored = draft.value?.positions[`annotation:${annotation.id}`]
    if (stored && draft.value) return mapAnchorProjection(stored, snapshotChange(draft.value.content, content))
    return locateTextAnchor(content, annotation.anchor, content === snapshot.value?.content ? snapshot.value.hash : undefined)
  }
  const annotationMarks = computed(() => annotations.value.filter(item => item.status === 'open').map(annotation => ({ id: annotation.id, position: annotationPosition(annotation) })))
  const items = computed<InlineReviewItem[]>(() => reviews.value.flatMap(review => review.blocks.map(block => ({
    block, position: draft.value?.positions[block.id] || { start: block.anchor.start, end: block.anchor.end, status: 'needs-relocation' as const },
    busy: busy.value || recovery.value || Boolean(error.value) || inputLocked.value
  }))))
  const pending = computed(() => reviews.value.flatMap(r => r.blocks).filter(b => b.status === 'pending').length)
  const staged = computed(() => draft.value?.stagedDecisionIds.length || 0)
  function scope() {
    const token = epoch
    return () => { if (disposed || token !== epoch) throw new Error('文档已经切换，修订未应用。') }
  }
  function checkEditable() {
    if (ports.readOnly()) throw new Error('当前文档暂不可编辑，请先处理只读提示。')
    if (ports.composing()) throw new Error('请先完成当前输入，再处理修订或批注。')
  }
  function enqueue<T>(operation: (check: () => void) => Promise<T>): Promise<T> {
    const token = epoch
    const result = queue.then(async () => {
      if (disposed || token !== epoch) throw new Error('文档已经切换，修订未应用。')
      return operation(scope())
    })
    queue = result.catch(cause => { if (!disposed && token === epoch) error.value = errorText(cause, '修订操作失败，稿件仍保留。') })
    return result
  }
  async function readExpandedAnnotations(document: DocumentRef, check: () => void) {
    const items: DocumentAnnotation[] = []
    let cursor: number | null = null, pages = 0
    do {
      const page = await ports.api.annotations.list({ document, ...(cursor === null ? {} : { cursor }), includeDeleted: true })
      check()
      items.push(...page.items); cursor = page.nextCursor; pages++
    } while (cursor !== null && pages < annotationPageCount)
    return { items, nextCursor: cursor, pages }
  }
  async function refresh() {
    const check = scope()
    const document = snapshot.value!.ref
    const [nextReviews, nextDraft, page] = await Promise.all([ports.api.listReviews(document), ports.api.recoverDraft(document), readExpandedAnnotations(document, check)])
    check()
    reviews.value = nextReviews; draft.value = nextDraft
    annotations.value = page.items; annotationCursor.value = page.nextCursor
    annotationPageCount = page.pages
  }
  async function refreshConfirmedAnnotations(token: number, checkRecovery = false) {
    if (disposed || token !== epoch) return
    try {
      await refresh()
      if (!disposed && token === epoch) {
        if (checkRecovery) recovery.value = Boolean(draft.value && (baseChanged.value || draft.value.content !== ports.current().content || draft.value.title !== ports.current().title))
        error.value = ''
      }
    } catch (cause) {
      if (!disposed && token === epoch) error.value = `批注已保存，但列表刷新失败：${cause instanceof Error ? cause.message : '读取暂不可用'}。请点击“重新核对”。`
    }
  }
  async function acknowledgeAnnotationWrite(document: DocumentRef, token: number) {
    const sequence = ++annotationChangeSequence
    if (!disposed && token === epoch) seenAnnotationChange = sequence
    annotationChanges.set(annotationDocumentKey(document), sequence)
    // A confirmed write must not become a failed submission just because the
    // original editor closed or its follow-up read failed.
    await refreshConfirmedAnnotations(token)
  }
  watch(() => snapshot.value ? annotationChanges.get(annotationDocumentKey(snapshot.value.ref)) || 0 : 0, sequence => {
    if (sequence <= seenAnnotationChange) return
    seenAnnotationChange = sequence
    const token = epoch
    void enqueue(() => refreshConfirmedAnnotations(token, true)).catch(() => undefined)
  })
  async function sync(title: string, content: string, changes?: TextChange[], before?: string, historyDirection?: 'undo' | 'redo') {
    const check = scope()
    if (!active.value || !draft.value || !snapshot.value) return
    if (recovery.value) throw new Error('有尚未恢复的修订稿，请先核对恢复稿。')
    if (draft.value.content === content && draft.value.title === title && !historyDirection) return
    // Checkpoint author input even during IME; only actions that replace text
    // or commit decisions are gated. A checkpoint never overwrites the editor.
    const nextDraft = await ports.api.syncDraft({ document: snapshot.value.ref, expectedDraftRevision: draft.value.revision,
      title, changes: changes && before === draft.value.content ? changes : snapshotChange(draft.value.content, content),
      ...(historyDirection ? { historyDirection } : {}) })
    check(); draft.value = nextDraft
    if (historyDirection) { const next = await ports.api.listReviews(snapshot.value.ref); check(); reviews.value = next }
  }
  function changed(edit: Edit) {
    if (applying || !active.value || recovery.value) return
    const title = ports.current().title
    const history = edit.userEvent === 'undo' || edit.userEvent === 'redo' ? edit.userEvent : undefined
    void enqueue(() => sync(title, edit.content, edit.changes, edit.before, history)).catch(() => undefined)
  }
  function history(direction: 'undo' | 'redo', title: string, content: string) {
    if (!active.value || recovery.value) return
    void enqueue(() => sync(title, content, undefined, undefined, direction)).catch(() => undefined)
  }
  async function open(taskId: string, allowFailedReview = false) {
    return enqueue(async check => {
      checkEditable()
      if (!snapshot.value) { const next = await ports.api.readSnapshot(ports.target()); check(); snapshot.value = next }
      checkEditable()
      const existing = reviews.value.find(review => review.source.taskId === taskId)
      if (!existing) { await ports.api.openReview({ document: snapshot.value.ref, taskId, allowFailedReview }); check() }
      await refresh(); check()
      const current = ports.current()
      if (draft.value?.stagedDecisionIds.length && draft.value.content !== current.content) { recovery.value = true; return }
      await sync(current.title, current.content); check()
      error.value = ''
    })
  }
  async function decide(id: string, action: 'retain' | 'reject') {
    if (busy.value || recovery.value || inputLocked.value) return
    const token = epoch
    busy.value = true
    try {
      await enqueue(async check => {
        checkEditable()
        if (!snapshot.value) throw new Error('文档尚未加载。')
        if (error.value) throw new Error(error.value)
        const current = ports.current()
        await sync(current.title, current.content); check()
        checkEditable()
        if (action === 'reject') {
          const next = await ports.api.discardDecision({ document: snapshot.value.ref, blockId: id, operationId: crypto.randomUUID() }); check(); reviews.value = next
          return
        }
        const permit = await ports.api.prepareDecision({ document: snapshot.value.ref, blockId: id,
          operationId: crypto.randomUUID(), expectedDraftRevision: draft.value!.revision })
        check()
        checkEditable()
        applying = true
        try {
          if (ports.composing() || !ports.apply(current.content, permit.start, permit.end, permit.replacement)) throw new Error('编辑稿已经变化，请重新核对这处修订。')
          const next = await ports.api.acknowledgeStage({ document: snapshot.value.ref, permitId: permit.id, resultingDraftHash: permit.resultingDraftHash }); check(); draft.value = next
        } finally { applying = false }
        const next = await ports.api.listReviews(snapshot.value.ref); check(); reviews.value = next
      })
    } catch { /* queue exposes the recoverable error; never fall through to a manual write */ }
    finally { if (token === epoch) busy.value = false }
  }
  async function save(value: { title: string; content: string }): Promise<ReviewSaveResult | null> {
    return enqueue(async check => {
      checkEditable()
      if (!active.value) return null
      if (error.value) throw new Error(error.value)
      if (ports.current().content !== value.content || ports.current().title !== value.title) throw new Error('编辑稿继续变化，请保存最新输入。')
      await sync(value.title, value.content); check()
      checkEditable()
      const result = await ports.api.saveReviewedDraft({ document: snapshot.value!.ref, operationId: crypto.randomUUID(),
        expectedDraftRevision: draft.value!.revision, expectedRevision: draft.value!.baseRevision })
      check(); snapshot.value = result.snapshot
      try { await refresh(); check() }
      catch (cause) {
        // Formal storage has already acknowledged this write. Keep the
        // receipt successful while stale review state waits for a read retry.
        check()
        error.value = `稿件已保存，但修订记录刷新失败：${cause instanceof Error ? cause.message : '读取暂不可用'}。请点击“重新核对”。`
      }
      return result
    })
  }
  async function readTarget(check: () => void) {
    availability.value = 'loading'
    try {
      const next = await ports.api.readSnapshot(ports.target()); check()
      const [nextReviews, nextDraft, page] = await Promise.all([ports.api.listReviews(next.ref), ports.api.recoverDraft(next.ref), readExpandedAnnotations(next.ref, check)])
      check()
      snapshot.value = next; reviews.value = nextReviews; draft.value = nextDraft
      annotations.value = page.items; annotationCursor.value = page.nextCursor; annotationPageCount = page.pages
      recovery.value = Boolean(nextDraft && (nextDraft.baseRevision !== next.revision || nextDraft.content !== ports.current().content || nextDraft.title !== ports.current().title))
      availability.value = 'ready'; error.value = ''
    } catch (cause) {
      check()
      const failure = cause as { code?: string; details?: { reason?: string } } | null
      if (!snapshot.value && failure?.code === 'NOT_FOUND' && failure.details?.reason === 'not-created') {
        availability.value = 'absent'; error.value = ''
      } else if (failure?.code === 'FEATURE_UNAVAILABLE') {
        availability.value = 'unavailable'; error.value = ''
      } else {
        availability.value = 'error'; error.value = errorText(cause, '修订记录暂时无法读取，请重试。')
      }
    }
  }
  async function retry() { await enqueue(readTarget).catch(() => undefined) }
  function restore() {
    if (!draft.value || inputLocked.value || busy.value || baseChanged.value) return
    applying = true
    ports.restore(draft.value.title, draft.value.content)
    applying = false
    recovery.value = false; error.value = ''
  }
  async function useLatest() {
    if (inputLocked.value || busy.value) return
    const token = epoch
    busy.value = true
    try { await enqueue(async check => {
      checkEditable()
      const nextSnapshot = await ports.api.readSnapshot(ports.target()); check(); snapshot.value = nextSnapshot
      checkEditable()
      const current = ports.current()
      const nextDraft = await ports.api.useLatestDraft({ document: snapshot.value.ref, operationId: crypto.randomUUID(), expectedRevision: snapshot.value.revision,
        expectedDraftRevision: draft.value!.revision, localTitle: current.title, localContent: current.content })
      check(); draft.value = nextDraft
      checkEditable()
      applying = true
      try { ports.restore(draft.value.title, draft.value.content) } finally { applying = false }
      await refresh(); check()
      const archive = await ports.api.recoveryHistory(snapshot.value.ref); check(); recoveryHistory.value = archive
      recovery.value = false; error.value = ''
    }) } catch { /* keep inputs and queue error */ } finally { if (token === epoch) busy.value = false }
  }
  async function loadRecoveryHistory() {
    await enqueue(async check => { if (snapshot.value) { const archive = await ports.api.recoveryHistory(snapshot.value.ref); check(); recoveryHistory.value = archive } }).catch(() => undefined)
  }
  async function createAnnotation(body: string, selection: { start: number; end: number; text: string }, operationId: string) {
    return enqueue(async check => {
      checkEditable()
      if (!active.value) { const next = await ports.api.readSnapshot(ports.target()); check(); snapshot.value = next }
      if (!snapshot.value || recovery.value || ports.composing()) throw new Error('请先完成输入并核对恢复稿。')
      const current = ports.current()
      if (current.content.slice(selection.start, selection.end) !== selection.text) throw new Error('选区已变化，请重新选择批注原文。')
      await sync(current.title, current.content); check()
      checkEditable()
      const document = snapshot.value.ref, token = epoch
      const result = await ports.api.annotations.create({ document: snapshot.value.ref, operationId, expectedRevision: snapshot.value.revision,
        expectedDraftRevision: draft.value?.revision ?? null, title: current.title, draftText: current.content, start: selection.start, end: selection.end, body })
      await acknowledgeAnnotationWrite(document, token)
      return result
    })
  }
  async function changeAnnotation(action: 'update' | 'remove' | 'resolve' | 'reopen' | 'reanchor', annotation: DocumentAnnotation,
    operationId: string, body?: string, selection?: { start: number; end: number; text: string }) {
    return enqueue(async check => {
      checkEditable()
      if (!snapshot.value || recovery.value || ports.composing()) throw new Error('请先完成输入并核对恢复稿。')
      const document = snapshot.value.ref, token = epoch
      const input = { document: snapshot.value.ref, id: annotation.id, expectedAnnotationRevision: annotation.revision, operationId }
      if (action === 'update') await ports.api.annotations.update({ ...input, body: body! })
      else if (action === 'reanchor') {
        const current = ports.current()
        if (!selection || current.content.slice(selection.start, selection.end) !== selection.text) throw new Error('请先选中新的原文位置。')
        await sync(current.title, current.content); check()
        checkEditable()
        await ports.api.annotations.reanchor({ ...input, expectedRevision: snapshot.value.revision, expectedDraftRevision: draft.value?.revision ?? null,
          title: current.title, draftText: current.content, start: selection.start, end: selection.end })
      } else await ports.api.annotations[action](input)
      await acknowledgeAnnotationWrite(document, token)
    })
  }
  async function loadMoreAnnotations() {
    if (annotationsLoading.value || annotationCursor.value === null) return
    const token = epoch
    annotationsLoading.value = true
    try {
      await enqueue(async check => {
        if (annotationCursor.value === null || !snapshot.value) return
        const page = await ports.api.annotations.list({ document: snapshot.value.ref, cursor: annotationCursor.value, includeDeleted: true })
        check(); annotations.value = [...annotations.value, ...page.items]; annotationCursor.value = page.nextCursor
        annotationPageCount++
      }).catch(() => undefined)
    } finally { if (!disposed && token === epoch) annotationsLoading.value = false }
  }
  async function prepareGeneration() {
    return enqueue(async check => {
      checkEditable()
      if (!snapshot.value || recovery.value || ports.composing()) throw new Error('请先完成输入并核对恢复稿。')
      const current = ports.current()
      await sync(current.title, current.content); check()
      checkEditable()
      return snapshot.value.ref
    })
  }
  watch(() => JSON.stringify(ports.target()), () => {
    ++epoch
    busy.value = false
    seenAnnotationChange = annotationChangeSequence
    annotationPageCount = 1; annotationsLoading.value = false
    snapshot.value = null; draft.value = null; reviews.value = []; annotations.value = []; annotationCursor.value = null; error.value = ''; recovery.value = false; annotationOpen.value = false; recoveryHistory.value = []
    availability.value = 'loading'
    void enqueue(readTarget).catch(() => undefined)
  }, { immediate: true })
  onBeforeUnmount(() => { disposed = true; epoch++ })
  return { active, items, busy, inputLocked, error, recovery, pending, staged, reviews, snapshot, availability, draft, open, decide, changed, history, save, retry, restore,
    baseChanged, useLatest, recoveryHistory, loadRecoveryHistory,
    annotations, annotationCursor, annotationsLoading, annotationOpen, annotationMarks, annotationPosition, createAnnotation, changeAnnotation, loadMoreAnnotations, prepareGeneration,
    settled: () => queue, generation: ports.api.generation, refresh: () => enqueue(refresh) }
}
