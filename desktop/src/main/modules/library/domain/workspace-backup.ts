export const WORKSPACE_BACKUP_MANIFEST = 'lanjian-backup.json' as const
export const WORKSPACE_BACKUP_VERSION = 1 as const

export type WorkspaceBackupFile = {
  relativePath: string
  size: number
  sha256: string
  kind: 'project-file' | 'sqlite'
}

export type WorkspaceBackupManifest = {
  version: typeof WORKSPACE_BACKUP_VERSION
  createdAt: string
  appVersion: string
  projectName: string
  storageMode: 'shadow' | 'sqlite'
  databaseSchemaVersion: number
  chapterCount: number
  bodyVersionCount: number
  trigger?: 'manual' | 'automatic'
  files: WorkspaceBackupFile[]
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
