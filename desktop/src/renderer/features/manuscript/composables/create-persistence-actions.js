import {
  isSameManuscriptDraft,
  isSameManuscriptSaveTarget
} from '../../../../contracts/manuscript/manuscript-save-identity'
import { supersededSave } from '../services/manuscript-save-queue'
import { measureManuscript } from '../../../../contracts/manuscript/manuscript-metrics'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createManuscriptPersistenceActions(ports) {
  let savedInfoSequence = 0

  async function refreshSavedChapterInfo() {
    const saved = ports.lastSavedChapter
    if (!ports.current.value || !saved.id || saved.id !== ports.selectedId.value) return false
    const request = ports.workspaceRequests.capture(ports.current.value)
    const generation = ports.chapterSelectionGeneration
    const sequence = ++savedInfoSequence
    try {
      const loaded = await ports.desktop.chapters.get(saved.id)
      if (
        sequence !== savedInfoSequence || generation !== ports.chapterSelectionGeneration ||
        !ports.workspaceRequests.isCurrent(request, ports.current.value) ||
        ports.selectedId.value !== saved.id || ports.lastSavedChapter !== saved ||
        loaded.id !== saved.id || loaded.revision !== saved.revision ||
        loaded.bodyVersionId !== saved.bodyVersionId || !isSameManuscriptDraft(loaded, saved)
      ) return false
      const index = ports.chapters.value.findIndex(item => item.id === saved.id && item.revision === saved.revision)
      if (index < 0) return false
      // Only file metadata belongs to this read; newer input and catalog edits stay intact.
      ports.chapters.value.splice(index, 1, { ...ports.chapters.value[index], storageMode: loaded.storageMode, mirrorStatus: loaded.mirrorStatus })
      return true
    } catch {
      return false
    }
  }

  async function newChapter() {
    if (ports.chapterOrderIssue.value) return ports.notice('章节顺序账本待核对，暂不能新建章节')
    if (!(await ports.prepareOutlineLeave())) return
    if (!(await ports.flushPlannedChapterSave()) || !(await ports.flushChapterSaveSafely())) return
    const chapter = await ports.guard(() => ports.desktop.chapters.create(), '新章节已建立')
    if (!chapter) return
    ports.chapters.value = await ports.desktop.chapters.list()
    await ports.selectChapter(chapter)
  }

  async function saveChapter() {
    if (ports.chapterOrderIssue.value) return ports.notice('章节顺序账本待核对，当前正文仅供查看')
    try {
      await ports.manuscriptEditor.value?.flush?.()
      await persistChapter(ports.pendingSaveReason === 'ai' ? 'ai' : 'manual', true)
    } catch (error) {
      ports.notice(error?.message || '保存失败，草稿仍保留在当前章节')
    }
  }

  function chapterIsDirty() {
    return Boolean(
      ports.selectedId.value &&
        (ports.lastSavedChapter.id !== ports.selectedId.value ||
          ports.lastSavedChapter.title !== ports.chapterTitle.value ||
          ports.lastSavedChapter.content !== ports.chapterContent.value)
    )
  }

  function clearAutosaveTimer() {
    if (ports.autosaveTimer) window.clearTimeout(ports.autosaveTimer)
    ports.autosaveTimer = null
  }

  function clearAutosaveFinalizeTimer() {
    if (ports.autosaveFinalizeTimer) window.clearTimeout(ports.autosaveFinalizeTimer)
    ports.autosaveFinalizeTimer = null
  }

  function writeCurrentRecoverySnapshot() {
    if (!ports.current.value?.id || !ports.selectedId.value || !chapterIsDirty()) return null
    try {
      return ports.manuscriptRecoveryStore.write({
        workItemId: ports.current.value.id,
        chapterId: ports.selectedId.value,
        title: ports.chapterTitle.value,
        content: ports.chapterContent.value,
        baseRevision: ports.lastSavedChapter.revision ?? null
      })
    } catch {
      return null
    }
  }

  function scheduleCheckpointFinalization(checkpoint) {
    clearAutosaveFinalizeTimer()
    if (!checkpoint || checkpoint.status !== 'staged') return
    const delay = Math.max(0, Date.parse(checkpoint.windowEndsAt) - Date.now())
    const timer = window.setTimeout(
      () => {
        if (ports.autosaveFinalizeTimer === timer) ports.autosaveFinalizeTimer = null
        finalizeAutosaveCheckpoint(checkpoint).catch(() => ports.notice('恢复草稿仍在，正式版本暂未落盘'))
      },
      Math.min(delay, 2_147_483_647)
    )
    ports.autosaveFinalizeTimer = timer
  }

  function scheduleAutosave() {
    if (ports.chapterOrderIssue.value || ports.suppressManuscriptAutosave) return
    clearAutosaveTimer()
    if (!chapterIsDirty()) {
      ports.saveState.value = ports.activeAutosaveCheckpoint ? 'checkpoint' : 'saved'
      ports.manuscriptSaveError.value = null
      if (ports.pendingSaveReason === 'ai' && ports.current.value?.id && ports.selectedId.value) {
        const key = `${ports.current.value.id}::${ports.selectedId.value}`
        const nextSources = { ...ports.pendingAiSourceTaskIds.value }
        const nextSettlements = { ...ports.pendingCharacterSettlements.value }
        delete nextSources[key]
        delete nextSettlements[key]
        ports.pendingAiSourceTaskIds.value = nextSources
        ports.pendingCharacterSettlements.value = nextSettlements
        ports.pendingSaveReason = 'autosave'
      }
      return
    }
    writeCurrentRecoverySnapshot()
    if (ports.bookProfile.value.autosaveEnabled === false) {
      ports.saveState.value = 'local'
      return
    }
    ports.saveState.value = ports.manuscriptSaveError.value ? 'error' : 'dirty'
    ports.autosaveTimer = window.setTimeout(
      () => {
        persistChapter(ports.pendingSaveReason).catch(() => ports.notice('自动保存失败，正文仍保留在编辑器中，请重试'))
      },
      Math.max(250, Number(ports.bookProfile.value.autosaveDelayMs) || 1500)
    )
  }

  async function persistChapter(reason = 'autosave', announce = false) {
    if (ports.chapterOrderIssue.value) return null
    // Finish an expired merge window before staging the next one. Without this
    // ordering, two timers landing in the same event-loop turn can create a new
    // checkpoint on the old body version just before the previous one advances it.
    if (
      reason === 'autosave' &&
      ports.activeAutosaveCheckpoint &&
      Date.parse(ports.activeAutosaveCheckpoint.windowEndsAt) <= Date.now()
    ) {
      await finalizeAutosaveCheckpoint(ports.activeAutosaveCheckpoint)
    }
    clearAutosaveTimer()
    const id = ports.selectedId.value
    if (!id || (!chapterIsDirty() && !(reason !== 'autosave' && ports.activeAutosaveCheckpoint))) return null
    const previousChapter = ports.chapters.value.find(item => item.id === id)
    if (!previousChapter || !ports.current.value) return null
    const request = ports.workspaceRequests.capture(ports.current.value)
    const workItemId = ports.current.value?.id
    const workItemPath = ports.current.value?.path
    const saveTarget = { workItemId, workItemPath, chapterId: id }
    const settlementKey = workItemId ? `${workItemId}::${id}` : ''
    const settlementJobId =
      reason === 'ai' && settlementKey ? ports.pendingCharacterSettlements.value[settlementKey] : null
    const sourceTaskRunId = reason === 'ai' && settlementKey ? ports.pendingAiSourceTaskIds.value[settlementKey] : null
    const snapshot = {
      title: ports.chapterTitle.value,
      content: ports.chapterContent.value,
      reason,
      ...(sourceTaskRunId ? { sourceTaskRunId } : {}),
      workItemId,
      workItemPath
    }
    const recoverySnapshot = ports.manuscriptRecoveryStore.read(workItemId, id) || writeCurrentRecoverySnapshot()
    ports.saveState.value = 'saving'
    const reviewEditor = ports.manuscriptEditor.value
    const operation = ports.manuscriptSaves.enqueue(
      async () => {
        const reviewed = await reviewEditor?.saveReviewedDraft?.(snapshot)
        if (reviewed) {
          const saved = reviewed.snapshot
          const chapter = { ...previousChapter, title: saved.title, content: saved.content,
            revision: saved.revision, bodyVersionId: saved.versionId,
            word_count: measureManuscript(saved.content).wordCount, mirrorStatus: undefined }
          return { storageMode: chapter.storageMode, checkpoint: null, chapter, reviewed: true }
        }
        if (reason === 'autosave') {
          return ports.desktop.chapters.stageAutosave(id, {
            title: snapshot.title,
            content: snapshot.content,
            clientOperationId: recoverySnapshot?.operationId || crypto.randomUUID(),
            ...(ports.lastSavedChapter.id === id && ports.lastSavedChapter.bodyVersionId
              ? { baseBodyVersionId: ports.lastSavedChapter.bodyVersionId }
              : {}),
            ...(ports.lastSavedChapter.id === id && ports.lastSavedChapter.revision
              ? { expectedRevision: ports.lastSavedChapter.revision }
              : {}),
            mergeWindowMs: Math.max(1000, Number(ports.bookProfile.value.autosaveMergeWindowMs) || 30000),
            workItemId,
            workItemPath
          })
        }
        const chapter = await ports.desktop.chapters.update(id, {
          ...snapshot,
          ...(ports.lastSavedChapter.id === id && ports.lastSavedChapter.revision
            ? { expectedRevision: ports.lastSavedChapter.revision }
            : {})
        })
        return { storageMode: chapter.storageMode || 'files', checkpoint: null, chapter, insertedVersion: true }
      },
      reason === 'autosave' ? JSON.stringify([workItemId, workItemPath, id]) : undefined
    )
    try {
      const result = await operation
      if (result === supersededSave) return null
      const chapter = result.chapter
      const currentTarget = ports.workspaceRequests.isCurrent(request, ports.current.value) && isSameManuscriptSaveTarget(saveTarget, {
        workItemId: ports.current.value?.id,
        workItemPath: ports.current.value?.path,
        chapterId: ports.selectedId.value
      })
      if (!currentTarget) return chapter
      const index = ports.chapters.value.findIndex((item) => item.id === chapter.id)
      if (index >= 0) ports.chapters.value.splice(index, 1, result.reviewed
        ? { ...ports.chapters.value[index], title: chapter.title, content: chapter.content, revision: chapter.revision,
            bodyVersionId: chapter.bodyVersionId, word_count: chapter.word_count, mirrorStatus: undefined }
        : chapter)
      const confirmed = result.reviewed ? chapter : snapshot
      if (ports.selectedId.value === id) {
        if (reason === 'autosave' && result.storageMode === 'sqlite' && result.checkpoint) {
          ports.activeAutosaveCheckpoint = result.checkpoint
          ports.stagedRecoverySnapshot = recoverySnapshot
          ports.lastSavedChapter = {
            ...ports.lastSavedChapter,
            id,
            title: snapshot.title,
            content: snapshot.content,
            revision: chapter.revision ?? ports.lastSavedChapter.revision,
            bodyVersionId: chapter.bodyVersionId ?? ports.lastSavedChapter.bodyVersionId
          }
          ports.lastSavedAt.value = new Date(result.checkpoint.updatedAt)
          if (result.checkpoint.status === 'conflict') {
            ports.saveState.value = 'local'
            ports.manuscriptSaveError.value = {
              workItemId,
              workItemPath,
              chapterId: id,
              message: '正式正文已变化；恢复草稿已保留，请比较后再决定。'
            }
            await ports.refreshManuscriptRecoveries()
            return chapter
          }
          ports.saveState.value = 'checkpoint'
          ports.manuscriptSaveError.value = null
          ports.manuscriptConflict.value = null
          scheduleCheckpointFinalization(result.checkpoint)
        } else {
          clearAutosaveFinalizeTimer()
          ports.activeAutosaveCheckpoint = null
          ports.lastSavedChapter = {
            id,
            title: confirmed.title,
            content: confirmed.content,
            revision: chapter.revision ?? null,
            bodyVersionId: chapter.bodyVersionId ?? null
          }
          ports.lastSavedAt.value = new Date()
          if (recoverySnapshot) ports.manuscriptRecoveryStore.clearIfSnapshotMatches(recoverySnapshot)
        }
        if (isSameManuscriptDraft(confirmed, { title: ports.chapterTitle.value, content: ports.chapterContent.value })) {
          if (!(reason === 'autosave' && result.storageMode === 'sqlite' && result.checkpoint))
            ports.saveState.value = 'saved'
          ports.manuscriptSaveError.value = null
          ports.manuscriptConflict.value = null
          ports.pendingSaveReason = 'autosave'
          if (sourceTaskRunId) {
            const nextSources = { ...ports.pendingAiSourceTaskIds.value }
            delete nextSources[settlementKey]
            ports.pendingAiSourceTaskIds.value = nextSources
          }
        } else {
          ports.saveState.value = 'dirty'
          scheduleAutosave()
        }
      }
      if (result.reviewed) void refreshSavedChapterInfo()
      if (settlementJobId) {
        try {
          if (settlementJobId.kind === 'writingAgent') await ports.desktop.ai.settleWritingAgent(settlementJobId.id)
          const next = { ...ports.pendingCharacterSettlements.value }
          delete next[settlementKey]
          ports.pendingCharacterSettlements.value = next
          await ports.refreshWorkflow()
        } catch (error) {
          ports.notice(`正文已保存；后续状态未结算：${error?.message || '请稍后重试'}`)
        }
      }
      if (announce) ports.notice(ports.desktop?.app?.platform === 'browser' ? '章节已保存到账户书库' : '章节已保存到本地')
      return chapter
    } catch (error) {
      if (
        ports.workspaceRequests.isCurrent(request, ports.current.value) && isSameManuscriptSaveTarget(saveTarget, {
          workItemId: ports.current.value?.id,
          workItemPath: ports.current.value?.path,
          chapterId: ports.selectedId.value
        })
      ) {
        ports.saveState.value = 'error'
        const details = error?.details && typeof error.details === 'object' ? error.details : null
        const isConflict = error?.code === 'CONFLICT' && details?.area === 'manuscript'
        ports.manuscriptSaveError.value = {
          workItemId,
          workItemPath,
          chapterId: id,
          message: isConflict
            ? error?.message || '磁盘正文已变化，未覆盖外部版本'
            : `${error?.message || '写入失败'}；草稿仍在当前窗口，请重试保存`
        }
        ports.manuscriptConflict.value = isConflict
          ? {
              reason: details.reason,
              externalChapter: details.externalChapter || null,
              expectedRevision: details.expectedRevision || '',
              workItemId,
              workItemPath,
              chapterId: id
            }
          : null
      }
      throw error
    }
  }

  async function finalizeAutosaveCheckpoint(checkpoint = ports.activeAutosaveCheckpoint) {
    if (!checkpoint) return null
    if (ports.activeAutosaveCheckpoint?.id === checkpoint.id) clearAutosaveFinalizeTimer()
    const saveTarget = {
      workItemId: ports.current.value?.id,
      workItemPath: ports.current.value?.path,
      chapterId: checkpoint.chapterId
    }
    const operation = ports.manuscriptSaves.barrier(() => ports.desktop.chapters.finalizeAutosave(checkpoint.id))
    const result = await operation
    if (result.checkpoint?.status === 'conflict') {
      ports.saveState.value = 'local'
      ports.manuscriptSaveError.value = { ...saveTarget, message: '正式正文已变化；恢复草稿没有覆盖新版本。' }
      await ports.refreshManuscriptRecoveries()
      throw new Error('自动保存检查点与当前正式版本冲突')
    }
    const chapter = result.chapter
    const index = ports.chapters.value.findIndex((item) => item.id === chapter.id)
    if (index >= 0) ports.chapters.value.splice(index, 1, chapter)
    if (
      isSameManuscriptSaveTarget(saveTarget, {
        workItemId: ports.current.value?.id,
        workItemPath: ports.current.value?.path,
        chapterId: ports.selectedId.value
      })
    ) {
      ports.lastSavedChapter = {
        id: chapter.id,
        title: checkpoint.title,
        content: checkpoint.content,
        revision: chapter.revision ?? null,
        bodyVersionId: chapter.bodyVersionId ?? null
      }
      ports.lastSavedAt.value = new Date()
      const ownsActiveCheckpoint = ports.activeAutosaveCheckpoint?.id === checkpoint.id
      if (ownsActiveCheckpoint && ports.stagedRecoverySnapshot)
        ports.manuscriptRecoveryStore.clearIfSnapshotMatches(ports.stagedRecoverySnapshot)
      if (ownsActiveCheckpoint) {
        ports.stagedRecoverySnapshot = null
        ports.activeAutosaveCheckpoint = null
      }
      ports.manuscriptSaveError.value = null
      ports.saveState.value = ports.activeAutosaveCheckpoint ? 'checkpoint' : chapterIsDirty() ? 'dirty' : 'saved'
      if (!ports.activeAutosaveCheckpoint && chapterIsDirty()) scheduleAutosave()
    }
    await ports.refreshManuscriptRecoveries()
    return chapter
  }

  function flushManuscriptWhenInactive() {
    if (
      ports.active.value !== 'desk' ||
      !ports.selectedId.value ||
      (!chapterIsDirty() && !ports.activeAutosaveCheckpoint)
    )
      return
    void ports.flushChapterSaveSafely()
  }

  function handleDocumentVisibilityChange() {
    if (document.visibilityState === 'hidden') flushManuscriptWhenInactive()
  }

  return {
    refreshSavedChapterInfo,
    newChapter,
    saveChapter,
    chapterIsDirty,
    clearAutosaveTimer,
    clearAutosaveFinalizeTimer,
    writeCurrentRecoverySnapshot,
    scheduleCheckpointFinalization,
    scheduleAutosave,
    persistChapter,
    finalizeAutosaveCheckpoint,
    flushManuscriptWhenInactive,
    handleDocumentVisibilityChange
  }
}
