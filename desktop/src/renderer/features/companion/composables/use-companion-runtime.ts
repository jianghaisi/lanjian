import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { useCompanionVoicePreferences } from './use-companion-voice-preferences'
import type { CompanionVoicePreferences } from '../services/companion-voice-preferences'

export const companionPreparation = ref('按需加载')
export const companionPreparationPhase = ref<'idle' | 'loading' | 'ready' | 'failed'>('idle')
export const companionPreparationError = ref('')
let retryPreparation: (() => Promise<void>) | undefined
export async function retryCompanionPreparation() { await retryPreparation?.() }
export function companionRuntimeOptions(value: CompanionVoicePreferences) {
  return { textModel: value.textModel, speechModel: !value.mute, preload: value.preload, voice: value.voice }
}

/** One preparation owner; the opening overlay observes its readiness, not a second load. */
export function useCompanionRuntime(libraryReady: Ref<boolean> = ref(true)) {
  const { preferences, ready: settingsReady } = useCompanionVoicePreferences()
  const api = window.novelDesktop?.companionVoice
  let epoch = 0, mounted = false
  async function sync() {
    const token = ++epoch
    await settingsReady
    if (!mounted || token !== epoch) return
    if (!libraryReady.value) {
      companionPreparationPhase.value = 'idle'
      companionPreparation.value = '等待作品库'
      companionPreparationError.value = ''
      return
    }
    if (!api) { companionPreparationPhase.value = 'failed'; companionPreparation.value = '当前环境不支持本地模型'; return }
    const value = { ...preferences.value }
    companionPreparationPhase.value = 'idle'
    companionPreparationError.value = ''
    companionPreparation.value = value.textModel || !value.mute ? '按需加载' : '预设陪伴 · 不加载模型'
    try {
      await api.configure(companionRuntimeOptions(value))
      if (!mounted || token !== epoch || !value.preload || (!value.textModel && value.mute)) return
      companionPreparationPhase.value = 'loading'
      companionPreparation.value = '后台准备中 · 不影响进入作品'
      const ready = await api.warmup()
      if (mounted && token === epoch) {
        companionPreparationPhase.value = ready ? 'ready' : 'failed'
        companionPreparation.value = ready
          ? (value.mute ? '文字模型准备完成' : '模型准备完成 · 语音保留至退出岚笺')
          : '未完成预加载 · 可以重试'
      }
    } catch (error) {
      if (mounted && token === epoch) {
        companionPreparationPhase.value = 'failed'
        let message = '模型准备失败，可重试或关闭模型使用预设文字。'
        if (error && typeof error === 'object' && 'code' in error
          && (error.code === 'FEATURE_UNAVAILABLE' || error.code === 'CONFLICT')
          && 'message' in error && typeof error.message === 'string' && error.message.length <= 300) message = error.message
        companionPreparationError.value = message
        companionPreparation.value = companionPreparationError.value
      }
    }
  }
  watch(() => [preferences.value.textModel, preferences.value.mute, preferences.value.voice, preferences.value.preload, libraryReady.value], () => { void sync() })
  onMounted(() => { mounted = true; retryPreparation = sync; void sync() })
  onBeforeUnmount(() => {
    mounted = false; epoch++
    if (retryPreparation === sync) { retryPreparation = undefined; companionPreparationPhase.value = 'idle'; companionPreparation.value = '按需加载'; companionPreparationError.value = '' }
    void api?.suspend().catch(() => {})
  })
}
