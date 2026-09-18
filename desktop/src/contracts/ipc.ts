// Compatibility exports; implementations belong to the feature contract modules.
export { chapterLimits } from './manuscript/validation'
export { planningLimits } from './planning/validation'
export { bookProfileLimits } from './worldbuilding/validation'
export type { ChapterUpdateInput, ChapterDraftRecoveryInput } from './manuscript/ipc'
export {
  decodeChapterIdArgs,
  decodeChapterReorderArgs,
  decodeChapterUpdateArgs,
  decodeChapterAutosaveStageArgs,
  decodeAutosaveCheckpointIdArgs,
  decodeChapterMirrorRecoveryTokenArgs,
  decodeChapterDraftRecoveryArgs,
  decodeChapterRevisionArgs,
  decodeChapterRevisionLabelArgs,
  decodeOptionalChapterIdArgs
} from './manuscript/ipc'
export type { ArgsDecoder } from './core/validation'
export { decodeNoArgs, decodeJobIdArgs, toAppErrorDto } from './core/ipc'
export {
  decodeWorldMapWriteArgs,
  decodeWorldMapImageGenerateArgs,
  decodeWorldMapImageAdoptArgs,
  decodeWorldMapImageCancelArgs
} from './world-map/ipc'
export {
  decodeChapterPlanningUpdateArgs,
  decodeIdeaSaveArgs,
  decodeIdeaPromotionArgs,
  decodePlanningOutlineKeyArgs,
  decodeOutlineExpansionArgs,
  decodeIdeaGenerationArgs,
  decodePlanningPackageArgs,
  decodePlanningProposalIdArgs,
  decodePlanningChapterDetailArgs,
  decodePlanningTotalAdoptionArgs,
  decodePlanningVolumeStructureArgs,
  decodePlanningVolumeOutlinePreviewArgs,
  decodePlanningVolumeOutlineAdoptionArgs,
  decodePlanningChapterDetailAdoptionPreviewArgs,
  decodePlanningChapterDetailAdoptionArgs,
  decodePlanningCharacterSeedAdoptionArgs,
  decodePlanningWorldSeedAdoptionArgs,
  decodePlanningPowerSystemAdoptionArgs,
  decodePlanningCheatSystemAdoptionArgs,
  decodeOutlineVolumeCreateArgs,
  decodeOutlineVolumeRenameArgs,
  decodePlannedChapterUpdateArgs,
  decodePlannedChapterStartArgs,
  decodeOutlineStageCreateArgs,
  decodeOutlineStageUpdateArgs,
  decodeOutlineChapterStagePlacementArgs,
  decodeOutlineEventPlacementArgs,
  decodeOutlineChapterPlacementArgs,
  decodeOutlineEventChapterPlacementArgs,
  decodeOutlineVolumeArgs,
  decodeOutlineUpdateArgs,
  decodeChapterOutlineUpdateArgs
} from './planning/ipc'
export {
  decodeProjectPathArgs,
  decodeProjectCreateArgs,
  decodeAutoBackupPreferencesArgs,
  decodeAutoBackupRunArgs,
  decodeSqliteShadowMigrationTokenArgs,
  decodeWorkspaceBootstrapIssueIdArgs
} from './library/ipc'
export {
  decodeBookProfileArgs,
  decodeResearchSettingsArgs,
  decodeResearchQueryArgs,
  decodeSourceCardCreateArgs,
  decodeSourceCardUpdateArgs,
  decodeFoundationArgs,
  decodeRealmsArgs,
  decodePowerSystemArgs,
  decodeCheatSystemArgs,
  decodeSystemTemplateArgs
} from './worldbuilding/ipc'
export {
  decodeContextBudgetPreferencesArgs,
  decodeAiCompleteArgs,
  decodeWritingAgentArgs,
  decodeWritingAgentStartArgs,
  decodeWritingAgentRetryArgs,
  decodeWritingAgentArtifactDecisionArgs,
  decodeWritingAgentArtifactApplicationArgs,
  decodePromptOverrideArgs,
  decodePromptTaskArgs
} from './assistant/ipc'
export {
  decodeRealTrialChapterArgs,
  decodeRealTrialConclusionArgs,
  decodeFactReviewDecisionArgs,
  decodeConsistencyFindingDecisionArgs,
  decodeChapterSummaryArgs,
  decodeCharacterConflictIdArgs
} from './review/ipc'
export {
  decodeImportCommitArgs,
  decodeImportManifestCommitArgs,
  decodeImportManifestIdArgs
} from './library/import-ipc'
export {
  decodeContinuationAnalysisEditsArgs,
  decodeContinuationCandidateIdArgs,
  decodeContinuationProjectDefinitionAdoptionArgs,
  decodeContinuationExistingPlotAdoptionArgs,
  decodeContinuationCharacterPreviewArgs,
  decodeContinuationCharacterAdoptionArgs,
  decodeContinuationWorldViewAdoptionArgs,
  decodeContinuationPowerSystemAdoptionArgs,
  decodeContinuationCheatSystemAdoptionArgs,
  decodeContinuationTotalOutlineAdoptionArgs,
  decodeContinuationVolumeOutlinePreviewArgs,
  decodeContinuationVolumeOutlineAdoptionArgs,
  decodeContinuationChapterOutlinePreviewArgs,
  decodeContinuationChapterOutlineAdoptionArgs
} from './library/continuation-ipc'
export { decodeAiSettingsUpdateArgs, decodeAiConnectionDraftArgs } from './models/ipc'
export {
  decodeCharacterAliasesArgs,
  decodeStoryEntityArgs,
  decodeStoryEntityRelationArgs,
  decodeResourceLedgerAppendArgs,
  decodeForeshadowActionArgs,
  decodeOptionalStoryEntityIdArgs
} from './characters/ipc'
export { decodeEventCandidateCreateArgs, decodeResearchEventIdArgs, decodeTimelineArgs } from './timeline/ipc'
