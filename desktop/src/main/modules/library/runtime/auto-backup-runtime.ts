import { ProjectService } from '../application/project-service'
import { SettingsStore } from '../../../platform/settings/settings-store'
import { WorkspaceBackupService } from '../application/workspace-backup-service'
import { automaticBackupCheckDecision } from '../application/automatic-backup-policy'
import type { AutoBackupStatus } from '../../../../contracts/index'

interface Dependencies {
  projects: ProjectService
  settings: SettingsStore
  workspaceBackups: WorkspaceBackupService
}

export function createAutoBackupRuntime(dependencies: Dependencies) {
  const { projects, settings, workspaceBackups } = dependencies
  const autoBackupStatus = async (state?: AutoBackupStatus['state']): Promise<AutoBackupStatus> => {
    const root = await projects.currentPath()
    const stored = await settings.autoBackup(root)
    const baseline = stored.lastCheckedAt || stored.lastSuccessAt
    const nextDueAt =
      stored.enabled && stored.targetParentPath
        ? new Date((baseline ? Date.parse(baseline) : Date.now()) + stored.intervalMinutes * 60_000).toISOString()
        : null
    return {
      enabled: stored.enabled,
      targetParentPath: stored.targetParentPath,
      backupOnFirstOpen: stored.backupOnFirstOpen,
      intervalMinutes: stored.intervalMinutes,
      retentionCount: stored.retentionCount,
      lastCheckedAt: stored.lastCheckedAt || null,
      lastSuccessAt: stored.lastSuccessAt || null,
      nextDueAt,
      lastError: stored.lastError || null,
      lastResult: stored.lastResult || null,
      state:
        state ??
        (!stored.enabled
          ? 'disabled'
          : !stored.targetParentPath
            ? 'needs-folder'
            : stored.lastError
              ? 'failed'
              : 'ready')
    }
  }
  const runAutomaticBackup = async (force = false): Promise<AutoBackupStatus> => {
    const root = await projects.currentPath()
    const stored = await settings.autoBackup(root)
    if (!stored.enabled) return autoBackupStatus('disabled')
    if (!stored.targetParentPath) return autoBackupStatus('needs-folder')
    const checkedAt = new Date()
    const checkedAtIso = checkedAt.toISOString()
    const backupDecision = automaticBackupCheckDecision({
      checkedAt,
      lastCheckedAt: stored.lastCheckedAt,
      lastSuccessAt: stored.lastSuccessAt,
      intervalMinutes: stored.intervalMinutes,
      backupOnFirstOpen: stored.backupOnFirstOpen,
      force
    })
    if (!backupDecision.shouldCheck) return autoBackupStatus('ready')
    try {
      const fingerprint = await workspaceBackups.changeFingerprint()
      if (!backupDecision.dailySnapshotDue && fingerprint === stored.lastFingerprint) {
        await settings.recordAutoBackup(root, { lastCheckedAt: checkedAtIso, lastError: '' })
        return autoBackupStatus('unchanged')
      }
      const result = await workspaceBackups.createAutomatic(stored.targetParentPath, stored.retentionCount)
      await settings.recordAutoBackup(root, {
        lastCheckedAt: checkedAtIso,
        lastSuccessAt: result.createdAt,
        lastFingerprint: fingerprint,
        lastError: '',
        lastResult: result
      })
      return autoBackupStatus('backed-up')
    } catch (error) {
      const message = error instanceof Error ? error.message : '自动备份未完成，请检查保存文件夹。'
      await settings.recordAutoBackup(root, { lastCheckedAt: checkedAtIso, lastError: message.slice(0, 500) })
      return autoBackupStatus('failed')
    }
  }
  return { autoBackupStatus, runAutomaticBackup }
}
