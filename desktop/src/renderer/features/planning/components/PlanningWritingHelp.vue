<script setup lang="ts">
import { ref, watch } from 'vue'
import { outlineLevelGuidance, outlineTemplates } from '../../../../contracts/planning/outline-story-guidance'
const props = defineProps<{ kind: string; empty: boolean; disabled?: boolean }>()
const emit = defineEmits<{ insert: [text: string] }>()
const preferenceKey = 'lanjian.planning-writing-help'
function readPreference() { try { return localStorage.getItem(preferenceKey) !== 'closed' } catch { return true } }
const expanded = ref(readPreference())
function remember(event: Event) {
  expanded.value = (event.currentTarget as HTMLDetailsElement).open
  try { localStorage.setItem(preferenceKey, expanded.value ? 'open' : 'closed') } catch { /* Session-only preference when storage is unavailable. */ }
}
watch(() => props.kind, () => { expanded.value = readPreference() })
const guides = Object.fromEntries(['total', 'volume', 'stage', 'chapter'].map(kind => [kind, {
  title: ({ total: '总纲写什么', volume: '卷纲写什么', stage: '阶段纲写什么', chapter: '章纲写什么' } as Record<string, string>)[kind],
  prompt: outlineLevelGuidance[kind as keyof typeof outlineTemplates],
  example: '因为前事形成这个处境，人物作出选择；对方回应造成变化，于是引出后事。要写具体经历。',
  template: outlineTemplates[kind as keyof typeof outlineTemplates]
}]))
</script>
<template>
  <details class="planning-writing-help" :open="expanded" @toggle="remember">
    <summary>{{ (guides[kind] || guides.chapter).title }}<span>逐层展开</span></summary>
    <div><p>{{ (guides[kind] || guides.chapter).prompt }}</p><p class="planning-example"><b>示例</b>{{ (guides[kind] || guides.chapter).example }}</p><button type="button" class="text-action compact" :disabled="disabled" @click="emit('insert', (guides[props.kind] || guides.chapter).template)">插入标题</button><small>只插入草稿，可撤销；不会自动保存或确认。</small></div>
  </details>
</template>
