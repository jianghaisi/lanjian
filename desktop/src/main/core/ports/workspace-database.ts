import type { ChapterLifecycleState } from '../../modules/manuscript/domain/chapter-lifecycle'
import type { ChapterCard } from '../../modules/manuscript/domain/chapter-card'
import type { WorkspaceTaskContractSnapshot } from '../../modules/assistant/domain/task-template-contract'
import type { AppendStoryEventVersionInput, StoryEventVersion, StoryEventVersionHeads } from '../../modules/timeline/domain/story-event-version'

export const WORKSPACE_DATABASE_RELATIVE_PATH = '.webnovel/workspace.sqlite' as const
export const WORKSPACE_DATABASE_SCHEMA_VERSION = 42
export const WORKSPACE_AUTOSAVE_CHECKPOINT_WINDOW_MS = 30_000

export type LegacyWorkspaceChapter = {
  legacyChapterId: number
  position: number
  title: string
  content: string
  contentHash: string
  wordCount: number
  mirrorRelativePath: string
}

export type LegacyWorkspaceSnapshot = {
  /** Canonical current-project identity used only to reopen the same local work item. */
  workItemId: string
  projectName: string
  projectManifestHash: string
  sourceFingerprint: string
  chapters: LegacyWorkspaceChapter[]
  outlines?: LegacyWorkspaceOutline[]
  totalWords: number
  chapterOrderMirror: {
    relativePath: string
    content: string
    contentHash: string
    observedHash: string | null
  }
  promptProfile?: LegacyWorkspacePromptProfile
}

export type LegacyWorkspacePromptProfile = {
  version: 1
  workItemId: string
  genreFingerprint: string
  overrides: Partial<Record<'outline' | 'chapterOutline' | 'prose' | 'review', string>>
  updatedAt: string
  mirror: {
    relativePath: '.webnovel/config/prompt-profile.json'
    content: string
    contentHash: string
    observedHash: string | null
  } | null
}

export type LegacyWorkspaceOutline = {
  legacyKey: string
  parentLegacyKey?: string
  nodeType: 'summary' | 'volume' | 'stage' | 'chapter'
  seq: number
  title: string
  content: string
  contentHash: string
  mirrorRelativePath: string
}

export type WorkspaceStorageMode = 'shadow' | 'sqlite'
export type WorkspaceMirrorStatus = 'pending' | 'synced' | 'conflict' | 'failed'

export type WorkspaceChapterRecord = {
  legacyChapterId: number
  position: number
  title: string
  content: string
  contentHash: string
  wordCount: number
  revision: string
  currentVersionId: string
  mirrorStatus: WorkspaceMirrorStatus
  mirrorRelativePath: string
}

export type WorkspaceArchivedChapterRecord = WorkspaceChapterRecord & {
  deletedAt: string
}

export type WorkspaceBodyRevisionRecord = {
  id: string
  versionId: string
  legacyChapterId: number
  title: string
  content: string
  wordCount: number
  createdAt: string
  reason: 'legacy_import' | 'manual' | 'autosave' | 'ai' | 'restore'
  label: string | null
  isCurrent: boolean
  sourceTaskRunId: string | null
  generationArtifactId: string | null
}

export type WorkspaceMirrorPlan = {
  action: 'write' | 'delete'
  sourceType: 'chapter_markdown' | 'chapter_order_json' | 'outline_markdown' | 'outline_planning_state_json' | 'ai_settings_json' | 'workspace_config_json' | 'project_config_json' | 'foundation_json' | 'prompt_profile_json' | 'chapter_card_json' | 'character_aliases_json' | 'character_state_json' | 'story_entities_json' | 'ideas_json' | 'idea_generation_json' | 'outline_expansion_json' | 'resource_ledger_json' | 'foreshadow_ledger_json' | 'material_sources_json' | 'canonical_events_json'
  status?: WorkspaceMirrorStatus
  sourceId: string
  sourceVersionId: string
  relativePath: string
  previousRelativePath: string | null
  previousObservedHash: string | null
  content: string
  contentHash: string
}

export type WorkspaceMirrorPlanFilter = {
  sourceTypes?: readonly WorkspaceMirrorPlan['sourceType'][]
  excludeSourceTypes?: readonly WorkspaceMirrorPlan['sourceType'][]
  sourceId?: string
  sourceVersionId?: string
  legacyChapterId?: number
  statuses?: readonly WorkspaceMirrorStatus[]
}

export type WorkspaceOutlineRecord = {
  legacyKey: string
  parentLegacyKey: string | null
  nodeType: 'summary' | 'volume' | 'stage' | 'chapter'
  seq: number
  title: string
  content: string
  contentHash: string
  revision: string
  currentVersionId: string
  mirrorStatus: WorkspaceMirrorStatus
  mirrorRelativePath: string
  planning: WorkspaceOutlinePlanningMetadata
}

export type WorkspaceOutlinePlanningMetadata = {
  goalText: string
  entryStateText: string
  exitStateText: string
  conflictText: string
  turningPointText: string
  hookText: string
  metadataJson: string
}

export type WorkspaceOutlineWriteInput = {
  legacyKey: string
  parentLegacyKey?: string | null
  nodeType: WorkspaceOutlineRecord['nodeType']
  seq: number
  title: string
  content: string
  expectedRevision?: string
  sourceType?: 'manual' | 'ai' | 'restore'
  planning?: Partial<WorkspaceOutlinePlanningMetadata>
}

/** Main-process adoption plan. Every target must be new; existing author nodes are never replaced. */
export type WorkspaceOutlineChildrenAppendInput = {
  parentLegacyKey: string
  expectedParentRevision: string
  expectedChildKeys: string[]
  children: WorkspaceOutlineWriteInput[]
  adoption?: { taskId: string; artifactId: string; artifactHash: string }
}

export type WorkspaceProjectWritingConfig = {
  targetWords: number | null
  genreText: string
  audienceScale: string
  defaultPov: string
  writingStyle: string
  chapterTargetWords: number | null
  autosaveEnabled: boolean
  autosaveDelayMs: number
  autosaveMergeWindowMs: number
  configJson: string
}

export type WorkspaceProjectWritingConfigInput = Partial<WorkspaceProjectWritingConfig>

export type WorkspaceFoundationConfig = {
  creationPath: 'materials' | 'research'
  sourceNotes: string
  worldView: string
  useRealms: boolean
  useSystem: boolean
}

export type WorkspaceFoundationConfigWriteResult = {
  foundation: WorkspaceFoundationConfig
  mirrors: WorkspaceMirrorPlan[]
}

export type WorkspaceChapterCard = ChapterCard & {
  status: 'empty' | 'draft' | 'confirmed'
}

export type WorkspaceChapterPlanningRecord = {
  legacyChapterId: number
  outlineLegacyKey: string | null
  lifecycleStatus: ChapterLifecycleState
  archivedFromStatus: Exclude<ChapterLifecycleState, 'ARCHIVED'> | null
  currentBodyVersionId: string
  confirmedBodyVersionId: string | null
  confirmedAt: string | null
  hasUnconfirmedChanges: boolean
  card: WorkspaceChapterCard
}

export type WorkspaceChapterPlanningWriteInput = {
  legacyChapterId: number
  outlineLegacyKey?: string | null
  lifecycleStatus?: ChapterLifecycleState
  card?: Partial<WorkspaceChapterCard>
}

export type WorkspaceProjectWritingConfigWriteResult = {
  config: WorkspaceProjectWritingConfig
  mirror: WorkspaceMirrorPlan
}

export type WorkspacePromptProfileRecord = {
  version: 1
  workItemId: string
  genreFingerprint: string
  overrides: Partial<Record<'outline' | 'chapterOutline' | 'prose' | 'review', string>>
  updatedAt: string
  mirrorStatus: WorkspaceMirrorStatus | null
}

export type WorkspacePromptProfileWriteResult = {
  profile: WorkspacePromptProfileRecord
  mirror: WorkspaceMirrorPlan
}

export type WorkspaceCharacterAliasWriteResult = {
  aliases: WorkspaceCharacterAliasRecord[]
  mirror: WorkspaceMirrorPlan
}

export type WorkspaceChapterPlanningWriteResult = {
  planning: WorkspaceChapterPlanningRecord
  mirror: WorkspaceMirrorPlan
  manuscriptMirror: WorkspaceMirrorPlan | null
}

export type WorkspaceChapterWriteInput = {
  legacyChapterId: number
  title: string
  content: string
  reason: 'manual' | 'autosave' | 'ai' | 'restore'
  expectedRevision?: string
  restoredFromVersionId?: string
  sourceTaskRunId?: string
  generationArtifactId?: string
  /** Optional author-visible provenance label, committed with the new version. */
  label?: string
}

export type WorkspaceChapterWriteResult = {
  chapter: WorkspaceChapterRecord
  mirror: WorkspaceMirrorPlan
  insertedVersion: boolean
}

export type WorkspaceWritingAgentApplicationInput = {
  taskRunId: string
  artifactId: string
  artifactType: 'writing_agent_turn' | 'writing_agent_stream'
  legacyChapterId: number
  title: string
  content: string
  expectedRevision: string
  metadataJson: string
}

export type WorkspaceWritingAgentApplicationResult = WorkspaceChapterWriteResult & {
  artifact: WorkspaceGenerationArtifactRecord
}

export type WorkspaceAutosaveCheckpointStatus = 'staged' | 'finalized' | 'conflict' | 'discarded'

export type WorkspaceAutosaveCheckpointRecord = {
  id: string
  legacyChapterId: number
  clientOperationId: string
  baseBodyVersionId: string
  title: string
  content: string
  contentHash: string
  status: WorkspaceAutosaveCheckpointStatus
  mergeWindowMs: number
  windowStartedAt: string
  windowEndsAt: string
  lastStagedAt: string
  conflictCurrentBodyVersionId: string | null
  finalizedBodyVersionId: string | null
  operationCount: number
  createdAt: string
  updatedAt: string
}

export type WorkspaceAutosaveCheckpointStageInput = {
  legacyChapterId: number
  clientOperationId: string
  baseBodyVersionId: string
  title: string
  content: string
  /** Uses the current project configuration when omitted. */
  mergeWindowMs?: number
}

export type WorkspaceAutosaveCheckpointStageResult = {
  checkpoint: WorkspaceAutosaveCheckpointRecord
  merged: boolean
  idempotent: boolean
}

export type WorkspaceAutosaveCheckpointFinalizeResult = {
  checkpoint: WorkspaceAutosaveCheckpointRecord
  chapter: WorkspaceChapterRecord | null
  mirror: WorkspaceMirrorPlan | null
  insertedVersion: boolean
}

export type WorkspaceFactBatchStatus = 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'PARTIALLY_APPROVED' | 'REJECTED' | 'SUPERSEDED' | 'STALE'
export type WorkspaceFactChangeDecision = 'PENDING' | 'APPROVED' | 'REJECTED' | 'DEFERRED'
export type WorkspaceFactChangeType = 'NEW' | 'CHANGED' | 'CONFIRMS' | 'CONTRADICTS'
export type WorkspaceFactImportance = 'high' | 'medium' | 'low'
export type WorkspaceFactReviewClass = 'reviewable' | 'low_value'

export type WorkspaceFactChangeCreateInput = {
  id: string
  candidateType: string
  subjectType: string
  subjectId?: string | null
  subjectJson: string
  predicate: string
  objectJson: string
  normalizedKey: string
  evidenceJson: string
  confidence?: number | null
  importance: WorkspaceFactImportance
  changeType: WorkspaceFactChangeType
  reviewClass: WorkspaceFactReviewClass
  matchedFactId?: string | null
}

export type WorkspaceFactBatchCreateInput = {
  id: string
  legacyChapterId: number
  bodyVersionId: string
  contentHash: string
  idempotencyKey: string
  extractorTaskRunId?: string | null
  countsJson: string
  changes: WorkspaceFactChangeCreateInput[]
}

export type WorkspaceFactChangeRecord = WorkspaceFactChangeCreateInput & {
  batchId: string
  subjectId: string | null
  confidence: number | null
  matchedFactId: string | null
  decisionStatus: WorkspaceFactChangeDecision
  editedObjectJson: string | null
  createdAt: string
  updatedAt: string
}

export type WorkspaceFactBatchRecord = {
  id: string
  projectId: string
  legacyChapterId: number
  bodyVersionId: string
  contentHash: string
  status: WorkspaceFactBatchStatus
  extractorTaskRunId: string | null
  idempotencyKey: string
  countsJson: string
  changes: WorkspaceFactChangeRecord[]
  createdAt: string
  updatedAt: string
}

export type WorkspaceFactDecisionInput = {
  batchId: string
  decisions: Array<{
    id: string
    changeId: string
    decision: Exclude<WorkspaceFactChangeDecision, 'PENDING'>
    decidedObjectJson?: string
    sourceQuote?: string
    sourceSpanJson?: string
  }>
}

export type WorkspaceFactDecisionResult = {
  batch: WorkspaceFactBatchRecord
  createdFactIds: string[]
}

export type WorkspaceApprovedFactSourceRecord = {
  id: string
  legacyChapterId: number
  bodyVersionId: string
  contentHash: string
  quote: string
  spanJson: string
  current: boolean
}

export type WorkspaceApprovedFactRecord = {
  id: string
  subjectType: string
  subjectId: string | null
  predicate: string
  objectJson: string
  normalizedKey: string
  importance: WorkspaceFactImportance
  supersedesFactId: string | null
  approvedAt: string
  sourceCurrent: boolean
  sources: WorkspaceApprovedFactSourceRecord[]
}

export type WorkspaceTaskStatus = 'queued' | 'resuming' | 'preparing' | 'running' | 'streaming' | 'paused' | 'succeeded' | 'cancelled' | 'failed' | 'interrupted'
export type WorkspaceArtifactStatus = 'partial' | 'complete' | 'invalid' | 'discarded' | 'applied'

export type WorkspaceTaskRunRecord = {
  id: string
  projectId: string
  legacyChapterId: number | null
  taskType: string
  status: WorkspaceTaskStatus
  idempotencyKey: string
  parentTaskRunId: string | null
  baseBodyVersionId: string | null
  contentHash: string | null
  contextPackageId: string | null
  modelConfigId: string | null
  taskContract: WorkspaceTaskContractSnapshot
  attempt: number
  checkpointJson: string
  errorCode: string | null
  errorMessage: string | null
  startedAt: string | null
  endedAt: string | null
  createdAt: string
  updatedAt: string
}

export type WorkspaceContextPackageRecord = {
  id: string
  projectId: string
  taskRunId: string
  compilerVersion: string
  contentJson: string
  contentHash: string
  tokenBudget: number
  estimatedTokens: number
  truncationJson: string
  createdAt: string
}

export type WorkspaceContextPackageCreateInput = {
  id: string
  taskRunId: string
  compilerVersion: string
  contentJson: string
  contentHash: string
  tokenBudget: number
  estimatedTokens: number
  truncationJson: string
}

export type WorkspaceTaskRunCreateInput = {
  id: string
  /** A continuation is inserted atomically as resuming; its paused/interrupted parent is never reopened. */
  initialStatus?: 'queued' | 'resuming'
  legacyChapterId?: number
  taskType: string
  idempotencyKey: string
  parentTaskRunId?: string
  baseBodyVersionId?: string
  contentHash?: string
  modelConfigId?: string
  /** Omit only for generic infrastructure callers; production services freeze an explicit task template. */
  taskContract?: WorkspaceTaskContractSnapshot
  attempt?: number
  checkpointJson: string
}

export type WorkspaceTaskRunTransitionInput = {
  id: string
  status: WorkspaceTaskStatus
  checkpointJson?: string
  errorCode?: string | null
  errorMessage?: string | null
}

export type WorkspaceGenerationArtifactRecord = {
  id: string
  taskRunId: string
  artifactType: string
  status: WorkspaceArtifactStatus
  content: string
  contentHash: string
  schemaValid: boolean
  baseBodyVersionId: string | null
  selectionAnchorJson: string | null
  metadataJson: string
  createdAt: string
  updatedAt: string
}

export type WorkspaceGenerationArtifactCreateInput = {
  id: string
  taskRunId: string
  artifactType: string
  status: WorkspaceArtifactStatus
  content: string
  contentHash: string
  schemaValid: boolean
  selectionAnchorJson?: string
  metadataJson: string
}

export type WorkspaceFindingLayer = 'deterministic' | 'semantic' | 'literary'
export type WorkspaceFindingSeverity = 'blocker' | 'warning' | 'suggestion'
export type WorkspaceFindingStatus = 'open' | 'accepted' | 'ignored' | 'exception' | 'stale' | 'fixed'

export type WorkspaceFindingCreateInput = {
  code: string
  title: string
  rationale: string
  evidenceJson: string
  suggestedAction?: string
  confidence?: number | null
}

export type WorkspaceFindingRunInput = {
  legacyChapterId: number
  bodyVersionId: string
  contentHash: string
  ruleLayer: WorkspaceFindingLayer
  findings: Array<WorkspaceFindingCreateInput & {
    severity: WorkspaceFindingSeverity
  }>
}

export type WorkspaceFindingRecord = WorkspaceFindingCreateInput & {
  id: string
  runId: string
  legacyChapterId: number
  bodyVersionId: string
  contentHash: string
  ruleLayer: WorkspaceFindingLayer
  severity: WorkspaceFindingSeverity
  status: WorkspaceFindingStatus
  /** Exact saved repair target; null for historical decisions without proven repair. */
  resultingBodyVersionId?: string | null
  createdAt: string
  updatedAt: string
}

export type WorkspaceFindingDecision = 'accepted' | 'ignored' | 'exception' | 'later' | 'fixed'
export type WorkspaceFindingDecisionInput = {
  findingId: string
  reason?: string
} & ({
  decision: Exclude<WorkspaceFindingDecision, 'fixed'>
  resultingBodyVersionId?: never
  expectedUpdatedAt?: never
} | {
  decision: 'fixed'
  resultingBodyVersionId: string
  expectedUpdatedAt: string
})

export type WorkspaceSummaryVersionRecord = {
  id: string
  legacyChapterId: number
  bodyVersionId: string
  content: string
  contentHash: string
  sourceTaskRunId: string | null
  status: 'draft' | 'approved' | 'stale' | 'rejected'
  createdAt: string
}

export type WorkspaceSummaryVersionWriteInput = {
  legacyChapterId: number
  bodyVersionId: string
  content: string
  sourceTaskRunId?: string | null
  status?: 'draft' | 'approved'
}

export type WorkspaceChapterDerivativeStatus = {
  bodyVersionId: string | null
  factBatches: { current: number; stale: number }
  summaries: { current: number; stale: number }
  ruleRuns: { current: number; stale: number }
}

export type WorkspaceDocumentChunkRecord = {
  id: string
  legacyChapterId: number
  chapterPosition: number
  chapterTitle: string
  bodyVersionId: string
  ordinal: number
  content: string
  contentHash: string
  tokenEstimate: number
  createdAt: string
}

/** Rebuildable cache derived only from effective approved character facts. */
export type WorkspaceCharacterSnapshotRecord = {
  id: string
  characterId: string
  name: string
  throughChapterId: number
  throughChapterPosition: number
  present: boolean
  location?: string
  injury?: string
  relationships?: string[]
  knowledge?: string[]
  possession?: string
  goal?: string
  power?: string
  vitality?: 'alive' | 'dead'
  lastFactId: string
  sourceFactSetHash: string
  generatedAt: string
}

export type WorkspaceModelConfigInput = {
  provider: string
  modelName: string
  displayName: string
  settingsJson: string
  inputTokenBudget?: number | null
  enabled?: boolean
  isDefault?: boolean
}

export type WorkspaceModelConfigRecord = WorkspaceModelConfigInput & {
  id: string
  projectId: string | null
  inputTokenBudget: number | null
  enabled: boolean
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export type WorkspaceCharacterAliasInput = {
  canonicalName: string
  aliases: string[]
}

export type WorkspaceCharacterAliasRecord = {
  characterId: string
  canonicalName: string
  alias: string
  normalizedAlias: string
  validFromChapterId: number | null
  validToChapterId: number | null
  createdAt: string
}

export type WorkspaceEntityType = 'character' | 'location' | 'item' | 'organization' | 'world_rule'

export type WorkspaceEntityInput = {
  id?: string
  entityType: WorkspaceEntityType
  canonicalName: string
  profileJson?: string
  status?: 'candidate' | 'approved' | 'archived'
}

export type WorkspaceEntityRecord = {
  id: string
  entityType: WorkspaceEntityType
  canonicalName: string
  normalizedName: string
  profileJson: string
  status: 'candidate' | 'approved' | 'archived'
  createdAt: string
  updatedAt: string
}

export type WorkspaceEntityRelationInput = {
  subjectEntityId: string
  predicate: string
  objectEntityId: string
  notes?: string
}

export type WorkspaceEntityRelationRecord = Omit<WorkspaceEntityRelationInput, 'notes'> & {
  id: string
  notes: string
  createdAt: string
  updatedAt: string
}

export type WorkspaceEntityWriteResult = {
  entity: WorkspaceEntityRecord
  mirror: WorkspaceMirrorPlan
}

export type WorkspaceEntityRelationWriteResult = {
  relation: WorkspaceEntityRelationRecord
  mirror: WorkspaceMirrorPlan
}

export type WorkspaceIdeaStatus = 'candidate' | 'approved' | 'archived'
export type WorkspaceIdeaPromotionType = 'world_rule' | 'summary'

export type WorkspaceIdeaInput = {
  generationSource?: { taskId: string; optionIndex: number }
  id?: string
  title: string
  content: string
  status?: WorkspaceIdeaStatus
}

export type WorkspaceIdeaRecord = {
  generationSource?: { taskId: string; optionIndex: number }
  id: string
  title: string
  content: string
  status: WorkspaceIdeaStatus
  promotedToType: WorkspaceIdeaPromotionType | null
  promotedToId: string | null
  createdAt: string
  updatedAt: string
}

export type WorkspaceIdeaWriteResult = {
  idea: WorkspaceIdeaRecord
  mirror: WorkspaceMirrorPlan
}

export type WorkspaceMaterialSourceType = 'manual' | 'web' | 'toutiao' | 'douyin-baike' | 'douyin-video' | 'other'

export type WorkspaceMaterialSourceReference = { title: string; url: string }

export type WorkspaceMaterialSourceRecord = {
  id: string
  provider: string
  sourceType: WorkspaceMaterialSourceType
  externalId?: string
  url?: string
  title: string
  author?: string
  publishedAt?: string
  capturedAt: string
  updatedAt?: string
  excerpt: string
  userNotes: string
  references?: WorkspaceMaterialSourceReference[]
  contentHash: string
}

export type WorkspaceMaterialSourcesWriteResult = {
  sources: WorkspaceMaterialSourceRecord[]
  mirror: WorkspaceMirrorPlan | null
}

export type WorkspaceMaterialSourceWriteResult = {
  source: WorkspaceMaterialSourceRecord
  mirror: WorkspaceMirrorPlan
}

export type WorkspaceCanonicalEventRecord = {
  id: string
  time: string
  characters: string[]
  location: string
  event: string
  result?: string
  evidenceRefs: Array<{ sourceId: string; excerpt: string }>
  confidence: number
  status: 'candidate' | 'approved'
  conflictGroupId?: string
  createdAt: string
  approvedAt?: string
}

export type WorkspaceCanonicalEventsWriteResult = {
  events: WorkspaceCanonicalEventRecord[]
  mirror: WorkspaceMirrorPlan | null
}

export type WorkspaceCanonicalEventWriteResult = {
  event: WorkspaceCanonicalEventRecord
  mirror: WorkspaceMirrorPlan | null
}

export type WorkspaceCanonicalEventVersionWriteResult = {
  version: StoryEventVersion
  heads: StoryEventVersionHeads
  mirror: WorkspaceMirrorPlan | null
}

export type WorkspaceCharacterStateDocument = {
  content: string
  contentHash: string
  revision: number
  updatedAt: string
}

export type WorkspaceCharacterStateWriteResult = {
  document: WorkspaceCharacterStateDocument
  mirror: WorkspaceMirrorPlan | null
}

export type WorkspaceOutlinePlanningStateDocument = WorkspaceCharacterStateDocument
export type WorkspaceOutlinePlanningStateWriteResult = WorkspaceCharacterStateWriteResult
export type WorkspaceAiSettingsDocument = WorkspaceCharacterStateDocument
export type WorkspaceAiSettingsWriteResult = WorkspaceCharacterStateWriteResult
/** Private model-assignment transaction guard; existing AI callers may omit it. */
export type WorkspaceAiSettingsWriteGuard = { projectId: string; revision: number | null; assertActive(): void }
export type WorkspaceConfigDocumentKind = 'timeline' | 'realms' | 'power_system' | 'cheat_system' | 'system_ui' | 'world_map'
export type WorkspaceConfigDocument = WorkspaceCharacterStateDocument
export type WorkspaceConfigWriteResult = WorkspaceCharacterStateWriteResult

export type WorkspaceIdeaPromotionResult = {
  idea: WorkspaceIdeaRecord
  entity: WorkspaceEntityRecord
  mirrors: WorkspaceMirrorPlan[]
}

export type WorkspaceResourceLedgerInput = {
  operationKey: string
  resourceEntityId: string
  delta: number
  eventId?: string
  factId?: string
  note?: string
}

export type WorkspaceResourceLedgerRecord = {
  id: string
  operationKey: string
  resourceEntityId: string
  resourceName: string
  eventId: string | null
  factId: string | null
  delta: number
  resultingQuantity: number
  note: string
  createdAt: string
}

export type WorkspaceResourceBalanceRecord = {
  resourceEntityId: string
  resourceName: string
  quantity: number
  isNegative: boolean
  lastChangedAt: string | null
}

export type WorkspaceResourceLedgerView = {
  balances: WorkspaceResourceBalanceRecord[]
  entries: WorkspaceResourceLedgerRecord[]
}

export type WorkspaceResourceLedgerWriteResult = {
  entry: WorkspaceResourceLedgerRecord
  balance: WorkspaceResourceBalanceRecord
  mirror: WorkspaceMirrorPlan | null
  idempotent: boolean
}

export type WorkspaceForeshadowStatus = 'open' | 'resolved' | 'discarded'
export type WorkspaceForeshadowAction = 'plant' | 'advance' | 'misdirect' | 'resolve' | 'hold' | 'discard'
export type WorkspaceForeshadowSourceType = 'manual' | 'chapter_draft' | 'writing_agent'

export type WorkspaceForeshadowActionInput = {
  operationKey: string
  action: WorkspaceForeshadowAction
  /** Required when planting; ignored for an existing foreshadow selected by id. */
  title?: string
  foreshadowId?: string
  legacyChapterId?: number
  description?: string
  evidence?: string
  sourceType: WorkspaceForeshadowSourceType
}

export type WorkspaceForeshadowRecord = {
  id: string
  title: string
  normalizedTitle: string
  status: WorkspaceForeshadowStatus
  plantedChapterId: number | null
  payoffChapterId: number | null
  dataJson: string
  createdAt: string
  updatedAt: string
}

export type WorkspaceForeshadowActionRecord = {
  id: string
  operationKey: string
  foreshadowId: string
  foreshadowTitle: string
  chapterId: number | null
  action: WorkspaceForeshadowAction
  description: string
  evidence: string
  sourceType: WorkspaceForeshadowSourceType
  createdAt: string
}

export type WorkspaceForeshadowLedgerView = {
  foreshadows: WorkspaceForeshadowRecord[]
  actions: WorkspaceForeshadowActionRecord[]
}

export type WorkspaceForeshadowActionWriteResult = {
  foreshadow: WorkspaceForeshadowRecord
  action: WorkspaceForeshadowActionRecord
  mirror: WorkspaceMirrorPlan | null
  idempotent: boolean
}

export type WorkspaceRealTrialChapterInput = {
  legacyChapterId: number
  bodyVersionId: string
  planningMinutes: number
  writingMinutes: number
  aiEditingMinutes: number
  factReviewMinutes: number
  diffAcceptedBlocks: number
  diffRejectedBlocks: number
  misappliedChanges: number
  falsePositiveFindings: number
  usefulFindings: number
  modelCost: number | null
  satisfaction: number
  continueNextChapter: boolean
  bypassedFeatures: string
  notes: string
}

export type WorkspaceRealTrialAutomaticMetrics = {
  autosaveCheckpoints: number
  autosaveFinalized: number
  autosaveConflicts: number
  autosavePending: number
  autosaveDiscarded: number
  aiTasks: number
  aiSucceeded: number
  aiCancelled: number
  aiFailed: number
  aiInterrupted: number
  aiRetries: number
  contextEstimatedTokens: number
  factCandidates: number
  factDecisions: number
  factBatchSubmittedDecisions: number
  findings: number
  findingDecisions: number
  usefulFindings: number
  falsePositiveFindings: number
  diffAcceptedBlocks: number
  diffRejectedBlocks: number
}

export type WorkspaceRealTrialChapterRecord = WorkspaceRealTrialChapterInput & {
  id: string
  contentHash: string
  automatic: WorkspaceRealTrialAutomaticMetrics
  createdAt: string
  updatedAt: string
}

export type WorkspaceRealTrialDecision = 'continue' | 'narrow' | 'adjust'

export type WorkspaceRealTrialConclusionInput = {
  decision: WorkspaceRealTrialDecision
  highPriorityProblems: string
  mediumPriorityProblems: string
  lowPriorityProblems: string
  rationale: string
  nextScope: string
}

export type WorkspaceRealTrialConclusionRecord = WorkspaceRealTrialConclusionInput & {
  id: string
  chapterCountAtDecision: number
  createdAt: string
  updatedAt: string
}

export type ShadowImportBlocker = {
  code: string
  message: string
}

export type ShadowImportPreview = {
  targetRelativePath: typeof WORKSPACE_DATABASE_RELATIVE_PATH
  sourceFingerprint: string
  chapterCount: number
  totalWords: number
  blockers: ShadowImportBlocker[]
}

export type ShadowImportResult = {
  sourceFingerprint: string
  chapterCount: number
  insertedVersions: number
  unchangedVersions: number
  verified: true
}

export type WorkspaceDatabaseInspection = {
  schemaVersion: number
  foreignKeys: boolean
  journalMode: string
  project: {
    id: string
    name: string
    storageMode: 'shadow' | 'sqlite'
    manifestHash: string
  }
  chapters: Array<{
    id: string
    legacyChapterId: number
    position: number
    title: string
    status: string
    currentBodyVersionId: string
    currentContent: string
    currentContentHash: string
    versionCount: number
    mirrorStatus: string
    mirrorRelativePath: string
  }>
}

export interface LegacyWorkspaceSource {
  snapshot(): Promise<LegacyWorkspaceSnapshot>
}

export interface WorkspaceDatabasePort {
  importSnapshot(snapshot: LegacyWorkspaceSnapshot): ShadowImportResult
  verifySnapshot(snapshot: LegacyWorkspaceSnapshot): void
  inspect(): WorkspaceDatabaseInspection
  storageMode(): WorkspaceStorageMode | null
  textAuthority(): 'legacy-sqlite' | 'files-v1'
  recoverManuscriptCommits(): void
  projectWritingConfig(): WorkspaceProjectWritingConfig
  updateProjectWritingConfig(input: WorkspaceProjectWritingConfigInput, expectedConfigHash?: string): WorkspaceProjectWritingConfigWriteResult
  foundationConfig(): WorkspaceFoundationConfig | null
  foundationMirror(): { relativePath: string; contentHash: string; status: WorkspaceMirrorStatus } | null
  writeFoundationConfig(input: WorkspaceFoundationConfig, observedMirrorHash?: string): WorkspaceFoundationConfigWriteResult
  formalPromptReady(): boolean
  formalPromptMirror(): { relativePath: string; contentHash: string; status: WorkspaceMirrorStatus } | null
  importPromptProfile(input: LegacyWorkspacePromptProfile): WorkspaceMirrorPlan | null
  promptProfile(): WorkspacePromptProfileRecord
  writePromptProfile(input: Omit<WorkspacePromptProfileRecord, 'mirrorStatus'>): WorkspacePromptProfileWriteResult
  activateSqlite(snapshot: LegacyWorkspaceSnapshot): void
  activateEmptyFileTextAuthority(): void
  deactivateSqlite(sourceFingerprint: string): void
  formalChapters(): WorkspaceChapterRecord[]
  /** Ordered active identities without loading manuscript bodies. */
  formalChapterIds(): number[]
  /** Point lookup for saves; must not materialize unrelated manuscript bodies. */
  formalChapter(legacyChapterId: number): WorkspaceChapterRecord | undefined
  formalArchivedChapters(): WorkspaceArchivedChapterRecord[]
  formalBodyVersion(legacyChapterId: number, versionId: string): WorkspaceChapterRecord
  formalManuscriptRevision(): string
  formalOutlineReady(): boolean
  formalOutlines(): WorkspaceOutlineRecord[]
  writeFormalOutline(input: WorkspaceOutlineWriteInput): { outline: WorkspaceOutlineRecord; mirror: WorkspaceMirrorPlan; insertedVersion: boolean }
  appendFormalOutlineChildren(input: WorkspaceOutlineChildrenAppendInput): WorkspaceOutlineRecord[]
  reservedOutlineKeys(): string[]
  writeFormalChapter(input: WorkspaceChapterWriteInput): WorkspaceChapterWriteResult
  applyWritingAgentArtifact(input: WorkspaceWritingAgentApplicationInput): WorkspaceWritingAgentApplicationResult
  startChapterFromOutline(chapterId: number, expectedRevision: string): { chapter: WorkspaceChapterRecord; created: boolean; mirror: WorkspaceMirrorPlan | null }
  createFormalChapter(minimumId?: number): WorkspaceChapterWriteResult
  stageAutosaveCheckpoint(input: WorkspaceAutosaveCheckpointStageInput): WorkspaceAutosaveCheckpointStageResult
  finalizeAutosaveCheckpoint(checkpointId: string): WorkspaceAutosaveCheckpointFinalizeResult
  listAutosaveCheckpoints(legacyChapterId?: number): WorkspaceAutosaveCheckpointRecord[]
  discardAutosaveCheckpoint(checkpointId: string): WorkspaceAutosaveCheckpointRecord
  createFactBatch(input: WorkspaceFactBatchCreateInput): WorkspaceFactBatchRecord
  listFactBatches(legacyChapterId?: number, statuses?: WorkspaceFactBatchStatus[]): WorkspaceFactBatchRecord[]
  decideFactChanges(input: WorkspaceFactDecisionInput): WorkspaceFactDecisionResult
  approvedFactsBefore(legacyChapterId: number, normalizedKeys?: string[]): WorkspaceApprovedFactRecord[]
  chapterPlanning(legacyChapterId: number): WorkspaceChapterPlanningRecord
  updateChapterPlanning(input: WorkspaceChapterPlanningWriteInput): WorkspaceChapterPlanningWriteResult
  reorderFormalChapter(legacyChapterId: number, position: number): WorkspaceMirrorPlan
  formalRevisions(legacyChapterId: number): WorkspaceBodyRevisionRecord[]
  nameCurrentFormalRevision(legacyChapterId: number, label: string): WorkspaceBodyRevisionRecord
  restoreFormalRevision(legacyChapterId: number, publicRevisionId: string, expectedRevision?: string): WorkspaceChapterWriteResult
  archiveFormalChapter(legacyChapterId: number): WorkspaceMirrorPlan
  restoreArchivedFormalChapter(legacyChapterId: number): WorkspaceChapterWriteResult
  pendingMirrorPlans(filter?: WorkspaceMirrorPlanFilter): WorkspaceMirrorPlan[]
  readableMirrorPlans(filter?: WorkspaceMirrorPlanFilter): WorkspaceMirrorPlan[]
  acknowledgeMirror(plan: WorkspaceMirrorPlan, status: WorkspaceMirrorStatus, observedHash?: string, errorCode?: string): void
  assertRollbackReady(): void
  backupTo(targetPath: string): void
  reidentifyRestoredProject(projectName: string, projectManifestHash: string, workItemId: string): void
  createTaskRun(input: WorkspaceTaskRunCreateInput): WorkspaceTaskRunRecord
  createContextPackage(input: WorkspaceContextPackageCreateInput): WorkspaceContextPackageRecord
  contextPackageForTask(taskRunId: string): WorkspaceContextPackageRecord | null
  transitionTaskRun(input: WorkspaceTaskRunTransitionInput): WorkspaceTaskRunRecord
  taskRun(id: string): WorkspaceTaskRunRecord | null
  taskRunByOperationKey(key: string): WorkspaceTaskRunRecord | null
  recentTaskRuns(taskType: string, legacyChapterId?: number, limit?: number): WorkspaceTaskRunRecord[]
  recentProjectTaskRuns(limit?: number): WorkspaceTaskRunRecord[]
  taskCenterTaskRuns(limit?: number): Array<WorkspaceTaskRunRecord & { hasContinuation: boolean }>
  interruptActiveTaskRuns(taskType?: string): number
  createGenerationArtifact(input: WorkspaceGenerationArtifactCreateInput): WorkspaceGenerationArtifactRecord
  completeTaskRunWithArtifact(taskId: string, checkpointJson: string, input: WorkspaceGenerationArtifactCreateInput): { task: WorkspaceTaskRunRecord; artifact: WorkspaceGenerationArtifactRecord }
  generationArtifactForTask(taskRunId: string, artifactType?: string): WorkspaceGenerationArtifactRecord | null
  savePartialGenerationArtifact(input: WorkspaceGenerationArtifactCreateInput): WorkspaceGenerationArtifactRecord
  updateGenerationArtifactStatus(id: string, status: WorkspaceArtifactStatus, metadataJson: string): WorkspaceGenerationArtifactRecord
  recordFindingRun(input: WorkspaceFindingRunInput): WorkspaceFindingRecord[]
  listFindings(legacyChapterId?: number, statuses?: WorkspaceFindingStatus[]): WorkspaceFindingRecord[]
  decideFinding(input: WorkspaceFindingDecisionInput): WorkspaceFindingRecord
  writeSummaryVersion(input: WorkspaceSummaryVersionWriteInput): WorkspaceSummaryVersionRecord
  chapterDerivativeStatus(legacyChapterId: number): WorkspaceChapterDerivativeStatus
  upsertModelConfig(input: WorkspaceModelConfigInput): WorkspaceModelConfigRecord
  reconcileModelConfigs(inputs: WorkspaceModelConfigInput[]): WorkspaceModelConfigRecord[]
  listModelConfigs(): WorkspaceModelConfigRecord[]
  replaceCharacterAliases(input: WorkspaceCharacterAliasInput): WorkspaceCharacterAliasWriteResult
  listCharacterAliases(): WorkspaceCharacterAliasRecord[]
  upsertEntity(input: WorkspaceEntityInput): WorkspaceEntityWriteResult
  listEntities(entityType?: WorkspaceEntityType): WorkspaceEntityRecord[]
  upsertEntityRelation(input: WorkspaceEntityRelationInput): WorkspaceEntityRelationWriteResult
  listEntityRelations(entityId?: string): WorkspaceEntityRelationRecord[]
  upsertIdea(input: WorkspaceIdeaInput): WorkspaceIdeaWriteResult
  listIdeas(status?: WorkspaceIdeaStatus): WorkspaceIdeaRecord[]
  ideasMirror(): { relativePath: string; contentHash: string; status: WorkspaceMirrorStatus } | null
  formalMaterialSourcesReady(): boolean
  importMaterialSources(sources: WorkspaceMaterialSourceRecord[], observedMirrorHash?: string): WorkspaceMaterialSourcesWriteResult
  listMaterialSources(): WorkspaceMaterialSourceRecord[]
  searchMaterialSources(queryTerms: string[], pinnedSourceIds?: string[], limit?: number): WorkspaceMaterialSourceRecord[]
  addMaterialSources(sources: WorkspaceMaterialSourceRecord[]): WorkspaceMaterialSourcesWriteResult
  updateMaterialSource(source: WorkspaceMaterialSourceRecord): WorkspaceMaterialSourceWriteResult
  materialSourcesMirror(): { relativePath: string; contentHash: string; status: WorkspaceMirrorStatus } | null
  formalCanonicalEventsReady(): boolean
  importCanonicalEvents(events: WorkspaceCanonicalEventRecord[], observedMirrorHash?: string): WorkspaceCanonicalEventsWriteResult
  listCanonicalEvents(): WorkspaceCanonicalEventRecord[]
  createCanonicalEvent(event: WorkspaceCanonicalEventRecord): WorkspaceCanonicalEventWriteResult
  approveCanonicalEvent(id: string): WorkspaceCanonicalEventWriteResult
  listCanonicalEventVersions(eventId: string): StoryEventVersion[]
  canonicalEventVersionHeads(eventId: string): StoryEventVersionHeads | null
  baselineCanonicalEventVersions(): StoryEventVersion[]
  appendCanonicalEventVersion(input: AppendStoryEventVersionInput): WorkspaceCanonicalEventVersionWriteResult
  canonicalEventsMirror(): { relativePath: string; contentHash: string; status: WorkspaceMirrorStatus } | null
  formalCharacterStateReady(): boolean
  importCharacterState(content: string, contentHash: string, observedMirrorHash?: string): WorkspaceCharacterStateWriteResult
  characterState(): WorkspaceCharacterStateDocument
  replaceCharacterState(expectedContentHash: string, content: string, contentHash: string): WorkspaceCharacterStateWriteResult
  characterStateMirror(): { relativePath: string; contentHash: string; status: WorkspaceMirrorStatus } | null
  formalOutlinePlanningStateReady(): boolean
  importOutlinePlanningState(content: string, contentHash: string, observedMirrorHash?: string): WorkspaceOutlinePlanningStateWriteResult
  outlinePlanningState(): WorkspaceOutlinePlanningStateDocument
  replaceOutlinePlanningState(expectedContentHash: string, content: string, contentHash: string): WorkspaceOutlinePlanningStateWriteResult
  outlinePlanningStateMirror(): { relativePath: string; contentHash: string; status: WorkspaceMirrorStatus } | null
  formalAiSettingsReady(): boolean
  importAiSettings(content: string, contentHash: string, observedMirrorHash?: string, guard?: WorkspaceAiSettingsWriteGuard): WorkspaceAiSettingsWriteResult
  aiSettings(): WorkspaceAiSettingsDocument
  replaceAiSettings(expectedContentHash: string, content: string, contentHash: string, guard?: WorkspaceAiSettingsWriteGuard): WorkspaceAiSettingsWriteResult
  aiSettingsMirror(): { relativePath: string; contentHash: string; status: WorkspaceMirrorStatus } | null
  formalWorkspaceConfigReady(kind: WorkspaceConfigDocumentKind): boolean
  importWorkspaceConfig(kind: WorkspaceConfigDocumentKind, content: string, contentHash: string, observedMirrorHash?: string): WorkspaceConfigWriteResult
  workspaceConfig(kind: WorkspaceConfigDocumentKind): WorkspaceConfigDocument
  replaceWorkspaceConfig(kind: WorkspaceConfigDocumentKind, expectedContentHash: string, content: string, contentHash: string): WorkspaceConfigWriteResult
  workspaceConfigMirror(kind: WorkspaceConfigDocumentKind): { relativePath: string; contentHash: string; status: WorkspaceMirrorStatus } | null
  promoteIdeaToWorldRule(ideaId: string, expectedUpdatedAt: string): WorkspaceIdeaPromotionResult
  promoteIdeaToSummary(ideaId: string, expectedUpdatedAt: string): { idea: WorkspaceIdeaRecord; outline: WorkspaceOutlineRecord; mirrors: WorkspaceMirrorPlan[] }
  resourceLedger(resourceEntityId?: string): WorkspaceResourceLedgerView
  appendResourceLedger(input: WorkspaceResourceLedgerInput): WorkspaceResourceLedgerWriteResult
  foreshadowLedger(status?: WorkspaceForeshadowStatus): WorkspaceForeshadowLedgerView
  recordForeshadowAction(input: WorkspaceForeshadowActionInput): WorkspaceForeshadowActionWriteResult
  upsertRealTrialChapter(input: WorkspaceRealTrialChapterInput): WorkspaceRealTrialChapterRecord
  listRealTrialChapters(): WorkspaceRealTrialChapterRecord[]
  upsertRealTrialConclusion(input: WorkspaceRealTrialConclusionInput): WorkspaceRealTrialConclusionRecord
  realTrialConclusion(): WorkspaceRealTrialConclusionRecord | null
  latestSummaryForChapter(legacyChapterId: number): WorkspaceSummaryVersionRecord | null
  approvedSummariesBefore(legacyChapterId: number, limit?: number): WorkspaceSummaryVersionRecord[]
  latestApprovedSummaryBefore(legacyChapterId: number): WorkspaceSummaryVersionRecord | null
  currentDocumentChunksBefore(legacyChapterId: number, limit?: number): WorkspaceDocumentChunkRecord[]
  searchCurrentDocumentChunksBefore(legacyChapterId: number, queryTerms: string[], limit?: number): WorkspaceDocumentChunkRecord[]
  rebuildCharacterSnapshots(): WorkspaceCharacterSnapshotRecord[]
  characterSnapshotHistory(): WorkspaceCharacterSnapshotRecord[]
  characterSnapshotsBefore(legacyChapterId: number): WorkspaceCharacterSnapshotRecord[]
  close(): void
}

/** Event inspection owns no mutation capability and pins one database read snapshot. */
/** Identity/status only; no manuscript or outline text is loaded for placement inspection. */
export type WorkspaceEventChapterCatalog = {
  manuscripts: 'sqlite' | 'unavailable'
  outlines: 'sqlite' | 'unavailable'
  entries: Array<{ kind: 'manuscript' | 'outline'; chapterId: number; status: 'active' | 'archived'; revision: string | null }>
}

export type WorkspaceEventReadPort = Pick<WorkspaceDatabasePort,
  'storageMode' | 'formalMaterialSourcesReady' | 'listMaterialSources' | 'searchMaterialSources'
  | 'materialSourcesMirror' | 'formalCanonicalEventsReady' | 'listCanonicalEvents'
  | 'listCanonicalEventVersions' | 'canonicalEventVersionHeads' | 'canonicalEventsMirror'
  | 'formalOutlinePlanningStateReady' | 'outlinePlanningState' | 'outlinePlanningStateMirror'
  | 'formalWorkspaceConfigReady' | 'workspaceConfig' | 'workspaceConfigMirror' | 'close'> & {
    readonly schemaVersion: number
    readonly projectId: string | null
    eventChapterCatalog(): WorkspaceEventChapterCatalog
    /** Presence only, never a verified receipt or permission to replay migration. */
    hasEventMigrationEvidence(): boolean
    /** Verified historical receipt only; no migration retry or consumer transition. */
    eventMigrationReceipt(operationId?: string): import('../../modules/timeline/domain/event-migration-receipt').EventMigrationReceipt | null
  }

/** Recovery previews receive no writes and pin a private, verified read snapshot. */
export type WorkspaceRecoveryReadPort = Pick<WorkspaceDatabasePort,
  'storageMode' | 'textAuthority' | 'formalBodyVersion' | 'formalOutlineReady' | 'formalChapters' | 'formalOutlines' | 'readableMirrorPlans' | 'close'>

export interface WorkspaceDatabaseFactory {
  /** Shelf identity from a private snapshot; never creates or upgrades author data. */
  readProjectIdentity?(workItemId: string): Promise<{ title: string; genre: string } | null>
  open(workItemId: string): Promise<WorkspaceDatabasePort>
  openExisting(workItemId: string): Promise<WorkspaceDatabasePort | null>
  /** Explicit AI save only: require an existing current schema; never create or migrate. */
  openModelSettingsWrite?(workItemId: string): Promise<WorkspaceDatabasePort>
  /** Optional for older injected adapters; callers must fail closed, never fall back to openExisting. */
  openEventReadOnly?(workItemId: string): Promise<WorkspaceEventReadPort | null>
  openRecoveryReadOnly?(workItemId: string): Promise<WorkspaceRecoveryReadPort | null>
}

export function assertLegacyWorkspaceSnapshot(snapshot: LegacyWorkspaceSnapshot): void {
  if (!snapshot.workItemId || !snapshot.projectName || !isSha256(snapshot.projectManifestHash) || !isSha256(snapshot.sourceFingerprint)) {
    throw new Error('影子导入快照身份无效')
  }
  if (!Number.isSafeInteger(snapshot.totalWords) || snapshot.totalWords < 0) throw new Error('影子导入总字数无效')
  if (snapshot.chapterOrderMirror.relativePath !== '.webnovel/manuscript/chapter-order.json'
    || !isSha256(snapshot.chapterOrderMirror.contentHash)
    || (snapshot.chapterOrderMirror.observedHash !== null && !isSha256(snapshot.chapterOrderMirror.observedHash))) {
    throw new Error('影子导入章节顺序镜像无效')
  }
  if (snapshot.promptProfile) assertLegacyPromptProfile(snapshot.promptProfile)
  const ids = new Set<number>()
  const positions = new Set<number>()
  let totalWords = 0
  for (const chapter of snapshot.chapters) {
    if (!Number.isSafeInteger(chapter.legacyChapterId) || chapter.legacyChapterId < 1 || ids.has(chapter.legacyChapterId)) {
      throw new Error('影子导入章节身份无效')
    }
    if (!Number.isSafeInteger(chapter.position) || chapter.position < 1 || positions.has(chapter.position)) {
      throw new Error('影子导入章节顺序无效')
    }
    if (!chapter.title || !isSha256(chapter.contentHash) || !Number.isSafeInteger(chapter.wordCount) || chapter.wordCount < 0) {
      throw new Error('影子导入章节内容无效')
    }
    const mirrorSegments = chapter.mirrorRelativePath.split('/')
    if (!chapter.mirrorRelativePath.startsWith('正文/')
      || chapter.mirrorRelativePath.includes('\\')
      || mirrorSegments.some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new Error('影子导入镜像路径无效')
    }
    ids.add(chapter.legacyChapterId)
    positions.add(chapter.position)
    totalWords += chapter.wordCount
  }
  if (snapshot.chapters.some((_, index) => !positions.has(index + 1)) || totalWords !== snapshot.totalWords) {
    throw new Error('影子导入章节统计不一致')
  }
  const outlineKeys = new Set<string>()
  for (const outline of snapshot.outlines ?? []) {
    if (!/^(total|volume-[1-9]\d*|stage-[1-9]\d*|chapter-[1-9]\d*)$/.test(outline.legacyKey) || outlineKeys.has(outline.legacyKey)
      || !['summary', 'volume', 'stage', 'chapter'].includes(outline.nodeType) || !Number.isSafeInteger(outline.seq) || outline.seq < 1
      || !outline.title.trim() || !isSha256(outline.contentHash) || outline.mirrorRelativePath.includes('\\')
      || !outline.mirrorRelativePath.startsWith('大纲/') || outline.mirrorRelativePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new Error('影子导入大纲结构无效')
    }
    if (outline.parentLegacyKey && !outlineKeys.has(outline.parentLegacyKey)) throw new Error('影子导入大纲父级无效')
    outlineKeys.add(outline.legacyKey)
  }
}

function assertLegacyPromptProfile(profile: LegacyWorkspacePromptProfile): void {
  if (!profile || profile.version !== 1 || !profile.workItemId || profile.genreFingerprint.length > 64 || profile.updatedAt.length > 100) {
    throw new Error('影子导入提示词身份无效')
  }
  const tasks = new Set(['outline', 'chapterOutline', 'prose', 'review'])
  for (const [task, content] of Object.entries(profile.overrides)) {
    if (!tasks.has(task) || typeof content !== 'string' || !content.trim() || content.length > 50_000) throw new Error('影子导入提示词内容无效')
  }
  if (profile.mirror && (profile.mirror.relativePath !== '.webnovel/config/prompt-profile.json'
    || !isSha256(profile.mirror.contentHash)
    || (profile.mirror.observedHash !== null && !isSha256(profile.mirror.observedHash)))) {
    throw new Error('影子导入提示词镜像无效')
  }
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value)
}
