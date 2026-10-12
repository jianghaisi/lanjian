import { computed } from 'vue'
import type { CompanionVoicePreferences } from '../services/companion-voice-preferences'
import { useCompanionSettings } from './use-companion-settings'
export function useCompanionVoicePreferences() {
  const shared = useCompanionSettings()
  return { preferences: computed(() => shared.settings.value.voice), error: shared.error, ready: shared.ready, update: (patch: Partial<CompanionVoicePreferences>) => shared.update({ voice: patch }) }
}
