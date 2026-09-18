import { companionHoldHintMs, companionHoldMs } from '../../../../contracts/companion/companion-presence'

/** Release is an intent; cancellation must never produce a tap or open a chat. */
export function createCompanionHold(
  open: () => void,
  changed: (holding: boolean) => void,
  tap: () => void,
  schedule = (fn: () => void, ms: number) => setTimeout(fn, ms),
  clear = (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  now = () => performance.now(),
) {
  let active: { started: number } | undefined
  let hintTimer: ReturnType<typeof setTimeout> | undefined
  let openTimer: ReturnType<typeof setTimeout> | undefined
  function cancel() {
    active = undefined
    if (hintTimer !== undefined) clear(hintTimer)
    if (openTimer !== undefined) clear(openTimer)
    hintTimer = openTimer = undefined
    changed(false)
  }
  return {
    start() {
      if (active) return
      const gesture = { started: now() }
      active = gesture
      hintTimer = schedule(() => {
        if (active === gesture) changed(true)
      }, companionHoldHintMs)
      openTimer = schedule(() => {
        if (active !== gesture) return
        cancel()
        open()
      }, companionHoldMs)
    },
    release() {
      if (!active) return
      const elapsed = now() - active.started
      cancel()
      // Timers can be delayed by a busy renderer. Elapsed time still wins.
      if (elapsed >= companionHoldMs) open()
      else if (elapsed >= 0 && elapsed < companionHoldHintMs) tap()
    },
    cancel,
  }
}
