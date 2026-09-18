export const chapterLifecycleStates = ['PLANNED', 'DRAFTING', 'REVIEWABLE', 'CONFIRMED', 'REVISING', 'ARCHIVED'] as const

export type ChapterLifecycleState = typeof chapterLifecycleStates[number]
export type ActiveChapterLifecycleState = Exclude<ChapterLifecycleState, 'ARCHIVED'>

export type ChapterLifecycle = {
  status: ChapterLifecycleState
  archivedFrom: ActiveChapterLifecycleState | null
}

const allowedTransitions: Record<ActiveChapterLifecycleState, ReadonlySet<ActiveChapterLifecycleState>> = {
  PLANNED: new Set(['DRAFTING']),
  DRAFTING: new Set(['REVIEWABLE', 'REVISING']),
  REVIEWABLE: new Set(['CONFIRMED', 'REVISING']),
  CONFIRMED: new Set(['REVISING']),
  REVISING: new Set(['PLANNED', 'DRAFTING', 'REVIEWABLE', 'CONFIRMED'])
}

export function chapterLifecycleCanTransition(current: ChapterLifecycle, target: ChapterLifecycleState): boolean {
  if (current.status === target) return true
  if (current.status === 'ARCHIVED') return Boolean(current.archivedFrom && target === current.archivedFrom)
  if (target === 'ARCHIVED') return true
  return allowedTransitions[current.status].has(target)
}

export function transitionChapterLifecycle(current: ChapterLifecycle, target: ChapterLifecycleState): ChapterLifecycle {
  if (!chapterLifecycleCanTransition(current, target)) {
    throw new Error(`章节状态不能从 ${current.status} 迁移到 ${target}`)
  }
  if (current.status === target) return current
  if (target === 'ARCHIVED') return { status: 'ARCHIVED', archivedFrom: current.status as ActiveChapterLifecycleState }
  return { status: target, archivedFrom: null }
}

export function initialChapterLifecycle(hasBody: boolean): ChapterLifecycle {
  return { status: hasBody ? 'DRAFTING' : 'PLANNED', archivedFrom: null }
}
