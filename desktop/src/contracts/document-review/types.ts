export type DocumentKind = 'body' | 'total' | 'volume' | 'stage' | 'chapter-outline'

/** Main resolves the legacy locator once; persisted references use the database identity. */
export type DocumentLocator = { workItemId: string; kind: DocumentKind; legacyId?: number }
export type DocumentRef = { workItemId: string; kind: DocumentKind; documentId: string }
export type DocumentSnapshot = {
  ref: DocumentRef
  legacyId: number
  title: string
  content: string
  versionId: string
  revision: string
  hash: string
}

/** Offsets are UTF-16 units, matching CodeMirror and JavaScript string slicing. */
export type TextAnchor = {
  start: number
  end: number
  quote: string
  before: string
  after: string
  versionId: string
  documentHash: string
}
export type AnchorProjection = { start: number; end: number; status: 'located' | 'needs-relocation' }
export type ReviewBlockStatus = 'pending' | 'staged' | 'rejected' | 'committed' | 'conflicted'
export type ReviewBlock = {
  id: string
  sessionId: string
  anchor: TextAnchor
  replacement: string
  status: ReviewBlockStatus
}
export type ReviewSource = {
  taskId: string
  artifactId: string
  artifactType: string
  artifactHash: string
}
export type DocumentReview = {
  id: string
  document: DocumentRef
  source: ReviewSource
  baseVersionId: string
  baseRevision: string
  baseDraft: string
  createdAt: string
  blocks: ReviewBlock[]
}
export type ReviewDraft = {
  document: DocumentRef
  title: string
  content: string
  baseRevision: string
  revision: number
  stagedDecisionIds: string[]
  updatedAt: string
}
export type PreparedReviewDecision = {
  id: string
  document: DocumentRef
  blockId: string
  expectedDraftHash: string
  resultingDraftHash: string
  start: number
  end: number
  replacement: string
  expiresAt: string
}
export type ReviewApplicationReceipt = {
  id: string
  document: DocumentRef
  previousVersionId: string
  versionId: string
  revision: string
  contentHash: string
  sourceLinks: Array<ReviewSource & { blockIds: string[] }>
}
