// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createReviewEvaluationActions(ports) {
  async function startConsistencyEvaluation() {
    if (ports.consistencyEvaluationJob.value?.status === 'running') return
    if (!(ports.ai.value.modelConfigured ?? ports.ai.value.apiKeyConfigured))
      return ports.notice('请先在模型设置中选用可用模型')
    const job = await ports.guard(() => ports.desktop.ai.startConsistencyEvaluation(), '固定语义样本评测已经开始')
    if (!job) return
    ports.consistencyEvaluationJob.value = job
    scheduleConsistencyEvaluationPoll()
  }

  function scheduleConsistencyEvaluationPoll() {
    if (ports.consistencyEvaluationPollTimer) window.clearTimeout(ports.consistencyEvaluationPollTimer)
    if (ports.consistencyEvaluationJob.value?.status !== 'running') return
    ports.consistencyEvaluationPollTimer = window.setTimeout(pollConsistencyEvaluation, 500)
  }

  async function pollConsistencyEvaluation() {
    ports.consistencyEvaluationPollTimer = 0
    const id = ports.consistencyEvaluationJob.value?.id
    if (!id) return
    try {
      const job = await ports.desktop.ai.consistencyEvaluationJob(id)
      ports.consistencyEvaluationJob.value = job
      if (job.status === 'completed') {
        ports.consistencyEvaluationSummary.value = job.result
        ports.notice(
          job.result?.semanticUnableToJudge
            ? `评测完成，${job.result.semanticUnableToJudge} 条语义样本无法判断`
            : '固定一致性评测完成'
        )
      } else if (job.status === 'failed') ports.notice(job.error?.message || '一致性评测未完成')
      else if (job.status === 'cancelled') ports.notice('评测已停止，作品内容没有变化')
    } catch (error) {
      ports.notice(error?.message || '无法读取一致性评测进度')
      ports.consistencyEvaluationJob.value = null
    }
    scheduleConsistencyEvaluationPoll()
  }

  async function cancelConsistencyEvaluation() {
    const id = ports.consistencyEvaluationJob.value?.id
    if (!id || ports.consistencyEvaluationJob.value.status !== 'running') return
    ports.consistencyEvaluationJob.value = await ports.guard(() => ports.desktop.ai.cancelConsistencyEvaluation(id))
    scheduleConsistencyEvaluationPoll()
  }

  function evaluationTime(value) {
    if (!value) return '尚未运行'
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(value))
  }

  return {
    startConsistencyEvaluation,
    scheduleConsistencyEvaluationPoll,
    pollConsistencyEvaluation,
    cancelConsistencyEvaluation,
    evaluationTime
  }
}
