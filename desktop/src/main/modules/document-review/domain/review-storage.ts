import type { RecoverReviewedDraftInput, OutlineHistoryEntry, OutlineVersionInput } from '../../../../contracts/document-review/api'
import type { WorkspaceTaskRunRecord, WorkspaceGenerationArtifactRecord } from '../../../core/ports/workspace-database'
import type { DocumentLocator, DocumentRef, DocumentReview, DocumentSnapshot, PreparedReviewDecision, ReviewSource } from '../../../../contracts/document-review/types'
import type { AcknowledgeDecisionInput, DiscardDecisionInput, PrepareDecisionInput, ReviewDraftRecord, ReviewSaveResult, SaveReviewedDraftInput, SyncReviewDraftInput } from '../../../../contracts/document-review/api'
import type { AnnotationChangeInput, AnnotationCreateInput, AnnotationListInput, AnnotationPage, AnnotationReanchorInput, AnnotationUpdateInput, DocumentAnnotation } from '../../../../contracts/document-review/annotations'
export type { AcknowledgeDecisionInput, DiscardDecisionInput, PrepareDecisionInput, ReviewDraftRecord, ReviewSaveResult, SaveReviewedDraftInput, SyncReviewDraftInput } from '../../../../contracts/document-review/api'
export type OpenReviewInput = {
  snapshot: DocumentSnapshot
  baseDraft: string
  candidate: string
  source: ReviewSource
}
export type ReviewReadPort = {
  taskRun(id: string): WorkspaceTaskRunRecord | null
  taskRunByOperationKey(key: string): WorkspaceTaskRunRecord | null
  recentTaskRuns(taskType: string, legacyChapterId?: number, limit?: number): WorkspaceTaskRunRecord[]
  generationArtifactForTask(taskRunId: string, artifactType?: string): WorkspaceGenerationArtifactRecord | null
  assertAnnotationRevisionCurrent(taskId: string): void
  documentReviewCatalog(workItemId: string): Array<{ document: DocumentRef; title: string; parentId: string | null; legacyId: number }>
  documentAnnotations(input: AnnotationListInput): AnnotationPage
  documentAnnotation(document: DocumentRef, id: string, revision?: number): DocumentAnnotation
  documentReviewSnapshot(target: DocumentLocator | DocumentRef): DocumentSnapshot
  outlineHistory(document: DocumentRef): OutlineHistoryEntry[]
  outlineVersion(input: OutlineVersionInput): { version: OutlineHistoryEntry; content: string }
  documentReviews(document: DocumentRef): DocumentReview[]
  reviewDraft(document: DocumentRef): ReviewDraftRecord | null
  reviewRecoveryHistory(document: DocumentRef): ReviewDraftRecord[]
  close(): void
}
export type ReviewWritePort = {
  createDocumentAnnotation(input: AnnotationCreateInput): DocumentAnnotation
  changeDocumentAnnotation(action: 'update' | 'remove' | 'resolve' | 'reopen' | 'reanchor', input: AnnotationChangeInput | AnnotationUpdateInput | AnnotationReanchorInput): DocumentAnnotation
  openDocumentReview(input: OpenReviewInput): DocumentReview
  syncReviewDraft(input: SyncReviewDraftInput): ReviewDraftRecord
  prepareReviewDecision(input: PrepareDecisionInput): PreparedReviewDecision
  acknowledgeReviewStage(input: AcknowledgeDecisionInput): ReviewDraftRecord
  discardReviewDecision(input: DiscardDecisionInput): DocumentReview[]
  saveReviewedDraft(input: SaveReviewedDraftInput): ReviewSaveResult
  useLatestReviewDraft(input: RecoverReviewedDraftInput): ReviewDraftRecord
}
