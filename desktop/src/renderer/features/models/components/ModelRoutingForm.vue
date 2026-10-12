<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import type { ModelConnectionsApi } from '../../../../contracts/models/model-connections-contracts'
import type { GenerationTarget } from '../../../../contracts/models/generation-parameters'
import { remoteModelProtocol } from '../../../../contracts/models/model-connections'
import { LOCAL_CONNECTION_ID, LOCAL_QWEN_ID, LOCAL_QWEN_LIMITS, type LocalModelView } from '../../../../contracts/models/local-model-contracts'
import { modelTaskLabels, copySharedProfiles, selectModel, type RoutingDraft, type ModelSlot, type ProfileDraft } from '../services/model-connections-state'
import { buildModelCatalog, type ModelCatalogChoice } from '../services/model-catalog'
import ArchiveFormField from '../../../ui/ArchiveFormField.vue'
import ArchiveAction from '../../../ui/ArchiveAction.vue'
import ModelCatalogPicker from './ModelCatalogPicker.vue'
import ModelParameterEditor from './ModelParameterEditor.vue'
import { sessionModelCatalogs as catalogs } from '../composables/model-catalog-session'
type SourceOption = { value: string; label: string; disabled?: boolean; protocol?: string; baseUrl?: string; revision?: number }
const draft = defineModel<RoutingDraft>({ required: true })
const props = defineProps<{ options: SourceOption[]; api?: ModelConnectionsApi; localModels?: LocalModelView[]; disabled?: boolean }>()
const emit = defineEmits<{ busy: [value: boolean] }>()
const routingModeName = useId()
const showInactive = ref(false), chooseSource = ref(false), loading = ref(''), errors = ref<Record<string, { revision: number; message: string }>>({})
const undo = ref<Partial<Record<ModelSlot, ProfileDraft>>>({})
const taskCopyVersion = ref(0)
let generation = 0
const slots = computed(() => (Object.keys(modelTaskLabels) as ModelSlot[]).filter(slot => showInactive.value || (slot === 'shared') === (draft.value.routingMode === 'shared')))
const enabledGlobals = computed(() => props.options.filter(o => o.value.startsWith('global:') && !o.disabled))
function currentSource(key: string, revision: number) { return props.options.some(o => o.value === key && o.revision === revision && !o.disabled) }
function source(slot: ModelSlot) { return props.options.find(o => o.value === draft.value.profiles[slot].selection) ?? (!draft.value.profiles[slot].selection && enabledGlobals.value.length === 1 ? enabledGlobals.value[0] : undefined) }
function connections(slot: ModelSlot) { const o = source(slot); return o ? [{ id: o.value === 'local' ? LOCAL_CONNECTION_ID : o.value, name: o.label, baseUrl: o.baseUrl, enabled: !o.disabled }] : [] }
function snapshot(slot: ModelSlot) { const o = source(slot), c = o && catalogs.value[o.value]; return c && c.revision === o?.revision ? c : undefined }
function choices(slot: ModelSlot) {
  const c = connections(slot), p = draft.value.profiles[slot]
  const entries = snapshot(slot)?.entries ?? []
  const models = source(slot)?.value === 'local' ? (props.localModels?.map(m => m.id) ?? [LOCAL_QWEN_ID]) : entries.map(e => e.id)
  return buildModelCatalog(c, c.length ? { [c[0].id]: models } : {}, c.length && p.model ? [{ connectionId: c[0].id, model: p.model }] : [], props.localModels ?? [], c.length ? { [c[0].id]: entries } : {})
}
function target(slot: ModelSlot): GenerationTarget {
  const o = source(slot), model = draft.value.profiles[slot].model
  const local = props.localModels?.find(m => m.id === model)
  return { protocol: o?.value === 'local' ? 'local' : remoteModelProtocol(o?.protocol ?? 'openai-compatible'), baseUrl: o?.baseUrl, model,
    metadata: snapshot(slot)?.entries.find(e => e.id === model), ...(o?.value === 'local' && local?.systemReserveTokens !== undefined ? { localLimits: { contextTokens: local.contextTokens, maxOutputTokens: local.maxOutputTokens, recommendedOutputTokens: local.recommendedOutputTokens, systemReserveTokens: local.systemReserveTokens, samplingDefaults: local.samplingDefaults } } : o?.value === 'local' && model === LOCAL_QWEN_ID ? { localLimits: LOCAL_QWEN_LIMITS } : {}) }
}
function change(slot: ModelSlot, model: string, selection: string) {
  const p = draft.value.profiles[slot]
  if (p.model === model && p.selection === selection) return
  undo.value[slot] = JSON.parse(JSON.stringify(p))
  draft.value.profiles[slot] = selectModel(p, model, selection)
}
function selected(slot: ModelSlot, choice: ModelCatalogChoice | null) { if (choice && source(slot)) change(slot, choice.model, source(slot)!.value) }
function changedSource(slot: ModelSlot, event: Event) {
  generation++; if (loading.value) void props.api?.cancelTest(); loading.value = ''; emit('busy', false)
  change(slot, draft.value.profiles[slot].model, (event.target as HTMLSelectElement).value)
}
function useLocal(slot: ModelSlot) {
  generation++; if (loading.value) void props.api?.cancelTest(); loading.value = ''; emit('busy', false)
  change(slot, props.localModels?.find(m => m.state === 'ready')?.id ?? props.localModels?.[0]?.id ?? LOCAL_QWEN_ID, 'local')
}
function copyToTasks() {
  if (props.disabled) return
  draft.value = copySharedProfiles(draft.value)
  for (const slot of Object.keys(modelTaskLabels) as ModelSlot[]) if (slot !== 'shared') delete undo.value[slot]
  // A same-model copy also replaces parameter intent; discard the child editors' old undo.
  taskCopyVersion.value++
}
async function fetchModels(slot: ModelSlot) {
  const o = source(slot)
  if (!props.api || !o || !o.value.startsWith('global:') || o.revision === undefined || loading.value) return
  const request = ++generation, key = o.value, revision = o.revision
  loading.value = key; delete errors.value[key]; emit('busy', true); delete catalogs.value[key]
  try {
    const result = await props.api.catalog({ id: key.slice(7), revision })
    if (request !== generation || !currentSource(key, revision)) return
    if (result.id !== key.slice(7) || result.revision !== revision) throw Error('接口已变化，请重新获取型号。')
    if (!result.success) throw Error(result.message || '型号列表获取失败，可以手填型号。')
    catalogs.value[key] = result.catalog ?? { connectionId: result.id, revision, protocol: remoteModelProtocol(o.protocol ?? 'openai-compatible'), fetchedAt: result.testedAt, complete: true, entries: result.models.map(id => ({ id })) }
  } catch (e) {
    if (request === generation && currentSource(key, revision)) {
      // The validated desktop bridge rejects with a plain AppErrorDto, not an Error instance.
      const message = e && typeof e === 'object' && 'message' in e && typeof e.message === 'string' && e.message.trim() ? e.message : '型号列表获取失败，可以手填型号。'
      errors.value[key] = { revision, message }
    }
  }
  finally { if (request === generation) { loading.value = ''; emit('busy', false) } }
}
watch(() => props.options, () => {
  for (const [key, c] of Object.entries(catalogs.value)) if (!currentSource(key, c.revision)) delete catalogs.value[key]
  for (const [key, error] of Object.entries(errors.value)) if (!currentSource(key, error.revision)) delete errors.value[key]
}, { deep: true })
onBeforeUnmount(() => { generation++; if (loading.value) void props.api?.cancelTest(); emit('busy', false) })
</script>
<template>
  <div class="model-routing-form" data-testid="model-routing-form">
    <div class="routing-heading">
      <div class="routing-mode" role="radiogroup" aria-label="分配方式">
        <label :class="{ active: draft.routingMode === 'shared' }"><input v-model="draft.routingMode" type="radio" :name="routingModeName" value="shared" :disabled="disabled"><span>统一模型</span><small>所有创作任务</small></label>
        <label :class="{ active: draft.routingMode === 'perTask' }"><input v-model="draft.routingMode" type="radio" :name="routingModeName" value="perTask" :disabled="disabled"><span>按任务分配</span><small>分别选择型号</small></label>
      </div>
      <p class="routing-help">{{ draft.routingMode === 'shared' ? '谋篇、章纲、正文与审校，共用下面的选择。' : '各项任务独立选择，已有参数会保留。' }}</p>
    </div>
    <fieldset v-for="slot in slots" :key="slot" class="routing-dossier" :disabled="disabled" :data-model-slot="slot">
      <legend class="visually-hidden">{{ modelTaskLabels[slot] }}</legend>
      <div class="profile-face">
        <header class="profile-heading"><div><span class="archive-kicker">{{ slot === 'shared' ? 'WRITING / 创作模型' : 'TASK / 任务模型' }}</span><h4>{{ modelTaskLabels[slot] }}</h4></div><span class="profile-scope">{{ (slot === 'shared') !== (draft.routingMode === 'shared') ? '未启用 · 保留参数' : '本书专用' }}</span></header>
        <div class="model-choice-row">
          <ArchiveFormField label="模型型号"><ModelCatalogPicker empty-label="选择或填写模型型号" :choices="choices(slot)" :connections="connections(slot)" :model="draft.profiles[slot].model" :connection-id="connections(slot)[0]?.id" :label="`${modelTaskLabels[slot]}型号`" :test-id="`routing-model-${slot}`" :disabled="disabled || !source(slot) || source(slot)?.disabled" :allow-manual="source(slot)?.value !== 'local'" @select="selected(slot, $event)"/></ArchiveFormField>
          <ArchiveAction v-if="source(slot)?.value.startsWith('global:')" class="fetch-models" :disabled="disabled || Boolean(loading) || source(slot)?.disabled || !api" :data-testid="`fetch-models-${slot}`" @click="fetchModels(slot)">{{ loading === source(slot)?.value ? '正在获取…' : snapshot(slot) ? '刷新型号' : '获取型号' }}</ArchiveAction>
        </div>
        <div class="profile-source">
          <span class="source-caption">模型来源</span>
          <div v-if="enabledGlobals.length === 1 && source(slot)?.value === enabledGlobals[0].value && !chooseSource" class="single-source"><b>{{ source(slot)?.label }}</b><button type="button" :disabled="disabled" @click="chooseSource = true">切换来源 ↗</button></div>
          <select v-else :value="enabledGlobals.some(o => o.value === source(slot)?.value) ? source(slot)?.value : ''" :aria-label="`${modelTaskLabels[slot]}接口`" @change="changedSource(slot, $event)"><option value="" disabled>{{ draft.profiles[slot].selection ? (source(slot) && !source(slot)?.disabled ? '切换到全局接口' : '原选择不可用，请重新分配') : '请选择全局接口' }}</option><option v-for="option in enabledGlobals" :key="option.value" :value="option.value">{{ option.label }}</option></select>
        </div>
        <p v-if="draft.profiles[slot].selection && !enabledGlobals.some(o => o.value === draft.profiles[slot].selection)" class="catalog-note" role="status">当前来源：{{ source(slot)?.label ?? '原选择不可用，请重新分配' }}。{{ source(slot)?.value === 'local' ? '在本机运行，无需 API。' : '选择新接口并保存后才会更换。' }}</p>
        <p v-if="source(slot)?.value.startsWith('private:')" class="catalog-note">旧书私有配置，可在“整理旧配置”中转用已有全局接口。</p>
        <p v-if="snapshot(slot)" class="catalog-note" role="status">目录 {{ snapshot(slot)!.entries.length }} 个型号 · {{ new Date(snapshot(slot)!.fetchedAt).toLocaleString() }}</p>
        <p v-else-if="source(slot)?.value.startsWith('global:')" class="catalog-note">获取接口目录，或在选择窗口中手动填写型号。</p>
      </div>
      <div class="profile-settings">
        <p v-if="errors[source(slot)?.value ?? '']" class="error" role="alert">{{ errors[source(slot)?.value ?? ''].message }} 当前型号仍保留。</p>
        <div v-if="undo[slot]" class="selection-change" role="status"><span>型号或来源已变化，参数已切换为自动；保存后生效。</span><ArchiveAction :disabled="disabled" @click="draft.profiles[slot] = undo[slot]!; delete undo[slot]">撤销这次切换</ArchiveAction></div>
        <ModelParameterEditor v-if="draft.profiles[slot].model" :key="slot === 'shared' ? slot : `${slot}:${taskCopyVersion}`" v-model="draft.profiles[slot]" :target="target(slot)" :task="slot" :label="modelTaskLabels[slot]" :disabled="disabled"/>
        <p v-else class="routing-help">选定型号后，在这里查看和调整创作参数。</p>
      </div>
    </fieldset>
    <details class="routing-maintenance"><summary>更多分配操作</summary><label class="routing-help"><input v-model="showInactive" type="checkbox" :disabled="disabled"> 显示未启用的另一组分配（参数仍保留）</label><ArchiveAction :disabled="disabled" @click="copyToTasks">把统一选择复制到四项任务</ArchiveAction><p class="routing-help">复制会替换四项任务的草稿及其旧撤销记录，点击保存后生效。</p><div v-if="options.some(o => o.value === 'local')" class="local-routing"><p class="routing-help">本地推理 · 需先在本地模型页安装并启动模型。</p><ArchiveAction v-for="slot in slots" :key="slot" :disabled="disabled || draft.profiles[slot].selection === 'local'" :data-testid="`use-local-${slot}`" @click="useLocal(slot)">{{ modelTaskLabels[slot] }}改用本地模型</ArchiveAction></div></details>
  </div>
</template>
<style scoped>
.model-routing-form { display:grid; gap:16px; min-width:0; }
.routing-heading { display:flex; align-items:center; gap:20px; flex-wrap:wrap; }
.routing-mode { display:flex; border:1px solid var(--line-strong); padding:3px; background:var(--surface); }
.routing-mode label { position:relative; display:grid; gap:2px; padding:9px 20px; cursor:pointer; color:var(--muted); }
.routing-mode label.active { background:#26372d; color:#f5f3eb; box-shadow:inset 0 -2px #eaa247; }
.routing-mode span { font:600 14px/1.4 var(--sans); }.routing-mode small { font-size:11px; opacity:.8; }
.routing-mode input,.visually-hidden { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; border:0; }
.routing-mode label:has(input:focus-visible) { outline:2px solid var(--jade); outline-offset:3px; }
.routing-mode label:has(input:disabled) { opacity:.55; cursor:default; }
.routing-help { color:var(--muted); font-size:var(--form-help); line-height:1.7; margin:0; }.routing-help input { width:auto; min-height:auto; }
.routing-dossier { margin:0; border:1px solid var(--line-strong); padding:0; min-width:0; background:var(--surface); }
.profile-face { position:relative; padding:22px 24px 16px; color:#f5f3eb; background:linear-gradient(#c7d6cd08 1px,transparent 1px),linear-gradient(90deg,#c7d6cd08 1px,transparent 1px),linear-gradient(115deg,#303d37,#19241f 75%); background-size:48px 48px,48px 48px,auto; border:4px double #809d8c; }
.profile-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:18px; padding-left:12px; border-left:3px solid #eaa247; }
.archive-kicker { color:#ecb365; font:10px/1.5 var(--sans); letter-spacing:.14em; }
.profile-heading h4 { margin:4px 0 0; color:#f5f3eb; font:600 24px/1.2 var(--serif); }
.profile-scope { color:#c5d0c7; padding:4px 8px; border:1px solid #a2b8a849; font-size:11px; white-space:nowrap; }
.model-choice-row { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:end; gap:12px; }
.model-choice-row :deep(.archive-field-label) { color:#c5d0c7; font-size:11px; }
.model-choice-row :deep(.model-catalog-trigger) { min-height:66px; padding:12px 16px; border:1px solid #899f90; border-radius:0; background:#f2f0e8; color:#202c25; }
.model-choice-row :deep(.model-trigger-copy b) { font-size:21px; line-height:1.25; white-space:normal; overflow-wrap:anywhere; }
.model-choice-row :deep(.model-trigger-copy small) { color:#58665d; font-size:11px; }
.model-choice-row :deep(.model-family-mark) { border-radius:0; background:#e1e8de; border-color:#a5b4a6; color:#355f4b; }
.model-choice-row :deep(.model-trigger-chevron) { color:#385c48; }
.model-choice-row :deep(.model-catalog-label) { display:none; }
.model-choice-row :deep(.model-catalog-trigger:focus-visible) { outline-color:#eaa247; outline-offset:3px; }
.model-routing-form .model-choice-row button.fetch-models.archive-action { min-height:44px; margin-bottom:11px; color:#f5f3eb; background:#c5d8cb12; border-color:#91aa9966; border-radius:0; }
.model-routing-form .model-choice-row button.fetch-models.archive-action:hover:not(:disabled) { background:#c5d8cb24; color:#f5f3eb; border-color:#91aa99; }
.profile-source { display:flex; gap:12px; align-items:center; margin-top:16px; padding-top:12px; border-top:1px solid #a2b8a836; min-width:0; }
.source-caption { flex:none; color:#b2c2b7; font-size:12px; }
.single-source { flex:1; display:flex; flex-wrap:wrap; align-items:center; gap:8px 16px; min-width:0; }
.single-source b { font:500 13px/1.5 var(--sans); overflow-wrap:anywhere; }.single-source button { margin-left:auto; border:0; padding:4px 0; color:#b4dac6; background:none; font:12px var(--sans); cursor:pointer; }
.profile-source select { min-width:0; flex:1; min-height:34px; padding:6px 8px; border:1px solid #91aa9966; border-radius:0; color:#f5f3eb; background:#293b30; font:13px var(--sans); }
.catalog-note { margin:8px 0 0; color:#b2c2b7; font:11px/1.6 var(--sans); }
.profile-settings { display:grid; gap:12px; padding:18px 24px; }
.profile-settings :deep(.parameter-editor) { border:0; padding:0; gap:8px; }
.profile-settings :deep(.parameter-mode) { gap:12px 22px; }
.profile-settings :deep(.parameter-mode > :first-child) { min-width:160px; }
.profile-settings :deep(.parameter-mode select) { border-radius:0; min-height:36px; padding:6px 10px; }
.profile-settings :deep(.parameter-mode p) { font-size:12px; }
.profile-settings :deep(.budget-summary) { padding:10px 0 0; border-top:1px solid var(--line); }
.profile-settings :deep(.budget-summary strong) { font-size:20px; font-weight:500; }
.profile-settings :deep(.parameter-note) { font-size:12px; }
.profile-settings :deep(.parameter-details) { padding:4px 0 0; font-size:12px; }
.selection-change { display:flex; flex-wrap:wrap; gap:12px; align-items:center; border-left:3px solid var(--jade); padding-left:12px; font-size:var(--form-help); }.error { color:var(--danger); margin:0; }
.routing-maintenance { color:var(--muted); font-size:var(--form-help); }.routing-maintenance summary { cursor:pointer; padding:4px 0; }.routing-maintenance > :not(summary) { display:block; margin-top:12px; }
:is(select,button,summary):focus-visible { outline:2px solid var(--jade); outline-offset:2px; }
.profile-face :is(select,button):focus-visible { outline-color:#eaa247; }
@container (max-width:600px) { .profile-face { padding:16px; }.profile-settings { padding:16px 20px; }.routing-heading { gap:10px; }.routing-heading > .routing-help { display:none; }.routing-mode { width:100%; }.routing-mode label { flex:1; padding:8px 12px; }.profile-heading h4 { font-size:21px; }.model-choice-row { gap:8px; }.model-choice-row :deep(.model-trigger-copy b) { font-size:17px; }.model-choice-row :deep(.model-catalog-trigger) { padding:10px; }.model-routing-form .model-choice-row button.fetch-models.archive-action { font-size:12px; } }
@container (max-width:380px) { .model-choice-row { grid-template-columns:minmax(0,1fr); }.model-routing-form .model-choice-row button.fetch-models.archive-action { margin:0; justify-self:start; }.profile-source { flex-wrap:wrap; } }
</style>
