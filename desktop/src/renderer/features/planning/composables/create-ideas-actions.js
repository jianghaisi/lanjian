// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createPlanningIdeasActions(ports) {
  function canLeaveIdeaDraft() {
    return !ports.ideaDraftDirty.value || window.confirm('这条灵感还有修改尚未保存。放弃修改并继续吗？')
  }

  function openIdea(idea, force = false) {
    if (!force && idea.id !== ports.selectedIdeaId.value && !canLeaveIdeaDraft()) return
    ports.selectedIdeaId.value = idea.id
    ports.ideaGenerationSource.value = idea.generationSource ?? null
    ports.creatingIdea.value = false
    ports.ideaDraft.value = { title: idea.title, content: idea.content, status: idea.status }
    void loadIdeaSource(idea.generationSource)
    void refreshIdeaGenerations()
  }

  async function loadIdeaSource(source) {
    const generation = ++ports.ideaSourceLoad
    ports.ideaSourceTask.value = null
    ports.ideaSourceIssue.value = ''
    if (!source || !ports.current.value) return
    const request = ports.workspaceRequests.capture(ports.current.value)
    try {
      const task = await ports.desktop.workspace.ideaGeneration(source.taskId)
      if (generation !== ports.ideaSourceLoad || !ports.workspaceRequests.isCurrent(request, ports.current.value))
        return
      if (task.id !== source.taskId || !task.proposal?.options?.[source.optionIndex]) throw new Error('来源候选不完整')
      ports.ideaSourceTask.value = task
    } catch (error) {
      if (generation === ports.ideaSourceLoad && ports.workspaceRequests.isCurrent(request, ports.current.value)) {
        ports.ideaSourceIssue.value = error?.message || '暂时无法读取这条便签的生成来源'
      }
    }
  }

  function clearIdeaGenerationPoll() {
    if (ports.ideaGenerationTimer) window.clearTimeout(ports.ideaGenerationTimer)
    ports.ideaGenerationTimer = null
    ports.ideaGenerationLoad += 1
  }

  async function refreshIdeaGenerations() {
    clearIdeaGenerationPoll()
    if (!ports.current.value) return
    const generation = ports.ideaGenerationLoad
    const request = ports.workspaceRequests.capture(ports.current.value)
    try {
      const tasks = await ports.desktop.workspace.listIdeaGenerations()
      if (generation !== ports.ideaGenerationLoad || !ports.workspaceRequests.isCurrent(request, ports.current.value))
        return
      ports.ideaGenerations.value = tasks
      if (ports.ideaGenerationRunning.value) ports.ideaGenerationTimer = window.setTimeout(refreshIdeaGenerations, 1000)
    } catch (error) {
      if (generation === ports.ideaGenerationLoad && ports.workspaceRequests.isCurrent(request, ports.current.value))
        ports.notice(error?.message || '读取灵感候选失败，请重新打开便签')
    }
  }

  async function startIdeaGeneration(mode) {
    const idea = ports.selectedIdea.value
    if (!idea || ports.ideaDraftDirty.value || ports.ideaGenerationRunning.value) return
    await ports.guard(
      () =>
        ports.desktop.workspace.startIdeaGeneration({
          operationId: crypto.randomUUID(),
          ideaId: idea.id,
          expectedUpdatedAt: idea.updatedAt,
          mode,
          instruction: ports.ideaGenerationInstruction.value
        }),
      '已开始生成，结果只会保存为候选'
    )
    await refreshIdeaGenerations()
  }

  async function stopIdeaGeneration(id) {
    await ports.guard(() => ports.desktop.workspace.cancelIdeaGeneration(id), '灵感生成已停止')
    await refreshIdeaGenerations()
  }

  async function retryIdeaGeneration(id) {
    if (ports.ideaGenerationRunning.value || !ports.current.value) return
    await ports.guard(
      () => ports.desktop.workspace.retryIdeaGeneration(id, crypto.randomUUID()),
      '已重新开始生成，结果仍只保存为候选'
    )
    await refreshIdeaGenerations()
  }

  function editIdeaGenerationOption(task, option) {
    if (task.sourceStale || !canLeaveIdeaDraft()) return
    startIdea()
    ports.ideaGenerationSource.value = { taskId: task.id, optionIndex: task.proposal.options.indexOf(option) }
    ports.ideaDraft.value = { title: option.title, content: option.content, status: 'candidate' }
    ports.notice('已放入新便签草稿，保存前不会修改任何作品数据')
  }

  function startIdea() {
    if (!canLeaveIdeaDraft()) return
    ports.selectedIdeaId.value = ''
    ports.creatingIdea.value = true
    ports.resetIdeaDraft()
  }

  async function saveIdea(status = ports.ideaDraft.value.status) {
    if (!ports.ideaDraft.value.title.trim() || !ports.ideaDraft.value.content.trim())
      return ports.notice('请填写灵感标题和内容')
    const input = {
      ...(ports.selectedIdea.value ? { id: ports.selectedIdea.value.id } : {}),
      ...(ports.ideaGenerationSource.value ? { generationSource: ports.ideaGenerationSource.value } : {}),
      title: ports.ideaDraft.value.title,
      content: ports.ideaDraft.value.content,
      status
    }
    const saved = await ports.guard(
      () => ports.desktop.workspace.saveIdea(ports.plainDto(input)),
      status === 'approved' ? '灵感已由你批准' : '灵感便签已保存'
    )
    const index = ports.ideas.value.findIndex((item) => item.id === saved.id)
    if (index >= 0) ports.ideas.value.splice(index, 1, saved)
    else ports.ideas.value = [saved, ...ports.ideas.value]
    openIdea(saved, true)
    await ports.refreshWorkflow()
    return saved
  }

  async function promoteIdeaToWorldRule() {
    const idea = ports.selectedIdea.value
    if (!idea) return
    if (ports.ideaDraftDirty.value) return ports.notice('请先保存当前修改，再提升为正式设定')
    const result = await ports.guard(
      () => ports.desktop.workspace.promoteIdeaToWorldRule(idea.id, idea.updatedAt),
      '灵感已复制为正式世界设定，原便签仍然保留'
    )
    const index = ports.ideas.value.findIndex((item) => item.id === result.idea.id)
    if (index >= 0) ports.ideas.value.splice(index, 1, result.idea)
    openIdea(result.idea, true)
    ports.storyEntitiesLoaded.value = false
    await ports.refreshWorkflow()
  }

  async function promoteIdeaToSummary() {
    const idea = ports.selectedIdea.value
    if (!idea || ports.ideaDraftDirty.value) return ports.notice('请先保存当前灵感，再创建梗概')
    if (ports.totalOutline.value !== ports.lastSavedTotalOutline.value)
      return ports.notice('总纲中有未保存的修改，请先处理，再创建梗概')
    const result = await ports.guard(
      () => ports.desktop.workspace.promoteIdeaToSummary(idea.id, idea.updatedAt),
      '已创建正式梗概，可在谋篇的总纲中继续编辑；尚未确认或生成正文'
    )
    const index = ports.ideas.value.findIndex((item) => item.id === result.idea.id)
    if (index >= 0) ports.ideas.value.splice(index, 1, result.idea)
    openIdea(result.idea, true)
    ports.totalOutline.value = (await ports.desktop.outlines.get('total')).content
    ports.lastSavedTotalOutline.value = ports.totalOutline.value
    ports.sqliteStorageStatus.value = await ports.desktop.projects.sqliteStorageStatus()
    await ports.refreshWorkflow()
  }

  return {
    canLeaveIdeaDraft,
    openIdea,
    loadIdeaSource,
    clearIdeaGenerationPoll,
    refreshIdeaGenerations,
    startIdeaGeneration,
    stopIdeaGeneration,
    retryIdeaGeneration,
    editIdeaGenerationOption,
    startIdea,
    saveIdea,
    promoteIdeaToWorldRule,
    promoteIdeaToSummary
  }
}
