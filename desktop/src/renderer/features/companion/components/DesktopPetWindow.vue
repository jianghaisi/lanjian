<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DesktopPetCommand, DesktopPetPreferences, DesktopPetState } from '../../../../contracts/companion/desktop-pet'
import { desktopPetClient } from '../services/desktop-pet-client'
import { defaultCompanionOptions } from '../services/companion-controller'
import CompanionHost from './CompanionHost.vue'

const state = ref<DesktopPetState | null>(null)
const error = ref('')
const loading = ref(true)
const busy = ref(false)
const menu = ref(false)
const dragging = ref(false)
const message = ref('')
const petting = ref(false)
const interactionPulse = ref(0)
const handle = ref<HTMLButtonElement>()
const panel = ref<HTMLElement>()
let disposed = false, eventGeneration = 0, requestGeneration = 0
let unsubscribe: (() => void) | undefined
let messageTimer: ReturnType<typeof setTimeout> | undefined, reminderTimer: ReturnType<typeof setTimeout> | undefined
let petTimer: ReturnType<typeof setTimeout> | undefined
let regionsFrame = 0, lastRegions = ''
let regionsObserver: ResizeObserver | undefined
const observedRegions = new Set<Element>()
let hoverValue: boolean | undefined
let drag: { pointerId: number; x: number; y: number; moved: boolean } | undefined
const context = computed(() => state.value?.context)
const options = computed(() => ({ ...defaultCompanionOptions,
  writingMode: context.value?.mode ?? 'chibi',
  followPointer: context.value?.followPointer ?? false,
  autoBlink: context.value?.autoBlink ?? false,
  stateFeedback: context.value?.stateFeedback ?? false,
  intensity: context.value?.intensity ?? 0,
  focusAutoHide: true
}))
const isQuiet = computed(() => Boolean(context.value?.quiet) || options.value.intensity === 0)
const statusText = computed(() => {
  if (context.value?.quiet) return '安静陪写中'
  if (context.value?.taskStatus === 'streaming') return '正在写下故事'
  if (['queued', 'preparing', 'running', 'resuming'].includes(context.value?.taskStatus ?? '')) return '正在构思'
  return '拖动我，放到喜欢的位置'
})
const scales = computed(() => [...new Set([0.6, 0.75, 1, 1.25, 1.5, 1.8, state.value?.preferences.scale ?? 1])].sort((a, b) => a - b))
const reminderChoices = computed(() => [...new Set([0, 25, 45, 60, state.value?.preferences.reminderMinutes ?? 0])].sort((a, b) => a - b))

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
function configure(patch: Partial<DesktopPetPreferences>) {
  if (!state.value) return
  void command({ type: 'configure', preferences: { ...state.value.preferences, ...patch } })
}
function checked(event: Event) { return (event.target as HTMLInputElement).checked }
function selectedNumber(event: Event) { return Number((event.target as HTMLSelectElement).value) }
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
  if (drag && Math.hypot(event.screenX - drag.x, event.screenY - drag.y) > 5) drag.moved = true
  hover(dragging.value || Boolean(event.target instanceof Element && event.target.closest('[data-pet-interactive]')))
}
function leave() { if (!dragging.value) hover(false) }
function startDrag(event: PointerEvent) {
  if (event.button !== 0 || !state.value || busy.value) return
  handle.value?.focus()
  handle.value?.setPointerCapture(event.pointerId)
  drag = { pointerId: event.pointerId, x: event.screenX, y: event.screenY, moved: false }
  dragging.value = true; hover(true)
  void command({ type: 'drag-start' }, false)
}
function endDrag(event?: PointerEvent) {
  if (!drag || (event && event.pointerId !== drag.pointerId)) return
  const current = drag; drag = undefined; dragging.value = false
  if (handle.value?.hasPointerCapture(current.pointerId)) handle.value.releasePointerCapture(current.pointerId)
  void command({ type: 'drag-end' }, false)
  if (event?.type === 'pointerup' && !current.moved) greet()
}
async function toggleMenu() {
  menu.value = !menu.value
  await nextTick()
  if (menu.value) panel.value?.querySelector<HTMLButtonElement>('button')?.focus()
  else handle.value?.focus()
}
function closeMenu() { menu.value = false; handle.value?.focus() }
function say(text: string) { clearTimeout(messageTimer); message.value = text; messageTimer = setTimeout(() => { message.value = '' }, 8000) }
function animatePet() {
  interactionPulse.value += 1
  clearTimeout(petTimer); petting.value = true; petTimer = setTimeout(() => { petting.value = false }, 900)
}
function pat() { say('收到摸摸。接下来的故事，也一起慢慢写吧。'); animatePet() }
const greetings = ['我在。今天也一起把故事写下去吧。', '要继续上一章，还是先听听人物的心声？', '书可以先放下，但故事别忘了带上。', '灵感来了就写，我会陪你看着它长大。']
function greet() { say(greetings[Math.floor(Math.random() * greetings.length)]!); animatePet() }
function dice() { say(`本地骰子 · ${1 + Math.floor(Math.random() * 6)} 点。把选择权交给灵感，也可以不听它的。`) }
const prompts = ['让一个配角说出此刻最不合时宜的真心话。', '给这一场景添一个声音，再让人物误会它。', '如果这段对话里有人在隐瞒一个小秘密呢？', '用一件普通物品，接住人物没说出口的情绪。', '让男主吐槽一句，再给对方一个更妙的回敬。', '回到人物眼前最想完成的那件小事。']
function inspiration() { say(`离线灵感签 · ${prompts[Math.floor(Math.random() * prompts.length)]}`) }
function scheduleReminder() {
  clearTimeout(reminderTimer)
  const minutes = state.value?.preferences.reminderMinutes ?? 0
  if (!minutes || !state.value?.open || disposed) return
  const remind = () => {
    if (disposed || !state.value?.open) return
    if (context.value?.quiet) { reminderTimer = setTimeout(remind, 30_000); return }
    say('休息一下吧：看看远处、喝口水，让故事也喘口气。')
    scheduleReminder()
  }
  reminderTimer = setTimeout(remind, minutes * 60_000)
}
function blur() { endDrag(); hover(false) }
watch(() => [state.value?.preferences.reminderMinutes, state.value?.open], scheduleReminder)
watch(() => [menu.value, message.value, error.value, loading.value, state.value?.error, context.value?.mode,
  context.value?.focusHidden, state.value?.open, state.value?.preferences.scale, petting.value], scheduleRegions, { flush: 'post' })
onMounted(() => {
  try { unsubscribe = desktopPetClient.onState(receive) } catch { error.value = '桌面伙伴连接暂不可用。请从主窗口重新打开。' }
  window.addEventListener('pointermove', pointer, { passive: true })
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
  endDrag(); disposed = true; requestGeneration += 1; unsubscribe?.()
  clearTimeout(messageTimer); clearTimeout(reminderTimer); clearTimeout(petTimer)
  cancelAnimationFrame(regionsFrame); regionsObserver?.disconnect(); observedRegions.clear()
  window.removeEventListener('pointermove', pointer); window.removeEventListener('mousemove', pointer); window.removeEventListener('blur', blur)
  document.documentElement.removeEventListener('pointerleave', leave)
  window.removeEventListener('resize', scheduleRegions); document.removeEventListener('scroll', scheduleRegions, true)
})
</script>

<template>
  <main class="desktop-pet-window" :class="{ quiet: isQuiet, dragging }" data-testid="desktop-pet-window" @keydown.esc.stop="closeMenu">
    <section v-if="!state" class="connection-card" data-pet-interactive aria-live="polite">
      <b>岚笺 · 桌面伙伴</b><p>{{ loading ? '正在连接伙伴…' : error || '伙伴暂不可用' }}</p>
      <button v-if="!loading" type="button" @click="load">重新连接</button>
    </section>
    <template v-else>
      <section v-if="menu" ref="panel" class="pet-panel" data-pet-interactive data-testid="desktop-pet-menu" aria-label="桌面伙伴菜单">
        <header><div><small>LANJIAN / COMPANION</small><b>桌面伙伴</b></div><button type="button" aria-label="关闭伙伴菜单" @click="closeMenu">×</button></header>
        <div class="mode-row" role="group" aria-label="伙伴形态">
          <button type="button" :disabled="busy" :aria-pressed="context?.mode === 'detailed'" data-testid="pet-mode-detailed" @click="command({ type: 'mode', mode: 'detailed' })">Live2D 立绘</button>
          <button type="button" :disabled="busy" :aria-pressed="context?.mode === 'chibi'" data-testid="pet-mode-chibi" @click="command({ type: 'mode', mode: 'chibi' })">Q版</button>
        </div>
        <label class="option-row">显示大小<select aria-label="桌面伙伴大小" data-testid="pet-scale" :value="state.preferences.scale" :disabled="busy" @change="configure({ scale: selectedNumber($event) })"><option v-for="scale in scales" :key="scale" :value="scale">{{ Math.round(scale * 100) }}%{{ scale === 1 ? ' · 标准' : '' }}</option></select></label>
        <label class="option-row"><span>始终置顶</span><input type="checkbox" :checked="state.preferences.alwaysOnTop" :disabled="busy" @change="configure({ alwaysOnTop: checked($event) })"></label>
        <label class="option-row"><span>鼠标完全穿透</span><input type="checkbox" data-testid="pet-click-through" :checked="state.preferences.clickThrough" :disabled="busy" @change="configure({ clickThrough: checked($event) })"></label>
        <p class="help">透明空白自动让出鼠标。开启完全穿透后，可从岚笺顶栏找回并恢复操作。</p>
        <label class="option-row">休息提醒<select aria-label="休息提醒间隔" :value="state.preferences.reminderMinutes" :disabled="busy" @change="configure({ reminderMinutes: selectedNumber($event) })"><option v-for="minutes in reminderChoices" :key="minutes" :value="minutes">{{ minutes ? `${minutes} 分钟` : '关闭' }}</option></select></label>
        <p class="help">只在伙伴窗口提醒，不发送系统通知；连续写作时延后。</p>
        <div class="play-row" role="group" aria-label="离线互动"><button type="button" data-testid="pet-pat" @click="pat">摸摸</button><button type="button" data-testid="pet-dice" @click="dice">掷骰子</button><button type="button" data-testid="pet-inspiration" @click="inspiration">灵感签</button></div>
        <div v-if="message" class="speech inline-result" data-pet-interactive role="status" data-testid="pet-result"><p>{{ message }}</p><button type="button" aria-label="关闭伙伴消息" @click="message = ''">×</button></div>
        <p class="help">本地小互动，不调用 AI、不改动小说。</p>
        <div class="action-grid"><button type="button" :disabled="busy" @click="command({ type: 'return-to-writing' })">回到书稿 ↗</button><button type="button" :disabled="busy" @click="command({ type: 'settings' })">动画设置 ↗</button><button type="button" :disabled="busy" @click="command({ type: 'locate' })">找回到当前屏幕</button><button type="button" :disabled="busy" data-testid="pet-hide" @click="command({ type: 'hide' })">隐藏伙伴</button></div>
      </section>
      <aside v-if="error || state.error" class="error-card" data-pet-interactive role="alert"><span>{{ error || state.error }}</span><button type="button" :disabled="busy" @click="load">重读状态</button><button type="button" @click="error = ''; command({ type: 'locate' })">找回伙伴</button></aside>
      <div v-if="message && !menu" class="speech" data-pet-interactive role="status" data-testid="pet-result"><p>{{ message }}</p><button type="button" aria-label="关闭伙伴消息" @click="message = ''">×</button></div>
      <div class="pet-stage" :class="{ petting: petting && !isQuiet }" data-testid="desktop-pet-stage">
        <button ref="handle" class="pet-body" type="button" data-pet-interactive data-testid="pet-window-handle" aria-label="拖动桌面伙伴；点击与她说话；右键打开菜单" :aria-expanded="menu" @pointerdown.prevent="startDrag" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag" @click="($event.detail === 0) && greet()" @contextmenu.prevent="toggleMenu">
          <CompanionHost :options="options" :mode="context?.mode ?? 'chibi'" :scope="context?.scope" :task-id="context?.taskId" :task-status="context?.taskStatus" :quiet="Boolean(context?.quiet) || dragging" :focus="context?.focusHidden" :action="interactionPulse" pet />
        </button>
        <button class="pet-caption" type="button" data-pet-interactive data-testid="pet-window-menu-toggle" :aria-expanded="menu" @click="toggleMenu"><span>岚笺</span><small>{{ statusText }}</small><span aria-hidden="true">⋯</span></button>
      </div>
    </template>
  </main>
</template>

<style>
@font-face{font-family:LanjianSans;src:local('Noto Sans CJK SC'),local('Source Han Sans SC'),local('Microsoft YaHei');font-display:swap}
:root{--sans:LanjianSans,sans-serif;--color-paper:#f3f0e8;--color-surface:#faf9f5;--color-ink:#1d2220;--color-line:#d8d6cf;--color-muted:#777c78;--color-jade:#287a68}
html,body,#pet-app{margin:0;width:100%;height:100%;background:transparent!important;overflow:hidden}
body{font-family:var(--sans);color:var(--color-ink)}
</style>
<style scoped>
.desktop-pet-window{position:relative;inline-size:100%;block-size:100%;background:transparent;user-select:none;font:14px/1.5 var(--sans)}
.pet-panel .inline-result{position:static;max-block-size:none;box-shadow:none;background:var(--color-paper);overflow:visible}
button,select,input{font:inherit}button{cursor:pointer;color:var(--color-ink);background:var(--color-surface);border:1px solid var(--color-line);border-radius:.2em;min-block-size:2em;padding:.4em .6em}button:disabled,select:disabled{opacity:.5;cursor:wait}button:hover:not(:disabled){border-color:var(--color-jade)}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--color-jade);outline-offset:2px}
.pet-stage{position:absolute;inset-inline-end:1em;inset-block-end:.7em;inline-size:56%;max-inline-size:13em;display:grid;justify-items:center;gap:.3em}.pet-body{display:block;inline-size:75%;padding:0;min-block-size:0;border:0;background:transparent;cursor:grab;touch-action:none}.dragging .pet-body{cursor:grabbing}.pet-body :deep(.companion-host){pointer-events:none}.pet-body :deep(.companion-art){filter:drop-shadow(0 .2em .35em #1d222026)}.pet-caption{inline-size:100%;display:flex;align-items:center;gap:.4em;min-block-size:2.5em;background:#faf9f5ed;box-shadow:0 .2em .7em #0002;font-size:.74em}.pet-caption small{flex:1;min-inline-size:0;font-size:.85em;text-align:start;overflow-wrap:anywhere}.pet-caption>span:first-child{font-weight:650;white-space:nowrap}
.pet-panel{position:absolute;z-index:5;inset: .65em .65em auto;box-sizing:border-box;max-block-size:calc(100% - 1.3em);overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:.85em;display:grid;gap:.7em;border:1px solid var(--color-line);border-block-start:3px solid var(--color-jade);border-radius:.35em;background:var(--color-surface);box-shadow:0 .2em .7em #0002;font-size:.87em}.pet-panel header{display:flex;justify-content:space-between;align-items:center;gap:.5em}.pet-panel header>div{display:grid;gap:.3em}.pet-panel header small{font-size:.65em;letter-spacing:.12em;color:var(--color-muted)}.pet-panel header b{font-size:1.18em}.mode-row,.play-row{display:flex;gap:.4em}.mode-row button,.play-row button{flex:1;min-inline-size:0;white-space:nowrap}.mode-row button[aria-pressed=true]{background:var(--color-ink);color:var(--color-surface)}.option-row{display:flex;align-items:center;justify-content:space-between;gap:.6em;min-block-size:2em}.option-row select{min-inline-size:0;max-inline-size:58%;background:var(--color-paper);border:1px solid var(--color-line);border-radius:.2em;color:var(--color-ink);padding:.4em}.option-row input{accent-color:var(--color-jade);inline-size:1.1em;block-size:1.1em}.help{margin:0;font-size:.83em;color:#646963;line-height:1.5}.action-grid{display:grid;grid-template-columns:1fr 1fr;gap:.4em}.action-grid button{font-size:.9em}
.speech,.error-card,.connection-card{position:absolute;z-index:6;box-sizing:border-box;inset-inline:.75em;inset-block-start:.75em;padding:.75em;background:var(--color-surface);border:1px solid var(--color-line);border-radius:.35em;box-shadow:0 .2em .7em #0002;font-size:.88em;line-height:1.55;max-block-size:calc(100% - 1.5em);overflow:auto}.speech{inset-block-start:auto;inset-block-end:54%;display:flex;align-items:flex-start;gap:.5em;pointer-events:auto}.speech p{margin:0;flex:1}.speech button{flex:none;padding:.1em .5em}.error-card{border-color:#b4473e;display:flex;flex-wrap:wrap;gap:.5em}.error-card span{flex-basis:100%}.petting{animation:pet-nod .8s ease-in-out}@keyframes pet-nod{35%{transform:translateY(.2em) rotate(2deg)}70%{transform:translateY(-.1em) rotate(-1deg)}}
</style>
