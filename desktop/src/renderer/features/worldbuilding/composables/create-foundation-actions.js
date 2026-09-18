import { fieldSourceIds, clearSavedFieldSources } from '../../assistant/services/assistant-field-registry'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createWorldbuildingFoundationActions(ports) {
  function addRealm() {
    ports.realms.value.push({ id: crypto.randomUUID(), name: '', description: '' })
  }

  async function saveRealms() {
    const result = await ports.guard(async () => {
      const realmData = await ports.desktop.workspace.saveRealms(ports.plainDto(ports.realms.value))
      ports.powerSystem.value = await ports.desktop.workspace.savePowerSystem(ports.plainDto(ports.powerSystem.value))
      const foundationData = await ports.desktop.workspace.saveFoundation(ports.plainDto(ports.foundation.value))
      ports.foundation.value = foundationData
      return realmData
    }, '境界设定已保存')
    ports.realms.value = result.levels
    await ports.refreshWorkflow()
  }

  async function saveSystemTemplate() {
    await ports.guard(async () => {
      ports.cheatSystem.value = await ports.desktop.workspace.saveCheatSystem(ports.plainDto(ports.cheatSystem.value))
      const templateData = await ports.desktop.workspace.saveSystemTemplate(ports.systemTemplate.value)
      const foundationData = await ports.desktop.workspace.saveFoundation(ports.plainDto(ports.foundation.value))
      ports.foundation.value = foundationData
      return templateData
    }, '系统界面模板已保存')
    await ports.refreshWorkflow()
  }

  async function saveFoundation() {
    ports.foundation.value = await ports.guard(
      () => ports.desktop.workspace.saveFoundation(ports.plainDto(ports.foundation.value)),
      '当前书稿的素材与世界观已保存'
    )
    await ports.refreshWorkflow()
  }

  async function saveBookProfile() {
    ports.profileSaveProgress.value = 'saving'
    const scope = ports.current.value?.id
    const submitted = ports.plainDto(ports.bookProfile.value)
    const assistantCandidateIds = [
      ...fieldSourceIds('definition.bookProfile.'),
      ...fieldSourceIds('AppShell.bookProfile.')
    ]
    try {
      const saved = await ports.guard(
        () => ports.desktop.workspace.saveBookProfile({ ...submitted, assistantCandidateIds }),
        '当前书稿的作品定义已保存'
      )
      if (ports.current.value?.id !== scope) return
      clearSavedFieldSources(assistantCandidateIds)
      // Preserve each field the author edited while the save was pending.
      for (const key of Object.keys(saved))
        if (key === 'revision' || ports.bookProfile.value[key] === submitted[key])
          ports.bookProfile.value[key] = saved[key]
      ports.profileSavedSnapshot.value = JSON.stringify(saved)
      ports.profileSavedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
      ports.profileSaveProgress.value = 'saved'
      ports.current.value = { ...ports.current.value, genre: saved.genre }
    } catch (error) {
      if (ports.current.value?.id === scope) ports.profileSaveProgress.value = 'error'
      throw error
    }
    await ports.refreshProjects()
    if (ports.current.value?.id !== scope) return
    const savedPromptProfile = await ports.desktop.workspace.getPromptProfile()
    if (ports.current.value?.id !== scope) return
    ports.promptProfile.value = savedPromptProfile
    ports.syncPromptDraft()
    await ports.refreshWorkflow()
  }

  async function saveWritingPreferences() {
    await saveBookProfile()
  }

  async function generateFoundationDraft() {
    ports.foundationDraft.value = await ports.guard(
      () => ports.desktop.workspace.generateFoundationDraft(),
      '作品设定候选已经起草，请审阅后采用'
    )
  }

  return {
    addRealm,
    saveRealms,
    saveSystemTemplate,
    saveFoundation,
    saveBookProfile,
    saveWritingPreferences,
    generateFoundationDraft
  }
}
