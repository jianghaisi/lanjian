<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { useDocumentReview } from './use-document-review'
import type { AnnotationRevisionSelection, AnnotationRevisionTask, RelatedRevisionAnalysis } from '../../../contracts/document-review/generation'
import type { AuthorAnswer } from '../../../contracts/assistant/author-interaction-contracts'
import AuthorQuestionCard from '../assistant/components/AuthorQuestionCard.vue'
import { annotationAnswerDrafts } from './annotation-answer-drafts'
import type { AuthorQuestionDraft } from '../assistant/services/author-question-draft'
const props = defineProps<{ review: ReturnType<typeof useDocumentReview>; selectedIds: string[]; disabled?: boolean; unsavedOpinion?: boolean }>()
const emit = defineEmits<{ 'edit-opinion': [] }>()
const tasks = shallowRef<AnnotationRevisionTask[]>([]), analysis = shallowRef<RelatedRevisionAnalysis | null>(null), selection = shallowRef<AnnotationRevisionSelection | null>(null)
const targets = ref<string[]>([]), busy = ref(false), error = ref('')
const taskReadError = ref('')
const stopping = ref(new Set<string>())
const deferredQuestions = ref(new Set<string>())
const generationDisabled = computed(() => Boolean(props.disabled || props.unsavedOpinion))
let epoch = 0, readSequence = 0, timer: ReturnType<typeof setTimeout> | undefined, disposed = false
let intentGeneration = 0, analysisGeneration = -1
const annotationIntent = computed(() => JSON.stringify([...props.selectedIds].sort().map(id => {
  const annotation = props.review.annotations.value.find(item => item.id === id)
  return [id, annotation?.revision, annotation?.status]
})))
function clearAnalysis() { analysis.value = null; selection.value = null; targets.value = []; analysisGeneration = -1 }
function invalidateAnalysis() {
  intentGeneration++
  if (analysis.value || busy.value) error.value = '所选批注或编辑状态已变化，请重新发起修改。'
  clearAnalysis()
}
function checkIntent(token: number, intent: number) {
  if (token !== epoch || disposed) throw new Error('文档已切换，请重新选择批注。')
  if (intent !== intentGeneration) throw new Error('所选批注或编辑状态已变化，请重新发起修改。')
  if (generationDisabled.value) throw new Error('请先完成当前编辑或保存，再根据批注修改。')
}
const labels = { queued: '等待生成', running: '正在生成', succeeded: '等待逐处核对', failed: '未完成', cancelled: '已停止', interrupted: '运行中断', 'waiting-input': '等待回答' }
function taskLabel(task: AnnotationRevisionTask) {
  if (task.stale) return '依据已变化，请重新生成'
  if (task.status === 'waiting-input' && answerDraft(task)?.acknowledged) return '回答已提交，正在核对后续进度'
  if (task.status === 'succeeded' && task.reviewId) {
    if (!task.pending && !task.staged) return '本次建议已处理'
    if (task.staged) return task.pending ? '已部分保留，继续核对' : '已保留，等待保存'
    if (task.committed) return '已部分保存，继续核对'
  }
  return labels[task.status]
}
async function reload() {
  const origin = props.review.snapshot.value?.ref, token = epoch, request = ++readSequence
  if (!origin || disposed) return
  try {
    const next = await props.review.generation.recent(origin)
    if (token !== epoch || request !== readSequence || disposed) return
    const newlyFinished = next.some(t => t.status === 'succeeded' && tasks.value.find(old => old.id === t.id)?.status !== 'succeeded')
    tasks.value = next
    taskReadError.value = ''
    if (newlyFinished) await props.review.refresh()
    if (token !== epoch || request !== readSequence || disposed) return
    clearTimeout(timer)
    if (next.some(t => t.status === 'running' || t.status === 'queued')) timer = setTimeout(reload, 2000)
  } catch (cause) { if (token === epoch && request === readSequence && !disposed) taskReadError.value = (cause as { message?: string })?.message || '任务状态读取失败，可稍后刷新。' }
}
watch(() => JSON.stringify(props.review.snapshot.value?.ref), () => { epoch++; intentGeneration++; busy.value = false; stopping.value.clear(); deferredQuestions.value.clear(); error.value = ''; taskReadError.value = ''; clearTimeout(timer); tasks.value = []; clearAnalysis(); void reload() }, { immediate: true, flush: 'sync' })
watch(annotationIntent, invalidateAnalysis, { flush: 'sync' })
watch(generationDisabled, disabled => { if (disabled) invalidateAnalysis() }, { flush: 'sync' })
watch(() => props.review.reviews.value.flatMap(r => r.blocks.map(b => b.status)).join(','), () => { if (tasks.value.length) void reload() })
// A submitted answer may be acknowledged after this document remounts.
// Re-read the real task, but never offer to submit that old question again.
watch(() => tasks.value.filter(task => task.status === 'waiting-input' && answerDraft(task)?.acknowledged).map(task => task.id).join(','), ids => { if (ids) void reload() })
onBeforeUnmount(() => { disposed = true; epoch++; clearTimeout(timer) })
async function operate(action: () => Promise<void>, requiresSavedOpinion = true) {
  if (disposed || busy.value || props.disabled || (requiresSavedOpinion && props.unsavedOpinion)) return
  const token = epoch, intent = intentGeneration
  busy.value = true; error.value = ''
  try { await action() } catch (cause) { if (token === epoch && intent === intentGeneration && !disposed) error.value = (cause as { message?: string })?.message || '操作未完成，批注和原文已保留。' }
  finally { if (token === epoch && !disposed) busy.value = false }
}
async function analyze() {
  const token = epoch, intent = intentGeneration
  clearAnalysis()
  checkIntent(token, intent)
  // Freeze the author's selection before the draft queue or IPC can yield.
  const annotations = props.review.annotations.value.filter(a => props.selectedIds.includes(a.id) && a.status === 'open').map(a => ({ id: a.id, revision: a.revision }))
  if (!annotations.length) throw new Error('请勾选要处理的批注。')
  if (annotations.length !== props.selectedIds.length) throw new Error('所选批注已变化，请重新选择待处理批注。')
  const origin = await props.review.prepareGeneration()
  checkIntent(token, intent)
  const selected = { origin, annotations }
  const next = await props.review.generation.analyzeRelated(selected)
  checkIntent(token, intent)
  selection.value = selected; analysis.value = next; analysisGeneration = intent
  targets.value = [origin.documentId]
}
async function generate(mode: 'current' | 'related') {
  const token = epoch
  if (mode === 'current') await analyze()
  if (!selection.value || !analysis.value) throw new Error('请重新选择关联文档并核对修改依据。')
  const intent = analysisGeneration
  checkIntent(token, intent)
  const selected = mode === 'current' ? [selection.value.origin] : analysis.value.targets.filter(t => targets.value.includes(t.document.documentId)).map(t => t.document)
  if (!selected.length || selected.length > 8) throw new Error('每次请选择 1 到 8 份目标文档。')
  const input = { ...selection.value, mode, receipt: analysis.value.receipt, targets: selected }
  clearAnalysis()
  try {
    // Flush new author input before main validates the existing receipt. A
    // changed draft requires fresh analysis; it must not silently reuse it.
    if (mode === 'related') { await props.review.prepareGeneration(); checkIntent(token, intent) }
    for (const target of selected) {
      checkIntent(token, intent)
      await props.review.generation.start({ ...input, target, operationId: crypto.randomUUID() })
    }
  } finally { if (token === epoch && !disposed) { clearTimeout(timer); await reload() } }
}
async function reviewTask(task: AnnotationRevisionTask) {
  if (task.target.document.documentId === props.review.snapshot.value?.ref.documentId) await props.review.open(task.id)
  else window.dispatchEvent(new CustomEvent('document-review:navigate', { detail: task.target.document }))
}
async function stopTask(task: AnnotationRevisionTask) {
  if (disposed || stopping.value.has(task.id) || !['running', 'queued', 'waiting-input'].includes(task.status)) return
  const token = epoch
  stopping.value.add(task.id); error.value = ''
  try {
    await props.review.generation.cancel(task.id)
    if (token === epoch && !disposed) await reload()
  } catch (cause) {
    if (token === epoch && !disposed) error.value = (cause as { message?: string })?.message || '停止请求未完成，请重新核对任务状态。'
  } finally { if (token === epoch && !disposed) stopping.value.delete(task.id) }
}
async function retryTask(task: AnnotationRevisionTask) {
  if (stopping.value.has(task.id)) return
  await operate(async () => { await props.review.generation.resume({ id: task.id, operationId: crypto.randomUUID() }); await reload() })
}
async function answer(task: AnnotationRevisionTask, answers: AuthorAnswer[]) {
  if (disposed || generationDisabled.value || !task.question) return
  const document = task.origin
  const submitted = annotationAnswerDrafts.begin(document, { runId: task.id, questionId: task.question.id, questionVersion: task.question.version, answers })
  if (!submitted) return
  try {
    await props.review.generation.answer({ ...submitted.draft, answerSubmissionId: submitted.operation })
    annotationAnswerDrafts.finish(document, submitted)
  } catch (cause) {
    annotationAnswerDrafts.finish(document, submitted, (cause as { message?: string })?.message || '回答未提交，输入仍保留在当前窗口。')
    throw cause
  }
}
function answerDraft(task: AnnotationRevisionTask) {
  return task.question ? annotationAnswerDrafts.get(task.origin, { runId: task.id, questionId: task.question.id, questionVersion: task.question.version }) : undefined
}
function saveAnswerDraft(task: AnnotationRevisionTask, draft: AuthorQuestionDraft) {
  if (task.id !== draft.runId || task.question?.id !== draft.questionId || task.question.version !== draft.questionVersion) return
  annotationAnswerDrafts.set(task.origin, draft)
}
</script>
<template>
  <section class="annotation-generation" aria-label="根据批注修改">
    <p>已选 {{ selectedIds.length }} 条批注</p>
    <p v-if="unsavedOpinion" role="status" data-testid="unsaved-annotation-opinion">还有尚未保存的批注意见，请先保存或取消本次填写，再发起改稿。<button type="button" @click="emit('edit-opinion')">返回意见</button></p>
    <div class="generation-actions">
      <button type="button" :disabled="generationDisabled || busy || !selectedIds.length" data-testid="revise-current-from-annotations" @click="operate(() => generate('current'))">修改当前文档</button>
      <button type="button" :disabled="generationDisabled || busy || !selectedIds.length" data-testid="analyze-annotation-targets" @click="operate(analyze)">选择关联文档</button>
    </div>
    <fieldset v-if="analysis" :disabled="generationDisabled || busy" data-testid="annotation-targets">
      <legend>要生成建议的文档</legend>
      <label v-for="target in analysis.targets" :key="target.document.documentId" :data-target-kind="target.document.kind"><input v-model="targets" type="checkbox" :value="target.document.documentId"><span>{{ target.title }}<small>{{ target.reason }}</small></span></label>
      <p v-if="analysis.hasMore">关联文档较多，此处显示前 200 份；可从更具体的卷纲或章纲继续操作。</p>
      <button type="button" :disabled="!targets.length || targets.length > 8" data-testid="generate-annotation-targets" @click="operate(() => generate('related'))">为所选文档生成建议</button>
    </fieldset>
    <p v-if="busy">正在核对修改依据…</p><p v-if="error" role="alert">{{ error }}</p>
    <p v-if="taskReadError" role="alert">{{ taskReadError }}</p>
    <small>生成结果以红字显示。保留后仍需保存；批注由你决定何时解决。</small>
    <details v-if="tasks.length" open class="annotation-runs"><summary>批注改稿记录（{{ tasks.length }}）</summary>
      <article v-for="task in tasks" :key="task.id" :data-annotation-task="task.id">
        <strong>{{ task.target.title }}</strong><p>{{ taskLabel(task) }}</p>
        <small>{{ task.model }}<template v-if="task.reviewId"> · {{ task.pending }} 处待处理 / {{ task.staged }} 处待保存 / {{ task.committed }} 处已保存</template></small>
        <p v-if="task.error" role="alert">{{ task.error }}</p>
        <details v-if="task.rawResult"><summary>查看未通过的候选与复核问题</summary><pre class="failed-result">{{ task.rawResult }}</pre></details>
        <div class="generation-actions">
          <button v-if="task.status === 'succeeded'" type="button" :disabled="disabled || busy" @click="operate(() => reviewTask(task), false)">在目标文档核对</button>
          <button v-if="['running','queued','waiting-input'].includes(task.status) && !answerDraft(task)?.acknowledged" type="button" :disabled="stopping.has(task.id)" data-testid="stop-annotation-task" @click="stopTask(task)">{{ stopping.has(task.id) ? '停止中…' : '停止' }}</button>
          <button v-if="['failed','cancelled','interrupted'].includes(task.status) && !task.stale" type="button" :disabled="generationDisabled || busy || stopping.has(task.id)" @click="retryTask(task)">重试</button>
          <button v-if="task.status === 'waiting-input' && task.question && !answerDraft(task)?.acknowledged && deferredQuestions.has(task.id)" type="button" @click="deferredQuestions.delete(task.id)">继续回答</button>
        </div>
        <p v-if="answerDraft(task)?.error" role="alert">{{ answerDraft(task)?.error }}</p>
        <p v-if="task.status === 'waiting-input' && answerDraft(task)?.acknowledged" role="status">回答已提交；正在核对后续任务，可刷新改稿记录查看进度。</p>
        <fieldset v-if="task.status === 'waiting-input' && task.question && !answerDraft(task)?.acknowledged && !deferredQuestions.has(task.id)" class="annotation-question" :disabled="generationDisabled || busy || stopping.has(task.id)" aria-label="作者回答">
          <AuthorQuestionCard :question="task.question" :book-title="task.target.title" :busy="Boolean(answerDraft(task)?.pending)" :needs-resume="false" :run-id="task.id" :draft="answerDraft(task)?.draft" draft-status="回答暂存在当前窗口，提交后才会继续" @update:draft="saveAnswerDraft(task, $event)" @submit="operate(() => answer(task, $event))" @defer="deferredQuestions.add(task.id)" @cancel="stopTask(task)" />
        </fieldset>
      </article>
    </details>
    <button type="button" :disabled="busy" @click="reload">刷新改稿记录</button>
  </section>
</template>
<style scoped>
.annotation-generation { border-block:1px solid var(--line); padding:.8rem 0; margin-top:.8rem; font:13px/1.6 var(--sans); }
.generation-actions { display:flex; gap:.4rem; flex-wrap:wrap; margin:.5rem 0; } button { border:1px solid var(--line); background:var(--surface); color:var(--ink); padding:.35rem .5rem; border-radius:3px; font:inherit; cursor:pointer; } button:disabled { opacity:.5; cursor:default; }
fieldset { margin:.75rem 0; padding:.6rem; border:1px solid var(--line); max-height:22rem; overflow:auto; } label { display:flex; gap:.4rem; margin-bottom:.6rem; } input { flex:none; } small { display:block; color:var(--ink-soft); } p { margin:.4rem 0; } article { padding:.75rem 0; border-bottom:1px solid var(--line); } [role=alert] { color:var(--cinnabar); } button:focus-visible { outline:2px solid var(--accent); } .annotation-runs { margin:.8rem 0; }
.failed-result { white-space:pre-wrap; overflow-wrap:anywhere; max-height:24rem; overflow:auto; }
.annotation-question { border:0; padding:0; margin:0; max-height:none; min-width:0; overflow:visible; }
</style>
