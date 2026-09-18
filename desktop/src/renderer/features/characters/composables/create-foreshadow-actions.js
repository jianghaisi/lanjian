// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createCharactersForeshadowActions(ports) {
  async function loadForeshadowLedger(force = false) {
    if (!ports.current.value || (ports.foreshadowLedgerLoaded.value && !force)) return
    const workItemId = ports.current.value.id
    try {
      const result = await ports.desktop.workspace.getForeshadowLedger()
      if (ports.current.value?.id !== workItemId) return
      ports.foreshadowLedger.value = result
      ports.foreshadowLedgerLoaded.value = true
      if (!result.foreshadows.some((item) => item.id === ports.selectedForeshadowId.value))
        ports.selectedForeshadowId.value = result.foreshadows[0]?.id || ''
      if (
        !ports.foreshadowDraft.value.foreshadowId ||
        !result.foreshadows.some(
          (item) => item.id === ports.foreshadowDraft.value.foreshadowId && item.status === 'open'
        )
      ) {
        ports.foreshadowDraft.value.foreshadowId = result.foreshadows.find((item) => item.status === 'open')?.id || ''
      }
    } catch (error) {
      ports.foreshadowLedger.value = { foreshadows: [], actions: [] }
      ports.foreshadowLedgerLoaded.value = true
      ports.notice(error?.message || '伏笔账本读取失败')
    }
  }

  function chooseForeshadow(item) {
    ports.selectedForeshadowId.value = item.id
    if (item.status === 'open') ports.foreshadowDraft.value.foreshadowId = item.id
  }

  async function recordForeshadowAction() {
    const draft = ports.foreshadowDraft.value
    if (draft.action === 'plant' ? !draft.title.trim() : !draft.foreshadowId)
      return ports.notice(draft.action === 'plant' ? '请填写伏笔名称' : '请选择待处理伏笔')
    const sourcePosition = Number(draft.legacyChapterId)
    const sourceChapter = draft.legacyChapterId.trim()
      ? ports.chapters.value.find((item) => item.position === sourcePosition)
      : null
    if (draft.legacyChapterId.trim() && !sourceChapter)
      return ports.notice('没有找到这个显示章序，请填写章节目录中看到的章号')
    const result = await ports.guard(
      () =>
        ports.desktop.workspace.recordForeshadowAction({
          operationKey: crypto.randomUUID(),
          action: draft.action,
          ...(draft.action === 'plant' ? { title: draft.title.trim() } : { foreshadowId: draft.foreshadowId }),
          ...(sourceChapter ? { legacyChapterId: sourceChapter.id } : {}),
          description: draft.description.trim(),
          sourceType: 'manual'
        }),
      '伏笔动作已记入正式账本'
    )
    if (!result) return
    ports.selectedForeshadowId.value = result.foreshadow.id
    ports.foreshadowLedger.value = {
      foreshadows: [
        result.foreshadow,
        ...ports.foreshadowLedger.value.foreshadows.filter((item) => item.id !== result.foreshadow.id)
      ],
      actions: ports.foreshadowLedger.value.actions.some((item) => item.id === result.action.id)
        ? ports.foreshadowLedger.value.actions
        : [result.action, ...ports.foreshadowLedger.value.actions]
    }
    ports.foreshadowDraft.value = { action: 'plant', title: '', foreshadowId: '', legacyChapterId: '', description: '' }
    await loadForeshadowLedger(true)
  }

  async function openForeshadowChapter(chapterId) {
    const chapter = ports.chapters.value.find((item) => item.id === chapterId)
    if (!chapter) return ports.notice('来源章节已不存在或尚未载入')
    await ports.selectActivity('desk')
    await ports.selectChapter(chapter)
  }

  return { loadForeshadowLedger, chooseForeshadow, recordForeshadowAction, openForeshadowChapter }
}
