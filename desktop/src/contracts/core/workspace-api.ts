import type { WorkflowStatus, WorkspaceBootstrapIssue, WorkspaceBootstrapProjection } from '../library/types'
import type { WorkspaceLoadCheckInput, WorkspaceLoadCheckResult } from '../library/types'
import type {
  ContextBudgetPreferences,
  ContextChapterSummaryView,
  ContextFactPackView,
  PromptProfileRecoveryResult,
  PromptProfileView,
  TaskCenterItem
} from '../assistant/types'
import type {
  BookProfile,
  CheatSystemData,
  FoundationData,
  FoundationDraftProposal,
  FoundationStatus,
  PowerSystemData,
  RealmLevel
} from '../worldbuilding/types'
import type { ChapterWorkspaceProjection } from '../manuscript/types'
import type {
  ApprovedFactView,
  ConsistencyFindingDecisionInput,
  ConsistencyOverview,
  FactBatchView,
  FactExtractionJob,
  FactReviewDecisionInput
} from '../review/types'
import type {
  CharacterLinesView,
  CharacterStateView,
  ForeshadowAction,
  ForeshadowActionView,
  ForeshadowLedgerView,
  ForeshadowSourceType,
  ForeshadowView,
  ResourceBalanceView,
  ResourceLedgerEntryView,
  ResourceLedgerView,
  StoryEntityRelationView,
  StoryEntityView
} from '../characters/types'
import type {
  IdeaGenerationInput,
  IdeaGenerationTask,
  IdeaSaveInput,
  IdeaView,
  OutlineExpansionAdoptionPreview,
  OutlineExpansionAdoptionResult,
  OutlineExpansionTask,
  OutlineExpansionTaskInput,
  PlanningOutlineSource
} from '../planning/types'
import type { TimelineEvent } from '../timeline/types'
import type { AiTask } from '../models/types'

export type DesktopWorkspaceApi = {
  bootstrap: () => Promise<WorkspaceBootstrapProjection>
  recheckLoadIssues: (input: WorkspaceLoadCheckInput) => Promise<WorkspaceLoadCheckResult>
  listTaskCenter: () => Promise<TaskCenterItem[]>
  getBookProfile: () => Promise<BookProfile>
  saveBookProfile: (data: BookProfile) => Promise<BookProfile>
  getContextBudgetPreferences: () => Promise<ContextBudgetPreferences>
  saveContextBudgetPreferences: (data: ContextBudgetPreferences) => Promise<ContextBudgetPreferences>
  generateFoundationDraft: () => Promise<FoundationDraftProposal>
  getFoundation: () => Promise<FoundationData>
  saveFoundation: (data: FoundationData) => Promise<FoundationData>
  getFoundationStatus: (chapterId?: number) => Promise<FoundationStatus>
  getChapterProjection: (chapterId?: number) => Promise<ChapterWorkspaceProjection>
  getWorkflowStatus: (chapterId?: number) => Promise<WorkflowStatus>
  getConsistencyOverview: (chapterId?: number) => Promise<ConsistencyOverview>
  getContextFactPack: (chapterId?: number) => Promise<ContextFactPackView>
  listFactBatches: (chapterId?: number) => Promise<FactBatchView[]>
  decideFactChanges: (input: FactReviewDecisionInput) => Promise<FactBatchView>
  decideConsistencyFinding: (input: ConsistencyFindingDecisionInput) => Promise<void>
  saveChapterSummary: (input: {
    chapterId: number
    bodyVersionId: string
    content: string
  }) => Promise<ContextChapterSummaryView>
  getChapterSummary: (
    chapterId: number
  ) => Promise<(ContextChapterSummaryView & { status: 'draft' | 'approved' | 'stale' | 'rejected' }) | null>
  startFactExtraction: (chapterId: number) => Promise<FactExtractionJob>
  getFactExtractionJob: (jobId: string) => Promise<FactExtractionJob>
  cancelFactExtraction: (jobId: string) => Promise<FactExtractionJob>
  retryFactExtraction: (jobId: string, operationId: string) => Promise<FactExtractionJob>
  listFactExtractionJobs: (chapterId?: number) => Promise<FactExtractionJob[]>
  approvedFactsBefore: (chapterId: number) => Promise<ApprovedFactView[]>
  listCharacterAliases: () => Promise<Array<{ characterId: string; canonicalName: string; alias: string }>>
  replaceCharacterAliases: (input: {
    canonicalName: string
    aliases: string[]
  }) => Promise<Array<{ characterId: string; canonicalName: string; alias: string }>>
  listStoryEntities: () => Promise<StoryEntityView[]>
  saveStoryEntity: (input: {
    id?: string
    entityType: StoryEntityView['entityType']
    canonicalName: string
    profileJson?: string
    status?: StoryEntityView['status']
  }) => Promise<StoryEntityView>
  listIdeas: () => Promise<IdeaView[]>
  startIdeaGeneration: (input: IdeaGenerationInput) => Promise<IdeaGenerationTask>
  retryIdeaGeneration: (taskId: string, operationId: string) => Promise<IdeaGenerationTask>
  startOutlineExpansion: (input: OutlineExpansionTaskInput) => Promise<OutlineExpansionTask>
  retryOutlineExpansion: (taskId: string, operationId: string) => Promise<OutlineExpansionTask>
  getPlanningOutline: (key: string) => Promise<PlanningOutlineSource | null>
  listOutlineExpansions: () => Promise<OutlineExpansionTask[]>
  cancelOutlineExpansion: (id: string) => Promise<OutlineExpansionTask>
  previewOutlineExpansionAdoption: (taskId: string) => Promise<OutlineExpansionAdoptionPreview>
  adoptOutlineExpansion: (token: string) => Promise<OutlineExpansionAdoptionResult>
  listIdeaGenerations: () => Promise<IdeaGenerationTask[]>
  ideaGeneration: (taskId: string) => Promise<IdeaGenerationTask>
  cancelIdeaGeneration: (taskId: string) => Promise<IdeaGenerationTask>
  saveIdea: (input: IdeaSaveInput) => Promise<IdeaView>
  promoteIdeaToWorldRule: (
    ideaId: string,
    expectedUpdatedAt: string
  ) => Promise<{ idea: IdeaView; entity: StoryEntityView }>
  promoteIdeaToSummary: (ideaId: string, expectedUpdatedAt: string) => Promise<{ idea: IdeaView }>
  listStoryEntityRelations: (entityId?: string) => Promise<StoryEntityRelationView[]>
  saveStoryEntityRelation: (input: {
    subjectEntityId: string
    predicate: string
    objectEntityId: string
    notes?: string
  }) => Promise<StoryEntityRelationView>
  getResourceLedger: (resourceEntityId?: string) => Promise<ResourceLedgerView>
  appendResourceLedger: (input: {
    operationKey: string
    resourceEntityId: string
    delta: number
    eventId?: string
    factId?: string
    note?: string
  }) => Promise<{ entry: ResourceLedgerEntryView; balance: ResourceBalanceView; idempotent: boolean }>
  getForeshadowLedger: () => Promise<ForeshadowLedgerView>
  recordForeshadowAction: (input: {
    operationKey: string
    action: ForeshadowAction
    title?: string
    foreshadowId?: string
    legacyChapterId?: number
    description?: string
    evidence?: string
    sourceType: ForeshadowSourceType
  }) => Promise<{ foreshadow: ForeshadowView; action: ForeshadowActionView; idempotent: boolean }>
  getCharacterState: () => Promise<CharacterStateView>
  getCharacterLines: () => Promise<CharacterLinesView>
  getWorldMap: () => Promise<import('../world-map/world-map').WorldMapView>
  saveWorldMap: (
    input: import('../world-map/world-map').WorldMapWriteInput
  ) => Promise<import('../world-map/world-map').WorldMapLayoutView>
  generateWorldMapImage: (
    input: import('../world-map/world-map').WorldMapImageGenerateInput
  ) => Promise<import('../world-map/world-map').WorldMapImageCandidate>
  cancelWorldMapImage: (operationId: string) => Promise<import('../world-map/world-map').WorldMapCancelResult>
  adoptWorldMapImage: (
    input: import('../world-map/world-map').WorldMapImageAdoptInput
  ) => Promise<import('../world-map/world-map').WorldMapLayoutView>
  getWorldMapBackground: () => Promise<import('../world-map/world-map').WorldMapBackgroundView>
  dismissCharacterConflict: (conflictId: string) => Promise<CharacterStateView>
  getTimeline: () => Promise<{ events: TimelineEvent[] }>
  saveTimeline: (events: TimelineEvent[]) => Promise<{ events: TimelineEvent[] }>
  getRealms: () => Promise<{ levels: RealmLevel[] }>
  saveRealms: (levels: RealmLevel[]) => Promise<{ levels: RealmLevel[] }>
  getPowerSystem: () => Promise<PowerSystemData>
  savePowerSystem: (data: PowerSystemData) => Promise<PowerSystemData>
  getCheatSystem: () => Promise<CheatSystemData>
  saveCheatSystem: (data: CheatSystemData) => Promise<CheatSystemData>
  getSystemTemplate: () => Promise<{ template: string }>
  saveSystemTemplate: (template: string) => Promise<{ template: string }>
  getPromptProfile: () => Promise<PromptProfileView>
  recoverDamagedPromptProfile: () => Promise<PromptProfileRecoveryResult>
  revealBootstrapIssue: (issueId: WorkspaceBootstrapIssue['id']) => Promise<{ success: true; relativePath: string }>
  savePromptOverride: (input: { task: AiTask; content: string }) => Promise<PromptProfileView>
  resetPromptOverride: (task: AiTask) => Promise<PromptProfileView>
}
