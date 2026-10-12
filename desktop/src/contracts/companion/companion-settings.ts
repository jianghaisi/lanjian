import { voiceId, type CompanionVoiceId } from './companion-voice-contracts'

export type CompanionVoicePreferences = { voice: CompanionVoiceId; volume: number; mute: boolean; proactive: boolean; subtitles: boolean; textModel: boolean; preload: boolean }
export const defaultCompanionVoicePreferences: CompanionVoicePreferences = { voice: 'ningguang', volume: .65, mute: false, proactive: true, subtitles: true, textModel: false, preload: true }
export function normalizeCompanionVoicePreferences(value: unknown): CompanionVoicePreferences {
  const item = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    voice: item.voice === 'ganyu' || item.voice === 'keqing' ? item.voice : 'ningguang',
    volume: typeof item.volume === 'number' && Number.isFinite(item.volume) ? Math.max(0, Math.min(1, item.volume)) : .65,
    mute: item.mute === true, proactive: item.proactive !== false, subtitles: item.subtitles !== false,
    textModel: typeof item.textModel === 'boolean' ? item.textModel : ['ningguang', 'ganyu', 'keqing', 'zf_001', 'zf_002'].includes(String(item.voice)),
    preload: item.preload !== false,
  }
}
export type CompanionMicrophoneSettings = { enabled: boolean; deviceId: string; mode: 'hold' | 'toggle' }
export const defaultMicrophoneSettings: CompanionMicrophoneSettings = { enabled: false, deviceId: '', mode: 'toggle' }
export type CompanionSettings = { version: 1; revision: number; voice: CompanionVoicePreferences; reducedMotion: boolean; microphone: CompanionMicrophoneSettings; careEnabled: boolean; roam: boolean; followCursor: boolean }
export type CompanionSettingsPatch = { voice?: Partial<CompanionVoicePreferences>; reducedMotion?: boolean; microphone?: CompanionMicrophoneSettings; careEnabled?: boolean; roam?: boolean; followCursor?: boolean }
export type CompanionSettingsApi = {
  get(): Promise<CompanionSettings>
  importVoice(voice: CompanionVoicePreferences): Promise<CompanionSettings>
  update(patch: CompanionSettingsPatch): Promise<CompanionSettings>
  recover(): Promise<CompanionSettings>
  onChange(listener: (settings: CompanionSettings) => void): () => void
}
export function companionRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error('COMPANION_SETTINGS_INVALID')
  return value as Record<string, unknown>
}
const voiceKeys = ['voice', 'volume', 'mute', 'proactive', 'subtitles', 'textModel', 'preload'] as const
export function decodeVoicePreferences(value: unknown, partial = false): Partial<CompanionVoicePreferences> {
  const input = companionRecord(value, voiceKeys)
  if (!partial && voiceKeys.some(key => !Object.hasOwn(input, key))) throw new Error('COMPANION_SETTINGS_INVALID')
  for (const [key, item] of Object.entries(input)) {
    if (key === 'voice') voiceId(item)
    else if (key === 'volume') { if (typeof item !== 'number' || !Number.isFinite(item) || item < 0 || item > 1) throw new Error('COMPANION_SETTINGS_INVALID') }
    else if (typeof item !== 'boolean') throw new Error('COMPANION_SETTINGS_INVALID')
  }
  return input as Partial<CompanionVoicePreferences>
}
export function decodeCompanionSettingsPatch(value: unknown): CompanionSettingsPatch {
  const input = companionRecord(value, ['voice', 'reducedMotion', 'microphone','careEnabled','roam','followCursor'])
  for (const key of ['careEnabled','roam','followCursor']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error('COMPANION_SETTINGS_INVALID')
  if (input.reducedMotion !== undefined && typeof input.reducedMotion !== 'boolean') throw new Error('COMPANION_SETTINGS_INVALID')
  return { ...input, ...(input.voice === undefined ? {} : { voice: decodeVoicePreferences(input.voice, true) }), ...(input.microphone === undefined ? {} : { microphone: decodeMicrophone(input.microphone) }) } as CompanionSettingsPatch
}
function decodeMicrophone(value: unknown): CompanionMicrophoneSettings {
  const input = companionRecord(value, ['enabled', 'deviceId', 'mode'])
  if (typeof input.enabled !== 'boolean' || typeof input.deviceId !== 'string' || input.deviceId.length > 256 || !['hold', 'toggle'].includes(String(input.mode))) throw new Error('COMPANION_SETTINGS_INVALID')
  return input as CompanionMicrophoneSettings
}
export function decodeCompanionSettings(value: unknown): CompanionSettings {
  const input = companionRecord(value, ['version', 'revision', 'voice', 'reducedMotion', 'microphone','careEnabled','roam','followCursor'])
  for (const key of ['careEnabled','roam','followCursor']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error('COMPANION_SETTINGS_INVALID')
  if (input.version !== 1 || !Number.isSafeInteger(input.revision) || Number(input.revision) < 0 || typeof input.reducedMotion !== 'boolean') throw new Error('COMPANION_SETTINGS_INVALID')
  return { version: 1, revision: Number(input.revision), voice: decodeVoicePreferences(input.voice) as CompanionVoicePreferences, reducedMotion: input.reducedMotion, microphone: input.microphone === undefined ? { ...defaultMicrophoneSettings } : decodeMicrophone(input.microphone), careEnabled: input.careEnabled !== false, roam: input.roam === true, followCursor: input.followCursor === true }
}
export function defaultCompanionSettings(): CompanionSettings { return { version: 1, revision: 0, voice: { ...defaultCompanionVoicePreferences }, reducedMotion: false, microphone: { ...defaultMicrophoneSettings }, careEnabled: true, roam: false, followCursor: false } }
