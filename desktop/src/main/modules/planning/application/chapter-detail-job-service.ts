import { randomUUID } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import type { PlanningChapterDetailJob, PlanningPackageProposal } from '../../../../contracts/index'
import type { ChapterDetailProgress } from './chapter-detail-service'

type Runner = { generate: (proposalId: string, volume: number, signal?: AbortSignal, progress?: ChapterDetailProgress) => Promise<PlanningPackageProposal> }
type Active = { state: PlanningChapterDetailJob; controller: AbortController }

export class ChapterDetailJobService {
  private jobs = new Map<string, Active>()
  constructor(private runner: Runner, private workItemId: () => Promise<string>, private now = () => new Date(), private id = () => randomUUID()) {}
  async start(proposalId: string, volume: number) {
    const owner = await this.workItemId()
    if ([...this.jobs.values()].some((item) => item.state.workItemId === owner && item.state.status === 'running')) throw new AppError('CONFLICT', '当前书稿已有详细章纲任务。', { recoverable: true })
    const state: PlanningChapterDetailJob = { id: this.id(), workItemId: owner, proposalId, volume, status: 'running', stage: 'chapterDetail', progress: { completed: 0, total: 1, message: `正在准备第 ${volume} 卷详细章纲` }, startedAt: this.now().toISOString() }
    const job = { state, controller: new AbortController() }; this.jobs.set(state.id, job); void this.run(job); return structuredClone(state)
  }
  status(id: string) { return structuredClone(this.require(id).state) }
  cancel(id: string) { const job = this.require(id); if (job.state.status === 'running') { job.controller.abort(); job.state = { ...job.state, status: 'cancelled', completedAt: this.now().toISOString(), progress: { ...job.state.progress, message: '已停止生成，未保存不完整结果' } } }; return structuredClone(job.state) }
  cancelAll() { for (const job of this.jobs.values()) if (job.state.status === 'running') this.cancel(job.state.id) }
  clear() { this.cancelAll(); this.jobs.clear() }
  private async run(job: Active) {
    try {
      const proposal = await this.runner.generate(job.state.proposalId, job.state.volume, job.controller.signal, (completed, total, message) => { if (job.state.status === 'running') job.state = { ...job.state, progress: { completed, total, message } } })
      if (job.state.status === 'running') job.state = { ...job.state, status: 'completed', completedAt: this.now().toISOString(), proposal, progress: { ...job.state.progress, completed: job.state.progress.total, message: `第 ${job.state.volume} 卷详细章纲候选已完成` } }
    } catch { if (job.state.status === 'running') job.state = { ...job.state, status: 'failed', completedAt: this.now().toISOString(), error: { code: 'GENERATION_FAILED', message: '详细章纲未完成，请检查模型连接与上游确认状态后重试。', stage: 'chapterDetail' }, progress: { ...job.state.progress, message: '详细章纲未完成' } } }
  }
  private require(id: string) { const job = this.jobs.get(id); if (!job) throw new AppError('NOT_FOUND', '详细章纲任务不存在或已经过期。', { recoverable: true }); return job }
}
