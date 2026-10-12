import type { AiTask } from '../models/types'
import type { SourceCard } from '../worldbuilding/types'
import type { EvidenceRef } from '../timeline/types'
import type { CharacterStateSnapshot } from '../characters/types'
import type { AdherenceReport, ApprovedFactView, FactImportance } from '../review/types'
import type { Chapter } from '../manuscript/types'

export type PromptAuthorityLayerView = {
  id: 'guardrails' | 'canon' | 'taskContext' | 'taskStrategy' | 'materials'
  order: number
  label: string
  source: string
  summary: string
}

export type PromptTemplateView = {
  task: AiTask
  label: string
  description: string
  builtIn: string
  override: string
  effective: string
  customized: boolean
  guardrails: string[]
  authorityLayers: PromptAuthorityLayerView[]
}

export type PromptProfileView = {
  version: 1
  workItemId: string
  genreLabel: string
  genreFingerprint: string
  storedGenreFingerprint: string
  baselineChanged: boolean
  storageMode: 'files' | 'sqlite'
  mirrorStatus: 'pending' | 'synced' | 'conflict' | 'failed' | null
  entries: PromptTemplateView[]
}

export type ContextFactEvidence = {
  chapterId: number
  chapterPosition: number
  chapterTitle: string
  manuscriptRevision: string
  excerpt: string
  reason: string
  score: number
  sourceType?: 'chapter' | 'document_chunk'
  chunkOrdinal?: number
  tokenEstimate?: number
}

export type ContextMaterialEvidence = {
  sourceId: string
  title: string
  provider: string
  sourceType: SourceCard['sourceType']
  contentHash: string
  excerpt: string
  userNotes: string
  url?: string
  reason: string
  score: number
}

export type ContextCanonicalEventView = {
  id: string
  versionId?: string
  phase: 'planned' | 'realized' | 'deviated' | 'legacy-unknown'
  time: string
  characters: string[]
  location: string
  event: string
  result?: string
  provenance: '统一事件正式版本' | '资料库正式事件' | '作者直接纪事'
  evidenceRefs: EvidenceRef[]
}

export type ContextCharacterStateView = Pick<
  CharacterStateSnapshot,
  | 'characterId'
  | 'name'
  | 'throughChapter'
  | 'present'
  | 'location'
  | 'injury'
  | 'relationships'
  | 'knowledge'
  | 'possession'
  | 'goal'
  | 'power'
  | 'vitality'
  | 'lastEventId'
>

export type ContextFactPackView = {
  version: 1
  workItemId: string
  chapterId?: number
  queryTerms: string[]
  structured: {
    eventApprovedRevision?: string
    canonicalEvents: ContextCanonicalEventView[]
    characterSnapshots: ContextCharacterStateView[]
    characterAliases: ContextCharacterAliasView[]
    approvedFacts: ApprovedFactView[]
    latestApprovedSummary?: ContextChapterSummaryView
    recentApprovedSummaries?: ContextChapterSummaryView[]
  }
  evidence: ContextFactEvidence[]
  materials?: ContextMaterialEvidence[]
  materialBudget?: {
    maxCharacters: number
    usedCharacters: number
    omittedEvidenceCount: number
    searchMode: 'sqlite' | 'files'
  }
  budget: { maxCharacters: number; usedCharacters: number; omittedEvidenceCount: number }
}

export type ContextCharacterAliasView = {
  characterId: string
  canonicalName: string
  aliases: string[]
}

export type ContextChapterSummaryView = {
  chapterId: number
  bodyVersionId: string
  content: string
  createdAt: string
}

export type ContextBudgetPreferences = {
  version: 1
  inputBudgetTokens: number
  modelContextLimit: number
  outputReservePercent: number
  systemReserveTokens: number
  recentSummaryCount: number
  structuredRepairAttempts: number
  minimumFactImportance: FactImportance
  showFactConfirmations: boolean
  pinnedEvidenceKeys: string[]
  excludedEvidenceKeys: string[]
  alwaysConfirmBeforeSend?: boolean
}

export const contextBudgetStartingSuggestions = {
  inputBudgetTokens: 120_000,
  modelContextLimit: 150_000,
  outputReservePercent: 25,
  systemReserveTokens: 10_000,
  recentSummaryCount: 3,
  structuredRepairAttempts: 1,
  minimumFactImportance: 'medium',
  showFactConfirmations: false
} as const

export type ChapterBeat = { id: string; order: number; requirement: string; eventRef?: string }

export type ChapterContractVersionRef = {
  storyConstraints?: import('../planning/chapter-story-contract').ChapterStoryConstraints
  fingerprint: string
  totalFingerprint: string
  volumeFingerprint?: string
  outlineHash: string
  eventIds: string[]
  eventVersions?: Array<{ eventId: string; versionId: string; phase: 'planned' | 'realized' | 'deviated' | 'legacy-unknown' }>
  eventApprovedRevision?: string
  confirmedAt: string
}

export type ChapterForeshadowAction = {
  id: string
  action: 'plant' | 'advance' | 'misdirect' | 'resolve' | 'hold' | 'discard'
  description: string
}

export type ChapterContract = {
  chapterId: number
  chapterPosition: number
  outlineSnapshot: string
  beats: ChapterBeat[]
  forbiddenEvents: string[]
  entryState: string
  exitState: string
  allowedFacts: string[]
  foreshadowActions: ChapterForeshadowAction[]
  version: ChapterContractVersionRef
}

export type ChapterDraftProposal = {
  id: string
  chapterId: number
  createdAt: string
  content: string
  contract: ChapterContract
  report: AdherenceReport
}

export type WritingAgentSkillId =
  | 'continue'
  | 'rewrite'
  | 'expand'
  | 'compress'
  | 'custom'
  | 'polish'
  | 'review'
  | 'query'
  | 'plan'

export type WritingAgentToolId = 'currentChapter' | 'chapterContract' | 'contextFacts' | 'consistencyGate'

export type WritingAgentSelection = { start: number; end: number; text: string }

export type WritingAgentInsertionAnchor = { offset: number; before: string; after: string }

export type WritingAgentContextAddition = { id: string; label: string; content: string }

export type WritingAgentContextSelection = {
  pinnedIds: string[]
  excludedIds: string[]
  temporaryAdditions: WritingAgentContextAddition[]
}

export type WritingAgentRequest = {
  chapterId: number
  message: string
  currentDraft: string
  /** Assertion only: main still selects the book and rejects a stale UI request. */
  expectedWorkItemId?: string
  /** When supplied, the model may run only with the exact context package the author previewed. */
  expectedContextHash?: string
  model?: string
  modelConnectionId?: string
  maxTokensOverride?: number
  preferredSkill?: WritingAgentSkillId
  selection?: WritingAgentSelection
  insertionAnchor?: WritingAgentInsertionAnchor
  contextSelection?: WritingAgentContextSelection
}

export type WritingAgentContextPreviewItem = {
  id: string
  label: string
  sourceType: string
  authority: 'required' | 'pinned' | 'related' | 'optional'
  included: boolean
  required: boolean
  mode: 'full' | 'compressed' | 'truncated' | 'excluded'
  estimatedTokens: number
  characters: number
  reasons: string[]
  preview: string
  exclusionReason?: 'user_excluded' | 'budget' | 'compression_unavailable' | 'compressed_over_budget' | 'drop_policy'
}

export type WritingAgentContextPreview = {
  version: 1
  workItemId: string
  chapterId: number
  skill: WritingAgentSkillId
  status: 'ready' | 'blocked'
  tokenBudget: number
  estimatedTokens: number
  remainingTokens: number
  truncated: boolean
  contentHash: string
  items: WritingAgentContextPreviewItem[]
  blockedMessage?: string
}

export type WritingAgentToolRun = {
  id: WritingAgentToolId
  label: string
  summary: string
}

export type WritingAgentDiffBlock = {
  id: string
  kind: 'equal' | 'change'
  before: string
  after: string
}

export type WritingAgentCandidate = {
  mode: 'append' | 'replaceSelection' | 'insertAtAnchor'
  content: string
  baseDraftFingerprint: string
  selection?: WritingAgentSelection
  insertionAnchor?: WritingAgentInsertionAnchor
  diff?: WritingAgentDiffBlock[]
}

export type WritingAgentChapterCardOption = {
  id: string
  title: string
  rationale: string
  goal?: string
  beats?: string[]
  conflict?: string
  characters?: string[]
  exitChange?: string
  hook?: string
}

export type WritingAgentTurn = {
  id: string
  workItemId: string
  chapterId: number
  createdAt: string
  model: string
  chapterCardFingerprint?: string
  skill: { id: WritingAgentSkillId; label: string }
  answer: string
  tools: WritingAgentToolRun[]
  candidate?: WritingAgentCandidate
  chapterCardOptions?: WritingAgentChapterCardOption[]
  proposal?: ChapterDraftProposal
}

export type WritingAgentTaskStatus =
  | 'queued'
  | 'resuming'
  | 'preparing'
  | 'running'
  | 'streaming'
  | 'paused'
  | 'succeeded'
  | 'cancelled'
  | 'failed'
  | 'interrupted'

export type WritingAgentTaskStart = {
  operationId: string
  request: WritingAgentRequest
}

export type WritingAgentTask = {
  id: string
  workItemId: string
  chapterId: number
  status: WritingAgentTaskStatus
  attempt: number
  parentTaskRunId?: string
  message: string
  baseDraft: string
  model?: string
  preferredSkill?: WritingAgentSkillId
  skill?: WritingAgentSkillId
  selection?: WritingAgentSelection
  insertionAnchor?: WritingAgentInsertionAnchor
  startedAt?: string
  completedAt?: string
  error?: { code: string; message: string }
  artifact?: { id: string; status: 'partial' | 'complete' | 'invalid' | 'discarded' | 'applied' }
  partial?: {
    id: string
    content: string
    status: 'partial' | 'complete' | 'invalid' | 'discarded' | 'applied'
    updatedAt: string
  }
  contextPackage?: {
    id: string
    compilerVersion: string
    contentHash: string
    tokenBudget: number
    estimatedTokens: number
    characterCount: number
    contextCount: number
    truncated: boolean
    createdAt: string
    skill: WritingAgentSkillId
    contexts: Array<{
      task: AiTask
      id?: string
      sourceType?: string
      label: string
      authority?: string
      mode?: string
      estimatedTokens?: number
      reasons?: string[]
      characters: number
      preview: string
    }>
  }
  turn?: WritingAgentTurn
}

export type TaskCenterItem = {
  id: string
  workItemId: string
  taskType: 'writing_agent' | 'idea_generation' | 'outline_expansion' | 'fact_extraction' | 'other'
  status: WritingAgentTaskStatus
  label: string
  detail: string
  chapterId?: number
  attempt: number
  parentTaskRunId?: string
  /** Same-project persisted child exists, including children outside the history page. */
  hasContinuation?: boolean
  createdAt: string
  updatedAt: string
  errorMessage?: string
  actions: Array<'view' | 'pause' | 'resume' | 'cancel' | 'retry'>
}

export type WritingAgentArtifactDecision = {
  taskId: string
  decision: 'applied' | 'discarded'
  acceptedChangeIds?: string[]
  /** Present only when the author explicitly reviewed every diff block and kept the original text. */
  reviewedChangeIds?: string[]
}

export type WritingAgentArtifactApplicationInput = {
  taskId: string
  title: string
  expectedRevision: string
  acceptedChangeIds?: string[]
  allowFailedReview?: boolean
  rebase?: { choices: Record<string, 'current' | 'candidate'> }
  formatting: {
    firstLineIndent: boolean
    paragraphSpacing: boolean
  }
}

export type WritingAgentArtifactApplicationResult = {
  task: WritingAgentTask
  chapter: Chapter
  insertedVersion: boolean
}

export type PromptProfileRecoveryResult = {
  success: true
  recoveryRelativePath: string
}
