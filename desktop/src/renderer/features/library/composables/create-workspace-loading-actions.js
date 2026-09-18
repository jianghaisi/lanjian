import { preferredChapterForOpen } from '../../../../contracts/manuscript/chapter-tree-window'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createLibraryWorkspaceLoadingActions(ports) {
  function resetWorkItemTransientState() {
    ports.resetPlannedChapter()
    ports.newProjectGuide.value = null
    ports.chapterTrashOpen.value = false
    ports.chapterTrashEntries.value = []
    ports.chapterDeleteTarget.value = null
    ports.showDeleteConfirm.value = false
    ports.chapterSelectionGeneration += 1
    ports.workspaceRefreshGeneration += 1
    ports.workspaceLoadError.value = ''
    ports.workspaceBootstrapIssues.value = []
    ports.chapters.value = []
    ports.selectedId.value = null
    ports.stageOutlines.value = []
    ports.selectedStage.value = null
    ports.stageTitle.value = ''
    ports.stageOutline.value = ''
    ports.lastSavedStageTitle.value = ''
    ports.lastSavedStageOutline.value = ''
    ports.stageDraftTitle.value = ''
    ports.chapterTitle.value = ''
    ports.chapterContent.value = ''
    ports.manuscriptSaveError.value = null
    ports.manuscriptConflict.value = null
    ports.migrationPreview.value = null
    ports.sqliteStorageStatus.value = null
    ports.outlineStorageFeedback.reset()
    ports.sqliteActivationPreview.value = null
    ports.sqliteActivationResult.value = null
    ports.workspaceBackupResult.value = null
    ports.consistencyEvaluationSummary.value = null
    ports.consistencyEvaluationJob.value = null
    if (ports.consistencyEvaluationPollTimer) window.clearTimeout(ports.consistencyEvaluationPollTimer)
    ports.consistencyEvaluationPollTimer = 0
    ports.realTrialReport.value = null
    ports.realTrialIssue.value = ''
    ports.realTrialChapterId.value = null
    ports.realTrialDraft.value = ports.realTrialDraftDefaults()
    ports.realTrialConclusionDraft.value = ports.realTrialConclusionDefaults()
    ports.workspaceRestorePreview.value = null
    ports.autoBackupStatus.value = {
      enabled: false,
      targetParentPath: '',
      backupOnFirstOpen: true,
      intervalMinutes: 30,
      retentionCount: 10,
      lastCheckedAt: null,
      lastSuccessAt: null,
      nextDueAt: null,
      lastError: null,
      lastResult: null,
      state: 'disabled'
    }
    ports.autoBackupDraft.value = {
      enabled: false,
      targetParentPath: '',
      backupOnFirstOpen: true,
      intervalMinutes: 30,
      retentionCount: 10
    }
    ports.autoBackupRunning.value = false
    ports.autoBackupLoading.value = false
    ports.autoBackupDraftDirty.value = false
    ports.autoBackupRefreshGeneration += 1
    ports.autoBackupSettingsLoadGeneration += 1
    ports.pendingCharacterSettlements.value = {}
    ports.pendingAiSourceTaskIds.value = {}
    ports.writingAgentTurns.value = []
    ports.writingAgentTasks.value = []
    ports.writingAgentRunning.value = false
    ports.writingAgentContextPreview.value = null
    ports.writingAgentContextPreviewBusy.value = false
    ports.manuscriptSelection.value = null
    ports.manuscriptInsertionAnchor.value = null
    ports.chapterPlanning.value = null
    ports.chapterCardOpen.value = false
    ports.chapterCardAdoption.value = null
    ports.foundationDraft.value = null
    ports.timelineMode.value = 'events'
    ports.worldMapWorkspace.reset()
    ports.expandedTimelineEntry.value = ''
    ports.timelineAiCandidates.value = []
    ports.timelineAiGenerating.value = false
    ports.characterLines.value = { version: 1, workItemId: '', source: 'legacy-accepted-prose', lines: [] }
    ports.characterLinesLoaded.value = false
    ports.characterLinesLoading.value = false
    ports.characterLinesError.value = ''
    ports.characterLinesRefreshGeneration += 1
    ports.characterDisplayMode.value = 'cards'
    ports.characterAtlasThroughPosition.value = null
    ports.characterAtlasInitialized = false
    ports.selectedCharacterLineId.value = ''
    ports.selectedTimelineVolume.value = 0
    ports.timelineVolumeContent.value = ''
    ports.timelineVolumeLoading.value = false
    ports.foreshadowLedger.value = { foreshadows: [], actions: [] }
    ports.foreshadowLedgerLoaded.value = false
    ports.selectedForeshadowId.value = ''
    ports.foreshadowDraft.value = { action: 'plant', title: '', foreshadowId: '', legacyChapterId: '', description: '' }
    ports.clearPlanningPoll()
    ports.clearPlanningSkeletonPoll()
    ports.clearPlanningDetailPoll()
    ports.clearPlanningDraftSave()
    ports.planningJob.value = null
    ports.planningSkeletonJob.value = null
    ports.planningSkeletonStatus.value = { exists: false, stale: false, chapterCount: 0, volumeCount: 0 }
    ports.planningDetailJob.value = null
    ports.planningDetailStatuses.value = []
    ports.planningDraft.value = null
    ports.planningAdoptionPreview.value = null
    ports.planningVolumeStructurePreview.value = null
    ports.planningVolumeOutlinePreview.value = null
    ports.planningChapterDetailPreview.value = null
    ports.planningCharacterSeedPreview.value = null
    ports.planningWorldSeedPreview.value = null
    ports.planningPowerSystemPreview.value = null
    ports.planningCheatSystemPreview.value = null
    ports.planningDraftSaveState.value = 'saved'
    ports.promptProfile.value = null
    ports.promptDraft.value = ''
    ports.workflowStatus.value = null
    ports.consistencyOverview.value = null
    ports.chapterDerivatives.value = null
    ports.contextFactPack.value = null
    ports.factBatches.value = []
    ports.factExtractionRetryId.value = ''
    ports.factExtractionRawResult.value = ''
    ports.characterState.value = null
    ports.showCharacterConflicts.value = false
    ports.dismissingConflictId.value = ''
    ports.importRecoveries.value = []
    ports.recoveryBusyId.value = ''
    ports.continuationAnalysis.value = null
    ports.continuationManifestId.value = ''
    ports.continuationBlockedReason.value = ''
    ports.continuationProjectDefinitionPreview.value = null
    ports.continuationExistingPlotPreview.value = null
    ports.continuationCharacterEditorOpen.value = false
    ports.continuationCharacterPreview.value = null
    ports.continuationWorldViewPreview.value = null
    ports.continuationPowerSystemPreview.value = null
    ports.continuationCheatSystemPreview.value = null
    ports.continuationTotalOutlinePreview.value = null
    ports.continuationVolumeOutlinePreview.value = null
    ports.continuationVolumeTarget.value = 0
    ports.continuationChapterOutlinePreview.value = null
    ports.continuationChapterTarget.value = 0
  }

  async function loadWorkspace(
    existingRequest = null,
    preferredChapterId = ports.selectedId.value || ports.current.value?.manuscript?.lastEditedChapter?.id || null
  ) {
    if (!ports.current.value) return false
    const request = existingRequest || ports.workspaceRequests.begin(ports.current.value)
    ports.workspaceLoadError.value = ''
    ports.setWorkspaceOpeningPhase('database')
    // Storage status is independent from the compound workspace snapshot. Start
    // both reads together so a large manuscript does not pay two cold-start
    // round trips before the first chapter can render.
    const storageStatusLoad = ports.desktop.projects.sqliteStorageStatus().catch(() => null)
    const bootstrap = await ports.desktop.workspace.bootstrap()
    if (
      !ports.workspaceRequests.isCurrent(request, ports.current.value) ||
      bootstrap.workItem.id !== request.workItemId ||
      bootstrap.workItem.path !== request.path
    )
      return false
    ports.setWorkspaceOpeningPhase('workspace')
    ports.chapters.value = bootstrap.chapters
    ports.totalOutline.value = bootstrap.outlines.total?.content || ''
    ports.lastSavedTotalOutline.value = ports.totalOutline.value
    ports.selectedVolume.value = bootstrap.outlines.volumes[0]?.volume || null
    ports.volumeOutline.value = bootstrap.outlines.volumes[0]?.content || ''
    ports.lastSavedVolumeOutline.value = ports.volumeOutline.value
    ports.stageOutlines.value = bootstrap.outlines.stages || []
    ports.standaloneOutlineEntries.value = bootstrap.outlines.chapterOutlines || []
    ports.selectedStage.value = null
    ports.stageTitle.value = ''
    ports.stageOutline.value = ''
    ports.lastSavedStageTitle.value = ''
    ports.lastSavedStageOutline.value = ''
    ports.timeline.value = bootstrap.timeline.events
    ports.realms.value = bootstrap.realms.levels
    ports.powerSystem.value = bootstrap.powerSystem
    ports.cheatSystem.value = bootstrap.cheatSystem
    ports.systemTemplate.value = bootstrap.systemTemplate.template
    ports.foundation.value = bootstrap.foundation
    ports.bookProfile.value = bootstrap.bookProfile
    ports.profileSavedSnapshot.value = JSON.stringify(ports.bookProfile.value)
    ports.profileSaveProgress.value = 'saved'
    ports.profileSavedAt.value = null
    ports.ai.value = bootstrap.aiSettings
      ? {
          ...bootstrap.aiSettings,
          connections: bootstrap.aiSettings.connections.map((connection) => ({
            ...connection,
            apiKey: '',
            clearApiKey: false
          }))
        }
      : {
          version: 3,
          connections: [],
          apiKeyConfigured: false,
          modelConfigured: false,
          routingMode: 'shared',
          shared: ports.modelDefaults(),
          tasks: Object.fromEntries(Object.keys(ports.taskLabels).map((task) => [task, ports.modelDefaults()]))
        }
    void ports.refreshOneOffConnections()
    ports.removedAiConnectionIds.value = []
    ports.aiCatalogRefreshGeneration += 1
    ports.availableModelsByConnection.value = {}
    ports.aiCatalogLoading.value = false
    ports.aiCatalogUnavailableConnectionIds.value = []
    ports.aiConnectionResult.value = null
    ports.aiModelChecks.value = []
    ports.aiConnectionDeletePreview.value = null
    ports.aiCredentialClearPreview.value = null
    ports.researchSettings.value = { ...bootstrap.researchSettings, apiKey: '' }
    ports.migrationPreview.value = bootstrap.migration
    ports.sqliteStorageStatus.value = await storageStatusLoad
    const ideasLoad =
      ports.sqliteStorageStatus.value?.storageMode === 'sqlite' && ports.desktop.workspace.listIdeas
        ? ports.desktop.workspace.listIdeas().catch(() => [])
        : Promise.resolve([])
    ports.clearIdeaGenerationPoll()
    ports.ideaGenerations.value = []
    ports.ideaSourceLoad += 1
    ports.ideaSourceTask.value = null
    ports.ideaSourceIssue.value = ''
    ports.ideaGenerationInstruction.value = ''
    ports.selectedIdeaId.value = ''
    ports.creatingIdea.value = false
    ports.ideaDraft.value = { title: '', content: '', status: 'candidate' }
    ports.sourceCards.value = bootstrap.sources.sources
    ports.canonicalEvents.value = bootstrap.events.events
    ports.planningDraft.value = bootstrap.planningDraft
    ports.workspaceBootstrapIssues.value = bootstrap.issues
    ports.planningDraftSaveState.value = 'saved'
    ports.promptProfile.value = bootstrap.promptProfile
    ports.importRecoveries.value = bootstrap.importRecoveries
    ports.continuationAnalysis.value = bootstrap.continuation.candidate
    ports.continuationManifestId.value = bootstrap.continuation.availableManifestId || ''
    ports.continuationBlockedReason.value = bootstrap.continuation.blockedReason || ''
    ports.syncPromptDraft()
    ports.researchQuery.value = ''
    ports.researchResult.value = null
    // Backup settings are independent of the first chapter projection. Start
    // that read early, but keep recovery discovery after the editor identity is
    // established so the active manuscript is never mistaken for a crash draft.
    const autoBackupLoad = ports.refreshAutoBackup()
    ports.setWorkspaceOpeningPhase('chapter')
    const preferredChapter = preferredChapterForOpen(ports.chapters.value, preferredChapterId)
    if (preferredChapter) await ports.selectChapter(preferredChapter, request)
    else await ports.refreshWorkflow(request)
    const loadedIdeas = await ideasLoad
    if (!ports.workspaceRequests.isCurrent(request, ports.current.value)) return false
    ports.ideas.value = loadedIdeas
    ports.setWorkspaceOpeningPhase('recovery')
    await ports.refreshManuscriptRecoveries()
    await autoBackupLoad
    void ports.runAutomaticBackup(false)
    if (ports.workspaceRequests.isCurrent(request, ports.current.value)) void ports.outlineStorageFeedback.refresh()
    ports.setWorkspaceOpeningPhase('ready')
    return ports.workspaceRequests.isCurrent(request, ports.current.value)
  }

  return { resetWorkItemTransientState, loadWorkspace }
}
