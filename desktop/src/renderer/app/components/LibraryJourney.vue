<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import LibraryBookCover from '../../features/library/components/LibraryBookCover.vue'

type Opening = { generation: number; path: string; visible: boolean; replay?: boolean }
type Origin = { path: string; title: string; bounds: DOMRect; at: number }
const props = defineProps<{ pending: Opening | null; currentPath?: string }>()
const flight = ref<Origin | null>(null)
const cover = ref<HTMLElement>()
let candidate: Origin | null = null
let selected: Origin | null = null
let generation = 0
let target: HTMLElement | undefined
const animations = new Set<Animation>()
const reduce = () => document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches

function clear() {
  generation++
  for (const animation of animations) animation.cancel()
  animations.clear()
  target?.removeAttribute('data-cover-in-flight')
  target = undefined
  flight.value = null
}
function play(element: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
  const animation = element.animate(frames, options)
  animations.add(animation)
  void animation.finished.then(() => animations.delete(animation)).catch(() => {})
  return animation
}
function capture(event: MouseEvent) {
  const button = (event.target as Element)?.closest<HTMLElement>('[data-library-open-path]')
  const source = button?.querySelector<HTMLElement>('.library-book-cover')
  if (!button || !source || reduce() || button.closest('[inert]')) return
  candidate = { path: button.dataset.libraryOpenPath!, title: button.dataset.libraryOpenTitle!, bounds: source.getBoundingClientRect(), at: performance.now() }
}

watch(() => props.pending, async (pending, before) => {
  clear()
  if (pending) {
    selected = pending.visible && pending.replay !== false && candidate?.path === pending.path && performance.now() - candidate.at < 1500 ? candidate : null
    candidate = null
    return
  }
  const origin = selected
  selected = null
  if (!before?.visible || before.replay === false || props.currentPath !== before.path || reduce()) return
  const ticket = generation
  await nextTick()
  if (ticket !== generation || reduce() || props.currentPath !== before.path) return
  const panels = document.querySelectorAll<HTMLElement>('.studio > :is(.activitybar,.explorer,.planning-sidebar,.chronicle-sidebar,.workbench)')
  panels.forEach((panel, index) => play(panel, [
    { opacity: 0, transform: `translate${panel.classList.contains('workbench') ? 'Y' : 'X'}(${panel.classList.contains('workbench') ? 12 : -12}px)` },
    { opacity: 1, transform: 'none' }
  ], { duration: 460, delay: Math.min(index, 3) * 55, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }))
  if (!origin) return
  const tab = Array.from(document.querySelectorAll<HTMLElement>('[data-book-tab]')).find(element => element.dataset.bookPath === origin.path)
  target = tab?.querySelector<HTMLElement>('.library-book-cover') ?? undefined
  if (!target || !origin.bounds.width || !origin.bounds.height) return
  const end = target.getBoundingClientRect()
  if (!end.width || end.right < 0 || end.left > innerWidth) { target = undefined; return }
  target.setAttribute('data-cover-in-flight', '')
  flight.value = origin
  await nextTick()
  if (ticket !== generation) return
  if (!cover.value || !target?.isConnected || reduce() || props.currentPath !== origin.path) { clear(); return }
  const { left, top, width, height } = origin.bounds
  const animation = play(cover.value, [
    { transform: `translate(${left}px,${top}px) scale(1)`, opacity: 0, offset: 0 },
    { transform: `translate(${left}px,${top - 8}px) scale(1)`, opacity: 1, offset: .12 },
    { transform: `translate(${end.left}px,${end.top}px) scale(${end.width / width},${end.height / height})`, opacity: 1, offset: 1 }
  ], { duration: 620, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' })
  try { await animation.finished } catch {
    // A cancelled decorative effect must still reveal the real destination.
  } finally {
    if (ticket === generation) clear()
  }
}, { flush: 'post' })

function interrupt() { candidate = null; selected = null; clear() }
function visibility() { if (document.hidden) interrupt() }
function targetScroll(event: Event) {
  if (!flight.value || !target) return
  if (event.target === document || (event.target instanceof Element && event.target.contains(target))) interrupt()
}
watch(() => props.currentPath, path => {
  if (flight.value && flight.value.path !== path) interrupt()
})
let preference: MediaQueryList | undefined
onMounted(() => {
  document.addEventListener('click', capture, true)
  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('resize', interrupt)
  window.addEventListener('scroll', targetScroll, true)
  preference = matchMedia('(prefers-reduced-motion: reduce)')
  preference.addEventListener('change', interrupt)
})
onBeforeUnmount(() => {
  interrupt()
  document.removeEventListener('click', capture, true)
  document.removeEventListener('visibilitychange', visibility)
  window.removeEventListener('resize', interrupt)
  window.removeEventListener('scroll', targetScroll, true)
  preference?.removeEventListener('change', interrupt)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="flight" ref="cover" class="library-cover-flight" aria-hidden="true" inert data-testid="library-cover-flight" :data-project-path="flight.path" :style="{ width: `${flight.bounds.width}px`, height: `${flight.bounds.height}px` }">
      <LibraryBookCover :title="flight.title" />
    </div>
  </Teleport>
</template>

<style scoped>
.library-cover-flight{position:fixed;left:0;top:0;z-index:5100;pointer-events:none;transform-origin:top left;will-change:transform;box-shadow:0 8px 30px #0003}
.library-cover-flight :deep(.library-book-cover){width:100%;height:100%;border-radius:0}
:global([data-cover-in-flight]){opacity:0!important}
</style>
