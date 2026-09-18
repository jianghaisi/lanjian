import { computed, ref, type Ref } from 'vue'
import { normalizeCompanionOptions, type CompanionOptions } from '../services/companion-controller'

export const COMPANION_STORAGE_KEY = 'lanjian-companion-v1'
type Saved = { version: 1; defaults: CompanionOptions; projects: Record<string, CompanionOptions> }
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>
export function createCompanionPreferences(storage: StoragePort, workItem: Ref<string>) {
  const error = ref('')
  let unreadable = false
  let originalRaw: string | null = null
  let initial: Saved = { version: 1, defaults: normalizeCompanionOptions(null), projects: {} }
  try {
    const raw = storage.getItem(COMPANION_STORAGE_KEY)
    originalRaw = raw
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed.version !== 1) throw new Error('unsupported-version')
      if (parsed.projects !== undefined && (!parsed.projects || typeof parsed.projects !== 'object' || Array.isArray(parsed.projects))) throw new Error('invalid-project-preferences')
      initial.defaults = normalizeCompanionOptions(parsed.defaults)
      for (const [key, value] of Object.entries(parsed.projects || {}).slice(0, 100)) {
        if (key && !['__proto__', 'constructor', 'prototype'].includes(key)) initial.projects[key] = normalizeCompanionOptions(value)
      }
    }
  } catch { unreadable = true; error.value = '看板娘偏好未能读取，暂用默认值；原记录未删除。请先恢复默认偏好。' }
  const saved = ref(initial)
  const projectSpecific = computed(() => Boolean(workItem.value && Object.hasOwn(saved.value.projects, workItem.value)))
  const options = computed(() => projectSpecific.value ? saved.value.projects[workItem.value]! : saved.value.defaults)
  function persist(next: Saved) {
    if (unreadable) return false
    try { storage.setItem(COMPANION_STORAGE_KEY, JSON.stringify(next)); saved.value = next; error.value = ''; return true }
    catch { error.value = '偏好保存失败，仍保留上次设置，请重试。'; return false }
  }
  function recoverDefaults() {
    try {
      // Re-read before recovery; a failed getItem must never be mistaken for empty storage.
      const raw = storage.getItem(COMPANION_STORAGE_KEY)
      if (raw !== originalRaw && originalRaw !== null) { error.value = '偏好记录已变化，请重新打开应用后核对。'; return false }
      if (raw) storage.setItem(`${COMPANION_STORAGE_KEY}-recovery-${Date.now()}`, raw)
      const next: Saved = { version: 1, defaults: normalizeCompanionOptions(null), projects: {} }
      storage.setItem(COMPANION_STORAGE_KEY, JSON.stringify(next))
      saved.value = next; unreadable = false; originalRaw = null; error.value = ''; return true
    } catch { error.value = '默认偏好未能保存，原记录保留。请检查本机存储后重试。'; return false }
  }
  function update(patch: Partial<CompanionOptions>) {
    const normalized = normalizeCompanionOptions({ ...options.value, ...patch })
    return persist(projectSpecific.value
      ? { ...saved.value, projects: { ...saved.value.projects, [workItem.value]: normalized } }
      : { ...saved.value, defaults: normalized })
  }
  function setProjectSpecific(enabled: boolean) {
    if (!workItem.value) return false
    const projects = { ...saved.value.projects }
    if (enabled) {
      if (!projectSpecific.value && Object.keys(projects).length >= 100) { error.value = '已保存 100 部作品的独立偏好，请先让不再需要的作品恢复跟随全局。'; return false }
      projects[workItem.value] = { ...options.value }
    } else delete projects[workItem.value]
    return persist({ ...saved.value, projects })
  }
  return { options, error, projectSpecific, update, setProjectSpecific, recoverDefaults }
}
