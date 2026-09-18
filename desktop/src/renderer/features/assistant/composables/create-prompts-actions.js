// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createAssistantPromptsActions(ports) {
  function handleBookGenreChange() {
    if (ports.bookProfile.value.subgenre && !ports.bookSubgenreOptions.value.includes(ports.bookProfile.value.subgenre))
      ports.bookProfile.value.subgenre = ''
  }

  function syncPromptDraft() {
    ports.promptDraft.value =
      ports.promptProfile.value?.entries.find((entry) => entry.task === ports.selectedPromptTask.value)?.effective || ''
  }

  function selectPromptTask(task) {
    if (ports.promptDraftDirty.value && !window.confirm('当前提示词尚未保存。切换后会放弃这些修改，是否继续？')) return
    ports.selectedPromptTask.value = task
    syncPromptDraft()
  }

  async function savePromptOverride() {
    if (!ports.promptDraft.value.trim()) return ports.notice('提示词不能为空；如需恢复内置内容，请使用“恢复题材基线”')
    ports.promptProfile.value = await ports.guard(
      () =>
        ports.desktop.workspace.savePromptOverride(
          ports.plainDto({ task: ports.selectedPromptTask.value, content: ports.promptDraft.value })
        ),
      `${ports.selectedPromptEntry.value?.label || '任务'}提示词已保存到当前作品`
    )
    if (ports.promptProfile.value?.storageMode === 'sqlite')
      ports.sqliteStorageStatus.value = await ports.desktop.projects
        .sqliteStorageStatus()
        .catch(() => ports.sqliteStorageStatus.value)
    syncPromptDraft()
  }

  async function resetPromptOverride() {
    if (!ports.selectedPromptEntry.value?.customized) return
    if (!window.confirm(`恢复“${ports.selectedPromptEntry.value.label}”的题材内置提示词？只删除当前作品的这一项覆写。`))
      return
    ports.promptProfile.value = await ports.guard(
      () => ports.desktop.workspace.resetPromptOverride(ports.selectedPromptTask.value),
      '已经恢复当前题材的内置提示词'
    )
    if (ports.promptProfile.value?.storageMode === 'sqlite')
      ports.sqliteStorageStatus.value = await ports.desktop.projects
        .sqliteStorageStatus()
        .catch(() => ports.sqliteStorageStatus.value)
    syncPromptDraft()
  }

  return { handleBookGenreChange, syncPromptDraft, selectPromptTask, savePromptOverride, resetPromptOverride }
}
