import { AppError, isAppError } from '../../../core/errors/app-error'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'
import type { WorkspaceDatabaseFactory } from '../../../core/ports/workspace-database'
import type {
  EventMirrorFeedback,
  EventMirrorPublisherPort,
  EventMirrorStoragePort,
  EventMirrorSyncPort
} from '../domain/event-mirror'
import type { EventMigrationReceipt } from '../domain/event-migration-receipt'
import type { EventSnapshotScope } from '../domain/event-source-snapshot'

/** Post-commit only. Retrying this use case never replays migration rows. */
export class EventMirrorSyncService implements EventMirrorSyncPort {
  constructor(
    private readonly databases: Pick<WorkspaceDatabaseFactory, 'openEventMirrorWrite'>,
    private readonly publisher: EventMirrorPublisherPort,
    private readonly currentScope: () => Promise<EventSnapshotScope>,
    private readonly writes: WorkspaceWriteCoordinator
  ) {}

  async syncCommitted(scope: EventSnapshotScope, receipt: EventMigrationReceipt): Promise<EventMirrorFeedback> {
    return this.synchronize(scope, receipt.operationId, receipt)
  }

  async retry(operationId?: string): Promise<EventMirrorFeedback> {
    const scope = await this.currentScope()
    return this.synchronize(scope, operationId)
  }

  async retryCaptured(root: string): Promise<EventMirrorFeedback> {
    const scope = await this.currentScope()
    if (scope.root !== root) return staleFeedback()
    return this.synchronize(scope)
  }

  private async synchronize(scope: EventSnapshotScope, operationId?: string, expectedReceipt?: EventMigrationReceipt): Promise<EventMirrorFeedback> {
    return this.writes.run(scope.root, async () => {
      let storage: EventMirrorStoragePort | undefined
      let outcome: EventMirrorFeedback = unavailable()
      let active = true
      const assertActive = () => {
        if (!active) throw staleError()
      }
      const checkScope = async () => {
        const current = await this.currentScope()
        active = active && current.workItemId === scope.workItemId && current.root === scope.root
          && current.generation === scope.generation
        assertActive()
      }
      try {
        await checkScope()
        if (!this.databases.openEventMirrorWrite) return unavailable()
        storage = await this.databases.openEventMirrorWrite(scope.root)
        await checkScope()
        const plan = storage.read(operationId)
        if (expectedReceipt && (plan.receipt.operationId !== expectedReceipt.operationId
          || plan.receipt.projectId !== expectedReceipt.projectId
          || plan.receipt.sourceFingerprint !== expectedReceipt.sourceFingerprint
          || plan.receipt.decisionFingerprint !== expectedReceipt.decisionFingerprint)) throw staleError()

        const recheck = async () => {
          await checkScope()
          storage!.assertCurrent(plan)
        }
        const published = await this.publisher.publish(scope, plan, { recheck, assertActive })
        try {
          await recheck()
          storage.acknowledge(plan, published.feedback, published.observedHash)
          outcome = published.feedback
        } catch (error) {
          outcome = isAppError(error) && error.code === 'CONFLICT' ? staleFeedback() : storageFailure()
        }
      } catch (error) {
        outcome = isAppError(error) && error.code === 'CONFLICT'
          ? staleFeedback()
          : isAppError(error) && error.code === 'FEATURE_UNAVAILABLE'
            ? unavailable()
            : storageFailure()
      }
      try { storage?.close() } catch { return storageFailure() }
      return outcome
    })
  }
}

function staleError() {
  return new AppError('CONFLICT', '事件可读副本同步范围已经变化。', {
    recoverable: true, details: { area: 'eventMirror', reason: 'stale' }
  })
}

function unavailable(): EventMirrorFeedback {
  return Object.freeze({ status: 'pending', issue: 'unavailable' })
}

function staleFeedback(): EventMirrorFeedback {
  return Object.freeze({ status: 'pending', issue: 'stale' })
}

function storageFailure(): EventMirrorFeedback {
  return Object.freeze({ status: 'failed', issue: 'storage-error' })
}
