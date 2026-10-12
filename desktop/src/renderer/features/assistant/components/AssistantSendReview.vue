<script setup lang="ts">
import { computed, ref } from 'vue'
import { readAssistantReview } from '../services/assistant-presentation'
const props = withDefaults(defineProps<{ text: string; current?: boolean }>(), { current: true })
const emit = defineEmits<{ 'return-input': [] }>()
const element = ref<HTMLElement>()
defineExpose({ element })
const review = computed(() => readAssistantReview(props.text))
</script>

<template>
  <section ref="element" class="assistant-send-review" data-testid="assistant-send-review" :class="{stale:!current}" tabindex="-1" aria-label="发送前核对">
    <header><div><b>发送前核对</b><span role="status">{{ current?'核对后确认发送':'内容已变化，请更新核对' }}</span></div><button type="button" @click="emit('return-input')">返回输入 ↓</button></header>
    <template v-if="review">
      <h4>你的要求</h4><p>{{ review.message }}</p>
      <details open><summary>可编辑内容 · {{ review.fields.length }} 项</summary><dl><template v-for="(field,index) in review.fields" :key="index"><dt>{{ field.label }}</dt><dd>{{ field.value === '' ? '（空白）' : field.value }}</dd></template></dl></details>
      <details v-for="(background,index) in review.backgrounds" :key="index"><summary>相关背景 {{ index+1 }}</summary><pre>{{ background }}</pre></details>
      <details v-if="review.history.length"><summary>近期对话 · {{ review.history.length }} 条</summary><article v-for="(turn,index) in review.history" :key="index"><b>{{ turn.role==='user'?'你':'智能助笔' }}</b><p>{{ turn.content }}</p></article></details>
    </template>
    <pre v-else>{{ text }}</pre>
  </section>
</template>

<style scoped>
.assistant-send-review { border:1px solid var(--assistant-edge,var(--line)); border-top:3px solid var(--jade); padding:12px; background:var(--surface); box-shadow:2px 3px 0 var(--assistant-rule,transparent); font:400 13px/1.75 var(--sans); }
.assistant-send-review:focus-visible { outline:1px solid var(--jade); outline-offset:2px; }
.assistant-send-review > header { position:sticky; top:0; z-index:1; display:flex; align-items:center; justify-content:space-between; gap:8px; margin:-12px -12px 10px; padding:8px 12px; border-bottom:1px solid var(--line); background:var(--assistant-label,var(--surface)); }
.assistant-send-review > header > div { display:flex; flex-wrap:wrap; gap:2px 10px; min-width:0; }
.assistant-send-review > header > button { flex:none; width:auto; height:auto; min-width:0; min-height:26px; white-space:nowrap; border:1px solid var(--line); background:var(--surface); color:var(--jade); padding:3px 6px; font:500 11px/1.5 var(--sans); cursor:pointer; }
header span,dt { color:var(--muted); font-size:12px; }
h4,dt { margin:10px 0 4px; }
p,pre,dd { white-space:pre-wrap; overflow-wrap:anywhere; margin:0 0 8px; font:inherit; }
details { border-top:1px solid var(--line); padding-top:8px; margin-top:8px; }
summary { cursor:pointer; color:var(--jade); }
dl { display:grid; grid-template-columns:minmax(70px,26%) minmax(0,1fr); margin:8px 0 0; }
dt,dd { margin:0; padding:7px 8px; border-bottom:1px solid var(--line); }
dt { background:var(--assistant-desk,var(--surface)); font-size:11px; overflow-wrap:anywhere; }
dd { font-size:12.5px; line-height:1.7; }
.assistant-send-review.stale { border-top-color:#d79035; }
.assistant-send-review.stale > header { background:var(--assistant-note,var(--surface)); }
.assistant-send-review > h4 { margin:8px 0 4px; font:600 11px/1.5 var(--sans); color:var(--muted); }
.assistant-send-review > p { padding:8px; border-left:2px solid #d79035; background:var(--assistant-note,var(--surface)); }
.assistant-send-review > details > article { padding:8px; margin-top:6px; border:1px solid var(--line); background:var(--surface); }
</style>
