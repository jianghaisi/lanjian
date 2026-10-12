import type { DocumentRef, TextAnchor } from './types'
export type DocumentAnnotation = {
  id: string; document: DocumentRef; revision: number; body: string
  status: 'open' | 'resolved' | 'deleted'; anchor: TextAnchor; createdAt: string; updatedAt: string
}
export type AnnotationPage = { items: DocumentAnnotation[]; nextCursor: number | null }
export type AnnotationListInput = { document: DocumentRef; cursor?: number; includeDeleted?: boolean }
export type AnnotationCreateInput = {
  document: DocumentRef; operationId: string; expectedRevision: string
  expectedDraftRevision: number | null
  title: string; draftText: string; start: number; end: number; body: string
}
export type AnnotationChangeInput = { document: DocumentRef; id: string; operationId: string; expectedAnnotationRevision: number }
export type AnnotationUpdateInput = AnnotationChangeInput & { body: string }
export type AnnotationReanchorInput = AnnotationChangeInput & Omit<AnnotationCreateInput, 'body'>
export type DocumentAnnotationsApi = {
  list(input: AnnotationListInput): Promise<AnnotationPage>
  create(input: AnnotationCreateInput): Promise<DocumentAnnotation>
  update(input: AnnotationUpdateInput): Promise<DocumentAnnotation>
  remove(input: AnnotationChangeInput): Promise<DocumentAnnotation>
  resolve(input: AnnotationChangeInput): Promise<DocumentAnnotation>
  reopen(input: AnnotationChangeInput): Promise<DocumentAnnotation>
  reanchor(input: AnnotationReanchorInput): Promise<DocumentAnnotation>
}
