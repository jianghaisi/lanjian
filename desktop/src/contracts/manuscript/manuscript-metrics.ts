export type ManuscriptMetrics = {
  wordCount: number
  paragraphCount: number
}

export function measureManuscript(content: string): ManuscriptMetrics {
  let wordCount = 0
  let insideAsciiWord = false
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index)
    const isCjk = code >= 0x3400 && code <= 0x9fff
    const isAsciiWord = (code >= 0x30 && code <= 0x39)
      || (code >= 0x41 && code <= 0x5a)
      || (code >= 0x61 && code <= 0x7a)
    if (isCjk) {
      wordCount += 1
      insideAsciiWord = false
    } else if (isAsciiWord) {
      if (!insideAsciiWord) wordCount += 1
      insideAsciiWord = true
    } else {
      insideAsciiWord = false
    }
  }

  const trimmed = content.trim()
  if (!trimmed) return { wordCount, paragraphCount: 0 }
  let paragraphCount = 1
  const separator = /\n\s*\n/g
  while (separator.exec(trimmed)) paragraphCount += 1
  return { wordCount, paragraphCount }
}

export function projectWordCountWithDraft(persistedProjectWords: number, persistedChapterWords: number, draftContent: string): number {
  const projectWords = Number.isFinite(persistedProjectWords) ? Math.max(0, Math.trunc(persistedProjectWords)) : 0
  const chapterWords = Number.isFinite(persistedChapterWords) ? Math.max(0, Math.trunc(persistedChapterWords)) : 0
  return Math.max(0, projectWords - chapterWords + measureManuscript(draftContent).wordCount)
}

export function countLinesBeforeOffset(content: string, offset: number): number {
  const end = Math.max(0, Math.min(content.length, offset))
  let line = 0
  for (let index = 0; index < end; index += 1) {
    if (content.charCodeAt(index) === 0x0a) line += 1
  }
  return line
}
