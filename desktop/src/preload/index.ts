import { contextBridge, ipcRenderer } from 'electron'
import { exposeDesktopPetBridge } from './desktop-pet-bridge'
import { createCompanionVoiceBridge } from './companion-voice-bridge'
import { createModelConnectionsBridge } from './model-connections-bridge'
import type { DesktopApi } from '../contracts/index'
import { unwrapValidatedIpcResponse } from '../contracts/core/ipc-response'

exposeDesktopPetBridge(true)

const invokeValidated = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
  const response: unknown = await ipcRenderer.invoke(channel, ...args)
  // Reject with a plain structured-cloneable DTO. Electron strips custom
  // properties from Error objects crossing contextBridge, including the
  // conflict code and safe recovery details needed by the renderer.
  return unwrapValidatedIpcResponse<T>(channel, response)
}

// Values arriving through contextBridge can still be Vue reactive proxies. Convert
// declared JSON DTOs to plain data before Electron's structured-clone boundary.
const plainDto = <T>(value: T): T => value === undefined
  ? value
  : JSON.parse(JSON.stringify(value)) as T

let windowShown = false
const windowShownListeners = new Set<() => void>()
ipcRenderer.on('app:window-shown', () => {
  windowShown = true
  for (const listener of windowShownListeners) listener()
})

const desktopApi: DesktopApi = {
  modelConnections: createModelConnectionsBridge(invokeValidated),
  localModels: {list:()=>invokeValidated('local-models:list'), inspect:modelId=>invokeValidated('local-models:inspect',modelId), cancel:modelId=>invokeValidated('local-models:cancel',modelId)},
  companionVoice: createCompanionVoiceBridge(),
  fieldAssistant: {
    conversation: input => invokeValidated('assistant:conversation',plainDto(input)),
    cancelConversation: operationId => invokeValidated('assistant:cancel-conversation',operationId),
    conversationProgress: operationId => invokeValidated('assistant:conversation-progress',operationId),
    applicationModel: () => invokeValidated('assistant:application-model'),
    saveApplicationModel: input => invokeValidated('assistant:save-application-model', plainDto(input)),
    preview: input => invokeValidated('assistant:preview-field', plainDto(input)),
    start: input => invokeValidated('assistant:start-field', plainDto(input)),
    task: id => invokeValidated('assistant:field-task', id),
    cancel: id => invokeValidated('assistant:cancel-field', id),
    recent: scope => invokeValidated('assistant:recent-fields', scope),
    prepareApplication: input => invokeValidated('assistant:prepare-field', plainDto(input)),
    acknowledge: input => invokeValidated('assistant:acknowledge-field', plainDto(input))
  },
  app: {
    version: () => invokeValidated('app:version'),
    onWindowShown: (listener) => {
      windowShownListeners.add(listener)
      if (windowShown) queueMicrotask(listener)
      return () => windowShownListeners.delete(listener)
    },
    onBeforeClose: (listener) => {
      const callback = () => listener()
      ipcRenderer.on('app:before-close', callback)
      return () => ipcRenderer.removeListener('app:before-close', callback)
    },
    readyToClose: (success) => ipcRenderer.send('app:close-ready', success),
    showSelectionAiMenu: () => ipcRenderer.send('app:show-selection-ai-menu'),
    onSelectionAiAction: (listener) => {
      const allowed = new Set(['rewrite', 'expand', 'compress', 'custom', 'polish'])
      const callback = (_event: Electron.IpcRendererEvent, skill: unknown) => {
        if (typeof skill === 'string' && allowed.has(skill)) listener(skill as 'rewrite' | 'expand' | 'compress' | 'custom' | 'polish')
      }
      ipcRenderer.on('app:selection-ai-action', callback)
      return () => ipcRenderer.removeListener('app:selection-ai-action', callback)
    }
  },
  projects: {
    libraryOutlinePreview: (input) => invokeValidated('projects:library-outline-preview', plainDto(input)),
    list: () => invokeValidated('projects:list'),
    create: (input) => invokeValidated('projects:create', plainDto(input)),
    importProject: (path) => invokeValidated('projects:import', path),
    chooseDirectory: () => invokeValidated('projects:choose-directory'),
    switch: (path) => invokeValidated('projects:switch', path),
    removeRecent: (id) => invokeValidated('projects:remove-recent', id),
    trash: (path) => invokeValidated('projects:trash', path),
    openTrash: () => invokeValidated('projects:open-trash'),
    status: () => invokeValidated('projects:status'),
    migrationPreview: () => invokeValidated('projects:migration-preview'),
    migrate: () => invokeValidated('projects:migrate'),
    previewSqliteShadowMigration: () => invokeValidated('projects:sqlite-shadow-preview'),
    importSqliteShadowMigration: (token) => invokeValidated('projects:sqlite-shadow-import', token),
    sqliteStorageStatus: () => invokeValidated('projects:sqlite-storage-status'),
    previewSqliteActivation: () => invokeValidated('projects:sqlite-activation-preview'),
    activateSqliteStorage: (token) => invokeValidated('projects:sqlite-activation-commit', token),
    retrySqliteMirrors: () => invokeValidated('projects:sqlite-mirrors-retry'),
    rebuildReadableMirrors: () => invokeValidated('projects:readable-mirrors-rebuild'),
    rollbackSqliteStorage: () => invokeValidated('projects:sqlite-storage-rollback'),
    createWorkspaceBackup: () => invokeValidated('projects:workspace-backup-create'),
    exportManuscript: () => invokeValidated('projects:manuscript-export'),
    realTrialReport: () => invokeValidated('projects:real-trial-report'),
    saveRealTrialChapter: (input) => invokeValidated('projects:save-real-trial-chapter', plainDto(input)),
    saveRealTrialConclusion: (input) => invokeValidated('projects:save-real-trial-conclusion', plainDto(input)),
    getAutoBackup: () => invokeValidated('projects:auto-backup-get'),
    chooseAutoBackupDirectory: () => invokeValidated('projects:auto-backup-choose-directory'),
    updateAutoBackup: (input) => invokeValidated('projects:auto-backup-update', plainDto(input)),
    runAutoBackup: (force) => invokeValidated('projects:auto-backup-run', force),
    previewWorkspaceRestore: () => invokeValidated('projects:workspace-restore-preview'),
    restoreWorkspaceBackup: (token) => invokeValidated('projects:workspace-restore-commit', token)
  },
  chapters: {
    create: () => invokeValidated('chapters:create'),
    list: () => invokeValidated('chapters:list'),
    get: (id) => invokeValidated('chapters:get', id),
    update: (id, data) => invokeValidated('chapters:update', id, plainDto(data)),
    stageAutosave: (id, data) => invokeValidated('chapters:autosave-stage', id, plainDto(data)),
    finalizeAutosave: (checkpointId) => invokeValidated('chapters:autosave-finalize', checkpointId),
    autosaveRecoveries: () => invokeValidated('chapters:autosave-recoveries'),
    discardAutosaveRecovery: (checkpointId) => invokeValidated('chapters:autosave-discard', checkpointId),
    preserveDraft: (id, data) => invokeValidated('chapters:preserve-draft', id, plainDto(data)),
    reorder: (id, position) => invokeValidated('chapters:reorder', id, position),
    delete: (id) => invokeValidated('chapters:delete', id),
    trashList: () => invokeValidated('chapters:trash-list'),
    restore: (id) => invokeValidated('chapters:restore', id),
    stats: () => invokeValidated('chapters:stats'),
    revisions: (id) => invokeValidated('chapters:revisions', id),
    nameCurrentRevision: (id, label) => invokeValidated('chapters:name-current-revision', id, label),
    restoreRevision: (id, revisionId) => invokeValidated('chapters:restore-revision', id, revisionId),
    previewExternalMirror: (id) => invokeValidated('chapters:preview-external-mirror', id),
    adoptExternalMirror: (token) => invokeValidated('chapters:adopt-external-mirror', token),
    getPlanning: (id) => invokeValidated('chapters:get-planning', id),
    updatePlanning: (id, input) => invokeValidated('chapters:update-planning', id, plainDto(input))
  },
  imports: {
    chooseText: () => invokeValidated('imports:choose-text'),
    chooseDocuments: () => invokeValidated('imports:choose-documents'),
    appendDocuments: (manifestId) => invokeValidated('imports:append-documents', manifestId),
    commitText: (input) => invokeValidated('imports:commit-text', plainDto(input)),
    commitManifest: (input) => invokeValidated('imports:commit-manifest', plainDto(input)),
    recoverableManifests: () => invokeValidated('imports:recoverable-manifests'),
    resumeManifest: (id) => invokeValidated('imports:resume-manifest', id),
    continuationAnalysis: () => invokeValidated('imports:continuation-analysis'),
    generateContinuationAnalysis: (manifestId) => invokeValidated('imports:generate-continuation-analysis', manifestId),
    saveContinuationAnalysis: (input) => invokeValidated('imports:save-continuation-analysis', plainDto(input)),
    previewContinuationProjectDefinition: (candidateId) => invokeValidated('imports:preview-continuation-project-definition', candidateId),
    adoptContinuationProjectDefinition: (input) => invokeValidated('imports:adopt-continuation-project-definition', plainDto(input)),
    previewContinuationExistingPlot: (candidateId) => invokeValidated('imports:preview-continuation-existing-plot', candidateId),
    adoptContinuationExistingPlot: (input) => invokeValidated('imports:adopt-continuation-existing-plot', plainDto(input)),
    previewContinuationCharacter: (input) => invokeValidated('imports:preview-continuation-character', plainDto(input)),
    adoptContinuationCharacter: (input) => invokeValidated('imports:adopt-continuation-character', plainDto(input)),
    previewContinuationWorldView: (candidateId) => invokeValidated('imports:preview-continuation-world-view', candidateId),
    adoptContinuationWorldView: (input) => invokeValidated('imports:adopt-continuation-world-view', plainDto(input)),
    previewContinuationPowerSystem: (candidateId) => invokeValidated('imports:preview-continuation-power-system', candidateId),
    adoptContinuationPowerSystem: (input) => invokeValidated('imports:adopt-continuation-power-system', plainDto(input)),
    previewContinuationCheatSystem: (candidateId) => invokeValidated('imports:preview-continuation-cheat-system', candidateId),
    adoptContinuationCheatSystem: (input) => invokeValidated('imports:adopt-continuation-cheat-system', plainDto(input)),
    previewContinuationTotalOutline: (candidateId) => invokeValidated('imports:preview-continuation-total-outline', candidateId),
    adoptContinuationTotalOutline: (input) => invokeValidated('imports:adopt-continuation-total-outline', plainDto(input)),
    previewContinuationVolumeOutline: (candidateId, volume) => invokeValidated('imports:preview-continuation-volume-outline', candidateId, volume),
    adoptContinuationVolumeOutline: (input) => invokeValidated('imports:adopt-continuation-volume-outline', plainDto(input)),
    previewContinuationChapterOutline: (candidateId, chapterId) => invokeValidated('imports:preview-continuation-chapter-outline', candidateId, chapterId),
    adoptContinuationChapterOutline: (input) => invokeValidated('imports:adopt-continuation-chapter-outline', plainDto(input))
  },
  outlines: {
    list: () => invokeValidated('outlines:list'),
    get: (volume) => invokeValidated('outlines:get', volume),
    update: (volume, content) => invokeValidated('outlines:update', volume, content),
    tree: () => invokeValidated('outlines:tree'),
    planningStatus: (chapterId) => invokeValidated('outlines:planning-status', chapterId),
    acknowledgeReview: (volume) => invokeValidated('outlines:acknowledge-review', volume),
    confirmPlanning: (volume) => invokeValidated('outlines:confirm-planning', volume),
    assignEvent: (eventId) => invokeValidated('outlines:assign-event', eventId),
    unassignEvent: (eventId) => invokeValidated('outlines:unassign-event', eventId),
    createVolume: (title) => invokeValidated('outlines:create-volume', title),
    renameVolume: (volume, title) => invokeValidated('outlines:rename-volume', volume, title),
    createStage: (volume, title) => invokeValidated('outlines:create-stage', volume, title),
    updateStage: (stage, title, content) => invokeValidated('outlines:update-stage', stage, title, content),
    getPlannedChapter: (id) => invokeValidated('outlines:get-planned-chapter', id),
    updatePlannedChapter: (input) => invokeValidated('outlines:update-planned-chapter', plainDto(input)),
    startPlannedChapter: (input) => invokeValidated('outlines:start-planned-chapter', plainDto(input)),
    placeChapterInStage: (chapterId, stage, volume) => invokeValidated('outlines:place-chapter-in-stage', chapterId, stage, volume),
    placeEvent: (eventId, volume) => invokeValidated('outlines:place-event', eventId, volume),
    placeEventInChapter: (eventId, chapterId) => invokeValidated('outlines:place-event-in-chapter', eventId, chapterId),
    placeChapter: (chapterId, volume) => invokeValidated('outlines:place-chapter', chapterId, volume),
    reviewChapter: (chapterId) => invokeValidated('outlines:review-chapter', chapterId),
    confirmChapter: (chapterId) => invokeValidated('outlines:confirm-chapter', chapterId)
  },
  chapterOutlines: {
    previewExternalMirror: (chapterId) => invokeValidated('chapter-outlines:preview-external-mirror', chapterId),
    adoptExternalMirror: (token) => invokeValidated('chapter-outlines:adopt-external-mirror', token),
    list: () => invokeValidated('chapter-outlines:list'),
    get: (chapterId) => invokeValidated('chapter-outlines:get', chapterId),
    update: (chapterId, content) => invokeValidated('chapter-outlines:update', chapterId, content)
  },
  ai: {
    getSettings: () => invokeValidated('ai:get-settings'),
    updateSettings: (input) => invokeValidated('ai:update-settings', plainDto(input)),
    listModels: (draft) => invokeValidated('ai:list-models', plainDto(draft)),
    testConnection: (draft) => invokeValidated('ai:test', plainDto(draft)),
    latestConsistencyEvaluation: () => invokeValidated('ai:latest-consistency-evaluation'),
    startConsistencyEvaluation: () => invokeValidated('ai:start-consistency-evaluation'),
    consistencyEvaluationJob: (jobId) => invokeValidated('ai:consistency-evaluation-job', jobId),
    cancelConsistencyEvaluation: (jobId) => invokeValidated('ai:cancel-consistency-evaluation', jobId),
    genres: () => invokeValidated('ai:genres'),
    complete: (instruction, draft, task, chapterId) => invokeValidated('ai:complete', instruction, draft, task, chapterId),
    runWritingAgent: (input) => invokeValidated('ai:run-writing-agent', plainDto(input)),
    previewWritingAgentContext: (input) => invokeValidated('ai:preview-writing-agent-context', plainDto(input)),
    startWritingAgent: (input) => invokeValidated('ai:start-writing-agent', plainDto(input)),
    writingAgentTask: (taskId) => invokeValidated('ai:writing-agent-task', taskId),
    listWritingAgentTasks: (chapterId) => invokeValidated('ai:list-writing-agent-tasks', chapterId),
    pauseWritingAgentTask: (taskId) => invokeValidated('ai:pause-writing-agent-task', taskId),
    resumeWritingAgentTask: (taskId, operationId) => invokeValidated('ai:resume-writing-agent-task', taskId, operationId),
    cancelWritingAgentTask: (taskId) => invokeValidated('ai:cancel-writing-agent-task', taskId),
    retryWritingAgentTask: (taskId, operationId) => invokeValidated('ai:retry-writing-agent-task', taskId, operationId),
    dismissWritingAgentTask: (taskId) => invokeValidated('ai:dismiss-writing-agent-task', taskId),
    decideWritingAgentArtifact: (input) => invokeValidated('ai:decide-writing-agent-artifact', plainDto(input)),
    applyWritingAgentArtifact: (input) => invokeValidated('ai:apply-writing-agent-artifact', plainDto(input)),
    settleWritingAgent: (turnId) => invokeValidated('ai:settle-writing-agent', turnId)
  },
  planning: {
    start: () => invokeValidated('planning:start'),
    job: (jobId) => invokeValidated('planning:job', jobId),
    cancel: (jobId) => invokeValidated('planning:cancel', jobId),
    draft: () => invokeValidated('planning:draft'),
    saveDraft: (proposal) => invokeValidated('planning:save-draft', plainDto(proposal)),
    discardDraft: () => invokeValidated('planning:discard-draft'),
    recoverDamagedDraft: () => invokeValidated('planning:recover-damaged-draft'),
    previewTotalAdoption: (proposalId) => invokeValidated('planning:preview-total-adoption', proposalId),
    adoptTotal: (input) => invokeValidated('planning:adopt-total', plainDto(input)),
    previewVolumeStructure: (proposalId) => invokeValidated('planning:preview-volume-structure', proposalId),
    initializeVolumeStructure: (input) => invokeValidated('planning:initialize-volume-structure', plainDto(input)),
    previewVolumeOutlineAdoption: (proposalId, order) => invokeValidated('planning:preview-volume-outline-adoption', proposalId, order),
    adoptVolumeOutline: (input) => invokeValidated('planning:adopt-volume-outline', plainDto(input)),
    previewChapterDetailAdoption: (proposalId, chapterId) => invokeValidated('planning:preview-chapter-detail-adoption', proposalId, chapterId),
    adoptChapterDetail: (input) => invokeValidated('planning:adopt-chapter-detail', plainDto(input)),
    previewCharacterSeedAdoption: (proposalId) => invokeValidated('planning:preview-character-seed-adoption', proposalId),
    adoptCharacterSeeds: (input) => invokeValidated('planning:adopt-character-seeds', plainDto(input)),
    previewWorldSeedAdoption: (proposalId) => invokeValidated('planning:preview-world-seed-adoption', proposalId),
    adoptWorldSeed: (input) => invokeValidated('planning:adopt-world-seed', plainDto(input)),
    previewPowerSystemAdoption: (proposalId) => invokeValidated('planning:preview-power-system-adoption', proposalId),
    adoptPowerSystem: (input) => invokeValidated('planning:adopt-power-system', plainDto(input)),
    previewCheatSystemAdoption: (proposalId) => invokeValidated('planning:preview-cheat-system-adoption', proposalId),
    adoptCheatSystem: (input) => invokeValidated('planning:adopt-cheat-system', plainDto(input)),
    chapterSkeletonStatus: (proposalId) => invokeValidated('planning:chapter-skeleton-status', proposalId),
    startChapterSkeleton: (proposalId) => invokeValidated('planning:start-chapter-skeleton', proposalId),
    chapterSkeletonJob: (jobId) => invokeValidated('planning:chapter-skeleton-job', jobId),
    cancelChapterSkeleton: (jobId) => invokeValidated('planning:cancel-chapter-skeleton', jobId),
    chapterDetailStatuses: (proposalId) => invokeValidated('planning:chapter-detail-statuses', proposalId),
    startChapterDetail: (proposalId, volume) => invokeValidated('planning:start-chapter-detail', proposalId, volume),
    chapterDetailJob: (jobId) => invokeValidated('planning:chapter-detail-job', jobId),
    cancelChapterDetail: (jobId) => invokeValidated('planning:cancel-chapter-detail', jobId)
  },
  research: {
    getSettings: () => invokeValidated('research:get-settings'),
    updateSettings: (input) => invokeValidated('research:update-settings', plainDto(input)),
    search: (query) => invokeValidated('research:search', query),
    listSources: () => invokeValidated('research:list-sources'),
    createSource: (input) => invokeValidated('research:create-source', plainDto(input)),
    updateSource: (id, input) => invokeValidated('research:update-source', id, plainDto(input)),
    listEvents: () => invokeValidated('research:list-events'),
    createEventCandidate: (input) => invokeValidated('research:create-event-candidate', plainDto(input)),
    approveEvent: (id) => invokeValidated('research:approve-event', id)
  },
  workspace: {
    bootstrap: () => invokeValidated('workspace:bootstrap'),
    listTaskCenter: () => invokeValidated('workspace:list-task-center'),
    getBookProfile: () => invokeValidated('workspace:get-book-profile'),
    saveBookProfile: (data) => invokeValidated('workspace:save-book-profile', plainDto(data)),
    getContextBudgetPreferences: () => invokeValidated('workspace:get-context-budget-preferences'),
    saveContextBudgetPreferences: (data) => invokeValidated('workspace:save-context-budget-preferences', plainDto(data)),
    generateFoundationDraft: () => invokeValidated('workspace:generate-foundation-draft'),
    getFoundation: () => invokeValidated('workspace:get-foundation'),
    saveFoundation: (data) => invokeValidated('workspace:save-foundation', plainDto(data)),
    getFoundationStatus: (chapterId) => invokeValidated('workspace:get-foundation-status', chapterId),
    getChapterProjection: (chapterId) => invokeValidated('workspace:get-chapter-projection', chapterId),
    getWorkflowStatus: (chapterId) => invokeValidated('workspace:get-workflow-status', chapterId),
    getConsistencyOverview: (chapterId) => invokeValidated('workspace:get-consistency-overview', chapterId),
    getContextFactPack: (chapterId) => invokeValidated('workspace:get-context-fact-pack', chapterId),
    listFactBatches: (chapterId) => invokeValidated('workspace:list-fact-batches', chapterId),
    decideFactChanges: (input) => invokeValidated('workspace:decide-fact-changes', plainDto(input)),
    decideConsistencyFinding: (input) => invokeValidated('workspace:decide-consistency-finding', plainDto(input)),
    saveChapterSummary: (input) => invokeValidated('workspace:save-chapter-summary', plainDto(input)),
    getChapterSummary: (chapterId) => invokeValidated('workspace:get-chapter-summary', chapterId),
    startFactExtraction: (chapterId) => invokeValidated('workspace:start-fact-extraction', chapterId),
    getFactExtractionJob: (jobId) => invokeValidated('workspace:fact-extraction-job', jobId),
    cancelFactExtraction: (jobId) => invokeValidated('workspace:cancel-fact-extraction', jobId),
    retryFactExtraction: (jobId, operationId) => invokeValidated('workspace:retry-fact-extraction', jobId, operationId),
    listFactExtractionJobs: (chapterId) => invokeValidated('workspace:list-fact-extraction-jobs', chapterId),
    approvedFactsBefore: (chapterId) => invokeValidated('workspace:approved-facts-before', chapterId),
    listCharacterAliases: () => invokeValidated('workspace:list-character-aliases'),
    replaceCharacterAliases: (input) => invokeValidated('workspace:replace-character-aliases', plainDto(input)),
    listStoryEntities: () => invokeValidated('workspace:list-story-entities'),
    saveStoryEntity: (input) => invokeValidated('workspace:save-story-entity', plainDto(input)),
    listIdeas: () => invokeValidated('workspace:list-ideas'),
    startIdeaGeneration: (input) => invokeValidated('workspace:start-idea-generation', plainDto(input)),
    retryIdeaGeneration: (taskId, operationId) => invokeValidated('workspace:retry-idea-generation', taskId, operationId),
    startOutlineExpansion: (input) => invokeValidated('workspace:start-outline-expansion', plainDto(input)),
    retryOutlineExpansion: (taskId, operationId) => invokeValidated('workspace:retry-outline-expansion', taskId, operationId),
    getPlanningOutline: (key) => invokeValidated('workspace:get-planning-outline', key),
    listOutlineExpansions: () => invokeValidated('workspace:list-outline-expansions'),
    cancelOutlineExpansion: (id) => invokeValidated('workspace:cancel-outline-expansion', id),
    previewOutlineExpansionAdoption: (taskId) => invokeValidated('workspace:preview-outline-expansion-adoption', taskId),
    adoptOutlineExpansion: (token) => invokeValidated('workspace:adopt-outline-expansion', token),
    listIdeaGenerations: () => invokeValidated('workspace:list-idea-generations'),
    ideaGeneration: (taskId) => invokeValidated('workspace:idea-generation', taskId),
    cancelIdeaGeneration: (taskId) => invokeValidated('workspace:cancel-idea-generation', taskId),
    saveIdea: (input) => invokeValidated('workspace:save-idea', plainDto(input)),
    promoteIdeaToWorldRule: (ideaId, expectedUpdatedAt) => invokeValidated('workspace:promote-idea-world-rule', ideaId, expectedUpdatedAt),
    promoteIdeaToSummary: (ideaId, expectedUpdatedAt) => invokeValidated('workspace:promote-idea-summary', ideaId, expectedUpdatedAt),
    listStoryEntityRelations: (entityId) => invokeValidated('workspace:list-story-entity-relations', entityId),
    saveStoryEntityRelation: (input) => invokeValidated('workspace:save-story-entity-relation', plainDto(input)),
    getResourceLedger: (resourceEntityId) => invokeValidated('workspace:get-resource-ledger', resourceEntityId),
    appendResourceLedger: (input) => invokeValidated('workspace:append-resource-ledger', plainDto(input)),
    getForeshadowLedger: () => invokeValidated('workspace:get-foreshadow-ledger'),
    recordForeshadowAction: (input) => invokeValidated('workspace:record-foreshadow-action', plainDto(input)),
    getCharacterState: () => invokeValidated('workspace:get-character-state'),
    getCharacterLines: () => invokeValidated('workspace:get-character-lines'),
    getWorldMap: () => invokeValidated('workspace:get-world-map'),
    saveWorldMap: (input) => invokeValidated('workspace:save-world-map', plainDto(input)),
    generateWorldMapImage: (input) => invokeValidated('workspace:generate-world-map-image', plainDto(input)),
    cancelWorldMapImage: (operationId) => invokeValidated('workspace:cancel-world-map-image', operationId),
    adoptWorldMapImage: (input) => invokeValidated('workspace:adopt-world-map-image', plainDto(input)),
    getWorldMapBackground: () => invokeValidated('workspace:get-world-map-background'),
    dismissCharacterConflict: (conflictId) => invokeValidated('workspace:dismiss-character-conflict', conflictId),
    getTimeline: () => invokeValidated('workspace:get-timeline'),
    saveTimeline: (events) => invokeValidated('workspace:save-timeline', plainDto(events)),
    getRealms: () => invokeValidated('workspace:get-realms'),
    saveRealms: (levels) => invokeValidated('workspace:save-realms', plainDto(levels)),
    getPowerSystem: () => invokeValidated('workspace:get-power-system'),
    savePowerSystem: (data) => invokeValidated('workspace:save-power-system', plainDto(data)),
    getCheatSystem: () => invokeValidated('workspace:get-cheat-system'),
    saveCheatSystem: (data) => invokeValidated('workspace:save-cheat-system', plainDto(data)),
    getSystemTemplate: () => invokeValidated('workspace:get-system-template'),
    saveSystemTemplate: (template) => invokeValidated('workspace:save-system-template', template),
    getPromptProfile: () => invokeValidated('workspace:get-prompt-profile'),
    recoverDamagedPromptProfile: () => invokeValidated('workspace:recover-damaged-prompt-profile'),
    revealBootstrapIssue: (issueId) => invokeValidated('workspace:reveal-bootstrap-issue', issueId),
    savePromptOverride: (input) => invokeValidated('workspace:save-prompt-override', plainDto(input)),
    resetPromptOverride: (task) => invokeValidated('workspace:reset-prompt-override', task)
  }
}

contextBridge.exposeInMainWorld('novelDesktop', desktopApi)
