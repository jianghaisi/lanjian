import type { WorkflowStatus } from '../library/types'
import type { OutlinePlanningStatus } from '../planning/types'
import type { ConsistencyFindingHistory, ConsistencyOverview } from '../review/types'

export type ManuscriptExportResult = {
  format: 'txt' | 'markdown'
  filePath: string
  chapterCount: number
  characterCount: number
}

export type Chapter = {
  id: number
  /** One-based, user-facing order. The stable id continues to address files and history. */
  position: number
  title: string
  content: string
  word_count: number
  summary: string
  /** Opaque content identity used to reject stale saves after an external edit. */
  revision?: string
  /** SQLite body version identity used as the autosave checkpoint baseline. */
  bodyVersionId?: string
  storageMode?: 'files' | 'sqlite'
  mirrorStatus?: 'pending' | 'synced' | 'conflict' | 'failed'
}

export type DeletedChapterSummary = {
  id: number
  /** Original one-based position, used as the preferred restore position. */
  position: number
  title: string
  word_count: number
  deletedAt: string
}

export type ChapterMirrorRecoveryPreview = {
  token: string
  chapterId: number
  sqliteTitle: string
  sqliteCharacterCount: number
  sqliteExcerpt: string
  externalTitle: string
  externalCharacterCount: number
  externalExcerpt: string
  expiresAt: string
}

export type ChapterMirrorRecoveryResult = {
  chapter: Chapter
  previousBodyVersionId: string
  importedExternalHash: string
  /** The database commit succeeded; only the readable mirror still needs attention. */
  mirrorPending?: boolean
}

export type ManuscriptAutosaveCheckpoint = {
  id: string
  chapterId: number
  title: string
  content: string
  contentHash: string
  status: 'staged' | 'finalized' | 'conflict' | 'discarded'
  baseBodyVersionId: string
  mergeWindowMs: number
  windowStartedAt: string
  windowEndsAt: string
  updatedAt: string
  conflictCurrentBodyVersionId: string | null
  finalizedBodyVersionId: string | null
  operationCount: number
}

export type ChapterAutosaveStageInput = {
  title: string
  content: string
  clientOperationId: string
  baseBodyVersionId?: string
  expectedRevision?: string
  mergeWindowMs?: number
  workItemId?: string
  workItemPath?: string
}

export type ChapterAutosaveStageResult = {
  storageMode: 'files' | 'sqlite'
  checkpoint: ManuscriptAutosaveCheckpoint | null
  chapter: Chapter
  merged: boolean
  idempotent: boolean
}

export type ChapterAutosaveFinalizeResult = {
  storageMode: 'files' | 'sqlite'
  checkpoint: ManuscriptAutosaveCheckpoint | null
  chapter: Chapter
  insertedVersion: boolean
}

export type ChapterLifecycleState = 'PLANNED' | 'DRAFTING' | 'REVIEWABLE' | 'CONFIRMED' | 'REVISING' | 'ARCHIVED'

export type ChapterExecutionCard = {
  status: 'empty' | 'draft' | 'confirmed'
  goal: string
  entryState: string
  beats: string[]
  conflict: string
  characters: string[]
  pointOfView: string
  narrativeDistance: string
  exitChange: string
  hook: string
}

export type ChapterPlanningRecord = {
  legacyChapterId: number
  outlineLegacyKey: string | null
  lifecycleStatus: ChapterLifecycleState
  archivedFromStatus: Exclude<ChapterLifecycleState, 'ARCHIVED'> | null
  currentBodyVersionId: string
  confirmedBodyVersionId: string | null
  confirmedAt: string | null
  hasUnconfirmedChanges: boolean
  card: ChapterExecutionCard
}

export type ChapterPlanningUpdate = {
  lifecycleStatus?: ChapterLifecycleState
  card?: Partial<ChapterExecutionCard>
}

export type ManuscriptDraftRecoveryResult = {
  success: true
  recoveryRelativePath: string
}

export type ChapterRevisionReason = 'legacy_import' | 'manual' | 'autosave' | 'ai' | 'restore'

export type ChapterRevision = {
  id: string
  chapterId: number
  title: string
  content: string
  word_count: number
  createdAt: string
  reason: ChapterRevisionReason
  label?: string | null
  isCurrent?: boolean
  sourceTaskRunId?: string | null
  generationArtifactId?: string | null
}

export type ChapterDerivativeStatus = {
  bodyVersionId: string | null
  factBatches: { current: number; stale: number }
  summaries: { current: number; stale: number }
  ruleRuns: { current: number; stale: number }
}

export type ChapterWorkspaceProjection = {
  chapterId?: number
  workflow: WorkflowStatus
  planning: OutlinePlanningStatus
  consistency: ConsistencyOverview
  derivatives?: ChapterDerivativeStatus
  findingHistory?: ConsistencyFindingHistory
}
