import { isSameManuscriptDraft } from '../../../../contracts/manuscript/manuscript-save-identity'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createManuscriptChapterCardsActions(ports) {
  async function selectChapter(chapter, existingRequest = null, navigation = null, { deferWorkflow = false } = {}) {
    if (!ports.worldMapWorkspace.canLeave() || !ports.current.value) return false
    const request = existingRequest || ports.workspaceRequests.capture(ports.current.value)
    if (!navigation) ports.invalidateOutlineRead()
    const selectionGeneration = ++ports.chapterSelectionGeneration
    const stillCurrent = () =>
      ports.workspaceRequests.isCurrent(request, ports.current.value) &&
      selectionGeneration === ports.chapterSelectionGeneration &&
      (!navigation || navigation.isCurrent())
    if (!(await ports.prepareOutlineLeave()) || !(await ports.flushPlannedChapterSave())) return false
    if (!stillCurrent()) return false
    if (ports.selectedId.value && ports.selectedId.value !== chapter.id && !(await ports.flushChapterSaveSafely()))
      return false
    if (!stillCurrent()) return false
    const sourceDraft = ports.outlineDraftSnapshot()
    const sourceManuscript = { title: ports.chapterTitle.value, content: ports.chapterContent.value }
    const sourceEditor = ports.manuscriptEditor.value
    const [selectedOutline, planning] = await Promise.all([
      ports.desktop.chapterOutlines.get(chapter.id),
      ports.desktop.chapters.getPlanning(chapter.id).catch(() => null)
    ])
    if (!stillCurrent()) return false
    if (sourceEditor !== ports.manuscriptEditor.value) return false
    await sourceEditor?.flush?.()
    if (!stillCurrent() || sourceEditor !== ports.manuscriptEditor.value) return false
    if (!isSameManuscriptDraft(sourceManuscript, { title: ports.chapterTitle.value, content: ports.chapterContent.value })) {
      ports.notice('读取期间当前正文有新修改，已保留输入，请再次打开目标章节。')
      return false
    }
    if (sourceDraft !== ports.outlineDraftSnapshot()) {
      ports.notice('读取期间当前大纲有新修改，已保留草稿，请再次打开目标章节。')
      return false
    }
    ports.clearAutosaveTimer()
    ports.clearAutosaveFinalizeTimer()
    ports.activeAutosaveCheckpoint = null
    ports.stagedRecoverySnapshot = null
    ports.showRevisions.value = false
    ports.selectedId.value = chapter.id
    ports.chapterCardAdoption.value = null
    ports.manuscriptSelection.value = null
    ports.manuscriptInsertionAnchor.value = null
    ports.lastSavedChapter = {
      id: chapter.id,
      title: chapter.title,
      content: chapter.content,
      revision: chapter.revision ?? null,
      bodyVersionId: chapter.bodyVersionId ?? null
    }
    ports.suppressManuscriptAutosave = true
    ports.chapterTitle.value = chapter.title
    ports.chapterContent.value = chapter.content
    ports.suppressManuscriptAutosave = false
    ports.saveState.value = 'saved'
    ports.manuscriptSaveError.value = null
    ports.manuscriptConflict.value = null
    ports.lastSavedAt.value = new Date()
    ports.chapterOutline.value = selectedOutline.content
    ports.chapterPlanning.value = planning
    ports.lastSavedChapterOutline.value = ports.chapterOutline.value
    navigation?.commit()
    // Both projections are read-only and guarded by the same work-item and
    // chapter generations. Waiting for them together shortens first-open time
    // without allowing a stale reply to publish into a newer workspace.
    try {
      await Promise.all([
        deferWorkflow ? undefined : ports.refreshWorkflow(request),
        ports.loadWritingAgentTasks(chapter.id, request, selectionGeneration)
      ])
    } catch (error) {
      if (!stillCurrent() || !isSameManuscriptDraft(chapter, { title: ports.chapterTitle.value, content: ports.chapterContent.value })) return false
      throw error
    }
    return stillCurrent() && ports.selectedId.value === chapter.id
  }

  function openChapterCard() {
    if (!ports.chapterPlanning.value) return ports.notice('章卡将在作品切换为 SQLite 正式数据后启用')
    const card = ports.chapterPlanning.value.card
    ports.chapterCardDraft.value = {
      status: card.status === 'confirmed' ? 'confirmed' : 'draft',
      goal: card.goal,
      entryState: card.entryState,
      beatsText: card.beats.join('\n'),
      conflict: card.conflict,
      charactersText: card.characters.join('、'),
      pointOfView: card.pointOfView,
      narrativeDistance: card.narrativeDistance,
      exitChange: card.exitChange,
      hook: card.hook
    }
    ports.chapterCardOpen.value = true
    ports.chapterSummaryDraft.value = ''
    ports.chapterSummaryStatus.value = ''
    ports.desktop.workspace
      .getChapterSummary(ports.selectedId.value)
      .then((summary) => {
        if (!ports.chapterCardOpen.value || ports.selectedId.value !== summary?.chapterId) return
        ports.chapterSummaryDraft.value = summary?.content || ''
        ports.chapterSummaryStatus.value = summary
          ? summary.status === 'approved'
            ? '已确认，可供下一章承接'
            : '正文已变更，需重新确认'
          : '尚未填写'
      })
      .catch(() => {
        ports.chapterSummaryStatus.value = '保存正文后可填写章末承接'
      })
  }

  async function saveChapterSummary() {
    const chapter = ports.chapters.value.find((item) => item.id === ports.selectedId.value)
    if (!chapter?.bodyVersionId || !ports.chapterSummaryDraft.value.trim())
      return ports.notice('请先保存正文，再填写章末承接摘要')
    try {
      await ports.desktop.workspace.saveChapterSummary({
        chapterId: chapter.id,
        bodyVersionId: chapter.bodyVersionId,
        content: ports.chapterSummaryDraft.value
      })
      ports.chapterSummaryStatus.value = '已确认，可供下一章承接'
      await ports.refreshWorkflow()
      ports.notice('章末承接摘要已确认')
    } catch (error) {
      ports.notice(error?.message || '章末摘要保存失败')
    }
  }

  async function saveChapterCard(lifecycleStatus = undefined) {
    if (!ports.selectedId.value || !ports.chapterPlanning.value || ports.chapterCardSaving.value) return
    ports.chapterCardSaving.value = true
    try {
      if (lifecycleStatus === 'CONFIRMED') await persistCurrentChapterBeforeConfirmation()
      const draft = ports.chapterCardDraft.value
      ports.chapterPlanning.value = await ports.desktop.chapters.updatePlanning(ports.selectedId.value, {
        ...(lifecycleStatus ? { lifecycleStatus } : {}),
        card: {
          status: draft.status,
          goal: draft.goal,
          entryState: draft.entryState,
          beats: draft.beatsText
            .split(/\r?\n/)
            .map((item) => item.trim())
            .filter(Boolean),
          conflict: draft.conflict,
          characters: draft.charactersText
            .split(/[、,，；;\n]/)
            .map((item) => item.trim())
            .filter(Boolean),
          pointOfView: draft.pointOfView,
          narrativeDistance: draft.narrativeDistance,
          exitChange: draft.exitChange,
          hook: draft.hook
        }
      })
      if (lifecycleStatus === 'CONFIRMED') await refreshChapterAfterConfirmation()
      ports.notice(
        lifecycleStatus
          ? `章节状态已改为“${ports.chapterLifecycleLabels[lifecycleStatus]}”`
          : '本章执行卡已保存并同步 JSON'
      )
    } catch (error) {
      ports.notice(error?.message || '章卡保存失败')
    } finally {
      ports.chapterCardSaving.value = false
    }
  }

  async function persistCurrentChapterBeforeConfirmation() {
    await ports.manuscriptEditor.value?.flush?.()
    await ports.persistChapter(ports.pendingSaveReason === 'ai' ? 'ai' : 'manual')
  }

  async function refreshChapterAfterConfirmation() {
    if (!ports.selectedId.value) return
    const chapter = await ports.desktop.chapters.get(ports.selectedId.value)
    const index = ports.chapters.value.findIndex((item) => item.id === chapter.id)
    if (index >= 0) ports.chapters.value.splice(index, 1, chapter)
    ports.lastSavedChapter = {
      id: chapter.id,
      title: chapter.title,
      content: chapter.content,
      revision: chapter.revision ?? null,
      bodyVersionId: chapter.bodyVersionId ?? null
    }
    ports.lastSavedAt.value = new Date()
    ports.saveState.value = 'saved'
  }

  async function confirmCurrentChapter() {
    if (!ports.selectedId.value || !ports.chapterPlanning.value || ports.chapterCardSaving.value) return false
    if (
      ports.chapterPlanning.value.lifecycleStatus === 'CONFIRMED' &&
      !ports.chapterPlanning.value.hasUnconfirmedChanges
    )
      return true
    ports.chapterCardSaving.value = true
    try {
      await persistCurrentChapterBeforeConfirmation()
      ports.chapterPlanning.value = await ports.desktop.chapters.getPlanning(ports.selectedId.value)
      if (ports.chapterPlanning.value.lifecycleStatus === 'DRAFTING') {
        ports.chapterPlanning.value = await ports.desktop.chapters.updatePlanning(ports.selectedId.value, {
          lifecycleStatus: 'REVIEWABLE'
        })
      }
      ports.chapterPlanning.value = await ports.desktop.chapters.updatePlanning(ports.selectedId.value, {
        lifecycleStatus: 'CONFIRMED'
      })
      await refreshChapterAfterConfirmation()
      ports.notice('本章正文已建立确认版本；下一章会优先引用这一版')
      return true
    } catch (error) {
      ports.notice(error?.message || '本章确认失败，正文仍保持原样')
      return false
    } finally {
      ports.chapterCardSaving.value = false
    }
  }

  async function confirmAndExtractCurrentChapterFacts() {
    if (!(await confirmCurrentChapter())) return
    await ports.extractCurrentChapterFacts()
  }

  return {
    selectChapter,
    openChapterCard,
    saveChapterSummary,
    saveChapterCard,
    persistCurrentChapterBeforeConfirmation,
    refreshChapterAfterConfirmation,
    confirmCurrentChapter,
    confirmAndExtractCurrentChapterFacts
  }
}
