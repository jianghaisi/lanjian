import type { AiToolMessage } from '../../../../../contracts/assistant/assistant-conversation-contracts'
import type { AssistantConversationPorts } from '../assistant-conversation-service'
import { AppError } from '../../../../core/errors/app-error'
import type { WritingPluginDispatcher } from '../../../writing-plugins/application/dispatcher'
import { decodeToolCall, runLimits, runConflict } from './state'

/** Shared native envelope validation. Private signatures stay in the owning history. */
export async function modelStep(model: Awaited<ReturnType<AssistantConversationPorts['prepare']>>, messages: AiToolMessage[], dispatcher: WritingPluginDispatcher, signal: AbortSignal, assertFresh: () => Promise<void>, onDelta?: (content: string) => void) {
  await assertFresh(); signal.throwIfAborted()
  const reply = await model.step(messages, dispatcher.definitions(), signal, onDelta)
  signal.throwIfAborted(); await assertFresh()
  if (reply.toolCalls.length > runLimits.pendingCalls) throw new AppError('AI_RESPONSE_INVALID', '模型一次返回了过多工具调用，请缩小目标后重试。', { recoverable: true })
  const calls = reply.toolCalls.map(decodeToolCall), prior = new Set(messages.flatMap(m => m.tool_calls?.map(c => c.id) ?? []))
  if (new Set(calls.map(c => c.id)).size !== calls.length || calls.some(c => prior.has(c.id))) runConflict('模型返回了重复的工具调用标识，任务已停止。')
  return { reply, calls, envelope: { role: 'assistant' as const, content: reply.content || null, ...(calls.length ? { tool_calls: calls } : {}), ...(reply.providerContent ? { providerContent: reply.providerContent } : {}), ...(reply.geminiParts ? { geminiParts: reply.geminiParts } : {}) } }
}
