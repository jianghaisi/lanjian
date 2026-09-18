import { isQuickChapterShortcut } from '../services/quick-chapter-search'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createManuscriptNavigationActions(ports) {
  function openQuickChapterSearch() {
    if (
      !ports.current.value ||
      ports.opening.value ||
      ports.workspaceOpening.value ||
      document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')
    )
      return
    ports.quickChapterOpen.value?.open()
  }

  function handleQuickChapterShortcut(event) {
    if (!isQuickChapterShortcut(event) || !ports.current.value || ports.opening.value || ports.workspaceOpening.value)
      return
    if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return
    event.preventDefault()
    openQuickChapterSearch()
  }

  async function openQuickChapter(id) {
    if (!ports.current.value || !ports.worldMapWorkspace.canLeave()) return false
    const request = ports.workspaceRequests.capture(ports.current.value)
    const selectionGeneration = ports.chapterSelectionGeneration
    const isWorkspaceCurrent = () => ports.workspaceRequests.isCurrent(request, ports.current.value)
    const isCurrent = () => isWorkspaceCurrent() && selectionGeneration === ports.chapterSelectionGeneration
    return ports.chapterOpenNavigation.open(id, {
      isCurrent,
      isWorkspaceCurrent,
      prepare: async () => {
        if (!(await ports.flushChapterSaveSafely()) || !isCurrent()) return false
        if (!(await ports.flushPlannedChapterSave()) || !isCurrent()) return false
        await ports.flushPlanningDraftSave()
        return isCurrent()
      },
      read: (chapterId) => ports.desktop.chapters.get(chapterId),
      select: (chapter) => ports.selectChapter(chapter, request),
      isSelected: (chapterId) => ports.selectedId.value === chapterId,
      reveal: async () => {
        await ports.selectActivity('desk')
        return ports.active.value === 'desk'
      }
    })
  }

  return { openQuickChapterSearch, handleQuickChapterShortcut, openQuickChapter }
}
