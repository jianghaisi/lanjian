import type { Chapter } from '../manuscript/types'
import type { CreativePolicyRecord } from '@lanjian/writing-plugin-contracts'
import type { ChapterContractVersionRef } from '../assistant/types'
import type { CharacterStateView } from '../characters/types'
import type { CheatSystemData, FoundationData, PowerSystemData } from '../worldbuilding/types'

export type IdeaView = {
  generationSource?: { taskId: string; optionIndex: number }
  id: string
  title: string
  content: string
  status: 'candidate' | 'approved' | 'archived'
  promotedToType: 'world_rule' | 'summary' | null
  promotedToId: string | null
  createdAt: string
  updatedAt: string
}

export type IdeaGenerationInput = {
  operationId: string
  ideaId: string
  expectedUpdatedAt: string
  mode: 'diverge' | 'synopsis'
  instruction: string
}

export type PlanningOutlineSource = {
  projectFingerprint: string
  key: string
  kind: 'summary' | 'volume' | 'stage' | 'chapter'
  title: string
  content: string
  revision: string
}

export type OutlineExpansionInput = {
  parentKey: string
  expectedRevision: string
  count: number
  instruction: string
}

export type OutlineExpansionTaskInput = OutlineExpansionInput & { operationId: string }

export type OutlineExpansionTask = {
  id: string
  status: IdeaGenerationTask['status']
  createdAt: string
  model: string
  request: OutlineExpansionTaskInput
  sourceStale: boolean
  proposal: OutlineExpansionProposal | null
  error: string | null
  rawResult?: string
  adoptedKeys?: string[]
}

export type OutlineExpansionAdoptionPreview = {
  token: string
  taskId: string
  parentTitle: string
  children: Array<{ key: string; title: string; content: string }>
}

export type OutlineExpansionAdoptionResult = { keys: string[]; mirrorPending: boolean }

export type OutlineExpansionProposal = {
  creativePolicy?: CreativePolicyRecord[]
  methodVersion?: 'story-v1'
  id: string
  createdAt: string
  source: PlanningOutlineSource
  sourceStale: boolean
  childType: 'volume' | 'stage' | 'chapter'
  children: Array<{
    title: string
    content: string
    events: Array<{ time: string; characters: string[]; location: string; event: string }>
  }>
}

export type IdeaGenerationProposal = {
  options: Array<{ title: string; content: string; rationale: string }>
}

export type IdeaGenerationTask = {
  id: string
  ideaId: string
  mode: IdeaGenerationInput['mode']
  status: 'queued' | 'preparing' | 'running' | 'streaming' | 'succeeded' | 'cancelled' | 'failed' | 'interrupted'
  model: string
  createdAt: string
  sourceStale: boolean
  proposal: IdeaGenerationProposal | null
  error: string | null
  rawResult?: string
}

export type IdeaSaveInput = {
  generationSource?: { taskId: string; optionIndex: number }
  id?: string
  title: string
  content: string
  status?: IdeaView['status']
}

export type OutlineMirrorRecoveryPreview = {
  token: string
  chapterId: number
  sqliteContent: string
  externalContent: string
  expiresAt: string
}

export type OutlineMirrorRecoveryResult = {
  outline: PlannedChapterOutline
  previousOutlineVersionId: string
  importedExternalHash: string
  mirrorPending: boolean
}

export type OutlineVolume = number | 'total'

export type VolumeOutline = { volume: number; title: string; content: string }

export type StageOutline = {
  stage: number
  volume: number
  title: string
  content: string
  chapterIds: number[]
  mirrorStatus?: 'pending' | 'synced' | 'conflict' | 'failed'
}

export type ChapterOutlineEntry = {
  chapterId: number
  title: string
  revision: string
  volume: number | null
  stage: number | null
  hasManuscript: boolean
  mirrorStatus: 'pending' | 'synced' | 'conflict' | 'failed'
}

export type PlannedChapterOutline = ChapterOutlineEntry & { content: string }

export type PlannedChapterOutlineUpdate = {
  chapterId: number
  title: string
  content: string
  expectedRevision: string
}

export type PlannedChapterStartInput = { chapterId: number; expectedRevision: string }

export type PlannedChapterStartResult = { chapter: Chapter; created: boolean; mirrorPending: boolean }

export type OutlineList = {
  total: { content: string } | null
  volumes: VolumeOutline[]
  stages?: StageOutline[]
  chapterOutlines?: ChapterOutlineEntry[]
}

export type OutlineDocument = { volume?: number; content: string }

export type OutlineUpdateResult = {
  success: true
  volume: OutlineVolume
  content: string
  storageMode?: 'files' | 'sqlite'
  mirrorStatus?: 'pending' | 'synced' | 'conflict' | 'failed'
}

export type ChapterOutlineDocument = {
  chapterId: number
  content: string
  storageMode?: 'files' | 'sqlite'
  mirrorStatus?: 'pending' | 'synced' | 'conflict' | 'failed'
}

export type StageOutlineUpdateResult = {
  success: true
  stage: StageOutline
  storageMode: 'sqlite'
}

export type OutlineReviewIssue = {
  code: string
  level: 'error' | 'warning'
  message: string
}

export type ChapterOutlineReview = {
  upstream?: import('./upstream-review-contracts').ChapterUpstreamReview
  status: 'missing' | 'needs-changes' | 'ready' | 'confirmed' | 'stale'
  canConfirm: boolean
  issues: OutlineReviewIssue[]
  metrics: {
    beatCount: number
    forbiddenCount: number
    formalEventCount: number
    boundaryCount: number
    foreshadowCount: number
  }
  confirmedAt?: string
}

export type PlanningOutlineReviewIssue = {
  code: string
  level: 'warning' | 'info'
  message: string
  suggestion: string
}

export type PlanningOutlineReview = {
  scope: OutlineVolume
  status: 'clear' | 'attention' | 'acknowledged'
  issues: PlanningOutlineReviewIssue[]
  metrics: {
    characterCount: number
    sectionCount: number
    causalCueCount: number
    eventCount: number
    chapterCount: number
  }
  fingerprint: string
  acknowledgedAt?: string
}

export type PlanningOutlineApproval = {
  scope: OutlineVolume
  status: 'missing' | 'needs-review' | 'blocked' | 'ready' | 'confirmed' | 'stale'
  canConfirm: boolean
  reason: string
  fingerprint: string
  confirmedAt?: string
}

export type ChapterOutlinePlanningStatus = {
  chapterId: number
  hasContent: boolean
  volume?: number
  basedOnTotalRevision?: number
  basedOnVolumeRevision?: number
  volumeRevision?: number
  stale: boolean
  reason: 'missing' | 'untracked' | 'current' | 'upstream-changed'
  review: ChapterOutlineReview
  contractVersion?: ChapterContractVersionRef
}

export type OutlinePlanningVolume = {
  volume: number
  title: string
  eventIds: string[]
  origin: 'planned' | 'existing-outline'
  revision: number
  outlineExists: boolean
  externalChangeDetected: boolean
  review: PlanningOutlineReview
  approval: PlanningOutlineApproval
}

export type OutlinePlanningStatus = {
  totalRevision: number
  totalOutlineExists: boolean
  externalChangeDetected: boolean
  totalReview: PlanningOutlineReview
  totalApproval: PlanningOutlineApproval
  assignedEventIds: string[]
  unplacedEventIds: string[]
  volumes: OutlinePlanningVolume[]
  chapterPlacements: Array<{ chapterId: number; volume: number }>
  eventChapterPlacements: Array<{ eventId: string; chapterId: number }>
  chapter?: ChapterOutlinePlanningStatus
}

export type PlanningStage = 'blueprint' | 'totalOutline' | 'volumePlan'

export type PlanningChapterSkeletonStage = 'chapterSkeleton'

export type PlanningChapterDetailStage = 'chapterDetail'

export type PlanningJobStatus = 'running' | 'completed' | 'cancelled' | 'failed'

export type PlanningCharacterSeed = {
  name: string
  role: string
  arcSeed: string
}

export type PlanningBlueprintProposal = {
  premise: string
  worldView: string
  characters: PlanningCharacterSeed[]
  powerSystem: string
  cheatSystem: string
  rationale: string
}

export type PlanningTotalOutlineProposal = {
  title: string
  summary: string
  content: string
}

export type PlanningVolumeProposal = {
  storyContent?: string
  order: number
  title: string
  goal: string
  summary: string
  ending: string
}

export type PlanningChapterSkeletonEntry = {
  chapter: number
  volume: number
  volumeChapter: number
  title: string
  coreEvent: string
  characters: string[]
  location: string
  result: string
}

export type PlanningChapterSkeletonProposal = {
  creativePolicy?: CreativePolicyRecord[]
  generatedAt: string
  basedOn: {
    totalOutlineFingerprint: string
    volumePlanFingerprint: string
  }
  targetWordsPerChapter: number
  chapters: PlanningChapterSkeletonEntry[]
}

export type PlanningChapterSkeletonStatus = {
  exists: boolean
  stale: boolean
  chapterCount: number
  volumeCount: number
  reason?: string
}

export type FormalSkeletonView = {
  volume: number
  fingerprint: string
  canAdopt: boolean
  reason: string
  entries: Array<{
    chapter: number
    title: string
    revision: string | null
    status: 'untracked' | 'current' | 'stale' | 'changed'
    reasons: string[]
  }>
  affectedChapterIds: number[]
}

export type FormalSkeletonPreview = FormalSkeletonView & { token: string; proposalId: string }

export type ChapterEventReference = {
  id: string
  replaceable?: boolean
  version: string | null
  phase: 'planned' | 'realized' | 'deviated' | 'legacy-unknown'
  time: string
  characters: string[]
  location: string
  event: string
  result: string | null
}

export type ChapterEventRefinementSource = { eventId: string; eventVersionId: string }
export type ChapterEventDraft = { time: string; characters: string[]; location: string; event: string; result: string; refines?: ChapterEventRefinementSource; replaces?: ChapterEventRefinementSource }
export type ChapterEventReplacementImpact = { chapterIds: number[]; skeletonChapterIds: number[] }
export type ChapterEventAdoptionPreview = {
  token: string; operationId: string; proposalId: string; chapterId: number
  event: ChapterEventDraft; chapterContent: string; replacesChapter: boolean; existingEventCount: number
  events?: ChapterEventDraft[]
  replacementImpact?: ChapterEventReplacementImpact
}
export type ChapterEventAdoptionResult = {
  chapterId: number; eventId: string; eventVersionId: string
  mirrorsPending: boolean; candidateReceiptPending: boolean
  events?: Array<{ eventId: string; eventVersionId: string }>
}

/** Informational comparison only; this fingerprint is never an adoption grant. */
export type ChapterEventPreview = {
  workItemId: string
  proposalId: string
  chapterId: number
  fingerprint: string
  freshness: 'current' | 'stale' | 'untracked'
  candidate: {
    title: string
    time: null
    characters: string[]
    location: string
    coreEvent: string
    plannedResult: string
    entryState: string
    beats: string[]
    exitState: string
  }
  formalEvents: ChapterEventReference[]
  findings: Array<{ code: 'TIME_UNSPECIFIED' | 'SOURCE_CHANGED' | 'UNTRACKED_CANDIDATE' | 'SEMANTIC_REVIEW_REQUIRED'; message: string }>
}

export type PlanningChapterDetailEntry = {
  storyContent?: string
  chapter: number
  volume: number
  volumeChapter: number
  title: string
  entryState: string
  beats: string[]
  exitState: string
  allowedFacts: string[]
  forbiddenEvents: string[]
  foreshadowActions: Array<{
    action: 'plant' | 'advance' | 'misdirect' | 'resolve' | 'hold' | 'discard'
    description: string
  }>
}

export type PlanningChapterDetailVolumeProposal = {
  creativePolicy?: CreativePolicyRecord[]
  volume: number
  generatedAt: string
  basedOn: { totalOutlineFingerprint: string; volumeOutlineFingerprint: string; skeletonFingerprint: string; formalSkeletonFingerprint?: string }
  chapters: PlanningChapterDetailEntry[]
}

export type PlanningChapterDetailStatus = {
  volume: number
  exists: boolean
  stale: boolean
  chapterCount: number
  reason?: string
}

export type PlanningTotalOutlineAdoption = {
  fingerprint: string
  adoptedAt: string
  revision: number
}

export type PlanningVolumeStructureAdoption = {
  fingerprint: string
  initializedAt: string
  totalRevision: number
}

export type PlanningVolumeOutlineAdoption = {
  order: number
  fingerprint: string
  adoptedAt: string
  revision: number
  totalFingerprint: string
}

export type PlanningChapterDetailAdoption = {
  chapter: number
  candidateFingerprint: string
  adoptedAt: string
  totalFingerprint: string
  volumeFingerprint: string
}

export type PlanningCharacterSeedAdoption = {
  fingerprint: string
  adoptedAt: string
  anchorFingerprint: string
}

export type PlanningWorldSeedAdoption = {
  fingerprint: string
  adoptedAt: string
  foundationFingerprint: string
}

export type PlanningPowerSystemAdoption = {
  fingerprint: string
  adoptedAt: string
  powerSystemFingerprint: string
}

export type PlanningCheatSystemAdoption = {
  fingerprint: string
  adoptedAt: string
  cheatSystemFingerprint: string
}

export type PlanningPackageProposal = {
  creativePolicy?: CreativePolicyRecord[]
  id: string
  workItemId: string
  createdAt: string
  basedOn: {
    inputFingerprint: string
    blueprintFingerprint: string
    totalOutlineFingerprint: string
  }
  blueprint: PlanningBlueprintProposal
  totalOutline: PlanningTotalOutlineProposal
  volumes: PlanningVolumeProposal[]
  chapterSkeleton?: PlanningChapterSkeletonProposal
  chapterDetails?: PlanningChapterDetailVolumeProposal[]
  adoption?: {
    totalOutline?: PlanningTotalOutlineAdoption
    volumeStructure?: PlanningVolumeStructureAdoption
    volumeOutlines?: PlanningVolumeOutlineAdoption[]
    chapterOutlines?: PlanningChapterDetailAdoption[]
    characterSeeds?: PlanningCharacterSeedAdoption
    worldSeed?: PlanningWorldSeedAdoption
    powerSystem?: PlanningPowerSystemAdoption
    cheatSystem?: PlanningCheatSystemAdoption
  }
}

export type PlanningTotalAdoptionPreview = {
  proposalId: string
  candidateFingerprint: string
  currentFingerprint: string
  changes: boolean
  current: { exists: boolean; excerpt: string; characterCount: number; revision: number; confirmed: boolean }
  candidate: { title: string; excerpt: string; characterCount: number }
  affected: { chapterOutlines: number; confirmedVolumes: number; totalConfirmation: boolean }
}

export type PlanningTotalAdoptionResult = {
  proposal: PlanningPackageProposal
  planning: OutlinePlanningStatus
}

export type PlanningVolumeStructurePreview = {
  proposalId: string
  candidateFingerprint: string
  currentFingerprint: string
  totalFingerprint: string
  changes: boolean
  actions: Array<{
    order: number
    action: 'create' | 'rename' | 'keep'
    fromTitle?: string
    toTitle: string
    outlineExists: boolean
  }>
  preservedExtraVolumes: Array<{ order: number; title: string }>
  conflicts: string[]
  affected: { placedChapters: number; confirmedVolumes: number; totalConfirmation: boolean }
}

export type PlanningVolumeStructureResult = {
  proposal: PlanningPackageProposal
  planning: OutlinePlanningStatus
}

export type PlanningVolumeOutlinePreview = {
  proposalId: string
  order: number
  parentFingerprint: string
  candidateFingerprint: string
  currentFingerprint: string
  changes: boolean
  current: { exists: boolean; excerpt: string; characterCount: number; revision: number; confirmed: boolean }
  candidate: { title: string; excerpt: string; characterCount: number }
  affected: { chapterOutlines: number; volumeConfirmation: boolean }
}

export type PlanningVolumeOutlineResult = {
  proposal: PlanningPackageProposal
  planning: OutlinePlanningStatus
}

export type PlanningChapterDetailAdoptionPreview = {
  proposalId: string
  chapterId: number
  volume: number
  upstreamFingerprint: string
  candidateFingerprint: string
  currentFingerprint: string
  changes: boolean
  current: { exists: boolean; excerpt: string; characterCount: number; confirmed: boolean }
  candidate: { title: string; excerpt: string; characterCount: number; beatCount: number }
  affected: { confirmation: boolean; formalEvents: number }
}

export type PlanningChapterDetailAdoptionResult = {
  proposal: PlanningPackageProposal
  planning: OutlinePlanningStatus
}

export type PlanningCharacterSeedPreview = {
  proposalId: string
  candidateFingerprint: string
  currentFingerprint: string
  changes: boolean
  conflicts: string[]
  actions: Array<{
    name: string
    action: 'create' | 'enrich' | 'update' | 'keep'
    candidate: { role: string; arcSeed: string }
    current?: { role?: string; arcSeed?: string }
  }>
  affected: { existingAnchors: number; dynamicSnapshots: number; pendingConflicts: number }
}

export type PlanningCharacterSeedResult = {
  proposal: PlanningPackageProposal
  characters: CharacterStateView
}

export type PlanningWorldSeedPreview = {
  proposalId: string
  candidateFingerprint: string
  currentFingerprint: string
  changes: boolean
  current: { exists: boolean; excerpt: string; characterCount: number }
  candidate: { excerpt: string; characterCount: number }
  preserved: { sourceNotes: boolean; useRealms: boolean; useSystem: boolean }
}

export type PlanningWorldSeedResult = {
  proposal: PlanningPackageProposal
  foundation: FoundationData
}

export type PlanningPowerSystemPreview = {
  proposalId: string
  candidateFingerprint: string
  currentFingerprint: string
  changes: boolean
  current: { exists: boolean; excerpt: string; characterCount: number }
  candidate: { exists: boolean; excerpt: string; characterCount: number }
  preserved: { realmLevels: number; realmsEnabled: boolean }
}

export type PlanningPowerSystemResult = {
  proposal: PlanningPackageProposal
  powerSystem: PowerSystemData
}

export type PlanningCheatSystemPreview = {
  proposalId: string
  candidateFingerprint: string
  currentFingerprint: string
  changes: boolean
  current: { exists: boolean; excerpt: string; characterCount: number }
  candidate: { exists: boolean; excerpt: string; characterCount: number }
  preserved: { templateCharacters: number; systemEnabled: boolean }
}

export type PlanningCheatSystemResult = {
  proposal: PlanningPackageProposal
  cheatSystem: CheatSystemData
}

export type PlanningJob = {
  recovery?: { saved: boolean; action: 'review' | 'stage' | 'save' | 'none' }
  rawResult?: string
  id: string
  workItemId: string
  status: PlanningJobStatus
  stage: PlanningStage
  progress: {
    completed: number
    total: 3
    message: string
  }
  startedAt: string
  completedAt?: string
  proposal?: PlanningPackageProposal
  error?: { code: 'GENERATION_FAILED'; message: string; stage: PlanningStage }
}

export type PlanningChapterSkeletonJob = {
  rawResult?: string
  id: string
  workItemId: string
  proposalId: string
  status: PlanningJobStatus
  stage: PlanningChapterSkeletonStage
  progress: { completed: number; total: number; message: string }
  startedAt: string
  completedAt?: string
  proposal?: PlanningPackageProposal
  error?: { code: 'GENERATION_FAILED'; message: string; stage: PlanningChapterSkeletonStage }
}

export type PlanningChapterDetailJob = {
  rawResult?: string
  id: string
  workItemId: string
  proposalId: string
  volume: number
  status: PlanningJobStatus
  stage: PlanningChapterDetailStage
  progress: { completed: number; total: number; message: string }
  startedAt: string
  completedAt?: string
  proposal?: PlanningPackageProposal
  error?: { code: 'GENERATION_FAILED'; message: string; stage: PlanningChapterDetailStage }
}

export type PlanningDraftRecoveryResult = {
  success: true
  recoveryRelativePath: string
}
