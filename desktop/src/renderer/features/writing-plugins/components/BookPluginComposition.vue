<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, toRefs, watch } from 'vue'
import { renderContributionText, type JsonObject, type WritingContribution } from '@lanjian/writing-plugin-contracts'
import type { PluginManagementView, WritingPluginsApi } from '../../../../contracts/writing-plugins/management-contracts'
import type { CompositionEntry, CompositionPreview } from '../../../../contracts/writing-plugins/contributions'
import ArchiveAction from '../../../ui/ArchiveAction.vue'
import { pluginError } from '../plugin-error'
import { unavailableContributions } from '../composition-recovery'
import { describeCompositionEntry, reviewComposition } from '../composition-review'
import { applyCompositionSession, beginCompositionInput, clearCompositionFields, compositionDirty, compositionSession, finishCompositionInput, loadCompositionSaved, reconcileComposition, setCompositionParam } from '../composition-session'

const props = defineProps<{ api: WritingPluginsApi; view: PluginManagementView; disabled: boolean; bookScopeKey: string; scope?: 'book' | 'library' }>()
const emit = defineEmits<{ applied: []; manage: [id: string, digest: string]; install: [] }>()
const library = computed(() => props.scope === 'library')
const savedComposition = computed(() => library.value ? props.view.library?.composition : props.view.composition)
const savedEntries = computed(() => savedComposition.value?.entries ?? [])
const scopeToken = computed(() => library.value ? props.view.library?.token : props.view.book?.token)
const scopeTitle = computed(() => library.value ? '知识库' : props.view.book?.title ?? '')
const scopedPlugins = computed(() => !library.value ? props.view.plugins : props.view.plugins.map(p => ({ ...p, versions: p.versions.map(v => ({ ...v, manifest: { ...v.manifest, contributions: v.manifest.contributions?.filter(c => c.kind === 'creative-policy' && ['inspiration-extract', 'inspiration-summary'].includes(c.slot)) } })) })))
const session = compositionSession(props.bookScopeKey, savedEntries.value, scopeTitle.value)
const restored = ref(compositionDirty(session))
const { draft, busy, error, invalidFields, textDrafts, composing, savedContent } = toRefs(session)
const preview = ref<CompositionPreview | null>(null), externalChange = ref(false)
const previewPanel = ref<HTMLElement | null>(null), actions = ref<HTMLElement | null>(null)
const review = computed(() => preview.value && !preview.value.conflicts.length ? reviewComposition(savedEntries.value, preview.value.entries, props.view.plugins) : null)
const changeLabels = { added: '新增', removed: '移除', changed: '修改', unchanged: '未变更' }
const reviewValue = (value: string | undefined) => value === undefined ? '未设置' : value === '' ? '（空文本）' : value
const dirty = computed(() => compositionDirty(session))
let generation = 0, alive = true
onBeforeUnmount(() => { alive = false; generation++; finishCompositionInput(session) })
let observedApply = session.appliedSequence
watch([() => session.appliedSequence, () => props.disabled], () => {
  if (alive && !props.disabled && observedApply !== session.appliedSequence) { observedApply = session.appliedSequence; emit('applied') }
})
function loadSaved() {
  loadCompositionSaved(session, savedEntries.value)
  preview.value = null; externalChange.value = false; restored.value = false; generation++
}
// The parent is keyed by book ID + path. A same-book management refresh rotates
// its token, but must not replace unapplied parameters or in-progress IME text.
watch(() => props.view, () => {
  preview.value = null; error.value = ''; generation++
  externalChange.value = reconcileComposition(session, savedEntries.value)
}, { immediate: true })
const key = (e: { pluginId: string; contributionId: string }) => `${e.pluginId}/${e.contributionId}`
const kinds = { 'context-fragment': '写作参考', 'setting-template': '候选模板', checker: '检查建议', workflow: '写作流程', 'tool-reference': '工具配置', 'creative-policy': '创作方法', 'team-preset': '创作团队' }
const stages: Record<string, string> = { assistant: '助笔对话', worldbuilding: '世界设定', planning: '谋篇', writing: '正文', review: '审校' }
const rows = computed(() => scopedPlugins.value.flatMap(p => p.versions.filter(v => v.digest === p.current || draft.value.some(e => e.pluginId === p.id && e.digest === v.digest)).flatMap(v => (v.manifest.contributions ?? []).map(c => ({ pluginId: p.id, digest: v.digest, contributionId: c.id, contribution: c, name: v.manifest.name, version: v.manifest.version, current: v.digest === p.current, ready: p.enabled && (library.value || p.bookEnabled) })))))
const selected = (row: { pluginId: string; digest: string; contributionId: string }) => draft.value.find(e => key(e) === key(row) && e.digest === row.digest)
const missing = computed(() => unavailableContributions(draft.value, scopedPlugins.value, textDrafts.value, invalidFields.value).map(item => ({ ...item, reason: library.value ? item.reason.replace('本书', '知识库') : item.reason })))
function recover(entry?: CompositionEntry) {
  if (busy.value || props.disabled || composing.value) return
  generation++; preview.value = null
  if (entry) emit('manage', entry.pluginId, entry.digest)
  else emit('install')
}
function clearEntryFields(entry: { pluginId: string; contributionId: string }) {
  clearCompositionFields(session, entry)
}
function removeMissing(entry: CompositionEntry) { generation++; preview.value = null; draft.value = draft.value.filter(e => key(e) !== key(entry)); clearEntryFields(entry) }
const savedRows = computed(() => (savedEntries.value).map(entry => describeCompositionEntry(entry, props.view.plugins)))
const fields = (c: WritingContribution) => c.configSchema.type === 'object' ? Object.entries(c.configSchema.properties) : []
function toggle(row: typeof rows.value[number], enabled: boolean) {
  generation++; preview.value = null; error.value = ''
  draft.value = draft.value.filter(e => key(e) !== key(row))
  clearEntryFields(row)
  if (enabled) draft.value.push({ pluginId: row.pluginId, digest: row.digest, contributionId: row.contributionId, params: Object.fromEntries(fields(row.contribution).filter(([,s]) => s.type === 'boolean').map(([name]) => [name, false])) })
}
function setParam(row: typeof rows.value[number], name: string, value: string | boolean, type: string) {
  generation++; preview.value = null
  setCompositionParam(session, row, name, value, type)
}
function beginComposition(row: typeof rows.value[number], name: string, event: Event, type: string) {
  beginCompositionInput(session, row, name, type, (event.target as HTMLInputElement).value)
  generation++; preview.value = null
}
function endComposition(row: typeof rows.value[number], name: string, event: Event, type: string) {
  composing.value = false; session.input = null; textInput(row, name, event, type)
}
function textInput(row: typeof rows.value[number], name: string, event: Event, type: string) {
  const value = (event.target as HTMLInputElement).value
  textDrafts.value[`${key(row)}/${name}`] = value
  if ((event as InputEvent).isComposing || composing.value) { generation++; preview.value = null; return }
  setParam(row, name, value, type)
}
const display = (params: JsonObject, name: string) => params[name] === undefined ? '' : typeof params[name] === 'object' ? JSON.stringify(params[name], null, 2) : String(params[name])
async function inspect(reviewedChange = false) {
  if (busy.value || props.disabled || composing.value || Object.keys(invalidFields.value).length || !scopeToken.value || externalChange.value && !reviewedChange) return
  if (reviewedChange) { savedContent.value = JSON.stringify(savedEntries.value); externalChange.value = false }
  busy.value = true; error.value = ''; preview.value = null; const request = ++generation
  try {
    const entries = JSON.parse(JSON.stringify(draft.value))
    const result = library.value
      ? await props.api.previewLibraryComposition({ libraryToken: scopeToken.value!, revision: props.view.revision, entries })
      : await props.api.previewComposition({ bookToken: scopeToken.value!, revision: props.view.revision, entries })
    if (alive && request === generation) {
      preview.value = result; await nextTick()
      if (alive && request === generation) { previewPanel.value?.focus({ preventScroll: true }); previewPanel.value?.scrollIntoView({ block: 'nearest' }) }
    }
  }
  catch (cause) { if (alive && request === generation) error.value = pluginError(cause, '预览未完成。') }
  finally { busy.value = false }
}
async function returnToEdit() {
  if (busy.value || props.disabled || composing.value) return
  const request = ++generation; preview.value = null
  await nextTick()
  if (alive && request === generation) actions.value?.querySelector<HTMLButtonElement>('button')?.focus()
}
async function apply() {
  if (!preview.value || preview.value.conflicts.length || busy.value || props.disabled || composing.value || externalChange.value) return
  const plan = preview.value; preview.value = null; generation++
  await applyCompositionSession(session, props.api, plan.planId)
}
</script>
<template>
  <section v-if="scopeToken" class="book-composition" :data-testid="library ? 'library-plugin-composition' : 'book-plugin-composition'" :aria-busy="busy">
    <header><div><p class="eyebrow">{{ scopeTitle }} · 已保存组合 {{ savedComposition?.revision ?? 0 }}</p><h3>{{ library ? '知识库的提取方法' : '这本书的写作组合' }}</h3></div><span>{{ draft.length }} 项已选 · {{ composing ? '正在输入' : dirty || externalChange ? '未应用' : '已保存' }}</span></header>
    <p v-if="library">选择提取情节与汇总故事的方法，预览后确认。未选择时使用官方默认方法；新选择用于之后的提取，已开始的作业保留原版本与参数。</p><p v-else>挑选写作参考、候选模板或流程，预览后确认。新组合用于之后的任务；已开始的任务保留原版本与参数。</p>
    <p v-if="dirty" class="draft-notice" role="status" data-testid="composition-draft-notice">{{ restored ? '已恢复本窗口中的未应用修改。' : '未应用修改暂存在本窗口。' }}切换页面或作品可继续编辑；关闭窗口前，请确认应用以保存。</p>
    <div v-if="externalChange" class="external-change" data-testid="composition-external-change">
      <p role="status">已保存组合有变化。你的修改已保留，请核对后重新预览。</p>
      <details><summary>查看已保存组合</summary><p v-if="!savedRows.length">目前保存的组合为空。</p><div v-for="row in savedRows" :key="key(row.entry)"><p>{{ row.label }}</p><p v-if="!row.parameters.length">未配置额外参数。</p><div v-for="parameter in row.parameters" :key="parameter.name" class="saved-parameter"><span>{{ parameter.label }}</span><pre v-if="parameter.structured">{{ parameter.text }}</pre><span v-else>{{ parameter.text }}</span></div></div></details>
      <p>核对后将以当前编辑内容重新预览，确认应用前不会替换已保存组合。</p>
    </div>
    <p v-if="!rows.length && !missing.length">{{ library ? '当前使用官方默认提取方法。可从插件目录创建个人副本，编辑、安装并启用后在此选择。' : '已安装插件尚未声明写作贡献。普通工具仍可通过“本书使用”启用。' }}</p>
    <fieldset :disabled="disabled || busy">
      <article v-for="row in rows" :key="`${key(row)}/${row.digest}`" class="contribution" :data-contribution-id="row.contributionId" :data-digest="row.digest">
        <label class="choice"><input type="checkbox" :checked="Boolean(selected(row))" :disabled="!row.ready && !selected(row)" @change="toggle(row, ($event.target as HTMLInputElement).checked)" /><span><strong>{{ row.contribution.name }}</strong><small>{{ row.name }} {{ row.version }} · {{ kinds[row.contribution.kind] }}</small></span></label>
        <p v-if="!library || !row.ready" class="stages"><template v-if="!library">{{ row.contribution.stages.map(s => stages[s]).join(' · ') }}</template><span v-if="!row.ready"> · {{ library ? '请先启用插件' : '请先启用并选择本书使用' }}</span></p>
        <p v-if="library && row.contribution.kind === 'creative-policy'" class="stages">{{ row.contribution.slot === 'inspiration-extract' ? '提取情节' : '汇总故事' }} · {{ { replace: '替换默认方法', append: '补充方法', disabled: '停用此项创作' }[row.contribution.mode] }}</p>
        <div v-if="selected(row)" class="parameters">
          <div class="version-actions"><small v-if="!row.current">{{ library ? '知识库保留此版本' : '本书保留此版本' }}</small><ArchiveAction compact :disabled="disabled || busy || composing" @click="recover(selected(row))">管理此版本</ArchiveAction></div>
          <p v-if="row.contribution.kind === 'context-fragment'" class="fragment">{{ renderContributionText(row.contribution.text, selected(row)!.params, '〈待填写〉') }}</p>
          <label v-for="[name, schema] in fields(row.contribution)" :key="name">{{ schema.description || name }}
            <input v-if="schema.type === 'boolean'" type="checkbox" :checked="selected(row)!.params[name] === true" @change="setParam(row, name, ($event.target as HTMLInputElement).checked, schema.type)" />
            <select v-else-if="'enum' in schema && schema.enum" :value="display(selected(row)!.params, name)" @change="setParam(row, name, ($event.target as HTMLSelectElement).value, schema.type)"><option value="">请选择</option><option v-for="value in schema.enum" :key="value" :value="value">{{ value }}</option></select>
            <textarea v-else-if="schema.type === 'object' || schema.type === 'array'" :value="textDrafts[`${key(row)}/${name}`] ?? display(selected(row)!.params, name)" rows="4" @compositionstart="beginComposition(row, name, $event, schema.type)" @compositionend="endComposition(row, name, $event, schema.type)" @input="textInput(row, name, $event, schema.type)" />
            <input v-else :type="schema.type === 'string' ? 'text' : 'number'" :value="textDrafts[`${key(row)}/${name}`] ?? display(selected(row)!.params, name)" :maxlength="schema.type === 'string' ? schema.maxLength : undefined" @compositionstart="beginComposition(row, name, $event, schema.type)" @compositionend="endComposition(row, name, $event, schema.type)" @input="textInput(row, name, $event, schema.type)" />
          </label>
        </div>
      </article>
    </fieldset>
    <div v-for="item in missing" :key="key(item.entry)" class="contribution unavailable" data-testid="composition-unavailable" :data-contribution-id="item.entry.contributionId">
      <h4>{{ item.label }}</h4><p class="recovery-reason">{{ item.reason }}</p>
      <p>原选择和输入已保留，可查看或复制。请核对原版本标识后重新安装所需插件包；安装其他版本不会替换当前选择。</p>
      <div v-for="parameter in item.parameters" :key="parameter.name" class="saved-parameter"><span>{{ parameter.name }}</span><div><pre>{{ parameter.text === '' ? '（空内容）' : parameter.text }}</pre><small v-if="parameter.error" class="error">{{ parameter.error }} 原始输入已保留。</small></div></div>
      <p v-if="!item.parameters.length">未配置额外参数。</p>
      <details><summary>核对原版本标识</summary><p>插件：{{ item.entry.pluginId }}<br />写作贡献：{{ item.entry.contributionId }}</p><code>{{ item.entry.digest }}</code></details>
      <div class="actions"><ArchiveAction :disabled="busy || disabled || composing" @click="recover()">重新安装插件包</ArchiveAction><ArchiveAction :disabled="busy || disabled || composing" @click="removeMissing(item.entry)">移除失效贡献</ArchiveAction></div>
    </div>
    <p v-for="message in invalidFields" :key="message" role="alert" class="error">{{ message }}</p>
    <p v-if="error" role="alert" class="error">{{ error }} 草稿已保留，可重新预览。</p>
    <div v-if="preview" ref="previewPanel" class="composition-preview" data-testid="composition-preview" tabindex="-1" :aria-label="library ? '知识库方法预览' : '本书组合预览'">
      <template v-if="preview.conflicts.length"><h4>需要先调整组合</h4><ul><li v-for="(conflict, index) in preview.conflicts" :key="index">{{ conflict.contribution }}：{{ conflict.message }}</li></ul></template>
      <template v-else-if="review">
        <h4>核对本次组合变化</h4>
        <p role="status">新增 {{ review.counts.added }} 项 · 修改 {{ review.counts.changed }} 项 · 移除 {{ review.counts.removed }} 项 · 未变更 {{ review.counts.unchanged }} 项</p>
        <p v-if="!preview.entries.length && review.counts.removed">{{ library ? '知识库将恢复官方默认方法。已有作业仍使用原方法。' : '本书写作组合将清空。插件安装、授权和“本书使用”设置保持不变。' }}</p>
        <p v-else-if="!review.counts.added && !review.counts.changed && !review.counts.removed && !review.orderChanged">与已保存组合一致。</p>
        <p v-if="review.orderChanged">已有贡献的顺序已调整，以下按应用后的顺序排列，移除项列在最后。</p>
        <details v-for="item in review.rows" :key="item.key" class="review-entry" :open="item.status !== 'unchanged'" :data-change="item.status" :data-contribution-key="item.key">
          <summary><span class="change-label">{{ changeLabels[item.status] }}</span>{{ (item.after ?? item.before)!.label }}</summary>
          <p v-if="item.versionChanged">插件包已更换，请核对版本标识。<br />原版本：{{ item.before!.label }}<br />应用后：{{ item.after!.label }}</p>
          <p v-if="item.versionChanged" class="review-stages">原适用阶段：{{ item.before!.stages.map(s => stages[s]).join(' · ') || '不可用' }}<br />应用后适用阶段：{{ item.after!.stages.map(s => stages[s]).join(' · ') || '不可用' }}</p>
          <p v-else class="review-stages">{{ (item.after ?? item.before)!.stages.map(s => stages[s]).join(' · ') || '原版本的适用阶段不可用' }}</p>
          <table v-if="item.parameters.length" class="review-parameters"><thead><tr><th scope="col">参数</th><th scope="col">已保存</th><th scope="col">应用后</th></tr></thead><tbody><tr v-for="parameter in item.parameters" :key="parameter.name" :class="{ 'parameter-changed': parameter.changed }"><th scope="row">{{ parameter.label }}<small v-if="parameter.label !== parameter.name">{{ parameter.name }}</small></th><td><pre>{{ reviewValue(parameter.before) }}</pre></td><td><pre>{{ reviewValue(parameter.after) }}</pre></td></tr></tbody></table>
          <p v-else>没有额外配置参数。</p>
          <details class="review-identity"><summary>查看版本标识</summary><p>{{ item.key }}</p><p v-if="item.before">已保存：<code>{{ item.before.entry.digest }}</code></p><p v-if="item.after">应用后：<code>{{ item.after.entry.digest }}</code></p></details>
        </details>
        <p>确认后替换{{ library ? '知识库' : '本书' }}已保存的组合，仅用于后续任务；不会修改正文或正式设定。</p>
      </template>
    </div>
    <div ref="actions" class="actions"><ArchiveAction data-testid="composition-inspect" :disabled="busy || disabled || composing || externalChange || Boolean(Object.keys(invalidFields).length)" @click="inspect()">预览组合</ArchiveAction><ArchiveAction v-if="externalChange" variant="primary" :disabled="busy || disabled || composing || Boolean(Object.keys(invalidFields).length)" @click="inspect(true)">核对后预览当前编辑</ArchiveAction><ArchiveAction v-if="preview" :disabled="busy || disabled || composing" @click="returnToEdit">返回修改</ArchiveAction><ArchiveAction v-if="preview && !preview.conflicts.length" variant="primary" :disabled="busy || disabled || composing" @click="apply">确认应用组合</ArchiveAction><ArchiveAction v-if="dirty || externalChange" :disabled="busy || disabled || composing" @click="loadSaved">放弃修改，载入已保存组合</ArchiveAction></div>
  </section>
</template>
<style scoped>
.composition-preview:focus { outline:2px solid var(--jade); outline-offset:6px; }.review-entry { border-top:1px solid var(--line); padding:12px 0; font-size:13px; }.review-entry > summary { cursor:pointer; line-height:1.7; }.change-label { color:var(--jade); margin-right:10px; }.review-stages,.review-identity { color:var(--ink-muted); font-size:12px; }.review-identity { margin-top:12px; }.review-identity summary { cursor:pointer; }.review-parameters { width:100%; table-layout:fixed; border-collapse:collapse; font-size:13px; }.review-parameters th,.review-parameters td { text-align:left; vertical-align:top; padding:9px 10px; border-bottom:1px solid var(--line); overflow-wrap:anywhere; }.review-parameters th { font-weight:500; }.review-parameters thead { color:var(--ink-muted); }.review-parameters pre { margin:0; font:inherit; white-space:pre-wrap; overflow-wrap:anywhere; }.parameter-changed { background:var(--paper); }
.version-actions { display:flex; align-items:center; flex-wrap:wrap; gap:10px; }.unavailable { font-size:13px; }.unavailable h4 { margin:0; font-size:14px; overflow-wrap:anywhere; }.recovery-reason { color:var(--ink-muted); }.unavailable details { margin-top:16px; }.unavailable summary { cursor:pointer; color:var(--jade); }.unavailable code,.unavailable pre { white-space:pre-wrap; overflow-wrap:anywhere; }.unavailable pre { font:inherit; }.unavailable .saved-parameter { padding:8px 12px; background:var(--paper); }
.draft-notice { color:var(--ink-muted); font-size:13px; }
.external-change { margin:16px 0; padding:12px 16px; border-left:2px solid var(--jade); background:var(--paper); font-size:13px; }.external-change p { margin:8px 0; }.external-change summary { cursor:pointer; color:var(--jade); }.external-change pre { white-space:pre-wrap; overflow-wrap:anywhere; }
.saved-parameter { display:grid; grid-template-columns:minmax(80px,160px) minmax(0,1fr); gap:10px; margin:6px 0; white-space:pre-wrap; overflow-wrap:anywhere; }.saved-parameter > :first-child { color:var(--ink-muted); }.saved-parameter pre { margin:0; }
.book-composition { border: 1px solid var(--line); border-inline-start: 3px solid var(--jade); border-radius: 12px; padding: 24px; background: var(--surface); }header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }h3 { margin: 0; font-size: 20px; }.eyebrow, .stages, small { font-size: 12px; opacity: .75; }.eyebrow { margin: 0 0 7px; }p, li { line-height: 1.7; }fieldset { border: 0; padding: 0; min-width: 0; }.contribution { padding: 16px 0; border-top: 1px solid var(--line); }.choice { display: flex; align-items: start; gap: 10px; cursor: pointer; }small { display: block; margin-top: 4px; }input[type="checkbox"] { accent-color: var(--jade); margin-top: 4px; }.stages, .parameters { margin-left: 27px; }.parameters { display: grid; gap: 12px; }.parameters label { display: grid; gap: 7px; font-size: 13px; }input:not([type="checkbox"]), select, textarea { box-sizing: border-box; width: 100%; min-width: 0; padding: 9px 12px; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 6px; }.fragment { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; margin: 0; }.actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }.composition-preview { border-top: 1px solid var(--line); margin-top: 12px; overflow-wrap: anywhere; }.error { color: var(--danger, #b14c42); }input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid var(--jade); outline-offset: 2px; }@media(max-width: 760px) { .book-composition { padding: 18px; }header { align-items: start; flex-direction: column; } }
</style>
