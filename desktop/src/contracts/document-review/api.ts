import type { TextChange } from './anchors'
import type { AnchorProjection, DocumentLocator, DocumentRef, DocumentReview, DocumentSnapshot, PreparedReviewDecision, ReviewApplicationReceipt, ReviewDraft, TextAnchor } from './types'
export type ReviewDraftRecord = ReviewDraft & { positions: Record<string, AnchorProjection>; anchors: Record<string, TextAnchor> }
export type SyncReviewDraftInput = { document: DocumentRef; expectedDraftRevision: number; title: string; changes: TextChange[]; withdrawDecisionIds?: string[]; historyDirection?: 'undo' | 'redo' }
export type PrepareDecisionInput = { document: DocumentRef; blockId: string; operationId: string; expectedDraftRevision: number }
export type AcknowledgeDecisionInput = { document: DocumentRef; permitId: string; resultingDraftHash: string }
export type DiscardDecisionInput = { document: DocumentRef; blockId: string; operationId: string }
export type SaveReviewedDraftInput = { document: DocumentRef; operationId: string; expectedDraftRevision: number; expectedRevision: string }
export type RecoverReviewedDraftInput = SaveReviewedDraftInput & { localTitle: string; localContent: string }
export type ReviewSaveResult = { snapshot: DocumentSnapshot; receipt: ReviewApplicationReceipt | null }
export type OutlineHistoryEntry = { versionId: string; versionNo: number; sourceType: string; createdAt: string }
export type OutlineVersionInput = { document: DocumentRef; versionId: string }
export type OpenWritingReviewInput = { document: DocumentRef; taskId: string; allowFailedReview?: boolean }
export type DocumentReviewApi = {
  generation: import('./generation').AnnotationRevisionApi
  annotations: import('./annotations').DocumentAnnotationsApi
  readSnapshot(target: DocumentLocator | DocumentRef): Promise<DocumentSnapshot>
  outlineHistory(document: DocumentRef): Promise<OutlineHistoryEntry[]>
  outlineVersion(input: OutlineVersionInput): Promise<{ version: OutlineHistoryEntry; content: string }>
  openReview(input: OpenWritingReviewInput): Promise<DocumentReview>
  listReviews(document: DocumentRef): Promise<DocumentReview[]>
  syncDraft(input: SyncReviewDraftInput): Promise<ReviewDraftRecord>
  prepareDecision(input: PrepareDecisionInput): Promise<PreparedReviewDecision>
  acknowledgeStage(input: AcknowledgeDecisionInput): Promise<ReviewDraftRecord>
  saveReviewedDraft(input: SaveReviewedDraftInput): Promise<ReviewSaveResult>
  discardDecision(input: DiscardDecisionInput): Promise<DocumentReview[]>
  recoverDraft(document: DocumentRef): Promise<ReviewDraftRecord | null>
  useLatestDraft(input: RecoverReviewedDraftInput): Promise<ReviewDraftRecord>
  recoveryHistory(document: DocumentRef): Promise<ReviewDraftRecord[]>
}
