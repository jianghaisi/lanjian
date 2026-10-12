import type { DocumentRef } from './types'
export type AnnotationRevisionSelection = { origin: DocumentRef; annotations: Array<{ id: string; revision: number }> }
export type RelatedRevisionTarget = { document: DocumentRef; title: string; reason: string }
export type RelatedRevisionAnalysis = { receipt: string; targets: RelatedRevisionTarget[]; hasMore: boolean }
export type AnnotationRevisionStart = AnnotationRevisionSelection & { operationId: string; mode: 'current' | 'related'; receipt: string; targets: DocumentRef[]; target: DocumentRef }
export type AnnotationRevisionTask = {
  id: string; workItemId: string; origin: DocumentRef; target: RelatedRevisionTarget; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'waiting-input';
  model: string; createdAt: string; error: string | null; stale: boolean; reviewId: string | null; pending: number; committed: number; staged: number;
  rawResult?: string
  question: import('../assistant/author-interaction-contracts').AuthorQuestionCard | null
}
export type AnnotationRevisionApi = {
  analyzeRelated(input: AnnotationRevisionSelection): Promise<RelatedRevisionAnalysis>
  start(input: AnnotationRevisionStart): Promise<AnnotationRevisionTask>
  recent(origin: DocumentRef): Promise<AnnotationRevisionTask[]>
  status(id: string): Promise<AnnotationRevisionTask>
  cancel(id: string): Promise<AnnotationRevisionTask>
  resume(input: { id: string; operationId: string }): Promise<AnnotationRevisionTask>
  answer(input: import('../assistant/author-interaction-contracts').AuthorAnswerSubmission): Promise<AnnotationRevisionTask>
}
