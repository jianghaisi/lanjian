import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { PetFocus } from '../../../../contracts/companion/companion-care'

/** Display only: bridge one five-second main tick, never complete or reward focus. */
export function usePetFocusClock(focus: Readonly<Ref<PetFocus | null | undefined>>, enabled: Readonly<Ref<boolean>>, now = () => performance.now()) {
  const delta = ref(0)
  let anchor = now(), timer: ReturnType<typeof setInterval> | undefined
  function reset() {
    clearInterval(timer); timer = undefined; delta.value = 0; anchor = now()
    if (!enabled.value || focus.value?.status !== 'running') return
    timer = setInterval(() => { delta.value = Math.min(5, Math.max(0, (now() - anchor) / 1000)) }, 200)
  }
  watch([() => focus.value?.id, () => focus.value?.duration, () => focus.value?.elapsed, () => focus.value?.status, () => enabled.value], reset, { immediate: true, flush: 'sync' })
  onBeforeUnmount(() => clearInterval(timer))
  const remaining = computed(() => {
    const value = focus.value
    if (!value || value.status === 'complete') return 0
    return Math.max(value.status === 'running' ? 1 : 0, Math.ceil(value.duration - value.elapsed - delta.value))
  })
  const text = computed(() => `${Math.floor(remaining.value / 60).toString().padStart(2, '0')}:${(remaining.value % 60).toString().padStart(2, '0')}`)
  const progress = computed(() => Math.max(0, (focus.value?.duration ?? 0) - remaining.value))
  const waiting = computed(() => Boolean(enabled.value && focus.value?.status === 'running' && (delta.value >= 5 || focus.value.duration - focus.value.elapsed - delta.value <= 0)))
  return { text, progress, waiting }
}
