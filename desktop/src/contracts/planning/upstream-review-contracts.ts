import { boundedInteger, boundedString, enumValue, exactArgs, exactRecord, invalid, record, rejectUnknown, requiredString, type ArgsDecoder } from '../core/validation'

export type UpstreamReviewDecision = 'no-conflict' | 'needs-upstream-change'
export type UpstreamComparisonField = { field: 'time' | 'characters' | 'location' | 'event' | 'result'; source: string; detail: string; changed: boolean }
export type UpstreamReviewEvidence = { eventVersion: string; sourceVersion: string; provenanceRevision: string; fields: UpstreamComparisonField[] }
export type UpstreamReviewRecord = {
  chapterId: number
  eventId: string
  sourceId: string
  fingerprint: string
  decision: UpstreamReviewDecision
  reason: string
  decidedAt: string
  evidence?: UpstreamReviewEvidence
}
export type UpstreamReviewFinding = {
  eventId: string
  eventVersion: string
  sourceId: string
  provenanceRevision: string
  sourceVersion: string | null
  fingerprint: string
  status: 'pending' | 'blocked' | 'clear' | UpstreamReviewDecision
  fields: UpstreamComparisonField[]
  decision: UpstreamReviewRecord | null
}
export type ChapterUpstreamReview = { findings: UpstreamReviewFinding[]; history: UpstreamReviewRecord[] }
export type UpstreamReviewInput = { workItemId: string; chapterId: number; fingerprint: string; decision: UpstreamReviewDecision; reason: string }

function fingerprint(value: unknown): string {
  const result = requiredString(value, 'fingerprint', 64)
  if (!/^[a-f0-9]{64}$/.test(result)) invalid('fingerprint', '格式无效')
  return result
}
export const decodeUpstreamReviewArgs: ArgsDecoder<[UpstreamReviewInput]> = args => {
  exactArgs(args, 1)
  const v = exactRecord(args[0], 'review', ['workItemId', 'chapterId', 'fingerprint', 'decision', 'reason'])
  return [{ workItemId: requiredString(v.workItemId, 'workItemId', 4096), chapterId: boundedInteger(v.chapterId, 'chapterId', 1, 1_000_000),
    fingerprint: fingerprint(v.fingerprint), decision: enumValue(v.decision, 'decision', ['no-conflict', 'needs-upstream-change']), reason: requiredString(v.reason, 'reason', 2000) }]
}

export function decodeUpstreamReviewRecord(value: unknown): UpstreamReviewRecord {
  const v = record(value, 'decision')
  rejectUnknown(v, 'decision', ['chapterId', 'eventId', 'sourceId', 'fingerprint', 'decision', 'reason', 'decidedAt', 'evidence'])
  const decidedAt = requiredString(v.decidedAt, 'decidedAt', 40)
  if (Number.isNaN(Date.parse(decidedAt))) invalid('decidedAt', '日期无效')
  return { chapterId: boundedInteger(v.chapterId, 'chapterId', 1, 1_000_000), eventId: requiredString(v.eventId, 'eventId', 200),
    sourceId: requiredString(v.sourceId, 'sourceId', 200), fingerprint: fingerprint(v.fingerprint),
    decision: enumValue(v.decision, 'decision', ['no-conflict', 'needs-upstream-change']), reason: requiredString(v.reason, 'reason', 2000), decidedAt,
    ...(v.evidence !== undefined ? { evidence: decodeEvidence(v.evidence) } : {}) }
}

function comparisonFields(value: unknown): UpstreamComparisonField[] {
  if (!Array.isArray(value) || value.length !== 5) invalid('fields', '缺少对照字段')
  const fields = value.map(raw => {
    const r = exactRecord(raw, 'field', ['field', 'source', 'detail', 'changed'])
    const source = boundedString(r.source, 'source', 20100), detail = boundedString(r.detail, 'detail', 20100)
    if (typeof r.changed !== 'boolean' || r.changed !== (source !== detail)) invalid('changed', '与对照内容不一致')
    return { field: enumValue(r.field, 'field', ['time', 'characters', 'location', 'event', 'result']), source, detail, changed: r.changed }
  })
  if (new Set(fields.map(f => f.field)).size !== 5) invalid('fields', '重复字段')
  return fields
}

function decodeEvidence(value: unknown): UpstreamReviewEvidence {
  const v = exactRecord(value, 'evidence', ['eventVersion', 'sourceVersion', 'provenanceRevision', 'fields'])
  return { eventVersion: requiredString(v.eventVersion, 'eventVersion', 200), sourceVersion: requiredString(v.sourceVersion, 'sourceVersion', 200),
    provenanceRevision: requiredString(v.provenanceRevision, 'provenanceRevision', 200), fields: comparisonFields(v.fields) }
}

export function decodeChapterUpstreamReview(value: unknown): ChapterUpstreamReview {
  const v = exactRecord(value, 'upstream', ['findings', 'history'])
  if (!Array.isArray(v.findings) || v.findings.length > 200 || !Array.isArray(v.history) || v.history.length > 20) invalid('upstream', '超出复核范围')
  const findings = v.findings.map(item => {
    const f = exactRecord(item, 'finding', ['eventId', 'eventVersion', 'sourceId', 'provenanceRevision', 'sourceVersion', 'fingerprint', 'status', 'fields', 'decision'])
    const fields = comparisonFields(f.fields)
    const result: UpstreamReviewFinding = { eventId: requiredString(f.eventId, 'eventId', 200), eventVersion: requiredString(f.eventVersion, 'eventVersion', 200), sourceId: requiredString(f.sourceId, 'sourceId', 200),
      provenanceRevision: requiredString(f.provenanceRevision, 'provenanceRevision', 200), sourceVersion: f.sourceVersion === null ? null : requiredString(f.sourceVersion, 'sourceVersion', 200), fingerprint: fingerprint(f.fingerprint),
      status: enumValue(f.status, 'status', ['pending', 'blocked', 'clear', 'no-conflict', 'needs-upstream-change']), fields, decision: f.decision === null ? null : decodeUpstreamReviewRecord(f.decision) }
    if (result.decision && (result.decision.fingerprint !== result.fingerprint || result.decision.eventId !== result.eventId || result.decision.sourceId !== result.sourceId)) invalid('decision', '与复核项不一致')
    const evidence = result.decision?.evidence
    if (evidence && (evidence.eventVersion !== result.eventVersion || evidence.sourceVersion !== result.sourceVersion || evidence.provenanceRevision !== result.provenanceRevision
      || JSON.stringify(evidence.fields) !== JSON.stringify(result.fields))) invalid('evidence', '与当前判断依据不一致')
    if (['no-conflict', 'needs-upstream-change'].includes(result.status) && result.decision?.decision !== result.status) invalid('status', '缺少对应判断')
    return result
  })
  if (new Set(findings.map(f => f.fingerprint)).size !== findings.length) invalid('findings', '重复复核项')
  return { findings, history: v.history.map(decodeUpstreamReviewRecord) }
}
