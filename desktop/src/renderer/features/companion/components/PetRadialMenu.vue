<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { MessageCircle, Heart, Hand, Sparkles, Timer, Settings, Utensils, Droplets, Package, Moon, Smile, Dice5, Lightbulb, Volume2, LockKeyhole, ArrowUpRight, Power } from '@lucide/vue'
import { petRadialLayout, type OrbitPoint, type PetRadialAction } from '../services/pet-radial-layout'
import { petCareDisabledReason } from '../services/pet-care-feedback'
const props = defineProps<{ open: boolean; width: number; height: number; petWidth: number; petHeight: number; reduced: boolean; careEnabled: boolean; careReady: boolean; busy: boolean; sleeping: boolean; food: number; water: number; locked: boolean }>()
const emit = defineEmits<{ action: [action: PetRadialAction]; close: []; closed: []; layout: [] }>()
const root = ref<HTMLElement>(), selected = ref(-1)
let hoverTimer: ReturnType<typeof setTimeout> | undefined
let keyboardNavigation = false
const groups = [
  { id: 'care', label: '照料', icon: Heart, children: [
    { id: 'food', label: '喂食', icon: Utensils }, { id: 'water', label: '喝水', icon: Droplets }, { id: 'care', label: '背包', icon: Package }, { id: 'sleep', label: '休息', icon: Moon }] },
  { id: 'interact', label: '互动', icon: Hand, children: [
    { id: 'pat', label: '摸摸', icon: Heart }, { id: 'handshake', label: '握手', icon: Hand }, { id: 'greet', label: '招呼', icon: Smile }] },
  { id: 'chat', label: '聊天', icon: MessageCircle, children: [] },
  { id: 'settings', label: '设置', icon: Settings, children: [
    { id: 'settings', label: '外观', icon: Settings }, { id: 'voice', label: '声音', icon: Volume2 }, { id: 'lock', label: '锁定', icon: LockKeyhole }, { id: 'writing', label: '回到写作', icon: ArrowUpRight }, { id: 'hide', label: '关闭桌宠', icon: Power }] },
  { id: 'focus', label: '专注', icon: Timer, children: [] },
  { id: 'play', label: '灵感', icon: Sparkles, children: [
    { id: 'dice', label: '骰子', icon: Dice5 }, { id: 'inspiration', label: '灵感签', icon: Lightbulb }] }
] as const
const children = computed(() => groups[selected.value]?.children ?? [])
const layout = computed(() => petRadialLayout(props.width, props.height, props.petWidth, props.petHeight, selected.value, children.value.length))
function style(point: OrbitPoint, index: number, origin = layout.value.center) {
  return { left: `${point.x - 28}px`, top: `${point.y - 28}px`, '--dx': `${origin.x - point.x}px`, '--dy': `${origin.y - point.y}px`, '--delay': `${index * 22}ms` }
}
function pick(index: number) { clearTimeout(hoverTimer); selected.value = index; void nextTick(() => emit('layout')) }
function hover(index: number) { clearTimeout(hoverTimer); if (!keyboardNavigation) hoverTimer = setTimeout(() => pick(index), 180) }
function pointerMove(event: PointerEvent) {
  if (!keyboardNavigation || (!event.movementX && !event.movementY)) return
  keyboardNavigation = false
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-primary]') : null
  const index = button ? [...root.value!.querySelectorAll('[data-primary]')].indexOf(button) : -1
  if (index >= 0) hover(index)
}
function leave() { clearTimeout(hoverTimer) }
function groupAction(index: number) {
  clearTimeout(hoverTimer)
  const item = groups[index]!
  if (!item.children.length) { emit('action', item.id as PetRadialAction); return }
  pick(index)
}
function disabledReason(id: string) { return petCareDisabledReason(id, props) }
function label(id: string, text: string) { return id === 'lock' && props.locked ? '解除锁定' : id === 'sleep' && props.sleeping ? '唤醒' : text }
function testId(id: string) { return ({ chat: 'pet-open-chat', care: 'pet-open-care', settings: 'pet-open-settings', focus: 'pet-open-activities', food: 'pet-use-food', water: 'pet-use-water', sleep: 'pet-sleep' } as Record<string, string>)[id] ?? `pet-${id}` }
function keydown(event: KeyboardEvent) {
  keyboardNavigation = true
  clearTimeout(hoverTimer)
  if (event.key === 'Escape') {
    event.stopPropagation(); event.preventDefault()
    if (selected.value >= 0) {
      const parent = root.value?.querySelectorAll<HTMLButtonElement>('[data-primary]')[selected.value]
      pick(-1); parent?.focus()
    } else emit('close')
    return
  }
  if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return
  event.preventDefault()
  const items = [...root.value!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  const index = items.indexOf(document.activeElement as HTMLButtonElement), direction = ['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1
  items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + direction + items.length) % items.length]?.focus()
}
function entered() { root.value?.querySelector<HTMLButtonElement>('[data-primary]')?.focus(); emit('layout') }
watch(() => props.open, value => { if (!value) { clearTimeout(hoverTimer); selected.value = -1; keyboardNavigation = false } })
onBeforeUnmount(() => clearTimeout(hoverTimer))
</script>

<template>
  <Transition name="orbit" appear :duration="reduced ? 0 : { enter: 400, leave: 240 }" @after-enter="entered" @after-leave="emit('closed')">
    <nav v-if="open" ref="root" class="pet-orbit" :class="{ reduced, compact: layout.compact }" aria-label="桌宠快捷菜单" data-testid="desktop-pet-menu" @keydown="keydown" @pointermove="pointerMove" @pointerleave="leave">
      <button v-for="(item,index) in groups" :key="item.id" type="button" class="orbit-node" :class="{ selected: selected === index, quiet: selected >= 0 && selected !== index }" :style="style(layout.primary[index]!,index)" :data-testid="item.children.length ? `pet-radial-${item.id}` : testId(item.id)" data-pet-interactive data-primary :aria-label="item.label" :aria-expanded="item.children.length ? selected === index : undefined" :disabled="busy" @pointerenter="hover(index)" @pointerleave="leave" @click="groupAction(index)">
        <span class="orbit-disc"><component :is="item.icon" :size="20" :stroke-width="1.6" /></span><span class="orbit-label">{{ item.label }}</span><i v-if="item.children.length" aria-hidden="true" />
      </button>
      <TransitionGroup name="satellite" tag="div" class="satellites" @after-enter="emit('layout')" @after-leave="emit('layout')">
        <button v-for="(item,index) in children" :key="item.id" type="button" class="orbit-node satellite" :class="{ destructive: item.id === 'hide' }" :style="style(layout.secondary[index]!,index,layout.primary[selected])" :data-testid="testId(item.id)" data-pet-interactive :aria-label="label(item.id,item.label)" :title="disabledReason(item.id) || label(item.id,item.label)" :aria-description="disabledReason(item.id) || undefined" :disabled="Boolean(disabledReason(item.id))" @pointerenter="leave" @click="emit('action',item.id)">
          <span class="orbit-disc"><component :is="item.icon" :size="19" :stroke-width="1.7" /></span><span class="orbit-label">{{ label(item.id,item.label) }}</span>
        </button>
      </TransitionGroup>
    </nav>
  </Transition>
</template>

<style scoped>
.pet-orbit,.satellites{position:absolute;inset:0;pointer-events:none}.pet-orbit{--orbit-ease:cubic-bezier(.16,1,.3,1);font:500 11px/1.25 var(--sans)}
.orbit-node{position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;width:56px;height:56px;padding:0;border:1px solid var(--color-line);border-radius:50%;background:var(--color-surface);color:var(--color-ink);box-shadow:0 3px 10px #1b211e12,inset 0 1px #fff8;font:inherit;cursor:pointer;pointer-events:auto;transition:opacity .2s,transform .32s var(--orbit-ease),background .18s,border-color .18s,color .18s;transform-origin:center;touch-action:manipulation}
.orbit-disc{display:grid;place-items:center;flex:none;height:20px;color:var(--color-jade)}
.orbit-label{font-size:11px;font-weight:500;white-space:nowrap;letter-spacing:.025em}
.orbit-node>i{position:absolute;top:4px;right:7px;width:4px;height:4px;border-radius:50%;background:var(--color-muted)}
.orbit-node:hover:not(:disabled),.orbit-node.selected{background:var(--color-jade);color:var(--color-surface);border-color:var(--color-jade);box-shadow:0 4px 12px #24473f24}
.orbit-node:hover:not(:disabled) .orbit-disc,.orbit-node.selected .orbit-disc{color:inherit}.orbit-node.selected>i,.orbit-node:hover>i{background:currentColor}
.orbit-node:focus-visible{outline:2px solid var(--color-jade);outline-offset:3px}.orbit-node.quiet{opacity:.8}.orbit-node.quiet:hover,.orbit-node.quiet:focus-visible{opacity:1}
.satellite{background:var(--color-paper)}.satellite.destructive,.satellite.destructive .orbit-disc{color:var(--color-danger)}.orbit-node:disabled{opacity:.4;cursor:default}
.orbit-enter-active .orbit-node{transition:transform .38s var(--orbit-ease),opacity .28s;transition-delay:var(--delay)}.orbit-leave-active .orbit-node{transition:transform .2s cubic-bezier(.4,0,.6,1),opacity .18s;pointer-events:none}.orbit-enter-from .orbit-node,.orbit-leave-to .orbit-node{transform:translate(var(--dx),var(--dy)) scale(.2);opacity:0}
.satellite-enter-active,.satellite-leave-active{transition:transform .26s var(--orbit-ease),opacity .2s}.satellite-enter-from,.satellite-leave-to{transform:translate(var(--dx),var(--dy)) scale(.35);opacity:0}.satellite-leave-active{position:absolute;pointer-events:none}
.reduced *{transition:none!important;transition-delay:0ms!important}
</style>
