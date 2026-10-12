import { onBeforeUnmount, ref } from 'vue'
import { petPlaybackDuration, type PetAnimation } from '../services/pet-action-motion'

export function usePetAnimation() {
  const intent = ref<PetAnimation | 'idle'>('idle'), sequence = ref(0)
  let timer: ReturnType<typeof setTimeout> | undefined, active = false
  function cancel() { clearTimeout(timer); timer = undefined; active = false; intent.value = 'idle' }
  function started(value: PetAnimation, action: number) {
    if (!active || intent.value !== value || sequence.value !== action) return
    clearTimeout(timer)
    timer = setTimeout(cancel, petPlaybackDuration(value))
  }
  function play(value: PetAnimation) {
    cancel(); active = true; intent.value = value; sequence.value++
    started(value, sequence.value)
  }
  onBeforeUnmount(cancel)
  return { intent, sequence, play, cancel, started }
}
