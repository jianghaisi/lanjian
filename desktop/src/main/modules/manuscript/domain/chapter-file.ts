export type ChapterFileIdentity = { id: number; title: string }

const chapterFilePattern = /^第(\d+)章(?:[-－—_ ](.*))?\.md$/

export function parseChapterFileName(file: string): ChapterFileIdentity | null {
  const match = file.match(chapterFilePattern)
  if (!match) return null
  return { id: Number(match[1]), title: match[2] || `第${match[1]}章` }
}

export function summarizeChapterFiles(files: string[]): {
  chapterCount: number
  fileCount: number
  duplicateIds: number[]
} {
  const ids = files.map(parseChapterFileName).filter((item): item is ChapterFileIdentity => Boolean(item)).map((item) => item.id)
  const counts = new Map<number, number>()
  for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1)
  return {
    chapterCount: counts.size,
    fileCount: ids.length,
    duplicateIds: [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id).sort((a, b) => a - b)
  }
}
