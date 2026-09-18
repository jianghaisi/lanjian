import type { ContextFactEvidence, ContextMaterialEvidence } from '../index'

export type ContextEvidenceIdentity = Pick<ContextFactEvidence, 'chapterId' | 'manuscriptRevision' | 'sourceType' | 'chunkOrdinal'>

export function contextEvidenceKey(item: ContextEvidenceIdentity): string {
  const sourceType = item.sourceType === 'document_chunk' ? 'document_chunk' : 'chapter'
  const ordinal = sourceType === 'document_chunk' ? item.chunkOrdinal ?? 0 : 'chapter'
  return `${item.chapterId}:${item.manuscriptRevision}:${sourceType}:${ordinal}`
}

export function contextMaterialEvidenceKey(item: Pick<ContextMaterialEvidence, 'sourceId' | 'contentHash'>): string {
  return `material:${item.sourceId}:${item.contentHash}`
}

export function materialSourceIdFromEvidenceKey(key: string): string | null {
  if (!key.startsWith('material:')) return null
  const value = key.slice('material:'.length)
  const separator = value.lastIndexOf(':')
  if (separator < 1) return null
  const sourceId = value.slice(0, separator)
  const contentHash = value.slice(separator + 1)
  return /^[a-f0-9]{64}$/i.test(contentHash) && sourceId.length <= 512 ? sourceId : null
}
