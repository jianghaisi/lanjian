export type ChapterOpenCallbacks<T> = {
  /** Workspace identity plus the selection generation captured at the click. */
  isCurrent: () => boolean
  /** Workspace identity only: selecting the requested chapter changes selection. */
  isWorkspaceCurrent: () => boolean
  prepare: () => Promise<boolean>
  read: (chapterId: number) => Promise<T>
  select: (chapter: T) => Promise<void>
  isSelected: (chapterId: number) => boolean
  reveal: () => Promise<boolean>
}

/** Serialize intent, not I/O: the most recent open request owns navigation. */
export function createChapterOpenNavigation<T>() {
  let sequence = 0
  return {
    invalidate() { sequence += 1 },
    async open(chapterId: number, callbacks: ChapterOpenCallbacks<T>): Promise<boolean> {
      const request = ++sequence
      let selectionStarted = false
      const beforeSelection = () => request === sequence && callbacks.isCurrent()
      const afterSelection = () => request === sequence && callbacks.isWorkspaceCurrent() && callbacks.isSelected(chapterId)
      try {
        if (!beforeSelection()) return false
        const prepared = await callbacks.prepare()
        if (!prepared || !beforeSelection()) return false
        const chapter = await callbacks.read(chapterId)
        if (!beforeSelection()) return false
        selectionStarted = true
        // select/reveal retain their own guards for state they update internally
        // after awaits; this helper owns the boundaries between those operations.
        await callbacks.select(chapter)
        if (!afterSelection()) return false
        const revealed = await callbacks.reveal()
        return revealed && afterSelection()
      } catch (error) {
        // A failed superseded request must not surface an unrelated error toast.
        if (request !== sequence || !(selectionStarted ? callbacks.isWorkspaceCurrent() : callbacks.isCurrent())) return false
        throw error
      }
    }
  }
}
