import type { EventMirrorFeedback } from './event-mirror'
import type { EventLifecycle, EventStateSnapshot } from './event-state'
import type { StoryEventVersionPayload, StoryRevisionRef, StorySourceEdge } from './story-event-version'

export type ProjectedStoryEventContent = Readonly<{
  time: string
  characters: readonly string[]
  location: string
  event: string
  result?: string
  evidenceRefs: readonly Readonly<{ sourceId: string; excerpt: string }>[]
  confidence: number
  title?: string
  rawCharacters?: string
}>

export type ProjectedStoryEvent = Readonly<{
  settlement?: Readonly<import('../../../../contracts/timeline/prose-event-settlement-contracts').SettlementStatus>
  eventId: string
  versionId: string
  version: number
  content: ProjectedStoryEventContent
  granularity: StoryEventVersionPayload['granularity']
  phase: StoryEventVersionPayload['phase']
  creator: StoryEventVersionPayload['creator']
  sources: readonly Readonly<{ relation: StorySourceEdge['relation']; source: Readonly<StoryRevisionRef> }>[]
  createdAt: string
}>

export type ArchivedProjectedEvent = Readonly<{
  lifecycle: EventLifecycle
  approved: ProjectedStoryEvent | null
  candidate: ProjectedStoryEvent | null
}>

/** Main-private until consumer routing and named desktop contracts land. */
export type UnifiedEventProjection = Readonly<{
  version: 1
  workItemId: string
  revision: string
  approvedRevision: string
  candidateRevision: string
  operationId: string
  committedAt: string
  ordering: 'author-display'
  state: EventStateSnapshot
  approved: readonly ProjectedStoryEvent[]
  candidates: readonly ProjectedStoryEvent[]
  archived: readonly ArchivedProjectedEvent[]
  mirror: EventMirrorFeedback | null
}>
