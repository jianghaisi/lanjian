import { AppError, isAppError } from '../../../core/errors/app-error'
import type { WorkspaceDatabaseFactory } from '../../../core/ports/workspace-database'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'
import type { EventMigrationFilesPort } from '../domain/event-migration-commit'
import type { EventMigrationCommitResult, EventMirrorFeedback, EventMirrorSyncPort } from '../domain/event-mirror'
import type { EventSnapshotScope } from '../domain/event-source-snapshot'
import { EventMigrationReviewSession } from './event-migration-review-session'

/** Private use case. Composition must wait for unified consumers and named IPC.
 * Receipt recovery is a separate read, never a replay of a consumed token. */
export class EventMigrationCommitService {
  constructor(
    private readonly reviews: EventMigrationReviewSession,
    private readonly databases: Pick<WorkspaceDatabaseFactory, 'openEventMigrationWrite'>,
    private readonly files: EventMigrationFilesPort,
    private readonly currentScope: () => Promise<EventSnapshotScope>,
    private readonly writes: WorkspaceWriteCoordinator,
    private readonly mirrors?: EventMirrorSyncPort
  ) {}

  async commit(token: string): Promise<EventMigrationCommitResult> {
    const committed = await this.reviews.withConfirmation(token, async (review, assertActive) => {
      const scope = review.snapshot.scope
      // Claim acquisition uses the read lane itself; enter the write lane only
      // AFTER claiming, and retain cancellation/expiry checks while queued.
      return this.writes.run(scope.root, async () => {
        const check = async () => {
          const current = await this.currentScope()
          assertActive()
          if (current.workItemId !== scope.workItemId || current.root !== scope.root || current.generation !== scope.generation) {
            throw new AppError('CONFLICT', '作品或核对会话已经变化，请重新核对事件。', { recoverable: true })
          }
        }
        let database: Awaited<ReturnType<NonNullable<WorkspaceDatabaseFactory['openEventMigrationWrite']>>> | undefined
        try {
          await check()
          if (!this.databases.openEventMigrationWrite) throw new AppError('FEATURE_UNAVAILABLE', '事件迁移提交暂不可用。', { recoverable: true })
          database = await this.databases.openEventMigrationWrite(scope.root)
          await this.files.assertUnchanged(review.snapshot)
          await check()
          // No await from this final scope check through SQLite COMMIT.
          return Object.freeze({ scope, receipt: database.commit(review, assertActive) })
        } catch (error) {
          if (isAppError(error)) throw error
          throw new AppError('STORAGE_ERROR', '事件迁移未能提交，请重新核对；原始文件已保留。', { recoverable: true, cause: error })
        } finally {
          try { database?.close() } catch (cause) {
            // COMMIT may already have succeeded. Never describe this as a
            // rollback or authorize replay; the stable operation has a receipt.
            throw new AppError('STORAGE_ERROR', '事件提交连接暂未正常结束，请查询本次迁移回执确认结果。', { recoverable: true, cause })
          }
        }
      })
    })
    let mirror: EventMirrorFeedback = Object.freeze({ status: 'pending', issue: 'unavailable' })
    if (this.mirrors) {
      try { mirror = await this.mirrors.syncCommitted(committed.scope, committed.receipt) }
      catch (error) {
        mirror = isAppError(error) && error.code === 'CONFLICT'
          ? Object.freeze({ status: 'pending', issue: 'stale' })
          : Object.freeze({ status: 'failed', issue: 'storage-error' })
      }
    }
    return Object.freeze({ receipt: committed.receipt, mirror })
  }
}
