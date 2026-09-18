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
