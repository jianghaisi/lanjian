import { watch } from 'vue'

// The controller constructs live ports before its refs; observe them only on the first action.
export function createReviewFactsActions(ports) {
  let stopWatching, pollTimer, extraction, review, epoch = 0, disposed = false

  function clearPoll() {
    clearTimeout(pollTimer)
    pollTimer = undefined
  }

  function reset() {
    epoch += 1
    clearPoll()
    extraction = review = undefined
    ports.factExtractionBusy.value = false
    ports.factExtractionJobId.value = ''
    ports.factExtractionRetryId.value = ''
    ports.factExtractionRawResult.value = ''
    ports.factReviewBusy.value = false
  }

  function observe() {
    if (disposed) return false
    stopWatching ??= watch(
      () => [ports.current.value?.id, ports.current.value?.path, ports.selectedId.value],
      reset,
      { flush: 'sync' }
    )
    // Generations can change even when the selected IDs do not.
    if ((extraction && !isCurrent(extraction)) || (review && !isCurrent(review))) reset()
    return Boolean(ports.current.value)
  }

  function capture() {
    return {
      request: ports.workspaceRequests.capture(ports.current.value),
      chapter: ports.selectedId.value,
      chapterGeneration: ports.chapterSelectionGeneration,
      epoch
    }
  }

  function isCurrent(owner) {
    return !disposed && owner.epoch === epoch
      && ports.workspaceRequests.isCurrent(owner.request, ports.current.value)
      && owner.chapter === ports.selectedId.value
      && owner.chapterGeneration === ports.chapterSelectionGeneration
  }

  function ownsExtraction(owner, jobId = owner?.jobId) {
    return Boolean(owner && extraction === owner && isCurrent(owner) && owner.jobId === jobId)
  }

  function finishExtraction(owner) {
    if (!ownsExtraction(owner)) return
    clearPoll()
    extraction = undefined
    ports.factExtractionBusy.value = false
    ports.factExtractionJobId.value = ''
  }

  async function decideFactChanges(input) {
    if (!observe() || ports.factReviewBusy.value) return
    const owner = review = capture()
    ports.factReviewBusy.value = true
    try {
      const updated = await ports.desktop.workspace.decideFactChanges(input)
      if (review !== owner || !isCurrent(owner)) return
      const index = ports.factBatches.value.findIndex((batch) => batch.id === updated.id)
      if (index >= 0) ports.factBatches.value.splice(index, 1, updated)
      else ports.factBatches.value = [updated, ...ports.factBatches.value]
      ports.contextFactPackKey = ''
      await ports.refreshWorkflow()
      if (review !== owner || !isCurrent(owner)) return
      ports.notice(
        updated.status === 'PARTIALLY_APPROVED' ? '已保存这些选择；其余变化可以稍后再看' : '选择已保存，可以继续写作'
      )
    } catch (error) {
      if (review === owner && isCurrent(owner)) ports.notice(error?.message || '事实审批保存失败，请重试')
    } finally {
      if (review === owner && isCurrent(owner)) {
        review = undefined
        ports.factReviewBusy.value = false
      }
    }
  }

  async function extractCurrentChapterFacts() {
    if (!observe() || !ports.selectedId.value || ports.factExtractionBusy.value) return
    const owner = extraction = capture()
    ports.factExtractionBusy.value = true
    ports.factExtractionRetryId.value = ''
    ports.factExtractionRawResult.value = ''
    try {
      const job = await ports.desktop.workspace.startFactExtraction(owner.chapter)
      if (!ownsExtraction(owner)) return
      owner.jobId = job.id
      ports.factExtractionJobId.value = job.id
      void pollFactExtraction(job.id, owner)
      if (owner.cancelRequested) void cancelFactExtraction()
    } catch (error) {
      if (ownsExtraction(owner)) {
        ports.notice(error?.message || '事实提炼未启动')
        finishExtraction(owner)
      }
    }
  }

  async function settle(job, owner) {
    if (!ownsExtraction(owner, job.id) || owner.settling) return
    owner.settling = true
    clearPoll()
    if (job.status === 'completed') {
      ports.factExtractionRetryId.value = ''
      ports.factExtractionRawResult.value = ''
      await ports.refreshWorkflow()
      if (!ownsExtraction(owner, job.id)) return
      ports.notice(job.batch ? '已生成重要变化候选，请逐项确认' : '没有发现需要确认的重要变化')
    } else if (job.status === 'failed' || job.status === 'interrupted') {
      ports.factExtractionRetryId.value = job.id
      ports.factExtractionRawResult.value = job.rawResult || ''
      ports.notice(job.error?.message || '事实提炼未完成，可重新提炼')
    }
    finishExtraction(owner)
  }

  async function pollFactExtraction(jobId, owner = extraction) {
    if (!ownsExtraction(owner, jobId) || owner.settling) return
    try {
      const job = await ports.desktop.workspace.getFactExtractionJob(jobId)
      if (!ownsExtraction(owner, jobId) || owner.settling) return
      if (job.status === 'running') {
        clearPoll()
        pollTimer = setTimeout(() => {
          pollTimer = undefined
          void pollFactExtraction(jobId, owner)
        }, 500)
        return
      }
      await settle(job, owner)
    } catch (error) {
      if (ownsExtraction(owner, jobId)) {
        ports.notice(error?.message || '事实提炼状态不可用')
        finishExtraction(owner)
      }
    }
  }

  async function cancelFactExtraction() {
    if (!observe() || !extraction) return
    const owner = extraction, jobId = owner.jobId
    if (!jobId) { owner.cancelRequested = true; return }
    try {
      const job = await ports.desktop.workspace.cancelFactExtraction(jobId)
      if (!ownsExtraction(owner, jobId)) return
      ports.notice('已请求停止变化提炼')
      if (job.status !== 'running') await settle(job, owner)
    } catch (error) {
      if (ownsExtraction(owner, jobId)) {
        ports.notice(error?.message || '事实提炼未完成')
        if (owner.settling) finishExtraction(owner)
      }
    }
  }

  async function retryFactExtraction() {
    if (!observe() || !ports.selectedId.value || !ports.factExtractionRetryId.value || ports.factExtractionBusy.value) return
    const owner = extraction = capture()
    const retryId = ports.factExtractionRetryId.value, rawResult = ports.factExtractionRawResult.value
    ports.factExtractionBusy.value = true
    ports.factExtractionRawResult.value = ''
    try {
      const job = await ports.desktop.workspace.retryFactExtraction(
        retryId,
        crypto.randomUUID()
      )
      if (!ownsExtraction(owner)) return
      owner.jobId = job.id
      ports.factExtractionRetryId.value = ''
      ports.factExtractionJobId.value = job.id
      void pollFactExtraction(job.id, owner)
      if (owner.cancelRequested) void cancelFactExtraction()
    } catch (error) {
      if (ownsExtraction(owner)) {
        ports.factExtractionRetryId.value = retryId
        ports.factExtractionRawResult.value = rawResult
        ports.notice(error?.message || '无法重新提炼本章变化')
        finishExtraction(owner)
      }
    }
  }

  async function revealBootstrapIssue(issue) {
    if (issue.id === 'modelSettingsUnreadable') {
      await ports.selectActivity('settings')
      await ports.selectSettingsSection('connection')
      return
    }
    const result = await ports.guard(() => ports.desktop.workspace.revealBootstrapIssue(issue.id))
    ports.notice(`已在文件管理器中定位：${result.relativePath}`)
  }

  return {
    dispose() {
      if (disposed) return
      reset()
      disposed = true
      stopWatching?.()
    },
    decideFactChanges,
    extractCurrentChapterFacts,
    pollFactExtraction,
    cancelFactExtraction,
    retryFactExtraction,
    revealBootstrapIssue
  }
}
