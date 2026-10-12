import { AppError } from '../../../core/errors/app-error'
import { assertStoryIdentifier, storyEventVersionPayload, type StoryEventContent } from './story-event-version'
import type { EventSourceSnapshot } from './event-source-snapshot'

type ExpectedEvent = { eventId: string; expectedVersionId: string; expectedLifecycleId: string }
type AuthorContent = { content: StoryEventContent; granularity: 'macro' | 'chapter-detail' | 'legacy-unknown' }
export type EventOperation = { expectedOrderId: string } & (
  | ({ kind: 'create'; granularity: 'macro' | 'chapter-detail' } & AuthorContent)
  | ({ kind: 'edit' } & ExpectedEvent & AuthorContent)
  | ({ kind: 'adopt' } & ExpectedEvent)
  | ({ kind: 'archive' } & ExpectedEvent)
  | ({ kind: 'restore' } & ExpectedEvent)
  | { kind: 'reorder'; eventIds: string[] }
)
export type VerifiedManuscriptAuthority = Readonly<{
  kind: 'verified-manuscript'
  manifestId: string
  sourceFingerprint: string
  evidenceFingerprint: string
  manuscriptSources: ReadonlyArray<Readonly<{ chapterId: number; id: string; revision: string }>>
}>
export type VerifiedMaterialCandidateAuthority = Readonly<{
  kind: 'verified-material-candidate'
  sourceId: string
  sourceRevision: string
}>
export type VerifiedModelCandidateAuthority = Readonly<{
  kind: 'verified-model-candidate'
  taskId: string
  artifactId: string
  artifactHash: string
  candidateIndex: number
}>
export type EventOperationAuthority = VerifiedManuscriptAuthority | VerifiedMaterialCandidateAuthority | VerifiedModelCandidateAuthority
export type EventOperationReview = Readonly<{
  operationId: string
  requestHash: string
  command: EventOperation
  snapshot: EventSourceSnapshot
  authority?: EventOperationAuthority
}>
export type EventOperationReceipt = Readonly<{
  operationId: string
  kind: EventOperation['kind']
  requestHash: string
  eventId: string | null
  versionId: string | null
  lifecycleId: string | null
  orderId: string
  noOp: boolean
  committedAt: string
}>
export interface EventOperationWritePort {
  commit(review: EventOperationReview, assertActive: () => void): EventOperationReceipt
  close(): void
}

/** Main-private authority. Renderer operation decoders never accept it. */
export function decodeVerifiedManuscriptAuthority(value: unknown): VerifiedManuscriptAuthority {
  const input = record(value)
  exact(input, ['kind', 'manifestId', 'sourceFingerprint', 'evidenceFingerprint', 'manuscriptSources'])
  if (input.kind !== 'verified-manuscript') invalid()
  assertStoryIdentifier(input.manifestId)
  if (typeof input.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.sourceFingerprint)
    || typeof input.evidenceFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.evidenceFingerprint)) invalid()
  if (!Array.isArray(input.manuscriptSources) || !input.manuscriptSources.length || input.manuscriptSources.length > 100) invalid()
  const manuscriptSources = input.manuscriptSources.map((value) => {
    const source = record(value)
    exact(source, ['chapterId', 'id', 'revision'])
    if (!Number.isSafeInteger(source.chapterId) || Number(source.chapterId) < 1) invalid()
    assertStoryIdentifier(source.id); assertStoryIdentifier(source.revision)
    return Object.freeze({ chapterId: Number(source.chapterId), id: source.id, revision: source.revision })
  })
  if (new Set(manuscriptSources.map((source) => `${source.chapterId}\0${source.id}\0${source.revision}`)).size !== manuscriptSources.length) invalid()
  return Object.freeze({
    kind: 'verified-manuscript',
    manifestId: input.manifestId,
    sourceFingerprint: input.sourceFingerprint,
    evidenceFingerprint: input.evidenceFingerprint,
    manuscriptSources: Object.freeze(manuscriptSources)
  })
}

/** Main-private proof that a create command must remain a candidate and is
 * bound to one exact material revision. */
export function decodeVerifiedMaterialCandidateAuthority(value: unknown): VerifiedMaterialCandidateAuthority {
  const input = record(value)
  exact(input, ['kind', 'sourceId', 'sourceRevision'])
  if (input.kind !== 'verified-material-candidate') invalid()
  assertStoryIdentifier(input.sourceId)
  if (typeof input.sourceRevision !== 'string' || !/^[a-f0-9]{64}$/.test(input.sourceRevision)) invalid()
  return Object.freeze({ kind: input.kind, sourceId: input.sourceId, sourceRevision: input.sourceRevision })
}

/** Main-private proof that a create command came from one immutable, successful
 * model Artifact owned by the current book. */
export function decodeVerifiedModelCandidateAuthority(value: unknown): VerifiedModelCandidateAuthority {
  const input = record(value)
  exact(input, ['kind', 'taskId', 'artifactId', 'artifactHash', 'candidateIndex'])
  if (input.kind !== 'verified-model-candidate') invalid()
  assertStoryIdentifier(input.taskId); assertStoryIdentifier(input.artifactId)
  if (typeof input.artifactHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.artifactHash)
    || !Number.isSafeInteger(input.candidateIndex) || Number(input.candidateIndex) < 0 || Number(input.candidateIndex) > 29) invalid()
  return Object.freeze({ kind: input.kind, taskId: input.taskId, artifactId: input.artifactId,
    artifactHash: input.artifactHash, candidateIndex: Number(input.candidateIndex) })
}

export function decodeEventOperationAuthority(value: unknown): EventOperationAuthority {
  const input = record(value)
  return input.kind === 'verified-manuscript'
    ? decodeVerifiedManuscriptAuthority(input)
    : input.kind === 'verified-material-candidate'
      ? decodeVerifiedMaterialCandidateAuthority(input)
      : decodeVerifiedModelCandidateAuthority(input)
}

/** Narrow intents, never renderer-supplied approval, phase, origin or source edges. */
export function decodeEventOperation(value: unknown): EventOperation {
  const input = { ...record(value) }
  const kinds = ['create', 'edit', 'adopt', 'archive', 'restore', 'reorder']
  if (typeof input.kind !== 'string' || !kinds.includes(input.kind)) invalid()
  const keys = ['kind', 'expectedOrderId']
  if (input.kind === 'reorder') keys.push('eventIds')
  else {
    if (input.kind !== 'create') keys.push('eventId', 'expectedVersionId', 'expectedLifecycleId')
    if (input.kind === 'create' || input.kind === 'edit') keys.push('content', 'granularity')
  }
  exact(input, keys)
  assertStoryIdentifier(input.expectedOrderId)
  if (input.kind === 'reorder') {
    if (!Array.isArray(input.eventIds) || input.eventIds.length > 100_000) invalid()
    input.eventIds.forEach(assertStoryIdentifier)
    if (new Set(input.eventIds).size !== input.eventIds.length) invalid()
  } else {
    if (input.kind !== 'create') {
      assertStoryIdentifier(input.eventId); assertStoryIdentifier(input.expectedVersionId); assertStoryIdentifier(input.expectedLifecycleId)
    }
    if (input.kind === 'create' || input.kind === 'edit') {
      if (!(input.kind === 'edit' ? ['macro', 'chapter-detail', 'legacy-unknown'] : ['macro', 'chapter-detail']).includes(String(input.granularity))) invalid()
      const content = record(input.content)
      exact(content, ['time', 'characters', 'location', 'event', 'evidenceRefs', 'confidence',
        ...['title', 'rawCharacters', 'result'].filter(key => Object.hasOwn(content, key))])
      if (!Array.isArray(content.evidenceRefs)) invalid()
      for (const evidence of content.evidenceRefs) exact(record(evidence), ['sourceId', 'excerpt'])
      // Check content shape before the owner resolves exact material revisions.
      input.content = storyEventVersionPayload({ content: content as StoryEventContent, status: 'approved', creator: 'author',
        phase: 'legacy-unknown', granularity: 'legacy-unknown', sources: [] }).content
    }
  }
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 16_776_000) invalid()
  return structuredClone(input) as EventOperation
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid()
}
function invalid(): never { throw new AppError('VALIDATION_ERROR', '事件操作包含无效或未支持的内容，请重新核对。', { recoverable: true }) }
