<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ConsistencyFindingDecisionInput, ConsistencyFindingHistory, ConsistencyFindingHistoryEntry } from '../../../../contracts/index'

const props = defineProps<{ history: ConsistencyFindingHistory; busy?: boolean; unsaved?: boolean; error?: string }>()
const emit = defineEmits<{ resolve: [input: Extract<ConsistencyFindingDecisionInput, { decision: 'fixed' }>]; refresh: [] }>()
const limit = ref(20)
const preview = ref<{ entry: ConsistencyFindingHistoryEntry; bodyVersionId: string } | null>(null)
const labels = { open: '待核对', accepted: '待修改', ignored: '已忽略', exception: '有意安排', stale: '检查已过期，待复核', fixed: '已确认修复' }
const entries = computed(() => props.history.entries.slice(0, limit.value))
const canResolve = (entry: ConsistencyFindingHistoryEntry) => ['open', 'accepted', 'stale'].includes(entry.status)
  && entry.sourceBodyVersionId !== props.history.bodyVersionId
const currentPreview = computed(() => {
  const pending = preview.value
  if (!pending || pending.bodyVersionId !== props.history.bodyVersionId) return false
  const current = props.history.entries.find(entry => entry.id === pending.entry.id)
  return Boolean(current && canResolve(current) && current.updatedAt === pending.entry.updatedAt)
})
watch(() => props.history, () => { if (!currentPreview.value) preview.value = null })
function confirm() {
  if (!currentPreview.value || !preview.value || props.busy || props.unsaved) return
  emit('resolve', { findingId: preview.value.entry.id, decision: 'fixed', resultingBodyVersionId: preview.value.bodyVersionId, expectedUpdatedAt: preview.value.entry.updatedAt })
}
</script>

<template>
  <details class="finding-history" data-testid="finding-history">
    <summary>本章问题记录 <span>{{ history.entries.length }} 条</span></summary>
    <div class="history-intro"><p>修改不会自动等于修复。核对并保存正文后，可在这里确认；原始问题和处理记录都会保留。最多显示最近 500 条。</p><button class="control-button secondary compact" type="button" :disabled="busy" @click="emit('refresh')">刷新记录</button></div>
    <p v-if="unsaved" class="history-warning" role="status">正文尚未正式保存。请先返回书稿保存，再确认修复。</p>
    <p v-if="error" class="history-error" role="alert">{{ error }}</p>
    <p v-if="!history.entries.length">本章还没有已记录的问题。</p>
    <article v-for="entry in entries" :key="entry.id" :data-finding-id="entry.id" class="history-entry">
      <header><h3>{{ entry.title }}</h3><span :class="{ resolved: entry.status === 'fixed' }">{{ labels[entry.status] }}</span></header>
      <p>{{ entry.rationale }}</p>
      <dl><div><dt>发现于正文</dt><dd :title="entry.sourceBodyVersionId">{{ entry.sourceBodyVersionId.slice(0, 8) }}</dd></div><div v-if="entry.resultingBodyVersionId"><dt>{{ entry.status === 'fixed' ? '修复于正文' : '曾确认修复于' }}</dt><dd :title="entry.resultingBodyVersionId">{{ entry.resultingBodyVersionId.slice(0, 8) }}</dd></div></dl>
      <p v-if="entry.status === 'stale' && entry.resultingBodyVersionId" class="history-note">上次确认后正文又有变化，旧修复记录不代表当前版本已经通过核对。</p>
      <button v-if="canResolve(entry)" class="control-button secondary compact" type="button" data-testid="preview-finding-resolution" :disabled="busy || unsaved" @click="preview = { entry: { ...entry }, bodyVersionId: history.bodyVersionId }">我已修改，确认修复</button>
      <p v-else-if="entry.status === 'open' || entry.status === 'accepted'" class="history-note">还没有新的正式正文版本。修改并保存后才能确认修复。</p>
      <form v-if="preview?.entry.id === entry.id" class="resolution-preview" data-testid="finding-resolution-preview" @submit.prevent="confirm">
        <strong>确认这条问题已在当前正文修好？</strong>
        <p>只记录你的确认，不会改动正文，也不代表其他问题已经解决。</p>
        <p :title="preview.bodyVersionId">关联已保存版本：{{ preview.bodyVersionId.slice(0, 8) }}</p>
        <div><button class="control-button primary compact" type="submit" data-testid="confirm-finding-resolution" :disabled="busy || unsaved || !currentPreview">{{ busy ? '正在记录…' : '确认已修复' }}</button><button class="control-button secondary compact" type="button" :disabled="busy" @click="preview = null">暂不确认</button></div>
      </form>
    </article>
    <button v-if="history.entries.length > limit" type="button" class="control-button secondary compact" @click="limit += 20">再显示 20 条记录</button>
  </details>
</template>

<style scoped>
.finding-history { margin: 16px 0; border: 1px solid var(--line); background: var(--surface); color: var(--ink); font: 13px/1.6 var(--sans); }
summary { padding: 16px; cursor: pointer; font-weight: 650; }
summary span { margin-left: 8px; color: var(--muted); font-weight: 400; }
.history-intro { display: flex; align-items: start; gap: 16px; border-top: 1px solid var(--line); padding: 16px; }
.history-intro p { flex: 1; margin: 0; }
.history-intro button { flex: none; }
.history-entry { padding: 16px; border-top: 1px solid var(--line); }
.history-entry header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; }
.history-entry h3 { margin: 0; font: 650 14px/1.5 var(--sans); }
.history-entry header span, .history-note { color: var(--muted); }
.history-entry header .resolved { color: var(--jade-deep); }
.history-entry p { margin: 8px 0; overflow-wrap: anywhere; }
dl { display: flex; flex-wrap: wrap; gap: 8px 24px; margin: 8px 0 16px; font-size: 12px; }
dl div { display: flex; gap: 8px; } dt { color: var(--muted); } dd { margin: 0; font-variant-numeric: tabular-nums; }
.resolution-preview { margin-top: 16px; padding: 16px; border-left: 3px solid var(--jade); background: var(--jade-wash); }
.resolution-preview > div { display: flex; flex-wrap: wrap; gap: 8px; }
.history-warning, .history-error { margin: 0 16px 16px; padding: 8px 16px; border-left: 3px solid var(--cinnabar); }
.finding-history > p, .finding-history > button { margin: 16px; }
button:focus-visible, summary:focus-visible { outline: 2px solid var(--jade); outline-offset: 3px; }
@media (max-width: 700px) { .history-intro { flex-wrap: wrap; } .history-intro p { flex-basis: 100%; } }
</style>
