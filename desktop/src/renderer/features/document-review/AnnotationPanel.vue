<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { DocumentAnnotation } from '../../../contracts/document-review/annotations'
import type { useDocumentReview } from './use-document-review'
import AnnotationRevisionPanel from './AnnotationRevisionPanel.vue'
import { annotationFormDrafts } from './annotation-form-drafts'
const props = defineProps<{ review: ReturnType<typeof useDocumentReview>; selection: { start: number; end: number; text: string } | null; readOnly?: boolean }>()
const emit = defineEmits<{ locate: [start: number, end: number] }>()
const panel = ref<HTMLElement | null>(null), input = ref<HTMLTextAreaElement | null>(null)
const activeId = ref(''), actionPending = ref(false), actionMessage = ref(''), showClosed = ref(false)
const documentKey = computed(() => {
  const document = props.review.snapshot.value?.ref
  return document ? JSON.stringify([document.workItemId, document.kind, document.documentId]) : ''
})
const draft = computed(() => annotationFormDrafts.get(documentKey.value))
const editing = computed(() => draft.value?.editing || null)
const body = computed({ get: () => draft.value?.body || '', set: value => annotationFormDrafts.set(documentKey.value, value, editing.value) })
const hasUnsavedOpinion = computed(() => editing.value ? body.value !== editing.value.body : Boolean(body.value))
const pending = computed(() => Boolean(draft.value?.pending || actionPending.value))
const message = computed(() => actionMessage.value || draft.value?.error || '')
const selected = ref<string[]>([])
watch(() => props.review.annotations.value, annotations => {
  const open = new Set(annotations.filter(item => item.status === 'open').map(item => item.id))
  selected.value = selected.value.filter(id => open.has(id))
})
let epoch = 0, disposed = false
watch(documentKey, () => {
  epoch++; actionPending.value = false; actionMessage.value = ''; selected.value = []; showClosed.value = false; activeId.value = ''
}, { flush: 'sync' })
onBeforeUnmount(() => { disposed = true; epoch++ })
const visible = computed(() => props.review.annotations.value.filter(item => showClosed.value || item.status === 'open'))
function locate(item: DocumentAnnotation) { const position = props.review.annotationPosition(item); if (position.status === 'located') { activeId.value = item.id; emit('locate', position.start, position.end) } }
async function focusForm() {
  const token = epoch
  await nextTick()
  if (disposed || token !== epoch) return
  input.value?.focus({ preventScroll: true })
  if (panel.value) panel.value.scrollTop = 0
}
function edit(item: DocumentAnnotation) {
  if (props.readOnly || pending.value) return
  if (editing.value?.id === item.id) { void focusForm(); return }
  if (body.value && (!editing.value || body.value !== editing.value.body)) {
    actionMessage.value = '当前意见尚未保存，请先保存或清空，再编辑其他批注。'
    void focusForm(); return
  }
  actionMessage.value = ''
  annotationFormDrafts.set(documentKey.value, item.body, item)
  void focusForm()
}
function cancelEditing() {
  if (pending.value) return
  annotationFormDrafts.discard(documentKey.value); actionMessage.value = ''
}
async function focusAnnotation(id: string) {
  const token = epoch
  activeId.value = id
  await nextTick()
  if (disposed || token !== epoch || !panel.value) return
  const card = [...panel.value.querySelectorAll<HTMLElement>('[data-annotation-card]')].find(element => element.dataset.annotationCard === id)
  if (!card) return
  panel.value.scrollTop += card.getBoundingClientRect().top - panel.value.getBoundingClientRect().top - 12
  card.focus({ preventScroll: true })
}
defineExpose({ focusAnnotation })
async function save() {
  if (props.readOnly || pending.value || !documentKey.value) return
  const key = documentKey.value, submitted = annotationFormDrafts.begin(key)
  if (!submitted) return
  actionMessage.value = ''
  try {
    if (submitted.editing) await props.review.changeAnnotation('update', submitted.editing, submitted.operation, submitted.body)
    else if (props.selection) await props.review.createAnnotation(submitted.body, props.selection, submitted.operation)
    else throw new Error('请先选中要批注的原文。')
    annotationFormDrafts.finish(key, submitted.operation)
  } catch (cause) { annotationFormDrafts.finish(key, submitted.operation, (cause as { message?: string })?.message || '批注未保存，输入仍然保留。') }
}
async function action(name: 'remove' | 'resolve' | 'reopen' | 'reanchor', item: DocumentAnnotation) {
  if (props.readOnly || pending.value) return
  const token = epoch
  actionPending.value = true; actionMessage.value = ''
  try { await props.review.changeAnnotation(name, item, crypto.randomUUID(), undefined, props.selection || undefined) }
  catch (cause) { if (token === epoch && !disposed) actionMessage.value = (cause as { message?: string })?.message || '批注操作未完成，请重试。' }
  finally { if (token === epoch && !disposed) actionPending.value = false }
}
</script>
<template>
  <aside v-if="review.annotationOpen.value" ref="panel" class="annotation-panel" aria-label="文档批注" data-testid="annotation-panel">
    <header><b>批注</b><button type="button" aria-label="收起批注" @click="review.annotationOpen.value = false">收起</button></header>
    <form @submit.prevent="save">
      <small>{{ editing ? '编辑批注' : selection?.text ? `批注选文 · ${selection.text.length} 字符` : body ? '意见已保留，请重新选中原文后保存' : '先在文档中选中文字，再添加批注' }}</small>
      <blockquote v-if="!editing && selection?.text">{{ selection.text.slice(0, 160) }}</blockquote>
      <label class="annotation-input-label">修改意见<textarea ref="input" v-model="body" aria-label="批注内容" maxlength="10000" rows="3" placeholder="例如：这里的动机不够明确，请与前文的约定呼应。" :disabled="readOnly || pending || !documentKey" /></label>
      <div class="annotation-actions"><button v-if="editing || body" type="button" :disabled="pending" @click="cancelEditing">{{ editing ? '取消编辑' : '清空意见' }}</button><button type="submit" :disabled="readOnly || pending || !documentKey || !body.trim() || (!editing && !selection?.text)" data-testid="save-annotation">{{ pending ? '保存中…' : '保存批注' }}</button></div>
      <p v-if="message" role="alert">{{ message }}</p>
    </form>
    <label class="annotation-filter"><input v-model="showClosed" type="checkbox">显示已解决和已删除</label>
    <p v-if="!visible.length" class="annotation-empty">{{ showClosed ? '当前文档还没有批注' : '当前文档没有待处理批注' }}</p>
    <article v-for="item in visible" :key="item.id" :data-annotation-card="item.id" :class="{ closed: item.status !== 'open', active: activeId === item.id }" tabindex="-1" :aria-label="'批注：' + item.body.slice(0, 60)">
      <label v-if="item.status === 'open'" class="annotation-filter"><input v-model="selected" type="checkbox" :value="item.id" :aria-label="`选择批注：${item.body.slice(0, 60)}`">用于改稿</label>
      <header><button type="button" :disabled="review.annotationPosition(item).status !== 'located'" @click="locate(item)">定位原文</button><small>{{ item.status === 'resolved' ? '已解决' : item.status === 'deleted' ? '已删除' : review.annotationPosition(item).status === 'located' ? '待处理' : '原文已变化 · 待定位' }}</small></header>
      <blockquote>{{ item.anchor.quote.slice(0, 240) }}</blockquote><p class="annotation-body">{{ item.body }}</p>
      <div class="annotation-actions">
        <button v-if="item.status !== 'deleted'" type="button" :disabled="readOnly || pending" @click="edit(item)">编辑</button>
        <button v-if="item.status === 'open'" type="button" :disabled="readOnly || pending" @click="action('resolve', item)">解决</button>
        <button v-else type="button" :disabled="readOnly || pending" @click="action('reopen', item)">重新打开</button>
        <button v-if="item.status !== 'deleted' && review.annotationPosition(item).status !== 'located'" type="button" :disabled="readOnly || pending || !selection?.text" @click="action('reanchor', item)">关联当前选文</button>
        <button v-if="item.status !== 'deleted'" type="button" :disabled="readOnly || pending" @click="action('remove', item)">删除</button>
      </div>
    </article>
    <button v-if="review.annotationCursor.value !== null" type="button" :disabled="review.annotationsLoading.value" @click="review.loadMoreAnnotations">{{ review.annotationsLoading.value ? '读取中…' : '更多批注' }}</button>
    <AnnotationRevisionPanel :review="review" :selected-ids="selected" :disabled="readOnly || pending" :unsaved-opinion="hasUnsavedOpinion" @edit-opinion="focusForm" />
    <button type="button" @click="review.loadRecoveryHistory">查看留存的修订恢复稿</button>
  </aside>
</template>
<style scoped>
.annotation-panel { box-sizing:border-box; flex:none; width:19rem; max-width:42%; min-height:0; overflow:auto; padding:1rem; border-left:1px solid var(--line); background:var(--surface); color:var(--ink); font:13px/1.6 var(--sans); }
header,.annotation-actions { display:flex; align-items:center; justify-content:space-between; gap:.5rem; flex-wrap:wrap; }
header { margin-bottom:.75rem; } header b { font-size:15px; } button { color:inherit; cursor:pointer; background:transparent; border:1px solid var(--line); padding:.25rem .6rem; border-radius:3px; font:inherit; } button:disabled { opacity:.45; cursor:default; }
button:focus-visible,textarea:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
form { padding-bottom:1rem; border-bottom:1px solid var(--line); } .annotation-input-label { display:grid; gap:.3rem; } textarea { box-sizing:border-box; width:100%; resize:vertical; min-height:5rem; border:1px solid var(--line); padding:.6rem; background:var(--surface-raised); color:inherit; font:inherit; margin-bottom:.5rem; }
blockquote { border-left:2px solid var(--gold); margin:.5rem 0; padding:0 .5rem; color:var(--ink-soft); overflow-wrap:anywhere; white-space:pre-wrap; }
article { padding:1rem 0; border-bottom:1px solid var(--line); } .annotation-body { white-space:pre-wrap; overflow-wrap:anywhere; margin:.5rem 0; } .annotation-filter { display:flex; gap:.4rem; padding-top:.8rem; } .annotation-empty,small { color:var(--ink-soft); } .closed { opacity:.75; } [role=alert] { color:var(--cinnabar); }
article.active { background:var(--jade-wash); } article:focus-visible { outline:2px solid var(--gold); outline-offset:-2px; }
@media(max-width:1150px) { .annotation-panel { width:17rem; max-width:46%; padding:.65rem; } }
</style>
