import { readonly, ref } from 'vue'
import { defaultDialogueAppearance, normalizeDialogueAppearance, type CompanionDialogueAppearance } from '../services/companion-dialogue-appearance'
const KEY = 'lanjian-companion-dialogue-v1'
const preferences = ref({ ...defaultDialogueAppearance })
const error = ref('')
let loaded = false
export function useCompanionDialogueAppearance() {
  if (!loaded) {
    loaded = true
    try { preferences.value = normalizeDialogueAppearance(JSON.parse(localStorage.getItem(KEY) || 'null')) }
    catch { error.value = '对话框偏好未能读取，暂用默认外观。' }
  }
  function update(patch: Partial<CompanionDialogueAppearance>) {
    const next = normalizeDialogueAppearance({ ...preferences.value, ...patch })
    try { localStorage.setItem(KEY, JSON.stringify(next)); preferences.value = next; error.value = '' }
    catch { error.value = '对话框设置未保存，请重试。' }
  }
  return { preferences: readonly(preferences), error, update, reset: () => update(defaultDialogueAppearance) }
}
