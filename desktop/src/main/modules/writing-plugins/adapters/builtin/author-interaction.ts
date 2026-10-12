import { decodeAuthorQuestionRequest } from '../../../../../contracts/assistant/author-interaction-contracts'
import { objectSchema, textSchema } from '../../domain/schema'
import { builtinTool } from './fields'
import type { JsonObject } from '../../domain/types'

export const authorInteractionCapabilities = ['author.ask', 'author.review'] as const
export function authorInteractionTools() {
  return [builtinTool('ask_author', '向作者提出最多三个相关问题，支持 single 单选、multiple 多选、text 自由文本。推荐项仅提示，不会代替作者作答。等待真实回答后继续同一目标；偏好答案不是正式内容采用许可。', 'interaction', ['author.ask'],
    objectSchema({ questions: { type: 'array', minItems: 1, maxItems: 3, items: objectSchema({ id: textSchema(100, 1), prompt: textSchema(1000, 1), detail: textSchema(2000), mode: { type: 'string', enum: ['single', 'multiple', 'text'], maxLength: 10 }, required: { type: 'boolean' }, options: { type: 'array', maxItems: 8, items: objectSchema({ id: textSchema(100, 1), label: textSchema(120, 1), description: textSchema(500), recommended: { type: 'boolean' } }, ['id', 'label']) } }, ['id', 'prompt', 'mode', 'required', 'options']) } }), objectSchema({}),
    async input => ({ kind: 'waiting-input', question: decodeAuthorQuestionRequest(input) as unknown as JsonObject }), host => Boolean(host.workItemId)),
    builtinTool('request_candidate_review', '请作者在原来的比较与采用界面处理已存在的候选。candidateRef 必须引用本作品的真实 field-task 或 writing-task；结果由主进程核对，只能等待真实采用/拒绝，普通选择不能批准正文。', 'candidate', ['author.review'], objectSchema({ candidateRef: objectSchema({ kind: { type: 'string', enum: ['field-task', 'writing-task'], maxLength: 20 }, id: textSchema(200, 1) }) }), objectSchema({}),
      async input => ({ kind: 'waiting-adoption', candidateRef: input.candidateRef as { kind: string; id: string }, evidence: [] }), host => Boolean(host.workItemId))]
}
