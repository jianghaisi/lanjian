import { onBeforeUnmount, watch, type Ref } from 'vue'

type PetReminderInput = { minutes: number; enabled: boolean; scope: string | null; blocked: boolean }

/** One local reminder at most. Equal projections must not move its deadline. */
export function usePetReminder(input: Readonly<Ref<PetReminderInput>>, remind: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined, disposed = false
  function allowed() { return !disposed && input.value.enabled && Boolean(input.value.scope) && input.value.minutes > 0 }
  function schedule(delay = input.value.minutes * 60_000) {
    clearTimeout(timer); timer = undefined
    if (!allowed()) return
    timer = setTimeout(() => {
      timer = undefined
      if (!allowed()) return
      if (input.value.blocked) { schedule(30_000); return }
      remind()
      schedule()
    }, delay)
  }
  watch([() => input.value.minutes, () => input.value.enabled, () => input.value.scope], () => schedule(), { immediate: true, flush: 'sync' })
  onBeforeUnmount(() => { disposed = true; clearTimeout(timer) })
}
