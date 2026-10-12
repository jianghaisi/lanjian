import { nextTick, onScopeDispose, ref, watch, type Ref } from 'vue'
import type { ReadingPosition } from '../services/assistant-memory'

type ChatPositionState = {
  scope: number
  revision: number
  visible: boolean
  loading: boolean
  position?: ReadingPosition
}

/** Owns only the mounted reading surface; useAssistantMemory still owns persistence. */
export function useAssistantChatPosition(
  scroll: Ref<HTMLElement | undefined>, state: () => ChatPositionState,
  save: (position: ReadingPosition) => void,
) {
  const ready = ref(false)
  let version = 0, disposed = false, frame: number | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: { scope: number; revision: number; position: ReadingPosition } | undefined
  const sameScope = (sample: { scope: number; revision: number }) => {
    const current = state()
    return !current.loading && sample.scope === current.scope && sample.revision === current.revision
  }
  function flush() {
    clearTimeout(timer); timer = undefined
    const sample = pending; pending = undefined
    // A hidden DOM reports zero dimensions. Commit the visible sample, never resample it.
    if (sample && sameScope(sample)) save(sample.position)
  }
  function cancelRestore() {
    version++
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
  }
  function record() {
    const current = state(), element = scroll.value
    if (disposed || !ready.value || !current.visible || current.loading || !element?.clientHeight) return
    pending = { scope: current.scope, revision: current.revision, position: {
      top: element.scrollTop,
      atBottom: element.scrollHeight - element.scrollTop - element.clientHeight < 48,
    } }
    clearTimeout(timer); timer = setTimeout(flush, 120)
  }
  function interact(event: Event) {
    const key = event as KeyboardEvent
    if (event.type === 'keydown' && (key.isComposing || key.keyCode === 229 || !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(key.key))) return
    const current = state()
    if (!current.visible || current.loading || !scroll.value?.clientHeight) return
    cancelRestore(); ready.value = true
  }
  async function restore() {
    flush(); cancelRestore(); ready.value = false
    const current = state(), element = scroll.value, ticket = version
    if (disposed || !current.visible || current.loading || !element) return
    const position = current.position && { ...current.position }
    const valid = () => !disposed && ticket === version && sameScope(current) && state().visible && scroll.value === element
    await nextTick()
    if (!valid()) return
    // Copilot measures its input/content on the first frame; apply after that layout.
    frame = requestAnimationFrame(() => {
      if (!valid()) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        if (!valid() || !element.clientHeight) return
        if (position) element.scrollTop = position.atBottom ? element.scrollHeight : position.top
        ready.value = true
      })
    })
  }
  function listen(element: HTMLElement | undefined, add: boolean) {
    if (!element) return
    for (const [event, listener] of [['scroll', record], ['wheel', interact], ['pointerdown', interact], ['keydown', interact]] as const) {
      if (add) element.addEventListener(event, listener, { passive: true })
      else element.removeEventListener(event, listener)
    }
  }
  watch(scroll, (element, previous) => { listen(previous, false); listen(element, true) }, { flush: 'sync' })
  // Compare each scalar separately. A props projection also reads position; a
  // freshly allocated array would otherwise restore again on every saved scroll.
  watch([() => scroll.value, () => state().scope, () => state().revision, () => state().visible, () => state().loading],
    () => void restore(), { flush: 'sync', immediate: true })
  onScopeDispose(() => { flush(); disposed = true; cancelRestore(); listen(scroll.value, false) })
  return { ready }
}
