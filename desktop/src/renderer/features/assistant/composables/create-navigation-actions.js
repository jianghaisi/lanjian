// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createAssistantNavigationActions(ports) {
  async function navigateAssistantWorkspace(id) {
    const workItemId = ports.current.value?.id
    await ports.selectWorkspaceLeaf(id)
    if (!workItemId || ports.current.value?.id !== workItemId || ports.activeWorkspaceLeaf.value?.id !== id)
      throw new Error('目标工作区未能打开，当前输入已保留。')
    if (id === 'chapters' && !ports.selectedId.value) {
      if (ports.chapters.value.length === 1)
        await ports.selectChapter(await ports.desktop.chapters.get(ports.chapters.value[0].id))
      else
        throw new Error(
          ports.chapters.value.length
            ? '这部作品有多个章节，请说明要处理哪一章。'
            : '这部作品还没有章节。可以先试写对话样稿，或新建要处理的章节。'
        )
    }
  }

  async function sendAssistantProse(input) {
    if (input.taskId) {
      const book = ports.current.value?.id
      const task = await ports.desktop.ai.writingAgentTask(input.taskId)
      if (!book || task.workItemId !== book || ports.current.value?.id !== book) throw new Error('候选不属于当前作品。')
      await ports.selectWorkspaceLeaf('chapters')
      if (ports.current.value?.id !== book || ports.activeWorkspaceLeaf.value?.id !== 'chapters') throw new Error('原章节未能打开，当前草稿已保留。')
      if (ports.selectedId.value !== task.chapterId) await ports.selectChapter(await ports.desktop.chapters.get(task.chapterId))
      if (ports.current.value?.id !== book || ports.selectedId.value !== task.chapterId) throw new Error('原章节未能打开，当前草稿已保留。')
      ports.syncWritingAgentTask(task)
      if (['queued', 'resuming', 'preparing', 'running', 'streaming'].includes(task.status)) ports.pollWritingAgentTask(task.id)
      return
    }
    if (!ports.embeddedWritingAgent.value) throw new Error('请先打开要处理的章节。')
    const workItemId = ports.current.value?.id
    const storage = await ports.desktop.projects.sqliteStorageStatus()
    if (ports.current.value?.id !== workItemId) throw new Error('当前作品已变化，请重新发送。')
    if (storage.storageMode === 'files')
      throw new Error(
        '这部作品还未启用写作任务记录，请在“设置 → 项目数据”完成准备后再生成正式章节。独立测试小说可直接在对话中试写。'
      )
    ports.embeddedWritingAgent.value.sendMessage(input)
  }

  return { navigateAssistantWorkspace, sendAssistantProse }
}
