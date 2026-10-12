import type {
  AutoBackupPreferences,
  AutoBackupStatus,
  ProjectCreateInput,
  ProjectMigrationPreview,
  ProjectMigrationResult,
  ProjectSummary,
  ReadableMirrorRebuildResult,
  SqliteShadowMigrationPreview,
  SqliteShadowMigrationResult,
  SqliteStorageActivationPreview,
  SqliteStorageActivationResult,
  SqliteStorageRollbackResult,
  SqliteStorageStatus,
  WorkspaceBackupResult,
  WorkspaceRestoreOpenResult,
  WorkspaceRestorePreview
} from './types'
import type { ManuscriptExportResult, ManuscriptExportSelection } from '../manuscript/types'
import type { RealTrialChapterInput, RealTrialConclusionInput, RealTrialReport } from '../review/types'

export type DesktopProjectsApi = {
  libraryOutlinePreview: (
    input: import('./library-outline-preview').LibraryOutlineRequest
  ) => Promise<import('./library-outline-preview').LibraryOutlinePreview>
  list: () => Promise<{ projects: ProjectSummary[]; continueProjectId?: string | null }>
  create: (input: ProjectCreateInput) => Promise<{ project: ProjectSummary }>
  importProject: (path: string) => Promise<{ project: ProjectSummary }>
  chooseDirectory: () => Promise<string | null>
  switch: (path: string) => Promise<{ success: boolean; path: string }>
  removeRecent: (id: string) => Promise<{ success: boolean }>
  trash: (path: string) => Promise<{ success: true; recovery: 'system-trash'; title: string }>
  openTrash: () => Promise<{ success: true }>
  status: () => Promise<Record<string, unknown>>
  migrationPreview: () => Promise<ProjectMigrationPreview>
  migrate: () => Promise<ProjectMigrationResult>
  previewSqliteShadowMigration: () => Promise<SqliteShadowMigrationPreview>
  importSqliteShadowMigration: (token: string) => Promise<SqliteShadowMigrationResult>
  sqliteStorageStatus: () => Promise<SqliteStorageStatus>
  previewSqliteActivation: () => Promise<SqliteStorageActivationPreview>
  activateSqliteStorage: (token: string) => Promise<SqliteStorageActivationResult>
  retrySqliteMirrors: () => Promise<{ pending: number; conflicts: number; failed: number }>
  rebuildReadableMirrors: () => Promise<ReadableMirrorRebuildResult>
  rollbackSqliteStorage: () => Promise<SqliteStorageRollbackResult>
  createWorkspaceBackup: () => Promise<WorkspaceBackupResult | null>
  exportManuscript: (selection?: ManuscriptExportSelection) => Promise<ManuscriptExportResult | null>
  getAutoBackup: () => Promise<AutoBackupStatus>
  chooseAutoBackupDirectory: () => Promise<string | null>
  updateAutoBackup: (input: AutoBackupPreferences) => Promise<AutoBackupStatus>
  runAutoBackup: (force: boolean) => Promise<AutoBackupStatus>
  previewWorkspaceRestore: () => Promise<WorkspaceRestorePreview | null>
  restoreWorkspaceBackup: (token: string) => Promise<WorkspaceRestoreOpenResult | null>
  realTrialReport: () => Promise<RealTrialReport>
  saveRealTrialChapter: (input: RealTrialChapterInput) => Promise<RealTrialReport>
  saveRealTrialConclusion: (input: RealTrialConclusionInput) => Promise<RealTrialReport>
}
