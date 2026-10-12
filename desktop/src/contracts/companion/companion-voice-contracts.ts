/** Read-only mascot conversation. No novel paths, tools, providers or arbitrary channels. */
import type { CompanionNoticeReason } from './companion-presence'
export type CompanionVoiceId = 'ningguang' | 'ganyu' | 'keqing'
export const companionVoices = [{ id: 'ningguang', label: '凝光' }, { id: 'ganyu', label: '甘雨' }, { id: 'keqing', label: '刻晴' }] as const
export type CompanionVoiceOpen = { continueWorkId: 'library-current' | 'work-current' | null }
export type CompanionRuntimeOptions = { textModel: boolean; speechModel: boolean; preload: boolean; voice: CompanionVoiceId }
export type CompanionVoiceRequest = { sessionId: string; requestId: string; action: 'chat' | 'preview' | 'replay' | 'notice' | 'tap'; text: string; voice: CompanionVoiceId; mute: boolean; notice?: CompanionNoticeReason }
export type CompanionVoiceEvent = { sessionId: string; requestId: string; sequence: number } & (
  | { kind: 'text'; text: string }
  | { kind: 'audio'; pcm: Uint8Array; sampleRate: 24000 }
  | { kind: 'phase'; phase: 'thinking' | 'synthesizing' })
export type CompanionVoiceApi = {
  status(): Promise<{ installed: boolean; textInstalled: boolean; speechInstalled: boolean; profile: 'gpt-sovits-v2-fp16' }>
  configure(options: CompanionRuntimeOptions): Promise<boolean>
  warmup(): Promise<boolean>
  suspend(): Promise<boolean>
  prepare(voice: CompanionVoiceId): Promise<boolean>
  open(input: CompanionVoiceOpen): Promise<{ sessionId: string }>
  request(input: CompanionVoiceRequest): Promise<{ text: string }>
  cancel(sessionId: string): Promise<boolean>
  close(sessionId: string): Promise<boolean>
  onEvent(listener: (event: CompanionVoiceEvent) => void): () => void
  onReset?(listener: (sessionId: string) => void): () => void
}
function invalid(): never { throw new Error('COMPANION_VOICE_CONTRACT') }
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) invalid()
  return value as Record<string, unknown>
}
function text(value: unknown, max: number): string { if (typeof value !== 'string' || value.length > max) invalid(); return value }
export function voiceId(value: unknown): CompanionVoiceId { if (value !== 'ningguang' && value !== 'ganyu' && value !== 'keqing') invalid(); return value }
export function decodeCompanionRuntimeOptions(value: unknown): CompanionRuntimeOptions {
  const item = record(value, ['textModel', 'speechModel', 'preload', 'voice'])
  if (typeof item.textModel !== 'boolean' || typeof item.speechModel !== 'boolean' || typeof item.preload !== 'boolean') invalid()
  return { textModel: item.textModel, speechModel: item.speechModel, preload: item.preload, voice: voiceId(item.voice) }
}
export function companionSessionId(value: unknown): string { const id = text(value, 80); if (!/^[\w-]{1,80}$/.test(id)) invalid(); return id }
export function decodeCompanionOpen(value: unknown): CompanionVoiceOpen {
  const item = record(value, ['continueWorkId'])
  if (item.continueWorkId !== null && item.continueWorkId !== 'library-current' && item.continueWorkId !== 'work-current') invalid()
  return { continueWorkId: item.continueWorkId }
}
export function decodeCompanionRequest(value: unknown): CompanionVoiceRequest {
  const item = record(value, ['sessionId', 'requestId', 'action', 'text', 'voice', 'mute', 'notice'])
  if (typeof item.action !== 'string' || !['chat', 'preview', 'replay', 'notice', 'tap'].includes(item.action) || typeof item.mute !== 'boolean') invalid()
  const input = text(item.text, 2000)
  if (item.action === 'chat' && !input.trim()) invalid()
  if (item.action === 'tap' && input !== '') invalid()
  if (item.action === 'notice' ? input !== '' || (item.notice !== 'continue-hover' && item.notice !== 'late-night') : item.notice !== undefined) invalid()
  return { sessionId: companionSessionId(item.sessionId), requestId: companionSessionId(item.requestId), action: item.action as CompanionVoiceRequest['action'], text: input, voice: voiceId(item.voice), mute: item.mute, ...(item.action === 'notice' ? { notice: item.notice as CompanionNoticeReason } : {}) }
}
export function decodeCompanionEvent(value: unknown): CompanionVoiceEvent {
  const item = record(value, ['sessionId', 'requestId', 'sequence', 'kind', 'text', 'pcm', 'sampleRate', 'phase'])
  if (!Number.isSafeInteger(item.sequence) || Number(item.sequence) < 0 || Number(item.sequence) > 1000) invalid()
  const base = { sessionId: companionSessionId(item.sessionId), requestId: companionSessionId(item.requestId), sequence: Number(item.sequence) }
  if (item.kind === 'text') return { ...base, kind: 'text', text: text(item.text, 600) }
  if (item.kind === 'phase' && (item.phase === 'thinking' || item.phase === 'synthesizing')) return { ...base, kind: 'phase', phase: item.phase }
  if (item.kind === 'audio' && item.sampleRate === 24000 && item.pcm instanceof Uint8Array && item.pcm.byteLength > 0 && item.pcm.byteLength <= 1_440_000 && item.pcm.byteLength % 2 === 0) return { ...base, kind: 'audio', pcm: item.pcm, sampleRate: 24000 }
  return invalid()
}
export const companionVoiceResultDecoders = {
  'companion-voice:configure': (value: unknown) => { if (typeof value !== 'boolean') invalid(); return value },
  'companion-voice:warmup': (value: unknown) => { if (typeof value !== 'boolean') invalid(); return value },
  'companion-voice:suspend': (value: unknown) => { if (typeof value !== 'boolean') invalid(); return value },
  'companion-voice:prepare': (value: unknown) => { if (typeof value !== 'boolean') invalid(); return value },
  'companion-voice:status': (value: unknown) => { const item = record(value, ['installed', 'textInstalled', 'speechInstalled', 'profile']); if (typeof item.installed !== 'boolean' || typeof item.textInstalled !== 'boolean' || typeof item.speechInstalled !== 'boolean' || item.profile !== 'gpt-sovits-v2-fp16') invalid(); return value },
  'companion-voice:open': (value: unknown) => { const item = record(value, ['sessionId']); companionSessionId(item.sessionId); return value },
  'companion-voice:request': (value: unknown) => { const item = record(value, ['text']); text(item.text, 600); return value },
  'companion-voice:cancel': (value: unknown) => { if (typeof value !== 'boolean') invalid(); return value },
  'companion-voice:close': (value: unknown) => { if (typeof value !== 'boolean') invalid(); return value },
}
