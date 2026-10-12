import { boundedBoolean, boundedInteger, boundedString, enumValue, exactRecord, invalid, requiredString, uuid, record, rejectUnknown } from '../core/validation'
import { decodeDocumentRef } from './validation'
import { decodeAuthorQuestionCard } from '../assistant/author-interaction-contracts'
import type { AnnotationRevisionSelection, AnnotationRevisionStart, AnnotationRevisionTask, RelatedRevisionAnalysis, RelatedRevisionTarget } from './generation'
function list<T>(value: unknown, max: number, decode: (item: unknown) => T): T[] { if (!Array.isArray(value) || value.length > max) invalid('items', '数量超限'); return value.map(decode) }
function selection(r: Record<string, unknown>): AnnotationRevisionSelection {
  const annotations = list(r.annotations, 20, item => { const row = exactRecord(item, 'annotation', ['id', 'revision']); return { id: uuid(row.id, 'id'), revision: boundedInteger(row.revision, 'revision', 1, Number.MAX_SAFE_INTEGER) } })
  if (!annotations.length || new Set(annotations.map(item => item.id)).size !== annotations.length) invalid('annotations', '请选择不重复的批注')
  return { origin: decodeDocumentRef(r.origin), annotations }
}
function digest(value: unknown) { const result = requiredString(value, 'receipt', 64); if (!/^[a-f0-9]{64}$/.test(result)) invalid('receipt', '核对依据无效'); return result }
export function decodeRevisionSelection(v: unknown) { return selection(exactRecord(v, 'input', ['origin', 'annotations'])) }
export function decodeRevisionStart(v: unknown): AnnotationRevisionStart {
  const r = exactRecord(v, 'input', ['origin', 'annotations', 'operationId', 'mode', 'receipt', 'targets', 'target'])
  const targets = list(r.targets, 8, decodeDocumentRef)
  if (!targets.length || new Set(targets.map(t => t.documentId)).size !== targets.length) invalid('targets', '请选择 1 到 8 份不同文档')
  return { ...selection(r), operationId: uuid(r.operationId, 'operationId'), mode: enumValue(r.mode, 'mode', ['current', 'related']), receipt: digest(r.receipt), targets, target: decodeDocumentRef(r.target) }
}
export function decodeRevisionResume(v: unknown) { const r = exactRecord(v, 'input', ['id', 'operationId']); return { id: uuid(r.id, 'id'), operationId: uuid(r.operationId, 'operationId') } }
function target(v: unknown): RelatedRevisionTarget { const r = exactRecord(v, 'target', ['document', 'title', 'reason']); return { document: decodeDocumentRef(r.document), title: requiredString(r.title, 'title', 200), reason: requiredString(r.reason, 'reason', 300) } }
export function decodeRelatedAnalysis(v: unknown): RelatedRevisionAnalysis { const r = exactRecord(v, 'analysis', ['receipt', 'targets', 'hasMore']); return { receipt: digest(r.receipt), targets: list(r.targets, 200, target), hasMore: boundedBoolean(r.hasMore, 'hasMore') } }
export function decodeAnnotationRevisionTask(v: unknown): AnnotationRevisionTask {
  const source = record(v, 'task')
  rejectUnknown(source, 'task', ['rawResult', 'id', 'workItemId', 'origin', 'target', 'status', 'model', 'createdAt', 'error', 'stale', 'reviewId', 'pending', 'committed', 'staged', 'question'])
  const { rawResult, ...base } = source
  const r = exactRecord(base, 'task', ['id', 'workItemId', 'origin', 'target', 'status', 'model', 'createdAt', 'error', 'stale', 'reviewId', 'pending', 'committed', 'staged', 'question'])
  return { ...(rawResult !== undefined ? { rawResult: boundedString(rawResult, 'rawResult', 3_000_000) } : {}), id: uuid(r.id, 'id'), workItemId: requiredString(r.workItemId, 'workItemId', 512), origin: decodeDocumentRef(r.origin), target: target(r.target),
    status: enumValue(r.status, 'status', ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted', 'waiting-input']), model: boundedString(r.model, 'model', 200), createdAt: requiredString(r.createdAt, 'createdAt', 40),
    question: r.question === null ? null : decodeAuthorQuestionCard(r.question),
    error: r.error === null ? null : boundedString(r.error, 'error', 2000), stale: boundedBoolean(r.stale, 'stale'), reviewId: r.reviewId === null ? null : uuid(r.reviewId, 'reviewId'),
    pending: boundedInteger(r.pending, 'pending', 0, 1000), committed: boundedInteger(r.committed, 'committed', 0, 1000), staged: boundedInteger(r.staged, 'staged', 0, 1000) }
}
export const revisionGenerationResultDecoders = {
  'annotation-revision:analyze': decodeRelatedAnalysis,
  'annotation-revision:recent': (v: unknown) => list(v, 50, decodeAnnotationRevisionTask),
  ...Object.fromEntries(['start', 'status', 'cancel', 'resume', 'answer'].map(name => [`annotation-revision:${name}`, decodeAnnotationRevisionTask]))
}
