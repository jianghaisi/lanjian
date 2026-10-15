<script setup>
import ArchivePageHeader from '../ui/ArchivePageHeader.vue'
import ChapterStoryConstraints from '../features/planning/components/ChapterStoryConstraints.vue'
import ChapterUpstreamReview from '../features/planning/components/ChapterUpstreamReview.vue'
import ProseEventSettlement from '../features/timeline/components/ProseEventSettlement.vue'
import AppBootScreen from './components/AppBootScreen.vue'
import LibraryJourney from './components/LibraryJourney.vue'
import WorkspaceNavigationRail from './components/workspace/WorkspaceNavigationRail.vue'
import ArchiveCompanionBadge from '../features/companion/components/ArchiveCompanionBadge.vue'
import DesktopCompanionNotice from '../features/companion/components/DesktopCompanionNotice.vue'
import BrandLogo from '../ui/BrandLogo.vue'
import ChronicleSidebar from '../features/timeline/components/ChronicleSidebar.vue'
import ConflictResolutionActions from '../features/review/components/ConflictResolutionActions.vue'
import ConsistencyOverviewPanel from '../features/review/components/ConsistencyOverviewPanel.vue'
import ContextFactPackLedger from '../features/review/components/ContextFactPackLedger.vue'
import DefinitionWorkbench from '../features/worldbuilding/components/DefinitionWorkbench.vue'
import ExternalOutlineRecovery from '../features/planning/components/ExternalOutlineRecovery.vue'
import FactReviewPanel from '../features/review/components/FactReviewPanel.vue'
import FindingHistoryPanel from '../features/review/components/FindingHistoryPanel.vue'
import GlobalAssistantHost from '../features/assistant/components/GlobalAssistantHost.vue'
import ImportWorkspaceDialog from '../features/library/components/ImportWorkspaceDialog.vue'
import LibraryDialogTransition from '../features/library/components/LibraryDialogTransition.vue'
import DialogTransition from '../ui/DialogTransition.vue'
import LibraryAppearanceSettings from '../features/library/components/LibraryAppearanceSettings.vue'
import LibrarySettingsSections from '../features/library/components/LibrarySettingsSections.vue'
import SponsorCard from '../features/sponsors/SponsorCard.vue'
import WritingPluginSettings from '../features/writing-plugins/components/WritingPluginSettings.vue'
import CompanionVoiceSettings from '../features/companion/components/CompanionVoiceSettings.vue'
import CompanionDialogueSettings from '../features/companion/components/CompanionDialogueSettings.vue'
import LoaderPreferences from './components/LoaderPreferences.vue'
import SoundPreferences from './components/SoundPreferences.vue'
import { useRootSoundFeedback } from './composables/useUiSounds'
import { useQuickWorkspaceSounds } from './composables/useWorkspaceLoadingSounds'
import ManuscriptEditor from '../features/manuscript/components/ManuscriptEditor.vue'
import ManuscriptRecoveryDialog from '../features/manuscript/components/ManuscriptRecoveryDialog.vue'
import MaterialsWorkbench from '../features/worldbuilding/components/MaterialsWorkbench.vue'
import ModelConnectionsSettings from '../features/models/components/ModelConnectionsSettings.vue'
import ModelCreationDefaults from '../features/models/components/ModelCreationDefaults.vue'
import HostedAccount from './components/HostedAccount.vue'
import OutlineExpansionPanel from '../features/planning/components/OutlineExpansionPanel.vue'
import OutlineRecoveryShelf from '../features/planning/components/OutlineRecoveryShelf.vue'
import OutlineVolumeName from '../features/planning/components/OutlineVolumeName.vue'
import AnnotatedDocumentEditor from '../features/document-review/AnnotatedDocumentEditor.vue'
import { useReviewNavigation } from '../features/document-review/use-review-navigation'
import PlannedChapterEditor from '../features/planning/components/PlannedChapterEditor.vue'
import PlanningSidebar from '../features/planning/components/PlanningSidebar.vue'
import PlanningWritingHelp from '../features/planning/components/PlanningWritingHelp.vue'
import ProjectLibrary from '../features/library/components/ProjectLibrary.vue'
import QuickChapterOpen from '../features/manuscript/components/QuickChapterOpen.vue'
import RevisionHistoryDialog from '../features/manuscript/components/RevisionHistoryDialog.vue'
import SettingsWorkbench from './components/SettingsWorkbench.vue'
import StudioIcon from '../ui/StudioIcon.vue'
import TaskCenterPanel from '../features/assistant/components/TaskCenterPanel.vue'
import ThemeSelector from './components/ThemeSelector.vue'
import TimelineWorkbench from '../features/timeline/components/TimelineWorkbench.vue'
import WorkspaceExplorer from './components/WorkspaceExplorer.vue'
import WorkspaceGuidancePopover from './components/workspace/WorkspaceGuidancePopover.vue'
import WorkspaceLoadingScreen from '../features/library/components/WorkspaceLoadingScreen.vue'
import WritingAgentPanel from '../features/assistant/components/WritingAgentPanel.vue'
import WritingRebaseDialog from '../features/assistant/components/WritingRebaseDialog.vue'
import {
  workspaceCreationNavigation,
  workspaceUtilityNavigation
} from '../features/library/services/workspace-navigation'
import { computed, ref, shallowReactive, provide, watch } from 'vue'
import { useHostedViewport } from './composables/use-hosted-viewport'
import HostedPanel from './components/workspace/HostedPanel.vue'
import { createDossierArrival, dossierArrivalKey } from '../features/library/composables/dossier-arrival'
const dossierArrival = createDossierArrival()
provide(dossierArrivalKey, dossierArrival)
const uiSounds = useRootSoundFeedback()
import { useWorkspaceController } from './use-workspace-controller.js'
import InspirationLibrary from '../features/inspiration/components/InspirationLibrary.vue'
import GroupChatWorkspace from '../features/group-chat/components/GroupChatWorkspace.vue'
import BookTabs from '../features/library/components/BookTabs.vue'

const inspirationOpen = ref(false)
const inspirationOrigin = ref({ path: undefined, group: false })
async function showInspiration() { if (inspirationOpen.value) return; const path = current.value?.path, group = groupChatOpen.value; if ((!current.value || await prepareGroupCreation()) && current.value?.path === path) { inspirationOrigin.value = { path, group }; groupChatOpen.value = false; inspirationOpen.value = true } }
async function inspirationSelectBook(book) { await selectWorkspaceBook(book); if (current.value?.path === book?.path) inspirationOpen.value = false }
async function inspirationShowWorks() { await showWorkspaceLibrary(); if (!current.value) inspirationOpen.value = false }
async function closeInspiration() { inspirationOpen.value = false; if (inspirationOrigin.value.group && inspirationOrigin.value.path === current.value?.path) await openGroupChat() }
async function inspirationGroup() { inspirationOpen.value = false; await openGroupChat() }
async function selectCreationParent(id) { inspirationOpen.value = false; await selectWorkspaceParent(id) }
const settlementSourceComposing = ref(false)
const petBootTransition = ref(false), petWorkspaceTransition = ref(false)

const {
  groupChatOpen, openGroupChat, selectWorkspaceBook, showWorkspaceLibrary, groupBookCreated, prepareGroupCreation, openGroupCreateBook,
  libraryModelsDialog,
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
  archivedUnifiedEvents,
  approvedEvents,
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
  closeEventMigration,
  commitEventMigration,
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
  evaluationTime,
  eventDraft,
  eventPlacementLabel,
  eventPlacementValue,
  eventVolume,
  expandedTimelineEntry,
  eventMigrationBusy,
  eventMigrationError,
  eventMigrationState,
  eventProjection,
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
  exportManuscript,
  exportSelectedChapters,
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
  migrationReady,
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
  openEventMigration,
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
  openBookTabs,
  bookDraftConflicts,
  resolveBookDraftConflict,
  selectBookTab,
  closeBookTab,
  openBackgroundTask,
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
  projectTrashConfirmation,
  projectTrashTarget,
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
  restoreTimelineEvent,
  retryEventMirror,
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
  toggleMigrationAcknowledgement,
  unifiedEventCandidates,
  unifiedEventMode,
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
} = useWorkspaceController()
watch(current, () => uiSounds.cancelResults(), { flush: 'sync' })
useQuickWorkspaceSounds(() => {
  const opening = workspaceOpening.value
  return opening ? { generation: opening.generation, visible: opening.visible, replay: opening.replay,
    phase: opening.phase, impact: loadingPreferences.value.theme === 'impact' } : undefined
})
const workspaceExplorerScope = shallowReactive({
  active,
  activeSettingsCategory,
  activeTitle,
  activeWorkspaceGroup,
  activeWorkspaceLeaf,
  approvedEvents,
  busy,
  candidateIdeaCount,
  canonicalEvents,
  chapterOrderIssue,
  chapterPosition,
  chapterTitle,
  chapterTrashEntries,
  chapterTrashOpen,
  chapterTreeQuery,
  chapters,
  characterAtlasCards,
  characterLinesError,
  characterLinesLoaded,
  characterLinesLoading,
  chooseForeshadow,
  current,
  eventPlacementLabel,
  explorerScrolling,
  exportSelectedChapters,
  exportManuscript,
  foreshadowLedger,
  foreshadowLedgerLoaded,
  formatChapterTrashTime,
  ideas,
  importRecoveries,
  isTimelineEntryOpen,
  legacyLeafActivity,
  loadTimelineVolume,
  loading,
  manualSourceCount,
  materialSection,
  newChapter,
  noteExplorerScroll,
  openChapterTrash,
  openProject,
  openTxtImport,
  outlinePlanning,
  planningDraft,
  preparationMode,
  projects,
  recoverDamagedPlanningDraft,
  recoverDamagedPromptProfile,
  recoveryBusyId,
  requestDeleteChapter,
  researchEventsIssue,
  researchSourcesIssue,
  restoreDeletedChapter,
  resumeImportManifest,
  workspaceRecoveryBusy, workspaceRecoveryFeedback, recheckWorkspaceIssues,
  workspaceIssueDiagnostic, copyWorkspaceIssueDiagnostic,
  revealBootstrapIssue,
  sectionNavigation,
  selectChapter,
  selectSettingsSection,
  selectWorkspaceLeaf,
  selectedCharacterLineId,
  selectedForeshadowId,
  selectedId,
  selectedTimelineVolume,
  settingsSearch,
  settingsSearchResults,
  settingsSection,
  timeline,
  timelineEntryCount,
  timelineMode,
  timelineVolumeCards,
  toggleTimelineEntry,
  volumeLineRange,
  webSourceCount,
  workspaceBootstrapIssues,
  workspaceLeafTestId,
  worldMapDirty,
  worldMapView
})
const materialsWorkbenchScope = shallowReactive({
  activeIdeas,
  addResearchToMaterials,
  ai,
  approveCanonicalEvent,
  beginEventCandidate,
  busy,
  candidateIdeaCount,
  canonicalEvents,
  createEventCandidate,
  creatingIdea,
  creatingSource,
  editIdeaGenerationOption,
  eventDraft,
  formatRevisionTime,
  foundation,
  ideaDraft,
  ideaDraftDirty,
  ideaGenerationInstruction,
  ideaGenerationRunning,
  ideaGenerationStatus,
  ideaSourceIssue,
  ideaSourceTask,
  ideas,
  loadIdeaSource,
  manualSourceCount,
  manualSources,
  materialSearch,
  materialSection,
  materialSectionInfo,
  openIdea,
  openSourceCard,
  promoteIdeaToSummary,
  promoteIdeaToWorldRule,
  researchEventsIssue,
  researchQuery,
  researchResult,
  researchSettings,
  researchSourcesIssue,
  retryIdeaGeneration,
  runResearch,
  saveFoundation,
  saveIdea,
  saveSourceCard,
  selectedEventSource,
  selectedIdea,
  selectedIdeaGenerations,
  selectedIdeaId,
  selectedIdeaSourceOption,
  selectedSource,
  selectedSourceId,
  sourceCards,
  sourceDraft,
  sourceDraftDirty,
  sourceOriginLabel,
  startIdea,
  startIdeaGeneration,
  startSourceCard,
  stopIdeaGeneration,
  visibleMaterialSources,
  webSourceCount,
  webSources
})
const timelineWorkbenchScope = shallowReactive({
  addTimeline,
  adoptTimelineCandidate,
  archiveTimelineEvent,
  archivedUnifiedEvents,
  approvedEvents,
  busy,
  chapterPosition,
  chapters,
  characterAtlasCards,
  characterAtlasThroughPosition,
  characterDisplayMode,
  characterLines,
  characterLinesError,
  characterLinesLoading,
  characterPointDetails,
  chronicleMapLocation,
  closeEventMigration,
  commitEventMigration,
  current,
  discardTimelineCandidate,
  expandedTimelineEntry,
  eventMigrationBusy,
  eventMigrationError,
  eventMigrationState,
  eventProjection,
  foreshadowDraft,
  foreshadowLedger,
  generateTimelineCandidates,
  loadCharacterLines,
  loadTimelineVolume,
  moveTimelineEvent,
  migrationReady,
  oneOffConnections,
  openCharacterAtlasChapter,
  openChronicleMap,
  openEventMigration,
  openForeshadowChapter,
  openForeshadows,
  openTimelineVolumeInOutline,
  openWorldMapCharacter,
  openWorldMapEvent,
  outlinePlanning,
  quickChapterItems,
  recordForeshadowAction,
  removeTimelineEvent,
  restoreTimelineEvent,
  retryEventMirror,
  researchEventsIssue,
  reviewCanonicalEvents,
  saveTimeline,
  selectWorkspaceLeaf,
  selectedCharacterLine,
  selectedCharacterLineId,
  selectedForeshadow,
  selectedForeshadowActions,
  selectedTimelineVolume,
  selectedTimelineVolumeMeta,
  timeline,
  timelineAiCandidates,
  timelineAiGenerating,
  timelineEntryId,
  timelineMode,
  timelineVolumeCards,
  timelineVolumeContent,
  timelineVolumeError,
  timelineVolumeLoading,
  updateChronicleField,
  toggleMigrationAcknowledgement,
  unifiedEventCandidates,
  unifiedEventMode,
  volumeLineRange,
  volumeLineStatus,
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
  worldMapWorkspace
})
const definitionWorkbenchScope = shallowReactive({
  refreshJointChapterAdoption,
  active,
  adoptedPlanningVolumeCount,
  ai,
  autosaveCheckpointDelaySeconds,
  autosaveVersionIdleSeconds,
  bookProfile,
  bookSubgenreOptions,
  busy,
  cancelAutomaticPlanning,
  cancelPlanningChapterDetail,
  cancelPlanningChapterSkeleton,
  characterAliasDraft,
  characterAliasesLoaded,
  continuationAnalysis,
  continuationAreaLabels,
  continuationBlockedReason,
  continuationChapterTarget,
  continuationEligibleChapters,
  continuationGapLabels,
  continuationManifestId,
  continuationSelectedChapterConfirmed,
  continuationSelectedChapterReceipt,
  continuationSelectedVolumeConfirmed,
  continuationSelectedVolumeReceipt,
  continuationVolumeTarget,
  discardPlanningProposal,
  editCharacterAliases,
  generateContinuationAnalysis,
  groupedCharacterAliases,
  handleBookGenreChange,
  legacyBookSubgenre,
  markPlanningChapterDetailEdited,
  markPlanningCharacterSeedsEdited,
  markPlanningCheatSystemEdited,
  markPlanningPowerSystemEdited,
  markPlanningSkeletonEdited,
  markPlanningTotalEdited,
  markPlanningVolumeOutlineEdited,
  markPlanningVolumeStructureEdited,
  markPlanningWorldSeedEdited,
  newProjectGuide,
  nextPlanningChapterDetailCandidate,
  nextPlanningDetailVolume,
  nextPlanningVolumeCandidate,
  openChapterOutlineReview,
  openContinuationChapterOutlineAdoption,
  openContinuationCharacterEditor,
  openContinuationCheatSystemAdoption,
  openContinuationExistingPlotAdoption,
  openContinuationPowerSystemAdoption,
  openContinuationProjectDefinitionAdoption,
  openContinuationTotalOutlineAdoption,
  openContinuationVolumeOutlineAdoption,
  openContinuationWorldViewAdoption,
  openPlanningChapterDetailAdoption,
  openPlanningCharacterSeedAdoption,
  openPlanningCheatSystemAdoption,
  openPlanningPowerSystemAdoption,
  openPlanningRequirement,
  openPlanningTotalAdoption,
  openPlanningVolumeOutlineAdoption,
  openPlanningVolumeStructure,
  openPlanningWorldSeedAdoption,
  openTotalOutlineReview,
  openVolumeOutlineReview,
  outlinePlanning,
  planningAdoptionBusy,
  planningAdoptionGuidance,
  planningAdoptionMarker,
  planningAdoptionStageLabel,
  planningDetailJob,
  planningDetailRunning,
  planningDetailStatuses,
  planningDraft,
  planningDraftSaveState,
  planningFoundationAdoptedCount,
  planningFoundationReady,
  planningJob,
  planningMaterialsReady,
  planningRunning,
  planningSkeletonRunning,
  planningSkeletonStatus,
  planningSkeletonVolumes,
  planningStageLabel,
  planningTotalConfirmed,
  planningVolumesConfirmed,
  preparationMode,
  saveBookProfile,
  saveBookProfileAndContinue,
  saveCharacterAliases,
  saveContinuationAnalysis,
  selectWorkspaceLeaf,
  startAutomaticPlanning,
  startPlanningChapterDetail,
  startPlanningChapterSkeleton,
  updatePlanningChapterDetailList,
  updateSkeletonCharacters
})
useReviewNavigation({ desktop, current, activeWorkspaceLeaf, selectWorkspaceLeaf, selectChapter, openVolumeOutline, openStageOutline, outlineFullCatalog, openChapterFromOutlineCatalog, notice: message => { toast.value = message } })
const settingsWorkbenchScope = shallowReactive({
  activeSettingsCategory,
  ai,
  appVersion,
  appendResourceLedgerEntry,
  approvedResourceEntities,
  assistantWidth,
  autoBackupDraft,
  autoBackupDraftDirty,
  autoBackupLoading,
  autoBackupRunning,
  autoBackupStatus,
  autoBackupTime,
  bookProfile,
  busy,
  cancelConsistencyEvaluation,
  chapters,
  chooseAutoBackupDirectory,
  companionError,
  companionOptions,
  companionProjectSpecific,
  consistencyEvaluationJob,
  consistencyEvaluationSummary,
  contextBudgetPreferences,
  createWorkspaceBackup,
  current,
  currentSettingsSection,
  desktop,
  editStoryEntity,
  evaluationTime,
  explorerWidth,
  exportManuscript,
  loadRealTrialDraft,
  migrateProject,
  migrationPreview,
  modelChoices,
  modelSettingsDirty,
  openSqliteActivation,
  openSqliteShadowMigration,
  openWorkspaceRestore,
  promptDraft,
  promptDraftDirty,
  promptProfile,
  realTrialAvailableChapters,
  realTrialChapterId,
  realTrialConclusionDraft,
  realTrialDraft,
  realTrialExistingRecord,
  realTrialIssue,
  realTrialReport,
  realTrialSelectedChapter,
  rebuildReadableMirrors,
  recoverCompanionDefaults,
  refreshLocalModels,
  refreshModelAssignments,
  modelReturnLabel,
  returnFromModelSettings,
  replayOpening,
  researchSettings,
  resetAppearancePreferences,
  resetContextEvidencePreferences,
  resetPromptOverride,
  resourceLedger,
  resourceLedgerDraft,
  retrySqliteMirrors,
  rollbackSqliteStorage,
  runAutomaticBackup,
  saveAppearancePreferences,
  saveAutoBackupPreferences,
  saveContextBudgetPreferences,
  savePromptOverride,
  saveRealTrialChapter,
  saveRealTrialConclusion,
  saveResearchSettings,
  saveStoryEntity,
  saveStoryEntityRelation,
  saveWritingPreferences,
  selectPromptTask,
  selectSettingsCategory,
  selectSettingsSection,
  selectTheme,
  selectedPromptEntry,
  selectedPromptTask,
  selectedResourceBalance,
  selectedResourceEntries,
  setCompanionProjectSpecific,
  settingsSection,
  sqliteShadowResult,
  sqliteStorageStatus,
  startConsistencyEvaluation,
  storyEntities,
  storyEntitiesLoaded,
  storyEntityDraft,
  storyEntityRelations,
  storyRelationDraft,
  themeChoice,
  themeError,
  trialPercent,
  updateCompanionOptions,
  useLocalModel,
  workspaceBackupResult
})
const revisionHistoryDialogScope = shallowReactive({
  busy,
  chapterOrderIssue,
  chapterTitle,
  formatRevisionTime,
  nameCurrentRevision,
  restoreRevision,
  revisionDiffSummary,
  revisionLabelDraft,
  revisionReasonLabels,
  revisionViewMode,
  revisions,
  selectedChapterPosition,
  selectedId,
  selectedRevision,
  selectedRevisionChanges,
  selectedRevisionDiff,
  selectedRevisionId,
  showRevisions
})
const importWorkspaceDialogScope = shallowReactive({
  addContinuationDocuments,
  busy,
  chooseTxtDestination,
  commitTxtImport,
  current,
  desktop,
  importCreatedProject,
  importManifest,
  importModelsPreview,
  manifestChapterSelections,
  manifestRoles,
  moveManifestFile,
  partialImportCreation,
  showTxtImport,
  txtCanImport,
  txtImport,
  txtImportEntry,
  txtPreview
})
watch(groupChatOpen, value => { if (value) inspirationOpen.value = false })
const hostedNarrow = useHostedViewport()
const hostedNavigationOpen = ref(false)
// Keep the controller's transient state: task entry points and polling use it too.
const assistantPresented = assistantOpen
watch(hostedNarrow, () => { hostedNavigationOpen.value = false; assistantOpen.value = false })
watch(hostedNavigationOpen, value => { if (value && hostedNarrow.value) assistantOpen.value = false })
watch(assistantOpen, value => { if (value && hostedNarrow.value) hostedNavigationOpen.value = false })
watch(() => [current.value?.path, activeWorkspaceLeaf.value?.id, selectedId.value, selectedVolume.value, selectedStage.value], () => { hostedNavigationOpen.value = false })
</script>

<template>
  <LibraryJourney :pending="workspaceOpening" :current-path="current?.path" />
  <Transition name="opening" @before-leave="petBootTransition = true" @after-leave="petBootTransition = false">
    <AppBootScreen :projects="projects" :continue-project-id="continueProjectId" v-if="opening && desktop" :phase="displayBootPhase" :error="displayBootError" :detail="bootDetail" :models-required="bootModelsRequired && !bootModelsSkipped" :can-skip-models="canSkipBootModels" :preview="bootPreview" :boot-style="loadingPreferences.bootStyle" :palette="loadingPreferences.bootPalette" @complete="dismissOpening" @skip="dismissOpening" @skip-models="skipBootModels" @retry="bootError ? initializeBoot() : retryBootModels()" />
  </Transition>

  <Transition name="workspace-loading-fade" @before-enter="petWorkspaceTransition = true" @before-leave="petWorkspaceTransition = true" @after-leave="petWorkspaceTransition = false">
    <WorkspaceLoadingScreen v-if="workspaceOpening?.visible" :title="workspaceOpening.title" :phase="workspaceOpening.phase" :slow="workspaceOpening.slow" :quick="workspaceOpening.replay === false" :theme="loadingPreferences.theme" :sidebar-width="explorerWidth" @cancel="cancelWorkspaceOpening" />
  </Transition>

  <main class="app-frame" :class="{ 'has-book-tabs': Boolean(desktop) }" :inert="Boolean((opening && desktop) || workspaceOpening)">
    <BookTabs v-if="desktop" :books="openBookTabs" :current-path="current?.path"
      :disabled="Boolean(workspaceOpening || busy)" :read-tasks="desktop.ai.backgroundTasks" @task="openBackgroundTask" @select="inspirationSelectBook" @close="closeBookTab" @library="inspirationShowWorks">
      <template v-if="!current || !(editorFocusMode && (active === 'desk' || active === 'outline'))" #leading>
        <div class="workspace-brand-actions"><BrandLogo /><button v-if="current" class="workspace-guidance-trigger" type="button" data-testid="open-workspace-guidance" aria-label="写作指引" aria-haspopup="dialog" aria-controls="workspace-guidance-panel" aria-expanded="false" @click="toggleGuidance"><StudioIcon name="outline" :size="16"/><span>写作指引</span></button></div>
      </template>
      <template #actions>
        <button v-if="hostedNarrow && current" class="labeled-title-action hosted-navigation-trigger" type="button" aria-label="页面与目录" aria-controls="hosted-navigation-panel" :aria-expanded="hostedNavigationOpen" @click="hostedNavigationOpen = true"><StudioIcon name="menu" :size="18"/>目录</button>
        <button class="labeled-title-action" type="button" data-testid="open-inspiration-library" aria-label="知识库" title="知识库" :aria-pressed="inspirationOpen" @click="showInspiration"><StudioIcon name="book" :size="16"/><span>知识库</span></button>
        <HostedAccount v-if="desktop.app.hosted" :api="desktop.app.hosted" :library="!current"/>
        <div v-if="!current" class="title-actions library-header-actions">
          <button class="labeled-title-action" type="button" data-activity="settings" aria-label="设置" title="设置" @click="openAppearanceSettings"><StudioIcon name="settings" :size="19"/></button>
        </div>
        <div v-else-if="!(editorFocusMode && (active === 'desk' || active === 'outline'))" class="title-actions">
          <button class="labeled-title-action" type="button" data-testid="open-quick-chapter" title="快速打开章节（Ctrl+P）" aria-label="快速打开章节" aria-keyshortcuts="Control+p Meta+p" @click="openQuickChapterSearch"><StudioIcon name="search" :size="16"/><span>快速打开</span></button>
          <DesktopCompanionNotice v-if="desktop?.app.platform === 'browser'" compact />
          <ArchiveCompanionBadge v-else :options="companionOptions" :scope="`${current?.id || ''}:${selectedId || ''}`" :suspended="Boolean(opening || workspaceOpening || petBootTransition || petWorkspaceTransition)" :task-id="companionTask?.id || ''" :task-status="companionTask?.status || ''" :quiet="companionTyping || companionComposing" :focus="editorFocusMode" @mode="updateCompanionOptions({ writingMode: $event })" @settings="openCompanionSettings" @write="returnToManuscript" />
          <button v-if="assistantAvailable" class="assistant-toggle labeled-title-action" type="button" :title="assistantPresented ? '收起智能助笔侧栏' : '打开智能助笔侧栏'" :aria-label="assistantPresented ? '收起智能助笔侧栏' : '打开智能助笔侧栏'" aria-controls="assistant-drawer" :aria-expanded="assistantPresented" @click="assistantPresented = !assistantPresented"><StudioIcon name="spark" :size="16" /><span>智能助笔</span></button>
        </div>
      </template>
    </BookTabs>
    <div v-if="current && bookDraftConflicts.length" class="book-draft-conflicts" role="status">
      <span>《{{ current.title }}》的{{ bookDraftConflicts[0].label }}已更新。此标签还有未保存的输入，请选择保留哪一份。</span>
      <button type="button" :disabled="Boolean(workspaceOpening || busy)" @click="resolveBookDraftConflict(bookDraftConflicts[0].key, true)">恢复标签输入</button>
      <button type="button" :disabled="Boolean(workspaceOpening || busy)" @click="resolveBookDraftConflict(bookDraftConflicts[0].key, false)">使用最新资料</button>
    </div>
    <dialog v-if="!current" ref="localAppearanceDialog" class="local-appearance-dialog library-preferences-dialog" aria-label="外观设置" data-sound-dialog>
      <header><h2>作品库设置</h2><button class="control-button secondary" type="button" aria-label="关闭外观设置" @click="localAppearanceDialog.close()"><StudioIcon name="close" :size="18"/></button></header>
      <LibrarySettingsSections :models="desktop.app.platform !== 'browser'" @models="openLibraryModels">
        <template #sponsors><SponsorCard /></template>
        <template #appearance>
        <ThemeSelector :model-value="themeChoice" :error="themeError" @update:model-value="selectTheme" />
        <LibraryAppearanceSettings :background="libraryAppearance.background" :scene="libraryAppearance.scene" :character="libraryAppearance.character" :error="libraryAppearanceError" @background="updateLibraryAppearance({ background: $event })" @scene="updateLibraryAppearance({ scene: $event })" @character="updateLibraryAppearance({ character: $event })" />
        </template>
        <template #opening><LoaderPreferences :projects="projects" :continue-project-id="continueProjectId" /></template>
        <template #sound="{ active: soundActive }"><SoundPreferences :active="soundActive" /><CompanionVoiceSettings /><CompanionDialogueSettings /></template>
        <template v-if="desktop.app.platform !== 'browser'" #plugins="{ active: pluginsActive }"><WritingPluginSettings v-if="pluginsActive" :api="desktop.writingPlugins" :book-scope-key="null" /></template>
      </LibrarySettingsSections>
    </dialog>
    <dialog v-if="!current && libraryModelsOpen" ref="libraryModelsDialog" class="local-appearance-dialog global-models-dialog" aria-label="全局模型接口与新书默认" @cancel="closeLibraryModels">
      <header><h2>全局模型接口</h2><div><button class="control-button secondary" type="button" data-testid="library-models-return" @click="closeLibraryModels($event, true)">← 返回设置</button><button class="control-button secondary" type="button" @click="closeLibraryModels">关闭</button></div></header>
      <ModelConnectionsSettings :local-api="desktop.localModels" :api="desktop.modelConnections" @dirty="modelSettingsDirty = $event"/>
    </dialog>
    <Transition name="workbench-toast"><div v-if="toast" :key="toast" class="toast" role="status" aria-live="polite">{{ toast }}</div></Transition>
    <section v-if="!desktop" class="unsupported">
      <p class="eyebrow">桌面运行环境未连接</p><h1>岚笺需要从 Electron 启动</h1><p>请重新启动桌面开发进程。</p>
    </section>

    <section v-if="desktop" class="studio redesigned-studio narrative-terminal" :style="studioStyle" :data-page="inspirationOpen ? 'inspiration' : groupChatOpen ? 'group' : active" :data-destination="primaryDestination" :data-guide-style="editorGuideStyle" data-assistant-layout="sidebar" :data-assistant-open="!groupChatOpen && !inspirationOpen && current && assistantAvailable && assistantPresented ? 'true' : 'false'" :class="{ 'inspiration-mode': inspirationOpen, 'group-mode': groupChatOpen, 'assistant-collapsed': groupChatOpen || inspirationOpen || !current || !assistantAvailable || !assistantPresented, 'library-mode': !current, 'archive-workspace': Boolean(current) && !groupChatOpen && !inspirationOpen, 'writing-focus': !groupChatOpen && !inspirationOpen && editorFocusMode && (active === 'desk' || active === 'outline'), 'editor-guides-hidden': editorGuideStyle === 'off' }" @input="noteCompanionTyping" @compositionstart="companionComposing = true" @compositionend="companionComposing = false; noteCompanionTyping()">
      <ProjectLibrary v-if="!current" v-show="!inspirationOpen" :presented="!opening && !workspaceOpening" :projects="projects" :continue-project-id="continueProjectId" :loading="loading" :loaded="projectsLoaded" :recently-trashed-project="recentlyTrashedProject" :background-artwork="libraryBackgroundArtwork" :scene-artwork="librarySceneArtwork" :character-placement="libraryAppearance.character" @open="openProject" @open-chapter="openLibraryChapter" @create="openCreateProject" @import-project="importProject" @forget="forgetProject" @trash="requestTrashProject" @open-trash="openSystemTrash" @settings="openAppearanceSettings" @dismiss-trash="recentlyTrashedProject = null" />
      <QuickChapterOpen v-if="current" :key="current.path" ref="quickChapterOpen" :chapters="quickChapterItems" :selected-id="selectedId" :open-chapter="openQuickChapter" />
      <WorkspaceGuidancePopover v-if="current" ref="guidancePopover" :workflow="workflowStatus" :overview="consistencyOverview" :busy="busy" :scope="`${current.id}:${active}:${editorFocusMode}`" @navigate="goToWorkflowStep" @select-item="openConsistencyItem" @write="returnToManuscript" @refresh="refreshWorkflow()" />


      <HostedPanel :narrow="hostedNarrow" :open="hostedNavigationOpen" label="页面与目录" id="hosted-navigation-panel" @close="hostedNavigationOpen = false">
      <nav v-if="current" class="activitybar" :class="{ 'keyboard-expanded': activitybarKeyboardExpanded }" aria-label="创作流程" @mousedown="handleActivitybarPointerDown" @mouseup="handleActivitybarPointerEnd" @mouseleave="handleActivitybarPointerEnd" @keydown="handleActivitybarKeydown" @focusin="handleActivitybarFocusIn" @focusout="handleActivitybarFocusOut">
        <WorkspaceNavigationRail :selected="activeWorkspaceGroup.id" />
        <button v-for="item in workspaceCreationNavigation" :key="item.id" type="button" class="creation-activity" :class="{ selected: activeWorkspaceGroup.id === item.id }" :title="`${item.label}：${item.description}`" :aria-label="item.label" :aria-current="activeWorkspaceGroup.id === item.id ? 'step' : undefined" :data-activity="legacyParentActivity(item.id)" :data-nav-parent="item.id" :data-testid="item.id === 'group' ? 'group-chat-tab' : undefined" :data-sequence="item.sequence" @click="selectCreationParent(item.id)">
          <StudioIcon :name="item.icon" :size="24"/><span>{{ item.label }}</span>
        </button>
        <div class="activity-spacer"></div>
        <button v-for="item in workspaceUtilityNavigation" :key="item.id" type="button" class="creation-activity utility-activity" :class="{ selected: activeWorkspaceGroup.id === item.id }" :title="item.description" :aria-label="item.label" :aria-current="activeWorkspaceGroup.id === item.id ? 'page' : undefined" :data-activity="item.id" :data-nav-parent="item.id" :data-sequence="item.sequence" @click="selectCreationParent(item.id)">
          <StudioIcon :name="item.icon" :size="24"/><span>{{ item.label }}</span>
        </button>
      </nav>
      <PlanningSidebar v-show="!groupChatOpen && !inspirationOpen" v-if="current && activeWorkspaceGroup.id === 'planning'" :book-key="current.path" :active-leaf="activeWorkspaceLeaf?.id" :mode="active === 'outline' ? outlineMode : ''" :selected-volume="selectedVolume" :selected-stage="selectedStage" :selected-chapter="outlineMode === 'plannedChapter' ? plannedChapter?.chapterId : selectedId" :volumes="outlinePlanning.volumes" :stages="stageOutlines" :chapters="outlineFullCatalog" :loading="outlineLoading" :error="outlineOpenError" :disabled="busy || Boolean(outlinePlanningIssue || chapterOrderIssue)" @navigate="selectWorkspaceLeaf" @volume="openVolumeOutline" @stage="openStageOutline" @chapter="openChapterFromOutlineCatalog" @create-volume="openPlanningVolumeCreator" @create-chapter="createPlanningChapter" @recovery="openOutlineRecoveryShelf" @retry="retryOutlineOpen?.()" />
      <ChronicleSidebar v-show="!groupChatOpen && !inspirationOpen" v-if="current && activeWorkspaceGroup.id === 'chronicle'" :active-leaf="activeWorkspaceLeaf?.id" @navigate="selectWorkspaceLeaf" />
      <WorkspaceExplorer v-show="!groupChatOpen && !inspirationOpen" v-if="current && active !== 'profile' && !['chronicle', 'planning'].includes(activeWorkspaceGroup.id)" :scope="workspaceExplorerScope" />
      </HostedPanel>

    <InspirationLibrary v-if="desktop" v-show="inspirationOpen" :api="desktop" :visible="inspirationOpen" :book="current" :projects="projects" @close="closeInspiration" @group="inspirationGroup" @models="openLibraryModels" />
    <GroupChatWorkspace v-if="desktop" v-show="groupChatOpen" :api="desktop" :book="current" :visible="groupChatOpen" :before-create="prepareGroupCreation" :on-created="groupBookCreated" @new-book="openGroupCreateBook" @library="showWorkspaceLibrary" @open-book="selectWorkspaceBook(projects.find(book => book.id === $event) || openBookTabs.find(book => book.id === $event))" @setup-models="openLibraryModels" />

      <dialog v-if="current" ref="outlineLeaveDialog" class="planning-dialog" aria-labelledby="outline-leave-title" @cancel.prevent="resolveOutlineLeaveChoice('cancel')">
        <h2 id="outline-leave-title">这份大纲还有修改</h2><p>保存后再离开，或放弃本次未保存的修改。</p>
        <footer><button type="button" class="control-button secondary compact" @click="resolveOutlineLeaveChoice('cancel')">继续编辑</button><button type="button" class="control-button secondary compact" @click="resolveOutlineLeaveChoice('discard')">放弃修改</button><button type="button" class="control-button primary compact" @click="resolveOutlineLeaveChoice('save')">保存后继续</button></footer>
      </dialog>
      <dialog v-if="current" ref="outlineVolumeDialog" class="planning-dialog" aria-labelledby="planning-volume-title">
        <form @submit.prevent="submitPlanningVolume"><h2 id="planning-volume-title">新建卷</h2><label>卷名<input v-assist-field="{ id: 'AppShell.volumeDraft', read: () => volumeDraft, write: value => { volumeDraft = String(value) } }" v-model="volumeDraft" aria-label="新卷名称" maxlength="120" placeholder="例如：初入雾港" autofocus required></label><p>先给这一段故事取名，再写下本卷目标和结尾。</p><footer><button type="button" class="control-button secondary compact" :disabled="busy" @click="outlineVolumeDialog.close()">取消</button><button type="submit" class="control-button primary compact" :disabled="busy || !volumeDraft.trim()">建立卷</button></footer></form>
      </dialog>


      <div v-if="current && active !== 'profile' && activeWorkspaceGroup.id !== 'chronicle' && !(editorFocusMode && (active === 'desk' || active === 'outline'))" v-show="!groupChatOpen && !inspirationOpen" class="explorer-resizer" role="separator" aria-label="调整左侧边栏宽度" aria-orientation="vertical" aria-valuemin="200" aria-valuemax="420" :aria-valuenow="Math.round(explorerWidth)" tabindex="0" @pointerdown="beginExplorerResize" @keydown="resizeExplorerByKeyboard"><span>拖动调整边栏宽度</span></div>
      <div v-if="current && assistantAvailable && assistantPresented" v-show="!groupChatOpen && !inspirationOpen" class="assistant-resizer" role="separator" aria-label="调整智能助笔侧栏宽度" aria-orientation="vertical" aria-valuemin="280" aria-valuemax="720" :aria-valuenow="Math.round(assistantWidth)" tabindex="0" @pointerdown="beginAssistantResize" @keydown="resizeAssistantByKeyboard"><span>拖动调整助笔宽度</span></div>

      <section v-if="current" v-show="!groupChatOpen && !inspirationOpen" class="workbench">
        <template v-if="active === 'desk'">
          <article v-if="workspaceLoadError" class="manuscript-editor manuscript-load-blocked" data-testid="manuscript-load-blocked">
            <div class="center-empty"><span class="empty-mark">核</span><p class="eyebrow">正文仍在本地</p><h2>这部作品需要先核对</h2><p>{{ workspaceLoadError }}。岚笺已暂停自动读取，没有创建空章，也没有改动原稿。</p><div class="blocked-actions"><button v-if="migrationPreview" class="text-action" type="button" @click="active = 'settings'">查看项目诊断</button><button class="text-action" type="button" @click="closeProject">返回我的作品</button></div></div>
          </article>
          <ManuscriptEditor @composition-start="settlementSourceComposing = true" @composition-end="settlementSourceComposing = false" :work-item-id="current.id" v-else-if="selectedId" :key="`${current.id}:${selectedId}`" ref="manuscriptEditor" v-model:title="chapterTitle" v-model:content="chapterContent" :chapter-id="selectedId" :position="selectedChapterPosition" :project-word-count="liveProjectWordCount" :save-state="saveState" :save-error-message="manuscriptSaveErrorMessage" :conflict="manuscriptConflictView" :last-saved-at="lastSavedAt" :read-only="Boolean(chapterOrderIssue)" :storage-mode="selectedChapterRecord?.storageMode" :text-authority="sqliteStorageStatus?.textAuthority" :mirror-status="selectedChapterRecord?.mirrorStatus" :assistant-open="assistantPresented" :lifecycle-status="chapterPlanning?.lifecycleStatus" :has-unconfirmed-changes="chapterPlanning?.hasUnconfirmedChanges" :chapter-confirming="chapterCardSaving" @save="saveChapter" @check-saved-info="refreshSavedChapterInfo" @confirm="confirmCurrentChapter" @recover-conflict="backupDraftAndReloadExternal" @recover-mirror="recoverExternalMarkdownMirror" @history="openRevisions" @delete="requestDeleteChapter" @focus-mode="editorFocusMode = $event" @assistant-toggle="assistantPresented = !assistantPresented" @selection-ai="openWritingAgentQuickAction" @selection-ai-menu="openManuscriptSelectionAiMenu" @selection-change="updateManuscriptSelection" @anchor-change="updateManuscriptAnchor" @manual-edit="markManuscriptAsManualEdit" @history-restore="announceManuscriptHistory" @guidance="toggleGuidance"/>
          <article v-else class="manuscript-editor">
            <div class="center-empty"><span class="empty-mark">章</span><h2>{{ chapterOrderIssue ? '章序账本需要核对' : '案上还没有正文' }}</h2><p>{{ chapterOrderIssue ? '正文文件没有被改动；请先定位并恢复章序账本。' : '建立第一章，或者从左侧选择已有章节。' }}</p><button v-if="!chapterOrderIssue" class="seal-action" type="button" @click="newChapter"><span>建立第一章</span><i>启</i></button></div>
          </article>
        </template>

        <section v-else-if="active === 'review'" class="review-workspace archive-page" data-testid="review-workspace">
          <ArchivePageHeader eyebrow="06 / MANUSCRIPT REVIEW · 书稿审校" title="一致性检查" :description="chapterTitle || '选择章节后查看检查结果'"><button class="control-button secondary" type="button" :disabled="busy || !selectedId" @click="recheckSavedManuscript">重新核对</button></ArchivePageHeader>
          <ConsistencyOverviewPanel v-if="consistencyOverview" :overview="consistencyOverview" :busy="busy" @select-item="openConsistencyItem" @write="returnToManuscript" />
          <FactReviewPanel v-if="factBatches.length" :batches="factBatches" :busy="factReviewBusy" :minimum-importance="contextBudgetPreferences.minimumFactImportance" :show-confirmations="contextBudgetPreferences.showFactConfirmations" @decide="decideFactChanges" @continue-writing="continueAfterFactReview" />
          <div v-if="!consistencyOverview && !factBatches.length" class="review-empty"><b>还没有检查结果</b><p>选定章节后核对已保存的正文；需要修改时，可以带着证据回到原文。</p></div>
          <button class="control-button secondary" type="button" :disabled="!selectedId" @click="returnToManuscript().then(openWritingChecks)">打开正文与核对证据<StudioIcon name="arrow" :size="16"/></button>
        </section>
        <MaterialsWorkbench v-else-if="active === 'research'" :scope="materialsWorkbenchScope" />

        <OutlineRecoveryShelf v-else-if="active === 'outline' && outlineMode === 'recovery'" :drafts="outlineRecoveryDrafts" :error="outlineRecoveryShelfError" @refresh="refreshOutlineRecoveryShelf" @open="openShelfOutline" @discard="discardShelfRecovery" />
        <PlannedChapterEditor ref="outlineEditor" :assistant-open="assistantPresented" @focus-mode="editorFocusMode = $event" @assistant-toggle="assistantPresented = !assistantPresented" @guidance="toggleGuidance" :work-item-id="current.id" v-else-if="active === 'outline' && outlineMode === 'plannedChapter' && plannedChapter" :document="plannedChapter" v-model:title="plannedChapterTitle" v-model:content="plannedChapterContent" :dirty="plannedChapterDirty" :busy="plannedChapterBusy" :starting="plannedChapterStarting" :error="plannedChapterError" :recovery="plannedOutlineRecovery" :recovery-error="plannedOutlineRecoveryError" @restore-recovery="restorePlannedOutlineRecovery" @discard-recovery="discardPlannedOutlineRecovery" @save="flushPlannedChapterSave" @start="startPlannedChapter" @reload="reloadPlannedChapter" @composing="plannedChapterComposing = $event" />
        <div v-else-if="active === 'outline'" class="planning-document-workspace" :class="{ 'inspector-open': outlineInspectorOpen }">
          <header class="outline-writing-toolbar">
            <div class="outline-document-state" aria-live="polite">
              <span>{{ outlineMode === 'total' ? `全书总纲 · 第 ${outlinePlanning.totalRevision || '—'} 版` : outlineMode === 'volume' ? selectedVolumeMeta ? `第 ${selectedVolumeMeta.volume} 卷 · ${selectedVolumeMeta.title}` : '尚未选择篇卷' : outlineMode === 'stage' ? selectedStageMeta ? `第 ${selectedStageMeta.volume} 卷 · ${stageTitle}` : '尚未选择阶段' : selectedId ? `第 ${selectedChapterPosition} 章章纲` : '尚未选择章节' }}</span>
            </div>
            <div class="outline-toolbar-actions">
              <button v-if="expansionParentKey" class="control-button secondary compact" type="button" data-testid="open-outline-expansion" :aria-expanded="expansionOpen" :disabled="outlineDocumentLocked || busy || expansionBusy" @click="openOutlineExpansion">{{ expansionOpen ? '返回编辑' : outlineMode === 'total' ? '拆分卷纲' : outlineMode === 'volume' ? '细化本卷大纲' : '拆分章节' }}</button>
              <button class="control-button secondary compact" type="button" data-testid="outline-inspector-toggle" :aria-expanded="outlineInspectorOpen" :disabled="Boolean(outlinePlanningIssue || chapterOrderIssue)" @click="outlineInspectorOpen = !outlineInspectorOpen"><StudioIcon name="panel" :size="15"/>{{ outlineMode === 'chapter' ? '归卷与检查' : '结构与检查' }}</button>
              <button v-if="outlineMode === 'chapter' && selectedId" class="control-button secondary compact" type="button" data-testid="planning-write-chapter" @click="selectWorkspaceLeaf('chapters')">写这一章正文</button>
              <button v-if="outlineMode === 'total'" class="control-button secondary compact" type="button" data-testid="generate-total-outline-ai" :disabled="Boolean(outlinePlanningIssue) || busy" @click="handleTotalOutlineAi"><StudioIcon name="spark" :size="15"/>{{ planningRunning ? `查看生成进度 · ${planningStageLabel}` : planningDraft ? '查看 AI 总纲候选' : 'AI 生成总纲' }}</button>
              <button v-else-if="outlineMode === 'chapter'" class="control-button secondary compact" type="button" :disabled="outlineDocumentLocked || !selectedId || !foundationReady || busy" @click="generateChapterOutline"><StudioIcon name="spark" :size="15"/>AI 生成章纲</button>
            </div>
          </header>

          <p v-if="outlineMode === 'total' && !outlinePlanningIssue && !totalOutline.trim()" class="workspace-action-hint" data-testid="total-outline-start-guide">
            <span>还没有全书总纲。可以在下方手写并保存，或点击“{{ planningRunning ? '查看生成进度' : planningDraft ? '查看 AI 总纲候选' : 'AI 生成总纲' }}”。AI 生成的是候选，需要到“创作筹备”逐项核对采用后，才成为可供拆解的正式总纲。</span>
          </p>

          <div v-if="outlinePlanningIssue" class="material-source-locked outline-ledger-locked" data-testid="outline-planning-ledger-locked"><i>锁</i><div><b>谋篇版本与确认暂时锁定</b><p>总纲、卷纲、章纲原文仍可查看，但在版本账本核对完成前不能保存谋篇、分卷、确认契约或调用 AI 写作。</p><small>原文件没有被改动；请定位 `.webnovel/planning/outline-state.json` 后人工恢复。</small></div></div>

          <PlanningWritingHelp v-if="!expansionOpen && (outlineMode === 'total' || outlineMode === 'volume' && selectedVolume || outlineMode === 'stage' && selectedStage || outlineMode === 'chapter' && selectedId)" :key="outlineStorageKey" :kind="outlineMode" :empty="!(outlineMode === 'total' ? totalOutline : outlineMode === 'volume' ? volumeOutline : outlineMode === 'stage' ? stageOutline : chapterOutline).trim()" :disabled="outlineDocumentLocked || outlineComposing" @insert="insertOutlineTemplate" />
          <section v-if="!expansionOpen && (outlineMode === 'volume' && !selectedVolume || outlineMode === 'chapter' && !selectedId)" class="planning-empty-editor"><h3>{{ outlineMode === 'volume' ? '从这一卷的目标开始' : '写下这一章会发生什么' }}</h3><p>{{ outlineMode === 'volume' ? '建立卷后，就能记录本卷的冲突、转折和结尾。' : '新章节会加入书稿目录；先写章纲，正文可以稍后再写。' }}</p><button type="button" class="control-button primary" @click="outlineMode === 'volume' ? openPlanningVolumeCreator() : createPlanningChapter()">{{ outlineMode === 'volume' ? '新建卷' : '新建章节并写章纲' }}</button></section>
          <OutlineExpansionPanel v-if="expansionOpen" :source="expansionSource" :tasks="expansionTasks" :loading="expansionLoading" :busy="expansionBusy" :error="expansionError" :preview="expansionPreview" :notice="expansionNotice" @close="closeOutlineExpansion" @refresh="reloadOutlineExpansionView" @start="runOutlineExpansion" @cancel="id => runOutlineExpansion(null, id)" @retry="retryOutlineExpansion" @preview="previewOutlineExpansionAdoption" @dismiss-preview="expansionPreview = null" @adopt="adoptOutlineExpansion" />
          <ExternalOutlineRecovery v-if="outlineMode === 'chapter' && selectedId && current && !expansionOpen" :work-item-id="current.id" :chapter-id="selectedId" :draft="chapterOutline" :dirty="chapterOutlineDirty" :disabled="outlineDocumentLocked" @adopted="acceptRecoveredChapterOutline" />
          <AnnotatedDocumentEditor ref="outlineEditor" :assistant-open="assistantPresented" @focus-mode="editorFocusMode = $event" @assistant-toggle="assistantPresented = !assistantPresented" @guidance="toggleGuidance" :save-state="outlineStorageFeedback.saveStatus(outlineStorageKey).pending ? 'saving' : outlineStorageFeedback.saveStatus(outlineStorageKey).error ? 'error' : (outlineMode === 'chapter' ? chapterOutlineDirty : planningOutlineDirty) ? 'dirty' : 'saved'" :save-error-message="outlineStorageFeedback.saveStatus(outlineStorageKey).error" :save-revision="outlineStorageFeedback.saveStatus(outlineStorageKey).revision" :saved-label="outlineStorageDescription.text" :saved-warning="outlineStorageDescription.warning" :work-item-id="current.id" @composition-start="outlineComposing = true" @composition-end="totalOutline = $event; outlineComposing = false" :assistant-field="{ id: 'AppShell.totalOutline', read: () => totalOutline, write: value => { totalOutline = String(value) } }" v-if="outlineMode === 'total'" v-show="!expansionOpen" kind="total" document-label="总纲" title-prefix="全书总纲" :document-title="current.title" v-model="totalOutline" :document-key="`${current?.path}:total`" aria-label="全局总纲正文" :read-only="Boolean(outlinePlanningIssue)" placeholder="写下整本书的故事核心、主线冲突、阶段变化与最终结局……" @save="saveOutline" />
          <AnnotatedDocumentEditor ref="outlineEditor" :assistant-open="assistantPresented" @focus-mode="editorFocusMode = $event" @assistant-toggle="assistantPresented = !assistantPresented" @guidance="toggleGuidance" :save-state="outlineStorageFeedback.saveStatus(outlineStorageKey).pending ? 'saving' : outlineStorageFeedback.saveStatus(outlineStorageKey).error ? 'error' : (outlineMode === 'chapter' ? chapterOutlineDirty : planningOutlineDirty) ? 'dirty' : 'saved'" :save-error-message="outlineStorageFeedback.saveStatus(outlineStorageKey).error" :save-revision="outlineStorageFeedback.saveStatus(outlineStorageKey).revision" :saved-label="outlineStorageDescription.text" :saved-warning="outlineStorageDescription.warning" :work-item-id="current.id" @composition-start="outlineComposing = true" @composition-end="volumeOutline = $event; outlineComposing = false" :assistant-field="{ id: 'AppShell.volumeOutline', read: () => volumeOutline, write: value => { volumeOutline = String(value) } }" v-else-if="outlineMode === 'volume'" v-show="!expansionOpen && selectedVolume" kind="volume" document-label="卷纲" :title-prefix="'第 ' + selectedVolume + ' 卷'" :document-title="selectedVolumeMeta?.title || '卷纲'" :legacy-id="selectedVolume" v-model="volumeOutline" :document-key="`${current?.path}:volume:${selectedVolume}`" aria-label="当前卷纲正文" :read-only="Boolean(outlinePlanningIssue) || !selectedVolume" placeholder="写下本卷目标、阶段冲突、事件顺序、人物状态变化和卷末落点……" @save="saveVolumeOutline" />
          <AnnotatedDocumentEditor v-else-if="outlineMode === 'stage'" v-show="!expansionOpen" ref="outlineEditor" :assistant-open="assistantPresented" @focus-mode="editorFocusMode = $event" @assistant-toggle="assistantPresented = !assistantPresented" @guidance="toggleGuidance" :save-state="outlineStorageFeedback.saveStatus(outlineStorageKey).pending ? 'saving' : outlineStorageFeedback.saveStatus(outlineStorageKey).error ? 'error' : (outlineMode === 'chapter' ? chapterOutlineDirty : planningOutlineDirty) ? 'dirty' : 'saved'" :save-error-message="outlineStorageFeedback.saveStatus(outlineStorageKey).error" :save-revision="outlineStorageFeedback.saveStatus(outlineStorageKey).revision" :saved-label="outlineStorageDescription.text" :saved-warning="outlineStorageDescription.warning" :work-item-id="current.id" @composition-start="outlineComposing = true" @composition-end="stageOutline = $event; outlineComposing = false" :assistant-field="{ id: 'AppShell.stageOutline', read: () => stageOutline, write: value => { stageOutline = String(value) } }" kind="stage" document-label="阶段纲" title-editable title-aria-label="当前阶段名称" :save-disabled="!stageTitle.trim()" :legacy-id="selectedStage" v-model:document-title="stageTitle" v-model="stageOutline" :document-key="`${current?.path}:stage:${selectedStage}`" aria-label="当前阶段纲正文" :read-only="Boolean(outlinePlanningIssue) || !selectedStage" placeholder="写下这一阶段的入口状态、主要目标、冲突升级、关键转折、退出状态……" @save="saveStageOutline" />
          <AnnotatedDocumentEditor ref="outlineEditor" :assistant-open="assistantPresented" @focus-mode="editorFocusMode = $event" @assistant-toggle="assistantPresented = !assistantPresented" @guidance="toggleGuidance" :save-state="outlineStorageFeedback.saveStatus(outlineStorageKey).pending ? 'saving' : outlineStorageFeedback.saveStatus(outlineStorageKey).error ? 'error' : (outlineMode === 'chapter' ? chapterOutlineDirty : planningOutlineDirty) ? 'dirty' : 'saved'" :save-error-message="outlineStorageFeedback.saveStatus(outlineStorageKey).error" :save-revision="outlineStorageFeedback.saveStatus(outlineStorageKey).revision" :saved-label="outlineStorageDescription.text" :saved-warning="outlineStorageDescription.warning" :work-item-id="current.id" @composition-start="outlineComposing = true" @composition-end="chapterOutline = $event; outlineComposing = false" :assistant-field="{ id: 'AppShell.chapterOutline', read: () => chapterOutline, write: value => { chapterOutline = String(value) } }" v-else v-show="!expansionOpen && selectedId" kind="chapter-outline" document-label="章纲" :title-prefix="'第 ' + selectedChapterPosition + ' 章'" :document-title="chapterTitle || '章纲'" :legacy-id="selectedId" v-model="chapterOutline" :document-key="`${current?.path}:chapter:${selectedId}`" aria-label="当前章纲正文" :read-only="outlineDocumentLocked || !selectedId" placeholder="进入状态：人物、地点与关键事实。按顺序写剧情节点、退出状态、允许扩写和禁止提前发生的事件。" @save="saveChapterOutline" />

          <aside v-if="outlineStorageDescription.warning" class="outline-storage-warning" role="status">{{ outlineStorageDescription.text }}<button class="control-button compact" type="button" :disabled="outlineStorageFeedback.loading.value" @click="outlineStorageFeedback.refresh()">核对存储状态</button></aside>

          <div v-show="outlineInspectorOpen && !outlinePlanningIssue && !chapterOrderIssue" class="outline-inspector-layer" data-testid="outline-inspector" @click.self="outlineInspectorOpen = false">
            <aside class="outline-inspector" aria-label="故事结构与一致性检查">
              <header><div><span>案边</span><b>{{ outlineMode === 'total' ? '篇卷、事件与总纲检查' : outlineMode === 'volume' ? '卷纲与阶段结构' : outlineMode === 'stage' ? '阶段范围与章节' : '章纲归卷与阶段' }}</b></div><button type="button" aria-label="关闭结构与检查" @click="outlineInspectorOpen = false"><StudioIcon name="close" :size="17"/></button></header>
              <div class="outline-inspector-body">
                <template v-if="outlineMode === 'total'">
                  <div class="planning-review-stack"><section class="outline-event-shelf"><header><div><b>篇卷与正式事件</b><small>在这里建立卷，并决定正式事件进入总纲、卷纲还是章节契约。</small></div><span>第 {{ outlinePlanning.totalRevision || '—' }} 版 · {{ outlinePlanning.volumes.length }} 卷 · {{ outlinePlanning.unplacedEventIds.length }} 项待分卷</span></header><div class="volume-planner"><form @submit.prevent="createOutlineVolume"><label for="volume-title">建立篇卷</label><input v-assist-field="{ id: 'AppShell.volumeDraft', read: () => volumeDraft, write: value => { volumeDraft = String(value) } }" id="volume-title" v-model="volumeDraft" maxlength="120" placeholder="例如：旧声入梦"><button class="text-action compact" type="submit" :disabled="busy || !volumeDraft.trim()"><StudioIcon name="plus" :size="15"/>建立</button></form><div v-if="outlinePlanning.volumes.length" class="volume-strip"><article v-for="volume in outlinePlanning.volumes" :key="volume.volume" role="button" tabindex="0" :aria-label="`打开第 ${volume.volume} 卷卷纲`" @click="openVolumeOutline(volume.volume)" @keydown.enter="openVolumeOutline(volume.volume)"><i>{{ String(volume.volume).padStart(2, '0') }}</i><div><OutlineVolumeName :volume="volume.volume" :title="volume.title" @rename="renameOutlineVolume(volume.volume, $event)"/><small>{{ volume.outlineExists ? `卷纲第 ${volume.revision} 版` : '卷纲待写' }} · {{ volume.eventIds.length }} 项事件</small></div></article></div><p v-else>短篇可以只写总纲；长篇按故事阶段建立卷。</p></div><div v-if="approvedEvents.length" class="outline-event-strip"><article v-for="item in approvedEvents" :key="item.id" :class="{ assigned: outlinePlanning.assignedEventIds.includes(item.id) }"><i>{{ eventVolume(item.id) ? String(eventVolume(item.id).volume) : outlinePlanning.assignedEventIds.includes(item.id) ? '纲' : '事' }}</i><div><b>{{ item.event }}</b><small>{{ item.time }} · {{ item.characters.join('、') }} · {{ item.location }}</small><em>{{ eventPlacementLabel(item.id) }}</em></div><label class="event-placement">位置<select :value="eventPlacementValue(item.id)" :aria-label="`${item.event}的规划位置`" @change="setEventPlacement(item.id, $event.target.value)"><option value="unassigned">未纳入总纲</option><option value="total">只入总纲 · 待分卷</option><option v-for="volume in outlinePlanning.volumes" :key="volume.volume" :value="volume.volume">第 {{ volume.volume }} 卷 · {{ volume.title }}</option><optgroup v-if="outlinePlanning.chapterPlacements.length" label="进入章节契约"><option v-for="placement in outlinePlanning.chapterPlacements" :key="`chapter-${placement.chapterId}`" :value="`chapter:${placement.chapterId}`">第 {{ chapterPosition(placement.chapterId) }} 章 · 第 {{ placement.volume }} 卷</option></optgroup></select></label></article></div><p v-else>素材库还没有已确认事件。</p><em v-if="outlinePlanning.externalChangeDetected">检测到应用外改动；再次保存会建立新版本。</em></section><section v-if="planningOutlineReview" class="outline-review-sheet planning-review" :class="`review-${planningOutlineReview.status}`" aria-label="大纲本地预审"><i aria-hidden="true">校</i><div class="review-copy"><header><b>{{ planningReviewLabel }}</b><em :class="`approval-${planningOutlineApproval?.status}`">{{ planningApprovalLabel }}</em><span>{{ planningOutlineReview.metrics.characterCount }} 字 · {{ planningOutlineReview.metrics.causalCueCount }} 个因果线索 · {{ planningOutlineReview.metrics.eventCount }} 项事件</span></header><ul v-if="planningOutlineReview.issues.length"><li v-for="issue in planningOutlineReview.issues" :key="issue.code" :class="issue.level">{{ issue.message }}<small>{{ issue.suggestion }}</small></li></ul><small v-else>离线结构检查通过。</small></div><div class="planning-review-actions"><button class="review-confirm review-acknowledge" type="button" :disabled="busy || planningOutlineDirty || planningOutlineReview.status === 'clear' || planningOutlineReview.status === 'acknowledged'" @click="acknowledgePlanningReview">{{ planningOutlineDirty ? '先保存' : planningOutlineReview.status === 'acknowledged' ? '提示已知' : planningOutlineReview.status === 'clear' ? '无需略过' : '提示已知' }}</button><button class="review-confirm planning-confirm" type="button" :disabled="busy || planningOutlineDirty || !planningOutlineApproval?.canConfirm" @click="confirmPlanningOutline">{{ planningOutlineDirty ? '先保存' : planningOutlineApproval?.status === 'confirmed' ? '已正式确认' : planningOutlineApproval?.status === 'stale' ? '重新确认' : '正式确认' }}</button></div></section></div>
                </template>
                <template v-else-if="outlineMode === 'volume'">
                  <div class="planning-review-stack"><section class="outline-version-bar" :class="{ stale: selectedVolumeMeta?.externalChangeDetected }"><div><b>{{ selectedVolumeMeta?.outlineExists ? `卷纲第 ${selectedVolumeMeta.revision} 版` : '卷纲尚未建立' }}</b><small v-if="selectedVolumeMeta?.externalChangeDetected">检测到应用外变化；本卷章纲已经过期。</small><small v-else>修改卷纲只会使本卷章纲需要复核。</small></div><span>{{ selectedVolumeMeta?.externalChangeDetected ? '外部改动' : `${selectedVolumeMeta?.eventIds.length || 0} 项事件` }}</span></section><section class="stage-builder"><header><div><b>阶段目录</b><small>阶段位于卷纲与章纲之间，用来约束一段连续剧情。</small></div><span>{{ stageOutlines.filter((stage) => stage.volume === selectedVolume).length }} 个</span></header><form @submit.prevent="createOutlineStage"><input v-assist-field="{ id: 'AppShell.stageDraftTitle', read: () => stageDraftTitle, write: value => { stageDraftTitle = String(value) } }" v-model="stageDraftTitle" maxlength="120" placeholder="例如：身份暴露前夜" aria-label="新阶段名称"><button class="text-action compact" type="submit" data-testid="create-outline-stage" :disabled="busy || !selectedVolume || !stageDraftTitle.trim()"><StudioIcon name="plus" :size="15"/>建立阶段</button></form><button v-for="stage in stageOutlines.filter((item) => item.volume === selectedVolume)" :key="stage.stage" type="button" class="stage-builder-item" @click="openStageOutline(stage)"><i>段</i><span><b>{{ stage.title }}</b><small>{{ stage.chapterIds.length }} 章 · {{ stage.content.trim() ? `${stage.content.trim().length} 字` : '待写阶段纲' }}</small></span><StudioIcon name="chevron-right" :size="14"/></button></section><section v-if="planningOutlineReview" class="outline-review-sheet planning-review" :class="`review-${planningOutlineReview.status}`" aria-label="大纲本地预审"><i aria-hidden="true">校</i><div class="review-copy"><header><b>{{ planningReviewLabel }}</b><em :class="`approval-${planningOutlineApproval?.status}`">{{ planningApprovalLabel }}</em><span>{{ planningOutlineReview.metrics.characterCount }} 字 · {{ planningOutlineReview.metrics.causalCueCount }} 个因果线索 · {{ planningOutlineReview.metrics.eventCount }} 项事件</span></header><ul v-if="planningOutlineReview.issues.length"><li v-for="issue in planningOutlineReview.issues" :key="issue.code" :class="issue.level">{{ issue.message }}<small>{{ issue.suggestion }}</small></li></ul><small v-else>离线结构检查通过。</small></div><div class="planning-review-actions"><button class="review-confirm review-acknowledge" type="button" :disabled="busy || planningOutlineDirty || planningOutlineReview.status === 'clear' || planningOutlineReview.status === 'acknowledged'" @click="acknowledgePlanningReview">{{ planningOutlineDirty ? '先保存' : planningOutlineReview.status === 'acknowledged' ? '提示已知' : planningOutlineReview.status === 'clear' ? '无需略过' : '提示已知' }}</button><button class="review-confirm planning-confirm" type="button" :disabled="busy || planningOutlineDirty || !planningOutlineApproval?.canConfirm" @click="confirmPlanningOutline">{{ planningOutlineDirty ? '先保存' : planningOutlineApproval?.status === 'confirmed' ? '已正式确认' : planningOutlineApproval?.status === 'stale' ? '重新确认' : '正式确认' }}</button></div></section></div>
                </template>
                <template v-else-if="outlineMode === 'stage'">
                  <div class="stage-inspector-summary"><i>段</i><div><b>{{ selectedStageMeta?.title || '阶段待选择' }}</b><p>属于第 {{ selectedStageMeta?.volume || '—' }} 卷；阶段纲保存后会生成独立 Markdown 镜像。</p><small>当前已归入 {{ selectedStageMeta?.chapterIds.length || 0 }} 章。章节可在各自章纲的“归卷与阶段”中调整。</small></div></div>
                </template>
                <template v-else>
                  <div class="chapter-review-stack"><section class="outline-version-bar" :class="{ stale: outlinePlanning.chapter?.stale }"><div><b>{{ outlinePlanning.chapter?.stale ? '章纲需要重新确认' : outlinePlanning.chapter?.hasContent ? '章纲版本有效' : '章纲尚未建立' }}</b><small v-if="outlinePlanning.chapter?.stale">上游大纲已经变化；保存后仍需重新确认。</small><small v-else-if="outlinePlanning.chapter?.hasContent">基于总纲第 {{ outlinePlanning.chapter.basedOnTotalRevision }} 版{{ selectedChapterVolume ? ` · 卷纲第 ${outlinePlanning.chapter.basedOnVolumeRevision}` : '' }}。</small><small v-else>首次保存会记录当前上游版本。</small></div><div class="chapter-structure-placement"><label class="chapter-volume-placement">归属篇卷<select :value="selectedChapterVolume || 'unassigned'" :disabled="!selectedId" aria-label="当前章节所属篇卷" @change="setChapterPlacement($event.target.value)"><option value="unassigned">待归卷</option><option v-for="volume in outlinePlanning.volumes" :key="volume.volume" :value="volume.volume">第 {{ volume.volume }} 卷 · {{ volume.title }}</option></select></label><label class="chapter-volume-placement">所属阶段<select :value="selectedChapterStage?.stage || 'unassigned'" :disabled="!selectedId || !selectedChapterVolume || !outlinePlanning.chapter?.hasContent" aria-label="当前章节所属阶段" data-testid="chapter-stage-select" @change="setChapterStage($event.target.value)"><option value="unassigned">本卷直属</option><option v-for="stage in selectedVolumeStages" :key="stage.stage" :value="stage.stage">{{ stage.title }}</option></select></label></div></section><section v-if="chapterReview" class="outline-review-sheet" :class="`review-${chapterReview.status}`" aria-label="章纲结构审核"><i aria-hidden="true">审</i><div class="review-copy"><header><b>{{ chapterReviewLabel }}</b><span>{{ chapterReview.metrics.beatCount }} 节点 · {{ chapterReview.metrics.boundaryCount }}/3 边界 · {{ chapterReview.metrics.foreshadowCount }} 伏笔 · {{ chapterReview.metrics.forbiddenCount }} 禁写</span></header><ul v-if="chapterReview.issues.length"><li v-for="issue in chapterReview.issues" :key="issue.code" :class="issue.level">{{ issue.message }}</li></ul><small v-else>{{ chapterReview.status === 'confirmed' ? '本版已经锁定为正文契约。' : '结构检查通过；确认后才开放 AI 正文。' }}</small></div><button class="review-confirm" type="button" :disabled="busy || chapterOutlineDirty || !chapterReview.canConfirm || chapterReview.status === 'confirmed'" @click="confirmChapterOutline">{{ chapterOutlineDirty ? '先保存' : chapterReview.status === 'confirmed' ? '已确认' : '确认本版' }}</button></section><ChapterStoryConstraints v-if="current && selectedId" :work-item-id="current.id" :chapter-id="selectedId" :content="chapterOutline" :disabled="busy || chapterOutlineDirty || outlineDocumentLocked" @saved="refreshWorkflow()" /><ChapterUpstreamReview v-if="current && selectedId" :work-item-id="current.id" :chapter-id="selectedId" :review="chapterReview?.upstream" :disabled="busy || chapterOutlineDirty" @saved="refreshWorkflow()" /></div>
                </template>
              </div>
            </aside>
          </div>
        </div>

        <TimelineWorkbench v-else-if="active === 'timeline'" :scope="timelineWorkbenchScope" />

        <DefinitionWorkbench v-else-if="['profile', 'preparation'].includes(active)" :scope="definitionWorkbenchScope" @import-project="importProject" />

        <div v-else-if="active === 'world'" class="document-editor archive-page"><ArchivePageHeader eyebrow="03 / WORLD FOUNDATION · 本书设定" title="世界观" description="写下故事运转的规则，以及正文不能越过的边界。"><button class="control-button primary compact save-action" type="button" @click="saveFoundation"><StudioIcon name="save" :size="15"/>保存世界观</button></ArchivePageHeader><textarea v-assist-field="{ id: 'AppShell.foundation.worldView', read: () => foundation.worldView, write: value => { foundation.worldView = String(value) }, identity: () => foundation }" v-model="foundation.worldView" class="longform" placeholder="写下时代背景、空间范围、社会秩序、力量规则、核心矛盾，以及绝不能被正文违反的边界……"></textarea></div>

        <div v-else-if="active === 'realms'" class="structured-editor narrow archive-page" data-testid="realm-config-page"><ArchivePageHeader eyebrow="03 / POWER SYSTEM · 本书设定" title="力量与境界"><template #context><label class="inline-preference"><input v-assist-field="{ id: 'AppShell.foundation.useRealms', read: () => foundation.useRealms, write: value => { foundation.useRealms = Boolean(value) }, identity: () => foundation }" v-model="foundation.useRealms" type="checkbox">本书启用明确境界等级</label></template><div><button class="control-button secondary compact" type="button" data-testid="add-realm-level" @click="addRealm"><StudioIcon name="plus" :size="15"/>添加境界</button><button class="control-button primary compact" type="button" data-testid="save-realm-config" @click="saveRealms"><StudioIcon name="save" :size="15"/>保存设定</button></div></ArchivePageHeader><section class="power-system-overview"><label>力量体系总述<textarea v-assist-field="{ id: 'AppShell.powerSystem.overview', read: () => powerSystem.overview, write: value => { powerSystem.overview = String(value) }, identity: () => powerSystem }" v-model="powerSystem.overview" placeholder="描述力量来源、成长代价、职业路径或能力边界；暂时没有完整规则也可以只写大概……"></textarea></label><small>总述可以很宽泛；只有下方境界表会参与越级检查。未勾选启用时，境界表不会成为章纲门禁。</small></section><div class="realm-list"><section v-for="(item, index) in realms" :key="item.id" class="realm-row"><b>{{ index + 1 }}</b><input v-assist-field="{ id: 'Realm.name', read: () => item.name, write: value => { item.name = String(value) }, identity: () => item }" v-model="item.name" :aria-label="`第 ${index + 1} 层境界名称`" placeholder="境界名称"><textarea v-assist-field="{ id: 'Realm.description', read: () => item.description, write: value => { item.description = String(value) }, identity: () => item }" v-model="item.description" :aria-label="`第 ${index + 1} 层境界边界`" placeholder="能力边界、突破条件、典型表现"></textarea><button class="icon-danger" type="button" :aria-label="`删除第 ${index + 1} 层境界`" @click="realms.splice(index, 1)"><StudioIcon name="close" :size="16"/></button></section></div></div>

        <div v-else-if="active === 'system'" class="document-editor system-config-editor archive-page" data-testid="system-ui-config-page"><ArchivePageHeader eyebrow="03 / SYSTEM TEMPLATE · 本书设定" title="金手指与系统界面"><template #context><label class="inline-preference"><input v-assist-field="{ id: 'AppShell.foundation.useSystem', read: () => foundation.useSystem, write: value => { foundation.useSystem = Boolean(value) }, identity: () => foundation }" v-model="foundation.useSystem" type="checkbox">本书启用固定系统界面</label></template><button class="control-button primary compact" type="button" data-testid="save-system-ui-config" @click="saveSystemTemplate"><StudioIcon name="save" :size="15"/>保存设定</button></ArchivePageHeader><section class="power-system-overview"><label>金手指 / 特殊优势总述<textarea v-assist-field="{ id: 'AppShell.cheatSystem.overview', read: () => cheatSystem.overview, write: value => { cheatSystem.overview = String(value) }, identity: () => cheatSystem }" v-model="cheatSystem.overview" placeholder="描述主角独有的知识、天赋、道具、系统或信息差，以及限制、代价和不能做到的事……"></textarea></label><small>填写能力及限制；显示样式在下方设置。</small></section><div class="system-template-workbench"><label class="system-template-editor">系统界面固定模板<textarea v-assist-field="{ id: 'AppShell.systemTemplate', read: () => systemTemplate, write: value => { systemTemplate = String(value) } }" v-model="systemTemplate" class="longform code-like" aria-label="系统界面模板"></textarea><small v-if="!foundation.useSystem">未启用：生成时不使用系统弹窗。</small><small v-else>正文出现系统提示时必须严格套用此模板，不得临时更换排列或标题。</small></label><section class="system-template-preview" aria-label="系统界面模板预览"><header><span>固定样式预览</span><small>预览保留占位符。</small></header><pre>{{ systemTemplate || '模板尚未填写' }}</pre></section></div></div>

        <SettingsWorkbench v-else :scope="settingsWorkbenchScope" />
      </section>

<HostedPanel :narrow="hostedNarrow" :open="assistantPresented && !groupChatOpen && !inspirationOpen" label="智能助笔" id="hosted-assistant-panel" @close="assistantPresented = false"><GlobalAssistantHost :visible="!groupChatOpen && !inspirationOpen" v-if="desktop && current" ref="globalAssistantHost" v-model:open="assistantPresented" v-model:mode="assistantMode" :api="desktop.fieldAssistant" :always-confirm-before-send="Boolean(contextBudgetPreferences.alwaysConfirmBeforeSend)" :page="activeWorkspaceLeaf?.id || active" :page-label="activeWorkspaceLeaf?.label || '作品'" :has-book="true" :has-chapter="Boolean(selectedId)" :chapter-id="selectedId || null" :selected-characters="manuscriptSelection?.text?.length || 0" :prose-snapshot="JSON.stringify({chapter:selectedId,content:chapterContent,selection:manuscriptSelection,anchor:manuscriptInsertionAnchor})" :prose-handler="sendAssistantProse" :navigate-handler="navigateAssistantWorkspace" :task-active="writingAgentRunning" :models="writingAgentModelChoices" :connections="oneOffConnections">
        <template #prose>
            <WritingAgentPanel ref="embeddedWritingAgent" embedded @compose="globalAssistantHost?.compose($event)" :turns="visibleWritingAgentTurns" :busy="writingAgentRunning" :applying-turn-id="writingAgentApplyingTurnId" :active-task="activeWritingAgentTask" :recoverable-tasks="recoverableWritingAgentTasks" :context-preview="writingAgentContextPreview" :context-preview-busy="writingAgentContextPreviewBusy" :always-confirm-before-send="Boolean(contextBudgetPreferences.alwaysConfirmBeforeSend)" :quick-action="writingAgentQuickAction" :disabled="busy || !selectedId || Boolean(chapterOrderIssue) || Boolean(characterStateIssue) || Boolean(outlinePlanningIssue)" :selected-characters="manuscriptSelection?.text?.length || 0" :insertion-anchor-offset="manuscriptInsertionAnchor?.offset ?? null" :models="writingAgentModelChoices" :connections="oneOffConnections" @send="runWritingAgent" @preview-context="previewWritingAgentContext" @pause="pauseWritingAgentTask" @cancel="cancelWritingAgentTask" @resume="resumeWritingAgentTask" @retry="retryWritingAgentTask" @dismiss="dismissWritingAgentTask" @apply-partial="applyWritingAgentPartial" @discard-partial="discardWritingAgentPartial" @apply="applyWritingAgentTurn" @discard="discardWritingAgentTurn" @adopt-card="openChapterCardAdoption" />
          </template>
        <template #checks>
            <ProseEventSettlement v-if="current && selectedId" :key="'settlement:'+current.id+':'+selectedId" :work-item-id="current.id" :chapter-id="selectedId" :body="chapterContent" :title="chapterTitle" :disabled="busy || settlementSourceComposing || saveState !== 'saved' || Boolean(chapterOrderIssue)" />
            <ConsistencyOverviewPanel v-if="consistencyOverview" :overview="consistencyOverview" :busy="busy" @select-item="openConsistencyItem" @write="returnToManuscript" />
            <section v-if="selectedId" class="fact-extraction-action chapter-review-action"><header><b>章卡与审校</b><small>需要按章纲核对时再打开；日常手写不必使用</small></header><div><button class="text-action compact" type="button" data-testid="open-chapter-card" @click="openChapterCard">查看本章章卡</button></div></section>
            <div v-if="characterStateIssue" class="material-source-locked" data-testid="character-state-ledger-locked"><i>锁</i><div><b>人物状态账本待核对</b><p>正文仍可手写保存；人物连续性、事实包与 AI 正文已锁定，岚笺不会把损坏状态当作无人或无记忆。</p><small>原文件没有被改动；请定位 `.webnovel/story-state/characters.json` 后人工恢复。</small></div></div>
            <div v-if="chapterOrderIssue" class="material-source-locked" data-testid="chapter-order-ledger-locked"><i>锁</i><div><b>章节顺序账本待核对</b><p>当前只按稳定文件编号列出独立正文；叙事顺序未知，保存、删除、重排、导入和 AI 写作均已暂停。</p><small>原文件和正文没有被改动；请定位 `.webnovel/manuscript/chapter-order.json` 后人工恢复。</small></div></div>
            <section v-if="selectedId" class="fact-extraction-action"><header><b>重要变化</b><small>{{ factExtractionDescription }}</small></header><div><button v-if="factExtractionBusy" class="text-action compact" type="button" @click="cancelFactExtraction">停止提炼</button><button v-else-if="factExtractionRetryId" class="text-action compact" type="button" @click="retryFactExtraction">重新提炼</button><button v-else-if="!chapterPlanning?.confirmedBodyVersionId" class="text-action compact" type="button" :disabled="chapterCardSaving || !chapterContent.trim()" @click="confirmAndExtractCurrentChapterFacts">确认正文并提炼</button><button v-else class="text-action compact" type="button" @click="extractCurrentChapterFacts">基于确认版提炼</button></div></section>
            <details v-if="factExtractionRawResult" class="fact-extraction-raw"><summary>查看模型最初返回的内容</summary><p>自动修复仍未通过格式校验，原文已保留，没有写入正式事实。</p><pre>{{ factExtractionRawResult }}</pre></details>
            <FactReviewPanel v-if="factBatches.length" :batches="factBatches" :busy="factReviewBusy" :minimum-importance="contextBudgetPreferences.minimumFactImportance" :show-confirmations="contextBudgetPreferences.showFactConfirmations" @decide="decideFactChanges" @continue-writing="continueAfterFactReview" />
            <ContextFactPackLedger v-if="contextFactPack" :pack="contextFactPack" :pinned-evidence-keys="contextBudgetPreferences.pinnedEvidenceKeys" :excluded-evidence-keys="contextBudgetPreferences.excludedEvidenceKeys" @pin-evidence="updateContextEvidencePreference($event, 'pin')" @exclude-evidence="updateContextEvidencePreference($event, 'exclude')" />
          </template>
        <template #tasks>
            <TaskCenterPanel :items="taskCenterItems" :loading="taskCenterLoading" :busy-id="taskCenterBusyId" @refresh="loadTaskCenter" @action="handleTaskCenterAction" />
          </template>
      </GlobalAssistantHost></HostedPanel>


      <DialogTransition @escape="aiConnectionDeletePreview = null">
      <div v-if="aiConnectionDeletePreview" class="modal-backdrop ai-settings-danger-backdrop" @click.self="aiConnectionDeletePreview = null">
        <section class="ai-settings-danger-dialog" role="alertdialog" aria-modal="true" aria-labelledby="ai-connection-delete-title" aria-describedby="ai-connection-delete-description">
          <header><div><p class="eyebrow">模型接口 · 保存后生效</p><h2 id="ai-connection-delete-title">移除“{{ aiConnectionDeletePreview.connectionName }}”？</h2></div><button type="button" aria-label="关闭移除接口确认" @click="aiConnectionDeletePreview = null"><StudioIcon name="close" :size="18"/></button></header>
          <p id="ai-connection-delete-description">接口地址和安全存储中的密钥会在保存后移除。请先确认受影响的模型任务要改到哪个接口。</p>
          <div v-if="aiConnectionDeletePreview.affected.length" class="ai-settings-impact"><b>受影响的分配</b><span v-for="item in aiConnectionDeletePreview.affected" :key="item">{{ item }}</span></div>
          <div v-else class="ai-settings-impact quiet"><b>没有任务正在使用此接口</b><span>保存后只移除接口与对应密钥。</span></div>
          <label>改用接口<select v-model="aiConnectionDeletePreview.fallbackConnectionId" data-testid="ai-connection-delete-fallback"><option v-for="connection in ai.connections.filter((item) => item.id !== aiConnectionDeletePreview.connectionId)" :key="connection.id" :value="connection.id">{{ connectionOptionLabel(connection) }}</option></select></label>
          <footer><button class="text-action" type="button" @click="aiConnectionDeletePreview = null">继续保留</button><button class="trash-confirm" type="button" data-testid="confirm-remove-ai-connection" @click="confirmRemoveAiConnection">确认移除接口</button></footer>
        </section>
      </div>
      </DialogTransition>

      <DialogTransition @escape="aiCredentialClearPreview = null">
      <div v-if="aiCredentialClearPreview" class="modal-backdrop ai-settings-danger-backdrop" @click.self="aiCredentialClearPreview = null">
        <section class="ai-settings-danger-dialog compact" role="alertdialog" aria-modal="true" aria-labelledby="ai-credential-clear-title" aria-describedby="ai-credential-clear-description">
          <header><div><p class="eyebrow">安全存储 · 保存后生效</p><h2 id="ai-credential-clear-title">清除“{{ aiCredentialClearPreview.connectionName }}”的密钥？</h2></div><button type="button" aria-label="关闭清除密钥确认" @click="aiCredentialClearPreview = null"><StudioIcon name="close" :size="18"/></button></header>
          <p id="ai-credential-clear-description">接口地址和任务分配会保留，但在重新填写密钥前，这个接口无法生成内容。</p>
          <footer><button class="text-action" type="button" @click="aiCredentialClearPreview = null">取消</button><button class="trash-confirm" type="button" data-testid="confirm-clear-ai-credential" @click="confirmClearAiCredential">确认清除密钥</button></footer>
        </section>
      </div>
      </DialogTransition>

      <DialogTransition @escape="!busy && closeSqliteShadowMigration()">
      <div v-if="sqliteShadowPreview || sqliteShadowResult" class="modal-backdrop sqlite-shadow-backdrop" @click.self="!busy && closeSqliteShadowMigration()">
        <section class="sqlite-shadow-dialog" role="dialog" aria-modal="true" aria-labelledby="sqlite-shadow-title" data-testid="sqlite-shadow-migration-dialog">
          <header><div><p class="eyebrow">项目数据 · 渐进迁移</p><h2 id="sqlite-shadow-title">{{ sqliteShadowResult ? '影子副本核对完成' : '建立 SQLite 影子副本' }}</h2><small>{{ sqliteShadowResult ? '这一步没有切换正式数据源；现在的编辑与保存方式保持不变。' : '先看清要写入什么，再决定是否建立；关闭对话框不会产生任何文件。' }}</small></div><button type="button" aria-label="关闭迁移核对" :disabled="busy" @click="closeSqliteShadowMigration"><StudioIcon name="close" :size="18"/></button></header>
          <div class="storage-confirmation-reading">
          <template v-if="sqliteShadowResult">
            <div class="shadow-success-ledger">
              <span class="shadow-success-seal" aria-hidden="true">验</span>
              <div><b>数据库与原稿逐章一致</b><p>本次写入 {{ sqliteShadowResult.insertedVersions }} 个正文版本，{{ sqliteShadowResult.unchangedVersions }} 章保持不变；数据库完整性和章节关联均已通过。</p><code>{{ sqliteShadowResult.targetRelativePath }}</code></div>
            </div>
            <div class="shadow-contract-grid success"><article><span>正式来源</span><b>仍是 Markdown / JSON</b><p>普通打开、编辑和保存尚未切换。</p></article><article><span>回退方式</span><b>可删除影子数据库</b><p>不会影响现有正文与大纲文件。</p></article><article><span>下一阶段</span><b>镜像写回与切换预演</b><p>必须再次核对后才会进入。</p></article></div>
          </template>
          <template v-else-if="sqliteShadowPreview">
            <div class="shadow-impact-strip"><div><span>扫描章节</span><b>{{ sqliteShadowPreview.chapterCount.toLocaleString() }} 章</b></div><div><span>正文总字数</span><b>{{ sqliteShadowPreview.totalWords.toLocaleString() }} 字</b></div><div><span>写入位置</span><b>作品内部</b></div></div>
            <div v-if="sqliteShadowPreview.blockers.length" class="shadow-blockers"><article v-for="blocker in sqliteShadowPreview.blockers" :key="`${blocker.code}-${blocker.message}`"><span>阻断</span><div><b>{{ blocker.code }}</b><p>{{ blocker.message }}</p></div></article></div>
            <div v-else class="shadow-contract-grid"><article><span>01</span><b>原稿不改写</b><p>Markdown、JSON、章节顺序和文件名保持原样。</p></article><article><span>02</span><b>版本只追加</b><p>相同内容不会重复，变化章节保留前一版。</p></article><article><span>03</span><b>失败即停</b><p>校验失败不会让半成品数据库接管作品。</p></article></div>
            <div class="shadow-target-path"><span>准备建立</span><code>{{ sqliteShadowPreview.targetRelativePath }}</code><small v-if="sqliteShadowPreview.expiresAt">本次核对凭证 15 分钟内有效，且仅可使用一次。</small></div>
          </template>
          </div>
          <footer><span>{{ sqliteShadowResult ? '后续正式切换仍需要独立的预览、备份和恢复验证。' : sqliteShadowPreview?.canImport ? '点击建立后会再次读取并核对原稿；核对期间若有变化会自动中止。' : '请先处理上方阻断问题；当前没有可执行的写入凭证。' }}</span><div><button class="text-action" type="button" :disabled="busy" @click="closeSqliteShadowMigration">{{ sqliteShadowResult ? '完成' : '暂不建立' }}</button><button v-if="!sqliteShadowResult" class="seal-action small" data-testid="confirm-sqlite-shadow-migration" type="button" :disabled="busy || !sqliteShadowPreview?.canImport" @click="confirmSqliteShadowMigration"><span>{{ busy ? '正在逐章核对…' : '建立并校验' }}</span><i>建</i></button></div></footer>
        </section>
      </div>
      </DialogTransition>

      <DialogTransition @escape="!busy && closeSqliteActivation()">
      <div v-if="sqliteActivationPreview || sqliteActivationResult" class="modal-backdrop sqlite-shadow-backdrop" @click.self="!busy && closeSqliteActivation()">
        <section class="sqlite-shadow-dialog" role="dialog" aria-modal="true" aria-labelledby="sqlite-activation-title" data-testid="sqlite-activation-dialog">
          <header><div><p class="eyebrow">项目数据 · 正式切换</p><h2 id="sqlite-activation-title">{{ sqliteActivationResult ? 'SQLite 已接管正文保存' : '把 SQLite 设为正式数据源' }}</h2><small>{{ sqliteActivationResult ? '书稿界面已经重新载入；Markdown 与章节顺序继续作为可读镜像。' : '这不是自动升级。请确认保存职责、可读镜像和安全退回规则后再切换。' }}</small></div><button type="button" aria-label="关闭正式切换核对" :disabled="busy" @click="closeSqliteActivation"><StudioIcon name="close" :size="18"/></button></header>
          <div class="storage-confirmation-reading">
          <template v-if="sqliteActivationResult">
            <div class="shadow-success-ledger"><span class="shadow-success-seal" aria-hidden="true">正</span><div><b>{{ sqliteActivationResult.chapterCount }} 章已进入正式存储</b><p>SQLite 正文、历史版本和章节顺序已经生效；当前没有覆盖任何外部修改。</p><code>.webnovel/workspace.sqlite</code></div></div>
            <div class="shadow-contract-grid success"><article><span>正式来源</span><b>SQLite</b><p>保存、排序、版本恢复均以数据库提交为准。</p></article><article><span>可读镜像</span><b>Markdown / JSON</b><p>每次保存后原子写回，仍可直接查看。</p></article><article><span>安全退回</span><b>逐项一致才允许</b><p>有冲突或缺失时会拒绝退回。</p></article></div>
          </template>
          <template v-else-if="sqliteActivationPreview">
            <div class="shadow-impact-strip"><div><span>准备切换</span><b>{{ sqliteActivationPreview.chapterCount.toLocaleString() }} 章</b></div><div><span>正文总字数</span><b>{{ sqliteActivationPreview.totalWords.toLocaleString() }} 字</b></div><div><span>镜像策略</span><b>持续写回</b></div></div>
            <div v-if="sqliteActivationPreview.blockers.length" class="shadow-blockers"><article v-for="blocker in sqliteActivationPreview.blockers" :key="`${blocker.code}-${blocker.message}`"><span>阻断</span><div><b>{{ blocker.code }}</b><p>{{ blocker.message }}</p></div></article></div>
            <div v-else class="shadow-contract-grid"><article><span>01</span><b>先提交数据库</b><p>正文版本只追加，保存成功后再刷新镜像。</p></article><article><span>02</span><b>不覆盖外部修改</b><p>检测到 Markdown 变化会标记冲突并保留原文件。</p></article><article><span>03</span><b>可以安全退回</b><p>只在全部镜像逐字一致时恢复文件保存。</p></article></div>
            <div class="shadow-target-path"><span>正式数据库</span><code>.webnovel/workspace.sqlite</code><small v-if="sqliteActivationPreview.expiresAt">本次切换凭证 15 分钟内有效，且仅可使用一次。</small></div>
          </template>
          </div>
          <footer><span>{{ sqliteActivationResult ? '设置页会持续显示当前存储状态和镜像异常。' : sqliteActivationPreview?.canActivate ? '点击切换后会再次核对原稿，内容变化会自动中止。' : '请先处理上方阻断问题；当前不会切换。' }}</span><div><button class="text-action" type="button" :disabled="busy" @click="closeSqliteActivation">{{ sqliteActivationResult ? '完成' : '暂不切换' }}</button><button v-if="!sqliteActivationResult" class="seal-action small" data-testid="confirm-sqlite-activation" type="button" :disabled="busy || !sqliteActivationPreview?.canActivate" @click="confirmSqliteActivation"><span>{{ busy ? '正在逐章切换…' : '确认正式切换' }}</span><i>正</i></button></div></footer>
        </section>
      </div>
      </DialogTransition>

      <DialogTransition @escape="!busy && closeWorkspaceRestore()">
      <div v-if="workspaceRestorePreview" class="modal-backdrop sqlite-shadow-backdrop" @click.self="!busy && closeWorkspaceRestore()">
        <section class="sqlite-shadow-dialog workspace-restore-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-restore-title" data-testid="workspace-restore-dialog">
          <header><div><p class="eyebrow">项目数据 · 灾难恢复</p><h2 id="workspace-restore-title">{{ workspaceRestorePreview.canRestore ? `恢复《${workspaceRestorePreview.projectName}》的备份` : '这个备份暂时不能恢复' }}</h2><small>{{ workspaceRestorePreview.canRestore ? '这里只完成了只读核对。下一步会让你选择保存位置，并建立一部独立的新作品。' : '岚笺没有写入备份或当前作品，请根据下方原因检查备份文件夹。' }}</small></div><button type="button" aria-label="关闭恢复核对" :disabled="busy" @click="closeWorkspaceRestore"><StudioIcon name="close" :size="18"/></button></header>
          <div class="storage-confirmation-reading">
          <div v-if="workspaceRestorePreview.canRestore" class="shadow-impact-strip"><div><span>备份时间</span><b>{{ workspaceRestorePreview.createdAt?.slice(0, 10) }}</b></div><div><span>正文规模</span><b>{{ workspaceRestorePreview.chapterCount.toLocaleString() }} 章</b></div><div><span>存储状态</span><b>{{ workspaceRestorePreview.storageMode === 'sqlite' ? '正式存储' : '影子存储' }}</b></div></div>
          <div v-if="workspaceRestorePreview.blockers.length" class="shadow-blockers"><article v-for="blocker in workspaceRestorePreview.blockers" :key="`${blocker.code}-${blocker.message}`"><span>阻断</span><div><b>{{ blocker.code }}</b><p>{{ blocker.message }}</p></div></article></div>
          <div v-else class="shadow-contract-grid"><article><span>01</span><b>原作品不变</b><p>当前作品和原备份都不会被覆盖或改名。</p></article><article><span>02</span><b>逐文件校验</b><p>{{ workspaceRestorePreview.fileCount }} 个文件会再次核对大小和 SHA-256。</p></article><article><span>03</span><b>恢复后再打开</b><p>只有新副本完整落盘并通过数据库检查，才会切换过去。</p></article></div>
          <div v-if="workspaceRestorePreview.canRestore" class="shadow-target-path"><span>恢复方式</span><code>另存为新的作品文件夹</code><small>本次恢复凭证 15 分钟内有效，且只能使用一次；取消保存位置不会消耗凭证。</small></div>
          </div>
          <footer><span>{{ workspaceRestorePreview.canRestore ? '确认后仍会先让你选择恢复位置；如果目标冲突或校验失败，当前作品保持原样。' : '没有生成恢复凭证，因此无法执行任何写入。' }}</span><div><button class="text-action" type="button" :disabled="busy" @click="closeWorkspaceRestore">{{ workspaceRestorePreview.canRestore ? '暂不恢复' : '关闭' }}</button><button v-if="workspaceRestorePreview.canRestore" class="seal-action small" data-testid="confirm-workspace-restore" type="button" :disabled="busy" @click="confirmWorkspaceRestore"><span>{{ busy ? '正在恢复并复核…' : '选择位置并恢复副本' }}</span><i>复</i></button></div></footer>
        </section>
      </div>
      </DialogTransition>

      <LibraryDialogTransition @escape="!busy && closeCreateProject()">
      <div v-if="showCreate" class="modal-backdrop" @click.self="closeCreateProject">
        <form class="modal create-book-modal" role="dialog" aria-modal="true" aria-labelledby="create-project-title" novalidate @submit.prevent="createProject">
          <header><div><p class="eyebrow">作品库 · 新建空白作品</p><h2 id="create-project-title">{{ desktop?.app.platform === 'browser' ? '建立你的新作品' : '给新作品建立本地书案' }}</h2></div><button type="button" aria-label="关闭" :disabled="busy" @click="closeCreateProject"><StudioIcon name="close" :size="18"/></button></header>
          <p class="create-project-intro">{{ desktop?.app.platform === 'browser' ? '作品保存在你的账户书库中，可随时导出。' : '创建空白作品，不生成正文。' }}</p>
          <p v-if="partialCreation" role="alert">{{ partialCreation.message }} 这次只重试原创建操作，不使用下面修改后的书名或位置。</p>
          <ModelCreationDefaults :api="desktop.modelConnections" :disabled="busy" @ready="createModelsPreview = $event"/>
          <label :class="{ invalid: createErrors.name }"><span>作品名 <em>必填</em></span><input v-assist-field="{ id: 'AppShell.createForm.name', read: () => createForm.name, write: value => { createForm.name = String(value); createErrors.name = '' }, identity: () => createForm }" ref="createNameInput" v-model="createForm.name" required :aria-invalid="Boolean(createErrors.name)" :aria-describedby="createErrors.name ? 'create-name-error' : undefined" placeholder="例如：灯火照长安" @input="createErrors.name = ''"><small v-if="createErrors.name" id="create-name-error" class="field-error" role="alert">{{ createErrors.name }}</small></label>
          <label><span>小说种类</span><input v-model="createForm.genre" maxlength="80" placeholder="例如：都市奇幻" data-testid="create-book-genre"><small>创建后进入本书群聊。</small></label>
          <label v-if="desktop?.app.platform !== 'browser'" :class="{ invalid: createErrors.parentPath }"><span>本地保存位置 <em>必填</em></span><div class="path-row"><input v-model="createForm.parentPath" readonly required :aria-invalid="Boolean(createErrors.parentPath)" :aria-describedby="createErrors.parentPath ? 'create-path-error' : undefined" placeholder="选择本地文件夹"><button type="button" class="text-action compact" data-testid="choose-create-folder" :disabled="busy" @click="chooseCreateFolder">选择位置</button></div><small v-if="createErrors.parentPath" id="create-path-error" class="field-error" role="alert">{{ createErrors.parentPath }}</small><small v-else>岚笺会在所选位置下新建以作品名命名的文件夹。</small></label>
          <footer><button type="button" class="text-action" :disabled="busy" @click="closeCreateProject">取消</button><button class="control-button primary" :disabled="busy"><StudioIcon name="plus" :size="16"/>{{ busy ? '正在创建…' : '创建空白作品' }}</button></footer>
        </form>
      </div>

      </LibraryDialogTransition>

      <DialogTransition @escape="projectTrashTarget = null">
      <div v-if="projectTrashTarget" class="modal-backdrop delete-backdrop" @click.self="projectTrashTarget = null">
        <form class="delete-sheet project-trash-sheet" role="alertdialog" aria-modal="true" aria-labelledby="project-trash-title" aria-describedby="project-trash-description" data-testid="project-trash-confirmation" @submit.prevent="trashProject">
          <div class="delete-seal" aria-hidden="true">藏</div>
          <p class="eyebrow">作品管理 · 可恢复删除</p>
          <h2 id="project-trash-title">把《{{ projectTrashTarget.title }}》移入{{ desktop.app.platform === 'browser' ? '回收站' : '系统回收站' }}？</h2>
          <p id="project-trash-description">{{ desktop.app.platform === 'browser' ? '作品将从书库移入回收站，正文、设定、素材和大纲都会保留，可以随时恢复。' : '这会移动整部作品目录，包括正文、设定、素材、大纲和本书配置；不会永久销毁，可以从 Windows 回收站恢复。' }}</p>
          <dl v-if="desktop.app.platform !== 'browser'"><div><dt>作品位置</dt><dd>{{ projectTrashTarget.path }}</dd></div><div><dt>本书模型密钥</dt><dd>从岚笺安全设置中移除，恢复作品后需要重新填写</dd></div></dl>
          <label class="project-trash-verification">输入作品名以确认<input v-model="projectTrashConfirmation" data-testid="project-trash-name" autocomplete="off" :placeholder="projectTrashTarget.title"></label>
          <footer><button class="text-action" type="button" @click="projectTrashTarget = null">继续保留</button><button class="trash-confirm" data-testid="confirm-trash-work-item" :disabled="busy || projectTrashConfirmation !== projectTrashTarget.title">{{ desktop.app.platform === 'browser' ? '移入回收站' : '移入系统回收站' }}</button></footer>
        </form>
      </div>
      </DialogTransition>

      <DialogTransition @escape="planningAdoptionPreview = null">
      <div v-if="planningAdoptionPreview" class="modal-backdrop planning-adoption-backdrop" @click.self="planningAdoptionPreview = null">
        <section class="planning-adoption-sheet" role="alertdialog" aria-modal="true" aria-labelledby="planning-adoption-title" data-testid="planning-adoption-preview">
          <header><div><p class="eyebrow">候选转正 · 先看影响</p><h2 id="planning-adoption-title">采用《{{ planningAdoptionPreview.candidate.title }}》为正式总纲？</h2><small>系统会再次核对候选和正式总纲；预览后若任一内容变化，本次采用会自动中止。</small></div><button type="button" aria-label="关闭影响预览" @click="planningAdoptionPreview = null"><StudioIcon name="close" :size="18"/></button></header>
          <div class="adoption-impact-strip">
            <div><span>正式总纲</span><b>{{ planningAdoptionPreview.current.exists ? `版本 ${planningAdoptionPreview.current.revision}` : '尚未建立' }}</b></div>
            <div><span>已有章纲</span><b>{{ planningAdoptionPreview.affected.chapterOutlines }} 份</b></div>
            <div><span>已确认卷纲</span><b>{{ planningAdoptionPreview.affected.confirmedVolumes }} 份</b></div>
          </div>
          <p v-if="planningAdoptionPreview.affected.totalConfirmation || planningAdoptionPreview.affected.confirmedVolumes || planningAdoptionPreview.affected.chapterOutlines" class="adoption-warning">采用后，旧总纲确认和依赖它的卷纲、章纲可能转为“需复核”；内容不会被删除。</p>
          <div class="adoption-compare">
            <article><span>当前正式总纲 · {{ planningAdoptionPreview.current.characterCount }} 字符</span><pre>{{ planningAdoptionPreview.current.excerpt || '尚无正式总纲' }}</pre></article>
            <article class="candidate"><span>准备采用 · {{ planningAdoptionPreview.candidate.characterCount }} 字符</span><pre>{{ planningAdoptionPreview.candidate.excerpt }}</pre></article>
          </div>
          <footer><span>本次只更新总纲；不会自动确认，也不会生成卷纲、章纲或正文。</span><div><button class="text-action" type="button" @click="planningAdoptionPreview = null">继续修改候选</button><button class="seal-action small" type="button" data-testid="confirm-total-adoption" :disabled="planningAdoptionBusy" @click="confirmPlanningTotalAdoption"><span>{{ planningAdoptionPreview.changes ? '采用为正式总纲' : '标记当前总纲已采用' }}</span><i>采</i></button></div></footer>
        </section>
      </div>
      </DialogTransition>

      <DialogTransition @escape="planningVolumeStructurePreview = null">
      <div v-if="planningVolumeStructurePreview" class="modal-backdrop planning-adoption-backdrop" @click.self="planningVolumeStructurePreview = null">
        <section class="planning-adoption-sheet volume-structure-sheet" role="alertdialog" aria-modal="true" aria-labelledby="volume-structure-title" data-testid="volume-structure-preview">
          <header><div><p class="eyebrow">篇卷立目 · 保留旧稿</p><h2 id="volume-structure-title">按候选建立 {{ planningVolumeStructurePreview.actions.length }} 卷目录？</h2><small>只同步卷号和卷名。已有卷纲正文、事件归属与候选内容都不会被覆盖或删除。</small></div><button type="button" aria-label="关闭篇卷预览" @click="planningVolumeStructurePreview = null"><StudioIcon name="close" :size="18"/></button></header>
          <div class="adoption-impact-strip"><div><span>待新建</span><b>{{ planningVolumeStructurePreview.actions.filter((item) => item.action === 'create').length }} 卷</b></div><div><span>待改名</span><b>{{ planningVolumeStructurePreview.actions.filter((item) => item.action === 'rename').length }} 卷</b></div><div><span>保留额外篇卷</span><b>{{ planningVolumeStructurePreview.preservedExtraVolumes.length }} 卷</b></div></div>
          <p class="adoption-warning">篇卷结构属于总纲的一部分。实际发生新建或改名后，总纲确认会转为“需复核”；这是预期的安全门禁。</p>
          <div v-if="planningVolumeStructurePreview.conflicts.length" class="structure-conflicts"><b>暂不能建立</b><span v-for="item in planningVolumeStructurePreview.conflicts" :key="item">{{ item }}</span></div>
          <ol class="volume-structure-actions"><li v-for="item in planningVolumeStructurePreview.actions" :key="item.order" :class="item.action"><i>{{ String(item.order).padStart(2, '0') }}</i><span><b>{{ item.toTitle }}</b><small>{{ item.action === 'create' ? '新建篇卷目录' : item.action === 'rename' ? `由“${item.fromTitle}”改名；原卷纲正文保留` : '卷号与卷名已经一致' }}</small></span><em>{{ item.action === 'create' ? '新建' : item.action === 'rename' ? '改名' : '保留' }}</em></li></ol>
          <p v-if="planningVolumeStructurePreview.preservedExtraVolumes.length" class="preserved-volumes">当前书稿额外篇卷将原样保留：{{ planningVolumeStructurePreview.preservedExtraVolumes.map((item) => `第 ${item.order} 卷《${item.title}》`).join('、') }}</p>
          <footer><span>本次不写任何卷纲正文；完成后先复核并确认总纲，再逐卷采用候选卷纲。</span><div><button class="text-action" type="button" @click="planningVolumeStructurePreview = null">继续修改候选</button><button class="seal-action small" type="button" data-testid="confirm-volume-structure" :disabled="planningAdoptionBusy || planningVolumeStructurePreview.conflicts.length > 0" @click="confirmPlanningVolumeStructure"><span>{{ planningVolumeStructurePreview.changes ? '建立篇卷目录' : '记录目录已一致' }}</span><i>卷</i></button></div></footer>
        </section>
      </div>
      </DialogTransition>

      <DialogTransition @escape="planningVolumeOutlinePreview = null">
      <div v-if="planningVolumeOutlinePreview" class="modal-backdrop planning-adoption-backdrop" @click.self="planningVolumeOutlinePreview = null">
        <section class="planning-adoption-sheet volume-outline-adoption-sheet" role="alertdialog" aria-modal="true" aria-labelledby="volume-outline-adoption-title" data-testid="volume-outline-adoption-preview">
          <header><div><p class="eyebrow">逐卷转正 · 父级已锁定</p><h2 id="volume-outline-adoption-title">采用第 {{ planningVolumeOutlinePreview.order }} 卷《{{ planningVolumeOutlinePreview.candidate.title }}》？</h2><small>系统会再次核对已确认总纲、候选卷纲与正式卷纲；任一版本变化都会中止。</small></div><button type="button" aria-label="关闭卷纲影响预览" @click="planningVolumeOutlinePreview = null"><StudioIcon name="close" :size="18"/></button></header>
          <div class="adoption-impact-strip"><div><span>正式卷纲</span><b>{{ planningVolumeOutlinePreview.current.exists ? `版本 ${planningVolumeOutlinePreview.current.revision}` : '尚未写入' }}</b></div><div><span>本卷已有章纲</span><b>{{ planningVolumeOutlinePreview.affected.chapterOutlines }} 份</b></div><div><span>原确认状态</span><b>{{ planningVolumeOutlinePreview.affected.volumeConfirmation ? '将需复核' : '尚未确认' }}</b></div></div>
          <p class="adoption-warning">本次只更新这一卷的正式卷纲正文。其他篇卷、事件归属、章纲和正文都不会被改写。</p>
          <div class="adoption-compare"><article class="current"><span>当前正式卷纲 · {{ planningVolumeOutlinePreview.current.characterCount }} 字符</span><pre>{{ planningVolumeOutlinePreview.current.excerpt || '尚无正式卷纲' }}</pre></article><article class="candidate"><span>准备采用 · {{ planningVolumeOutlinePreview.candidate.characterCount }} 字符</span><pre>{{ planningVolumeOutlinePreview.candidate.excerpt }}</pre></article></div>
          <footer><span>采用不等于确认；完成后仍需在大纲页复核并正式确认本卷，才能恢复下游章纲门禁。</span><div><button class="text-action" type="button" @click="planningVolumeOutlinePreview = null">继续修改候选</button><button class="seal-action small" type="button" data-testid="confirm-volume-outline-adoption" :disabled="planningAdoptionBusy" @click="confirmPlanningVolumeOutlineAdoption"><span>{{ planningVolumeOutlinePreview.changes ? '采用本卷卷纲' : '记录本卷已采用' }}</span><i>采</i></button></div></footer>
        </section>
      </div>
      </DialogTransition>

      <DialogTransition @escape="planningChapterDetailPreview = null">
      <div v-if="planningChapterDetailPreview" class="modal-backdrop planning-adoption-backdrop" @click.self="planningChapterDetailPreview = null">
        <section class="planning-adoption-sheet chapter-detail-adoption-sheet" role="alertdialog" aria-modal="true" aria-labelledby="chapter-detail-adoption-title" data-testid="chapter-detail-adoption-preview">
          <header><div><p class="eyebrow">逐章转正 · 三重指纹复核</p><h2 id="chapter-detail-adoption-title">采用第 {{ planningChapterDetailPreview.chapterId }} 章《{{ planningChapterDetailPreview.candidate.title }}》？</h2><small>系统会在落笔前再次核对总纲、卷纲、详细章纲候选与当前正式章纲；任何一处变化都会中止。</small></div><button type="button" aria-label="关闭章纲影响预览" @click="planningChapterDetailPreview = null"><StudioIcon name="close" :size="18"/></button></header>
          <div class="adoption-impact-strip"><div><span>当前正式章纲</span><b>{{ planningChapterDetailPreview.current.exists ? `${planningChapterDetailPreview.current.characterCount} 字符` : '尚未写入' }}</b></div><div><span>剧情节拍</span><b>{{ planningChapterDetailPreview.candidate.beatCount }} 项</b></div><div><span>关联正式事件</span><b>保留 {{ planningChapterDetailPreview.affected.formalEvents }} 项</b></div></div>
          <p class="adoption-warning">本次只写第 {{ planningChapterDetailPreview.chapterId }} 章并登记为第 {{ planningChapterDetailPreview.volume }} 卷；不会覆盖其他章、自动确认、创建正文或启动模型。</p>
          <div class="adoption-compare"><article class="current"><span>当前正式章纲</span><pre>{{ planningChapterDetailPreview.current.excerpt || '尚无正式章纲' }}</pre></article><article class="candidate"><span>准备采用 · {{ planningChapterDetailPreview.candidate.characterCount }} 字符</span><pre>{{ planningChapterDetailPreview.candidate.excerpt }}</pre></article></div>
          <footer><span>若当前章纲已经确认，写入会使它回到“待复核”；ChapterContract 仍需确认后才能开放正文生成。</span><div><button class="text-action" type="button" @click="planningChapterDetailPreview = null">继续修改候选</button><button class="seal-action small" type="button" data-testid="confirm-chapter-detail-adoption" :disabled="planningAdoptionBusy" @click="confirmPlanningChapterDetailAdoption"><span>{{ planningChapterDetailPreview.changes ? '采用本章章纲' : '记录本章已采用' }}</span><i>章</i></button></div></footer>
        </section>
      </div>
      </DialogTransition>

      <DialogTransition @escape="continuationProjectDefinitionPreview = null">
      <div v-if="continuationProjectDefinitionPreview" class="modal-backdrop planning-adoption-backdrop" @click.self="continuationProjectDefinitionPreview = null">
        <section class="planning-adoption-sheet continuation-definition-adoption-sheet" role="alertdialog" aria-modal="true" aria-labelledby="continuation-definition-adoption-title" data-testid="continuation-project-definition-preview">
          <header><div><p class="eyebrow">旧稿接续 · 一项一核</p><h2 id="continuation-definition-adoption-title">把候选写入本书核心设想？</h2><small>这不是整套迁移，也不会把模型判断直接变成正式大纲。当前只处理“作品定义”这一项。</small></div><button type="button" aria-label="关闭作品定义影响预览" @click="continuationProjectDefinitionPreview = null"><StudioIcon name="close" :size="18"/></button></header>
          <div class="continuation-impact-scope"><i>只改一处</i><div><b>核心设想</b><small>写入后仍可在作品定义中继续修改</small></div><span>其余 5 项保持原样</span></div>
          <div class="adoption-compare continuation-definition-compare"><article class="current"><span>当前核心设想</span><pre>{{ continuationProjectDefinitionPreview.currentCoreIdea || '尚未填写' }}</pre></article><article class="candidate"><span>准备采用的候选</span><pre>{{ continuationProjectDefinitionPreview.candidateCoreIdea || '候选为空' }}</pre></article></div>
          <section class="continuation-preserved"><header><b>明确不改动</b><span>采用时会再次核对</span></header><ul><li v-for="item in continuationProjectDefinitionPreview.preserved" :key="item"><i>✓</i><span>{{ item }}</span></li></ul></section>
          <p v-if="continuationProjectDefinitionPreview.reason" class="adoption-warning">{{ continuationProjectDefinitionPreview.reason }}</p>
          <footer><span>若候选或作品设置在预览后发生变化，本次采用会自动中止，请重新核对。</span><div><button class="text-action" type="button" @click="continuationProjectDefinitionPreview = null">返回继续修改</button><button class="seal-action small" type="button" data-testid="confirm-continuation-project-definition" :disabled="busy || !continuationProjectDefinitionPreview.canAdopt" @click="confirmContinuationProjectDefinitionAdoption"><span>只采用核心设想</span><i>定</i></button></div></footer>
        </section>
      </div>
      </DialogTransition>

      <DialogTransition @escape="continuationExistingPlotPreview = null">
      <div v-if="continuationExistingPlotPreview" class="modal-backdrop planning-adoption-backdrop" @click.self="continuationExistingPlotPreview = null">
        <section class="planning-adoption-sheet continuation-plot-adoption-sheet" role="alertdialog" aria-modal="true" aria-labelledby="continuation-plot-adoption-title" data-testid="continuation-existing-plot-preview">
          <header><div><p class="eyebrow">旧稿接续 · 逐事确认</p><h2 id="continuation-plot-adoption-title">把一项已有剧情写入正式纪事？</h2><small>模型摘要只作为起点。时间、人物、地点和事件必须由你逐项核对，确认后只新增这一条纪事。</small></div><button type="button" aria-label="关闭已有剧情确认" @click="continuationExistingPlotPreview = null"><StudioIcon name="close" :size="18"/></button></header>
          <div class="continuation-plot-fields">
            <label>时间<input v-assist-field="{ id: 'AppShell.continuationExistingPlotDraft.time', read: () => continuationExistingPlotDraft.time, write: value => { continuationExistingPlotDraft.time = String(value) }, identity: () => continuationExistingPlotDraft }" v-model="continuationExistingPlotDraft.time" data-testid="continuation-plot-time" placeholder="例如：入学第一天早晨"></label>
            <label>人物<input v-assist-field="{ id: 'AppShell.continuationExistingPlotDraft.characters', read: () => continuationExistingPlotDraft.characters, write: value => { continuationExistingPlotDraft.characters = String(value) }, identity: () => continuationExistingPlotDraft }" v-model="continuationExistingPlotDraft.characters" data-testid="continuation-plot-characters" placeholder="例如：陈景安、同桌"></label>
            <label>地点<input v-assist-field="{ id: 'AppShell.continuationExistingPlotDraft.location', read: () => continuationExistingPlotDraft.location, write: value => { continuationExistingPlotDraft.location = String(value) }, identity: () => continuationExistingPlotDraft }" v-model="continuationExistingPlotDraft.location" data-testid="continuation-plot-location" placeholder="例如：示例中学教室"></label>
            <label class="wide">事件<textarea v-assist-field="{ id: 'AppShell.continuationExistingPlotDraft.event', read: () => continuationExistingPlotDraft.event, write: value => { continuationExistingPlotDraft.event = String(value) }, identity: () => continuationExistingPlotDraft }" v-model="continuationExistingPlotDraft.event" data-testid="continuation-plot-event"></textarea></label>
          </div>
          <details v-if="continuationExistingPlotPreview.evidence.length" class="continuation-plot-evidence"><summary>核对 {{ continuationExistingPlotPreview.evidence.length }} 条原文证据</summary><blockquote v-for="item in continuationExistingPlotPreview.evidence" :key="`${item.fileName}:${item.excerpt}`"><b>{{ item.fileName }}</b><span>{{ item.excerpt }}</span></blockquote></details>
          <p v-if="continuationExistingPlotPreview.reason" class="adoption-warning">{{ continuationExistingPlotPreview.reason }}</p>
          <footer><span>若候选或正式纪事在预览后变化，本次确认会自动中止。人物卡、设定、大纲和正文不会改变。</span><div><button class="text-action" type="button" @click="continuationExistingPlotPreview = null">返回继续修改</button><button class="seal-action small" type="button" data-testid="confirm-continuation-existing-plot" :disabled="busy || !continuationExistingPlotPreview.canAdopt || !continuationExistingPlotDraft.time.trim() || !continuationExistingPlotDraft.characters.trim() || !continuationExistingPlotDraft.location.trim() || !continuationExistingPlotDraft.event.trim()" @click="confirmContinuationExistingPlotAdoption"><span>只确认这一项纪事</span><i>事</i></button></div></footer>
        </section>
      </div>
      </DialogTransition>

      <DialogTransition @escape="closeContinuationCharacterEditor">
      <div v-if="continuationCharacterEditorOpen" class="modal-backdrop planning-adoption-backdrop" @click.self="closeContinuationCharacterEditor">
        <section class="planning-adoption-sheet continuation-character-adoption-sheet" role="alertdialog" aria-modal="true" aria-labelledby="continuation-character-adoption-title" data-testid="continuation-character-editor">
          <header><div><p class="eyebrow">旧稿接续 · 逐人立传</p><h2 id="continuation-character-adoption-title">核对一位人物的稳定锚点</h2><small>只保存姓名、初始定位与人物弧方向。地点、关系、目标、实力和生死等动态状态仍由采用后的正文逐章结算。</small></div><button type="button" aria-label="关闭人物确认" @click="closeContinuationCharacterEditor"><StudioIcon name="close" :size="18"/></button></header>
          <div class="continuation-character-fields">
            <label>人物名<input v-assist-field="{ id: 'AppShell.continuationCharacterDraft.name', read: () => continuationCharacterDraft.name, write: value => { continuationCharacterDraft.name = String(value); continuationCharacterPreview = null }, identity: () => continuationCharacterDraft }" v-model="continuationCharacterDraft.name" data-testid="continuation-character-name" maxlength="120" placeholder="例如：陈景安" @input="continuationCharacterPreview = null"></label>
            <label>初始角色定位<input v-assist-field="{ id: 'AppShell.continuationCharacterDraft.role', read: () => continuationCharacterDraft.role, write: value => { continuationCharacterDraft.role = String(value); continuationCharacterPreview = null }, identity: () => continuationCharacterDraft }" v-model="continuationCharacterDraft.role" data-testid="continuation-character-role" maxlength="1000" placeholder="例如：努力维持普通生活的高中生" @input="continuationCharacterPreview = null"></label>
            <label class="wide">人物弧方向<textarea v-assist-field="{ id: 'AppShell.continuationCharacterDraft.arcSeed', read: () => continuationCharacterDraft.arcSeed, write: value => { continuationCharacterDraft.arcSeed = String(value); continuationCharacterPreview = null }, identity: () => continuationCharacterDraft }" v-model="continuationCharacterDraft.arcSeed" data-testid="continuation-character-arc" maxlength="5000" placeholder="写方向，不要把未来变化写成已经发生的事实" @input="continuationCharacterPreview = null"></textarea></label>
          </div>
          <div v-if="continuationCharacterPreview" class="continuation-character-impact" data-testid="continuation-character-preview">
            <i>{{ { create: '新', enrich: '补', update: '改', keep: '同' }[continuationCharacterPreview.action] }}</i>
            <div><b>{{ { create: '建立新人物锚点', enrich: '补充现有人物锚点', update: '更新现有人物锚点', keep: '人物锚点内容一致' }[continuationCharacterPreview.action] }}</b><small>已有 {{ continuationCharacterPreview.affected.existingAnchors }} 人 · 动态快照 {{ continuationCharacterPreview.affected.dynamicSnapshots }} 份 · 待核冲突 {{ continuationCharacterPreview.affected.pendingConflicts }} 项</small><p v-if="continuationCharacterPreview.current">当前：{{ continuationCharacterPreview.current.role || '未定定位' }}；{{ continuationCharacterPreview.current.arcSeed || '未定人物弧' }}</p></div>
            <em>正文状态不变</em>
          </div>
          <details v-if="continuationCharacterPreview?.evidence.length" class="continuation-plot-evidence"><summary>核对 {{ continuationCharacterPreview.evidence.length }} 条原文证据</summary><blockquote v-for="item in continuationCharacterPreview.evidence" :key="`${item.fileName}:${item.excerpt}`"><b>{{ item.fileName }}</b><span>{{ item.excerpt }}</span></blockquote></details>
          <p v-if="continuationCharacterPreview?.reason" class="adoption-warning">{{ continuationCharacterPreview.reason }}</p>
          <footer><span>{{ continuationCharacterPreview ? '预览后若候选或正式人物锚点发生变化，确认会自动中止。' : '先补齐三项内容并预览影响；不会从模型摘要中自动拆人物。' }}</span><div><button class="text-action" type="button" @click="closeContinuationCharacterEditor">返回候选</button><button v-if="!continuationCharacterPreview" class="ink-action compact-search" type="button" data-testid="preview-continuation-character" :disabled="busy || !continuationCharacterDraft.name.trim() || !continuationCharacterDraft.role.trim() || !continuationCharacterDraft.arcSeed.trim()" @click="previewContinuationCharacterImpact">预览人物影响</button><button v-else class="seal-action small" type="button" data-testid="confirm-continuation-character" :disabled="busy || !continuationCharacterPreview.canAdopt" @click="confirmContinuationCharacterAdoption"><span>只确认这一人</span><i>人</i></button></div></footer>
        </section>
      </div>
      </DialogTransition>

      <DialogTransition @escape="continuationWorldViewPreview = null">
      <div v-if="continuationWorldViewPreview" class="modal-backdrop planning-adoption-backdrop" @click.self="continuationWorldViewPreview = null">
        <section class="planning-adoption-sheet continuation-definition-adoption-sheet" role="alertdialog" aria-modal="true" aria-labelledby="continuation-world-view-adoption-title" data-testid="continuation-world-view-preview">
          <header><div><p class="eyebrow">旧稿接续 · 天地留白</p><h2 id="continuation-world-view-adoption-title">采用这段世界观开放描述？</h2><small>世界观可以先写大方向，再随创作继续生长；这里不会自动扩展成僵硬规则或结构化表格。</small></div><button type="button" aria-label="关闭世界观影响预览" @click="continuationWorldViewPreview = null"><StudioIcon name="close" :size="18"/></button></header>
          <div class="continuation-impact-scope"><i>只改一处</i><div><b>本书世界观</b><small>采用后仍可在设定页继续修改</small></div><span>其他正式内容保持原样</span></div>
          <p class="adoption-warning">只采用原稿中有证据的开放描述；力量体系、境界表、金手指、人物、纪事、三级大纲和正文都不会改变。</p>
          <div class="adoption-compare continuation-definition-compare"><article class="current"><span>当前本书世界观</span><pre>{{ continuationWorldViewPreview.currentWorldView || '尚未填写' }}</pre></article><article class="candidate"><span>准备采用的候选</span><pre>{{ continuationWorldViewPreview.candidateWorldView || '候选为空' }}</pre></article></div>
          <section class="continuation-preserved"><header><b>明确不改动</b><span>采用时会再次核对</span></header><ul><li v-for="item in continuationWorldViewPreview.preserved" :key="item"><i>✓</i><span>{{ item }}</span></li></ul></section>
          <details v-if="continuationWorldViewPreview.evidence.length" class="continuation-plot-evidence"><summary>核对 {{ continuationWorldViewPreview.evidence.length }} 条原文证据</summary><blockquote v-for="item in continuationWorldViewPreview.evidence" :key="`${item.fileName}:${item.excerpt}`"><b>{{ item.fileName }}</b><span>{{ item.excerpt }}</span></blockquote></details>
          <p v-if="continuationWorldViewPreview.reason" class="adoption-warning">{{ continuationWorldViewPreview.reason }}</p>
          <footer><span>若候选或本书设定在预览后发生变化，本次采用会自动中止，请重新核对。</span><div><button class="text-action" type="button" @click="continuationWorldViewPreview = null">返回继续修改</button><button class="seal-action small" type="button" data-testid="confirm-continuation-world-view" :disabled="busy || !continuationWorldViewPreview.canAdopt" @click="confirmContinuationWorldViewAdoption"><span>{{ continuationWorldViewPreview.changes ? '只采用世界观描述' : '记录世界观一致' }}</span><i>界</i></button></div></footer>
        </section>
      </div>
      </DialogTransition>

      <DialogTransition @escape="continuationPowerSystemPreview = null">
      <div v-if="continuationPowerSystemPreview" class="modal-backdrop planning-adoption-backdrop" @click.self="continuationPowerSystemPreview = null">
        <section class="planning-adoption-sheet power-system-adoption-sheet" role="alertdialog" aria-modal="true" aria-labelledby="continuation-power-system-adoption-title" data-testid="continuation-power-system-preview">
          <header><div><p class="eyebrow">旧稿接续 · 力量脉络</p><h2 id="continuation-power-system-adoption-title">采用这段力量体系总述？</h2><small>这里只保存可以继续修改的大方向，不会把摘要擅自拆成境界等级，也不会替作者开启修炼体系。</small></div><button type="button" aria-label="关闭力量体系影响预览" @click="continuationPowerSystemPreview = null"><StudioIcon name="close" :size="18"/></button></header>
          <div class="adoption-compare continuation-definition-compare"><article class="current"><span>当前力量体系总述</span><pre>{{ continuationPowerSystemPreview.currentOverview || '尚未填写' }}</pre></article><article class="candidate"><span>准备采用的候选</span><pre>{{ continuationPowerSystemPreview.candidateOverview || '候选为空' }}</pre></article></div>
          <section class="continuation-preserved"><header><b>境界配置保持独立</b><span>采用时不会改动</span></header><ul><li><i>✓</i><span>现有境界等级 {{ continuationPowerSystemPreview.preserved.realmLevels }} 项，原样保留</span></li><li><i>✓</i><span>境界系统{{ continuationPowerSystemPreview.preserved.realmsEnabled ? '保持启用' : '保持关闭' }}</span></li><li><i>✓</i><span>世界观、特殊优势、系统模板、大纲与正文全部保留</span></li></ul></section>
          <details v-if="continuationPowerSystemPreview.evidence.length" class="continuation-plot-evidence"><summary>核对 {{ continuationPowerSystemPreview.evidence.length }} 条原文证据</summary><blockquote v-for="item in continuationPowerSystemPreview.evidence" :key="`${item.fileName}:${item.excerpt}`"><b>{{ item.fileName }}</b><span>{{ item.excerpt }}</span></blockquote></details>
          <p v-if="continuationPowerSystemPreview.reason" class="adoption-warning">{{ continuationPowerSystemPreview.reason }}</p>
          <footer><span>若候选或力量体系总述在预览后变化，本次采用会自动中止，请重新核对。</span><div><button class="text-action" type="button" @click="continuationPowerSystemPreview = null">返回继续修改</button><button class="seal-action small" type="button" data-testid="confirm-continuation-power-system" :disabled="busy || !continuationPowerSystemPreview.canAdopt" @click="confirmContinuationPowerSystemAdoption"><span>{{ continuationPowerSystemPreview.changes ? '只采用体系总述' : '记录总述一致' }}</span><i>力</i></button></div></footer>
        </section>
      </div>
      </DialogTransition>

      <DialogTransition @escape="continuationCheatSystemPreview = null">
      <div v-if="continuationCheatSystemPreview" class="modal-backdrop planning-adoption-backdrop" @click.self="continuationCheatSystemPreview = null">
        <section class="planning-adoption-sheet power-system-adoption-sheet" role="alertdialog" aria-modal="true" aria-labelledby="continuation-cheat-system-adoption-title" data-testid="continuation-cheat-system-preview">
          <header><div><p class="eyebrow">旧稿接续 · 奇策留白</p><h2 id="continuation-cheat-system-adoption-title">采用这段特殊优势总述？</h2><small>这里只保存能力或特殊优势的大方向，不会替作者启用系统，也不会把摘要编成新的界面模板。</small></div><button type="button" aria-label="关闭特殊优势影响预览" @click="continuationCheatSystemPreview = null"><StudioIcon name="close" :size="18"/></button></header>
          <div class="adoption-compare continuation-definition-compare"><article class="current"><span>当前特殊优势总述</span><pre>{{ continuationCheatSystemPreview.currentOverview || '尚未填写' }}</pre></article><article class="candidate"><span>准备采用的候选</span><pre>{{ continuationCheatSystemPreview.candidateOverview || '候选为空' }}</pre></article></div>
          <section class="continuation-preserved"><header><b>系统配置保持独立</b><span>采用时不会改动</span></header><ul><li><i>✓</i><span>系统功能{{ continuationCheatSystemPreview.preserved.systemEnabled ? '保持启用' : '保持关闭' }}</span></li><li><i>✓</i><span>固定显示模板{{ continuationCheatSystemPreview.preserved.templateConfigured ? '已配置并原样保留' : '当前为空，仍保持为空' }}</span></li><li><i>✓</i><span>世界观、力量与境界、大纲和正文全部保留</span></li></ul></section>
          <details v-if="continuationCheatSystemPreview.evidence.length" class="continuation-plot-evidence"><summary>核对 {{ continuationCheatSystemPreview.evidence.length }} 条原文证据</summary><blockquote v-for="item in continuationCheatSystemPreview.evidence" :key="`${item.fileName}:${item.excerpt}`"><b>{{ item.fileName }}</b><span>{{ item.excerpt }}</span></blockquote></details>
          <p v-if="continuationCheatSystemPreview.reason" class="adoption-warning">{{ continuationCheatSystemPreview.reason }}</p>
          <footer><span>若候选或特殊优势总述在预览后变化，本次采用会自动中止，请重新核对。</span><div><button class="text-action" type="button" @click="continuationCheatSystemPreview = null">返回继续修改</button><button class="seal-action small" type="button" data-testid="confirm-continuation-cheat-system" :disabled="busy || !continuationCheatSystemPreview.canAdopt" @click="confirmContinuationCheatSystemAdoption"><span>{{ continuationCheatSystemPreview.changes ? '只采用优势总述' : '记录总述一致' }}</span><i>奇</i></button></div></footer>
        </section>
      </div>
      </DialogTransition>

      <DialogTransition @escape="continuationTotalOutlinePreview = null">
      <div v-if="continuationTotalOutlinePreview" class="modal-backdrop planning-adoption-backdrop" @click.self="continuationTotalOutlinePreview = null">
        <section class="planning-adoption-sheet" role="alertdialog" aria-modal="true" aria-labelledby="continuation-total-outline-adoption-title" data-testid="continuation-total-outline-preview">
          <header><div><p class="eyebrow">旧稿接续 · 总纲定稿</p><h2 id="continuation-total-outline-adoption-title">把旧稿总纲放入正式编辑区？</h2><small>这是总纲承接，不是自动确认。采用后仍待复核，作者确认前不会继续生成卷纲、章纲或正文。</small></div><button type="button" aria-label="关闭总纲影响预览" @click="continuationTotalOutlinePreview = null"><StudioIcon name="close" :size="18"/></button></header>
          <div class="adoption-impact-strip"><div><span>当前总纲版本</span><b>第 {{ continuationTotalOutlinePreview.affected.currentRevision }} 版</b></div><div><span>确认状态</span><b>{{ continuationTotalOutlinePreview.affected.totalConfirmed ? '已确认，改动后需重审' : '尚未确认' }}</b></div><div><span>下游内容</span><b>{{ continuationTotalOutlinePreview.affected.volumeOutlines }} 卷纲 · {{ continuationTotalOutlinePreview.affected.chapterOutlines }} 章纲</b></div></div>
          <p class="adoption-warning">只更新全书总纲正文。六类前置事实会在确认时再次核对；采用不会创建、删除或改写任何卷纲、章纲、章节正文。</p>
          <div class="adoption-compare"><article class="current"><span>当前正式总纲</span><pre>{{ continuationTotalOutlinePreview.currentOutline || '尚未填写' }}</pre></article><article class="candidate"><span>准备采用的旧稿候选</span><pre>{{ continuationTotalOutlinePreview.candidateOutline || '候选为空' }}</pre></article></div>
          <details v-if="continuationTotalOutlinePreview.evidence.length" class="continuation-plot-evidence"><summary>核对 {{ continuationTotalOutlinePreview.evidence.length }} 条原文证据</summary><blockquote v-for="item in continuationTotalOutlinePreview.evidence" :key="`${item.fileName}:${item.excerpt}`"><b>{{ item.fileName }}</b><span>{{ item.excerpt }}</span></blockquote></details>
          <p v-if="continuationTotalOutlinePreview.reason" class="adoption-warning">{{ continuationTotalOutlinePreview.reason }}</p>
          <footer><span>预览后若候选、正式总纲或任一前置事实发生变化，本次采用会自动中止。</span><div><button class="text-action" type="button" @click="continuationTotalOutlinePreview = null">返回继续修改</button><button class="seal-action small" type="button" data-testid="confirm-continuation-total-outline" :disabled="busy || !continuationTotalOutlinePreview.canAdopt" @click="confirmContinuationTotalOutlineAdoption"><span>{{ continuationTotalOutlinePreview.changes ? '只采用为正式总纲' : '记录总纲一致' }}</span><i>纲</i></button></div></footer>
        </section>
      </div>
      </DialogTransition>

      <DialogTransition @escape="continuationVolumeOutlinePreview = null">
      <div v-if="continuationVolumeOutlinePreview" class="modal-backdrop planning-adoption-backdrop" @click.self="continuationVolumeOutlinePreview = null">
        <section class="planning-adoption-sheet" role="alertdialog" aria-modal="true" aria-labelledby="continuation-volume-outline-adoption-title" data-testid="continuation-volume-outline-preview">
          <header><div><p class="eyebrow">旧稿接续 · 逐卷落点</p><h2 id="continuation-volume-outline-adoption-title">写入第 {{ continuationVolumeOutlinePreview.volume }} 卷《{{ continuationVolumeOutlinePreview.volumeTitle }}》？</h2><small>这是作者明确选择的目标卷。采用后仍待本卷复核，不会自动生成章纲或正文。</small></div><button type="button" aria-label="关闭卷纲影响预览" @click="continuationVolumeOutlinePreview = null"><StudioIcon name="close" :size="18"/></button></header>
          <div class="adoption-impact-strip"><div><span>目标卷版本</span><b>第 {{ continuationVolumeOutlinePreview.affected.currentRevision }} 版</b></div><div><span>确认状态</span><b>{{ continuationVolumeOutlinePreview.affected.volumeConfirmed ? '已确认，改动后需重审' : '尚未确认' }}</b></div><div><span>保持不变</span><b>{{ continuationVolumeOutlinePreview.affected.siblingVolumeOutlines }} 个其他卷纲 · {{ continuationVolumeOutlinePreview.affected.chapterOutlines }} 章纲</b></div></div>
          <p class="adoption-warning">父级总纲会在写入前再次核对。只替换当前选择卷的卷纲正文，不创建卷、不移动事件、不改章节内容。</p>
          <div class="adoption-compare"><article class="current"><span>当前正式卷纲</span><pre>{{ continuationVolumeOutlinePreview.currentOutline || '尚未填写' }}</pre></article><article class="candidate"><span>准备采用的旧稿候选</span><pre>{{ continuationVolumeOutlinePreview.candidateOutline || '候选为空' }}</pre></article></div>
          <details v-if="continuationVolumeOutlinePreview.evidence.length" class="continuation-plot-evidence"><summary>核对 {{ continuationVolumeOutlinePreview.evidence.length }} 条原文证据</summary><blockquote v-for="item in continuationVolumeOutlinePreview.evidence" :key="`${item.fileName}:${item.excerpt}`"><b>{{ item.fileName }}</b><span>{{ item.excerpt }}</span></blockquote></details>
          <p v-if="continuationVolumeOutlinePreview.reason" class="adoption-warning">{{ continuationVolumeOutlinePreview.reason }}</p>
          <footer><span>若候选、父级总纲或目标卷纲在预览后变化，本次采用会自动中止。</span><div><button class="text-action" type="button" @click="continuationVolumeOutlinePreview = null">返回重新选择</button><button class="seal-action small" type="button" data-testid="confirm-continuation-volume-outline" :disabled="busy || !continuationVolumeOutlinePreview.canAdopt" @click="confirmContinuationVolumeOutlineAdoption"><span>{{ continuationVolumeOutlinePreview.changes ? '只采用到本卷' : '记录本卷一致' }}</span><i>卷</i></button></div></footer>
        </section>
      </div>
      </DialogTransition>

      <DialogTransition @escape="continuationChapterOutlinePreview = null">
      <div v-if="continuationChapterOutlinePreview" class="modal-backdrop planning-adoption-backdrop" @click.self="continuationChapterOutlinePreview = null">
        <section class="planning-adoption-sheet" role="alertdialog" aria-modal="true" aria-labelledby="continuation-chapter-outline-adoption-title" data-testid="continuation-chapter-outline-preview">
          <header><div><p class="eyebrow">旧稿接续 · 逐章落点</p><h2 id="continuation-chapter-outline-adoption-title">写入第 {{ continuationChapterOutlinePreview.chapterPosition }} 章《{{ continuationChapterOutlinePreview.chapterTitle }}》？</h2><small>本章已明确归入第 {{ continuationChapterOutlinePreview.volume }} 卷《{{ continuationChapterOutlinePreview.volumeTitle }}》。采用后仍需章纲结构审核与 ChapterContract 确认。</small></div><button type="button" aria-label="关闭章纲影响预览" @click="continuationChapterOutlinePreview = null"><StudioIcon name="close" :size="18"/></button></header>
          <div class="adoption-impact-strip"><div><span>本章正文</span><b>保持 {{ continuationChapterOutlinePreview.affected.manuscriptWordCount }} 字不变</b></div><div><span>当前章纲</span><b>{{ continuationChapterOutlinePreview.affected.chapterConfirmed ? '已确认，改动后需重审' : '尚未确认' }}</b></div><div><span>其他章纲</span><b>保留 {{ continuationChapterOutlinePreview.affected.siblingChapterOutlines }} 章</b></div></div>
          <p class="adoption-warning">写入前会再次核对候选、目标章纲、正式总纲和目标卷纲。不会创建章节，不会改标题、正文、父级大纲或其他章纲。</p>
          <div class="adoption-compare"><article class="current"><span>当前正式章纲</span><pre>{{ continuationChapterOutlinePreview.currentOutline || '尚未填写' }}</pre></article><article class="candidate"><span>准备采用的旧稿候选</span><pre>{{ continuationChapterOutlinePreview.candidateOutline || '候选为空' }}</pre></article></div>
          <details v-if="continuationChapterOutlinePreview.evidence.length" class="continuation-plot-evidence"><summary>核对 {{ continuationChapterOutlinePreview.evidence.length }} 条原文证据</summary><blockquote v-for="item in continuationChapterOutlinePreview.evidence" :key="`${item.fileName}:${item.excerpt}`"><b>{{ item.fileName }}</b><span>{{ item.excerpt }}</span></blockquote></details>
          <p v-if="continuationChapterOutlinePreview.reason" class="adoption-warning">{{ continuationChapterOutlinePreview.reason }}</p>
          <footer><span>采用只是把候选写入本章章纲；必须在谋篇中人工确认本版，才能开放正文生成。</span><div><button class="text-action" type="button" @click="continuationChapterOutlinePreview = null">返回重新选择</button><button class="seal-action small" type="button" data-testid="confirm-continuation-chapter-outline" :disabled="busy || !continuationChapterOutlinePreview.canAdopt" @click="confirmContinuationChapterOutlineAdoption"><span>{{ continuationChapterOutlinePreview.changes ? '只采用到本章' : '记录本章一致' }}</span><i>章</i></button></div></footer>
        </section>
      </div>
      </DialogTransition>

      <DialogTransition @escape="planningCharacterSeedPreview = null">
      <div v-if="planningCharacterSeedPreview" class="modal-backdrop planning-adoption-backdrop" @click.self="planningCharacterSeedPreview = null">
        <section class="planning-adoption-sheet character-seed-adoption-sheet" role="alertdialog" aria-modal="true" aria-labelledby="character-seed-adoption-title" data-testid="character-seed-adoption-preview">
          <header><div><p class="eyebrow">人物立传 · 动静分层</p><h2 id="character-seed-adoption-title">建立 {{ planningCharacterSeedPreview.actions.length }} 个人物稳定锚点？</h2><small>稳定锚点保存姓名、初始定位和人物弧方向；正文形成的动态状态与逐字证据原样保留。</small></div><button type="button" aria-label="关闭人物锚点预览" @click="planningCharacterSeedPreview = null"><StudioIcon name="close" :size="18"/></button></header>
          <div class="adoption-impact-strip"><div><span>新建人物</span><b>{{ planningCharacterSeedPreview.actions.filter((item) => item.action === 'create').length }} 人</b></div><div><span>补充 / 更新</span><b>{{ planningCharacterSeedPreview.actions.filter((item) => item.action === 'enrich' || item.action === 'update').length }} 人</b></div><div><span>动态状态</span><b>保留 {{ planningCharacterSeedPreview.affected.dynamicSnapshots }} 人</b></div></div>
          <p v-if="planningCharacterSeedPreview.conflicts.length" class="adoption-warning">{{ planningCharacterSeedPreview.conflicts[0] }}</p>
          <div class="character-seed-action-list"><article v-for="item in planningCharacterSeedPreview.actions" :key="item.name" :class="`action-${item.action}`"><span>{{ { create: '新建', enrich: '补充', update: '更新', keep: '一致' }[item.action] }}</span><div><h3>{{ item.name }}</h3><p>{{ item.candidate.role }}</p><small>{{ item.candidate.arcSeed }}</small></div><dl v-if="item.current && item.action === 'update'"><dt>当前锚点</dt><dd>{{ item.current.role || '未写角色定位' }} · {{ item.current.arcSeed || '未写人物弧' }}</dd></dl></article></div>
          <footer><span>本次不删除人物、正文事件或状态快照，也不会让候选人物自动变成章节事实。</span><div><button class="text-action" type="button" @click="planningCharacterSeedPreview = null">继续修改人物种子</button><button class="seal-action small" type="button" data-testid="confirm-character-seed-adoption" :disabled="planningAdoptionBusy || planningCharacterSeedPreview.conflicts.length" @click="confirmPlanningCharacterSeedAdoption"><span>{{ planningCharacterSeedPreview.changes ? '建立人物锚点' : '记录人物锚点一致' }}</span><i>立</i></button></div></footer>
        </section>
      </div>
      </DialogTransition>

      <DialogTransition @escape="planningWorldSeedPreview = null">
      <div v-if="planningWorldSeedPreview" class="modal-backdrop planning-adoption-backdrop" @click.self="planningWorldSeedPreview = null">
        <section class="planning-adoption-sheet world-seed-adoption-sheet" role="alertdialog" aria-modal="true" aria-labelledby="world-seed-adoption-title" data-testid="world-seed-adoption-preview">
          <header><div><p class="eyebrow">天地立意 · 开放描述</p><h2 id="world-seed-adoption-title">采用这段世界种子？</h2><small>这里只替换当前作品的世界观文字，不自动补齐规则，也不改作者札记、境界或金手指设置。</small></div><button type="button" aria-label="关闭世界种子预览" @click="planningWorldSeedPreview = null"><StudioIcon name="close" :size="18"/></button></header>
          <div class="adoption-impact-strip"><div><span>当前世界观</span><b>{{ planningWorldSeedPreview.current.exists ? `${planningWorldSeedPreview.current.characterCount} 字符` : '尚未填写' }}</b></div><div><span>作者札记</span><b>{{ planningWorldSeedPreview.preserved.sourceNotes ? '原样保留' : '当前为空' }}</b></div><div><span>体系开关</span><b>全部保留</b></div></div>
          <p class="adoption-warning">世界观是可持续生长的总述，不是一次写死的 Schema。采用后仍可进入“世界观”继续修改。</p>
          <div class="adoption-compare"><article class="current"><span>当前本书世界观</span><pre>{{ planningWorldSeedPreview.current.excerpt || '尚无世界观' }}</pre></article><article class="candidate"><span>准备采用 · {{ planningWorldSeedPreview.candidate.characterCount }} 字符</span><pre>{{ planningWorldSeedPreview.candidate.excerpt }}</pre></article></div>
          <footer><span>若预览后本书设定发生变化，采用会自动中止，防止覆盖刚刚保存的内容。</span><div><button class="text-action" type="button" @click="planningWorldSeedPreview = null">继续修改世界种子</button><button class="seal-action small" type="button" data-testid="confirm-world-seed-adoption" :disabled="planningAdoptionBusy" @click="confirmPlanningWorldSeedAdoption"><span>{{ planningWorldSeedPreview.changes ? '采用为本书世界观' : '记录世界观一致' }}</span><i>界</i></button></div></footer>
        </section>
      </div>
      </DialogTransition>

      <DialogTransition @escape="planningPowerSystemPreview = null">
      <div v-if="planningPowerSystemPreview" class="modal-backdrop planning-adoption-backdrop" @click.self="planningPowerSystemPreview = null">
        <section class="planning-adoption-sheet power-system-adoption-sheet" role="alertdialog" aria-modal="true" aria-labelledby="power-system-adoption-title" data-testid="power-system-adoption-preview">
          <header><div><p class="eyebrow">立势成法 · 总述先行</p><h2 id="power-system-adoption-title">采用这段力量体系总述？</h2><small>这里只保存开放总述；不会拆分等级、启用境界，或改变作者已经写好的境界表。</small></div><button type="button" aria-label="关闭力量体系预览" @click="planningPowerSystemPreview = null"><StudioIcon name="close" :size="18"/></button></header>
          <div class="adoption-impact-strip"><div><span>当前体系总述</span><b>{{ planningPowerSystemPreview.current.exists ? `${planningPowerSystemPreview.current.characterCount} 字符` : '尚未填写' }}</b></div><div><span>已有境界</span><b>保留 {{ planningPowerSystemPreview.preserved.realmLevels }} 层</b></div><div><span>境界开关</span><b>{{ planningPowerSystemPreview.preserved.realmsEnabled ? '保持启用' : '保持关闭' }}</b></div></div>
          <p class="adoption-warning">候选为空也可以确认“本书暂不设力量体系”；以后仍可在“力量与境界”中继续补写。</p>
          <div class="adoption-compare"><article class="current"><span>当前本书总述</span><pre>{{ planningPowerSystemPreview.current.excerpt || '尚无力量体系总述' }}</pre></article><article class="candidate"><span>准备采用 · {{ planningPowerSystemPreview.candidate.characterCount }} 字符</span><pre>{{ planningPowerSystemPreview.candidate.excerpt || '本书暂不设置力量体系' }}</pre></article></div>
          <footer><span>预览后若作者修改了本书总述，旧确认会中止；境界等级始终需要单独编辑和保存。</span><div><button class="text-action" type="button" @click="planningPowerSystemPreview = null">继续修改候选</button><button class="seal-action small" type="button" data-testid="confirm-power-system-adoption" :disabled="planningAdoptionBusy" @click="confirmPlanningPowerSystemAdoption"><span>{{ planningPowerSystemPreview.changes ? '采用为体系总述' : '记录体系一致' }}</span><i>势</i></button></div></footer>
        </section>
      </div>
      </DialogTransition>

      <DialogTransition @escape="planningCheatSystemPreview = null">
      <div v-if="planningCheatSystemPreview" class="modal-backdrop planning-adoption-backdrop" @click.self="planningCheatSystemPreview = null">
        <section class="planning-adoption-sheet power-system-adoption-sheet" role="alertdialog" aria-modal="true" aria-labelledby="cheat-system-adoption-title" data-testid="cheat-system-adoption-preview">
          <header><div><p class="eyebrow">异能有界 · 呈现分离</p><h2 id="cheat-system-adoption-title">采用这段金手指或特殊优势总述？</h2><small>这里只保存能力、限制与代价；不会启用系统界面，也不会覆盖作者已经写好的固定显示模板。</small></div><button type="button" aria-label="关闭特殊优势预览" @click="planningCheatSystemPreview = null"><StudioIcon name="close" :size="18"/></button></header>
          <div class="adoption-impact-strip"><div><span>当前能力总述</span><b>{{ planningCheatSystemPreview.current.exists ? `${planningCheatSystemPreview.current.characterCount} 字符` : '尚未填写' }}</b></div><div><span>显示模板</span><b>保留 {{ planningCheatSystemPreview.preserved.templateCharacters }} 字符</b></div><div><span>系统界面</span><b>{{ planningCheatSystemPreview.preserved.systemEnabled ? '保持启用' : '保持关闭' }}</b></div></div>
          <p class="adoption-warning">候选为空也可以确认“本书没有金手指”；普通天赋、知识优势和系统能力都使用同一总述，不强迫系统流。</p>
          <div class="adoption-compare"><article class="current"><span>当前本书能力总述</span><pre>{{ planningCheatSystemPreview.current.excerpt || '尚无金手指或特殊优势总述' }}</pre></article><article class="candidate"><span>准备采用 · {{ planningCheatSystemPreview.candidate.characterCount }} 字符</span><pre>{{ planningCheatSystemPreview.candidate.excerpt || '本书不设置金手指或特殊优势' }}</pre></article></div>
          <footer><span>预览后若作者修改了能力总述，旧确认会中止；显示模板始终需要在设定页单独编辑和保存。</span><div><button class="text-action" type="button" @click="planningCheatSystemPreview = null">继续修改候选</button><button class="seal-action small" type="button" data-testid="confirm-cheat-system-adoption" :disabled="planningAdoptionBusy" @click="confirmPlanningCheatSystemAdoption"><span>{{ planningCheatSystemPreview.changes ? '采用为能力总述' : '记录能力一致' }}</span><i>异</i></button></div></footer>
        </section>
      </div>
      </DialogTransition>

      <DialogTransition @escape="!manuscriptRecoveryBusyId && (manuscriptRecoveryItems = [])">
      <ManuscriptRecoveryDialog
        v-if="manuscriptRecoveryItems.length"
        :items="manuscriptRecoveryItems"
        :busy-id="manuscriptRecoveryBusyId"
        @close="!manuscriptRecoveryBusyId && (manuscriptRecoveryItems = [])"
        @restore="restoreManuscriptRecovery"
        @discard="discardManuscriptRecovery"
      />
      </DialogTransition>
      <DialogTransition @escape="!writingRebaseBusy && (writingRebase = null)">
      <WritingRebaseDialog v-if="writingRebase" :base="writingRebase.base" :current="writingRebase.current" :proposed="writingRebase.proposed" :busy="writingRebaseBusy" @close="writingRebase = null" @confirm="confirmWritingRebase" />
      </DialogTransition>

      <DialogTransition @escape="!chapterCardSaving && (chapterCardAdoption = null)">
      <div v-if="chapterCardAdoption && chapterPlanning" class="modal-backdrop chapter-card-adoption-backdrop" @click.self="!chapterCardSaving && (chapterCardAdoption = null)">
        <section class="chapter-card-adoption-sheet" role="alertdialog" aria-modal="true" aria-labelledby="chapter-card-adoption-title" data-testid="chapter-card-adoption-preview">
          <header><div><p class="eyebrow">讨论留在候选 · 选择后才进章卡</p><h2 id="chapter-card-adoption-title">采用“{{ chapterCardAdoption.option.title }}”的哪些部分？</h2><small>{{ chapterCardAdoption.option.rationale }}</small></div><button type="button" aria-label="关闭章卡候选核对" :disabled="chapterCardSaving" @click="chapterCardAdoption = null"><StudioIcon name="close" :size="18"/></button></header>
          <div class="chapter-card-reading">
          <div class="chapter-card-adoption-notice"><i>候</i><p><b>正文不会改变，正式章卡也不会被整张覆盖</b><span>逐项选择要写入的栏位。已有文字默认不勾选；节拍和人物只补入并自动去重。采用后章卡会回到“草稿”，需要你再次确认。</span></p></div>
          <div class="chapter-card-adoption-fields">
            <label v-for="field in chapterCardAdoptionFields" :key="field.key" :class="{ selected: chapterCardAdoption.selected[field.key] }">
              <input v-model="chapterCardAdoption.selected[field.key]" type="checkbox" :disabled="chapterCardSaving">
              <span class="chapter-card-field-mark">{{ chapterCardAdoption.selected[field.key] ? '取' : '留' }}</span>
              <span class="chapter-card-field-name"><b>{{ field.label }}</b><small>{{ field.action }}</small></span>
              <span class="chapter-card-field-compare"><span><i>现在</i>{{ field.current || '尚未填写' }}</span><span class="proposed"><i>候选</i>{{ field.proposed }}</span></span>
            </label>
          </div>
          </div>
          <footer><span>未选择的内容仍保留在本次讨论中，不会改动章卡。</span><div><button class="text-action" type="button" :disabled="chapterCardSaving" @click="chapterCardAdoption = null">保留讨论，不采用</button><button class="seal-action small" type="button" data-testid="confirm-chapter-card-adoption" :disabled="chapterCardSaving || !chapterCardAdoptionFields.some((field) => chapterCardAdoption.selected[field.key])" @click="confirmChapterCardAdoption"><span>{{ chapterCardSaving ? '正在写入…' : '写入章卡草稿' }}</span><i>取</i></button></div></footer>
        </section>
      </div>

      </DialogTransition>

      <DialogTransition @escape="!chapterCardSaving && (chapterCardOpen = false)" :reading-key="current && selectedId ? `${current.id}:${selectedId}` : undefined">
      <div v-if="chapterCardOpen && chapterPlanning" class="modal-backdrop chapter-card-backdrop" @click.self="!chapterCardSaving && (chapterCardOpen = false)">
        <section class="chapter-card-sheet" role="dialog" aria-modal="true" aria-labelledby="chapter-card-title" data-testid="chapter-card-sheet">
          <header>
            <div><p class="eyebrow">本章执行卡 · 创作计划</p><h2 id="chapter-card-title">第 {{ selectedChapterPosition }} 章怎么写</h2><small>核对目标、节拍与承接信息，保存后用于本章创作。</small></div>
            <button type="button" aria-label="关闭本章执行卡" :disabled="chapterCardSaving" @click="chapterCardOpen = false"><StudioIcon name="close" :size="18"/></button>
          </header>
          <div class="chapter-card-reading" data-dialog-reading>
          <div class="chapter-card-status-row">
            <span>章节状态</span><b>{{ chapterLifecycleLabels[chapterPlanning.lifecycleStatus] }}</b>
            <button v-for="action in chapterLifecycleActions" :key="action.value" class="text-action compact" type="button" :disabled="chapterCardSaving" @click="saveChapterCard(action.value)">{{ action.label }}</button>
          </div>
          <section class="chapter-derived-status" aria-label="本章派生资料状态" data-testid="chapter-derived-status">
            <article v-for="entry in chapterDerivativeEntries" :key="entry.id" :class="`status-${entry.state}`" :data-testid="`chapter-derived-${entry.id}`">
              <i aria-hidden="true">{{ entry.state === 'stale' ? '旧' : entry.state === 'current' ? '今' : '待' }}</i>
              <span><b>{{ entry.label }}</b><small>{{ entry.summary }}</small></span>
            </article>
          </section>
          <form class="chapter-card-form" @submit.prevent>
            <label class="wide"><span>本章目标</span><textarea v-assist-field="{ id: 'AppShell.chapterCardDraft.goal', read: () => chapterCardDraft.goal, write: value => { chapterCardDraft.goal = String(value) }, identity: () => chapterCardDraft }" v-model="chapterCardDraft.goal" maxlength="2000" placeholder="本章必须完成什么变化？"></textarea></label>
            <label><span>进入状态</span><textarea v-assist-field="{ id: 'AppShell.chapterCardDraft.entryState', read: () => chapterCardDraft.entryState, write: value => { chapterCardDraft.entryState = String(value) }, identity: () => chapterCardDraft }" v-model="chapterCardDraft.entryState" maxlength="2000" placeholder="开场时人物、地点与局面"></textarea></label>
            <label><span>退出变化</span><textarea v-assist-field="{ id: 'AppShell.chapterCardDraft.exitChange', read: () => chapterCardDraft.exitChange, write: value => { chapterCardDraft.exitChange = String(value) }, identity: () => chapterCardDraft }" v-model="chapterCardDraft.exitChange" maxlength="2000" placeholder="章末相较开场改变了什么"></textarea></label>
            <label class="wide"><span>节拍 / 场景（每行一项）</span><textarea v-assist-field="{ id: 'AppShell.chapterCardDraft.beatsText', read: () => chapterCardDraft.beatsText, write: value => { chapterCardDraft.beatsText = String(value) }, identity: () => chapterCardDraft }" v-model="chapterCardDraft.beatsText" maxlength="25000" placeholder="发现异常\n追踪线索\n被迫作出选择"></textarea></label>
            <label><span>核心冲突</span><textarea v-assist-field="{ id: 'AppShell.chapterCardDraft.conflict', read: () => chapterCardDraft.conflict, write: value => { chapterCardDraft.conflict = String(value) }, identity: () => chapterCardDraft }" v-model="chapterCardDraft.conflict" maxlength="2000"></textarea></label>
            <label><span>章末钩子</span><textarea v-assist-field="{ id: 'AppShell.chapterCardDraft.hook', read: () => chapterCardDraft.hook, write: value => { chapterCardDraft.hook = String(value) }, identity: () => chapterCardDraft }" v-model="chapterCardDraft.hook" maxlength="2000"></textarea></label>
            <label><span>出场人物</span><input v-assist-field="{ id: 'AppShell.chapterCardDraft.charactersText', read: () => chapterCardDraft.charactersText, write: value => { chapterCardDraft.charactersText = String(value) }, identity: () => chapterCardDraft }" v-model="chapterCardDraft.charactersText" maxlength="5000" placeholder="用顿号或逗号分隔"></label>
            <label><span>视角人物 / 人称</span><input v-assist-field="{ id: 'AppShell.chapterCardDraft.pointOfView', read: () => chapterCardDraft.pointOfView, write: value => { chapterCardDraft.pointOfView = String(value) }, identity: () => chapterCardDraft }" v-model="chapterCardDraft.pointOfView" maxlength="2000" :placeholder="bookProfile.defaultPov || '例如：第三人称限知，跟随主角'"></label>
            <label class="wide"><span>叙述距离</span><input v-assist-field="{ id: 'AppShell.chapterCardDraft.narrativeDistance', read: () => chapterCardDraft.narrativeDistance, write: value => { chapterCardDraft.narrativeDistance = String(value) }, identity: () => chapterCardDraft }" v-model="chapterCardDraft.narrativeDistance" maxlength="2000" :placeholder="bookProfile.narrativeDistance || '例如：近距离，贴近当下感受'"></label>
            <label class="wide"><span>章末承接摘要 <small>{{ chapterSummaryStatus }}</small></span><textarea v-assist-field="{ id: 'AppShell.chapterSummaryDraft', read: () => chapterSummaryDraft, write: value => { chapterSummaryDraft = String(value) }, identity: () => selectedId }" v-model="chapterSummaryDraft" maxlength="50000" placeholder="概括本章已发生的变化、未解线索与下一章必须承接的状态。"></textarea><button class="text-action compact" type="button" :disabled="chapterCardSaving || !chapterSummaryDraft.trim()" @click="saveChapterSummary">确认作为下一章上下文</button></label>
          </form>
          </div>
          <footer class="chapter-card-actions"><label class="chapter-card-confirm"><input v-model="chapterCardDraft.status" type="checkbox" true-value="confirmed" false-value="draft" :disabled="chapterCardSaving"><span>章卡内容已确认</span></label><div><button class="text-action" type="button" :disabled="chapterCardSaving" @click="chapterCardOpen = false">返回正文</button><button class="seal-action small" type="button" data-testid="save-chapter-card" :disabled="chapterCardSaving" @click="saveChapterCard()"><span>{{ chapterCardSaving ? '保存中…' : '保存章卡' }}</span><i>卡</i></button></div></footer>
        </section>
      </div>

      </DialogTransition>

      <Transition name="revision-overlay" @before-leave="element => { element.inert = true; element.setAttribute('aria-hidden', 'true') }">
        <RevisionHistoryDialog v-if="showRevisions" :scope="revisionHistoryDialogScope" />
      </Transition>

      <DialogTransition @escape="showCharacterConflicts = false" :reading-key="current && selectedId ? `${current.id}:${selectedId}` : undefined">
      <div v-if="showCharacterConflicts" class="modal-backdrop character-conflict-backdrop" @click.self="showCharacterConflicts = false">
        <section class="character-conflict-docket" role="dialog" aria-modal="true" aria-labelledby="character-conflict-title">
          <header>
            <div><p class="eyebrow">写作提醒 · 逐条处理</p><h2 id="character-conflict-title">这条冲突应该怎么处理？</h2><small>先看正文证据，再决定修改、保留或稍后处理。点击 × 会保留提醒，不代表问题已解决。</small></div>
            <button type="button" aria-label="关闭人物冲突案卷" @click="showCharacterConflicts = false"><StudioIcon name="close" :size="18"/></button>
          </header>
          <div class="character-conflict-scroll" data-dialog-reading>
            <div class="conflict-help" data-testid="conflict-help"><b>修改后如何继续？</b><p>点击“去正文修改”会跳到相关段落。改好并保存后，从顶栏“写作指引”返回核对<template v-if="findingHistory">，展开下方“本章问题记录”确认修复</template>；如果原文正确，直接选择“原文没问题，这是误报”。</p></div>
            <article v-for="finding in characterContinuityFindings" :key="`${finding.code}-${finding.characterId}-${finding.fromChapter}-${finding.toChapter}`" class="continuity-finding-card" :class="[`severity-${finding.severity}`, { 'is-accepted': finding.findingStatus === 'accepted' }]">
              <div class="conflict-card-heading"><span class="conflict-field-seal" aria-hidden="true">{{ finding.severity === 'blocked' ? '阻' : finding.severity === 'attention' ? '察' : '议' }}</span><div><small>第 {{ finding.fromChapter }} → {{ finding.toChapter }} 章 · {{ continuityFindingLabels[finding.code] }}</small><h3>{{ finding.characterName }}</h3></div></div>
              <span v-if="finding.findingStatus === 'accepted'" class="continuity-finding-status">已列入待修复</span>
              <p>{{ finding.message }}</p>
              <blockquote><span>{{ finding.layer === 'semantic' ? '冲突双方与证据' : '状态证据' }}</span><p v-for="evidence in finding.evidence" :key="evidence">{{ evidence }}</p></blockquote>
              <div v-if="finding.sourceBodyVersionId" class="finding-audit-meta" data-testid="finding-audit-meta">
                <span>{{ findingLayerLabels[finding.layer || 'deterministic'] }}</span>
                <span v-if="finding.confidence !== undefined">置信度 {{ findingConfidenceLabel(finding.confidence) }}</span>
                <span :title="finding.sourceBodyVersionId">正文版本 {{ finding.sourceBodyVersionId.slice(0, 8) }}</span>
                <span :title="finding.sourceContentHash">内容校验 {{ finding.sourceContentHash?.slice(0, 8) }}</span>
              </div>
              <p v-if="finding.suggestedAction" class="finding-suggested-action"><b>建议动作</b><span>{{ finding.suggestedAction }}</span></p>
              <ConflictResolutionActions :busy="busy || Boolean(decidingContinuityFindingId)" :decidable="Boolean(finding.findingId)" :accepted="finding.findingStatus === 'accepted'" @locate="locateConsistencyFinding(finding)" @decide="(decision, reason) => decideContinuityFinding(finding, decision, reason)" />
            </article>
            <article v-for="conflict in pendingCharacterConflicts" :key="conflict.id" class="character-conflict-card" :data-conflict-id="conflict.id">
              <div class="conflict-card-heading">
                <span class="conflict-field-seal" aria-hidden="true">{{ { identity: '身', motivation: '志', arc: '弧' }[conflict.field] }}</span>
                <div><small>第 {{ conflict.chapterPosition }} 章 · {{ characterConflictLabels[conflict.field] }}</small><h3>{{ conflict.name }}</h3></div>
              </div>
              <dl><dt>模型认为正文正在声明</dt><dd>{{ conflict.claimedValue }}</dd></dl>
              <blockquote><span>正文逐字证据</span><p>{{ conflict.evidence }}</p></blockquote>
              <footer><small>确实写错了，就去正文修改；正文没有矛盾，则标为误报。</small><div class="conflict-main-actions"><button class="control-button primary compact" type="button" data-testid="locate-continuity-evidence" :disabled="busy" @click="locateLegacyCharacterConflict(conflict)">去正文修改</button><button class="control-button secondary compact" type="button" :disabled="busy || dismissingConflictId === conflict.id" @click="dismissCharacterConflict(conflict.id)">{{ dismissingConflictId === conflict.id ? '正在处理…' : '原文没问题，这是误报' }}</button></div></footer>
            </article>
            <article v-for="finding in literaryStyleFindings" :key="`${finding.code}-${finding.fromChapter}`" class="continuity-finding-card severity-advice" :class="{ 'is-accepted': finding.findingStatus === 'accepted' }">
              <div class="conflict-card-heading"><span class="conflict-field-seal" aria-hidden="true">文</span><div><small>第 {{ finding.fromChapter }} 章 · 文学性建议</small><h3>{{ literaryFindingLabels[finding.code] }}</h3></div></div>
              <span v-if="finding.findingStatus === 'accepted'" class="continuity-finding-status">已列入待修复</span>
              <p>{{ finding.message }}</p>
              <blockquote><span>命中片段</span><p v-for="evidence in finding.evidence" :key="evidence">{{ evidence }}</p></blockquote>
              <div v-if="finding.sourceBodyVersionId" class="finding-audit-meta" data-testid="finding-audit-meta">
                <span>{{ findingLayerLabels[finding.layer || 'literary'] }}</span>
                <span v-if="finding.confidence !== undefined">置信度 {{ findingConfidenceLabel(finding.confidence) }}</span>
                <span :title="finding.sourceBodyVersionId">正文版本 {{ finding.sourceBodyVersionId.slice(0, 8) }}</span>
                <span :title="finding.sourceContentHash">内容校验 {{ finding.sourceContentHash?.slice(0, 8) }}</span>
              </div>
              <p v-if="finding.suggestedAction" class="finding-suggested-action"><b>建议动作</b><span>{{ finding.suggestedAction }}</span></p>
              <ConflictResolutionActions literary :busy="busy || Boolean(decidingContinuityFindingId)" :decidable="Boolean(finding.findingId)" :accepted="finding.findingStatus === 'accepted'" @locate="locateConsistencyFinding(finding)" @decide="(decision, reason) => decideContinuityFinding(finding, decision, reason)" />
            </article>
            <FindingHistoryPanel v-if="findingHistory" :key="selectedId" :history="findingHistory" :busy="busy || Boolean(decidingContinuityFindingId)" :unsaved="saveState !== 'saved'" :error="findingResolutionError" @resolve="confirmFindingResolution" @refresh="refreshFindingHistory" />
            <div v-if="!characterContinuityFindings.length && !pendingCharacterConflicts.length && !literaryStyleFindings.length" class="character-conflict-empty"><span aria-hidden="true">清</span><h3>当前没有新的核对提示</h3><p v-if="findingHistory?.entries.some(entry => ['open', 'accepted', 'stale'].includes(entry.status))">还有旧记录待复核。展开“本章问题记录”，可继续核对修改结果。</p><p v-else-if="findingHistory?.entries.length">处理结果已保留在本章记录中，可随时查看。</p><p v-else>如刚刚修改了正文，请保存后重新核对；没有检查记录时，不代表已经通过检查。</p></div>
          </div>
          <footer class="character-conflict-footer"><span>未处理的提醒会保留，可从顶栏“写作指引”中的待处理项再次打开。</span><div class="conflict-main-actions"><button class="control-button secondary compact" type="button" :disabled="busy" @click="recheckSavedManuscript">重新核对已保存正文</button><button class="control-button secondary compact" type="button" @click="returnToManuscript">暂不处理，返回书稿</button></div></footer>
        </section>
      </div>

      </DialogTransition>

      <DialogTransition @escape="cancelChapterDelete">
      <div v-if="showDeleteConfirm && chapterDeleteTarget" class="modal-backdrop delete-backdrop" @click.self="cancelChapterDelete">
        <section class="delete-sheet" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description">
          <div class="delete-seal" aria-hidden="true">移</div>
          <p class="eyebrow">收卷入篓 · 尚可取回</p>
          <h2 id="delete-title">删除第 {{ chapterDeleteTarget.position }} 章《{{ chapterDeleteTarget.id === selectedId ? chapterTitle : chapterDeleteTarget.title }}》？</h2>
          <p id="delete-description">章节会从正文目录移入本书回收站，不会永久销毁。之后可以在章节栏的回收站中找到并恢复。</p>
          <dl><div><dt>正文</dt><dd>保留在章节回收站</dd></div><div><dt>章纲与历史</dt><dd>继续保留</dd></div></dl>
          <footer><button class="text-action" type="button" @click="cancelChapterDelete">继续保留</button><button class="trash-confirm" type="button" :disabled="busy" @click="deleteChapter">移入回收站</button></footer>
        </section>
      </div>

      </DialogTransition>

      <LibraryDialogTransition @escape="!busy && (showTxtImport = false)">
        <ImportWorkspaceDialog v-if="showTxtImport" :scope="importWorkspaceDialogScope" />
      </LibraryDialogTransition>
    </section>
  </main>
</template>

<style>


.local-appearance-dialog.global-models-dialog { background:var(--surface); }
.writing-preference-group > .writing-full-flow-note { grid-column: 1 / -1; }
.structured-editor.character-atlas-workbench {
  min-inline-size: 0;
  min-block-size: 0;
  padding: var(--archive-gutter, 1rem);
  gap: 1rem;
  grid-template-rows: auto minmax(0, 1fr);
}
.character-atlas-workbench > .timeline-workbench-header {
  gap: 1rem;
  min-block-size: 0;
  padding-block-end: .875rem;
  flex-direction: row;
  align-items: center;
}
.character-atlas-workbench > .timeline-workbench-header h2 {
  font: 600 var(--archive-heading-size, 1.5rem)/1.3 var(--serif);
}
.character-atlas-workbench > .timeline-workbench-header p:not(.eyebrow) {
  font-size: var(--archive-text-small, .75rem);
  max-inline-size: 48em;
}
.character-atlas-view-switch { display: flex; gap: .25rem; flex-shrink: 0; }
.character-atlas-view-switch button {
  min-block-size: 2.5em;
  padding: .5em .75em;
  border: 1px solid var(--color-line);
  background: var(--color-surface);
  color: var(--color-ink);
  font: 500 var(--archive-text-control, .875rem)/1.4 var(--sans);
  cursor: pointer;
}
.character-atlas-view-switch button[aria-pressed=true] {
  color: var(--color-surface);
  background: var(--color-ink);
  border-color: var(--color-ink);
}
.character-atlas-view-switch button:focus-visible {
  outline: 2px solid var(--color-jade);
  outline-offset: 2px;
}
@media (max-width: 60rem) {
  .character-atlas-workbench > .timeline-workbench-header { flex-wrap: wrap; }
  .character-atlas-workbench > .timeline-workbench-header p:not(.eyebrow) { display: none; }
}
/* Multi-provider settings: preserve the paper-and-ink language while keeping
   ownership, credential state and destructive effects visible. */
.settings-page .settings-page-section > header > div:first-child > small,
.settings-page .ai-connection-card > header small {
  display: block;
}
.settings-page .settings-page-section > header > div:first-child > small {
  max-width: 660px;
  margin-top: 4px;
  font-size: 12px !important;
  line-height: 1.6;
}
.settings-page .ai-connection-card > header small {
  overflow: hidden;
  color: var(--muted);
  font-size: 11px !important;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ai-connection-fields label > small {
  color: var(--muted);
  font-size: 11px !important;
  font-weight: 400;
  line-height: 1.5;
}
.ai-connection-fields label > small.ai-field-error,
.ai-connection-fields label > small.ai-field-warning {
  color: var(--cinnabar);
}
.ai-settings-danger-dialog {
  width: min(620px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  overflow: auto;
  border: 1px solid var(--line-strong);
  background: var(--surface-raised);
  box-shadow: 0 24px 70px rgba(31, 34, 29, .24);
}
.ai-settings-danger-dialog.compact { width: min(540px, calc(100vw - 48px)); }
.ai-settings-danger-dialog > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 24px 26px 18px;
  border-bottom: 1px solid var(--line);
}
.ai-settings-danger-dialog > header h2 { margin: 5px 0 0; font-size: 22px; }
.ai-settings-danger-dialog > header > button {
  width: 40px;
  height: 40px;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  border: 0;
  background: transparent;
}
.ai-settings-danger-dialog > p { margin: 0; padding: 18px 26px 0; color: var(--ink-2); line-height: 1.7; }
.ai-settings-impact {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin: 18px 26px 0;
  padding: 14px;
  border-left: 3px solid var(--cinnabar);
  background: rgba(161, 61, 47, .06);
}
.ai-settings-impact b { flex-basis: 100%; font-size: 13px; }
.ai-settings-impact span { padding: 5px 8px; border: 1px solid var(--line); background: var(--surface); font-size: 12px; }
.ai-settings-impact.quiet { border-left-color: var(--jade); background: var(--jade-wash); }
.ai-settings-danger-dialog > label { display: grid; gap: 7px; padding: 18px 26px 0; color: var(--muted); font-size: 12px; }
.ai-settings-danger-dialog > label select { width: 100%; min-height: 40px; padding: 0 10px; border: 1px solid var(--line-strong); background: var(--surface); }
.ai-settings-danger-dialog > footer { display: flex; justify-content: flex-end; gap: 9px; margin-top: 22px; padding: 16px 26px; border-top: 1px solid var(--line); }
.ai-settings-danger-dialog .trash-confirm { color:var(--cinnabar); border-color:var(--cinnabar); }

@media (max-width: 1250px) {
  .settings-page .ai-connection-fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding-left: 16px;
  }
  .settings-page .ai-connection-fields > label:last-child { grid-column: 1 / -1; }
  .settings-page .ai-connection-card > footer { padding-left: 16px; }
  .settings-page .task-route-row {
    grid-template-columns: minmax(0, 1fr);
    align-items: stretch;
    gap: 9px;
  }
  .settings-page .task-route-row > div:first-child {
    grid-template-columns: auto minmax(0, 1fr);
    align-items: baseline;
    gap: 12px;
  }
  .settings-page .task-route-row .model-profile {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .settings-page .task-route-row .catalog-profile > .route-picker-field { grid-column: 1 / -1; }
  .settings-page .task-route-row .model-profile > label:nth-child(4) { grid-column: 1 / -1; }
  .settings-page .connection-command-bar {
    align-items: stretch;
    flex-direction: column;
  }
  .settings-page .connection-command-actions { justify-content: flex-end; flex-wrap: wrap; }
}
</style>
