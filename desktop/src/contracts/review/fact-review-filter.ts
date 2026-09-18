import type { FactChangeView, FactImportance } from '../index'

export type FactReviewVisibilityPreferences = {
  minimumImportance: FactImportance
  showConfirmations: boolean
}

const importanceRank: Record<FactImportance, number> = {
  low: 1,
  medium: 2,
  high: 3
}

/** Conflicts are never hidden. Everything else follows the per-book review preferences. */
export function isFactChangeVisible(change: FactChangeView, preferences: FactReviewVisibilityPreferences): boolean {
  if (change.changeType === 'CONTRADICTS') return true
  if (change.changeType === 'CONFIRMS' && !preferences.showConfirmations) return false
  if (change.changeType === 'LOW_VALUE') return preferences.minimumImportance === 'low'
  return importanceRank[change.importance] >= importanceRank[preferences.minimumImportance]
}

export function visibleFactChanges(changes: FactChangeView[], preferences: FactReviewVisibilityPreferences): FactChangeView[] {
  return changes.filter((change) => isFactChangeVisible(change, preferences))
}
