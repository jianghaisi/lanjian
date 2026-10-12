<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { ChapterEventAdoptionPreview, ChapterEventAdoptionResult, ChapterEventPreview, ChapterEventDraft, ChapterEventRefinementSource } from '../../../../contracts/planning/types'
import { MAX_CHAPTER_ADOPTION_EVENTS } from '../../../../contracts/planning/chapter-event-contracts'

const props = defineProps<{ comparison: ChapterEventPreview; saved: boolean; disabled?: boolean }>()
const emit = defineEmits<{ adopted: [value: ChapterEventAdoptionResult & { proposalId: string }] }>()
const open = ref(false), busy = ref(false), acknowledged = ref(false), submitted = ref(false)
const preview = ref<ChapterEventAdoptionPreview | null>(null), error = ref(''), message = ref('')
type EventDraft = { key: number; selected: boolean; expanded: boolean; mode?: 'replace'; time: string; characters: string; location: string; event: string; result: string; refines?: ChapterEventRefinementSource; replaces?: ChapterEventRefinementSource }
const drafts = ref<EventDraft[]>([])
let nextKey = 0
let generation = 0
const selectedDrafts = computed(() => drafts.value.filter(d => d.selected))
const valid = computed(() => selectedDrafts.value.length > 0 && selectedDrafts.value.every(d => (d.mode !== 'replace' || d.replaces) && [d.time, d.characters, d.location, d.event, d.result].every(v => v.trim())))
const previewEvents = computed(() => preview.value ? preview.value.events ?? [preview.value.event] : [])
const refinementSources = computed(() => props.comparison.formalEvents.filter(e => e.phase === 'planned' && e.version))
const replacementSources = computed(() => refinementSources.value.filter(e => e.replaceable))
const replacementCount = computed(() => previewEvents.value.filter(e => e.replaces).length)
function replacementBefore(source: ChapterEventRefinementSource) {
  return props.comparison.formalEvents.find(e => e.id === source.eventId && e.version === source.eventVersionId)
}
function refinementLabel(source: ChapterEventRefinementSource) {
  return props.comparison.formalEvents.find(e => e.id === source.eventId && e.version === source.eventVersionId)?.event ?? '来源事件'
}
function reset() { generation++; open.value = false; busy.value = false; preview.value = null; error.value = ''; message.value = ''; submitted.value = false }
watch(() => props.comparison, reset)
watch(drafts, () => { generation++; preview.value = null; acknowledged.value = false }, { deep: true, flush: 'sync' })
onBeforeUnmount(() => { generation++ })
function begin() {
  const c = props.comparison.candidate
  drafts.value = [{ key: ++nextKey, selected: true, expanded: true, time: '', characters: c.characters.join('、'), location: c.location, event: c.coreEvent, result: c.plannedResult }]
  open.value = true; message.value = ''; error.value = ''; submitted.value = false
}
function addEvent() {
  if (drafts.value.length >= MAX_CHAPTER_ADOPTION_EVENTS || busy.value || submitted.value) return
  drafts.value.forEach(d => { d.expanded = false })
  drafts.value.push({ key: ++nextKey, selected: true, expanded: true, time: '', characters: '', location: '', event: '', result: '' })
}
async function inspect() {
  if (!valid.value || busy.value || !props.saved || props.disabled || submitted.value) return
  const ticket = ++generation
  busy.value = true; error.value = ''; preview.value = null; acknowledged.value = false
  const events: ChapterEventDraft[] = selectedDrafts.value.map(draft => ({ time: draft.time, location: draft.location, event: draft.event, result: draft.result,
    characters: draft.characters.split(/[、,，\n]/).map(c => c.trim()).filter(Boolean),
    ...(draft.mode === 'replace' ? { replaces: { ...draft.replaces! } } : draft.refines ? { refines: { ...draft.refines } } : {}) }))
  try {
    const next = await window.novelDesktop!.planning.previewChapterEventAdoption(props.comparison.proposalId, props.comparison.chapterId, events)
    if (ticket === generation) preview.value = next
  } catch (e) { if (ticket === generation) error.value = e instanceof Error ? e.message : '未能核对，请重试。' }
  finally { if (ticket === generation) busy.value = false }
}
async function adopt() {
  const selected = preview.value
  if (!selected || !acknowledged.value || busy.value || !props.saved || props.disabled || submitted.value) return
  const ticket = ++generation
  busy.value = true; error.value = ''; submitted.value = true
  try {
    const result = await window.novelDesktop!.planning.adoptChapterEvent(selected.token)
    if (ticket !== generation) return
    message.value = `章纲与 ${result.events?.length ?? 1} 个章节细节事件已写入，仍需复核章纲。${result.mirrorsPending ? '可读副本待同步，可在纪事中重试同步。' : ''}${result.candidateReceiptPending ? '候选标记待刷新，正式数据已保存。' : ''}`
    preview.value = null
    emit('adopted', { ...result, proposalId: props.comparison.proposalId })
  } catch (e) {
    if (ticket === generation) error.value = `${e instanceof Error ? e.message : '提交结果未能确认。'} 请先检查正式章纲与纪事；不要重复新建事件。`
  } finally { if (ticket === generation) busy.value = false }
}
async function recover() {
  if (!preview.value || busy.value) return
  const ticket = ++generation
  busy.value = true; error.value = ''
  try {
    const result = await window.novelDesktop!.planning.recoverChapterEvent(preview.value.operationId)
    if (ticket !== generation) return
    message.value = `已核实章纲与 ${result.events?.length ?? 1} 个事件提交。${result.mirrorsPending ? '可读副本待同步。' : ''}`
    preview.value = null
    emit('adopted', { ...result, proposalId: props.comparison.proposalId })
  } catch (e) {
    if (ticket !== generation) return
    if (e && typeof e === 'object' && 'code' in e && e.code === 'NOT_FOUND') {
      submitted.value = false; preview.value = null; acknowledged.value = false
      error.value = '已核实本次没有提交或待恢复记录，填写内容已保留，请重新预览。'
    } else error.value = e instanceof Error ? e.message : '恢复暂未完成，原稿与记录已保留。'
  }
  finally { if (ticket === generation) busy.value = false }
}
</script>

<template>
  <div class="joint-adoption">
    <button v-if="!open" type="button" class="control-button" :disabled="!saved || disabled || comparison.freshness !== 'current'" @click="begin">添加细节事件并联合采纳</button>
    <form v-else @submit.prevent="inspect">
      <p>勾选要与本章章纲一起写入的细节计划事件。请核对人物、时间和结果是否符合上游安排。</p>
      <fieldset v-if="!preview && !submitted" :disabled="busy || disabled || !saved">
        <article v-for="(draft, index) in drafts" :key="draft.key" class="event-draft">
          <div class="event-draft-heading">
            <label class="event-selection"><input v-model="draft.selected" type="checkbox" />采用事件 {{ index + 1 }}</label>
            <span class="event-draft-summary">{{ draft.event || '待填写' }}</span>
            <button type="button" class="control-button" :aria-expanded="draft.expanded" @click="draft.expanded = !draft.expanded">{{ draft.expanded ? '收起' : '展开' }}</button>
            <button type="button" class="control-button" :aria-label="`移除事件 ${index + 1}`" @click="drafts.splice(index, 1)">移除</button>
          </div>
          <fieldset v-if="draft.expanded" :disabled="!draft.selected">
            <label v-if="replacementSources.length" class="refinement-source">事件操作
              <select v-model="draft.mode" aria-label="事件操作"><option :value="undefined">新增细节事件</option><option value="replace">替代本章已有细节</option></select>
            </label>
            <label v-if="draft.mode === 'replace'" class="refinement-source">替代对象
              <select v-model="draft.replaces" aria-label="替代对象" required>
                <option :value="undefined" disabled>选择要追加新版本的事件</option>
                <option v-for="source in replacementSources" :key="source.id" :value="{ eventId: source.id, eventVersionId: source.version }">{{ source.time }} · {{ source.event }}</option>
              </select>
              <small>沿用事件身份和位置，旧版本保留。下方填写本次完整的新内容。</small>
            </label>
            <label v-else-if="refinementSources.length" class="refinement-source">细化来源
              <select v-model="draft.refines" aria-label="细化来源">
                <option :value="undefined">独立新增</option>
                <option v-for="source in refinementSources" :key="source.id" :value="{ eventId: source.id, eventVersionId: source.version }">{{ source.time }} · {{ source.event }}</option>
              </select>
              <small>选择后新增细节事件并记录来源，原计划保留。</small>
            </label>
        <div class="event-fields">
          <label>时间<input v-model="draft.time" required maxlength="500" placeholder="填写明确时间或相对顺序" /></label>
          <label>人物<input v-model="draft.characters" required maxlength="12000" placeholder="用顿号分隔" /></label>
          <label>地点<input v-model="draft.location" required maxlength="1000" /></label>
          <label>事件<textarea v-model="draft.event" required maxlength="5000" rows="2" /></label>
          <label>结果<textarea v-model="draft.result" required maxlength="5000" rows="2" /></label>
        </div>
          </fieldset>
        </article>
        <div class="event-batch-actions">
          <button type="button" class="control-button" :disabled="drafts.length >= MAX_CHAPTER_ADOPTION_EVENTS" @click="addEvent">添加事件</button>
          <span>已选 {{ selectedDrafts.length }} 个 · 最多 {{ MAX_CHAPTER_ADOPTION_EVENTS }} 个</span>
        <button type="submit" class="control-button" :disabled="!valid">预览联合采纳</button>
        </div>
      </fieldset>
      <section v-if="preview" class="joint-review">
        <p>{{ preview.replacesChapter ? '替换本章正式章纲' : '新增本章正式章纲' }}；新增 {{ previewEvents.length - replacementCount }} 个计划事件<span v-if="replacementCount">，替代 {{ replacementCount }} 个事件版本</span>，保留 {{ preview.existingEventCount }} 个原有关联。</p>
        <ol class="event-review-list"><li v-for="(event, index) in previewEvents" :key="index">
          <div v-if="event.replaces" class="replacement-preview">
            <strong>替代前</strong>
            <p>{{ replacementBefore(event.replaces)?.time }} · {{ replacementBefore(event.replaces)?.characters.join('、') }} · {{ replacementBefore(event.replaces)?.location }}</p>
            <p>{{ replacementBefore(event.replaces)?.event }} → {{ replacementBefore(event.replaces)?.result }}</p>
            <small>保留旧版本 {{ event.replaces.eventVersionId }}</small>
          </div>
          <strong v-if="event.replaces">替代后</strong>
          <p v-if="event.refines" class="refinement-preview">细化自：{{ refinementLabel(event.refines) }}<small>来源版本 {{ event.refines.eventVersionId }}</small></p>
          <p>{{ event.time }} · {{ event.characters.join('、') }} · {{ event.location }}</p>
          <p>{{ event.event }} → {{ event.result }}</p>
        </li></ol>
        <div v-if="preview.replacementImpact" class="replacement-impact">
          <p>本章会改为引用新版本。{{ preview.replacementImpact.chapterIds.length ? `仍引用旧版的其他章纲：第 ${preview.replacementImpact.chapterIds.join('、')} 章。` : '未发现其他章纲直接引用旧版。' }}</p>
          <p v-if="preview.replacementImpact.skeletonChapterIds.length">仍引用旧版的章节骨架：第 {{ preview.replacementImpact.skeletonChapterIds.join('、') }} 章。</p>
          <p>旧依赖保留，相关记录需重新核对；上下游情节是否冲突仍需你判断。</p>
        </div>
        <details><summary>查看将写入的完整章纲</summary><pre>{{ preview.chapterContent }}</pre></details>
        <label class="joint-confirm"><input v-model="acknowledged" type="checkbox" :disabled="busy || submitted" />我已核对事件与上游安排，确认一起写入</label>
        <button type="button" class="control-button primary" :disabled="!acknowledged || busy || submitted || disabled || !saved" @click="adopt">{{ busy ? '正在写入…' : '确认联合采纳' }}</button>
        <button v-if="!submitted" type="button" class="control-button" :disabled="busy" @click="preview = null; acknowledged = false">返回修改事件</button>
      </section>
      <button v-if="!submitted" type="button" class="control-button" :disabled="busy" @click="reset">取消</button>
      <p v-if="error" role="alert">{{ error }}</p>
      <button v-if="submitted && preview" type="button" class="control-button" :disabled="busy" @click="recover">恢复并核对提交结果</button>
      <p v-if="message" role="status">{{ message }}</p>
    </form>
  </div>
</template>

<style scoped>
.joint-adoption { margin-top: 12px; border-top: 1px solid var(--color-line); padding-top: 12px; }
.refinement-source { display: grid; gap: 4px; margin: 8px 0; }
.refinement-source select { width: 100%; min-width: 0; }
.refinement-source small, .refinement-preview small { display: block; color: var(--color-muted); overflow-wrap: anywhere; }
.replacement-preview { border-left: 2px solid var(--color-line); padding-left: 12px; margin-bottom: 12px; }
.replacement-preview small { color: var(--color-muted); overflow-wrap: anywhere; }
.replacement-impact { border-top: 1px solid var(--color-line); margin-top: 12px; }
.joint-adoption fieldset { border: 0; padding: 0; margin: 0 0 10px; min-width: 0; }
.event-draft { border-bottom: 1px solid var(--color-line); padding: 8px 0; }
.event-draft-heading, .event-batch-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.event-batch-actions { margin-top: 12px; }
.event-draft-summary { flex: 1 1 120px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.joint-adoption .event-selection { display: flex; gap: 6px; align-items: center; font-size: 14px; white-space: nowrap; }
.event-selection input { width: 16px; height: 16px; }
.event-review-list { padding-left: 24px; }
.event-review-list li + li { border-top: 1px solid var(--color-line); }
.event-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 10px 0; }
.event-fields label { display: grid; gap: 5px; min-width: 0; }
.event-fields label:last-child { grid-column: 1 / -1; }
.event-fields input, .event-fields textarea, .refinement-source select { width: 100%; box-sizing: border-box; color: var(--color-ink); background: var(--color-paper); border: 1px solid var(--color-line); padding: 8px; font: inherit; }
.joint-adoption .event-fields textarea { min-height: 64px; height: 72px; max-height: 160px; }
.joint-review { border-left: 2px solid var(--color-jade); padding-left: 12px; margin: 12px 0; }
.joint-review pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; max-height: 200px; overflow: auto; }
.joint-adoption .joint-confirm { display: flex; gap: 8px; align-items: center; margin: 12px 0; font-size: 14px; line-height: 1.5; }
.joint-adoption .joint-confirm input { width: 16px; height: 16px; margin: 0; flex-shrink: 0; }
@media (max-width: 800px) { .event-fields { grid-template-columns: minmax(0, 1fr); } }
</style>
