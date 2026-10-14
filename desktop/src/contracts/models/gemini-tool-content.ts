import { AppError } from '../core/app-error'
import type { AiToolMessage } from '../assistant/assistant-conversation-contracts'

/** Process-owned replay data; never accepted in renderer requests or run views. */
export type GeminiToolPart = {
  text?: string; thought?: boolean; thoughtSignature?: string
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string }
}
export const geminiToolLimits = { text: 50000, args: 20000, signature: 65536, parts: 128, bytes: 200000, calls: 8 } as const
export const geminiToolInvalid = (): never => { throw new AppError('AI_RESPONSE_INVALID', 'Gemini 回复中断、格式或工具历史无效，未执行不完整的工具调用。可重试；反复出现时请检查接口工具兼容性。若已更换型号或参数，请保留记录并开始新对话。', { recoverable: true }) }
export const geminiRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const string = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max
const identifier = (v: unknown): v is string => string(v, 200) && !!v && !/[\u0000-\u001f\u007f]/.test(v)

export function decodeGeminiParts(value: unknown): GeminiToolPart[] {
  if (!Array.isArray(value) || value.length > geminiToolLimits.parts || new TextEncoder().encode(JSON.stringify(value)).length > geminiToolLimits.bytes) return geminiToolInvalid()
  let text = 0, calls = 0
  const ids = new Set<string>()
  const result = value.map((v): GeminiToolPart => {
    if (!geminiRecord(v) || Object.keys(v).some(k => !['text', 'thought', 'thoughtSignature', 'functionCall'].includes(k))) return geminiToolInvalid()
    if (v.thought !== undefined && typeof v.thought !== 'boolean' || v.text !== undefined && !string(v.text, geminiToolLimits.text)) return geminiToolInvalid()
    if (v.thoughtSignature !== undefined && (!string(v.thoughtSignature, geminiToolLimits.signature) || !v.thoughtSignature)) return geminiToolInvalid()
    if (v.text === undefined && v.functionCall === undefined && v.thoughtSignature === undefined) return geminiToolInvalid()
    text += typeof v.text === 'string' ? v.text.length : 0
    if (text > geminiToolLimits.text) return geminiToolInvalid()
    if (v.functionCall !== undefined) {
      const f = v.functionCall
      if (v.text !== undefined || v.thought === true || !geminiRecord(f) || Object.keys(f).some(k => !['id', 'name', 'args'].includes(k))) return geminiToolInvalid()
      if (!identifier(f.name) || !/^[a-zA-Z_][a-zA-Z0-9_.:-]*$/.test(f.name) || ++calls > geminiToolLimits.calls) return geminiToolInvalid()
      if (f.args !== undefined && (!geminiRecord(f.args) || JSON.stringify(f.args).length > geminiToolLimits.args)) return geminiToolInvalid()
      if (f.id !== undefined) {
        if (!identifier(f.id) || ids.has(f.id)) return geminiToolInvalid()
        ids.add(f.id)
      }
    }
    return structuredClone(v) as GeminiToolPart
  })
  return result
}
export const geminiVisibleText = (parts: GeminiToolPart[]) => parts.filter(p => p.thought !== true).map(p => p.text ?? '').join('')

/** Prevent replay metadata from contradicting the calls the dispatcher executed. */
export function validatedGeminiMessage(message: AiToolMessage): GeminiToolPart[] {
  const parts = decodeGeminiParts(message.geminiParts), calls = parts.flatMap(p => p.functionCall ? [p.functionCall] : [])
  if (message.role !== 'assistant' || geminiVisibleText(parts) !== (message.content ?? '') || calls.length !== (message.tool_calls?.length ?? 0)) return geminiToolInvalid()
  calls.forEach((call, index) => {
    const declared = message.tool_calls![index]
    if (call.name !== declared.function.name || JSON.stringify(call.args ?? {}) !== declared.function.arguments) geminiToolInvalid()
  })
  return parts
}
