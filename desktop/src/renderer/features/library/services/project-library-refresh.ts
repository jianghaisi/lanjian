export interface ProjectLibraryRefreshDecision {
  requestGeneration: number
  currentGeneration: number
  loaded: boolean
  currentCount: number
  nextCount: number
  allowRemoval?: boolean
}

export function shouldApplyProjectLibraryRefresh(decision: ProjectLibraryRefreshDecision) {
  if (decision.requestGeneration !== decision.currentGeneration) return false
  if (decision.allowRemoval) return true
  if (!decision.loaded) return true
  return decision.nextCount >= decision.currentCount
}
