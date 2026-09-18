import { AppError } from '../../../core/errors/app-error'

export type StoryRevisionRef = {
  kind: 'material' | 'total-outline' | 'volume-outline' | 'chapter-skeleton' | 'chapter-outline' | 'event' | 'manuscript'
  id: string
  revision: string
}

/** Origin is explanatory history. It is never an implicit freshness dependency. */
export type StorySourceEdge = {
  source: StoryRevisionRef
  relation: 'derived-from' | 'refines' | 'realizes' | 'deviates-from' | 'supersedes'
}

export type StoryDependencyState = 'current' | 'stale' | 'untracked' | 'upstream-review-required'
export type StoryDependencyManifest = { sources: StoryRevisionRef[]; fingerprint: string }
export type StoryUpstreamReviewFinding = { source: StoryRevisionRef; reason: string }

/** Version-bound display evidence; absence differs from an explicitly empty value. */
export type StoryEventDisplayMetadata = { title?: string; rawCharacters?: string }

export type StoryEventContent = StoryEventDisplayMetadata & {
  time: string
  characters: string[]
  location: string
  event: string
  result?: string
  evidenceRefs: Array<{ sourceId: string; excerpt: string }>
  confidence: number
}

export type StoryEventVersionPayload = {
  content: StoryEventContent
  status: 'candidate' | 'approved'
  granularity: 'macro' | 'chapter-detail' | 'legacy-unknown'
  phase: 'planned' | 'realized' | 'deviated' | 'legacy-unknown'
  creator: 'author' | 'model-candidate' | 'manuscript-extraction' | 'legacy-unknown'
  sources: StorySourceEdge[]
}

export type StoryEventVersion = StoryEventVersionPayload & {
  id: string
  eventId: string
  projectId: string
  version: number
  previousVersionId: string | null
  contentHash: string
  createdAt: string
}

export type StoryEventVersionHeads = {
  latestVersionId: string
  approvedVersionId: string | null
}

export type AppendStoryEventVersionInput = StoryEventVersionPayload & {
  eventId: string
  expectedVersionId: string
}

const revisionKinds = ['material', 'total-outline', 'volume-outline', 'chapter-skeleton', 'chapter-outline', 'event', 'manuscript']
const relations = ['derived-from', 'refines', 'realizes', 'deviates-from', 'supersedes']

function invalid(): never {
  throw new AppError('VALIDATION_ERROR', '事件版本、来源或内容无效。', { recoverable: true })
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}

function text(value: unknown, max: number, allowEmpty = false): asserts value is string {
  if (typeof value !== 'string' || value.length > max || value.includes('\u0000') || (!allowEmpty && !value.trim())) invalid()
}

export function assertStoryIdentifier(value: unknown): asserts value is string {
  text(value, 200)
  if (value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) invalid()
}

export function assertStoryRevisionRef(value: unknown): asserts value is StoryRevisionRef {
  const ref = record(value)
  if (typeof ref.kind !== 'string' || !revisionKinds.includes(ref.kind)) invalid()
  assertStoryIdentifier(ref.id)
  assertStoryIdentifier(ref.revision)
  if (ref.kind === 'material' && !/^[a-f0-9]{64}$/.test(ref.revision)) invalid()
}

export function assertStoryEventDisplayMetadata(value: unknown): asserts value is StoryEventDisplayMetadata & Record<string, unknown> {
  const metadata = record(value)
  if (metadata.title !== undefined) text(metadata.title, 200, true)
  if (metadata.rawCharacters !== undefined) text(metadata.rawCharacters, 20_000, true)
}

export function assertStoryEventVersionPayload(value: unknown): asserts value is StoryEventVersionPayload {
  const payload = record(value)
  const content = record(payload.content)
  assertStoryEventDisplayMetadata(content)
  text(content.time, 500)
  text(content.location, 500)
  text(content.event, 20_000)
  if (content.result !== undefined) text(content.result, 20_000, true)
  if (!Array.isArray(content.characters) || !content.characters.length || content.characters.length > 100) invalid()
  content.characters.forEach((name) => text(name, 200))
  if (typeof content.confidence !== 'number' || !Number.isFinite(content.confidence) || content.confidence < 0 || content.confidence > 1) invalid()
  if (typeof payload.status !== 'string' || !['candidate', 'approved'].includes(payload.status)
    || typeof payload.granularity !== 'string' || !['macro', 'chapter-detail', 'legacy-unknown'].includes(payload.granularity)
    || typeof payload.phase !== 'string' || !['planned', 'realized', 'deviated', 'legacy-unknown'].includes(payload.phase)
    || typeof payload.creator !== 'string' || !['author', 'model-candidate', 'manuscript-extraction', 'legacy-unknown'].includes(payload.creator)) invalid()
  if (!Array.isArray(payload.sources) || payload.sources.length > 200) invalid()
  const sourceKeys = new Set<string>()
  for (const value of payload.sources) {
    const edge = record(value)
    assertStoryRevisionRef(edge.source)
    if (typeof edge.relation !== 'string' || !relations.includes(edge.relation)) invalid()
    const key = JSON.stringify([edge.relation, edge.source.kind, edge.source.id, edge.source.revision])
    if (sourceKeys.has(key)) invalid()
    sourceKeys.add(key)
  }
  if (!Array.isArray(content.evidenceRefs) || content.evidenceRefs.length > 100) invalid()
  for (const value of content.evidenceRefs) {
    const evidence = record(value)
    assertStoryIdentifier(evidence.sourceId)
    text(evidence.excerpt, 2_000)
    if (!(payload.phase === 'legacy-unknown' && payload.granularity === 'legacy-unknown')
      && !(payload.sources as StorySourceEdge[]).some((edge) => edge.source.kind === 'material' && edge.source.id === evidence.sourceId)) invalid()
  }
  if (['realized', 'deviated'].includes(String(payload.phase))
    && !(payload.sources as StorySourceEdge[]).some((edge) => edge.source.kind === 'manuscript')) invalid()
}

export function assertAppendStoryEventVersionInput(value: unknown): asserts value is AppendStoryEventVersionInput {
  assertStoryEventVersionPayload(value)
  const input = value as AppendStoryEventVersionInput
  assertStoryIdentifier(input.eventId)
  assertStoryIdentifier(input.expectedVersionId)
  if (input.status === 'approved' && input.creator !== 'author') invalid()
  if (input.content.evidenceRefs.some((evidence) => !input.sources.some((edge) => edge.source.kind === 'material' && edge.source.id === evidence.sourceId))) invalid()
}

/** Explicit field selection makes hashes independent of callers' property ordering. */
export function storyEventVersionPayload(value: StoryEventVersionPayload): StoryEventVersionPayload {
  assertStoryEventVersionPayload(value)
  return {
    content: {
      time: value.content.time, characters: [...value.content.characters], location: value.content.location,
      event: value.content.event, ...(value.content.result !== undefined ? { result: value.content.result } : {}),
      evidenceRefs: value.content.evidenceRefs.map(({ sourceId, excerpt }) => ({ sourceId, excerpt })), confidence: value.content.confidence,
      // Append only when present: historical payload bytes/hashes stay unchanged.
      ...(value.content.title !== undefined ? { title: value.content.title } : {}),
      ...(value.content.rawCharacters !== undefined ? { rawCharacters: value.content.rawCharacters } : {})
    },
    status: value.status, granularity: value.granularity, phase: value.phase, creator: value.creator,
    sources: value.sources.map(({ source, relation }) => ({ source: { kind: source.kind, id: source.id, revision: source.revision }, relation }))
  }
}
