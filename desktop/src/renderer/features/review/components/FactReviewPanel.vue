<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { FactBatchView, FactImportance, FactReviewDecisionInput } from '../../../../contracts/index'
import { visibleFactChanges } from '../../../../contracts/review/fact-review-filter'

type ReviewDecision = FactReviewDecisionInput['decisions'][number]['decision']

const props = withDefaults(defineProps<{
  batch?: FactBatchView | null
  batches?: FactBatchView[]
  busy?: boolean
  minimumImportance?: FactImportance
  showConfirmations?: boolean
}>(), {
  batch: null,
  batches: () => [],
  busy: false,
  minimumImportance: 'medium',
  showConfirmations: false
})

const emit = defineEmits<{
  decide: [input: FactReviewDecisionInput]
  continueWriting: []
}>()

const unfinishedStatuses = new Set<FactBatchView['status']>(['PENDING', 'IN_REVIEW', 'PARTIALLY_APPROVED'])
const terminalStatuses = new Set<FactBatchView['status']>(['APPROVED', 'REJECTED', 'SUPERSEDED', 'STALE'])
const choices = ref<Record<string, ReviewDecision | undefined>>({})
const editedObjects = ref<Record<string, string>>({})
const editDrafts = ref<Record<string, string>>({})
const editErrors = ref<Record<string, string>>({})
const editingChangeId = ref('')
const visibilityPreferences = computed(() => ({
  minimumImportance: props.minimumImportance,
  showConfirmations: props.showConfirmations
}))

function batchHasVisibleWork(batch: FactBatchView): boolean {
  return visibleFactChanges(batch.changes, visibilityPreferences.value).some((change) => (
    change.decisionStatus === 'PENDING' || change.decisionStatus === 'DEFERRED'
  ))
}

const activeBatch = computed(() => {
  if (props.batch) return props.batch
  return [...props.batches]
    .filter((item) => unfinishedStatuses.has(item.status) && batchHasVisibleWork(item))
    .sort((left, right) => batchTime(right) - batchTime(left) || right.id.localeCompare(left.id))[0] ?? null
})

const displayedChanges = computed(() => activeBatch.value
  ? visibleFactChanges(activeBatch.value.changes, visibilityPreferences.value)
  : [])

const hiddenChangeCount = computed(() => activeBatch.value
  ? activeBatch.value.changes.length - displayedChanges.value.length
  : 0)

const reviewableChanges = computed(() => displayedChanges.value.filter((change) => (
  change.decisionStatus === 'PENDING' || change.decisionStatus === 'DEFERRED'
)))

const selectedCount = computed(() => reviewableChanges.value.reduce((count, change) => (
  choices.value[change.id] ? count + 1 : count
), 0))
const selectionSummary = computed(() => {
  const counts = { APPROVED: 0, REJECTED: 0, DEFERRED: 0 }
  for (const change of reviewableChanges.value) {
    const decision = choices.value[change.id]
    if (decision) counts[decision] += 1
  }
  return [counts.APPROVED && `记住 ${counts.APPROVED} 条`, counts.DEFERRED && `稍后 ${counts.DEFERRED} 条`, counts.REJECTED && `不采用 ${counts.REJECTED} 条`].filter(Boolean).join('，')
})
const submitHint = computed(() => editingChangeId.value ? '这条修改还没选好，请先完成或取消修改。'
  : selectedCount.value ? `${selectionSummary.value}。点击保存后才会生效。`
  : '先为上方条目选择处理方式；也可以先继续写作。')

function clearSelections() {
  if (props.busy) return
  choices.value = {}
  editedObjects.value = {}
  editDrafts.value = {}
  editErrors.value = {}
  editingChangeId.value = ''
}

function pendingChoiceLabel(decision: ReviewDecision) {
  return { APPROVED: '已选：记住这条', DEFERRED: '已选：稍后再看', REJECTED: '已选：不采用' }[decision]
}

const ordinaryReviewableChanges = computed(() => reviewableChanges.value.filter((change) => change.changeType !== 'CONTRADICTS'))
const conflictReviewableCount = computed(() => reviewableChanges.value.length - ordinaryReviewableChanges.value.length)

const approvalDisabled = computed(() => (
  props.busy
  || !activeBatch.value
  || terminalStatuses.has(activeBatch.value.status)
))

watch(
  () => activeBatch.value ? `${activeBatch.value.id}:${activeBatch.value.updatedAt}` : '',
  () => {
    choices.value = {}
    editedObjects.value = {}
    editDrafts.value = {}
    editErrors.value = {}
    editingChangeId.value = ''
  }
)

function batchTime(batch: FactBatchView): number {
  const updated = Date.parse(batch.updatedAt)
  if (Number.isFinite(updated)) return updated
  const created = Date.parse(batch.createdAt)
  return Number.isFinite(created) ? created : 0
}

function choose(changeId: string, decision: ReviewDecision) {
  if (approvalDisabled.value) return
  choices.value = { ...choices.value, [changeId]: decision }
}

function chooseBulk(decision: ReviewDecision) {
  if (approvalDisabled.value) return
  const targets = decision === 'APPROVED' ? ordinaryReviewableChanges.value : reviewableChanges.value
  choices.value = {
    ...choices.value,
    ...Object.fromEntries(targets.map((change) => [change.id, decision]))
  }
}

function beginEdit(change: FactBatchView['changes'][number]) {
  if (approvalDisabled.value) return
  editingChangeId.value = change.id
  editDrafts.value = {
    ...editDrafts.value,
    [change.id]: editableJsonValue(editedObjects.value[change.id] ?? change.editedObjectJson ?? change.objectJson)
  }
  const nextErrors = { ...editErrors.value }
  delete nextErrors[change.id]
  editErrors.value = nextErrors
}

function cancelEdit(changeId: string) {
  if (editingChangeId.value === changeId) editingChangeId.value = ''
  const nextErrors = { ...editErrors.value }
  delete nextErrors[changeId]
  editErrors.value = nextErrors
}

function saveEditedApproval(change: FactBatchView['changes'][number]) {
  const source = editDrafts.value[change.id] ?? ''
  try {
    const decidedObjectJson = encodeEditedJsonValue(change.objectJson, source)
    editedObjects.value = { ...editedObjects.value, [change.id]: decidedObjectJson }
    choose(change.id, 'APPROVED')
    editingChangeId.value = ''
    const nextErrors = { ...editErrors.value }
    delete nextErrors[change.id]
    editErrors.value = nextErrors
  } catch (error) {
    editErrors.value = { ...editErrors.value, [change.id]: error instanceof Error ? error.message : '修改内容无效' }
  }
}

function submitDecisions() {
  const batch = activeBatch.value
  if (!batch || approvalDisabled.value || editingChangeId.value) return
  const decisions = batch.changes.flatMap((change) => {
    const decision = choices.value[change.id]
    return decision && (change.decisionStatus === 'PENDING' || change.decisionStatus === 'DEFERRED')
      ? [{
          changeId: change.id,
          decision,
          ...(decision === 'APPROVED' && editedObjects.value[change.id]
            ? { decidedObjectJson: editedObjects.value[change.id] }
            : {})
        }]
      : []
  })
  if (!decisions.length) return
  emit('decide', { batchId: batch.id, decisions })
}

function friendlyJson(source: string): string {
  const trimmed = source.trim()
  if (!trimmed) return '—'
  let formatted = trimmed
  try {
    const value: unknown = JSON.parse(trimmed)
    if (value === null) formatted = '空'
    else if (typeof value === 'string') formatted = value
    else if (typeof value === 'number' || typeof value === 'boolean') formatted = String(value)
    else formatted = JSON.stringify(value, null, 2)
  } catch {
    // Older projects may contain plain text in JSON fields; Vue escapes it safely.
  }
  const limit = 2400
  return formatted.length > limit ? `${formatted.slice(0, limit)}\n…（内容较长，已省略）` : formatted
}

function factEvidence(source: string): { event: string; quotes: string[] } {
  try {
    const value: unknown = JSON.parse(source)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>
      const quotes = Array.isArray(record.quotes)
        ? record.quotes.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim())
        : typeof record.quote === 'string' && record.quote.trim() ? [record.quote.trim()] : []
      return { event: typeof record.event === 'string' ? record.event.trim() : '', quotes: [...new Set(quotes)] }
    }
  } catch {
    // Legacy evidence remains available through the generic JSON formatter.
  }
  return { event: '', quotes: [] }
}

function evidenceLabel(source: string): string {
  const evidence = factEvidence(source)
  if (!evidence.quotes.length) return friendlyJson(source)
  const lines = evidence.quotes.map((quote, index) => evidence.quotes.length > 1 ? `${index + 1}. ${quote}` : quote)
  return evidence.event ? `事件：${evidence.event}\n${lines.join('\n')}` : lines.join('\n')
}

function evidenceCount(source: string): number {
  return factEvidence(source).quotes.length || 1
}

function editableJsonValue(source: string): string {
  try {
    const value: unknown = JSON.parse(source)
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  } catch {
    return source
  }
}

function encodeEditedJsonValue(originalJson: string, source: string): string {
  const trimmed = source.trim()
  if (!trimmed) throw new Error('修改后的事实内容不能为空')
  let original: unknown
  try { original = JSON.parse(originalJson) } catch { original = originalJson }
  if (typeof original === 'string') return JSON.stringify(trimmed)
  try {
    const value: unknown = JSON.parse(trimmed)
    if (value === null) throw new Error('事实内容不能为空')
    if (Array.isArray(original) && !Array.isArray(value)) throw new Error('这条事实需要保持列表格式')
    if (original && typeof original === 'object' && !Array.isArray(original) && (!value || typeof value !== 'object' || Array.isArray(value))) {
      throw new Error('这条事实需要保持字段格式')
    }
    return JSON.stringify(value)
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('这条结构化事实需要保持有效格式')
    throw error
  }
}

function importanceLabel(value: FactBatchView['changes'][number]['importance']) {
  return ({ high: '高', medium: '中', low: '低' } as const)[value]
}

function subjectLabel(source: string): string {
  try {
    const value: unknown = JSON.parse(source)
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>
      for (const key of ['name', 'title', 'label', 'id']) {
        if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim()
      }
    }
    if (typeof value === 'string' && value.trim()) return value.trim()
  } catch {
    // Legacy plain-text subjects remain readable.
  }
  return source.trim() || '未命名对象'
}

function predicateLabel(value: string): string {
  return ({
    location: '所在地', identity: '身份', injury: '伤势', knowledge: '知情', relationship: '关系',
    possession: '持有物', goal: '当前目标', power: '能力与境界', vitality: '生命状态'
  } as Record<string, string>)[value] || value
}

function changeTypeLabel(value: FactBatchView['changes'][number]['changeType']) {
  return ({ NEW: '新增', CHANGED: '变更', CONFIRMS: '确认', CONTRADICTS: '冲突', LOW_VALUE: '低价值' } as const)[value]
}

function decisionLabel(value: FactBatchView['changes'][number]['decisionStatus']) {
  return ({ PENDING: '待核对', APPROVED: '已记住', REJECTED: '已不采用', DEFERRED: '已留待稍后' } as const)[value]
}
</script>

<template>
  <details class="fact-review-panel" open data-testid="fact-review-panel">
    <summary class="fact-review-summary">
      <span><b>让 AI 记住重要变化</b><small>只记住你确认的内容，供后续章节参考</small></span>
      <em v-if="activeBatch">待处理 {{ reviewableChanges.length }} · 已选择 {{ selectedCount }}</em>
      <em v-else>当前没有待核对项</em>
    </summary>

    <div v-if="!activeBatch" class="fact-review-empty" data-testid="fact-review-empty">
      <p>当前没有需要你核对的重要变化，可以继续写作。</p>
      <button class="control-button secondary compact" type="button" :disabled="busy" @click="emit('continueWriting')">返回正文继续写</button>
    </div>

    <section v-else class="fact-review-batch" :class="`status-${activeBatch.status.toLowerCase()}`" data-testid="fact-review-batch" :data-batch-id="activeBatch.id">
      <header class="fact-review-batch-header">
        <span><b>第 {{ activeBatch.chapterId }} 章</b><small>正文版本 {{ activeBatch.bodyVersionId.slice(0, 10) }}</small></span>
        <em>{{ activeBatch.changes.length }} 条候选 · 当前显示 {{ displayedChanges.length }} 条</em>
      </header>
      <div v-if="!terminalStatuses.has(activeBatch.status)" class="fact-review-instructions" data-testid="fact-review-instructions">
        <b>先选要记住的变化，再保存选择</b>
        <p>“记住这条”会让 AI 在后续章节引用；不确定的可以稍后再看。这里不会修改正文，也不要求全部确认才能继续写。</p>
      </div>

      <p v-if="hiddenChangeCount" class="fact-review-filter-notice" role="status" data-testid="fact-review-filter-notice">
        已按本书设置收起 {{ hiddenChangeCount }} 条低优先级或重复确认；矛盾冲突始终显示。
      </p>

      <details v-if="reviewableChanges.length && !terminalStatuses.has(activeBatch.status)" class="fact-review-bulk" data-testid="fact-review-bulk">
        <summary>批量选择（可选）</summary>
        <span><small>只改变下方选择，仍需点击“保存这些选择”；冲突项不能批量记住。</small></span>
        <nav aria-label="批量处理事实候选">
          <button type="button" :disabled="approvalDisabled || !ordinaryReviewableChanges.length" data-testid="fact-review-approve-ordinary" @click="chooseBulk('APPROVED')">选中普通项 {{ ordinaryReviewableChanges.length }}</button>
          <button type="button" :disabled="approvalDisabled" data-testid="fact-review-defer-all" @click="chooseBulk('DEFERRED')">选为全部稍后</button>
          <button type="button" :disabled="approvalDisabled" data-testid="fact-review-reject-all" @click="chooseBulk('REJECTED')">选为全部不采用</button>
        </nav>
        <em v-if="conflictReviewableCount">{{ conflictReviewableCount }} 条冲突需单独确认</em>
      </details>

      <p v-if="activeBatch.status === 'STALE'" class="fact-review-stale-notice" role="status" data-testid="fact-review-stale">
        来源正文已经发生变化。此批事实绑定的是旧正文版本，现已过期且不可审批；请根据当前正文重新执行核对。
      </p>
      <p v-else-if="terminalStatuses.has(activeBatch.status)" class="fact-review-terminal-notice" role="status" data-testid="fact-review-terminal">
        这个事实批次已经结束，仅供查看，不能继续审批。
      </p>

      <ol class="fact-review-list">
        <li v-for="(change, index) in displayedChanges" :key="change.id" class="fact-review-item" :class="[`importance-${change.importance}`, `change-${change.changeType.toLowerCase()}`, `decision-${change.decisionStatus.toLowerCase()}`]" data-testid="fact-review-change" :data-change-id="change.id">
          <header class="fact-review-item-header">
            <span class="fact-review-index" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
            <span class="fact-review-meta">
              <b>{{ changeTypeLabel(change.changeType) }}</b>
              <small>重要度 {{ importanceLabel(change.importance) }}<template v-if="change.confidence !== null"> · 置信度 {{ Math.round(change.confidence * 100) }}%</template></small>
            </span>
            <em>{{ decisionLabel(change.decisionStatus) }}</em>
          </header>

          <div class="fact-review-statement" :aria-label="`事实 ${index + 1}`">
            <span class="fact-review-subject"><small>主体</small><pre>{{ subjectLabel(change.subjectJson) }}</pre></span>
            <span class="fact-review-predicate"><small>变化</small><b>{{ predicateLabel(change.predicate) }}</b></span>
            <span class="fact-review-object"><small>{{ editedObjects[change.id] || change.editedObjectJson ? '修改为' : '内容' }}</small><pre>{{ friendlyJson(editedObjects[change.id] || change.editedObjectJson || change.objectJson) }}</pre></span>
          </div>

          <div v-if="editingChangeId === change.id" class="fact-review-editor" data-testid="fact-review-editor">
            <label><span>修正后内容</span><textarea v-assist-field="{ id: 'FactReviewPanel.editDrafts.change.id', read: () => editDrafts[change.id], write: value => { editDrafts[change.id] = String(value) }, identity: () => change }" v-model="editDrafts[change.id]" maxlength="100000" :aria-label="`修改事实 ${index + 1}`" data-testid="fact-review-edit-input"></textarea></label>
            <p v-if="editErrors[change.id]" role="alert">{{ editErrors[change.id] }}</p>
            <footer><button type="button" :disabled="approvalDisabled" @click="cancelEdit(change.id)">取消修改</button><button type="button" :disabled="approvalDisabled" data-testid="fact-review-save-edit" @click="saveEditedApproval(change)">选用修改内容（尚未保存）</button></footer>
          </div>

          <details class="fact-review-evidence">
            <summary>查看证据<template v-if="evidenceCount(change.evidenceJson) > 1">（{{ evidenceCount(change.evidenceJson) }} 处）</template></summary>
            <pre>{{ evidenceLabel(change.evidenceJson) }}</pre>
          </details>

          <div v-if="change.decisionStatus === 'PENDING' || change.decisionStatus === 'DEFERRED'" class="fact-review-decisions" role="group" :aria-label="`审批事实 ${index + 1}`">
            <button type="button" :class="{ selected: choices[change.id] === 'APPROVED' }" :aria-pressed="choices[change.id] === 'APPROVED'" :disabled="approvalDisabled" data-testid="fact-review-approve" @click="choose(change.id, 'APPROVED')">记住这条</button>
            <button type="button" :class="{ selected: choices[change.id] === 'DEFERRED' }" :aria-pressed="choices[change.id] === 'DEFERRED'" :disabled="approvalDisabled" data-testid="fact-review-defer" @click="choose(change.id, 'DEFERRED')">稍后再看</button>
            <details class="fact-review-more"><summary>更多</summary><button type="button" :disabled="approvalDisabled" data-testid="fact-review-edit" @click="beginEdit(change)">修正内容再记住</button><button type="button" :class="{ selected: choices[change.id] === 'REJECTED' }" :aria-pressed="choices[change.id] === 'REJECTED'" :disabled="approvalDisabled" data-testid="fact-review-reject" @click="choose(change.id, 'REJECTED')">不采用这条</button></details>
          </div>
          <p v-if="choices[change.id]" class="fact-review-unsaved-choice" role="status" data-testid="fact-review-unsaved-choice">{{ pendingChoiceLabel(choices[change.id]!) }} · 尚未保存</p>
        </li>
      </ol>

      <footer v-if="!terminalStatuses.has(activeBatch.status)" class="fact-review-actions">
        <span role="status" data-testid="fact-review-submit-hint">{{ submitHint }}</span>
        <button type="button" :disabled="approvalDisabled || selectedCount === 0 || Boolean(editingChangeId)" data-testid="fact-review-submit" @click="submitDecisions">
          {{ busy ? '正在保存…' : selectedCount ? `保存这些选择（${selectedCount}）` : '先选择要处理的条目' }}
        </button>
        <button v-if="selectedCount || editingChangeId" class="fact-review-secondary" type="button" :disabled="busy" data-testid="fact-review-clear" @click="clearSelections">清空未保存选择</button>
        <button v-else class="fact-review-secondary" type="button" :disabled="busy" data-testid="fact-review-continue" @click="emit('continueWriting')">先继续写作，稍后再核对</button>
      </footer>
    </section>
  </details>
</template>
