import { localModelCatalog } from '../../models/adapters/local-models/catalog'
import { isLocalConnection } from '../../../../contracts/models/local-model-contracts'
import { parseBookModelSettings } from '../../models/domain/book-model-settings'
import { bookModelConfigInputs } from '../../models/adapters/book-model-configs'
import { modelBookIdentity } from '../../models/adapters/ai-settings-read-snapshot'
import { assignmentConflict, type BookModelAssignmentCommit } from '../../models/domain/book-model-assignments'
import type { BookModelSnapshot } from '../../models/domain/book-model-resolution'
import type { ModelRequestGuard } from '../../models/domain/model-provider'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type {
  ManuscriptAuthority,
  ManuscriptAutosaveCheckpoint,
  ManuscriptAutosaveFinalizeResult,
  ManuscriptAutosaveStageInput,
  ManuscriptAutosaveStageResult
} from '../domain/manuscript-authority'
import { AppError } from '../../../core/errors/app-error'
import type { ChapterOutlineEntry, ConsistencyFindingHistory, PlannedChapterOutline, PlannedChapterOutlineUpdate, SourceCard } from '../../../../contracts/index'
import type { PlannedChapterStartInput, PlannedChapterStartResult } from '../../../../contracts/index'
import type { OutlineMirrorRecoveryPreview, OutlineMirrorRecoveryResult } from '../../../../contracts/index'
import type {
  LegacyWorkspaceSnapshot,
  LegacyWorkspacePromptProfile,
  WorkspaceChapterPlanningRecord,
  WorkspaceChapterRecord,
  WorkspaceChapterPlanningWriteInput,
  WorkspaceDatabaseFactory,
  WorkspaceDatabasePort,
  WorkspaceEventReadPort,
  WorkspaceRecoveryReadPort,
  WorkspaceApprovedFactRecord,
  WorkspaceFactBatchRecord,
  WorkspaceFactBatchStatus,
  WorkspaceFactChangeType,
  WorkspaceFactDecisionInput,
  WorkspaceFindingDecisionInput,
  WorkspaceFindingRecord,
  WorkspaceFindingRunInput,
  WorkspaceMirrorPlan,
  WorkspaceMirrorStatus,
  WorkspacePromptProfileRecord,
  WorkspaceProjectWritingConfig,
  WorkspaceProjectWritingConfigInput,
  WorkspaceFoundationConfig,
  WorkspaceSummaryVersionRecord,
  WorkspaceChapterDerivativeStatus,
  WorkspaceDocumentChunkRecord,
  WorkspaceCharacterSnapshotRecord,
  WorkspaceEntityInput,
  WorkspaceEntityRelationInput,
  WorkspaceEntityRecord,
  WorkspaceEntityRelationRecord,
  WorkspaceIdeaInput,
  WorkspaceIdeaPromotionResult,
  WorkspaceIdeaRecord,
  WorkspaceIdeaStatus,
  WorkspaceMaterialSourceRecord,
  WorkspaceCanonicalEventRecord,
  WorkspaceResourceLedgerInput,
  WorkspaceResourceLedgerView,
  WorkspaceResourceLedgerWriteResult,
  WorkspaceForeshadowActionInput,
  WorkspaceForeshadowActionWriteResult,
  WorkspaceForeshadowLedgerView,
  WorkspaceForeshadowStatus,
  WorkspaceOutlineRecord,
  WorkspaceConfigDocumentKind
} from '../../../core/ports/workspace-database'
import type { AiSettings, ApprovedFactView, CanonicalEvent, Chapter, ChapterDraftProposal, ChapterMirrorRecoveryPreview, ChapterMirrorRecoveryResult, ChapterOutlineDocument, ChapterRevision, ChapterRevisionReason, CharacterDynamicChange, CharacterLinePoint, CharacterStateSnapshot, CharacterStateView, DeletedChapterSummary, FactBatchView, FactReviewDecisionInput, OutlineList, OutlineUpdateResult, OutlineVolume, ReadableMirrorRebuildResult, StageOutline, StageOutlineUpdateResult } from '../../../../contracts/index'
import { atomicWriteText } from '../../../platform/storage/atomic-file'
import { projectDirectory, projectExistingPath } from '../../../platform/storage/project-path'
import { parseChapterFileName } from '../domain/chapter-file'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'

export type SqliteActivationResult = {
  storageMode: 'sqlite'
  chapterCount: number
  pendingMirrors: number
  conflicts: number
  verified: true
}

// Compatibility readers may maintain their own mirrors, never another module's.
// Whole-book recovery is deliberately explicit at every call site.
type MirrorSyncScope = 'all' | { sourceTypes: readonly WorkspaceMirrorPlan['sourceType'][]; sourceId?: string }

function plannedChapterEntries(outlines: WorkspaceOutlineRecord[], manuscriptIds: Set<number>): ChapterOutlineEntry[] {
  const byKey = new Map(outlines.map(node => [node.legacyKey, node]))
  return outlines.filter(node => node.nodeType === 'chapter').map(node => {
    const chapterId = Number(node.legacyKey.slice(8))
    const parent = node.parentLegacyKey ? byKey.get(node.parentLegacyKey) : undefined
    const volume = parent?.nodeType === 'volume' ? parent : parent?.parentLegacyKey ? byKey.get(parent.parentLegacyKey) : undefined
    return { chapterId, title: node.title, revision: node.revision, mirrorStatus: node.mirrorStatus,
      volume: volume?.nodeType === 'volume' ? Number(volume.legacyKey.slice(7)) : null,
      stage: parent?.nodeType === 'stage' ? Number(parent.legacyKey.slice(6)) : null,
      hasManuscript: manuscriptIds.has(chapterId) }
  })
}

function stageOutlineView(outline: WorkspaceOutlineRecord, outlines: WorkspaceOutlineRecord[]): StageOutline {
  const volume = Number(outline.parentLegacyKey?.slice(7))
  if (!Number.isSafeInteger(volume) || volume < 1) throw new AppError('INVALID_PROJECT_STATE', '阶段纲缺少有效的所属篇卷。', { recoverable: true })
  return {
    stage: outline.seq,
    volume,
    title: outline.title,
    content: outline.content,
    chapterIds: outlines.filter((item) => item.nodeType === 'chapter' && item.parentLegacyKey === outline.legacyKey).map((item) => item.seq).sort((left, right) => left - right),
    mirrorStatus: outline.mirrorStatus
  }
}

export type SqliteRollbackResult = {
  storageMode: 'shadow'
  chapterCount: number
  verified: true
}

type ChapterMirrorRecoveryToken = {
  workItemId: string
  chapterId: number
  currentVersionId: string
  externalHash: string
  externalTitle: string
  expiresAt: number
}

const mirrorRecoveryLifetimeMs = 15 * 60 * 1000
const maximumMirrorBodyLength = 2_000_000

// Trusted main-process input after external full-text review; never a renderer DTO.
export type ReviewedExternalRevision = {
  projectFingerprint: string
  target: { kind: 'body'; chapterId: number } | { kind: 'outline'; key: string }
  baseVersionId: string
  baseHash: string
  content: string
  candidateHash: string
  reviewManifestHash: string
  creationMethod: 'ai'
}

export class SqliteManuscriptService implements ManuscriptAuthority {
  private readonly mirrorRecoveryTokens = new Map<string, ChapterMirrorRecoveryToken>()
  private readonly outlineMirrorRecoveryTokens = new Map<string, ChapterMirrorRecoveryToken>()

  constructor(
    private readonly databases: WorkspaceDatabaseFactory,
    private readonly trash: { trashItem: (path: string) => Promise<void> } = {
      trashItem: async () => { throw new AppError('FEATURE_UNAVAILABLE', '系统回收站服务未配置') }
    },
    private readonly writes: WorkspaceWriteCoordinator = new WorkspaceWriteCoordinator()
  ) {}

  async active(workItemId: string): Promise<boolean> {
    const database = await this.databases.openExisting(workItemId)
    if (!database) return false
    try { return database.storageMode() === 'sqlite' } finally { database.close() }
  }

  async outlineActive(workItemId: string): Promise<boolean> {
    const database = await this.databases.openExisting(workItemId)
    if (!database) return false
    try { return database.storageMode() === 'sqlite' && database.formalOutlineReady() } finally { database.close() }
  }

  async validate(workItemId: string): Promise<void> {
    // Writable book-open preparation replays only a previously authorized durable
    // commit. Private read-only previews never enter this lane.
    await this.withFormalMutation(workItemId, (database) => { database.formalChapters() })
  }

  async chapters(workItemId: string): Promise<Chapter[]> {
    return this.withFormalMutation(workItemId, async (database) => {
      await this.syncPending(workItemId, database, { sourceTypes: ['chapter_markdown', 'chapter_order_json'] })
      await this.detectSyncedChapterMirrorDrift(workItemId, database)
      return database.formalChapters().map(toChapter)
    })
  }

  async manuscriptRevision(workItemId: string): Promise<string> {
    return this.withFormalDatabase(workItemId, (database) => database.formalManuscriptRevision())
  }

  async projectWritingConfig(workItemId: string): Promise<WorkspaceProjectWritingConfig> {
    return this.withFormalDatabase(workItemId, (database) => database.projectWritingConfig())
  }

  async updateProjectWritingConfig(workItemId: string, input: WorkspaceProjectWritingConfigInput, expectedConfigHash?: string): Promise<WorkspaceProjectWritingConfig> {
    return this.withFormalMutation(workItemId, async (database) => {
      const result = database.updateProjectWritingConfig(input, expectedConfigHash)
      await this.syncPlan(workItemId, database, result.mirror)
      return result.config
    })
  }

  async foundationConfig(workItemId: string): Promise<WorkspaceFoundationConfig | null> {
    return this.withFormalDatabase(workItemId, (database) => database.foundationConfig())
  }

  async updateFoundationConfig(workItemId: string, input: WorkspaceFoundationConfig, observedMirrorHash?: string): Promise<WorkspaceFoundationConfig> {
    return this.withFormalMutation(workItemId, async (database) => {
      const result = database.writeFoundationConfig(input, observedMirrorHash)
      for (const mirror of result.mirrors) await this.syncPlan(workItemId, database, mirror)
      return result.foundation
    })
  }

  async promptProfile(workItemId: string, defaultProfileWorkItemId: string): Promise<WorkspacePromptProfileRecord> {
    return this.withFormalMutation(workItemId, async (database) => {
      await this.ensurePromptProfileReady(workItemId, database, defaultProfileWorkItemId)
      return database.promptProfile()
    })
  }

  async writePromptProfile(workItemId: string, input: Omit<WorkspacePromptProfileRecord, 'mirrorStatus'>): Promise<WorkspacePromptProfileRecord> {
    return this.withFormalMutation(workItemId, async (database) => {
      await this.ensurePromptProfileReady(workItemId, database, input.workItemId)
      const result = database.writePromptProfile(input)
      await this.syncPlan(workItemId, database, result.mirror)
      return database.promptProfile()
    })
  }

  async syncModelConfigs(workItemId: string, settings: AiSettings): Promise<void> {
    await this.withFormalMutation(workItemId, (database) => {
      database.reconcileModelConfigs(database.formalAiSettingsReady()
        ? bookModelConfigInputs(parseBookModelSettings(database.aiSettings().content)) : modelConfigInputs(settings))
    })
  }

  async aiSettingsReady(workItemId: string): Promise<boolean> {
    return this.withFormalDatabase(workItemId, (database) => database.formalAiSettingsReady())
  }

  async readAiSettings(workItemId: string): Promise<{ content: string; contentHash: string }> {
    return this.withFormalDatabase(workItemId, database => {
      const document = database.aiSettings()
      return { content: document.content, contentHash: document.contentHash }
    })
  }

  async aiSettings(workItemId: string): Promise<{ content: string; contentHash: string }> {
    return this.withFormalMutation(workItemId, async (database) => {
      await this.syncPending(workItemId, database, { sourceTypes: ['ai_settings_json'] })
      await this.detectAiSettingsMirrorDrift(workItemId, database)
      const document = database.aiSettings()
      return { content: document.content, contentHash: document.contentHash }
    })
  }

  async importAiSettings(workItemId: string, content: string, _settings: AiSettings, observedMirrorHash?: string): Promise<{ content: string; contentHash: string }> {
    return this.withFormalMutation(workItemId, async (database) => {
      const contentHash = hash(content)
      const result = database.importAiSettings(content, contentHash, observedMirrorHash)
      if (result.mirror) {
        const status = await this.syncPlan(workItemId, database, result.mirror)
        if (status !== 'synced') throw new AppError('CONFLICT', 'AI 模型配置已安全迁入 SQLite，但 JSON 在迁移期间发生变化，原文件没有被覆盖。', { recoverable: true })
      }
      return { content: result.document.content, contentHash: result.document.contentHash }
    })
  }

  async replaceAiSettings(workItemId: string, expectedContentHash: string, content: string, _settings: AiSettings): Promise<{ content: string; contentHash: string }> {
    return this.withFormalMutation(workItemId, async (database) => {
      const result = database.replaceAiSettings(expectedContentHash, content, hash(content))
      if (result.mirror) await this.syncPlan(workItemId, database, result.mirror)
      return { content: result.document.content, contentHash: result.document.contentHash }
    })
  }

  /** Private captured model-save entry. Reads/previews and old public setters do not call this. */
  async saveBookModelAssignment(source: BookModelSnapshot, content: string, guard: ModelRequestGuard): Promise<BookModelAssignmentCommit> {
    bookModelConfigInputs(parseBookModelSettings(content))
    if (!this.databases.openModelSettingsWrite || source.storage.mode !== 'sqlite' || !source.storage.projectId) {
      throw new AppError('FEATURE_UNAVAILABLE', '当前模型分配保存入口不可用；未尝试创建或升级数据库。', { recoverable: true })
    }
    return this.writes.run(source.bookRoot, async () => {
      await guard.recheck()
      const database = await this.databases.openModelSettingsWrite!(source.bookRoot)
      let committed = false
      try {
        await guard.recheck()
        const expected = { projectId: source.storage.projectId!, revision: source.storage.revision, assertActive: guard.assertActive }
        const result = source.storage.ready
          ? database.replaceAiSettings(source.storage.contentHash!, content, hash(content), expected)
          : database.importAiSettings(content, hash(content), source.fileHash ?? undefined, expected)
        committed = true
        // Commit is definitive; a later scope/mirror failure must not be reported as rollback.
        let mirrorStatus: WorkspaceMirrorStatus = 'pending'
        if (!result.mirror) {
          try { mirrorStatus = database.aiSettingsMirror()?.status ?? 'pending' }
          catch { mirrorStatus = 'failed' }
        }
        if (result.mirror) {
          const mirrorGuard: ModelRequestGuard = {
            assertActive: guard.assertActive,
            recheck: async () => {
              guard.assertActive()
              if (await modelBookIdentity(source.bookRoot) !== source.sourceIdentity) throw assignmentConflict()
              const current = database.aiSettings()
              if (current.contentHash !== result.document.contentHash || current.revision !== result.document.revision) throw assignmentConflict()
              guard.assertActive()
            }
          }
          try { mirrorStatus = await this.syncPlan(source.bookRoot, database, result.mirror, mirrorGuard) }
          catch { mirrorStatus = 'failed' } // Preserve committed success even if mirror acknowledgement itself fails.
        }
        return { content: result.document.content, contentHash: result.document.contentHash, revision: result.document.revision,
          authority: 'sqlite', mirrorStatus }
      } finally {
        try { database.close() }
        catch (error) { if (!committed) throw error } // Connection cleanup cannot undo an authoritative commit.
      }
    })
  }

  async workspaceConfigReady(workItemId: string, kind: WorkspaceConfigDocumentKind): Promise<boolean> {
    return this.withFormalDatabase(workItemId, (database) => database.formalWorkspaceConfigReady(kind))
  }

  /** No mirror synchronization or read-create; suitable for read-only map views. */
  async readWorldMapConfig(root: string): Promise<{ content: string; contentHash: string; revision: number; mirrorStatus: WorkspaceMirrorStatus | null } | null> {
    return this.withFormalDatabase(root, database => {
      if (!database.formalWorkspaceConfigReady('world_map')) return null
      return { ...database.workspaceConfig('world_map'), mirrorStatus: database.workspaceConfigMirror('world_map')?.status ?? null }
    })
  }

  async saveWorldMapConfig(root: string, input: { content: string; expectedContentHash: string | null; observedMirrorHash?: string }, guard: () => Promise<void>): Promise<{ content: string; contentHash: string; revision: number; mirrorStatus: WorkspaceMirrorStatus | null }> {
    return this.withFormalMutation(root, async database => {
      await guard()
      const ready = database.formalWorkspaceConfigReady('world_map')
      if (ready !== (input.expectedContentHash !== null)) throw new AppError('CONFLICT', '地图数据已变化，请重新读取后再保存。', { recoverable: true })
      const result = ready
        ? database.replaceWorkspaceConfig('world_map', input.expectedContentHash!, input.content, hash(input.content))
        : database.importWorkspaceConfig('world_map', input.content, hash(input.content), input.observedMirrorHash)
      if (result.mirror) await this.syncPlan(root, database, result.mirror)
      return { ...result.document, mirrorStatus: database.workspaceConfigMirror('world_map')?.status ?? null }
    })
  }

  async workspaceConfig(workItemId: string, kind: WorkspaceConfigDocumentKind): Promise<{ content: string; contentHash: string }> {
    return this.withFormalMutation(workItemId, async (database) => {
      await this.syncPending(workItemId, database, { sourceTypes: ['workspace_config_json'], sourceId: kind })
      await this.detectWorkspaceConfigMirrorDrift(workItemId, database, kind)
      const document = database.workspaceConfig(kind)
      return { content: document.content, contentHash: document.contentHash }
    })
  }

  async importWorkspaceConfig(workItemId: string, kind: WorkspaceConfigDocumentKind, content: string, observedMirrorHash?: string): Promise<{ content: string; contentHash: string }> {
    return this.withFormalMutation(workItemId, async (database) => {
      const result = database.importWorkspaceConfig(kind, content, hash(content), observedMirrorHash)
      if (result.mirror) {
        const status = await this.syncPlan(workItemId, database, result.mirror)
        if (status !== 'synced') throw new AppError('CONFLICT', `${workspaceConfigDisplayName(kind)}已安全迁入 SQLite，但 JSON 在迁移期间发生变化，原文件没有被覆盖。`, { recoverable: true })
      }
      return { content: result.document.content, contentHash: result.document.contentHash }
    })
  }

  async replaceWorkspaceConfig(workItemId: string, kind: WorkspaceConfigDocumentKind, expectedContentHash: string, content: string): Promise<{ content: string; contentHash: string }> {
    return this.withFormalMutation(workItemId, async (database) => {
      const result = database.replaceWorkspaceConfig(kind, expectedContentHash, content, hash(content))
      if (result.mirror) await this.syncPlan(workItemId, database, result.mirror)
      return { content: result.document.content, contentHash: result.document.contentHash }
    })
  }

  async characterAliases(workItemId: string): Promise<Array<{ characterId: string; canonicalName: string; alias: string }>> {
    return this.withFormalDatabase(workItemId, (database) => database.listCharacterAliases()
      .map((item) => ({ characterId: item.characterId, canonicalName: item.canonicalName, alias: item.alias })))
  }

  async replaceCharacterAliases(workItemId: string, input: { canonicalName: string; aliases: string[] }): Promise<Array<{ characterId: string; canonicalName: string; alias: string }>> {
    return this.withFormalMutation(workItemId, async (database) => {
      const result = database.replaceCharacterAliases(input)
      await this.syncPlan(workItemId, database, result.mirror)
      return result.aliases.map((item) => ({ characterId: item.characterId, canonicalName: item.canonicalName, alias: item.alias }))
    })
  }

  async storyEntities(workItemId: string): Promise<WorkspaceEntityRecord[]> {
    return this.withFormalDatabase(workItemId, (database) => database.listEntities())
  }

  async saveStoryEntity(workItemId: string, input: WorkspaceEntityInput): Promise<WorkspaceEntityRecord> {
    return this.withFormalMutation(workItemId, async (database) => {
      const result = database.upsertEntity(input)
      await this.syncPlan(workItemId, database, result.mirror)
      return result.entity
    })
  }

  async storyEntityRelations(workItemId: string, entityId?: string): Promise<WorkspaceEntityRelationRecord[]> {
    return this.withFormalDatabase(workItemId, (database) => database.listEntityRelations(entityId))
  }

  async saveStoryEntityRelation(workItemId: string, input: WorkspaceEntityRelationInput): Promise<WorkspaceEntityRelationRecord> {
    return this.withFormalMutation(workItemId, async (database) => {
      const result = database.upsertEntityRelation(input)
      await this.syncPlan(workItemId, database, result.mirror)
      return result.relation
    })
  }

  async ideas(workItemId: string, status?: WorkspaceIdeaStatus): Promise<WorkspaceIdeaRecord[]> {
    return this.withFormalDatabase(workItemId, (database) => database.listIdeas(status))
  }

  async saveIdea(workItemId: string, input: WorkspaceIdeaInput): Promise<WorkspaceIdeaRecord> {
    return this.withFormalMutation(workItemId, async (database) => {
      const result = database.upsertIdea(input)
      await this.syncPlan(workItemId, database, result.mirror)
      return result.idea
    })
  }

  async materialSourcesReady(workItemId: string): Promise<boolean> {
    return this.withFormalDatabase(workItemId, (database) => database.formalMaterialSourcesReady())
  }

  /** Null means the module still uses its legacy source; inspection never imports it. */
  async readMaterialSources(workItemId: string): Promise<SourceCard[] | null> {
    return this.withEventReadOnly(workItemId, (database) => database?.storageMode() === 'sqlite' && database.formalMaterialSourcesReady()
      ? database.listMaterialSources() as SourceCard[] : null)
  }

  async readCanonicalEvents(workItemId: string): Promise<CanonicalEvent[] | null> {
    return this.withEventReadOnly(workItemId, (database) => database?.storageMode() === 'sqlite' && database.formalCanonicalEventsReady()
      ? database.listCanonicalEvents() as CanonicalEvent[] : null)
  }

  async readTimelineConfig(workItemId: string): Promise<{ content: string; contentHash: string } | null> {
    return this.withEventReadOnly(workItemId, (database) => database?.storageMode() === 'sqlite' && database.formalWorkspaceConfigReady('timeline')
      ? database.workspaceConfig('timeline') : null)
  }

  async materialSources(workItemId: string): Promise<SourceCard[]> {
    return this.withFormalMutation(workItemId, async (database) => {
      await this.syncPending(workItemId, database, { sourceTypes: ['material_sources_json'] })
      await this.detectMaterialSourcesMirrorDrift(workItemId, database)
      return database.listMaterialSources() as SourceCard[]
    })
  }

  async searchMaterialSources(workItemId: string, queryTerms: string[], pinnedSourceIds: string[] = [], limit?: number): Promise<SourceCard[]> {
    return this.withEventReadOnly(workItemId, (database) => {
      if (!database || database.storageMode() !== 'sqlite' || !database.formalMaterialSourcesReady()) {
        throw new AppError('CONFLICT', '素材数据源已经变化，请重新读取后检索。', { recoverable: true })
      }
      return database.searchMaterialSources(queryTerms, pinnedSourceIds, limit) as SourceCard[]
    })
  }

  async importMaterialSources(workItemId: string, sources: SourceCard[], observedMirrorHash?: string): Promise<SourceCard[]> {
    return this.withFormalMutation(workItemId, async (database) => {
      const result = database.importMaterialSources(sources as WorkspaceMaterialSourceRecord[], observedMirrorHash)
      if (result.mirror) {
        const status = await this.syncPlan(workItemId, database, result.mirror)
        if (status !== 'synced') throw new AppError('CONFLICT', '素材资料已安全迁入 SQLite，但 JSON 在迁移期间发生变化，原文件没有被覆盖。', { recoverable: true })
      }
      return result.sources as SourceCard[]
    })
  }

  async addMaterialSources(workItemId: string, sources: SourceCard[]): Promise<SourceCard[]> {
    return this.withFormalMutation(workItemId, async (database) => {
      const result = database.addMaterialSources(sources as WorkspaceMaterialSourceRecord[])
      if (result.mirror) await this.syncPlan(workItemId, database, result.mirror)
      return result.sources as SourceCard[]
    })
  }

  async updateMaterialSource(workItemId: string, source: SourceCard): Promise<SourceCard> {
    return this.withFormalMutation(workItemId, async (database) => {
      const result = database.updateMaterialSource(source as WorkspaceMaterialSourceRecord)
      await this.syncPlan(workItemId, database, result.mirror)
      return result.source as SourceCard
    })
  }

  async canonicalEventsReady(workItemId: string): Promise<boolean> {
    return this.withFormalDatabase(workItemId, (database) => database.formalCanonicalEventsReady())
  }

  async canonicalEvents(workItemId: string): Promise<CanonicalEvent[]> {
    return this.withFormalMutation(workItemId, async (database) => {
      await this.syncPending(workItemId, database, { sourceTypes: ['canonical_events_json'] })
      await this.detectCanonicalEventsMirrorDrift(workItemId, database)
      return database.listCanonicalEvents() as CanonicalEvent[]
    })
  }

  async importCanonicalEvents(workItemId: string, events: CanonicalEvent[], observedMirrorHash?: string): Promise<CanonicalEvent[]> {
    return this.withFormalMutation(workItemId, async (database) => {
      const result = database.importCanonicalEvents(events as WorkspaceCanonicalEventRecord[], observedMirrorHash)
      if (result.mirror) {
        const status = await this.syncPlan(workItemId, database, result.mirror)
        if (status !== 'synced') throw new AppError('CONFLICT', '正式事件已安全迁入 SQLite，但 JSON 在迁移期间发生变化，原文件没有被覆盖。', { recoverable: true })
      }
      return result.events as CanonicalEvent[]
    })
  }

  async createCanonicalEvent(workItemId: string, event: CanonicalEvent): Promise<CanonicalEvent> {
    return this.withFormalMutation(workItemId, async (database) => {
      const result = database.createCanonicalEvent(event as WorkspaceCanonicalEventRecord)
      if (result.mirror) await this.syncPlan(workItemId, database, result.mirror)
      return result.event as CanonicalEvent
    })
  }

  async approveCanonicalEvent(workItemId: string, id: string): Promise<CanonicalEvent> {
    return this.withFormalMutation(workItemId, async (database) => {
      const result = database.approveCanonicalEvent(id)
      if (result.mirror) await this.syncPlan(workItemId, database, result.mirror)
      return result.event as CanonicalEvent
    })
  }

  async characterStateReady(workItemId: string): Promise<boolean> {
    return this.withFormalDatabase(workItemId, (database) => database.formalCharacterStateReady())
  }

  async outlinePlanningStateReady(workItemId: string): Promise<boolean> {
    return this.withFormalDatabase(workItemId, (database) => database.formalOutlinePlanningStateReady())
  }

  async outlinePlanningState(workItemId: string): Promise<{ content: string; contentHash: string }> {
    return this.withFormalMutation(workItemId, async (database) => {
      await this.syncPending(workItemId, database, { sourceTypes: ['outline_planning_state_json'] })
      await this.detectOutlinePlanningStateMirrorDrift(workItemId, database)
      const document = database.outlinePlanningState()
      return { content: document.content, contentHash: document.contentHash }
    })
  }

  async importOutlinePlanningState(workItemId: string, content: string, observedMirrorHash?: string): Promise<{ content: string; contentHash: string }> {
    return this.withFormalMutation(workItemId, async (database) => {
      const contentHash = createHash('sha256').update(content).digest('hex')
      const result = database.importOutlinePlanningState(content, contentHash, observedMirrorHash)
      if (result.mirror) {
        const status = await this.syncPlan(workItemId, database, result.mirror)
        if (status !== 'synced') throw new AppError('CONFLICT', '谋篇工作流已安全迁入 SQLite，但 JSON 在迁移期间发生变化，原文件没有被覆盖。', { recoverable: true })
      }
      return { content: result.document.content, contentHash: result.document.contentHash }
    })
  }

  async replaceOutlinePlanningState(workItemId: string, expectedContentHash: string, content: string): Promise<{ content: string; contentHash: string }> {
    return this.withFormalMutation(workItemId, async (database) => {
      const contentHash = createHash('sha256').update(content).digest('hex')
      const result = database.replaceOutlinePlanningState(expectedContentHash, content, contentHash)
      if (result.mirror) await this.syncPlan(workItemId, database, result.mirror)
      return { content: result.document.content, contentHash: result.document.contentHash }
    })
  }

  async characterState(workItemId: string): Promise<{ state: CharacterStateView; contentHash: string }> {
    return this.withFormalMutation(workItemId, async (database) => {
      await this.syncPending(workItemId, database, { sourceTypes: ['character_state_json'] })
      await this.detectCharacterStateMirrorDrift(workItemId, database)
      const document = database.characterState()
      const state = JSON.parse(document.content) as CharacterStateView
      if (state.workItemId !== workItemId) throw new AppError('DATABASE_INTEGRITY_FAILED', '人物状态不属于当前作品。', { recoverable: false })
      return { state, contentHash: document.contentHash }
    })
  }

  async importCharacterState(workItemId: string, state: CharacterStateView, observedMirrorHash?: string): Promise<CharacterStateView> {
    return this.withFormalMutation(workItemId, async (database) => {
      if (state.workItemId !== workItemId) throw new AppError('VALIDATION_ERROR', '人物状态不属于当前作品。', { recoverable: true })
      const content = JSON.stringify(state)
      const result = database.importCharacterState(content, createHash('sha256').update(content).digest('hex'), observedMirrorHash)
      if (result.mirror) {
        const status = await this.syncPlan(workItemId, database, result.mirror)
        if (status !== 'synced') throw new AppError('CONFLICT', '人物状态已安全迁入 SQLite，但 JSON 在迁移期间发生变化，原文件没有被覆盖。', { recoverable: true })
      }
      return JSON.parse(result.document.content) as CharacterStateView
    })
  }

  async replaceCharacterState(workItemId: string, expectedContentHash: string, state: CharacterStateView): Promise<CharacterStateView> {
    return this.withFormalMutation(workItemId, async (database) => {
      if (state.workItemId !== workItemId) throw new AppError('VALIDATION_ERROR', '人物状态不属于当前作品。', { recoverable: true })
      const content = JSON.stringify(state)
      const contentHash = createHash('sha256').update(content).digest('hex')
      const result = database.replaceCharacterState(expectedContentHash, content, contentHash)
      if (result.mirror) await this.syncPlan(workItemId, database, result.mirror)
      return JSON.parse(result.document.content) as CharacterStateView
    })
  }

  async promoteIdeaToWorldRule(workItemId: string, ideaId: string, expectedUpdatedAt: string): Promise<Omit<WorkspaceIdeaPromotionResult, 'mirrors'>> {
    return this.withFormalMutation(workItemId, async (database) => {
      const result = database.promoteIdeaToWorldRule(ideaId, expectedUpdatedAt)
      for (const mirror of result.mirrors) await this.syncPlan(workItemId, database, mirror)
      return { idea: result.idea, entity: result.entity }
    })
  }

  async promoteIdeaToSummary(workItemId: string, ideaId: string, expectedUpdatedAt: string): Promise<{ idea: WorkspaceIdeaRecord }> {
    return this.withFormalMutation(workItemId, async (database) => {
      const result = database.promoteIdeaToSummary(ideaId, expectedUpdatedAt)
      for (const mirror of result.mirrors) await this.syncPlan(workItemId, database, mirror)
      return { idea: result.idea }
    })
  }

  async resourceLedger(workItemId: string, resourceEntityId?: string): Promise<WorkspaceResourceLedgerView> {
    return this.withFormalDatabase(workItemId, (database) => database.resourceLedger(resourceEntityId))
  }

  async appendResourceLedger(workItemId: string, input: WorkspaceResourceLedgerInput): Promise<Omit<WorkspaceResourceLedgerWriteResult, 'mirror'>> {
    return this.withFormalMutation(workItemId, async (database) => {
      const result = database.appendResourceLedger(input)
      if (result.mirror) await this.syncPlan(workItemId, database, result.mirror)
      return { entry: result.entry, balance: result.balance, idempotent: result.idempotent }
    })
  }

  async foreshadowLedger(workItemId: string, status?: WorkspaceForeshadowStatus): Promise<WorkspaceForeshadowLedgerView> {
    return this.withFormalDatabase(workItemId, (database) => database.foreshadowLedger(status))
  }

  async recordForeshadowAction(workItemId: string, input: WorkspaceForeshadowActionInput): Promise<Omit<WorkspaceForeshadowActionWriteResult, 'mirror'>> {
    return this.withFormalMutation(workItemId, async (database) => {
      const result = database.recordForeshadowAction(input)
      if (result.mirror) await this.syncPlan(workItemId, database, result.mirror)
      return { foreshadow: result.foreshadow, action: result.action, idempotent: result.idempotent }
    })
  }

  async settleForeshadowActions(workItemId: string, chapter: Chapter, proposal: ChapterDraftProposal, sourceType: 'chapter_draft' | 'writing_agent', sourceOperationId: string): Promise<WorkspaceForeshadowLedgerView> {
    if (!proposal.report.passed || proposal.chapterId !== chapter.id || !proposal.content.trim() || !chapter.content.includes(proposal.content.trim())) {
      throw new AppError('CONFLICT', '已保存正文与候选稿不一致，伏笔状态没有自动结算。', { recoverable: true })
    }
    const verifiedIds = proposal.report.reviewMode === 'fast'
      ? new Set(proposal.contract.foreshadowActions.map((item) => item.id))
      : new Set(proposal.report.foreshadowing.filter((item) => item.status === 'satisfied').map((item) => item.id))
    for (const item of proposal.contract.foreshadowActions.filter((action) => verifiedIds.has(action.id))) {
      const current = await this.foreshadowLedger(workItemId, 'open')
      const normalizedDescription = normalizeForeshadowTitle(item.description)
      const matched = item.action === 'plant' ? undefined : uniqueForeshadowMatch(current.foreshadows, normalizedDescription)
      if (item.action !== 'plant' && !matched) {
        throw new AppError('CONFLICT', `找不到与“${item.description}”唯一对应的待回收伏笔，请在纪事·伏笔中手动选择。`, { recoverable: true })
      }
      const reportEvidence = proposal.report.foreshadowing.find((finding) => finding.id === item.id)?.evidence?.trim()
      await this.recordForeshadowAction(workItemId, {
        operationKey: `${sourceType}:${sourceOperationId}:${item.id}`,
        action: item.action,
        ...(item.action === 'plant' ? { title: item.description } : { foreshadowId: matched!.id }),
        legacyChapterId: chapter.id,
        description: item.description,
        evidence: reportEvidence || proposal.content.trim().slice(0, 2_000),
        sourceType
      })
    }
    return this.foreshadowLedger(workItemId)
  }

  async factBatches(workItemId: string, legacyChapterId?: number, statuses?: WorkspaceFactBatchStatus[]): Promise<FactBatchView[]> {
    return this.withFormalDatabase(workItemId, (database) => database.listFactBatches(legacyChapterId, statuses)
      .map((batch) => toFactBatch(workItemId, batch)))
  }

  async decideFacts(workItemId: string, input: FactReviewDecisionInput): Promise<FactBatchView> {
    return this.withFormalMutation(workItemId, (database) => {
      const batch = database.listFactBatches().find((item) => item.id === input.batchId)
      if (!batch) throw new AppError('NOT_FOUND', '事实候选批次不存在。', { recoverable: true })
      const changes = new Map(batch.changes.map((change) => [change.id, change]))
      const decisions: WorkspaceFactDecisionInput['decisions'] = input.decisions.map((decision) => {
        const change = changes.get(decision.changeId)
        if (!change) throw new AppError('CONFLICT', '事实候选不属于当前批次。', { recoverable: true })
        const citation = factCitation(change.evidenceJson, change.id)
        return {
          id: randomUUID(),
          changeId: change.id,
          decision: decision.decision,
          ...(decision.decidedObjectJson !== undefined ? { decidedObjectJson: decision.decidedObjectJson } : {}),
          ...(decision.decision === 'APPROVED' ? { sourceQuote: citation.quote, sourceSpanJson: citation.spanJson } : {})
        }
      })
      return toFactBatch(workItemId, database.decideFactChanges({ batchId: batch.id, decisions }).batch)
    })
  }

  async approvedFactsBefore(workItemId: string, legacyChapterId: number, normalizedKeys?: string[]): Promise<ApprovedFactView[]> {
    return this.withFormalDatabase(workItemId, (database) => database.approvedFactsBefore(legacyChapterId, normalizedKeys).map(toApprovedFact))
  }

  async latestApprovedSummaryBefore(workItemId: string, legacyChapterId: number): Promise<WorkspaceSummaryVersionRecord | null> {
    return this.withFormalDatabase(workItemId, (database) => database.latestApprovedSummaryBefore(legacyChapterId))
  }

  async approvedSummariesBefore(workItemId: string, legacyChapterId: number, limit?: number): Promise<WorkspaceSummaryVersionRecord[]> {
    return this.withFormalDatabase(workItemId, (database) => database.approvedSummariesBefore(legacyChapterId, limit))
  }

  async latestSummaryForChapter(workItemId: string, legacyChapterId: number): Promise<WorkspaceSummaryVersionRecord | null> {
    return this.withFormalDatabase(workItemId, (database) => database.latestSummaryForChapter(legacyChapterId))
  }

  async chapterDerivativeStatus(workItemId: string, legacyChapterId: number): Promise<WorkspaceChapterDerivativeStatus> {
    return this.withFormalDatabase(workItemId, (database) => database.chapterDerivativeStatus(legacyChapterId))
  }

  async consistencyFindingHistory(workItemId: string, legacyChapterId: number): Promise<ConsistencyFindingHistory> {
    return this.withFormalDatabase(workItemId, (database) => {
      // Read current-version metadata, not the whole book or its readable mirrors.
      // No await separates these reads; recheck the pointer against external writers.
      const bodyVersionId = database.chapterDerivativeStatus(legacyChapterId).bodyVersionId
      if (!bodyVersionId) throw new AppError('NOT_FOUND', '当前章节尚无正式正文，无法读取检查历史。', { recoverable: true })
      const records = database.listFindings(legacyChapterId)
      if (database.chapterDerivativeStatus(legacyChapterId).bodyVersionId !== bodyVersionId) {
        throw new AppError('CONFLICT', '正文在读取检查历史时已变化，请刷新后重试。', { recoverable: true })
      }
      return {
        bodyVersionId,
        entries: records.slice(0, 500).map(record => ({
          id: record.id,
          title: record.title,
          rationale: record.rationale,
          status: record.status,
          sourceBodyVersionId: record.bodyVersionId,
          resultingBodyVersionId: record.resultingBodyVersionId ?? null,
          updatedAt: record.updatedAt
        }))
      }
    })
  }

  async currentDocumentChunksBefore(workItemId: string, legacyChapterId: number, limit?: number): Promise<WorkspaceDocumentChunkRecord[]> {
    return this.withFormalDatabase(workItemId, (database) => database.currentDocumentChunksBefore(legacyChapterId, limit))
  }

  async searchCurrentDocumentChunksBefore(workItemId: string, legacyChapterId: number, queryTerms: string[], limit?: number): Promise<WorkspaceDocumentChunkRecord[]> {
    return this.withFormalDatabase(workItemId, (database) => database.searchCurrentDocumentChunksBefore(legacyChapterId, queryTerms, limit))
  }

  async rebuildCharacterSnapshots(workItemId: string): Promise<CharacterStateSnapshot[]> {
    return this.withFormalMutation(workItemId, (database) => database.rebuildCharacterSnapshots().map(toCharacterSnapshot))
  }

  async characterSnapshotHistory(workItemId: string): Promise<CharacterLinePoint[]> {
    return this.withFormalDatabase(workItemId, (database) => database.characterSnapshotHistory().map((snapshot) => ({
      ...toCharacterSnapshot(snapshot),
      chapterId: snapshot.throughChapterId,
      chapterPosition: snapshot.throughChapterPosition,
      source: 'approved_fact' as const,
      sourceId: snapshot.lastFactId
    })))
  }

  async characterSnapshotsBefore(workItemId: string, legacyChapterId: number): Promise<CharacterStateSnapshot[]> {
    return this.withFormalDatabase(workItemId, (database) => database.characterSnapshotsBefore(legacyChapterId).map(toCharacterSnapshot))
  }

  async saveApprovedChapterSummary(workItemId: string, input: { chapterId: number; bodyVersionId: string; content: string }): Promise<WorkspaceSummaryVersionRecord> {
    return this.withFormalMutation(workItemId, (database) => database.writeSummaryVersion({
      legacyChapterId: input.chapterId, bodyVersionId: input.bodyVersionId, content: input.content, status: 'approved'
    }))
  }

  async recordConsistencyFindings(workItemId: string, input: WorkspaceFindingRunInput): Promise<WorkspaceFindingRecord[]> {
    return this.withFormalMutation(workItemId, (database) => database.recordFindingRun(input))
  }

  async decideConsistencyFinding(workItemId: string, input: WorkspaceFindingDecisionInput): Promise<void> {
    await this.withFormalMutation(workItemId, (database) => { database.decideFinding(input) })
  }

  async recordCharacterFactCandidates(workItemId: string, chapter: Chapter, changes: CharacterDynamicChange[], idempotencyKey: string, extractorTaskRunId?: string): Promise<FactBatchView | null> {
    if (!changes.length) return null
    if (!chapter.bodyVersionId || !chapter.revision) throw new AppError('CONFLICT', '正文正式版本尚未就绪，不能建立事实候选。', { recoverable: true })
    return this.withFormalMutation(workItemId, (database) => {
      const mergedChanges = mergeCharacterFactChanges(changes)
      const normalized = mergedChanges.map(({ change }) => normalizedCharacterFactKey(change))
      const previous = new Map(database.approvedFactsBefore(chapter.id, normalized).map((fact) => [fact.normalizedKey, fact]))
      const candidates = mergedChanges.map(({ change, evidenceQuotes, valueVariants }) => {
        const normalizedKey = normalizedCharacterFactKey(change)
        const matched = previous.get(normalizedKey)
        const objectJson = JSON.stringify(change.value)
        const changeType: WorkspaceFactChangeType = !matched ? 'NEW' : equivalentFactObject(matched.objectJson, objectJson) ? 'CONFIRMS' : 'CHANGED'
        const reviewClass = change.reviewClass === 'low_value' && changeType !== 'CONFIRMS' ? 'low_value' as const : 'reviewable' as const
        return {
          id: randomUUID(),
          candidateType: 'character_dynamic',
          subjectType: 'character',
          subjectJson: JSON.stringify({ name: change.character }),
          predicate: change.field,
          objectJson,
          normalizedKey,
          evidenceJson: JSON.stringify({
            quote: evidenceQuotes[0],
            quotes: evidenceQuotes,
            ...(valueVariants.length > 1 ? { valueVariants } : {}),
            ...(change.event ? { event: change.event } : {}),
            span: { kind: 'excerpt', chapterId: chapter.id, evidenceCount: evidenceQuotes.length }
          }),
          importance: change.importance ?? factImportance(change.field),
          changeType,
          reviewClass,
          ...(matched ? { matchedFactId: matched.id } : {})
        }
      })
      const batch = database.createFactBatch({
        id: randomUUID(),
        legacyChapterId: chapter.id,
        bodyVersionId: chapter.bodyVersionId!,
        contentHash: createHash('sha256').update(chapter.content).digest('hex'),
        idempotencyKey,
        ...(extractorTaskRunId ? { extractorTaskRunId } : {}),
        countsJson: JSON.stringify({
          total: candidates.length,
          high: candidates.filter((change) => change.importance === 'high').length,
          medium: candidates.filter((change) => change.importance === 'medium').length,
          low: candidates.filter((change) => change.importance === 'low').length,
          confirmations: candidates.filter((change) => change.changeType === 'CONFIRMS').length,
          lowValue: candidates.filter((change) => change.reviewClass === 'low_value').length
        }),
        changes: candidates
      })
      return toFactBatch(workItemId, batch)
    })
  }

  async chapterPlanning(workItemId: string, legacyChapterId: number): Promise<WorkspaceChapterPlanningRecord> {
    return this.withFormalDatabase(workItemId, (database) => database.chapterPlanning(legacyChapterId))
  }

  async bodyVersion(workItemId: string, legacyChapterId: number, versionId: string): Promise<Chapter> {
    return this.withFormalDatabase(workItemId, (database) => toChapter(database.formalBodyVersion(legacyChapterId, versionId)))
  }

  async updateChapterPlanning(workItemId: string, input: WorkspaceChapterPlanningWriteInput): Promise<WorkspaceChapterPlanningRecord> {
    return this.withFormalMutation(workItemId, async (database) => {
      const result = database.updateChapterPlanning(input)
      if (result.manuscriptMirror) await this.syncPlan(workItemId, database, result.manuscriptMirror)
      await this.syncPlan(workItemId, database, result.mirror)
      return result.planning
    })
  }

  async createChapter(workItemId: string, minimumId = 1): Promise<Chapter> {
    return this.withFormalMutation(workItemId, async database => {
      const result = database.createFormalChapter(minimumId)
      await this.syncPlan(workItemId, database, result.mirror)
      return toChapter(database.formalChapters().find(chapter => chapter.legacyChapterId === result.chapter.legacyChapterId)!)
    })
  }

  async updateChapter(workItemId: string, id: number, data: { title?: string; content?: string; reason?: ChapterRevisionReason; expectedRevision?: string; sourceTaskRunId?: string; generationArtifactId?: string }): Promise<Chapter> {
    return this.withFormalMutation(workItemId, async (database) => {
      const existing = database.formalChapter(id)
      const result = database.writeFormalChapter({
        legacyChapterId: id,
        title: safeTitle(data.title ?? existing?.title ?? `第${id}章`),
        content: data.content ?? existing?.content ?? '',
        reason: writableReason(data.reason),
        expectedRevision: data.expectedRevision,
        sourceTaskRunId: data.sourceTaskRunId,
        generationArtifactId: data.generationArtifactId
      })
      await this.syncPlan(workItemId, database, result.mirror)
      return toChapter(database.formalChapter(id)!)
    })
  }

  async stageAutosave(workItemId: string, id: number, input: ManuscriptAutosaveStageInput): Promise<ManuscriptAutosaveStageResult> {
    return this.withFormalMutation(workItemId, (database) => {
      const current = database.formalChapter(id)
      if (!current) throw new AppError('NOT_FOUND', `第 ${id} 章不存在`, { recoverable: true, details: { chapterId: id } })
      const result = database.stageAutosaveCheckpoint({
        legacyChapterId: id,
        clientOperationId: input.clientOperationId,
        baseBodyVersionId: input.baseBodyVersionId ?? current.currentVersionId,
        title: safeTitle(input.title),
        content: input.content,
        mergeWindowMs: input.mergeWindowMs
      })
      return {
        storageMode: 'sqlite',
        checkpoint: toAutosaveCheckpoint(result.checkpoint),
        chapter: toChapter(database.textAuthority() === 'files-v1' ? database.formalChapter(id)! : current),
        merged: result.merged,
        idempotent: result.idempotent
      }
    })
  }

  async finalizeAutosave(workItemId: string, checkpointId: string): Promise<ManuscriptAutosaveFinalizeResult> {
    return this.withFormalMutation(workItemId, async (database) => {
      const result = database.finalizeAutosaveCheckpoint(checkpointId)
      if (result.mirror) await this.syncPlan(workItemId, database, result.mirror)
      const chapter = (database.textAuthority() === 'files-v1' ? database.formalChapter(result.checkpoint.legacyChapterId) : result.chapter)
        ?? database.formalChapter(result.checkpoint.legacyChapterId)
      if (!chapter) throw new AppError('NOT_FOUND', '自动保存检查点对应的章节不存在', { recoverable: true })
      return {
        storageMode: 'sqlite',
        checkpoint: toAutosaveCheckpoint(result.checkpoint),
        chapter: toChapter(chapter),
        insertedVersion: result.insertedVersion
      }
    })
  }

  async autosaveRecoveries(workItemId: string, id?: number): Promise<ManuscriptAutosaveCheckpoint[]> {
    return this.withFormalDatabase(workItemId, (database) => database.listAutosaveCheckpoints(id)
      .filter((checkpoint) => checkpoint.status === 'staged' || checkpoint.status === 'conflict')
      .map(toAutosaveCheckpoint))
  }

  async discardAutosaveRecovery(workItemId: string, checkpointId: string): Promise<ManuscriptAutosaveCheckpoint> {
    return this.withFormalMutation(workItemId, (database) => toAutosaveCheckpoint(database.discardAutosaveCheckpoint(checkpointId)))
  }

  async reorderChapter(workItemId: string, id: number, position: number): Promise<Chapter[]> {
    return this.withFormalMutation(workItemId, async (database) => {
      await this.syncPlan(workItemId, database, database.reorderFormalChapter(id, position))
      return database.formalChapters().map(toChapter)
    })
  }

  async revisions(workItemId: string, id: number): Promise<ChapterRevision[]> {
    return this.withFormalDatabase(workItemId, (database) => database.formalRevisions(id).map((revision) => ({
      id: revision.id,
      chapterId: revision.legacyChapterId,
      title: revision.title,
      content: revision.content,
      word_count: revision.wordCount,
      createdAt: revision.createdAt,
      reason: revision.reason,
      label: revision.label,
      isCurrent: revision.isCurrent,
      sourceTaskRunId: revision.sourceTaskRunId,
      generationArtifactId: revision.generationArtifactId
    })))
  }

  async nameCurrentRevision(workItemId: string, id: number, label: string): Promise<ChapterRevision> {
    return this.withFormalMutation(workItemId, (database) => {
      const revision = database.nameCurrentFormalRevision(id, label)
      return {
        id: revision.id,
        chapterId: revision.legacyChapterId,
        title: revision.title,
        content: revision.content,
        word_count: revision.wordCount,
        createdAt: revision.createdAt,
        reason: revision.reason,
        label: revision.label,
        isCurrent: revision.isCurrent,
        sourceTaskRunId: revision.sourceTaskRunId,
        generationArtifactId: revision.generationArtifactId
      }
    })
  }

  async restoreRevision(workItemId: string, id: number, revisionId: string): Promise<Chapter> {
    return this.withFormalMutation(workItemId, async (database) => {
      let current: WorkspaceChapterRecord | undefined
      try { current = database.formalChapter(id) }
      catch (error) {
        // Explicit history restore may recreate this exact missing current file;
        // ordinary reads and unrelated failures must never do so.
        if (database.textAuthority() !== 'files-v1' || !(error instanceof AppError) || error.code !== 'NOT_FOUND') throw error
      }
      const result = database.restoreFormalRevision(id, revisionId, current?.revision)
      await this.syncPlan(workItemId, database, result.mirror)
      return toChapter(database.formalChapter(id)!)
    })
  }

  async previewExternalMirror(workItemId: string, id: number): Promise<ChapterMirrorRecoveryPreview> {
    if (!Number.isSafeInteger(id) || id < 1) throw new AppError('VALIDATION_ERROR', '章节编号无效。', { recoverable: true })
    return this.withRecoveryReadOnly(workItemId, async (database) => {
      const current = database.formalChapters().find((chapter) => chapter.legacyChapterId === id)
      if (!current) throw new AppError('NOT_FOUND', `第 ${id} 章不存在`, { recoverable: true, details: { chapterId: id } })
      const plan = chapterMirrorPlan(database, id)
      const baseline = database.textAuthority() === 'files-v1' ? database.formalBodyVersion(id, current.currentVersionId) : current
      const externalContent = await this.readManagedText(workItemId, plan.relativePath)
      const externalHash = hash(externalContent)
      if (externalHash === plan.contentHash) {
        throw new AppError('CONFLICT', 'Markdown 与 SQLite 已经一致，不需要恢复。', { recoverable: true })
      }
      const token = randomUUID()
      const expiresAt = Date.now() + mirrorRecoveryLifetimeMs
      const parsed = parseChapterFileName(basename(plan.relativePath))
      const externalTitle = safeTitle(parsed?.title || current.title)
      this.mirrorRecoveryTokens.set(token, {
        workItemId,
        chapterId: id,
        currentVersionId: current.currentVersionId,
        externalHash,
        externalTitle,
        expiresAt
      })
      this.pruneMirrorRecoveryTokens()
      return {
        token,
        chapterId: id,
        sqliteTitle: baseline.title,
        sqliteCharacterCount: baseline.content.length,
        sqliteExcerpt: mirrorExcerpt(baseline.content),
        externalTitle,
        externalCharacterCount: externalContent.length,
        externalExcerpt: mirrorExcerpt(externalContent),
        expiresAt: new Date(expiresAt).toISOString()
      }
    })
  }

  async adoptExternalMirror(workItemId: string, token: string, beforeCommit?: () => Promise<void>): Promise<ChapterMirrorRecoveryResult> {
    const pending = this.mirrorRecoveryTokens.get(token)
    if (!pending || pending.expiresAt <= Date.now()) {
      this.mirrorRecoveryTokens.delete(token)
      throw new AppError('CONFLICT', '这次恢复预览已经失效，请重新查看 Markdown 正文。', { recoverable: true })
    }
    if (pending.workItemId !== workItemId) throw new AppError('CONFLICT', '恢复预览属于另一部作品，未执行任何改动。', { recoverable: true })
    const result = await this.withFormalMutation(workItemId, async (database) => {
      if (this.mirrorRecoveryTokens.get(token) !== pending || pending.expiresAt <= Date.now()) throw new AppError('CONFLICT', '这次恢复已处理或过期，请重新核对当前版本。', { recoverable: true })
      const current = database.formalChapters().find((chapter) => chapter.legacyChapterId === pending.chapterId)
      if (!current || current.currentVersionId !== pending.currentVersionId) {
        throw new AppError('CONFLICT', 'SQLite 正文在预览后已经变化，请重新核对。', { recoverable: true })
      }
      const plan = chapterMirrorPlan(database, pending.chapterId)
      const externalContent = await this.readManagedText(workItemId, plan.relativePath)
      const externalHash = hash(externalContent)
      if (externalHash !== pending.externalHash) {
        database.acknowledgeMirror(plan, 'conflict', externalHash, 'MIRROR_EXTERNAL_CHANGE')
        throw new AppError('CONFLICT', 'Markdown 正文在预览后又发生了变化，请重新查看。', { recoverable: true })
      }
      await beforeCommit?.()
      if (pending.expiresAt <= Date.now()) throw new AppError('CONFLICT', '这次恢复预览已过期，请重新核对。', { recoverable: true })
      const write = database.writeFormalChapter({
        legacyChapterId: pending.chapterId,
        title: pending.externalTitle,
        content: externalContent,
        reason: 'restore',
        expectedRevision: current.revision
      })
      // The formal commit consumed this authorization, including when mirror sync fails.
      this.mirrorRecoveryTokens.delete(token)
      const mirrorStatus = await this.syncPlan(workItemId, database, write.mirror)
      const chapter = database.formalChapters().find((item) => item.legacyChapterId === pending.chapterId)
      if (!chapter) throw new AppError('NOT_FOUND', '恢复后的章节无法读取。', { recoverable: true })
      return {
        chapter: toChapter(chapter),
        previousBodyVersionId: pending.currentVersionId,
        importedExternalHash: externalHash,
        mirrorPending: mirrorStatus !== 'synced'
      }
    })
    this.mirrorRecoveryTokens.delete(token)
    return result
  }

  async adoptReviewedExternalRevision(workItemId: string, value: ReviewedExternalRevision, beforeCommit: () => Promise<void>) {
    // Detach caller-owned objects before any asynchronous work.
    const input = { ...value, target: { ...value.target } }
    if (input.projectFingerprint !== hash(workItemId) || input.creationMethod !== 'ai'
      || ![input.baseHash, input.candidateHash, input.reviewManifestHash].every(item => /^[a-f0-9]{64}$/.test(item))
      || !input.baseVersionId || typeof input.content !== 'string' || !input.content.trim()
      || input.content.length > maximumMirrorBodyLength || hash(input.content) !== input.candidateHash
      || input.candidateHash === input.baseHash || typeof beforeCommit !== 'function'
      || (input.target.kind === 'body' ? !Number.isSafeInteger(input.target.chapterId) || input.target.chapterId < 1
        : input.target.kind !== 'outline' || !/^(total|volume-[1-9]\d*|chapter-[1-9]\d*)$/.test(input.target.key))) {
      throw new AppError('VALIDATION_ERROR', '外部修订的作品、目标、来源或候选校验无效。', { recoverable: true })
    }
    return this.withFormalMutation(workItemId, async database => {
      const target = input.target
      const readTarget = () => target.kind === 'body'
        ? database.formalChapters().find(item => item.legacyChapterId === target.chapterId)
        : database.formalOutlines().find(item => item.legacyKey === target.key)
      const current = readTarget()
      if (!current || current.currentVersionId !== input.baseVersionId || current.contentHash !== input.baseHash) {
        throw new AppError('CONFLICT', '正式内容在审阅后已变化，未采用外部修订。', { recoverable: true })
      }
      const plan = target.kind === 'body' ? chapterMirrorPlan(database, target.chapterId)
        : database.readableMirrorPlans({ sourceTypes: ['outline_markdown'], sourceVersionId: input.baseVersionId })[0]
      if (!plan || plan.status !== 'synced' || await this.readManagedHash(workItemId, plan.relativePath) !== input.baseHash) {
        throw new AppError('CONFLICT', '可读镜像与审阅基准不一致，请先核对外部改动。', { recoverable: true })
      }
      await beforeCommit()
      if (await this.readManagedHash(workItemId, plan.relativePath) !== input.baseHash) {
        throw new AppError('CONFLICT', '可读镜像在采用前发生变化。', { recoverable: true })
      }
      // No await between the final version/metadata check and the formal write.
      const latest = readTarget()
      if (!latest || latest.currentVersionId !== input.baseVersionId || latest.revision !== current.revision) {
        throw new AppError('CONFLICT', '正式内容在采用前发生变化。', { recoverable: true })
      }
      const written = target.kind === 'body'
        ? database.writeFormalChapter({ legacyChapterId: target.chapterId, title: latest.title, content: input.content,
          expectedRevision: latest.revision, reason: 'restore', label: `外部 AI 修订采用 · ${input.reviewManifestHash.slice(0, 16)}` })
        : database.writeFormalOutline({ legacyKey: target.key, parentLegacyKey: (latest as WorkspaceOutlineRecord).parentLegacyKey,
          nodeType: (latest as WorkspaceOutlineRecord).nodeType, seq: (latest as WorkspaceOutlineRecord).seq,
          title: latest.title, content: input.content, expectedRevision: latest.revision, sourceType: 'restore' })
      const versionId = 'chapter' in written ? written.chapter.currentVersionId : written.outline.currentVersionId
      // Returning a committed receipt must not depend on filesystem success.
      let mirrorPending = true
      try { mirrorPending = await this.syncPlan(workItemId, database, written.mirror) !== 'synced' } catch { /* committed */ }
      return { previousVersionId: input.baseVersionId, adoptedVersionId: versionId, candidateHash: input.candidateHash,
        reviewManifestHash: input.reviewManifestHash, creationMethod: input.creationMethod, sourceType: 'restore' as const, mirrorPending }
    })
  }

  async previewExternalOutlineMirror(workItemId: string, chapterId: number): Promise<OutlineMirrorRecoveryPreview> {
    if (!Number.isSafeInteger(chapterId) || chapterId < 1) throw new AppError('VALIDATION_ERROR', '章纲编号无效。', { recoverable: true })
    return this.withRecoveryReadOnly(workItemId, async database => {
      if (!database.formalOutlineReady()) throw new AppError('FEATURE_UNAVAILABLE', '当前章纲仍由 Markdown 正式保存，不需要恢复镜像。', { recoverable: true })
      const node = database.formalOutlines().find(item => item.legacyKey === `chapter-${chapterId}`)
      if (!node) throw new AppError('NOT_FOUND', '这份章纲不存在或已归档。', { recoverable: true })
      const baseline = database.textAuthority() === 'files-v1'
        ? database.readableMirrorPlans({ sourceTypes: ['outline_markdown'], sourceVersionId: node.currentVersionId })[0]?.content : node.content
      if (typeof baseline !== 'string') throw new AppError('INVALID_PROJECT_STATE', '章纲历史基线缺失，未返回空稿。', { recoverable: true })
      const externalContent = await this.readManagedText(workItemId, node.mirrorRelativePath)
      if (hash(externalContent) === hash(baseline)) throw new AppError('CONFLICT', '外部文件与已保存版本一致，不需要恢复。', { recoverable: true })
      const token = randomUUID(), expiresAt = Date.now() + mirrorRecoveryLifetimeMs
      this.pruneMirrorRecoveryTokens()
      this.outlineMirrorRecoveryTokens.set(token, { workItemId, chapterId, currentVersionId: node.currentVersionId,
        externalHash: hash(externalContent), externalTitle: node.title, expiresAt })
      return { token, chapterId, sqliteContent: baseline, externalContent, expiresAt: new Date(expiresAt).toISOString() }
    })
  }

  async adoptExternalOutlineMirror(workItemId: string, token: string, beforeCommit?: () => Promise<void>): Promise<OutlineMirrorRecoveryResult> {
    const pending = this.outlineMirrorRecoveryTokens.get(token)
    if (!pending || pending.expiresAt <= Date.now()) {
      this.outlineMirrorRecoveryTokens.delete(token)
      throw new AppError('CONFLICT', '章纲恢复预览已失效，请重新核对两份内容。', { recoverable: true })
    }
    if (pending.workItemId !== workItemId) throw new AppError('CONFLICT', '章纲恢复预览属于另一部作品。', { recoverable: true })
    return this.withFormalOutlineMutation(workItemId, async database => {
      if (this.outlineMirrorRecoveryTokens.get(token) !== pending || pending.expiresAt <= Date.now()) throw new AppError('CONFLICT', '这次章纲恢复已处理或过期，请核对当前版本。', { recoverable: true })
      const node = database.formalOutlines().find(item => item.legacyKey === `chapter-${pending.chapterId}`)
      if (!node || node.currentVersionId !== pending.currentVersionId || node.title !== pending.externalTitle) {
        throw new AppError('CONFLICT', '正式章纲在预览后已经变化，请重新核对。', { recoverable: true })
      }
      const externalContent = await this.readManagedText(workItemId, node.mirrorRelativePath)
      if (hash(externalContent) !== pending.externalHash) throw new AppError('CONFLICT', '外部章纲在预览后已经变化，请重新核对。', { recoverable: true })
      await beforeCommit?.()
      if (pending.expiresAt <= Date.now()) throw new AppError('CONFLICT', '这次章纲恢复预览已过期，请重新核对。', { recoverable: true })
      const write = database.writeFormalOutline({ legacyKey: node.legacyKey, parentLegacyKey: node.parentLegacyKey,
        nodeType: 'chapter', seq: node.seq, title: node.title, content: externalContent, expectedRevision: node.revision, sourceType: 'restore' })
      this.outlineMirrorRecoveryTokens.delete(token)
      const mirrorStatus = await this.syncPlan(workItemId, database, write.mirror)
      const entries = plannedChapterEntries(database.formalOutlines(), new Set(database.formalChapterIds()))
      const entry = entries.find(item => item.chapterId === pending.chapterId)!
      return { outline: { ...entry, content: write.outline.content }, previousOutlineVersionId: pending.currentVersionId,
        importedExternalHash: pending.externalHash, mirrorPending: mirrorStatus !== 'synced' }
    })
  }

  async deleteChapter(workItemId: string, id: number): Promise<{ success: boolean; recovery: 'chapter-trash' }> {
    return this.withFormalMutation(workItemId, async (database) => {
      await this.syncPlan(workItemId, database, database.archiveFormalChapter(id))
      await this.syncPending(workItemId, database, 'all')
      return { success: true, recovery: 'chapter-trash' as const }
    })
  }

  async trashedChapters(workItemId: string): Promise<DeletedChapterSummary[]> {
    return this.withFormalDatabase(workItemId, (database) => database.formalArchivedChapters().map((chapter) => ({
      id: chapter.legacyChapterId,
      position: chapter.position,
      title: chapter.title,
      word_count: chapter.wordCount,
      deletedAt: chapter.deletedAt
    })))
  }

  async restoreChapter(workItemId: string, id: number): Promise<Chapter> {
    return this.withFormalMutation(workItemId, async (database) => {
      const result = database.restoreArchivedFormalChapter(id)
      await this.syncPlan(workItemId, database, result.mirror)
      await this.syncPending(workItemId, database, 'all')
      return toChapter(result.chapter)
    })
  }

  async outlines(workItemId: string): Promise<OutlineList> {
    return this.withFormalOutlineDatabase(workItemId, (database) => {
      const outlines = database.formalOutlines()
      const total = outlines.find((outline) => outline.nodeType === 'summary')
      return {
        total: total ? { content: total.content } : null,
        volumes: outlines.filter((outline) => outline.nodeType === 'volume').map((outline) => ({
          volume: outline.seq,
          title: outline.title,
          content: outline.content
        })),
        stages: outlines.filter((outline) => outline.nodeType === 'stage').map((outline) => stageOutlineView(outline, outlines)),
        chapterOutlines: plannedChapterEntries(outlines, new Set(database.formalChapterIds()))
      }
    })
  }

  async getPlannedChapter(workItemId: string, chapterId: number): Promise<PlannedChapterOutline> {
    if (!Number.isSafeInteger(chapterId) || chapterId < 1) throw new AppError('VALIDATION_ERROR', '章纲编号无效。', { recoverable: true })
    return this.withFormalOutlineDatabase(workItemId, database => {
      const outlines = database.formalOutlines()
      const entry = plannedChapterEntries(outlines, new Set(database.formalChapterIds())).find(item => item.chapterId === chapterId)
      if (!entry) throw new AppError('NOT_FOUND', '这份章纲不存在或已归档。', { recoverable: true })
      return { ...entry, content: outlines.find(node => node.legacyKey === `chapter-${chapterId}`)!.content }
    })
  }

  async startPlannedChapter(workItemId: string, input: PlannedChapterStartInput): Promise<PlannedChapterStartResult> {
    return this.withFormalOutlineMutation(workItemId, async database => {
      const result = database.startChapterFromOutline(input.chapterId, input.expectedRevision)
      // The database has committed; a mirror problem must never cause duplicate chapter creation.
      let mirrorPending = false
      try { await this.syncPending(workItemId, database, 'all') } catch { mirrorPending = true }
      const chapter = database.formalChapters().find(item => item.legacyChapterId === input.chapterId)!
      return { chapter: toChapter(chapter), created: result.created, mirrorPending: mirrorPending || chapter.mirrorStatus !== 'synced' }
    })
  }

  async updatePlannedChapter(workItemId: string, input: PlannedChapterOutlineUpdate): Promise<PlannedChapterOutline> {
    if (!Number.isSafeInteger(input.chapterId) || input.chapterId < 1 || !input.title.trim() || input.title.trim().length > 200
      || typeof input.content !== 'string' || input.content.length > 2_000_000 || !/^[a-f0-9]{64}$/.test(input.expectedRevision)) {
      throw new AppError('VALIDATION_ERROR', '独立章纲保存参数无效。', { recoverable: true })
    }
    return this.withFormalOutlineMutation(workItemId, async database => {
      const outlines = database.formalOutlines()
      const node = outlines.find(item => item.legacyKey === `chapter-${input.chapterId}`)
      if (!node || node.nodeType !== 'chapter') throw new AppError('NOT_FOUND', '章纲已不存在，未创建新节点。', { recoverable: true })
      if (database.formalChapters().some(chapter => chapter.legacyChapterId === input.chapterId)) {
        throw new AppError('CONFLICT', '本章已有正文，请从现有章节入口编辑章纲。', { recoverable: true })
      }
      const result = database.writeFormalOutline({ legacyKey: node.legacyKey, parentLegacyKey: node.parentLegacyKey,
        nodeType: 'chapter', seq: node.seq, title: input.title.trim(), content: input.content,
        expectedRevision: input.expectedRevision, sourceType: 'manual' })
      await this.syncPlan(workItemId, database, result.mirror)
      const updated = database.formalOutlines()
      const entry = plannedChapterEntries(updated, new Set()).find(item => item.chapterId === input.chapterId)!
      return { ...entry, content: result.outline.content }
    })
  }

  async planningOutline(workItemId: string, key: string): Promise<import('../../../../contracts/index').PlanningOutlineSource | null> {
    return this.withFormalOutlineDatabase(workItemId, (database) => {
      const node = database.formalOutlines().find((outline) => outline.legacyKey === key)
      return node ? { projectFingerprint: createHash('sha256').update(workItemId).digest('hex'), key: node.legacyKey, kind: node.nodeType, title: node.title, content: node.content, revision: node.revision } : null
    })
  }

  async createStage(workItemId: string, volume: number, title: string): Promise<StageOutlineUpdateResult> {
    if (!Number.isSafeInteger(volume) || volume < 1) throw new AppError('VALIDATION_ERROR', '阶段所属篇卷无效。', { recoverable: true })
    const normalizedTitle = title.trim()
    if (!normalizedTitle || normalizedTitle.length > 120) throw new AppError('VALIDATION_ERROR', '阶段名称需要 1 到 120 个字符。', { recoverable: true })
    return this.withFormalOutlineMutation(workItemId, async (database) => {
      const outlines = database.formalOutlines()
      if (!outlines.some((outline) => outline.legacyKey === `volume-${volume}`)) throw new AppError('NOT_FOUND', '要归入的篇卷不存在。', { recoverable: true })
      if (outlines.some((outline) => outline.nodeType === 'stage' && outline.parentLegacyKey === `volume-${volume}` && outline.title.normalize('NFKC').toLocaleLowerCase('zh-CN') === normalizedTitle.normalize('NFKC').toLocaleLowerCase('zh-CN'))) {
        throw new AppError('CONFLICT', '本卷已有同名阶段，请换一个名称。', { recoverable: true })
      }
      const stage = Math.max(0, ...outlines.filter((outline) => outline.nodeType === 'stage').map((outline) => outline.seq)) + 1
      if (stage > 10_000) throw new AppError('VALIDATION_ERROR', '阶段数量已达到上限。', { recoverable: true })
      const result = database.writeFormalOutline({
        legacyKey: `stage-${stage}`,
        parentLegacyKey: `volume-${volume}`,
        nodeType: 'stage',
        seq: stage,
        title: normalizedTitle,
        content: '',
        sourceType: 'manual'
      })
      await this.syncPlan(workItemId, database, result.mirror)
      const refreshed = database.formalOutlines()
      return { success: true, stage: stageOutlineView(refreshed.find((item) => item.legacyKey === `stage-${stage}`)!, refreshed), storageMode: 'sqlite' }
    })
  }

  async updateStage(workItemId: string, stage: number, title: string, content: string): Promise<StageOutlineUpdateResult> {
    if (!Number.isSafeInteger(stage) || stage < 1) throw new AppError('VALIDATION_ERROR', '阶段编号无效。', { recoverable: true })
    const normalizedTitle = title.trim()
    if (!normalizedTitle || normalizedTitle.length > 120) throw new AppError('VALIDATION_ERROR', '阶段名称需要 1 到 120 个字符。', { recoverable: true })
    return this.withFormalOutlineMutation(workItemId, async (database) => {
      const outlines = database.formalOutlines()
      const current = outlines.find((outline) => outline.legacyKey === `stage-${stage}` && outline.nodeType === 'stage')
      if (!current || !current.parentLegacyKey?.startsWith('volume-')) throw new AppError('NOT_FOUND', '要编辑的阶段不存在。', { recoverable: true })
      if (outlines.some((outline) => outline.nodeType === 'stage' && outline.legacyKey !== current.legacyKey && outline.parentLegacyKey === current.parentLegacyKey && outline.title.normalize('NFKC').toLocaleLowerCase('zh-CN') === normalizedTitle.normalize('NFKC').toLocaleLowerCase('zh-CN'))) {
        throw new AppError('CONFLICT', '本卷已有同名阶段，请换一个名称。', { recoverable: true })
      }
      const result = database.writeFormalOutline({
        legacyKey: current.legacyKey,
        parentLegacyKey: current.parentLegacyKey,
        nodeType: 'stage',
        seq: current.seq,
        title: normalizedTitle,
        content,
        expectedRevision: current.revision,
        sourceType: 'manual'
      })
      await this.syncPlan(workItemId, database, result.mirror)
      const refreshed = database.formalOutlines()
      return { success: true, stage: stageOutlineView(refreshed.find((item) => item.legacyKey === current.legacyKey)!, refreshed), storageMode: 'sqlite' }
    })
  }

  async placeChapterInStage(workItemId: string, chapterId: number, stage: number | null, volume: number | null): Promise<StageOutlineUpdateResult | { success: true; stage: null; storageMode: 'sqlite' }> {
    if (!Number.isSafeInteger(chapterId) || chapterId < 1) throw new AppError('VALIDATION_ERROR', '章节编号无效。', { recoverable: true })
    if (stage !== null && (!Number.isSafeInteger(stage) || stage < 1)) throw new AppError('VALIDATION_ERROR', '阶段编号无效。', { recoverable: true })
    if (volume !== null && (!Number.isSafeInteger(volume) || volume < 1)) throw new AppError('VALIDATION_ERROR', '篇卷编号无效。', { recoverable: true })
    return this.withFormalOutlineMutation(workItemId, async (database) => {
      const outlines = database.formalOutlines()
      const current = outlines.find((outline) => outline.legacyKey === `chapter-${chapterId}` && outline.nodeType === 'chapter')
      if (!current) throw new AppError('CONFLICT', '请先保存本章章纲，再安排所属阶段。', { recoverable: true })
      const targetStage = stage === null ? undefined : outlines.find((outline) => outline.legacyKey === `stage-${stage}` && outline.nodeType === 'stage')
      if (stage !== null && !targetStage) throw new AppError('NOT_FOUND', '要归入的阶段不存在。', { recoverable: true })
      const targetVolume = targetStage ? Number(targetStage.parentLegacyKey?.slice(7)) : volume
      if (!targetVolume || !outlines.some((outline) => outline.legacyKey === `volume-${targetVolume}`)) throw new AppError('CONFLICT', '请先把本章归入一个篇卷。', { recoverable: true })
      if (volume !== null && targetStage && targetVolume !== volume) throw new AppError('CONFLICT', '所选阶段不属于当前篇卷。', { recoverable: true })
      const result = database.writeFormalOutline({
        legacyKey: current.legacyKey,
        parentLegacyKey: targetStage?.legacyKey ?? `volume-${targetVolume}`,
        nodeType: 'chapter',
        seq: current.seq,
        title: current.title,
        content: current.content,
        expectedRevision: current.revision,
        sourceType: 'manual'
      })
      await this.syncPlan(workItemId, database, result.mirror)
      if (!targetStage) return { success: true, stage: null, storageMode: 'sqlite' }
      const refreshed = database.formalOutlines()
      return { success: true, stage: stageOutlineView(refreshed.find((item) => item.legacyKey === targetStage.legacyKey)!, refreshed), storageMode: 'sqlite' }
    })
  }

  async chapterOutlines(workItemId: string): Promise<Array<{ chapterId: number; content: string }>> {
    return this.withFormalOutlineDatabase(workItemId, (database) => database.formalOutlines()
      .filter((outline) => outline.nodeType === 'chapter')
      .map((outline) => ({ chapterId: outline.seq, content: outline.content })))
  }

  async updateOutline(workItemId: string, volume: OutlineVolume, content: string): Promise<OutlineUpdateResult> {
    return this.withFormalOutlineMutation(workItemId, async (database) => {
      const outlines = database.formalOutlines()
      const legacyKey = volume === 'total' ? 'total' : `volume-${volume}`
      const current = outlines.find((outline) => outline.legacyKey === legacyKey)
      const result = database.writeFormalOutline({
        legacyKey,
        ...(volume !== 'total' && outlines.some((outline) => outline.legacyKey === 'total') ? { parentLegacyKey: 'total' } : {}),
        nodeType: volume === 'total' ? 'summary' : 'volume',
        seq: volume === 'total' ? 1 : volume,
        title: current?.title ?? (volume === 'total' ? '总纲' : `第${volume}卷-大纲`),
        content,
        expectedRevision: current?.revision,
        sourceType: 'manual'
      })
      await this.syncPlan(workItemId, database, result.mirror)
      return { success: true, volume, content: result.outline.content, storageMode: 'sqlite', mirrorStatus: database.formalOutlines().find((outline) => outline.legacyKey === legacyKey)?.mirrorStatus ?? result.outline.mirrorStatus }
    })
  }

  async updateChapterOutline(workItemId: string, chapterId: number, content: string, plannedVolume?: number): Promise<ChapterOutlineDocument> {
    if (!Number.isSafeInteger(chapterId) || chapterId < 1) throw new AppError('VALIDATION_ERROR', '章节编号无效。', { recoverable: true })
    if (plannedVolume !== undefined && (!Number.isSafeInteger(plannedVolume) || plannedVolume < 1 || plannedVolume > 1000)) {
      throw new AppError('VALIDATION_ERROR', '篇卷编号无效。', { recoverable: true })
    }
    return this.withFormalOutlineMutation(workItemId, async (database) => {
      const current = database.formalOutlines().find((outline) => outline.legacyKey === `chapter-${chapterId}`)
      if (!current && plannedVolume === undefined) throw new AppError('VALIDATION_ERROR', '请先在谋篇中为本章选择所属篇卷，再保存章纲。正文不受影响。', { recoverable: true })
      const result = database.writeFormalOutline({
        legacyKey: `chapter-${chapterId}`,
        ...(!current ? { parentLegacyKey: `volume-${plannedVolume}` } : {}),
        nodeType: 'chapter',
        seq: chapterId,
        title: current?.title ?? `第${chapterId}章章纲`,
        content,
        expectedRevision: current?.revision,
        sourceType: 'manual'
      })
      await this.syncPlan(workItemId, database, result.mirror)
      return { chapterId, content: result.outline.content, storageMode: 'sqlite', mirrorStatus: database.formalOutlines().find((outline) => outline.legacyKey === `chapter-${chapterId}`)?.mirrorStatus ?? result.outline.mirrorStatus }
    })
  }

  async activate(workItemId: string, snapshot: LegacyWorkspaceSnapshot): Promise<SqliteActivationResult> {
    return this.writes.run(workItemId, async () => {
      const database = await this.databases.openExisting(workItemId)
      if (!database) throw new AppError('NOT_FOUND', '尚未建立可切换的 SQLite 影子副本。', { recoverable: true })
      try {
        const legacyWritingConfig = await this.readLegacyProjectWritingConfig(workItemId)
        database.activateSqlite(snapshot)
        await this.importLegacyProjectWritingConfig(workItemId, database, legacyWritingConfig)
        await this.syncPending(workItemId, database, 'all')
        const pending = database.pendingMirrorPlans()
        const outlines = database.formalOutlineReady() ? database.formalOutlines() : []
        const promptMirror = database.formalPromptReady() ? database.formalPromptMirror() : null
        const foundationMirror = database.foundationMirror()
        const ideasMirror = database.ideasMirror()
        const materialSourcesMirror = database.formalMaterialSourcesReady() ? database.materialSourcesMirror() : null
        const canonicalEventsMirror = database.formalCanonicalEventsReady() ? database.canonicalEventsMirror() : null
        return {
          storageMode: 'sqlite',
          chapterCount: database.formalChapters().length,
          pendingMirrors: pending.filter((plan) => plan.action === 'write').length,
          conflicts: [...database.formalChapters(), ...outlines].filter((item) => item.mirrorStatus === 'conflict').length + (promptMirror?.status === 'conflict' ? 1 : 0) + (foundationMirror?.status === 'conflict' ? 1 : 0) + (ideasMirror?.status === 'conflict' ? 1 : 0) + (materialSourcesMirror?.status === 'conflict' ? 1 : 0) + (canonicalEventsMirror?.status === 'conflict' ? 1 : 0),
          verified: true
        }
      } finally {
        database.close()
      }
    })
  }

  private async readLegacyProjectWritingConfig(workItemId: string): Promise<{ profile: Record<string, unknown> | null; foundation: WorkspaceFoundationConfig | null; foundationObservedHash?: string }> {
    const profileFile = await this.readOptionalConfigRecord(workItemId, '.webnovel/config/book-profile.json', '作品定义')
    const foundationFile = await this.readOptionalConfigRecord(workItemId, '.webnovel/config/foundation.json', '创作基础')
    const foundation = foundationFile ? normalizeFoundationConfig(foundationFile.record) : null
    return { profile: profileFile?.record ?? null, foundation, ...(foundationFile ? { foundationObservedHash: foundationFile.contentHash } : {}) }
  }

  private async importLegacyProjectWritingConfig(
    workItemId: string,
    database: WorkspaceDatabasePort,
    legacy: { profile: Record<string, unknown> | null; foundation: WorkspaceFoundationConfig | null; foundationObservedHash?: string }
  ): Promise<void> {
    const { profile, foundation, foundationObservedHash } = legacy
    const optionalPositiveInteger = (value: unknown): number | null => Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null
    const optionalText = (value: unknown): string => typeof value === 'string' ? value.trim() : ''
    if (profile) {
      const result = database.updateProjectWritingConfig({
        targetWords: optionalPositiveInteger(profile.targetWords),
        genreText: optionalText(profile.genre),
        audienceScale: optionalText(profile.audienceScale),
        defaultPov: optionalText(profile.defaultPov),
        writingStyle: optionalText(profile.writingStyle),
        chapterTargetWords: optionalPositiveInteger(profile.targetWordsPerChapter),
        configJson: JSON.stringify(profile)
      })
      await this.syncPlan(workItemId, database, result.mirror)
    }
    if (foundation) {
      const result = database.writeFoundationConfig(foundation, foundationObservedHash)
      for (const mirror of result.mirrors) await this.syncPlan(workItemId, database, mirror)
    }
  }

  private async readOptionalConfigRecord(workItemId: string, relativePath: string, label: string): Promise<{ record: Record<string, unknown>; contentHash: string } | null> {
    const path = await this.targetManagedPath(workItemId, relativePath)
    let content: string
    let parsed: unknown
    try {
      content = await readFile(await projectExistingPath(workItemId, path), 'utf8')
      parsed = JSON.parse(content)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      if (error instanceof SyntaxError) throw new AppError('INVALID_PROJECT_STATE', `${label} JSON 已损坏；SQLite 切换已暂停，原文件没有被覆盖。`, { recoverable: true })
      throw error
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new AppError('INVALID_PROJECT_STATE', `${label} JSON 结构无效；SQLite 切换已暂停，原文件没有被覆盖。`, { recoverable: true })
    }
    return { record: parsed as Record<string, unknown>, contentHash: hash(content) }
  }

  private async ensurePromptProfileReady(workItemId: string, database: WorkspaceDatabasePort, defaultProfileWorkItemId: string): Promise<void> {
    if (database.formalPromptReady()) return
    const relativePath = '.webnovel/config/prompt-profile.json' as const
    const path = await this.targetManagedPath(workItemId, relativePath)
    let input: LegacyWorkspacePromptProfile = { version: 1, workItemId: defaultProfileWorkItemId, genreFingerprint: '', overrides: {}, updatedAt: '', mirror: null }
    try {
      const content = await readFile(await projectExistingPath(workItemId, path), 'utf8')
      let parsed: unknown
      try { parsed = JSON.parse(content) }
      catch { throw new AppError('INVALID_PROJECT_STATE', '本书提示词 JSON 镜像已损坏；SQLite 升级已暂停，文件没有被覆盖。', { recoverable: true }) }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AppError('INVALID_PROJECT_STATE', '本书提示词 JSON 镜像结构无效；SQLite 升级已暂停。', { recoverable: true })
      const record = parsed as Record<string, unknown>
      if (record.version !== 1 || record.workItemId !== defaultProfileWorkItemId || typeof record.genreFingerprint !== 'string'
        || !record.overrides || typeof record.overrides !== 'object' || Array.isArray(record.overrides)) {
        throw new AppError('INVALID_PROJECT_STATE', '本书提示词 JSON 镜像不属于当前作品或结构无效；SQLite 升级已暂停。', { recoverable: true })
      }
      const tasks = new Set(['outline', 'chapterOutline', 'prose', 'review'])
      const overrides: LegacyWorkspacePromptProfile['overrides'] = {}
      for (const [task, value] of Object.entries(record.overrides as Record<string, unknown>)) {
        if (!tasks.has(task) || typeof value !== 'string' || !value.trim() || value.length > 50_000) throw new AppError('INVALID_PROJECT_STATE', '本书提示词 JSON 镜像包含无效内容；SQLite 升级已暂停。', { recoverable: true })
        overrides[task as keyof LegacyWorkspacePromptProfile['overrides']] = value.trim()
      }
      const contentHash = hash(content)
      input = {
        version: 1, workItemId: defaultProfileWorkItemId, genreFingerprint: record.genreFingerprint, overrides,
        updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
        mirror: { relativePath, content, contentHash, observedHash: contentHash }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const mirror = database.importPromptProfile(input)
    if (mirror) await this.syncPlan(workItemId, database, mirror)
  }

  async retryMirrors(workItemId: string): Promise<{ pending: number; conflicts: number; failed: number }> {
    return this.withFormalMutation(workItemId, async (database) => {
      await this.syncPending(workItemId, database, 'all')
      const pendingPlans = database.pendingMirrorPlans(database.textAuthority() === 'files-v1'
        ? { excludeSourceTypes: ['chapter_markdown', 'outline_markdown'] } : undefined)
      return {
        pending: pendingPlans.length,
        conflicts: pendingPlans.filter((plan) => plan.status === 'conflict').length,
        failed: pendingPlans.filter((plan) => plan.status === 'failed').length
      }
    })
  }

  async rebuildReadableMirrors(workItemId: string): Promise<ReadableMirrorRebuildResult> {
    return this.withFormalMutation(workItemId, async (database) => {
      await this.syncPending(workItemId, database, 'all')
      const plans = database.readableMirrorPlans(database.textAuthority() === 'files-v1'
        ? { excludeSourceTypes: ['chapter_markdown', 'outline_markdown'] } : undefined).filter((plan) => plan.action === 'write')
      const result: ReadableMirrorRebuildResult = { checked: plans.length, recreated: 0, upToDate: 0, conflicts: 0, failed: 0 }
      for (const plan of plans) {
        let previousHash: string | null | undefined
        try { previousHash = await this.readManagedHash(workItemId, plan.relativePath) } catch { previousHash = undefined }
        const status = await this.syncPlan(workItemId, database, plan)
        if (status === 'conflict') result.conflicts += 1
        else if (status === 'failed') result.failed += 1
        else if (previousHash === null) result.recreated += 1
        else result.upToDate += 1
      }
      return result
    })
  }

  async rollback(workItemId: string): Promise<SqliteRollbackResult> {
    return this.withFormalMutation(workItemId, async (database) => {
      if (database.textAuthority() === 'files-v1') throw new AppError('CONFLICT', '正文已经直接保存为文件；不能停用仍管理版本与资料关系的数据库。', { recoverable: true })
      await this.syncPending(workItemId, database, 'all')
      database.assertRollbackReady()
      const chapters = database.formalChapters()
      for (const chapter of chapters) {
        const observed = await this.readManagedHash(workItemId, chapter.mirrorRelativePath)
        if (observed !== chapter.contentHash) throw new AppError('CONFLICT', `第 ${chapter.position} 章的 Markdown 镜像与 SQLite 不一致，不能安全退回文件模式。`, { recoverable: true })
      }
      await this.assertChapterInventory(workItemId, chapters.map((chapter) => chapter.mirrorRelativePath))
      if (database.formalOutlineReady()) {
        const outlines = database.formalOutlines()
        for (const outline of outlines) {
          const observed = await this.readManagedHash(workItemId, outline.mirrorRelativePath)
          if (observed !== outline.contentHash) throw new AppError('CONFLICT', `${outline.title}的 Markdown 镜像与 SQLite 不一致，不能安全退回文件模式。`, { recoverable: true })
        }
        await this.assertOutlineInventory(workItemId, outlines.map((outline) => outline.mirrorRelativePath))
      }
      if (database.formalPromptReady()) {
        const promptMirror = database.formalPromptMirror()
        if (promptMirror) {
          const observed = await this.readManagedHash(workItemId, promptMirror.relativePath)
          if (observed !== promptMirror.contentHash) throw new AppError('CONFLICT', '提示词 JSON 镜像与 SQLite 不一致，不能安全退回文件模式。', { recoverable: true })
        }
      }
      const foundationMirror = database.foundationMirror()
      if (foundationMirror) {
        const observed = await this.readManagedHash(workItemId, foundationMirror.relativePath)
        if (observed !== foundationMirror.contentHash) throw new AppError('CONFLICT', '创作基础 JSON 镜像与 SQLite 不一致，不能安全退回文件模式。', { recoverable: true })
      }
      const ideasMirror = database.ideasMirror()
      if (ideasMirror) {
        const observed = await this.readManagedHash(workItemId, ideasMirror.relativePath)
        if (observed !== ideasMirror.contentHash) throw new AppError('CONFLICT', '灵感 JSON 镜像与 SQLite 不一致，不能安全退回文件模式。', { recoverable: true })
      }
      if (database.formalMaterialSourcesReady()) {
        const materialSourcesMirror = database.materialSourcesMirror()
        if (materialSourcesMirror) {
          const observed = await this.readManagedHash(workItemId, materialSourcesMirror.relativePath)
          if (observed !== materialSourcesMirror.contentHash) throw new AppError('CONFLICT', '素材资料 JSON 镜像与 SQLite 不一致，不能安全退回文件模式。', { recoverable: true })
        }
      }
      if (database.formalCanonicalEventsReady()) {
        const canonicalEventsMirror = database.canonicalEventsMirror()
        if (canonicalEventsMirror) {
          const observed = await this.readManagedHash(workItemId, canonicalEventsMirror.relativePath)
          if (observed !== canonicalEventsMirror.contentHash) throw new AppError('CONFLICT', '正式事件 JSON 镜像与 SQLite 不一致，不能安全退回文件模式。', { recoverable: true })
        }
      }
      const orderContent = `${JSON.stringify({ version: 1, chapterIds: chapters.map((chapter) => chapter.legacyChapterId) }, null, 2)}\n`
      const orderHash = await this.readManagedHash(workItemId, '.webnovel/manuscript/chapter-order.json')
      if (orderHash !== hash(orderContent)) throw new AppError('CONFLICT', '章节顺序镜像与 SQLite 不一致，不能安全退回文件模式。', { recoverable: true })
      const revision = database.formalManuscriptRevision()
      database.deactivateSqlite(revision)
      return { storageMode: 'shadow', chapterCount: chapters.length, verified: true }
    })
  }

  private async withRecoveryReadOnly<T>(workItemId: string, operation: (database: WorkspaceRecoveryReadPort) => T | Promise<T>): Promise<T> {
    if (!this.databases.openRecoveryReadOnly) throw new AppError('FEATURE_UNAVAILABLE', '当前存储适配器不支持只读恢复预览。', { recoverable: true })
    const database = await this.databases.openRecoveryReadOnly(workItemId)
    if (!database) throw new AppError('FEATURE_UNAVAILABLE', '当前作品未启用 SQLite 镜像恢复。', { recoverable: true })
    try {
      if (database.storageMode() !== 'sqlite') throw new AppError('FEATURE_UNAVAILABLE', '当前作品仍由 Markdown 正式保存，不需要执行镜像恢复。', { recoverable: true })
      return await operation(database)
    } finally { database.close() }
  }

  private async withEventReadOnly<T>(workItemId: string, operation: (database: WorkspaceEventReadPort | null) => T): Promise<T> {
    if (!this.databases.openEventReadOnly) {
      throw new AppError('FEATURE_UNAVAILABLE', '只读事件核对暂不可用，未尝试导入或修改数据。', { recoverable: true })
    }
    // Byte-copy acquisition must not race our own imports/checkpoints. This lane
    // grants no write capability: only the read facade reaches the callback.
    return this.writes.run(workItemId, async () => {
      const database = await this.databases.openEventReadOnly!(workItemId)
      try { return operation(database) } finally { database?.close() }
    })
  }

  private async withFormalDatabase<T>(workItemId: string, operation: (database: WorkspaceDatabasePort) => T | Promise<T>): Promise<T> {
    const database = await this.databases.openExisting(workItemId)
    if (!database || database.storageMode() !== 'sqlite') {
      database?.close()
      throw new AppError('CONFLICT', '作品尚未切换为 SQLite 正式数据。', { recoverable: true })
    }
    try { return await operation(database) } finally { database.close() }
  }

  private async withFormalMutation<T>(workItemId: string, operation: (database: WorkspaceDatabasePort) => T | Promise<T>): Promise<T> {
    return this.writes.run(workItemId, () => this.withFormalDatabase(workItemId, database => {
      database.recoverManuscriptCommits()
      return operation(database)
    }))
  }

  private async withFormalOutlineDatabase<T>(workItemId: string, operation: (database: WorkspaceDatabasePort) => T | Promise<T>): Promise<T> {
    return this.withFormalDatabase(workItemId, (database) => {
      if (!database.formalOutlineReady()) throw new AppError('FEATURE_UNAVAILABLE', '这部作品的大纲尚未迁入 SQLite，仍由 Markdown 保存。', { recoverable: true })
      return operation(database)
    })
  }

  private async withFormalOutlineMutation<T>(workItemId: string, operation: (database: WorkspaceDatabasePort) => T | Promise<T>): Promise<T> {
    return this.writes.run(workItemId, () => this.withFormalOutlineDatabase(workItemId, database => {
      database.recoverManuscriptCommits()
      return operation(database)
    }))
  }

  private async syncPending(workItemId: string, database: WorkspaceDatabasePort, scope: MirrorSyncScope): Promise<void> {
    const filter = {
      ...(scope === 'all' ? {} : { sourceTypes: scope.sourceTypes, ...(scope.sourceId !== undefined ? { sourceId: scope.sourceId } : {}) }),
      ...(database.textAuthority() === 'files-v1' ? { excludeSourceTypes: ['chapter_markdown', 'outline_markdown'] as const } : {})
    }
    for (const plan of database.pendingMirrorPlans(filter)) {
      await this.syncPlan(workItemId, database, plan)
    }
  }

  private async detectSyncedChapterMirrorDrift(workItemId: string, database: WorkspaceDatabasePort): Promise<void> {
    if (database.textAuthority() === 'files-v1') return
    const plans = database.readableMirrorPlans({ sourceTypes: ['chapter_markdown'], statuses: ['synced'] }).filter((plan) => plan.action === 'write')
    for (const plan of plans) {
      const observedHash = await this.readManagedHash(workItemId, plan.relativePath)
      if (observedHash === null) {
        // A missing readable copy can be recreated safely from SQLite.
        await this.syncPlan(workItemId, database, plan)
      } else if (observedHash !== plan.contentHash) {
        database.acknowledgeMirror(plan, 'conflict', observedHash, 'MIRROR_EXTERNAL_CHANGE')
      }
    }
  }

  private async detectMaterialSourcesMirrorDrift(workItemId: string, database: WorkspaceDatabasePort): Promise<void> {
    const plan = database.readableMirrorPlans({ sourceTypes: ['material_sources_json'] }).find((item) => item.action === 'write')
    if (!plan) throw new AppError('DATABASE_INTEGRITY_FAILED', '素材资料缺少可读 JSON 镜像记录。', { recoverable: false })
    if (plan.status !== 'synced') throw new AppError('CONFLICT', '素材资料 JSON 镜像尚未同步，请先在项目数据设置中重试。', { recoverable: true })
    const observedHash = await this.readManagedHash(workItemId, plan.relativePath)
    if (observedHash === null) {
      await this.syncPlan(workItemId, database, plan)
      return
    }
    if (observedHash !== plan.contentHash) {
      database.acknowledgeMirror(plan, 'conflict', observedHash, 'MIRROR_EXTERNAL_CHANGE')
      throw new AppError('CONFLICT', '素材资料 JSON 被外部修改；SQLite 与原文件都已保留，应用没有覆盖它。', { recoverable: true })
    }
  }

  private async detectCanonicalEventsMirrorDrift(workItemId: string, database: WorkspaceDatabasePort): Promise<void> {
    const plan = database.readableMirrorPlans({ sourceTypes: ['canonical_events_json'] }).find((item) => item.action === 'write')
    if (!plan) throw new AppError('DATABASE_INTEGRITY_FAILED', '正式事件缺少可读 JSON 镜像记录。', { recoverable: false })
    if (plan.status !== 'synced') throw new AppError('CONFLICT', '正式事件 JSON 镜像尚未同步，请先在项目数据设置中重试。', { recoverable: true })
    const observedHash = await this.readManagedHash(workItemId, plan.relativePath)
    if (observedHash === null) {
      await this.syncPlan(workItemId, database, plan)
      return
    }
    if (observedHash !== plan.contentHash) {
      database.acknowledgeMirror(plan, 'conflict', observedHash, 'MIRROR_EXTERNAL_CHANGE')
      throw new AppError('CONFLICT', '正式事件 JSON 被外部修改；SQLite 与原文件都已保留，应用没有覆盖它。', { recoverable: true })
    }
  }

  private async detectCharacterStateMirrorDrift(workItemId: string, database: WorkspaceDatabasePort): Promise<void> {
    const plan = database.readableMirrorPlans({ sourceTypes: ['character_state_json'] }).find((item) => item.action === 'write')
    if (!plan) throw new AppError('DATABASE_INTEGRITY_FAILED', '人物状态缺少可读 JSON 镜像记录。', { recoverable: false })
    if (plan.status !== 'synced') throw new AppError('CONFLICT', '人物状态 JSON 镜像尚未同步，请先在项目数据设置中重试。', { recoverable: true })
    const observedHash = await this.readManagedHash(workItemId, plan.relativePath)
    if (observedHash === null) {
      await this.syncPlan(workItemId, database, plan)
      return
    }
    if (observedHash !== plan.contentHash) {
      database.acknowledgeMirror(plan, 'conflict', observedHash, 'MIRROR_EXTERNAL_CHANGE')
      throw new AppError('CONFLICT', '人物状态 JSON 被外部修改；SQLite 与原文件都已保留，应用没有覆盖它。', { recoverable: true })
    }
  }

  private async detectOutlinePlanningStateMirrorDrift(workItemId: string, database: WorkspaceDatabasePort): Promise<void> {
    const plan = database.readableMirrorPlans({ sourceTypes: ['outline_planning_state_json'] }).find((item) => item.action === 'write')
    if (!plan) throw new AppError('DATABASE_INTEGRITY_FAILED', '谋篇工作流缺少可读 JSON 镜像记录。', { recoverable: false })
    if (plan.status !== 'synced') throw new AppError('CONFLICT', '谋篇工作流 JSON 镜像尚未同步，请先在项目数据设置中重试。', { recoverable: true })
    const observedHash = await this.readManagedHash(workItemId, plan.relativePath)
    if (observedHash === null) {
      await this.syncPlan(workItemId, database, plan)
      return
    }
    if (observedHash !== plan.contentHash) {
      database.acknowledgeMirror(plan, 'conflict', observedHash, 'MIRROR_EXTERNAL_CHANGE')
      throw new AppError('CONFLICT', '谋篇工作流 JSON 被外部修改；SQLite 与原文件都已保留，应用没有覆盖它。', { recoverable: true })
    }
  }

  private async detectAiSettingsMirrorDrift(workItemId: string, database: WorkspaceDatabasePort): Promise<void> {
    const plan = database.readableMirrorPlans({ sourceTypes: ['ai_settings_json'] }).find((item) => item.action === 'write')
    if (!plan) throw new AppError('DATABASE_INTEGRITY_FAILED', 'AI 模型配置缺少可读 JSON 镜像记录。', { recoverable: false })
    if (plan.status !== 'synced') throw new AppError('CONFLICT', 'AI 模型配置 JSON 镜像尚未同步，请先在项目数据设置中重试。', { recoverable: true })
    const observedHash = await this.readManagedHash(workItemId, plan.relativePath)
    if (observedHash === null) {
      await this.syncPlan(workItemId, database, plan)
      return
    }
    if (observedHash !== plan.contentHash) {
      database.acknowledgeMirror(plan, 'conflict', observedHash, 'MIRROR_EXTERNAL_CHANGE')
      throw new AppError('CONFLICT', 'AI 模型配置 JSON 被外部修改；SQLite 与原文件都已保留，应用没有覆盖它。', { recoverable: true })
    }
  }

  private async detectWorkspaceConfigMirrorDrift(workItemId: string, database: WorkspaceDatabasePort, kind: WorkspaceConfigDocumentKind): Promise<void> {
    const plan = database.readableMirrorPlans({ sourceTypes: ['workspace_config_json'], sourceId: kind }).find((item) => item.action === 'write')
    if (!plan) throw new AppError('DATABASE_INTEGRITY_FAILED', `${workspaceConfigDisplayName(kind)}缺少可读 JSON 镜像记录。`, { recoverable: false })
    if (plan.status !== 'synced') throw new AppError('CONFLICT', `${workspaceConfigDisplayName(kind)} JSON 镜像尚未同步，请先在项目数据设置中重试。`, { recoverable: true })
    const observedHash = await this.readManagedHash(workItemId, plan.relativePath)
    if (observedHash === null) {
      await this.syncPlan(workItemId, database, plan)
      return
    }
    if (observedHash !== plan.contentHash) {
      database.acknowledgeMirror(plan, 'conflict', observedHash, 'MIRROR_EXTERNAL_CHANGE')
      throw new AppError('CONFLICT', `${workspaceConfigDisplayName(kind)} JSON 被外部修改；SQLite 与原文件都已保留，应用没有覆盖它。`, { recoverable: true })
    }
  }

  private async syncPlan(workItemId: string, database: WorkspaceDatabasePort, plan: WorkspaceMirrorPlan, guard?: ModelRequestGuard): Promise<WorkspaceMirrorStatus> {
    if (database.textAuthority() === 'files-v1' && ['chapter_markdown', 'outline_markdown'].includes(plan.sourceType)) {
      await guard?.recheck()
      guard?.assertActive()
      const actual = await this.readManagedHash(workItemId, plan.relativePath)
      if (actual !== (plan.action === 'delete' ? null : plan.contentHash)) {
        throw new AppError('CONFLICT', '当前稿件文件已变化或缺失，未从数据库或历史覆盖它。', { recoverable: true })
      }
      return 'synced'
    }
    let conflictingObservedHash: string | undefined
    let guardFailed = false
    const checkGuard = async () => {
      try { await guard?.recheck() }
      catch (error) { guardFailed = true; throw error }
    }
    const assertActive = () => {
      try { guard?.assertActive() }
      catch (error) { guardFailed = true; throw error }
    }
    try {
      if (guard) await checkGuard()
      if (plan.action === 'delete') {
        const relativePath = plan.previousRelativePath ?? plan.relativePath
        const existingHash = await this.readManagedHash(workItemId, relativePath)
        if (existingHash === null) {
          database.acknowledgeMirror(plan, 'synced')
          return 'synced'
        }
        if (plan.previousObservedHash && existingHash !== plan.previousObservedHash) {
          conflictingObservedHash = existingHash
          throw mirrorConflict()
        }
        await this.trash.trashItem(await this.existingManagedPath(workItemId, relativePath))
        database.acknowledgeMirror(plan, 'synced')
        return 'synced'
      }

      const target = await this.targetManagedPath(workItemId, plan.relativePath)
      const previousRelativePath = plan.previousRelativePath
      const targetHash = await this.readManagedHash(workItemId, plan.relativePath)
      if (previousRelativePath === plan.relativePath && targetHash === plan.contentHash) {
        if (guard) await checkGuard()
        database.acknowledgeMirror(plan, 'synced', plan.contentHash)
        return 'synced'
      }
      if (previousRelativePath) {
        const previousHash = await this.readManagedHash(workItemId, previousRelativePath)
        if (previousHash !== null && plan.previousObservedHash && previousHash !== plan.previousObservedHash) {
          conflictingObservedHash = previousHash
          throw mirrorConflict()
        }
        if (previousHash !== null && !plan.previousObservedHash && previousHash !== plan.contentHash) {
          conflictingObservedHash = previousHash
          throw mirrorConflict()
        }
      }
      if (targetHash !== null && plan.relativePath !== previousRelativePath && targetHash !== plan.contentHash) {
        conflictingObservedHash = targetHash
        throw mirrorConflict()
      }
      await mkdir(dirname(target), { recursive: true })
      if (targetHash !== plan.contentHash) await atomicWriteText(target, plan.content, guard ? async () => {
        await checkGuard()
        const latestHash = await this.readManagedHash(workItemId, plan.relativePath)
        if (latestHash !== targetHash) {
          conflictingObservedHash = latestHash ?? undefined
          throw mirrorConflict()
        }
      } : undefined, guard ? assertActive : undefined)
      if (previousRelativePath && previousRelativePath !== plan.relativePath) {
        const previous = await this.targetManagedPath(workItemId, previousRelativePath)
        await unlink(previous).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        })
      }
      if (guard) await checkGuard()
      database.acknowledgeMirror(plan, 'synced', plan.contentHash)
      return 'synced'
    } catch (error) {
      if (guardFailed) return 'pending'
      if (error instanceof AppError && error.code === 'CONFLICT') {
        database.acknowledgeMirror(plan, 'conflict', conflictingObservedHash ?? plan.previousObservedHash ?? undefined, 'MIRROR_EXTERNAL_CHANGE')
        return 'conflict'
      }
      database.acknowledgeMirror(plan, 'failed', plan.previousObservedHash ?? undefined, 'MIRROR_WRITE_FAILED')
      return 'failed'
    }
  }

  private async readManagedHash(workItemId: string, relativePath: string): Promise<string | null> {
    const target = await this.targetManagedPath(workItemId, relativePath)
    try {
      const path = await projectExistingPath(workItemId, target)
      return hash(await readFile(path))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private async readManagedText(workItemId: string, relativePath: string): Promise<string> {
    const target = await this.targetManagedPath(workItemId, relativePath)
    let content: string
    try { content = await readFile(await projectExistingPath(workItemId, target), 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AppError('NOT_FOUND', 'Markdown 正文文件不存在，无法从外部文件恢复。', { recoverable: true })
      throw error
    }
    if (content.includes('\u0000') || content.length > maximumMirrorBodyLength) {
      throw new AppError('VALIDATION_ERROR', 'Markdown 正文格式异常或内容过大，未导入 SQLite。', { recoverable: true })
    }
    return content
  }

  private pruneMirrorRecoveryTokens(): void {
    const now = Date.now()
    for (const [token, value] of this.mirrorRecoveryTokens) if (value.expiresAt <= now) this.mirrorRecoveryTokens.delete(token)
    for (const [token, value] of this.outlineMirrorRecoveryTokens) if (value.expiresAt <= now) this.outlineMirrorRecoveryTokens.delete(token)
  }

  private async targetManagedPath(workItemId: string, relativePath: string): Promise<string> {
    if (!relativePath || relativePath.includes('\\') || relativePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new AppError('PATH_ESCAPE', '可读镜像路径无效。', { recoverable: false })
    }
    return projectDirectory(workItemId, join(workItemId, ...relativePath.split('/')))
  }

  private async existingManagedPath(workItemId: string, relativePath: string): Promise<string> {
    return projectExistingPath(workItemId, await this.targetManagedPath(workItemId, relativePath))
  }

  private async assertChapterInventory(workItemId: string, expectedRelativePaths: string[]): Promise<void> {
    const manuscriptRoot = await projectDirectory(workItemId, join(workItemId, '正文'))
    let files: string[] = []
    try { files = await readdir(manuscriptRoot) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const actual = files
      .filter((file) => Boolean(parseChapterFileName(file)))
      .map((file) => `正文/${file}`)
      .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    const expected = [...expectedRelativePaths].sort((left, right) => left.localeCompare(right, 'zh-CN'))
    if (actual.length !== expected.length || actual.some((path, index) => path !== expected[index])) {
      throw new AppError('CONFLICT', '正文文件夹中存在未纳入 SQLite 的章节文件，不能安全退回文件模式。', { recoverable: true })
    }
  }

  private async assertOutlineInventory(workItemId: string, expectedRelativePaths: string[]): Promise<void> {
    const outlineRoot = await projectDirectory(workItemId, join(workItemId, '大纲'))
    const actual: string[] = []
    let rootFiles: string[] = []
    try { rootFiles = await readdir(outlineRoot) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    actual.push(...rootFiles.filter((file) => file.endsWith('.md')).map((file) => `大纲/${file}`))
    const chapterRoot = await projectDirectory(workItemId, join(workItemId, '大纲', '章纲'))
    let chapterFiles: string[] = []
    try { chapterFiles = await readdir(chapterRoot) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    actual.push(...chapterFiles.filter((file) => /^第\d+章\.md$/.test(file)).map((file) => `大纲/章纲/${file}`))
    const stageRoot = await projectDirectory(workItemId, join(workItemId, '大纲', '阶段纲'))
    let stageFiles: string[] = []
    try { stageFiles = await readdir(stageRoot) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    actual.push(...stageFiles.filter((file) => /^第\d+阶段-大纲\.md$/.test(file)).map((file) => `大纲/阶段纲/${file}`))
    const expected = [...expectedRelativePaths].sort((left, right) => left.localeCompare(right, 'zh-CN'))
    actual.sort((left, right) => left.localeCompare(right, 'zh-CN'))
    if (actual.length !== expected.length || actual.some((path, index) => path !== expected[index])) {
      throw new AppError('CONFLICT', '大纲文件夹中存在未纳入 SQLite 的 Markdown，不能安全退回文件模式。', { recoverable: true })
    }
  }
}

function normalizeFoundationConfig(value: Record<string, unknown>): WorkspaceFoundationConfig {
  const sourceNotes = typeof value.sourceNotes === 'string' ? value.sourceNotes.trim() : ''
  const worldView = typeof value.worldView === 'string' ? value.worldView.trim() : ''
  if (sourceNotes.length > 100_000 || worldView.length > 100_000 || /\u0000/.test(sourceNotes) || /\u0000/.test(worldView)) {
    throw new AppError('INVALID_PROJECT_STATE', '创作基础 JSON 内容超出安全范围；SQLite 切换已暂停，原文件没有被覆盖。', { recoverable: true })
  }
  return {
    creationPath: value.creationPath === 'research' ? 'research' : 'materials',
    sourceNotes,
    worldView,
    useRealms: value.useRealms === true,
    useSystem: value.useSystem === true
  }
}

function toChapter(chapter: ReturnType<WorkspaceDatabasePort['formalChapters']>[number]): Chapter {
  return {
    id: chapter.legacyChapterId,
    position: chapter.position,
    title: chapter.title,
    content: chapter.content,
    word_count: chapter.wordCount,
    summary: '',
    revision: chapter.revision,
    bodyVersionId: chapter.currentVersionId,
    storageMode: 'sqlite',
    mirrorStatus: chapter.mirrorStatus
  }
}

function toAutosaveCheckpoint(checkpoint: ReturnType<WorkspaceDatabasePort['listAutosaveCheckpoints']>[number]): ManuscriptAutosaveCheckpoint {
  return {
    id: checkpoint.id,
    chapterId: checkpoint.legacyChapterId,
    title: checkpoint.title,
    content: checkpoint.content,
    contentHash: checkpoint.contentHash,
    status: checkpoint.status,
    baseBodyVersionId: checkpoint.baseBodyVersionId,
    mergeWindowMs: checkpoint.mergeWindowMs,
    windowStartedAt: checkpoint.windowStartedAt,
    windowEndsAt: checkpoint.windowEndsAt,
    updatedAt: checkpoint.updatedAt,
    conflictCurrentBodyVersionId: checkpoint.conflictCurrentBodyVersionId,
    finalizedBodyVersionId: checkpoint.finalizedBodyVersionId,
    operationCount: checkpoint.operationCount
  }
}

function toFactBatch(workItemId: string, batch: WorkspaceFactBatchRecord): FactBatchView {
  return {
    id: batch.id,
    workItemId,
    chapterId: batch.legacyChapterId,
    bodyVersionId: batch.bodyVersionId,
    contentHash: batch.contentHash,
    status: batch.status,
    extractorTaskRunId: batch.extractorTaskRunId,
    countsJson: batch.countsJson,
    changes: batch.changes.map((change) => ({
      ...change,
      changeType: change.reviewClass === 'low_value' ? 'LOW_VALUE' as const : change.changeType
    })),
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt
  }
}

function toApprovedFact(fact: WorkspaceApprovedFactRecord): ApprovedFactView {
  return {
    id: fact.id,
    subjectType: fact.subjectType,
    subjectId: fact.subjectId,
    predicate: fact.predicate,
    objectJson: fact.objectJson,
    normalizedKey: fact.normalizedKey,
    importance: fact.importance,
    supersedesFactId: fact.supersedesFactId,
    approvedAt: fact.approvedAt,
    sourceCurrent: fact.sourceCurrent,
    sources: fact.sources.map((source) => ({
      id: source.id,
      chapterId: source.legacyChapterId,
      bodyVersionId: source.bodyVersionId,
      contentHash: source.contentHash,
      quote: source.quote,
      spanJson: source.spanJson,
      current: source.current
    }))
  }
}

function toCharacterSnapshot(snapshot: WorkspaceCharacterSnapshotRecord): CharacterStateSnapshot {
  return {
    characterId: snapshot.characterId,
    name: snapshot.name,
    throughChapter: snapshot.throughChapterPosition,
    present: snapshot.present,
    ...(snapshot.location ? { location: snapshot.location } : {}),
    ...(snapshot.injury ? { injury: snapshot.injury } : {}),
    ...(snapshot.relationships?.length ? { relationships: [...snapshot.relationships] } : {}),
    ...(snapshot.knowledge?.length ? { knowledge: [...snapshot.knowledge] } : {}),
    ...(snapshot.possession ? { possession: snapshot.possession } : {}),
    ...(snapshot.goal ? { goal: snapshot.goal } : {}),
    ...(snapshot.power ? { power: snapshot.power } : {}),
    ...(snapshot.vitality ? { vitality: snapshot.vitality } : {}),
    lastEventId: snapshot.lastFactId
  }
}

function normalizedCharacterFactKey(change: CharacterDynamicChange): string {
  const subject = change.character.trim().normalize('NFKC').toLocaleLowerCase('zh-CN')
  return `character:${encodeURIComponent(subject)}:${change.field}`
}

type MergedCharacterFactChange = {
  change: CharacterDynamicChange
  evidenceQuotes: string[]
  valueVariants: string[]
  normalizedKey: string
  eventKey: string
  valueKey: string
}

function mergeCharacterFactChanges(changes: CharacterDynamicChange[]): MergedCharacterFactChange[] {
  const merged: MergedCharacterFactChange[] = []
  for (const change of changes) {
    const normalizedKey = normalizedCharacterFactKey(change)
    const eventKey = normalizeFactText(change.event || '')
    const valueKey = normalizeFactText(change.value)
    const existing = merged.find((candidate) => candidate.normalizedKey === normalizedKey
      && candidate.eventKey === eventKey
      && (eventKey ? compatibleFactValues(candidate.valueKey, valueKey) : candidate.valueKey === valueKey))
    if (!existing) {
      merged.push({ change: { ...change }, evidenceQuotes: [change.evidence], valueVariants: [change.value.trim()], normalizedKey, eventKey, valueKey })
      continue
    }
    if (!existing.evidenceQuotes.includes(change.evidence)) existing.evidenceQuotes.push(change.evidence)
    if (!existing.valueVariants.includes(change.value.trim())) existing.valueVariants.push(change.value.trim())
    if (valueKey.length > existing.valueKey.length) {
      existing.change.value = change.value
      existing.valueKey = valueKey
    }
    existing.change.importance = strongerFactImportance(existing.change.importance, change.importance)
    if (existing.change.reviewClass === 'low_value' && change.reviewClass !== 'low_value') existing.change.reviewClass = 'reviewable'
  }
  return merged
}

function normalizeFactText(value: string): string {
  return value.trim().normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN')
}

function compatibleFactValues(left: string, right: string): boolean {
  return left === right || left.includes(right) || right.includes(left)
}

function strongerFactImportance(left?: CharacterDynamicChange['importance'], right?: CharacterDynamicChange['importance']): CharacterDynamicChange['importance'] {
  const weight = { low: 0, medium: 1, high: 2 } as const
  if (!left) return right
  if (!right) return left
  return weight[right] > weight[left] ? right : left
}

function factImportance(field: CharacterDynamicChange['field']): 'high' | 'medium' | 'low' {
  if (field === 'vitality' || field === 'power') return 'high'
  if (field === 'knowledge') return 'low'
  return 'medium'
}

function equivalentFactObject(leftJson: string, rightJson: string): boolean {
  const normalize = (source: string): string => {
    try {
      const value: unknown = JSON.parse(source)
      return typeof value === 'string' ? value.trim().normalize('NFKC') : JSON.stringify(value)
    } catch {
      return source.trim().normalize('NFKC')
    }
  }
  return normalize(leftJson) === normalize(rightJson)
}

function factCitation(evidenceJson: string, changeId: string): { quote: string; spanJson: string } {
  let evidence: unknown
  try { evidence = JSON.parse(evidenceJson) } catch { evidence = null }
  if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)) {
    const record = evidence as Record<string, unknown>
    const quote = [record.quote, record.excerpt, record.evidence].find((value) => typeof value === 'string' && value.trim())
    const span = record.span && typeof record.span === 'object' ? record.span as Record<string, unknown> : { kind: 'candidate', changeId }
    const quotes = Array.isArray(record.quotes)
      ? record.quotes.filter((item) => typeof item === 'string' && item.trim()).map((item) => String(item).trim())
      : []
    const enrichedSpan = {
      ...span,
      ...(quotes.length > 1 ? { evidenceQuotes: quotes } : {}),
      ...(typeof record.event === 'string' && record.event.trim() ? { event: record.event.trim() } : {})
    }
    if (typeof quote === 'string') return { quote: quote.trim(), spanJson: JSON.stringify(enrichedSpan) }
  }
  return { quote: '作者确认的事实候选（原始提取未提供逐字引文）', spanJson: JSON.stringify({ kind: 'candidate', changeId }) }
}

function writableReason(reason?: ChapterRevisionReason): 'manual' | 'autosave' | 'ai' | 'restore' {
  return reason === 'autosave' || reason === 'ai' || reason === 'restore' ? reason : 'manual'
}

function safeTitle(title: string): string {
  return title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || '未命名'
}

function normalizeForeshadowTitle(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s\p{P}\p{S}]+/gu, '')
}

function uniqueForeshadowMatch(items: import('../../../core/ports/workspace-database').WorkspaceForeshadowRecord[], normalizedDescription: string): import('../../../core/ports/workspace-database').WorkspaceForeshadowRecord | undefined {
  const exact = items.filter((item) => normalizeForeshadowTitle(item.title) === normalizedDescription)
  if (exact.length === 1) return exact[0]
  const contained = items.filter((item) => {
    const title = normalizeForeshadowTitle(item.title)
    return title.length >= 2 && (normalizedDescription.includes(title) || title.includes(normalizedDescription))
  })
  return contained.length === 1 ? contained[0] : undefined
}

function chapterMirrorPlan(database: Pick<WorkspaceDatabasePort, 'readableMirrorPlans'>, chapterId: number): WorkspaceMirrorPlan {
  const plan = database.readableMirrorPlans({ sourceTypes: ['chapter_markdown'], legacyChapterId: chapterId })
    .find((item) => item.action === 'write' && parseChapterFileName(basename(item.relativePath))?.id === chapterId)
  if (!plan) throw new AppError('NOT_FOUND', `第 ${chapterId} 章缺少可读 Markdown 镜像记录。`, { recoverable: true })
  return plan
}

function mirrorExcerpt(content: string): string {
  const normalized = content.replace(/\r\n?/g, '\n').trim()
  return normalized ? normalized.slice(0, 240) : '（空白）'
}

function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function modelConfigInputs(settings: AiSettings) {
  const profiles = settings.routingMode === 'shared'
    ? [['shared', settings.shared, true] as const]
    : (Object.entries(settings.tasks).map(([task, profile]) => [task, profile, task === 'prose'] as const))
  return profiles.map(([scope, profile, isDefault]) => {
    const connection = settings.connections.find((item) => item.id === profile.connectionId)
    if (!connection) throw new Error(`模型“${profile.model}”绑定的接口已经不存在`)
    const localModel = isLocalConnection(profile.connectionId) ? localModelCatalog.find(m => m.id === profile.model) : undefined
    return {
      provider: connection.kind === 'local' ? `${connection.id}#${scope}` : `${connection.id}:${connection.baseUrl}#${scope}`,
      modelName: profile.model,
      displayName: scope === 'shared' ? profile.model : `${profile.model} · ${scope}`,
      settingsJson: JSON.stringify({ routingMode: settings.routingMode, scope, connectionId: connection.id, connectionName: connection.name, temperature: profile.temperature, topP: profile.topP, maxTokens: profile.maxTokens }),
      inputTokenBudget: localModel ? Math.max(0, localModel.contextTokens - profile.maxTokens - localModel.systemReserveTokens) : profile.maxTokens,
      enabled: true,
      isDefault
    }
  })
}

function workspaceConfigDisplayName(kind: WorkspaceConfigDocumentKind): string {
  return ({ timeline: '纪事时间线', realms: '境界体系', power_system: '力量体系', cheat_system: '金手指设定', system_ui: '系统界面模板', world_map: '小说地图' } as const)[kind]
}

function mirrorConflict(): AppError {
  return new AppError('CONFLICT', '可读镜像已被外部修改，SQLite 正文已保存，但没有覆盖外部文件。', { recoverable: true })
}
