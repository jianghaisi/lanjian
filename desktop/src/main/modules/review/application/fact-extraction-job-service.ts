import { randomUUID } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import type { FactBatchView, FactExtractionJob } from '../../../../contracts/index'
import { safePersistedErrorMessage } from '../../../platform/errors/safe-persisted-error'

type Runner = { extract: (workItemId: string, chapterId: number, signal: AbortSignal, taskId: string) => Promise<FactBatchView | null> }
type Active = { state: FactExtractionJob; controller: AbortController }
type Persistence = {
  initialize: (workItemId: string) => Promise<void>
  create: (input: { id: string; workItemId: string; chapterId: number; parentTaskId?: string }) => Promise<FactExtractionJob>
  read: (workItemId: string, id: string) => Promise<FactExtractionJob | null>
  find: (id: string) => Promise<FactExtractionJob | null>
  list: (workItemId: string, chapterId?: number) => Promise<FactExtractionJob[]>
  transition: (input: { workItemId: string; id: string; status: FactExtractionJob['status']; error?: FactExtractionJob['error'] }) => Promise<FactExtractionJob>
}

export class FactExtractionJobService {
  private readonly jobs = new Map<string, Active>()
  private readonly initializedWorkItems = new Set<string>()
  private readonly starting = new Map<string, Promise<void>>()
  constructor(private readonly runner: Runner, private readonly persistence?: Persistence, private readonly now = () => new Date(), private readonly id = () => randomUUID()) {}

  async start(workItemId: string, chapterId: number): Promise<FactExtractionJob> {
    return this.startInternal(workItemId, chapterId)
  }

  async retry(id: string, operationId: string): Promise<FactExtractionJob> {
    const previous = await this.status(id)
    if (!['cancelled', 'failed', 'interrupted'].includes(previous.status)) {
      throw new AppError('CONFLICT', previous.status === 'running' ? '变化提炼仍在进行中，无需重新开始。' : '已完成的变化提炼无需重试。', { recoverable: true })
    }
    let duplicate: FactExtractionJob | null = null
    try { duplicate = await this.status(operationId) }
    catch (error) {
      if (!(error instanceof AppError) || error.code !== 'NOT_FOUND') throw error
    }
    if (duplicate) {
      if (duplicate.parentTaskId !== previous.id) throw new AppError('CONFLICT', '这次重试标识已经用于其他任务。', { recoverable: true })
      return duplicate
    }
    return this.startInternal(previous.workItemId, previous.chapterId, previous.id, operationId)
  }

  async recent(workItemId: string, chapterId?: number): Promise<FactExtractionJob[]> {
    await this.initialize(workItemId)
    const stored = this.persistence ? await this.persistence.list(workItemId, chapterId) : []
    const active = [...this.jobs.values()]
      .map((item) => item.state)
      .filter((item) => item.workItemId === workItemId && (chapterId === undefined || item.chapterId === chapterId))
    return [...new Map([...stored, ...active].map((item) => [item.id, item])).values()]
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
  }

  private async startInternal(workItemId: string, chapterId: number, parentTaskId?: string, fixedId?: string): Promise<FactExtractionJob> {
    if (!workItemId) throw new AppError('VALIDATION_ERROR', '作品身份无效。', { recoverable: true })
    if (!Number.isSafeInteger(chapterId) || chapterId < 1) throw new AppError('VALIDATION_ERROR', '章节身份无效。', { recoverable: true })
    const key = `${workItemId}\u0000${chapterId}`
    const pending = this.starting.get(key)
    if (pending) await pending
    let finishSetup: (() => void) | undefined
    const setup = new Promise<void>((resolve) => { finishSetup = resolve })
    this.starting.set(key, setup)
    try {
      await this.initialize(workItemId)
      if (fixedId && this.persistence) {
        const duplicate = await this.persistence.find(fixedId)
        if (duplicate) {
          if (duplicate.workItemId !== workItemId || duplicate.chapterId !== chapterId || duplicate.parentTaskId !== parentTaskId) {
            throw new AppError('CONFLICT', '这次重试标识已经用于其他任务。', { recoverable: true })
          }
          return duplicate
        }
      }
      if ([...this.jobs.values()].some((job) => job.state.workItemId === workItemId && job.state.chapterId === chapterId && job.state.status === 'running')) {
        throw new AppError('CONFLICT', '本章已有变化提炼任务。', { recoverable: true })
      }
      this.prune()
      const controller = new AbortController()
      const id = fixedId || this.id()
      const initial: FactExtractionJob = { id, workItemId, chapterId, status: 'running', startedAt: this.now().toISOString(),
        ...(parentTaskId ? { parentTaskId } : {}) }
      const state = this.persistence ? await this.persistence.create({ id, workItemId, chapterId, ...(parentTaskId ? { parentTaskId } : {}) }) : initial
      const active = { state, controller }
      this.jobs.set(state.id, active)
      void this.run(active)
      return structuredClone(state)
    } finally {
      finishSetup?.()
      this.starting.delete(key)
    }
  }

  async status(id: string): Promise<FactExtractionJob> {
    const active = this.jobs.get(id)
    if (active) return structuredClone(active.state)
    if (this.persistence) {
      for (const workItemId of this.initializedWorkItems) {
        const stored = await this.persistence.read(workItemId, id)
        if (stored) return stored
      }
      const stored = await this.persistence.find(id)
      if (stored) return stored
    }
    throw new AppError('NOT_FOUND', '变化提炼任务不存在。', { recoverable: true })
  }

  async cancel(id: string): Promise<FactExtractionJob> {
    const active = this.jobs.get(id)
    if (!active) {
      const stored = await this.status(id)
      if (stored.status !== 'running') return stored
      if (!this.persistence) throw new AppError('NOT_FOUND', '变化提炼任务不存在。', { recoverable: true })
      return this.persist({ workItemId: stored.workItemId, id, status: 'cancelled' })
    }
    if (active.state.status === 'running') {
      active.controller.abort()
      active.state = await this.persist({ workItemId: active.state.workItemId, id: active.state.id, status: 'cancelled' })
    }
    return structuredClone(active.state)
  }
  async cancelAll(): Promise<void> { for (const active of this.jobs.values()) if (active.state.status === 'running') await this.cancel(active.state.id) }
  async clear(): Promise<void> { await this.cancelAll(); this.jobs.clear(); this.initializedWorkItems.clear() }

  private async run(active: Active): Promise<void> {
    try {
      const batch = await this.runner.extract(active.state.workItemId, active.state.chapterId, active.controller.signal, active.state.id)
      if (active.controller.signal.aborted || active.state.status !== 'running') return
      const completed = await this.persist({ workItemId: active.state.workItemId, id: active.state.id, status: 'completed' })
      active.state = { ...completed, ...(batch ? { batch } : {}) }
    } catch (error) {
      if (active.controller.signal.aborted || active.state.status !== 'running') return
      active.state = await this.persist({
        workItemId: active.state.workItemId,
        id: active.state.id,
        status: 'failed',
        error: {
          code: error instanceof AppError ? error.code : 'EXTRACTION_FAILED',
          message: safePersistedErrorMessage(error, '变化提炼未完成，请检查模型连接后重试。')
        }
      })
    }
  }
  private prune(): void {
    const terminal = [...this.jobs.values()].filter((job) => job.state.status !== 'running')
    for (const job of terminal.slice(0, Math.max(0, terminal.length - 49))) this.jobs.delete(job.state.id)
  }
  private async initialize(workItemId: string): Promise<void> {
    if (this.initializedWorkItems.has(workItemId)) return
    await this.persistence?.initialize(workItemId)
    this.initializedWorkItems.add(workItemId)
  }

  private async persist(input: { workItemId: string; id: string; status: FactExtractionJob['status']; error?: FactExtractionJob['error'] }): Promise<FactExtractionJob> {
    if (this.persistence) return this.persistence.transition(input)
    return {
      id: input.id,
      workItemId: input.workItemId,
      chapterId: this.jobs.get(input.id)?.state.chapterId ?? 0,
      status: input.status,
      startedAt: this.jobs.get(input.id)?.state.startedAt ?? this.now().toISOString(),
      completedAt: this.now().toISOString(),
      ...(input.error ? { error: input.error } : {})
    }
  }
}
