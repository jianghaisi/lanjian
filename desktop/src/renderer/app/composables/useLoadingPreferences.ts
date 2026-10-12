import { readonly, ref } from 'vue'

export type LoadingTheme = 'standard' | 'impact'
export type BootStyle = 'cinematic' | 'impact' | 'brief'
export type BootPalette = 'system' | 'light' | 'dark'
export interface LoadingPreferences { theme: LoadingTheme; bootStyle: BootStyle; bootPalette: BootPalette }
export const LOADING_PREFERENCES_KEY = 'lanjian-loading-v1'
const defaults: LoadingPreferences = { theme: 'impact', bootStyle: 'cinematic', bootPalette: 'system' }
export function parseLoadingPreferences(raw: string | null): LoadingPreferences {
  if (raw === null) return { ...defaults }
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || !('theme' in value)
    || (value.theme !== 'standard' && value.theme !== 'impact')) throw new Error('加载外观设置无法读取，原设置已保留。')
  const bootStyle = 'bootStyle' in value ? value.bootStyle : defaults.bootStyle
  const bootPalette = 'bootPalette' in value ? value.bootPalette : defaults.bootPalette
  if (bootStyle !== 'cinematic' && bootStyle !== 'impact' && bootStyle !== 'brief') throw new Error('开场样式无法读取。')
  if (bootPalette !== 'system' && bootPalette !== 'light' && bootPalette !== 'dark') throw new Error('档案材质无法读取。')
  return { theme: value.theme, bootStyle, bootPalette }
}
/** Visual preferences only; never contains book identity, credentials or manuscripts. */
export function createLoadingPreferenceStore(storage: Pick<Storage, 'getItem' | 'setItem'> | null) {
  const preferences = ref<LoadingPreferences>({ ...defaults })
  const error = ref('')
  let invalid = false
  try { preferences.value = parseLoadingPreferences(storage?.getItem(LOADING_PREFERENCES_KEY) ?? null) }
  catch { invalid = true; error.value = '加载外观设置无法读取，原设置已保留。可以明确恢复默认设置。' }
  function update(patch: Partial<LoadingPreferences>): boolean {
    if (invalid) return false
    try {
      const next = parseLoadingPreferences(JSON.stringify({ ...preferences.value, ...patch }))
      if (!storage) throw new Error('storage-unavailable')
      storage.setItem(LOADING_PREFERENCES_KEY, JSON.stringify(next))
      preferences.value = next; error.value = ''; return true
    } catch { error.value = '加载外观设置未能保存，请重试。'; return false }
  }
  function reset(): boolean {
    try {
      if (!storage) throw new Error('storage-unavailable')
      const raw = storage.getItem(LOADING_PREFERENCES_KEY)
      if (raw !== null) storage.setItem(`${LOADING_PREFERENCES_KEY}-backup-${Date.now()}`, raw)
      storage.setItem(LOADING_PREFERENCES_KEY, JSON.stringify(defaults))
      preferences.value = { ...defaults }; error.value = ''; invalid = false; return true
    } catch { error.value = '无法备份并恢复设置，原记录未主动删除。'; return false }
  }
  return { preferences: readonly(preferences), error: readonly(error), update, reset }
}
let shared: ReturnType<typeof createLoadingPreferenceStore> | undefined
export function useLoadingPreferences() {
  if (!shared) {
    let storage: Storage | null = null
    try { if (typeof window !== 'undefined') storage = window.localStorage } catch { /* Visual defaults remain usable. */ }
    shared = createLoadingPreferenceStore(storage)

  }
  return shared
}
