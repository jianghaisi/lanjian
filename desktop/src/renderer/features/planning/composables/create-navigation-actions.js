// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createPlanningNavigationActions(ports) {
  async function openChapterOutlineReview(chapterId) {
    const chapter = ports.chapters.value.find((item) => item.id === chapterId)
    if (!chapter) return ports.notice('目标章节已经不存在，请重新选择')
    if (await openChapterFromOutlineCatalog(chapter)) ports.outlineInspectorOpen.value = true
  }

  async function openChapterFromOutlineCatalog(chapter) {
    if (!chapter) return false
    if (chapter.plannedOnly) return ports.openPlannedChapter(chapter.id)
    if (
      ports.active.value === 'outline' &&
      ports.outlineMode.value === 'chapter' &&
      ports.selectedId.value === chapter.id
    ) {
      ports.invalidateOutlineRead()
      return true
    }
    const generation = ++ports.outlineNavigationGeneration
    const book = ports.current.value?.path
    ports.outlineOpenError.value = ''
    ports.outlineLoading.value = `正在打开第 ${chapter.position} 章…`
    ports.retryOutlineOpen = () => openChapterFromOutlineCatalog(chapter)
    const isCurrent = () => generation === ports.outlineNavigationGeneration && book === ports.current.value?.path
    try {
      const target = ports.chapters.value.find((item) => item.id === chapter.id)
      if (!target) throw new Error('目标章节已变化，请重新选择。')
      return await ports.selectChapter(target, null, {
        isCurrent,
        commit: () => {
          ports.active.value = 'outline'
          ports.outlineMode.value = 'chapter'
        }
      })
    } catch (error) {
      if (isCurrent())
        ports.outlineOpenError.value = `第 ${chapter.position} 章未打开：${error?.message || '读取失败，请重试。'}`
      return false
    } finally {
      if (isCurrent()) ports.outlineLoading.value = ''
    }
  }

  return { openChapterOutlineReview, openChapterFromOutlineCatalog }
}
