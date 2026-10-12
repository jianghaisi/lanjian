import { nextTick, onBeforeUnmount, onMounted, watch, type Ref, type WatchSource } from 'vue'

/** Keep real keyed cards (and their focus) while their layout changes. */
export function useGalleryMotion(root: Ref<HTMLElement | undefined>, source: WatchSource) {
  const playing = new Map<HTMLElement, Animation>()
  const preference = matchMedia('(prefers-reduced-motion: reduce)')
  let revision = 0
  const stop = () => { for (const animation of playing.values()) animation.cancel(); playing.clear() }
  // A changed presentation context invalidates both in-flight and not-yet-started motion.
  const settle = () => { revision++; stop() }
  const visibility = () => { if (document.hidden) settle() }
  onMounted(() => {
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('resize', settle)
    preference.addEventListener('change', settle)
  })
  watch(source, async () => {
    const ticket = ++revision
    const cards = Array.from(root.value?.querySelectorAll<HTMLElement>('.work-card') ?? [])
    // Read the interrupted visual positions before removing old transforms.
    // Vue may replace a fading node when the same work is filtered back in.
    const before = new Map(cards.filter(card => card.dataset.projectPath)
      .map(card => [card.dataset.projectPath, card.getBoundingClientRect()]))
    stop()
    await nextTick()
    if (ticket !== revision || document.hidden || preference.matches) return
    const connected = Array.from(root.value?.querySelectorAll<HTMLElement>('.work-card') ?? [])
      .filter(card => card.isConnected)
    // A second query may arrive while a previous departure is still fading.
    // Measure its base rectangle, not the frozen transform from that departure.
    for (const card of connected) {
      if (card.classList.contains('archive-list-leave-active')) card.style.removeProperty('transform')
    }
    const after = connected
      .map(card => ({ card, bounds: card.getBoundingClientRect() }))
    for (const { card, bounds } of after) {
      const first = before.get(card.dataset.projectPath)
      if (!first || !bounds.width || !bounds.height || !first.width || !first.height) continue
      const x = first.left - bounds.left, y = first.top - bounds.top
      if (Math.abs(x) + Math.abs(y) + Math.abs(first.width - bounds.width) + Math.abs(first.height - bounds.height) < 1) continue
      const transform = `translate(${x}px,${y}px) scale(${first.width / bounds.width},${first.height / bounds.height})`
      if (card.classList.contains('archive-list-leave-active')) {
        // Vue owns the opacity exit and removal; freeze geometry until it finishes.
        card.style.transform = transform
        continue
      }
      const animation = card.animate([
        { transform },
        { transform: 'none' }
      ], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' })
      playing.set(card, animation)
      void animation.finished.then(() => { if (playing.get(card) === animation) playing.delete(card) }).catch(() => {})
    }
  }, { flush: 'pre' })
  onBeforeUnmount(() => {
    settle()
    document.removeEventListener('visibilitychange', visibility)
    window.removeEventListener('resize', settle)
    preference.removeEventListener('change', settle)
  })
}
