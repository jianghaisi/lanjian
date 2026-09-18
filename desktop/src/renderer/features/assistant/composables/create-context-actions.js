// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createAssistantContextActions(ports) {
  async function saveContextBudgetPreferences() {
    ports.contextBudgetPreferences.value = await ports.guard(
      () => ports.desktop.workspace.saveContextBudgetPreferences(ports.plainDto(ports.contextBudgetPreferences.value)),
      '当前书稿的上下文预算已保存'
    )
  }

  async function updateContextEvidencePreference(key, mode) {
    const currentPreferences = await ports.desktop.workspace.getContextBudgetPreferences()
    const pinnedEvidenceKeys = new Set(currentPreferences.pinnedEvidenceKeys)
    const excludedEvidenceKeys = new Set(currentPreferences.excludedEvidenceKeys)
    if (mode === 'pin') {
      if (pinnedEvidenceKeys.has(key)) pinnedEvidenceKeys.delete(key)
      else {
        pinnedEvidenceKeys.add(key)
        excludedEvidenceKeys.delete(key)
      }
    } else {
      pinnedEvidenceKeys.delete(key)
      excludedEvidenceKeys.add(key)
    }
    ports.contextBudgetPreferences.value = await ports.guard(
      () =>
        ports.desktop.workspace.saveContextBudgetPreferences({
          ...currentPreferences,
          pinnedEvidenceKeys: [...pinnedEvidenceKeys],
          excludedEvidenceKeys: [...excludedEvidenceKeys]
        }),
      mode === 'pin' ? '该依据的固定状态已更新' : '该依据将不再自动引用'
    )
    ports.contextFactPackKey = ''
    await ports.refreshWorkflow()
  }

  async function resetContextEvidencePreferences() {
    const currentPreferences = await ports.desktop.workspace.getContextBudgetPreferences()
    ports.contextBudgetPreferences.value = await ports.guard(
      () =>
        ports.desktop.workspace.saveContextBudgetPreferences({
          ...currentPreferences,
          pinnedEvidenceKeys: [],
          excludedEvidenceKeys: []
        }),
      '已恢复自动选择前文证据'
    )
    ports.contextFactPackKey = ''
    await ports.refreshWorkflow()
  }

  return { saveContextBudgetPreferences, updateContextEvidencePreference, resetContextEvidencePreferences }
}
