import { useGroupWorkspaceNavigation } from '../features/group-chat/composables/use-group-workspace-navigation'
import { createWorkspaceRecoveryActions } from '../features/library/composables/create-workspace-recovery-actions.js'
import { prepareCompositionClose } from '../features/writing-plugins/composition-session'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { WorkspaceRequestGuard } from '../../contracts/library/workspace-request-guard'
import { createWorldMapWorkspace } from '../features/world-map/composables/world-map-workspace'
import { createOutlineStorageFeedback } from '../features/planning/composables/outline-storage-feedback'
import { createChapterOpenNavigation } from '../features/manuscript/services/chapter-open-navigation'
import { updateFieldScope, registerAssistantField } from '../features/assistant/services/assistant-field-registry'
import { createManuscriptRecoveryStore } from '../features/manuscript/services/manuscript-recovery-store'
import { createManuscriptRecoveryRefresh } from '../features/manuscript/services/manuscript-recovery-refresh'
import { ManuscriptSaveQueue } from '../features/manuscript/services/manuscript-save-queue'
import { useEditorPreferences } from '../features/manuscript/composables/editor-preferences'
import { useCompanionBoot } from '../features/companion/composables/use-companion-boot'
import { useLoadingPreferences } from './composables/useLoadingPreferences'
import { createCompanionPreferences } from '../features/companion/composables/companion-preferences'
import { useThemePreferences } from './composables/theme-preferences'
import { useLibraryAppearance } from '../features/library/composables/library-appearance'
import { createAppNavigationActions } from './composables/create-navigation-actions.js'
import { createCompanionInteractionActions } from '../features/companion/composables/create-interaction-actions.js'
import { createManuscriptNavigationActions } from '../features/manuscript/composables/create-navigation-actions.js'
import { createModelsConnectionOptionsActions } from '../features/models/composables/create-connection-options-actions.js'
import { createAssistantNavigationActions } from '../features/assistant/composables/create-navigation-actions.js'
import { createReviewFormattingActions } from '../features/review/composables/create-formatting-actions.js'
import { createAppBootActions } from './composables/create-boot-actions.js'
import { createAppLayoutActions } from './composables/create-layout-actions.js'
import { createTimelineNavigationActions } from '../features/timeline/composables/create-navigation-actions.js'
import { createCharactersForeshadowActions } from '../features/characters/composables/create-foreshadow-actions.js'
import { createTimelineProjectionsActions } from '../features/timeline/composables/create-projections-actions.js'
import { createReviewFindingsActions } from '../features/review/composables/create-findings-actions.js'
import { createAppFeedbackActions } from './composables/create-feedback-actions.js'
import { useUiSounds } from './composables/useUiSounds'
import { createLibraryProjectsActions } from '../features/library/composables/create-projects-actions.js'
import { createLibraryImportsActions } from '../features/library/composables/create-imports-actions.js'
import { createLibraryOpeningActions } from '../features/library/composables/create-opening-actions.js'
import { createLibraryWorkspaceLoadingActions } from '../features/library/composables/create-workspace-loading-actions.js'
import { createLibraryContinuationActions } from '../features/library/composables/create-continuation-actions.js'
import { createPlanningNavigationActions } from '../features/planning/composables/create-navigation-actions.js'
import { createLibraryWorkflowActions } from '../features/library/composables/create-workflow-actions.js'
import { createReviewFactsActions } from '../features/review/composables/create-facts-actions.js'
import { createManuscriptChapterCardsActions } from '../features/manuscript/composables/create-chapter-cards-actions.js'
import { createManuscriptPersistenceActions } from '../features/manuscript/composables/create-persistence-actions.js'
import { createManuscriptRecoveryActions } from '../features/manuscript/composables/create-recovery-actions.js'
import { createManuscriptHistoryActions } from '../features/manuscript/composables/create-history-actions.js'
import { createAssistantApplicationActions } from '../features/assistant/composables/create-application-actions.js'
import { createAssistantTasksActions } from '../features/assistant/composables/create-tasks-actions.js'
import { createAssistantAdoptionActions } from '../features/assistant/composables/create-adoption-actions.js'
import { createPlanningOutlinesActions } from '../features/planning/composables/create-outlines-actions.js'
import { createTimelineEditingActions } from '../features/timeline/composables/create-editing-actions.js'
import { createEventMigrationActions } from '../features/timeline/composables/create-migration-actions.js'
import { createWorldbuildingFoundationActions } from '../features/worldbuilding/composables/create-foundation-actions.js'
import { createAssistantContextActions } from '../features/assistant/composables/create-context-actions.js'
import { createCharactersEntitiesActions } from '../features/characters/composables/create-entities-actions.js'
import { createAssistantPromptsActions } from '../features/assistant/composables/create-prompts-actions.js'
import { createPlanningGenerationActions } from '../features/planning/composables/create-generation-actions.js'
import { createPlanningAdoptionActions } from '../features/planning/composables/create-adoption-actions.js'
import { createWorldbuildingMaterialsActions } from '../features/worldbuilding/composables/create-materials-actions.js'
import { createPlanningChapterOutlineActions } from '../features/planning/composables/create-chapter-outline-actions.js'
import { createPlanningExpansionActions } from '../features/planning/composables/create-expansion-actions.js'
import { createPlanningIdeasActions } from '../features/planning/composables/create-ideas-actions.js'
import { createModelsConnectionsActions } from '../features/models/composables/create-connections-actions.js'
import { createLibraryStorageActions } from '../features/library/composables/create-storage-actions.js'
import { createReviewEvaluationActions } from '../features/review/composables/create-evaluation-actions.js'
import { createReviewTrialActions } from '../features/review/composables/create-trial-actions.js'
import { createLibraryBackupActions } from '../features/library/composables/create-backup-actions.js'
import { createAppState } from './composables/create-workspace-state.js'
import { createLibraryState } from '../features/library/composables/create-workspace-state.js'
import { createModelsState } from '../features/models/composables/create-workspace-state.js'
import { createWorldbuildingState } from '../features/worldbuilding/composables/create-workspace-state.js'
import { createAssistantState } from '../features/assistant/composables/create-workspace-state.js'
import { createManuscriptState } from '../features/manuscript/composables/create-workspace-state.js'
import { createCompanionState } from '../features/companion/composables/create-workspace-state.js'
import { createPlanningState } from '../features/planning/composables/create-workspace-state.js'
import { createTimelineState } from '../features/timeline/composables/create-workspace-state.js'
import { createCharactersState } from '../features/characters/composables/create-workspace-state.js'
import { createReviewState } from '../features/review/composables/create-workspace-state.js'

export function useWorkspaceController() {
  const {
    refreshOneOffConnections,
    refreshModelAssignments,
    modelReturnLabel,
    returnFromModelSettings,
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
  } = createAppNavigationActions({
    get groupWorkspace() { return groupWorkspace },
    get workspaceRequests() { return workspaceRequests },
    get clearModelLoadIssue() { return clearModelLoadIssue },
    get current() {
      return current
    },
    get desktop() {
      return desktop
    },
    get oneOffGlobalConnections() {
      return oneOffGlobalConnections
    },
    get ai() {
      return ai
    },
    get notice() {
      return notice
    },
    get libraryModelsOpen() {
      return libraryModelsOpen
    },
    get libraryModelsDialog() {
      return libraryModelsDialog
    },
    get modelSettingsDirty() {
      return modelSettingsDirty
    },
    get activitybarPointerFocusing() {
      return activitybarPointerFocusing
    },
    set activitybarPointerFocusing(value) {
      activitybarPointerFocusing = value
    },
    get activitybarKeyboardExpanded() {
      return activitybarKeyboardExpanded
    },
    get lastPlanningLeaf() {
      return lastPlanningLeaf
    },
    get outlineMode() {
      return outlineMode
    },
    get stageOutlines() {
      return stageOutlines
    },
    get selectedStage() {
      return selectedStage
    },
    get openStageOutline() {
      return openStageOutline
    },
    get active() {
      return active
    },
    get settingsSection() {
      return settingsSection
    },
    get openTotalOutline() {
      return openTotalOutline
    },
    get outlinePlanning() {
      return outlinePlanning
    },
    get selectedVolume() {
      return selectedVolume
    },
    get openVolumeOutline() {
      return openVolumeOutline
    },
    get runOutlineNavigation() {
      return runOutlineNavigation
    },
    get volumeOutline() {
      return volumeOutline
    },
    get outlineFullCatalog() {
      return outlineFullCatalog
    },
    get plannedChapter() {
      return plannedChapter
    },
    get selectedId() {
      return selectedId
    },
    get openChapterFromOutlineCatalog() {
      return openChapterFromOutlineCatalog
    },
    get chooseMaterialSection() {
      return chooseMaterialSection
    },
    get materialSection() {
      return materialSection
    },
    get selectTimelineMode() {
      return selectTimelineMode
    },
    get timelineMode() {
      return timelineMode
    },
    get preparationMode() {
      return preparationMode
    },
    get localAppearanceDialog() {
      return localAppearanceDialog
    },
    get planningMaterialsReady() {
      return planningMaterialsReady
    },
    get assistantAvailable() {
      return assistantAvailable
    },
    get assistantOpen() {
      return assistantOpen
    },
    get assistantMode() {
      return assistantMode
    },
    get loadTaskCenter() {
      return loadTaskCenter
    },
    get guidancePopover() {
      return guidancePopover
    },
    get prepareOutlineLeave() {
      return prepareOutlineLeave
    },
    get worldMapWorkspace() {
      return worldMapWorkspace
    },
    get flushPlannedChapterSave() {
      return flushPlannedChapterSave
    },
    get flushChapterSaveSafely() {
      return flushChapterSaveSafely
    },
    get editorFocusMode() {
      return editorFocusMode
    },
    get invalidateOutlineRead() {
      return invalidateOutlineRead
    },
    get outlineStorageFeedback() {
      return outlineStorageFeedback
    },
    get refreshStandaloneOutlineCatalog() {
      return refreshStandaloneOutlineCatalog
    },
    get loadCharacterAliases() {
      return loadCharacterAliases
    },
    get autoBackupSettingsLoadGeneration() {
      return autoBackupSettingsLoadGeneration
    },
    set autoBackupSettingsLoadGeneration(value) {
      autoBackupSettingsLoadGeneration = value
    },
    get autoBackupRefreshGeneration() {
      return autoBackupRefreshGeneration
    },
    set autoBackupRefreshGeneration(value) {
      autoBackupRefreshGeneration = value
    },
    get autoBackupLoading() {
      return autoBackupLoading
    },
    get sqliteStorageStatus() {
      return sqliteStorageStatus
    },
    get refreshAutoBackup() {
      return refreshAutoBackup
    },
    get consistencyEvaluationSummary() {
      return consistencyEvaluationSummary
    },
    get contextBudgetPreferences() {
      return contextBudgetPreferences
    },
    get loadRealTrialReport() {
      return loadRealTrialReport
    },
    get loadStoryEntities() {
      return loadStoryEntities
    },
    get appVersion() {
      return appVersion
    },
    get settingsSearch() {
      return settingsSearch
    }
  })

  const { noteCompanionTyping } = createCompanionInteractionActions({
    get companionTyping() {
      return companionTyping
    },
    get companionQuietTimer() {
      return companionQuietTimer
    },
    set companionQuietTimer(value) {
      companionQuietTimer = value
    }
  })

  const { openQuickChapterSearch, handleQuickChapterShortcut, openQuickChapter } = createManuscriptNavigationActions({
    get current() {
      return current
    },
    get opening() {
      return opening
    },
    get workspaceOpening() {
      return workspaceOpening
    },
    get quickChapterOpen() {
      return quickChapterOpen
    },
    get worldMapWorkspace() {
      return worldMapWorkspace
    },
    get workspaceRequests() {
      return workspaceRequests
    },
    get chapterSelectionGeneration() {
      return chapterSelectionGeneration
    },
    set chapterSelectionGeneration(value) {
      chapterSelectionGeneration = value
    },
    get chapterOpenNavigation() {
      return chapterOpenNavigation
    },
    get flushChapterSaveSafely() {
      return flushChapterSaveSafely
    },
    get flushPlannedChapterSave() {
      return flushPlannedChapterSave
    },
    get flushPlanningDraftSave() {
      return flushPlanningDraftSave
    },
    get desktop() {
      return desktop
    },
    get selectChapter() {
      return selectChapter
    },
    get selectedId() {
      return selectedId
    },
    get selectActivity() {
      return selectActivity
    },
    get active() {
      return active
    }
  })

  const {
    modelChoices,
    isDuplicateAiConnectionName,
    connectionHost,
    connectionOptionLabel,
    connectionModels,
    invalidateAiConnectionValidation,
    invalidateAiRoutingValidation,
    handleConnectionNameInput,
    handleConnectionKeyInput,
    connectionCredentialStatus,
    connectionCanTest,
    modelCheckFor
  } = createModelsConnectionOptionsActions({
    get ai() {
      return ai
    },
    get availableModelsByConnection() {
      return availableModelsByConnection
    },
    get researchSettings() {
      return researchSettings
    },
    get duplicateAiConnectionNames() {
      return duplicateAiConnectionNames
    },
    get aiConnectionResult() {
      return aiConnectionResult
    },
    get aiModelChecks() {
      return aiModelChecks
    }
  })

  const { navigateAssistantWorkspace, sendAssistantProse } = createAssistantNavigationActions({
    get current() {
      return current
    },
    get selectWorkspaceLeaf() {
      return selectWorkspaceLeaf
    },
    get activeWorkspaceLeaf() {
      return activeWorkspaceLeaf
    },
    get selectedId() {
      return selectedId
    },
    get chapters() {
      return chapters
    },
    get selectChapter() {
      return selectChapter
    },
    get desktop() {
      return desktop
    },
    get embeddedWritingAgent() {
      return embeddedWritingAgent
    },
    get syncWritingAgentTask() {
      return syncWritingAgentTask
    },
    get pollWritingAgentTask() {
      return pollWritingAgentTask
    }
  })

  const { findingConfidenceLabel } = createReviewFormattingActions({})

  const { dismissOpening, replayOpening, initializeBoot, saveAppearancePreferences, resetAppearancePreferences } =
    createAppBootActions({
      get desktop() { return desktop },
      get projects() { return projects },
      get openProject() { return openProject },
      get opening() {
        return opening
      },
      get bootPreview() {
        return bootPreview
      },
      get projectsLoaded() {
        return projectsLoaded
      },
      get refreshProjects() {
        return refreshProjects
      },
      get openingReturnFocus() {
        return openingReturnFocus
      },
      set openingReturnFocus(value) {
        openingReturnFocus = value
      },
      get workspaceOpening() {
        return workspaceOpening
      },
      get bootPhase() {
        return bootPhase
      },
      get bootError() {
        return bootError
      },
      get loading() {
        return loading
      },
      get notice() {
        return notice
      },
      get explorerWidth() {
        return explorerWidth
      },
      get assistantWidth() {
        return assistantWidth
      },
      get interfaceFontSize() {
        return interfaceFontSize
      },
      get saveEditorPreferences() {
        return saveEditorPreferences
      },
      get resetEditorPreferences() {
        return resetEditorPreferences
      }
    })

  const {
    noteExplorerScroll,
    beginExplorerResize,
    resizeExplorerByKeyboard,
    beginAssistantResize,
    resizeAssistantByKeyboard
  } = createAppLayoutActions({
    get explorerScrolling() {
      return explorerScrolling
    },
    get explorerScrollEndTimer() {
      return explorerScrollEndTimer
    },
    set explorerScrollEndTimer(value) {
      explorerScrollEndTimer = value
    },
    get explorerWidth() {
      return explorerWidth
    },
    get removeExplorerResizeListeners() {
      return removeExplorerResizeListeners
    },
    set removeExplorerResizeListeners(value) {
      removeExplorerResizeListeners = value
    },
    get saveAppearancePreferences() {
      return saveAppearancePreferences
    },
    get assistantWidth() {
      return assistantWidth
    },
    get removeAssistantResizeListeners() {
      return removeAssistantResizeListeners
    },
    set removeAssistantResizeListeners(value) {
      removeAssistantResizeListeners = value
    }
  })

  const { selectTimelineMode, openChronicleMap, openWorldMapEvent, openWorldMapCharacter } =
    createTimelineNavigationActions({
      get timelineMode() {
        return timelineMode
      },
      get worldMapWorkspace() {
        return worldMapWorkspace
      },
      get loadCharacterLines() {
        return loadCharacterLines
      },
      get ensureTimelineVolumeSelected() {
        return ensureTimelineVolumeSelected
      },
      get loadForeshadowLedger() {
        return loadForeshadowLedger
      },
      get chronicleMapLocation() {
        return chronicleMapLocation
      },
      get selectWorkspaceLeaf() {
        return selectWorkspaceLeaf
      },
      get worldMapView() {
        return worldMapView
      },
      get notice() {
        return notice
      },
      get approvedEvents() {
        return approvedEvents
      },
      get timeline() {
        return timeline
      },
      get expandedTimelineEntry() {
        return expandedTimelineEntry
      },
      get timelineEntryId() {
        return timelineEntryId
      },
      get current() {
        return current
      },
      get workspaceRequests() {
        return workspaceRequests
      },
      get characterLines() {
        return characterLines
      },
      get characterAtlasThroughPosition() {
        return characterAtlasThroughPosition
      },
      get characterDisplayMode() {
        return characterDisplayMode
      },
      get selectedCharacterLineId() {
        return selectedCharacterLineId
      }
    })

  const { loadForeshadowLedger, chooseForeshadow, recordForeshadowAction, openForeshadowChapter } =
    createCharactersForeshadowActions({
      get current() {
        return current
      },
      get foreshadowLedgerLoaded() {
        return foreshadowLedgerLoaded
      },
      get desktop() {
        return desktop
      },
      get foreshadowLedger() {
        return foreshadowLedger
      },
      get selectedForeshadowId() {
        return selectedForeshadowId
      },
      get foreshadowDraft() {
        return foreshadowDraft
      },
      get notice() {
        return notice
      },
      get chapters() {
        return chapters
      },
      get guard() {
        return guard
      },
      get selectActivity() {
        return selectActivity
      },
      get selectChapter() {
        return selectChapter
      }
    })

  const {
    loadCharacterLines,
    openCharacterAtlasChapter,
    ensureTimelineVolumeSelected,
    loadTimelineVolume,
    openTimelineVolumeInOutline,
    characterPointDetails,
    volumeLineRange,
    volumeLineStatus
  } = createTimelineProjectionsActions({
    get current() {
      return current
    },
    get characterLinesLoaded() {
      return characterLinesLoaded
    },
    get workspaceRequests() {
      return workspaceRequests
    },
    get characterLinesRefreshGeneration() {
      return characterLinesRefreshGeneration
    },
    set characterLinesRefreshGeneration(value) {
      characterLinesRefreshGeneration = value
    },
    get characterLinesLoading() {
      return characterLinesLoading
    },
    get characterLinesError() {
      return characterLinesError
    },
    get characterAtlasInitialized() {
      return characterAtlasInitialized
    },
    set characterAtlasInitialized(value) {
      characterAtlasInitialized = value
    },
    get characterAtlasThroughPosition() {
      return characterAtlasThroughPosition
    },
    get chapters() {
      return chapters
    },
    get selectedId() {
      return selectedId
    },
    get desktop() {
      return desktop
    },
    get characterLines() {
      return characterLines
    },
    get characterAtlasCards() {
      return characterAtlasCards
    },
    get selectedCharacterLineId() {
      return selectedCharacterLineId
    },
    get notice() {
      return notice
    },
    get openQuickChapter() {
      return openQuickChapter
    },
    get timelineVolumeCards() {
      return timelineVolumeCards
    },
    get selectedTimelineVolume() {
      return selectedTimelineVolume
    },
    get selectedChapterVolume() {
      return selectedChapterVolume
    },
    get timelineVolumeContent() {
      return timelineVolumeContent
    },
    get timelineVolumeGeneration() {
      return timelineVolumeGeneration
    },
    set timelineVolumeGeneration(value) {
      timelineVolumeGeneration = value
    },
    get active() {
      return active
    },
    get timelineMode() {
      return timelineMode
    },
    get timelineVolumeLoading() {
      return timelineVolumeLoading
    },
    get timelineVolumeError() {
      return timelineVolumeError
    },
    get openVolumeOutline() {
      return openVolumeOutline
    }
  })

  const {
    openConsistencyItem,
    openWritingChecks,
    returnToManuscript,
    recheckSavedManuscript,
    continueAfterFactReview,
    dismissCharacterConflict,
    decideContinuityFinding,
    confirmFindingResolution,
    refreshFindingHistory,
    locateConsistencyFinding,
    locateLegacyCharacterConflict
  } = createReviewFindingsActions({
    get openVolumeOutline() {
      return openVolumeOutline
    },
    get selectedChapterVolume() {
      return selectedChapterVolume
    },
    get selectedVolume() {
      return selectedVolume
    },
    get selectWorkspaceLeaf() {
      return selectWorkspaceLeaf
    },
    get openTotalOutline() {
      return openTotalOutline
    },
    get outlineInspectorOpen() {
      return outlineInspectorOpen
    },
    get flushPlannedChapterSave() {
      return flushPlannedChapterSave
    },
    get characterState() {
      return characterState
    },
    get guard() {
      return guard
    },
    get desktop() {
      return desktop
    },
    get showCharacterConflicts() {
      return showCharacterConflicts
    },
    get selectActivity() {
      return selectActivity
    },
    get assistantOpen() {
      return assistantOpen
    },
    get assistantMode() {
      return assistantMode
    },
    get current() {
      return current
    },
    get localAppearanceDialog() {
      return localAppearanceDialog
    },
    get notice() {
      return notice
    },
    get manuscriptEditor() {
      return manuscriptEditor
    },
    get refreshWorkflow() {
      return refreshWorkflow
    },
    get dismissingConflictId() {
      return dismissingConflictId
    },
    get decidingContinuityFindingId() {
      return decidingContinuityFindingId
    },
    get selectedId() {
      return selectedId
    },
    get workspaceRequests() {
      return workspaceRequests
    },
    get findingResolutionError() {
      return findingResolutionError
    },
    get saveState() {
      return saveState
    },
    get chapterIsDirty() {
      return chapterIsDirty
    },
    get findingHistory() {
      return findingHistory
    },
    get chapters() {
      return chapters
    },
    get chapterContent() {
      return chapterContent
    },
    get selectChapter() {
      return selectChapter
    }
  })

  const { notice, guard } = createAppFeedbackActions({
    beginSoundResult: () => useUiSounds().beginResult(),
    get toast() {
      return toast
    },
    get busy() {
      return busy
    }
  })

  const {
    openBookTabs,
    bookDraftConflicts,
    resolveBookDraftConflict,
    selectBookTab,
    closeBookTab,
    openBackgroundTask,
    refreshProjects,
    chooseCreateFolder,
    openCreateProject,
    closeCreateProject,
    createProject,
    saveBookProfileAndContinue,
    importProject,
    openProject,
    openLibraryChapter,
    forgetProject,
    requestTrashProject,
    trashProject,
    openSystemTrash,
    closeProject,
    prepareWorkItemTransition,
    activateWorkItem,
    invalidateWorkspaceSnapshot
  } = createLibraryProjectsActions({
    afterCreate: () => groupWorkspace.show(),
    get openTxtImport() { return openTxtImport },
    get outlineStorageFeedback() { return outlineStorageFeedback },
    get refreshWorkflow() { return refreshWorkflow },
    get chapterTitle() { return chapterTitle },
    get chapterContent() { return chapterContent },
    get manuscriptConflict() { return manuscriptConflict },
    get sqliteStorageStatus() { return sqliteStorageStatus },
    get suppressManuscriptAutosave() { return suppressManuscriptAutosave },
    set suppressManuscriptAutosave(value) { suppressManuscriptAutosave = value },
    get sessionWorkspaceFields() {
      return { chapters, selectedId, chapterTitle, chapterContent, chapterOutline, chapterPlanning,
        lastSavedChapterOutline, totalOutline, lastSavedTotalOutline, selectedVolume, volumeOutline,
        lastSavedVolumeOutline, stageOutlines, selectedStage, stageTitle, stageOutline,
        lastSavedStageTitle, lastSavedStageOutline, standaloneOutlineEntries,
        bookProfile, foundation, realms, powerSystem, cheatSystem, systemTemplate,
        profileSavedSnapshot, profileSaveProgress, ai, researchSettings, sqliteStorageStatus, migrationPreview,
        eventProjection, unifiedEvents, archivedUnifiedEvents, unifiedEventCandidates, timeline, canonicalEvents,
        sourceCards, planningDraft, promptProfile, promptDraft, workspaceBootstrapIssues,
        importRecoveries, continuationAnalysis, continuationManifestId, continuationBlockedReason,
        writingAgentTasks, writingAgentTurns, manuscriptRecoveryItems, autoBackupStatus, autoBackupDraft,
        ideas, saveState, lastSavedAt, outlineMode, materialSection, preparationMode }
    },
    get openTaskCenter() { return openTaskCenter },
    get manuscriptEditor() { return manuscriptEditor },
    get sessionNavigation() { return ['outlineMode', 'materialSection', 'preparationMode'] },
    async restoreBookJobs(path) {
      const generation = workspaceRefreshGeneration
      const valid = () => current.value?.path === path && workspaceRefreshGeneration === generation
      const tasks = await desktop.ai.backgroundTasks().catch(() => [])
      if (!valid()) return
      for (const [kind, field, read, poll] of [
        ['自动谋篇', planningJob, id => desktop.planning.job(id), pollAutomaticPlanning],
        ['章节安排', planningSkeletonJob, id => desktop.planning.chapterSkeletonJob(id), pollPlanningChapterSkeleton],
        ['详细章纲', planningDetailJob, id => desktop.planning.chapterDetailJob(id), pollPlanningChapterDetail]
      ]) {
        const task = tasks.find(task => task.bookPath === path && task.kind === kind && task.status === 'running')
        if (!task) continue
        const value = await read(task.taskId).catch(() => null)
        if (!valid()) return
        field.value = value
        if (value) poll()
      }
    },
    get sessionFields() {
      return { bookProfile, foundation, realms, powerSystem, cheatSystem, systemTemplate,
        outlineMode, materialSection, preparationMode }
    },
    get desktop() {
      return desktop
    },
    get projectLibraryRefreshGeneration() {
      return projectLibraryRefreshGeneration
    },
    set projectLibraryRefreshGeneration(value) {
      projectLibraryRefreshGeneration = value
    },
    get projectsLoaded() {
      return projectsLoaded
    },
    get projects() {
      return projects
    },
    get continueProjectId() {
      return continueProjectId
    },
    get createForm() {
      return createForm
    },
    get createErrors() {
      return createErrors
    },
    get createModelsPreview() {
      return createModelsPreview
    },
    get createTrigger() {
      return createTrigger
    },
    get showCreate() {
      return showCreate
    },
    get createNameInput() {
      return createNameInput
    },
    get notice() {
      return notice
    },
    get partialCreation() {
      return partialCreation
    },
    get guard() {
      return guard
    },
    get plainDto() {
      return plainDto
    },
    get active() {
      return active
    },
    get newProjectGuide() {
      return newProjectGuide
    },
    get saveBookProfile() {
      return saveBookProfile
    },
    get selectWorkspaceLeaf() {
      return selectWorkspaceLeaf
    },
    get workspaceOpening() {
      return workspaceOpening
    },
    get beginWorkspaceOpening() {
      return beginWorkspaceOpening
    },
    get isCurrentWorkspaceOpening() {
      return isCurrentWorkspaceOpening
    },
    get setWorkspaceOpeningPhase() {
      return setWorkspaceOpeningPhase
    },
    get waitForWorkspaceOpeningPhase() {
      return waitForWorkspaceOpeningPhase
    },
    get WORKSPACE_COMPLETION_DURATION_MS() {
      return WORKSPACE_COMPLETION_DURATION_MS
    },
    get finishWorkspaceOpening() {
      return finishWorkspaceOpening
    },
    get current() {
      return current
    },
    get chapters() {
      return chapters
    },
    get selectActivity() {
      return selectActivity
    },
    get selectChapter() {
      return selectChapter
    },
    get projectTrashConfirmation() {
      return projectTrashConfirmation
    },
    get projectTrashTarget() {
      return projectTrashTarget
    },
    get recentlyTrashedProject() {
      return recentlyTrashedProject
    },
    get workspaceRequests() {
      return workspaceRequests
    },
    get chapterSelectionGeneration() {
      return chapterSelectionGeneration
    },
    set chapterSelectionGeneration(value) {
      chapterSelectionGeneration = value
    },
    get workspaceRefreshGeneration() {
      return workspaceRefreshGeneration
    },
    set workspaceRefreshGeneration(value) {
      workspaceRefreshGeneration = value
    },
    get clearAutosaveTimer() {
      return clearAutosaveTimer
    },
    get clearAutosaveFinalizeTimer() {
      return clearAutosaveFinalizeTimer
    },
    get activeAutosaveCheckpoint() {
      return activeAutosaveCheckpoint
    },
    set activeAutosaveCheckpoint(value) {
      activeAutosaveCheckpoint = value
    },
    get stagedRecoverySnapshot() {
      return stagedRecoverySnapshot
    },
    set stagedRecoverySnapshot(value) {
      stagedRecoverySnapshot = value
    },
    get selectedId() {
      return selectedId
    },
    get selectedVolume() {
      return selectedVolume
    },
    get volumeOutline() {
      return volumeOutline
    },
    get stageOutlines() {
      return stageOutlines
    },
    get selectedStage() {
      return selectedStage
    },
    get stageTitle() {
      return stageTitle
    },
    get stageOutline() {
      return stageOutline
    },
    get lastSavedStageTitle() {
      return lastSavedStageTitle
    },
    get lastSavedStageOutline() {
      return lastSavedStageOutline
    },
    get stageDraftTitle() {
      return stageDraftTitle
    },
    get lastSavedChapter() {
      return lastSavedChapter
    },
    set lastSavedChapter(value) {
      lastSavedChapter = value
    },
    get resetWorkItemTransientState() {
      return resetWorkItemTransientState
    },
    get prepareOutlineLeave() {
      return prepareOutlineLeave
    },
    get invalidateOutlineRead() {
      return invalidateOutlineRead
    },
    get modelSettingsDirty() {
      return modelSettingsDirty
    },
    get worldMapWorkspace() {
      return worldMapWorkspace
    },
    get flushPlannedChapterSave() {
      return flushPlannedChapterSave
    },
    get cancelAutomaticPlanning() {
      return cancelAutomaticPlanning
    },
    get cancelPlanningChapterSkeleton() {
      return cancelPlanningChapterSkeleton
    },
    get cancelPlanningChapterDetail() {
      return cancelPlanningChapterDetail
    },
    get flushChapterSaveSafely() {
      return flushChapterSaveSafely
    },
    get flushPlanningDraftSave() {
      return flushPlanningDraftSave
    },
    get loadWorkspace() {
      return loadWorkspace
    },
    get workspaceLoadError() {
      return workspaceLoadError
    },
    get migrationPreview() {
      return migrationPreview
    }
  })

  const { openTxtImport, addContinuationDocuments, moveManifestFile, chooseTxtDestination, commitTxtImport } =
    createLibraryImportsActions({
      get importProject() { return importProject },
      get workspaceRequests() { return workspaceRequests },
      get txtImportEntry() {
        return txtImportEntry
      },
      get txtPreview() {
        return txtPreview
      },
      get txtMaterialPreview() {
        return txtMaterialPreview
      },
      get importManifest() {
        return importManifest
      },
      get importCreatedProject() {
        return importCreatedProject
      },
      get manifestRoles() {
        return manifestRoles
      },
      get manifestChapterSelections() {
        return manifestChapterSelections
      },
      get txtImport() {
        return txtImport
      },
      get current() {
        return current
      },
      get showTxtImport() {
        return showTxtImport
      },
      get guard() {
        return guard
      },
      get desktop() {
        return desktop
      },
      get busy() {
        return busy
      },
      get notice() {
        return notice
      },
      get txtCanImport() {
        return txtCanImport
      },
      get prepareWorkItemTransition() {
        return prepareWorkItemTransition
      },
      get importModelsPreview() {
        return importModelsPreview
      },
      get partialImportCreation() {
        return partialImportCreation
      },
      get activateWorkItem() {
        return activateWorkItem
      },
      get refreshProjects() {
        return refreshProjects
      },
      get loadWorkspace() {
        return loadWorkspace
      },
      get active() {
        return active
      },
      get continuationAnalysis() {
        return continuationAnalysis
      },
      get continuationManifestId() {
        return continuationManifestId
      },
      get preparationMode() {
        return preparationMode
      }
    })

  const {
    beginWorkspaceOpening,
    isCurrentWorkspaceOpening,
    workspaceOpeningPhaseIndex,
    settleWorkspaceOpeningPhaseWaiters,
    stopWorkspaceOpeningPhasePlayback,
    scheduleWorkspaceOpeningPhaseAdvance,
    advanceWorkspaceOpeningPhase,
    setWorkspaceOpeningPhase,
    waitForWorkspaceOpeningPhase,
    finishWorkspaceOpening,
    cancelWorkspaceOpening
  } = createLibraryOpeningActions({
    get workspaceOpeningGeneration() {
      return workspaceOpeningGeneration
    },
    set workspaceOpeningGeneration(value) {
      workspaceOpeningGeneration = value
    },
    get workspaceOpeningSlowTimer() {
      return workspaceOpeningSlowTimer
    },
    set workspaceOpeningSlowTimer(value) {
      workspaceOpeningSlowTimer = value
    },
    get workspaceOpening() {
      return workspaceOpening
    },
    get WORKSPACE_PHASE_SEQUENCE() {
      return WORKSPACE_PHASE_SEQUENCE
    },
    get workspaceOpeningPhaseWaiters() {
      return workspaceOpeningPhaseWaiters
    },
    set workspaceOpeningPhaseWaiters(value) {
      workspaceOpeningPhaseWaiters = value
    },
    get workspaceOpeningPhaseTimer() {
      return workspaceOpeningPhaseTimer
    },
    set workspaceOpeningPhaseTimer(value) {
      workspaceOpeningPhaseTimer = value
    },
    get workspaceOpeningPhaseFrame() {
      return workspaceOpeningPhaseFrame
    },
    set workspaceOpeningPhaseFrame(value) {
      workspaceOpeningPhaseFrame = value
    },
    get WORKSPACE_PHASE_DWELL_MS() {
      return WORKSPACE_PHASE_DWELL_MS
    },
    get workspaceRequests() {
      return workspaceRequests
    },
    get chapterSelectionGeneration() {
      return chapterSelectionGeneration
    },
    set chapterSelectionGeneration(value) {
      chapterSelectionGeneration = value
    },
    get workspaceRefreshGeneration() {
      return workspaceRefreshGeneration
    },
    set workspaceRefreshGeneration(value) {
      workspaceRefreshGeneration = value
    },
    get clearAutosaveTimer() {
      return clearAutosaveTimer
    },
    get clearAutosaveFinalizeTimer() {
      return clearAutosaveFinalizeTimer
    },
    get current() {
      return current
    },
    get selectedId() {
      return selectedId
    },
    get resetWorkItemTransientState() {
      return resetWorkItemTransientState
    },
    get refreshProjects() {
      return refreshProjects
    }
  })

  const { resetWorkItemTransientState, loadWorkspace } = createLibraryWorkspaceLoadingActions({
    get findingHistory() { return findingHistory },
    get outlinePlanning() { return outlinePlanning },
    get resetPlannedChapter() {
      return resetPlannedChapter
    },
    get newProjectGuide() {
      return newProjectGuide
    },
    get chapterTrashOpen() {
      return chapterTrashOpen
    },
    get chapterTrashEntries() {
      return chapterTrashEntries
    },
    get chapterDeleteTarget() {
      return chapterDeleteTarget
    },
    get showDeleteConfirm() {
      return showDeleteConfirm
    },
    get chapterSelectionGeneration() {
      return chapterSelectionGeneration
    },
    set chapterSelectionGeneration(value) {
      chapterSelectionGeneration = value
    },
    get workspaceRefreshGeneration() {
      return workspaceRefreshGeneration
    },
    set workspaceRefreshGeneration(value) {
      workspaceRefreshGeneration = value
    },
    get workspaceLoadError() {
      return workspaceLoadError
    },
    get workspaceBootstrapIssues() {
      return workspaceBootstrapIssues
    },
    get chapters() {
      return chapters
    },
    get selectedId() {
      return selectedId
    },
    get stageOutlines() {
      return stageOutlines
    },
    get selectedStage() {
      return selectedStage
    },
    get stageTitle() {
      return stageTitle
    },
    get stageOutline() {
      return stageOutline
    },
    get lastSavedStageTitle() {
      return lastSavedStageTitle
    },
    get lastSavedStageOutline() {
      return lastSavedStageOutline
    },
    get stageDraftTitle() {
      return stageDraftTitle
    },
    get chapterTitle() {
      return chapterTitle
    },
    get chapterContent() {
      return chapterContent
    },
    get manuscriptSaveError() {
      return manuscriptSaveError
    },
    get manuscriptConflict() {
      return manuscriptConflict
    },
    get migrationPreview() {
      return migrationPreview
    },
    get sqliteStorageStatus() {
      return sqliteStorageStatus
    },
    get outlineStorageFeedback() {
      return outlineStorageFeedback
    },
    get sqliteActivationPreview() {
      return sqliteActivationPreview
    },
    get sqliteActivationResult() {
      return sqliteActivationResult
    },
    get workspaceBackupResult() {
      return workspaceBackupResult
    },
    get consistencyEvaluationSummary() {
      return consistencyEvaluationSummary
    },
    get consistencyEvaluationJob() {
      return consistencyEvaluationJob
    },
    get consistencyEvaluationPollTimer() {
      return consistencyEvaluationPollTimer
    },
    set consistencyEvaluationPollTimer(value) {
      consistencyEvaluationPollTimer = value
    },
    get realTrialReport() {
      return realTrialReport
    },
    get realTrialIssue() {
      return realTrialIssue
    },
    get realTrialChapterId() {
      return realTrialChapterId
    },
    get realTrialDraft() {
      return realTrialDraft
    },
    get realTrialDraftDefaults() {
      return realTrialDraftDefaults
    },
    get realTrialConclusionDraft() {
      return realTrialConclusionDraft
    },
    get realTrialConclusionDefaults() {
      return realTrialConclusionDefaults
    },
    get workspaceRestorePreview() {
      return workspaceRestorePreview
    },
    get autoBackupStatus() {
      return autoBackupStatus
    },
    get autoBackupDraft() {
      return autoBackupDraft
    },
    get autoBackupRunning() {
      return autoBackupRunning
    },
    get autoBackupLoading() {
      return autoBackupLoading
    },
    get autoBackupDraftDirty() {
      return autoBackupDraftDirty
    },
    get autoBackupRefreshGeneration() {
      return autoBackupRefreshGeneration
    },
    set autoBackupRefreshGeneration(value) {
      autoBackupRefreshGeneration = value
    },
    get autoBackupSettingsLoadGeneration() {
      return autoBackupSettingsLoadGeneration
    },
    set autoBackupSettingsLoadGeneration(value) {
      autoBackupSettingsLoadGeneration = value
    },
    get pendingCharacterSettlements() {
      return pendingCharacterSettlements
    },
    get pendingAiSourceTaskIds() {
      return pendingAiSourceTaskIds
    },
    get writingAgentTurns() {
      return writingAgentTurns
    },
    get writingAgentTasks() {
      return writingAgentTasks
    },
    get writingAgentRunning() {
      return writingAgentRunning
    },
    get writingAgentContextPreview() {
      return writingAgentContextPreview
    },
    get writingAgentContextPreviewBusy() {
      return writingAgentContextPreviewBusy
    },
    get manuscriptSelection() {
      return manuscriptSelection
    },
    get manuscriptInsertionAnchor() {
      return manuscriptInsertionAnchor
    },
    get chapterPlanning() {
      return chapterPlanning
    },
    get chapterCardOpen() {
      return chapterCardOpen
    },
    get chapterCardAdoption() {
      return chapterCardAdoption
    },
    get foundationDraft() {
      return foundationDraft
    },
    get timelineMode() {
      return timelineMode
    },
    get worldMapWorkspace() {
      return worldMapWorkspace
    },
    get expandedTimelineEntry() {
      return expandedTimelineEntry
    },
    get timelineAiCandidates() {
      return timelineAiCandidates
    },
    get timelineAiGenerating() {
      return timelineAiGenerating
    },
    get characterLines() {
      return characterLines
    },
    get characterLinesLoaded() {
      return characterLinesLoaded
    },
    get characterLinesLoading() {
      return characterLinesLoading
    },
    get characterLinesError() {
      return characterLinesError
    },
    get characterLinesRefreshGeneration() {
      return characterLinesRefreshGeneration
    },
    set characterLinesRefreshGeneration(value) {
      characterLinesRefreshGeneration = value
    },
    get characterDisplayMode() {
      return characterDisplayMode
    },
    get characterAtlasThroughPosition() {
      return characterAtlasThroughPosition
    },
    get characterAtlasInitialized() {
      return characterAtlasInitialized
    },
    set characterAtlasInitialized(value) {
      characterAtlasInitialized = value
    },
    get selectedCharacterLineId() {
      return selectedCharacterLineId
    },
    get selectedTimelineVolume() {
      return selectedTimelineVolume
    },
    get timelineVolumeContent() {
      return timelineVolumeContent
    },
    get timelineVolumeLoading() {
      return timelineVolumeLoading
    },
    get foreshadowLedger() {
      return foreshadowLedger
    },
    get foreshadowLedgerLoaded() {
      return foreshadowLedgerLoaded
    },
    get selectedForeshadowId() {
      return selectedForeshadowId
    },
    get foreshadowDraft() {
      return foreshadowDraft
    },
    get clearPlanningPoll() {
      return clearPlanningPoll
    },
    get clearPlanningSkeletonPoll() {
      return clearPlanningSkeletonPoll
    },
    get clearPlanningDetailPoll() {
      return clearPlanningDetailPoll
    },
    get clearPlanningDraftSave() {
      return clearPlanningDraftSave
    },
    get planningJob() {
      return planningJob
    },
    get planningSkeletonJob() {
      return planningSkeletonJob
    },
    get planningSkeletonStatus() {
      return planningSkeletonStatus
    },
    get planningDetailJob() {
      return planningDetailJob
    },
    get planningDetailStatuses() {
      return planningDetailStatuses
    },
    get planningDraft() {
      return planningDraft
    },
    get planningAdoptionPreview() {
      return planningAdoptionPreview
    },
    get planningVolumeStructurePreview() {
      return planningVolumeStructurePreview
    },
    get planningVolumeOutlinePreview() {
      return planningVolumeOutlinePreview
    },
    get planningChapterDetailPreview() {
      return planningChapterDetailPreview
    },
    get planningCharacterSeedPreview() {
      return planningCharacterSeedPreview
    },
    get planningWorldSeedPreview() {
      return planningWorldSeedPreview
    },
    get planningPowerSystemPreview() {
      return planningPowerSystemPreview
    },
    get planningCheatSystemPreview() {
      return planningCheatSystemPreview
    },
    get planningDraftSaveState() {
      return planningDraftSaveState
    },
    get promptProfile() {
      return promptProfile
    },
    get promptDraft() {
      return promptDraft
    },
    get workflowStatus() {
      return workflowStatus
    },
    get consistencyOverview() {
      return consistencyOverview
    },
    get chapterDerivatives() {
      return chapterDerivatives
    },
    get contextFactPack() {
      return contextFactPack
    },
    get factBatches() {
      return factBatches
    },
    get factExtractionRetryId() {
      return factExtractionRetryId
    },
    get factExtractionRawResult() {
      return factExtractionRawResult
    },
    get characterState() {
      return characterState
    },
    get showCharacterConflicts() {
      return showCharacterConflicts
    },
    get dismissingConflictId() {
      return dismissingConflictId
    },
    get importRecoveries() {
      return importRecoveries
    },
    get recoveryBusyId() {
      return recoveryBusyId
    },
    get continuationAnalysis() {
      return continuationAnalysis
    },
    get continuationManifestId() {
      return continuationManifestId
    },
    get continuationBlockedReason() {
      return continuationBlockedReason
    },
    get continuationProjectDefinitionPreview() {
      return continuationProjectDefinitionPreview
    },
    get continuationExistingPlotPreview() {
      return continuationExistingPlotPreview
    },
    get continuationCharacterEditorOpen() {
      return continuationCharacterEditorOpen
    },
    get continuationCharacterPreview() {
      return continuationCharacterPreview
    },
    get continuationWorldViewPreview() {
      return continuationWorldViewPreview
    },
    get continuationPowerSystemPreview() {
      return continuationPowerSystemPreview
    },
    get continuationCheatSystemPreview() {
      return continuationCheatSystemPreview
    },
    get continuationTotalOutlinePreview() {
      return continuationTotalOutlinePreview
    },
    get continuationVolumeOutlinePreview() {
      return continuationVolumeOutlinePreview
    },
    get continuationVolumeTarget() {
      return continuationVolumeTarget
    },
    get continuationChapterOutlinePreview() {
      return continuationChapterOutlinePreview
    },
    get continuationChapterTarget() {
      return continuationChapterTarget
    },
    get current() {
      return current
    },
    get workspaceRequests() {
      return workspaceRequests
    },
    get setWorkspaceOpeningPhase() {
      return setWorkspaceOpeningPhase
    },
    get desktop() {
      return desktop
    },
    get totalOutline() {
      return totalOutline
    },
    get lastSavedTotalOutline() {
      return lastSavedTotalOutline
    },
    get selectedVolume() {
      return selectedVolume
    },
    get volumeOutline() {
      return volumeOutline
    },
    get lastSavedVolumeOutline() {
      return lastSavedVolumeOutline
    },
    get standaloneOutlineEntries() {
      return standaloneOutlineEntries
    },
    get timeline() {
      return timeline
    },
    get eventProjection() {
      return eventProjection
    },
    get unifiedEvents() {
      return unifiedEvents
    },
    get archivedUnifiedEvents() {
      return archivedUnifiedEvents
    },
    get unifiedEventCandidates() {
      return unifiedEventCandidates
    },
    get eventMigrationState() {
      return eventMigrationState
    },
    get eventMigrationBusy() {
      return eventMigrationBusy
    },
    get eventMigrationError() {
      return eventMigrationError
    },
    get realms() {
      return realms
    },
    get powerSystem() {
      return powerSystem
    },
    get cheatSystem() {
      return cheatSystem
    },
    get systemTemplate() {
      return systemTemplate
    },
    get foundation() {
      return foundation
    },
    get bookProfile() {
      return bookProfile
    },
    get profileSavedSnapshot() {
      return profileSavedSnapshot
    },
    get profileSaveProgress() {
      return profileSaveProgress
    },
    get profileSavedAt() {
      return profileSavedAt
    },
    get ai() {
      return ai
    },
    get modelDefaults() {
      return modelDefaults
    },
    get taskLabels() {
      return taskLabels
    },
    get refreshOneOffConnections() {
      return refreshOneOffConnections
    },
    get removedAiConnectionIds() {
      return removedAiConnectionIds
    },
    get aiCatalogRefreshGeneration() {
      return aiCatalogRefreshGeneration
    },
    set aiCatalogRefreshGeneration(value) {
      aiCatalogRefreshGeneration = value
    },
    get availableModelsByConnection() {
      return availableModelsByConnection
    },
    get aiCatalogLoading() {
      return aiCatalogLoading
    },
    get aiCatalogUnavailableConnectionIds() {
      return aiCatalogUnavailableConnectionIds
    },
    get aiConnectionResult() {
      return aiConnectionResult
    },
    get aiModelChecks() {
      return aiModelChecks
    },
    get aiConnectionDeletePreview() {
      return aiConnectionDeletePreview
    },
    get aiCredentialClearPreview() {
      return aiCredentialClearPreview
    },
    get researchSettings() {
      return researchSettings
    },
    get clearIdeaGenerationPoll() {
      return clearIdeaGenerationPoll
    },
    get ideaGenerations() {
      return ideaGenerations
    },
    get ideaSourceLoad() {
      return ideaSourceLoad
    },
    set ideaSourceLoad(value) {
      ideaSourceLoad = value
    },
    get ideaSourceTask() {
      return ideaSourceTask
    },
    get ideaSourceIssue() {
      return ideaSourceIssue
    },
    get ideaGenerationInstruction() {
      return ideaGenerationInstruction
    },
    get selectedIdeaId() {
      return selectedIdeaId
    },
    get creatingIdea() {
      return creatingIdea
    },
    get ideaDraft() {
      return ideaDraft
    },
    get sourceCards() {
      return sourceCards
    },
    get canonicalEvents() {
      return canonicalEvents
    },
    get recoverEventOperation() {
      return recoverEventOperation
    },
    get syncPromptDraft() {
      return syncPromptDraft
    },
    get researchQuery() {
      return researchQuery
    },
    get researchResult() {
      return researchResult
    },
    get refreshAutoBackup() {
      return refreshAutoBackup
    },
    get selectChapter() {
      return selectChapter
    },
    get refreshWorkflow() {
      return refreshWorkflow
    },
    get ideas() {
      return ideas
    },
    get refreshManuscriptRecoveries() {
      return refreshManuscriptRecoveries
    },
    get runAutomaticBackup() {
      return runAutomaticBackup
    }
  })

  const {
    resumeImportManifest,
    generateContinuationAnalysis,
    saveContinuationAnalysis,
    openContinuationProjectDefinitionAdoption,
    confirmContinuationProjectDefinitionAdoption,
    openContinuationExistingPlotAdoption,
    confirmContinuationExistingPlotAdoption,
    openContinuationCharacterEditor,
    closeContinuationCharacterEditor,
    previewContinuationCharacterImpact,
    confirmContinuationCharacterAdoption,
    openContinuationWorldViewAdoption,
    confirmContinuationWorldViewAdoption,
    openContinuationPowerSystemAdoption,
    confirmContinuationPowerSystemAdoption,
    openContinuationCheatSystemAdoption,
    confirmContinuationCheatSystemAdoption,
    openContinuationTotalOutlineAdoption,
    confirmContinuationTotalOutlineAdoption,
    openContinuationVolumeOutlineAdoption,
    confirmContinuationVolumeOutlineAdoption,
    openContinuationChapterOutlineAdoption,
    confirmContinuationChapterOutlineAdoption
  } = createLibraryContinuationActions({
    get workspaceRequests() { return workspaceRequests },
    get current() { return current },
    get recoveryBusyId() {
      return recoveryBusyId
    },
    get guard() {
      return guard
    },
    get desktop() {
      return desktop
    },
    get loadWorkspace() {
      return loadWorkspace
    },
    get notice() {
      return notice
    },
    get continuationManifestId() {
      return continuationManifestId
    },
    get busy() {
      return busy
    },
    get continuationBlockedReason() {
      return continuationBlockedReason
    },
    get continuationAnalysis() {
      return continuationAnalysis
    },
    get active() {
      return active
    },
    get preparationMode() {
      return preparationMode
    },
    get continuationProjectDefinitionPreview() {
      return continuationProjectDefinitionPreview
    },
    get plainDto() {
      return plainDto
    },
    get bookProfile() {
      return bookProfile
    },
    get continuationExistingPlotPreview() {
      return continuationExistingPlotPreview
    },
    get continuationExistingPlotDraft() {
      return continuationExistingPlotDraft
    },
    get timeline() {
      return timeline
    },
    get refreshWorkflow() {
      return refreshWorkflow
    },
    get continuationCharacterDraft() {
      return continuationCharacterDraft
    },
    get continuationCharacterPreview() {
      return continuationCharacterPreview
    },
    get continuationCharacterEditorOpen() {
      return continuationCharacterEditorOpen
    },
    get characterState() {
      return characterState
    },
    get toast() {
      return toast
    },
    get continuationWorldViewPreview() {
      return continuationWorldViewPreview
    },
    get foundation() {
      return foundation
    },
    get continuationPowerSystemPreview() {
      return continuationPowerSystemPreview
    },
    get powerSystem() {
      return powerSystem
    },
    get continuationCheatSystemPreview() {
      return continuationCheatSystemPreview
    },
    get cheatSystem() {
      return cheatSystem
    },
    get continuationTotalOutlinePreview() {
      return continuationTotalOutlinePreview
    },
    get totalOutline() {
      return totalOutline
    },
    get lastSavedTotalOutline() {
      return lastSavedTotalOutline
    },
    get outlinePlanning() {
      return outlinePlanning
    },
    get continuationVolumeTarget() {
      return continuationVolumeTarget
    },
    get continuationVolumeOutlinePreview() {
      return continuationVolumeOutlinePreview
    },
    get selectedVolume() {
      return selectedVolume
    },
    get volumeOutline() {
      return volumeOutline
    },
    get lastSavedVolumeOutline() {
      return lastSavedVolumeOutline
    },
    get continuationChapterTarget() {
      return continuationChapterTarget
    },
    get continuationChapterOutlinePreview() {
      return continuationChapterOutlinePreview
    },
    get selectedId() {
      return selectedId
    },
    get chapterOutline() {
      return chapterOutline
    },
    get lastSavedChapterOutline() {
      return lastSavedChapterOutline
    }
  })

  const { openChapterOutlineReview, openChapterFromOutlineCatalog } = createPlanningNavigationActions({
    get chapters() {
      return chapters
    },
    get notice() {
      return notice
    },
    get outlineInspectorOpen() {
      return outlineInspectorOpen
    },
    get openPlannedChapter() {
      return openPlannedChapter
    },
    get active() {
      return active
    },
    get outlineMode() {
      return outlineMode
    },
    get selectedId() {
      return selectedId
    },
    get invalidateOutlineRead() {
      return invalidateOutlineRead
    },
    get outlineNavigationGeneration() {
      return outlineNavigationGeneration
    },
    set outlineNavigationGeneration(value) {
      outlineNavigationGeneration = value
    },
    get current() {
      return current
    },
    get outlineOpenError() {
      return outlineOpenError
    },
    get outlineLoading() {
      return outlineLoading
    },
    get retryOutlineOpen() {
      return retryOutlineOpen
    },
    set retryOutlineOpen(value) {
      retryOutlineOpen = value
    },
    get selectChapter() {
      return selectChapter
    }
  })

  const { refreshWorkflow } = createLibraryWorkflowActions({
    get chapterTitle() { return chapterTitle },
    get chapterContent() { return chapterContent },
    get workspaceRefreshGeneration() {
      return workspaceRefreshGeneration
    },
    set workspaceRefreshGeneration(value) {
      workspaceRefreshGeneration = value
    },
    get current() {
      return current
    },
    get workflowStatus() {
      return workflowStatus
    },
    get consistencyOverview() {
      return consistencyOverview
    },
    get chapterDerivatives() {
      return chapterDerivatives
    },
    get contextFactPack() {
      return contextFactPack
    },
    get factBatches() {
      return factBatches
    },
    get contextFactPackKey() {
      return contextFactPackKey
    },
    set contextFactPackKey(value) {
      contextFactPackKey = value
    },
    get outlinePlanning() {
      return outlinePlanning
    },
    get workspaceRequests() {
      return workspaceRequests
    },
    get selectedId() {
      return selectedId
    },
    get chapterOrderIssue() {
      return chapterOrderIssue
    },
    get foundation() {
      return foundation
    },
    get totalOutline() {
      return totalOutline
    },
    get planningSkeletonStatus() {
      return planningSkeletonStatus
    },
    get planningDetailStatuses() {
      return planningDetailStatuses
    },
    get outlinePlanningIssue() {
      return outlinePlanningIssue
    },
    get bookProfile() {
      return bookProfile
    },
    get sourceCards() {
      return sourceCards
    },
    get researchEventsIssue() {
      return researchEventsIssue
    },
    get canonicalEvents() {
      return canonicalEvents
    },
    get timeline() {
      return timeline
    },
    get characterStateIssue() {
      return characterStateIssue
    },
    get desktop() {
      return desktop
    },
    get planningDraft() {
      return planningDraft
    },
    get sqliteStorageStatus() {
      return sqliteStorageStatus
    },
    get findingHistory() {
      return findingHistory
    },
    get factExtractionBusy() {
      return factExtractionBusy
    },
    get factExtractionRetryId() {
      return factExtractionRetryId
    },
    get factExtractionRawResult() {
      return factExtractionRawResult
    },
    get chapterOutline() {
      return chapterOutline
    },
    get assistantAvailable() {
      return assistantAvailable
    },
    get assistantOpen() {
      return assistantOpen
    },
    get researchSourcesIssue() {
      return researchSourcesIssue
    }
  })

  const {
    workspaceRecoveryBusy, workspaceRecoveryFeedback, recheckWorkspaceIssues,
    workspaceIssueDiagnostic, copyWorkspaceIssueDiagnostic, clearModelLoadIssue
  } = createWorkspaceRecoveryActions({
    get desktop() { return desktop },
    get current() { return current },
    get workspaceRequests() { return workspaceRequests },
    get workspaceBootstrapIssues() { return workspaceBootstrapIssues },
    get ai() { return ai },
    get modelSettingsDirty() { return modelSettingsDirty },
    get eventProjection() { return eventProjection },
    get unifiedEvents() { return unifiedEvents },
    get archivedUnifiedEvents() { return archivedUnifiedEvents },
    get unifiedEventCandidates() { return unifiedEventCandidates },
    get appVersion() { return appVersion },
    get invalidateWorkspaceSnapshot() { return invalidateWorkspaceSnapshot }
  })

  const {
    decideFactChanges,
    extractCurrentChapterFacts,
    pollFactExtraction,
    cancelFactExtraction,
    retryFactExtraction,
    revealBootstrapIssue,
    dispose: disposeReviewFacts
  } = createReviewFactsActions({
    get current() { return current },
    get workspaceRequests() { return workspaceRequests },
    get chapterSelectionGeneration() { return chapterSelectionGeneration },
    get factReviewBusy() {
      return factReviewBusy
    },
    get desktop() {
      return desktop
    },
    get factBatches() {
      return factBatches
    },
    get contextFactPackKey() {
      return contextFactPackKey
    },
    set contextFactPackKey(value) {
      contextFactPackKey = value
    },
    get refreshWorkflow() {
      return refreshWorkflow
    },
    get notice() {
      return notice
    },
    get selectedId() {
      return selectedId
    },
    get factExtractionBusy() {
      return factExtractionBusy
    },
    get factExtractionRetryId() {
      return factExtractionRetryId
    },
    get factExtractionRawResult() {
      return factExtractionRawResult
    },
    get factExtractionJobId() {
      return factExtractionJobId
    },
    get selectActivity() {
      return selectActivity
    },
    get selectSettingsSection() {
      return selectSettingsSection
    },
    get guard() {
      return guard
    }
  })

  const {
    selectChapter,
    openChapterCard,
    saveChapterSummary,
    saveChapterCard,
    persistCurrentChapterBeforeConfirmation,
    refreshChapterAfterConfirmation,
    confirmCurrentChapter,
    confirmAndExtractCurrentChapterFacts
  } = createManuscriptChapterCardsActions({
    get worldMapWorkspace() {
      return worldMapWorkspace
    },
    get current() {
      return current
    },
    get workspaceRequests() {
      return workspaceRequests
    },
    get invalidateOutlineRead() {
      return invalidateOutlineRead
    },
    get chapterSelectionGeneration() {
      return chapterSelectionGeneration
    },
    set chapterSelectionGeneration(value) {
      chapterSelectionGeneration = value
    },
    get prepareOutlineLeave() {
      return prepareOutlineLeave
    },
    get flushPlannedChapterSave() {
      return flushPlannedChapterSave
    },
    get selectedId() {
      return selectedId
    },
    get flushChapterSaveSafely() {
      return flushChapterSaveSafely
    },
    get outlineDraftSnapshot() {
      return outlineDraftSnapshot
    },
    get desktop() {
      return desktop
    },
    get notice() {
      return notice
    },
    get clearAutosaveTimer() {
      return clearAutosaveTimer
    },
    get clearAutosaveFinalizeTimer() {
      return clearAutosaveFinalizeTimer
    },
    get activeAutosaveCheckpoint() {
      return activeAutosaveCheckpoint
    },
    set activeAutosaveCheckpoint(value) {
      activeAutosaveCheckpoint = value
    },
    get stagedRecoverySnapshot() {
      return stagedRecoverySnapshot
    },
    set stagedRecoverySnapshot(value) {
      stagedRecoverySnapshot = value
    },
    get showRevisions() {
      return showRevisions
    },
    get chapterCardAdoption() {
      return chapterCardAdoption
    },
    get manuscriptSelection() {
      return manuscriptSelection
    },
    get manuscriptInsertionAnchor() {
      return manuscriptInsertionAnchor
    },
    get lastSavedChapter() {
      return lastSavedChapter
    },
    set lastSavedChapter(value) {
      lastSavedChapter = value
    },
    get suppressManuscriptAutosave() {
      return suppressManuscriptAutosave
    },
    set suppressManuscriptAutosave(value) {
      suppressManuscriptAutosave = value
    },
    get chapterTitle() {
      return chapterTitle
    },
    get chapterContent() {
      return chapterContent
    },
    get saveState() {
      return saveState
    },
    get manuscriptSaveError() {
      return manuscriptSaveError
    },
    get manuscriptConflict() {
      return manuscriptConflict
    },
    get lastSavedAt() {
      return lastSavedAt
    },
    get chapterOutline() {
      return chapterOutline
    },
    get chapterPlanning() {
      return chapterPlanning
    },
    get lastSavedChapterOutline() {
      return lastSavedChapterOutline
    },
    get refreshWorkflow() {
      return refreshWorkflow
    },
    get loadWritingAgentTasks() {
      return loadWritingAgentTasks
    },
    get chapterCardDraft() {
      return chapterCardDraft
    },
    get chapterCardOpen() {
      return chapterCardOpen
    },
    get chapterSummaryDraft() {
      return chapterSummaryDraft
    },
    get chapterSummaryStatus() {
      return chapterSummaryStatus
    },
    get chapters() {
      return chapters
    },
    get chapterCardSaving() {
      return chapterCardSaving
    },
    get chapterLifecycleLabels() {
      return chapterLifecycleLabels
    },
    get manuscriptEditor() {
      return manuscriptEditor
    },
    get persistChapter() {
      return persistChapter
    },
    get pendingSaveReason() {
      return pendingSaveReason
    },
    set pendingSaveReason(value) {
      pendingSaveReason = value
    },
    get extractCurrentChapterFacts() {
      return extractCurrentChapterFacts
    }
  })

  const {
    newChapter,
    saveChapter,
    refreshSavedChapterInfo,
    chapterIsDirty,
    clearAutosaveTimer,
    clearAutosaveFinalizeTimer,
    writeCurrentRecoverySnapshot,
    scheduleCheckpointFinalization,
    scheduleAutosave,
    persistChapter,
    finalizeAutosaveCheckpoint,
    flushManuscriptWhenInactive,
    handleDocumentVisibilityChange
  } = createManuscriptPersistenceActions({
    get workspaceRequests() { return workspaceRequests },
    get chapterSelectionGeneration() { return chapterSelectionGeneration },
    get chapterOrderIssue() {
      return chapterOrderIssue
    },
    get notice() {
      return notice
    },
    get prepareOutlineLeave() {
      return prepareOutlineLeave
    },
    get flushPlannedChapterSave() {
      return flushPlannedChapterSave
    },
    get flushChapterSaveSafely() {
      return flushChapterSaveSafely
    },
    get guard() {
      return guard
    },
    get desktop() {
      return desktop
    },
    get chapters() {
      return chapters
    },
    get selectChapter() {
      return selectChapter
    },
    get manuscriptEditor() {
      return manuscriptEditor
    },
    get pendingSaveReason() {
      return pendingSaveReason
    },
    set pendingSaveReason(value) {
      pendingSaveReason = value
    },
    get selectedId() {
      return selectedId
    },
    get lastSavedChapter() {
      return lastSavedChapter
    },
    set lastSavedChapter(value) {
      lastSavedChapter = value
    },
    get chapterTitle() {
      return chapterTitle
    },
    get chapterContent() {
      return chapterContent
    },
    get autosaveTimer() {
      return autosaveTimer
    },
    set autosaveTimer(value) {
      autosaveTimer = value
    },
    get autosaveFinalizeTimer() {
      return autosaveFinalizeTimer
    },
    set autosaveFinalizeTimer(value) {
      autosaveFinalizeTimer = value
    },
    get current() {
      return current
    },
    get manuscriptRecoveryStore() {
      return manuscriptRecoveryStore
    },
    get suppressManuscriptAutosave() {
      return suppressManuscriptAutosave
    },
    set suppressManuscriptAutosave(value) {
      suppressManuscriptAutosave = value
    },
    get saveState() {
      return saveState
    },
    get activeAutosaveCheckpoint() {
      return activeAutosaveCheckpoint
    },
    set activeAutosaveCheckpoint(value) {
      activeAutosaveCheckpoint = value
    },
    get manuscriptSaveError() {
      return manuscriptSaveError
    },
    get pendingAiSourceTaskIds() {
      return pendingAiSourceTaskIds
    },
    get pendingCharacterSettlements() {
      return pendingCharacterSettlements
    },
    get bookProfile() {
      return bookProfile
    },
    get manuscriptSaves() {
      return manuscriptSaves
    },
    get stagedRecoverySnapshot() {
      return stagedRecoverySnapshot
    },
    set stagedRecoverySnapshot(value) {
      stagedRecoverySnapshot = value
    },
    get lastSavedAt() {
      return lastSavedAt
    },
    get refreshManuscriptRecoveries() {
      return refreshManuscriptRecoveries
    },
    get manuscriptConflict() {
      return manuscriptConflict
    },
    get refreshWorkflow() {
      return refreshWorkflow
    },
    get active() {
      return active
    }
  })

  const {
    applyManuscriptRecoveries,
    restoreManuscriptRecovery,
    discardManuscriptRecovery,
    backupDraftAndReloadExternal,
    recoverExternalMarkdownMirror,
    flushChapterSave,
    flushChapterSaveSafely
  } = createManuscriptRecoveryActions({
    get workspaceRequests() { return workspaceRequests },
    get chapterSelectionGeneration() { return chapterSelectionGeneration },
    get manuscriptRecoveryStore() {
      return manuscriptRecoveryStore
    },
    get chapters() {
      return chapters
    },
    get selectedId() {
      return selectedId
    },
    get chapterTitle() {
      return chapterTitle
    },
    get chapterContent() {
      return chapterContent
    },
    get manuscriptRecoveryItems() {
      return manuscriptRecoveryItems
    },
    get current() {
      return current
    },
    get manuscriptRecoveryBusyId() {
      return manuscriptRecoveryBusyId
    },
    get desktop() {
      return desktop
    },
    get selectChapter() {
      return selectChapter
    },
    get clearAutosaveFinalizeTimer() {
      return clearAutosaveFinalizeTimer
    },
    get activeAutosaveCheckpoint() {
      return activeAutosaveCheckpoint
    },
    set activeAutosaveCheckpoint(value) {
      activeAutosaveCheckpoint = value
    },
    get stagedRecoverySnapshot() {
      return stagedRecoverySnapshot
    },
    set stagedRecoverySnapshot(value) {
      stagedRecoverySnapshot = value
    },
    get lastSavedChapter() {
      return lastSavedChapter
    },
    set lastSavedChapter(value) {
      lastSavedChapter = value
    },
    get suppressManuscriptAutosave() {
      return suppressManuscriptAutosave
    },
    set suppressManuscriptAutosave(value) {
      suppressManuscriptAutosave = value
    },
    get saveState() {
      return saveState
    },
    get lastSavedAt() {
      return lastSavedAt
    },
    get refreshManuscriptRecoveries() {
      return refreshManuscriptRecoveries
    },
    get notice() {
      return notice
    },
    get manuscriptConflict() {
      return manuscriptConflict
    },
    get manuscriptEditor() {
      return manuscriptEditor
    },
    get manuscriptSaveError() {
      return manuscriptSaveError
    },
    get chapterIsDirty() {
      return chapterIsDirty
    },
    get writeCurrentRecoverySnapshot() {
      return writeCurrentRecoverySnapshot
    },
    get clearAutosaveTimer() {
      return clearAutosaveTimer
    },
    get chapterPlanning() {
      return chapterPlanning
    },
    get manuscriptSaves() {
      return manuscriptSaves
    },
    get persistChapter() {
      return persistChapter
    },
    get pendingSaveReason() {
      return pendingSaveReason
    },
    set pendingSaveReason(value) {
      pendingSaveReason = value
    },
    get finalizeAutosaveCheckpoint() {
      return finalizeAutosaveCheckpoint
    }
  })

  const {
    openRevisions,
    nameCurrentRevision,
    restoreRevision,
    formatRevisionTime,
    requestDeleteChapter,
    deleteChapter,
    cancelChapterDelete,
    openChapterTrash,
    restoreDeletedChapter,
    formatChapterTrashTime
  } = createManuscriptHistoryActions({
    get selectedId() {
      return selectedId
    },
    get revisions() {
      return revisions
    },
    get guard() {
      return guard
    },
    get desktop() {
      return desktop
    },
    get selectedRevisionId() {
      return selectedRevisionId
    },
    get revisionViewMode() {
      return revisionViewMode
    },
    get revisionLabelDraft() {
      return revisionLabelDraft
    },
    get showRevisions() {
      return showRevisions
    },
    get flushChapterSaveSafely() {
      return flushChapterSaveSafely
    },
    get chapterOrderIssue() {
      return chapterOrderIssue
    },
    get notice() {
      return notice
    },
    get selectedRevision() {
      return selectedRevision
    },
    get chapters() {
      return chapters
    },
    get selectChapter() {
      return selectChapter
    },
    get selectedChapterRecord() {
      return selectedChapterRecord
    },
    get chapterDeleteTarget() {
      return chapterDeleteTarget
    },
    get showDeleteConfirm() {
      return showDeleteConfirm
    },
    get flushChapterSave() {
      return flushChapterSave
    },
    get clearAutosaveTimer() {
      return clearAutosaveTimer
    },
    get chapterTrashEntries() {
      return chapterTrashEntries
    },
    get lastSavedChapter() {
      return lastSavedChapter
    },
    set lastSavedChapter(value) {
      lastSavedChapter = value
    },
    get chapterTrashOpen() {
      return chapterTrashOpen
    }
  })

  const { commitWritingAgentApplication } = createAssistantApplicationActions({
    get selectedId() {
      return selectedId
    },
    get lastSavedChapter() {
      return lastSavedChapter
    },
    set lastSavedChapter(value) {
      lastSavedChapter = value
    },
    get notice() {
      return notice
    },
    get clearAutosaveTimer() {
      return clearAutosaveTimer
    },
    get current() {
      return current
    },
    get chapterTitle() {
      return chapterTitle
    },
    get writeCurrentRecoverySnapshot() {
      return writeCurrentRecoverySnapshot
    },
    get saveState() {
      return saveState
    },
    get manuscriptSaves() {
      return manuscriptSaves
    },
    get desktop() {
      return desktop
    },
    get syncWritingAgentTask() {
      return syncWritingAgentTask
    },
    get chapters() {
      return chapters
    },
    get clearAutosaveFinalizeTimer() {
      return clearAutosaveFinalizeTimer
    },
    get activeAutosaveCheckpoint() {
      return activeAutosaveCheckpoint
    },
    set activeAutosaveCheckpoint(value) {
      activeAutosaveCheckpoint = value
    },
    get lastSavedAt() {
      return lastSavedAt
    },
    get manuscriptSaveError() {
      return manuscriptSaveError
    },
    get manuscriptConflict() {
      return manuscriptConflict
    },
    get chapterContent() {
      return chapterContent
    },
    get pendingSaveReason() {
      return pendingSaveReason
    },
    set pendingSaveReason(value) {
      pendingSaveReason = value
    },
    get manuscriptRecoveryStore() {
      return manuscriptRecoveryStore
    },
    get scheduleAutosave() {
      return scheduleAutosave
    },
    get pendingAiSourceTaskIds() {
      return pendingAiSourceTaskIds
    },
    get pendingCharacterSettlements() {
      return pendingCharacterSettlements
    },
    get writingAgentTurns() {
      return writingAgentTurns
    },
    get manuscriptSelection() {
      return manuscriptSelection
    },
    get manuscriptInsertionAnchor() {
      return manuscriptInsertionAnchor
    },
    get refreshWorkflow() {
      return refreshWorkflow
    }
  })

  const {
    syncWritingAgentTask,
    loadWritingAgentTasks,
    updateManuscriptSelection,
    updateManuscriptAnchor,
    openWritingAgentQuickAction,
    openManuscriptSelectionAiMenu,
    markManuscriptAsManualEdit,
    announceManuscriptHistory,
    previewWritingAgentContext,
    runWritingAgent,
    pollWritingAgentTask,
    cancelWritingAgentTask,
    pauseWritingAgentTask,
    resumeWritingAgentTask,
    retryWritingAgentTask,
    dismissWritingAgentTask,
    loadTaskCenter,
    openTaskCenterItem,
    handleTaskCenterAction
  } = createAssistantTasksActions({
    get writingAgentTasks() {
      return writingAgentTasks
    },
    get writingAgentTurns() {
      return writingAgentTurns
    },
    get desktop() {
      return desktop
    },
    get workspaceRequests() {
      return workspaceRequests
    },
    get current() {
      return current
    },
    get chapterSelectionGeneration() {
      return chapterSelectionGeneration
    },
    set chapterSelectionGeneration(value) {
      chapterSelectionGeneration = value
    },
    get selectedId() {
      return selectedId
    },
    get writingAgentRunning() {
      return writingAgentRunning
    },
    get manuscriptSelection() {
      return manuscriptSelection
    },
    get manuscriptInsertionAnchor() {
      return manuscriptInsertionAnchor
    },
    get assistantMode() {
      return assistantMode
    },
    get writingAgentQuickAction() {
      return writingAgentQuickAction
    },
    get assistantOpen() {
      return assistantOpen
    },
    get pendingSaveReason() {
      return pendingSaveReason
    },
    set pendingSaveReason(value) {
      pendingSaveReason = value
    },
    get pendingAiSourceTaskIds() {
      return pendingAiSourceTaskIds
    },
    get pendingCharacterSettlements() {
      return pendingCharacterSettlements
    },
    get notice() {
      return notice
    },
    get writingAgentContextPreviewRequest() {
      return writingAgentContextPreviewRequest
    },
    set writingAgentContextPreviewRequest(value) {
      writingAgentContextPreviewRequest = value
    },
    get writingAgentContextPreviewBusy() {
      return writingAgentContextPreviewBusy
    },
    get manuscriptEditor() {
      return manuscriptEditor
    },
    get chapterContent() {
      return chapterContent
    },
    get writingAgentContextPreview() {
      return writingAgentContextPreview
    },
    get activeWritingAgentTask() {
      return activeWritingAgentTask
    },
    get taskCenterLoading() {
      return taskCenterLoading
    },
    get taskCenterItems() {
      return taskCenterItems
    },
    get selectWorkspaceLeaf() {
      return selectWorkspaceLeaf
    },
    get selectWorkspaceParent() {
      return selectWorkspaceParent
    },
    get selectActivity() {
      return selectActivity
    },
    get active() {
      return active
    },
    get chapters() {
      return chapters
    },
    get selectChapter() {
      return selectChapter
    },
    get taskCenterBusyId() {
      return taskCenterBusyId
    },
    get refreshIdeaGenerations() {
      return refreshIdeaGenerations
    },
    get expansionOpen() {
      return expansionOpen
    },
    get refreshOutlineExpansions() {
      return refreshOutlineExpansions
    }
  })

  const {
    discardWritingAgentPartial,
    applyWritingAgentPartial,
    discardWritingAgentTurn,
    openChapterCardAdoption,
    confirmChapterCardAdoption,
    applyWritingAgentTurn,
    confirmWritingRebase
  } = createAssistantAdoptionActions({
    get writingAgentTasks() {
      return writingAgentTasks
    },
    get syncWritingAgentTask() {
      return syncWritingAgentTask
    },
    get desktop() {
      return desktop
    },
    get notice() {
      return notice
    },
    get current() {
      return current
    },
    get selectedId() {
      return selectedId
    },
    get chapterContent() {
      return chapterContent
    },
    get commitWritingAgentApplication() {
      return commitWritingAgentApplication
    },
    get writingAgentTurns() {
      return writingAgentTurns
    },
    get chapterPlanning() {
      return chapterPlanning
    },
    get chapterCardAdoption() {
      return chapterCardAdoption
    },
    get chapterCardSaving() {
      return chapterCardSaving
    },
    get chapterCardAdoptionFields() {
      return chapterCardAdoptionFields
    },
    get openChapterCard() {
      return openChapterCard
    },
    get writingAgentApplyingTurnId() {
      return writingAgentApplyingTurnId
    },
    get manuscriptSelection() {
      return manuscriptSelection
    },
    get manuscriptInsertionAnchor() {
      return manuscriptInsertionAnchor
    },
    get flushChapterSaveSafely() {
      return flushChapterSaveSafely
    },
    get chapterTitle() {
      return chapterTitle
    },
    get lastSavedChapter() {
      return lastSavedChapter
    },
    set lastSavedChapter(value) {
      lastSavedChapter = value
    },
    get writingRebase() {
      return writingRebase
    },
    get writingRebaseBusy() {
      return writingRebaseBusy
    }
  })

  const {
    invalidateOutlineRead,
    outlineDraftSnapshot,
    resolveOutlineLeaveChoice,
    prepareOutlineLeave,
    runOutlineNavigation,
    openPlanningVolumeCreator,
    submitPlanningVolume,
    createPlanningChapter,
    insertOutlineTemplate,
    saveOutline,
    openVolumeOutline,
    refreshStageOutlines,
    openStageOutline,
    createOutlineStage,
    saveStageOutline,
    saveVolumeOutline,
    acknowledgePlanningReview,
    confirmPlanningOutline,
    saveChapterOutline,
    acceptRecoveredChapterOutline,
    confirmChapterOutline,
    setChapterPlacement,
    setChapterStage,
    chapterPosition,
    reorderSelectedChapter,
    eventVolume,
    eventPlacementValue,
    eventPlacementLabel,
    setEventPlacement,
    createOutlineVolume,
    renameOutlineVolume,
    generateChapterOutline
  } = createPlanningOutlinesActions({
    get manuscriptEditor() {
      return manuscriptEditor
    },
    get outlineNavigationGeneration() {
      return outlineNavigationGeneration
    },
    set outlineNavigationGeneration(value) {
      outlineNavigationGeneration = value
    },
    get outlineLoading() {
      return outlineLoading
    },
    get current() {
      return current
    },
    get active() {
      return active
    },
    get outlineMode() {
      return outlineMode
    },
    get selectedVolume() {
      return selectedVolume
    },
    get selectedStage() {
      return selectedStage
    },
    get selectedId() {
      return selectedId
    },
    get chapterTitle() {
      return chapterTitle
    },
    get chapterContent() {
      return chapterContent
    },
    get totalOutline() {
      return totalOutline
    },
    get volumeOutline() {
      return volumeOutline
    },
    get stageTitle() {
      return stageTitle
    },
    get stageOutline() {
      return stageOutline
    },
    get chapterOutline() {
      return chapterOutline
    },
    get plannedChapter() {
      return plannedChapter
    },
    get plannedChapterTitle() {
      return plannedChapterTitle
    },
    get plannedChapterContent() {
      return plannedChapterContent
    },
    get outlineLeaveDialog() {
      return outlineLeaveDialog
    },
    get resolveOutlineLeave() {
      return resolveOutlineLeave
    },
    set resolveOutlineLeave(value) {
      resolveOutlineLeave = value
    },
    get outlineComposing() {
      return outlineComposing
    },
    get notice() {
      return notice
    },
    get busy() {
      return busy
    },
    get planningOutlineDirty() {
      return planningOutlineDirty
    },
    get chapterOutlineDirty() {
      return chapterOutlineDirty
    },
    get outlineLeavePending() {
      return outlineLeavePending
    },
    get lastSavedTotalOutline() {
      return lastSavedTotalOutline
    },
    get lastSavedVolumeOutline() {
      return lastSavedVolumeOutline
    },
    get lastSavedStageOutline() {
      return lastSavedStageOutline
    },
    get lastSavedStageTitle() {
      return lastSavedStageTitle
    },
    get lastSavedChapterOutline() {
      return lastSavedChapterOutline
    },
    get workspaceRequests() {
      return workspaceRequests
    },
    get retryOutlineOpen() {
      return retryOutlineOpen
    },
    set retryOutlineOpen(value) {
      retryOutlineOpen = value
    },
    get outlineOpenError() {
      return outlineOpenError
    },
    get worldMapWorkspace() {
      return worldMapWorkspace
    },
    get modelSettingsDirty() {
      return modelSettingsDirty
    },
    get flushPlannedChapterSave() {
      return flushPlannedChapterSave
    },
    get flushChapterSaveSafely() {
      return flushChapterSaveSafely
    },
    get timelineMode() {
      return timelineMode
    },
    get editorFocusMode() {
      return editorFocusMode
    },
    get outlineStorageFeedback() {
      return outlineStorageFeedback
    },
    get volumeDraft() {
      return volumeDraft
    },
    get outlineVolumeDialog() {
      return outlineVolumeDialog
    },
    get newChapter() {
      return newChapter
    },
    get openChapterFromOutlineCatalog() {
      return openChapterFromOutlineCatalog
    },
    get chapters() {
      return chapters
    },
    get outlineEditor() {
      return outlineEditor
    },
    get guard() {
      return guard
    },
    get desktop() {
      return desktop
    },
    get refreshWorkflow() {
      return refreshWorkflow
    },
    get selectWorkspaceLeaf() {
      return selectWorkspaceLeaf
    },
    get stageOutlines() {
      return stageOutlines
    },
    get stageDraftTitle() {
      return stageDraftTitle
    },
    get planningOutlineReview() {
      return planningOutlineReview
    },
    get outlinePlanning() {
      return outlinePlanning
    },
    get planningOutlineApproval() {
      return planningOutlineApproval
    },
    get chapterOrderIssue() {
      return chapterOrderIssue
    },
    get selectedChapterStage() {
      return selectedChapterStage
    },
    get selectedChapterVolume() {
      return selectedChapterVolume
    },
    get selectedChapterPosition() {
      return selectedChapterPosition
    },
    get flushChapterSave() {
      return flushChapterSave
    }
  })

  const {
    timelineEntryId,
    isTimelineEntryOpen,
    toggleTimelineEntry,
    addTimeline,
    updateChronicleField,
    removeTimelineEvent,
    moveTimelineEvent,
    generateTimelineCandidates,
    adoptTimelineCandidate,
    discardTimelineCandidate,
    reviewCanonicalEvents,
    saveTimeline,
    createEventCandidate,
    approveCanonicalEvent,
    archiveTimelineEvent,
    restoreTimelineEvent,
    recoverEventOperation
  } = createTimelineEditingActions({
    get expandedTimelineEntry() {
      return expandedTimelineEntry
    },
    get timeline() {
      return timeline
    },
    get eventProjection() {
      return eventProjection
    },
    get unifiedEvents() {
      return unifiedEvents
    },
    get archivedUnifiedEvents() {
      return archivedUnifiedEvents
    },
    get unifiedEventCandidates() {
      return unifiedEventCandidates
    },
    get unifiedEventMode() {
      return unifiedEventMode
    },
    get timelineAiCandidates() {
      return timelineAiCandidates
    },
    get timelineAiGenerating() {
      return timelineAiGenerating
    },
    get approvedEvents() {
      return approvedEvents
    },
    get current() {
      return current
    },
    get bookProfile() {
      return bookProfile
    },
    get foundation() {
      return foundation
    },
    get totalOutline() {
      return totalOutline
    },
    get guard() {
      return guard
    },
    get desktop() {
      return desktop
    },
    get notice() {
      return notice
    },
    get active() {
      return active
    },
    get materialSection() {
      return materialSection
    },
    get busy() {
      return busy
    },
    get workspaceRequests() {
      return workspaceRequests
    },
    get plainDto() {
      return plainDto
    },
    get refreshWorkflow() {
      return refreshWorkflow
    },
    get eventDraft() {
      return eventDraft
    },
    get canonicalEvents() {
      return canonicalEvents
    }
  })

  const {
    addRealm,
    saveRealms,
    saveSystemTemplate,
    saveFoundation,
    saveBookProfile,
    saveWritingPreferences,
    generateFoundationDraft
  } = createWorldbuildingFoundationActions({
    get realms() {
      return realms
    },
    get guard() {
      return guard
    },
    get desktop() {
      return desktop
    },
    get plainDto() {
      return plainDto
    },
    get powerSystem() {
      return powerSystem
    },
    get foundation() {
      return foundation
    },
    get refreshWorkflow() {
      return refreshWorkflow
    },
    get cheatSystem() {
      return cheatSystem
    },
    get systemTemplate() {
      return systemTemplate
    },
    get profileSaveProgress() {
      return profileSaveProgress
    },
    get current() {
      return current
    },
    get bookProfile() {
      return bookProfile
    },
    get profileSavedSnapshot() {
      return profileSavedSnapshot
    },
    get profileSavedAt() {
      return profileSavedAt
    },
    get refreshProjects() {
      return refreshProjects
    },
    get promptProfile() {
      return promptProfile
    },
    get syncPromptDraft() {
      return syncPromptDraft
    },
    get foundationDraft() {
      return foundationDraft
    }
  })

  const { saveContextBudgetPreferences, updateContextEvidencePreference, resetContextEvidencePreferences } =
    createAssistantContextActions({
      get contextBudgetPreferences() {
        return contextBudgetPreferences
      },
      get guard() {
        return guard
      },
      get desktop() {
        return desktop
      },
      get plainDto() {
        return plainDto
      },
      get contextFactPackKey() {
        return contextFactPackKey
      },
      set contextFactPackKey(value) {
        contextFactPackKey = value
      },
      get refreshWorkflow() {
        return refreshWorkflow
      }
    })

  const {
    loadCharacterAliases,
    editCharacterAliases,
    saveCharacterAliases,
    loadStoryEntities,
    editStoryEntity,
    saveStoryEntity,
    saveStoryEntityRelation,
    appendResourceLedgerEntry
  } = createCharactersEntitiesActions({
    get current() {
      return current
    },
    get desktop() {
      return desktop
    },
    get characterAliases() {
      return characterAliases
    },
    get characterAliasesLoaded() {
      return characterAliasesLoaded
    },
    get characterAliasDraft() {
      return characterAliasDraft
    },
    get notice() {
      return notice
    },
    get guard() {
      return guard
    },
    get storyEntities() {
      return storyEntities
    },
    get storyEntityRelations() {
      return storyEntityRelations
    },
    get resourceLedger() {
      return resourceLedger
    },
    get resourceLedgerDraft() {
      return resourceLedgerDraft
    },
    get storyEntitiesLoaded() {
      return storyEntitiesLoaded
    },
    get storyEntityDraft() {
      return storyEntityDraft
    },
    get refreshWorkflow() {
      return refreshWorkflow
    },
    get storyRelationDraft() {
      return storyRelationDraft
    },
    get plainDto() {
      return plainDto
    }
  })

  const { handleBookGenreChange, syncPromptDraft, selectPromptTask, savePromptOverride, resetPromptOverride } =
    createAssistantPromptsActions({
      get bookProfile() {
        return bookProfile
      },
      get bookSubgenreOptions() {
        return bookSubgenreOptions
      },
      get promptDraft() {
        return promptDraft
      },
      get promptProfile() {
        return promptProfile
      },
      get selectedPromptTask() {
        return selectedPromptTask
      },
      get promptDraftDirty() {
        return promptDraftDirty
      },
      get notice() {
        return notice
      },
      get guard() {
        return guard
      },
      get desktop() {
        return desktop
      },
      get plainDto() {
        return plainDto
      },
      get selectedPromptEntry() {
        return selectedPromptEntry
      },
      get sqliteStorageStatus() {
        return sqliteStorageStatus
      }
    })

  const {
    clearPlanningPoll,
    startAutomaticPlanning,
    handleTotalOutlineAi,
    pollAutomaticPlanning,
    cancelAutomaticPlanning,
    discardPlanningProposal,
    recoverDamagedPlanningDraft,
    recoverDamagedPromptProfile,
    clearPlanningDraftSave,
    schedulePlanningDraftSave,
    persistPlanningDraft,
    flushPlanningDraftSave,
    markPlanningTotalEdited,
    markPlanningVolumeStructureEdited,
    markPlanningVolumeOutlineEdited,
    invalidatePlanningOutlinesFromFoundation,
    markPlanningSkeletonUpstreamChanged,
    markPlanningDetailsStale,
    markPlanningSkeletonEdited,
    updateSkeletonCharacters,
    markPlanningChapterDetailEdited,
    updatePlanningChapterDetailList,
    clearPlanningSkeletonPoll,
    startPlanningChapterSkeleton,
    pollPlanningChapterSkeleton,
    cancelPlanningChapterSkeleton,
    clearPlanningDetailPoll,
    startPlanningChapterDetail,
    pollPlanningChapterDetail,
    cancelPlanningChapterDetail,
    openPlanningChapterDetailAdoption,
    confirmPlanningChapterDetailAdoption,
    refreshJointChapterAdoption,
    markPlanningCharacterSeedsEdited,
    markPlanningWorldSeedEdited,
    markPlanningPowerSystemEdited,
    markPlanningCheatSystemEdited
  } = createPlanningGenerationActions({
    get current() { return current },
    get workspaceRequests() { return workspaceRequests },
    get selectWorkspaceLeaf() { return selectWorkspaceLeaf },
    get workspaceRefreshGeneration() { return workspaceRefreshGeneration },
    get planningPollTimer() {
      return planningPollTimer
    },
    set planningPollTimer(value) {
      planningPollTimer = value
    },
    get planningMaterialsReady() {
      return planningMaterialsReady
    },
    get notice() {
      return notice
    },
    get ai() {
      return ai
    },
    get desktop() {
      return desktop
    },
    get plainDto() {
      return plainDto
    },
    get bookProfile() {
      return bookProfile
    },
    get planningJob() {
      return planningJob
    },
    get guard() {
      return guard
    },
    get planningRunning() {
      return planningRunning
    },
    get planningDraft() {
      return planningDraft
    },
    get active() {
      return active
    },
    get preparationMode() {
      return preparationMode
    },
    get planningDraftSaveState() {
      return planningDraftSaveState
    },
    get planningAdoptionPreview() {
      return planningAdoptionPreview
    },
    get planningVolumeStructurePreview() {
      return planningVolumeStructurePreview
    },
    get planningVolumeOutlinePreview() {
      return planningVolumeOutlinePreview
    },
    get planningCharacterSeedPreview() {
      return planningCharacterSeedPreview
    },
    get planningWorldSeedPreview() {
      return planningWorldSeedPreview
    },
    get planningPowerSystemPreview() {
      return planningPowerSystemPreview
    },
    get planningCheatSystemPreview() {
      return planningCheatSystemPreview
    },
    get workspaceBootstrapIssues() {
      return workspaceBootstrapIssues
    },
    get busy() {
      return busy
    },
    get promptProfile() {
      return promptProfile
    },
    get planningDraftSaveTimer() {
      return planningDraftSaveTimer
    },
    set planningDraftSaveTimer(value) {
      planningDraftSaveTimer = value
    },
    get planningDraftEditVersion() {
      return planningDraftEditVersion
    },
    set planningDraftEditVersion(value) {
      planningDraftEditVersion = value
    },
    get planningDraftSaveError() {
      return planningDraftSaveError
    },
    set planningDraftSaveError(value) {
      planningDraftSaveError = value
    },
    get planningDraftSaveQueue() {
      return planningDraftSaveQueue
    },
    set planningDraftSaveQueue(value) {
      planningDraftSaveQueue = value
    },
    get planningSkeletonStatus() {
      return planningSkeletonStatus
    },
    get planningDetailStatuses() {
      return planningDetailStatuses
    },
    get planningSkeletonPollTimer() {
      return planningSkeletonPollTimer
    },
    set planningSkeletonPollTimer(value) {
      planningSkeletonPollTimer = value
    },
    get planningSkeletonRunning() {
      return planningSkeletonRunning
    },
    get planningSkeletonJob() {
      return planningSkeletonJob
    },
    get suppressNextPlanningDraftSave() {
      return suppressNextPlanningDraftSave
    },
    set suppressNextPlanningDraftSave(value) {
      suppressNextPlanningDraftSave = value
    },
    get planningDetailPollTimer() {
      return planningDetailPollTimer
    },
    set planningDetailPollTimer(value) {
      planningDetailPollTimer = value
    },
    get planningDetailRunning() {
      return planningDetailRunning
    },
    get planningDetailJob() {
      return planningDetailJob
    },
    get planningAdoptionBusy() {
      return planningAdoptionBusy
    },
    get planningChapterDetailPreview() {
      return planningChapterDetailPreview
    },
    get outlinePlanning() {
      return outlinePlanning
    },
    get selectedId() {
      return selectedId
    },
    get chapterOutline() {
      return chapterOutline
    },
    get lastSavedChapterOutline() {
      return lastSavedChapterOutline
    }
  })

  const {
    applyPlanningAdoption,
    openPlanningCharacterSeedAdoption,
    confirmPlanningCharacterSeedAdoption,
    openPlanningWorldSeedAdoption,
    confirmPlanningWorldSeedAdoption,
    openPlanningPowerSystemAdoption,
    confirmPlanningPowerSystemAdoption,
    openPlanningCheatSystemAdoption,
    confirmPlanningCheatSystemAdoption,
    openPlanningVolumeOutlineAdoption,
    confirmPlanningVolumeOutlineAdoption,
    openVolumeOutlineReview,
    openPlanningVolumeStructure,
    confirmPlanningVolumeStructure,
    openTotalOutlineReview,
    openPlanningTotalAdoption,
    confirmPlanningTotalAdoption
  } = createPlanningAdoptionActions({
    get suppressNextPlanningDraftSave() {
      return suppressNextPlanningDraftSave
    },
    set suppressNextPlanningDraftSave(value) {
      suppressNextPlanningDraftSave = value
    },
    get planningDraft() {
      return planningDraft
    },
    get planningAdoptionBusy() {
      return planningAdoptionBusy
    },
    get flushPlanningDraftSave() {
      return flushPlanningDraftSave
    },
    get planningCharacterSeedPreview() {
      return planningCharacterSeedPreview
    },
    get desktop() {
      return desktop
    },
    get notice() {
      return notice
    },
    get plainDto() {
      return plainDto
    },
    get planningDraftSaveState() {
      return planningDraftSaveState
    },
    get characterState() {
      return characterState
    },
    get refreshWorkflow() {
      return refreshWorkflow
    },
    get planningWorldSeedPreview() {
      return planningWorldSeedPreview
    },
    get foundation() {
      return foundation
    },
    get planningPowerSystemPreview() {
      return planningPowerSystemPreview
    },
    get powerSystem() {
      return powerSystem
    },
    get planningCheatSystemPreview() {
      return planningCheatSystemPreview
    },
    get cheatSystem() {
      return cheatSystem
    },
    get planningVolumeOutlinePreview() {
      return planningVolumeOutlinePreview
    },
    get outlinePlanning() {
      return outlinePlanning
    },
    get openVolumeOutline() {
      return openVolumeOutline
    },
    get outlineInspectorOpen() {
      return outlineInspectorOpen
    },
    get planningVolumeStructurePreview() {
      return planningVolumeStructurePreview
    },
    get openTotalOutline() {
      return openTotalOutline
    },
    get planningAdoptionPreview() {
      return planningAdoptionPreview
    },
    get totalOutline() {
      return totalOutline
    },
    get lastSavedTotalOutline() {
      return lastSavedTotalOutline
    }
  })

  const {
    applyFoundationDraft,
    saveResearchSettings,
    runResearch,
    addResearchToMaterials,
    resetSourceDraft,
    resetIdeaDraft,
    canLeaveSourceDraft,
    chooseMaterialSection,
    openSourceCard,
    startSourceCard,
    saveSourceCard,
    beginEventCandidate,
    sourceOriginLabel
  } = createWorldbuildingMaterialsActions({
    get foundationDraft() {
      return foundationDraft
    },
    get foundation() {
      return foundation
    },
    get realms() {
      return realms
    },
    get systemTemplate() {
      return systemTemplate
    },
    get active() {
      return active
    },
    get notice() {
      return notice
    },
    get guard() {
      return guard
    },
    get desktop() {
      return desktop
    },
    get researchSettings() {
      return researchSettings
    },
    get researchResult() {
      return researchResult
    },
    get researchQuery() {
      return researchQuery
    },
    get plainDto() {
      return plainDto
    },
    get sourceCards() {
      return sourceCards
    },
    get refreshWorkflow() {
      return refreshWorkflow
    },
    get sourceDraft() {
      return sourceDraft
    },
    get ideaGenerationSource() {
      return ideaGenerationSource
    },
    get ideaSourceLoad() {
      return ideaSourceLoad
    },
    set ideaSourceLoad(value) {
      ideaSourceLoad = value
    },
    get ideaSourceTask() {
      return ideaSourceTask
    },
    get ideaSourceIssue() {
      return ideaSourceIssue
    },
    get ideaDraft() {
      return ideaDraft
    },
    get sourceDraftDirty() {
      return sourceDraftDirty
    },
    get materialSection() {
      return materialSection
    },
    get canLeaveIdeaDraft() {
      return canLeaveIdeaDraft
    },
    get materialSearch() {
      return materialSearch
    },
    get selectedSourceId() {
      return selectedSourceId
    },
    get creatingSource() {
      return creatingSource
    },
    get selectedSource() {
      return selectedSource
    },
    get eventDraft() {
      return eventDraft
    }
  })

  const {
    resetPlannedChapter,
    refreshStandaloneOutlineCatalog,
    openPlannedChapter,
    flushPlannedChapterSave,
    startPlannedChapter,
    reloadPlannedChapter,
    openTotalOutline,
    loadPlannedOutlineRecovery,
    refreshOutlineRecoveryShelf,
    openOutlineRecoveryShelf,
    openShelfOutline,
    discardShelfRecovery,
    restorePlannedOutlineRecovery,
    discardPlannedOutlineRecovery
  } = createPlanningChapterOutlineActions({
    get outlineEditor() { return outlineEditor },
    get outlineRecoveryDrafts() {
      return outlineRecoveryDrafts
    },
    get outlineRecoveryShelfError() {
      return outlineRecoveryShelfError
    },
    get plannedOutlineRecovery() {
      return plannedOutlineRecovery
    },
    get plannedOutlineRecoveryError() {
      return plannedOutlineRecoveryError
    },
    get outlineMode() {
      return outlineMode
    },
    get plannedChapterGeneration() {
      return plannedChapterGeneration
    },
    set plannedChapterGeneration(value) {
      plannedChapterGeneration = value
    },
    get standaloneOutlineEntries() {
      return standaloneOutlineEntries
    },
    get plannedChapter() {
      return plannedChapter
    },
    get plannedChapterTitle() {
      return plannedChapterTitle
    },
    get plannedChapterContent() {
      return plannedChapterContent
    },
    get plannedChapterError() {
      return plannedChapterError
    },
    get plannedChapterBusy() {
      return plannedChapterBusy
    },
    get plannedChapterStarting() {
      return plannedChapterStarting
    },
    get plannedChapterComposing() {
      return plannedChapterComposing
    },
    get current() {
      return current
    },
    get workspaceRequests() {
      return workspaceRequests
    },
    get desktop() {
      return desktop
    },
    get stageOutlines() {
      return stageOutlines
    },
    get active() {
      return active
    },
    get invalidateOutlineRead() {
      return invalidateOutlineRead
    },
    get runOutlineNavigation() {
      return runOutlineNavigation
    },
    get outlineInspectorOpen() {
      return outlineInspectorOpen
    },
    get worldMapWorkspace() {
      return worldMapWorkspace
    },
    get notice() {
      return notice
    },
    get plannedChapterDirty() {
      return plannedChapterDirty
    },
    get plannedOutlineRecoveryStore() {
      return plannedOutlineRecoveryStore
    },
    get flushChapterSaveSafely() {
      return flushChapterSaveSafely
    },
    get chapters() {
      return chapters
    },
    get selectChapter() {
      return selectChapter
    }
  })

  const {
    closeOutlineExpansion,
    openOutlineExpansion,
    refreshOutlineExpansions,
    runOutlineExpansion,
    retryOutlineExpansion,
    previewOutlineExpansionAdoption,
    reloadOutlineExpansionView,
    adoptOutlineExpansion
  } = createPlanningExpansionActions({
    get expansionGeneration() {
      return expansionGeneration
    },
    set expansionGeneration(value) {
      expansionGeneration = value
    },
    get expansionTimer() {
      return expansionTimer
    },
    set expansionTimer(value) {
      expansionTimer = value
    },
    get expansionOpen() {
      return expansionOpen
    },
    get expansionSource() {
      return expansionSource
    },
    get expansionTasks() {
      return expansionTasks
    },
    get expansionLoading() {
      return expansionLoading
    },
    get expansionBusy() {
      return expansionBusy
    },
    get expansionError() {
      return expansionError
    },
    get expansionPreview() {
      return expansionPreview
    },
    get expansionNotice() {
      return expansionNotice
    },
    get planningOutlineDirty() {
      return planningOutlineDirty
    },
    get notice() {
      return notice
    },
    get expansionParentKey() {
      return expansionParentKey
    },
    get outlineInspectorOpen() {
      return outlineInspectorOpen
    },
    get current() {
      return current
    },
    get workspaceRequests() {
      return workspaceRequests
    },
    get desktop() {
      return desktop
    },
    get refreshStandaloneOutlineCatalog() {
      return refreshStandaloneOutlineCatalog
    },
    get stageOutlines() {
      return stageOutlines
    },
    get refreshWorkflow() {
      return refreshWorkflow
    }
  })

  const {
    canLeaveIdeaDraft,
    openIdea,
    loadIdeaSource,
    clearIdeaGenerationPoll,
    refreshIdeaGenerations,
    startIdeaGeneration,
    stopIdeaGeneration,
    retryIdeaGeneration,
    editIdeaGenerationOption,
    startIdea,
    saveIdea,
    promoteIdeaToWorldRule,
    promoteIdeaToSummary
  } = createPlanningIdeasActions({
    get ideaDraftDirty() {
      return ideaDraftDirty
    },
    get selectedIdeaId() {
      return selectedIdeaId
    },
    get ideaGenerationSource() {
      return ideaGenerationSource
    },
    get creatingIdea() {
      return creatingIdea
    },
    get ideaDraft() {
      return ideaDraft
    },
    get ideaSourceLoad() {
      return ideaSourceLoad
    },
    set ideaSourceLoad(value) {
      ideaSourceLoad = value
    },
    get ideaSourceTask() {
      return ideaSourceTask
    },
    get ideaSourceIssue() {
      return ideaSourceIssue
    },
    get current() {
      return current
    },
    get workspaceRequests() {
      return workspaceRequests
    },
    get desktop() {
      return desktop
    },
    get ideaGenerationTimer() {
      return ideaGenerationTimer
    },
    set ideaGenerationTimer(value) {
      ideaGenerationTimer = value
    },
    get ideaGenerationLoad() {
      return ideaGenerationLoad
    },
    set ideaGenerationLoad(value) {
      ideaGenerationLoad = value
    },
    get ideaGenerations() {
      return ideaGenerations
    },
    get ideaGenerationRunning() {
      return ideaGenerationRunning
    },
    get notice() {
      return notice
    },
    get selectedIdea() {
      return selectedIdea
    },
    get guard() {
      return guard
    },
    get ideaGenerationInstruction() {
      return ideaGenerationInstruction
    },
    get resetIdeaDraft() {
      return resetIdeaDraft
    },
    get plainDto() {
      return plainDto
    },
    get ideas() {
      return ideas
    },
    get refreshWorkflow() {
      return refreshWorkflow
    },
    get storyEntitiesLoaded() {
      return storyEntitiesLoaded
    },
    get totalOutline() {
      return totalOutline
    },
    get lastSavedTotalOutline() {
      return lastSavedTotalOutline
    },
    get sqliteStorageStatus() {
      return sqliteStorageStatus
    }
  })

  const {
    refreshLocalModels,
    useLocalModel,
    saveAi,
    addAiConnection,
    requestRemoveAiConnection,
    confirmRemoveAiConnection,
    requestClearAiCredential,
    confirmClearAiCredential,
    connectionName,
    connectionDraft,
    refreshAiModelCatalog,
    selectProfileModel,
    testAi
  } = createModelsConnectionsActions({
    get desktop() {
      return desktop
    },
    get ai() {
      return ai
    },
    get localModelViews() {
      return localModelViews
    },
    get guard() {
      return guard
    },
    get plainDto() {
      return plainDto
    },
    get removedAiConnectionIds() {
      return removedAiConnectionIds
    },
    get notice() {
      return notice
    },
    get taskLabels() {
      return taskLabels
    },
    get aiConnectionDeletePreview() {
      return aiConnectionDeletePreview
    },
    get availableModelsByConnection() {
      return availableModelsByConnection
    },
    get aiModelChecks() {
      return aiModelChecks
    },
    get aiConnectionResult() {
      return aiConnectionResult
    },
    get aiCredentialClearPreview() {
      return aiCredentialClearPreview
    },
    get invalidateAiConnectionValidation() {
      return invalidateAiConnectionValidation
    },
    get aiCatalogLoading() {
      return aiCatalogLoading
    },
    get current() {
      return current
    },
    get connectionCanTest() {
      return connectionCanTest
    },
    get aiCatalogRefreshGeneration() {
      return aiCatalogRefreshGeneration
    },
    set aiCatalogRefreshGeneration(value) {
      aiCatalogRefreshGeneration = value
    },
    get aiCatalogUnavailableConnectionIds() {
      return aiCatalogUnavailableConnectionIds
    },
    get invalidateAiRoutingValidation() {
      return invalidateAiRoutingValidation
    },
    get aiTesting() {
      return aiTesting
    }
  })

  const {
    migrateProject,
    openSqliteShadowMigration,
    closeSqliteShadowMigration,
    confirmSqliteShadowMigration,
    openSqliteActivation,
    closeSqliteActivation,
    confirmSqliteActivation,
    retrySqliteMirrors,
    rebuildReadableMirrors,
    rollbackSqliteStorage,
    createWorkspaceBackup,
    exportSelectedChapters,
    exportManuscript
  } = createLibraryStorageActions({
    get current() { return current },
    get workspaceRequests() { return workspaceRequests },
    get migrationPreview() {
      return migrationPreview
    },
    get flushChapterSave() {
      return flushChapterSave
    },
    get guard() {
      return guard
    },
    get desktop() {
      return desktop
    },
    get sqliteShadowResult() {
      return sqliteShadowResult
    },
    get sqliteShadowPreview() {
      return sqliteShadowPreview
    },
    get sqliteStorageStatus() {
      return sqliteStorageStatus
    },
    get sqliteActivationResult() {
      return sqliteActivationResult
    },
    get sqliteActivationPreview() {
      return sqliteActivationPreview
    },
    get loadWorkspace() {
      return loadWorkspace
    },
    get notice() {
      return notice
    },
    get workspaceBackupResult() {
      return workspaceBackupResult
    }
  })

  const {
    startConsistencyEvaluation,
    scheduleConsistencyEvaluationPoll,
    pollConsistencyEvaluation,
    cancelConsistencyEvaluation,
    evaluationTime
  } = createReviewEvaluationActions({
    get consistencyEvaluationJob() {
      return consistencyEvaluationJob
    },
    get ai() {
      return ai
    },
    get notice() {
      return notice
    },
    get guard() {
      return guard
    },
    get desktop() {
      return desktop
    },
    get consistencyEvaluationPollTimer() {
      return consistencyEvaluationPollTimer
    },
    set consistencyEvaluationPollTimer(value) {
      consistencyEvaluationPollTimer = value
    },
    get consistencyEvaluationSummary() {
      return consistencyEvaluationSummary
    }
  })

  const {
    loadRealTrialReport,
    loadRealTrialConclusionDraft,
    loadRealTrialDraft,
    saveRealTrialChapter,
    saveRealTrialConclusion,
    trialPercent
  } = createReviewTrialActions({
    get realTrialIssue() {
      return realTrialIssue
    },
    get realTrialReport() {
      return realTrialReport
    },
    get desktop() {
      return desktop
    },
    get realTrialAvailableChapters() {
      return realTrialAvailableChapters
    },
    get selectedId() {
      return selectedId
    },
    get realTrialChapterId() {
      return realTrialChapterId
    },
    get realTrialConclusionDraft() {
      return realTrialConclusionDraft
    },
    get realTrialConclusionDefaults() {
      return realTrialConclusionDefaults
    },
    get realTrialDraft() {
      return realTrialDraft
    },
    get realTrialDraftDefaults() {
      return realTrialDraftDefaults
    },
    get realTrialSelectedChapter() {
      return realTrialSelectedChapter
    },
    get notice() {
      return notice
    },
    get guard() {
      return guard
    }
  })

  const {
    refreshAutoBackup,
    chooseAutoBackupDirectory,
    saveAutoBackupPreferences,
    runAutomaticBackup,
    autoBackupTime,
    openWorkspaceRestore,
    closeWorkspaceRestore,
    confirmWorkspaceRestore
  } = createLibraryBackupActions({
    get current() {
      return current
    },
    get desktop() {
      return desktop
    },
    get autoBackupRefreshGeneration() {
      return autoBackupRefreshGeneration
    },
    set autoBackupRefreshGeneration(value) {
      autoBackupRefreshGeneration = value
    },
    get autoBackupStatus() {
      return autoBackupStatus
    },
    get autoBackupDraftDirty() {
      return autoBackupDraftDirty
    },
    get autoBackupDraft() {
      return autoBackupDraft
    },
    get notice() {
      return notice
    },
    get guard() {
      return guard
    },
    get plainDto() {
      return plainDto
    },
    get autoBackupRunning() {
      return autoBackupRunning
    },
    get busy() {
      return busy
    },
    get chapterIsDirty() {
      return chapterIsDirty
    },
    get saveState() {
      return saveState
    },
    get flushChapterSave() {
      return flushChapterSave
    },
    get workspaceRestorePreview() {
      return workspaceRestorePreview
    },
    get activateWorkItem() {
      return activateWorkItem
    },
    get active() {
      return active
    },
    get settingsSection() {
      return settingsSection
    }
  })

  const {
    localAppearanceDialog,
    groupChatOpen,
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
  } = createAppState({
    get materialSection() {
      return materialSection
    },
    get timelineMode() {
      return timelineMode
    },
    get outlineMode() {
      return outlineMode
    },
    get preparationMode() {
      return preparationMode
    },
    get profileSaveProgress() {
      return profileSaveProgress
    },
    get bookProfile() {
      return bookProfile
    },
    get profileSavedSnapshot() {
      return profileSavedSnapshot
    },
    get profileSavedAt() {
      return profileSavedAt
    },
    get chapterContent() {
      return chapterContent
    },
    get bookSubgenreOptions() {
      return bookSubgenreOptions
    },
    get duplicateAiConnectionNames() {
      return duplicateAiConnectionNames
    },
    get explorerWidth() {
      return explorerWidth
    },
    get assistantWidth() {
      return assistantWidth
    },
    get interfaceFontSize() {
      return interfaceFontSize
    },
    get editorFontScale() {
      return editorFontScale
    },
    get editorLeading() {
      return editorLeading
    },
    get editorPageWidth() {
      return editorPageWidth
    },
    get editorFontFamilyCss() {
      return editorFontFamilyCss
    },
    get workflowStatus() {
      return workflowStatus
    },
    get ai() {
      return ai
    },
    get oneOffGlobalConnections() {
      return oneOffGlobalConnections
    },
    get writingAgentTasks() {
      return writingAgentTasks
    },
    get selectedId() {
      return selectedId
    },
    get planningDraft() {
      return planningDraft
    },
    get planningDetailStatuses() {
      return planningDetailStatuses
    },
    get planningDetailCandidates() {
      return planningDetailCandidates
    },
    get foreshadowLedger() {
      return foreshadowLedger
    },
    get sourceCards() {
      return sourceCards
    },
    get ideas() {
      return ideas
    },
    get materialSearch() {
      return materialSearch
    },
    get projectWordCount() {
      return projectWordCount
    },
    get selectedChapterRecord() {
      return selectedChapterRecord
    },
    get consistencyOverview() {
      return consistencyOverview
    },
    get characterState() {
      return characterState
    },
    get writingAgentTurns() {
      return writingAgentTurns
    },
    get chapterPlanning() {
      return chapterPlanning
    },
    get characterAliases() {
      return characterAliases
    },
    get storyEntities() {
      return storyEntities
    }
  })

  const {
    libraryModelsDialog,
    libraryModelsOpen,
    workspaceOpening,
    projectsLoaded,
    projects,
    continueProjectId,
    projectTrashTarget,
    projectTrashConfirmation,
    recentlyTrashedProject,
    txtImportEntry,
    txtPreview,
    txtMaterialPreview,
    importManifest,
    manifestRoles,
    manifestChapterSelections,
    importCreatedProject,
    importRecoveries,
    continuationAnalysis,
    continuationManifestId,
    continuationBlockedReason,
    continuationProjectDefinitionPreview,
    continuationExistingPlotPreview,
    continuationExistingPlotDraft,
    continuationCharacterEditorOpen,
    continuationCharacterPreview,
    continuationCharacterDraft,
    continuationWorldViewPreview,
    continuationPowerSystemPreview,
    continuationCheatSystemPreview,
    continuationTotalOutlinePreview,
    continuationVolumeOutlinePreview,
    continuationVolumeTarget,
    continuationChapterOutlinePreview,
    continuationChapterTarget,
    txtImport,
    createForm,
    createErrors,
    createNameInput,
    createTrigger,
    newProjectGuide,
    profileSavedSnapshot,
    profileSaveProgress,
    profileSavedAt,
    workflowStatus,
    migrationPreview,
    sqliteShadowPreview,
    sqliteShadowResult,
    sqliteStorageStatus,
    sqliteActivationPreview,
    sqliteActivationResult,
    workspaceBackupResult,
    workspaceRestorePreview,
    autoBackupStatus,
    autoBackupDraft,
    autoBackupRunning,
    autoBackupLoading,
    autoBackupDraftDirty,
    workspaceLoadError,
    workspaceBootstrapIssues,
    projectWordCount,
    continuationSelectedVolumeReceipt,
    continuationSelectedVolumeConfirmed,
    continuationEligibleChapters,
    continuationSelectedChapterReceipt,
    continuationSelectedChapterConfirmed,
    txtCanImport
  } = createLibraryState({
    get chapters() {
      return chapters
    },
    get outlinePlanning() {
      return outlinePlanning
    },
    get planningTotalConfirmed() {
      return planningTotalConfirmed
    },
    get selectedId() {
      return selectedId
    },
    get current() {
      return current
    }
  })

  const {
    modelSettingsDirty,
    createModelsPreview,
    partialCreation,
    importModelsPreview,
    partialImportCreation,
    oneOffGlobalConnections,
    availableModelsByConnection,
    aiCatalogLoading,
    aiCatalogUnavailableConnectionIds,
    aiConnectionResult,
    aiModelChecks,
    aiTesting,
    aiConnectionDeletePreview,
    aiCredentialClearPreview,
    aiInstruction,
    duplicateAiConnectionNames,
    localModelViews,
    modelCatalogChoices
  } = createModelsState({
    get ai() {
      return ai
    }
  })

  const {
    preparationMode,
    realms,
    powerSystem,
    cheatSystem,
    systemTemplate,
    foundation,
    bookProfile,
    foundationDraft,
    researchSettings,
    researchResult,
    researchQuery,
    sourceCards,
    materialSection,
    materialSearch,
    creatingSource,
    sourceDraft,
    materialSectionInfo,
    foundationMissing,
    foundationReady,
    researchSourcesIssue,
    researchEventsIssue,
    sourceDraftDirty
  } = createWorldbuildingState({
    get workflowStatus() {
      return workflowStatus
    },
    get workspaceBootstrapIssues() {
      return workspaceBootstrapIssues
    },
    get selectedSource() {
      return selectedSource
    }
  })

  const {
    contextBudgetPreferences,
    assistantOpen,
    assistantMode,
    taskCenterItems,
    taskCenterLoading,
    taskCenterBusyId,
    promptProfile,
    promptDraft,
    contextFactPack,
    writingAgentTurns,
    writingRebase,
    writingRebaseBusy,
    writingAgentApplyingTurnId,
    writingAgentTasks,
    writingAgentRunning,
    writingAgentContextPreview,
    writingAgentContextPreviewBusy,
    writingAgentQuickAction,
    bookSubgenreOptions,
    assistantAvailable,
    embeddedWritingAgent,
    writingAgentModelChoices,
    activeWritingAgentTask,
    promptDraftDirty
  } = createAssistantState({
    get bookProfile() {
      return bookProfile
    },
    get desktop() {
      return desktop
    },
    get oneOffConnections() {
      return oneOffConnections
    },
    get availableModelsByConnection() {
      return availableModelsByConnection
    },
    get ai() {
      return ai
    },
    get localModelViews() {
      return localModelViews
    },
    get current() {
      return current
    },
    get selectedId() {
      return selectedId
    },
    get selectedPromptEntry() {
      return selectedPromptEntry
    }
  })

  const {
    editorFocusMode,
    manuscriptEditor,
    chapterDeleteTarget,
    chapterTrashOpen,
    chapterTrashEntries,
    revisions,
    selectedRevisionId,
    revisionViewMode,
    revisionLabelDraft,
    recoveryBusyId,
    chapters,
    selectedId,
    chapterTitle,
    chapterTreeQuery,
    quickChapterOpen,
    quickChapterItems,
    chapterContent,
    chapterOutline,
    selectedCharacterLineId,
    selectedTimelineVolume,
    selectedPromptTask,
    chapterDerivatives,
    selectedIdeaGenerations,
    selectedIdeaId,
    selectedSourceId,
    manuscriptSelection,
    manuscriptInsertionAnchor,
    chapterPlanning,
    chapterCardOpen,
    chapterCardSaving,
    chapterCardAdoption,
    chapterCardDraft,
    chapterSummaryDraft,
    chapterSummaryStatus,
    pendingCharacterSettlements,
    pendingAiSourceTaskIds,
    saveState,
    manuscriptSaveError,
    manuscriptConflict,
    manuscriptRecoveryItems,
    manuscriptRecoveryBusyId,
    lastSavedAt,
    lastSavedChapterOutline,
    chapterOrderIssue,
    manuscriptSaveErrorMessage,
    manuscriptConflictView,
    chapterLifecycleActions,
    selectedPromptEntry,
    saveStatusLabel,
    selectedRevision,
    selectedRevisionDiff,
    selectedRevisionChanges,
    revisionDiffSummary,
    selectedEventSource,
    selectedCharacterLine,
    selectedTimelineVolumeMeta,
    selectedSource,
    selectedIdea,
    selectedIdeaSourceOption,
    selectedChapterVolume,
    selectedChapterStage,
    selectedChapterRecord,
    selectedChapterPosition,
    chapterDerivativeEntries,
    chapterOutlineDirty,
    chapterReview,
    chapterReviewLabel,
    chapterCardAdoptionFields,
    selectedResourceBalance,
    selectedResourceEntries
  } = createManuscriptState({
    get chapterPosition() {
      return chapterPosition
    },
    get ideaGenerations() {
      return ideaGenerations
    },
    get workspaceBootstrapIssues() {
      return workspaceBootstrapIssues
    },
    get lastSavedChapter() {
      return lastSavedChapter
    },
    set lastSavedChapter(value) {
      lastSavedChapter = value
    },
    get promptProfile() {
      return promptProfile
    },
    get current() {
      return current
    },
    get sqliteStorageStatus() {
      return sqliteStorageStatus
    },
    get sourceCards() {
      return sourceCards
    },
    get eventDraft() {
      return eventDraft
    },
    get characterAtlasCards() {
      return characterAtlasCards
    },
    get timelineVolumeCards() {
      return timelineVolumeCards
    },
    get ideas() {
      return ideas
    },
    get ideaSourceTask() {
      return ideaSourceTask
    },
    get outlinePlanning() {
      return outlinePlanning
    },
    get stageOutlines() {
      return stageOutlines
    },
    get resourceLedger() {
      return resourceLedger
    },
    get resourceLedgerDraft() {
      return resourceLedgerDraft
    }
  })

  const { companionTyping, companionComposing, companionTask } = createCompanionState({
    get activeWritingAgentTask() {
      return activeWritingAgentTask
    },
    get writingAgentTasks() {
      return writingAgentTasks
    },
    get current() {
      return current
    },
    get selectedId() {
      return selectedId
    }
  })

  const {
    totalOutline,
    volumeOutline,
    stageOutlines,
    selectedStage,
    stageTitle,
    stageOutline,
    lastSavedStageTitle,
    lastSavedStageOutline,
    stageDraftTitle,
    outlineMode,
    outlineInspectorOpen,
    selectedVolume,
    outlineEditor,
    outlineComposing,
    outlineLeaveDialog,
    outlineVolumeDialog,
    outlineLeavePending,
    outlineLoading,
    outlineOpenError,
    lastPlanningLeaf,
    planningJob,
    planningDraft,
    planningDraftSaveState,
    planningAdoptionPreview,
    planningVolumeStructurePreview,
    planningVolumeOutlinePreview,
    planningChapterDetailPreview,
    planningCharacterSeedPreview,
    planningWorldSeedPreview,
    planningPowerSystemPreview,
    planningCheatSystemPreview,
    planningAdoptionBusy,
    planningSkeletonJob,
    planningSkeletonStatus,
    planningDetailJob,
    planningDetailStatuses,
    ideas,
    ideaGenerations,
    ideaGenerationInstruction,
    ideaSourceTask,
    ideaSourceIssue,
    ideaGenerationRunning,
    creatingIdea,
    ideaDraft,
    ideaGenerationSource,
    outlinePlanning,
    volumeDraft,
    lastSavedTotalOutline,
    expansionOpen,
    expansionSource,
    expansionTasks,
    expansionLoading,
    expansionBusy,
    expansionError,
    standaloneOutlineEntries,
    plannedChapter,
    plannedChapterTitle,
    plannedChapterContent,
    plannedChapterBusy,
    plannedChapterStarting,
    plannedOutlineRecovery,
    plannedOutlineRecoveryError,
    outlineRecoveryDrafts,
    outlineRecoveryShelfError,
    plannedChapterError,
    plannedChapterComposing,
    plannedChapterDirty,
    expansionPreview,
    expansionNotice,
    expansionParentKey,
    lastSavedVolumeOutline,
    planningMaterialsReady,
    outlinePlanningIssue,
    outlineDocumentLocked,
    outlineStorageKey,
    outlineStorageDescription,
    planningRunning,
    planningSkeletonRunning,
    planningDetailRunning,
    planningTotalConfirmed,
    planningVolumesConfirmed,
    planningSkeletonVolumes,
    planningDetailCandidates,
    planningFoundationAdoptedCount,
    planningFoundationReady,
    planningAdoptionStageLabel,
    planningAdoptionMarker,
    planningAdoptionGuidance,
    planningStageLabel,
    ideaDraftDirty,
    selectedVolumeMeta,
    selectedStageMeta,
    selectedVolumeStages,
    outlineFullCatalog,
    planningOutlineReview,
    planningOutlineApproval,
    planningOutlineDirty,
    planningReviewLabel,
    planningApprovalLabel
  } = createPlanningState({
    get workflowStatus() {
      return workflowStatus
    },
    get workspaceBootstrapIssues() {
      return workspaceBootstrapIssues
    },
    get chapterOrderIssue() {
      return chapterOrderIssue
    },
    get selectedId() {
      return selectedId
    },
    get outlineStorageFeedback() {
      return outlineStorageFeedback
    },
    get nextPlanningVolumeCandidate() {
      return nextPlanningVolumeCandidate
    },
    get adoptedPlanningVolumeCount() {
      return adoptedPlanningVolumeCount
    },
    get nextPlanningDetailVolume() {
      return nextPlanningDetailVolume
    },
    get nextPlanningChapterDetailCandidate() {
      return nextPlanningChapterDetailCandidate
    },
    get adoptedPlanningChapterCount() {
      return adoptedPlanningChapterCount
    },
    get selectedIdea() {
      return selectedIdea
    },
    get selectedChapterVolume() {
      return selectedChapterVolume
    },
    get chapters() {
      return chapters
    }
  })

  const {
    timelineMode,
    chronicleMapLocation,
    timeline,
    expandedTimelineEntry,
    timelineAiCandidates,
    timelineAiGenerating,
    timelineVolumeContent,
    timelineVolumeLoading,
    timelineVolumeError,
    canonicalEvents,
    eventProjection,
    unifiedEvents,
    archivedUnifiedEvents,
    unifiedEventCandidates,
    unifiedEventMode,
    eventMigrationState,
    eventMigrationBusy,
    eventMigrationError,
    eventDraft,
    approvedEvents,
    timelineEntryCount,
    timelineVolumeCards
  } = createTimelineState({
    get outlinePlanning() {
      return outlinePlanning
    },
    get chapters() {
      return chapters
    }
  })

  const {
    openEventMigration,
    closeEventMigration,
    toggleMigrationAcknowledgement,
    migrationReady,
    commitEventMigration,
    retryEventMirror
  } = createEventMigrationActions({
    get desktop() { return desktop },
    get current() { return current },
    get workspaceRequests() { return workspaceRequests },
    get eventProjection() { return eventProjection },
    get unifiedEvents() { return unifiedEvents },
    get archivedUnifiedEvents() { return archivedUnifiedEvents },
    get unifiedEventCandidates() { return unifiedEventCandidates },
    get unifiedEventMode() { return unifiedEventMode },
    get timeline() { return timeline },
    get eventMigrationState() { return eventMigrationState },
    get eventMigrationBusy() { return eventMigrationBusy },
    get eventMigrationError() { return eventMigrationError },
    get notice() { return notice },
    get refreshWorkflow() { return refreshWorkflow }
  })

  const {
    characterLines,
    characterLinesLoaded,
    characterLinesLoading,
    characterLinesError,
    characterDisplayMode,
    characterAtlasThroughPosition,
    foreshadowLedger,
    foreshadowLedgerLoaded,
    selectedForeshadowId,
    foreshadowDraft,
    characterAliases,
    characterAliasDraft,
    characterAliasesLoaded,
    storyEntities,
    storyEntityRelations,
    storyEntitiesLoaded,
    storyEntityDraft,
    storyRelationDraft,
    resourceLedger,
    resourceLedgerDraft,
    characterState,
    characterStateIssue,
    characterAtlasCards,
    selectedForeshadow,
    selectedForeshadowActions,
    characterContinuityFindings
  } = createCharactersState({
    get workspaceBootstrapIssues() {
      return workspaceBootstrapIssues
    },
    get chapters() {
      return chapters
    },
    get allCharacterFindings() {
      return allCharacterFindings
    }
  })

  const {
    consistencyOverview,
    findingHistory,
    findingResolutionError,
    factBatches,
    factReviewBusy,
    factExtractionBusy,
    factExtractionJobId,
    factExtractionRetryId,
    factExtractionRawResult,
    dismissingConflictId,
    decidingContinuityFindingId,
    consistencyEvaluationSummary,
    consistencyEvaluationJob,
    realTrialReport,
    realTrialIssue,
    realTrialChapterId,
    factExtractionDescription,
    realTrialAvailableChapters,
    realTrialSelectedChapter,
    realTrialExistingRecord
  } = createReviewState({
    get chapterPlanning() {
      return chapterPlanning
    },
    get chapters() {
      return chapters
    }
  })

  const { choice: themeChoice, error: themeError, select: selectTheme } = useThemePreferences()
  const {
    preferences: libraryAppearance,
    backgroundArtwork: libraryBackgroundArtwork,
    sceneArtwork: librarySceneArtwork,
    error: libraryAppearanceError,
    update: updateLibraryAppearance
  } = useLibraryAppearance()
  const { preferences: loadingPreferences } = useLoadingPreferences()
  let activitybarPointerFocusing = false

  const desktop = window.novelDesktop
  const manuscriptRecoveryStore = createManuscriptRecoveryStore(window.localStorage)
  const plannedOutlineRecoveryStore = createManuscriptRecoveryStore(window.localStorage, { kind: 'planned-outline' })
  const workspaceRequests = new WorkspaceRequestGuard()
  let chapterSelectionGeneration = 0
  let workspaceRefreshGeneration = 0
  let workspaceOpeningGeneration = 0
  let workspaceOpeningSlowTimer = 0
  let workspaceOpeningPhaseTimer = 0
  let workspaceOpeningPhaseFrame = 0
  let workspaceOpeningPhaseWaiters = []
  const WORKSPACE_COMPLETION_DURATION_MS = 1000
  const WORKSPACE_PHASE_DWELL_MS = 320
  const WORKSPACE_PHASE_SEQUENCE = ['switch', 'database', 'workspace', 'chapter', 'recovery', 'ready']
  const plainDto = (value) => JSON.parse(JSON.stringify(value))
  const {
    phase: displayBootPhase,
    error: displayBootError,
    detail: bootDetail,
    required: bootModelsRequired,
    skipped: bootModelsSkipped,
    canSkip: canSkipBootModels,
    skipWaiting: skipBootModels,
    retryModels: retryBootModels
  } = useCompanionBoot(bootPhase, bootError, bootPreview)
  const preferenceNumber = (key, fallback, min, max) => {
    const value = Number.parseFloat(localStorage.getItem(key) || '')
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
  }
  const explorerWidth = ref(preferenceNumber('lanjian-explorer-width', 248, 200, 420))
  const assistantWidth = ref(preferenceNumber('lanjian-assistant-width', 348, 280, 720))
  const interfaceFontSize = ref(preferenceNumber('lanjian-interface-font-size', 14, 12, 15))
  const {
    fontScale: editorFontScale,
    leading: editorLeading,
    fontFamily: editorFontFamily,
    pageWidth: editorPageWidth,
    guideStyle: editorGuideStyle,
    fontFamilyCss: editorFontFamilyCss,
    save: saveEditorPreferences,
    reset: resetEditorPreferences
  } = useEditorPreferences()
  const appSearchParams = new URLSearchParams(window.location.search)
  const smokeRuntime = appSearchParams.get('smoke') === '1'
  const opening = ref(!smokeRuntime || appSearchParams.get('boot') === '1')
  let taskCenterTimer = null
  let contextFactPackKey = ''
  const {
    options: companionOptions,
    error: companionError,
    projectSpecific: companionProjectSpecific,
    update: updateCompanionOptions,
    setProjectSpecific: setCompanionProjectSpecific,
    recoverDefaults: recoverCompanionDefaults
  } = createCompanionPreferences(
    window.localStorage,
    computed(() => current.value?.path || '')
  )
  let companionQuietTimer = 0
  const chapterOpenNavigation = createChapterOpenNavigation()
  let resolveOutlineLeave = null
  let outlineNavigationGeneration = 0
  let retryOutlineOpen = null
  watch(
    () => current.value?.path,
    () => {
      lastPlanningLeaf.value = 'total-outline'
      invalidateOutlineRead()
      outlineOpenError.value = ''
    }
  )
  watch(
    () => current.value?.path,
    () => {
      chronicleMapLocation.value = ''
    }
  )
  const worldMapWorkspace = createWorldMapWorkspace(desktop.workspace, () => current.value, workspaceRequests, notice)
  const {
    view: worldMapView,
    loading: worldMapLoading,
    saving: worldMapSaving,
    dirty: worldMapDirty,
    error: worldMapError,
    saveError: worldMapSaveError,
    background: worldMapBackground,
    backgroundError: worldMapBackgroundError,
    candidate: worldMapCandidate,
    generating: worldMapGenerating,
    adopting: worldMapAdopting,
    generationError: worldMapGenerationError
  } = worldMapWorkspace
  let characterLinesRefreshGeneration = 0
  let characterAtlasInitialized = false
  let timelineVolumeGeneration = 0
  watch(
    [() => current.value?.id, () => current.value?.path, selectedId],
    () => {
      findingHistory.value = null
      findingResolutionError.value = ''
    },
    { flush: 'sync' }
  )
  watch(
    consistencyOverview,
    (value) => {
      if (!value) findingHistory.value = null
    },
    { flush: 'sync' }
  )
  const outlineStorageFeedback = createOutlineStorageFeedback(
    () => desktop.projects.sqliteStorageStatus(),
    () => current.value,
    workspaceRequests
  )
  let consistencyEvaluationPollTimer = 0
  const realTrialDraftDefaults = () => ({
    planningMinutes: 0,
    writingMinutes: 0,
    aiEditingMinutes: 0,
    factReviewMinutes: 0,
    diffAcceptedBlocks: 0,
    diffRejectedBlocks: 0,
    misappliedChanges: 0,
    falsePositiveFindings: 0,
    usefulFindings: 0,
    modelCost: '',
    satisfaction: 4,
    continueNextChapter: true,
    bypassedFeatures: '',
    notes: ''
  })
  const realTrialDraft = ref(realTrialDraftDefaults())
  const realTrialConclusionDefaults = () => ({
    decision: 'adjust',
    highPriorityProblems: '',
    mediumPriorityProblems: '',
    lowPriorityProblems: '',
    rationale: '',
    nextScope: ''
  })
  const realTrialConclusionDraft = ref(realTrialConclusionDefaults())
  let autoBackupRefreshGeneration = 0
  let autoBackupSettingsLoadGeneration = 0
  let ideaGenerationTimer = null
  let ideaGenerationLoad = 0
  let ideaSourceLoad = 0
  const ideaGenerationStatus = {
    queued: '准备中',
    preparing: '准备中',
    running: '生成中',
    streaming: '生成中',
    succeeded: '候选已保存',
    failed: '生成失败',
    cancelled: '已停止',
    interrupted: '上次任务中断，可重新生成'
  }
  const modelDefaults = (connectionId = 'primary') => ({
    connectionId,
    model: 'gpt-4.1-mini',
    temperature: 0.7,
    topP: 1,
    maxTokens: 8192
  })
  const ai = ref({
    version: 2,
    connections: [
      { id: 'primary', name: '主要接口', baseUrl: 'https://api.openai.com/v1', apiKey: '', apiKeyConfigured: false }
    ],
    apiKeyConfigured: false,
    routingMode: 'shared',
    shared: modelDefaults(),
    tasks: {
      outline: { ...modelDefaults(), temperature: 0.6 },
      chapterOutline: { ...modelDefaults(), temperature: 0.65 },
      prose: { ...modelDefaults(), temperature: 0.8 },
      review: { ...modelDefaults(), temperature: 0.2 }
    }
  })
  const taskLabels = { outline: '生成总纲', chapterOutline: '生成章节大纲', prose: '生成正文', review: '校验与修订' }
  let aiCatalogRefreshGeneration = 0
  let writingAgentContextPreviewRequest = 0
  let lastSavedChapter = { id: null, title: '', content: '', revision: null, bodyVersionId: null }
  let activeAutosaveCheckpoint = null
  let stagedRecoverySnapshot = null
  let plannedChapterGeneration = 0
  let expansionGeneration = 0
  let expansionTimer = null
  let autosaveTimer = null
  let autosaveFinalizeTimer = null
  let suppressManuscriptAutosave = false
  let pendingSaveReason = 'autosave'
  const manuscriptSaves = new ManuscriptSaveQueue()
  let removeBeforeClose = null
  let removeSelectionAiAction = null
  let planningPollTimer = null
  let planningSkeletonPollTimer = null
  let planningDetailPollTimer = null
  let planningDraftSaveTimer = null
  let autoBackupTimer = null
  let planningDraftSaveQueue = Promise.resolve()
  let planningDraftEditVersion = 0
  let planningDraftSaveError = null
  let suppressNextPlanningDraftSave = false
  const autosaveCheckpointDelaySeconds = computed({
    get: () => Math.max(0.25, (Number(bookProfile.value.autosaveDelayMs) || 1_500) / 1_000),
    set: (seconds) => {
      bookProfile.value.autosaveDelayMs = Math.round(Math.min(60, Math.max(0.25, Number(seconds) || 1.5)) * 1_000)
    }
  })
  const autosaveVersionIdleSeconds = computed({
    get: () => Math.max(1, Math.round((Number(bookProfile.value.autosaveMergeWindowMs) || 30_000) / 1_000)),
    set: (seconds) => {
      bookProfile.value.autosaveMergeWindowMs = Math.min(600, Math.max(1, Number(seconds) || 30)) * 1_000
    }
  })
  const chapterLifecycleLabels = {
    PLANNED: '待写',
    DRAFTING: '起草中',
    REVIEWABLE: '可审阅',
    CONFIRMED: '已定稿',
    REVISING: '修订中',
    ARCHIVED: '已归档'
  }
  const characterConflictLabels = { identity: '身份', motivation: '长期动机', arc: '人物弧' }
  const continuityFindingLabels = {
    LOCATION_JUMP: '地点承接',
    POWER_SKIP: '境界越级',
    POWER_REGRESSION: '境界回落',
    UNEXPLAINED_REVIVAL: '生死矛盾',
    POSSESSION_HANDOFF: '物品交接',
    IDENTITY_CONFLICT: '身份冲突',
    MOTIVATION_CONFLICT: '动机冲突',
    ARC_CONFLICT: '人物弧冲突'
  }
  const literaryFindingLabels = {
    DUPLICATE_PARAGRAPH: '重复段落',
    REPEATED_PARAGRAPH_OPENING: '段落起笔重复',
    SUMMARY_TONE_DENSITY: '总结性表达偏密'
  }
  const findingLayerLabels = { deterministic: '确定性核对', semantic: '语义疑点', literary: '表达建议' }
  const revisionReasonLabels = { manual: '手动保存', autosave: '自动保存', ai: '采用候选稿', restore: '恢复前备份' }
  const continuationAreaLabels = {
    projectDefinition: '作品定义',
    existingPlot: '已有剧情',
    characters: '人物',
    worldView: '世界观',
    powerSystem: '力量或境界',
    cheatSystem: '金手指或特殊优势',
    totalOutline: '总纲碎片',
    volumeOutline: '卷纲碎片',
    chapterOutline: '章纲碎片'
  }
  const continuationGapLabels = { required: '继续写作前必核', recommended: '建议补充', conflict: '待核冲突' }

  let openingReturnFocus = null

  let removeExplorerResizeListeners = null
  let removeAssistantResizeListeners = null
  let explorerScrollEndTimer = null

  let projectLibraryRefreshGeneration = 0

  const refreshManuscriptRecoveries = createManuscriptRecoveryRefresh({
    current: () => current.value,
    guard: workspaceRequests,
    read: () => desktop.chapters.autosaveRecoveries(),
    clear: () => {
      manuscriptRecoveryItems.value = []
    },
    apply: applyManuscriptRecoveries
  })

  watch(
    () => [plannedChapterTitle.value, plannedChapterContent.value, plannedChapter.value?.revision],
    () => {
      if (!plannedChapter.value || !current.value || plannedOutlineRecovery.value) return
      try {
        if (plannedChapterDirty.value) {
          plannedOutlineRecoveryStore.write({
            workItemId: current.value.path,
            chapterId: plannedChapter.value.chapterId,
            title: plannedChapterTitle.value,
            content: plannedChapterContent.value,
            baseRevision: plannedChapter.value.revision
          })
        } else {
          const snapshot = plannedOutlineRecoveryStore.read(current.value.path, plannedChapter.value.chapterId)
          if (snapshot) plannedOutlineRecoveryStore.clearIfSnapshotMatches(snapshot)
        }
        plannedOutlineRecoveryError.value = ''
      } catch (error) {
        plannedOutlineRecoveryError.value = error.message
      }
    },
    { flush: 'post' }
  )

  watch(() => current.value?.path, resetPlannedChapter)

  watch(activeWorkspaceLeaf, (leaf) => {
    if (leaf && activeWorkspaceGroup.value.id === 'planning') lastPlanningLeaf.value = leaf.id
  })
  watch(
    () => [current.value?.path, active.value, outlineMode.value, selectedVolume.value, selectedStage.value],
    closeOutlineExpansion
  )
  onBeforeUnmount(closeOutlineExpansion)

  onMounted(async () => {
    if (desktop) {
      removeSelectionAiAction = desktop.app.onSelectionAiAction?.((skill) => openWritingAgentQuickAction(skill)) || null
      removeBeforeClose = desktop.app.onBeforeClose(async () => {
        if (modelSettingsDirty.value) {
          notice('模型设置有未保存的输入，请先保存或明确放弃。')
          desktop.app.readyToClose(false)
          return
        }
        if (!worldMapWorkspace.canLeave()) {
          desktop.app.readyToClose(false)
          return
        }
        const pluginCloseStillCurrent = prepareCompositionClose(message => window.confirm(message), notice)
        if (!pluginCloseStillCurrent) {
          desktop.app.readyToClose(false)
          return
        }
        try {
          await cancelAutomaticPlanning(false)
          await cancelPlanningChapterSkeleton(false)
          await cancelPlanningChapterDetail(false)
          await flushChapterSave()
          if (!(await prepareOutlineLeave()) || !(await flushPlannedChapterSave())) throw new Error('大纲未保存')
          await flushPlanningDraftSave()
          if (!pluginCloseStillCurrent()) {
            notice('关闭等待期间插件组合有变化，窗口已保留，请核对后重试。')
            desktop.app.readyToClose(false)
            return
          }
          desktop.app.readyToClose(true)
        } catch {
          notice('关闭前保存失败，窗口已保留，请检查后重试')
          desktop.app.readyToClose(false)
        }
      })
    }
    window.addEventListener('blur', flushManuscriptWhenInactive)
    window.addEventListener('keydown', handleQuickChapterShortcut)
    document.addEventListener('visibilitychange', handleDocumentVisibilityChange)
    autoBackupTimer = window.setInterval(() => void runAutomaticBackup(false), 60_000)
    taskCenterTimer = window.setInterval(() => {
      if (assistantOpen.value && assistantMode.value === 'tasks') void loadTaskCenter()
    }, 1500)
    await initializeBoot()
  })

  watch(
    () => [current.value?.path, active.value],
    ([workItemPath]) => {
      chapterTreeQuery.value = ''
      if (!workItemPath) assistantOpen.value = false
    }
  )
  watch(
    [realTrialAvailableChapters, () => settingsSection.value],
    ([available, section]) => {
      if (
        section !== 'trial' ||
        !available.length ||
        available.some((chapter) => chapter.id === realTrialChapterId.value)
      )
        return
      realTrialChapterId.value = available.find((chapter) => chapter.id === selectedId.value)?.id ?? available[0].id
      loadRealTrialDraft()
    },
    { flush: 'post' }
  )
  watch([chapterTitle, chapterContent], scheduleAutosave, { flush: 'sync' })
  watch(assistantOpen, async (open) => {
    if (open && assistantAvailable.value && selectedId.value && !contextFactPack.value) {
      contextFactPackKey = ''
      await refreshWorkflow()
    }
  })
  watch([assistantOpen, assistantMode, current], ([open, mode, workItem]) => {
    if (open && mode === 'tasks' && workItem) void loadTaskCenter()
  })
  watch(
    planningDraft,
    (value, previous) => {
      // Loading an existing candidate is read-only. Only edits to an already loaded
      // object schedule a write; newly generated candidates are persisted in main.
      if (!value || previous === null) return
      if (suppressNextPlanningDraftSave) {
        suppressNextPlanningDraftSave = false
        return
      }
      schedulePlanningDraftSave()
    },
    { deep: true, flush: 'post' }
  )

  watch(
    () => [current.value?.id, activeWorkspaceLeaf.value?.id, active.value],
    () => {
      updateFieldScope(
        current.value?.id || null,
        current.value ? activeWorkspaceLeaf.value?.id || active.value : 'library',
        current.value ? activeWorkspaceLeaf.value?.label || '作品' : '我的作品'
      )
    },
    { immediate: true, flush: 'sync' }
  )
  // Keep the named premise available from every book page; actual writes use this draft setter.
  const premiseRegistration = registerAssistantField(
    {
      id: 'definition.bookProfile.coreIdea',
      read: () => bookProfile.value.coreIdea,
      write: (value) => {
        bookProfile.value.coreIdea = String(value)
      },
      identity: () => bookProfile.value,
      available: () => Boolean(current.value),
      reveal: async () => {
        await selectActivity('profile')
        return active.value === 'profile'
      }
    },
    undefined,
    true
  )
  onBeforeUnmount(premiseRegistration.dispose)

  onBeforeUnmount(() => {
    disposeReviewFacts()
    window.clearTimeout(companionQuietTimer)
    clearIdeaGenerationPoll()
    void cancelAutomaticPlanning(false)
    void cancelPlanningChapterSkeleton(false)
    void cancelPlanningChapterDetail(false)
    clearAutosaveTimer()
    clearAutosaveFinalizeTimer()
    clearPlanningDraftSave()
    clearPlanningSkeletonPoll()
    clearPlanningDetailPoll()
    if (autoBackupTimer) window.clearInterval(autoBackupTimer)
    if (taskCenterTimer) window.clearInterval(taskCenterTimer)
    if (consistencyEvaluationPollTimer) window.clearTimeout(consistencyEvaluationPollTimer)
    if (explorerScrollEndTimer) window.clearTimeout(explorerScrollEndTimer)
    if (workspaceOpeningSlowTimer) window.clearTimeout(workspaceOpeningSlowTimer)
    stopWorkspaceOpeningPhasePlayback()
    removeExplorerResizeListeners?.()
    removeAssistantResizeListeners?.()
    removeBeforeClose?.()
    removeSelectionAiAction?.()
    window.removeEventListener('blur', flushManuscriptWhenInactive)
    window.removeEventListener('keydown', handleQuickChapterShortcut)
    document.removeEventListener('visibilitychange', handleDocumentVisibilityChange)
  })
  const groupWorkspace = useGroupWorkspaceNavigation({ current, open: groupChatOpen, prepareLeave: prepareWorkItemTransition, selectBook: selectBookTab,
    closeBook: closeProject, activate: activateWorkItem, refresh: refreshProjects })
  return {
    groupChatOpen: groupWorkspace.open, openGroupChat: groupWorkspace.show, selectWorkspaceBook: groupWorkspace.select,
    showWorkspaceLibrary: groupWorkspace.library, groupBookCreated: groupWorkspace.created, prepareGroupCreation: prepareWorkItemTransition,
    openGroupCreateBook: async () => { await groupWorkspace.library(); if (!current.value) await openCreateProject() },

    libraryModelsDialog,
    openBookTabs,
    bookDraftConflicts,
    resolveBookDraftConflict,
    selectBookTab,
    closeBookTab,
    openBackgroundTask,
    quickChapterOpen,
    guidancePopover,
    outlineLeaveDialog,
    manuscriptEditor,
    outlineEditor,
    embeddedWritingAgent,
    createNameInput,
    acceptRecoveredChapterOutline,
    acknowledgePlanningReview,
    active,
    activeIdeas,
    activeSettingsCategory,
    activeTitle,
    activeWorkspaceGroup,
    activeWorkspaceLeaf,
    activeWritingAgentTask,
    activitybarKeyboardExpanded,
    addContinuationDocuments,
    addRealm,
    addResearchToMaterials,
    addTimeline,
    adoptOutlineExpansion,
    adoptTimelineCandidate,
    adoptedPlanningVolumeCount,
    ai,
    aiConnectionDeletePreview,
    aiCredentialClearPreview,
    announceManuscriptHistory,
    appVersion,
    appendResourceLedgerEntry,
    applyWritingAgentPartial,
    applyWritingAgentTurn,
    approveCanonicalEvent,
    archiveTimelineEvent,
    restoreTimelineEvent,
    approvedEvents,
    openEventMigration,
    closeEventMigration,
    toggleMigrationAcknowledgement,
    migrationReady,
    commitEventMigration,
    retryEventMirror,
    approvedResourceEntities,
    assistantAvailable,
    assistantMode,
    assistantOpen,
    assistantWidth,
    autoBackupDraft,
    autoBackupDraftDirty,
    autoBackupLoading,
    autoBackupRunning,
    autoBackupStatus,
    autoBackupTime,
    autosaveCheckpointDelaySeconds,
    autosaveVersionIdleSeconds,
    backupDraftAndReloadExternal,
    beginAssistantResize,
    beginEventCandidate,
    beginExplorerResize,
    bookProfile,
    bookSubgenreOptions,
    bootDetail,
    bootError,
    bootModelsRequired,
    bootModelsSkipped,
    bootPreview,
    busy,
    canSkipBootModels,
    cancelAutomaticPlanning,
    cancelChapterDelete,
    cancelConsistencyEvaluation,
    cancelFactExtraction,
    cancelPlanningChapterDetail,
    cancelPlanningChapterSkeleton,
    cancelWorkspaceOpening,
    cancelWritingAgentTask,
    candidateIdeaCount,
    canonicalEvents,
    chapterCardAdoption,
    chapterCardAdoptionFields,
    chapterCardDraft,
    chapterCardOpen,
    chapterCardSaving,
    chapterContent,
    chapterDeleteTarget,
    chapterDerivativeEntries,
    chapterLifecycleActions,
    chapterLifecycleLabels,
    chapterOrderIssue,
    chapterOutline,
    chapterOutlineDirty,
    chapterPlanning,
    chapterPosition,
    chapterReview,
    chapterReviewLabel,
    chapterSummaryDraft,
    chapterSummaryStatus,
    chapterTitle,
    chapterTrashEntries,
    chapterTrashOpen,
    chapterTreeQuery,
    chapters,
    characterAliasDraft,
    characterAliasesLoaded,
    characterAtlasCards,
    characterAtlasThroughPosition,
    characterConflictLabels,
    characterContinuityFindings,
    characterDisplayMode,
    characterLines,
    characterLinesError,
    characterLinesLoaded,
    characterLinesLoading,
    characterPointDetails,
    characterStateIssue,
    cheatSystem,
    chooseAutoBackupDirectory,
    chooseCreateFolder,
    chooseForeshadow,
    chooseTxtDestination,
    chronicleMapLocation,
    closeContinuationCharacterEditor,
    closeCreateProject,
    closeLibraryModels,
    closeOutlineExpansion,
    closeProject,
    closeSqliteActivation,
    closeSqliteShadowMigration,
    closeWorkspaceRestore,
    commitTxtImport,
    companionComposing,
    companionError,
    companionOptions,
    companionProjectSpecific,
    companionTask,
    companionTyping,
    confirmAndExtractCurrentChapterFacts,
    confirmChapterCardAdoption,
    confirmChapterOutline,
    confirmClearAiCredential,
    confirmContinuationChapterOutlineAdoption,
    confirmContinuationCharacterAdoption,
    confirmContinuationCheatSystemAdoption,
    confirmContinuationExistingPlotAdoption,
    confirmContinuationPowerSystemAdoption,
    confirmContinuationProjectDefinitionAdoption,
    confirmContinuationTotalOutlineAdoption,
    confirmContinuationVolumeOutlineAdoption,
    confirmContinuationWorldViewAdoption,
    confirmCurrentChapter,
    confirmFindingResolution,
    confirmPlanningChapterDetailAdoption,
    refreshJointChapterAdoption,
    confirmPlanningCharacterSeedAdoption,
    confirmPlanningCheatSystemAdoption,
    confirmPlanningOutline,
    confirmPlanningPowerSystemAdoption,
    confirmPlanningTotalAdoption,
    confirmPlanningVolumeOutlineAdoption,
    confirmPlanningVolumeStructure,
    confirmPlanningWorldSeedAdoption,
    confirmRemoveAiConnection,
    confirmSqliteActivation,
    confirmSqliteShadowMigration,
    confirmWorkspaceRestore,
    confirmWritingRebase,
    connectionOptionLabel,
    consistencyEvaluationJob,
    consistencyEvaluationSummary,
    consistencyOverview,
    contextBudgetPreferences,
    contextFactPack,
    continuationAnalysis,
    continuationAreaLabels,
    continuationBlockedReason,
    continuationChapterOutlinePreview,
    continuationChapterTarget,
    continuationCharacterDraft,
    continuationCharacterEditorOpen,
    continuationCharacterPreview,
    continuationCheatSystemPreview,
    continuationEligibleChapters,
    continuationExistingPlotDraft,
    continuationExistingPlotPreview,
    continuationGapLabels,
    continuationManifestId,
    continuationPowerSystemPreview,
    continuationProjectDefinitionPreview,
    continuationSelectedChapterConfirmed,
    continuationSelectedChapterReceipt,
    continuationSelectedVolumeConfirmed,
    continuationSelectedVolumeReceipt,
    continuationTotalOutlinePreview,
    continuationVolumeOutlinePreview,
    continuationVolumeTarget,
    continuationWorldViewPreview,
    continueAfterFactReview,
    continueProjectId,
    continuityFindingLabels,
    createErrors,
    createEventCandidate,
    createForm,
    createModelsPreview,
    createOutlineStage,
    createOutlineVolume,
    createPlanningChapter,
    createProject,
    createWorkspaceBackup,
    creatingIdea,
    creatingSource,
    current,
    currentSettingsSection,
    decideContinuityFinding,
    decideFactChanges,
    decidingContinuityFindingId,
    deleteChapter,
    desktop,
    discardManuscriptRecovery,
    discardPlannedOutlineRecovery,
    discardPlanningProposal,
    discardShelfRecovery,
    discardTimelineCandidate,
    discardWritingAgentPartial,
    discardWritingAgentTurn,
    dismissCharacterConflict,
    dismissOpening,
    dismissWritingAgentTask,
    dismissingConflictId,
    displayBootError,
    displayBootPhase,
    editCharacterAliases,
    editIdeaGenerationOption,
    editStoryEntity,
    editorFocusMode,
    editorGuideStyle,
    effectiveModel,
    evaluationTime,
    eventDraft,
    eventPlacementLabel,
    eventPlacementValue,
    eventVolume,
    expandedTimelineEntry,
    expansionBusy,
    expansionError,
    expansionLoading,
    expansionNotice,
    expansionOpen,
    expansionParentKey,
    expansionPreview,
    expansionSource,
    expansionTasks,
    explorerScrolling,
    explorerWidth,
    exportSelectedChapters,
    exportManuscript,
    extractCurrentChapterFacts,
    factBatches,
    factExtractionBusy,
    factExtractionDescription,
    factExtractionRawResult,
    factExtractionRetryId,
    factReviewBusy,
    findingConfidenceLabel,
    findingHistory,
    findingLayerLabels,
    findingResolutionError,
    flushPlannedChapterSave,
    foreshadowDraft,
    foreshadowLedger,
    foreshadowLedgerLoaded,
    forgetProject,
    formatChapterTrashTime,
    formatRevisionTime,
    foundation,
    foundationMissing,
    foundationReady,
    generateChapterOutline,
    generateContinuationAnalysis,
    generateTimelineCandidates,
    globalAssistantHost,
    goToWorkflowStep,
    groupedCharacterAliases,
    handleActivitybarFocusIn,
    handleActivitybarFocusOut,
    handleActivitybarKeydown,
    handleActivitybarPointerDown,
    handleActivitybarPointerEnd,
    handleBookGenreChange,
    handleTaskCenterAction,
    handleTotalOutlineAi,
    ideaDraft,
    ideaDraftDirty,
    ideaGenerationInstruction,
    ideaGenerationRunning,
    ideaGenerationStatus,
    ideaSourceIssue,
    ideaSourceTask,
    ideas,
    importCreatedProject,
    importManifest,
    importModelsPreview,
    importProject,
    importRecoveries,
    initializeBoot,
    insertOutlineTemplate,
    isTimelineEntryOpen,
    lastSavedAt,
    legacyBookSubgenre,
    legacyLeafActivity,
    legacyParentActivity,
    libraryAppearance,
    libraryAppearanceError,
    libraryBackgroundArtwork,
    libraryModelsOpen,
    librarySceneArtwork,
    literaryFindingLabels,
    literaryStyleFindings,
    liveProjectWordCount,
    loadCharacterLines,
    loadIdeaSource,
    loadRealTrialDraft,
    loadTaskCenter,
    loadTimelineVolume,
    loading,
    loadingPreferences,
    localAppearanceDialog,
    locateConsistencyFinding,
    locateLegacyCharacterConflict,
    manifestChapterSelections,
    manifestRoles,
    manualSourceCount,
    manualSources,
    manuscriptConflictView,
    manuscriptInsertionAnchor,
    manuscriptRecoveryBusyId,
    manuscriptRecoveryItems,
    manuscriptSaveErrorMessage,
    manuscriptSelection,
    markManuscriptAsManualEdit,
    markPlanningChapterDetailEdited,
    markPlanningCharacterSeedsEdited,
    markPlanningCheatSystemEdited,
    markPlanningPowerSystemEdited,
    markPlanningSkeletonEdited,
    markPlanningTotalEdited,
    markPlanningVolumeOutlineEdited,
    markPlanningVolumeStructureEdited,
    markPlanningWorldSeedEdited,
    materialSearch,
    materialSection,
    materialSectionInfo,
    migrateProject,
    migrationPreview,
    modelChoices,
    modelSettingsDirty,
    moveManifestFile,
    moveTimelineEvent,
    nameCurrentRevision,
    navigateAssistantWorkspace,
    newChapter,
    newProjectGuide,
    nextPlanningChapterDetailCandidate,
    nextPlanningDetailVolume,
    nextPlanningVolumeCandidate,
    noteCompanionTyping,
    noteExplorerScroll,
    oneOffConnections,
    openAppearanceSettings,
    openChapterCard,
    openChapterCardAdoption,
    openChapterFromOutlineCatalog,
    openChapterOutlineReview,
    openChapterTrash,
    openCharacterAtlasChapter,
    openChronicleMap,
    openCompanionSettings,
    openConsistencyItem,
    openContinuationChapterOutlineAdoption,
    openContinuationCharacterEditor,
    openContinuationCheatSystemAdoption,
    openContinuationExistingPlotAdoption,
    openContinuationPowerSystemAdoption,
    openContinuationProjectDefinitionAdoption,
    openContinuationTotalOutlineAdoption,
    openContinuationVolumeOutlineAdoption,
    openContinuationWorldViewAdoption,
    openCreateProject,
    openForeshadowChapter,
    openForeshadows,
    openIdea,
    openLibraryChapter,
    openLibraryModels,
    openManuscriptSelectionAiMenu,
    openOutlineExpansion,
    openOutlineRecoveryShelf,
    openPlanningChapterDetailAdoption,
    openPlanningCharacterSeedAdoption,
    openPlanningCheatSystemAdoption,
    openPlanningPowerSystemAdoption,
    openPlanningRequirement,
    openPlanningTotalAdoption,
    openPlanningVolumeCreator,
    openPlanningVolumeOutlineAdoption,
    openPlanningVolumeStructure,
    openPlanningWorldSeedAdoption,
    openProject,
    openQuickChapter,
    openQuickChapterSearch,
    openRevisions,
    openShelfOutline,
    openSourceCard,
    openSqliteActivation,
    openSqliteShadowMigration,
    openStageOutline,
    openSystemTrash,
    openTimelineVolumeInOutline,
    openTotalOutlineReview,
    openTxtImport,
    openVolumeOutline,
    openVolumeOutlineReview,
    openWorkspaceRestore,
    openWorldMapCharacter,
    openWorldMapEvent,
    openWritingAgentQuickAction,
    openWritingChecks,
    opening,
    outlineComposing,
    outlineDocumentLocked,
    outlineFullCatalog,
    outlineInspectorOpen,
    outlineLoading,
    outlineMode,
    outlineOpenError,
    outlinePlanning,
    outlinePlanningIssue,
    outlineRecoveryDrafts,
    outlineRecoveryShelfError,
    outlineStorageDescription,
    outlineStorageFeedback,
    outlineStorageKey,
    outlineVolumeDialog,
    partialCreation,
    partialImportCreation,
    pauseWritingAgentTask,
    pendingCharacterConflicts,
    plannedChapter,
    plannedChapterBusy,
    plannedChapterComposing,
    plannedChapterContent,
    plannedChapterDirty,
    plannedChapterError,
    plannedChapterStarting,
    plannedChapterTitle,
    plannedOutlineRecovery,
    plannedOutlineRecoveryError,
    planningAdoptionBusy,
    planningAdoptionGuidance,
    planningAdoptionMarker,
    planningAdoptionPreview,
    planningAdoptionStageLabel,
    planningApprovalLabel,
    planningChapterDetailPreview,
    planningCharacterSeedPreview,
    planningCheatSystemPreview,
    planningDetailJob,
    planningDetailRunning,
    planningDetailStatuses,
    planningDraft,
    planningDraftSaveState,
    planningFoundationAdoptedCount,
    planningFoundationReady,
    planningJob,
    planningMaterialsReady,
    planningOutlineApproval,
    planningOutlineDirty,
    planningOutlineReview,
    planningPowerSystemPreview,
    planningReviewLabel,
    planningRunning,
    planningSkeletonRunning,
    planningSkeletonStatus,
    planningSkeletonVolumes,
    planningStageLabel,
    planningTotalConfirmed,
    planningVolumeOutlinePreview,
    planningVolumeStructurePreview,
    planningVolumesConfirmed,
    planningWorldSeedPreview,
    powerSystem,
    preparationMode,
    previewContinuationCharacterImpact,
    previewOutlineExpansionAdoption,
    previewWritingAgentContext,
    primaryDestination,
    profileStatus,
    profileStatusLabel,
    projectTrashConfirmation,
    projectTrashTarget,
    projectWordCount,
    projects,
    projectsLoaded,
    promoteIdeaToSummary,
    promoteIdeaToWorldRule,
    promptDraft,
    promptDraftDirty,
    promptProfile,
    quickChapterItems,
    realTrialAvailableChapters,
    realTrialChapterId,
    realTrialConclusionDraft,
    realTrialDraft,
    realTrialExistingRecord,
    realTrialIssue,
    realTrialReport,
    realTrialSelectedChapter,
    realms,
    rebuildReadableMirrors,
    recentlyTrashedProject,
    recheckSavedManuscript,
    recordForeshadowAction,
    recoverCompanionDefaults,
    recoverDamagedPlanningDraft,
    recoverDamagedPromptProfile,
    recoverExternalMarkdownMirror,
    recoverableWritingAgentTasks,
    recoveryBusyId,
    refreshFindingHistory,
    refreshLocalModels,
    refreshModelAssignments,
    modelReturnLabel,
    returnFromModelSettings,
    refreshOutlineRecoveryShelf,
    refreshWorkflow,
    reloadOutlineExpansionView,
    reloadPlannedChapter,
    removeTimelineEvent,
    renameOutlineVolume,
    replayOpening,
    requestDeleteChapter,
    requestTrashProject,
    researchEventsIssue,
    researchQuery,
    researchResult,
    researchSettings,
    researchSourcesIssue,
    resetAppearancePreferences,
    resetContextEvidencePreferences,
    resetPromptOverride,
    resizeAssistantByKeyboard,
    resizeExplorerByKeyboard,
    resolveOutlineLeaveChoice,
    resourceLedger,
    resourceLedgerDraft,
    restoreDeletedChapter,
    restoreManuscriptRecovery,
    restorePlannedOutlineRecovery,
    restoreRevision,
    resumeImportManifest,
    resumeWritingAgentTask,
    retryBootModels,
    retryFactExtraction,
    retryIdeaGeneration,
    retryOutlineExpansion,
    retryOutlineOpen,
    retrySqliteMirrors,
    retryWritingAgentTask,
    returnToManuscript,
    workspaceRecoveryBusy, workspaceRecoveryFeedback, recheckWorkspaceIssues,
    workspaceIssueDiagnostic, copyWorkspaceIssueDiagnostic,
    revealBootstrapIssue,
    reviewCanonicalEvents,
    revisionDiffSummary,
    revisionLabelDraft,
    revisionReasonLabels,
    revisionViewMode,
    revisions,
    rollbackSqliteStorage,
    runAutomaticBackup,
    runOutlineExpansion,
    runResearch,
    runWritingAgent,
    saveAppearancePreferences,
    saveAutoBackupPreferences,
    saveBookProfile,
    saveBookProfileAndContinue,
    saveChapter,
    refreshSavedChapterInfo,
    saveChapterCard,
    saveChapterOutline,
    saveChapterSummary,
    saveCharacterAliases,
    saveContextBudgetPreferences,
    saveContinuationAnalysis,
    saveFoundation,
    saveIdea,
    saveOutline,
    savePromptOverride,
    saveRealTrialChapter,
    saveRealTrialConclusion,
    saveRealms,
    saveResearchSettings,
    saveSourceCard,
    saveStageOutline,
    saveState,
    saveStoryEntity,
    saveStoryEntityRelation,
    saveSystemTemplate,
    saveTimeline,
    saveVolumeOutline,
    saveWritingPreferences,
    sectionNavigation,
    selectChapter,
    selectPromptTask,
    selectSettingsCategory,
    selectSettingsSection,
    selectTheme,
    selectWorkspaceLeaf,
    selectWorkspaceParent,
    selectedChapterPosition,
    selectedChapterRecord,
    selectedChapterStage,
    selectedChapterVolume,
    selectedCharacterLine,
    selectedCharacterLineId,
    selectedEventSource,
    selectedForeshadow,
    selectedForeshadowActions,
    selectedForeshadowId,
    selectedId,
    selectedIdea,
    selectedIdeaGenerations,
    selectedIdeaId,
    selectedIdeaSourceOption,
    selectedPromptEntry,
    selectedPromptTask,
    selectedResourceBalance,
    selectedResourceEntries,
    selectedRevision,
    selectedRevisionChanges,
    selectedRevisionDiff,
    selectedRevisionId,
    selectedSource,
    selectedSourceId,
    selectedStage,
    selectedStageMeta,
    selectedTimelineVolume,
    selectedTimelineVolumeMeta,
    selectedVolume,
    selectedVolumeMeta,
    selectedVolumeStages,
    sendAssistantProse,
    setChapterPlacement,
    setChapterStage,
    setCompanionProjectSpecific,
    setEventPlacement,
    settingsSearch,
    settingsSearchResults,
    settingsSection,
    showCharacterConflicts,
    showCreate,
    showDeleteConfirm,
    showRevisions,
    showTxtImport,
    skipBootModels,
    sourceCards,
    sourceDraft,
    sourceDraftDirty,
    sourceOriginLabel,
    sqliteActivationPreview,
    sqliteActivationResult,
    sqliteShadowPreview,
    sqliteShadowResult,
    sqliteStorageStatus,
    stageDraftTitle,
    stageOutline,
    stageOutlines,
    stageTitle,
    startAutomaticPlanning,
    startConsistencyEvaluation,
    startIdea,
    startIdeaGeneration,
    startPlannedChapter,
    startPlanningChapterDetail,
    startPlanningChapterSkeleton,
    startSourceCard,
    stopIdeaGeneration,
    storyEntities,
    storyEntitiesLoaded,
    storyEntityDraft,
    storyEntityRelations,
    storyRelationDraft,
    studioStyle,
    submitPlanningVolume,
    systemTemplate,
    taskCenterBusyId,
    taskCenterItems,
    taskCenterLoading,
    themeChoice,
    themeError,
    timeline,
    eventProjection,
    unifiedEvents,
    archivedUnifiedEvents,
    unifiedEventCandidates,
    unifiedEventMode,
    eventMigrationState,
    eventMigrationBusy,
    eventMigrationError,
    timelineAiCandidates,
    timelineAiGenerating,
    timelineEntryCount,
    timelineEntryId,
    timelineMode,
    timelineVolumeCards,
    timelineVolumeContent,
    timelineVolumeError,
    timelineVolumeLoading,
    toast,
    toggleGuidance,
    toggleTimelineEntry,
    totalOutline,
    trashProject,
    trialPercent,
    txtCanImport,
    txtImport,
    txtImportEntry,
    txtPreview,
    updateChronicleField,
    updateCompanionOptions,
    updateContextEvidencePreference,
    updateLibraryAppearance,
    updateManuscriptAnchor,
    updateManuscriptSelection,
    updatePlanningChapterDetailList,
    updateSkeletonCharacters,
    useLocalModel,
    visibleMaterialSources,
    visibleWritingAgentTurns,
    volumeDraft,
    volumeLineRange,
    volumeLineStatus,
    volumeOutline,
    webSourceCount,
    webSources,
    workflowStatus,
    workspaceBackupResult,
    workspaceBootstrapIssues,
    workspaceLeafTestId,
    workspaceLoadError,
    workspaceOpening,
    workspaceRestorePreview,
    worldMapAdopting,
    worldMapBackground,
    worldMapBackgroundError,
    worldMapCandidate,
    worldMapDirty,
    worldMapError,
    worldMapGenerating,
    worldMapGenerationError,
    worldMapLoading,
    worldMapSaveError,
    worldMapSaving,
    worldMapView,
    worldMapWorkspace,
    writingAgentApplyingTurnId,
    writingAgentContextPreview,
    writingAgentContextPreviewBusy,
    writingAgentModelChoices,
    writingAgentQuickAction,
    writingAgentRunning,
    writingRebase,
    writingRebaseBusy
  }
}
