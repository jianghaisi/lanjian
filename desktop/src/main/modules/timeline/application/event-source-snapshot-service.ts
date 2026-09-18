import { AppError } from '../../../core/errors/app-error'
import type { EventSnapshotScope, EventSourceSnapshot, EventSourceSnapshotPort } from '../domain/event-source-snapshot'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'

/** Acquire a retained read, never refresh a reviewed authorization or retry a write. */
export class EventSourceSnapshotService {
  constructor(
    private readonly source: EventSourceSnapshotPort,
    private readonly currentScope: () => Promise<EventSnapshotScope>,
    private readonly writes: WorkspaceWriteCoordinator
  ) {}

  async capture(): Promise<EventSourceSnapshot> {
    const scope = { ...await this.currentScope() }
    if (typeof scope.workItemId !== 'string' || !scope.workItemId || typeof scope.root !== 'string' || !scope.root
      || !Number.isSafeInteger(scope.generation) || scope.generation < 0) throw changedScope()
    return this.writes.run(scope.root, async () => {
      await this.assertCurrent(scope)
      try {
        const snapshot = await this.source.capture(scope)
        await this.assertCurrent(scope)
        if (!sameScope(scope, snapshot.scope)) throw changedScope()
        return snapshot
      } catch (error) {
        // An old book's late failure must not replace the current book's state.
        await this.assertCurrent(scope)
        throw error
      }
    })
  }

  private async assertCurrent(scope: EventSnapshotScope): Promise<void> {
    const current = await this.currentScope()
    if (!sameScope(scope, current)) throw changedScope()
  }
}

function sameScope(left: EventSnapshotScope, right: EventSnapshotScope): boolean {
  return left.workItemId === right.workItemId && left.root === right.root && left.generation === right.generation
}

function changedScope(): AppError {
  return new AppError('CONFLICT', '作品或核对会话已经变化，请重新核对事件。', { recoverable: true })
}
