// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createManuscriptHistoryActions(ports) {
  async function openRevisions() {
    if (!ports.selectedId.value) return
    ports.revisions.value = await ports.guard(() => ports.desktop.chapters.revisions(ports.selectedId.value))
    ports.selectedRevisionId.value = ports.revisions.value[0]?.id || null
    ports.revisionViewMode.value = 'changes'
    ports.revisionLabelDraft.value = ports.revisions.value.find((item) => item.isCurrent)?.label || ''
    ports.showRevisions.value = true
  }

  async function nameCurrentRevision() {
    if (!ports.selectedId.value || !ports.revisionLabelDraft.value.trim()) return
    if (!(await ports.flushChapterSaveSafely())) return
    const named = await ports.guard(
      () => ports.desktop.chapters.nameCurrentRevision(ports.selectedId.value, ports.revisionLabelDraft.value.trim()),
      '当前正文版本已留下名称'
    )
    if (!named) return
    ports.revisions.value = await ports.desktop.chapters.revisions(ports.selectedId.value)
    ports.selectedRevisionId.value = named.id
    ports.revisionLabelDraft.value = named.label || ''
    ports.revisionViewMode.value = 'changes'
  }

  async function restoreRevision() {
    if (ports.chapterOrderIssue.value) return ports.notice('章节顺序账本待核对，历史版本当前仅供查看')
    const revision = ports.selectedRevision.value
    if (!ports.selectedId.value || !revision) return
    if (revision.isCurrent) return ports.notice('这就是当前正文，不需要恢复')
    if (
      !window.confirm(
        `确定恢复到 ${formatRevisionTime(revision.createdAt)} 的版本吗？当前编辑内容会先保存，并继续保留在历史版本中。`
      )
    )
      return
    if (!(await ports.flushChapterSaveSafely())) return
    const chapter = await ports.guard(
      () => ports.desktop.chapters.restoreRevision(ports.selectedId.value, revision.id),
      '历史版本已恢复，恢复前的正文也已备份'
    )
    if (!chapter) return
    ports.chapters.value = await ports.desktop.chapters.list()
    await ports.selectChapter(chapter)
  }

  function formatRevisionTime(value) {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(new Date(value))
  }

  function requestDeleteChapter(chapter = ports.selectedChapterRecord.value) {
    if (ports.chapterOrderIssue.value) return ports.notice('章节顺序账本待核对，暂不能移动或删除章节')
    if (!chapter) return
    ports.chapterDeleteTarget.value = chapter
    ports.showDeleteConfirm.value = true
  }

  async function deleteChapter() {
    const target = ports.chapterDeleteTarget.value
    if (!target) return
    const deletingCurrent = target.id === ports.selectedId.value
    if (deletingCurrent) {
      await ports.flushChapterSave()
      ports.clearAutosaveTimer()
    }
    await ports.guard(() => ports.desktop.chapters.delete(target.id), '章节已移入本书回收站')
    ports.showDeleteConfirm.value = false
    ports.chapterDeleteTarget.value = null
    ports.chapters.value = await ports.desktop.chapters.list()
    ports.chapterTrashEntries.value = await ports.desktop.chapters.trashList()
    if (deletingCurrent) {
      ports.selectedId.value = null
      ports.lastSavedChapter = { id: null, title: '', content: '', revision: null, bodyVersionId: null }
      const next =
        ports.chapters.value[Math.min(Math.max(target.position - 1, 0), Math.max(0, ports.chapters.value.length - 1))]
      next ? await ports.selectChapter(next) : (ports.selectedId.value = null)
    }
  }

  function cancelChapterDelete() {
    ports.showDeleteConfirm.value = false
    ports.chapterDeleteTarget.value = null
  }

  async function openChapterTrash() {
    ports.chapterTrashEntries.value = await ports.guard(() => ports.desktop.chapters.trashList())
    ports.chapterTrashOpen.value = true
  }

  async function restoreDeletedChapter(item) {
    if (ports.chapterOrderIssue.value) return ports.notice('章节顺序账本待核对，暂不能恢复章节')
    await ports.flushChapterSave()
    const restored = await ports.guard(
      () => ports.desktop.chapters.restore(item.id),
      `第 ${item.position} 章《${item.title}》已恢复`
    )
    ports.chapters.value = await ports.desktop.chapters.list()
    ports.chapterTrashEntries.value = await ports.desktop.chapters.trashList()
    ports.chapterTrashOpen.value = false
    const currentRecord = ports.chapters.value.find((chapter) => chapter.id === restored.id) ?? restored
    await ports.selectChapter(currentRecord)
  }

  function formatChapterTrashTime(value) {
    const time = new Date(value)
    if (!Number.isFinite(time.getTime())) return '删除时间未知'
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(time)
  }

  return {
    openRevisions,
    nameCurrentRevision,
    restoreRevision,
    formatRevisionTime,
    requestDeleteChapter,
    deleteChapter,
    cancelChapterDelete,
    openChapterTrash,
    restoreDeletedChapter,
    formatChapterTrashTime
  }
}
