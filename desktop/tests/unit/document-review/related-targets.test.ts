import test from 'node:test'
import assert from 'node:assert/strict'
import { relatedTargets } from '../../../src/main/modules/document-review/domain/related-targets'
import { parseAnnotationRevision } from '../../../src/main/modules/document-review/domain/annotation-revision'
import { reviewedOutlineState } from '../../../src/main/modules/planning/domain/reviewed-outline-state'
import type { DocumentSnapshot, DocumentKind } from '../../../src/contracts/document-review/types'
const entry = (id: string, kind: DocumentKind, parentId: string | null) => ({ document: { workItemId: 'book', documentId: id, kind }, title: id, parentId, legacyId: 1 })
test('related targets follow actual ancestors and descendants without including sibling chapters', () => {
  const catalog = [entry('total', 'total', null), entry('v1', 'volume', 'total'), entry('c1', 'chapter-outline', 'v1'), entry('b1', 'body', 'c1'), entry('c2', 'chapter-outline', 'v1'), entry('b2', 'body', 'c2')]
  assert.deepEqual(new Set(relatedTargets(catalog, catalog[3]!.document).targets.map(t => t.document.documentId)), new Set(['b1', 'c1', 'v1', 'total']))
  assert.equal(relatedTargets(catalog, catalog[0]!.document).targets.length, 6)
})
test('model output must name the selected document and uniquely quote exact non-overlapping source', () => {
  const snapshot = { ref: { documentId: 'target' } } as DocumentSnapshot
  const result = (changes: unknown, documentId = 'target') => JSON.stringify({ documentId, changes })
  assert.deepEqual(parseAnnotationRevision(result([{ quote: '原文', replacement: '改稿' }]), snapshot, '前文。原文。'), { candidate: '前文。改稿。' })
  for (const value of [result([{ quote: '原文', replacement: '改稿' }], 'another'), result([{ quote: '不存在', replacement: '改稿' }]), result([{ quote: '。', replacement: '改稿' }]), result([{ quote: '前文。', replacement: '甲' }, { quote: '。原文', replacement: '乙' }])]) assert.throws(() => parseAnnotationRevision(value, snapshot, '前文。原文。'), { code: 'VALIDATION_ERROR' })
  assert.ok('question' in parseAnnotationRevision(JSON.stringify({ ask_author: { questions: [{ id: 'q', prompt: '保留哪种动机？', mode: 'text', required: true, options: [] }] } }), snapshot, '原文'))
})
test('reviewed outline save advances only the planning revision, retaining author confirmations as stale evidence', () => {
  const original = { total: { revision: 2, hash: 'old' }, volumes: [{ volume: 1, revision: 4, outlineHash: 'v-old', title: '卷', eventIds: ['event'], createdAt: 'then', updatedAt: 'then' }], chapterConfirmations: [{ chapterId: 1, basedOnTotalRevision: 2 }], eventChapterPlacements: [{ eventId: 'event', chapterId: 1 }] }
  const changed = JSON.parse(reviewedOutlineState(JSON.stringify(original), { kind: 'total', legacyId: 1, title: '总纲', previousHash: 'old', nextHash: 'new', now: 'now' }))
  assert.equal(changed.total.revision, 3)
  assert.deepEqual(changed.chapterConfirmations, original.chapterConfirmations)
  assert.deepEqual(changed.eventChapterPlacements, original.eventChapterPlacements)
  assert.deepEqual(changed.volumes, original.volumes)
})
