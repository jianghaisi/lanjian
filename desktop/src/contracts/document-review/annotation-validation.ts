import { boundedBoolean, boundedInteger, boundedString, enumValue, exactRecord, invalid, record, rejectUnknown, requiredString, uuid } from '../core/validation'
import { decodeDocumentRef, decodeTextAnchor } from './validation'
import type { AnnotationChangeInput, AnnotationCreateInput, AnnotationListInput, AnnotationPage, AnnotationReanchorInput, AnnotationUpdateInput, DocumentAnnotation } from './annotations'
const identifier = (v: unknown) => uuid(v, 'id')
const revision = (v: unknown) => boundedInteger(v, 'revision', 1, Number.MAX_SAFE_INTEGER)
const body = (v: unknown) => requiredString(v, '批注', 10_000)
export function decodeAnnotation(v: unknown): DocumentAnnotation {
  const r = exactRecord(v, 'annotation', ['id', 'document', 'revision', 'body', 'status', 'anchor', 'createdAt', 'updatedAt'])
  for (const key of ['createdAt', 'updatedAt']) if (typeof r[key] !== 'string' || !Number.isFinite(Date.parse(r[key] as string))) invalid(key, '时间无效')
  return { id: identifier(r.id), document: decodeDocumentRef(r.document), revision: revision(r.revision), body: body(r.body),
    status: enumValue(r.status, 'status', ['open', 'resolved', 'deleted']), anchor: decodeTextAnchor(r.anchor), createdAt: r.createdAt as string, updatedAt: r.updatedAt as string }
}
export function decodeAnnotationPage(v: unknown): AnnotationPage {
  const r = exactRecord(v, 'page', ['items', 'nextCursor'])
  if (!Array.isArray(r.items) || r.items.length > 50) invalid('items', '批注数量超限')
  return { items: r.items.map(decodeAnnotation), nextCursor: r.nextCursor === null ? null : revision(r.nextCursor) }
}
export function decodeAnnotationList(v: unknown): AnnotationListInput {
  const r = record(v, 'input'); rejectUnknown(r, 'input', ['document', 'cursor', 'includeDeleted'])
  return { document: decodeDocumentRef(r.document), ...(r.cursor === undefined ? {} : { cursor: revision(r.cursor) }),
    ...(r.includeDeleted === undefined ? {} : { includeDeleted: boundedBoolean(r.includeDeleted, 'includeDeleted') }) }
}
const common = ['document', 'id', 'operationId', 'expectedAnnotationRevision']
const location = ['expectedRevision', 'expectedDraftRevision', 'title', 'draftText', 'start', 'end']
function change(r: Record<string, unknown>): AnnotationChangeInput {
  return { document: decodeDocumentRef(r.document), id: identifier(r.id), operationId: identifier(r.operationId), expectedAnnotationRevision: revision(r.expectedAnnotationRevision) }
}
function placement(r: Record<string, unknown>) {
  if (typeof r.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(r.expectedRevision)) invalid('expectedRevision', '版本无效')
  const draftText = boundedString(r.draftText, 'draftText', 2_000_000)
  const start = boundedInteger(r.start, 'start', 0, draftText.length), end = boundedInteger(r.end, 'end', start + 1, draftText.length)
  return { expectedRevision: r.expectedRevision, expectedDraftRevision: r.expectedDraftRevision === null ? null : revision(r.expectedDraftRevision), title: requiredString(r.title, 'title', 200), draftText, start, end }
}
export function decodeAnnotationCreate(v: unknown): AnnotationCreateInput {
  const r = exactRecord(v, 'input', ['document', 'operationId', 'body', ...location])
  return { document: decodeDocumentRef(r.document), operationId: identifier(r.operationId), body: body(r.body), ...placement(r) }
}
export function decodeAnnotationChange(v: unknown): AnnotationChangeInput { return change(exactRecord(v, 'input', common)) }
export function decodeAnnotationUpdate(v: unknown): AnnotationUpdateInput {
  const r = exactRecord(v, 'input', [...common, 'body']); return { ...change(r), body: body(r.body) }
}
export function decodeAnnotationReanchor(v: unknown): AnnotationReanchorInput {
  const r = exactRecord(v, 'input', [...common, ...location]); return { ...change(r), ...placement(r) }
}
export const annotationResultDecoders = {
  'document-annotations:list': decodeAnnotationPage,
  ...Object.fromEntries(['create', 'update', 'remove', 'resolve', 'reopen', 'reanchor'].map(action => [`document-annotations:${action}`, decodeAnnotation]))
}
