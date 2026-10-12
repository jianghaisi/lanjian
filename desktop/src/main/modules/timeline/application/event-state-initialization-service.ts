import { AppError, isAppError } from '../../../core/errors/app-error'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'
import type { WorkspaceDatabaseFactory } from '../../../core/ports/workspace-database'
import type { EventSnapshotScope } from '../domain/event-source-snapshot'
import type { EventStateInitializationPlan } from '../domain/event-state-initialization'

const TTL_MS = 10 * 60 * 1000

type Runtime = { nonce(): string; now(): number }
type Review = Readonly<{ scope: EventSnapshotScope; plan: EventStateInitializationPlan; expiresAt: number }>

/** Explicit recovery for early unified-event databases that have a sealed
 * migration receipt but no schema-43 state rows. A preview token is single use;
 * lost responses are recovered by reading the resulting projection. */
export class EventStateInitializationService {
  private readonly reviews = new Map<string, Review>()
  private serial = 0

  constructor(private readonly databases: Pick<WorkspaceDatabaseFactory, 'openEventReadOnly' | 'openEventStateInitializationWrite'>,
    private readonly currentScope: () => Promise<EventSnapshotScope>, private readonly writes: WorkspaceWriteCoordinator,
    private readonly runtime: Runtime) {}

  async preview() {
    const scope = await this.scope()
    return this.writes.run(scope.root, async () => {
      await this.assertScope(scope)
      if (!this.databases.openEventReadOnly) throw unavailable()
      let database: Awaited<ReturnType<NonNullable<WorkspaceDatabaseFactory['openEventReadOnly']>>> = null
      try {
        database = await this.databases.openEventReadOnly(scope.root)
        await this.assertScope(scope)
        if (!database || database.bookRoot !== scope.root) throw changed()
        const plan = database.eventStateInitializationPlan()
        await this.assertScope(scope)
        const token = `${this.runtime.nonce()}:${++this.serial}`, expiresAt = this.runtime.now() + TTL_MS
        this.reviews.clear()
        this.reviews.set(token, Object.freeze({ scope: Object.freeze({ ...scope }), plan, expiresAt }))
        return Object.freeze({ token, migrationOperationId: plan.operationId, eventCount: plan.eventIds.length,
          orderHash: plan.orderHash, expiresAt })
      } catch (error) {
        if (isAppError(error)) throw error
        throw new AppError('STORAGE_ERROR', '事件状态恢复预览暂时无法读取；未改动作品。', { recoverable: true, cause: error })
      } finally { database?.close() }
    })
  }

  async commit(token: string) {
    const review = this.reviews.get(token)
    this.reviews.delete(token)
    if (!review || this.runtime.now() > review.expiresAt) throw changed()
    await this.assertScope(review.scope)
    return this.writes.run(review.scope.root, async () => {
      await this.assertScope(review.scope)
      if (!this.databases.openEventStateInitializationWrite) throw unavailable()
      let database: Awaited<ReturnType<NonNullable<WorkspaceDatabaseFactory['openEventStateInitializationWrite']>>> | undefined
      try {
        database = await this.databases.openEventStateInitializationWrite(review.scope.root)
        await this.assertScope(review.scope)
        // From the last scope check through COMMIT, the adapter performs only
        // synchronous SQLite work and re-derives the complete plan.
        database.initialize(review.plan, () => {
          if (this.runtime.now() > review.expiresAt) throw changed()
        })
        return Object.freeze({ migrationOperationId: review.plan.operationId, eventCount: review.plan.eventIds.length,
          orderHash: review.plan.orderHash })
      } catch (error) {
        if (isAppError(error)) throw error
        throw new AppError('STORAGE_ERROR', '事件状态恢复未能提交；原事件和迁移记录保持不变。', { recoverable: true, cause: error })
      } finally { database?.close() }
    })
  }

  clear(): void { this.reviews.clear() }

  private async scope(): Promise<EventSnapshotScope> {
    const scope = { ...await this.currentScope() }
    if (!scope.workItemId || !scope.root || !Number.isSafeInteger(scope.generation) || scope.generation < 0) throw changed()
    return scope
  }

  private async assertScope(expected: EventSnapshotScope): Promise<void> {
    const current = await this.scope()
    if (current.workItemId !== expected.workItemId || current.root !== expected.root || current.generation !== expected.generation) throw changed()
  }
}

function changed(): AppError {
  return new AppError('CONFLICT', '作品、会话或恢复预览已经变化，请重新核对。', { recoverable: true })
}
function unavailable(): AppError {
  return new AppError('FEATURE_UNAVAILABLE', '当前版本暂不能恢复缺失的事件状态。', { recoverable: true })
}
