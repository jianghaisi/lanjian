import { boundedBoolean, boundedInteger, boundedString, enumValue, exactRecord, invalid, record, rejectUnknown, requiredString, uuid } from '../core/validation'
import type { AnchorProjection, DocumentLocator, DocumentRef, DocumentReview, DocumentSnapshot, PreparedReviewDecision, ReviewApplicationReceipt, ReviewBlock, ReviewSource, TextAnchor } from './types'
import type { AcknowledgeDecisionInput, DiscardDecisionInput, OpenWritingReviewInput, PrepareDecisionInput, ReviewDraftRecord, ReviewSaveResult, SaveReviewedDraftInput, SyncReviewDraftInput } from './api'
const kinds = ['body', 'total', 'volume', 'stage', 'chapter-outline'] as const
function inputRecord(v: unknown, field: string, allowed: string[]) { const r = record(v, field); rejectUnknown(r, field, allowed); return r }
const text = (v: unknown) => boundedString(v, 'text', 2_000_000)
const id = (v: unknown) => requiredString(v, 'id', 200)
const integer = (v: unknown) => boundedInteger(v, 'revision', 1, Number.MAX_SAFE_INTEGER)
const offset = (v: unknown) => boundedInteger(v, 'offset', 0, 2_000_000)
function hash(v: unknown): string { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) invalid('hash', '应是文本摘要'); return v }
function list<T>(v: unknown, max: number, decode: (item: unknown) => T): T[] { if (!Array.isArray(v) || v.length > max) invalid('list', '数量超限'); return v.map(decode) }
function timestamp(v: unknown): string { const s = requiredString(v, 'timestamp', 50); if (!Number.isFinite(Date.parse(s))) invalid('timestamp', '无效'); return s }
export function decodeDocumentRef(v: unknown): DocumentRef {
  const r = exactRecord(v, 'document', ['workItemId', 'kind', 'documentId'])
  const documentId = id(r.documentId)
  if (/[\\/]/.test(documentId)) invalid('documentId', '不能是路径')
  return { workItemId: requiredString(r.workItemId, 'workItemId', 32767), kind: enumValue(r.kind, 'kind', kinds), documentId }
}
export function decodeDocumentTarget(v: unknown): DocumentLocator | DocumentRef {
  const value = record(v, 'target')
  if ('documentId' in value) return decodeDocumentRef(v)
  const r = inputRecord(v, 'target', ['workItemId', 'kind', 'legacyId'])
  const kind = enumValue(r.kind, 'kind', kinds)
  if (kind !== 'total' && r.legacyId === undefined) invalid('legacyId', '必填')
  return { workItemId: requiredString(r.workItemId, 'workItemId', 32767), kind, ...(r.legacyId === undefined ? {} : { legacyId: boundedInteger(r.legacyId, 'legacyId', 1, 1_000_000) }) }
}
export function decodeSnapshot(v: unknown): DocumentSnapshot {
  const r = exactRecord(v, 'snapshot', ['ref', 'legacyId', 'title', 'content', 'versionId', 'revision', 'hash'])
  return { ref: decodeDocumentRef(r.ref), legacyId: integer(r.legacyId), title: requiredString(r.title, 'title', 200), content: text(r.content), versionId: id(r.versionId), revision: hash(r.revision), hash: hash(r.hash) }
}
export function decodeOutlineVersionInput(v: unknown) {
  const r = exactRecord(v, 'input', ['document', 'versionId'])
  const document = decodeDocumentRef(r.document)
  if (document.kind === 'body') invalid('document', '应为大纲文档')
  return { document, versionId: id(r.versionId) }
}
export function decodeOutlineHistoryEntry(v: unknown) {
  const r = exactRecord(v, 'version', ['versionId', 'versionNo', 'sourceType', 'createdAt'])
  return { versionId: id(r.versionId), versionNo: integer(r.versionNo), sourceType: requiredString(r.sourceType, 'sourceType', 100), createdAt: timestamp(r.createdAt) }
}
export function decodeTextAnchor(v: unknown): TextAnchor {
  const r = exactRecord(v, 'anchor', ['start', 'end', 'quote', 'before', 'after', 'versionId', 'documentHash'])
  const result = { start: offset(r.start), end: offset(r.end), quote: text(r.quote), before: boundedString(r.before, 'before', 80), after: boundedString(r.after, 'after', 80), versionId: id(r.versionId), documentHash: hash(r.documentHash) }
  if (result.end - result.start !== result.quote.length) invalid('anchor', '范围和引文不一致')
  return result
}
function source(v: unknown): ReviewSource {
  const r = exactRecord(v, 'source', ['taskId', 'artifactId', 'artifactType', 'artifactHash'])
  return { taskId: id(r.taskId), artifactId: id(r.artifactId), artifactType: id(r.artifactType), artifactHash: hash(r.artifactHash) }
}
function block(v: unknown): ReviewBlock {
  const r = exactRecord(v, 'block', ['id', 'sessionId', 'anchor', 'replacement', 'status'])
  return { id: id(r.id), sessionId: id(r.sessionId), anchor: decodeTextAnchor(r.anchor), replacement: text(r.replacement), status: enumValue(r.status, 'status', ['pending', 'staged', 'rejected', 'committed', 'conflicted']) }
}
export function decodeReview(v: unknown): DocumentReview {
  const r = exactRecord(v, 'review', ['id', 'document', 'source', 'baseVersionId', 'baseRevision', 'baseDraft', 'createdAt', 'blocks'])
  return { id: id(r.id), document: decodeDocumentRef(r.document), source: source(r.source), baseVersionId: id(r.baseVersionId), baseRevision: hash(r.baseRevision), baseDraft: text(r.baseDraft), createdAt: timestamp(r.createdAt), blocks: list(r.blocks, 500, block) }
}
export const decodeReviews = (v: unknown) => list(v, 100, decodeReview)
function mapping<T>(v: unknown, decode: (v: unknown) => T): Record<string, T> {
  const r = record(v, 'mapping'), result: Record<string, T> = Object.create(null)
  if (Object.keys(r).length > 50_000) invalid('mapping', '数量超限')
  for (const [key, value] of Object.entries(r)) { if (!/^[\w:-]{1,200}$/.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) invalid('key', '无效'); result[key] = decode(value) }
  return result
}
export function decodeDraft(v: unknown): ReviewDraftRecord {
  const r = exactRecord(v, 'draft', ['document', 'title', 'content', 'baseRevision', 'revision', 'stagedDecisionIds', 'updatedAt', 'anchors', 'positions'])
  return { document: decodeDocumentRef(r.document), title: requiredString(r.title, 'title', 200), content: text(r.content), baseRevision: hash(r.baseRevision), revision: integer(r.revision),
    stagedDecisionIds: list(r.stagedDecisionIds, 50_000, id), updatedAt: timestamp(r.updatedAt), anchors: mapping(r.anchors, decodeTextAnchor), positions: mapping(r.positions, value => {
      const p = exactRecord(value, 'position', ['start', 'end', 'status'])
      const result: AnchorProjection = { start: offset(p.start), end: offset(p.end), status: enumValue(p.status, 'status', ['located', 'needs-relocation']) }
      if (result.end < result.start) invalid('position', '范围倒置'); return result
    }) }
}
export function decodePermit(v: unknown): PreparedReviewDecision {
  const r = exactRecord(v, 'permit', ['id', 'document', 'blockId', 'expectedDraftHash', 'resultingDraftHash', 'start', 'end', 'replacement', 'expiresAt'])
  const result = { id: id(r.id), document: decodeDocumentRef(r.document), blockId: id(r.blockId), expectedDraftHash: hash(r.expectedDraftHash), resultingDraftHash: hash(r.resultingDraftHash), start: offset(r.start), end: offset(r.end), replacement: text(r.replacement), expiresAt: timestamp(r.expiresAt) }
  if (result.end < result.start) invalid('permit', '范围倒置'); return result
}
export function decodeReceipt(v: unknown): ReviewApplicationReceipt {
  const r = exactRecord(v, 'receipt', ['id', 'document', 'previousVersionId', 'versionId', 'revision', 'contentHash', 'sourceLinks'])
  return { id: id(r.id), document: decodeDocumentRef(r.document), previousVersionId: id(r.previousVersionId), versionId: id(r.versionId), revision: hash(r.revision), contentHash: hash(r.contentHash), sourceLinks: list(r.sourceLinks, 100, value => {
    const s = exactRecord(value, 'link', ['taskId', 'artifactId', 'artifactType', 'artifactHash', 'blockIds'])
    const { blockIds, ...rest } = s; return { ...source(rest), blockIds: list(blockIds, 500, id) }
  }) }
}
export function decodeSaveResult(v: unknown): ReviewSaveResult {
  const r = exactRecord(v, 'result', ['snapshot', 'receipt']); return { snapshot: decodeSnapshot(r.snapshot), receipt: r.receipt === null ? null : decodeReceipt(r.receipt) }
}
export function decodeOpenReview(v: unknown): OpenWritingReviewInput {
  const r = inputRecord(v, 'input', ['document', 'taskId', 'allowFailedReview'])
  return { document: decodeDocumentRef(r.document), taskId: id(r.taskId), ...(r.allowFailedReview === undefined ? {} : { allowFailedReview: boundedBoolean(r.allowFailedReview, 'allowFailedReview') }) }
}
export function decodeSyncDraft(v: unknown): SyncReviewDraftInput {
  const r = inputRecord(v, 'input', ['document', 'expectedDraftRevision', 'title', 'changes', 'withdrawDecisionIds', 'historyDirection'])
  return { document: decodeDocumentRef(r.document), expectedDraftRevision: integer(r.expectedDraftRevision), title: requiredString(r.title, 'title', 200), changes: list(r.changes, 2000, value => {
    const c = exactRecord(value, 'change', ['from', 'to', 'insert']); const from = offset(c.from), to = offset(c.to)
    if (to < from) invalid('change', '范围倒置'); return { from, to, insert: text(c.insert) }
  }), ...(r.withdrawDecisionIds === undefined ? {} : { withdrawDecisionIds: list(r.withdrawDecisionIds, 500, id) }),
    ...(r.historyDirection === undefined ? {} : { historyDirection: enumValue(r.historyDirection, 'historyDirection', ['undo', 'redo']) }) }
}
export function decodePrepare(v: unknown): PrepareDecisionInput {
  const r = exactRecord(v, 'input', ['document', 'blockId', 'operationId', 'expectedDraftRevision'])
  return { document: decodeDocumentRef(r.document), blockId: id(r.blockId), operationId: uuid(r.operationId, 'operationId'), expectedDraftRevision: integer(r.expectedDraftRevision) }
}
export function decodeAcknowledge(v: unknown): AcknowledgeDecisionInput {
  const r = exactRecord(v, 'input', ['document', 'permitId', 'resultingDraftHash'])
  return { document: decodeDocumentRef(r.document), permitId: id(r.permitId), resultingDraftHash: hash(r.resultingDraftHash) }
}
export function decodeDiscard(v: unknown): DiscardDecisionInput {
  const r = exactRecord(v, 'input', ['document', 'blockId', 'operationId'])
  return { document: decodeDocumentRef(r.document), blockId: id(r.blockId), operationId: uuid(r.operationId, 'operationId') }
}
export function decodeSave(v: unknown): SaveReviewedDraftInput {
  const r = exactRecord(v, 'input', ['document', 'operationId', 'expectedDraftRevision', 'expectedRevision'])
  return { document: decodeDocumentRef(r.document), operationId: uuid(r.operationId, 'operationId'), expectedDraftRevision: integer(r.expectedDraftRevision), expectedRevision: hash(r.expectedRevision) }
}
export function decodeRecovery(v: unknown) {
  const r = exactRecord(v, 'input', ['document', 'operationId', 'expectedDraftRevision', 'expectedRevision', 'localTitle', 'localContent'])
  const { localTitle, localContent, ...save } = r
  return { ...decodeSave(save), localTitle: requiredString(localTitle, 'localTitle', 200), localContent: text(localContent) }
}
export const reviewResultDecoders = {
  'document-review:outline-history': (v: unknown) => list(v, 50, decodeOutlineHistoryEntry),
  'document-review:outline-version': (v: unknown) => { const r = exactRecord(v, 'result', ['version', 'content']); return { version: decodeOutlineHistoryEntry(r.version), content: text(r.content) } },
  'document-review:snapshot': decodeSnapshot, 'document-review:open': decodeReview, 'document-review:list': decodeReviews,
  'document-review:sync-draft': decodeDraft, 'document-review:prepare': decodePermit, 'document-review:acknowledge': decodeDraft,
  'document-review:save': decodeSaveResult, 'document-review:discard': decodeReviews,
  'document-review:use-latest': decodeDraft, 'document-review:recovery-history': (v: unknown) => list(v, 20, decodeDraft),
  'document-review:recover': (v: unknown) => v === null ? null : decodeDraft(v)
}
