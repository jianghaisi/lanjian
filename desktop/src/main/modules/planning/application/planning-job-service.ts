import { StructuredResponseFailure } from '../../assistant/application/structured-response-repair'
import { randomUUID } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import type { PlanningJob, PlanningPackageProposal, PlanningStage } from '../../../../contracts/index'
import type { PlanningProgress } from './planning-draft-service'

export type PlanningRunner = {
  generate: (workItemId: string, signal?: AbortSignal, onProgress?: PlanningProgress) => Promise<PlanningPackageProposal>
}

type ActiveJob = { state: PlanningJob; controller: AbortController }

export class PlanningJobService {
  private readonly jobs = new Map<string, ActiveJob>()

  constructor(
    private readonly runner: PlanningRunner,
    private readonly now = () => new Date(),
    private readonly id: () => string = () => randomUUID()
  ) {}

  start(workItemId: string): PlanningJob {
    if (!workItemId.trim()) throw new AppError('VALIDATION_ERROR', '书稿工作项无效。', { recoverable: true })
    if ([...this.jobs.values()].some((job) => job.state.workItemId === workItemId && job.state.status === 'running')) {
      throw new AppError('CONFLICT', '当前书稿已有自动谋篇任务，请先停止或等待完成。', { recoverable: true })
    }
    this.prune()
    const controller = new AbortController()
    const state: PlanningJob = {
      id: this.id(),
      workItemId,
      status: 'running',
      stage: 'blueprint',
      progress: { completed: 0, total: 3, message: '正在准备自动谋篇' },
      startedAt: this.now().toISOString()
    }
    const job = { state, controller }
    this.jobs.set(state.id, job)
    void this.run(job)
    return snapshot(state)
  }

  status(jobId: string): PlanningJob {
    return snapshot(this.require(jobId).state)
  }

  cancel(jobId: string): PlanningJob {
    const job = this.require(jobId)
    if (job.state.status !== 'running') return snapshot(job.state)
    job.controller.abort()
    job.state = { ...job.state, status: 'cancelled', completedAt: this.now().toISOString(), progress: { ...job.state.progress, message: '已停止自动谋篇' } }
    return snapshot(job.state)
  }

  cancelAll(): void {
    for (const job of this.jobs.values()) if (job.state.status === 'running') this.cancel(job.state.id)
  }

  clear(): void {
    this.cancelAll()
    this.jobs.clear()
  }

  private async run(job: ActiveJob): Promise<void> {
    let failedStage: PlanningStage = 'blueprint'
    try {
      const proposal = await this.runner.generate(job.state.workItemId, job.controller.signal, (stage, completed, message) => {
        if (job.state.status !== 'running' || job.controller.signal.aborted) return
        failedStage = stage
        job.state = { ...job.state, stage, progress: { completed, total: 3, message } }
      })
      if (job.state.status !== 'running' || job.controller.signal.aborted) return
      job.state = {
        ...job.state,
        status: 'completed',
        stage: 'volumePlan',
        progress: { completed: 3, total: 3, message: '自动谋篇候选已经完成' },
        completedAt: this.now().toISOString(),
        proposal
      }
    } catch (error) {
      if (job.state.status !== 'running' || job.controller.signal.aborted) return
      job.state = {
        ...job.state,
        status: 'failed',
        ...(error instanceof StructuredResponseFailure ? { rawResult: JSON.stringify({ original: error.originalContent, last: error.lastContent }) } : {}),
        completedAt: this.now().toISOString(),
        error: { code: 'GENERATION_FAILED', message: error instanceof StructuredResponseFailure ? error.message.slice(0, 1000) : '自动谋篇未完成，请检查作品资料与模型连接后重试。', stage: failedStage },
        progress: { ...job.state.progress, message: '自动谋篇未完成' }
      }
    }
  }

  private require(jobId: string): ActiveJob {
    const job = this.jobs.get(jobId)
    if (!job) throw new AppError('NOT_FOUND', '自动谋篇任务不存在或已经过期。', { recoverable: true })
    return job
  }

  private prune(): void {
    const terminal = [...this.jobs.values()].filter((job) => job.state.status !== 'running')
    for (const job of terminal.slice(0, Math.max(0, terminal.length - 49))) this.jobs.delete(job.state.id)
  }
}

function snapshot(state: PlanningJob): PlanningJob {
  return structuredClone(state)
}
