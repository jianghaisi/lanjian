import type { AiToolMessage } from '../../../../contracts/assistant/assistant-conversation-contracts'
import { providerInvalid, validatedProviderMessage } from '../../../../contracts/models/provider-tool-content'
import type { CompiledRemoteConfig } from '../domain/generation-config'
import { providerScope } from './provider-transport'

export function chatToolHistory(c: CompiledRemoteConfig, messages: AiToolMessage[]) {
  return messages.map(m => {
    const result: Record<string, unknown> = { role: m.role, content: m.content, ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}), ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}) }
    if (m.geminiParts) return providerInvalid('历史来自其他协议，请重新开始对话。')
    if (m.providerContent) {
      const e = validatedProviderMessage(m)
      if (e.protocol !== 'openai-compatible' || e.scope !== providerScope(c) || !c.generation.capabilities.rule?.preserveReasoning) return providerInvalid('型号或参数已变化，请重新开始对话，不能回传旧思考内容。')
      result.reasoning_content = e.reasoningContent
    }
    return result
  })
}
