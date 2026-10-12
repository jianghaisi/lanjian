<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { ChapterEventPreview, ChapterEventAdoptionResult } from '../../../../contracts/planning/types'
import ChapterEventAdoption from './ChapterEventAdoption.vue'

const props = defineProps<{ proposalId: string; workItemId: string; chapterId: number; candidate: unknown; saved: boolean; disabled?: boolean }>()
const emit = defineEmits<{ adopted: [value: ChapterEventAdoptionResult & { proposalId: string }] }>()
const result = ref<ChapterEventPreview | null>(null)
const busy = ref(false)
const error = ref('')
let generation = 0
const identity = computed(() => JSON.stringify([props.workItemId, props.proposalId, props.chapterId, props.candidate, props.saved]))
const freshness = { current: '来源版本有效', stale: '来源已变化', untracked: '旧候选 · 来源未绑定' }
const phases = { planned: '计划事件', realized: '实际事件', deviated: '偏离计划', 'legacy-unknown': '历史事件 · 阶段未标记' }
function close() { generation++; result.value = null; error.value = ''; busy.value = false }
watch(identity, close)
onBeforeUnmount(close)
async function inspect() {
  if (busy.value || !props.saved || props.disabled) return
  const ticket = ++generation
  busy.value = true; error.value = ''; result.value = null
  try {
    const next = await window.novelDesktop!.planning.previewChapterEvents(props.proposalId, props.chapterId)
    if (ticket === generation && next.workItemId === props.workItemId && next.chapterId === props.chapterId && next.proposalId === props.proposalId) result.value = next
  } catch (e) { if (ticket === generation) error.value = e instanceof Error ? e.message : '事件核对未能读取，请重试。' }
  finally { if (ticket === generation) busy.value = false }
}
</script>

<template>
  <section class="chapter-event-preview" :data-event-preview-chapter="chapterId">
    <div class="event-actions">
      <button type="button" class="control-button" :disabled="!saved || disabled || busy" @click="inspect">{{ busy ? '正在读取…' : result ? '重新核对事件与来源' : '核对事件与来源' }}</button>
      <button v-if="result || busy || error" type="button" class="control-button" @click="close">收起</button>
      <small v-if="!saved">候选保存后可核对</small>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-if="result" class="event-comparison">
      <p role="status">{{ freshness[result.freshness] }} · 候选与正式记录</p>
      <div class="event-columns">
        <article>
          <h4>本章候选依据</h4>
          <dl>
            <dt>时间</dt><dd>未指定</dd>
            <dt>骨架人物</dt><dd>{{ result.candidate.characters.join('、') }}</dd>
            <dt>骨架地点</dt><dd>{{ result.candidate.location }}</dd>
            <dt>骨架事件</dt><dd>{{ result.candidate.coreEvent }}</dd>
            <dt>骨架结果</dt><dd>{{ result.candidate.plannedResult }}</dd>
            <dt>进入状态</dt><dd>{{ result.candidate.entryState }}</dd>
          </dl>
          <ol><li v-for="(beat, index) in result.candidate.beats" :key="index">{{ beat }}</li></ol>
          <p>退出状态：{{ result.candidate.exitState }}</p>
        </article>
        <article>
          <h4>本章关联的正式事件 · {{ result.formalEvents.length }}</h4>
          <p v-if="!result.formalEvents.length">尚未关联正式事件。</p>
          <details v-for="event in result.formalEvents" :key="event.id">
            <summary>{{ event.event }} · {{ phases[event.phase] }}</summary>
            <dl>
              <dt>时间</dt><dd>{{ event.time || '未记录' }}</dd>
              <dt>人物</dt><dd>{{ event.characters.join('、') || '未记录' }}</dd>
              <dt>地点</dt><dd>{{ event.location || '未记录' }}</dd>
              <dt>结果</dt><dd>{{ event.result ?? '未记录' }}</dd>
              <dt>版本</dt><dd>{{ event.version ?? '历史兼容记录，未建立版本' }}</dd>
            </dl>
          </details>
        </article>
      </div>
      <ul class="event-findings"><li v-for="finding in result.findings" :key="finding.code">{{ finding.message }}</li></ul>
      <ChapterEventAdoption :comparison="result" :saved="saved" :disabled="disabled" @adopted="emit('adopted', $event)" />
    </div>
  </section>
</template>

<style scoped>
.chapter-event-preview { margin: 12px 18px; color: var(--color-ink); font-size: 14px; }
.event-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.event-comparison { margin-top: 10px; padding: 12px; border: 1px solid var(--color-line); background: var(--color-surface); max-height: 460px; overflow: auto; }
.event-comparison p, .event-comparison h4 { margin: 0 0 10px; }
.event-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.event-columns article { min-width: 0; overflow-wrap: anywhere; }
.event-columns dl { display: grid; grid-template-columns: 5em minmax(0, 1fr); gap: 6px; margin: 8px 0; }
.event-columns dd { margin: 0; white-space: pre-wrap; }
.event-columns dt { opacity: .75; }
.event-columns details { border-top: 1px solid var(--color-line); padding: 8px 0; }
.event-columns summary { cursor: pointer; white-space: pre-wrap; }
.event-columns ol, .event-findings { padding-left: 20px; line-height: 1.6; }
.event-findings { margin-bottom: 0; border-top: 1px solid var(--color-line); padding-top: 8px; }
@media (max-width: 1100px) { .event-columns { grid-template-columns: minmax(0, 1fr); } }
</style>
