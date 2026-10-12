<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { FormalSkeletonPreview, FormalSkeletonView } from '../../../../contracts/planning/types'

const props = defineProps<{ proposalId: string; workItemId: string; volume: number; candidate: unknown; saved: boolean; disabled?: boolean }>()
const preview = ref<FormalSkeletonPreview | null>(null)
const result = ref<FormalSkeletonView | null>(null)
const busy = ref(false)
const error = ref('')
let generation = 0
const identity = computed(() => JSON.stringify([props.workItemId, props.proposalId, props.volume, props.candidate, props.saved]))
watch(identity, () => { generation++; preview.value = null; result.value = null; error.value = ''; busy.value = false })
onBeforeUnmount(() => { generation++ })
const view = computed(() => preview.value ?? result.value)
const labels = { untracked: '尚未采用', current: '正式版本有效', stale: '上游待复核', changed: '候选有修改' }

async function inspect() {
  if (!props.saved || props.disabled || busy.value) return
  const ticket = ++generation
  busy.value = true; error.value = ''; preview.value = null
  try {
    const next = await window.novelDesktop!.planning.previewFormalSkeleton(props.proposalId, props.volume)
    if (ticket === generation) preview.value = next
  } catch (e) { if (ticket === generation) error.value = e instanceof Error ? e.message : '预览未能读取，请重试。' }
  finally { if (ticket === generation) busy.value = false }
}

async function adopt() {
  const selected = preview.value
  if (!selected?.canAdopt || busy.value || !props.saved || props.disabled) return
  const ticket = ++generation
  busy.value = true; error.value = ''
  try {
    const next = await window.novelDesktop!.planning.adoptFormalSkeleton(selected.token)
    if (ticket === generation) { result.value = next; preview.value = null }
  } catch (e) {
    if (ticket === generation) { preview.value = null; error.value = e instanceof Error ? e.message : '采用失败，请重新预览。' }
  } finally { if (ticket === generation) busy.value = false }
}
</script>

<template>
  <div class="formal-skeleton-adoption" :data-formal-skeleton-volume="volume">
    <div class="skeleton-actions">
      <button type="button" class="control-button" :disabled="!saved || disabled || busy" @click="inspect">{{ busy ? '正在核对…' : '核对并采用本卷安排' }}</button>
      <small v-if="!saved">候选保存后可核对</small>
      <small v-else-if="result" role="status">正式骨架已保存，章纲与正文保持原稿。</small>
    </div>
    <div v-if="view" class="skeleton-review">
      <p>{{ view.reason }}</p>
      <p v-if="view.affectedChapterIds.length">采用后需复核章纲：第 {{ view.affectedChapterIds.join('、') }} 章</p>
      <ul>
        <li v-for="entry in view.entries" :key="entry.chapter">
          <span>第 {{ entry.chapter }} 章 · {{ entry.title }}</span>
          <span>{{ labels[entry.status] }}<code v-if="entry.revision" :title="entry.revision"> · {{ entry.revision.slice(0, 8) }}</code></span>
          <small v-if="entry.reasons.length">{{ entry.reasons.join('；') }}</small>
        </li>
      </ul>
      <div v-if="preview" class="skeleton-actions">
        <button type="button" class="control-button primary" :disabled="!preview.canAdopt || !saved || disabled || busy" @click="adopt">确认采用本卷骨架</button>
        <button type="button" class="control-button" :disabled="busy" @click="preview = null">取消</button>
      </div>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.formal-skeleton-adoption { margin: 12px 18px; padding: 12px; color: var(--color-ink); background: var(--color-surface); border: 1px solid var(--color-line); }
.skeleton-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.skeleton-review ul { max-height: 240px; overflow: auto; list-style: none; padding: 0; }
.skeleton-review li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--color-line); }
.skeleton-review li small { flex-basis: 100%; }
.skeleton-review code { font-size: .85em; }
</style>
