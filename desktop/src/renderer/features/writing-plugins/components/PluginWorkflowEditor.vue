<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { PluginManifest } from '@lanjian/writing-plugin-contracts'
import ArchiveAction from '../../../ui/ArchiveAction.vue'
import { addDraftWorkflowOption, editableDraftWorkflow, removeDraftWorkflowOption, restoreDraftWorkflowOption, updateDraftWorkflow, workflowOptionLimit, type RemovedWorkflowOption, type WorkflowQuestionTarget, type WorkflowTextEdit } from '../draft-workflow'
import { pluginError } from '../plugin-error'
const props = defineProps<{ text: string; manifest: PluginManifest; disabled: boolean; composing: boolean }>()
const emit = defineEmits<{ 'update:text': [value: string] }>()
const tools = computed(() => editableDraftWorkflow(props.text, props.manifest)), error = ref('')
const root = ref<HTMLElement | null>(null), removed = ref<RemovedWorkflowOption | null>(null)
let emittedText: string | undefined, alive = true
function publish(text: string) { emittedText = text; emit('update:text', text); error.value = '' }
watch(() => props.text, text => {
  if (text !== emittedText) { removed.value = null; error.value = '' }
  emittedText = undefined
})
onBeforeUnmount(() => { alive = false })
const modes = { single: '单选', multiple: '多选', text: '自由回答' }
function edit(change: WorkflowTextEdit) {
  if (props.disabled) return
  try { publish(updateDraftWorkflow(props.text, props.manifest, change)) }
  catch (cause) { error.value = pluginError(cause, '流程修改未完成，已有内容已保留。') }
}
function isRemoved(target: WorkflowQuestionTarget) {
  return removed.value?.toolId === target.toolId && removed.value.stepId === target.stepId && removed.value.questionId === target.questionId
}
async function changeOptions(action: 'add' | 'copy' | 'remove' | 'undo', target: WorkflowQuestionTarget, optionId?: string) {
  if (props.disabled || props.composing) return
  try {
    let focusId: string | undefined
    if (action === 'add' || action === 'copy') {
      const result = addDraftWorkflowOption(props.text, props.manifest, target, action === 'copy' ? optionId : undefined)
      focusId = result.id; publish(result.text)
    } else if (action === 'remove' && optionId) {
      const result = removeDraftWorkflowOption(props.text, props.manifest, target, optionId)
      removed.value = result.removed; publish(result.text)
    } else if (action === 'undo' && removed.value && isRemoved(target)) {
      const text = restoreDraftWorkflowOption(props.text, props.manifest, removed.value)
      focusId = removed.value.option.id; removed.value = null; publish(text)
    }
    await nextTick()
    if (!alive) return
    const tool = Array.from(root.value?.querySelectorAll<HTMLElement>('[data-workflow-tool]') ?? []).find(el => el.dataset.workflowTool === target.toolId)
    const step = Array.from(tool?.querySelectorAll<HTMLElement>('[data-workflow-step]') ?? []).find(el => el.dataset.workflowStep === target.stepId)
    const question = Array.from(step?.querySelectorAll<HTMLElement>('[data-workflow-question]') ?? []).find(el => el.dataset.workflowQuestion === target.questionId)
    const option = Array.from(question?.querySelectorAll<HTMLElement>('[data-workflow-option]') ?? []).find(el => el.dataset.workflowOption === focusId)
    const control = option?.querySelector<HTMLInputElement>('input') ?? question?.querySelector<HTMLButtonElement>('[data-option-undo]') ?? question?.querySelector<HTMLButtonElement>('[data-option-add]')
    control?.focus({ preventScroll: true }); control?.scrollIntoView({ block: 'nearest' })
  } catch (cause) { error.value = pluginError(cause, '选项修改未完成，已有内容已保留。') }
}
</script>
<template>
  <section ref="root" class="workflow-editor" data-testid="plugin-workflow-editor">
    <header><h4>交互流程</h4><p>直接修改提问、选项和返回说明。已有选项标识保持不变；增删选项后，请核对返回说明与后续步骤。</p></header>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="!tools" class="hint">流程格式尚未完成，请在下方“源文件与附带资料”中继续编辑；原内容已保留。</p>
    <fieldset v-for="tool in tools ?? []" :key="tool.id" :disabled="disabled" :data-workflow-tool="tool.id">
      <legend>{{ tool.description }}</legend>
      <section v-for="(step, si) in tool.steps" :key="step.id" :data-workflow-step="step.id" class="question-group">
        <h5>第 {{ si + 1 }} 组提问</h5>
        <p v-if="!step.questions" class="hint">这个提问使用动态内容，或结构尚未完成。请在源文件中编辑，表单不会替换它。</p>
        <div v-for="(q, qi) in step.questions ?? []" :key="q.id" :data-workflow-question="q.id" class="question">
          <p class="hint">{{ modes[q.mode] }} · {{ q.required ? '必答' : '可跳过' }}</p>
          <label>问题 {{ qi + 1 }}<textarea :value="q.prompt" :aria-label="`问题 ${qi + 1}`" rows="2" maxlength="1000" @input="edit({ toolId: tool.id, stepId: step.id, questionId: q.id, field: 'prompt', value: ($event.target as HTMLTextAreaElement).value })" /></label>
          <label>补充说明<textarea :value="q.detail ?? ''" aria-label="问题补充说明" rows="2" maxlength="2000" @input="edit({ toolId: tool.id, stepId: step.id, questionId: q.id, field: 'detail', value: ($event.target as HTMLTextAreaElement).value })" /></label>
          <div v-if="q.mode !== 'text'" class="option-actions"><span class="hint">{{ q.options.length }} / {{ workflowOptionLimit }} 个选项 · 至少保留 2 个</span><ArchiveAction compact data-option-add :disabled="disabled || composing || q.options.length >= workflowOptionLimit" @click="changeOptions('add', { toolId: tool.id, stepId: step.id, questionId: q.id })">添加选项</ArchiveAction></div>
          <div v-if="isRemoved({ toolId: tool.id, stepId: step.id, questionId: q.id })" class="option-actions" role="status"><span class="hint">已移除“{{ removed?.option.label || '未命名选项' }}”。</span><ArchiveAction compact data-option-undo :disabled="disabled || composing || q.options.length >= workflowOptionLimit" @click="changeOptions('undo', { toolId: tool.id, stepId: step.id, questionId: q.id })">撤销移除选项</ArchiveAction></div>
          <div class="options">
            <div v-for="(option, oi) in q.options" :key="option.id" :data-workflow-option="option.id" class="option">
              <div class="option-actions"><ArchiveAction compact :aria-label="`复制选项 ${oi + 1}`" :disabled="disabled || composing || q.options.length >= workflowOptionLimit" @click="changeOptions('copy', { toolId: tool.id, stepId: step.id, questionId: q.id }, option.id)">复制</ArchiveAction><ArchiveAction compact :aria-label="`移除选项 ${oi + 1}`" :disabled="disabled || composing || q.options.length <= 2" @click="changeOptions('remove', { toolId: tool.id, stepId: step.id, questionId: q.id }, option.id)">移除</ArchiveAction></div>
              <label>选项 {{ oi + 1 }}{{ option.recommended ? ' · 推荐' : '' }}<input :value="option.label" :aria-label="`选项 ${oi + 1} 文字`" maxlength="120" @input="edit({ toolId: tool.id, stepId: step.id, questionId: q.id, optionId: option.id, field: 'label', value: ($event.target as HTMLInputElement).value })" /></label>
              <label>选项说明<textarea :value="option.description ?? ''" :aria-label="`选项 ${oi + 1} 说明`" rows="2" maxlength="500" @input="edit({ toolId: tool.id, stepId: step.id, questionId: q.id, optionId: option.id, field: 'description', value: ($event.target as HTMLTextAreaElement).value })" /></label>
            </div>
          </div>
          <p v-if="!q.prompt.trim() || q.options.some(o => !o.label.trim())" class="hint" role="status">草稿可以保存，运行前请补全问题和选项文字。</p>
        </div>
      </section>
      <label v-if="tool.result">返回给助笔的说明<textarea :value="tool.result.text" aria-label="返回给助笔的说明" rows="3" :maxlength="tool.result.limit" @input="edit({ toolId: tool.id, field: 'result', value: ($event.target as HTMLTextAreaElement).value })" /><span class="hint">修改选项含义后，请同步核对这段说明；回答引用与后续步骤保持原样。</span></label>
      <p v-else class="hint">返回内容由流程动态生成，可在源文件中查看。</p>
    </fieldset>
  </section>
</template>
<style scoped>
.option-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}.option-actions>.hint{flex:1;min-width:0;overflow-wrap:anywhere}
.workflow-editor,.question-group,.question,.option{display:grid;gap:12px;min-width:0}.workflow-editor{border-top:1px solid var(--line);padding-top:16px}header{display:grid;gap:6px}h4,h5,p{margin:0}h5{font-size:13px}header p,.hint{font-size:13px;color:var(--ink-muted);line-height:1.7}fieldset{display:grid;gap:16px;border:1px solid var(--line);padding:16px;min-width:0;margin:0}legend{font-size:14px;padding:0 6px;overflow-wrap:anywhere}.question+.question{border-top:1px solid var(--line);padding-top:12px}.options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.option{padding:12px;background:var(--paper);border:1px solid var(--line)}label{display:grid;gap:6px;font-size:13px;min-width:0}input,textarea{box-sizing:border-box;min-width:0;width:100%;border:1px solid var(--line);border-radius:4px;padding:9px;background:var(--surface);color:var(--ink);font:inherit}textarea{resize:vertical;line-height:1.6}[role=alert]{color:var(--danger,#b74536)}:focus-visible{outline:2px solid var(--jade);outline-offset:2px}@container(max-width:600px){.options{grid-template-columns:minmax(0,1fr)}}
</style>
