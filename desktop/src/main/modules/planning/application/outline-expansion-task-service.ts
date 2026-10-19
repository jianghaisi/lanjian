import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import type { WorkspaceDatabaseFactory, WorkspaceDatabasePort, WorkspaceTaskRunRecord } from '../../../core/ports/workspace-database'
import type { OutlineExpansionProposal, OutlineExpansionTask, OutlineExpansionTaskInput, PlanningOutlineSource } from '../../../../contracts/index'
import { decodeOutlineExpansionArgs } from '../../../../contracts/ipc'
import { parseOutlineExpansion, type PlanningDraftService } from './planning-draft-service'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'
import { StructuredResponseFailure } from '../../assistant/application/structured-response-repair'
import { createTaskContractSnapshot, isLegacyTaskContract } from '../../assistant/domain/task-template-contract'
import { decodeCreativePolicyRecords } from '../../../../contracts/writing-plugins/creative-policy'

const type = 'outline_expansion'
const running = (status: string) => ['queued', 'preparing', 'running', 'streaming'].includes(status)
type ExpansionSibling = { key: string; title: string; content: string; revision: string }
type Checkpoint = { methodVersion?: 'story-v1' | 'story-v2-direct-chapter'; version: 1; request: OutlineExpansionTaskInput;
  source: PlanningOutlineSource; model: string; siblings?: ExpansionSibling[] }

/** Uses the database task/Artifact lifecycle; never creates formal outline nodes. */
export class OutlineExpansionTaskService {
  private readonly active = new Map<string, { id: string; root: string; controller: AbortController }>()
  private readonly initialized = new Set<string>()
  private queue: Promise<unknown> = Promise.resolve()
  constructor(
    private readonly projects: { currentPath(): Promise<string>; readonly executionIdentity?: { root: string } },
    private readonly databases: WorkspaceDatabaseFactory,
    private readonly runner: Pick<PlanningDraftService, 'expandNextLayer'>,
    private readonly source: (key: string) => Promise<PlanningOutlineSource | null>,
    private readonly model: () => Promise<string>,
    private readonly syncMirrors?: (root: string) => Promise<unknown>,
    private readonly writes: WorkspaceWriteCoordinator = new WorkspaceWriteCoordinator()
  ) {}

  start(raw: OutlineExpansionTaskInput): Promise<OutlineExpansionTask> {
    const input = decodeOutlineExpansionArgs([raw])[0]
    const operation = this.queue.then(async () => {
      const root = await this.projects.currentPath()
      if (await this.initialize(root)) await this.syncMirrors?.(root).catch(() => undefined)
      const duplicate = await this.db(root, db => db.taskRunByOperationKey(input.operationId))
      if (duplicate) {
        if (duplicate.taskType !== type || JSON.stringify(this.checkpoint(duplicate).request) !== JSON.stringify(input)) throw this.conflict('提交标识已经用于其他任务。')
        return this.view(root, duplicate)
      }
      if ([...this.active.values()].some(item => item.root === root)) throw this.conflict('请先停止或等待本书的逐层规划任务。')
      const source = await this.source(input.parentKey)
      if (!source || source.revision !== input.expectedRevision || !source.content.trim()) throw this.conflict('父级为空或已经变化，请重新打开后拆解。')
      const siblings = source.kind === 'volume' ? await this.db(root, db => {
        const nodes = db.formalOutlines().filter(node => node.parentLegacyKey === source.key).sort((a, b) => a.seq - b.seq)
        if (nodes.some(node => node.nodeType === 'stage')) throw this.conflict('本卷已有阶段纲，请从对应阶段继续拆章。')
        return nodes.map((node, index) => ({ key: node.legacyKey, title: node.title,
          content: index === nodes.length - 1 ? node.content : '', revision: node.revision }))
      }) : []
      const checkpoint: Checkpoint = { version: 1, methodVersion: 'story-v2-direct-chapter', request: input, source,
        model: await this.model(), ...(source.kind === 'volume' ? { siblings } : {}) }
      if (resolve(root) !== resolve(await this.projects.currentPath())) throw this.conflict('作品已经切换，本次未启动生成。')
      const task = await this.dbWrite(root, db => db.createTaskRun({ id: randomUUID(), taskType: type, idempotencyKey: input.operationId,
        taskContract: createTaskContractSnapshot(type), checkpointJson: JSON.stringify(checkpoint) }))
      const controller = new AbortController()
      this.active.set(JSON.stringify([root, task.id]), { id: task.id, root, controller })
      void this.execute(root, task, checkpoint, controller)
      return this.view(root, task)
    })
    this.queue = operation.catch(() => undefined)
    return operation
  }

  async recent(): Promise<OutlineExpansionTask[]> {
    const root = await this.projects.currentPath()
    if (await this.initialize(root)) await this.syncMirrors?.(root).catch(() => undefined)
    const result = await this.db(root, db => {
      const parents = new Map(db.formalOutlines().map(node => [node.legacyKey, node.revision]))
      return db.recentTaskRuns(type, undefined, 50).map(task => this.project(db, task, parents))
    })
    if (resolve(root) !== resolve(await this.projects.currentPath())) throw this.conflict('作品已经切换，请重新读取候选。')
    return result
  }

  async status(id: string): Promise<OutlineExpansionTask> {
    const root = await this.projects.currentPath()
    return this.view(root, await this.db(root, db => this.require(db, id)))
  }

  async cancel(id: string): Promise<OutlineExpansionTask> {
    const root = await this.projects.currentPath()
    const task = await this.db(root, db => this.require(db, id))
    this.active.get(JSON.stringify([root, id]))?.controller.abort()
    const cancelled = running(task.status) ? await this.dbWrite(root, db => db.transitionTaskRun({ id, status: 'cancelled' })) : task
    this.active.delete(JSON.stringify([root, id]))
    return this.view(root, cancelled)
  }

  retry(id: string, operationId: string): Promise<OutlineExpansionTask> {
    const operation = this.queue.then(async () => {
      const root = await this.projects.currentPath()
      await this.initialize(root)
      const original = await this.db(root, db => this.require(db, id))
      if (!['cancelled', 'failed', 'interrupted'].includes(original.status)) {
        throw this.conflict('只有已停止、失败或被重启中断的逐层谋篇任务可以重试。')
      }
      const duplicate = await this.db(root, db => db.taskRunByOperationKey(operationId))
      if (duplicate) {
        if (duplicate.taskType !== type || duplicate.parentTaskRunId !== original.id) throw this.conflict('这次重试标识已经用于其他任务。')
        return this.view(root, duplicate)
      }
      if (await this.db(root, db => db.recentTaskRuns(type, undefined, 100).some(task => running(task.status)))) {
        throw this.conflict('请先停止或等待本书的逐层谋篇任务。')
      }
      const checkpoint = this.checkpoint(original)
      if (isLegacyTaskContract(original.taskContract)) throw this.conflict('这条旧谋篇任务没有可验证的冻结契约，请从当前父稿重新发起。')
      const currentSource = await this.source(checkpoint.source.key)
      if (!currentSource || currentSource.revision !== checkpoint.source.revision
        || currentSource.projectFingerprint !== checkpoint.source.projectFingerprint) {
        throw this.conflict('原父稿已经变化，请基于当前版本重新拆解。')
      }
      if (resolve(root) !== resolve(await this.projects.currentPath())) throw this.conflict('作品已经切换，本次未启动重试。')
      const nextCheckpoint: Checkpoint = { ...checkpoint, request: { ...checkpoint.request, operationId } }
      const task = await this.dbWrite(root, db => db.createTaskRun({
        id: randomUUID(), taskType: type, idempotencyKey: operationId, parentTaskRunId: original.id,
        taskContract: original.taskContract,
        attempt: original.attempt + 1, checkpointJson: JSON.stringify(nextCheckpoint)
      }))
      const controller = new AbortController()
      this.active.set(JSON.stringify([root, task.id]), { id: task.id, root, controller })
      void this.execute(root, task, nextCheckpoint, controller)
      return this.view(root, task)
    })
    this.queue = operation.catch(() => undefined)
    return operation
  }

  async cancelAll(): Promise<void> {
    await this.queue
    for (const item of this.active.values()) {
      const { id, root } = item
      item.controller.abort()
      await this.dbWrite(item.root, db => { if (running(this.require(db, id).status)) db.transitionTaskRun({ id, status: 'cancelled' }) })
      this.active.delete(JSON.stringify([root, id]))
    }
  }
  abortForShutdown(): void { for (const item of this.active.values()) item.controller.abort() }

  private async execute(root: string, task: WorkspaceTaskRunRecord, checkpoint: Checkpoint, controller: AbortController) {
    try {
      if (controller.signal.aborted) return
      await this.dbWrite(root, db => { if (this.require(db, task.id).status === 'queued') db.transitionTaskRun({ id: task.id, status: 'running' }) })
      if (controller.signal.aborted) return
      const proposal = await this.runner.expandNextLayer(checkpoint.request, controller.signal, checkpoint.model,
        checkpoint.methodVersion ?? 'legacy', checkpoint.siblings)
      if (controller.signal.aborted) return
      const content = JSON.stringify(proposal)
      await this.dbWrite(root, db => {
        if (this.require(db, task.id).status !== 'running') return
        db.completeTaskRunWithArtifact(task.id, JSON.stringify(checkpoint), {
          id: randomUUID(), taskRunId: task.id, artifactType: type, status: 'complete', content,
          contentHash: createHash('sha256').update(content).digest('hex'), schemaValid: true,
          metadataJson: JSON.stringify({ parentKey: checkpoint.source.key, parentRevision: checkpoint.source.revision, model: checkpoint.model })
        })
      })
      await this.syncMirrors?.(root)
    } catch (error) {
      if (process.env.LANJIAN_SMOKE_OUTLINE_EXPANSION_ONLY === '1') console.error('[desktop smoke] outline expansion failure: EXPANSION_FAILED')
      await this.dbWrite(root, db => {
        if (!running(this.require(db, task.id).status)) return
        if (!controller.signal.aborted && error instanceof StructuredResponseFailure) {
          db.createGenerationArtifact({
            id: randomUUID(), taskRunId: task.id, artifactType: type, status: 'invalid',
            content: error.originalContent, contentHash: createHash('sha256').update(error.originalContent).digest('hex'), schemaValid: false,
            metadataJson: JSON.stringify({ parentKey: checkpoint.source.key, parentRevision: checkpoint.source.revision, model: checkpoint.model,
              repairAttempts: error.repairAttempts, lastResult: error.lastContent, failure: 'structured-or-story-response-invalid' })
          })
        }
        db.transitionTaskRun({ id: task.id, status: controller.signal.aborted ? 'cancelled' : 'failed', errorCode: 'EXPANSION_FAILED',
          errorMessage: error instanceof StructuredResponseFailure ? error.message : '逐层规划未完成，原大纲保持不变。' })
      }).catch(() => undefined)
    } finally { this.active.delete(JSON.stringify([root, task.id])) }
  }

  private async view(root: string, task: WorkspaceTaskRunRecord) {
    return this.db(root, db => this.project(db, task, new Map(db.formalOutlines().map(node => [node.legacyKey, node.revision]))))
  }
  private project(db: WorkspaceDatabasePort, task: WorkspaceTaskRunRecord, parents: Map<string, string>): OutlineExpansionTask {
    if (task.status === 'paused' || task.status === 'resuming') {
      throw new AppError('DATABASE_INTEGRITY_FAILED', '谋篇任务包含不支持的暂停或恢复状态；原记录未改动。', { recoverable: true })
    }
    const checkpoint = this.checkpoint(task)
    const artifact = db.generationArtifactForTask(task.id, type)
    let proposal: OutlineExpansionProposal | null = null
    if (artifact?.schemaValid) {
      const value = JSON.parse(artifact.content) as OutlineExpansionProposal
      if (value.source?.key !== checkpoint.source.key || value.source.revision !== checkpoint.source.revision || value.source.projectFingerprint !== checkpoint.source.projectFingerprint) throw this.conflict('候选来源与任务记录不一致。')
      proposal = { ...value, children: parseOutlineExpansion(JSON.stringify({ children: value.children }), checkpoint.request.count,
        Boolean(checkpoint.methodVersion && value.methodVersion === checkpoint.methodVersion)),
        ...(value.creativePolicy !== undefined ? { creativePolicy: decodeCreativePolicyRecords(value.creativePolicy) } : {}) }
    }
    const currentSiblings = checkpoint.siblings && db.formalOutlines().filter(node => node.parentLegacyKey === checkpoint.source.key)
      .map(node => ({ key: node.legacyKey, revision: node.revision })).sort((a, b) => a.key.localeCompare(b.key))
    const frozenSiblings = checkpoint.siblings?.map(({ key, revision }) => ({ key, revision })).sort((a, b) => a.key.localeCompare(b.key))
    const sourceStale = parents.get(checkpoint.source.key) !== checkpoint.source.revision
      || (artifact?.status !== 'applied' && currentSiblings !== undefined && JSON.stringify(currentSiblings) !== JSON.stringify(frozenSiblings))
    return { id: task.id, status: task.status, createdAt: task.createdAt, model: checkpoint.model, request: checkpoint.request,
      sourceStale, proposal: proposal ? { ...proposal, sourceStale } : null, error: task.errorMessage,
      ...(artifact && !artifact.schemaValid ? { rawResult: artifact.content } : {}),
      adoptedKeys: artifact?.status === 'applied' ? JSON.parse(artifact.metadataJson).adoption?.keys ?? [] : [] }
  }
  private checkpoint(task: WorkspaceTaskRunRecord): Checkpoint {
    const value = JSON.parse(task.checkpointJson) as Checkpoint
    if (value.version !== 1 || !value.source?.revision || typeof value.model !== 'string') throw this.conflict('规划任务记录不完整。')
    decodeOutlineExpansionArgs([value.request])
    return value
  }
  private require(db: WorkspaceDatabasePort, id: string) {
    const task = db.taskRun(id)
    if (!task || task.taskType !== type) throw this.conflict('当前作品没有这条逐层规划任务。')
    return task
  }
  private async initialize(root: string): Promise<boolean> {
    if (this.initialized.has(root)) return false
    let initialized = false
    await this.dbWrite(root, db => {
      if (this.initialized.has(root)) return
      db.formalOutlines()
      db.interruptActiveTaskRuns(type)
      this.initialized.add(root)
      initialized = true
    })
    return initialized
  }
  private async open(root: string) {
    if (this.projects.executionIdentity && resolve(await this.projects.currentPath()) !== resolve(root)) throw this.conflict('任务存储与绑定作品不一致。')
    const db = await this.databases.openExisting(root)
    if (!db) throw this.conflict('请先启用本书 SQLite 正式大纲。')
    return db
  }
  private async db<T>(root: string, action: (db: WorkspaceDatabasePort) => T): Promise<T> {
    const db = await this.open(root)
    try { return action(db) } finally { db.close() }
  }
  private async dbWrite<T>(root: string, action: (db: WorkspaceDatabasePort) => T): Promise<T> {
    return this.writes.run(root, () => this.db(root, action))
  }
  private conflict(message: string) { return new AppError('CONFLICT', message, { recoverable: true }) }
}
