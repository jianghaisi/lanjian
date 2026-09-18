import type { WorkspaceTaskRunRecord, WorkspaceTaskStatus } from '../../../core/ports/workspace-database'

export const taskRunStates: readonly WorkspaceTaskStatus[] = [
  'queued', 'resuming', 'preparing', 'running', 'streaming', 'paused', 'succeeded', 'cancelled', 'failed', 'interrupted'
]

const allowedTransitions: Record<WorkspaceTaskStatus, ReadonlySet<WorkspaceTaskStatus>> = {
  queued: new Set(['preparing', 'running', 'paused', 'cancelled', 'failed', 'interrupted']),
  resuming: new Set(['preparing', 'running', 'paused', 'cancelled', 'failed', 'interrupted']),
  preparing: new Set(['running', 'paused', 'cancelled', 'failed', 'interrupted']),
  running: new Set(['streaming', 'succeeded', 'paused', 'cancelled', 'failed', 'interrupted']),
  streaming: new Set(['succeeded', 'paused', 'cancelled', 'failed', 'interrupted']),
  paused: new Set(['cancelled']),
  succeeded: new Set(),
  cancelled: new Set(),
  failed: new Set(),
  interrupted: new Set()
}

export function taskRunCanTransition(current: WorkspaceTaskStatus, target: WorkspaceTaskStatus): boolean {
  return current === target || allowedTransitions[current].has(target)
}

/**
 * Paused is durable but not terminal. Its provider request is stopped, and a
 * continuation starts a separate resuming child; the parent never succeeds.
 */
export function taskRunIsTerminal(status: WorkspaceTaskStatus): boolean {
  return status === 'succeeded' || status === 'cancelled' || status === 'failed' || status === 'interrupted'
}

/** Compatibility reads only: never infer a pause from a bare phase string. */
export function taskRunHasLegacyPause(task: Pick<WorkspaceTaskRunRecord, 'status' | 'taskType' | 'legacyChapterId' | 'checkpointJson'>, expectedWorkItemId: string): boolean {
  if (task.status !== 'cancelled' || task.taskType !== 'writing_agent') return false
  try {
    const value = JSON.parse(task.checkpointJson)
    return Boolean(expectedWorkItemId) && value?.version === 1 && value.phase === 'paused' && value.workItemId === expectedWorkItemId
      && Number.isSafeInteger(value.request?.chapterId) && value.request.chapterId > 0
      && value.request.chapterId === task.legacyChapterId
      && typeof value.request.message === 'string' && typeof value.request.currentDraft === 'string'
  } catch { return false }
}
