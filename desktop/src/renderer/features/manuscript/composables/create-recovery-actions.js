import { isSameManuscriptSaveTarget } from '../../../../contracts/manuscript/manuscript-save-identity'
import { recoveryDraftMatchesActiveEditor } from '../services/manuscript-recovery-store'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createManuscriptRecoveryActions(ports) {
  function applyManuscriptRecoveries(sqliteDrafts, workItemId) {
    const localDrafts = ports.manuscriptRecoveryStore.list(workItemId).filter((draft) => {
      const chapter = ports.chapters.value.find((item) => item.id === draft.chapterId)
      if (!chapter || chapter.title !== draft.title || chapter.content !== draft.content) return true
      ports.manuscriptRecoveryStore.discard(workItemId, draft.chapterId)
      return false
    })
    const sqliteContentKeys = new Set(
      sqliteDrafts.map((item) => `${item.chapterId}\u0000${item.title}\u0000${item.content}`)
    )
    const currentById = new Map(ports.chapters.value.map((chapter) => [chapter.id, chapter]))
    // A recovery snapshot is also the crash-safety copy of the text that is
    // currently open. Background checkpoint finalization must not turn that
    // normal in-session snapshot into a modal interruption. Keep the snapshot
    // on disk/localStorage; only hide it until the editor no longer owns the
    // same text (for example after reopening the app or switching work items).
    const activeEditorDraft = {
      chapterId: ports.selectedId.value,
      title: ports.chapterTitle.value,
      content: ports.chapterContent.value
    }
    const isCurrentEditorDraft = (draft) => recoveryDraftMatchesActiveEditor(draft, activeEditorDraft)
    const toDialogItem = (draft, source) => {
      const currentChapter = currentById.get(draft.chapterId) || {
        id: draft.chapterId,
        position: draft.chapterId,
        title: '',
        content: '',
        revision: null
      }
      const baseChanged =
        source === 'renderer' &&
        draft.baseRevision &&
        currentChapter.revision &&
        draft.baseRevision !== currentChapter.revision
      return {
        id: `${source}:${draft.id || `${draft.workItemId}:${draft.chapterId}`}`,
        checkpointId: source === 'sqlite' ? draft.id : null,
        localOperationId: source === 'renderer' ? draft.operationId : null,
        chapterId: draft.chapterId,
        chapterPosition: currentChapter.position,
        chapterTitle: currentChapter.title,
        source,
        updatedAt: draft.updatedAt,
        draftTitle: draft.title,
        draftContent: draft.content,
        currentTitle: currentChapter.title,
        currentContent: currentChapter.content,
        status: draft.status === 'conflict' || baseChanged ? 'conflict' : 'recoverable'
      }
    }
    ports.manuscriptRecoveryItems.value = [
      ...sqliteDrafts.filter((draft) => !isCurrentEditorDraft(draft)).map((draft) => toDialogItem(draft, 'sqlite')),
      ...localDrafts
        .filter((draft) => !sqliteContentKeys.has(`${draft.chapterId}\u0000${draft.title}\u0000${draft.content}`))
        .filter((draft) => !isCurrentEditorDraft(draft))
        .map((draft) => toDialogItem(draft, 'renderer'))
    ]
  }

  async function restoreManuscriptRecovery(item) {
    if (!ports.current.value || ports.manuscriptRecoveryBusyId.value) return
    ports.manuscriptRecoveryBusyId.value = item.id
    try {
      if (item.source === 'sqlite' && item.status !== 'conflict' && item.checkpointId) {
        const result = await ports.desktop.chapters.finalizeAutosave(item.checkpointId)
        if (result.checkpoint?.status === 'conflict') throw new Error('正式稿已经变化，请核对后恢复为新版本')
        const index = ports.chapters.value.findIndex((chapter) => chapter.id === result.chapter.id)
        if (index >= 0) ports.chapters.value.splice(index, 1, result.chapter)
        if (ports.selectedId.value === result.chapter.id) await ports.selectChapter(result.chapter)
      } else {
        const currentChapter = ports.chapters.value.find((chapter) => chapter.id === item.chapterId)
        const restored = await ports.desktop.chapters.update(item.chapterId, {
          title: item.draftTitle,
          content: item.draftContent,
          reason: 'restore',
          ...(currentChapter?.revision ? { expectedRevision: currentChapter.revision } : {}),
          workItemId: ports.current.value.id,
          workItemPath: ports.current.value.path
        })
        const index = ports.chapters.value.findIndex((chapter) => chapter.id === restored.id)
        if (index >= 0) ports.chapters.value.splice(index, 1, restored)
        if (item.checkpointId) await ports.desktop.chapters.discardAutosaveRecovery(item.checkpointId).catch(() => null)
        ports.manuscriptRecoveryStore.discard(ports.current.value.id, item.chapterId)
        if (ports.selectedId.value === restored.id) {
          ports.clearAutosaveFinalizeTimer()
          ports.activeAutosaveCheckpoint = null
          ports.stagedRecoverySnapshot = null
          ports.lastSavedChapter = {
            id: restored.id,
            title: restored.title,
            content: restored.content,
            revision: restored.revision ?? null,
            bodyVersionId: restored.bodyVersionId ?? null
          }
          ports.suppressManuscriptAutosave = true
          ports.chapterTitle.value = restored.title
          ports.chapterContent.value = restored.content
          ports.suppressManuscriptAutosave = false
          ports.saveState.value = 'saved'
          ports.lastSavedAt.value = new Date()
        }
      }
      ports.manuscriptRecoveryStore.discard(ports.current.value.id, item.chapterId)
      await ports.refreshManuscriptRecoveries()
      ports.notice('恢复稿已作为新版本写入，原有版本仍然保留')
    } catch (error) {
      ports.notice(error?.message || '恢复失败，草稿仍然保留')
    } finally {
      ports.manuscriptRecoveryBusyId.value = ''
    }
  }

  async function discardManuscriptRecovery(item) {
    if (!ports.current.value || ports.manuscriptRecoveryBusyId.value) return
    ports.manuscriptRecoveryBusyId.value = item.id
    try {
      if (item.checkpointId) await ports.desktop.chapters.discardAutosaveRecovery(item.checkpointId)
      ports.manuscriptRecoveryStore.discard(ports.current.value.id, item.chapterId)
      if (ports.activeAutosaveCheckpoint?.id === item.checkpointId) {
        ports.clearAutosaveFinalizeTimer()
        ports.activeAutosaveCheckpoint = null
        ports.stagedRecoverySnapshot = null
      }
      await ports.refreshManuscriptRecoveries()
      ports.notice('这份恢复草稿已丢弃，正式正文没有变化')
    } finally {
      ports.manuscriptRecoveryBusyId.value = ''
    }
  }

  async function backupDraftAndReloadExternal() {
    const conflict = ports.manuscriptConflict.value
    const id = ports.selectedId.value
    if (
      !conflict ||
      !id ||
      !isSameManuscriptSaveTarget(conflict, {
        workItemId: ports.current.value?.id,
        workItemPath: ports.current.value?.path,
        chapterId: id
      })
    )
      return
    await ports.manuscriptEditor.value?.flush?.()
    if (!window.confirm('岚笺会先把当前草稿另存为项目内的恢复副本，再载入磁盘版本。确认继续吗？')) return
    try {
      const recovery = await ports.desktop.chapters.preserveDraft(id, {
        title: ports.chapterTitle.value,
        content: ports.chapterContent.value,
        workItemId: ports.current.value?.id,
        workItemPath: ports.current.value?.path,
        ...(ports.lastSavedChapter.revision ? { baseRevision: ports.lastSavedChapter.revision } : {})
      })
      if (conflict.reason === 'missing') {
        ports.notice(`草稿已保存在 ${recovery.recoveryRelativePath}；原正文仍不存在，请在文件管理器中核对后再继续。`)
        return
      }
      const external = await ports.desktop.chapters.get(id)
      if (
        !isSameManuscriptSaveTarget(conflict, {
          workItemId: ports.current.value?.id,
          workItemPath: ports.current.value?.path,
          chapterId: ports.selectedId.value
        })
      )
        return
      const index = ports.chapters.value.findIndex((item) => item.id === id)
      if (index >= 0) ports.chapters.value.splice(index, 1, external)
      ports.suppressManuscriptAutosave = true
      ports.chapterTitle.value = external.title
      ports.chapterContent.value = external.content
      ports.suppressManuscriptAutosave = false
      ports.lastSavedChapter = {
        id,
        title: external.title,
        content: external.content,
        revision: external.revision ?? null,
        bodyVersionId: external.bodyVersionId ?? null
      }
      ports.lastSavedAt.value = new Date()
      ports.saveState.value = 'saved'
      ports.manuscriptSaveError.value = null
      ports.manuscriptConflict.value = null
      ports.notice(`本地草稿已备份到 ${recovery.recoveryRelativePath}，现已载入磁盘版本。`)
    } catch (error) {
      ports.notice(error?.message || '草稿恢复副本未能建立；当前草稿仍保留在编辑器中')
    }
  }

  async function recoverExternalMarkdownMirror() {
    const chapterId = ports.selectedId.value
    if (!chapterId || !ports.current.value) return
    const workItemId = ports.current.value.id
    let recoverySnapshot = null
    if (ports.chapterIsDirty()) {
      recoverySnapshot = ports.writeCurrentRecoverySnapshot()
      if (!recoverySnapshot) return ports.notice('当前未保存文字无法建立恢复副本，请先复制正文后再处理 Markdown。')
    }
    try {
      const preview = await ports.desktop.chapters.previewExternalMirror(chapterId)
      if (ports.current.value?.id !== workItemId || ports.selectedId.value !== chapterId) return
      const dirtyNote = recoverySnapshot ? '\n\n当前编辑器里的未保存文字已另存为恢复草稿，不会丢失。' : ''
      const accepted = window.confirm(
        `核对正文修订：\n\n上次固定的版本：${preview.sqliteCharacterCount.toLocaleString()} 字符\n${preview.sqliteExcerpt}\n\n当前 Markdown 文件：${preview.externalCharacterCount.toLocaleString()} 字符\n${preview.externalExcerpt}${dirtyNote}\n\n确认后，当前 Markdown 会登记为新版本；原版本仍保留在“历史版本”中。是否继续？`
      )
      if (!accepted) return
      const reviewedDraft = { title: ports.chapterTitle.value, content: ports.chapterContent.value }
      const result = await ports.desktop.chapters.adoptExternalMirror(preview.token)
      if (ports.current.value?.id !== workItemId || ports.selectedId.value !== chapterId) return
      ports.clearAutosaveTimer()
      ports.clearAutosaveFinalizeTimer()
      const chapter = result.chapter
      const editedDuringAdoption =
        ports.chapterTitle.value !== reviewedDraft.title || ports.chapterContent.value !== reviewedDraft.content
      const index = ports.chapters.value.findIndex((item) => item.id === chapterId)
      if (index >= 0) ports.chapters.value.splice(index, 1, chapter)
      ports.lastSavedChapter = {
        id: chapter.id,
        title: chapter.title,
        content: chapter.content,
        revision: chapter.revision ?? null,
        bodyVersionId: chapter.bodyVersionId ?? null
      }
      ports.activeAutosaveCheckpoint = null
      ports.stagedRecoverySnapshot = null
      if (!editedDuringAdoption) {
        ports.suppressManuscriptAutosave = true
        ports.chapterTitle.value = chapter.title
        ports.chapterContent.value = chapter.content
        ports.suppressManuscriptAutosave = false
      } else ports.writeCurrentRecoverySnapshot()
      ports.saveState.value = editedDuringAdoption ? 'dirty' : 'saved'
      ports.manuscriptSaveError.value = null
      ports.manuscriptConflict.value = null
      ports.lastSavedAt.value = new Date()
      ports.notice(
        `Markdown 正文已登记为新版本；原稿仍在历史版本中。${result.mirrorPending ? ' 正式稿已保存，Markdown 文件仍需核对，请勿重复恢复。' : ''}${recoverySnapshot ? ' 未保存文字也已保留为恢复草稿。' : ''}${editedDuringAdoption ? ' 采用期间新增的文字仍留在编辑器中，待您保存。' : ''}`
      )
      const planning = await ports.desktop.chapters.getPlanning(chapterId).catch(() => null)
      if (
        ports.current.value?.id === workItemId &&
        ports.selectedId.value === chapterId &&
        ports.lastSavedChapter.bodyVersionId === chapter.bodyVersionId
      )
        ports.chapterPlanning.value = planning
    } catch (error) {
      ports.notice(error?.message || '未能恢复 Markdown 正文，两份内容都没有被覆盖')
    }
  }

  async function flushChapterSave() {
    if (!ports.current.value || !ports.selectedId.value) return
    const request = ports.workspaceRequests.capture(ports.current.value)
    const chapterId = ports.selectedId.value
    const generation = ports.chapterSelectionGeneration
    const editor = ports.manuscriptEditor.value
    const assertCurrent = () => {
      if (!ports.workspaceRequests.isCurrent(request, ports.current.value) ||
        chapterId !== ports.selectedId.value || generation !== ports.chapterSelectionGeneration ||
        editor !== ports.manuscriptEditor.value) throw new Error('编辑文档已变化，请重新执行刚才的操作。')
    }
    await editor?.flush?.()
    assertCurrent()
    ports.clearAutosaveTimer()
    await ports.manuscriptSaves.idle()
    assertCurrent()
    if (ports.chapterIsDirty()) await ports.persistChapter(ports.pendingSaveReason)
    assertCurrent()
    await ports.manuscriptSaves.idle()
    assertCurrent()
    if (ports.activeAutosaveCheckpoint) await ports.finalizeAutosaveCheckpoint()
    assertCurrent()
    await ports.manuscriptSaves.idle()
    assertCurrent()
    // Waiting for the queue does not include text still buffered by the editor.
    await editor?.flush?.()
    assertCurrent()
    if (ports.chapterIsDirty() || ports.activeAutosaveCheckpoint)
      throw new Error('保存期间正文又有新修改，已保留当前输入，请再次执行刚才的操作。')
  }

  async function flushChapterSaveSafely() {
    try {
      await flushChapterSave()
      return true
    } catch (error) {
      ports.notice(error?.message || '保存失败，已保留当前章节和草稿')
      return false
    }
  }

  return {
    applyManuscriptRecoveries,
    restoreManuscriptRecovery,
    discardManuscriptRecovery,
    backupDraftAndReloadExternal,
    recoverExternalMarkdownMirror,
    flushChapterSave,
    flushChapterSaveSafely
  }
}
