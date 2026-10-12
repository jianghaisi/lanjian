import { integer, record } from '@lanjian/hosted-contracts'

export type ModelUsage = { input: number; output: number; cacheRead?: number; cacheWrite?: number; cacheWrite1h?: number; audioInput?: number }
const count = (value: unknown) => value === undefined ? 0 : integer(value, 0, 100_000_000)
function detailed(input: number, output: number, cacheRead = 0, cacheWrite = 0, cacheWrite1h = 0): ModelUsage | null {
  if (cacheRead + cacheWrite + cacheWrite1h > input) return null
  return { input, output, ...(cacheRead ? { cacheRead } : {}), ...(cacheWrite ? { cacheWrite } : {}), ...(cacheWrite1h ? { cacheWrite1h } : {}) }
}
function claudeUsage(raw: unknown): ModelUsage | null {
  const u = record(raw), plain = integer(u.input_tokens, 0, 100_000_000), output = integer(u.output_tokens, 0, 100_000_000)
  const read = count(u.cache_read_input_tokens), write = count(u.cache_creation_input_tokens)
  const split = u.cache_creation === undefined ? {} : record(u.cache_creation)
  const hour = count(split.ephemeral_1h_input_tokens), short = count(split.ephemeral_5m_input_tokens)
  if ((u.cache_creation !== undefined && short + hour !== write) || count(record(u.server_tool_use ?? {}).web_search_requests)) return null
  return detailed(integer(plain + read + write, 0, 100_000_000), output, read, write - hour, hour)
}
function openAiUsage(raw: unknown, nested = false): ModelUsage | null {
  const u = record(raw)
  // New API explicitly preserves the upstream's billing semantics. Estimated
  // counts and legacy ambiguous cache conversions are never an actual-cost bill.
  if (u.billing_usage !== undefined && !nested) {
    const billing = record(u.billing_usage)
    if (billing.estimated !== undefined && billing.estimated !== false) return null
    if (billing.semantic === 'anthropic') return claudeUsage(billing.claude_usage)
    if (billing.semantic === 'openai') return openAiUsage(billing.openai_usage, true)
    if (billing.semantic === 'gemini') return geminiUsage(billing.gemini_usage_metadata)
    return null
  }
  const input = integer(u.prompt_tokens, 0, 100_000_000), output = integer(u.completion_tokens, 0, 100_000_000)
  if (u.total_tokens !== undefined && integer(u.total_tokens, 0, 200_000_000) !== input + output) return null
  const p = record(u.prompt_tokens_details ?? {}), c = record(u.completion_tokens_details ?? {})
  if (count(p.audio_tokens) || count(p.image_tokens) || count(c.audio_tokens) || count(c.image_tokens) || count(c.reasoning_tokens) > output) return null
  const read = Math.max(count(p.cached_tokens), count(u.prompt_cache_hit_tokens))
  const aggregate = Math.max(count(p.cached_creation_tokens), count(p.cache_write_tokens))
  const short = count(u.claude_cache_creation_5_m_tokens), hour = count(u.claude_cache_creation_1_h_tokens)
  if (short + hour > 0 && aggregate > 0 && short + hour !== aggregate) return null
  const write = Math.max(aggregate, short + hour)
  if (u.usage_semantic === 'anthropic') return detailed(integer(input + read + write, 0, 100_000_000), output, read, write - hour, hour)
  if (u.usage_semantic !== undefined && u.usage_semantic !== '' && u.usage_semantic !== 'openai' && u.usage_semantic !== 'gemini') return null
  if ((short || hour) && !u.usage_semantic) return null
  return detailed(input, output, read, write - hour, hour)
}
function geminiUsage(raw: unknown): ModelUsage | null {
  const u = record(raw), input = integer(u.promptTokenCount, 0, 100_000_000)
  const candidates = integer(u.candidatesTokenCount, 0, 100_000_000), thoughts = count(u.thoughtsTokenCount)
  const output = integer(candidates + thoughts, 0, 100_000_000)
  if (u.totalTokenCount !== undefined && integer(u.totalTokenCount, 0, 200_000_000) !== input + output) return null
  if (count(u.toolUsePromptTokenCount)) return null
  for (const key of ['promptTokensDetails', 'cacheTokensDetails', 'candidatesTokensDetails']) if (u[key] !== undefined) {
    if (!Array.isArray(u[key])) return null
    for (const raw of u[key] as unknown[]) { const item = record(raw); if (item.modality !== 'TEXT' && count(item.tokenCount)) return null }
  }
  return detailed(input, output, count(u.cachedContentTokenCount))
}
/** Provider totals retain their exact cache semantics; unsupported dimensions freeze billing. */
export function decodeUsage(payload: unknown, protocol: 'openai-compatible' | 'gemini-native'): ModelUsage | null {
  try {
    const p = record(payload)
    if (protocol === 'openai-compatible') {
      if (!p.usage) return null
      return openAiUsage(p.usage)
    }
    if (!p.usageMetadata) return null
    return geminiUsage(p.usageMetadata)
  } catch { return null }
}

export class UsageStream {
  usage: ModelUsage | null = null
  done = false
  private buffer = ''
  private decoder = new TextDecoder('utf-8', { fatal: true })
  constructor(readonly protocol: 'openai-compatible' | 'gemini-native') {}
  push(bytes: Uint8Array, end = false) {
    this.buffer += this.decoder.decode(bytes, { stream: !end })
    if (this.buffer.length > 2 * 1024 * 1024) throw new Error('Invalid model stream.')
    const events = this.buffer.split(/\r?\n\r?\n/u)
    this.buffer = events.pop() ?? ''
    if (end && this.buffer.trim()) { events.push(this.buffer); this.buffer = '' }
    for (const event of events) {
      const data = event.split(/\r?\n/u).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim()
      if (!data) continue
      if (data === '[DONE]') { this.done = true; continue }
      const payload: unknown = JSON.parse(data), usage = decodeUsage(payload, this.protocol)
      if (usage) this.usage = usage
      else if (payload && typeof payload === 'object' && ('usage' in payload || 'usageMetadata' in payload)) this.usage = null
    }
  }
}
