import type { WorkflowStep } from '../library/types'
import type { CharacterDynamicChange, CharacterStableConflict } from '../characters/types'

export type FactBatchStatus =
  | 'PENDING'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'PARTIALLY_APPROVED'
  | 'REJECTED'
  | 'SUPERSEDED'
  | 'STALE'

export type FactDecisionValue = 'PENDING' | 'APPROVED' | 'REJECTED' | 'DEFERRED'

export type FactChangeType = 'NEW' | 'CHANGED' | 'CONFIRMS' | 'CONTRADICTS' | 'LOW_VALUE'

export type FactImportance = 'high' | 'medium' | 'low'

export type FactReviewClass = 'reviewable' | 'low_value'

export type FactChangeView = {
  id: string
  batchId: string
  candidateType: string
  subjectType: string
  subjectId: string | null
  subjectJson: string
  predicate: string
  objectJson: string
  normalizedKey: string
  evidenceJson: string
  confidence: number | null
  importance: FactImportance
  changeType: FactChangeType
  matchedFactId: string | null
  decisionStatus: FactDecisionValue
  editedObjectJson: string | null
  createdAt: string
  updatedAt: string
}

export type FactBatchView = {
  id: string
  workItemId: string
  chapterId: number
  bodyVersionId: string
  contentHash: string
  status: FactBatchStatus
  extractorTaskRunId: string | null
  countsJson: string
  changes: FactChangeView[]
  createdAt: string
  updatedAt: string
}

export type FactExtractionJob = {
  id: string
  workItemId: string
  chapterId: number
  status: 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted'
  startedAt: string
  attempt?: number
  parentTaskId?: string
  completedAt?: string
  batch?: FactBatchView
  error?: { code: string; message: string }
  rawResult?: string
}

export type FactReviewDecisionInput = {
  batchId: string
  decisions: Array<{
    changeId: string
    decision: Exclude<FactDecisionValue, 'PENDING'>
    decidedObjectJson?: string
  }>
}

export type ApprovedFactSourceView = {
  id: string
  chapterId: number
  bodyVersionId: string
  contentHash: string
  quote: string
  spanJson: string
  current: boolean
}

export type ApprovedFactView = {
  id: string
  subjectType: string
  subjectId: string | null
  predicate: string
  objectJson: string
  normalizedKey: string
  importance: FactImportance
  supersedesFactId: string | null
  approvedAt: string
  sourceCurrent: boolean
  sources: ApprovedFactSourceView[]
}

export type ConsistencyEvaluationSummary = {
  version: 1
  suite: 'consistency-fixed-v2'
  modelVersion: string
  completedAt: string
  reportRelativePath: string
  sampleCount: number
  evaluatedCount: number
  unableToJudgeCount: number
  semanticSampleCount: number
  semanticEvaluatedCount: number
  semanticTruePositive: number
  semanticFalsePositive: number
  semanticFalseNegative: number
  semanticUnableToJudge: number
  warningCount: number
}

export type ConsistencyEvaluationJob = {
  id: string
  workItemId: string
  status: 'running' | 'completed' | 'cancelled' | 'failed'
  completedBatches: number
  totalBatches: number
  message: string
  startedAt: string
  completedAt?: string
  result?: ConsistencyEvaluationSummary
  error?: { code: string; message: string }
}

export type RealTrialChapterInput = {
  legacyChapterId: number
  bodyVersionId: string
  planningMinutes: number
  writingMinutes: number
  aiEditingMinutes: number
  factReviewMinutes: number
  diffAcceptedBlocks: number
  diffRejectedBlocks: number
  misappliedChanges: number
  falsePositiveFindings: number
  usefulFindings: number
  modelCost: number | null
  satisfaction: number
  continueNextChapter: boolean
  bypassedFeatures: string
  notes: string
}

export type RealTrialChapterRecord = RealTrialChapterInput & {
  id: string
  contentHash: string
  automatic: {
    autosaveCheckpoints: number
    autosaveFinalized: number
    autosaveConflicts: number
    autosavePending: number
    autosaveDiscarded: number
    aiTasks: number
    aiSucceeded: number
    aiCancelled: number
    aiFailed: number
    aiInterrupted: number
    aiRetries: number
    aiSuccessRate: number | null
    aiCancellationRate: number | null
    aiRetryRate: number | null
    contextEstimatedTokens: number
    factCandidates: number
    factDecisions: number
    factBatchSubmittedDecisions: number
    findings: number
    findingDecisions: number
    usefulFindings: number
    falsePositiveFindings: number
    diffAcceptedBlocks: number
    diffRejectedBlocks: number
  }
  createdAt: string
  updatedAt: string
}

export type RealTrialConclusionInput = {
  decision: 'continue' | 'narrow' | 'adjust'
  highPriorityProblems: string
  mediumPriorityProblems: string
  lowPriorityProblems: string
  rationale: string
  nextScope: string
}

export type RealTrialConclusionRecord = RealTrialConclusionInput & {
  id: string
  chapterCountAtDecision: number
  createdAt: string
  updatedAt: string
}

export type RealTrialReport = {
  version: 1
  purpose: 'product-experience-and-cost-only'
  workItemId: string
  generatedAt: string
  reportRelativePath: '.webnovel/evaluations/real-chapter-trial-v1.json'
  scopeNotice: string
  summary: {
    chapterCount: number
    targetMinimum: 20
    targetMaximum: 30
    status: 'collecting' | 'review-ready' | 'window-complete'
    totalHumanMinutes: number
    averageHumanMinutes: number
    humanTimeRecordedChapters: number
    humanTimeCoverage: number
    autosaveCheckpoints: number
    autosaveFinalized: number
    autosaveConflicts: number
    autosavePending: number
    autosaveDiscarded: number
    autosaveConflictFreeRate: number | null
    aiTasks: number
    aiSucceeded: number
    aiCancelled: number
    aiFailed: number
    aiInterrupted: number
    aiRetries: number
    diffAcceptedBlocks: number
    diffRejectedBlocks: number
    diffAcceptanceRate: number | null
    misappliedChanges: number
    factCandidates: number
    factDecisions: number
    factDecisionRate: number | null
    factBatchSubmittedDecisions: number
    factBatchSubmissionRate: number | null
    reviewDecisions: number
    averageReviewDecisions: number
    falsePositiveFindings: number
    usefulFindings: number
    findingFalsePositiveRate: number | null
    contextEstimatedTokens: number
    modelCostTotal: number | null
    modelCostCoverage: number
    averageSatisfaction: number
    continueNextChapterRate: number
    bypassedFeatures: Array<{ label: string; chapters: number }>
  }
  conclusion: RealTrialConclusionRecord | null
  chapters: RealTrialChapterRecord[]
}

export type ConsistencyItemStatus = 'ready' | 'attention' | 'blocked' | 'deferred'

export type ConsistencyFindingStatus = 'open' | 'accepted' | 'ignored' | 'exception' | 'stale' | 'fixed'

export type ConsistencyFindingDecisionInput =
  | { findingId: string; decision: 'accepted' | 'ignored' | 'exception' | 'later'; reason?: string }
  | { findingId: string; decision: 'fixed'; resultingBodyVersionId: string; expectedUpdatedAt: string; reason?: string }

export type ConsistencyFindingHistoryEntry = {
  id: string
  title: string
  rationale: string
  status: ConsistencyFindingStatus
  sourceBodyVersionId: string
  resultingBodyVersionId: string | null
  updatedAt: string
}

export type ConsistencyFindingHistory = {
  bodyVersionId: string
  entries: ConsistencyFindingHistoryEntry[]
}

export type ConsistencyFinding = {
  code:
    | 'LOCATION_JUMP'
    | 'POWER_SKIP'
    | 'POWER_REGRESSION'
    | 'UNEXPLAINED_REVIVAL'
    | 'POSSESSION_HANDOFF'
    | 'DUPLICATE_PARAGRAPH'
    | 'REPEATED_PARAGRAPH_OPENING'
    | 'SUMMARY_TONE_DENSITY'
    | 'IDENTITY_CONFLICT'
    | 'MOTIVATION_CONFLICT'
    | 'ARC_CONFLICT'
  layer?: 'deterministic' | 'semantic' | 'literary'
  severity: 'blocked' | 'attention' | 'advice'
  message: string
  characterId: string
  characterName: string
  fromChapter: number
  toChapter: number
  evidence: string[]
  findingId?: string
  findingStatus?: ConsistencyFindingStatus
  resultingBodyVersionId?: string | null
  updatedAt?: string
  sourceBodyVersionId?: string
  sourceContentHash?: string
  suggestedAction?: string
  confidence?: number
  semanticConflictId?: string
}

export type ConsistencyItem = {
  id:
    | 'foundation'
    | 'totalOutline'
    | 'volumeOutline'
    | 'events'
    | 'chapterOutline'
    | 'chapterContract'
    | 'characterState'
    | 'literaryStyle'
  label: string
  status: ConsistencyItemStatus
  summary: string
  target: WorkflowStep['target']
  revision?: number
  fingerprint?: string
  issues: string[]
  findings?: ConsistencyFinding[]
}

export type ConsistencyOverview = {
  status: 'ready' | 'attention' | 'blocked'
  readyForProse: boolean
  chapterId?: number
  chapterPosition?: number
  summary: string
  blockers: string[]
  items: ConsistencyItem[]
}

export type AdherenceBoundaryResult = {
  entryRespected: boolean
  exitReached: boolean
  evidence: string
}

export type AdherenceBeatResult = {
  id: string
  status: 'covered' | 'partial' | 'missing'
  evidence: string
}

export type AdherenceForeshadowResult = { id: string; status: 'satisfied' | 'missing' | 'violated'; evidence: string }

export type LiteraryFinding = {
  category: 'scene-motivation' | 'character-voice' | 'relationship-continuity' | 'causal-gap' | 'scene-function'
  severity: 'blocking' | 'advice'
  candidateQuote: string
  sourceQuote: string
  reason: string
  correction: string
}

export type AdherenceReport = {
  /** Older persisted proposals without this field were produced by the full AI review path. */
  reviewMode?: 'fast' | 'full'
  passed: boolean
  summary: string
  beats: AdherenceBeatResult[]
  boundary: AdherenceBoundaryResult
  foreshadowing: AdherenceForeshadowResult[]
  violations: string[]
  introducedFacts: string[]
  characterChanges: CharacterDynamicChange[]
  characterConflicts: CharacterStableConflict[]
  /** Absent in historical reports; an empty list means the new review actually ran. */
  literaryFindings?: LiteraryFinding[]
}
