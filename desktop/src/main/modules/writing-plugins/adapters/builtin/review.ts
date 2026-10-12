import { AppError } from '../../../../core/errors/app-error'
import type { AssistantConversationRequest } from '../../../../../contracts/assistant/assistant-conversation-contracts'
import { objectSchema, textSchema } from '../../domain/schema'
import { builtinTool } from './fields'
import type { WritingDomainPorts } from './domain-ports'
import { freshChapter, manuscriptRequestSchema, writingRequest, type ManuscriptReads } from './manuscript'

export function reviewTools(ports: Pick<WritingDomainPorts, 'documents' | 'review'>, request: AssistantConversationRequest, reads: ManuscriptReads) {
  return [builtinTool('review_manuscript', '对已读取的真实章节执行只读审校；使用原写作 Agent 冻结的资料、章纲、境界和系统模板，不生成或采用正文。', 'read', ['manuscript.read', 'review.read'], manuscriptRequestSchema, objectSchema({ answer: textSchema(200000), contextHash: textSchema(200) }),
    async (args, host) => {
      const chapter = await freshChapter(ports, reads, Number(args.chapterId), String(args.expectedRevision), host)
      const input = writingRequest(request, chapter, String(args.instruction), 'review')
      const prepared = await host.hostCall(() => ports.review.prepare(input))
      if (prepared.workItemId !== host.workItemId || prepared.skill !== 'review') throw new AppError('CONFLICT', '审校依据不属于当前作品。', { recoverable: true })
      const result = await host.hostCall(() => ports.review.run(input, host.signal, prepared))
      await freshChapter(ports, reads, chapter.id, String(args.expectedRevision), host)
      if (result.workItemId !== host.workItemId || result.chapterId !== chapter.id || result.skill.id !== 'review' || result.candidate || result.proposal) throw new AppError('AI_RESPONSE_INVALID', '只读审校返回了不允许的正文修改。', { recoverable: true })
      return { kind: 'completed', trace: '完成只读审校', evidence: [{ kind: 'manuscript', id: String(chapter.id), revision: String(args.expectedRevision) }, { kind: 'context-package', id: prepared.toolGrant.taskTemplate, revision: prepared.contextCompilation.contentHash }], value: { answer: result.answer, contextHash: prepared.contextCompilation.contentHash } }
    }, host => Boolean(host.workItemId))]
}
