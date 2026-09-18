import type { CompanionVoiceId } from '../../../../contracts/companion/companion-voice-contracts'

export type CompanionVoicePreferences = { voice: CompanionVoiceId; volume: number; mute: boolean; proactive: boolean; subtitles: boolean; textModel: boolean; preload: boolean }
export const companionVoicePreferenceKey = 'lanjian-companion-voice-v1'
export const defaultCompanionVoicePreferences: CompanionVoicePreferences = { voice: 'ningguang', volume: .65, mute: false, proactive: true, subtitles: true, textModel: false, preload: true }
export function normalizeCompanionVoicePreferences(value: unknown): CompanionVoicePreferences {
  const item = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    voice: item.voice === 'ganyu' || item.voice === 'keqing' ? item.voice : 'ningguang',
    volume: typeof item.volume === 'number' && Number.isFinite(item.volume) ? Math.max(0, Math.min(1, item.volume)) : .65,
    mute: item.mute === true,
    proactive: item.proactive !== false,
    subtitles: item.subtitles !== false,
    // Existing saved users keep intelligent chat; fresh installs start with presets.
    textModel: typeof item.textModel === 'boolean' ? item.textModel : ['ningguang', 'ganyu', 'keqing', 'zf_001', 'zf_002'].includes(String(item.voice)),
    preload: item.preload !== false,
  }
}
