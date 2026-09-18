import { computed, ref } from 'vue'
import industrialCity from '../../../assets/visuals/background-industrial-city.png'
import fogCity from '../../../assets/visuals/recent-fog-city.png'
import skyTower from '../../../assets/visuals/recent-sky-tower.png'
import redMoon from '../../../assets/visuals/recent-red-moon.png'
import observatory from '../../../assets/visuals/archive-observatory.png'
import satelliteCity from '../../../assets/visuals/scene-satellite-city.png'

export type LibraryBackgroundId = 'industrial' | 'fog' | 'sky' | 'red-moon'
export type LibrarySceneId = 'satellite' | 'observatory' | 'hidden'
export type LibraryCharacterPlacement = { scale: number; inlineOffset: number; blockOffset: number }
export type LibraryAppearance = { version: 4; background: LibraryBackgroundId; scene: LibrarySceneId; character: LibraryCharacterPlacement }
export const LIBRARY_APPEARANCE_STORAGE_KEY = 'lanjian-library-appearance-v4'
const LEGACY_LIBRARY_APPEARANCE_STORAGE_KEYS = ['lanjian-library-appearance-v3', 'lanjian-library-appearance-v2', 'lanjian-library-appearance-v1'] as const
export const defaultLibraryCharacterPlacement: LibraryCharacterPlacement = { scale: 1.24, inlineOffset: 0, blockOffset: 18 }

export const libraryBackgroundChoices = [
  { id: 'industrial', label: '云上工业城', src: industrialCity },
  { id: 'fog', label: '雾中城市', src: fogCity },
  { id: 'sky', label: '晴空高塔', src: skyTower },
  { id: 'red-moon', label: '赤月废墟', src: redMoon }
] as const

export const librarySceneChoices = [
  { id: 'satellite', label: '卫星城', src: satelliteCity },
  { id: 'observatory', label: '旧观测站', src: observatory },
  { id: 'hidden', label: '不显示', src: '' }
] as const

const defaults: LibraryAppearance = { version: 4, background: 'industrial', scene: 'satellite', character: { ...defaultLibraryCharacterPlacement } }
const backgroundIds = new Set(libraryBackgroundChoices.map(item => item.id))
const sceneIds = new Set(librarySceneChoices.map(item => item.id))

function normalize(value: unknown): LibraryAppearance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...defaults }
  const input = value as Partial<LibraryAppearance>
  const storedCharacter = input.character && typeof input.character === 'object' ? input.character : defaultLibraryCharacterPlacement
  const storedVersion = (input as { version?: number }).version
  const character = ((storedVersion === 2 && storedCharacter.scale === 1 && storedCharacter.inlineOffset === 0 && storedCharacter.blockOffset === 0)
    || (storedVersion === 3 && storedCharacter.scale === 1.5 && storedCharacter.inlineOffset === 0 && storedCharacter.blockOffset === 36))
    ? defaultLibraryCharacterPlacement
    : storedCharacter
  const finite = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
  return {
    version: 4,
    background: backgroundIds.has(input.background as LibraryBackgroundId) ? input.background as LibraryBackgroundId : defaults.background,
    scene: sceneIds.has(input.scene as LibrarySceneId) ? input.scene as LibrarySceneId : defaults.scene,
    character: {
      scale: finite(character.scale, defaultLibraryCharacterPlacement.scale, .7, 2),
      inlineOffset: finite(character.inlineOffset, defaultLibraryCharacterPlacement.inlineOffset, -40, 40),
      blockOffset: finite(character.blockOffset, defaultLibraryCharacterPlacement.blockOffset, -50, 50)
    }
  }
}

export function useLibraryAppearance(storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage) {
  const error = ref('')
  let initial = normalize(null)
  try { initial = normalize(JSON.parse(storage.getItem(LIBRARY_APPEARANCE_STORAGE_KEY) || LEGACY_LIBRARY_APPEARANCE_STORAGE_KEYS.map(key => storage.getItem(key)).find(Boolean) || 'null')) }
  catch { error.value = '作品库背景偏好未能读取，已暂用默认画面。' }
  const preferences = ref<LibraryAppearance>(initial)
  const backgroundArtwork = computed(() => libraryBackgroundChoices.find(item => item.id === preferences.value.background)?.src || industrialCity)
  const sceneArtwork = computed(() => librarySceneChoices.find(item => item.id === preferences.value.scene)?.src || '')
  function update(patch: Partial<Pick<LibraryAppearance, 'background' | 'scene'>> & { character?: Partial<LibraryCharacterPlacement> }) {
    const next = normalize({ ...preferences.value, ...patch, character: { ...preferences.value.character, ...patch.character } })
    try { storage.setItem(LIBRARY_APPEARANCE_STORAGE_KEY, JSON.stringify(next)); preferences.value = next; error.value = ''; return true }
    catch { error.value = '作品库背景偏好未能保存，请重试。'; return false }
  }
  function reset() { return update(defaults) }
  return { preferences, backgroundArtwork, sceneArtwork, error, update, reset }
}
