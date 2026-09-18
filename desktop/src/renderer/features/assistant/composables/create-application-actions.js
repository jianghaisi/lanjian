import { isSameManuscriptSaveTarget } from '../../../../contracts/manuscript/manuscript-save-identity'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createAssistantApplicationActions(ports) {
  async function commitWritingAgentApplication({
    taskId,
    turnId = '',
    baseDraft,
    acceptedChangeIds = [],
    allowFailedReview = false,
    settleCharacters = false,
    successMessage,
    rebase = undefined
  }) {
    if (
      !ports.selectedId.value ||
      ports.lastSavedChapter.id !== ports.selectedId.value ||
      !ports.lastSavedChapter.revision
    ) {
      ports.notice('当前正文版本尚未稳定，请先保存后再采用候选')
      return false
    }
    ports.clearAutosaveTimer()
    const chapterId = ports.selectedId.value
    const workItemId = ports.current.value?.id
    const workItemPath = ports.current.value?.path
    const saveTarget = { workItemId, workItemPath, chapterId }
    const editorSnapshot = { title: ports.chapterTitle.value, content: baseDraft }
    const expectedRevision = ports.lastSavedChapter.revision
    const recoverySnapshot = ports.writeCurrentRecoverySnapshot()
    ports.saveState.value = 'saving'
    const operation = ports.manuscriptSaves.barrier(() =>
      ports.desktop.ai.applyWritingAgentArtifact({
        taskId,
        title: editorSnapshot.title,
        expectedRevision,
        ...(acceptedChangeIds.length ? { acceptedChangeIds: [...acceptedChangeIds] } : {}),
        ...(allowFailedReview ? { allowFailedReview: true } : {}),
        ...(rebase ? { rebase: { choices: { ...rebase.choices } } } : {}),
        formatting: {
          firstLineIndent: localStorage.getItem('lanjian-editor-first-line-indent') !== 'false',
          paragraphSpacing: localStorage.getItem('lanjian-editor-paragraph-spacing') !== 'false'
        }
      })
    )
    try {
      const result = await operation
      ports.syncWritingAgentTask(result.task)
      const chapter = result.chapter
      const index = ports.chapters.value.findIndex((item) => item.id === chapter.id)
      if (index >= 0) ports.chapters.value.splice(index, 1, chapter)
      if (
        !isSameManuscriptSaveTarget(saveTarget, {
          workItemId: ports.current.value?.id,
          workItemPath: ports.current.value?.path,
          chapterId: ports.selectedId.value
        })
      )
        return true
      ports.clearAutosaveFinalizeTimer()
      ports.activeAutosaveCheckpoint = null
      ports.lastSavedChapter = {
        id: chapter.id,
        title: chapter.title,
        content: chapter.content,
        revision: chapter.revision ?? null,
        bodyVersionId: chapter.bodyVersionId ?? null
      }
      ports.lastSavedAt.value = new Date()
      ports.manuscriptSaveError.value = null
      ports.manuscriptConflict.value = null
      const editorUnchanged =
        ports.chapterTitle.value === editorSnapshot.title && ports.chapterContent.value === editorSnapshot.content
      if (editorUnchanged) {
        ports.chapterTitle.value = chapter.title
        ports.chapterContent.value = chapter.content
        ports.saveState.value = 'saved'
        ports.pendingSaveReason = 'autosave'
        if (recoverySnapshot) ports.manuscriptRecoveryStore.clearIfSnapshotMatches(recoverySnapshot)
      } else {
        ports.saveState.value = 'dirty'
        ports.scheduleAutosave()
      }
      const settlementKey = `${workItemId}::${chapterId}`
      const nextSources = { ...ports.pendingAiSourceTaskIds.value }
      const nextSettlements = { ...ports.pendingCharacterSettlements.value }
      delete nextSources[settlementKey]
      delete nextSettlements[settlementKey]
      ports.pendingAiSourceTaskIds.value = nextSources
      ports.pendingCharacterSettlements.value = nextSettlements
      if (turnId) ports.writingAgentTurns.value = ports.writingAgentTurns.value.filter((item) => item.id !== turnId)
      ports.manuscriptSelection.value = null
      ports.manuscriptInsertionAnchor.value = null
      if (settleCharacters && turnId) {
        try {
          await ports.desktop.ai.settleWritingAgent(turnId)
          await ports.refreshWorkflow()
        } catch (error) {
          ports.notice(`正文已保存；人物状态稍后重试：${error?.message || '状态结算失败'}`)
        }
      }
      ports.notice(editorUnchanged ? successMessage : `${successMessage}；你在结算期间的新输入仍保留，等待自动保存`)
      return true
    } catch (error) {
      if (
        isSameManuscriptSaveTarget(saveTarget, {
          workItemId: ports.current.value?.id,
          workItemPath: ports.current.value?.path,
          chapterId: ports.selectedId.value
        })
      ) {
        ports.saveState.value = 'error'
        ports.manuscriptSaveError.value = {
          workItemId,
          workItemPath,
          chapterId,
          message: error?.message || '候选结算失败，正文和候选均未改变'
        }
      }
      ports.notice(error?.message || '候选结算失败，正文和候选均未改变，可以直接重试')
      return false
    }
  }

  return { commitWritingAgentApplication }
}
