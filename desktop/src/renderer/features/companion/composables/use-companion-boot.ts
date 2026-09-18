import { computed, ref, type Ref } from 'vue'
import { companionPreparationPhase, companionPreparationError, retryCompanionPreparation } from './use-companion-runtime'
import { useCompanionVoicePreferences } from './use-companion-voice-preferences'

/** Present core readiness and the existing library model job as one honest opening flow. */
export function useCompanionBoot(corePhase: Ref<string>, coreError: Ref<string>, preview: Ref<boolean>) {
  const { preferences } = useCompanionVoicePreferences()
  const skipped = ref(false)
  const required = computed(() => preferences.value.preload && (preferences.value.textModel || !preferences.value.mute))
  const waiting = computed(() => !preview.value && corePhase.value === 'ready' && required.value && !skipped.value && companionPreparationPhase.value !== 'ready')
  const phase = computed(() => waiting.value ? 'models' : corePhase.value)
  const error = computed(() => coreError.value || (waiting.value && companionPreparationPhase.value === 'failed'
    ? companionPreparationError.value || '看板娘模型未能完成准备。可以重新加载，或跳过等待进入作品库；原作品不会受影响。' : ''))
  const detail = computed(() => {
    if (preview.value || corePhase.value !== 'ready') return ''
    if (skipped.value) return companionPreparationPhase.value === 'failed'
      ? '已跳过模型等待；模型尚未就绪，可在设置中重试。'
      : '已跳过模型等待；尚未完成的准备会在后台继续。'
    if (!required.value) return preferences.value.textModel || !preferences.value.mute
      ? '作品库已就绪；未开启预加载，模型将在使用时准备。' : '作品库已就绪 · 预设陪伴无需加载模型。'
    if (!waiting.value) return '已选模型准备完成，作品库可以进入。'
    const models = preferences.value.textModel ? preferences.value.mute ? '文字模型' : '文字与语音模型' : '语音模型'
    return `正在准备${models}；首次加载可能需要较长时间，请稍候。`
  })
  return {
    phase, error, detail, required, skipped, canSkip: waiting,
    skipWaiting: () => { skipped.value = true },
    retryModels: retryCompanionPreparation,
  }
}
