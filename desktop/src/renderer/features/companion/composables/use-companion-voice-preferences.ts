import { readonly, ref } from 'vue'
import { companionVoicePreferenceKey, defaultCompanionVoicePreferences, normalizeCompanionVoicePreferences, type CompanionVoicePreferences } from '../services/companion-voice-preferences'

const preferences = ref({ ...defaultCompanionVoicePreferences })
const error = ref('')
let loaded = false
export function useCompanionVoicePreferences() {
  if (!loaded) {
    loaded = true
    try { preferences.value = normalizeCompanionVoicePreferences(JSON.parse(localStorage.getItem(companionVoicePreferenceKey) || 'null')) }
    catch { error.value = '声音偏好未能读取，暂用默认值。' }
  }
  function update(patch: Partial<CompanionVoicePreferences>) {
    const next = normalizeCompanionVoicePreferences({ ...preferences.value, ...patch })
    try {
      localStorage.setItem(companionVoicePreferenceKey, JSON.stringify(next))
      preferences.value = next; error.value = ''
    } catch { error.value = '声音设置未保存，请重试。' }
  }
  return { preferences: readonly(preferences), error: readonly(error), update }
}
