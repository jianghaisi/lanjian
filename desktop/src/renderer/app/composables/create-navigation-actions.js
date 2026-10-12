import { computed, nextTick, shallowRef } from 'vue'
import { targetForLeaf, workspaceCreationNavigation } from '../../features/library/services/workspace-navigation'
import { firstSettingsSection } from '../services/settings-navigation'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createAppNavigationActions(ports) {
  let connectionsRefreshGeneration = 0, assignmentsRefreshGeneration = 0
  // Settings leave the editor's selected object and draft with their existing owner.
  // Only remember the view and workspace generation; never copy manuscript or credentials.
  const modelReturnTarget = shallowRef(null)
  const currentReturnTarget = () => {
    const target = modelReturnTarget.value
    return target && ports.workspaceRequests.isCurrent(target.request, ports.current.value) ? target : null
  }
  const modelReturnLabel = computed(() => {
    const target = currentReturnTarget()
    return target?.section === 'story' ? '返回正式资料' : target ? `返回${({ desk: '正文', outline: '大纲', preparation: '创作准备', research: '采风', timeline: '时间线', materials: '资料', world: '世界设定', profile: '作品设定' })[target.activity] || '创作'}` : '返回书稿'
  })
  async function returnFromModelSettings() {
    if (!ports.current.value) return
    const target = currentReturnTarget()
    if (target?.section) {
      await selectSettingsSection(target.section)
      if (ports.settingsSection.value === target.section) modelReturnTarget.value = null
      return
    }
    await selectActivity(target?.activity || 'desk')
    if (ports.active.value !== 'settings') modelReturnTarget.value = null
  }

  async function refreshOneOffConnections() {
    const generation = ++connectionsRefreshGeneration
    const request = ports.current.value && ports.workspaceRequests.capture(ports.current.value)
    const id = ports.current.value?.id
    const current = () => generation === connectionsRefreshGeneration && ports.current.value?.id === id
      && (!request || ports.workspaceRequests.isCurrent(request, ports.current.value))
    try {
      const view = await ports.desktop.modelConnections.list()
      if (current()) ports.oneOffGlobalConnections.value = view.connections
    } catch {
      if (current()) ports.oneOffGlobalConnections.value = []
    }
  }

  async function refreshModelAssignments() {
    const generation = ++assignmentsRefreshGeneration
    const id = ports.current.value?.id
    const request = ports.current.value && ports.workspaceRequests.capture(ports.current.value)
    const current = () => generation === assignmentsRefreshGeneration && ports.current.value?.id === id
      && (!request || ports.workspaceRequests.isCurrent(request, ports.current.value))
    await refreshOneOffConnections()
    if (!id || !current()) return
    try {
      const value = await ports.desktop.ai.getSettings()
      if (current()) {
        ports.ai.value = {
          ...value,
          connections: value.connections.map((c) => ({ ...c, apiKey: '', clearApiKey: false }))
        }
        ports.clearModelLoadIssue?.()
      }
    } catch (error) {
      if (current()) ports.notice(error?.message || '模型分配暂时无法读取，正文仍可编辑。')
    }
  }

  async function openLibraryModels() {
    if (ports.desktop.app.platform === 'browser') return
    ports.localAppearanceDialog.value?.close()
    ports.libraryModelsOpen.value = true
    await nextTick()
    ports.libraryModelsDialog.value?.showModal()
  }

  function closeLibraryModels(event, returnToSettings = false) {
    if (ports.modelSettingsDirty.value) {
      event?.preventDefault()
      ports.notice('模型设置还有未保存的输入，请先保存或放弃修改。')
      return
    }
    ports.libraryModelsDialog.value?.close()
    ports.libraryModelsOpen.value = false
    if (returnToSettings && !ports.current.value) ports.localAppearanceDialog.value?.showModal()
  }

  function handleActivitybarPointerDown() {
    ports.activitybarPointerFocusing = true
    ports.activitybarKeyboardExpanded.value = false
  }

  function handleActivitybarPointerEnd() {
    ports.activitybarPointerFocusing = false
  }

  function handleActivitybarKeydown(event) {
    if (['Tab', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
      ports.activitybarKeyboardExpanded.value = true
  }

  function handleActivitybarFocusIn(event) {
    if (ports.activitybarPointerFocusing) return
    const target = event.target
    if (target instanceof HTMLElement && target.matches(':focus-visible'))
      ports.activitybarKeyboardExpanded.value = true
  }

  function handleActivitybarFocusOut(event) {
    const rail = event.currentTarget
    const next = event.relatedTarget
    if (rail instanceof HTMLElement && !(next instanceof Node && rail.contains(next)))
      ports.activitybarKeyboardExpanded.value = false
  }

  async function selectWorkspaceParent(id) {
    if (id === 'group') return ports.groupWorkspace.show()
    if (id === 'master-outline') id = 'planning'
    if (id === 'planning') {
      if (ports.lastPlanningLeaf.value === 'chapter-outline' && ports.outlineMode.value === 'stage') {
        const stage = ports.stageOutlines.value.find((item) => item.stage === ports.selectedStage.value)
        if (stage) return openOutline(() => ports.openStageOutline(stage))
      }
      return selectWorkspaceLeaf(ports.lastPlanningLeaf.value)
    }
    if (id === 'settings') {
      await selectActivity('settings')
      if (ports.active.value === 'settings' && ports.settingsSection.value === 'story')
        await selectSettingsSection('appearance')
      return
    }
    const firstLeaf = workspaceCreationNavigation.find((group) => group.id === id)?.children[0]
    if (firstLeaf) await selectWorkspaceLeaf(firstLeaf.id)
  }

  async function selectWorkspaceLeaf(id) {
    const target = targetForLeaf(id)
    if (!target) return
    if (target.active === 'group') return ports.groupWorkspace.show()
    if (target.outlineMode === 'total') return openOutline(() => ports.openTotalOutline())
    if (target.outlineMode === 'volume') {
      const volume =
        ports.outlinePlanning.value.volumes.find((item) => item.volume === ports.selectedVolume.value) ||
        ports.outlinePlanning.value.volumes[0]
      if (volume) return openOutline(() => ports.openVolumeOutline(volume.volume))
      return openOutline(() => ports.runOutlineNavigation('卷纲', async () => () => {
        ports.selectedVolume.value = null
        ports.volumeOutline.value = ''
        ports.outlineMode.value = 'volume'
      }))
    }
    if (target.outlineMode === 'chapter') {
      const chapter =
        ports.outlineFullCatalog.value.find(
          (item) =>
            item.id ===
            (ports.outlineMode.value === 'plannedChapter'
              ? ports.plannedChapter.value?.chapterId
              : ports.selectedId.value)
        ) || ports.outlineFullCatalog.value[0]
      if (chapter) return openOutline(() => ports.openChapterFromOutlineCatalog(chapter))
      return openOutline(() => ports.runOutlineNavigation('章纲', async () => () => {
        ports.outlineMode.value = 'chapter'
      }))
    }
    await selectActivity(target.active, { deferTimelineLoad: Boolean(target.timelineMode) })
    if (ports.active.value !== target.active) return
    if (target.materialSection) {
      ports.chooseMaterialSection(target.materialSection)
      if (ports.materialSection.value !== target.materialSection) return
    }
    if (target.timelineMode) {
      await ports.selectTimelineMode(target.timelineMode)
      if (ports.timelineMode.value !== target.timelineMode) return
    }
    if (target.settingsSection) {
      await selectSettingsSection(target.settingsSection)
      if (ports.settingsSection.value !== target.settingsSection) return
    }
    if (target.preparationMode) ports.preparationMode.value = target.preparationMode
    await nextTick()
    if (id === 'chapter-skeleton')
      document
        .querySelector('[data-testid="chapter-skeleton-candidate"], [data-testid="planning-run"]')
        ?.scrollIntoView({ block: 'start' })
  }

  function openOutline(operation) {
    return ports.groupWorkspace?.open.value ? ports.groupWorkspace.leaveAfter(operation) : operation()
  }

  function legacyParentActivity(id) {
    return (
      {
        definition: 'profile',
        materials: 'materials',
        foundation: 'world',
        'master-outline': 'preparation',
        chronicle: 'timeline',
        planning: 'planning',
        manuscript: 'desk',
        settings: 'settings'
      }[id] || id
    )
  }

  function legacyLeafActivity(id, fallback) {
    return (
      {
        characters: 'story',
        'system-template': 'system',
        'event-timeline': 'timeline',
        'character-lines': 'timeline',
        foreshadows: 'timeline',
        'world-map': 'timeline',
        'volume-lines': 'timeline'
      }[id] || fallback
    )
  }

  function workspaceLeafTestId(id) {
    return {
      ideas: 'material-tab-notes',
      'manual-sources': 'material-tab-manual',
      'web-research': 'material-tab-research',
      'event-extraction': 'material-tab-events',
      'event-timeline': 'timeline-mode-events',
      'character-lines': 'timeline-mode-characters',
      foreshadows: 'timeline-mode-foreshadows',
      'world-map': 'timeline-mode-map',
      'volume-lines': 'timeline-mode-volumes'
    }[id]
  }

  async function openAppearanceSettings() {
    if (!ports.current.value) return ports.localAppearanceDialog.value?.showModal()
    await selectActivity('settings')
    if (ports.active.value === 'settings') await selectSettingsSection('appearance')
  }

  async function openCompanionSettings() {
    if (!ports.current.value) {
      ports.localAppearanceDialog.value?.showModal()
      ports.localAppearanceDialog.value?.querySelector('[data-testid="library-settings-sound"]')?.click()
      await nextTick()
      const controls = ports.localAppearanceDialog.value?.querySelector('[data-testid="companion-voice-settings"]')
      controls?.scrollIntoView({ block: 'start' })
      controls?.querySelector('input, select, button')?.focus()
      return
    }
    await selectActivity('settings')
    if (ports.active.value === 'settings') await selectSettingsSection('companion')
  }

  async function openPlanningRequirement() {
    if (!ports.planningMaterialsReady.value) return selectActivity('research')
    await selectActivity('settings')
    if (ports.active.value === 'settings') await selectSettingsSection('connection')
  }

  async function openTaskCenter() {
    if (!ports.assistantAvailable.value) await selectActivity('desk')
    if (!ports.assistantAvailable.value) return
    ports.assistantOpen.value = true
    ports.assistantMode.value = 'tasks'
    await ports.loadTaskCenter()
  }

  function toggleGuidance(event) {
    ports.guidancePopover.value?.toggle(event.currentTarget)
  }

  async function selectActivity(id, { deferTimelineLoad = false } = {}) {
    const request = ports.current.value && ports.workspaceRequests.capture(ports.current.value)
    const isCurrent = () => !request || ports.workspaceRequests.isCurrent(request, ports.current.value)
    const origin = ports.active.value
    if (id !== ports.active.value && !(await ports.prepareOutlineLeave())) return
    if (!isCurrent()) return
    if (id !== ports.active.value && ports.modelSettingsDirty.value) {
      ports.notice('模型设置还有未保存的输入，请先保存或放弃修改。')
      return
    }
    if (id !== ports.active.value && !ports.worldMapWorkspace.canLeave()) return
    if (!(await ports.flushPlannedChapterSave())) return
    if (!isCurrent()) return
    if (ports.active.value === 'desk' && id !== 'desk' && !(await ports.flushChapterSaveSafely())) return
    if (!isCurrent()) return
    if (id !== 'desk') ports.editorFocusMode.value = false
    if (ports.active.value === 'timeline' && ports.timelineMode.value === 'map' && id !== 'timeline')
      ports.worldMapWorkspace.cancelRead()
    ports.invalidateOutlineRead()
    if (id === 'settings' && origin !== 'settings' && request)
      modelReturnTarget.value = { activity: origin, request }
    ports.active.value = id
    ports.groupWorkspace?.hide()
    if (id === 'outline') {
      void ports.outlineStorageFeedback.refresh()
      try {
        await ports.refreshStandaloneOutlineCatalog()
      } catch (error) {
        ports.notice(error?.message || '章纲目录读取失败，请重试。')
      }
    }
    if (id === 'profile') await ports.loadCharacterAliases()
    if (id === 'timeline' && !deferTimelineLoad) await ports.selectTimelineMode(ports.timelineMode.value)
    if (id === 'settings') await selectSettingsSection(ports.settingsSection.value)
  }

  async function selectSettingsSection(id) {
    if (ports.desktop.app.platform === 'browser' && ['connection', 'routing', 'local-models'].includes(id)) id = 'context'
    if (id !== ports.settingsSection.value && ports.modelSettingsDirty.value) {
      ports.notice('模型设置还有未保存的输入，请先保存或放弃修改。')
      return
    }
    if (ports.settingsSection.value === 'story' && id !== 'story' && ports.current.value)
      modelReturnTarget.value = { activity: 'settings', section: 'story', request: ports.workspaceRequests.capture(ports.current.value) }
    const settingsLoadGeneration = ++ports.autoBackupSettingsLoadGeneration
    ports.settingsSection.value = id
    if (id !== 'project') {
      ports.autoBackupRefreshGeneration += 1
      ports.autoBackupLoading.value = false
    }
    if (id === 'project' && ports.current.value) {
      ports.autoBackupLoading.value = true
      try {
        ports.sqliteStorageStatus.value = await ports.desktop.projects
          .sqliteStorageStatus()
          .catch(() => ports.sqliteStorageStatus.value)
        if (settingsLoadGeneration !== ports.autoBackupSettingsLoadGeneration) return
        await ports.refreshAutoBackup()
        if (settingsLoadGeneration !== ports.autoBackupSettingsLoadGeneration) return
        ports.consistencyEvaluationSummary.value = await ports.desktop.ai
          .latestConsistencyEvaluation()
          .catch(() => ports.consistencyEvaluationSummary.value)
      } finally {
        if (settingsLoadGeneration === ports.autoBackupSettingsLoadGeneration) ports.autoBackupLoading.value = false
      }
    }
    if (id === 'context' && ports.current.value)
      ports.contextBudgetPreferences.value = await ports.desktop.workspace
        .getContextBudgetPreferences()
        .catch(() => ports.contextBudgetPreferences.value)
    if (id === 'trial' && ports.current.value) await ports.loadRealTrialReport()
    if (id === 'story') await ports.loadStoryEntities()
    if (id === 'about' && !ports.appVersion.value)
      ports.appVersion.value = await ports.desktop.app.version().catch(() => '')
    await nextTick()
    const settingsPage = document.querySelector('.settings-editor')
    if (settingsPage instanceof HTMLElement) settingsPage.scrollTop = 0
  }

  async function selectSettingsCategory(id) {
    ports.settingsSearch.value = ''
    await selectSettingsSection(firstSettingsSection(id))
  }

  function activitySelected(id) {
    if (id === 'world') return ['world', 'realms', 'system'].includes(ports.active.value)
    return ports.active.value === id
  }

  async function goToWorkflowStep(step) {
    if (!step) return
    if (step.id === 'chapterPlan') return selectWorkspaceLeaf('chapter-outline')
    if (step.id === 'outline') return ports.openTotalOutline()
    await selectActivity(step.target)
  }

  return {
    modelReturnLabel,
    returnFromModelSettings,
    refreshOneOffConnections,
    refreshModelAssignments,
    openLibraryModels,
    closeLibraryModels,
    handleActivitybarPointerDown,
    handleActivitybarPointerEnd,
    handleActivitybarKeydown,
    handleActivitybarFocusIn,
    handleActivitybarFocusOut,
    selectWorkspaceParent,
    selectWorkspaceLeaf,
    legacyParentActivity,
    legacyLeafActivity,
    workspaceLeafTestId,
    openAppearanceSettings,
    openCompanionSettings,
    openPlanningRequirement,
    openTaskCenter,
    toggleGuidance,
    selectActivity,
    selectSettingsSection,
    selectSettingsCategory,
    activitySelected,
    goToWorkflowStep
  }
}
