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
    builtinTool('read_planning_outline', '读取本书已保存且非空的总纲、卷纲或阶段纲及版本，作为拆解依据。key 为 total、volume-N 或 stage-N；卷号和阶段号必须来自本书目录，不要猜测。没有总纲时先引导到谋篇→全书总纲，AI 候选须作者在创作筹备逐项采用后才成为正式大纲。', 'read', ['planning.read'], objectSchema({ key: textSchema(100, 1) }), objectSchema({ key: textSchema(100), kind: textSchema(100), content: textSchema(200000), revision: textSchema(200) }),
      async (args, host) => {
        const key = String(args.key)
        if (!/^(total|volume-[1-9]\d*|stage-[1-9]\d*)$/.test(key)) throw new AppError('VALIDATION_ERROR', '大纲标识无效。', { recoverable: true })
        const source = await host.hostCall(() => ports.workspace.planningOutline(key))
        if (!source || source.key !== key || !source.content.trim()) {
          reads.delete(key)
          const label = key === 'total' ? '全书总纲' : key.startsWith('volume-') ? `第 ${key.slice(7)} 卷卷纲` : `第 ${key.slice(6)} 个阶段纲`
          const next = key === 'total'
            ? '请打开“谋篇 → 全书总纲”，手写并保存，或点击“AI 生成总纲”。已有 AI 候选请到“创作筹备”，依次核对人物、世界、力量和特殊优势，再“预览影响并采用总纲”。'
            : key.startsWith('volume-')
              ? '请到“谋篇”核对本书卷目录，打开对应卷纲并保存内容；需要生成时，从“全书总纲 → 拆分卷纲”生成候选并预览采用，或继续采用“创作筹备”中的卷纲候选。'
              : '请到“谋篇”核对本书阶段目录，打开对应阶段纲并保存内容；尚未建立阶段时，从所属卷纲的“细化本卷大纲”生成阶段候选并预览采用。'
          throw new AppError('NOT_FOUND', `${label}${source?.key === key ? '尚未保存非空内容' : '尚未建立'}。${next}完成后再继续原请求；直接重试不会补齐大纲。保存或采用不等于作者确认。`, { recoverable: true })
        }
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
