<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { FieldAssistantApi, FieldTask } from '../../../../contracts/assistant/field-assistant-contracts'
import type { AssistantRunView } from '../../../../contracts/assistant/assistant-run-contracts'
import { useAssistantHistoryPreview } from '../composables/use-assistant-history-preview'
import { useAssistantReading } from '../composables/use-assistant-reading'
import { copyAssistantText } from '../services/assistant-clipboard'
import { createAssistantHistoryPositions } from '../services/assistant-history-position'
import { fieldScope } from '../services/assistant-field-registry'
import { matchesAssistantHistory } from '../services/assistant-presentation'
import { assistantRunHistoryState, assistantFieldHistoryState, assistantHistoryDate, assistantHistoryText, matchesAssistantHistoryState, type AssistantHistoryFilter } from '../services/assistant-history-presentation'
import AssistantDocument from './AssistantDocument.vue'
import FieldAssistantCandidate from './FieldAssistantCandidate.vue'

type ReadState = { loading: boolean; loaded: boolean; error: string }
const props = defineProps<{ api: FieldAssistantApi; runs: AssistantRunView[]; fields: FieldTask[]; runState: ReadState; fieldState: ReadState; active: boolean; hasBook: boolean; busy: boolean; applying: boolean; receiptPending: boolean }>()
const emit = defineEmits<{ 'refresh-runs': []; 'refresh-fields': []; 'view-run': [run: AssistantRunView]; 'return-dialogue': [] }>()
const reader = useAssistantHistoryPreview(props.api)
const { preview, loading, error } = reader
const query = ref(''), filter = ref<AssistantHistoryFilter>('all')
const indexPane = ref<HTMLElement>(), detailPane = ref<HTMLElement>(), detailHeading = ref<HTMLElement>(), searchInput = ref<HTMLInputElement>()
const detailBody = ref<HTMLElement>(), findInput = ref<HTMLInputElement>(), findButton = ref<HTMLButtonElement>(), showFind = ref(false)
let returnTarget: HTMLElement | null = null, indexTop = 0
const runs = computed(() => props.runs.map(item => ({ item, state: assistantRunHistoryState(item), date: assistantHistoryDate(item.updatedAt || item.createdAt) })))
const fields = computed(() => props.fields.map(item => ({ item, state: assistantFieldHistoryState(item), date: assistantHistoryDate(item.updatedAt || item.createdAt) })))
const visibleRuns = computed(() => runs.value.filter(row => matchesAssistantHistoryState(row.state, filter.value) && matchesAssistantHistory(query.value, row.item.goal, row.item.message, row.item.result?.message || '')))
const visibleFields = computed(() => fields.value.filter(row => matchesAssistantHistoryState(row.state, filter.value) && matchesAssistantHistory(query.value, row.item.target.label, String(row.item.candidate?.after ?? ''), row.item.error || '')))
const counts = computed(() => { const all = [...runs.value, ...fields.value], pending = all.filter(row => row.state.pending).length; return { all: all.length, pending, ended: all.length - pending } })
const filters: Array<{ id: AssistantHistoryFilter; label: string }> = [{ id: 'all', label: '全部' }, { id: 'pending', label: '待处理' }, { id: 'ended', label: '已结束' }]
const previewState = computed(() => preview.value?.run ? assistantRunHistoryState(preview.value.run) : preview.value?.task ? assistantFieldHistoryState(preview.value.task) : null)
const previewCandidate = computed(() => preview.value?.task?.candidate || preview.value?.run?.handoff?.result.task?.candidate)
const previewFailure = computed(() => preview.value?.task?.rawResult || preview.value?.run?.handoff?.result.task?.rawResult)
const selectedKey = computed(() => preview.value?.run ? 'run:' + preview.value.run.id : preview.value?.task ? 'field:' + preview.value.task.id : '')
const canViewRun = computed(() => !props.busy && !props.applying && !props.receiptPending && !loading.value && !error.value)
const findEnabled = computed(() => props.active && Boolean(preview.value) && showFind.value)
const { query: findQuery, matches: findMatches, active: findActive, limited: findLimited, searching: findSearching, headings, jump, jumpHeading } = useAssistantReading(detailBody, findEnabled, 'history')
const findStatus = computed(() => !findQuery.value ? '输入关键词' : findSearching.value ? '查找中…' : !findMatches.value ? '没有匹配' : findActive.value < 0 ? `${findLimited.value?'前':'共'} ${findMatches.value} 处` : `${findActive.value+1} / ${findMatches.value}${findLimited.value?'+':''}`)
const recordText = computed(() => preview.value ? assistantHistoryText(preview.value.goal, preview.value.message, previewCandidate.value) : '')
const positions = createAssistantHistoryPositions()
function rememberPosition() {
  if (selectedKey.value && detailPane.value?.getClientRects().length) positions.save(selectedKey.value, recordText.value, detailPane.value.scrollTop)
}
function rememberVisiblePosition() { if (props.active) rememberPosition() }
function restorePosition() {
  if (detailPane.value?.getClientRects().length) detailPane.value.scrollTop = positions.restore(selectedKey.value, recordText.value)
}
watch([selectedKey, recordText], ([key, text], [previousKey, previousText]) => {
  // A refreshed reply is a new document, even when its run ID stayed the same.
  if (key && key === previousKey && text !== previousText) {
    positions.save(key, text, 0)
    if (detailPane.value) detailPane.value.scrollTop = 0
  }
}, { flush: 'post' })
watch(() => props.active, async active => {
  if (!active) { rememberPosition(); return }
  const epoch = fieldScope.epoch, key = selectedKey.value
  await nextTick()
  if (props.active && epoch === fieldScope.epoch && key === selectedKey.value) restorePosition()
}, { flush: 'sync' })
watch(() => fieldScope.epoch, () => positions.clear(), { flush: 'sync' })
onBeforeUnmount(() => positions.clear())
const copied = ref(false), copying = ref(false), copyError = ref('')
let copyVersion = 0
function resetCopy() { copyVersion++; copied.value = false; copying.value = false; copyError.value = '' }
function resetReading() { showFind.value = false; findQuery.value = ''; resetCopy() }
watch(selectedKey, resetReading, { flush: 'sync' })
watch(recordText, resetCopy, { flush: 'sync' })
watch(() => fieldScope.epoch, () => { resetReading(); query.value = ''; filter.value = 'all'; returnTarget = null; indexTop = 0; if (indexPane.value) indexPane.value.scrollTop = 0 }, { flush: 'sync' })
onBeforeUnmount(resetCopy)

async function focusFind() {
  const epoch = fieldScope.epoch, key = selectedKey.value
  if (preview.value) showFind.value = true
  await nextTick()
  if (!props.active || epoch !== fieldScope.epoch || key !== selectedKey.value) return
  const target = preview.value ? findInput.value : searchInput.value
  target?.focus({ preventScroll: true }); target?.select()
}
async function closeFind() {
  const epoch = fieldScope.epoch, key = selectedKey.value; showFind.value = false; await nextTick()
  if (props.active && epoch === fieldScope.epoch && key === selectedKey.value) findButton.value?.focus({ preventScroll: true })
}
function findKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); event.stopPropagation(); jump(event.shiftKey ? -1 : 1) }
}
async function copyRecord() {
  if (copying.value || !preview.value) return
  const ticket = ++copyVersion, text = recordText.value
  copying.value = true; copied.value = false; copyError.value = ''
  try { if (await copyAssistantText(text, () => ticket === copyVersion && props.active)) copied.value = true }
  catch { if (ticket === copyVersion) copyError.value = '复制未完成，请重试，或直接选择下方文字复制。' }
  finally { if (ticket === copyVersion) copying.value = false }
}
defineExpose({ focusFind })

async function inspect(item: AssistantRunView | FieldTask, kind: 'run' | 'field', event: Event) {
  const epoch = fieldScope.epoch, key = kind + ':' + item.id
  rememberPosition()
  indexTop = indexPane.value?.scrollTop || 0; returnTarget = event.currentTarget as HTMLElement
  if (kind === 'run') void reader.inspectRun(item as AssistantRunView)
  else reader.inspectTask(item as FieldTask)
  await nextTick()
  if (epoch !== fieldScope.epoch || selectedKey.value !== key || !props.active) return
  restorePosition()
  detailHeading.value?.focus({ preventScroll: true })
}
async function backToIndex() {
  const epoch = fieldScope.epoch; rememberPosition(); reader.close(); await nextTick()
  if (epoch !== fieldScope.epoch || !props.active) return
  if (indexPane.value) indexPane.value.scrollTop = indexTop
  const target = returnTarget?.isConnected && returnTarget.getClientRects().length ? returnTarget : searchInput.value
  target?.focus({ preventScroll: true })
}
function returnToDialogue() { rememberPosition(); reader.close(); emit('return-dialogue') }
function viewRun() { if (preview.value?.run && canViewRun.value) { const value = preview.value.run; rememberPosition(); reader.close(); emit('view-run', value) } }
function keydown(event: KeyboardEvent) { if (event.key === 'Escape' && preview.value && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); event.stopPropagation(); if (showFind.value) void closeFind(); else void backToIndex() } }
function resetFilters() { query.value = ''; filter.value = 'all'; searchInput.value?.focus() }
</script>

<template>
  <div class="assistant-task-browser" :class="{ 'has-preview': preview }" data-testid="assistant-task-browser" @keydown="keydown">
    <div class="assistant-history-layout">
      <div ref="indexPane" class="assistant-history-index" data-testid="assistant-history-index">
        <div class="assistant-history-toolbar">
          <div class="assistant-history-caption"><b>任务记录</b><span>已读取 {{ counts.all }} 条</span></div>
          <label class="assistant-history-search"><span class="visually-hidden">查找本作品的助笔任务</span><input ref="searchInput" v-model="query" type="search" maxlength="256" placeholder="搜索要求、回复或修改内容" aria-label="搜索助笔任务"></label>
          <div class="assistant-history-filters" role="group" aria-label="按处理状态筛选任务"><button v-for="option in filters" :key="option.id" type="button" :aria-pressed="filter===option.id" :data-testid="'assistant-history-filter-'+option.id" @click="filter=option.id">{{ option.label }}<span>{{ counts[option.id] }}</span></button></div>
        </div>
        <section class="field-task-history" data-testid="assistant-run-history" :aria-busy="runState.loading">
          <header><b>创作任务 <span>{{ visibleRuns.length }}</span></b><button type="button" :disabled="runState.loading" :aria-label="runState.error?'重试读取创作任务':'刷新创作任务'" @click="emit('refresh-runs')">{{ runState.loading?'读取中…':runState.error?'重试读取创作任务':'刷新' }}</button></header>
          <p v-if="runState.error" class="assistant-history-error" role="alert">{{ runState.error }}<span v-if="runs.length"> 已保留上次读取的记录。</span></p>
          <p v-else-if="runState.loaded&&!runState.loading&&!visibleRuns.length" class="assistant-history-empty">{{ query||filter!=='all'?'当前筛选下没有创作任务。':hasBook?'本作品还没有创作任务。':'打开作品后可查看创作任务。' }}</p>
          <button v-for="row in visibleRuns" :key="row.item.id" type="button" class="assistant-history-row" :aria-current="selectedKey==='run:'+row.item.id?'true':undefined" @click="inspect(row.item,'run',$event)">
            <span class="assistant-history-row-heading"><b :title="row.item.goal">{{ row.item.goal }}</b><span class="assistant-history-state" :data-tone="row.state.tone">{{ row.state.label }}</span></span>
            <span class="assistant-history-row-meta"><span>{{ row.item.message }}</span><time :datetime="row.date.dateTime" :title="row.date.full">{{ row.date.short }}</time></span>
          </button>
        </section>
        <section class="field-task-history" data-testid="assistant-field-history" :aria-busy="fieldState.loading">
          <header><b>输入内容的修改 <span>{{ visibleFields.length }}</span></b><button type="button" :disabled="fieldState.loading" :aria-label="fieldState.error?'重试读取修改记录':'刷新修改记录'" @click="emit('refresh-fields')">{{ fieldState.loading?'读取中…':fieldState.error?'重试读取修改记录':'刷新' }}</button></header>
          <p v-if="fieldState.error" class="assistant-history-error" role="alert">{{ fieldState.error }}<span v-if="fields.length"> 已保留上次读取的记录。</span></p>
          <p v-else-if="fieldState.loaded&&!fieldState.loading&&!visibleFields.length" class="assistant-history-empty">{{ query||filter!=='all'?'当前筛选下没有修改记录。':'还没有输入内容的修改记录。' }}</p>
          <button v-for="row in visibleFields" :key="row.item.id" type="button" class="assistant-history-row" :aria-current="selectedKey==='field:'+row.item.id?'true':undefined" @click="inspect(row.item,'field',$event)">
            <span class="assistant-history-row-heading"><b>{{ row.item.target.label }}</b><span class="assistant-history-state" :data-tone="row.state.tone">{{ row.state.label }}</span></span>
            <span class="assistant-history-row-meta"><span>{{ row.item.error || (row.item.candidate?'查看完整修改内容':'输入内容的修改记录') }}</span><time :datetime="row.date.dateTime" :title="row.date.full">{{ row.date.short }}</time></span>
          </button>
        </section>
        <button v-if="(query||filter!=='all')&&!visibleRuns.length&&!visibleFields.length" type="button" class="assistant-history-reset" @click="resetFilters">清除筛选，显示全部记录</button>
        <div v-if="hasBook" class="assistant-history-other"><slot/></div>
      </div>
      <section v-if="preview" ref="detailPane" class="assistant-history-preview" data-testid="assistant-history-preview" aria-label="任务记录全文" @scroll.passive="rememberVisiblePosition">
        <header class="assistant-history-detail-header">
          <div class="assistant-history-navigation"><button type="button" data-testid="assistant-history-back" @click="backToIndex">← 任务目录</button><button type="button" @click="returnToDialogue">返回当前对话</button></div>
          <div class="assistant-history-detail-summary">
            <div class="assistant-history-detail-meta"><span ref="detailHeading" tabindex="-1" data-testid="assistant-history-heading">{{ preview.run?'创作任务':'输入修改' }}</span><span v-if="previewState" class="assistant-history-state" :data-tone="previewState.tone">{{ previewState.label }}</span></div>
            <span class="assistant-history-read-status" role="status">{{ loading?'正在刷新…':'只读回看' }}</span>
          </div>
          <div class="assistant-history-reading-tools">
            <select v-if="headings.length" aria-label="跳转记录段落" value="" @change="jumpHeading(Number(($event.target as HTMLSelectElement).value));($event.target as HTMLSelectElement).value=''"><option value="" disabled>段落目录 · {{ headings.length }} 节</option><option v-for="(heading,i) in headings" :key="i" :value="i">{{ heading.label }}</option></select>
            <div class="assistant-history-tool-actions">
              <button ref="findButton" type="button" :aria-expanded="showFind" @click="showFind?closeFind():focusFind()">查找本条</button>
              <button type="button" :aria-disabled="copying" aria-label="复制完整任务记录" @click="copyRecord">{{ copying?'复制中…':copied?'已复制':'复制记录' }}</button>
              <button v-if="preview.run" type="button" :disabled="loading" :aria-label="error?'重试读取这条任务':'刷新这条任务'" @click="reader.refresh">{{ error?'重试读取':'刷新' }}</button>
            </div>
          </div>
          <div v-if="showFind" class="assistant-history-find" role="search" aria-label="当前任务全文查找">
            <input ref="findInput" v-model="findQuery" type="search" maxlength="256" aria-label="查找当前任务全文" aria-describedby="assistant-history-find-status" placeholder="搜索本条全文" @keydown="findKeydown">
            <div class="assistant-history-find-controls"><span id="assistant-history-find-status" role="status" aria-live="polite" aria-atomic="true">{{ findStatus }}</span><button type="button" :disabled="!findMatches" aria-label="记录内上一处匹配" title="上一处 · Shift+Enter" @click="jump(-1)">↑</button><button type="button" :disabled="!findMatches" aria-label="记录内下一处匹配" title="下一处 · Enter" @click="jump(1)">↓</button><button type="button" aria-label="关闭记录查找" title="关闭 · Escape" @click="closeFind">×</button></div>
            <p v-if="findLimited">仅显示前 {{ findMatches }} 处，请输入更具体的关键词。</p>
          </div>
          <p v-if="copyError" class="assistant-history-copy-error" role="status">{{ copyError }}</p>
        </header>
        <div :key="selectedKey" ref="detailBody" class="assistant-history-detail-body">
          <p v-if="error" class="assistant-history-error" role="alert">{{ error }}</p>
          <div class="assistant-history-goal"><span>{{ preview.run?'原要求':'修改目标' }}</span><p>{{ preview.goal }}</p></div>
          <div class="assistant-history-response"><AssistantDocument :content="preview.message"/></div>
          <details v-if="previewFailure" class="assistant-history-response" data-testid="field-outline-review-failure"><summary>查看未通过的候选与复核记录</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">{{ previewFailure }}</pre></details>
          <FieldAssistantCandidate v-if="previewCandidate" :candidate="previewCandidate" :current="false" :busy="false" :can-undo="false" message="回看记录不会替换当前会话；候选需回到原任务核对。"/>
          <template v-if="preview.run&&previewState?.pending">
            <p v-if="receiptPending" role="status">当前回填记录尚未确认，请返回对话完成确认后再切换任务。</p>
            <button type="button" class="control-button primary" :disabled="!canViewRun" @click="viewRun">回到这个待处理任务</button>
          </template>
        </div>
      </section>
      <section v-else class="assistant-history-placeholder"><b>从目录选择一条记录</b><p>要求、回复和修改内容会在这里完整展开。</p><span>回看不改变当前对话与草稿</span></section>
    </div>
  </div>
</template>
