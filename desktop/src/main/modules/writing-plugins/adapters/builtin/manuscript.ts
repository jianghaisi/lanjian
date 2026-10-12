import { AppError } from '../../../../core/errors/app-error'
import type { Chapter, WritingAgentRequest } from '../../../../../contracts/index'
import type { AssistantConversationRequest } from '../../../../../contracts/assistant/assistant-conversation-contracts'
import { objectSchema, textSchema } from '../../domain/schema'
import type { ToolExecutionContext } from '../../domain/types'
import { builtinTool } from './fields'
import { sourceRef } from './book-context'
import { operationKey, taskOutput } from './planning'
import type { WritingDomainPorts } from './domain-ports'

export const chapterArgument = { type: 'integer' as const, minimum: 1, maximum: Number.MAX_SAFE_INTEGER }
export const manuscriptRequestSchema = objectSchema({ chapterId: chapterArgument, expectedRevision: textSchema(200, 1), instruction: textSchema(12000, 1) })
export const chapterRevision = (chapter: Chapter) => chapter.revision || chapter.bodyVersionId || sourceRef('manuscript', String(chapter.id), { title: chapter.title, content: chapter.content }).revision
export type ManuscriptReads = Map<number, { revision: string; contentHash: string }>

export async function freshChapter(ports: Pick<WritingDomainPorts, 'documents'>, reads: ManuscriptReads, id: number, expected: string, host: ToolExecutionContext): Promise<Chapter> {
  const previous = reads.get(id)
  if (!previous || previous.revision !== expected) throw new AppError('CONFLICT', '请先读取本次要处理的正文及版本。', { recoverable: true })
  const chapter = await host.hostCall(() => ports.documents.chapter(id))
  if (chapter.id !== id || chapterRevision(chapter) !== expected || sourceRef('manuscript', String(id), chapter.content).revision !== previous.contentHash) throw new AppError('CONFLICT', '正文已变化，请重新读取后处理。', { recoverable: true })
  return chapter
}
export function writingRequest(request: AssistantConversationRequest, chapter: Chapter, instruction: string, skill: 'continue' | 'review'): WritingAgentRequest {
  if (!instruction.trim()) throw new AppError('VALIDATION_ERROR', '写作要求不能为空。', { recoverable: true })
  return { chapterId: chapter.id, message: instruction, currentDraft: chapter.content, preferredSkill: skill, ...(request.model ? { model: request.model } : {}), ...(request.connectionId ? { modelConnectionId: request.connectionId } : {}), ...(request.maxTokensOverride === undefined ? {} : { maxTokensOverride: request.maxTokensOverride }) }
}

export function manuscriptTools(ports: Pick<WritingDomainPorts, 'projects' | 'documents' | 'writing'>, request: AssistantConversationRequest, reads: ManuscriptReads) {
  const book = (host: { workItemId: string | null }) => Boolean(host.workItemId)
  return [
    builtinTool('read_manuscript', '读取当前作品指定真实章节的已保存正文与版本。跨页可用，不读取另一部作品，也不代表编辑器未保存草稿。', 'read', ['manuscript.read'], objectSchema({ chapterId: chapterArgument }), objectSchema({ chapterId: chapterArgument, title: textSchema(2000), content: textSchema(300000), revision: textSchema(200) }),
      async (args, host) => {
        const id = Number(args.chapterId), chapter = await host.hostCall(() => ports.documents.chapter(id))
        if (chapter.id !== id) throw new AppError('CONFLICT', '章节身份已变化。', { recoverable: true })
        const revision = chapterRevision(chapter)
        reads.set(id, { revision, contentHash: sourceRef('manuscript', String(id), chapter.content).revision })
        return { kind: 'completed', trace: '读取已保存正文', evidence: [{ kind: 'manuscript', id: String(id), revision }], value: { chapterId: id, title: chapter.title, content: chapter.content, revision } }
      }, book),
    builtinTool('generate_manuscript', '依据已读取的真实章节与原领域章纲门禁生成续写候选。启动完整生成和审校任务，不写入正式正文；编辑器选段改写用 manuscript_assistant。', 'candidate', ['manuscript.read', 'manuscript.candidate'], manuscriptRequestSchema, taskOutput,
      async (args, host) => {
        const chapter = await freshChapter(ports, reads, Number(args.chapterId), String(args.expectedRevision), host)
        const input = { operationId: operationKey({ ...request, operationId: host.invocationId ?? request.operationId }, 'manuscript', args), request: writingRequest(request, chapter, String(args.instruction), 'continue') }
        const task = await host.hostCall(async () => {
          const task = await ports.projects.runBookTask('正文写作', () => ports.writing.start(input), id => ports.writing.status(id))
          if (host.signal.aborted) await ports.writing.cancel(task.id)
          return task
        })
        if (task.workItemId !== host.workItemId || task.chapterId !== chapter.id) throw new AppError('CONFLICT', '写作任务归属不匹配。', { recoverable: true })
        return { kind: 'completed', trace: '启动正文候选任务', evidence: [{ kind: 'manuscript', id: String(chapter.id), revision: String(args.expectedRevision) }], value: { taskId: task.id, status: task.status, notice: '已启动完整写作与审校任务；正文保持不变，请在原章节查看候选。', workspaceId: 'chapters' } }
      }, book)
  ]
}
