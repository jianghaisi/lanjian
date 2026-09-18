import type { WorkspaceFactBatchStatus } from '../../../core/ports/workspace-database'

export const factBatchStates: readonly WorkspaceFactBatchStatus[] = [
  'PENDING', 'IN_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'SUPERSEDED', 'STALE'
]

const terminalStates = new Set<WorkspaceFactBatchStatus>(['APPROVED', 'REJECTED', 'SUPERSEDED', 'STALE'])
const allowedTransitions: Record<WorkspaceFactBatchStatus, ReadonlySet<WorkspaceFactBatchStatus>> = {
  PENDING: new Set(['IN_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'SUPERSEDED', 'STALE']),
  IN_REVIEW: new Set(['APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'SUPERSEDED', 'STALE']),
  APPROVED: new Set(),
  PARTIALLY_APPROVED: new Set(['APPROVED', 'REJECTED', 'SUPERSEDED', 'STALE']),
  REJECTED: new Set(),
  SUPERSEDED: new Set(),
  STALE: new Set()
}

export function factBatchCanTransition(current: WorkspaceFactBatchStatus, target: WorkspaceFactBatchStatus): boolean {
  return current === target || allowedTransitions[current].has(target)
}

export function factBatchIsTerminal(status: WorkspaceFactBatchStatus): boolean {
  return terminalStates.has(status)
}

