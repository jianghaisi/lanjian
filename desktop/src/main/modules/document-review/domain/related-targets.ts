import type { ReviewReadPort } from './review-storage'
import type { DocumentRef } from '../../../../contracts/document-review/types'
import type { RelatedRevisionTarget } from '../../../../contracts/document-review/generation'
/** Only actual hierarchy edges, never model-invented paths or chapter numbers. */
export function relatedTargets(catalog: ReturnType<ReviewReadPort['documentReviewCatalog']>, origin: DocumentRef) {
  const byId = new Map(catalog.map(item => [item.document.documentId, item]))
  const ancestors = (id: string) => {
    const seen = new Set<string>(); let current = byId.get(id)
    while (current?.parentId && !seen.has(current.parentId)) { seen.add(current.parentId); current = byId.get(current.parentId) }
    return seen
  }
  const parents = ancestors(origin.documentId)
  const result: RelatedRevisionTarget[] = []
  for (const item of catalog) {
    const same = item.document.documentId === origin.documentId
    if (same || parents.has(item.document.documentId) || ancestors(item.document.documentId).has(origin.documentId)) {
      result.push({ document: item.document, title: item.title, reason: same ? '批注所在文档' : parents.has(item.document.documentId) ? '该文档是批注原文的上级规划' : '该文档依赖批注所在的上级规划' })
    }
  }
  result.sort((a, b) => Number(b.document.documentId === origin.documentId) - Number(a.document.documentId === origin.documentId))
  return { targets: result.slice(0, 200), hasMore: result.length > 200 }
}
