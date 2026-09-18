// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createReviewFactsActions(ports) {
  async function decideFactChanges(input) {
    if (ports.factReviewBusy.value) return
    ports.factReviewBusy.value = true
    try {
      const updated = await ports.desktop.workspace.decideFactChanges(input)
      const index = ports.factBatches.value.findIndex((batch) => batch.id === updated.id)
      if (index >= 0) ports.factBatches.value.splice(index, 1, updated)
      else ports.factBatches.value = [updated, ...ports.factBatches.value]
      ports.contextFactPackKey = ''
      await ports.refreshWorkflow()
      ports.notice(
        updated.status === 'PARTIALLY_APPROVED' ? '已保存这些选择；其余变化可以稍后再看' : '选择已保存，可以继续写作'
      )
    } catch (error) {
      ports.notice(error?.message || '事实审批保存失败，请重试')
    } finally {
      ports.factReviewBusy.value = false
    }
  }

  async function extractCurrentChapterFacts() {
    if (!ports.selectedId.value || ports.factExtractionBusy.value) return
    ports.factExtractionBusy.value = true
    ports.factExtractionRetryId.value = ''
    ports.factExtractionRawResult.value = ''
    try {
      const job = await ports.desktop.workspace.startFactExtraction(ports.selectedId.value)
      ports.factExtractionJobId.value = job.id
      void pollFactExtraction(job.id)
    } catch (error) {
      ports.notice(error?.message || '事实提炼未启动')
    }
  }

  async function pollFactExtraction(jobId) {
    try {
      const job = await ports.desktop.workspace.getFactExtractionJob(jobId)
      if (job.status === 'running')
        return void setTimeout(() => {
          void pollFactExtraction(jobId)
        }, 500)
      if (job.status === 'completed') {
        ports.factExtractionRawResult.value = ''
        await ports.refreshWorkflow()
        ports.notice(job.batch ? '已生成重要变化候选，请逐项确认' : '没有发现需要确认的重要变化')
      } else if (job.status === 'failed' || job.status === 'interrupted') {
        ports.factExtractionRetryId.value = job.id
        ports.factExtractionRawResult.value = job.rawResult || ''
        ports.notice(job.error?.message || '事实提炼未完成，可重新提炼')
      }
    } catch (error) {
      ports.notice(error?.message || '事实提炼状态不可用')
    } finally {
      ports.factExtractionBusy.value = false
      ports.factExtractionJobId.value = ''
    }
  }

  async function cancelFactExtraction() {
    if (!ports.factExtractionJobId.value) return
    try {
      await ports.desktop.workspace.cancelFactExtraction(ports.factExtractionJobId.value)
      ports.notice('已请求停止变化提炼')
    } catch (error) {
      ports.notice(error?.message || '事实提炼未完成')
    }
  }

  async function retryFactExtraction() {
    if (!ports.factExtractionRetryId.value || ports.factExtractionBusy.value) return
    ports.factExtractionBusy.value = true
    ports.factExtractionRawResult.value = ''
    try {
      const job = await ports.desktop.workspace.retryFactExtraction(
        ports.factExtractionRetryId.value,
        crypto.randomUUID()
      )
      ports.factExtractionRetryId.value = ''
      ports.factExtractionJobId.value = job.id
      void pollFactExtraction(job.id)
    } catch (error) {
      ports.notice(error?.message || '无法重新提炼本章变化')
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
    decideFactChanges,
    extractCurrentChapterFacts,
    pollFactExtraction,
    cancelFactExtraction,
    retryFactExtraction,
    revealBootstrapIssue
  }
}
