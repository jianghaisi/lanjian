<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { AssistantTurn } from '../services/assistant-presentation'
import { assistantReplyChoices, reconcileAssistantReplyPair, type AssistantReplyPair } from '../services/assistant-reply-comparison'
import AssistantDocument from './AssistantDocument.vue'
const props = defineProps<{ turns: AssistantTurn[]; scopeEpoch: number; active: boolean }>()
const emit = defineEmits<{ locate: [turn: AssistantTurn] }>()
const root = ref<HTMLDetailsElement>(), summary = ref<HTMLElement>(), opened = ref(false)
const replies = computed(() => assistantReplyChoices(props.turns)), pair = shallowRef<AssistantReplyPair>([null, null])
const selected = computed(() => pair.value.map(turn => replies.value.find(item => item.turn === turn)))
const available = computed(() => replies.value.length > 1), sides = [0, 1] as const
let navigation = 0
watch(replies, choices => {
  if (choices.length < 2) { pair.value = [null, null]; opened.value = false }
  else if (pair.value.some(Boolean)) pair.value = reconcileAssistantReplyPair(choices, pair.value)
}, { immediate: true })
watch(() => props.scopeEpoch, () => { navigation++; opened.value = false; pair.value = [null, null] }, { flush: 'sync' })
watch(opened, () => { navigation++ }, { flush: 'sync' })
onBeforeUnmount(() => { navigation++ })
function canNavigate(ticket: number, epoch: number) {
  return ticket === navigation && epoch === props.scopeEpoch && props.active && opened.value && Boolean(root.value?.getClientRects().length)
}
function reveal(target: HTMLElement | undefined, focus: HTMLElement | undefined) {
  const scroll = target?.closest<HTMLElement>('[data-testid="copilot-chat-view-scroll"]')
  if (!target || !scroll) return
  scroll.scrollTo({ top: scroll.scrollTop + target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 8, behavior: 'instant' })
  focus?.focus({ preventScroll: true })
}
async function select(side: 0 | 1, value: string) {
  const reply = replies.value[Number(value)]?.turn
  if (!props.active || !opened.value || !reply || reply === pair.value[side] || reply === pair.value[1 - side]) return
  const next: AssistantReplyPair = [...pair.value]; next[side] = reply; pair.value = next
  const ticket = ++navigation, epoch = props.scopeEpoch
  await nextTick()
  if (!canNavigate(ticket, epoch) || pair.value[side] !== reply) return
  const section = root.value?.querySelector<HTMLElement>(`[data-comparison-side="${side}"]`) ?? undefined
  reveal(section, section?.querySelector('select') ?? undefined)
}
function locate(side: 0 | 1) {
  const turn = pair.value[side]
  if (props.active && turn && props.turns.includes(turn)) emit('locate', turn)
}
function toggle(event: Event) {
  if (event.target !== root.value || !root.value) return
  if (root.value.open) pair.value = reconcileAssistantReplyPair(replies.value, pair.value)
  opened.value = root.value.open
}
async function openComparison() {
  if (!available.value || !props.active) return
  pair.value = reconcileAssistantReplyPair(replies.value, pair.value)
  opened.value = true
  const ticket = ++navigation, epoch = props.scopeEpoch
  await nextTick()
  if (canNavigate(ticket, epoch)) reveal(root.value, summary.value)
}
defineExpose({ available, openComparison })
</script>

<template>
  <details v-if="available" ref="root" :open="opened" class="assistant-reply-comparison" data-testid="assistant-reply-comparison" @toggle="toggle">
    <summary ref="summary">比较不同回复 · {{ replies.length }} 份均已保留</summary>
    <template v-if="opened">
      <p class="assistant-comparison-help">选择两份完整回复核对；新回复到来时，保留当前选择。</p>
      <div class="assistant-reply-columns">
        <section v-for="side in sides" :key="side" :data-comparison-side="side" :aria-label="side===0?'第一份比较全文':'第二份比较全文'">
          <div class="assistant-reply-reading-header">
            <div class="assistant-reply-identity"><b>{{ side===0?'第一份':'第二份' }}</b><span>回复 {{ selected[side]?.number }} · {{ selected[side]?.characters.toLocaleString() }} 字</span></div>
            <div class="assistant-reply-controls">
              <select :value="replies.findIndex(item=>item.turn===pair[side])" :aria-label="side===0?'第一份回复':'第二份回复'" @change="select(side,($event.target as HTMLSelectElement).value)">
                <option v-for="(item,i) in replies" :key="i" :value="i" :disabled="item.turn===pair[1-side]">{{ item.label }}</option>
              </select>
              <button type="button" :aria-label="side===0?'定位第一份原回复':'定位第二份原回复'" title="回到对话中的这份回复，继续复制或引用" @click="locate(side)">原回复 ↑</button>
            </div>
          </div>
          <details v-if="selected[side]?.request!=null" :key="replies.findIndex(item=>item.turn===pair[side])" class="assistant-reply-source"><summary>查看原要求</summary><p>{{ selected[side]?.request || '（空白）' }}</p></details>
          <p v-else class="assistant-comparison-help">这份历史回复没有可关联的原要求。</p>
          <AssistantDocument :content="selected[side]?.turn.content??''"/>
        </section>
      </div>
    </template>
  </details>
</template>
