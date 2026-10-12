<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { ChapterUpstreamReview, UpstreamReviewDecision, UpstreamReviewFinding } from '../../../../contracts/planning/upstream-review-contracts'

const props = defineProps<{ workItemId: string; chapterId: number; review?: ChapterUpstreamReview; disabled?: boolean }>()
const emit = defineEmits<{ saved: [] }>()
const pending = ref(false), message = ref(''), reasons = ref<Record<string, string>>({})
const open = ref(false)
let generation = 0
const identity = computed(() => JSON.stringify([props.workItemId, props.chapterId, props.review]))
watch(identity, () => { generation++; pending.value = false; message.value = ''; reasons.value = {} })
watch(() => `${props.workItemId}:${props.chapterId}`, () => { open.value = false })
onBeforeUnmount(() => generation++)
const unresolved = computed(() => props.review?.findings.filter(f => !['clear', 'no-conflict'].includes(f.status)).length ?? 0)
const labels = { time: '时间', characters: '人物', location: '地点', event: '事件', result: '结果' }
const statuses = { pending: '待复核', blocked: '来源不可用', clear: '内容一致', 'no-conflict': '已确认不冲突', 'needs-upstream-change': '需要调整上游' }
async function decide(finding: UpstreamReviewFinding, decision: UpstreamReviewDecision) {
  if (pending.value || props.disabled || finding.status === 'blocked') return
  const reason = reasons.value[finding.fingerprint]?.trim()
  if (!reason) { message.value = '请先填写判断理由。'; return }
  const ticket = ++generation, scope = identity.value
  pending.value = true; message.value = ''
  try {
    await window.novelDesktop.outlines.decideUpstreamReview({ workItemId: props.workItemId, chapterId: props.chapterId, fingerprint: finding.fingerprint, decision, reason })
    if (ticket !== generation || scope !== identity.value) return
    message.value = '判断已保存；将按当前依据重新检查。'
    emit('saved')
  } catch (error) {
    if (ticket === generation && scope === identity.value) message.value = error instanceof Error ? error.message : '保存失败，请重新核对后重试。'
  } finally { if (ticket === generation) pending.value = false }
}
</script>

<template>
  <section v-if="review && (review.findings.length || review.history.length)" class="upstream-review" data-testid="chapter-upstream-review" aria-label="细化事件上行复核">
    <button class="review-toggle" type="button" :aria-expanded="open" @click="open = !open">{{ open ? '收起' : '展开' }}上行复核 · {{ unresolved ? `${unresolved} 项待处理` : '当前已核对' }}</button>
    <div v-if="open" class="review-body">
      <p>对照细化事件与当前来源。文字差异不等于情节冲突，请结合总纲、卷纲判断。确认不冲突只对当前依据有效。</p>
      <p v-if="disabled">章纲有未保存的改动或正在处理，请先保存并等待完成。</p>
      <article v-for="(finding, index) in review.findings" :key="finding.fingerprint" class="review-item">
        <header><b>细化事件 {{ index + 1 }}</b><span>{{ statuses[finding.status] }}</span></header>
        <p v-if="finding.status === 'blocked'">来源已归档、缺失或不再是计划事件。请先在事件中恢复或调整来源，再重新核对。</p>
        <details>
          <summary>来源与版本</summary>
          <p>细化事件：{{ finding.eventId }} · {{ finding.eventVersion }}</p>
          <p>来源事件：{{ finding.sourceId }} · {{ finding.sourceVersion || '不可用' }}</p>
          <p>创建细化关系时的来源版本：{{ finding.provenanceRevision }}</p>
        </details>
        <div class="comparison">
          <b>核对项目</b><b>当前来源</b><b>本章细化</b>
          <template v-for="field in finding.fields" :key="field.field">
            <span :class="{ changed: field.changed }">{{ labels[field.field] }}{{ field.changed ? ' · 有差异' : '' }}</span><span>{{ field.source || '未填写' }}</span><span>{{ field.detail || '未填写' }}</span>
          </template>
        </div>
        <p v-if="finding.decision">已保存判断：{{ finding.decision.reason }}（{{ finding.decision.decidedAt }}）</p>
        <template v-if="finding.status !== 'blocked'">
          <label>判断理由<textarea v-model="reasons[finding.fingerprint]" rows="2" maxlength="2000" :disabled="pending || disabled" placeholder="说明这是合理细化，或哪些上游安排需要调整" /></label>
          <div class="review-actions"><button type="button" :disabled="pending || disabled || !reasons[finding.fingerprint]?.trim()" @click="decide(finding, 'no-conflict')">确认不冲突</button><button type="button" :disabled="pending || disabled || !reasons[finding.fingerprint]?.trim()" @click="decide(finding, 'needs-upstream-change')">需要调整上游</button></div>
        </template>
      </article>
      <details v-if="review.history.length" data-testid="upstream-review-history"><summary>最近判断记录（{{ review.history.length }}）</summary>
        <article v-for="record in review.history" :key="`${record.fingerprint}:${record.decidedAt}:${record.decision}`" class="review-item">
          <p>{{ record.decidedAt }} · {{ statuses[record.decision] }} · {{ record.reason }}<small>事件 {{ record.eventId }} · 依据 {{ record.fingerprint }}</small></p>
          <details v-if="record.evidence" class="historical-comparison">
            <summary>查看当时事件对照</summary>
            <p>以下是作出判断时保存的对照，后续修改不会更新这份记录。</p>
            <small>当时细化版本：{{ record.evidence.eventVersion }}</small>
            <small>当时来源版本：{{ record.evidence.sourceVersion }}</small>
            <small>细化关系最初引用：{{ record.evidence.provenanceRevision }}</small>
            <div class="comparison"><b>核对项目</b><b>当时来源</b><b>当时细化</b>
              <template v-for="field in record.evidence.fields" :key="field.field"><span :class="{ changed: field.changed }">{{ labels[field.field] }}{{ field.changed ? ' · 有差异' : '' }}</span><span>{{ field.source || '未填写' }}</span><span>{{ field.detail || '未填写' }}</span></template>
            </div>
          </details>
          <p v-else>该历史判断未保存事件对照，仅保留理由与依据指纹。</p>
        </article>
      </details>
    </div>
    <p v-if="message" role="status">{{ message }}</p>
  </section>
</template>

<style scoped>
.upstream-review { border: 1px solid var(--color-line); padding: .65rem .85rem; color: var(--color-ink); min-width: 0; }
.review-toggle { text-align: left; width: 100%; }
.review-body { max-height: 34rem; overflow: auto; padding-top: .65rem; }
.review-body p { line-height: 1.6; overflow-wrap: anywhere; }
.review-item { padding: .75rem 0; border-top: 1px solid var(--color-line); }
header,.review-actions { display: flex; justify-content: space-between; gap: .6rem; flex-wrap: wrap; }
.comparison { display: grid; grid-template-columns: minmax(5rem,.5fr) repeat(2,minmax(0,1fr)); gap: .5rem; padding: .75rem 0; }
.comparison span { white-space: pre-wrap; overflow-wrap: anywhere; }
.changed { font-weight: 700; }
label,small { display: block; }
small { overflow-wrap: anywhere; opacity: .8; }
textarea { display: block; box-sizing: border-box; width: 100%; resize: vertical; margin: .4rem 0; color: var(--color-ink); background: var(--color-surface); border: 1px solid var(--color-line); padding: .5rem; }
button { color: var(--color-ink); background: var(--color-surface); border: 1px solid var(--color-line); padding: .45rem .6rem; cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible,textarea:focus-visible,summary:focus-visible { outline: 2px solid var(--color-jade); outline-offset: 2px; }
</style>
