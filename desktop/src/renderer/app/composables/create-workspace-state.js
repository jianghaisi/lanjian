import { computed, ref } from 'vue'
import { chapterCardFingerprint } from '../../../contracts/manuscript/chapter-card-fingerprint'
import { measureManuscript, projectWordCountWithDraft } from '../../../contracts/manuscript/manuscript-metrics'
import { groupForLocation, leafForLocation } from '../../features/library/services/workspace-navigation'
import { settingsSections, categoryForSettingsSection, searchSettingsSections } from '../services/settings-navigation'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createAppState(ports) {
  const localAppearanceDialog = ref(null)

  const workspaceLocation = computed(() => ({
    active: active.value,
    materialSection: ports.materialSection.value,
    timelineMode: ports.timelineMode.value,
    outlineMode: ports.outlineMode.value,
    preparationMode: ports.preparationMode.value,
    settingsSection: settingsSection.value
  }))

  const activeWorkspaceLeaf = computed(() => leafForLocation(workspaceLocation.value))

  const activeWorkspaceGroup = computed(() => groupForLocation(workspaceLocation.value))

  const primaryDestination = computed(() => activeWorkspaceGroup.value.id)

  const sectionNavigation = computed(() =>
    activeWorkspaceGroup.value.children.length > 1 ? activeWorkspaceGroup.value.children : []
  )

  const activitybarKeyboardExpanded = ref(false)

  const bootPhase = ref('projects')

  const bootError = ref('')

  const bootPreview = ref(false)

  const active = ref('desk')

  const settingsSection = ref('appearance')

  const settingsSearch = ref('')

  const appVersion = ref('')

  const explorerScrolling = ref(false)

  const loading = ref(true)

  const busy = ref(false)

  const toast = ref('')

  const current = ref(null)

  const showCreate = ref(false)

  const showTxtImport = ref(false)

  const showRevisions = ref(false)

  const showDeleteConfirm = ref(false)

  const guidancePopover = ref(null)

  const profileStatus = computed(() =>
    ports.profileSaveProgress.value === 'saving' || ports.profileSaveProgress.value === 'error'
      ? ports.profileSaveProgress.value
      : JSON.stringify(ports.bookProfile.value) === ports.profileSavedSnapshot.value
        ? 'saved'
        : 'dirty'
  )

  const profileStatusLabel = computed(() =>
    profileStatus.value === 'dirty'
      ? '有改动待保存'
      : profileStatus.value === 'saving'
        ? '正在保存'
        : profileStatus.value === 'error'
          ? '保存失败，请重试'
          : ports.profileSavedAt.value
            ? `已保存 ${ports.profileSavedAt.value}`
            : '已载入作品定义'
  )

  const showCharacterConflicts = ref(false)

  const removedAiConnectionIds = ref([])

  const wordCount = computed(() => measureManuscript(ports.chapterContent.value).wordCount)

  const legacyBookSubgenre = computed(() =>
    ports.bookProfile.value.subgenre && !ports.bookSubgenreOptions.value.includes(ports.bookProfile.value.subgenre)
      ? ports.bookProfile.value.subgenre
      : ''
  )

  const hasDuplicateAiConnectionNames = computed(() => ports.duplicateAiConnectionNames.value.size > 0)

  const currentSettingsSection = computed(
    () => settingsSections.find((item) => item.id === settingsSection.value) || settingsSections[0]
  )

  const activeSettingsCategory = computed(() => categoryForSettingsSection(settingsSection.value))

  const settingsSearchResults = computed(() => {
    return searchSettingsSections(settingsSearch.value, activeSettingsCategory.value.id)
  })

  const activeTitle = computed(
    () =>
      activeWorkspaceLeaf.value?.label ||
      (activeWorkspaceGroup.value.id === 'settings'
        ? currentSettingsSection.value.label
        : activeWorkspaceGroup.value.label)
  )

  const globalAssistantHost = ref(null)

  const studioStyle = computed(() => ({
    // Legacy saved widths remain untouched; render them as proportions of the
    // original 90rem desktop canvas, with readable bounds supplied by CSS.
    '--explorer-width': `clamp(12.5rem, ${ports.explorerWidth.value / 14.4}vw, 26.25rem)`,
    '--assistant-width': `clamp(17.5rem, ${ports.assistantWidth.value / 14.4}vw, 28.75rem)`,
    '--type-control': `${ports.interfaceFontSize.value / 16}rem`,
    '--type-body': `${(ports.interfaceFontSize.value + 1) / 16}rem`,
    '--explorer-label-size': `${ports.interfaceFontSize.value / 16}rem`,
    '--reading-font-scale': ports.editorFontScale.value,
    '--editor-leading': ports.editorLeading.value,
    '--editor-page-width': `${ports.editorPageWidth.value}px`,
    '--editor-font-family': ports.editorFontFamilyCss.value,
    '--editor-line-height': `${17 * ports.editorFontScale.value * ports.editorLeading.value}px`
  }))

  const proseReady = computed(() => Boolean(ports.workflowStatus.value?.readyForProse))

  const effectiveModel = computed(() =>
    ports.ai.value.routingMode === 'shared' ? ports.ai.value.shared.model : ports.ai.value.tasks.prose.model
  )

  const effectiveConnectionId = computed(() =>
    ports.ai.value.routingMode === 'shared'
      ? ports.ai.value.shared.connectionId
      : ports.ai.value.tasks.prose.connectionId
  )

  const oneOffConnections = computed(() => [
    ...ports.ai.value.connections,
    ...ports.oneOffGlobalConnections.value
      .filter(
        (c) =>
          !ports.ai.value.connections.some(
            (attached) => attached.scope === 'global' && attached.globalConnectionId === c.id
          )
      )
      .map((c) => ({
        id: `global:${c.id}`,
        name: `${c.name} · 全局`,
        baseUrl: c.baseUrl,
        enabled: c.enabled,
        apiKeyConfigured: c.credentialState === 'stored' && c.enabled,
        disabledReason: c.enabled ? undefined : '全局接口已停用'
      }))
  ])

  const recoverableWritingAgentTasks = computed(() => {
    // Task history remains owned by the writing workflow; the companion only observes it.
    const recoveredParents = new Set(
      ports.writingAgentTasks.value.filter((task) => task.parentTaskRunId).map((task) => task.parentTaskRunId)
    )
    return ports.writingAgentTasks.value
      .filter(
        (task) =>
          task.workItemId === current.value?.id &&
          task.chapterId === ports.selectedId.value &&
          ['paused', 'failed', 'interrupted', 'cancelled'].includes(task.status) &&
          !recoveredParents.has(task.id) &&
          (!task.partial || task.partial.status === 'partial')
      )
      .slice(-3)
  })

  const nextPlanningVolumeCandidate = computed(
    () =>
      ports.planningDraft.value?.volumes.find(
        (volume) => !ports.planningDraft.value?.adoption?.volumeOutlines?.some((item) => item.order === volume.order)
      ) || null
  )

  const adoptedPlanningVolumeCount = computed(() => ports.planningDraft.value?.adoption?.volumeOutlines?.length || 0)

  const nextPlanningDetailVolume = computed(
    () =>
      ports.planningDraft.value?.volumes.find((volume) => {
        const status = ports.planningDetailStatuses.value.find((item) => item.volume === volume.order)
        return !status?.exists || status.stale
      }) || null
  )

  const nextPlanningChapterDetailCandidate = computed(
    () =>
      ports.planningDetailCandidates.value.find(
        (chapter) =>
          !ports.planningDraft.value?.adoption?.chapterOutlines?.some((item) => item.chapter === chapter.chapter)
      ) || null
  )

  const adoptedPlanningChapterCount = computed(() => ports.planningDraft.value?.adoption?.chapterOutlines?.length || 0)

  const openForeshadows = computed(() =>
    ports.foreshadowLedger.value.foreshadows.filter((item) => item.status === 'open')
  )

  const manualSourceCount = computed(
    () => ports.sourceCards.value.filter((item) => item.sourceType === 'manual').length
  )

  const webSourceCount = computed(() => ports.sourceCards.value.filter((item) => item.sourceType !== 'manual').length)

  const manualSources = computed(() => ports.sourceCards.value.filter((item) => item.sourceType === 'manual'))

  const webSources = computed(() => ports.sourceCards.value.filter((item) => item.sourceType !== 'manual'))

  const activeIdeas = computed(() => ports.ideas.value.filter((item) => item.status !== 'archived'))

  const candidateIdeaCount = computed(() => ports.ideas.value.filter((item) => item.status === 'candidate').length)

  const visibleMaterialSources = computed(() => {
    const sources = ports.materialSection.value === 'research' ? webSources.value : manualSources.value
    const query = ports.materialSearch.value.trim().toLocaleLowerCase('zh-CN')
    if (!query) return sources
    return sources.filter((item) =>
      `${item.title}\n${item.excerpt}\n${item.userNotes}`.toLocaleLowerCase('zh-CN').includes(query)
    )
  })

  const liveProjectWordCount = computed(() =>
    projectWordCountWithDraft(
      ports.projectWordCount.value,
      ports.selectedChapterRecord.value?.word_count || 0,
      ports.chapterContent.value
    )
  )

  const allCharacterFindings = computed(
    () => ports.consistencyOverview.value?.items.find((item) => item.id === 'characterState')?.findings || []
  )

  const formalSemanticConflictIds = computed(
    () =>
      new Set(
        allCharacterFindings.value
          .filter((finding) => finding.layer === 'semantic' && finding.semanticConflictId)
          .map((finding) => finding.semanticConflictId)
      )
  )

  const pendingCharacterConflicts = computed(
    () =>
      ports.characterState.value?.pendingConflicts.filter(
        (item) => item.status === 'pending' && !formalSemanticConflictIds.value.has(item.id)
      ) || []
  )

  const literaryStyleFindings = computed(() =>
    (ports.consistencyOverview.value?.items.find((item) => item.id === 'literaryStyle')?.findings || []).filter(
      (finding) => !finding.findingStatus || ['open', 'accepted'].includes(finding.findingStatus)
    )
  )

  const visibleWritingAgentTurns = computed(() =>
    ports.writingAgentTurns.value
      .filter(
        (turn) => turn.result.workItemId === current.value?.id && turn.result.chapterId === ports.selectedId.value
      )
      .map((turn) => ({
        ...turn,
        draftChanged: turn.baseDraft !== ports.chapterContent.value,
        stale: Boolean(
          turn.result.chapterCardFingerprint &&
            turn.result.chapterCardFingerprint !== chapterCardFingerprint(ports.chapterPlanning.value?.card)
        )
      }))
  )

  const groupedCharacterAliases = computed(() => {
    const groups = new Map()
    for (const item of ports.characterAliases.value) {
      const group = groups.get(item.characterId) || {
        characterId: item.characterId,
        canonicalName: item.canonicalName,
        aliases: []
      }
      group.aliases.push(item.alias)
      groups.set(item.characterId, group)
    }
    return [...groups.values()]
  })

  const approvedResourceEntities = computed(() =>
    ports.storyEntities.value.filter((item) => item.entityType === 'item' && item.status === 'approved')
  )

  return {
    localAppearanceDialog,
    workspaceLocation,
    activeWorkspaceLeaf,
    activeWorkspaceGroup,
    primaryDestination,
    sectionNavigation,
    activitybarKeyboardExpanded,
    bootPhase,
    bootError,
    bootPreview,
    active,
    settingsSection,
    settingsSearch,
    appVersion,
    explorerScrolling,
    loading,
    busy,
    toast,
    current,
    showCreate,
    showTxtImport,
    showRevisions,
    showDeleteConfirm,
    guidancePopover,
    profileStatus,
    profileStatusLabel,
    showCharacterConflicts,
    removedAiConnectionIds,
    wordCount,
    legacyBookSubgenre,
    hasDuplicateAiConnectionNames,
    currentSettingsSection,
    activeSettingsCategory,
    settingsSearchResults,
    activeTitle,
    globalAssistantHost,
    studioStyle,
    proseReady,
    effectiveModel,
    effectiveConnectionId,
    oneOffConnections,
    recoverableWritingAgentTasks,
    nextPlanningVolumeCandidate,
    adoptedPlanningVolumeCount,
    nextPlanningDetailVolume,
    nextPlanningChapterDetailCandidate,
    adoptedPlanningChapterCount,
    openForeshadows,
    manualSourceCount,
    webSourceCount,
    manualSources,
    webSources,
    activeIdeas,
    candidateIdeaCount,
    visibleMaterialSources,
    liveProjectWordCount,
    allCharacterFindings,
    formalSemanticConflictIds,
    pendingCharacterConflicts,
    literaryStyleFindings,
    visibleWritingAgentTurns,
    groupedCharacterAliases,
    approvedResourceEntities
  }
}
