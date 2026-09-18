<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CompanionIllustration from './CompanionIllustration.vue'
import Live2DCompanion from './Live2DCompanion.vue'
import { CompanionController, nextBlinkDelay, springStep, type CompanionMode, type CompanionOptions, type CompanionState } from '../services/companion-controller'
const props = withDefaults(defineProps<{
  options: CompanionOptions; mode: CompanionMode; scope?: string; taskId?: string; taskStatus?: string;
  quiet?: boolean; focus?: boolean; scene?: 'library' | 'writing'; greeting?: string; pet?: boolean; action?: number
}>(), { scope: '', taskId: '', taskStatus: '', quiet: false, focus: false, scene: 'writing', greeting: '', action: 0 })
const emit = defineEmits<{ mode: [mode: CompanionMode] }>()
const controller = new CompanionController()
const host = ref<HTMLElement>()
const state = ref<CompanionState>('idle')
const blink = ref(false)
const gaze = ref({ x: 0, y: 0 })
const lift = ref(0)
const documentHidden = ref(false)
const isHidden = computed(() => props.mode === 'hidden' || (props.focus && props.options.focusAutoHide))
const animationPaused = computed(() => props.options.intensity === 0)
const label = computed(() => props.greeting || ({ idle: '在这里，陪你写。', curious: '需要我一起想想吗？', thinking: '正在整理你的想法', writing: '正在写下故事', success: '这一段已准备好，请审阅', warning: '遇到问题，请查看任务提示', sleeping: '慢慢来，故事在等你', hidden: '' })[state.value])
let frame = 0, timer = 0, lastFrame = 0, blinkAt = 0, blinkEnds = 0
let targetX = 0, targetY = 0, velocityX = 0, velocityY = 0, hovered = false
const now = () => performance.now()
function stop() { cancelAnimationFrame(frame); clearTimeout(timer); frame = 0; timer = 0; blink.value = false }
function sampleState() {
  state.value = controller.state(now(), { hidden: isHidden.value || documentHidden.value, quiet: props.quiet || props.focus, feedback: props.options.stateFeedback, hovered })
}
function tick(time: number) {
  const dt = (time - lastFrame) / 1000; lastFrame = time; sampleState()
  const thinking = state.value === 'thinking' ? -1.6 : 0
  const x = springStep(gaze.value.x, velocityX, targetX, dt)
  const y = springStep(gaze.value.y, velocityY, targetY + thinking, dt)
  velocityX = x.velocity; velocityY = y.velocity; gaze.value = { x: x.position, y: y.position }
  const intensity = props.options.intensity
  lift.value = Math.sin(time / (state.value === 'writing' ? 450 : 1100)) * (state.value === 'writing' ? 1.5 : 1) * intensity
  if (props.options.autoBlink && time >= blinkAt) { blink.value = true; blinkEnds = time + 130; blinkAt = time + nextBlinkDelay() }
  if (blink.value && time >= blinkEnds) blink.value = false
  frame = requestAnimationFrame(tick)
}
function restart() {
  stop(); sampleState(); gaze.value = { x: 0, y: 0 }; lift.value = 0; velocityX = 0; velocityY = 0
  if (isHidden.value || documentHidden.value) return
  if (animationPaused.value || props.focus) {
    const update = () => { sampleState(); timer = window.setTimeout(update, 2500) }
    timer = window.setTimeout(update, 2500); return
  }
  lastFrame = now(); blinkAt = lastFrame + nextBlinkDelay(); frame = requestAnimationFrame(tick)
}
function pointer(event: PointerEvent) {
  controller.interact(now())
  if (!props.options.followPointer || animationPaused.value || props.focus || !host.value || (!hovered && !props.pet)) return
  const bounds = host.value.getBoundingClientRect()
  targetX = Math.max(-2.2, Math.min(2.2, (event.clientX - bounds.left - bounds.width / 2) / 100))
  targetY = Math.max(-1.5, Math.min(1.5, (event.clientY - bounds.top - bounds.height / 2) / 100))
}
function center() { targetX = 0; targetY = 0; hovered = false }
function activity() { controller.interact(now()) }
function visibility() { documentHidden.value = document.hidden }
watch(() => [props.scope, props.taskId, props.taskStatus], () => {
  controller.update(props.scope, props.taskId, props.taskStatus, now()); sampleState()
})
watch([isHidden, documentHidden, animationPaused, () => props.focus, () => props.options], restart, { deep: true })
onMounted(() => {
  controller.update(props.scope, props.taskId, props.taskStatus, now()); controller.interact(now())
  visibility(); document.addEventListener('visibilitychange', visibility)
  window.addEventListener('pointermove', pointer, { passive: true }); window.addEventListener('blur', center)
  document.documentElement.addEventListener('pointerleave', center); document.addEventListener('keydown', activity, { passive: true })
  restart()
})
onBeforeUnmount(() => {
  stop(); document.removeEventListener('visibilitychange', visibility)
  window.removeEventListener('pointermove', pointer); window.removeEventListener('blur', center)
  document.documentElement.removeEventListener('pointerleave', center); document.removeEventListener('keydown', activity)
})
</script>
<template>
  <div v-if="isHidden" class="companion-restore" data-testid="companion-hidden"><button v-if="!focus" type="button" @click="emit('mode', 'chibi')">显示写作伙伴</button></div>
  <section v-else ref="host" class="companion-host" :class="[scene, mode, { pet }]" :data-state="state" :data-motion="animationPaused || focus ? 'quiet' : 'active'" data-testid="companion-host" aria-label="写作伙伴" @pointerenter="hovered = true" @pointerleave="center">
    <div class="companion-art" :style="{ transform: `translateY(${lift}px) rotate(${gaze.x * .3}deg)` }">
      <slot v-if="mode === 'detailed'" name="detailed" :state="state" :gaze="gaze"><Live2DCompanion :state="state" :blink="blink" :gaze-x="gaze.x" :gaze-y="gaze.y" :intensity="options.intensity" :action="action"/></slot>
      <CompanionIllustration v-else :state="state" :blink="blink" :gaze-x="gaze.x" :gaze-y="gaze.y"/>
    </div>
    <div v-if="!pet" class="companion-copy"><span class="companion-code">LJ / ARCHIVIST</span><b>{{ label }}</b><small>{{ mode === 'detailed' ? '岚笺档案员 · 写作陪伴' : '你的故事，由你决定。' }}</small></div>
    <div v-if="!pet" class="companion-modes" role="group" aria-label="看板娘模式">
      <button v-for="choice in (['detailed', 'chibi', 'hidden'] as const)" :key="choice" type="button" :aria-pressed="mode === choice" :data-testid="`companion-mode-${choice}`" @click="emit('mode', choice)">{{ { detailed: '精细', chibi: 'Q版', hidden: '隐藏' }[choice] }}</button>
    </div>
  </section>
</template>
<style scoped>
.companion-host{position:relative;display:grid;grid-template-columns:88px minmax(0,1fr);grid-template-rows:1fr auto;gap:4px 12px;min-width:0;height:144px;padding:8px 16px;border-bottom:1px solid var(--color-line);background:var(--color-paper);font:14px/1.5 var(--sans)}
.companion-art{grid-row:1 / -1;min-height:0;align-self:center;height:105px;pointer-events:none;transform-origin:center bottom;will-change:transform}
.companion-copy{min-width:0;align-self:center;display:grid;gap:4px}.companion-copy b{font-size:13px;font-weight:600;overflow-wrap:anywhere}.companion-copy small{font-size:11px;color:var(--color-muted)}
.companion-code{font:9px/1.5 var(--sans);letter-spacing:.16em;color:var(--color-muted)}
.companion-modes{display:flex;justify-content:flex-end;gap:0;padding-bottom:2px}.companion-modes button{min-height:28px;padding:3px 9px;border:1px solid var(--color-line);background:var(--color-surface);color:var(--color-ink);font:12px/1.4 var(--sans);cursor:pointer}.companion-modes button+button{border-left:0}.companion-modes button[aria-pressed=true]{color:var(--color-surface);background:var(--color-ink)}
.companion-host.detailed.writing{height:158px;grid-template-columns:78px minmax(0,1fr)}.detailed.writing .companion-art{height:139px}
.companion-host.library{height:100%;min-height:320px;grid-template: auto minmax(180px,1fr) auto / minmax(0,1fr);padding:24px;border:0;background:transparent}.library .companion-copy{grid-row:1;gap:8px}.library .companion-copy b{font:24px/1.5 var(--serif)}.library .companion-art{grid-row:2;justify-self:center;height:100%;max-height:400px;max-width:260px;width:100%}.library.chibi .companion-art{max-height:240px}.library .companion-modes{grid-row:3;justify-content:center}
.companion-restore{flex:none;min-height:0}.companion-restore:empty{display:none}.companion-restore button{display:block;margin:6px 12px 6px auto;min-height:28px;border:1px solid var(--color-line);padding:3px 8px;color:var(--color-muted);background:var(--color-surface);font:12px var(--sans)}
.companion-host.pet{display:block;height:auto;min-height:0;padding:0;border:0;background:none}.companion-host.pet .companion-art{height:auto;width:100%;max-height:none;aspect-ratio:1}.companion-host.pet.detailed .companion-art{aspect-ratio:2/3}
button:focus-visible{outline:2px solid var(--color-jade);outline-offset:2px}
@media(max-height:720px){.companion-host.writing{height:104px;grid-template-columns:60px minmax(0,1fr);padding:4px 10px}.writing .companion-art,.detailed.writing .companion-art{height:80px}.writing .companion-copy small,.writing .companion-code{display:none}.companion-host.library{min-height:200px;padding:16px}.library .companion-art{max-height:260px}}
.companion-host.pet.writing{height:auto;padding:0}.companion-host.pet.writing .companion-art{height:auto}
</style>
