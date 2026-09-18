import type {
  BookProfile,
  CheatSystemData,
  FoundationData,
  PowerSystemData,
  RealmLevel,
  ResearchSettings,
  SourceCard
} from '../worldbuilding/types'
import type { Chapter } from '../manuscript/types'
import type { OutlineList, PlanningPackageProposal } from '../planning/types'
import type { CanonicalEvent, TimelineEvent } from '../timeline/types'
import type { AiSettings } from '../models/types'
import type { PromptProfileView } from '../assistant/types'
import type { DocumentImportRecovery } from './import-types'
import type { ContinuationAnalysisState } from './continuation-types'

export type ProjectSummary = {
  id: string
  name: string
  path: string
  title: string
  genre: string
  updated_at: string
  manuscript: {
    /** Unique recognized chapter numbers; duplicate files do not inflate this count. */
    chapterCount: number
    /** All recognized chapter Markdown files, including duplicates awaiting review. */
    fileCount: number
    /** Total words across all recognized chapter files, using the editor's CJK/Latin counting rule. */
    wordCount: number
    /** Read-only last edited chapter; null means no chapters, omitted means unavailable. */
    lastEditedChapter?: { id: number; position: number; title: string; updatedAt: string } | null
    status: 'ready' | 'chapter-review' | 'identity-review'
    message?: string
  }
}

export type ProjectCreateInput = {
  parentPath?: string
  path?: string
  name?: string
  title?: string
  genre?: string
  subgenre?: string
  coreIdea?: string
  plannedVolumes?: number
  chaptersPerVolume?: number
  targetWordsPerChapter?: number
  mode?: string
}

export type ProjectMigrationPreview = {
  currentVersion: number
  targetVersion: number
  required: boolean
  format: 'lanjian-current' | 'lanjian-legacy'
  canMigrate: boolean
  reviewRequired: boolean
  operations: string[]
  warnings: string[]
  issues: Array<{
    id: string
    severity: 'blocker' | 'attention' | 'info'
    title: string
    message: string
    evidence: string[]
  }>
}

export type ProjectMigrationResult = ProjectMigrationPreview & {
  migrated: boolean
  backupRelativePath?: string
}

export type SqliteShadowMigrationPreview = {
  token: string | null
  targetRelativePath: string
  canImport: boolean
  chapterCount: number
  totalWords: number
  expiresAt: string | null
  blockers: Array<{ code: string; message: string }>
}

export type SqliteShadowMigrationResult = {
  targetRelativePath: string
  storageMode: 'shadow'
  sourceFilesChanged: false
  chapterCount: number
  insertedVersions: number
  unchangedVersions: number
  verified: true
}

export type SqliteStorageStatus = {
  storageMode: 'files' | 'shadow' | 'sqlite'
  textAuthority?: 'legacy-sqlite' | 'files-v1'
  databaseExists: boolean
  chapterCount: number
  outlineCount: number
  outlineStorageMode: 'files' | 'sqlite'
  promptStorageMode: 'files' | 'sqlite'
  promptMirrorStatus: 'pending' | 'synced' | 'conflict' | 'failed' | null
  outlinePendingMirrors: number
  outlineConflictMirrors: number
  outlineFailedMirrors: number
  pendingMirrors: number
  conflictMirrors: number
  failedMirrors: number
}

export type SqliteStorageActivationPreview = {
  token: string | null
  canActivate: boolean
  chapterCount: number
  totalWords: number
  expiresAt: string | null
  blockers: Array<{ code: string; message: string }>
}

export type SqliteStorageActivationResult = {
  storageMode: 'sqlite'
  chapterCount: number
  pendingMirrors: number
  conflicts: number
  verified: true
}

export type SqliteStorageRollbackResult = {
  storageMode: 'shadow'
  chapterCount: number
  verified: true
}

export type ReadableMirrorRebuildResult = {
  checked: number
  recreated: number
  upToDate: number
  conflicts: number
  failed: number
}

export type WorkspaceBackupResult = {
  backupPath: string
  backupName: string
  createdAt: string
  projectName: string
  storageMode: 'shadow' | 'sqlite'
  chapterCount: number
  fileCount: number
  verified: true
}

export type AutoBackupPreferences = {
  enabled: boolean
  targetParentPath: string
  backupOnFirstOpen: boolean
  intervalMinutes: number
  retentionCount: number
}

export type AutoBackupStatus = AutoBackupPreferences & {
  lastCheckedAt: string | null
  lastSuccessAt: string | null
  nextDueAt: string | null
  lastError: string | null
  lastResult: WorkspaceBackupResult | null
  state: 'disabled' | 'needs-folder' | 'ready' | 'unchanged' | 'backed-up' | 'failed'
}

export type WorkspaceRestorePreview = {
  token: string | null
  canRestore: boolean
  projectName: string
  createdAt: string | null
  appVersion: string
  storageMode: 'shadow' | 'sqlite' | null
  chapterCount: number
  fileCount: number
  expiresAt: string | null
  blockers: Array<{ code: string; message: string }>
}

export type WorkspaceRestoreResult = {
  projectPath: string
  projectName: string
  restoredFrom: string
  storageMode: 'shadow' | 'sqlite'
  chapterCount: number
  verified: true
}

export type WorkspaceRestoreOpenResult = WorkspaceRestoreResult & { project: ProjectSummary }

export type WorkflowStepId = 'definition' | 'materials' | 'foundation' | 'events' | 'outline' | 'chapterPlan'

export type WorkflowStepState = 'complete' | 'current' | 'blocked'

export type WorkflowStep = {
  id: WorkflowStepId
  label: string
  state: WorkflowStepState
  detail: string
  missing: string[]
  target: 'profile' | 'research' | 'world' | 'timeline' | 'outline'
}

export type WorkflowStatus = {
  creationPath: FoundationData['creationPath']
  completed: number
  total: number
  currentStep: WorkflowStepId | null
  steps: WorkflowStep[]
  readyForChapterOutline: boolean
  readyForProse: boolean
  missingForChapterOutline: string[]
  missingForProse: string[]
}

export type WorkspaceBootstrapProjection = {
  version: 1
  workItem: { id: string; path: string }
  chapters: Chapter[]
  outlines: OutlineList
  timeline: { events: TimelineEvent[] }
  realms: { levels: RealmLevel[] }
  powerSystem: PowerSystemData
  cheatSystem: CheatSystemData
  systemTemplate: { template: string }
  foundation: FoundationData
  bookProfile: BookProfile
  aiSettings: AiSettings | null
  researchSettings: ResearchSettings
  migration: ProjectMigrationPreview
  sources: { sources: SourceCard[] }
  events: { events: CanonicalEvent[] }
  planningDraft: PlanningPackageProposal | null
  promptProfile: PromptProfileView
  importRecoveries: DocumentImportRecovery[]
  continuation: ContinuationAnalysisState
  issues: WorkspaceBootstrapIssue[]
}

export type WorkspaceBootstrapIssueBase = {
  title: string
  message: string
}

export type WorkspaceBootstrapIssue = WorkspaceBootstrapIssueBase &
  (
    | { id: 'planningDraftUnreadable'; area: 'planningDraft'; recovery: 'quarantinePlanningDraft' }
    | { id: 'promptProfileUnreadable'; area: 'promptProfile'; recovery: 'quarantinePromptProfile' }
    | { id: 'researchSourcesUnreadable'; area: 'researchSources'; recovery: 'manualReview' }
    | { id: 'researchEventsUnreadable'; area: 'researchEvents'; recovery: 'manualReview' }
    | { id: 'outlinePlanningUnreadable'; area: 'outlinePlanning'; recovery: 'manualReview' }
    | { id: 'characterStateUnreadable'; area: 'characterState'; recovery: 'manualReview' }
    | { id: 'chapterOrderUnreadable'; area: 'chapterOrder'; recovery: 'manualReview' }
    | { id: 'modelSettingsUnreadable'; area: 'aiSettings'; recovery: 'manualReview' }
  )
