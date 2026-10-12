import { readonly, ref } from 'vue'

export const SOUND_PREFERENCES_KEY = 'lanjian-sound-v1'
export interface SoundPreferences {
  enabled: boolean
  volume: number
  boot: boolean
  loading: boolean
  interaction: boolean
  hover: boolean
  waiting: boolean
}
export const soundDefaults: Readonly<SoundPreferences> = Object.freeze({
  enabled: true, volume: .6, boot: true, loading: true, interaction: true, hover: false, waiting: false,
})
export function parseSoundPreferences(raw: string | null): SoundPreferences {
  if (raw === null) return { ...soundDefaults }
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-sound-preferences')
  const record = value as Record<string, unknown>
  for (const key of ['enabled', 'boot', 'loading', 'interaction', 'hover', 'waiting']) {
    if (typeof record[key] !== 'boolean') throw new Error('invalid-sound-preferences')
  }
  if (typeof record.volume !== 'number' || !Number.isFinite(record.volume) || record.volume < 0 || record.volume > 1) throw new Error('invalid-sound-volume')
  return Object.fromEntries(Object.keys(soundDefaults).map(key => [key, record[key]])) as unknown as SoundPreferences
}
export function createSoundPreferenceStore(storage: Pick<Storage, 'getItem' | 'setItem'> | null) {
  const preferences = ref<SoundPreferences>({ ...soundDefaults })
  const error = ref('')
  let invalid = false
  try { preferences.value = parseSoundPreferences(storage?.getItem(SOUND_PREFERENCES_KEY) ?? null) }
  catch { invalid = true; preferences.value.enabled = false; error.value = '声音设置无法读取，原设置已保留，本次保持静音。' }
  function update(patch: Partial<SoundPreferences>): boolean {
    // Even failed persistence must never prevent an immediate session mute.
    if (patch.enabled === false) preferences.value = { ...preferences.value, enabled: false }
    if (patch.volume === 0) preferences.value = { ...preferences.value, volume: 0 }
    if (invalid) return false
    try {
      const next = parseSoundPreferences(JSON.stringify({ ...preferences.value, ...patch }))
      if (!storage) throw new Error('storage-unavailable')
      storage.setItem(SOUND_PREFERENCES_KEY, JSON.stringify(next))
      preferences.value = next; error.value = ''; return true
    } catch { error.value = '声音设置未能保存；本次静音仍然生效，请重试。'; return false }
  }
  function reset(): boolean {
    try {
      if (!storage) throw new Error('storage-unavailable')
      const raw = storage.getItem(SOUND_PREFERENCES_KEY)
      if (raw !== null) storage.setItem(`${SOUND_PREFERENCES_KEY}-backup-${Date.now()}`, raw)
      storage.setItem(SOUND_PREFERENCES_KEY, JSON.stringify(soundDefaults))
      invalid = false; preferences.value = { ...soundDefaults }; error.value = ''; return true
    } catch { error.value = '无法备份并恢复声音设置，原记录未主动删除。'; return false }
  }
  return { preferences: readonly(preferences), error: readonly(error), update, reset }
}
let shared: ReturnType<typeof createSoundPreferenceStore> | undefined
export function useSoundPreferences() {
  if (!shared) {
    let storage: Storage | null = null
    try { if (typeof window !== 'undefined') storage = window.localStorage } catch { /* Session mute remains available. */ }
    shared = createSoundPreferenceStore(storage)
  }
  return shared
}
