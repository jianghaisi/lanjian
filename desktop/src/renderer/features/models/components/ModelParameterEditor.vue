<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AiTask } from '../../../../contracts/models/types'
import { compileGeneration, modelCapabilities, type GenerationTarget } from '../../../../contracts/models/generation-parameters'
import { MODEL_RULES } from '../../../../contracts/models/model-rule-registry'
import type { ParameterOverrides, ReasoningChoice } from '../../../../contracts/models/parameter-policy'
import { draftProfile, modelTaskLabels, type ModelSlot, type ProfileDraft } from '../services/model-connections-state'
import ArchiveAction from '../../../ui/ArchiveAction.vue'
import ArchiveFormField from '../../../ui/ArchiveFormField.vue'
const profile = defineModel<ProfileDraft>({ required: true })
const props = defineProps<{ target: GenerationTarget; task: ModelSlot; label: string; disabled?: boolean; operation?: 'probe' }>()
const previous = ref<ProfileDraft>()
const previousParameter = ref<keyof ParameterOverrides>()
watch([() => profile.value.selection, () => profile.value.model], () => { previous.value = undefined })
const binding = computed(() => profile.value.parameterPolicy?.version === 2 ? profile.value.parameterPolicy.ruleId : undefined)
const v2 = computed(() => profile.value.parameterPolicy?.version === 2)
const caps = computed(() => { try { return modelCapabilities({ ...props.target, ruleId: binding.value }) } catch { return modelCapabilities(props.target) } })
const rules = computed(() => MODEL_RULES.filter(r => props.target.protocol !== 'local' && r.protocols.includes(props.target.protocol)))
const suggested = computed(() => MODEL_RULES.filter(r => r.models.includes(props.target.model)))
const policyBase = () => v2.value ? { version: 2 as const, ...(binding.value ? { ruleId: binding.value } : {}) } : { version: 1 as const }
function bindRule(value: string) {
  if (props.disabled) return
  previous.value = JSON.parse(JSON.stringify(profile.value)); previousParameter.value = undefined
  const old = { ...overrides.value }, t = old.thinking
  delete old.thinking
  if (t) old.reasoning = t.kind === 'effort' ? { effort: t.value } : { budgetTokens: t.tokens }
  profile.value = { ...profile.value, parameterPolicy: { version: 2, ...(value ? { ruleId: value } : {}), ...(profile.value.parameterPolicy?.mode === 'custom' ? { mode: 'custom', overrides: old } : { mode: 'auto' }) } }
}
function reasoning(key: keyof ReasoningChoice, value: string | number | undefined, invalid = false) {
  const next = { ...overrides.value.reasoning }
  if (value === undefined || value === '') delete next[key]
  else Object.assign(next, { [key]: value })
  update('reasoning', Object.keys(next).length ? next : undefined, key === 'budgetTokens' ? invalid : Boolean(profile.value.parameterInputErrors?.reasoning))
}
function reasoningBudget(event: Event) {
  const input = event.target as HTMLInputElement
  if (props.disabled) return
  if (input.validity.badInput) { profile.value = { ...profile.value, parameterInputErrors: { ...profile.value.parameterInputErrors, reasoning: true } }; return }
  reasoning('budgetTokens', input.value === '' ? undefined : input.valueAsNumber)
}
const overrides = computed(() => profile.value.parameterPolicy?.mode === 'custom' ? profile.value.parameterPolicy.overrides : {})
const unconfirmed = computed(() => {
  const items: Array<{ key: keyof ParameterOverrides; label: string; value: string }> = []
  if (overrides.value.temperature !== undefined && caps.value.temperature !== 'supported') items.push({ key: 'temperature', label: '创造性', value: String(overrides.value.temperature) })
  if (overrides.value.topP !== undefined && caps.value.topP !== 'supported') items.push({ key: 'topP', label: '采样范围', value: String(overrides.value.topP) })
  if (overrides.value.topK !== undefined && caps.value.rule?.topK?.status !== 'supported') items.push({ key: 'topK', label: '采样候选数', value: String(overrides.value.topK) })
  const r = overrides.value.reasoning, rule = caps.value.rule?.reasoning
  if (r && (!rule || r.mode !== undefined && !rule.modes?.includes(r.mode) || r.effort !== undefined && !rule.efforts?.includes(r.effort) || r.budgetTokens !== undefined && !rule.budget)) {
    items.push({ key: 'reasoning', label: '思考设置', value: [r.mode, r.effort, r.budgetTokens === undefined ? undefined : `${r.budgetTokens} tokens`].filter(v => v !== undefined).join(' · ') })
  }
  const thinking = overrides.value.thinking, capability = caps.value.thinking
  if (thinking && (capability.status !== 'supported' || capability.kind !== thinking.kind || (thinking.kind === 'effort' && !capability.values?.includes(thinking.value)))) {
    items.push({ key: 'thinking', label: '思考设置', value: thinking.kind === 'effort' ? thinking.value : `${thinking.tokens} tokens` })
  }
  return items
})
const preview = computed(() => {
  try {
    const value = draftProfile(profile.value, 'preview')
    const tasks = props.task === 'shared' ? Object.keys(modelTaskLabels).filter(task => task !== 'shared') as AiTask[] : [props.task]
    const results = tasks.map(task => {
      try { return compileGeneration(value, task, props.target, props.operation) }
      catch (e) { throw Error(`${modelTaskLabels[task]}：${e instanceof Error ? e.message : '请核对参数。'}`) }
    })
    return { result: results.find(result => result.task === 'prose') ?? results[0], results, error: '' }
  }
  catch (e) { return { result: undefined, results: [], error: e instanceof Error ? e.message : '请核对参数。' } }
})
const variedBudgets = computed(() => new Set(preview.value.results.map(result => result.outputTokens)).size > 1)
function mode(value: string) {
  if (props.disabled) return
  previous.value = JSON.parse(JSON.stringify(profile.value))
  previousParameter.value = undefined
  profile.value = { selection: profile.value.selection, model: profile.value.model, parameterPolicy: value === 'custom' ? { ...policyBase(), mode: 'custom', overrides: {} } : { ...policyBase(), mode: 'auto' } }
}
function clearUnconfirmed(key: keyof ParameterOverrides) {
  if (props.disabled) return
  const before = JSON.parse(JSON.stringify(profile.value)) as ProfileDraft
  update(key, undefined)
  previous.value = before; previousParameter.value = key
}
function invalidateParameterUndo(key: keyof ParameterOverrides) { if (previousParameter.value === key) previous.value = undefined }
function update(key: keyof ParameterOverrides, value: ParameterOverrides[keyof ParameterOverrides] | undefined, inputError = false) {
  if (props.disabled) return
  invalidateParameterUndo(key)
  const next = { ...overrides.value }
  const errors = { ...profile.value.parameterInputErrors }
  if (inputError) errors[key] = true
  else delete errors[key]
  if (value === undefined) delete next[key]
  else Object.assign(next, { [key]: value })
  profile.value = { selection: profile.value.selection, model: profile.value.model, parameterPolicy: { ...policyBase(), mode: 'custom', overrides: next }, ...(Object.keys(errors).length ? { parameterInputErrors: errors } : {}) }
}
function undo() {
  if (props.disabled || !previous.value) return
  const before = previous.value, key = previousParameter.value
  // A field-level undo must retain later edits and validation flags on other fields.
  if (key && before.parameterPolicy?.mode === 'custom') update(key, before.parameterPolicy.overrides[key], Boolean(before.parameterInputErrors?.[key]))
  else profile.value = before
  previous.value = undefined
}
// Native invalid input exposes an empty DOM value. An empty binding preserves
// its in-progress text instead of rewriting the last valid number.
function number(key: keyof ParameterOverrides, event: Event) {
  if (props.disabled) return
  const input = event.target as HTMLInputElement
  if (input.validity.badInput) {
    invalidateParameterUndo(key)
    profile.value = { ...profile.value, parameterInputErrors: { ...profile.value.parameterInputErrors, [key]: true } }
    return
  }
  update(key, input.value === '' ? undefined : key === 'thinking' ? { kind: 'budget', tokens: input.valueAsNumber } : input.valueAsNumber)
}
function thinking(event: Event) { const value = (event.target as HTMLSelectElement).value; update('thinking', value ? { kind: 'effort', value } : undefined) }
function budget(event: Event) { number('thinking', event) }
const sourceLabels = { 'official-rule': '官方型号规则', 'endpoint-metadata': '当前接口提供的型号资料', 'local-manifest': '本地模型清单', 'author-binding': '作者选择的官方参考规则（接口待验证）', unknown: '能力尚未确认' }
</script>
<template>
  <div class="parameter-editor" data-testid="model-parameters">
    <div class="parameter-mode">
      <ArchiveFormField label="创作参数" v-slot="{ controlProps }"><select v-bind="controlProps" :value="profile.parameterPolicy?.mode ?? 'legacy'" :aria-label="`${label}参数模式`" :disabled="disabled" @change="mode(($event.target as HTMLSelectElement).value)"><option v-if="!profile.parameterPolicy" value="legacy">保留原参数</option><option value="auto">自动 · 推荐</option><option value="custom">自定义</option></select></ArchiveFormField>
      <p v-if="profile.parameterPolicy?.mode === 'auto'">采样与思考沿用模型默认，输出预算按创作任务设置。</p>
      <p v-else-if="!profile.parameterPolicy">这本书沿用已保存的参数。选择“自动”后才应用新的推荐策略。</p>
      <p v-else>留空表示自动。只显示当前型号已确认的可调参数。</p>
    </div>
    <p v-if="preview.result" class="budget-summary"><template v-if="variedBudgets">各任务输出上限：<span v-for="(result, index) in preview.results" :key="result.task" :data-budget-task="result.task">{{ modelTaskLabels[result.task] }} <strong>{{ result.outputTokens.toLocaleString() }}</strong> tokens{{ index < preview.results.length - 1 ? '；' : '' }}</span></template><template v-else>{{ task === 'shared' ? '四项任务输出上限' : '本次输出上限' }} <strong>{{ preview.result.outputTokens.toLocaleString() }}</strong> tokens</template><span v-if="target.protocol !== 'local'"> · 思考可能占用此预算</span><span v-if="caps.maxOutputTokens"> · 型号上限 {{ caps.maxOutputTokens.toLocaleString() }}</span></p>
    <p v-if="preview.error" role="alert" class="error">{{ preview.error }}</p>
    <p v-for="note in preview.result?.notes" :key="note" class="parameter-note">{{ note }}</p>
    <details class="parameter-details" :open="profile.parameterPolicy?.mode === 'custom'">
      <summary>高级参数与依据</summary>
      <p class="parameter-note">{{ sourceLabels[caps.source] }}<template v-if="caps.source === 'official-rule'"> · 规则核对 {{ caps.checkedAt }}</template>。接口可能使用别名或忽略参数；测试成功仅代表这一组合完成了生成。</p>
      <ArchiveFormField v-if="target.protocol !== 'local'" label="型号规则" help="中转或别名可明确选择参考规则；不会更改发送型号。选择后先预览，保存才生效。" v-slot="{ controlProps }">
        <select v-bind="controlProps" :value="binding ?? ''" :aria-label="`${label}型号规则`" :disabled="disabled" @change="bindRule(($event.target as HTMLSelectElement).value)"><option value="">自动核对接口与完整型号</option><option v-for="rule in rules" :key="rule.id" :value="rule.id">{{ rule.label }}</option></select>
      </ArchiveFormField>
      <p v-if="target.protocol === 'openai-compatible'" class="parameter-note">Opus 5.5 的思考强度需 Anthropic Messages；GPT 6.1 等型号的工具调用需 OpenAI Responses。可在接口管理中新建相应协议连接。</p>
      <p v-if="caps.source === 'unknown' && suggested.length" class="parameter-note">可参考：{{ suggested.map(r => r.label).join('、') }}。需要匹配规则所列协议；可在接口管理中新建连接。</p>
      <p v-if="caps.rule" class="parameter-note">规则 {{ caps.rule.id }} · 核对 {{ caps.checkedAt }} · <a :href="caps.sourceUrl" target="_blank" rel="noreferrer">查看官方依据</a></p>
      <p v-if="caps.temperature === 'fixed'" class="parameter-note">温度固定为 {{ caps.rule?.temperature.default }}；不发送无效的自定义值。</p>
      <p v-if="caps.topP === 'fixed'" class="parameter-note">top_p 固定为 {{ caps.rule?.topP.default }}。</p>
      <p v-if="caps.contextTokens" class="parameter-note">已知上下文容量 {{ caps.contextTokens.toLocaleString() }} tokens，与最大输出、期望正文字数不同。</p>
      <ArchiveAction v-if="!v2" :disabled="disabled" @click="bindRule('')">预览新版规则与思考输出预算</ArchiveAction>
      <template v-if="!profile.parameterPolicy"><p>创造性 {{ profile.temperature }} · 采样范围 {{ profile.topP }} · 最大输出 {{ profile.maxTokens }} · 思考 {{ profile.thinkingLevel ?? '默认' }}</p><ArchiveAction :disabled="disabled" @click="mode('auto')">使用自动创作参数</ArchiveAction></template>
      <template v-else-if="profile.parameterPolicy.mode === 'custom'">
        <section v-if="unconfirmed.length" class="unconfirmed-parameters" aria-label="待确认的自定义参数" data-testid="unconfirmed-parameters">
          <p>以下自定义值仍保留，但当前型号不支持或尚未确认支持。可重新获取型号资料，或逐项恢复自动；保存前需要处理。</p>
          <div v-for="item in unconfirmed" :key="item.key" :data-testid="`unconfirmed-parameter-${item.key}`"><span>{{ item.label }}：<strong>{{ item.value }}</strong></span><ArchiveAction compact :disabled="disabled" :aria-label="`${label}将${item.label}恢复自动`" @click="clearUnconfirmed(item.key)">此项恢复自动</ArchiveAction></div>
        </section>
        <div class="parameter-grid">
          <ArchiveFormField v-if="caps.temperature === 'supported'" label="创造性（temperature）" help="影响采样随机性；更高不保证文笔更好。留空沿用模型默认。" v-slot="{ controlProps }"><input v-bind="controlProps" :value="profile.parameterInputErrors?.temperature ? '' : (overrides.temperature)" :aria-invalid="Boolean(profile.parameterInputErrors?.temperature)" :aria-label="`${label}创造性`" type="number" min="0" :max="caps.maxTemperature" step="0.05" placeholder="自动" :disabled="disabled" @input="number('temperature', $event)"></ArchiveFormField>
          <ArchiveFormField v-if="caps.topP === 'supported'" label="采样范围（top_p）" help="限制候选词范围，通常只需调整它或创造性中的一个。" v-slot="{ controlProps }"><input v-bind="controlProps" :value="profile.parameterInputErrors?.topP ? '' : (overrides.topP)" :aria-invalid="Boolean(profile.parameterInputErrors?.topP)" :aria-label="`${label}采样范围`" type="number" min="0" max="1" step="0.05" placeholder="自动" :disabled="disabled" @input="number('topP', $event)"></ArchiveFormField>
          <ArchiveFormField v-if="!v2 && caps.thinking.status === 'supported' && caps.thinking.kind === 'effort'" label="思考强度" help="更高可能增加等待与费用；自动使用模型默认。" v-slot="{ controlProps }"><select v-bind="controlProps" :value="overrides.thinking?.kind === 'effort' ? overrides.thinking.value : ''" :aria-label="`${label}思考强度`" :disabled="disabled" @change="thinking"><option value="">自动</option><option v-for="value in caps.thinking.values" :key="value" :value="value">{{ ({ none: '关闭', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高' } as Record<string, string>)[value] ?? value }}（{{ value }}）</option></select></ArchiveFormField>
          <ArchiveFormField v-if="!v2 && caps.thinking.status === 'supported' && caps.thinking.kind === 'budget'" label="思考预算（tokens）" help="与输出共用预算，需要为正文保留空间。留空由模型决定。" v-slot="{ controlProps }"><input v-bind="controlProps" :value="profile.parameterInputErrors?.thinking ? '' : (overrides.thinking?.kind === 'budget' ? overrides.thinking.tokens : undefined)" :aria-invalid="Boolean(profile.parameterInputErrors?.thinking)" :aria-label="`${label}思考预算`" type="number" :min="caps.thinking.allowZero ? 0 : caps.thinking.min" :max="caps.thinking.max" step="1" placeholder="自动" :disabled="disabled" @input="budget"></ArchiveFormField>
          <ArchiveFormField v-if="v2 && caps.rule?.topK?.status === 'supported'" label="候选词数（top_k）" :help="caps.rule.topK.reason" v-slot="{ controlProps }"><input v-bind="controlProps" :value="profile.parameterInputErrors?.topK ? '' : overrides.topK" :aria-invalid="Boolean(profile.parameterInputErrors?.topK)" :aria-label="`${label}候选词数`" type="number" :min="caps.rule.topK.min" :max="caps.rule.topK.max" step="1" placeholder="自动" :disabled="disabled" @input="number('topK', $event)"></ArchiveFormField>
          <template v-if="v2 && caps.thinking.status === 'supported'">
            <ArchiveFormField v-if="caps.rule?.reasoning.modes?.length" label="思考模式" :help="`默认：${caps.rule.reasoning.defaultMode ?? '由服务决定'}。留空沿用默认模式。`" v-slot="{ controlProps }"><select v-bind="controlProps" :value="overrides.reasoning?.mode ?? ''" :aria-label="`${label}思考模式`" :disabled="disabled" @change="reasoning('mode', ($event.target as HTMLSelectElement).value)"><option value="">服务默认</option><option v-for="value in caps.rule.reasoning.modes" :key="value" :value="value">{{ ({ enabled: '开启', disabled: '关闭', adaptive: '自适应', none: '关闭', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高' } as Record<string, string>)[value] ?? value }}（{{ value }}）</option></select></ArchiveFormField>
            <ArchiveFormField v-if="caps.rule?.reasoning.efforts?.length" label="思考强度" :help="`默认：${caps.rule.reasoning.defaultEffort ?? '由服务决定'}。更高不保证文笔更好。`" v-slot="{ controlProps }"><select v-bind="controlProps" :value="overrides.reasoning?.effort ?? ''" :aria-label="`${label}思考强度`" :disabled="disabled" @change="reasoning('effort', ($event.target as HTMLSelectElement).value)"><option value="">服务默认</option><option v-for="value in caps.rule.reasoning.efforts" :key="value" :value="value">{{ ({ enabled: '开启', disabled: '关闭', adaptive: '自适应', none: '关闭', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高' } as Record<string, string>)[value] ?? value }}（{{ value }}）</option></select></ArchiveFormField>
            <ArchiveFormField v-if="caps.rule?.reasoning.budget" label="思考预算（tokens）" help="需要为正文留出输出空间；某些型号不能同时设置档位和预算。" v-slot="{ controlProps }"><input v-bind="controlProps" :value="profile.parameterInputErrors?.reasoning ? '' : overrides.reasoning?.budgetTokens" :aria-invalid="Boolean(profile.parameterInputErrors?.reasoning)" :aria-label="`${label}思考预算`" type="number" :min="caps.rule.reasoning.budget.allowZero ? 0 : caps.rule.reasoning.budget.min" :max="Math.min(caps.rule.reasoning.budget.max, 128000)" step="1" placeholder="自动" :disabled="disabled" @input="reasoningBudget"></ArchiveFormField>
          </template>
          <ArchiveFormField label="最大输出（tokens）" help="这是本次用量上限，不是字数目标；过小会截断正文。" v-slot="{ controlProps }"><input v-bind="controlProps" :value="profile.parameterInputErrors?.maxTokens ? '' : (overrides.maxTokens)" :aria-invalid="Boolean(profile.parameterInputErrors?.maxTokens)" :aria-label="`${label}最大输出`" type="number" min="128" :max="Math.min(caps.maxOutputTokens ?? 128000, 128000)" step="128" placeholder="自动" :disabled="disabled" @input="number('maxTokens', $event)"></ArchiveFormField>
        </div>
        <p v-if="!unconfirmed.length && (caps.temperature !== 'supported' || caps.thinking.status !== 'supported')" class="parameter-note">未确认或不支持的采样、思考参数由服务决定，不提供猜测的调节项。</p>
        <p v-if="caps.samplingRequiresNone" class="parameter-note">此型号只有关闭思考（none）时才允许修改采样。</p>
      </template>
      <p v-else class="parameter-note">想自行调整时，选择上方“自定义”。只展开说明不会修改配置或联网。</p>
    </details>
    <ArchiveAction v-if="previous" :disabled="disabled" @click="undo">{{ previousParameter ? '撤销这项参数调整' : '撤销参数模式调整' }}</ArchiveAction>
  </div>
</template>
<style scoped>
.parameter-editor { display:grid; gap:10px; min-width:0; border-top:1px solid var(--line); padding-top:16px; }
.parameter-mode { display:flex; flex-wrap:wrap; gap:12px 24px; align-items:center; }.parameter-mode > :first-child { min-width:180px; }.parameter-mode p { flex:1; min-width:200px; }
p { margin:0; color:var(--muted); font-size:var(--form-help,14px); line-height:1.7; }.budget-summary strong { color:var(--ink); font-variant-numeric:tabular-nums; }.error { color:var(--danger); }
.parameter-details { padding:10px 0; }.parameter-details summary { cursor:pointer; color:var(--jade); }.parameter-details[open] { display:grid; gap:12px; }.parameter-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; margin-top:12px; }
.unconfirmed-parameters { display:grid; gap:10px; border-left:3px solid var(--jade); padding:10px 12px; background:var(--surface); }.unconfirmed-parameters > div { display:flex; flex-wrap:wrap; gap:8px 16px; justify-content:space-between; align-items:center; overflow-wrap:anywhere; }.unconfirmed-parameters strong { color:var(--ink); }
input,select { width:100%; min-width:0; min-height:40px; padding:8px 10px; border:1px solid var(--line); background:var(--surface); color:var(--ink); font:inherit; }
.parameter-note a { color:var(--jade); text-underline-offset:3px; }
:is(input,select,summary,a):focus-visible { outline:2px solid var(--jade); outline-offset:2px; }
@container (max-width:600px) { .parameter-grid { grid-template-columns:1fr; } }
</style>
