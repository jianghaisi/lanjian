<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useSlots } from 'vue'
const selected = ref('appearance')
const content = ref<HTMLElement>()
const slots = useSlots()
const tabs = computed(() => [{ id: 'appearance', label: '外观与画面', number: '01' }, { id: 'opening', label: '开场与加载', number: '02' }, { id: 'sound', label: '声音与对话', number: '03' }, ...(slots.plugins ? [{ id: 'plugins', label: '写作插件', number: '04' }] : [])])
const positions = new Map<string, number>()
let navigation = 0
async function select(id: string) {
  if (id === selected.value) return
  positions.set(selected.value, content.value?.scrollTop || 0)
  const ticket = ++navigation
  selected.value = id
  await nextTick()
  if (ticket === navigation && content.value?.isConnected) content.value.scrollTop = positions.get(id) || 0
}
onBeforeUnmount(() => { navigation++ })
</script>

<template>
  <div class="library-settings-layout">
    <nav aria-label="作品库设置分类">
      <button v-for="tab in tabs" :key="tab.id" type="button" :aria-current="selected === tab.id ? 'page' : undefined" :data-testid="`library-settings-${tab.id}`" @click="select(tab.id)"><small>{{ tab.number }}</small>{{ tab.label }}</button>
      <div class="library-model-link"><slot name="models" /></div>
    </nav>
    <div ref="content" class="library-settings-content">
      <section v-for="tab in tabs" v-show="selected === tab.id" :key="tab.id" :aria-label="tab.label"><slot :name="tab.id" :active="selected === tab.id" /></section>
    </div>
  </div>
</template>

<style scoped>
.library-settings-layout { display:grid; grid-template-columns:170px minmax(0,1fr); min-height:0; overflow:hidden; }
nav { display:flex; flex-direction:column; gap:6px; padding:20px 12px; border-right:1px solid var(--line); overflow:auto; }
nav > button { display:flex; align-items:center; gap:12px; padding:13px 10px; color:var(--muted); background:transparent; border:1px solid transparent; text-align:left; font:13px var(--sans); transition:background-color 160ms,color 160ms; }
nav > button[aria-current] { background:var(--surface-muted); border-color:var(--line); color:var(--jade); }
nav small { font-size:10px; opacity:.7; }.library-model-link { margin-top:auto; padding-top:24px; }
.library-model-link :deep(button) { max-width:100%; width:100%; white-space:normal; text-align:left; line-height:1.6; padding:10px; }
.library-settings-content { min-width:0; min-height:0; overflow:auto; overscroll-behavior:contain; padding:24px; scrollbar-gutter:stable; }
nav button:focus-visible { outline:2px solid var(--jade); outline-offset:2px; }
@media(max-width:760px) { .library-settings-layout { grid-template-columns:minmax(0,1fr); grid-template-rows:auto minmax(0,1fr); }nav { flex-direction:row; flex-wrap:wrap; padding:8px; border-right:0; border-bottom:1px solid var(--line); gap:2px; }nav > button { padding:10px 8px; }nav small { display:none; }.library-model-link { margin:0 0 0 auto; padding:0; }.library-settings-content { padding:16px; } }
@media(prefers-reduced-motion:reduce) { nav > button { transition:none; } }
</style>
