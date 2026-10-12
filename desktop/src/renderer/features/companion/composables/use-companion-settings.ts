import { readonly, ref } from 'vue'
import { defaultCompanionSettings, normalizeCompanionVoicePreferences, type CompanionSettings, type CompanionSettingsPatch } from '../../../../contracts/companion/companion-settings'
import { companionVoicePreferenceKey } from '../services/companion-voice-preferences'

const settings = ref(defaultCompanionSettings()), error = ref('')
let pending: Promise<void> | undefined
function receive(value: CompanionSettings) { if (value.revision >= settings.value.revision) settings.value = value }
export function useCompanionSettings() {
  const api = window.companionSettings
  async function load() {
    try {
      if (api) {
        receive(await api.get())
        if (settings.value.revision === 0 && window.novelDesktop) receive(await api.importVoice(normalizeCompanionVoicePreferences(JSON.parse(localStorage.getItem(companionVoicePreferenceKey) || 'null'))))
      } else settings.value = { ...settings.value, voice: normalizeCompanionVoicePreferences(JSON.parse(localStorage.getItem(companionVoicePreferenceKey) || 'null')) }
      error.value = ''
    } catch { error.value = '伙伴偏好未能读取，原记录已保留。请重试或备份恢复。' }
  }
  if (!pending) { api?.onChange(receive); pending = load() }
  async function update(patch: CompanionSettingsPatch) {
    await pending
    try {
      if (api) receive(await api.update(patch))
      else {
        const next = { ...settings.value, ...patch, voice: { ...settings.value.voice, ...patch.voice }, revision: settings.value.revision + 1 }
        localStorage.setItem(companionVoicePreferenceKey, JSON.stringify(next.voice)); receive(next)
      }
      error.value = ''
    } catch { error.value = '伙伴设置未能保存，请重试。' }
  }
  async function recover() {
    try { if (api) { receive(await api.recover()); error.value = '' } }
    catch { error.value = '原设置未能完成备份，恢复已取消。' }
  }
  return { settings: readonly(settings), error: readonly(error), ready: pending, update, recover, retry: load }
}
