<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DesktopPetCommand, DesktopPetState, DesktopPetRect, DesktopPetPanel } from '../../../../contracts/companion/desktop-pet'
import { desktopPetClient } from '../services/desktop-pet-client'
import { defaultCompanionOptions } from '../services/companion-controller'
import CompanionHost from './CompanionHost.vue'
import { usePetAnimation } from '../composables/use-pet-animation'
import { petPlaybackDuration, type PetAnimation } from '../services/pet-action-motion'
import { usePetBehavior } from '../composables/use-pet-behavior'
import { usePetReminder } from '../composables/use-pet-reminder'
import { usePetChatHistory } from '../composables/use-pet-chat-history'
import { petDragThreshold, petDragTilt } from '../services/pet-gesture'
import PetChatPanel from './PetChatPanel.vue'
import { useCompanionVoice } from '../composables/use-companion-voice'
import { useCompanionSettings } from '../composables/use-companion-settings'
import { usePetMicrophone } from '../composables/use-pet-microphone'
import PetMicrophoneControls from './PetMicrophoneControls.vue'
import PetCarePanel from './PetCarePanel.vue'
import PetSettingsPanel from './PetSettingsPanel.vue'
import PetRadialMenu from './PetRadialMenu.vue'
import type { PetRadialAction } from '../services/pet-radial-layout'
import { usePetCare } from '../composables/use-pet-care'
import { petCareFeedback, petCareStatus } from '../services/pet-care-feedback'
import { petLevel, type PetCareAction } from '../../../../contracts/companion/companion-care'

const state = ref<DesktopPetState | null>(null)
const error = ref('')
const loading = ref(true)
const busy = ref(false)
const menu = ref(false)
const menuPresent = ref(false)
let pendingMenuAction: PetRadialAction | undefined
const chat = ref(false)
const settingsPanel = ref(false), settingsActivity = ref({ busy: false, playing: false })
const settingsTab = ref<'pet' | 'voice'>('pet')
const carePanel = ref<'care' | 'focus' | null>(null)
const care = usePetCare()
const hidden = ref(document.hidden)
const shared = useCompanionSettings()
const dragging = ref(false), pressed = ref(false)
const animation = usePetAnimation()
let animationEpoch = 0
function cancelAnimation() { animationEpoch++; animation.cancel() }
const settling = ref(false)
let settlingTimer: ReturnType<typeof setTimeout> | undefined
function animationStarted(intent: PetAnimation, action: number) {
  if (intent === 'land' && settling.value) {
    clearTimeout(settlingTimer)
    settlingTimer = setTimeout(() => { settling.value = false }, petPlaybackDuration('land'))
  }
  animation.started(intent, action)
}
const dragTilt = ref(0)
let unsubscribeMotion: (() => void) | undefined
let motionSequence = -1
const message = ref('')
const handle = ref<HTMLButtonElement>()
let disposed = false, eventGeneration = 0, requestGeneration = 0
let unsubscribe: (() => void) | undefined
let messageTimer: ReturnType<typeof setTimeout> | undefined
let regionsFrame = 0, lastRegions = ''
let regionsObserver: ResizeObserver | undefined
const observedRegions = new Set<Element>()
let hoverValue: boolean | undefined
let drag: { pointerId: number; x: number; y: number; moved: boolean } | undefined
const context = computed(() => state.value?.context)
const workScope = computed(() => context.value?.scope || null)
const history = usePetChatHistory(workScope)
const voice = useCompanionVoice(workScope, { autoOpen: false, api: window.petVoice, pet: true, onChat: history.receive })
const microphone = usePetMicrophone(voice.input, workScope, voice.stop)
const chatStatus = computed(() => microphone.phase.value === 'recording' ? '正在录音 · 结束后本地转写' : microphone.phase.value === 'requesting' ? '正在打开麦克风…' : microphone.phase.value === 'transcribing' ? '正在本地识别…' : !voice.ready.value && voice.input.value ? '草稿已就绪，可修改后发送' : voice.stateLabel.value)
const reducedMotion = computed(() => shared.settings.value.reducedMotion || Boolean(context.value?.reducedMotion))
const options = computed(() => ({ ...defaultCompanionOptions,
  writingMode: 'chibi' as const,
  followPointer: context.value?.followPointer ?? false,
  autoBlink: context.value?.autoBlink ?? false,
  stateFeedback: context.value?.stateFeedback ?? false,
  intensity: reducedMotion.value ? 0 : context.value?.intensity ?? 0,
  focusAutoHide: true
}))
const isQuiet = computed(() => Boolean(context.value?.quiet) || options.value.intensity === 0)
const activePanel = computed<DesktopPetPanel | null>(() => settingsPanel.value ? 'settings' : chat.value ? 'chat' : carePanel.value ? 'care' : menuPresent.value ? 'menu' : null)
const panelReady = computed(() => Boolean(activePanel.value && state.value?.layout?.kind === activePanel.value))
function rectStyle(rect?: DesktopPetRect | null) { return rect ? { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`, right: 'auto', bottom: 'auto' } : undefined }
const behavior = usePetBehavior(computed(() => ({
  allowed: Boolean(state.value?.open && shared.settings.value.careEnabled && care.state.value && context.value?.stateFeedback)
    && !hidden.value && !context.value?.focusHidden && !isQuiet.value && !reducedMotion.value
    && !pressed.value && !dragging.value && !settling.value && !activePanel.value
    && !microphone.active.value && !voice.busy.value && !voice.playing.value && animation.intent.value === 'idle'
    && !care.state.value?.sleeping && care.state.value?.focus?.status !== 'running'
    && !['queued', 'preparing', 'running', 'resuming', 'streaming'].includes(context.value?.taskStatus ?? ''),
  energy: care.state.value?.energy ?? 100, mood: care.state.value?.mood ?? 50
})))
const speaking = computed(() => voice.playing.value || settingsActivity.value.playing)
usePetReminder(computed(() => ({
  minutes: state.value?.preferences.reminderMinutes ?? 0,
  enabled: Boolean(state.value?.open && shared.settings.value.voice.proactive) && !hidden.value,
  scope: workScope.value,
  blocked: Boolean(context.value?.quiet || context.value?.focusHidden || pressed.value || dragging.value || settling.value
    || activePanel.value || message.value || busy.value || care.busy.value || settingsActivity.value.busy
    || animation.intent.value !== 'idle' || behavior.intent.value !== 'idle' || microphone.active.value || voice.busy.value || speaking.value
    || shared.settings.value.careEnabled && (care.state.value?.sleeping || care.state.value?.focus?.status === 'running')
    || ['queued', 'preparing', 'running', 'resuming', 'streaming'].includes(context.value?.taskStatus ?? ''))
})), () => {
  if (!reducedMotion.value) animation.play('stretch')
  say('休息一下吧：看看远处、喝口水，让故事也喘口气。')
})
const intent = computed(() => dragging.value ? 'drag' : microphone.phase.value === 'recording' || microphone.phase.value === 'requesting' ? 'listening' : microphone.phase.value === 'transcribing' || voice.busy.value && !voice.playing.value || settingsActivity.value.busy && !speaking.value ? 'thinking' : animation.intent.value !== 'idle' ? animation.intent.value : shared.settings.value.careEnabled && care.state.value?.sleeping ? 'sleeping' : behavior.intent.value)
const statusText = computed(() => {
  const careStatus = petCareStatus(care.state.value, shared.settings.value.careEnabled)
  if (careStatus) return careStatus
  if (context.value?.quiet) return '安静陪写中'
  if (context.value?.taskStatus === 'streaming') return '正在写下故事'
  if (['queued', 'preparing', 'running', 'resuming'].includes(context.value?.taskStatus ?? '')) return '正在构思'
  if (behavior.intent.value === 'stretch') return '舒展一下身体'
  if (behavior.intent.value === 'greet') return '向你打个招呼'
  if (behavior.intent.value === 'thinking') return '安静待一会儿'
  return '陪你写作'
})

function receive(value: DesktopPetState) { if (!disposed) { eventGeneration += 1; state.value = value; loading.value = false } }
async function load() {
  const event = eventGeneration, request = ++requestGeneration
  loading.value = true; error.value = ''
  try { const value = await desktopPetClient.get(); if (!disposed && event === eventGeneration && request === requestGeneration) state.value = value }
  catch { if (!disposed && request === requestGeneration) error.value = '暂时无法读取桌面伙伴状态。可以重试，或从岚笺主窗口找回。' }
  finally { if (!disposed && request === requestGeneration) loading.value = false }
}
async function command(input: DesktopPetCommand, exclusive = true) {
  if (exclusive && busy.value) return
  const event = eventGeneration, request = ++requestGeneration
  if (exclusive) { busy.value = true; error.value = '' }
  try {
    const value = await desktopPetClient.command(input)
    if (!disposed && event === eventGeneration && request === requestGeneration) state.value = value
  } catch {
    if (!disposed) error.value = '这次操作未完成，请重试；若无法点击，请在岚笺主窗口找回伙伴。'
  } finally { if (!disposed && exclusive) busy.value = false }
}
function hover(interactive: boolean) {
  if (hoverValue === interactive || disposed) return
  hoverValue = interactive
  // Hover must not race authoritative preference acknowledgements into the view.
  void desktopPetClient.command({ type: 'hover', interactive }).catch(() => {
    if (!disposed) { hoverValue = undefined; error.value = '鼠标交互暂不可用，可在主窗口找回伙伴。' }
  })
}
function reportRegions() {
  regionsFrame = 0
  if (disposed) return
  const root = document.querySelector('[data-testid="desktop-pet-window"]')
  if (!root) return
  const targets = [...root.querySelectorAll<HTMLElement>('[data-pet-interactive]')]
  const watched = new Set<Element>([root, ...targets, ...root.querySelectorAll('.pet-stage,.pet-panel')])
  for (const element of observedRegions) if (!watched.has(element)) { regionsObserver?.unobserve(element); observedRegions.delete(element) }
  for (const element of watched) if (!observedRegions.has(element)) { regionsObserver?.observe(element); observedRegions.add(element) }
  const width = Math.min(innerWidth, 4096), height = Math.min(innerHeight, 4096)
  const regions = targets.flatMap(element => {
    const style = getComputedStyle(element), rect = element.getBoundingClientRect()
    if (style.display === 'none' || style.visibility !== 'visible' || style.pointerEvents === 'none' || Number(style.opacity) === 0) return []
    const x = Math.max(0, rect.left), y = Math.max(0, rect.top)
    const right = Math.min(width, rect.right), bottom = Math.min(height, rect.bottom)
    return right > x && bottom > y ? [{ x, y, width: right - x, height: bottom - y }] : []
  }).slice(0, 24)
  const signature = JSON.stringify(regions)
  if (signature === lastRegions) return
  lastRegions = signature
  // Main can unlock the window from the OS cursor even when Windows sends no
  // first forwarded mouse event. Rectangles never include the transparent root.
  void desktopPetClient.command({ type: 'regions', regions }).catch(() => {
    if (!disposed) { lastRegions = ''; error.value = '伙伴点击区域未能更新，可从主窗口找回后重试。' }
  })
}
function scheduleRegions() {
  if (!disposed && !regionsFrame) regionsFrame = requestAnimationFrame(reportRegions)
}
function pointer(event: MouseEvent) {
  if (event instanceof PointerEvent && event.buttons === 1 && drag && !drag.moved && petDragThreshold(drag, { x: event.screenX, y: event.screenY }, state.value?.preferences.scale)) {
    drag.moved = true
    if (state.value?.preferences.positionLocked) return
    cancelAnimation(); closeSettings(); closeCare(); closeChat(); closeMenu(true); dragging.value = true
    void command({ type: 'drag-start' }, false)
  }
  hover(dragging.value || Boolean(event.target instanceof Element && event.target.closest('[data-pet-interactive]')))
}
function leave() { if (!dragging.value) hover(false) }
function startDrag(event: PointerEvent) {
  if (event.button !== 0 || !state.value || busy.value) return
  cancelAnimation(); pressed.value = true
  clearTimeout(settlingTimer); settling.value = false
  if (microphone.active.value) microphone.cancel()
  handle.value?.focus()
  handle.value?.setPointerCapture(event.pointerId)
  drag = { pointerId: event.pointerId, x: event.screenX, y: event.screenY, moved: false }
  void command({ type: 'pointer-press', pressed: true }, false)
  hover(true)
}
function endDrag(event?: PointerEvent) {
  if (!drag || (event && event.pointerId !== drag.pointerId)) return
  const current = drag; drag = undefined; pressed.value = false; dragging.value = false; dragTilt.value = 0
  void command({ type: 'pointer-press', pressed: false }, false)
  if (current.moved && !reducedMotion.value && !isQuiet.value) { settling.value = true; settlingTimer = setTimeout(() => { settling.value = false }, petPlaybackDuration('land')) }
  if (handle.value?.hasPointerCapture(current.pointerId)) handle.value.releasePointerCapture(current.pointerId)
  void command({ type: 'drag-end' }, false)
  if (event?.type === 'pointerup' && !current.moved) pat()
}
async function toggleMenu() {
  closeSettings()
  carePanel.value = null
  if (chat.value) closeChat()
  pendingMenuAction = undefined
  menu.value = !menu.value
  if (menu.value) menuPresent.value = true
}
function closeMenu(immediate = false) {
  menu.value = false; pendingMenuAction = undefined
  if (immediate) menuPresent.value = false
  handle.value?.focus()
}
function requestMenuAction(action: PetRadialAction) { pendingMenuAction = action; menu.value = false }
function menuClosed() {
  menuPresent.value = false
  const action = pendingMenuAction; pendingMenuAction = undefined
  if (!action || !state.value?.open || hidden.value || dragging.value) { handle.value?.focus(); return }
  if (action === 'chat') void openChat()
  else if (action === 'care' || action === 'focus') openCare(action)
  else if (action === 'settings' || action === 'voice') openSettings(action === 'voice' ? 'voice' : 'pet')
  else if (action === 'pat') void pat()
  else if (action === 'handshake') handshake()
  else if (action === 'greet') { animation.play('greet'); say('向你打个招呼') }
  else if (action === 'food' || action === 'water') void careAction({ type: 'use', item: action })
  else if (action === 'sleep') void careAction({ type: care.state.value?.sleeping ? 'wake' : 'sleep' })
  else if (action === 'dice') dice()
  else if (action === 'inspiration') inspiration()
  else if (action === 'lock') void command({ type: 'configure', preferences: { ...state.value.preferences, positionLocked: !state.value.preferences.positionLocked } })
  else void command({ type: action === 'writing' ? 'return-to-writing' : 'hide' })
}
async function openChat() { closeSettings(); cancelAnimation(); endDrag(); carePanel.value = null; menu.value = false; chat.value = true; message.value = ''; if (!voice.ready.value) await voice.open(); scheduleRegions() }
function openCare(panel: 'care'|'focus') { closeSettings(); endDrag(); closeChat(); menu.value = false; message.value = ''; carePanel.value = panel }
function closeCare() { carePanel.value = null; handle.value?.focus() }
function openSettings(tab: 'pet' | 'voice' = 'pet') { cancelAnimation(); endDrag(); closeCare(); closeChat(true); closeMenu(true); message.value = ''; settingsTab.value = tab; settingsPanel.value = true }
function closeSettings() { settingsPanel.value = false; settingsActivity.value = { busy: false, playing: false } }
async function careAction(action: PetCareAction) {
  const scope = workScope.value, epoch = animationEpoch
  const completed = await care.act(action)
  if (disposed || hidden.value || dragging.value || scope !== workScope.value || epoch !== animationEpoch) return
  if (!completed) {
    if (care.error.value && !activePanel.value) openCare('care')
    return
  }
  if (action.type === 'use' && action.item === 'food') animation.play('eating')
  if (action.type === 'use' && action.item === 'water') animation.play('drinking')
  if (action.type === 'use' && action.item === 'toy') animation.play('playing')
  if (action.type === 'claim-daily') animation.play('success')
  if (action.type === 'sleep') animation.play('sleeping')
  if (action.type === 'wake') cancelAnimation()
  say(petCareFeedback(action))
}
function retryCare() { const action = care.pendingAction; if (action) void careAction(action); else void care.load() }
function closeChat(release = false) { microphone.cancel(); chat.value = false; if (release) voice.close(); else voice.stop(); handle.value?.focus() }
function clearChat() { microphone.cancel(); microphone.discardAlternative(); voice.close(); history.clear(); voice.input.value = ''; if (chat.value && !hidden.value) void voice.open() }
function escape() { if (microphone.active.value) microphone.cancel(); else if (settingsPanel.value) { closeSettings(); handle.value?.focus() } else if (carePanel.value) closeCare(); else if (menu.value) closeMenu(); else if (chat.value) closeChat(); else { message.value = ''; voice.stop() } }
async function sendChat() { if (microphone.active.value) return; if (!voice.ready.value) await voice.open(); if (!disposed && chat.value && !hidden.value) await voice.run() }
function visibility() { hidden.value = document.hidden; if (hidden.value) { cancelAnimation(); endDrag(); closeSettings(); closeCare(); closeChat(true); closeMenu(true); voice.input.value = ''; microphone.alternative.value = ''; message.value = ''; clearTimeout(settlingTimer); settling.value = false } }
function say(text: string) { clearTimeout(messageTimer); message.value = text; messageTimer = setTimeout(() => { message.value = '' }, 8000) }
function animatePet() {
  animation.play('pat')
}
async function pat() {
  if (activePanel.value || voice.busy.value || speaking.value) return
  say('收到摸摸'); animatePet()
  if (shared.settings.value.careEnabled) void care.act({ type: 'pat' })
}
function handshake() { closeMenu(); say('握手动作暂未启用') }
function dice() { closeMenu(); animation.play('playing'); say(`本地骰子 · ${1 + Math.floor(Math.random() * 6)} 点。把选择权交给灵感，也可以不听它的。`) }
const prompts = ['让一个配角说出此刻最不合时宜的真心话。', '给这一场景添一个声音，再让人物误会它。', '如果这段对话里有人在隐瞒一个小秘密呢？', '用一件普通物品，接住人物没说出口的情绪。', '让男主吐槽一句，再给对方一个更妙的回敬。', '回到人物眼前最想完成的那件小事。']
function inspiration() { closeMenu(); animation.play('playing'); say(`离线灵感签 · ${prompts[Math.floor(Math.random() * prompts.length)]}`) }
function blur() { cancelAnimation(); endDrag(); hover(false); voice.stop() }
watch(workScope, () => { cancelAnimation(); closeSettings(); closeCare(); closeMenu(true); closeChat(true); message.value = '' })
watch(() => animation.sequence.value, () => { clearTimeout(settlingTimer); settling.value = false }, { flush: 'sync' })
watch([() => shared.settings.value.careEnabled, () => care.state.value?.sleeping, () => care.state.value?.focus?.status], () => { clearTimeout(messageTimer); message.value = '' })
watch([() => care.state.value?.focus?.id, () => care.state.value?.focus?.status], ([id, status], [previousId, previousStatus]) => {
  if (!id || id !== previousId || previousStatus !== 'running' || status !== 'complete') return
  if (disposed || hidden.value || !state.value?.open || !shared.settings.value.careEnabled || context.value?.quiet || context.value?.focusHidden
    || pressed.value || dragging.value || microphone.active.value || voice.busy.value || speaking.value || settingsActivity.value.busy
    || animation.intent.value !== 'idle' || (activePanel.value && activePanel.value !== 'care')
    || ['queued', 'preparing', 'running', 'resuming', 'streaming'].includes(context.value?.taskStatus ?? '')) return
  if (!reducedMotion.value) animation.play('success')
  say('这一段专注完成了 · 奖励已入账')
})
watch(() => state.value?.open, (open, wasOpen) => {
  if (!open) { history.clear(); closeSettings(); closeCare(); closeMenu(true); closeChat(true) }
  else if (!wasOpen && !hidden.value && !care.state.value?.sleeping) animation.play('greet')
}, { flush: 'post' })
watch(activePanel, value => { void command({ type: 'panel', panel: value }, false) })
watch(() => state.value?.layout, () => {
  if (state.value?.layout?.kind === null && dragging.value) { closeSettings(); closeCare(); closeMenu(true); closeChat() }
  scheduleRegions()
}, { flush: 'post' })
watch(panelReady, value => { if (value) void nextTick(() => document.querySelector<HTMLElement>('.pet-side-panel textarea,.pet-side-panel button')?.focus()) })
watch(() => [pressed.value, animation.intent.value, behavior.intent.value, activePanel.value, microphone.active.value, voice.busy.value, speaking.value], () => {
  void desktopPetClient.command({ type: 'interaction', busy: Boolean(pressed.value || animation.intent.value !== 'idle' || behavior.intent.value !== 'idle' || activePanel.value || microphone.active.value || voice.busy.value || speaking.value) }).catch(() => {})
}, { flush: 'sync' })
watch(() => [menu.value, chat.value, carePanel.value, microphone.phase.value, voice.text.value, message.value, error.value, loading.value, state.value?.error, context.value?.mode,
  context.value?.focusHidden, state.value?.open, state.value?.preferences.scale], scheduleRegions, { flush: 'post' })
onMounted(() => {
  unsubscribeMotion = window.desktopPet?.onMotion?.(motion => {
    if (motion.sequence <= motionSequence) return
    motionSequence = motion.sequence
    dragTilt.value = motion.dragging && dragging.value ? petDragTilt(motion.velocityX, Boolean(context.value?.reducedMotion) || isQuiet.value) : 0
  })
  try { unsubscribe = desktopPetClient.onState(receive) } catch { error.value = '桌面伙伴连接暂不可用。请从主窗口重新打开。' }
  window.addEventListener('pointermove', pointer, { passive: true })
  document.addEventListener('visibilitychange', visibility)
  // Electron's transparent-window forwarding guarantees mousemove, not
  // pointermove. Keep both; hover() deduplicates the resulting IPC updates.
  window.addEventListener('mousemove', pointer, { passive: true }); window.addEventListener('blur', blur)
  document.documentElement.addEventListener('pointerleave', leave)
  regionsObserver = new ResizeObserver(scheduleRegions)
  window.addEventListener('resize', scheduleRegions)
  document.addEventListener('scroll', scheduleRegions, { passive: true, capture: true })
  void nextTick().then(scheduleRegions)
  void load()
})
onBeforeUnmount(() => {
  endDrag(); disposed = true; requestGeneration += 1; unsubscribe?.(); unsubscribeMotion?.()
  clearTimeout(messageTimer); clearTimeout(settlingTimer)
  clearTimeout(settlingTimer)
  cancelAnimationFrame(regionsFrame); regionsObserver?.disconnect(); observedRegions.clear()
  document.removeEventListener('visibilitychange', visibility)
  window.removeEventListener('pointermove', pointer); window.removeEventListener('mousemove', pointer); window.removeEventListener('blur', blur)
  document.documentElement.removeEventListener('pointerleave', leave)
  window.removeEventListener('resize', scheduleRegions); document.removeEventListener('scroll', scheduleRegions, true)
})
</script>

<template>
  <main class="desktop-pet-window" :class="{ quiet: isQuiet || reducedMotion, dragging }" data-testid="desktop-pet-window" @keydown.esc.stop="escape">
    <section v-if="!state" class="connection-card" data-pet-interactive aria-live="polite"><b>岚笺 · 桌面伙伴</b><p>{{ loading ? '正在连接伙伴…' : error || '伙伴暂不可用' }}</p><button v-if="!loading" type="button" @click="load">重新连接</button></section>
    <template v-else>
      <div v-if="panelReady" class="pet-side-panel" :class="{ radial: state.layout?.kind === 'menu' }" :data-side="state.layout?.side" :style="rectStyle(state.layout?.panel)" data-testid="pet-side-panel">
      <PetRadialMenu v-if="menuPresent" :open="menu" :width="state.layout!.panel!.width" :height="state.layout!.panel!.height" :pet-width="state.layout!.pet.width" :pet-height="state.layout!.pet.height" :reduced="reducedMotion" :care-enabled="shared.settings.value.careEnabled" :care-ready="Boolean(care.state.value)" :busy="care.busy.value || busy" :sleeping="Boolean(care.state.value?.sleeping)" :food="care.state.value?.inventory.food ?? 0" :water="care.state.value?.inventory.water ?? 0" :locked="state.preferences.positionLocked" @action="requestMenuAction" @close="closeMenu()" @closed="menuClosed" @layout="scheduleRegions" />
      <PetChatPanel v-if="chat" class="pet-chat-overlay" :input="voice.input.value" :turns="history.turns.value" :status="chatStatus" :error="voice.error.value" :busy="voice.busy.value || microphone.active.value" :playing="voice.playing.value" :ready="!microphone.active.value" @update:input="voice.input.value = $event" @send="sendChat" @stop="microphone.cancel(); voice.stop()" @retry="voice.open" @close="closeChat()" @clear="clearChat">
        <template #input-tools><PetMicrophoneControls :enabled="shared.settings.value.microphone.enabled" :mode="shared.settings.value.microphone.mode" :phase="microphone.phase.value" :seconds="microphone.seconds.value" :level="microphone.level.value" :error="microphone.error.value" :alternative="microphone.alternative.value" @start="microphone.start" @finish="microphone.finish" @cancel="microphone.cancel" @use-alternative="microphone.useAlternative" @discard-alternative="microphone.discardAlternative" @settings="openSettings" /></template>
      </PetChatPanel>
      <PetCarePanel v-if="carePanel" :initial="carePanel" :state="care.state.value" :busy="care.busy.value" :error="care.error.value" @act="careAction" @close="closeCare" @retry="retryCare" @reload="care.load" @settings="openSettings" @dice="closeCare(); dice()" @inspiration="closeCare(); inspiration()" />
      <PetSettingsPanel v-if="settingsPanel" :initial-tab="settingsTab" @close="closeSettings(); handle?.focus()" @activity="settingsActivity = $event" />
      </div>
      <aside v-if="error || state.error" class="error-card" data-pet-interactive role="alert"><span>{{ error || state.error }}</span><button type="button" :disabled="busy" @click="load">重试</button><button type="button" @click="error = ''; command({type:'locate'})">找回伙伴</button></aside>
      <div v-if="voice.playing.value && voice.text.value && shared.settings.value.voice.subtitles && !activePanel" class="speech" data-pet-interactive role="status" data-testid="pet-spoken-caption"><p>{{ voice.text.value }}</p><button type="button" aria-label="停止伙伴语音" @click="voice.stop()">×</button></div>
      <div class="pet-stage" :class="{ settling, speaking }" :style="{ '--pet-size': state.preferences.scale, '--pet-art-height': `${state.layout ? state.layout.pet.height - 32 : 240 * state.preferences.scale}px`, ...rectStyle(state.layout?.pet) }" data-testid="desktop-pet-stage">
        <button ref="handle" class="pet-body" type="button" data-pet-interactive data-testid="pet-window-handle" aria-label="拖动移动伙伴，点击摸摸，右键打开互动菜单" :class="{ locked: state.preferences.positionLocked }" :aria-expanded="menu" @pointerdown.prevent="startDrag" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag" @click="($event.detail === 0) && pat()" @contextmenu.prevent="toggleMenu" @keydown.shift.f10.prevent="toggleMenu">
          <CompanionHost :options="options" mode="chibi" :scope="context?.scope" :task-id="context?.taskId" :task-status="context?.taskStatus" :quiet="Boolean(context?.quiet) || dragging" :desktop-motion="true" :tilt="dragTilt" :settling="settling" :focus="context?.focusHidden || hidden" :action="animation.sequence.value" :speaking="speaking" :intent="intent" pet @started="animationStarted" />
          <span v-if="shared.settings.value.careEnabled && petLevel(care.state.value?.experience ?? 0) >= 3" class="pet-star" aria-label="知己星光装饰">✦</span>
        </button>
        <button class="pet-caption" type="button" data-pet-interactive data-testid="pet-window-menu-toggle" :aria-expanded="menu" :title="message || '展开伙伴功能'" aria-label="展开或收起伙伴功能" @click="toggleMenu"><i aria-hidden="true"/><span role="status" data-testid="pet-status">{{ speaking ? '正在说话' : message || statusText }}</span><b aria-hidden="true">{{ menu ? '×' : '···' }}</b></button>
      </div>
    </template>
  </main>
</template>

<style>
/* Same archive palette/font stack as desktop.css; this transparent entry does not load workspace layout styles. */
:root{--sans:'Noto Sans SC','Source Han Sans SC','Microsoft YaHei',sans-serif;--color-paper:#f2eee4;--color-surface:#faf7ef;--color-ink:#1b211e;--color-line:#d5cebf;--color-muted:#79817b;--color-jade:#315c52;--color-danger:#983b31}
html,body,#pet-app{margin:0;width:100%;height:100%;background:transparent!important;overflow:hidden}
body{font-family:var(--sans);color:var(--color-ink);-webkit-font-smoothing:antialiased}
*,*::before,*::after{box-sizing:border-box}
</style>
<style scoped>
.desktop-pet-window{position:relative;width:100%;height:100%;background:transparent;user-select:none;font:13px/1.65 var(--sans)}
button{font:inherit;cursor:pointer;color:var(--color-ink);background:var(--color-surface);border:1px solid var(--color-line);border-radius:8px;min-height:34px;padding:6px 10px}
button:disabled{opacity:.5;cursor:default}button:hover:not(:disabled){background:#edf3ea;border-color:#b8ccbb}button:focus-visible{outline:2px solid var(--color-jade);outline-offset:2px}
.pet-stage{position:absolute;right:10px;bottom:8px;width:calc(230px * var(--pet-size,1));display:grid;grid-template-columns:minmax(0,1fr);justify-items:center;gap:0}
.pet-body{position:relative;display:block;width:100%;min-width:0;padding:0;min-height:0;border:0;background:transparent!important;cursor:grab;touch-action:none}
.pet-body.locked{cursor:pointer}
.dragging .pet-body{cursor:grabbing}.pet-body :deep(.companion-host){pointer-events:none}.pet-body :deep(.companion-host.chibi.pet){width:100%;height:var(--pet-art-height,240px)}.pet-body :deep(.companion-host.chibi.pet .companion-art){width:100%;height:100%;max-height:100%;will-change:auto}
.pet-caption{display:flex;align-items:center;justify-content:center;gap:8px;max-width:100%;height:32px;min-height:32px;padding:0 11px;border:1px solid var(--color-line);border-radius:16px;background:var(--color-surface);box-shadow:0 3px 12px #1b211e0e;font:500 12px/1.4 var(--sans);letter-spacing:.02em;white-space:nowrap}
.pet-caption span{color:var(--color-ink);overflow:hidden;text-overflow:ellipsis}.pet-caption i{flex:none;width:5px;height:5px;border-radius:50%;background:var(--color-jade)}.pet-caption b{font-family:inherit;font-size:16px;font-weight:500;line-height:1;flex:none;color:var(--color-jade)}
.pet-star{position:absolute;top:20%;right:10%;color:#b59445;font-size:20px}
.pet-panel{position:absolute;z-index:5;inset:8px 8px auto;padding:15px;display:grid;gap:10px;max-height:calc(100% - 16px);overflow:auto;scrollbar-width:thin;border:1px solid var(--color-line);border-radius:16px;background:var(--color-surface);box-shadow:0 8px 25px #203f2b1a}
.pet-panel header{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:2px}.pet-panel header>div{display:grid;gap:3px}.pet-panel header small{font-size:12px;color:var(--color-muted)}.pet-panel header b{font-size:16px;font-weight:600}.pet-panel header button{border:0;min-width:32px;padding:3px;background:transparent;font-size:20px}
.pet-panel .chat-entry{display:flex;justify-content:space-between;align-items:center;background:var(--color-jade);color:white;border:0;padding:12px;font-size:14px}.chat-entry span{font-size:12px;opacity:.85}
.action-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.play-row{display:flex;gap:8px}.play-row button{flex:1}.hide-entry{color:var(--color-muted);border:0;background:transparent}.menu-result{margin:0;padding:10px;background:var(--color-paper);border-radius:8px;font-size:13px;line-height:1.8}
.pet-chat-overlay{position:absolute;z-index:8;inset:8px 8px auto;height:calc(100% - 112px)}
.pet-side-panel{position:absolute;z-index:8;min-width:0;min-height:0}.pet-side-panel.radial{pointer-events:none}.pet-side-panel>.pet-panel,.pet-side-panel>.pet-chat-overlay,.pet-side-panel :deep(.care-panel){position:relative;inset:auto;width:100%;height:100%;max-height:100%}
.speech,.error-card,.connection-card{position:absolute;z-index:6;inset-inline:10px;top:10px;padding:14px;background:var(--color-surface);border:1px solid var(--color-line);border-radius:14px;box-shadow:0 6px 20px #203f2b18;font-size:13px;line-height:1.8;max-height:calc(100% - 20px);overflow:auto;scrollbar-width:thin}
.speech{top:auto;bottom:64%;display:flex;align-items:flex-start;gap:8px}.speech p{margin:0;flex:1}.speech button{flex:none;padding:0 6px;min-height:28px;border:0}.error-card{border-color:#b4473e;display:flex;flex-wrap:wrap;gap:8px}.error-card span{flex-basis:100%}
</style>
