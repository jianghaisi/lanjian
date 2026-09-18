import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export type ThemeChoice = 'system' | 'qingzhou' | 'xuanzhi' | 'moye'
export type ResolvedTheme = Exclude<ThemeChoice, 'system'>
export const themeStorageKey = 'lanjian-theme'
export const themeChoices: ReadonlyArray<{ id: ThemeChoice; label: string }> = [
  { id: 'system', label: '跟随系统' },
  { id: 'qingzhou', label: '清昼' },
  { id: 'xuanzhi', label: '宣纸' },
  { id: 'moye', label: '墨夜' }
]

export function normalizeTheme(value: unknown): ThemeChoice {
  return themeChoices.find(item => item.id === value)?.id ?? 'qingzhou'
}

export function resolveTheme(choice: ThemeChoice, systemDark: boolean): ResolvedTheme {
  return choice === 'system' ? (systemDark ? 'moye' : 'qingzhou') : choice
}

export function useThemePreferences() {
  const choice = ref<ThemeChoice>('qingzhou')
  const error = ref('')
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const systemDark = ref(media.matches)
  try { choice.value = normalizeTheme(localStorage.getItem(themeStorageKey)) } catch { /* Session theme still works without storage. */ }
  const resolved = computed(() => resolveTheme(choice.value, systemDark.value))
  const stop = watch(resolved, value => {
    document.documentElement.dataset.theme = value
    document.documentElement.style.colorScheme = value === 'moye' ? 'dark' : 'light'
  }, { immediate: true })
  const onSystemChange = (event: MediaQueryListEvent) => { systemDark.value = event.matches }
  const onStorage = (event: StorageEvent) => {
    if (event.key === themeStorageKey) choice.value = normalizeTheme(event.newValue)
  }
  function select(value: ThemeChoice) {
    choice.value = normalizeTheme(value)
    try {
      localStorage.setItem(themeStorageKey, choice.value)
      error.value = ''
    } catch { error.value = '主题已预览，但本机偏好未能保存。请重试。' }
  }
  onMounted(() => {
    media.addEventListener('change', onSystemChange)
    window.addEventListener('storage', onStorage)
  })
  onBeforeUnmount(() => {
    stop()
    media.removeEventListener('change', onSystemChange)
    window.removeEventListener('storage', onStorage)
  })
  return { choice, resolved, error, select }
}
