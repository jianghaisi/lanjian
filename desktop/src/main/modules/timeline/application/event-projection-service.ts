import { createHash } from 'node:crypto'
import { AppError, isAppError } from '../../../core/errors/app-error'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'
import type { WorkspaceDatabaseFactory, WorkspaceEventReadPort } from '../../../core/ports/workspace-database'
import type { EventSnapshotScope } from '../domain/event-source-snapshot'
import type { EventMigrationReceipt } from '../domain/event-migration-receipt'
import type { ArchivedProjectedEvent, ProjectedStoryEvent, UnifiedEventProjection } from '../domain/event-projection'
import type { StoryEventVersion } from '../domain/story-event-version'

/** Builds one immutable, book-scoped view from a transitioned event module.
 * It has no compatibility fallback and never creates, upgrades or repairs data. */
export class EventProjectionService {
  constructor(
    private readonly databases: Pick<WorkspaceDatabaseFactory, 'openEventReadOnly'>,
    private readonly currentScope: () => Promise<EventSnapshotScope>,
    private readonly writes: WorkspaceWriteCoordinator
  ) {}

  async read(): Promise<UnifiedEventProjection> {
    const projection = await this.readInternal(false)
    if (!projection) throw unavailable()
    return projection
  }

  /** Consumers may retain their verified compatibility reader only when the
   * same read snapshot proves that no unified migration receipt exists. */
  async readForConsumer(): Promise<UnifiedEventProjection | null> {
    const projection=await this.readInternal(true)
    if(!projection)return null
    const approved=projection.approved.filter(event=>!event.settlement||['current','untracked'].includes(event.settlement.state))
    return Object.freeze({...projection,approved:Object.freeze(approved),approvedRevision:approved.length===projection.approved.length?projection.approvedRevision:revision({operationId:projection.operationId,approved})})
  }

  private async readInternal(allowCompatibility: boolean): Promise<UnifiedEventProjection | null> {
    const scope = await this.scope()
    return this.writes.read(scope.root, async () => {
      await this.assertScope(scope)
      if (!this.databases.openEventReadOnly) throw unavailable()
      let database: WorkspaceEventReadPort | null = null
      try {
        database = await this.databases.openEventReadOnly(scope.root)
        await this.assertScope(scope)
        if (!database) {
          if (allowCompatibility) return null
          throw unavailable()
        }
        if (!samePath(database.bookRoot, scope.root)) throw changed()
        const receipt = database.eventMigrationReceipt()
        if (!receipt) {
          if (allowCompatibility) return null
          throw unavailable()
        }
        if (!database.projectId || receipt.projectId !== database.projectId || !database.formalCanonicalEventsReady()) throw unavailable()
        const projection = this.project(scope, database, receipt)
        await this.assertScope(scope)
        return projection
      } catch (error) {
        await this.assertScope(scope)
        if (isAppError(error)) throw error
        throw new AppError('STORAGE_ERROR', '当前作品的统一事件暂时无法读取；未改动任何作品数据。', { recoverable: true, cause: error })
      } finally {
        try { database?.close() } catch (cause) {
          throw new AppError('STORAGE_ERROR', '统一事件只读快照未完整关闭，请稍后重试；未改动作品数据。', { recoverable: true, cause })
        }
      }
    })
  }

  private project(scope: EventSnapshotScope, database: WorkspaceEventReadPort, receipt: EventMigrationReceipt): UnifiedEventProjection {
    const state = database.eventState()
    if (!state) throw new AppError('FEATURE_UNAVAILABLE', '当前作品尚未确认事件排序和归档初始状态，请先完成状态初始化；未自动补写数据。', { recoverable: true })
    const approved: ProjectedStoryEvent[] = [], candidates: ProjectedStoryEvent[] = []
    const archived: ArchivedProjectedEvent[] = []
    const identities = new Set(database.listCanonicalEvents().map(identity => identity.id))
    if (state.order.eventIds.length !== identities.size || state.lifecycles.length !== identities.size) throw corrupted()
    const lifecycles = new Map(state.lifecycles.map(item => [item.eventId, item]))
    const settlements = database.settlements?.().statuses() ?? new Map()
    for (const eventId of state.order.eventIds) {
      if (!identities.delete(eventId)) throw corrupted()
      const lifecycle = lifecycles.get(eventId)
      if (!lifecycle) throw corrupted()
      const versions = database.listCanonicalEventVersions(eventId)
      const heads = database.canonicalEventVersionHeads(eventId)
      if (!heads || !versions.length) throw corrupted()
      const latest = versions.find(version => version.id === heads.latestVersionId)
      if (!latest || latest.eventId !== eventId || latest.projectId !== database.projectId) throw corrupted()
      let acceptedProjection: ProjectedStoryEvent | null = null
      if (heads.approvedVersionId !== null) {
        const accepted = versions.find(version => version.id === heads.approvedVersionId)
        if (!accepted || accepted.eventId !== eventId || accepted.projectId !== database.projectId
          || accepted.status !== 'approved') throw corrupted()
        const manuscript=accepted.sources.find(edge=>edge.source.kind==='manuscript')
        const settlement=settlements.get(eventId) ?? (database.schemaVersion>=48 && manuscript && ['realized','deviated'].includes(accepted.phase)
          ? {decisionId:'',chapterId:0,position:0,bodyVersionId:manuscript.source.revision,state:'untracked' as const,reason:'历史来源保留，尚未按本流程核对'} : undefined)
        acceptedProjection = Object.freeze({...projected(accepted),...(settlement?{settlement:Object.freeze({...settlement})}:{})})
      }
      const pendingProjection = latest.status === 'candidate' ? projected(latest) : null
      if (!pendingProjection && (latest.status !== 'approved' || latest.id !== heads.approvedVersionId)) throw corrupted()
      if (lifecycle.state === 'archived') archived.push(Object.freeze({ lifecycle, approved: acceptedProjection, candidate: pendingProjection }))
      else if (lifecycle.state === 'active') {
        if (acceptedProjection) approved.push(acceptedProjection)
        if (pendingProjection) candidates.push(pendingProjection)
      } else throw corrupted()
    }
    const storedMirror = database.eventMirrorStatus()
    const mirror = storedMirror ? Object.freeze({ ...storedMirror }) : null
    const scopeBasis = { version: 1, projectId: database.projectId, operationId: receipt.operationId }
    // Consumers of formal content must not depend on pending drafts or mirror feedback.
    const approvedRevision = revision({ ...scopeBasis, approved })
    const candidateRevision = revision({ ...scopeBasis, candidates })
    return Object.freeze({
      version: 1,
      workItemId: scope.workItemId,
      revision: revision({ ...scopeBasis, approvedRevision, candidateRevision, state, archived, mirror }),
      approvedRevision,
      candidateRevision,
      operationId: receipt.operationId,
      committedAt: receipt.committedAt,
      ordering: 'author-display',
      state,
      approved: Object.freeze(approved),
      candidates: Object.freeze(candidates),
      archived: Object.freeze(archived),
      mirror
    })
  }

  private async scope(): Promise<EventSnapshotScope> {
    try {
      const scope = { ...await this.currentScope() }
      if (typeof scope.workItemId !== 'string' || !scope.workItemId || typeof scope.root !== 'string' || !scope.root
        || !Number.isSafeInteger(scope.generation) || scope.generation < 0) throw changed()
      return scope
    } catch (error) {
      if (isAppError(error)) throw error
      throw new AppError('STORAGE_ERROR', '当前作品暂时无法核对，未读取其他作品的事件。', { recoverable: true, cause: error })
    }
  }

  private async assertScope(expected: EventSnapshotScope): Promise<void> {
    const current = await this.scope()
    if (current.workItemId !== expected.workItemId || !samePath(current.root, expected.root)
      || current.generation !== expected.generation) throw changed()
  }
}

function projected(version: StoryEventVersion): ProjectedStoryEvent {
  const content = Object.freeze({
    time: version.content.time,
    characters: Object.freeze([...version.content.characters]),
    location: version.content.location,
    event: version.content.event,
    ...(version.content.result !== undefined ? { result: version.content.result } : {}),
    evidenceRefs: Object.freeze(version.content.evidenceRefs.map(reference => Object.freeze({ ...reference }))),
    confidence: version.content.confidence,
    ...(version.content.title !== undefined ? { title: version.content.title } : {}),
    ...(version.content.rawCharacters !== undefined ? { rawCharacters: version.content.rawCharacters } : {})
  })
  return Object.freeze({
    eventId: version.eventId,
    versionId: version.id,
    version: version.version,
    content,
    granularity: version.granularity,
    phase: version.phase,
    creator: version.creator,
    sources: Object.freeze(version.sources.map(edge => Object.freeze({
      relation: edge.relation, source: Object.freeze({ ...edge.source })
    }))),
    createdAt: version.createdAt
  })
}

function revision(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US')
    : left === right
}

function changed(): AppError {
  return new AppError('CONFLICT', '作品或会话已经变化，请重新读取统一事件；未返回其他作品的数据。', { recoverable: true })
}

function unavailable(): AppError {
  return new AppError('FEATURE_UNAVAILABLE', '当前作品尚未完成事件迁移，不能作为统一事件来源。', { recoverable: true })
}

function corrupted(): AppError {
  return new AppError('DATABASE_INTEGRITY_FAILED', '统一事件版本或批准指针不完整，已停止读取以保护作品。', { recoverable: false })
}
