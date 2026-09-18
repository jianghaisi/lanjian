<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import Live2DCompanion from './Live2DCompanion.vue'
import CompanionDialoguePanel from './CompanionDialoguePanel.vue'
import CompanionConversation from './CompanionConversation.vue'
import CompanionNotice from './CompanionNotice.vue'
import { useCompanionPresence } from '../composables/use-companion-presence'
import { createCompanionHold } from '../services/companion-hold'
import { companionHoldHintMs, companionHoldMs } from '../../../../contracts/companion/companion-presence'
import { placeCompanionDialogue } from '../services/companion-dialogue-placement'
import { placeCompanionComposer } from '../services/companion-composer-placement'
import { useCompanionDialogueAppearance } from '../composables/use-companion-dialogue-appearance'
const { preferences: dialogueAppearance } = useCompanionDialogueAppearance()

const props = withDefaults(defineProps<{ gazeX?: number; gazeY?: number; continueWorkId?: string | null; continueIntent?:boolean }>(), { gazeX: 0, gazeY: 0, continueWorkId: null, continueIntent:false })
const emit = defineEmits<{ unavailable: [] }>()
const puppet = ref<HTMLElement>()
const live = ref<InstanceType<typeof Live2DCompanion>>()
const panel = ref<InstanceType<typeof CompanionDialoguePanel>>()
const placement = ref('above')
let resizeObserver: ResizeObserver | undefined
let mutationObserver: MutationObserver | undefined
let repositionFrame = 0
let panelObserver: ResizeObserver | undefined
const panelHeight = ref(112)
const composerHeight = ref(140)
const composerStyle = ref<Record<string, string>>({})
const draft = ref('')

const speaking = ref(false)
const presence = useCompanionPresence(toRef(props,'continueWorkId'),toRef(props,'continueIntent'),speaking)
const holding = ref(false), noticeHeight = ref(112)
const hold = createCompanionHold(() => { void talk() }, value => { holding.value = value }, () => { void acknowledge() })
const holdStyle = { '--hold-fill-duration': `${companionHoldMs - companionHoldHintMs}ms` }
let pointerOrigin: {x:number;y:number;id:number} | undefined
let heldKey: string | undefined
function startHold(event: PointerEvent) {
  if (event.button !== 0 || !event.isPrimary || pointerOrigin || heldKey || speaking.value || document.querySelector('dialog[open]')) return
  pointerOrigin = {x:event.clientX,y:event.clientY,id:event.pointerId}; hold.start()
}
function cancelHold() { pointerOrigin=undefined; heldKey=undefined; hold.cancel() }
function releasePointer(event: PointerEvent) {
  if (!pointerOrigin || pointerOrigin.id !== event.pointerId || event.button !== 0) return
  pointerOrigin = undefined
  hold.release()
}
function moveHold(event: PointerEvent) { if(pointerOrigin?.id === event.pointerId && Math.hypot(event.clientX-pointerOrigin.x,event.clientY-pointerOrigin.y)>8) cancelHold() }
function holdKey(event: KeyboardEvent) {
  if(event.isComposing || event.keyCode===229 || !['Enter',' '].includes(event.key)) return
  event.preventDefault()
  if(!event.repeat && !speaking.value && !pointerOrigin && !heldKey && !document.querySelector('dialog[open]')) { heldKey=event.key; hold.start() }
}
function releaseKey(event: KeyboardEvent) {
  if (heldKey !== event.key) return
  event.preventDefault()
  if (event.isComposing || event.keyCode === 229) { cancelHold(); return }
  heldKey = undefined
  hold.release()
}
const responding = ref(false)
const blink = ref(false)
const action = ref(0)
const dialogueStyle = ref<Record<string, string>>({})
let blinkTimer = 0
let responseTimer = 0
let responseRevision = 0


function updateDialogueAnchor() {
  if (!speaking.value && !presence.visible.value) return
  const stage = document.querySelector<HTMLElement>('.library-companion-stage')
  if (!stage) return
  const bounds = stage.getBoundingClientRect()
  const rects = live.value?.getProtectionRects() || []
  const safe = { left: 0, top: bounds.top, right: window.innerWidth, bottom: Math.min(bounds.bottom, window.innerHeight) }
  const composer = placeCompanionComposer(safe, bounds, composerHeight.value)
  composerStyle.value = {
    insetInlineStart: `${composer.left}px`, insetBlockEnd: `${window.innerHeight - composer.bottom}px`,
    inlineSize: `${composer.width}px`, maxBlockSize: `${Math.max(1, safe.bottom - safe.top - 24)}px`
  }
  const result = placeCompanionDialogue({
    safe, protectedUi: speaking.value ? [composer] : [],
    stage: bounds, character: rects, preference: dialogueAppearance.value.placement,
    desired: { width: dialogueAppearance.value.width, height: speaking.value ? panelHeight.value : noticeHeight.value }
  })
  if (result.kind === 'unavailable') { if(speaking.value) {closeDialogue(false); emit('unavailable')} else presence.cancel(); return }
  placement.value = result.kind
  dialogueStyle.value = {
    insetInlineStart: `${result.left}px`, insetBlockStart: `${result.top}px`,
    inlineSize: `${result.width}px`, maxBlockSize: `${Math.min(dialogueAppearance.value.maxHeight, Math.max(140, bounds.height * .46))}px`,
    '--dialogue-opacity': `${dialogueAppearance.value.opacity * 100}%`, '--dialogue-font-size': `${dialogueAppearance.value.fontSize}px`
  }
}
function requestReposition() {
  cancelAnimationFrame(repositionFrame)
  repositionFrame = requestAnimationFrame(updateDialogueAnchor)
}
function closeDialogue(restoreFocus = true) {
  panelObserver?.disconnect()
  speaking.value = false
  if (restoreFocus) puppet.value?.querySelector<HTMLElement>('.character-hit-area')?.focus({ preventScroll: true })
}
function suspendForModal() {
  if (document.querySelector('dialog[open]')) { cancelHold(); presence.cancel(); if(speaking.value) closeDialogue(false) }
}
function suspendForBlur() { cancelHold() }

function scheduleBlink() {
  window.clearTimeout(blinkTimer)
  blinkTimer = window.setTimeout(async () => {
    blink.value = true
    await nextTick()
    blink.value = false
    scheduleBlink()
  }, 2800 + Math.round(Math.random() * 2600))
}

async function acknowledge() {
  const revision = ++responseRevision
  window.clearTimeout(responseTimer)
  responding.value = false
  action.value += 1
  presence.tap()
  await nextTick()
  if (revision !== responseRevision) return
  responding.value = true
  responseTimer = window.setTimeout(() => { responding.value = false }, 780)
}

async function talk() {
  presence.cancel()
  speaking.value = true
  updateDialogueAnchor()
  if (!speaking.value) return
  await nextTick()
  panelObserver?.disconnect()
  if (panel.value?.element) {
    // ResizeObserver follows rendered text. Only the floating bubble is repositioned.
    panelObserver = new ResizeObserver(() => {
      const height = panel.value?.element?.getBoundingClientRect().height || 112
      if (Math.abs(panelHeight.value - height) < .5) return
      panelHeight.value = height
      updateDialogueAnchor()
    })
    panelObserver.observe(panel.value.element)
    panelHeight.value = panel.value.element.getBoundingClientRect().height
    updateDialogueAnchor()
  }
}
function measureComposer(height: number) {
  if (Math.abs(composerHeight.value - height) < .5) return
  composerHeight.value = height
  requestReposition()
}
function measureNotice(height:number) { if(Math.abs(noticeHeight.value-height)>.5) {noticeHeight.value=height; requestReposition()} }

watch(dialogueAppearance, requestReposition, { deep: true })
watch(presence.visible,updateDialogueAnchor)
watch(() => props.continueWorkId, () => { cancelHold(); draft.value = '' })
onMounted(() => {
  scheduleBlink()
  const stage = puppet.value?.closest<HTMLElement>('.library-companion-stage')
  resizeObserver = new ResizeObserver(requestReposition)
  if (stage) resizeObserver.observe(stage)
  mutationObserver = new MutationObserver(() => { suspendForModal(); requestReposition() })
  if (stage) mutationObserver.observe(stage, { attributes: true, subtree: true, attributeFilter: ['style', 'data-ready'] })
  mutationObserver.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['open'] })
  window.addEventListener('resize', requestReposition)
  window.addEventListener('blur',suspendForBlur)
  puppet.value?.addEventListener('transitionend', requestReposition)
  window.visualViewport?.addEventListener('resize', requestReposition)
})
onBeforeUnmount(() => {
  responseRevision++
  cancelHold(); window.removeEventListener('blur',suspendForBlur)
  for (const timer of [blinkTimer, responseTimer]) window.clearTimeout(timer)
  window.removeEventListener('resize', requestReposition)
  puppet.value?.removeEventListener('transitionend', requestReposition)
  window.visualViewport?.removeEventListener('resize', requestReposition)
  resizeObserver?.disconnect(); panelObserver?.disconnect(); mutationObserver?.disconnect(); cancelAnimationFrame(repositionFrame)
})
</script>

<template>
  <section ref="puppet" class="archive-character-puppet" :class="{ speaking, responding }" :data-action="action" data-testid="interactive-archive-character">
    <Live2DCompanion ref="live" class="character-live2d" state="idle" :blink="blink" :gaze-x="gazeX" :gaze-y="gazeY" :intensity="0" :action="action" />
    <button class="character-hit-area" :class="{'is-holding':holding}" type="button" aria-label="点按互动，长按 3 秒和岚笺档案员聊天" title="点按互动；长按 1 秒显示提示，累计 3 秒打开聊天；支持空格或回车" data-testid="archive-character-talk" :data-holding="holding" @pointerdown="startHold" @pointermove="moveHold" @pointerup="releasePointer" @pointerleave="cancelHold" @pointercancel="cancelHold" @lostpointercapture="cancelHold" @blur="cancelHold" @keydown="holdKey" @keyup="releaseKey" @click.prevent><span v-if="holding" class="hold-progress" :style="holdStyle" aria-hidden="true">继续按住 · 满 3 秒聊天<i /></span></button>
    <Teleport to="body">
      <Transition name="character-dialogue">
        <CompanionDialoguePanel v-if="speaking" ref="panel" :style="dialogueStyle" :placement="placement" data-anchor="stage-safe" @close="closeDialogue">
          <CompanionConversation v-model:draft="draft" :continue-work-id="continueWorkId" :composer-style="composerStyle" @composer-height="measureComposer" @close="closeDialogue" />
        </CompanionDialoguePanel>
      </Transition>
      <Transition name="character-dialogue">
        <CompanionNotice v-if="presence.visible.value && !speaking" :style="dialogueStyle" :text="presence.caption.value" :status="presence.status.value" :playing="presence.playing.value" @height="measureNotice" @close="presence.cancel" />
      </Transition>
    </Teleport>
  </section>
</template>

<style scoped>
.archive-character-puppet{position:relative;isolation:isolate;transform-origin:50% 72%;will-change:transform}
.hold-progress{position:absolute;inset-inline-start:30%;inset-block-start:28%;display:grid;gap:.35rem;min-inline-size:7rem;padding:.5rem .65rem;border:1px solid var(--jade);background:color-mix(in srgb,var(--surface) 85%,transparent);color:var(--ink);font:.6rem/1.4 var(--sans);pointer-events:none}.hold-progress i{block-size:2px;background:var(--jade);transform-origin:left;animation:hold-fill var(--hold-fill-duration) linear both}@keyframes hold-fill{from{transform:scaleX(.333333)}to{transform:scaleX(1)}}
.character-live2d{position:absolute;z-index:1;inset:0;filter:contrast(1.035) drop-shadow(.75rem .35rem 1rem #29312b24);transform-origin:50% 58%}
.responding .character-live2d{animation:character-acknowledge .72s cubic-bezier(.2,.78,.18,1)}
.character-hit-area{position:absolute;z-index:7;inset-block:1.5% 0;inset-inline-start:8%;inset-inline-end:24%;padding:0;border:0;background:transparent;clip-path:polygon(38% 0,66% 0,72% 13%,84% 27%,82% 43%,96% 73%,86% 100%,14% 100%,4% 72%,20% 43%,18% 26%,34% 13%);cursor:pointer;pointer-events:auto}.character-hit-area:focus-visible{outline:.18rem solid #d88931;outline-offset:-.45rem}
.character-dialogue-enter-active{animation:dialogue-in .28s cubic-bezier(.18,.78,.2,1)}.character-dialogue-leave-active{transition:opacity .2s ease,transform .2s ease}.character-dialogue-leave-to{opacity:0;transform:translateY(-.35rem)}
@keyframes dialogue-in{0%{opacity:0;transform:translateY(-.25rem)}100%{opacity:1;transform:none}}
@keyframes character-acknowledge{0%,100%{transform:translateY(0) scale(1)}28%{transform:translateY(-.5%) scale(1.012)}58%{transform:translateY(.15%) scale(.997)}}
</style>
