<script setup lang="ts">
import { pluginError } from '../plugin-error'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import ArchiveAction from '../../../ui/ArchiveAction.vue'
import PluginWorkflowEditor from './PluginWorkflowEditor.vue'
import { contributionLimits, pluginCategories, validatePluginPath, validatePluginTags, writingStages, type WritingStage } from '@lanjian/writing-plugin-contracts'
import type { PluginDraft, DraftBuild } from '../../../../contracts/writing-plugins/authoring'
import type { WritingPluginsApi, PluginInstallPreview } from '../../../../contracts/writing-plugins/management-contracts'
import type { PublishPreview } from '../../../../contracts/writing-plugins/marketplace'
import { acceptDraftMerge, draftDirty, draftSession, saveDraftSession } from '../draft-session'
import { addDraftGuidance, editableDraftManifest, removeDraftGuidance, restoreDraftGuidance, type RemovedGuidance } from '../draft-manifest'
import { stageLabels } from '../plugin-labels'

const props = defineProps<{ draft: PluginDraft; api: WritingPluginsApi; active?: boolean }>()
const emit = defineEmits<{ saved: [draft: PluginDraft]; preview: [preview: PluginInstallPreview] }>()
const session = draftSession(props.draft), busy = ref(false), error = ref(''), notice = ref(''), build = ref<DraftBuild | null>(null)
const assetPath = ref(''), publishPreview = ref<PublishPreview | null>(null), exportPreview = ref(false)
const buildReview = ref<HTMLElement | null>(null)
const errorPanel = ref<HTMLElement | null>(null)
const guidanceEditor = ref<HTMLElement | null>(null), removedGuidance = ref<RemovedGuidance | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined, alive = true
const manifest = computed(() => editableDraftManifest(session.draft.manifestText))
const tagsText = ref(manifest.value?.tags?.join('，') ?? '')
const parseTags = (text: string) => text.split(/[,，]/).map(tag => tag.trim()).filter(Boolean)
const tagsInvalid = computed(() => { try { validatePluginTags(manifest.value?.tags ?? []); return false } catch { return true } })
// Keep the author's separators while typing. Only an actual source/external
// tag change should replace the field with its manifest representation.
watch(() => JSON.stringify(manifest.value?.tags), () => {
  if (!manifest.value) return
  const tags = manifest.value.tags ?? []
  if (JSON.stringify(tags) !== JSON.stringify(parseTags(tagsText.value))) tagsText.value = tags.join('，')
})
const workflowFile = computed(() => manifest.value?.runtime === 'declarative' ? session.draft.files.find(f => f.path === manifest.value?.entry) : undefined)
const dirty = computed(() => draftDirty(session)), reference = () => ({ id: session.draft.id, revision: session.draft.revision })
const contexts = computed(() => manifest.value?.contributions?.filter(c => c.kind === 'context-fragment') ?? [])
const guidanceFull = computed(() => (manifest.value?.contributions?.length ?? 0) >= contributionLimits.count)
const newerSavedVersion = computed(() => props.draft.revision > session.draft.revision)
// A model/tool may save this same draft while the editor stays mounted. Only a
// clean, idle session can receive that newer revision; local input always wins.
watch([() => props.draft, dirty, () => session.saving, () => session.composing], () => {
  const revision = session.draft.revision
  draftSession(props.draft)
  if (session.draft.revision !== revision) removedGuidance.value = null
})
async function save() { clearTimeout(timer); await saveDraftSession(session, props.api); if (alive) emit('saved', JSON.parse(JSON.stringify(session.draft))) }
async function saveMergedDraft() {
  if (busy.value || session.saving || session.composing) return
  try { acceptDraftMerge(session, props.draft); await act('save') }
  catch (cause) { error.value = pluginError(cause, '合并未完成，当前输入已保留。') }
}
watch(() => JSON.stringify([session.draft.manifestText, session.draft.files]), () => {
  build.value = null; exportPreview.value = false; publishPreview.value = null; notice.value = ''; clearTimeout(timer)
  if (!session.composing) timer = setTimeout(() => { void save().catch(() => {}) }, 700)
})
function compositionEnd() { session.composing = false; clearTimeout(timer); timer = setTimeout(() => { void save().catch(() => {}) }, 200) }
function setField(name: string, value: unknown) {
  if (!manifest.value) return
  session.draft.manifestText = JSON.stringify({ ...manifest.value, [name]: value }, null, 2)
}
function setTags(text: string) { tagsText.value = text; setField('tags', parseTags(text)) }
function setContext(id: string, patch: { name?: string; text?: string; stages?: WritingStage[] }) {
  setField('contributions', manifest.value?.contributions?.map(c => c.kind === 'context-fragment' && c.id === id ? { ...c, ...patch } : c))
}
function toggleStage(id: string, stage: WritingStage) {
  const context = contexts.value.find(c => c.id === id)
  if (!context || (context.stages.includes(stage) && context.stages.length === 1)) return
  setContext(id, { stages: context.stages.includes(stage) ? context.stages.filter(s => s !== stage) : [...context.stages, stage] })
}
async function changeGuidance(action: 'add' | 'copy' | 'remove' | 'undo', id?: string) {
  if (!manifest.value || busy.value || session.composing) return
  error.value = ''; let focusId: string | undefined
  try {
    if (action === 'add' || action === 'copy') {
      const result = addDraftGuidance(manifest.value, action === 'copy' ? id : undefined, removedGuidance.value?.contribution.id)
      session.draft.manifestText = JSON.stringify(result.manifest, null, 2); focusId = result.id
    } else if (action === 'remove' && id) {
      const result = removeDraftGuidance(manifest.value, id)
      removedGuidance.value = result.removed; session.draft.manifestText = JSON.stringify(result.manifest, null, 2)
    } else if (action === 'undo' && removedGuidance.value) {
      focusId = removedGuidance.value.contribution.id
      session.draft.manifestText = JSON.stringify(restoreDraftGuidance(manifest.value, removedGuidance.value), null, 2); removedGuidance.value = null
    }
    await nextTick()
    if (!alive) return
    const row = Array.from(guidanceEditor.value?.querySelectorAll<HTMLElement>('[data-contribution-id]') ?? []).find(el => el.dataset.contributionId === focusId)
    const target = row?.querySelector<HTMLInputElement>('input') ?? guidanceEditor.value?.querySelector<HTMLButtonElement>('[data-guidance-undo]') ?? guidanceEditor.value?.querySelector<HTMLButtonElement>('[data-guidance-add]')
    target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'nearest' })
  } catch (cause) { error.value = pluginError(cause, '指导修改未完成，已有内容已保留。') }
}
function addAsset() {
  try {
    const path = validatePluginPath(assetPath.value)
    if (!manifest.value || path.toLowerCase() === 'lanjian-plugin.json' || session.draft.files.some(f => f.path.toLowerCase() === path.toLowerCase())) throw new Error()
    setField('assets', [...manifest.value.assets ?? [], path]); session.draft.files.push({ path, content: '' }); assetPath.value = ''; error.value = ''
  } catch { error.value = '请输入未被使用的包内相对文件名，例如 guidance.txt。' }
}
function removeAsset(path: string) { if (manifest.value && path !== manifest.value.entry) { setField('assets', manifest.value.assets?.filter(p => p !== path) ?? []); session.draft.files = session.draft.files.filter(f => f.path !== path) } }
async function act(kind: 'save' | 'validate' | 'build' | 'preview' | 'import' | 'publish-preview' | 'publish' | 'export-preview' | 'export') {
  if (busy.value || session.composing) return
  busy.value = true; error.value = ''; notice.value = ''
  try {
    await save(); if (dirty.value || !alive) return
    if (kind === 'publish-preview') { const result = await props.api.previewPublish(reference()); if (alive) publishPreview.value = result }
    else if (kind === 'publish') { const plan = publishPreview.value; publishPreview.value = null; if (!plan) return; const release = await props.api.publish(plan.planId); if (alive) notice.value = release.state === 'published' ? '自动校验通过，版本已公开。' : release.state === 'validation-failed' ? '市场校验失败，版本未公开。请检查发布记录。' : '已提交，稍后可在插件市场查询状态。' }
    else if (kind === 'validate' || kind === 'build' || kind === 'export-preview') {
      const result = await (kind === 'build' ? props.api.buildDraft(reference()) : props.api.validateDraft(reference()))
      if (alive) {
        build.value = result; exportPreview.value = kind === 'export-preview'
        notice.value = kind === 'build' ? '版本已构建，后续修改需要新版本号。' : kind === 'validate' ? '包格式校验通过。' : ''
        if (exportPreview.value) { await nextTick(); buildReview.value?.focus(); buildReview.value?.scrollIntoView({ block: 'nearest' }) }
      }
    }
    else if (kind === 'export') {
      const reviewed = build.value
      if (!reviewed || !exportPreview.value) return
      const result = await props.api.exportDraft({ id: reviewed.draftId, revision: reviewed.revision, digest: reviewed.digest })
      if (alive) { notice.value = result ? `已导出 ${result.fileName}。可通过“安装插件包”使用；后续修改需要新版本号。` : '已取消导出，草稿已保留。'; if (result) exportPreview.value = false }
    }
    else if (kind === 'preview') { const result = await props.api.previewDraft(reference()); if (alive) emit('preview', result) }
    else if (kind === 'import') { const result = await props.api.importDraftSource(reference()); if (result && alive) { draftSession(result); emit('saved', result); notice.value = 'JavaScript 已导入并保存。' } }
    else notice.value = '草稿已保存。'
  } catch (cause) {
    if (alive) {
      error.value = pluginError(cause, '操作未完成，草稿已保留。')
      await nextTick()
      if (alive) { errorPanel.value?.focus({ preventScroll: true }); errorPanel.value?.scrollIntoView({ block: 'nearest' }) }
    }
  }
  finally { if (alive) busy.value = false }
}
// Navigation may hide or remove an input before compositionend. Text bindings already
// retain its actual value; release only this editor's IME lock and use the same
// serialized save lane. Failed saves keep the session dirty and recoverable.
function flushOnDeparture() { clearTimeout(timer); session.composing = false; void save().catch(() => {}) }
watch(() => props.active, active => { if (active === false) flushOnDeparture() })
onBeforeUnmount(() => { alive = false; flushOnDeparture() })
</script>

<template>
  <article class="draft-editor" data-testid="plugin-draft-editor" :aria-busy="busy" @compositionstart="session.composing = true" @compositionend="compositionEnd">
    <header><div><p class="eyebrow">我的创作工具 · 本地草稿</p><h3>{{ manifest?.name || '编辑插件' }}</h3></div><span role="status">{{ session.saving ? '正在保存…' : dirty ? '尚未保存' : '已保存' }}</span></header>
    <p class="muted">先保存与校验，再构建版本。试用会打开安装预览，安装后仍需选择权限和使用作品。</p>
    <p v-if="session.draft.upstream" class="muted">派生自 {{ session.draft.upstream.pluginId }} · {{ session.draft.upstream.version }}；这是具有新身份的个人插件。</p>
    <p v-if="session.error || error" ref="errorPanel" role="alert" tabindex="-1" class="error">{{ session.error || error }} 输入已保留，可修正后再次保存。</p>
    <p v-if="notice" role="status" class="notice">{{ notice }}</p>
    <details v-if="newerSavedVersion" class="external-draft"><summary>已保存草稿有新版本 · 当前输入已保留</summary><p class="muted">当前有未保存修改或正在输入，未自动替换。以下是已保存内容，请先与编辑器内容核对、合并。</p><pre>{{ draft.manifestText }}</pre><details v-for="file in draft.files" :key="file.path"><summary>{{ file.path }}</summary><pre>{{ file.content }}</pre></details><p class="muted">确认后，将以编辑器当前的完整清单和源文件更新这份草稿。</p><ArchiveAction :disabled="busy || session.saving || session.composing" @click="saveMergedDraft">确认保存合并后的内容</ArchiveAction></details>
    <fieldset :disabled="busy">
      <div v-if="manifest" class="metadata">
        <label>插件名称<input aria-label="插件名称" :value="manifest.name" maxlength="100" @input="setField('name', ($event.target as HTMLInputElement).value)" /></label>
        <label>版本号<input aria-label="插件版本号" :value="manifest.version" maxlength="40" @input="setField('version', ($event.target as HTMLInputElement).value)" /></label>
        <label class="wide">简介<textarea :value="manifest.description" rows="2" maxlength="2000" @input="setField('description', ($event.target as HTMLTextAreaElement).value)" /></label>
        <label>类别（可多选）<select aria-label="草稿类别" multiple :value="manifest.categoryIds" @change="setField('categoryIds', Array.from(($event.target as HTMLSelectElement).selectedOptions).map(o => o.value))"><option v-for="category in pluginCategories" :key="category.categoryId" :value="category.categoryId">{{ category.name }}</option><option v-for="id in (manifest.categoryIds ?? []).filter(id => !pluginCategories.some(c => c.categoryId === id))" :key="id" :value="id">扩展分类 · {{ id }}</option></select></label>
        <label>标签（逗号分隔）<input aria-label="标签（逗号分隔）" :value="tagsText" :aria-invalid="tagsInvalid" :aria-describedby="tagsInvalid ? 'plugin-tags-error' : undefined" @input="setTags(($event.target as HTMLInputElement).value)" /><span v-if="tagsInvalid" id="plugin-tags-error" class="error" role="status">标签不能重复或含空白项、换行，每个最多 40 个字符，共最多 24 个。当前输入已保留，请修正后再校验。</span></label>
      </div>
      <section v-if="manifest" ref="guidanceEditor" class="guidance-editor" aria-label="写作指导">
        <div class="guidance-heading"><div><h4>写作指导 <span class="muted">{{ contexts.length }} 条</span></h4><p class="muted">逐条调整写作方法与适用阶段。安装后，在本书写作组合中选用才会生效。</p></div><ArchiveAction compact data-guidance-add :disabled="busy || session.composing || guidanceFull" @click="changeGuidance('add')">添加写作指导</ArchiveAction></div>
        <p v-if="!contexts.length" class="muted">还没有写作指导。可以为这个插件添加题材规则、文风要求或检查要点。</p>
        <p v-if="guidanceFull" class="muted">已达到 {{ contributionLimits.count }} 项贡献上限，工具引用等贡献也计入。</p>
        <div v-if="removedGuidance" class="guidance-removed" role="status"><span>已移除“{{ removedGuidance.contribution.name || '未命名指导' }}”。</span><ArchiveAction compact data-guidance-undo :disabled="busy || session.composing" @click="changeGuidance('undo')">撤销移除</ArchiveAction></div>
        <section v-for="(context, index) in contexts" :key="context.id" class="guidance-entry" :data-contribution-id="context.id">
          <div class="guidance-actions"><ArchiveAction compact :disabled="busy || session.composing || guidanceFull" :aria-label="`复制指导 ${index + 1}`" @click="changeGuidance('copy', context.id)">复制</ArchiveAction><ArchiveAction compact :disabled="busy || session.composing" :aria-label="`移除指导 ${index + 1}`" @click="changeGuidance('remove', context.id)">移除</ArchiveAction></div>
          <label>指导 {{ index + 1 }} · 名称<input :aria-label="`指导 ${index + 1} 名称`" :value="context.name" maxlength="100" @input="setContext(context.id, { name: ($event.target as HTMLInputElement).value })" /></label>
          <fieldset class="guidance-stages"><legend>适用阶段 <span class="muted">至少选择一个</span></legend><div><label v-for="stage in writingStages" :key="stage"><input type="checkbox" :checked="context.stages.includes(stage)" :disabled="context.stages.length === 1 && context.stages.includes(stage)" @change="toggleStage(context.id, stage)" />{{ stageLabels[stage] }}</label></div></fieldset>
          <label>指导内容<textarea :aria-label="`写作指导 ${index + 1}`" :value="context.text" rows="5" maxlength="12000" @input="setContext(context.id, { text: ($event.target as HTMLTextAreaElement).value })" /></label>
        </section>
      </section>
      <PluginWorkflowEditor v-if="manifest && workflowFile" :text="workflowFile.content" :manifest="manifest" :disabled="busy" :composing="session.composing" @update:text="workflowFile.content = $event" />
      <details :open="!manifest"><summary>高级清单 · 工具、能力与贡献</summary><p class="muted">身份由应用创建，不能改成已有插件。可以增加类别、标签、工具及贡献；未通过校验的文字也可保存。</p><textarea :value="session.draft.manifestText" @input="session.draft.manifestText = ($event.target as HTMLTextAreaElement).value" aria-label="插件清单" class="code" rows="16" spellcheck="false" /></details>
      <details><summary>源文件与附带资料（{{ session.draft.files.length }}）</summary><label v-for="file in session.draft.files" :key="file.path">{{ file.path }}<textarea :value="file.content" @input="file.content = ($event.target as HTMLTextAreaElement).value" :aria-label="`插件源文件 ${file.path}`" class="code" rows="12" spellcheck="false" /><ArchiveAction v-if="manifest?.assets?.includes(file.path)" :disabled="busy || session.composing" @click="removeAsset(file.path)">移除此附带资料</ArchiveAction></label><label>新增附带资料<input v-model="assetPath" aria-label="附带资料文件名" placeholder="guidance.txt" /></label><ArchiveAction :disabled="busy || session.composing || !assetPath" @click="addAsset">添加资料文件</ArchiveAction><p class="muted">代码以 JavaScript 模块导出 execute；提问后的继续执行导出 resume。源码只在插件隔离环境中运行。</p><ArchiveAction v-if="manifest?.runtime === 'quickjs-js'" :disabled="busy || session.composing" @click="act('import')">导入已编译 JavaScript</ArchiveAction></details>
    </fieldset>
    <div class="actions"><ArchiveAction :disabled="busy || session.composing" @click="act('save')">保存草稿</ArchiveAction><ArchiveAction :disabled="busy || session.composing" @click="act('validate')">校验</ArchiveAction><ArchiveAction :disabled="busy || session.composing" @click="act('build')">构建版本</ArchiveAction><ArchiveAction variant="primary" :disabled="busy || session.composing" @click="act('preview')">安装试用</ArchiveAction><ArchiveAction :disabled="busy || session.composing" @click="act('export-preview')">导出插件包</ArchiveAction><ArchiveAction :disabled="busy || session.composing" @click="act('publish-preview')">预览发布到市场</ArchiveAction></div>
    <section v-if="publishPreview" class="build" data-testid="plugin-publish-preview"><h4>发布前核对 · {{ publishPreview.request.manifest.name }} {{ publishPreview.request.manifest.version }}</h4><p>仅上传以下包文件和插件资料。提交后，自动校验通过即向其他作者公开。</p><p>{{ publishPreview.request.manifest.description }}</p><details><summary>完整发布清单</summary><pre class="code">{{ JSON.stringify(publishPreview.request.manifest, null, 2) }}</pre></details><ul><li v-for="file in publishPreview.build.files" :key="file.path">{{ file.path }} · {{ file.bytes }} 字节</li></ul><code>{{ publishPreview.request.digest }}</code><p>类别：{{ publishPreview.request.manifest.categoryIds?.join(' · ') }}；能力：{{ publishPreview.request.manifest.capabilities.join(' · ') || '无' }}</p><div class="actions"><ArchiveAction :disabled="busy" @click="publishPreview = null">取消发布</ArchiveAction><ArchiveAction variant="primary" :disabled="busy || dirty || session.composing" @click="act('publish')">提交并在校验通过后公开</ArchiveAction></div></section>
    <section v-if="build" class="build" data-testid="plugin-build-review"><h4 ref="buildReview" tabindex="-1">{{ exportPreview ? '导出前核对' : '本次包内容' }} · {{ build.manifest.name }} {{ build.manifest.version }}</h4><p v-if="exportPreview" class="muted">保存为 ZIP 插件包，可离线分享与安装。导出后，这个版本的内容将固定；继续修改请使用新版本号。</p><details><summary>完整插件清单</summary><pre class="code">{{ JSON.stringify(build.manifest, null, 2) }}</pre></details><ul><li v-for="file in build.files" :key="file.path">{{ file.path }} · {{ file.bytes }} 字节</li></ul><code>{{ build.digest }}</code><div v-if="exportPreview" class="actions"><ArchiveAction :disabled="busy" @click="exportPreview = false">取消导出</ArchiveAction><ArchiveAction variant="primary" :disabled="busy || dirty || session.composing" @click="act('export')">选择位置并导出</ArchiveAction></div></section>
  </article>
</template>

<style scoped>
.guidance-heading,.guidance-removed{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.guidance-heading>div{flex:1;min-width:180px}.guidance-actions{display:flex;justify-content:flex-end;gap:8px}.guidance-removed{font-size:13px;color:var(--jade);background:var(--paper);padding:10px 12px}.external-draft pre{max-height:240px;overflow:auto;font-size:12px}
.guidance-editor,.guidance-entry{display:grid;gap:14px;min-width:0}.guidance-entry{border-top:1px solid var(--line);padding-top:14px}.guidance-stages legend{font-size:13px;padding:0;margin-bottom:8px}.guidance-stages>div{display:flex;gap:10px 20px;flex-wrap:wrap}.guidance-stages label{display:flex;align-items:center;gap:6px}.guidance-stages input{width:auto;accent-color:var(--jade)}
.draft-editor{border:1px solid var(--line);background:var(--surface);padding:22px;display:grid;gap:14px;min-width:0}.draft-editor header{display:flex;justify-content:space-between;gap:16px;align-items:start}.eyebrow{color:var(--jade);font-size:12px;letter-spacing:.08em;margin:0 0 6px}h3,h4,p{margin:0}.muted,header>span{color:var(--ink-muted);font-size:13px;line-height:1.7}fieldset{border:0;padding:0;margin:0;min-width:0;display:grid;gap:16px}.metadata{align-items:start;display:grid;grid-template-columns:2fr 1fr;gap:14px}.wide{grid-column:1/-1}label{display:grid;gap:6px;font-size:13px;min-width:0}input,textarea,select{box-sizing:border-box;min-width:0;width:100%;border:1px solid var(--line);border-radius:4px;padding:9px;background:var(--surface);color:var(--ink);font:inherit}textarea{resize:vertical;line-height:1.6}.code{font-family:ui-monospace,monospace;font-size:12px}details{border-top:1px solid var(--line);padding-top:12px;min-width:0}summary{cursor:pointer;font-size:13px;margin-bottom:10px}.actions{display:flex;gap:8px;flex-wrap:wrap}.build pre{max-height:280px;overflow:auto}.build .actions{margin-top:12px}.build{border-left:2px solid var(--jade);padding-left:14px;min-width:0}pre{white-space:pre-wrap;overflow-wrap:anywhere}code{font-size:11px;overflow-wrap:anywhere}.error{color:var(--danger,#b74536)}.notice{color:var(--jade)}:focus-visible{outline:2px solid var(--jade);outline-offset:2px}@media(max-width:780px){.metadata{grid-template-columns:1fr}.wide{grid-column:auto}.draft-editor{padding:14px}}
</style>
