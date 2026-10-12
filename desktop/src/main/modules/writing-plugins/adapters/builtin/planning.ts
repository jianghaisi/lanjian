import { createHash } from 'node:crypto'
import { AppError } from '../../../../core/errors/app-error'
import type { AssistantConversationRequest } from '../../../../../contracts/assistant/assistant-conversation-contracts'
import { objectSchema, textSchema } from '../../domain/schema'
import { builtinTool } from './fields'
import type { WritingDomainPorts } from './domain-ports'

export const taskOutput = objectSchema({ taskId: textSchema(200, 1), status: textSchema(100, 1), notice: textSchema(500), workspaceId: textSchema(100) })
export function operationKey(request: AssistantConversationRequest, action: string, args: unknown): string {
  // Existing domain task decoders require UUIDs. Keep retries idempotent without
  // letting a model supply or reuse another task's operation identity.
  const hash = createHash('sha1').update('lanjian-writing-plugin:').update(JSON.stringify([request.workItemId, request.operationId, action, args])).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}
const conflict = (): never => { throw new AppError('CONFLICT', '规划依据未读取或已经变化，请重新读取后生成候选。', { recoverable: true }) }

export function planningTools(ports: Pick<WritingDomainPorts, 'projects' | 'planning' | 'expansion'> & { workspace: Pick<WritingDomainPorts['workspace'], 'planningOutline'> }, request: AssistantConversationRequest) {
  const reads = new Map<string, string>()
  const book = (host: { workItemId: string | null }) => Boolean(host.workItemId)
  return [
    builtinTool('generate_planning', '根据本书已保存资料生成创作蓝图、总纲与卷纲候选；启动真实自动谋篇任务，结果在创作筹备查看。无需章号，不确认或采用。', 'candidate', ['planning.candidate'], objectSchema({}), taskOutput,
      async (_args, host) => {
        const task = await host.hostCall(async () => {
          const task = await ports.projects.runBookTask('自动谋篇', () => ports.planning.start(host.workItemId!), id => ports.planning.status(id))
          if (host.signal.aborted) ports.planning.cancel(task.id)
          return task
        })
        return { kind: 'completed', trace: '启动自动谋篇候选', evidence: [], value: { taskId: task.id, status: task.status, notice: '仅已启动候选任务；请在创作筹备核对结果，未保存为正式大纲。', workspaceId: 'preparation' } }
      }, book),
    builtinTool('read_planning_outline', '读取当前作品真实父级大纲及版本，作为逐层拆解依据。key 为 total、volume-N 或 stage-N。', 'read', ['planning.read'], objectSchema({ key: textSchema(100, 1) }), objectSchema({ key: textSchema(100), kind: textSchema(100), content: textSchema(200000), revision: textSchema(200) }),
      async (args, host) => {
        const key = String(args.key)
        if (!/^(total|volume-[1-9]\d*|stage-[1-9]\d*)$/.test(key)) throw new AppError('VALIDATION_ERROR', '大纲标识无效。', { recoverable: true })
        const source = await host.hostCall(() => ports.workspace.planningOutline(key))
        if (!source || source.key !== key) throw new AppError('NOT_FOUND', '当前作品没有这个正式父级大纲。', { recoverable: true })
        reads.set(key, source.revision)
        return { kind: 'completed', trace: '读取父级大纲', evidence: [{ kind: 'planning-outline', id: key, revision: source.revision }], value: { key, kind: source.kind, content: source.content, revision: source.revision } }
      }, book),
    builtinTool('expand_outline', '把已读取的父级大纲拆为下一层候选，必须引用 read_planning_outline 返回的版本。不会创建正式章节或自动采用。', 'candidate', ['planning.read', 'planning.candidate'], objectSchema({ parentKey: textSchema(100, 1), expectedRevision: textSchema(64, 64), count: { type: 'integer', minimum: 1, maximum: 12 }, instruction: textSchema(2000) }), taskOutput,
      async (args, host) => {
        if (reads.get(String(args.parentKey)) !== args.expectedRevision) conflict()
        const input = { operationId: operationKey({ ...request, operationId: host.invocationId ?? request.operationId }, 'expand', args), parentKey: String(args.parentKey), expectedRevision: String(args.expectedRevision), count: Number(args.count), instruction: String(args.instruction) }
        const task = await host.hostCall(async () => {
          const task = await ports.projects.runBookTask('逐层规划', () => ports.expansion.start(input), id => ports.expansion.status(id))
          if (host.signal.aborted) await ports.expansion.cancel(task.id)
          return task
        })
        return { kind: 'completed', trace: '启动逐层规划候选', evidence: [{ kind: 'planning-outline', id: input.parentKey, revision: input.expectedRevision }], value: { taskId: task.id, status: task.status, notice: '已交给逐层规划任务；候选仍须作者查看与采用。', workspaceId: 'total-outline' } }
      }, book)
  ]
}
