export type QuickChapter = { id: number; title: string; position: number; wordCount: number }

export function searchQuickChapters(chapters: readonly QuickChapter[], query: string): QuickChapter[] {
  const normalized = query.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
  const number = normalized.match(/^(?:第\s*)?(\d+)\s*(?:章)?$/)?.[1]
  return chapters.filter(chapter => !normalized || (number
    ? chapter.position === Number(number)
    : chapter.title.normalize('NFKC').toLocaleLowerCase('zh-CN').includes(normalized)))
}

export function isQuickChapterShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing' | 'repeat' | 'defaultPrevented'>): boolean {
  return !event.defaultPrevented && !event.isComposing && !event.repeat && !event.altKey && !event.shiftKey
    && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p'
}
