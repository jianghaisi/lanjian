// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createLibraryBackupActions(ports) {
  async function refreshAutoBackup() {
    if (!ports.current.value || !ports.desktop.projects.getAutoBackup) return
    const refreshGeneration = ++ports.autoBackupRefreshGeneration
    const workItemId = ports.current.value.id
    const status = await ports.desktop.projects.getAutoBackup().catch(() => null)
    if (!status || refreshGeneration !== ports.autoBackupRefreshGeneration || ports.current.value?.id !== workItemId)
      return
    ports.autoBackupStatus.value = status
    if (ports.autoBackupDraftDirty.value) return
    ports.autoBackupDraft.value = {
      enabled: status.enabled,
      targetParentPath: status.targetParentPath,
      backupOnFirstOpen: status.backupOnFirstOpen,
      intervalMinutes: status.intervalMinutes,
      retentionCount: status.retentionCount
    }
  }

  async function chooseAutoBackupDirectory() {
    const workItemId = ports.current.value?.id
    const path = await ports.desktop.projects.chooseAutoBackupDirectory()
    if (path && ports.current.value?.id === workItemId) {
      ports.autoBackupRefreshGeneration += 1
      ports.autoBackupDraftDirty.value = true
      ports.autoBackupDraft.value = { ...ports.autoBackupDraft.value, targetParentPath: path }
    }
  }

  async function saveAutoBackupPreferences() {
    if (ports.autoBackupDraft.value.enabled && !ports.autoBackupDraft.value.targetParentPath)
      return ports.notice('请先选择自动备份文件夹')
    const status = await ports.guard(
      () => ports.desktop.projects.updateAutoBackup(ports.plainDto(ports.autoBackupDraft.value)),
      '自动备份设置已保存'
    )
    if (!status) return
    ports.autoBackupStatus.value = status
    ports.autoBackupDraftDirty.value = false
    ports.autoBackupDraft.value = {
      enabled: status.enabled,
      targetParentPath: status.targetParentPath,
      backupOnFirstOpen: status.backupOnFirstOpen,
      intervalMinutes: status.intervalMinutes,
      retentionCount: status.retentionCount
    }
    if (status.enabled) void runAutomaticBackup(true)
  }

  async function runAutomaticBackup(showNotice = true) {
    if (ports.desktop.app.hosted?.readOnly) return
    if (
      !ports.current.value ||
      ports.autoBackupRunning.value ||
      ports.busy.value ||
      ports.chapterIsDirty() ||
      ports.saveState.value === 'saving'
    )
      return
    ports.autoBackupRunning.value = true
    try {
      const status = await ports.desktop.projects.runAutoBackup(showNotice)
      ports.autoBackupStatus.value = status
      if (!showNotice) return
      if (status.state === 'backed-up') ports.notice('自动备份已完成并通过校验')
      else if (status.state === 'unchanged') ports.notice('作品没有新变化，不需要重复备份')
      else if (status.state === 'failed') ports.notice(status.lastError || '自动备份未完成')
    } finally {
      ports.autoBackupRunning.value = false
    }
  }

  function autoBackupTime(value) {
    if (!value) return '尚未运行'
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(value))
  }

  async function openWorkspaceRestore() {
    await ports.flushChapterSave()
    const preview = await ports.guard(() => ports.desktop.projects.previewWorkspaceRestore())
    if (!preview) return
    ports.workspaceRestorePreview.value = preview
    ports.notice(preview.canRestore ? '备份已完成只读核对；尚未恢复任何文件' : '这个备份未通过恢复核对')
  }

  function closeWorkspaceRestore() {
    ports.workspaceRestorePreview.value = null
  }

  async function confirmWorkspaceRestore() {
    const token = ports.workspaceRestorePreview.value?.token
    if (!token || !ports.workspaceRestorePreview.value.canRestore) return
    const result = await ports.guard(() => ports.desktop.projects.restoreWorkspaceBackup(token))
    if (!result) return
    ports.workspaceRestorePreview.value = null
    await ports.activateWorkItem(result.project)
    ports.active.value = 'settings'
    ports.settingsSection.value = 'project'
    ports.notice(`已恢复为新作品《${result.projectName}》；原作品没有改动`)
  }

  return {
    refreshAutoBackup,
    chooseAutoBackupDirectory,
    saveAutoBackupPreferences,
    runAutomaticBackup,
    autoBackupTime,
    openWorkspaceRestore,
    closeWorkspaceRestore,
    confirmWorkspaceRestore
  }
}
