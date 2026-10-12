import { createHash } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import type { PlanningChapterSkeletonEntry } from '../../../../contracts/planning/types'

/** Content revisions are scoped to this book; these are not SQLite outline-version IDs. */
export type PlanningSources = {
  total: string
  volume: number | null
  volumeHash: string | null
  events: Array<{ id: string; revision: string }>
  skeleton?: string
  stage?: { id: number; volume: number; revision: string }
}

export type FormalSkeletonRevision = {
  entryId: string
  revision: string
  previous: string | null
  entry: PlanningChapterSkeletonEntry
  sources: PlanningSources
  adoptedAt: string
}

export function planningHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function changedPlanningSources(saved: PlanningSources, current: PlanningSources): string[] {
  const reasons: string[] = []
  if (saved.total !== current.total) reasons.push('总纲内容已变化')
  if (saved.volume !== current.volume || saved.volumeHash !== current.volumeHash) reasons.push('所属卷或卷纲已变化')
  if (JSON.stringify(saved.events) !== JSON.stringify(current.events)) reasons.push('本章关联的正式事件已变化')
  if (saved.skeleton !== current.skeleton) reasons.push('本章正式骨架已变化')
  if (saved.stage?.id !== current.stage?.id || saved.stage?.volume !== current.stage?.volume
    || saved.stage?.revision !== current.stage?.revision) reasons.push('所属阶段或阶段纲已变化')
  if (current.events.some(e => e.revision === 'missing')) reasons.push('关联的正式事件缺失或已归档')
  return reasons
}

export function assertPlanningSources(value: unknown): asserts value is PlanningSources {
  const v = value as PlanningSources
  if (!v || typeof v !== 'object' || Array.isArray(v)
    || !digest(v.total) || !(v.volume === null || positive(v.volume, 1000))
    || !(v.volume === null ? v.volumeHash === null : digest(v.volumeHash))
    || (v.skeleton !== undefined && !digest(v.skeleton))
    || (v.stage !== undefined && (!v.stage || !positive(v.stage.id, 1_000_000)
      || !positive(v.stage.volume, 1000) || (v.volume !== null && v.stage.volume !== v.volume) || !digest(v.stage.revision)))
    || !Array.isArray(v.events) || v.events.length > 50_000
    || v.events.some(e => !e || typeof e.id !== 'string' || !e.id.length || e.id.length > 200
      || typeof e.revision !== 'string' || !e.revision.length || e.revision.length > 200)
    || new Set(v.events.map(e => e.id)).size !== v.events.length
    || v.events.some((e, i) => i > 0 && v.events[i - 1].id.localeCompare(e.id) >= 0)) invalid()
}

export function skeletonHeads(history: FormalSkeletonRevision[]): Map<number, FormalSkeletonRevision> {
  return new Map(history.map(item => [item.entry.chapter, item]))
}

export function skeletonRevision(entry: PlanningChapterSkeletonEntry, sources: PlanningSources, previous: string | null): string {
  return planningHash({ entry, sources, previous })
}

export function assertSkeletonHistory(value: unknown): asserts value is FormalSkeletonRevision[] {
  if (!Array.isArray(value) || value.length > 100_000) invalid()
  const heads = new Map<number, FormalSkeletonRevision>()
  for (const item of value as FormalSkeletonRevision[]) {
    if (!item || !item.entry || !positive(item.entry.chapter, 1_000_000)
      || !positive(item.entry.volume, 1000) || !positive(item.entry.volumeChapter, 50_000)
      || item.entryId !== `chapter:${item.entry.chapter}`
      || !['title', 'coreEvent', 'location', 'result'].every(k => {
        const v = item.entry[k as keyof PlanningChapterSkeletonEntry]
        return typeof v === 'string' && v.trim().length > 0 && v.length <= 5000
      }) || !Array.isArray(item.entry.characters) || !item.entry.characters.length
      || item.entry.characters.length > 500 || item.entry.characters.some(c => typeof c !== 'string' || !c.trim() || c.length > 120)
      || typeof item.adoptedAt !== 'string' || !Number.isFinite(Date.parse(item.adoptedAt))) invalid()
    assertPlanningSources(item.sources)
    if (item.sources.skeleton !== undefined || item.sources.stage !== undefined || item.sources.volume !== item.entry.volume
      || item.previous !== (heads.get(item.entry.chapter)?.revision ?? null)
      || item.revision !== skeletonRevision(item.entry, item.sources, item.previous)) invalid()
    heads.set(item.entry.chapter, item)
  }
}

/** Called at the authoritative CAS boundary as well as the compatibility writer. */
export function assertSkeletonHistoryAppend(previous: unknown, next: unknown): void {
  assertSkeletonHistory(previous)
  assertSkeletonHistory(next)
  if (next.length < previous.length || previous.some((item, i) => JSON.stringify(item) !== JSON.stringify(next[i]))) invalid()
}

function positive(value: unknown, max: number): boolean { return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= max }
function digest(value: unknown): boolean { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) }
function invalid(): never { throw new AppError('INVALID_PROJECT_STATE', '谋篇依赖或正式骨架历史损坏，已停止写入并保留现有内容。', { recoverable: true }) }
