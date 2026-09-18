import { AppError, isAppError } from '../../../core/errors/app-error'
import type { EventMigrationReceipt } from '../domain/event-migration-receipt'
import type { EventSnapshotScope } from '../domain/event-source-snapshot'
import { assertStoryIdentifier } from '../domain/story-event-version'
import type { WorkspaceDatabaseFactory } from '../../../core/ports/workspace-database'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'

/** Current-book recovery query. Main-private until the event IPC owner is wired. */
export class EventMigrationReceiptService {
  constructor(private readonly databases: Pick<WorkspaceDatabaseFactory, 'openEventReadOnly'>,
    private readonly currentScope: () => Promise<EventSnapshotScope>, private readonly writes: WorkspaceWriteCoordinator) {}

  async read(operationId?: string): Promise<EventMigrationReceipt | null> {
    if (operationId !== undefined) assertStoryIdentifier(operationId)
    const scope = await this.scope()
    return this.writes.run(scope.root, async () => {
      await this.assertScope(scope)
      if (!this.databases.openEventReadOnly) throw new AppError('FEATURE_UNAVAILABLE', '只读事件回执查询暂不可用，未尝试重放迁移。', { recoverable: true })
      let database: Awaited<ReturnType<NonNullable<WorkspaceDatabaseFactory['openEventReadOnly']>>> = null
      try {
        database = await this.databases.openEventReadOnly(scope.root)
        await this.assertScope(scope)
        const receipt = database?.eventMigrationReceipt(operationId) ?? null
        await this.assertScope(scope)
        return receipt
      } catch (error) {
        await this.assertScope(scope)
        if (isAppError(error)) throw error
        throw new AppError('STORAGE_ERROR', '事件迁移回执暂时无法读取，请稍后重试；未重放迁移。', { recoverable: true, cause: error })
      } finally {
        try { database?.close() } catch (cause) {
          throw new AppError('STORAGE_ERROR', '事件回执的只读查询暂未完整结束，请稍后重试；未重放迁移。', { recoverable: true, cause })
        }
      }
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
      throw new AppError('STORAGE_ERROR', '当前作品暂时无法核对，未查询其他作品的迁移记录。', { recoverable: true, cause: error })
    }
  }
  private async assertScope(expected: EventSnapshotScope): Promise<void> {
    const current = await this.scope()
    if (current.root !== expected.root || current.workItemId !== expected.workItemId || current.generation !== expected.generation) throw changed()
  }
}
function changed(): AppError { return new AppError('CONFLICT', '作品或会话已经变化，请重新查询事件迁移记录。', { recoverable: true }) }
