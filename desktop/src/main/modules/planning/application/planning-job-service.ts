import { StructuredResponseFailure } from '../../assistant/application/structured-response-repair'
import { randomUUID } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import type { PlanningJob, PlanningPackageProposal } from '../../../../contracts/index'
import type { PlanningProgress, PlanningRecovery, PlanningRecoveryPort } from './planning-draft-service'
import { PlanningRecoveryStore, planningHash, type PlanningRecoveryRecord } from './planning-recovery-store'

export type PlanningRunner = {
  generate: (workItemId: string, signal?: AbortSignal, onProgress?: PlanningProgress, recovery?: PlanningRecoveryPort) => Promise<PlanningPackageProposal>
  validateRecovery?: (state: PlanningRecovery) => Promise<void>
}
type Proposals = {
  get(): Promise<PlanningPackageProposal | null>
  save(proposal: PlanningPackageProposal, guard?: (existing: PlanningPackageProposal | null) => Promise<void>): Promise<PlanningPackageProposal>
}
type ActiveJob = { state: PlanningJob; controller: AbortController; record?: PlanningRecoveryRecord; pending?: Promise<void>; sealed?: boolean; settling?: boolean }
const conflict = (message: string) => new AppError('CONFLICT', message, { recoverable: true })

export class PlanningJobService {
  private readonly jobs = new Map<string, ActiveJob>()
  private retries: Promise<unknown> = Promise.resolve()
  constructor(private readonly runner: PlanningRunner, private readonly now = () => new Date(),
    private readonly id: () => string = () => randomUUID(), private readonly store?: PlanningRecoveryStore,
    private readonly proposals?: Proposals) {}

  start(workItemId: string): PlanningJob {
    if (!workItemId.trim()) throw conflict('书稿工作项无效。')
    this.assertIdle(workItemId)
    this.prune()
    const job: ActiveJob = { controller: new AbortController(), state: { id: this.id(), workItemId, status: 'running', stage: 'blueprint',
      progress: { completed: 0, total: 3, message: '正在准备自动谋篇' }, startedAt: this.now().toISOString() } }
    this.jobs.set(job.state.id, job)
    job.pending = this.run(job)
    return this.status(job.state.id)
  }
  status(jobId: string): PlanningJob {
    const job = this.require(jobId)
    const result = structuredClone(job.state)
    if (job.settling) {
      result.status = 'running'; delete result.error; delete result.completedAt; delete result.proposal
      result.progress.message = '正在保存阶段结果'
    }
    if (this.store) delete result.rawResult
    return result
  }
  cancel(jobId: string): PlanningJob {
    const job = this.require(jobId)
    if (job.state.status === 'running') {
      job.controller.abort()
      job.state = { ...job.state, status: 'cancelled', completedAt: this.now().toISOString(), progress: { ...job.state.progress, message: '已停止自动谋篇' } }
    }
    return this.status(jobId)
  }
  cancelAll(): void { for (const job of this.jobs.values()) if (job.state.status === 'running') this.cancel(job.state.id) }
  clear(): void { this.cancelAll(); this.jobs.clear() }

  async recent(workItemId: string): Promise<PlanningJob[]> {
    for (const record of await this.store?.list() ?? []) {
      if (record.job.workItemId !== workItemId || this.jobs.has(record.job.id)) continue
      const job: ActiveJob = { state: structuredClone(record.job), record, controller: new AbortController() }
      if (job.state.status === 'running') job.state = { ...job.state, status: 'failed',
        error: { code: 'GENERATION_FAILED', stage: job.state.stage, message: '上次谋篇已中断。已保存的阶段可查看；点击继续后才会再次调用模型。' } }
      job.state.recovery = { saved: true, action: this.action(job) }
      this.jobs.set(job.state.id, job)
    }
    return [...this.jobs.values()].filter(j => j.state.workItemId === workItemId)
      .sort((a, b) => b.state.startedAt.localeCompare(a.state.startedAt)).slice(0, 50).map(j => this.status(j.state.id))
  }
  async read(jobId: string, workItemId: string, details = false): Promise<PlanningJob> {
    if (!this.jobs.has(jobId)) await this.recent(workItemId)
    const job = this.require(jobId)
    if (job.state.workItemId !== workItemId) throw conflict('该谋篇任务不属于当前作品。')
    const result = this.status(jobId)
    if (details) result.rawResult = job.record ? JSON.stringify({ stages: job.record.recovery.stages,
      proposal: job.record.recovery.proposal ? { blueprint: job.record.recovery.proposal.blueprint, totalOutline: job.record.recovery.proposal.totalOutline, volumes: job.record.recovery.proposal.volumes } : undefined, failedResult: job.state.rawResult }, null, 2) : job.state.rawResult
    return result
  }
  async cancelSaved(jobId: string, owner: string): Promise<PlanningJob> {
    await this.read(jobId, owner)
    this.cancel(jobId)
    await this.persist(this.require(jobId))
    return this.status(jobId)
  }
  retry(jobId: string, operationId: string, owner: string, saveOnly = false): Promise<PlanningJob> {
    const operation = this.retries.then(async () => {
      if (!/^[a-zA-Z0-9_-]{1,120}$/.test(operationId)) throw conflict('重试操作编号无效。')
      await this.recent(owner)
      const duplicate = [...this.jobs.values()].find(j => j.state.workItemId === owner && j.record?.operationId === operationId)
      if (duplicate) {
        if (duplicate.record?.parentId !== jobId || Boolean(duplicate.record.saveOnly) !== saveOnly) throw conflict('重试编号已用于其他操作。')
        return this.status(duplicate.state.id)
      }
      await this.read(jobId, owner)
      const parent = this.require(jobId), record = parent.record
      if (!this.store || !record || parent.state.recovery?.saved !== true) throw conflict('该结果未持久保存，请先复制结果，再重新发起。')
      if (!['failed', 'cancelled'].includes(parent.state.status) || this.action(parent) === 'none') throw conflict('该任务不能直接继续，请查看复核详情。')
      if (saveOnly !== Boolean(record.recovery.proposal)) throw conflict('请选择该任务支持的恢复操作。')
      if (record.identity !== await this.store.identity(record.storage)) throw conflict('作品存储身份已变化，请保留结果并重新发起。')
      await this.runner.validateRecovery?.(record.recovery)
      this.assertIdle(owner)
      const state: PlanningJob = { ...structuredClone(parent.state), id: this.id(), status: 'running', startedAt: this.now().toISOString(),
        progress: { ...parent.state.progress, message: saveOnly ? '正在重新保存候选' : '正在从保存的阶段继续' } }
      delete state.error; delete state.rawResult; delete state.completedAt
      const job: ActiveJob = { state, controller: new AbortController(), record: { ...structuredClone(record), parentId: jobId, operationId, saveOnly, job: state } }
      await this.persist(job)
      parent.sealed = true
      this.jobs.set(state.id, job)
      job.pending = this.run(job, saveOnly)
      return this.status(state.id)
    })
    this.retries = operation.catch(() => undefined)
    return operation
  }
  private action(job: ActiveJob): NonNullable<PlanningJob['recovery']>['action'] {
    if (!job.record || job.state.status === 'completed') return 'none'
    if (job.record.recovery.proposal) return 'save'
    if (!job.record.recovery.sourceHash) return 'none'
    const phase = job.record.recovery.stages[job.state.stage]?.phase
    return phase === 'blocked' ? 'none' : phase === 'review' ? 'review' : 'stage'
  }
  private async persist(job: ActiveJob): Promise<void> {
    if (!this.store || !job.record) return
    if (job.sealed) return
    const recovery = { saved: true, action: this.action(job) }
    job.record.job = { ...structuredClone(job.state), recovery }
    job.state.recovery = { saved: false, action: 'none' }
    try { await this.store.save(structuredClone(job.record)); job.state.recovery = recovery } catch (cause) {
      job.state.recovery = { saved: false, action: 'none' }
      throw new AppError('STORAGE_ERROR', '阶段结果保存失败，请查看并复制结果，检查磁盘后再操作。', { recoverable: true, cause })
    }
  }
  private async run(job: ActiveJob, saveOnly = false): Promise<void> {
    try {
      if (this.store && !job.record) {
        const storage = await this.store.backend()
        job.record = { version: 1, storage, identity: await this.store.identity(storage), operationId: job.state.id,
          baseProposalHash: planningHash(await this.proposals?.get() ?? null), job: job.state, recovery: { version: 1, stages: {} } }
        await this.persist(job)
      }
      job.controller.signal.throwIfAborted()
      const recovery = job.record ? { state: job.record.recovery, save: async () => { job.controller.signal.throwIfAborted(); await this.persist(job) } } : undefined
      const proposal = saveOnly ? job.record!.recovery.proposal! : await this.runner.generate(job.state.workItemId, job.controller.signal, (stage, completed, message) => {
        if (!job.controller.signal.aborted) job.state = { ...job.state, stage, progress: { completed, total: 3, message } }
      }, recovery)
      job.controller.signal.throwIfAborted()
      if (this.proposals && job.record) {
        job.record.recovery.proposal = proposal
        await this.persist(job)
        const guard = async (existing: PlanningPackageProposal | null) => {
          job.controller.signal.throwIfAborted()
          await this.runner.validateRecovery?.(job.record!.recovery)
          if (planningHash(existing) !== job.record!.baseProposalHash && planningHash(existing) !== planningHash(proposal)) throw conflict('已有候选发生变化，未覆盖。请查看本次结果后另行处理。')
        }
        const existing = await this.proposals.get()
        await guard(existing)
        if (planningHash(existing) !== planningHash(proposal)) await this.proposals.save(proposal, guard)
      }
      job.controller.signal.throwIfAborted()
      job.settling = true
      job.state = { ...job.state, status: 'completed', stage: 'volumePlan', progress: { completed: 3, total: 3, message: '自动谋篇候选已经完成' }, completedAt: this.now().toISOString(), proposal }
      await this.persist(job)
    } catch (error) {
      if (job.sealed) return
      job.settling = true
      if (job.controller.signal.aborted) {
        job.state = { ...job.state, status: 'cancelled', completedAt: this.now().toISOString() }
      } else {
        const blocked = job.record?.recovery.stages[job.state.stage]?.phase === 'blocked'
        const message = blocked ? '草稿存在需要处理的内容问题，请查看复核详情，核对素材后重新发起。'
          : error instanceof StructuredResponseFailure || error instanceof AppError && ['CONFLICT', 'STORAGE_ERROR'].includes(error.code)
            ? error.message.slice(0, 1000) : '自动谋篇未完成，请检查作品资料、模型连接或额度，再选择继续或重新生成。'
        job.state = { ...job.state, status: 'failed', completedAt: this.now().toISOString(),
          ...(error instanceof StructuredResponseFailure ? { rawResult: JSON.stringify({ original: error.originalContent, last: error.lastContent }) } : {}),
          error: { code: 'GENERATION_FAILED', stage: job.state.stage, message }, progress: { ...job.state.progress, message: '自动谋篇未完成' } }
      }
      try { await this.persist(job) } catch { job.state.recovery = { saved: false, action: 'none' }; job.state.error = { code: 'GENERATION_FAILED', stage: job.state.stage, message: '阶段结果保存失败，请查看并复制结果后再退出，检查磁盘后重试。' } }
    } finally { job.settling = false }
  }
  private assertIdle(owner: string): void {
    if ([...this.jobs.values()].some(j => j.state.workItemId === owner && j.state.status === 'running')) throw conflict('当前书稿已有自动谋篇任务，请先停止或等待完成。')
  }
  private require(jobId: string): ActiveJob {
    const job = this.jobs.get(jobId)
    if (!job) throw new AppError('NOT_FOUND', '自动谋篇任务不存在或已经过期。', { recoverable: true })
    return job
  }
  private prune(): void {
    const terminal = [...this.jobs.values()].filter(j => j.state.status !== 'running')
    for (const job of terminal.slice(0, Math.max(0, terminal.length - 49))) this.jobs.delete(job.state.id)
  }
}
