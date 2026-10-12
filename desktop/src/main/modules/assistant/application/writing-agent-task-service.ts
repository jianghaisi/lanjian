import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { WorkspaceDatabaseFactory, WorkspaceDatabasePort, WorkspaceTaskRunRecord } from '../../../core/ports/workspace-database'
import { AppError, isAppError } from '../../../core/errors/app-error'
import { compileContext } from '../domain/context-compiler'
import type {
  WritingAgentArtifactDecision,
  WritingAgentRequest,
  WritingAgentSkillId,
  WritingAgentTask,
  WritingAgentTaskStart,
  WritingAgentTurn
} from '../../../../contracts/index'
import { contextBudgetStartingSuggestions } from '../../../../contracts/index'
import { ProjectService } from '../../library/application/project-service'
import { resolveWritingAgentSkill, WritingAgentService, type WritingAgentPreparedRun } from './writing-agent-service'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'
import { safePersistedErrorMessage } from '../../../platform/errors/safe-persisted-error'
import type { WritingAgentToolGrant } from './agent-tool-registry'
import { createTaskContractSnapshot, isLegacyTaskContract } from '../domain/task-template-contract'
import { taskRunHasLegacyPause } from '../domain/task-run-lifecycle'
import { decodeWritingAgentRecovery, missingWritingAgentRecovery, type WritingAgentRecovery } from '../domain/writing-agent-recovery'

type Checkpoint = {
  version: 1
  phase: 'queued' | 'resuming' | 'preparing' | 'model' | 'streaming' | 'paused' | 'approval' | 'failed' | 'cancelled'
  workItemId: string
  request: WritingAgentRequest
  recovery?: WritingAgentRecovery
  streamedCharacters?: number
  dismissedAt?: string
  toolGrant?: WritingAgentToolGrant
  plan?: {
    version: 1
    steps: readonly ['permission-check', 'compile-context', 'model', 'validate', 'artifact', 'approval']
  }
}

type ActiveTask = { taskId: string; controller: AbortController; workItemPath: string; request: WritingAgentRequest; streamedContent: string }
type ModelConfigResolver = (input: { workItemPath: string; request: WritingAgentRequest }) => Promise<string | undefined>

const activeWritingStatuses = ['queued', 'resuming', 'preparing', 'running', 'streaming']
const isPausedWritingTask = (task: WorkspaceTaskRunRecord, workItemId: string) => task.status === 'paused' || taskRunHasLegacyPause(task, workItemId)

export class WritingAgentTaskService {
  private readonly active = new Map<string, ActiveTask>()
  private readonly initializedPaths = new Set<string>()

  constructor(
    private readonly runner: WritingAgentService,
    private readonly projects: ProjectService,
    private readonly databases: WorkspaceDatabaseFactory,
    private readonly now = () => new Date(),
    private readonly id = () => randomUUID(),
    private readonly modelConfigResolver?: ModelConfigResolver,
    private readonly writes: WorkspaceWriteCoordinator = new WorkspaceWriteCoordinator()
  ) {}

  async start(input: WritingAgentTaskStart): Promise<WritingAgentTask> {
    if (!this.projects.executionIdentity) return this.projects.runInCurrentBook(() => this.start(input))
    const [summary, workItemPath] = await Promise.all([this.projects.currentSummary({ includeManuscript: false }), this.projects.currentPath()])
    if (input.request.expectedWorkItemId && input.request.expectedWorkItemId !== summary.id)
      throw new AppError('CONFLICT', '当前作品已切换，请返回发起任务的作品后重新核对。', { recoverable: true })
    await this.ensureInitialized(workItemPath)
    const existingTasks = await this.withDatabase(workItemPath, (database) => database.recentTaskRuns('writing_agent', input.request.chapterId, 50))
    const duplicate = await this.withDatabase(workItemPath, (database) => database.taskRunByOperationKey(input.operationId))
    if (duplicate) {
      if (duplicate.taskType !== 'writing_agent' || JSON.stringify(this.checkpoint(duplicate).request) !== JSON.stringify(input.request)) {
        throw new AppError('CONFLICT', '这次提交标识已经用于另一条写作请求。', { recoverable: true })
      }
      return this.snapshot(workItemPath, duplicate)
    }
    if (existingTasks.some((task) => activeWritingStatuses.includes(task.status))) {
      throw new AppError('CONFLICT', '当前章节已有写作任务，请先停止或等待完成。', { recoverable: true })
    }
    const checkpoint: Checkpoint = { version: 1, phase: 'queued', workItemId: summary.id, request: structuredClone(input.request) }
    const requestedId = this.id()
    const skill = resolveWritingAgentSkill(input.request.message, input.request.preferredSkill, Boolean(input.request.selection))
    const modelConfigId = await this.modelConfigId(workItemPath, input.request)
    const task = await this.withDatabaseWrite(workItemPath, (database) => database.createTaskRun({
      id: requestedId,
      legacyChapterId: input.request.chapterId,
      taskType: 'writing_agent',
      taskContract: createTaskContractSnapshot('writing_agent', skill),
      idempotencyKey: input.operationId,
      contentHash: hashText(input.request.currentDraft),
      ...(modelConfigId ? { modelConfigId } : {}),
      checkpointJson: JSON.stringify(checkpoint)
    }))
    if (task.id === requestedId && task.status === 'queued') this.launch(workItemPath, task.id, input.request)
    return this.snapshot(workItemPath, task)
  }

  async status(taskId: string): Promise<WritingAgentTask> {
    const workItemPath = await this.projects.currentPath()
    await this.ensureInitialized(workItemPath)
    const task = await this.withDatabase(workItemPath, (database) => database.taskRun(taskId))
    if (!task) throw new AppError('NOT_FOUND', 'AI 任务不存在或不属于当前作品。', { recoverable: true })
    return this.snapshot(workItemPath, task)
  }
  /** Read-only reconciliation of a main-issued handoff operation after interruption. */
  async byOperation(operationId: string): Promise<WritingAgentTask | null> {
    const workItemPath = await this.projects.currentPath()
    const task = await this.withDatabase(workItemPath, database => database.taskRunByOperationKey(operationId))
    if (!task || task.taskType !== 'writing_agent') return null
    return this.snapshot(workItemPath, task)
  }

  async recent(chapterId: number): Promise<WritingAgentTask[]> {
    const workItemPath = await this.projects.currentPath()
    await this.ensureInitialized(workItemPath)
    const tasks = await this.withDatabase(workItemPath, (database) => database.recentTaskRuns('writing_agent', chapterId, 50))
    const snapshots: WritingAgentTask[] = []
    for (const task of tasks.filter((item) => !this.checkpoint(item).dismissedAt).reverse()) snapshots.push(await this.snapshot(workItemPath, task))
    return snapshots
  }

  async cancel(taskId: string): Promise<WritingAgentTask> {
    const workItemPath = await this.projects.currentPath()
    await this.ensureInitialized(workItemPath)
    const active = this.active.get(this.activeKey(workItemPath, taskId))
    if (active && resolve(active.workItemPath) !== resolve(workItemPath)) {
      throw new AppError('NOT_FOUND', 'AI 任务不存在或不属于当前作品。', { recoverable: true })
    }
    active?.controller.abort()
    const task = await this.withDatabaseWrite(workItemPath, (database) => {
      const current = database.taskRun(taskId)
      if (!current) throw new AppError('NOT_FOUND', 'AI 任务不存在或不属于当前作品。', { recoverable: true })
      const checkpoint = this.checkpoint(current)
      if (isPausedWritingTask(current, workItemPath)) {
        return database.transitionTaskRun({
          id: taskId,
          status: 'cancelled',
          checkpointJson: JSON.stringify({ ...checkpoint, phase: 'cancelled' }),
          errorCode: null,
          errorMessage: null
        })
      }
      if (!activeWritingStatuses.includes(current.status)) return current
      if (active?.streamedContent) this.persistPartial(database, taskId, active.request, active.streamedContent)
      return database.transitionTaskRun({
        id: taskId,
        status: 'cancelled',
        checkpointJson: JSON.stringify({ ...checkpoint, phase: 'cancelled' }),
        errorCode: null,
        errorMessage: null
      })
    })
    return this.snapshot(workItemPath, task)
  }

  async pause(taskId: string): Promise<WritingAgentTask> {
    const workItemPath = await this.projects.currentPath()
    await this.ensureInitialized(workItemPath)
    const active = this.active.get(this.activeKey(workItemPath, taskId))
    if (active && resolve(active.workItemPath) !== resolve(workItemPath)) {
      throw new AppError('NOT_FOUND', 'AI 任务不存在或不属于当前作品。', { recoverable: true })
    }
    active?.controller.abort()
    const task = await this.withDatabaseWrite(workItemPath, (database) => {
      const current = database.taskRun(taskId)
      if (!current) throw new AppError('NOT_FOUND', 'AI 任务不存在或不属于当前作品。', { recoverable: true })
      const checkpoint = this.checkpoint(current)
      if (isPausedWritingTask(current, workItemPath)) return current
      if (!activeWritingStatuses.includes(current.status)) {
        throw new AppError('CONFLICT', '只有正在生成的任务可以暂停。', { recoverable: true })
      }
      if (active?.streamedContent) this.persistPartial(database, taskId, active.request, active.streamedContent)
      // Stop the provider transport, but retain a distinct durable pause. A
      // continuation gets a new child run, never an in-place network restart.
      return database.transitionTaskRun({
        id: taskId,
        status: 'paused',
        checkpointJson: JSON.stringify({ ...checkpoint, phase: 'paused' }),
        errorCode: null,
        errorMessage: null
      })
    })
    return this.snapshot(workItemPath, task)
  }

  async resume(taskId: string, operationId: string): Promise<WritingAgentTask> {
    if (!this.projects.executionIdentity) return this.projects.runInCurrentBook(() => this.resume(taskId, operationId))
    const workItemPath = await this.projects.currentPath()
    await this.ensureInitialized(workItemPath)
    const original = await this.withDatabase(workItemPath, (database) => database.taskRun(taskId))
    if (!original) throw new AppError('NOT_FOUND', '要继续的 AI 任务不存在。', { recoverable: true })
    const checkpoint = this.checkpoint(original)
    if (!isPausedWritingTask(original, workItemPath)) {
      throw new AppError('CONFLICT', '只有已暂停的任务可以继续。', { recoverable: true })
    }
    if (isLegacyTaskContract(original.taskContract)) throw new AppError('CONFLICT', '这条旧任务没有可验证的冻结契约，请从当前正文重新发起。', { recoverable: true })
    const existingTasks = await this.withDatabase(workItemPath, (database) => database.recentTaskRuns('writing_agent', checkpoint.request.chapterId, 50))
    const duplicate = await this.withDatabase(workItemPath, (database) => database.taskRunByOperationKey(operationId))
    if (duplicate) {
      if (duplicate.taskType !== 'writing_agent' || duplicate.parentTaskRunId !== original.id || JSON.stringify(this.checkpoint(duplicate).request) !== JSON.stringify(checkpoint.request)) {
        throw new AppError('CONFLICT', '这次继续标识已经用于另一条任务。', { recoverable: true })
      }
      return this.snapshot(workItemPath, duplicate)
    }
    if (existingTasks.some((task) => activeWritingStatuses.includes(task.status))) {
      throw new AppError('CONFLICT', '当前章节已有写作任务，请先停止或等待完成。', { recoverable: true })
    }
    const newId = this.id()
    this.assertRecoveryAvailable(checkpoint)
    const modelConfigId = await this.modelConfigId(workItemPath, checkpoint.request)
    const queued = await this.withDatabaseWrite(workItemPath, (database) => database.createTaskRun({
      id: newId,
      initialStatus: 'resuming',
      legacyChapterId: checkpoint.request.chapterId,
      taskType: 'writing_agent',
      taskContract: original.taskContract,
      idempotencyKey: operationId,
      parentTaskRunId: original.id,
      contentHash: hashText(checkpoint.request.currentDraft),
      ...(modelConfigId ? { modelConfigId } : {}),
      attempt: original.attempt + 1,
      checkpointJson: JSON.stringify({ ...checkpoint, phase: 'resuming' })
    }))
    if (queued.id === newId && queued.status === 'resuming') this.launch(workItemPath, queued.id, checkpoint.request)
    return this.snapshot(workItemPath, queued)
  }

  async retry(taskId: string, operationId: string): Promise<WritingAgentTask> {
    if (!this.projects.executionIdentity) return this.projects.runInCurrentBook(() => this.retry(taskId, operationId))
    const workItemPath = await this.projects.currentPath()
    await this.ensureInitialized(workItemPath)
    const original = await this.withDatabase(workItemPath, (database) => database.taskRun(taskId))
    if (!original) throw new AppError('NOT_FOUND', '要重试的 AI 任务不存在。', { recoverable: true })
    if (!['cancelled', 'failed', 'interrupted'].includes(original.status) || isPausedWritingTask(original, workItemPath)) {
      throw new AppError('CONFLICT', '只有已取消、失败或被重启中断的任务可以重试。', { recoverable: true })
    }
    const checkpoint = this.checkpoint(original)
    if (isLegacyTaskContract(original.taskContract)) throw new AppError('CONFLICT', '这条旧任务没有可验证的冻结契约，请从当前正文重新发起。', { recoverable: true })
    if (checkpoint.dismissedAt) throw new AppError('CONFLICT', '这条失败记录已经删除，不能再重试。', { recoverable: true })
    const duplicate = await this.withDatabase(workItemPath, (database) => database.taskRunByOperationKey(operationId))
    if (duplicate) {
      if (duplicate.taskType !== 'writing_agent' || duplicate.parentTaskRunId !== original.id || JSON.stringify(this.checkpoint(duplicate).request) !== JSON.stringify(checkpoint.request)) {
        throw new AppError('CONFLICT', '这次重试标识已经用于另一条任务。', { recoverable: true })
      }
      return this.snapshot(workItemPath, duplicate)
    }
    const newId = this.id()
    this.assertRecoveryAvailable(checkpoint)
    const modelConfigId = await this.modelConfigId(workItemPath, checkpoint.request)
    const queued = await this.withDatabaseWrite(workItemPath, (database) => {
      const latest = database.taskRun(taskId)
      if (!latest) throw new AppError('NOT_FOUND', '要重试的 AI 任务不存在。', { recoverable: true })
      const latestCheckpoint = this.checkpoint(latest)
      if (latestCheckpoint.dismissedAt) throw new AppError('CONFLICT', '这条失败记录已经删除，不能再重试。', { recoverable: true })
      if (!['cancelled', 'failed', 'interrupted'].includes(latest.status) || isPausedWritingTask(latest, workItemPath)) {
        throw new AppError('CONFLICT', '只有已取消、失败或被重启中断的任务可以重试。', { recoverable: true })
      }
      return database.createTaskRun({
        id: newId,
        initialStatus: latest.status === 'interrupted' ? 'resuming' : 'queued',
        legacyChapterId: latestCheckpoint.request.chapterId,
        taskType: 'writing_agent',
        taskContract: latest.taskContract,
        idempotencyKey: operationId,
        parentTaskRunId: latest.id,
        contentHash: hashText(latestCheckpoint.request.currentDraft),
        ...(modelConfigId ? { modelConfigId } : {}),
        attempt: latest.attempt + 1,
        checkpointJson: JSON.stringify({ ...latestCheckpoint, phase: latest.status === 'interrupted' ? 'resuming' : 'queued' })
      })
    })
    if (queued.id === newId && ['queued', 'resuming'].includes(queued.status)) this.launch(workItemPath, queued.id, checkpoint.request)
    return this.snapshot(workItemPath, queued)
  }

  async dismiss(taskId: string): Promise<WritingAgentTask> {
    const workItemPath = await this.projects.currentPath()
    await this.ensureInitialized(workItemPath)
    const task = await this.withDatabaseWrite(workItemPath, (database) => {
      const current = database.taskRun(taskId)
      if (!current) throw new AppError('NOT_FOUND', '要删除的 AI 任务记录不存在。', { recoverable: true })
      const checkpoint = this.checkpoint(current)
      if (checkpoint.dismissedAt) return current
      if (!['cancelled', 'failed', 'interrupted'].includes(current.status) || checkpoint.phase === 'paused') {
        throw new AppError('CONFLICT', '只有失败、中断或已停止且不含待处理草稿的任务记录可以删除。', { recoverable: true })
      }
      const partial = database.generationArtifactForTask(taskId, 'writing_agent_stream')
      if (partial?.status === 'partial') {
        database.updateGenerationArtifactStatus(partial.id, 'discarded', JSON.stringify({
          decision: 'discarded',
          partial: true,
          dismissedWithTask: true,
          decidedAt: this.now().toISOString()
        }))
      }
      return database.transitionTaskRun({
        id: taskId,
        status: current.status,
        checkpointJson: JSON.stringify({ ...checkpoint, dismissedAt: this.now().toISOString() })
      })
    })
    return this.snapshot(workItemPath, task)
  }

  async decide(input: WritingAgentArtifactDecision): Promise<WritingAgentTask> {
    const workItemPath = await this.projects.currentPath()
    await this.ensureInitialized(workItemPath)
    const task = await this.withDatabase(workItemPath, (database) => database.taskRun(input.taskId))
    if (!task) throw new AppError('NOT_FOUND', 'AI 任务不存在或不属于当前作品。', { recoverable: true })
    const snapshot = await this.snapshot(workItemPath, task)
    const accepted = input.acceptedChangeIds ?? []
    if (['paused', 'cancelled', 'failed', 'interrupted'].includes(task.status)) {
      if (!snapshot.partial || snapshot.partial.status !== 'partial') throw new AppError('CONFLICT', '未完成草稿不存在或已经处理。', { recoverable: true })
      if (accepted.length) throw new AppError('VALIDATION_ERROR', '未完成草稿不支持逐块修改决定。', { recoverable: true })
      if (input.decision === 'applied' && !['continue', 'rewrite', 'expand', 'compress', 'custom', 'polish'].includes(snapshot.skill || '')) {
        throw new AppError('CONFLICT', '只读回答的未完成内容不能放入正文。', { recoverable: true })
      }
      if (input.decision === 'applied') {
        throw new AppError('CONFLICT', '正文候选必须通过统一采用流程写入正文，不能只改变候选状态。', { recoverable: true })
      }
      await this.withDatabaseWrite(workItemPath, (database) => database.updateGenerationArtifactStatus(snapshot.partial!.id, input.decision, JSON.stringify({
        decision: input.decision,
        partial: true,
        decidedAt: this.now().toISOString()
      })))
      return this.status(input.taskId)
    }
    if (task.status !== 'succeeded' || !snapshot.artifact || !snapshot.turn) {
      throw new AppError('CONFLICT', '只有已完成的当前作品候选可以确认。', { recoverable: true })
    }
    if (input.decision === 'applied' && snapshot.turn.candidate) {
      throw new AppError('CONFLICT', '正文候选必须通过统一采用流程写入正文，不能只改变候选状态。', { recoverable: true })
    }
    const allowed = new Set(snapshot.turn.candidate?.diff?.filter((block) => block.kind === 'change').map((block) => block.id) ?? [])
    if (accepted.some((id) => !allowed.has(id))) throw new AppError('VALIDATION_ERROR', 'AI 修改决定包含未知块。', { recoverable: true })
    const reviewed = input.reviewedChangeIds ?? []
    const reviewedSet = new Set(reviewed)
    if (reviewed.some((id) => !allowed.has(id)) || (reviewed.length && (input.decision !== 'discarded' || accepted.length || reviewedSet.size !== reviewed.length || reviewedSet.size !== allowed.size))) {
      throw new AppError('VALIDATION_ERROR', 'AI 修改核对记录与候选不一致。', { recoverable: true })
    }
    const metadata = JSON.stringify({
      decision: input.decision,
      acceptedChangeIds: accepted,
      ...(reviewed.length ? { reviewedChangeIds: reviewed } : {}),
      decidedAt: this.now().toISOString()
    })
    await this.withDatabaseWrite(workItemPath, (database) => database.updateGenerationArtifactStatus(snapshot.artifact!.id, input.decision, metadata))
    return this.status(input.taskId)
  }

  async proposal(turnId: string): Promise<{ workItemId: string; chapterId: number; proposal: NonNullable<WritingAgentTurn['proposal']> } | undefined> {
    const existing = this.runner.proposal(turnId)
    if (existing) return existing
    const workItemPath = await this.projects.currentPath()
    await this.ensureInitialized(workItemPath)
    const tasks = await this.withDatabase(workItemPath, (database) => database.recentTaskRuns('writing_agent', undefined, 100))
    for (const task of tasks) {
      const snapshot = await this.snapshot(workItemPath, task)
      if (snapshot.turn?.id === turnId && snapshot.turn.proposal) {
        return { workItemId: snapshot.turn.workItemId, chapterId: snapshot.turn.chapterId, proposal: snapshot.turn.proposal }
      }
    }
    return undefined
  }

  async cancelAll(): Promise<void> {
    const tasks = [...this.active.values()]
    for (const active of tasks) {
      const { taskId } = active
      active.controller.abort()
      await this.withDatabaseWrite(active.workItemPath, (database) => {
        const current = database.taskRun(taskId)
        if (!current || !activeWritingStatuses.includes(current.status)) return
        const checkpoint = this.checkpoint(current)
        if (active.streamedContent) this.persistPartial(database, taskId, active.request, active.streamedContent)
        database.transitionTaskRun({ id: taskId, status: 'cancelled', checkpointJson: JSON.stringify({ ...checkpoint, phase: 'cancelled' }) })
      }).catch(() => undefined)
    }
    this.active.clear()
  }

  abortForShutdown(): void {
    for (const task of this.active.values()) task.controller.abort()
    this.active.clear()
  }

  clearProjectInitialization(): void {
    this.initializedPaths.clear()
  }

  private launch(workItemPath: string, taskId: string, request: WritingAgentRequest): void {
    const key = this.activeKey(workItemPath, taskId)
    if (this.active.has(key)) return
    const controller = new AbortController()
    const active: ActiveTask = { taskId, controller, workItemPath, request, streamedContent: '' }
    this.active.set(key, active)
    void this.execute(workItemPath, taskId, request, controller).finally(() => this.active.delete(key))
  }

  private activeKey(workItemPath: string, taskId: string): string { return JSON.stringify([resolve(workItemPath), taskId]) }

  private async execute(workItemPath: string, taskId: string, request: WritingAgentRequest, controller: AbortController): Promise<void> {
    let preparedRun: WritingAgentPreparedRun | undefined
    let streamedContent = ''
    let lastFlushedLength = 0
    let lastFlushedAt = 0
    const flushPartial = async (force = false): Promise<void> => {
      if (!streamedContent || (!force && streamedContent.length - lastFlushedLength < 512 && Date.now() - lastFlushedAt < 200)) return
      await this.withDatabaseWrite(workItemPath, async (database) => {
        if (preparedRun) await this.runner.assertRunAuthorized?.(preparedRun)
        controller.signal.throwIfAborted()
        const task = database.taskRun(taskId)
        if (!task || !['running', 'streaming'].includes(task.status)) return
        const checkpoint = this.checkpoint(task)
        if (task.status === 'running') database.transitionTaskRun({
          id: taskId,
          status: 'streaming',
          checkpointJson: JSON.stringify({ ...checkpoint, phase: 'streaming', streamedCharacters: streamedContent.length })
        })
        database.savePartialGenerationArtifact({
          id: `${taskId}-stream`,
          taskRunId: taskId,
          artifactType: 'writing_agent_stream',
          status: 'partial',
          content: streamedContent,
          contentHash: hashText(streamedContent),
          schemaValid: true,
          ...(requestAnchorJson(request) ? { selectionAnchorJson: requestAnchorJson(request) } : {}),
          metadataJson: JSON.stringify({ streamedCharacters: streamedContent.length, updatedAt: this.now().toISOString() })
        })
      })
      lastFlushedLength = streamedContent.length
      lastFlushedAt = Date.now()
    }
    try {
      const checkpoint = await this.withDatabaseWrite(workItemPath, (database) => {
        const task = database.taskRun(taskId)
        if (!task || !['queued', 'resuming'].includes(task.status)) throw new AppError('CONFLICT', 'AI 任务已经变化，未重复执行。', { recoverable: true })
        const checkpoint = this.checkpoint(task)
        database.transitionTaskRun({ id: taskId, status: 'preparing', checkpointJson: JSON.stringify({ ...checkpoint, phase: 'preparing' }) })
        return { ...checkpoint, restoring: Boolean(task.parentTaskRunId) }
      })
      if (checkpoint.restoring) this.assertRecoveryAvailable(checkpoint)
      const prepared = checkpoint.restoring && this.runner.restore
        ? await this.runner.restore(request, checkpoint.recovery, controller.signal)
        : await this.runner.prepare(request, controller.signal)
      preparedRun = prepared
      controller.signal.throwIfAborted()
      await this.freezeContextPackage(workItemPath, taskId, prepared)
      controller.signal.throwIfAborted()
      const turn = await this.runner.run(request, controller.signal, prepared, async (_delta, content) => {
        // Stop receiving text immediately, even while the stop write is queued.
        if (controller.signal.aborted) return
        streamedContent = content
        const active = this.active.get(this.activeKey(workItemPath, taskId))
        if (active) active.streamedContent = content
        await flushPartial()
      })
      if (controller.signal.aborted) return
      if (turn.workItemId !== prepared.workItemId || turn.chapterId !== request.chapterId) {
        throw new AppError('CONFLICT', '模型结果不属于任务绑定的作品或章节，未保存候选。', { recoverable: true })
      }
      await flushPartial(true)
      const content = JSON.stringify(turn)
      await this.withDatabaseWrite(workItemPath, async (database) => {
        await this.runner.assertRunAuthorized?.(prepared)
        controller.signal.throwIfAborted()
        const task = database.taskRun(taskId)
        if (!task || !['running', 'streaming'].includes(task.status)) return
        const checkpoint = this.checkpoint(task)
        database.completeTaskRunWithArtifact(taskId, JSON.stringify({ ...checkpoint, phase: 'approval' }), {
          id: this.id(),
          taskRunId: taskId,
          artifactType: 'writing_agent_turn',
          status: 'complete',
          content,
          contentHash: hashText(content),
          schemaValid: true,
          ...(requestAnchorJson(request) ? { selectionAnchorJson: requestAnchorJson(request) } : {}),
          metadataJson: JSON.stringify({ model: turn.model, skill: turn.skill.id, createdAt: turn.createdAt })
        })
        const stream = database.generationArtifactForTask(taskId, 'writing_agent_stream')
        if (stream?.status === 'partial') database.updateGenerationArtifactStatus(stream.id, 'complete', JSON.stringify({
          streamedCharacters: stream.content.length,
          completedAt: this.now().toISOString()
        }))
      })
    } catch (error) {
      // Only this task's stop signal proves an intentional pause/cancellation.
      // A dependency can abort independently and must leave a retryable failure.
      if (controller.signal.aborted) return
      await flushPartial(true).catch(() => undefined)
      await this.withDatabaseWrite(workItemPath, (database) => {
        const task = database.taskRun(taskId)
        if (!task || !activeWritingStatuses.includes(task.status)) return
        const checkpoint = this.checkpoint(task)
        database.transitionTaskRun({
          id: taskId,
          status: 'failed',
          checkpointJson: JSON.stringify({ ...checkpoint, phase: 'failed' }),
          errorCode: isAppError(error) ? error.code : 'GENERATION_FAILED',
          errorMessage: safeErrorMessage(error)
        })
      }).catch(() => undefined)
    }
  }

  private persistPartial(database: WorkspaceDatabasePort, taskId: string, request: WritingAgentRequest, content: string): void {
    const task = database.taskRun(taskId)
    if (!task || !['running', 'streaming'].includes(task.status) || !content) return
    const checkpoint = this.checkpoint(task)
    if (task.status === 'running') database.transitionTaskRun({
      id: taskId,
      status: 'streaming',
      checkpointJson: JSON.stringify({ ...checkpoint, phase: 'streaming', streamedCharacters: content.length })
    })
    database.savePartialGenerationArtifact({
      id: `${taskId}-stream`,
      taskRunId: taskId,
      artifactType: 'writing_agent_stream',
      status: 'partial',
      content,
      contentHash: hashText(content),
      schemaValid: true,
      ...(requestAnchorJson(request) ? { selectionAnchorJson: requestAnchorJson(request) } : {}),
      metadataJson: JSON.stringify({ streamedCharacters: content.length, updatedAt: this.now().toISOString() })
    })
  }

  private async freezeContextPackage(workItemPath: string, taskId: string, prepared: WritingAgentPreparedRun): Promise<void> {
    const request = await this.withDatabase(workItemPath, database => {
      const task = database.taskRun(taskId)
      if (!task) throw new AppError('NOT_FOUND', 'AI 任务不存在。', { recoverable: true })
      return this.checkpoint(task).request
    })
    const recovery = await this.runner.snapshotForRecovery?.(request, prepared)
    // Keep task recovery compatible with pre-compiler prepared runs: only the
    // service boundary may supply the fallback, and it still creates the same
    // immutable, budgeted package before a model request can start.
    const contextCompilation = prepared.contextCompilation ?? compileContext({
      task: `writing-agent:${prepared.skill}`,
      candidates: prepared.contexts.map((context) => ({
        id: `prompt-context:${context.task}`,
        sourceType: 'workspace-prompt-context',
        sourceId: context.task,
        label: context.label,
        content: context.content,
        authority: 'required' as const,
        truncationPolicy: 'never' as const
      })),
      modelContextLimit: contextBudgetStartingSuggestions.modelContextLimit,
      outputReserveTokens: Math.floor(contextBudgetStartingSuggestions.modelContextLimit * contextBudgetStartingSuggestions.outputReservePercent / 100),
      systemReserveTokens: contextBudgetStartingSuggestions.systemReserveTokens,
      projectInputBudget: contextBudgetStartingSuggestions.inputBudgetTokens
    })
    if (contextCompilation.status === 'blocked') {
      throw new AppError('VALIDATION_ERROR', `本次作品上下文无法安全编译：${contextCompilation.blocked?.message || '上下文预算不足'}。请缩短过长的总纲、章纲或资料后重试。`, { recoverable: true })
    }
    const contentJson = JSON.stringify({
      version: prepared.version,
      skill: prepared.skill,
      model: prepared.model,
      ...(prepared.connectionId ? {connectionId:prepared.connectionId} : {}),
      ...(prepared.localProfile ? {localProfile:prepared.localProfile} : {}),
      chapterCardFingerprint: prepared.chapterCardFingerprint,
      toolGrant: prepared.toolGrant,
      contexts: prepared.contexts,
      contextCompilation
    })
    const characterCount = prepared.contexts.reduce((total, item) => total + item.content.length, 0)
    const estimatedTokens = contextCompilation.budget.usedInputTokens
    const tokenBudget = contextCompilation.budget.availableInputTokens
    await this.withDatabaseWrite(workItemPath, async (database) => {
      await this.runner.assertRunAuthorized?.(prepared)
      const task = database.taskRun(taskId)
      if (!task || task.status !== 'preparing') throw new AppError('CONFLICT', 'AI 任务已停止，未发送模型请求。', { recoverable: true })
      database.createContextPackage({
        id: `${taskId}-context`,
        taskRunId: taskId,
        compilerVersion: 'context-compiler-v1',
        contentJson,
        contentHash: hashText(contentJson),
        tokenBudget,
        estimatedTokens,
        truncationJson: JSON.stringify({
          truncated: contextCompilation.truncation.truncated,
          strategy: 'authority-budgeted-context-compiler',
          characterCount,
          contextCount: prepared.contexts.length,
          estimator: contextCompilation.estimator,
          excluded: contextCompilation.excluded,
          truncation: contextCompilation.truncation,
          budget: contextCompilation.budget,
          contentHash: contextCompilation.contentHash
        })
      })
      const current = database.taskRun(taskId)
      if (current?.status === 'preparing') {
        const checkpoint = this.checkpoint(current)
        database.transitionTaskRun({
          id: taskId,
          status: 'running',
          checkpointJson: JSON.stringify({
            ...checkpoint,
            phase: 'model',
            ...(recovery ? { recovery } : {}),
            toolGrant: prepared.toolGrant,
            plan: {
              version: 1,
              steps: ['permission-check', 'compile-context', 'model', 'validate', 'artifact', 'approval']
            }
          })
        })
      }
    })
  }

  private async snapshot(workItemPath: string, task: WorkspaceTaskRunRecord): Promise<WritingAgentTask> {
    const checkpoint = this.checkpoint(task)
    const skill = resolveWritingAgentSkill(checkpoint.request.message, checkpoint.request.preferredSkill, Boolean(checkpoint.request.selection))
    const { artifact, partial, contextPackage } = await this.withDatabase(workItemPath, (database) => ({
      artifact: database.generationArtifactForTask(task.id, 'writing_agent_turn'),
      partial: database.generationArtifactForTask(task.id, 'writing_agent_stream'),
      contextPackage: database.contextPackageForTask(task.id)
    }))
    const turn = artifact?.schemaValid ? decodeTurn(artifact.content, checkpoint) : undefined
    if (turn) this.runner.remember(turn)
    return {
      id: task.id,
      workItemId: checkpoint.workItemId,
      chapterId: checkpoint.request.chapterId,
      status: taskRunHasLegacyPause(task, workItemPath) ? 'paused' : task.status,
      attempt: task.attempt,
      ...(task.parentTaskRunId ? { parentTaskRunId: task.parentTaskRunId } : {}),
      message: checkpoint.request.message,
      baseDraft: checkpoint.request.currentDraft,
      ...(checkpoint.request.model ? { model: checkpoint.request.model } : {}),
      ...(checkpoint.request.preferredSkill ? { preferredSkill: checkpoint.request.preferredSkill } : {}),
      skill,
      ...(checkpoint.request.selection ? { selection: checkpoint.request.selection } : {}),
      ...(checkpoint.request.insertionAnchor ? { insertionAnchor: checkpoint.request.insertionAnchor } : {}),
      ...(task.startedAt ? { startedAt: task.startedAt } : {}),
      ...(task.endedAt ? { completedAt: task.endedAt } : {}),
      ...(task.errorCode ? { error: { code: task.errorCode, message: task.errorMessage || 'AI 任务未完成。' } } : {}),
      ...(artifact ? { artifact: { id: artifact.id, status: artifact.status } } : {}),
      ...(partial ? { partial: { id: partial.id, content: partial.content, status: partial.status, updatedAt: partial.updatedAt } } : {}),
      ...(contextPackage ? { contextPackage: publicContextPackage(contextPackage, skill) } : {}),
      ...(turn ? { turn } : {})
    }
  }

  private checkpoint(task: WorkspaceTaskRunRecord): Checkpoint {
    try {
      const value = JSON.parse(task.checkpointJson) as Partial<Checkpoint>
      if (value.version !== 1 || !value.workItemId || !value.request || typeof value.request !== 'object') throw new Error('invalid checkpoint')
      const request = value.request as WritingAgentRequest
      if (!Number.isSafeInteger(request.chapterId) || request.chapterId < 1 || typeof request.message !== 'string' || typeof request.currentDraft !== 'string') {
        throw new Error('invalid request')
      }
      return value as Checkpoint
    } catch (error) {
      throw new AppError('DATABASE_INTEGRITY_FAILED', 'AI 任务检查点损坏，已停止恢复。', { recoverable: false, cause: error })
    }
  }

  private assertRecoveryAvailable(checkpoint: Checkpoint): void {
    // Historical test adapters omit the main recovery port; production owns it.
    if (!this.runner.restore) return
    if (!checkpoint.recovery) return missingWritingAgentRecovery()
    const recovery = decodeWritingAgentRecovery(checkpoint.recovery)
    if (recovery.workItemId !== checkpoint.workItemId || recovery.chapterId !== checkpoint.request.chapterId) return missingWritingAgentRecovery()
  }

  private async ensureInitialized(workItemPath: string): Promise<void> {
    const key = resolve(workItemPath)
    if (this.initializedPaths.has(key)) return
    await this.writes.run(workItemPath, async () => {
      if (this.initializedPaths.has(key)) return
      const database = await this.databases.openExisting(workItemPath)
      if (!database) throw new AppError('FEATURE_UNAVAILABLE', '这部作品尚未建立 SQLite 任务存储。请前往“设置 → 项目数据”建立数据库；手写与保存不受影响。', { recoverable: true })
      try { database.interruptActiveTaskRuns('writing_agent') } finally { database.close() }
      this.initializedPaths.add(key)
    })
  }

  private async withDatabase<T>(workItemPath: string, operation: (database: WorkspaceDatabasePort) => T | Promise<T>): Promise<T> {
    // Even a status query uses a writable connection whose close may checkpoint
    // WAL. Keep its whole lifetime outside byte-verified snapshot acquisition.
    return this.writes.run(workItemPath, async () => {
      if (this.projects.executionIdentity && resolve(await this.projects.currentPath()) !== resolve(workItemPath)) {
        throw new AppError('CONFLICT', '任务存储与绑定作品不一致。', { recoverable: true })
      }
      const database = await this.databases.openExisting(workItemPath)
      if (!database) throw new AppError('FEATURE_UNAVAILABLE', 'AI 任务数据库不可用。', { recoverable: true })
      try { return await operation(database) } finally { database.close() }
    })
  }

  private async withDatabaseWrite<T>(workItemPath: string, operation: (database: WorkspaceDatabasePort) => T | Promise<T>): Promise<T> {
    try {
      return await this.withDatabase(workItemPath, operation)
    } catch (error) {
      if (isAppError(error)) throw error
      throw new AppError('STORAGE_ERROR', 'AI 任务数据暂时无法保存，请检查存储空间和文件权限后重试。', { recoverable: true, cause: error })
    }
  }

  private async modelConfigId(workItemPath: string, request: WritingAgentRequest): Promise<string | undefined> {
    return this.modelConfigResolver ? this.modelConfigResolver({ workItemPath, request }) : request.model?.trim() || undefined
  }
}

function requestAnchorJson(request: WritingAgentRequest): string | undefined {
  if (!request.selection && !request.insertionAnchor) return undefined
  return JSON.stringify({
    version: 1,
    ...(request.selection ? { selection: request.selection } : {}),
    ...(request.insertionAnchor ? { insertionAnchor: request.insertionAnchor } : {})
  })
}

function decodeTurn(content: string, checkpoint: Checkpoint): WritingAgentTurn | undefined {
  try {
    const value = JSON.parse(content) as WritingAgentTurn
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' || value.workItemId !== checkpoint.workItemId
      || value.chapterId !== checkpoint.request.chapterId || typeof value.answer !== 'string' || !Array.isArray(value.tools)
      || !value.skill || typeof value.skill.id !== 'string' || typeof value.model !== 'string') return undefined
    return value
  } catch {
    return undefined
  }
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function safeErrorMessage(error: unknown): string {
  return safePersistedErrorMessage(error, 'AI 任务未完成，请检查模型连接后重试。')
}

function estimateTokens(value: string): number {
  let weighted = 0
  for (const character of value) weighted += /[\u3400-\u9fff]/.test(character) ? 1.35 : 0.32
  return Math.ceil(weighted)
}

function publicContextPackage(value: import('../../../core/ports/workspace-database').WorkspaceContextPackageRecord, fallbackSkill: WritingAgentSkillId): NonNullable<WritingAgentTask['contextPackage']> {
  let metadata: { truncated?: unknown; characterCount?: unknown; contextCount?: unknown } = {}
  let contexts: NonNullable<WritingAgentTask['contextPackage']>['contexts'] = []
  let skill = fallbackSkill
  try { metadata = JSON.parse(value.truncationJson) as typeof metadata } catch { /* validated at the storage boundary */ }
  try {
    const content = JSON.parse(value.contentJson) as { skill?: unknown; contexts?: Array<{ task?: unknown; id?: unknown; sourceType?: unknown; label?: unknown; content?: unknown; authority?: unknown; mode?: unknown; estimatedTokens?: unknown; reasons?: unknown }> }
    if (['continue', 'rewrite', 'expand', 'compress', 'custom', 'polish', 'review', 'query', 'plan'].includes(String(content.skill))) skill = content.skill as WritingAgentSkillId
    contexts = (content.contexts || []).slice(0, 100).flatMap((item) => {
      if ((item.task !== 'prose' && item.task !== 'review' && item.task !== 'chapterOutline') || typeof item.label !== 'string' || typeof item.content !== 'string') return []
      return [{
        task: item.task,
        ...(typeof item.id === 'string' ? { id: item.id.slice(0, 256) } : {}),
        ...(typeof item.sourceType === 'string' ? { sourceType: item.sourceType.slice(0, 100) } : {}),
        label: item.label.slice(0, 80),
        ...(typeof item.authority === 'string' ? { authority: item.authority.slice(0, 20) } : {}),
        ...(typeof item.mode === 'string' ? { mode: item.mode.slice(0, 20) } : {}),
        ...(Number.isFinite(item.estimatedTokens) ? { estimatedTokens: Number(item.estimatedTokens) } : {}),
        ...(Array.isArray(item.reasons) ? { reasons: item.reasons.filter((reason): reason is string => typeof reason === 'string').slice(0, 20).map((reason) => reason.slice(0, 200)) } : {}),
        characters: item.content.length,
        preview: item.content.slice(0, 1_200)
      }]
    })
  } catch { /* validated at the storage boundary */ }
  return {
    id: value.id,
    compilerVersion: value.compilerVersion,
    contentHash: value.contentHash,
    tokenBudget: value.tokenBudget,
    estimatedTokens: value.estimatedTokens,
    characterCount: Number(metadata.characterCount) || 0,
    contextCount: Number(metadata.contextCount) || 0,
    truncated: metadata.truncated === true,
    createdAt: value.createdAt,
    skill,
    contexts
  }
}
