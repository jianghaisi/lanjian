import type { FactImportance, FactReviewClass } from '../review/types'

export type StoryEntityView = {
  id: string
  entityType: 'character' | 'location' | 'item' | 'organization' | 'world_rule'
  canonicalName: string
  profileJson: string
  status: 'candidate' | 'approved' | 'archived'
  createdAt: string
  updatedAt: string
}

export type StoryEntityRelationView = {
  id: string
  subjectEntityId: string
  predicate: string
  objectEntityId: string
  notes: string
  createdAt: string
  updatedAt: string
}

export type ResourceLedgerEntryView = {
  id: string
  operationKey: string
  resourceEntityId: string
  resourceName: string
  eventId: string | null
  factId: string | null
  delta: number
  resultingQuantity: number
  note: string
  createdAt: string
}

export type ResourceBalanceView = {
  resourceEntityId: string
  resourceName: string
  quantity: number
  isNegative: boolean
  lastChangedAt: string | null
}

export type ResourceLedgerView = {
  balances: ResourceBalanceView[]
  entries: ResourceLedgerEntryView[]
}

export type ForeshadowStatus = 'open' | 'resolved' | 'discarded'

export type ForeshadowAction = 'plant' | 'advance' | 'misdirect' | 'resolve' | 'hold' | 'discard'

export type ForeshadowSourceType = 'manual' | 'chapter_draft' | 'writing_agent'

export type ForeshadowView = {
  id: string
  title: string
  normalizedTitle: string
  status: ForeshadowStatus
  plantedChapterId: number | null
  payoffChapterId: number | null
  dataJson: string
  createdAt: string
  updatedAt: string
}

export type ForeshadowActionView = {
  id: string
  operationKey: string
  foreshadowId: string
  foreshadowTitle: string
  chapterId: number | null
  action: ForeshadowAction
  description: string
  evidence: string
  sourceType: ForeshadowSourceType
  createdAt: string
}

export type ForeshadowLedgerView = { foreshadows: ForeshadowView[]; actions: ForeshadowActionView[] }

export type CharacterAnchor = {
  id: string
  name: string
  /** Author-confirmed initial role from an adopted planning seed; prose settlement never overwrites it. */
  role?: string
  /** Author-confirmed direction, not a frozen current state; prose can raise a conflict instead of overwriting it. */
  arcSeed?: string
  /** Confirmed event/timeline or planning-adoption references. */
  sourceRefs: string[]
}

export type CharacterDynamicField =
  | 'location'
  | 'injury'
  | 'relationship'
  | 'knowledge'
  | 'possession'
  | 'goal'
  | 'power'
  | 'vitality'

export type CharacterDynamicChange = {
  character: string
  field: CharacterDynamicField
  value: string
  /** Optional event label used only to merge equivalent review candidates from the same story event. */
  event?: string
  /** Optional bounded model classification. Missing values remain reviewable for backward compatibility. */
  importance?: FactImportance
  reviewClass?: FactReviewClass
  /** Exact excerpt from the accepted manuscript candidate. */
  evidence: string
}

export type CharacterStableConflictField = 'identity' | 'motivation' | 'arc'

export type CharacterStableConflict = {
  character: string
  field: CharacterStableConflictField
  claimedValue: string
  /** Exact excerpt from the accepted manuscript candidate. */
  evidence: string
}

export type CharacterStateConflict = {
  id: string
  characterId: string
  name: string
  field: CharacterStableConflictField
  claimedValue: string
  /** Existing author-confirmed anchor when that field has a directly comparable value. */
  anchorValue?: string
  chapterId: number
  chapterPosition: number
  manuscriptRevision: string
  proposalId: string
  evidence: string
  /** Dismissed means the author reviewed the cited manuscript evidence and kept the stable anchor unchanged. */
  status: 'pending' | 'superseded' | 'dismissed'
}

export type CharacterStateEvent = {
  id: string
  characterId: string
  chapterId: number
  chapterPosition: number
  manuscriptRevision: string
  proposalId: string
  acceptedAt: string
  evidence: string
  /** False when the chapter was deleted or its current manuscript hash no longer matches. */
  active: boolean
  changes: {
    present: true
    location?: string
    injury?: string
    relationships?: string[]
    knowledge?: string[]
    /** End-of-chapter state of plot-relevant possessions, not an inferred inventory. */
    possession?: string
    goal?: string
    power?: string
    vitality?: 'alive' | 'dead'
  }
  /** Exact evidence retained per semantic state field; optional for legacy events. */
  changeEvidence?: Partial<Record<CharacterDynamicField, string>>
}

export type CharacterStateSnapshot = {
  characterId: string
  name: string
  throughChapter: number
  present: boolean
  location?: string
  injury?: string
  relationships?: string[]
  knowledge?: string[]
  possession?: string
  goal?: string
  power?: string
  vitality?: 'alive' | 'dead'
  lastEventId: string
}

export type CharacterLinePoint = CharacterStateSnapshot & {
  chapterId: number
  chapterPosition: number
  source: 'approved_fact' | 'accepted_prose'
  sourceId: string
}

export type CharacterLinesView = {
  version: 1
  workItemId: string
  source: 'sqlite-approved-facts' | 'legacy-accepted-prose'
  lines: Array<{
    characterId: string
    name: string
    points: CharacterLinePoint[]
  }>
}

export type CharacterStateView = {
  version: 1
  workItemId: string
  anchors: CharacterAnchor[]
  events: CharacterStateEvent[]
  snapshots: CharacterStateSnapshot[]
  pendingConflicts: CharacterStateConflict[]
}
