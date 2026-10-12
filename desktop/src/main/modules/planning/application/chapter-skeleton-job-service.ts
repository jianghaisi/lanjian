import { StructuredResponseFailure } from '../../assistant/application/structured-response-repair'
import { randomUUID } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import type { PlanningChapterSkeletonJob, PlanningPackageProposal } from '../../../../contracts/index'
import type { ChapterSkeletonProgress } from './chapter-skeleton-service'

export type ChapterSkeletonRunner = {
  generate: (proposalId: string, signal?: AbortSignal, onProgress?: ChapterSkeletonProgress) => Promise<PlanningPackageProposal>
}

type ActiveJob = { state: PlanningChapterSkeletonJob; controller: AbortController }

export class ChapterSkeletonJobService {
  private readonly jobs = new Map<string, ActiveJob>()

  constructor(
    private readonly runner: ChapterSkeletonRunner,
    private readonly workItemId: () => Promise<string>,
    private readonly now = () => new Date(),
    private readonly id = () => randomUUID()
  ) {}

  async start(proposalId: string): Promise<PlanningChapterSkeletonJob> {
    const owner = await this.workItemId()
    if ([...this.jobs.values()].some((job) => job.state.workItemId === owner && job.state.status === 'running')) {
      throw new AppError('CONFLICT', '当前书稿已有章节骨架任务，请先停止或等待完成。', { recoverable: true })
    }
    this.prune()
    const controller = new AbortController()
    const state: PlanningChapterSkeletonJob = {
      id: this.id(), workItemId: owner, proposalId, status: 'running', stage: 'chapterSkeleton',
      progress: { completed: 0, total: 1, message: '正在准备全书章节骨架' },
      startedAt: this.now().toISOString()
    }
    const job = { state, controller }
    this.jobs.set(state.id, job)
    void this.run(job)
    return snapshot(state)
  }

  status(jobId: string): PlanningChapterSkeletonJob { return snapshot(this.require(jobId).state) }

  cancel(jobId: string): PlanningChapterSkeletonJob {
    const job = this.require(jobId)
    if (job.state.status !== 'running') return snapshot(job.state)
    job.controller.abort()
    job.state = { ...job.state, status: 'cancelled', completedAt: this.now().toISOString(), progress: { ...job.state.progress, message: '已停止生成，未保留半套骨架' } }
    return snapshot(job.state)
  }

  cancelAll(): void {
    for (const job of this.jobs.values()) if (job.state.status === 'running') this.cancel(job.state.id)
  }

  clear(): void { this.cancelAll(); this.jobs.clear() }

  private async run(job: ActiveJob): Promise<void> {
    try {
      const proposal = await this.runner.generate(job.state.proposalId, job.controller.signal, (completed, total, message) => {
        if (job.state.status !== 'running' || job.controller.signal.aborted) return
        job.state = { ...job.state, progress: { completed, total, message } }
      })
      if (job.state.status !== 'running' || job.controller.signal.aborted) return
      job.state = {
        ...job.state, status: 'completed', completedAt: this.now().toISOString(), proposal,
        progress: { completed: proposal.volumes.length, total: proposal.volumes.length, message: '全书章节骨架候选已经完成' }
      }
    } catch (error) {
      if (job.state.status !== 'running' || job.controller.signal.aborted) return
      job.state = {
        ...job.state, status: 'failed',
        ...(error instanceof StructuredResponseFailure ? { rawResult: JSON.stringify({ original: error.originalContent, last: error.lastContent }) } : {}), completedAt: this.now().toISOString(),
        error: { code: 'GENERATION_FAILED', message: error instanceof StructuredResponseFailure ? error.message.slice(0, 1000) : '章节骨架未完成，请检查篇卷确认状态与模型连接后重试。', stage: 'chapterSkeleton' },
        progress: { ...job.state.progress, message: '章节骨架未完成' }
      }
    }
  }

  private require(jobId: string): ActiveJob {
    const job = this.jobs.get(jobId)
    if (!job) throw new AppError('NOT_FOUND', '章节骨架任务不存在或已经过期。', { recoverable: true })
    return job
  }

  private prune(): void {
    const terminal = [...this.jobs.values()].filter((job) => job.state.status !== 'running')
    for (const job of terminal.slice(0, Math.max(0, terminal.length - 49))) this.jobs.delete(job.state.id)
  }
}

function snapshot(state: PlanningChapterSkeletonJob): PlanningChapterSkeletonJob { return structuredClone(state) }
