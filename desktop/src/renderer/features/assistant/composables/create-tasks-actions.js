// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createAssistantTasksActions(ports) {
  const polling = new Map()
  const running = task => ['queued', 'resuming', 'preparing', 'running', 'streaming'].includes(task.status)
  function captureBook() {
    const path = ports.current.value?.path, generation = ports.chapterSelectionGeneration
    return () => ports.current.value?.path === path && ports.chapterSelectionGeneration === generation
  }
  function syncWritingAgentTask(task) {
    if (task.workItemId !== ports.current.value?.id || task.chapterId !== ports.selectedId.value) return
    const index = ports.writingAgentTasks.value.findIndex((item) => item.id === task.id)
    if (index >= 0) ports.writingAgentTasks.value.splice(index, 1, task)
    else ports.writingAgentTasks.value = [...ports.writingAgentTasks.value, task]
    ports.writingAgentRunning.value = ports.writingAgentTasks.value.some(running)
    if (task.turn && task.artifact?.status === 'complete') {
      const conversation = {
        id: task.turn.id,
        taskId: task.id,
        message: task.message,
        result: task.turn,
        baseDraft: task.baseDraft,
        task
      }
      const turnIndex = ports.writingAgentTurns.value.findIndex((item) => item.id === task.turn.id)
      if (turnIndex >= 0) ports.writingAgentTurns.value.splice(turnIndex, 1, conversation)
      else ports.writingAgentTurns.value = [...ports.writingAgentTurns.value, conversation]
    }
  }

  async function loadWritingAgentTasks(chapterId, request, selectionGeneration) {
    try {
      const tasks = await ports.desktop.ai.listWritingAgentTasks(chapterId)
      if (
        !ports.workspaceRequests.isCurrent(request, ports.current.value) ||
        selectionGeneration !== ports.chapterSelectionGeneration ||
        ports.selectedId.value !== chapterId
      )
        return
      ports.writingAgentTasks.value = tasks
      ports.writingAgentTurns.value = tasks
        .filter((task) => task.turn && task.artifact?.status === 'complete')
        .map((task) => ({
          id: task.turn.id,
          taskId: task.id,
          message: task.message,
          result: task.turn,
          baseDraft: task.baseDraft,
          task
        }))
      ports.writingAgentRunning.value = tasks.some((task) =>
        ['queued', 'resuming', 'preparing', 'running', 'streaming'].includes(task.status)
      )
      for (const task of tasks.filter(task => ['queued', 'resuming', 'preparing', 'running', 'streaming'].includes(task.status))) {
        void pollWritingAgentTask(task.id).catch(() => undefined)
      }
    } catch {
      if (
        ports.workspaceRequests.isCurrent(request, ports.current.value) &&
        selectionGeneration === ports.chapterSelectionGeneration
      ) {
        ports.writingAgentTasks.value = []
        ports.writingAgentTurns.value = []
        ports.writingAgentRunning.value = false
      }
    }
  }

  function updateManuscriptSelection(selection) {
    ports.manuscriptSelection.value = selection
  }

  function updateManuscriptAnchor(anchor) {
    ports.manuscriptInsertionAnchor.value = anchor
  }

  function openWritingAgentQuickAction(skill, message = '') {
    ports.assistantMode.value = 'agent'
    ports.writingAgentQuickAction.value = {
      id: (ports.writingAgentQuickAction.value?.id || 0) + 1,
      skill,
      message
    }
    ports.assistantOpen.value = true
  }

  function openManuscriptSelectionAiMenu() {
    if (!ports.manuscriptSelection.value?.text || !ports.desktop?.app.showSelectionAiMenu) return
    ports.desktop.app.showSelectionAiMenu()
  }

  function markManuscriptAsManualEdit() {
    if (!ports.current.value?.id || !ports.selectedId.value) return
    const key = `${ports.current.value.id}::${ports.selectedId.value}`
    if (
      ports.pendingSaveReason !== 'ai' &&
      !ports.pendingAiSourceTaskIds.value[key] &&
      !ports.pendingCharacterSettlements.value[key]
    )
      return
    const nextSources = { ...ports.pendingAiSourceTaskIds.value }
    const nextSettlements = { ...ports.pendingCharacterSettlements.value }
    delete nextSources[key]
    delete nextSettlements[key]
    ports.pendingAiSourceTaskIds.value = nextSources
    ports.pendingCharacterSettlements.value = nextSettlements
    ports.pendingSaveReason = 'autosave'
  }

  function announceManuscriptHistory(direction) {
    markManuscriptAsManualEdit()
    ports.manuscriptSelection.value = null
    ports.manuscriptInsertionAnchor.value = null
    ports.notice(direction === 'undo' ? '已撤销上一步，改动尚未保存' : '已重做上一步，改动尚未保存')
  }

  async function previewWritingAgentContext(input) {
    if (!ports.selectedId.value) return
    const chapterId = ports.selectedId.value
    const workItemId = ports.current.value?.id
    const isCurrent = captureBook()
    const requestId = ++ports.writingAgentContextPreviewRequest
    ports.writingAgentContextPreviewBusy.value = true
    try {
      const selection = ports.manuscriptEditor.value?.selectionSnapshot?.() || null
      const insertionAnchor = ports.manuscriptInsertionAnchor.value
        ? ports.manuscriptEditor.value?.insertionAnchorSnapshot?.() || ports.manuscriptInsertionAnchor.value
        : null
      const preview = await ports.desktop.ai.previewWritingAgentContext({
        chapterId,
        expectedWorkItemId: workItemId,
        message: input.message?.trim() || '预览本次写作上下文',
        currentDraft: ports.chapterContent.value,
        ...(input.model ? { model: input.model } : {}),
        ...(input.modelConnectionId ? { modelConnectionId: input.modelConnectionId } : {}),
        ...(input.maxTokensOverride === undefined ? {} : { maxTokensOverride: input.maxTokensOverride }),
        ...(input.preferredSkill ? { preferredSkill: input.preferredSkill } : {}),
        ...(selection ? { selection } : {}),
        ...(insertionAnchor ? { insertionAnchor } : {}),
        contextSelection: input.contextSelection
      })
      if (
        requestId === ports.writingAgentContextPreviewRequest &&
        isCurrent() &&
        ports.current.value?.id === workItemId &&
        ports.selectedId.value === chapterId
      )
        ports.writingAgentContextPreview.value = preview
    } catch (error) {
      if (
        requestId === ports.writingAgentContextPreviewRequest &&
        isCurrent() &&
        ports.current.value?.id === workItemId &&
        ports.selectedId.value === chapterId
      )
        ports.notice(error?.message || '本次依据预览失败，请重试')
    } finally {
      if (
        requestId === ports.writingAgentContextPreviewRequest &&
        isCurrent() &&
        ports.current.value?.id === workItemId &&
        ports.selectedId.value === chapterId
      )
        ports.writingAgentContextPreviewBusy.value = false
    }
  }

  async function runWritingAgent(input) {
    const isCurrent = captureBook()
    if (!ports.selectedId.value || ports.writingAgentRunning.value) return
    await ports.manuscriptEditor.value?.flush?.()
    if (!isCurrent()) return
    const selection = ports.manuscriptEditor.value?.selectionSnapshot?.() || null
    const insertionAnchor = ports.manuscriptInsertionAnchor.value
      ? ports.manuscriptEditor.value?.insertionAnchorSnapshot?.() || ports.manuscriptInsertionAnchor.value
      : null
    const chapterId = ports.selectedId.value
    const workItemId = ports.current.value?.id
    const baseDraft = ports.chapterContent.value
    ports.writingAgentRunning.value = true
    try {
      const task = await ports.desktop.ai.startWritingAgent({
        operationId: input.operationId || crypto.randomUUID(),
        request: {
          chapterId,
          expectedWorkItemId: workItemId,
          message: input.message,
          currentDraft: baseDraft,
          ...(input.expectedContextHash ? { expectedContextHash: input.expectedContextHash } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(input.modelConnectionId ? { modelConnectionId: input.modelConnectionId } : {}),
          ...(input.maxTokensOverride === undefined ? {} : { maxTokensOverride: input.maxTokensOverride }),
          ...(input.preferredSkill ? { preferredSkill: input.preferredSkill } : {}),
          contextSelection: input.contextSelection,
          ...(selection ? { selection } : {}),
          ...(insertionAnchor ? { insertionAnchor } : {})
        }
      })
      if (!isCurrent()) return
      syncWritingAgentTask(task)
      const completed = await pollWritingAgentTask(task.id)
      if (!completed || ports.current.value?.id !== workItemId || ports.selectedId.value !== chapterId) return
      if (completed.status === 'succeeded' && completed.turn) {
        ports.notice(
          completed.turn.candidate
            ? '红字修订已放在原文下方，可逐处保留或撤销'
            : completed.turn.chapterCardOptions?.length
              ? '助笔已整理章卡候选；选择一种走法后仍需逐项核对'
              : '写作 Agent 已完成只读回答'
        )
      } else if (completed.status === 'cancelled') ports.notice('生成已停止；正文没有改变，任务记录已保留')
      else if (completed.status === 'paused') ports.notice('任务已暂停；现有片段已经保留，可稍后继续')
      else if (completed.status === 'failed' || completed.status === 'interrupted')
        ports.notice(completed.error?.message || '写作 Agent 本次任务没有完成，可以重试')
    } catch (error) {
      if (!isCurrent()) return
      if (ports.current.value?.id === workItemId) ports.notice(error?.message || '写作 Agent 本次任务没有完成，请重试')
    } finally {
      if (isCurrent()) ports.writingAgentRunning.value = ports.writingAgentTasks.value.some((task) =>
        ['queued', 'resuming', 'preparing', 'running', 'streaming'].includes(task.status)
      )
    }
  }

  function pollWritingAgentTask(taskId) {
    const key = JSON.stringify([ports.current.value?.path, ports.chapterSelectionGeneration, taskId])
    if (!polling.has(key)) polling.set(key, pollTask(taskId).finally(() => polling.delete(key)))
    return polling.get(key)
  }
  async function pollTask(taskId) {
    const path = ports.current.value?.path, selection = ports.chapterSelectionGeneration
    const isCurrent = () => ports.current.value?.path === path && ports.chapterSelectionGeneration === selection
    let task = ports.writingAgentTasks.value.find((item) => item.id === taskId)
    while (task && ['queued', 'resuming', 'preparing', 'running', 'streaming'].includes(task.status)) {
      await new Promise((resolve) => window.setTimeout(resolve, 180))
      if (!isCurrent()) return null
      task = await ports.desktop.ai.writingAgentTask(taskId)
      if (!isCurrent()) return null
      syncWritingAgentTask(task)
    }
    if (isCurrent() && task?.status === 'succeeded' && task.turn?.candidate && (!task.turn.proposal || task.turn.proposal.report.passed)) {
      await ports.manuscriptEditor?.value?.openReview?.(task.id)
    }
    return isCurrent() ? task : null
  }

  async function cancelWritingAgentTask(taskId = '') {
    const isCurrent = captureBook()
    const task = typeof taskId === 'string' && taskId ? { id: taskId } : ports.activeWritingAgentTask.value
    if (!task) return
    try {
      const cancelled = await ports.desktop.ai.cancelWritingAgentTask(task.id)
      if (!isCurrent()) return
      syncWritingAgentTask(cancelled)
      ports.writingAgentRunning.value = false
      ports.notice('正在停止生成；已有正文不会改变')
    } catch (error) {
      if (!isCurrent()) return
      ports.notice(error?.message || '停止任务失败，请重试')
    }
  }

  async function pauseWritingAgentTask(taskId = '') {
    const isCurrent = captureBook()
    const task = typeof taskId === 'string' && taskId ? { id: taskId } : ports.activeWritingAgentTask.value
    if (!task) return
    try {
      const paused = await ports.desktop.ai.pauseWritingAgentTask(task.id)
      if (!isCurrent()) return
      syncWritingAgentTask(paused)
      ports.writingAgentRunning.value = false
      ports.notice('任务已暂停；现有片段已保留，正文没有改变')
    } catch (error) {
      if (!isCurrent()) return
      ports.notice(error?.message || '暂停任务失败，请重试')
    }
  }

  async function resumeWritingAgentTask(taskId) {
    const isCurrent = captureBook()
    if (ports.writingAgentRunning.value) return
    ports.writingAgentRunning.value = true
    try {
      const task = await ports.desktop.ai.resumeWritingAgentTask(taskId, crypto.randomUUID())
      if (!isCurrent()) return
      syncWritingAgentTask(task)
      const completed = await pollWritingAgentTask(task.id)
      if (completed?.status === 'succeeded') ports.notice('暂停的任务已在新一轮中完成，候选等待你确认')
      else if (completed?.status === 'paused') ports.notice('新一轮任务也已暂停；正文没有改变')
      else if (completed?.status === 'failed' || completed?.status === 'interrupted')
        ports.notice(completed.error?.message || '继续任务没有完成')
    } catch (error) {
      if (!isCurrent()) return
      ports.notice(error?.message || '暂停的任务无法继续')
    } finally {
      if (isCurrent()) ports.writingAgentRunning.value = ports.writingAgentTasks.value.some((task) =>
        ['queued', 'resuming', 'preparing', 'running', 'streaming'].includes(task.status)
      )
    }
  }

  async function retryWritingAgentTask(taskId) {
    const isCurrent = captureBook()
    if (ports.writingAgentRunning.value) return
    ports.writingAgentRunning.value = true
    try {
      const task = await ports.desktop.ai.retryWritingAgentTask(taskId, crypto.randomUUID())
      if (!isCurrent()) return
      syncWritingAgentTask(task)
      const completed = await pollWritingAgentTask(task.id)
      if (completed?.status === 'succeeded') ports.notice('AI 任务重试完成，候选已恢复到对话中')
      else if (completed?.status === 'failed') ports.notice(completed.error?.message || '重试仍未完成')
    } catch (error) {
      if (!isCurrent()) return
      ports.notice(error?.message || 'AI 任务无法重试')
    } finally {
      if (isCurrent()) ports.writingAgentRunning.value = ports.writingAgentTasks.value.some((task) =>
        ['queued', 'resuming', 'preparing', 'running', 'streaming'].includes(task.status)
      )
    }
  }

  async function dismissWritingAgentTask(taskId) {
    const removed = ports.writingAgentTasks.value.find((task) => task.id === taskId)
    if (!removed) return
    ports.writingAgentTasks.value = ports.writingAgentTasks.value.filter((task) => task.id !== taskId)
    try {
      await ports.desktop.ai.dismissWritingAgentTask(taskId)
      ports.writingAgentTurns.value = ports.writingAgentTurns.value.filter((turn) => turn.taskId !== taskId)
      if (ports.assistantMode.value === 'tasks') void loadTaskCenter()
      ports.notice('失败记录已删除；正文、章节和历史版本都没有改变')
    } catch (error) {
      syncWritingAgentTask(removed)
      ports.notice(error?.message || '这条失败记录暂时无法删除')
    }
  }

  async function loadTaskCenter() {
    if (!ports.desktop || !ports.current.value || ports.taskCenterLoading.value) return
    ports.taskCenterLoading.value = true
    try {
      ports.taskCenterItems.value = await ports.desktop.workspace.listTaskCenter()
    } catch (error) {
      ports.notice(error?.message || '任务记录读取失败，请稍后重试')
    } finally {
      ports.taskCenterLoading.value = false
    }
  }

  async function openTaskCenterItem(item) {
    if (item.taskType === 'idea_generation') {
      await ports.selectWorkspaceLeaf('ideas')
    } else if (item.taskType === 'outline_expansion') {
      await ports.selectWorkspaceParent('planning')
    } else {
      await ports.selectActivity('desk')
      if (ports.active.value !== 'desk') return
      const chapter = item.chapterId ? ports.chapters.value.find((entry) => entry.id === item.chapterId) : null
      if (chapter && ports.selectedId.value !== chapter.id) await ports.selectChapter(chapter)
      ports.assistantMode.value = item.taskType === 'fact_extraction' ? 'checks' : 'agent'
    }
  }

  async function handleTaskCenterAction(item, action) {
    if (action === 'view') return void (await openTaskCenterItem(item))
    ports.taskCenterBusyId.value = item.id
    try {
      if (item.taskType === 'writing_agent' && action === 'pause') {
        const task = await ports.desktop.ai.pauseWritingAgentTask(item.id)
        if (item.chapterId === ports.selectedId.value) syncWritingAgentTask(task)
        ports.notice('任务已暂停；现有片段已保留，正文没有改变')
      } else if (item.taskType === 'writing_agent' && action === 'resume') {
        const task = await ports.desktop.ai.resumeWritingAgentTask(item.id, crypto.randomUUID())
        if (item.chapterId === ports.selectedId.value) {
          syncWritingAgentTask(task)
          void pollWritingAgentTask(task.id).finally(() => {
            ports.writingAgentRunning.value = ports.writingAgentTasks.value.some((entry) =>
              ['queued', 'resuming', 'preparing', 'running', 'streaming'].includes(entry.status)
            )
            void loadTaskCenter()
          })
        }
        ports.notice('任务已继续；可以留在任务中心查看进度')
      } else if (item.taskType === 'writing_agent' && action === 'cancel') {
        const task = await ports.desktop.ai.cancelWritingAgentTask(item.id)
        if (item.chapterId === ports.selectedId.value) syncWritingAgentTask(task)
        ports.notice('任务已停止；正文没有改变')
      } else if (item.taskType === 'writing_agent' && action === 'retry') {
        const task = await ports.desktop.ai.retryWritingAgentTask(item.id, crypto.randomUUID())
        if (item.chapterId === ports.selectedId.value) {
          syncWritingAgentTask(task)
          void pollWritingAgentTask(task.id).finally(() => {
            ports.writingAgentRunning.value = ports.writingAgentTasks.value.some((entry) =>
              ['queued', 'resuming', 'preparing', 'running', 'streaming'].includes(entry.status)
            )
            void loadTaskCenter()
          })
        }
        ports.notice('任务已重新开始；可以留在任务中心查看进度')
      } else if (item.taskType === 'idea_generation' && action === 'cancel')
        await ports.desktop.workspace.cancelIdeaGeneration(item.id)
      else if (item.taskType === 'idea_generation' && action === 'retry') {
        await ports.desktop.workspace.retryIdeaGeneration(item.id, crypto.randomUUID())
        void ports.refreshIdeaGenerations()
        ports.notice('灵感任务已重新开始；结果仍只保存为候选')
      } else if (item.taskType === 'outline_expansion' && action === 'cancel')
        await ports.desktop.workspace.cancelOutlineExpansion(item.id)
      else if (item.taskType === 'outline_expansion' && action === 'retry') {
        await ports.desktop.workspace.retryOutlineExpansion(item.id, crypto.randomUUID())
        if (ports.expansionOpen.value) void ports.refreshOutlineExpansions()
        ports.notice('谋篇任务已重新开始；结果仍只保存为候选')
      } else if (item.taskType === 'fact_extraction' && action === 'cancel')
        await ports.desktop.workspace.cancelFactExtraction(item.id)
      else if (item.taskType === 'fact_extraction' && action === 'retry')
        await ports.desktop.workspace.retryFactExtraction(item.id, crypto.randomUUID())
      else throw new Error('这个任务当前没有可执行的操作')
    } catch (error) {
      ports.notice(error?.message || '任务操作没有完成，请重试')
    } finally {
      if (item.taskType === 'writing_agent' && item.chapterId === ports.selectedId.value) {
        ports.writingAgentRunning.value = ports.writingAgentTasks.value.some((task) =>
          ['queued', 'resuming', 'preparing', 'running', 'streaming'].includes(task.status)
        )
      }
      ports.taskCenterBusyId.value = ''
      await loadTaskCenter()
    }
  }

  return {
    syncWritingAgentTask,
    loadWritingAgentTasks,
    updateManuscriptSelection,
    updateManuscriptAnchor,
    openWritingAgentQuickAction,
    openManuscriptSelectionAiMenu,
    markManuscriptAsManualEdit,
    announceManuscriptHistory,
    previewWritingAgentContext,
    runWritingAgent,
    pollWritingAgentTask,
    cancelWritingAgentTask,
    pauseWritingAgentTask,
    resumeWritingAgentTask,
    retryWritingAgentTask,
    dismissWritingAgentTask,
    loadTaskCenter,
    openTaskCenterItem,
    handleTaskCenterAction
  }
}
