import type { ManuscriptAutosaveCheckpoint } from '../../../../contracts/index'
import type { WorkspaceIdentity, WorkspaceRequestGuard } from '../../../../contracts/library/workspace-request-guard'

type RecoveryRefreshDependencies = {
  current: () => WorkspaceIdentity | null
  guard: WorkspaceRequestGuard
  read: () => Promise<ManuscriptAutosaveCheckpoint[]>
  apply: (drafts: ManuscriptAutosaveCheckpoint[], workItemId: string) => void
  clear: () => void
}

// Keep asynchronous recovery loading separate from synchronous dialog projection,
// so delayed replies can be exercised without exposing editor state to tests.
export function createManuscriptRecoveryRefresh(dependencies: RecoveryRefreshDependencies): () => Promise<void> {
  let generation = 0
  return async () => {
    const refreshGeneration = ++generation
    const workItem = dependencies.current()
    if (!workItem) {
      dependencies.clear()
      return
    }
    const request = dependencies.guard.capture(workItem)
    const drafts = await dependencies.read().catch(() => [])
    // Recheck before any local-store cleanup as well as before publication.
    // A same-book reopen changes the workspace epoch; overlapping refreshes
    // in one epoch are ordered independently by this loader's generation.
    if (refreshGeneration !== generation || !dependencies.guard.isCurrent(request, dependencies.current())) return
    dependencies.apply(drafts, request.workItemId)
  }
}
