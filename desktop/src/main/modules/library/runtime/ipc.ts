import { dialog, ipcMain, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ProjectService } from '../application/project-service'
import { LibraryOutlinePreviewService } from '../application/library-outline-preview-service'
import { decodeLibraryOutlineArgs } from '../../../../contracts/library/library-outline-preview'
import { registerModelConnections } from '../../models/runtime/model-connections-runtime'
import { SettingsStore } from '../../../platform/settings/settings-store'
import { WorkspaceService } from '../application/workspace-service'
import { WorkspaceBootstrapService } from '../application/workspace-bootstrap-service'
import { decodeWorkspaceLoadCheckArgs } from '../../../../contracts/library/ipc'
import { ShadowMigrationSessionService } from '../application/shadow-migration-session-service'
import { SqliteManuscriptService } from '../../manuscript/application/sqlite-manuscript-service'
import { SqliteCutoverSessionService } from '../application/sqlite-cutover-session-service'
import { WorkspaceBackupService } from '../application/workspace-backup-service'
import { AppError } from '../../../core/errors/app-error'
import type { AutoBackupStatus } from '../../../../contracts/index'
import { projectDirectory } from '../../../platform/storage/project-path'
import {
  decodeAutoBackupPreferencesArgs,
  decodeAutoBackupRunArgs,
  decodeNoArgs,
  decodeOptionalChapterIdArgs,
  decodeProjectCreateArgs,
  decodeProjectPathArgs,
  decodeWorkspaceBootstrapIssueIdArgs,
  decodeSqliteShadowMigrationTokenArgs
} from '../../../../contracts/ipc'
import { registerValidatedIpc } from '../../../platform/ipc/validated-ipc'
import { registerCompanionVoice } from '../../companion/runtime/companion-voice-runtime'
import type { BookModelsService } from '../../models/application/book-models-service'

interface Dependencies {
  projects: ProjectService
  companionVoice: ReturnType<typeof registerCompanionVoice> | undefined
  settings: SettingsStore
  modelConnectionsRuntime: ReturnType<typeof registerModelConnections> | undefined
  changeWorkItem: <T>(operation: () => Promise<T>, preserveCreation?: boolean) => Promise<T>
  smokeTrashRoot: string | undefined
  shadowMigrations: ShadowMigrationSessionService
  sqliteCutovers: SqliteCutoverSessionService
  sqliteManuscripts: SqliteManuscriptService
  projectAi: BookModelsService
  workspaceBackups: WorkspaceBackupService
  autoBackupStatus: (state?: AutoBackupStatus['state']) => Promise<AutoBackupStatus>
  runAutomaticBackup: (force?: boolean) => Promise<AutoBackupStatus>
  workspaceBootstrap: WorkspaceBootstrapService
  workspace: WorkspaceService
}

export function registerLibraryIpc(dependencies: Dependencies): void {
  const {
    projects,
    companionVoice,
    settings,
    modelConnectionsRuntime,
    changeWorkItem,
    smokeTrashRoot,
    shadowMigrations,
    sqliteCutovers,
    sqliteManuscripts,
    projectAi,
    workspaceBackups,
    autoBackupStatus,
    runAutomaticBackup,
    workspaceBootstrap,
    workspace
  } = dependencies
  let smokeWorkspaceBackupPath = ''
  registerValidatedIpc(ipcMain, 'workspace:recheck-load-issues', decodeWorkspaceLoadCheckArgs, input => workspaceBootstrap.recheck(input))
  registerValidatedIpc(ipcMain, 'projects:list', decodeNoArgs, async () => {
    const result = await projects.list()
    companionVoice?.updateLibrary(result.projects, result.continueProjectId)
    return result
  })
  registerValidatedIpc(ipcMain, 'projects:library-outline-preview', decodeLibraryOutlineArgs, (input) =>
    new LibraryOutlinePreviewService(settings).preview(input)
  )
  registerValidatedIpc(ipcMain, 'projects:create', decodeProjectCreateArgs, (input) =>
    modelConnectionsRuntime!.create(input)
  )
  registerValidatedIpc(ipcMain, 'projects:import', decodeProjectPathArgs, (path) =>
    changeWorkItem(() => projects.importProject(path))
  )
  registerValidatedIpc(
    ipcMain,
    'projects:choose-directory',
    decodeNoArgs,
    async () =>
      process.env.LANJIAN_SMOKE_CREATE_PARENT ??
      (await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })).filePaths[0] ??
      null
  )
  registerValidatedIpc(ipcMain, 'projects:switch', decodeProjectPathArgs, (path) =>
    changeWorkItem(() => projects.switch(path))
  )
  registerValidatedIpc(ipcMain, 'projects:remove-recent', decodeProjectPathArgs, async (path) => {
    await settings.removeRecent(path)
    return { success: true }
  })
  registerValidatedIpc(ipcMain, 'projects:trash', decodeProjectPathArgs, (path) =>
    changeWorkItem(() => projects.trashProject(path))
  )
  registerValidatedIpc(ipcMain, 'projects:open-trash', decodeNoArgs, async () => {
    if (!smokeTrashRoot) await shell.openExternal('shell:RecycleBinFolder')
    return { success: true as const }
  })
  registerValidatedIpc(ipcMain, 'projects:status', decodeNoArgs, () => projects.status())
  registerValidatedIpc(ipcMain, 'projects:migration-preview', decodeNoArgs, () => projects.migrationPreview())
  registerValidatedIpc(ipcMain, 'projects:migrate', decodeNoArgs, () => projects.migrate())
  registerValidatedIpc(ipcMain, 'projects:sqlite-shadow-preview', decodeNoArgs, () => shadowMigrations.preview())
  registerValidatedIpc(ipcMain, 'projects:sqlite-shadow-import', decodeSqliteShadowMigrationTokenArgs, (token) =>
    shadowMigrations.commit(token)
  )
  registerValidatedIpc(ipcMain, 'projects:sqlite-storage-status', decodeNoArgs, () => sqliteCutovers.status())
  registerValidatedIpc(ipcMain, 'projects:sqlite-activation-preview', decodeNoArgs, () => sqliteCutovers.preview())
  registerValidatedIpc(
    ipcMain,
    'projects:sqlite-activation-commit',
    decodeSqliteShadowMigrationTokenArgs,
    async (token) => {
      const result = await sqliteCutovers.commit(token)
      const root = await projects.currentPath()
      if (result.storageMode === 'sqlite') await sqliteManuscripts.syncModelConfigs(root, await projectAi.get())
      return result
    }
  )
  registerValidatedIpc(ipcMain, 'projects:sqlite-mirrors-retry', decodeNoArgs, async () =>
    sqliteManuscripts.retryMirrors(await projects.currentPath())
  )
  registerValidatedIpc(ipcMain, 'projects:readable-mirrors-rebuild', decodeNoArgs, async () =>
    sqliteManuscripts.rebuildReadableMirrors(await projects.currentPath())
  )
  registerValidatedIpc(ipcMain, 'projects:sqlite-storage-rollback', decodeNoArgs, async () =>
    sqliteManuscripts.rollback(await projects.currentPath())
  )
  registerValidatedIpc(ipcMain, 'projects:workspace-backup-create', decodeNoArgs, async () => {
    const smokeTarget = process.env.LANJIAN_SMOKE_BACKUP_TARGET
    const target =
      smokeTarget ??
      (
        await dialog.showOpenDialog({
          title: '选择备份保存位置',
          buttonLabel: '保存到这里',
          properties: ['openDirectory', 'createDirectory']
        })
      ).filePaths[0]
    if (!target) return null
    const result = await workspaceBackups.create(target)
    if (process.env.LANJIAN_SMOKE === '1') smokeWorkspaceBackupPath = result.backupPath
    return result
  })
  registerValidatedIpc(ipcMain, 'projects:auto-backup-get', decodeNoArgs, () => autoBackupStatus())
  registerValidatedIpc(
    ipcMain,
    'projects:auto-backup-choose-directory',
    decodeNoArgs,
    async () =>
      process.env.LANJIAN_SMOKE_BACKUP_TARGET ??
      (
        await dialog.showOpenDialog({
          title: '选择自动备份文件夹',
          buttonLabel: '使用这个文件夹',
          properties: ['openDirectory', 'createDirectory']
        })
      ).filePaths[0] ??
      null
  )
  registerValidatedIpc(ipcMain, 'projects:auto-backup-update', decodeAutoBackupPreferencesArgs, async (input) => {
    const root = await projects.currentPath()
    const targetParentPath = input.targetParentPath
      ? await workspaceBackups.validateTargetParent(input.targetParentPath)
      : ''
    await settings.updateAutoBackup(root, { ...input, targetParentPath })
    return autoBackupStatus()
  })
  registerValidatedIpc(ipcMain, 'projects:auto-backup-run', decodeAutoBackupRunArgs, (force) =>
    runAutomaticBackup(force)
  )
  registerValidatedIpc(ipcMain, 'projects:workspace-restore-preview', decodeNoArgs, async () => {
    const smokeTarget = process.env.LANJIAN_SMOKE_BACKUP_PATH || smokeWorkspaceBackupPath
    const target =
      smokeTarget ??
      (
        await dialog.showOpenDialog({
          title: '选择岚笺备份文件夹',
          buttonLabel: '核对这个备份',
          properties: ['openDirectory']
        })
      ).filePaths[0]
    return target ? workspaceBackups.previewRestore(target) : null
  })
  registerValidatedIpc(
    ipcMain,
    'projects:workspace-restore-commit',
    decodeSqliteShadowMigrationTokenArgs,
    async (token) => {
      const smokeTarget = process.env.LANJIAN_SMOKE_RESTORE_TARGET
      const target =
        smokeTarget ??
        (
          await dialog.showOpenDialog({
            title: '选择恢复副本的保存位置',
            buttonLabel: '恢复到这里',
            properties: ['openDirectory', 'createDirectory']
          })
        ).filePaths[0]
      if (!target) return null
      const restored = await workspaceBackups.restore(token, target)
      const opened = await changeWorkItem(() => projects.importProject(restored.projectPath))
      return { ...restored, project: opened.project }
    }
  )
  registerValidatedIpc(ipcMain, 'workspace:bootstrap', decodeNoArgs, async () => {
    const smokeDelay = Number.parseInt(process.env.LANJIAN_SMOKE_WORKSPACE_OPEN_DELAY_MS || '', 10)
    if (Number.isFinite(smokeDelay) && smokeDelay > 0)
      await new Promise((resolve) => setTimeout(resolve, Math.min(smokeDelay, 10_000)))
    return workspaceBootstrap.load()
  })
  registerValidatedIpc(ipcMain, 'workspace:get-chapter-projection', decodeOptionalChapterIdArgs, (chapterId) =>
    workspace.chapterProjection(chapterId)
  )
  registerValidatedIpc(ipcMain, 'workspace:get-workflow-status', decodeOptionalChapterIdArgs, (chapterId) =>
    workspace.workflowStatus(chapterId)
  )
  registerValidatedIpc(
    ipcMain,
    'workspace:reveal-bootstrap-issue',
    decodeWorkspaceBootstrapIssueIdArgs,
    async (issueId) => {
      if (issueId === 'modelSettingsUnreadable')
        throw new AppError('FEATURE_UNAVAILABLE', '请在 AI 与模型设置中核对本书分配和全局接口库。', {
          recoverable: true
        })
      const relativePath = (
        {
          planningDraftUnreadable: '.webnovel/planning/automatic-planning-draft.json',
          promptProfileUnreadable: '.webnovel/config/prompt-profile.json',
          researchSourcesUnreadable: '.webnovel/research/sources.json',
          researchEventsUnreadable: '.webnovel/research/events.json',
          unifiedEventsUnreadable: '.webnovel/workspace.sqlite',
          outlinePlanningUnreadable: '.webnovel/planning/outline-state.json',
          characterStateUnreadable: '.webnovel/story-state/characters.json',
          chapterOrderUnreadable: '.webnovel/manuscript/chapter-order.json'
        } as const
      )[issueId]
      const root = await projects.currentPath()
      const target = await projectDirectory(root, join(root, ...relativePath.split('/')))
      const smokeRevealLog = process.env.LANJIAN_SMOKE_REVEAL_LOG
      if (smokeRevealLog) await writeFile(smokeRevealLog, target, 'utf8')
      else shell.showItemInFolder(target)
      return { success: true as const, relativePath }
    }
  )
}
