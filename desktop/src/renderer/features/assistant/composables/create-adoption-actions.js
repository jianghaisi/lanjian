import { buildWritingAgentApplication } from '../../../../contracts/assistant/writing-application'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createAssistantAdoptionActions(ports) {
  async function discardWritingAgentPartial(taskId) {
    const task = ports.writingAgentTasks.value.find((item) => item.id === taskId)
    if (!task?.partial || task.partial.status !== 'partial') return
    try {
      ports.syncWritingAgentTask(await ports.desktop.ai.decideWritingAgentArtifact({ taskId, decision: 'discarded' }))
      ports.notice('未完成草稿已舍弃，正文没有改变')
    } catch (error) {
      ports.notice(error?.message || '未完成草稿状态保存失败，请重试')
    }
  }

  async function applyWritingAgentPartial(taskId) {
    const task = ports.writingAgentTasks.value.find((item) => item.id === taskId)
    const partial = task?.partial
    if (!task || !partial?.content || partial.status !== 'partial') return
    if (
      task.workItemId !== ports.current.value?.id ||
      task.chapterId !== ports.selectedId.value ||
      task.baseDraft !== ports.chapterContent.value
    ) {
      return ports.notice('正文、章节或作品已经变化，这份未完成草稿不能再采用')
    }
    await ports.commitWritingAgentApplication({
      taskId,
      baseDraft: task.baseDraft,
      successMessage: '未完成草稿已采用、按当前版式整理，并保存为新的正文版本'
    })
  }

  async function discardWritingAgentTurn(turnId) {
    const turn = ports.writingAgentTurns.value.find((item) => item.id === turnId)
    if (turn?.taskId) {
      try {
        ports.syncWritingAgentTask(
          await ports.desktop.ai.decideWritingAgentArtifact({ taskId: turn.taskId, decision: 'discarded' })
        )
      } catch (error) {
        return ports.notice(error?.message || '候选状态保存失败，请重试')
      }
    }
    ports.writingAgentTurns.value = ports.writingAgentTurns.value.filter((turn) => turn.id !== turnId)
    ports.notice('这份候选已舍弃，正文没有改变')
  }

  function openChapterCardAdoption(turnId, optionId) {
    const turn = ports.writingAgentTurns.value.find((item) => item.id === turnId)
    const option = turn?.result?.chapterCardOptions?.find((item) => item.id === optionId)
    if (!turn || !option || !ports.chapterPlanning.value) return ports.notice('这份章卡候选已经不可用，请重新讨论')
    if (
      turn.result.workItemId !== ports.current.value?.id ||
      turn.result.chapterId !== ports.selectedId.value ||
      turn.baseDraft !== ports.chapterContent.value
    ) {
      return ports.notice('正文、章节或作品已经变化，请重新讨论后再采用章卡方案')
    }
    const currentCard = ports.chapterPlanning.value.card
    const selected = {}
    for (const key of ['goal', 'conflict', 'exitChange', 'hook']) {
      if (option[key]) selected[key] = !currentCard[key]?.trim()
    }
    if (option.beats?.length) selected.beats = true
    if (option.characters?.length) selected.characters = true
    ports.chapterCardAdoption.value = {
      turnId,
      taskId: turn.taskId,
      option,
      selected,
      baseCard: JSON.stringify(currentCard)
    }
  }

  async function confirmChapterCardAdoption() {
    const adoption = ports.chapterCardAdoption.value
    if (!adoption || !ports.chapterPlanning.value || ports.chapterCardSaving.value) return
    if (adoption.baseCard !== JSON.stringify(ports.chapterPlanning.value.card))
      return ports.notice('核对期间章卡已经变化，请关闭后重新选择方案')
    const selectedFields = ports.chapterCardAdoptionFields.value.filter((field) => adoption.selected[field.key])
    if (!selectedFields.length) return ports.notice('请至少选择一个要送入章卡的栏位')
    ports.chapterCardSaving.value = true
    try {
      const card = structuredClone(ports.chapterPlanning.value.card)
      for (const field of selectedFields) {
        const value = adoption.option[field.key]
        if (field.key === 'beats' || field.key === 'characters')
          card[field.key] = [...new Set([...(card[field.key] || []), ...value])]
        else card[field.key] = value
      }
      card.status = 'draft'
      ports.chapterPlanning.value = await ports.desktop.chapters.updatePlanning(ports.selectedId.value, { card })
      if (adoption.taskId) {
        try {
          ports.syncWritingAgentTask(
            await ports.desktop.ai.decideWritingAgentArtifact({ taskId: adoption.taskId, decision: 'applied' })
          )
        } catch {
          ports.notice('方案已经写入章卡，但候选归档状态没有同步；不会重复覆盖章卡')
        }
      }
      ports.writingAgentTurns.value = ports.writingAgentTurns.value.filter((item) => item.id !== adoption.turnId)
      ports.chapterCardAdoption.value = null
      ports.openChapterCard()
      ports.notice('所选方案已进入章卡草稿，请核对并确认后再用于写作')
    } catch (error) {
      ports.notice(error?.message || '章卡候选采用失败，正式章卡没有改变')
    } finally {
      ports.chapterCardSaving.value = false
    }
  }

  async function applyWritingAgentTurn(turnId, acceptedChangeIds) {
    if (ports.writingAgentApplyingTurnId.value) return
    const turn = ports.writingAgentTurns.value.find((item) => item.id === turnId)
    const candidate = turn?.result?.candidate
    if (!turn || !candidate) return
    if (turn.result.workItemId !== ports.current.value?.id || turn.result.chapterId !== ports.selectedId.value) {
      return ports.notice('正文、章节或作品已经变化，这份旧候选不能再采用')
    }
    if (!turn.taskId) return ports.notice('这份候选缺少持久任务记录，不能写入正式正文')
    const accepted = Array.isArray(acceptedChangeIds) ? acceptedChangeIds : []
    if (candidate.diff && accepted.length === 0) {
      try {
        ports.syncWritingAgentTask(
          await ports.desktop.ai.decideWritingAgentArtifact({
            taskId: turn.taskId,
            decision: 'discarded',
            acceptedChangeIds: [],
            reviewedChangeIds: candidate.diff.filter((block) => block.kind === 'change').map((block) => block.id)
          })
        )
      } catch (error) {
        return ports.notice(error?.message || '候选状态保存失败，请重试')
      }
      ports.writingAgentTurns.value = ports.writingAgentTurns.value.filter((item) => item.id !== turnId)
      ports.manuscriptSelection.value = null
      ports.manuscriptInsertionAnchor.value = null
      return ports.notice(
        candidate.mode === 'insertAtAnchor' ? '已选择不插入，正文没有改变' : '已保留全部原文，正文没有改变'
      )
    }
    const failedReview = Boolean(turn.result.proposal && !turn.result.proposal.report.passed)
    if (failedReview && !window.confirm('这份续写候选没有通过全部章纲检查。仍要把它保存为新的正文版本吗？')) return
    ports.writingAgentApplyingTurnId.value = turnId
    try {
      if (!(await ports.flushChapterSaveSafely())) return
      if (turn.result.workItemId !== ports.current.value?.id || turn.result.chapterId !== ports.selectedId.value) return
      if (turn.baseDraft !== ports.chapterContent.value) {
        const task = ports.writingAgentTasks.value.find((item) => item.id === turn.taskId)
        if (!task) return ports.notice('候选任务尚未加载，请稍后重试；正文没有改变')
        try {
          const proposed = buildWritingAgentApplication(task, {
            taskId: task.id,
            title: ports.chapterTitle.value,
            expectedRevision: ports.lastSavedChapter.revision,
            acceptedChangeIds: accepted,
            allowFailedReview: failedReview,
            formatting: {
              firstLineIndent: localStorage.getItem('lanjian-editor-first-line-indent') !== 'false',
              paragraphSpacing: localStorage.getItem('lanjian-editor-paragraph-spacing') !== 'false'
            }
          }).content
          ports.writingRebase.value = {
            taskId: task.id,
            turnId,
            workItemId: ports.current.value.id,
            chapterId: ports.selectedId.value,
            base: task.baseDraft,
            current: ports.chapterContent.value,
            title: ports.chapterTitle.value,
            proposed,
            revision: ports.lastSavedChapter.revision,
            acceptedChangeIds: accepted,
            allowFailedReview: failedReview
          }
        } catch (error) {
          ports.notice(error?.message || '合并预览失败，候选仍然保留')
        }
        return
      }
      await ports.commitWritingAgentApplication({
        taskId: turn.taskId,
        turnId,
        baseDraft: turn.baseDraft,
        acceptedChangeIds: accepted,
        allowFailedReview: failedReview,
        settleCharacters: Boolean(turn.result.proposal?.report.passed),
        successMessage: '候选已采用、按当前版式整理，并保存为新的正文版本'
      })
    } finally {
      if (ports.writingAgentApplyingTurnId.value === turnId) ports.writingAgentApplyingTurnId.value = ''
    }
  }

  async function confirmWritingRebase(choices) {
    const preview = ports.writingRebase.value
    if (!preview || ports.writingRebaseBusy.value) return
    if (
      preview.workItemId !== ports.current.value?.id ||
      preview.chapterId !== ports.selectedId.value ||
      preview.current !== ports.chapterContent.value ||
      preview.title !== ports.chapterTitle.value ||
      preview.revision !== ports.lastSavedChapter.revision
    ) {
      ports.writingRebase.value = null
      return ports.notice('核对期间正文又有变化，请重新打开合并；你的修改和候选均已保留')
    }
    ports.writingRebaseBusy.value = true
    try {
      const saved = await ports.commitWritingAgentApplication({
        taskId: preview.taskId,
        turnId: preview.turnId,
        baseDraft: preview.current,
        acceptedChangeIds: preview.acceptedChangeIds,
        allowFailedReview: preview.allowFailedReview,
        rebase: { choices },
        settleCharacters: false,
        successMessage: '已合并到最新正文并保存，合并前的正文保留在历史版本中'
      })
      if (saved) ports.writingRebase.value = null
    } finally {
      ports.writingRebaseBusy.value = false
    }
  }

  return {
    discardWritingAgentPartial,
    applyWritingAgentPartial,
    discardWritingAgentTurn,
    openChapterCardAdoption,
    confirmChapterCardAdoption,
    applyWritingAgentTurn,
    confirmWritingRebase
  }
}
