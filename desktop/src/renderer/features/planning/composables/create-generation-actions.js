// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createPlanningGenerationActions(ports) {
  function clearPlanningPoll() {
    if (ports.planningPollTimer) window.clearTimeout(ports.planningPollTimer)
    ports.planningPollTimer = null
  }

  async function startAutomaticPlanning() {
    if (!ports.planningMaterialsReady.value)
      return ports.notice('请先在“素材”中批准一条灵感，或保存全书备注、资料卡或正式设定')
    if (!(ports.ai.value.modelConfigured ?? ports.ai.value.apiKeyConfigured))
      return ports.notice('请先在模型设置中保存并测试模型连接')
    try {
      await ports.desktop.workspace.saveBookProfile(ports.plainDto(ports.bookProfile.value))
      ports.planningJob.value = await ports.guard(() => ports.desktop.planning.start(), '自动谋篇已经开始')
      pollAutomaticPlanning()
    } catch {
      /* guard 已经给出可恢复提示 */
    }
  }

  async function handleTotalOutlineAi() {
    if (ports.planningRunning.value) return
    if (ports.planningDraft.value) {
      ports.active.value = 'preparation'
      ports.preparationMode.value = 'automatic'
      return ports.notice('已经打开总纲候选，请核对后再逐项采用')
    }
    await startAutomaticPlanning()
  }

  function pollAutomaticPlanning() {
    clearPlanningPoll()
    if (!ports.planningJob.value || ports.planningJob.value.status !== 'running') return
    ports.planningPollTimer = window.setTimeout(async () => {
      try {
        ports.planningJob.value = await ports.desktop.planning.job(ports.planningJob.value.id)
        if (ports.planningJob.value.status === 'completed') {
          ports.planningDraft.value = await ports.desktop.planning.draft()
          ports.planningDraftSaveState.value = 'saved'
          ports.notice('蓝图、总纲和卷纲候选已经完成，请审阅')
        }
        if (ports.planningJob.value.status === 'failed')
          ports.notice(ports.planningJob.value.error?.message || '自动谋篇未完成')
        if (ports.planningJob.value.status === 'running') pollAutomaticPlanning()
      } catch (error) {
        clearPlanningPoll()
        ports.planningJob.value = null
        ports.notice(error?.message || '自动谋篇任务已经结束')
      }
    }, 500)
  }

  async function cancelAutomaticPlanning(announce = true) {
    clearPlanningPoll()
    if (!ports.planningJob.value || ports.planningJob.value.status !== 'running') return
    try {
      ports.planningJob.value = await ports.desktop.planning.cancel(ports.planningJob.value.id)
      if (announce) ports.notice('自动谋篇已停止，正式设定与大纲没有改变')
    } catch (error) {
      if (announce) ports.notice(error?.message || '停止自动谋篇失败')
    }
  }

  async function discardPlanningProposal() {
    await cancelPlanningChapterDetail(false)
    await cancelPlanningChapterSkeleton(false)
    clearPlanningPoll()
    clearPlanningDraftSave()
    await ports.guard(() => ports.desktop.planning.discardDraft())
    ports.planningJob.value = null
    ports.planningDraft.value = null
    ports.planningAdoptionPreview.value = null
    ports.planningVolumeStructurePreview.value = null
    ports.planningVolumeOutlinePreview.value = null
    ports.planningCharacterSeedPreview.value = null
    ports.planningWorldSeedPreview.value = null
    ports.planningPowerSystemPreview.value = null
    ports.planningCheatSystemPreview.value = null
    ports.planningDraftSaveState.value = 'saved'
    ports.notice('候选已经放弃，正式设定与大纲没有改变')
  }

  async function recoverDamagedPlanningDraft() {
    const issue = ports.workspaceBootstrapIssues.value.find((item) => item.id === 'planningDraftUnreadable')
    if (!issue || ports.busy.value) return
    if (!window.confirm('保留损坏候选的原文件，并把它移到本书恢复目录后重新开始谋篇？正式设定、大纲和正文不会改变。'))
      return
    const result = await ports.guard(() => ports.desktop.planning.recoverDamagedDraft())
    ports.workspaceBootstrapIssues.value = ports.workspaceBootstrapIssues.value.filter((item) => item.id !== issue.id)
    ports.planningDraft.value = null
    ports.notice(`损坏候选已原样保留在 ${result.recoveryRelativePath}，现在可以重新开始谋篇`)
  }

  async function recoverDamagedPromptProfile() {
    const issue = ports.workspaceBootstrapIssues.value.find((item) => item.id === 'promptProfileUnreadable')
    if (!issue || ports.busy.value) return
    if (
      !window.confirm(
        '保留损坏提示词的原文件，并把它移到本书恢复目录？恢复后将使用当前题材的内置提示词，正文、设定与大纲不会改变。'
      )
    )
      return
    const result = await ports.guard(() => ports.desktop.workspace.recoverDamagedPromptProfile())
    ports.promptProfile.value = await ports.guard(() => ports.desktop.workspace.getPromptProfile())
    ports.workspaceBootstrapIssues.value = ports.workspaceBootstrapIssues.value.filter((item) => item.id !== issue.id)
    ports.notice(`损坏提示词已原样保留在 ${result.recoveryRelativePath}，当前已恢复内置提示词`)
  }

  function clearPlanningDraftSave() {
    if (ports.planningDraftSaveTimer) window.clearTimeout(ports.planningDraftSaveTimer)
    ports.planningDraftSaveTimer = null
  }

  function schedulePlanningDraftSave() {
    clearPlanningDraftSave()
    if (!ports.planningDraft.value || ports.planningRunning.value) return
    ports.planningDraftEditVersion += 1
    ports.planningDraftSaveError = null
    ports.planningDraftSaveState.value = 'dirty'
    ports.planningDraftSaveTimer = window.setTimeout(() => {
      void persistPlanningDraft(false)
    }, 650)
  }

  async function persistPlanningDraft(rethrow = false) {
    clearPlanningDraftSave()
    if (!ports.planningDraft.value || ports.planningRunning.value) return
    const version = ports.planningDraftEditVersion
    const snapshot = ports.plainDto(ports.planningDraft.value)
    ports.planningDraftSaveState.value = 'saving'
    const operation = ports.planningDraftSaveQueue.then(() => ports.desktop.planning.saveDraft(snapshot))
    ports.planningDraftSaveQueue = operation.catch(() => undefined)
    try {
      // Keep the reactive object in place; replacing it with the returned clone would
      // look like another user edit and create an endless autosave loop.
      await operation
      if (ports.planningDraftEditVersion === version) ports.planningDraftSaveError = null
      ports.planningDraftSaveState.value = ports.planningDraftEditVersion === version ? 'saved' : 'dirty'
    } catch (error) {
      if (ports.planningDraftEditVersion === version) ports.planningDraftSaveError = error
      if (ports.planningDraftEditVersion === version) ports.planningDraftSaveState.value = 'error'
      ports.notice(error?.message || '谋篇候选保存失败')
      if (rethrow) throw error
    }
  }

  async function flushPlanningDraftSave() {
    if (ports.planningDraftSaveState.value === 'dirty' || ports.planningDraftSaveTimer) await persistPlanningDraft(true)
    await ports.planningDraftSaveQueue
    if (ports.planningDraftSaveError) throw ports.planningDraftSaveError
    if (ports.planningDraftSaveState.value === 'dirty') await persistPlanningDraft(true)
  }

  function markPlanningTotalEdited() {
    markPlanningSkeletonUpstreamChanged()
    if (!ports.planningDraft.value?.adoption) return
    delete ports.planningDraft.value.adoption.totalOutline
    delete ports.planningDraft.value.adoption.volumeStructure
    delete ports.planningDraft.value.adoption.volumeOutlines
  }

  function markPlanningVolumeStructureEdited() {
    markPlanningSkeletonUpstreamChanged()
    if (!ports.planningDraft.value?.adoption) return
    delete ports.planningDraft.value.adoption.volumeStructure
    delete ports.planningDraft.value.adoption.volumeOutlines
  }

  function markPlanningVolumeOutlineEdited(order) {
    markPlanningSkeletonUpstreamChanged()
    const adopted = ports.planningDraft.value?.adoption?.volumeOutlines
    if (!adopted) return
    ports.planningDraft.value.adoption.volumeOutlines = adopted.filter((item) => item.order !== order)
  }

  function invalidatePlanningOutlinesFromFoundation() {
    markPlanningSkeletonUpstreamChanged()
    if (!ports.planningDraft.value?.adoption) return
    delete ports.planningDraft.value.adoption.totalOutline
    delete ports.planningDraft.value.adoption.volumeStructure
    delete ports.planningDraft.value.adoption.volumeOutlines
  }

  function markPlanningSkeletonUpstreamChanged() {
    markPlanningDetailsStale('总纲或篇卷候选已变化；旧详细章纲只保留供比较。')
    if (ports.planningDraft.value?.adoption) delete ports.planningDraft.value.adoption.chapterOutlines
    if (!ports.planningDraft.value?.chapterSkeleton) return
    ports.planningSkeletonStatus.value = {
      exists: true,
      stale: true,
      chapterCount: ports.planningDraft.value.chapterSkeleton.chapters.length,
      volumeCount: new Set(ports.planningDraft.value.chapterSkeleton.chapters.map((item) => item.volume)).size,
      reason: '总纲或篇卷候选已变化；旧章节安排保留供比较，但不能作为下一步依据。'
    }
  }

  function markPlanningDetailsStale(reason = '章节安排已变化；旧详细章纲只保留供比较。') {
    ports.planningDetailStatuses.value = ports.planningDetailStatuses.value.map((item) =>
      item.exists ? { ...item, stale: true, reason } : item
    )
  }

  function markPlanningSkeletonEdited() {
    markPlanningDetailsStale()
    schedulePlanningDraftSave()
  }

  function updateSkeletonCharacters(chapter, value) {
    chapter.characters = [
      ...new Set(
        String(value || '')
          .split(/[、,，;；]/)
          .map((item) => item.trim())
          .filter(Boolean)
      )
    ]
    markPlanningSkeletonEdited()
  }

  function markPlanningChapterDetailEdited(chapterId) {
    if (ports.planningDraft.value?.adoption?.chapterOutlines) {
      ports.planningDraft.value.adoption.chapterOutlines = ports.planningDraft.value.adoption.chapterOutlines.filter(
        (item) => item.chapter !== chapterId
      )
    }
    schedulePlanningDraftSave()
  }

  function updatePlanningChapterDetailList(chapter, field, value) {
    chapter[field] = String(value || '')
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
    markPlanningChapterDetailEdited(chapter.chapter)
  }

  function clearPlanningSkeletonPoll() {
    if (ports.planningSkeletonPollTimer) window.clearTimeout(ports.planningSkeletonPollTimer)
    ports.planningSkeletonPollTimer = null
  }

  async function startPlanningChapterSkeleton() {
    if (!ports.planningDraft.value || ports.planningSkeletonRunning.value) return
    try {
      await flushPlanningDraftSave()
      ports.planningSkeletonJob.value = await ports.desktop.planning.startChapterSkeleton(ports.planningDraft.value.id)
      ports.notice('全书章节安排开始按卷生成，可随时停止')
      pollPlanningChapterSkeleton()
    } catch (error) {
      ports.notice(error?.message || '章节安排任务未能开始')
    }
  }

  function pollPlanningChapterSkeleton() {
    clearPlanningSkeletonPoll()
    if (!ports.planningSkeletonJob.value || ports.planningSkeletonJob.value.status !== 'running') return
    ports.planningSkeletonPollTimer = window.setTimeout(async () => {
      try {
        ports.planningSkeletonJob.value = await ports.desktop.planning.chapterSkeletonJob(
          ports.planningSkeletonJob.value.id
        )
        if (ports.planningSkeletonJob.value.status === 'completed') {
          ports.suppressNextPlanningDraftSave = true
          ports.planningDraft.value = ports.planningSkeletonJob.value.proposal
          ports.planningDraftSaveState.value = 'saved'
          ports.planningSkeletonStatus.value = await ports.desktop.planning.chapterSkeletonStatus(
            ports.planningDraft.value.id
          )
          ports.notice(`全书 ${ports.planningSkeletonStatus.value.chapterCount} 章章节安排已经生成，请审阅修改`)
        } else if (ports.planningSkeletonJob.value.status === 'failed')
          ports.notice(ports.planningSkeletonJob.value.error?.message || '章节安排未完成')
        else pollPlanningChapterSkeleton()
      } catch (error) {
        clearPlanningSkeletonPoll()
        ports.planningSkeletonJob.value = null
        ports.notice(error?.message || '章节安排任务已经结束')
      }
    }, 500)
  }

  async function cancelPlanningChapterSkeleton(announce = true) {
    clearPlanningSkeletonPoll()
    if (!ports.planningSkeletonJob.value || ports.planningSkeletonJob.value.status !== 'running') return
    try {
      ports.planningSkeletonJob.value = await ports.desktop.planning.cancelChapterSkeleton(
        ports.planningSkeletonJob.value.id
      )
      if (announce) ports.notice('章节安排生成已停止，没有保留半套结果')
    } catch (error) {
      if (announce) ports.notice(error?.message || '停止章节安排失败')
    }
  }

  function clearPlanningDetailPoll() {
    if (ports.planningDetailPollTimer) window.clearTimeout(ports.planningDetailPollTimer)
    ports.planningDetailPollTimer = null
  }

  async function startPlanningChapterDetail(volume) {
    if (!ports.planningDraft.value || ports.planningDetailRunning.value) return
    try {
      await flushPlanningDraftSave()
      ports.planningDetailJob.value = await ports.desktop.planning.startChapterDetail(
        ports.planningDraft.value.id,
        volume
      )
      ports.notice(`第 ${volume} 卷详细章纲开始分批生成`)
      pollPlanningChapterDetail()
    } catch (error) {
      ports.notice(error?.message || '详细章纲任务未能开始')
    }
  }

  function pollPlanningChapterDetail() {
    clearPlanningDetailPoll()
    if (!ports.planningDetailJob.value || ports.planningDetailJob.value.status !== 'running') return
    ports.planningDetailPollTimer = window.setTimeout(async () => {
      try {
        ports.planningDetailJob.value = await ports.desktop.planning.chapterDetailJob(ports.planningDetailJob.value.id)
        if (ports.planningDetailJob.value.status === 'completed') {
          ports.suppressNextPlanningDraftSave = true
          ports.planningDraft.value = ports.planningDetailJob.value.proposal
          ports.planningDraftSaveState.value = 'saved'
          ports.planningDetailStatuses.value = await ports.desktop.planning.chapterDetailStatuses(
            ports.planningDraft.value.id
          )
          ports.notice(`第 ${ports.planningDetailJob.value.volume} 卷详细章纲候选已完成，请审阅修改`)
        } else if (ports.planningDetailJob.value.status === 'failed')
          ports.notice(ports.planningDetailJob.value.error?.message || '详细章纲未完成')
        else pollPlanningChapterDetail()
      } catch (error) {
        clearPlanningDetailPoll()
        ports.planningDetailJob.value = null
        ports.notice(error?.message || '详细章纲任务已经结束')
      }
    }, 500)
  }

  async function cancelPlanningChapterDetail(announce = true) {
    clearPlanningDetailPoll()
    if (!ports.planningDetailJob.value || ports.planningDetailJob.value.status !== 'running') return
    try {
      ports.planningDetailJob.value = await ports.desktop.planning.cancelChapterDetail(ports.planningDetailJob.value.id)
      if (announce) ports.notice('详细章纲生成已停止，旧候选保持不变')
    } catch (error) {
      if (announce) ports.notice(error?.message || '停止详细章纲失败')
    }
  }

  async function openPlanningChapterDetailAdoption(chapterId) {
    if (!ports.planningDraft.value || ports.planningAdoptionBusy.value) return
    ports.planningAdoptionBusy.value = true
    try {
      await flushPlanningDraftSave()
      ports.planningChapterDetailPreview.value = await ports.desktop.planning.previewChapterDetailAdoption(
        ports.planningDraft.value.id,
        chapterId
      )
    } catch (error) {
      ports.notice(error?.message || '详细章纲影响预览未能打开')
    } finally {
      ports.planningAdoptionBusy.value = false
    }
  }

  async function confirmPlanningChapterDetailAdoption() {
    if (!ports.planningChapterDetailPreview.value || ports.planningAdoptionBusy.value) return
    ports.planningAdoptionBusy.value = true
    try {
      const preview = ports.planningChapterDetailPreview.value
      const result = await ports.desktop.planning.adoptChapterDetail({
        proposalId: preview.proposalId,
        chapterId: preview.chapterId,
        upstreamFingerprint: preview.upstreamFingerprint,
        candidateFingerprint: preview.candidateFingerprint,
        currentFingerprint: preview.currentFingerprint
      })
      ports.suppressNextPlanningDraftSave = true
      ports.planningDraft.value = result.proposal
      ports.outlinePlanning.value = result.planning
      if (ports.selectedId.value === preview.chapterId) {
        const savedOutline = await ports.desktop.chapterOutlines.get(preview.chapterId)
        ports.chapterOutline.value = savedOutline.content
        ports.lastSavedChapterOutline.value = savedOutline.content
      }
      ports.planningChapterDetailPreview.value = null
      ports.notice(`第 ${preview.chapterId} 章已写入正式章纲，仍需复核确认`)
    } catch (error) {
      ports.notice(error?.message || '详细章纲未能采用')
    } finally {
      ports.planningAdoptionBusy.value = false
    }
  }

  function markPlanningCharacterSeedsEdited() {
    if (!ports.planningDraft.value?.adoption) return
    delete ports.planningDraft.value.adoption.characterSeeds
    invalidatePlanningOutlinesFromFoundation()
  }

  function markPlanningWorldSeedEdited() {
    if (!ports.planningDraft.value?.adoption) return
    delete ports.planningDraft.value.adoption.worldSeed
    invalidatePlanningOutlinesFromFoundation()
  }

  function markPlanningPowerSystemEdited() {
    if (!ports.planningDraft.value?.adoption) return
    delete ports.planningDraft.value.adoption.powerSystem
    invalidatePlanningOutlinesFromFoundation()
  }

  function markPlanningCheatSystemEdited() {
    if (!ports.planningDraft.value?.adoption) return
    delete ports.planningDraft.value.adoption.cheatSystem
    invalidatePlanningOutlinesFromFoundation()
  }

  return {
    clearPlanningPoll,
    startAutomaticPlanning,
    handleTotalOutlineAi,
    pollAutomaticPlanning,
    cancelAutomaticPlanning,
    discardPlanningProposal,
    recoverDamagedPlanningDraft,
    recoverDamagedPromptProfile,
    clearPlanningDraftSave,
    schedulePlanningDraftSave,
    persistPlanningDraft,
    flushPlanningDraftSave,
    markPlanningTotalEdited,
    markPlanningVolumeStructureEdited,
    markPlanningVolumeOutlineEdited,
    invalidatePlanningOutlinesFromFoundation,
    markPlanningSkeletonUpstreamChanged,
    markPlanningDetailsStale,
    markPlanningSkeletonEdited,
    updateSkeletonCharacters,
    markPlanningChapterDetailEdited,
    updatePlanningChapterDetailList,
    clearPlanningSkeletonPoll,
    startPlanningChapterSkeleton,
    pollPlanningChapterSkeleton,
    cancelPlanningChapterSkeleton,
    clearPlanningDetailPoll,
    startPlanningChapterDetail,
    pollPlanningChapterDetail,
    cancelPlanningChapterDetail,
    openPlanningChapterDetailAdoption,
    confirmPlanningChapterDetailAdoption,
    markPlanningCharacterSeedsEdited,
    markPlanningWorldSeedEdited,
    markPlanningPowerSystemEdited,
    markPlanningCheatSystemEdited
  }
}
