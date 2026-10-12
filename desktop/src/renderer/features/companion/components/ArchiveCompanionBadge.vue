<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronDown } from '@lucide/vue'
import portrait from '../../../assets/visuals/character-q-current.png'
import { useCompanionSettings } from '../composables/use-companion-settings'
import { desktopPetClient } from '../services/desktop-pet-client'
import type { DesktopPetContext, DesktopPetState } from '../../../../contracts/companion/desktop-pet'
import type { CompanionMode } from '../services/companion-controller'
import { CompanionController, type CompanionOptions, type CompanionState } from '../services/companion-controller'

const props = defineProps<{ options: CompanionOptions; scope: string; suspended?: boolean; taskId: string; taskStatus: string; quiet: boolean; focus: boolean }>()
const emit = defineEmits<{ settings: []; write: []; mode: [mode: CompanionMode] }>()
const petState = ref<DesktopPetState | null>(null)
const petOpen = computed(() => petState.value?.open ?? false)
const petMenu = ref(false)
const petError = ref('')
const petBusy = ref(false)
const controls = ref<HTMLElement>(), toolsButton = ref<HTMLButtonElement>(), menuElement = ref<HTMLElement>()
let menuTrigger: HTMLElement | undefined
const petStatus = computed(() => {
  const current = petState.value
  if (!current) return '正在连接桌宠…'
  if (!current.enabled) return '桌宠已关闭 · 开启后记住选择'
  if (!current.open || current.context.mode === 'hidden' || current.context.focusHidden) return '桌宠暂时隐藏'
  return `桌宠已开启${current.preferences.clickThrough ? ' · 鼠标穿透中' : ''}${current.preferences.positionLocked ? ' · 位置已锁定' : ''}`
})
const { settings } = useCompanionSettings()
const media = window.matchMedia('(prefers-reduced-motion: reduce)')
const reduced = ref(media.matches)
const mediaChange = () => { reduced.value = media.matches; void publishContext() }
let unsubscribePet: (() => void) | undefined, unsubscribeAction: (() => void) | undefined
let mounted = false
function petContext(): DesktopPetContext {
  return { mode: props.options.writingMode, scope: props.suspended ? '' : props.scope, taskId: props.taskId, taskStatus: props.taskStatus,
    quiet: props.quiet, reducedMotion: reduced.value || settings.value.reducedMotion, followPointer: props.options.followPointer,
    autoBlink: props.options.autoBlink, stateFeedback: props.options.stateFeedback, intensity: props.options.intensity, focusHidden: props.focus && props.options.focusAutoHide }
}
async function publishContext() {
  if (!mounted || !desktopPetClient.available()) return
  try { petState.value = await desktopPetClient.updateContext(petContext()) }
  catch { petError.value = '桌宠连接暂不可用，点击“找回桌宠”重试。' }
}
async function petCommand(type: 'toggle' | 'locate' | 'hide') {
  if (petBusy.value) return
  const fromMenu = petMenu.value
  petBusy.value = true
  try {
    await publishContext(); petState.value = await desktopPetClient.command({ type }); petError.value = ''
    closeMenu()
  } catch {
    petError.value = type === 'locate' ? '找回未能保存，请重试。' : '桌宠开关未能保存，请重试。'
    petMenu.value = true
  } finally {
    petBusy.value = false
    await nextTick()
    if (petMenu.value) menuElement.value?.querySelector<HTMLButtonElement>('button')?.focus()
    else if (fromMenu) closeMenu(true)
  }
}
function closeMenu(restoreFocus = false) {
  petMenu.value = false
  if (restoreFocus) (menuTrigger?.isConnected ? menuTrigger : toolsButton.value)?.focus()
}
async function toggleMenu(event?: Event) {
  if (petMenu.value) { closeMenu(true); return }
  menuTrigger = event?.currentTarget instanceof HTMLElement ? event.currentTarget : toolsButton.value
  petMenu.value = true
  await nextTick()
  menuElement.value?.querySelector<HTMLButtonElement>('button')?.focus()
}
function menuKeydown(event: KeyboardEvent) {
  if (event.key === 'Tab') { closeMenu(true); return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const items = [...menuElement.value!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  if (!items.length) return
  const index = items.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
  items[next]?.focus()
}
function outsidePointer(event: PointerEvent) { if (event.target instanceof Node && !controls.value?.contains(event.target)) closeMenu() }
function focusOut(event: FocusEvent) { if (event.relatedTarget instanceof Node && !controls.value?.contains(event.relatedTarget)) closeMenu() }
const controller = new CompanionController()
const state = ref<CompanionState>('idle')
const visible = computed(() => !(props.focus && props.options.focusAutoHide))
function togglePet() {
  void petCommand('toggle')
}
function handleBadgeKeydown(event: KeyboardEvent) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10') && !(event.altKey && event.key === 'ArrowDown')) return
  event.preventDefault()
  void toggleMenu(event)
}
const label = computed(() => ({ idle: '写作伙伴', curious: '陪你构思', thinking: '正在思考', writing: '正在生成', success: '候选已就绪', warning: '任务需处理', sleeping: '安静陪伴', hidden: '写作伙伴' })[state.value])
let timer: ReturnType<typeof setInterval> | undefined
function sample() { state.value = controller.state(performance.now(), { hidden: !visible.value || document.hidden, quiet: props.quiet, feedback: props.options.stateFeedback, hovered: false }) }
watch(() => [props.scope, props.taskId, props.taskStatus], () => { controller.update(props.scope, props.taskId, props.taskStatus, performance.now()); sample() })
watch(() => [props.scope, props.suspended, props.taskId, props.taskStatus, props.quiet, props.focus, props.options], () => void publishContext(), { deep: true })
watch(() => settings.value.reducedMotion, () => void publishContext())
onMounted(async () => {
  mounted = true
  media.addEventListener('change', mediaChange)
  document.addEventListener('pointerdown', outsidePointer)
  if (!desktopPetClient.available()) { petError.value = '桌面宠物仅在桌面客户端可用。'; return }
  unsubscribePet = desktopPetClient.onState(value => { petState.value = value; petError.value = value.error || '' })
  unsubscribeAction = desktopPetClient.onAction(action => {
    if (action === 'return-to-writing') emit('write')
    else if (action === 'settings') emit('settings')
    else emit('mode', action === 'mode-detailed' ? 'detailed' : 'chibi')
  })
  await publishContext()
})
onBeforeUnmount(() => {
  mounted = false; unsubscribePet?.(); unsubscribeAction?.(); media.removeEventListener('change', mediaChange)
  document.removeEventListener('pointerdown', outsidePointer)
  if (desktopPetClient.available()) {
    void desktopPetClient.updateContext({ ...petContext(), scope: '', taskId: '', taskStatus: '', quiet: true, focusHidden: false }).catch(() => {})
  }
})
onMounted(() => { controller.update(props.scope, props.taskId, props.taskStatus, performance.now()); sample(); timer = setInterval(sample, 1500) })
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div v-if="visible" ref="controls" class="archive-companion-controls" @keydown.esc.stop.prevent="closeMenu(true)" @focusout="focusOut">
  <button class="archive-companion-badge" :class="options.writingMode" type="button" data-testid="external-companion" :data-state="state" :data-quiet="quiet" :disabled="petBusy" :title="petError || '开启或关闭桌宠，下次打开作品沿用此选择；右侧菜单可找回或设置'" aria-label="开启或关闭写作伙伴，记住选择；右键打开伙伴菜单" aria-keyshortcuts="Shift+F10 Alt+ArrowDown" :aria-expanded="petOpen && options.writingMode !== 'hidden'" @click="togglePet" @contextmenu.prevent="toggleMenu" @keydown="handleBadgeKeydown">
    <span class="archive-companion-portrait"><img :src="portrait" alt="黑发白衣的岚笺写作伙伴"><i aria-hidden="true"></i></span><span>{{ label }}</span>
  </button>
  <button ref="toolsButton" class="archive-pet-tools" type="button" data-testid="desktop-pet-tools-toggle" aria-label="桌宠工具" aria-haspopup="menu" :aria-expanded="petMenu" :title="petError || '桌宠工具：找回、关闭与完整设置'" :disabled="petBusy" @click="toggleMenu" @keydown.down.prevent="toggleMenu"><ChevronDown :size="14" :stroke-width="1.5" aria-hidden="true" /></button>
  <div v-if="petMenu" ref="menuElement" class="archive-pet-menu" data-testid="desktop-pet-tools-menu" role="menu" aria-label="桌宠工具" @keydown="menuKeydown">
    <p class="pet-menu-status" role="status">{{ petStatus }}</p>
    <small v-if="petError" role="alert">{{ petError }}</small>
    <button type="button" role="menuitem" :disabled="petBusy" data-testid="desktop-pet-locate" @click="petCommand('locate')">找回桌宠 · 解除穿透</button>
    <button type="button" role="menuitem" :disabled="petBusy" @click="petCommand('hide')">关闭桌宠</button>
    <button type="button" role="menuitem" :disabled="petBusy" @click="closeMenu(true); emit('settings')">桌宠完整设置</button>
  </div>
  </div>
</template>

<style scoped>
.archive-companion-controls{position:relative;z-index:80;display:flex;inline-size:auto;block-size:2.5rem;align-items:center;flex:none;white-space:nowrap}
.archive-pet-menu{position:absolute;z-index:90;inset-block-start:calc(100% + .375rem);inset-inline-end:0;display:grid;gap:.4rem;inline-size:min(15rem,calc(100vw - 1rem));max-block-size:calc(100dvh - 4rem);overflow:auto;padding:.75rem;background:var(--surface);color:var(--ink);border:1px solid var(--line);box-shadow:0 .5rem 1.5rem #0002}
.archive-companion-controls .archive-pet-menu button{display:flex;width:100%;height:auto;inline-size:100%;block-size:auto;min-block-size:2.5rem;align-items:center;justify-content:flex-start;white-space:normal;overflow-wrap:anywhere;font:500 .8125rem/1.45 var(--sans);text-align:start;padding:.55rem .7rem;border:1px solid var(--line);background:var(--surface-muted);color:var(--ink);cursor:pointer}
.archive-pet-menu button:hover{border-color:var(--jade);background:var(--jade-wash);color:var(--jade-deep)}
.archive-pet-menu button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.archive-pet-menu small{color:var(--danger);font-size:.8rem}
.pet-menu-status{margin:0;padding:.2rem .25rem .4rem;font:500 .75rem/1.6 var(--sans);color:var(--ink-muted);white-space:normal;overflow-wrap:anywhere}
.archive-companion-controls .archive-pet-tools{display:inline-flex;align-items:center;justify-content:center;flex:none;width:1.75rem;height:2.5rem;padding:0;border:0;background:transparent;color:var(--ink);font:1.25rem/1 var(--sans);cursor:pointer}
.archive-pet-tools:hover,.archive-pet-tools[aria-expanded=true]{background:var(--surface-muted)}
.archive-pet-tools svg{transition:transform .16s ease}
.archive-pet-tools[aria-expanded=true] svg{transform:rotate(180deg)}
.archive-pet-tools:focus-visible{outline:2px solid var(--focus);outline-offset:-2px}
.archive-companion-controls button:disabled{cursor:wait;opacity:.55}
.archive-companion-controls .archive-companion-badge{display:inline-flex;width:auto;height:2.5rem;inline-size:auto;block-size:2.5rem;min-inline-size:0;align-items:center;justify-content:flex-start;gap:.5rem;flex:none;border:0;border-left:1px solid var(--line);padding:0 .75rem;color:var(--ink);background:transparent;font:var(--archive-text-small,.75rem) var(--sans);white-space:nowrap;cursor:pointer}
.archive-companion-portrait{position:relative;display:block;flex:0 0 2.125rem;inline-size:2.125rem;aspect-ratio:1;border-radius:50%;border:1px solid var(--line-strong);overflow:hidden;background:var(--surface-muted)}
.archive-companion-portrait img{position:absolute;inset-block:0;inset-inline:0;inline-size:100%;max-inline-size:none;max-width:none;block-size:100%;object-fit:cover;object-position:center 18%}
.archive-companion-portrait i{position:absolute;inset-inline-end:0;inset-block-end:0;inline-size:.5rem;aspect-ratio:1;border:.125rem solid var(--surface);border-radius:50%;background:var(--jade)}
[data-state=thinking] i,[data-state=writing] i{background:var(--signal)}
[data-state=warning] i{background:var(--danger)}
.archive-companion-badge:hover{background:var(--surface-muted)}
.archive-companion-badge:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.archive-companion-badge.chibi>span:last-child{display:none}
@media(max-width:72rem){.archive-companion-badge{padding-inline:.5rem}.archive-companion-badge>span:last-child{display:none}}
</style>
