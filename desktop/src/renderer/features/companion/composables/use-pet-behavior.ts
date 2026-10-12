import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { petPlaybackDuration, type PetAnimation } from '../services/pet-action-motion'

type PetBehaviorInput = { allowed: boolean; energy: number; mood: number }
export function choosePetBehavior(energy: number, mood: number, previous: PetAnimation): PetAnimation {
  const preferred = energy < 35 ? 'stretch' : mood < 35 ? 'thinking' : mood >= 70 ? 'greet' : 'stretch'
  return preferred === previous ? (preferred === 'stretch' ? 'blink' : 'stretch') : preferred
}

/** Quiet presentation only. Pauses discard the deadline instead of queuing work. */
export function usePetBehavior(input: Readonly<Ref<PetBehaviorInput>>, random = Math.random) {
  const intent = ref<PetAnimation>('idle'), sequence = ref(0)
  let timer: ReturnType<typeof setTimeout> | undefined, previous: PetAnimation = 'idle', disposed = false
  function cancel() { clearTimeout(timer); timer = undefined; intent.value = 'idle' }
  function schedule() {
    cancel()
    if (!input.value.allowed || disposed) return
    timer = setTimeout(() => {
      if (!input.value.allowed || disposed) return
      intent.value = choosePetBehavior(input.value.energy, input.value.mood, previous)
      previous = intent.value; sequence.value++
      timer = setTimeout(schedule, petPlaybackDuration(intent.value))
    }, 24_000 + Math.max(0, Math.min(1, random())) * 18_000)
  }
  watch(() => input.value.allowed, schedule, { immediate: true, flush: 'sync' })
  onBeforeUnmount(() => { disposed = true; cancel() })
  return { intent, sequence }
}
