<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{ selected: string }>()
const rail = ref<HTMLElement | null>(null)
const placement = ref({ y: 0, height: 0 })
const moving = ref(false)
let nav: HTMLElement | null = null
let observer: ResizeObserver | undefined
let frame = 0
let animateNext = false

function measure() {
  frame = 0
  const target = nav?.querySelector<HTMLElement>(':scope > button[aria-current]')
  if (!nav || !target || !rail.value) return
  const parentBox = nav.getBoundingClientRect(), box = target.getBoundingClientRect()
  const next = { y: box.top - parentBox.top + nav.scrollTop - nav.clientTop, height: box.height }
  if (!next.height) return
  if (next.y !== placement.value.y || next.height !== placement.value.height) {
    moving.value = animateNext && placement.value.height > 0 && !document.hidden
    placement.value = next
  }
  animateNext = false
}
function schedule(animate = false) {
  animateNext = animate
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(measure)
}
const settle = () => schedule()
watch(() => props.selected, () => schedule(true), { flush: 'post' })
onMounted(() => {
  nav = rail.value?.parentElement ?? null
  if (!nav) return
  observer = new ResizeObserver(settle)
  observer.observe(nav)
  nav.querySelectorAll(':scope > button').forEach(button => observer?.observe(button))
  nav.addEventListener('scroll', settle, { passive: true })
  document.addEventListener('visibilitychange', settle)
  schedule()
})
onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  observer?.disconnect()
  nav?.removeEventListener('scroll', settle)
  document.removeEventListener('visibilitychange', settle)
})
</script>

<template>
  <i ref="rail" class="workspace-navigation-rail" :class="{ moving }" :data-ready="placement.height > 0" aria-hidden="true"
    :style="{ transform: `translateY(${placement.y}px) scaleY(${placement.height})` }" />
</template>

<style scoped>
.workspace-navigation-rail{position:absolute;inset:0 auto auto 0;width:4px;height:1px;transform-origin:top;pointer-events:none;z-index:2;background:var(--color-orange,var(--signal));visibility:hidden}
.workspace-navigation-rail[data-ready=true]{visibility:visible}
.workspace-navigation-rail.moving{transition:transform 280ms cubic-bezier(.2,.8,.2,1)}
@media(prefers-reduced-motion:reduce){.workspace-navigation-rail.moving{transition:none}}
</style>
