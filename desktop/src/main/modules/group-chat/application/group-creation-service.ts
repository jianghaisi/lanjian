import { createHash } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import type { GroupBookCreation, GroupBookCreated } from '../../../../contracts/group-chat/creation'
import type { ModelCreationResult } from '../../../../contracts/models/model-connections-contracts'
import type { GroupChatService } from './group-chat-service'
export type GroupCreationReceipt = { creationId: string; inputDigest: string; state: 'creating' | 'result' | 'rejected'; result: ModelCreationResult | null }
export type GroupCreationPorts = {
  read(sessionId: string): Promise<GroupCreationReceipt | null>
  write(sessionId: string, receipt: GroupCreationReceipt): Promise<void>
  validateBeforeCreate?(input: { token: string; project: GroupBookCreation['project'] }): Promise<void>
  create(input: { token: string; project: GroupBookCreation['project'] }): Promise<ModelCreationResult>
  retry(input: { token: string; operationId: string }): Promise<ModelCreationResult>
  captureBook(result: Extract<ModelCreationResult, { status: 'created' }>): Promise<{ root: string; physicalIdentity: string }>
}
/** Durable publication receipt precedes binding. A binding retry never repeats creation. */
export class GroupCreationService {
  private readonly lanes = new Map<string, Promise<unknown>>()
  constructor(private readonly groups: GroupChatService, private readonly ports: GroupCreationPorts) {}
  create(input: GroupBookCreation): Promise<GroupBookCreated> {
    const old = this.lanes.get(input.sessionId) ?? Promise.resolve(), run = old.then(() => this.execute(input), () => this.execute(input)), settled = run.then(() => {}, () => {})
    this.lanes.set(input.sessionId, settled); return run.finally(() => { if (this.lanes.get(input.sessionId) === settled) this.lanes.delete(input.sessionId) })
  }
  private async execute(input: GroupBookCreation): Promise<GroupBookCreated> {
    let session = await this.groups.get({ sessionId: input.sessionId, limit: 100 })
    const digest = createHash('sha256').update(JSON.stringify(input.project)).digest('hex')
    let receipt = await this.ports.read(input.sessionId)
    if (receipt?.state === 'rejected') receipt = null
    if (receipt && (receipt.creationId !== input.creationId || receipt.inputDigest !== digest)) throw new AppError('CONFLICT', '原建书信息不同，已有目录和回执保留。', { recoverable: true })
    if (receipt?.state === 'creating') throw new AppError('CONFLICT', '上次建书结果尚未核实，请查看书架或原目录；不会再次建书。', { recoverable: true })
    if (!receipt) {
      if (session.revision !== input.expectedRevision || session.status !== 'waiting-creation' || session.creation?.id !== input.creationId || session.book) throw new AppError('CONFLICT', '群聊建书请求已变化。', { recoverable: true })
      await this.ports.validateBeforeCreate?.({ token: input.token, project: input.project })
      receipt = { creationId: input.creationId, inputDigest: digest, state: 'creating', result: null }
      await this.ports.write(input.sessionId, receipt)
      try { receipt.result = await this.ports.create({ token: input.token, project: input.project }) }
      catch (error) {
        if (error instanceof AppError && error.details?.groupCreationAllocation === 'not-started') { receipt.state = 'rejected'; await this.ports.write(input.sessionId, receipt) }
        throw error
      }
      receipt.state = 'result'; await this.ports.write(input.sessionId, receipt)
    } else if (receipt.result?.status === 'partial') {
      receipt.result = await this.ports.retry({ token: input.token, operationId: receipt.result.operationId }); await this.ports.write(input.sessionId, receipt)
    }
    const result = receipt.result!
    if (result.status === 'created' && !session.book) {
      const bound = await this.ports.captureBook(result)
      // Re-read actual revision; the durable creation result authorizes binding only.
      session = await this.groups.get({ sessionId: input.sessionId, limit: 100 })
      session = await this.groups.update({ sessionId: session.id, expectedRevision: session.revision }, async s => {
        if (s.view.creation?.id !== input.creationId || s.view.status !== 'waiting-creation' || s.view.book) throw new AppError('CONFLICT', '会话建书绑定已变化，已建作品保留。', { recoverable: true })
        // Finish the old preparation tool chain at the scope transition; next goal reads canon afresh.
        if (s.current) for (const call of s.current.pending) s.histories[s.current.historyKey].push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ skipped: true, reason: '作品已创建，旧筹备范围的剩余调用不执行。' }) })
        s.current = null; s.queue = []; s.histories = {}; s.bound = bound; s.intent = 'idle'
        s.view.book = { id: result.project.id, title: result.project.title }; s.view.creation = null; s.view.status = 'idle'; s.view.activeMember = null
        s.view.notice = '作品已创建。筹备资料已保留，请核对采用，再让团队继续规划。'
      })
    }
    if (result.status === 'created' && session.book?.id !== result.project.id) throw new AppError('CONFLICT', '原建书回执与当前关联作品不一致。', { recoverable: true })
    return { session, result }
  }
}
