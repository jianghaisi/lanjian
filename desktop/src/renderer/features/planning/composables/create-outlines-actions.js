import { isSameManuscriptDraft } from '../../../../contracts/manuscript/manuscript-save-identity'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createPlanningOutlinesActions(ports) {
  async function saveDocument(key, request, operation, successNotice) {
    ports.outlineStorageFeedback.beginSave?.(key)
    let failure = '保存失败，编辑稿仍在当前窗口'
    try {
      const result = await ports.guard(async () => {
        try { return await operation() }
        catch (cause) { failure = cause?.message || failure; throw cause }
      }, successNotice)
      if (ports.workspaceRequests.isCurrent(request, ports.current.value)) ports.outlineStorageFeedback.finishSave?.(key, result ? '' : failure)
      return result
    } catch (cause) {
      if (ports.workspaceRequests.isCurrent(request, ports.current.value)) ports.outlineStorageFeedback.finishSave?.(key, cause?.message || failure)
      throw cause
    }
  }
  function invalidateOutlineRead() {
    ports.outlineNavigationGeneration += 1
    ports.outlineLoading.value = ''
  }

  function outlineDraftSnapshot() {
    return JSON.stringify([
      ports.current.value?.path,
      ports.active.value,
      ports.outlineMode.value,
      ports.selectedVolume.value,
      ports.selectedStage.value,
      ports.selectedId.value,
      ports.chapterTitle.value,
      ports.chapterContent.value,
      ports.totalOutline.value,
      ports.volumeOutline.value,
      ports.stageTitle.value,
      ports.stageOutline.value,
      ports.chapterOutline.value,
      ports.plannedChapter.value?.chapterId,
      ports.plannedChapterTitle.value,
      ports.plannedChapterContent.value
    ])
  }

  function resolveOutlineLeaveChoice(choice) {
    ports.outlineLeaveDialog.value?.close()
    ports.resolveOutlineLeave?.(choice)
    ports.resolveOutlineLeave = null
  }

  async function prepareOutlineLeave() {
    if (ports.active.value !== 'outline' || ['plannedChapter', 'recovery'].includes(ports.outlineMode.value))
      return true
    if (ports.outlineComposing.value) {
      ports.notice('请先完成当前中文输入，再切换大纲。')
      return false
    }
    if (ports.busy.value) {
      ports.notice('正在保存或处理内容，请稍后再切换。')
      return false
    }
    if (
      !(ports.planningOutlineDirty.value || (ports.outlineMode.value === 'chapter' && ports.chapterOutlineDirty.value))
    )
      return true
    if (ports.outlineLeavePending.value) return false
    ports.outlineLeavePending.value = true
    try {
      const choice = await new Promise((resolve) => {
        ports.resolveOutlineLeave = resolve
        ports.outlineLeaveDialog.value?.showModal()
      })
      if (choice === 'cancel') return false
      if (choice === 'discard') {
        if (ports.outlineMode.value === 'total') ports.totalOutline.value = ports.lastSavedTotalOutline.value
        else if (ports.outlineMode.value === 'volume') ports.volumeOutline.value = ports.lastSavedVolumeOutline.value
        else if (ports.outlineMode.value === 'stage') {
          ports.stageOutline.value = ports.lastSavedStageOutline.value
          ports.stageTitle.value = ports.lastSavedStageTitle.value
        } else ports.chapterOutline.value = ports.lastSavedChapterOutline.value
        return true
      }
      if (ports.outlineMode.value === 'total') await saveOutline()
      else if (ports.outlineMode.value === 'volume') await saveVolumeOutline()
      else if (ports.outlineMode.value === 'stage') await saveStageOutline()
      else await saveChapterOutline()
      const saved =
        !ports.planningOutlineDirty.value && (ports.outlineMode.value !== 'chapter' || !ports.chapterOutlineDirty.value)
      if (!saved) ports.notice('仍有内容待保存，当前大纲已保留。')
      return saved
    } catch {
      return false
    } finally {
      ports.outlineLeavePending.value = false
    }
  }

  async function runOutlineNavigation(label, read) {
    if (!ports.current.value) return false
    const generation = ++ports.outlineNavigationGeneration
    const request = ports.workspaceRequests.capture(ports.current.value)
    const isCurrent = () =>
      generation === ports.outlineNavigationGeneration &&
      ports.workspaceRequests.isCurrent(request, ports.current.value)
    let isSourceCurrent = isCurrent
    ports.retryOutlineOpen = () => runOutlineNavigation(label, read)
    ports.outlineOpenError.value = ''
    try {
      if (!ports.worldMapWorkspace.canLeave() || ports.modelSettingsDirty.value) return false
      if (!(await prepareOutlineLeave()) || !(await ports.flushPlannedChapterSave()) || !isCurrent()) return false
      if (ports.active.value === 'desk' && !(await ports.flushChapterSaveSafely())) return false
      if (!isCurrent()) return false
      const sourceDraft = outlineDraftSnapshot()
      const sourceManuscript = ports.active.value === 'desk' ? {
        title: ports.chapterTitle.value, content: ports.chapterContent.value,
        chapterId: ports.selectedId.value, editor: ports.manuscriptEditor.value
      } : null
      isSourceCurrent = () => isCurrent() && (!sourceManuscript || (
        ports.active.value === 'desk' && ports.selectedId.value === sourceManuscript.chapterId &&
        ports.manuscriptEditor.value === sourceManuscript.editor
      ))
      ports.outlineLoading.value = `正在打开${label}…`
      const commit = await read()
      if (!isSourceCurrent()) return false
      if (sourceManuscript) {
        await sourceManuscript.editor?.flush?.()
        if (!isSourceCurrent()) return false
        if (!isSameManuscriptDraft(sourceManuscript, { title: ports.chapterTitle.value, content: ports.chapterContent.value }))
          throw new Error('当前正文有新修改，已保留输入，请重试打开。')
      }
      if (sourceDraft !== outlineDraftSnapshot()) throw new Error('当前大纲有新修改，已保留草稿，请重试打开。')
      if (ports.active.value === 'timeline' && ports.timelineMode.value === 'map') ports.worldMapWorkspace.cancelRead()
      ports.editorFocusMode.value = false
      commit()
      ports.active.value = 'outline'
      void ports.outlineStorageFeedback.refresh()
      return true
    } catch (error) {
      if (isSourceCurrent()) {
        ports.outlineOpenError.value = `${label}未打开：${error?.message || '读取失败，请重试。'}`
        ports.notice(ports.outlineOpenError.value)
      }
      return false
    } finally {
      if (isCurrent()) ports.outlineLoading.value = ''
    }
  }

  async function openPlanningVolumeCreator() {
    if (!(await prepareOutlineLeave()) || !(await ports.flushPlannedChapterSave())) return
    ports.volumeDraft.value = ''
    ports.outlineVolumeDialog.value?.showModal()
  }

  async function submitPlanningVolume() {
    try {
      await createOutlineVolume()
      if (!ports.volumeDraft.value) ports.outlineVolumeDialog.value?.close()
    } catch {
      /* guard retains the form and explains the error */
    }
  }

  async function createPlanningChapter() {
    if (!(await prepareOutlineLeave()) || !(await ports.flushPlannedChapterSave())) return
    const previousId = ports.selectedId.value
    try {
      await ports.newChapter()
      if (ports.selectedId.value !== previousId)
        await ports.openChapterFromOutlineCatalog(
          ports.chapters.value.find((item) => item.id === ports.selectedId.value)
        )
    } catch {
      /* guard preserves the current draft */
    }
  }

  function insertOutlineTemplate(text) {
    if (!ports.outlineEditor.value?.insertText(text)) ports.notice('请先选择可编辑的大纲，并完成当前中文输入。')
  }

  async function saveOutline() {
    if (!ports.current.value || ports.busy.value) return
    const request = ports.workspaceRequests.capture(ports.current.value),
      content = ports.totalOutline.value
    const result = await saveDocument('total', request, async () => {
      const reviewed = ports.outlineEditor?.value?.saveReviewedDraft ? await ports.outlineEditor.value.saveReviewedDraft({ content }) : null
      return reviewed ? { success: true, volume: 'total', content: reviewed.snapshot.content } : ports.desktop.outlines.update('total', content)
    })
    if (!result || !ports.workspaceRequests.isCurrent(request, ports.current.value)) return
    // Review receipts confirm content, not the ordinary save's storage fields.
    if (result.storageMode) ports.outlineStorageFeedback.record('total', result)
    else void ports.outlineStorageFeedback.refresh()
    ports.lastSavedTotalOutline.value = result.content
    ports.notice(ports.totalOutline.value === result.content ? '总纲已保存' : '已保存提交的总纲，后续输入仍待保存')
    await ports.refreshWorkflow()
  }

  async function openVolumeOutline(volume) {
    if (!volume) return ports.selectWorkspaceLeaf('volume-outline')
    if (
      ports.active.value === 'outline' &&
      ports.outlineMode.value === 'volume' &&
      ports.selectedVolume.value === volume
    ) {
      invalidateOutlineRead()
      return true
    }
    return runOutlineNavigation(`第 ${volume} 卷`, async () => {
      const loaded = await ports.desktop.outlines.get(volume)
      return () => {
        ports.selectedVolume.value = volume
        ports.volumeOutline.value = loaded.content
        ports.lastSavedVolumeOutline.value = loaded.content
        ports.outlineMode.value = 'volume'
      }
    })
  }

  async function refreshStageOutlines() {
    const listed = await ports.desktop.outlines.list()
    ports.stageOutlines.value = listed.stages || []
  }

  async function openStageOutline(stage) {
    if (
      ports.active.value === 'outline' &&
      ports.outlineMode.value === 'stage' &&
      ports.selectedStage.value === stage.stage
    ) {
      invalidateOutlineRead()
      return true
    }
    const document = ports.stageOutlines.value.find((item) => item.stage === stage.stage)
    if (!document) return ports.notice('阶段已经变化，请重新选择。')
    return runOutlineNavigation('阶段纲', async () => () => {
      ports.selectedStage.value = document.stage
      ports.selectedVolume.value = document.volume
      ports.stageTitle.value = document.title
      ports.stageOutline.value = document.content
      ports.lastSavedStageTitle.value = document.title
      ports.lastSavedStageOutline.value = document.content
      ports.outlineMode.value = 'stage'
    })
  }

  async function createOutlineStage() {
    if (!ports.selectedVolume.value || !ports.stageDraftTitle.value.trim()) return
    const result = await ports.guard(
      () => ports.desktop.outlines.createStage(ports.selectedVolume.value, ports.stageDraftTitle.value),
      `已在第 ${ports.selectedVolume.value} 卷建立阶段纲`
    )
    if (!result) return
    ports.stageDraftTitle.value = ''
    await refreshStageOutlines()
    openStageOutline(result.stage)
  }

  async function saveStageOutline() {
    if (!ports.selectedStage.value || !ports.stageTitle.value.trim()) return ports.notice('请先选择阶段并填写名称')
    if (!ports.current.value || ports.busy.value) return
    const request = ports.workspaceRequests.capture(ports.current.value),
      stage = ports.selectedStage.value
    const title = ports.stageTitle.value,
      content = ports.stageOutline.value
    const stageDocument = ports.stageOutlines.value.find(item => item.stage === stage)
    if (!stageDocument) return ports.notice('阶段已经变化，请重新选择。')
    const result = await saveDocument(`stage:${stage}`, request, async () => {
      const reviewed = ports.outlineEditor?.value?.saveReviewedDraft ? await ports.outlineEditor.value.saveReviewedDraft({ title, content }) : null
      if (!reviewed) return ports.desktop.outlines.updateStage(stage, title, content)
      return { success: true, stage: { ...stageDocument, title: reviewed.snapshot.title, content: reviewed.snapshot.content, mirrorStatus: undefined } }
    })
    if (!result || !ports.workspaceRequests.isCurrent(request, ports.current.value)) return
    ports.stageOutlines.value = ports.stageOutlines.value.map(item => item.stage !== stage ? item : result.storageMode ? result.stage :
      { ...item, title: result.stage.title, content: result.stage.content, mirrorStatus: undefined })
    if (result.storageMode) ports.outlineStorageFeedback.record(`stage:${stage}`, {
      storageMode: result.storageMode,
      mirrorStatus: result.stage.mirrorStatus
    })
    else void ports.outlineStorageFeedback.refresh()
    if (ports.selectedStage.value === stage) {
      ports.lastSavedStageTitle.value = result.stage.title
      ports.lastSavedStageOutline.value = result.stage.content
      if (ports.stageTitle.value === title) ports.stageTitle.value = result.stage.title
    }
    ports.notice(
      !result.storageMode ? '当前阶段纲已保存' : result.stage.mirrorStatus === 'synced'
        ? '当前阶段纲已保存，Markdown 已同步'
        : '当前阶段纲已存入 SQLite，Markdown 镜像待核对'
    )
  }

  async function saveVolumeOutline() {
    if (!ports.selectedVolume.value) return ports.notice('请先选择一个篇卷')
    if (!ports.current.value || ports.busy.value) return
    const request = ports.workspaceRequests.capture(ports.current.value),
      volume = ports.selectedVolume.value,
      content = ports.volumeOutline.value
    const result = await saveDocument(`volume:${volume}`, request, async () => {
      const reviewed = ports.outlineEditor?.value?.saveReviewedDraft ? await ports.outlineEditor.value.saveReviewedDraft({ content }) : null
      return reviewed ? { success: true, volume, content: reviewed.snapshot.content } : ports.desktop.outlines.update(volume, content)
    })
    if (!result || !ports.workspaceRequests.isCurrent(request, ports.current.value)) return
    if (result.storageMode) ports.outlineStorageFeedback.record(`volume:${volume}`, result)
    else void ports.outlineStorageFeedback.refresh()
    if (ports.selectedVolume.value === volume) ports.lastSavedVolumeOutline.value = result.content
    ports.notice(`第 ${volume} 卷卷纲已保存`)
    await ports.refreshWorkflow()
  }

  async function acknowledgePlanningReview() {
    if (!ports.planningOutlineReview.value || ports.planningOutlineReview.value.status === 'clear') return
    if (ports.planningOutlineDirty.value) return ports.notice('大纲有尚未保存的改动，请先保存再记录')
    const scope = ports.outlineMode.value === 'total' ? 'total' : ports.selectedVolume.value
    if (!scope) return ports.notice('请先选择一个篇卷')
    ports.outlinePlanning.value = await ports.guard(
      () => ports.desktop.outlines.acknowledgeReview(scope),
      '已记录为当前版本的已知提示；内容变化后会自动重新预审'
    )
    await ports.refreshWorkflow()
  }

  async function confirmPlanningOutline() {
    if (!ports.planningOutlineApproval.value) return
    if (ports.planningOutlineDirty.value) return ports.notice('大纲有尚未保存的改动，请先保存再确认')
    const scope = ports.outlineMode.value === 'total' ? 'total' : ports.selectedVolume.value
    if (!scope) return ports.notice('请先选择一个篇卷')
    ports.outlinePlanning.value = await ports.guard(
      () => ports.desktop.outlines.confirmPlanning(scope),
      scope === 'total' ? '当前总纲版本已正式确认' : `第 ${scope} 卷卷纲已正式确认`
    )
    await ports.refreshWorkflow()
  }

  async function saveChapterOutline() {
    if (ports.chapterOrderIssue.value) return ports.notice('章节顺序账本待核对，暂不能保存章节大纲')
    if (!ports.selectedId.value) return ports.notice('请先建立或选择一个章节')
    if (!ports.current.value || ports.busy.value) return
    const chapterId = ports.selectedId.value
    const request = ports.workspaceRequests.capture(ports.current.value)
    const content = ports.chapterOutline.value
    const result = await saveDocument(`chapter:${chapterId}`, request, async () => {
      const reviewed = ports.outlineEditor?.value?.saveReviewedDraft ? await ports.outlineEditor.value.saveReviewedDraft({ content }) : null
      return reviewed ? { chapterId, content: reviewed.snapshot.content } : ports.desktop.chapterOutlines.update(chapterId, content)
    }, '当前章纲已保存')
    if (!result || !ports.workspaceRequests.isCurrent(request, ports.current.value) || ports.selectedId.value !== chapterId) return
    if (result.storageMode) ports.outlineStorageFeedback.record(`chapter:${chapterId}`, result)
    else void ports.outlineStorageFeedback.refresh()
    ports.lastSavedChapterOutline.value = result.content
    await ports.refreshWorkflow()
  }

  async function acceptRecoveredChapterOutline({ workItemId, chapterId, draft, result }) {
    if (ports.current.value?.id !== workItemId || ports.selectedId.value !== chapterId) return
    if (ports.chapterOutline.value === draft) ports.chapterOutline.value = result.outline.content
    ports.lastSavedChapterOutline.value = result.outline.content
    ports.outlineStorageFeedback.record(`chapter:${chapterId}`, {
      storageMode: 'sqlite',
      mirrorStatus: result.outline.mirrorStatus
    })
    await ports.refreshWorkflow()
  }

  async function confirmChapterOutline() {
    if (ports.chapterOrderIssue.value) return ports.notice('章节顺序账本待核对，暂不能确认章节契约')
    if (!ports.selectedId.value) return ports.notice('请先建立或选择一个章节')
    if (ports.chapterOutlineDirty.value) return ports.notice('章纲有尚未保存的改动，请先保存再确认')
    ports.outlinePlanning.value = await ports.guard(
      () => ports.desktop.outlines.confirmChapter(ports.selectedId.value),
      '当前版本章纲已审核确认，正文生成门禁已开启'
    )
    await ports.refreshWorkflow()
  }

  async function setChapterPlacement(value) {
    if (ports.chapterOrderIssue.value) return ports.notice('章节顺序账本待核对，暂不能调整章节归卷')
    if (!ports.selectedId.value) return ports.notice('请先建立或选择一个章节')
    const volume = value === 'unassigned' ? null : Number(value)
    if (volume === null && ports.selectedChapterStage.value) {
      return ports.notice('请先把当前章从阶段移到“本卷直属”，再设为待归卷')
    }
    ports.outlinePlanning.value = await ports.guard(
      () => ports.desktop.outlines.placeChapter(ports.selectedId.value, volume),
      volume ? `当前章已归入第 ${volume} 卷` : '当前章已设为待归卷'
    )
    if (ports.selectedChapterStage.value && ports.selectedChapterStage.value.volume !== volume) {
      await ports.guard(
        () => ports.desktop.outlines.placeChapterInStage(ports.selectedId.value, null, volume),
        '章节已移出原阶段'
      )
      await refreshStageOutlines()
    }
    await ports.refreshWorkflow()
  }

  async function setChapterStage(value) {
    if (!ports.selectedId.value || !ports.selectedChapterVolume.value) return ports.notice('请先把当前章归入一个篇卷')
    const stage = value === 'unassigned' ? null : Number(value)
    const result = await ports.guard(
      () =>
        ports.desktop.outlines.placeChapterInStage(ports.selectedId.value, stage, ports.selectedChapterVolume.value),
      stage ? '当前章已归入所选阶段' : '当前章已移到本卷直属章节'
    )
    if (!result) return
    await refreshStageOutlines()
  }

  function chapterPosition(chapterId) {
    return ports.chapters.value.find((item) => item.id === chapterId)?.position || chapterId
  }

  async function reorderSelectedChapter(value) {
    if (ports.chapterOrderIssue.value) return ports.notice('章节顺序账本待核对，暂不能调整章序')
    if (!ports.selectedId.value) return
    const position = Number(value)
    if (position === ports.selectedChapterPosition.value) return
    await ports.flushChapterSave()
    ports.chapters.value = await ports.guard(
      () => ports.desktop.chapters.reorder(ports.selectedId.value, position),
      `当前章已移到第 ${position} 位`
    )
    await ports.refreshWorkflow()
  }

  function eventVolume(eventId) {
    return ports.outlinePlanning.value.volumes.find((volume) => volume.eventIds.includes(eventId)) || null
  }

  function eventPlacementValue(eventId) {
    const chapter = ports.outlinePlanning.value.eventChapterPlacements.find((item) => item.eventId === eventId)
    if (chapter) return `chapter:${chapter.chapterId}`
    const volume = eventVolume(eventId)
    if (volume) return String(volume.volume)
    return ports.outlinePlanning.value.assignedEventIds.includes(eventId) ? 'total' : 'unassigned'
  }

  function eventPlacementLabel(eventId) {
    const chapter = ports.outlinePlanning.value.eventChapterPlacements.find((item) => item.eventId === eventId)
    if (chapter) return `已入第 ${chapterPosition(chapter.chapterId)} 章契约`
    const volume = eventVolume(eventId)
    if (volume) return `已归第 ${volume.volume} 卷`
    return ports.outlinePlanning.value.assignedEventIds.includes(eventId) ? '已入总纲 · 待分卷' : '待入总纲'
  }

  async function setEventPlacement(eventId, value) {
    if (value === 'unassigned')
      ports.outlinePlanning.value = await ports.guard(
        () => ports.desktop.outlines.unassignEvent(eventId),
        '事件已移出总纲'
      )
    else if (value === 'total') {
      const assigned = ports.outlinePlanning.value.assignedEventIds.includes(eventId)
      ports.outlinePlanning.value = await ports.guard(
        () =>
          assigned ? ports.desktop.outlines.placeEvent(eventId, null) : ports.desktop.outlines.assignEvent(eventId),
        '事件已纳入总纲，等待分卷'
      )
    } else if (value.startsWith('chapter:')) {
      const chapterId = Number(value.slice('chapter:'.length))
      ports.outlinePlanning.value = await ports.guard(
        () => ports.desktop.outlines.placeEventInChapter(eventId, chapterId),
        `事件已进入第 ${chapterPosition(chapterId)} 章契约`
      )
    } else
      ports.outlinePlanning.value = await ports.guard(
        () => ports.desktop.outlines.placeEvent(eventId, Number(value)),
        `事件已归入第 ${value} 卷`
      )
    await ports.refreshWorkflow()
  }

  async function createOutlineVolume() {
    const title = ports.volumeDraft.value.trim()
    if (!title) return ports.notice('请先填写卷名')
    ports.outlinePlanning.value = await ports.guard(() => ports.desktop.outlines.createVolume(title), '新篇卷已建立')
    ports.volumeDraft.value = ''
    await ports.refreshWorkflow()
    const created = ports.outlinePlanning.value.volumes.at(-1)
    if (created) await openVolumeOutline(created.volume)
  }

  async function renameOutlineVolume(volume, title) {
    const normalized = String(title || '').trim()
    const existing = ports.outlinePlanning.value.volumes.find((item) => item.volume === volume)
    if (!normalized) {
      ports.notice('卷名不能为空')
      await ports.refreshWorkflow()
      return
    }
    if (existing?.title === normalized) return
    ports.outlinePlanning.value = await ports.guard(
      () => ports.desktop.outlines.renameVolume(volume, normalized),
      `第 ${volume} 卷卷名已更新`
    )
    await ports.refreshWorkflow()
  }

  async function generateChapterOutline() {
    if (ports.chapterOrderIssue.value) return ports.notice('章节顺序账本待核对，暂不能生成章节大纲')
    if (!ports.selectedId.value) return ports.notice('请先建立或选择一个章节')
    const result = await ports.guard(
      () => ports.desktop.planning.generateChapterStory(ports.selectedId.value),
      '章纲已生成，请确认后保存'
    )
    ports.chapterOutline.value = result.content
    ports.outlineMode.value = 'chapter'
  }

  return {
    invalidateOutlineRead,
    outlineDraftSnapshot,
    resolveOutlineLeaveChoice,
    prepareOutlineLeave,
    runOutlineNavigation,
    openPlanningVolumeCreator,
    submitPlanningVolume,
    createPlanningChapter,
    insertOutlineTemplate,
    saveOutline,
    openVolumeOutline,
    refreshStageOutlines,
    openStageOutline,
    createOutlineStage,
    saveStageOutline,
    saveVolumeOutline,
    acknowledgePlanningReview,
    confirmPlanningOutline,
    saveChapterOutline,
    acceptRecoveredChapterOutline,
    confirmChapterOutline,
    setChapterPlacement,
    setChapterStage,
    chapterPosition,
    reorderSelectedChapter,
    eventVolume,
    eventPlacementValue,
    eventPlacementLabel,
    setEventPlacement,
    createOutlineVolume,
    renameOutlineVolume,
    generateChapterOutline
  }
}
