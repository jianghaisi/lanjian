import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'

export const BOOT_COMPLETION_DURATION_MS = 3000

/** Count only the visible, successful completion stage, never model loading or preview. */
export function useBootCompletion(ready: Ref<boolean>, complete: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  function clear() { clearTimeout(timer) }
  onMounted(() => watch(ready, value => {
    clear()
    if (!value) return
    timer = setTimeout(() => { clear(); if (ready.value) complete() }, BOOT_COMPLETION_DURATION_MS)
  }, { immediate: true }))
  onBeforeUnmount(clear)
}
