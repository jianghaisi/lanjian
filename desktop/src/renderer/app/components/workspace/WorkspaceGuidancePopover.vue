<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ConsistencyItem, ConsistencyOverview, WorkflowStatus, WorkflowStep } from '../../../../contracts/index'
import WorkflowNextStep from '../WorkflowNextStep.vue'
import StudioIcon from '../../../ui/StudioIcon.vue'

const props = defineProps<{ workflow: WorkflowStatus | null; overview?: ConsistencyOverview | null; busy?: boolean; scope: string }>()
const emit = defineEmits<{ navigate: [step: WorkflowStep]; selectItem: [item: ConsistencyItem]; write: []; refresh: [] }>()
const open = ref(false)
const panel = ref<HTMLElement | null>(null)
const style = ref<Record<string, string>>({})
let trigger: HTMLElement | null = null
let observer: ResizeObserver | null = null
function place() {
  if (!open.value || !trigger?.isConnected) return
  const rect = trigger.getBoundingClientRect()
  const width = Math.min(380, window.innerWidth - 24)
  const top = Math.min(rect.bottom + 8, window.innerHeight - 80)
  style.value = { left: `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`, top: `${top}px`, width: `${width}px`, maxHeight: `${Math.max(64, window.innerHeight - top - 12)}px` }
}
function close(restoreFocus = false) {
  open.value = false
  trigger?.setAttribute('aria-expanded', 'false')
  if (restoreFocus && trigger?.isConnected) trigger.focus()
  observer?.disconnect()
}
async function toggle(element: HTMLElement) {
  if (open.value && trigger === element) { close(true); return }
  close()
  trigger = element
  open.value = true
  trigger.setAttribute('aria-expanded', 'true')
  place()
  observer = new ResizeObserver(place)
  observer.observe(trigger)
  await nextTick()
  panel.value?.focus({ preventScroll: true })
}
function outside(event: PointerEvent) {
  if (!open.value || !(event.target instanceof Node) || panel.value?.contains(event.target) || trigger?.contains(event.target)) return
  close()
}
function escape(event: KeyboardEvent) {
  if (open.value && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) }
}
watch(() => props.scope, () => close())
onMounted(() => {
  document.addEventListener('pointerdown', outside, true)
  document.addEventListener('keydown', escape, true)
  window.addEventListener('resize', place)
  window.visualViewport?.addEventListener('resize', place)
})
onBeforeUnmount(() => {
  close()
  document.removeEventListener('pointerdown', outside, true)
  document.removeEventListener('keydown', escape, true)
  window.removeEventListener('resize', place)
  window.visualViewport?.removeEventListener('resize', place)
})
defineExpose({ toggle, close })
</script>

<template>
  <Teleport to="body">
    <Transition name="workspace-guidance-popover">
      <section v-if="open" id="workspace-guidance-panel" ref="panel" class="workspace-guidance-popover" role="dialog" aria-label="写作指引" tabindex="-1" :style="style" data-testid="workspace-guidance-panel">
        <header><div><StudioIcon name="outline" :size="18"/><b>写作指引</b></div><button type="button" aria-label="关闭写作指引" @click="close(true)"><StudioIcon name="close" :size="18"/></button></header>
        <div class="guidance-popover-content">
          <WorkflowNextStep v-if="workflow" :workflow="workflow" :overview="overview" :busy="busy" @navigate="emit('navigate', $event)" @select-item="emit('selectItem', $event)" @write="emit('write')" />
          <div v-else class="guidance-empty"><p>{{ busy ? '正在读取创作进度…' : '创作进度尚未就绪。' }}</p><button type="button" :disabled="busy" @click="emit('refresh')">重新读取</button></div>
        </div>
      </section>
    </Transition>
  </Teleport>
</template>

<style>
.workspace-guidance-popover { position:fixed;z-index:180;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--color-line);border-top:3px solid var(--color-jade);border-radius:var(--radius-panel);background:var(--color-surface);color:var(--color-ink);box-shadow:0 12px 36px #0002;font:400 var(--form-text)/1.5 var(--sans);-webkit-app-region:no-drag; }
.workspace-guidance-popover:focus { outline:none; }
.workspace-guidance-popover>header { display:flex;align-items:center;justify-content:space-between;flex:none;padding:.75rem 1rem;border-bottom:1px solid var(--color-line); }
.workspace-guidance-popover>header>div { display:flex;align-items:center;gap:.5rem; }
.workspace-guidance-popover>header button { display:grid;place-items:center;width:2rem;height:2rem;border:0;background:transparent;color:inherit;cursor:pointer; }
.guidance-popover-content { min-height:0;overflow:auto;padding:1rem; }
.workspace-guidance-popover .workflow-next-step { margin:0;border:0;padding:0;background:transparent; }
.workspace-guidance-popover .workflow-next-step :is(p,button,summary,span) { font-family:var(--sans);font-size:var(--form-text); }
.workspace-guidance-popover .workflow-next-step p { color:var(--color-ink);line-height:1.7; }
.workspace-guidance-popover .workflow-next-step .control-button.primary { min-height:38px;color:var(--color-surface);background:var(--color-ink);border:1px solid var(--color-ink); }
.workspace-guidance-popover button:focus-visible,.workspace-guidance-popover summary:focus-visible { outline:2px solid var(--color-jade);outline-offset:2px; }
.workspace-guidance-popover-enter-active { transition:opacity var(--duration-panel) ease-out,transform var(--duration-panel) ease-out; }
.workspace-guidance-popover-leave-active { transition:opacity var(--duration-fast) ease-in,transform var(--duration-fast) ease-in; }
.workspace-guidance-popover-enter-from,.workspace-guidance-popover-leave-to { opacity:0;transform:translateY(-6px); }
</style>
