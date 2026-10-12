import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { AnnotationChangeInput, AnnotationCreateInput, AnnotationListInput, AnnotationPage, AnnotationReanchorInput, AnnotationUpdateInput, DocumentAnnotation } from '../../../../contracts/document-review/annotations'
import type { DocumentRef, DocumentSnapshot } from '../../../../contracts/document-review/types'
import type { DocumentReviewStore } from './review-store'
import { AppError } from '../../../core/errors/app-error'
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
function conflict(message: string): never { throw new AppError('CONFLICT', message, { recoverable: true }) }
export class DocumentAnnotationStore {
  constructor(private readonly db: DatabaseSync, private readonly ports: {
    projectId: string; id: () => string; now: () => string; snapshot: (document: DocumentRef) => DocumentSnapshot; drafts: DocumentReviewStore
  }) {}
  list(input: AnnotationListInput): AnnotationPage {
    this.ports.snapshot(input.document)
    const rows = this.db.prepare(`SELECT a.seq,a.payload_json FROM document_annotations a
      WHERE a.project_id=? AND a.document_kind=? AND a.document_id=? AND a.seq<?
      AND a.revision=(SELECT MAX(b.revision) FROM document_annotations b WHERE b.id=a.id)
      ${input.includeDeleted ? '' : "AND json_extract(a.payload_json,'$.status') <> 'deleted'"}
      ORDER BY a.seq DESC LIMIT 51`).all(this.ports.projectId, input.document.kind, input.document.documentId, input.cursor || Number.MAX_SAFE_INTEGER)
    return { items: rows.slice(0, 50).map(row => JSON.parse(String(row.payload_json)) as DocumentAnnotation),
      nextCursor: rows.length > 50 ? Number(rows[49]!.seq) : null }
  }
  get(document: DocumentRef, id: string, revision?: number): DocumentAnnotation {
    this.ports.snapshot(document)
    const row = this.db.prepare(`SELECT payload_json FROM document_annotations WHERE id=? AND project_id=? AND document_kind=? AND document_id=?
      ${revision ? 'AND revision=?' : ''} ORDER BY revision DESC LIMIT 1`)
      .get(id, this.ports.projectId, document.kind, document.documentId, ...(revision ? [revision] : []))
    return row ? JSON.parse(String(row.payload_json)) : conflict('批注不存在或不属于这个文档。')
  }
  create(input: AnnotationCreateInput): DocumentAnnotation {
    const requestHash = hash(JSON.stringify(['create', input]))
    const previous = this.repeated(input.operationId, requestHash)
    if (previous) return previous
    const snapshot = this.ports.snapshot(input.document)
    if (snapshot.revision !== input.expectedRevision) conflict('正式稿已经变化，请保留批注并重新核对选区。')
    const id = this.ports.id(), now = this.ports.now()
    const anchor = this.ports.drafts.anchorAnnotation(snapshot, input.title, input.draftText, id, input.start, input.end, input.expectedDraftRevision)
    return this.append({ id, document: input.document, revision: 1, body: input.body, status: 'open', anchor, createdAt: now, updatedAt: now }, input.operationId, requestHash)
  }
  change(action: 'update' | 'remove' | 'resolve' | 'reopen' | 'reanchor', input: AnnotationChangeInput | AnnotationUpdateInput | AnnotationReanchorInput): DocumentAnnotation {
    const requestHash = hash(JSON.stringify([action, input]))
    const repeated = this.repeated(input.operationId, requestHash)
    if (repeated) return repeated
    const previous = this.get(input.document, input.id)
    if (previous.revision !== input.expectedAnnotationRevision) conflict('这条批注已更新，当前输入仍保留，请重新核对。')
    if (previous.status === 'deleted' && action !== 'reopen') conflict('这条批注已删除，可先重新打开。')
    const next = { ...previous, revision: previous.revision + 1, updatedAt: this.ports.now() }
    if (action === 'update') next.body = (input as AnnotationUpdateInput).body
    if (action === 'remove') next.status = 'deleted'
    if (action === 'resolve') next.status = 'resolved'
    if (action === 'reopen') next.status = 'open'
    if (action === 'reanchor') {
      const value = input as AnnotationReanchorInput, snapshot = this.ports.snapshot(input.document)
      if (snapshot.revision !== value.expectedRevision) conflict('正式稿已经变化，未更换批注位置。')
      next.anchor = this.ports.drafts.anchorAnnotation(snapshot, value.title, value.draftText, next.id, value.start, value.end, value.expectedDraftRevision)
    }
    return this.append(next, input.operationId, requestHash)
  }
  private repeated(operationId: string, requestHash: string): DocumentAnnotation | null {
    const row = this.db.prepare('SELECT request_hash,payload_json FROM document_annotations WHERE operation_id=?').get(operationId)
    if (!row) return null
    if (row.request_hash !== requestHash) conflict('操作标识已用于另一条批注修改。')
    return JSON.parse(String(row.payload_json))
  }
  private append(value: DocumentAnnotation, operationId: string, requestHash: string) {
    this.db.prepare('INSERT INTO document_annotations(id,revision,project_id,document_kind,document_id,operation_id,request_hash,payload_json) VALUES(?,?,?,?,?,?,?,?)')
      .run(value.id, value.revision, this.ports.projectId, value.document.kind, value.document.documentId, operationId, requestHash, JSON.stringify(value))
    return value
  }
}
