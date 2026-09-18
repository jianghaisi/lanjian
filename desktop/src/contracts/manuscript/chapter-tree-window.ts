import type { Chapter } from '../index'

export type ChapterTreeProjection = {
  items: Chapter[]
  total: number
}

export type ChapterTreeVolume = { volume: number; title: string }
export type ChapterTreePlacement = { chapterId: number; volume: number }
export type ChapterTreeGroup = {
  key: string
  volume: number | null
  title: string
  chapters: Chapter[]
}

function normalizedQuery(query: string): string {
  return query.trim().toLocaleLowerCase().replace(/\s+/g, '')
}

export function chapterMatchesQuery(chapter: Chapter, query: string): boolean {
  const needle = normalizedQuery(query)
  if (!needle) return true
  const title = chapter.title.toLocaleLowerCase().replace(/\s+/g, '')
  return title.includes(needle)
    || String(chapter.position) === needle
    || `第${chapter.position}章`.includes(needle)
}

export function preferredChapterForOpen(chapters: Chapter[], preferredId?: number | null): Chapter | null {
  if (!chapters.length) return null
  return chapters.find((chapter) => chapter.id === preferredId) ?? chapters[0]!
}

export function projectChapterVolumeGroups(
  chapters: Chapter[],
  volumes: ChapterTreeVolume[],
  placements: ChapterTreePlacement[]
): ChapterTreeGroup[] {
  if (!volumes.length) return chapters.length
    ? [{ key: 'all', volume: null, title: '全部章节', chapters: [...chapters] }]
    : []

  const orderedVolumes = [...volumes]
    .filter((item, index, source) => Number.isSafeInteger(item.volume) && item.volume > 0
      && source.findIndex((candidate) => candidate.volume === item.volume) === index)
    .sort((left, right) => left.volume - right.volume)
  const validVolumes = new Set(orderedVolumes.map((item) => item.volume))
  const chapterVolume = new Map<number, number>()
  for (const placement of placements) {
    if (!chapterVolume.has(placement.chapterId) && validVolumes.has(placement.volume)) {
      chapterVolume.set(placement.chapterId, placement.volume)
    }
  }
  const chapterOrder = (left: Chapter, right: Chapter) => left.position - right.position || left.id - right.id
  const groups: ChapterTreeGroup[] = orderedVolumes.map((item) => ({
    key: `volume-${item.volume}`,
    volume: item.volume,
    title: item.title.trim() || `第 ${item.volume} 卷`,
    chapters: chapters.filter((chapter) => chapterVolume.get(chapter.id) === item.volume).sort(chapterOrder)
  })).filter((group) => group.chapters.length)
  const unassigned = chapters.filter((chapter) => !chapterVolume.has(chapter.id)).sort(chapterOrder)
  if (unassigned.length) groups.push({ key: 'unassigned', volume: null, title: '未分卷', chapters: unassigned })
  return groups
}

export function projectChapterTree(
  chapters: Chapter[],
  query: string
): ChapterTreeProjection {
  const filtered = query.trim() ? chapters.filter((chapter) => chapterMatchesQuery(chapter, query)) : chapters
  return { items: filtered, total: filtered.length }
}
