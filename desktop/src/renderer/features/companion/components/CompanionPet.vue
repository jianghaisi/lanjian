<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CompanionHost from './CompanionHost.vue'
import type { CompanionMode, CompanionOptions } from '../services/companion-controller'
import { placeCompanion } from '../services/companion-placement'

const props = defineProps<{ options: CompanionOptions; scope: string; taskId: string; taskStatus: string; quiet: boolean; focus: boolean; open: boolean }>()
const emit = defineEmits<{ mode: [mode: CompanionMode]; close: []; settings: [] }>()
const root = ref<HTMLElement>()
const position = ref({ x: 8, y: 200 })
const menu = ref(false)
const dragging = ref(false)
const available = ref(true)
const overlayBlocked = ref(false)
const menuStyle = computed(() => ({
  insetInlineStart: position.value.x > innerWidth / 2 ? 'auto' : '0',
  insetInlineEnd: position.value.x > innerWidth / 2 ? '0' : 'auto',
  insetBlockEnd: position.value.y < 260 ? 'auto' : 'calc(100% + .5rem)',
  insetBlockStart: position.value.y < 260 ? 'calc(100% + .5rem)' : 'auto'
}))
const visible = computed(() => props.open && props.options.writingMode !== 'hidden' && !(props.focus && props.options.focusAutoHide))
let drag: { pointer: number; x: number; y: number; startX: number; startY: number; moved: boolean } | undefined
let observer: MutationObserver | undefined
let resizeObserver: ResizeObserver | undefined
function reposition(x = position.value.x, y = position.value.y) {
  const box = root.value?.getBoundingClientRect()
  if (!box) return
  const editor = document.querySelector('.manuscript-editor .cm-scroller')?.getBoundingClientRect()
  const chapterAction = document.querySelector('.archive-new-chapter')?.getBoundingClientRect()
  const composer = document.querySelector('.agent-composer')?.getBoundingClientRect()
  const bottom = Math.min(innerHeight, chapterAction?.top || innerHeight, composer?.top || innerHeight)
  // Focus mode has no safe side strip. Keep the top-bar recovery control instead.
  available.value = !editor || editor.left >= box.width + 16 || innerWidth - editor.right >= box.width + 16
  position.value = placeCompanion(x, y, box.width, box.height, { width: innerWidth, height: bottom }, editor)
}
function start(event: PointerEvent) {
  if (event.button !== 0) return
  drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, startX: position.value.x, startY: position.value.y, moved: false }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointer) return
  if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 5) drag.moved = true
  if (drag.moved) { dragging.value = true; menu.value = false; reposition(drag.startX + event.clientX - drag.x, drag.startY + event.clientY - drag.y) }
}
function finish(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointer) return
  if (!drag.moved) menu.value = !menu.value
  drag = undefined; dragging.value = false
}
function keyboard(event: KeyboardEvent) {
  const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
  const direction = directions[event.key]
  if (!direction) return
  event.preventDefault(); reposition(position.value.x + direction[0] * 24, position.value.y + direction[1] * 24)
}
function handleClick(event: MouseEvent) {
  if (event.detail === 0) menu.value = !menu.value
}
function checkOverlay() {
  const blocked = Boolean(document.querySelector('.app-frame[inert], dialog[open], [aria-modal="true"]'))
  overlayBlocked.value = blocked
  if (root.value && root.value.inert !== blocked) root.value.inert = blocked
  root.value?.toggleAttribute('data-blocked', blocked)
}
function resize() { reposition() }
watch([visible, () => props.options.writingMode, () => props.focus], async () => { menu.value = false; await nextTick(); reposition(); checkOverlay() })
onMounted(async () => {
  await nextTick(); reposition((document.querySelector('.activitybar')?.getBoundingClientRect().right || 0) + 8, innerHeight * .62); checkOverlay()
  window.addEventListener('resize', resize)
  observer = new MutationObserver(checkOverlay)
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['inert', 'open', 'aria-modal'] })
  resizeObserver = new ResizeObserver(resize)
  const studio = document.querySelector('.studio'); if (studio) resizeObserver.observe(studio)
  const paper = document.querySelector('.workbench'); if (paper) resizeObserver.observe(paper)
})
onBeforeUnmount(() => { window.removeEventListener('resize', resize); observer?.disconnect(); resizeObserver?.disconnect() })
</script>

<template>
  <Teleport to="body">
    <aside v-if="visible" ref="root" class="companion-pet" :class="[options.writingMode, { dragging, unavailable: !available }]" :style="{ left: `${position.x}px`, top: `${position.y}px` }" data-testid="companion-pet" aria-label="独立写作伙伴" @keydown.esc.stop="menu = false">
      <div v-if="menu" class="pet-menu" :style="menuStyle" data-testid="companion-pet-menu">
        <strong>岚笺 · 写作伙伴</strong>
        <small>拖动或用方向键移动；点击角色展开。</small>
        <div role="group" aria-label="宠物形态"><button v-for="mode in (['detailed', 'chibi'] as const)" :key="mode" type="button" :aria-pressed="options.writingMode === mode" :data-testid="`pet-mode-${mode}`" @click="emit('mode', mode)">{{ mode === 'detailed' ? '立绘' : 'Q版' }}</button></div>
        <button type="button" @click="emit('settings'); menu = false">动画与偏好</button>
        <button type="button" data-testid="pet-hide" @click="emit('mode', 'hidden')">隐藏伙伴</button>
      </div>
      <button class="pet-handle" type="button" data-testid="pet-drag-handle" title="拖动写作伙伴；点击展开菜单；方向键移动" aria-label="移动或展开写作伙伴" :aria-expanded="menu" @pointerdown="start" @pointermove="move" @pointerup="finish" @pointercancel="drag = undefined; dragging = false" @keydown="keyboard" @click="handleClick">
        <CompanionHost :options="options" :mode="options.writingMode" :scope="scope" :task-id="taskId" :task-status="taskStatus" :quiet="quiet || dragging || !available || overlayBlocked" :focus="focus" pet />
      </button>
      <button type="button" class="pet-minimize" data-testid="pet-minimize" title="收起至顶栏" aria-label="收起写作伙伴" @click="emit('close')">−</button>
      <span class="pet-caption" aria-hidden="true">{{ taskStatus === 'streaming' ? '写下故事…' : ['queued', 'preparing', 'running', 'resuming'].includes(taskStatus) ? '构思中…' : '岚笺 / COMPANION' }}</span>
    </aside>
  </Teleport>
</template>

<style scoped>
.companion-pet{position:fixed;z-index:25;inline-size:clamp(5rem,7vw,7.5rem);color:var(--color-ink);font:var(--type-control,.875rem)/1.4 var(--sans);isolation:isolate;touch-action:none}
.companion-pet[data-blocked],.companion-pet.unavailable{visibility:hidden;pointer-events:none}
.pet-handle{display:block;inline-size:100%;padding:0;border:0;background:none;color:inherit;cursor:grab;touch-action:none}.dragging .pet-handle{cursor:grabbing}
.pet-handle :deep(.companion-host){display:block;inline-size:100%;block-size:auto;min-block-size:0;padding:0;border:0;background:transparent;pointer-events:none}
.pet-handle :deep(.companion-art){block-size:auto;inline-size:100%;aspect-ratio:1;filter:drop-shadow(0 .2rem .25rem #1d222026)}
.detailed .pet-handle :deep(.companion-art){aspect-ratio:2/3;border-radius:.25rem;overflow:hidden;box-shadow:0 .2rem .75rem #1d222026;background:var(--color-paper)}
.pet-caption{display:block;text-align:center;font-size:.6rem;letter-spacing:.06em;background:var(--color-surface);border:1px solid var(--color-line);padding:.25rem;pointer-events:none}
.pet-minimize{position:absolute;inset-block-start:-.6rem;inset-inline-end:0;inline-size:1.5rem;block-size:1.5rem;border:1px solid var(--color-line);border-radius:50%;color:var(--color-ink);background:var(--color-surface);cursor:pointer}
.pet-menu{position:absolute;inset-block-end:calc(100% + .5rem);inset-inline-start:0;inline-size:min(13rem,70vw);display:grid;gap:.5rem;padding:.75rem;border:1px solid var(--color-line);background:var(--color-surface);box-shadow:0 .4rem 1.2rem #1d222020;touch-action:auto}
.pet-menu small{font-size:.7rem;color:var(--color-muted)}.pet-menu>div{display:flex;gap:.5rem}.pet-menu button{padding:.35rem .6rem;border:1px solid var(--color-line);color:var(--color-ink);background:var(--color-paper);font:inherit;cursor:pointer}.pet-menu button[aria-pressed=true]{color:var(--color-surface);background:var(--color-ink)}
button:focus-visible{outline:2px solid var(--color-jade);outline-offset:3px}
</style>
