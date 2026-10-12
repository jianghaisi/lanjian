<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { WritingAgentContextPreview, WritingAgentContextSelection, WritingAgentSkillId, WritingAgentTask, WritingAgentTurn } from '../../../../contracts/index'
import StudioIcon from '../../../ui/StudioIcon.vue'
import ModelCatalogPicker from '../../models/components/ModelCatalogPicker.vue'
import type { ModelCatalogChoice, ModelConnectionSummary } from '../../models/services/model-catalog'

type AgentConversationTurn = {
  id: string
  message: string
  result: WritingAgentTurn
  stale: boolean
  draftChanged?: boolean
  task?: WritingAgentTask
}

const props = defineProps<{
  turns: AgentConversationTurn[]
  busy: boolean
  applyingTurnId?: string
  disabled?: boolean
  embedded?: boolean
  selectedCharacters: number
  insertionAnchorOffset?: number | null
  models: ModelCatalogChoice[]
  connections: ModelConnectionSummary[]
  activeTask?: WritingAgentTask | null
  recoverableTasks?: WritingAgentTask[]
  contextPreview?: WritingAgentContextPreview | null
  contextPreviewBusy?: boolean
  alwaysConfirmBeforeSend?: boolean
  quickAction?: { id: number; skill: WritingAgentSkillId; message?: string } | null
}>()

const emit = defineEmits<{
  compose: [message:string]
  send: [input: { message: string; operationId?: string; expectedContextHash?: string; model?: string; modelConnectionId?: string; maxTokensOverride?: number; preferredSkill?: WritingAgentSkillId; contextSelection: WritingAgentContextSelection }]
  previewContext: [input: { message?: string; model?: string; modelConnectionId?: string; maxTokensOverride?: number; preferredSkill?: WritingAgentSkillId; contextSelection: WritingAgentContextSelection }]
  apply: [turnId: string, acceptedChangeIds?: string[], mode?: 'inline']
  discard: [turnId: string]
  pause: []
  cancel: []
  resume: [taskId: string]
  retry: [taskId: string]
  dismiss: [taskId: string]
  applyPartial: [taskId: string]
  discardPartial: [taskId: string]
  adoptCard: [turnId: string, optionId: string]
}>()

const message = ref('')
const handoffOperationId = ref<string | undefined>()
const maxTokensOverride = ref(2048)
const selectedModel = ref<ModelCatalogChoice | null>(null)
const preferredSkill = ref<WritingAgentSkillId | undefined>()
const skillMenuOpen = ref(false)
const contextPreviewOpen = ref(false)
const pinnedContextIds = ref<string[]>([])
const excludedContextIds = ref<string[]>([])
const temporaryContextText = ref('')
const temporaryContextAdditions = ref<WritingAgentContextSelection['temporaryAdditions']>([])
const confirmingSend = ref(false)
const requestedPreviewSignature = ref('')
const resolvedPreviewSignature = ref('')
const diffDecisions = ref<Record<string, Record<string, 'accepted' | 'rejected'>>>({})
const threadEnd = ref<HTMLElement>()
const composerInput = ref<HTMLTextAreaElement>()
const skills: Array<{ id: WritingAgentSkillId; label: string; hint: string; mark: string }> = [
  { id: 'continue', label: '续写', hint: '依据章纲和前文接着写', mark: '续' },
  { id: 'rewrite', label: '改写', hint: '重写正文中选中的部分', mark: '改' },
  { id: 'expand', label: '扩写', hint: '增加动作、感官、对白或冲突过程', mark: '扩' },
  { id: 'compress', label: '压缩', hint: '删去重复表达但保留事实与笑点', mark: '缩' },
  { id: 'custom', label: '自定义', hint: '按你的目标和禁止事项处理选段', mark: '定' },
  { id: 'polish', label: '润色', hint: '调整选中文字的表达与节奏', mark: '润' },
  { id: 'review', label: '审校', hint: '检查情节、人物与设定', mark: '校' },
  { id: 'query', label: '问答', hint: '依据作品事实回答问题', mark: '问' },
  { id: 'plan', label: '讨论章卡', hint: '给出可选择的冲突、节拍与钩子方案', mark: '谋' }
]

const canSend = computed(() => Boolean(message.value.trim()) && !props.busy && !props.disabled)
const selectedSkill = computed(() => skills.find((item) => item.id === preferredSkill.value))
// Manual model IDs need not be returned by /models. Keep the explicitly chosen
// route locally so catalog refreshes cannot silently turn it into the default.
const modelChoices = computed(() => [...props.models, ...(selectedModel.value ? [selectedModel.value] : [])]
  .filter((choice, index, all) => Boolean(choice.model.trim() && choice.connectionId.trim()) && all.findIndex((candidate) => candidate.model === choice.model && candidate.connectionId === choice.connectionId) === index))
const selectedModelChoice = computed(() => modelChoices.value.find((choice) => choice.key === selectedModel.value?.key) || null)
const selectedModelLabel = computed(() => selectedModelChoice.value?.label || '跟随当前操作的模型分配')
const adjustableContextItems = computed(() => props.contextPreview?.items.filter((item) => !item.required) || [])
const requiredContextItems = computed(() => props.contextPreview?.items.filter((item) => item.required) || [])
const currentPreviewSignature = computed(() => JSON.stringify({
  message: message.value.trim(),
  model: selectedModelChoice.value?.model || '',
  connectionId: selectedModelChoice.value?.connectionId || '',
  maxTokensOverride: selectedModelChoice.value?.connectionId === 'local:llama-cpp' ? maxTokensOverride.value : undefined,
  preferredSkill: preferredSkill.value || '',
  selectedCharacters: props.selectedCharacters,
  insertionAnchorOffset: props.insertionAnchorOffset ?? null,
  contextSelection: currentContextSelection()
}))
const confirmationReady = computed(() => Boolean(
  confirmingSend.value
  && props.contextPreview
  && !props.contextPreviewBusy
  && !props.contextPreview.blockedMessage
  && resolvedPreviewSignature.value === currentPreviewSignature.value
))
const taskStatusLabel = (task: WritingAgentTask) => ({
  queued: '等待中', resuming: '恢复中', preparing: '准备中', running: '生成中', streaming: '正在输出', succeeded: '已完成',
  paused: '已暂停', failed: '生成失败', interrupted: '应用重启时中断', cancelled: '已停止'
}[task.status] || task.status)
const contextSummary = (task?: WritingAgentTask | null) => task?.contextPackage
  ? `${task.contextPackage.contextCount} 组 · 约 ${task.contextPackage.estimatedTokens.toLocaleString()} / ${task.contextPackage.tokenBudget.toLocaleString()} tokens`
  : ''

watch([() => props.turns.length, () => props.busy], async () => {
  await nextTick()
  threadEnd.value?.scrollIntoView({ block: 'end', behavior: 'smooth' })
})

watch(() => props.contextPreview, (preview) => {
  if (preview && requestedPreviewSignature.value) resolvedPreviewSignature.value = requestedPreviewSignature.value
})

watch(() => props.quickAction?.id, async (id) => {
  if (!id || !props.quickAction) return
  if(props.embedded){emit('compose',props.quickAction.message || `${skills.find(item=>item.id===props.quickAction?.skill)?.label || '完善'}${['continue','review','query','plan'].includes(props.quickAction.skill)?'当前章节':'选中的正文'}，`);return}
  preferredSkill.value = props.quickAction.skill
  if (props.quickAction.message) message.value = props.quickAction.message
  skillMenuOpen.value = false
  await nextTick()
  composerInput.value?.focus()
}, { immediate: true })

function sendMessage(input:{message:string;operationId?:string;model?:string;connectionId?:string;maxTokensOverride?:number}) {
  if(props.disabled||props.busy)throw new Error('当前章节的写作依据尚未就绪，请先核对章纲与人物状态。')
  handoffOperationId.value=input.operationId
  maxTokensOverride.value=input.maxTokensOverride ?? 2048
  message.value=input.message
  preferredSkill.value=undefined
  selectedModel.value=input.model&&input.connectionId ? props.models.find(choice=>choice.model===input.model&&choice.connectionId===input.connectionId)||{key:input.connectionId+':'+input.model,connectionId:input.connectionId,model:input.model,label:input.model,connectionName:'',connectionHost:'',family:{id:'other',label:'其他',mark:'模',order:99},duplicateModel:false,discovered:false} as ModelCatalogChoice:null
  submit()
}
defineExpose({sendMessage})
function submit() {
  if (!canSend.value) return
  if (props.alwaysConfirmBeforeSend) {
    confirmingSend.value = true
    contextPreviewOpen.value = true
    requestContextPreview()
    return
  }
  sendCurrentRequest()
}

function sendCurrentRequest() {
  const modelChoice = selectedModelChoice.value
  const previewMatches = Boolean(props.contextPreview && resolvedPreviewSignature.value === currentPreviewSignature.value)
  emit('send', {
    message: message.value.trim(),
    ...(handoffOperationId.value ? { operationId: handoffOperationId.value } : {}),
    ...(previewMatches && props.contextPreview ? { expectedContextHash: props.contextPreview.contentHash } : {}),
    ...(modelChoice ? { model: modelChoice.model, modelConnectionId: modelChoice.connectionId, ...(modelChoice.connectionId === 'local:llama-cpp' ? {maxTokensOverride:maxTokensOverride.value} : {}) } : {}),
    preferredSkill: preferredSkill.value,
    contextSelection: currentContextSelection()
  })
  handoffOperationId.value = undefined
  message.value = ''
  skillMenuOpen.value = false
  confirmingSend.value = false
  contextPreviewOpen.value = false
  resolvedPreviewSignature.value = ''
}

function currentContextSelection(): WritingAgentContextSelection {
  return {
    pinnedIds: [...pinnedContextIds.value],
    excludedIds: [...excludedContextIds.value],
    temporaryAdditions: temporaryContextAdditions.value.map((item) => ({ ...item }))
  }
}

function requestContextPreview() {
  requestedPreviewSignature.value = currentPreviewSignature.value
  resolvedPreviewSignature.value = ''
  const modelChoice = selectedModelChoice.value
  emit('previewContext', { message: message.value.trim() || undefined, ...(modelChoice ? { model: modelChoice.model, modelConnectionId: modelChoice.connectionId, ...(modelChoice.connectionId === 'local:llama-cpp' ? {maxTokensOverride:maxTokensOverride.value} : {}) } : {}), preferredSkill: preferredSkill.value, contextSelection: currentContextSelection() })
}

function selectAgentModel(choice: ModelCatalogChoice | null) {
  selectedModel.value = choice
  maxTokensOverride.value = choice?.recommendedOutputTokens ?? 2048
}

function confirmContextSend() {
  if (!confirmationReady.value) {
    requestContextPreview()
    return
  }
  sendCurrentRequest()
}

function closeContextPreview() {
  contextPreviewOpen.value = false
  confirmingSend.value = false
  resolvedPreviewSignature.value = ''
}

function toggleContextPreview() {
  contextPreviewOpen.value = !contextPreviewOpen.value
  if (contextPreviewOpen.value) requestContextPreview()
}

function toggleContextPin(id: string) {
  const pinned = new Set(pinnedContextIds.value)
  const excluded = new Set(excludedContextIds.value)
  if (pinned.has(id)) pinned.delete(id)
  else { pinned.add(id); excluded.delete(id) }
  pinnedContextIds.value = [...pinned]
  excludedContextIds.value = [...excluded]
  requestContextPreview()
}

function toggleContextExclusion(id: string) {
  const excluded = new Set(excludedContextIds.value)
  const pinned = new Set(pinnedContextIds.value)
  if (excluded.has(id)) excluded.delete(id)
  else { excluded.add(id); pinned.delete(id) }
  excludedContextIds.value = [...excluded]
  pinnedContextIds.value = [...pinned]
  requestContextPreview()
}

function addTemporaryContext() {
  const content = temporaryContextText.value.trim()
  if (!content || temporaryContextAdditions.value.length >= 5) return
  temporaryContextAdditions.value = [...temporaryContextAdditions.value, {
    id: `temporary:${crypto.randomUUID()}`,
    label: `本次补充 ${temporaryContextAdditions.value.length + 1}`,
    content
  }]
  temporaryContextText.value = ''
  requestContextPreview()
}

function removeTemporaryContext(id: string) {
  temporaryContextAdditions.value = temporaryContextAdditions.value.filter((item) => item.id !== id)
  pinnedContextIds.value = pinnedContextIds.value.filter((item) => item !== id)
  excludedContextIds.value = excludedContextIds.value.filter((item) => item !== id)
  requestContextPreview()
}

function contextModeLabel(mode: string) {
  return ({ full: '完整', compressed: '已压缩', truncated: '已截短', excluded: '未发送' } as Record<string, string>)[mode] || mode
}

function contextExclusionReasonLabel(reason?: WritingAgentContextPreview['items'][number]['exclusionReason']) {
  return ({
    user_excluded: '作者本次移除',
    budget: '超出本次上下文预算',
    compression_unavailable: '没有可安全压缩的内容',
    compressed_over_budget: '压缩后仍超出预算',
    drop_policy: '按该来源的省略规则未发送'
  } as const)[reason || 'user_excluded']
}

function chooseSkill(id: WritingAgentSkillId) {
  preferredSkill.value = preferredSkill.value === id ? undefined : id
  skillMenuOpen.value = false
  if (contextPreviewOpen.value) requestContextPreview()
}

function fillPrompt(text: string, skill?: WritingAgentSkillId) {
  message.value = text
  preferredSkill.value = skill
}

function changeBlocks(turn: AgentConversationTurn) {
  return turn.result.candidate?.diff?.filter((block) => block.kind === 'change') || []
}

function decideDiff(turnId: string, blockId: string, decision: 'accepted' | 'rejected') {
  diffDecisions.value = {
    ...diffDecisions.value,
    [turnId]: { ...(diffDecisions.value[turnId] || {}), [blockId]: decision }
  }
}

function decideAllDiff(turn: AgentConversationTurn, decision: 'accepted' | 'rejected') {
  diffDecisions.value = {
    ...diffDecisions.value,
    [turn.id]: Object.fromEntries(changeBlocks(turn).map((block) => [block.id, decision]))
  }
}

function diffDecision(turnId: string, blockId: string) {
  return diffDecisions.value[turnId]?.[blockId] || 'pending'
}

function pendingDiffCount(turn: AgentConversationTurn) {
  return changeBlocks(turn).filter((block) => diffDecision(turn.id, block.id) === 'pending').length
}

function acceptedDiffIds(turn: AgentConversationTurn) {
  return changeBlocks(turn).filter((block) => diffDecision(turn.id, block.id) === 'accepted').map((block) => block.id)
}

function allDiffBlocksAre(turn: AgentConversationTurn, decision: 'accepted' | 'rejected') {
  const blocks = changeBlocks(turn)
  return blocks.length > 0 && blocks.every((block) => diffDecision(turn.id, block.id) === decision)
}

function candidateNextLabel(turn: AgentConversationTurn) {
  if (props.applyingTurnId === turn.id) return turn.draftChanged ? '正在准备合并…' : '正在写入正文…'
  const next = changeBlocks(turn).findIndex((block) => diffDecision(turn.id, block.id) === 'pending')
  if (next >= 0) return `核对第 ${next + 1} 处${turn.result.candidate?.mode === 'insertAtAnchor' ? '插入' : '修改'}`
  if (turn.result.candidate?.diff && !acceptedDiffIds(turn).length) return '完成核对，正文不变'
  if (turn.draftChanged) return '与最新正文合并核对'
  if (turn.result.proposal && !turn.result.proposal.report.passed) return '仍要写入正文'
  return '写入正文并保存'
}

function candidateReviewHint(turn: AgentConversationTurn) {
  if (turn.stale) return '这份候选已过期，不能覆盖现在的正文。可以保留查看，或舍弃后重新发起。'
  if (turn.draftChanged) return '你已继续写作。候选仍然可用；选择修改后，与最新正文合并核对，不会直接覆盖你的新内容。'
  if (turn.result.proposal && !turn.result.proposal.report.passed) return '检查发现需要处理的地方。可以先修改要求重新生成，也可以明确选择保留这份候选。'
  if (!turn.result.candidate?.diff) return '现在只是候选；点击“写入正文并保存”后才会采用，旧稿保留在历史版本中。'
  const accepted = acceptedDiffIds(turn).length
  const pending = pendingDiffCount(turn)
  if (pending) return `还有 ${pending} 处待核对。逐处选择新文或原文；选中不会立即改正文。`
  return accepted ? `已选 ${accepted} 处新文，其余保留原文。尚未写入；确认后会按当前版式保存，旧稿留在历史版本中。`
    : '已选择全部保留原文；完成核对只会结束这份候选，不修改正文。'
}

function candidateReviewIssues(turn: AgentConversationTurn) {
  const report = turn.result.proposal?.report
  if (!report) return []
  const issues = [
    ...report.violations,
    ...report.beats.filter((beat) => beat.status === 'missing').map((beat) => `章纲节点 ${beat.id} 尚未覆盖${beat.evidence ? `：${beat.evidence}` : ''}`),
    ...(!report.boundary.entryRespected ? ['开头没有承接章纲进入状态'] : []),
    ...(!report.boundary.exitReached ? ['结尾尚未到达章纲退出状态'] : []),
    ...report.foreshadowing.filter((item) => item.status === 'violated').map((item) => `伏笔 ${item.id} 与章纲要求冲突${item.evidence ? `：${item.evidence}` : ''}`)
  ]
  return [...new Set(issues)].slice(0, 6)
}

async function prepareCandidateRetry(turn: AgentConversationTurn) {
  const issues = candidateReviewIssues(turn)
  message.value = [
    turn.message.trim(),
    issues.length ? `请修正上一份候选的检查问题：${issues.join('；')}` : '请根据上一份候选的检查结果重新生成，并完整遵守已确认章纲。'
  ].filter(Boolean).join('\n')
  preferredSkill.value = turn.result.skill.id
  skillMenuOpen.value = false
  contextPreviewOpen.value = false
  await nextTick()
  if(props.embedded)emit('compose',message.value)
  composerInput.value?.focus()
  composerInput.value?.scrollIntoView({ block: 'nearest' })
}

function applyCandidate(turn: AgentConversationTurn, event: MouseEvent) {
  if (turn.stale) return
  const next = changeBlocks(turn).find((block) => diffDecision(turn.id, block.id) === 'pending')
  if (next) {
    const source = event.currentTarget
    if (!(source instanceof HTMLElement)) return
    const target = Array.from(source.closest('.agent-candidate')?.querySelectorAll<HTMLElement>('[data-agent-diff-block]') || [])
      .find((block) => block.dataset.agentDiffBlock === next.id)
    const decisionButton = target?.querySelector<HTMLButtonElement>('footer button')
    decisionButton?.scrollIntoView({ block: 'center', behavior: 'instant' })
    decisionButton?.focus({ preventScroll: true })
    return
  }
  emit('apply', turn.id, turn.result.candidate?.diff ? acceptedDiffIds(turn) : undefined)
}

function candidateLabel(turn: AgentConversationTurn) {
  if (turn.result.candidate?.mode === 'append') return '续写提案'
  if (turn.result.candidate?.mode === 'insertAtAnchor') return '锚点续写提案'
  return '改写提案'
}
</script>

<template>
  <section class="writing-agent" data-testid="writing-agent">
    <div class="agent-thread" data-testid="agent-thread" aria-live="polite">
      <section v-if="!embedded && !turns.length && !busy" class="agent-thread-empty">
        <span class="agent-empty-mark">助</span>
        <h3>和助笔一起写这一章</h3>
        <p>直接描述你的意图。我会阅读当前正文、章纲和已确认事实，所有改文都先放在对话里供你审阅。</p>
        <div class="agent-quick-prompts" aria-label="常用写作要求">
          <button type="button" data-testid="quick-draft-current-chapter" @click="fillPrompt('依据已确认章卡和当前正文，生成或续完本章候选；写到章卡出口即停止，不要提前进入下一章。', 'continue')">生成或续完本章</button>
          <button type="button" @click="fillPrompt('依据章纲续写下一场，保持人物动机与实力一致。', 'continue')">续写下一场</button>
          <button type="button" @click="fillPrompt('检查这一章的人物动机、节奏与设定是否一致。', 'review')">检查本章</button>
          <button type="button" @click="fillPrompt('给我三种不同的冲突升级或收尾走向，先作为章卡候选。', 'plan')">讨论后续</button>
        </div>
      </section>

      <article v-for="task in recoverableTasks || []" :key="task.id" class="agent-task-recovery" :class="`status-${task.status}`" :data-testid="`writing-agent-task-${task.status}`">
        <span>{{ taskStatusLabel(task) }}</span>
        <div><b>{{ task.message }}</b><small>{{ task.error?.message || `第 ${task.attempt} 次运行没有产生可采用候选` }}</small><details v-if="task.partial?.content && task.partial.status === 'partial'" class="agent-partial-details"><summary>查看已保留的未完成草稿 · {{ task.partial.content.length }} 字符</summary><p>{{ task.partial.content }}</p></details></div>
        <footer class="agent-task-actions">
          <small v-if="task.status !== 'paused'" class="agent-task-action-note">仅清理记录，不影响正文</small>
          <div class="agent-task-action-buttons">
            <template v-if="task.partial?.content && task.partial.status === 'partial'"><button type="button" :disabled="busy || disabled" @click="emit('discardPartial', task.id)">舍弃片段</button><button v-if="task.skill === 'continue' || task.skill === 'rewrite' || task.skill === 'expand' || task.skill === 'compress' || task.skill === 'custom' || task.skill === 'polish'" type="button" :disabled="busy || disabled" :data-testid="`apply-writing-agent-partial-${task.id}`" @click="emit('applyPartial', task.id)">放入编辑器</button></template>
            <button v-if="task.status === 'paused'" type="button" :disabled="busy || disabled" :data-testid="`resume-writing-agent-task-${task.id}`" @click="emit('resume', task.id)">继续任务</button>
            <template v-else><button class="agent-task-delete" type="button" :disabled="busy || disabled" :data-testid="`dismiss-writing-agent-task-${task.id}`" title="删除这条失败记录；未完成片段会一并舍弃，不影响正文和历史版本" @click="emit('dismiss', task.id)">删除记录</button><button class="agent-task-retry" type="button" :disabled="busy || disabled" :data-testid="`retry-writing-agent-task-${task.id}`" @click="emit('retry', task.id)">重试</button></template>
          </div>
        </footer>
      </article>

      <template v-for="turn in turns" :key="turn.id">
        <article class="agent-message agent-message-user">
          <div class="agent-message-meta"><span>你</span><small>{{ turn.result.skill.label }} · {{ turn.result.model }}</small></div>
          <p>{{ turn.message }}</p>
        </article>

        <article class="agent-message agent-message-assistant" :class="{ stale: turn.stale }" :data-agent-turn-id="turn.id">
          <header class="agent-message-meta"><span>岚</span><div><b>智能助笔</b><small>{{ turn.result.skill.label }} · {{ turn.result.model }}</small></div></header>
          <p class="agent-answer-text">{{ turn.result.answer }}</p>

          <section v-if="turn.result.candidate" class="agent-candidate" :class="{ blocked: turn.stale }">
            <header>
              <div><span>{{ candidateLabel(turn) }}</span><b>{{ turn.result.candidate.diff ? `${changeBlocks(turn).length} 处${turn.result.candidate.mode === 'insertAtAnchor' ? '插入' : '修改'}` : `${turn.result.candidate.content.length} 字符` }}</b></div>
              <small>{{ turn.stale ? '原文已变化' : '候选 · 尚未写入' }}</small>
            </header>
            <div v-if="turn.result.candidate.diff" class="agent-diff-review">
              <details class="agent-diff-bulk" data-testid="agent-diff-bulk">
                <summary>批量选择（可选）</summary>
                <p>只改变本次选择；确认写入前，正文不会变化。</p>
              <nav class="agent-diff-bulk-actions" aria-label="批量决定所有修改">
                <button type="button" :class="{ active: allDiffBlocksAre(turn, 'rejected') }" :aria-pressed="allDiffBlocksAre(turn, 'rejected')" :data-testid="`reject-all-agent-diff-${turn.id}`" :disabled="turn.stale" @click="decideAllDiff(turn, 'rejected')">全部保留</button>
                <button type="button" :class="{ active: allDiffBlocksAre(turn, 'accepted') }" :aria-pressed="allDiffBlocksAre(turn, 'accepted')" :data-testid="`accept-all-agent-diff-${turn.id}`" :disabled="turn.stale" @click="decideAllDiff(turn, 'accepted')">全部接受</button>
              </nav>
              </details>
              <div class="agent-diff-list" aria-label="逐块核对改写">
              <article v-for="(block, index) in changeBlocks(turn)" :key="block.id" class="agent-diff-block" :data-agent-diff-block="block.id" :class="diffDecision(turn.id, block.id)">
                <header><span>{{ turn.result.candidate.mode === 'insertAtAnchor' ? '插入' : '修改' }} {{ index + 1 }}</span><small>{{ diffDecision(turn.id, block.id) === 'accepted' ? '已选新文 · 未写入' : diffDecision(turn.id, block.id) === 'rejected' ? '已选保留原文' : '等待选择' }}</small></header>
                <div class="agent-diff-copy"><p class="removed"><i>原</i>{{ block.before || '（空）' }}</p><p class="added"><i>新</i>{{ block.after || '（删除此处）' }}</p></div>
                <footer><button type="button" :class="{ active: diffDecision(turn.id, block.id) === 'rejected' }" :aria-pressed="diffDecision(turn.id, block.id) === 'rejected'" :disabled="turn.stale" @click="decideDiff(turn.id, block.id, 'rejected')">保留原文</button><button type="button" :class="{ active: diffDecision(turn.id, block.id) === 'accepted' }" :aria-pressed="diffDecision(turn.id, block.id) === 'accepted'" :disabled="turn.stale" @click="decideDiff(turn.id, block.id, 'accepted')">接受修改</button></footer>
              </article>
              </div>
            </div>
            <template v-else><details v-if="turn.result.candidate.selection" class="agent-before"><summary>修改前原文</summary><p>{{ turn.result.candidate.selection.text }}</p></details><div class="agent-after"><p>{{ turn.result.candidate.content }}</p></div></template>
            <button type="button" class="control-button" :disabled="turn.stale || disabled" :data-testid="`review-agent-candidate-${turn.id}`" @click="emit('apply', turn.id, undefined, 'inline')">在原文下方逐处核对</button>
            <p v-if="turn.stale" class="agent-stale-note">本章规划依据已经变化，请重新核对章卡；候选内容仍保留。</p>
            <p v-else-if="turn.draftChanged" class="agent-stale-note">正文已有新内容，候选已保留。核对合并后仍可采用。</p>
            <section v-if="turn.result.proposal" class="agent-candidate-check" :class="turn.result.proposal.report.passed ? 'passed' : 'attention'" :data-testid="`agent-candidate-check-${turn.id}`">
              <header><span>{{ turn.result.proposal.report.passed ? '检查通过' : '需要处理' }}</span><b>{{ turn.result.proposal.report.reviewMode === 'fast' ? '本地完整性检查' : turn.result.proposal.report.literaryFindings === undefined ? '章纲与事实检查' : '章纲、事实与文学检查' }}</b></header>
              <p>{{ turn.result.proposal.report.summary }}</p>
              <p v-if="turn.result.proposal.report.literaryFindings === undefined && turn.result.proposal.report.reviewMode !== 'fast'">这份历史报告未包含人物与场景专项检查。</p>
              <details v-if="turn.result.proposal.report.literaryFindings?.length">
                <summary>人物与场景问题 · {{ turn.result.proposal.report.literaryFindings.length }} 项</summary>
                <div v-for="(finding, index) in turn.result.proposal.report.literaryFindings" :key="index">
                  <p>{{ finding.severity === 'blocking' ? '需要修正' : '表达建议' }}：{{ finding.reason }}</p>
                  <blockquote>{{ finding.candidateQuote }}</blockquote>
                  <p v-if="finding.sourceQuote">依据：{{ finding.sourceQuote }}</p>
                  <p>修改方向：{{ finding.correction }}</p>
                </div>
              </details>
              <ul v-if="candidateReviewIssues(turn).length"><li v-for="issue in candidateReviewIssues(turn)" :key="issue">{{ issue }}</li></ul>
              <footer v-if="!turn.result.proposal.report.passed"><span>正文尚未改变</span><button type="button" :data-testid="`prepare-agent-candidate-retry-${turn.id}`" :disabled="busy || disabled" @click="prepareCandidateRetry(turn)">修改要求后重试</button></footer>
            </section>
            <footer class="agent-result-actions">
              <p class="agent-candidate-guidance" role="status" data-testid="agent-candidate-guidance">{{ candidateReviewHint(turn) }}</p>
              <button class="control-button secondary" type="button" title="只舍弃这份候选，正文不会改变" :disabled="props.applyingTurnId === turn.id" @click="emit('discard', turn.id)">舍弃这份候选</button>
              <button class="control-button primary" type="button" :disabled="turn.stale || props.applyingTurnId === turn.id" :aria-busy="props.applyingTurnId === turn.id" :data-testid="`apply-agent-candidate-${turn.id}`" @click="applyCandidate(turn, $event)">{{ candidateNextLabel(turn) }}</button>
            </footer>
          </section>

          <section v-if="turn.result.chapterCardOptions?.length" class="agent-card-options" :class="{ blocked: turn.stale }" data-testid="agent-chapter-card-options">
            <header><div><span>章卡候选</span><b>{{ turn.result.chapterCardOptions.length }} 种走法</b></div><small>{{ turn.stale ? '正文已变化' : '不会自动写入' }}</small></header>
            <article v-for="(option, index) in turn.result.chapterCardOptions" :key="option.id" class="agent-card-option">
              <div class="agent-card-option-index">{{ String(index + 1).padStart(2, '0') }}</div>
              <div class="agent-card-option-copy"><header><b>{{ option.title }}</b><small>{{ option.rationale }}</small></header><dl><template v-if="option.goal"><dt>目标</dt><dd>{{ option.goal }}</dd></template><template v-if="option.conflict"><dt>冲突</dt><dd>{{ option.conflict }}</dd></template><template v-if="option.beats?.length"><dt>节拍</dt><dd>{{ option.beats.join(' → ') }}</dd></template><template v-if="option.exitChange"><dt>出口</dt><dd>{{ option.exitChange }}</dd></template><template v-if="option.hook"><dt>钩子</dt><dd>{{ option.hook }}</dd></template></dl></div>
              <button type="button" :disabled="turn.stale || turn.draftChanged" :data-testid="`preview-card-option-${option.id}`" @click="emit('adoptCard', turn.id, option.id)">送入章卡核对</button>
            </article>
            <p v-if="turn.stale" class="agent-stale-note">本次讨论所依据的正文已经变化，请重新讨论后再送入章卡。</p>
          </section>

          <details class="agent-tool-trace">
            <summary>查看本次依据 · {{ turn.result.tools.length }} 项</summary>
            <ul><li v-for="tool in turn.result.tools" :key="tool.id"><b>{{ tool.label }}</b><span>{{ tool.summary }}</span></li></ul>
          </details>
          <details v-if="turn.task?.contextPackage" class="agent-context-package">
            <summary>查看冻结上下文 · {{ contextSummary(turn.task) }}</summary>
            <p>本次生成始终使用这份快照；之后修改设定或正文，不会悄悄改变这次结果的依据。</p>
            <ul><li v-for="context in turn.task.contextPackage.contexts" :key="context.id || `${context.task}-${context.label}`"><b>{{ context.label }}</b><small>{{ context.estimatedTokens ? `约 ${context.estimatedTokens.toLocaleString()} tokens` : `${context.characters.toLocaleString()} 字符` }}<template v-if="context.mode && context.mode !== 'full'"> · {{ contextModeLabel(context.mode) }}</template></small><em v-if="context.reasons?.length">{{ context.reasons.join(' · ') }}</em><pre>{{ context.preview }}</pre></li></ul>
            <small>编译器 {{ turn.task.contextPackage.compilerVersion }} · 指纹 {{ turn.task.contextPackage.contentHash.slice(0, 12) }}</small>
          </details>
        </article>
      </template>

      <article v-if="busy" class="agent-message agent-message-assistant agent-message-running" data-testid="agent-running-view">
        <header class="agent-message-meta"><span>岚</span><div><b>智能助笔</b><small>{{ selectedSkill?.label || '理解要求' }} · {{ selectedModelLabel }}</small></div></header>
        <div class="agent-running-line"><i><span></span><span></span><span></span></i><p>{{ activeTask?.status === 'streaming' ? '正在生成，未完成内容会自动保留' : activeTask?.status === 'preparing' ? '正在冻结本次作品上下文' : '正在阅读当前章节与写作约束' }}</p></div>
        <div v-if="activeTask?.partial?.content" class="agent-stream-preview" data-testid="writing-agent-stream-preview"><p>{{ activeTask.partial.content }}</p><small>已接收 {{ activeTask.partial.content.length }} 字符</small></div>
        <details v-if="activeTask?.contextPackage" class="agent-context-package active" data-testid="writing-agent-context-package">
          <summary>本次上下文已冻结 · {{ contextSummary(activeTask) }}</summary>
          <p>内容来自当前作品的总纲、时间线、卷章纲、人物状态、设定和前文证据。</p>
          <ul><li v-for="context in activeTask.contextPackage.contexts" :key="context.id || `${context.task}-${context.label}`"><b>{{ context.label }}</b><small>{{ context.estimatedTokens ? `约 ${context.estimatedTokens.toLocaleString()} tokens` : `${context.characters.toLocaleString()} 字符` }}<template v-if="context.mode && context.mode !== 'full'"> · {{ contextModeLabel(context.mode) }}</template></small><em v-if="context.reasons?.length">{{ context.reasons.join(' · ') }}</em><pre>{{ context.preview }}</pre></li></ul>
        </details>
        <footer v-if="activeTask" class="agent-running-actions"><small>暂停会保留现有片段；继续时建立可追踪的新一轮，不假装无缝续传</small><button type="button" data-testid="pause-writing-agent-task" @click="emit('pause')">暂停</button><button type="button" data-testid="cancel-writing-agent-task" @click="emit('cancel')">停止生成</button></footer>
      </article>
      <div ref="threadEnd" class="agent-thread-end" aria-hidden="true"></div>
    </div>

    <div v-if="!embedded || contextPreviewOpen" class="agent-composer-dock" data-testid="agent-composer-dock">
      <div v-if="skillMenuOpen" class="agent-skill-menu" data-testid="agent-skills-view" aria-label="选择本次操作">
        <button v-for="skill in skills" :key="skill.id" type="button" :class="{ active: preferredSkill === skill.id }" :aria-pressed="preferredSkill === skill.id" @click="chooseSkill(skill.id)">
          <span>{{ skill.mark }}</span><div><b>{{ skill.label }}</b><small>{{ skill.hint }}</small></div>
        </button>
      </div>

      <div v-if="selectedSkill" class="agent-mounted-skill">
        <span>{{ selectedSkill.mark }}</span><b>{{ selectedSkill.label }}</b>
        <button type="button" aria-label="取消指定操作" @click="preferredSkill = undefined"><StudioIcon name="close" :size="12" /></button>
      </div>
      <p v-if="preferredSkill === 'rewrite' || preferredSkill === 'expand' || preferredSkill === 'compress' || preferredSkill === 'custom' || preferredSkill === 'polish'" class="agent-selection-state" :class="{ ready: selectedCharacters > 0 }">{{ selectedCharacters > 0 ? `已选中正文 ${selectedCharacters} 字` : '请先在正文中选择要处理的文字' }}</p>
      <p v-else-if="preferredSkill === 'continue' && insertionAnchorOffset !== null && insertionAnchorOffset !== undefined" class="agent-selection-state ready">{{ selectedCharacters > 0 ? `将从选区末尾（正文第 ${insertionAnchorOffset} 字后）插入续写` : `将从光标处（正文第 ${insertionAnchorOffset} 字后）插入续写` }}</p>

      <section v-if="contextPreviewOpen" class="agent-context-preflight" data-testid="writing-agent-context-preflight">
        <header>
          <div><span>本次依据</span><b v-if="contextPreview">{{ contextPreview.items.filter((item) => item.included).length }} 项 · 约 {{ contextPreview.estimatedTokens.toLocaleString() }} tokens</b><b v-else>正在装配</b></div>
          <button type="button" aria-label="收起本次依据" @click="closeContextPreview"><StudioIcon name="close" :size="13" /></button>
        </header>
        <p v-if="contextPreview?.blockedMessage" class="agent-context-blocked">{{ contextPreview.blockedMessage }}</p>
        <div class="agent-context-preflight-list" :aria-busy="contextPreviewBusy">
          <article v-for="item in adjustableContextItems" :key="item.id" :class="{ excluded: !item.included }" :data-context-preview-id="item.id">
            <div><b>{{ item.label }}</b><small>{{ contextModeLabel(item.mode) }} · 约 {{ item.estimatedTokens.toLocaleString() }} tokens</small></div>
            <p>{{ item.reasons.join(' · ') || '作品上下文' }}<template v-if="item.exclusionReason"> · <strong class="agent-context-omission-reason">{{ contextExclusionReasonLabel(item.exclusionReason) }}</strong></template></p>
            <footer>
              <span>{{ item.authority === 'pinned' ? '本次固定' : item.included ? '将发送' : '本次移除' }}</span>
              <nav>
                <button type="button" :class="{ active: pinnedContextIds.includes(item.id) }" :aria-pressed="pinnedContextIds.includes(item.id)" @click="toggleContextPin(item.id)">{{ pinnedContextIds.includes(item.id) ? '已固定' : '固定' }}</button>
                <button type="button" :class="{ active: excludedContextIds.includes(item.id) }" :aria-pressed="excludedContextIds.includes(item.id)" @click="toggleContextExclusion(item.id)">{{ excludedContextIds.includes(item.id) ? '恢复' : '移除' }}</button>
              </nav>
            </footer>
            <details><summary>查看内容</summary><pre>{{ item.preview }}</pre></details>
          </article>
          <details v-if="requiredContextItems.length" class="agent-context-required">
            <summary><span><b>固定基础</b><small>写作职责、作品定义、总纲与当前章契约</small></span><em>{{ requiredContextItems.length }} 项 · 不可移除</em></summary>
            <ul><li v-for="item in requiredContextItems" :key="item.id"><span><b>{{ item.label }}</b><small>约 {{ item.estimatedTokens.toLocaleString() }} tokens</small></span><details><summary>查看</summary><pre>{{ item.preview }}</pre></details></li></ul>
          </details>
          <p v-if="contextPreviewBusy && !contextPreview" class="agent-context-loading">正在读取当前章纲、人物状态与前文……</p>
        </div>
        <div class="agent-context-temporary">
          <label><span>临时加入</span><textarea v-model="temporaryContextText" maxlength="20000" placeholder="只随这一次任务发送，不写入作品资料。"></textarea></label>
          <button type="button" :disabled="!temporaryContextText.trim() || temporaryContextAdditions.length >= 5" @click="addTemporaryContext">加入本次</button>
          <ul v-if="temporaryContextAdditions.length"><li v-for="item in temporaryContextAdditions" :key="item.id"><span><b>{{ item.label }}</b><small>{{ item.content.slice(0, 80) }}</small></span><button type="button" @click="removeTemporaryContext(item.id)">移除</button></li></ul>
        </div>
        <footer :class="{ confirming: confirmingSend }"><small v-if="confirmingSend">{{ confirmationReady ? `${selectedSkill?.label || '问答'} · ${selectedModelLabel} · 范围已核对` : '发送内容有变化，请重新核对本次依据' }}</small><small v-else>只调整本次任务；冻结后可在对话中复查，未写入正式资料。</small><div><button v-if="confirmingSend" type="button" @click="closeContextPreview">返回修改</button><button type="button" :disabled="contextPreviewBusy" @click="requestContextPreview">刷新</button><button v-if="confirmingSend" class="confirm-send" type="button" :disabled="contextPreviewBusy || Boolean(contextPreview?.blockedMessage)" data-testid="confirm-writing-agent-send" @click="confirmContextSend">{{ confirmationReady ? '确认并发送' : '重新核对' }}</button></div></footer>
      </section>

      <form v-if="!embedded" class="agent-composer" @submit.prevent="submit">
        <textarea ref="composerInput" v-model="message" maxlength="10000" :disabled="busy || disabled" placeholder="给智能助笔发送消息……" aria-label="给智能助笔发送消息" data-testid="writing-agent-input" @keydown.ctrl.enter.prevent="submit"></textarea>
        <div class="agent-composer-toolbar">
          <button class="agent-skill-trigger" type="button" :class="{ active: skillMenuOpen || selectedSkill }" :aria-expanded="skillMenuOpen" data-testid="open-agent-skills" @click="skillMenuOpen = !skillMenuOpen"><StudioIcon name="spark" :size="14" />{{ selectedSkill?.label || '选择操作' }}</button>
          <button class="agent-context-trigger" type="button" :class="{ active: contextPreviewOpen || pinnedContextIds.length || excludedContextIds.length || temporaryContextAdditions.length }" :aria-expanded="contextPreviewOpen" data-testid="open-writing-agent-context" @click="toggleContextPreview">依据<span v-if="contextPreview">{{ contextPreview.items.filter((item) => item.included).length }}</span></button>
          <ModelCatalogPicker :choices="modelChoices" :connections="connections" :model="selectedModelChoice?.model || ''" :connection-id="selectedModelChoice?.connectionId || ''" label="" :disabled="busy || disabled" :compact="true" :allow-empty="true" :allow-manual="true" empty-label="跟随任务模型" test-id="writing-agent-model" @select="selectAgentModel"/>
          <label v-if="selectedModelChoice?.connectionId === 'local:llama-cpp'" class="local-output-budget">本次最大输出 <input v-model.number="maxTokensOverride" type="number" min="128" max="4096" step="128" :disabled="busy" aria-label="本次本地最大输出"> tokens</label>
          <button class="agent-send" type="submit" :disabled="!canSend" data-testid="run-writing-agent" title="发送（Ctrl + Enter）" :aria-label="busy ? '助笔处理中' : alwaysConfirmBeforeSend ? '核对依据后发送' : '发送给智能助笔'"><StudioIcon name="arrow" :size="15" /></button>
        </div>
      </form>
      <p v-if="disabled" class="agent-disabled-note">当前章节的写作约束尚未就绪，智能助笔暂不可用。</p>
    </div>
  </section>
</template>

<style scoped>
.local-output-budget{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap;font-size:.72rem;color:var(--muted);padding:.35rem 0}.local-output-budget input{width:5.2rem;padding:.3rem;border:1px solid var(--line);color:var(--ink);background:var(--surface)}
</style>
