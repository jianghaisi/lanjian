export type PlanningChapter = {
  id: number
  position: number
  title: string
  volume: number | null
  plannedOnly: boolean
}

/** A directory is a projection of explicit membership, never a chapter-count heuristic. */
export function planningChapterCatalog(
  written: readonly { id: number; position: number; title: string }[],
  standalone: readonly { chapterId: number; title: string; volume?: number | null; hasManuscript: boolean }[],
  placements: readonly { chapterId: number; volume: number }[],
  volumes: readonly { volume: number }[]
): PlanningChapter[] {
  const knownVolumes = new Set(volumes.map(volume => volume.volume))
  const membership = new Map(placements.map(item => [item.chapterId, item.volume]))
  const writtenIds = new Set(written.map(chapter => chapter.id))
  const resolveVolume = (id: number, fallback?: number | null) => {
    const volume = membership.get(id) ?? fallback
    return volume && knownVolumes.has(volume) ? volume : null
  }
  return [
    ...written.map(chapter => ({ ...chapter, volume: resolveVolume(chapter.id), plannedOnly: false })),
    ...standalone.filter(entry => !entry.hasManuscript && !writtenIds.has(entry.chapterId)).map(entry => ({
      id: entry.chapterId, position: entry.chapterId, title: entry.title,
      volume: resolveVolume(entry.chapterId, entry.volume), plannedOnly: true
    }))
  ].sort((left, right) => left.position - right.position || left.id - right.id)
}

export function matchesPlanningSearch(query: string, ...parts: (string | number | null | undefined)[]): boolean {
  const terms = query.trim().toLocaleLowerCase('zh-CN').split(/\s+/).filter(Boolean)
  const text = parts.join(' ').toLocaleLowerCase('zh-CN')
  return terms.every(term => text.includes(term))
}
