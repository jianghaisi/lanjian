<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import type { ModelConnectionsApi, ModelDefaultsView, BookModelsView, BookModelsSaved, DefaultApplicationPreview, ModelProbeResult } from '../../../../contracts/models/model-connections-contracts'
import type { GlobalConnectionsView, GlobalConnectionView, RemoteModelProtocol } from '../../../../contracts/models/model-connections'
import type { LegacyReusePreview } from '../../../../contracts/models/legacy-connection-reuse'
import { routingDraft, compileRouting } from '../services/model-connections-state'
import ArchiveAction from '../../../ui/ArchiveAction.vue'
import ArchiveFormField from '../../../ui/ArchiveFormField.vue'
import ModelRoutingForm from './ModelRoutingForm.vue'
const props = withDefaults(defineProps<{ api: ModelConnectionsApi; bookAvailable?: boolean; page?: 'connection' | 'routing' }>(), { page: 'connection' })
const emit = defineEmits<{ changed: []; dirty: [value: boolean] }>()
const catalog = ref<GlobalConnectionsView | null>(null), defaults = ref<ModelDefaultsView | null>(null), book = ref<BookModelsView | null>(null)
const defaultDraft = ref(routingDraft(null)), bookDraft = ref(routingDraft(null)), defaultsOpen = ref(false)
const defaultBaseline = ref(''), bookBaseline = ref(''), defaultEdited = ref(false)
const selected = ref<GlobalConnectionView | null>(null), form = ref<{ name: string; baseUrl: string; protocol: RemoteModelProtocol; apiKey: string; clearApiKey: boolean }>({ name: '', baseUrl: '', protocol: 'openai-compatible', apiKey: '', clearApiKey: false })
const formBaseline = ref(JSON.stringify(form.value)), showForm = ref(false)
const privateForm = ref<{ id: string; name: string; originalName: string; apiKey: string; clearApiKey: boolean } | null>(null)
const pending = ref(false), error = ref(''), message = ref(''), probeModel = ref(''), probe = ref<ModelProbeResult | null>(null)
const reusePreview = ref<LegacyReusePreview | null>(null), applyPreview = ref<DefaultApplicationPreview | null>(null), reuseIds = ref<string[]>([])
let generation = 0
const dirty = computed(() => (showForm.value && JSON.stringify(form.value) !== formBaseline.value)
  || Boolean(privateForm.value && (privateForm.value.name !== privateForm.value.originalName || privateForm.value.apiKey || privateForm.value.clearApiKey))
  || (defaultEdited.value && JSON.stringify(defaultDraft.value) !== defaultBaseline.value)
  || Boolean(book.value && JSON.stringify(bookDraft.value) !== bookBaseline.value))
watch(dirty, value => emit('dirty', value))
const privateConnections = computed(() => !book.value ? [] : book.value.settings.version === 4
  ? book.value.settings.references.flatMap(r => r.kind === 'legacy-private' ? [{ id: r.id, originalId: r.originalConnectionId, name: r.name, baseUrl: r.baseUrl }] : [])
  : book.value.settings.connections.map(c => ({ ...c, originalId: c.id })))
const globalOptions = computed(() => [
  ...(catalog.value?.connections.map(c => ({ value: `global:${c.id}`, label: `${c.name} · 全局${c.enabled ? '' : ' · 已停用'}`, disabled: !c.enabled })) ?? []),
  { value: 'local', label: '本地推理 · 无需密钥' }
])
const bookOptions = computed(() => [...globalOptions.value, ...privateConnections.value.map(c => ({ value: `private:${c.id}`, label: `${c.name} · 仅本书` }))])
const credentialLabel = (c: GlobalConnectionView) => c.credentialState === 'stored' ? '密钥已存储 · 尚不代表连接可用' : c.credentialState === 'missing' ? '未配置密钥' : '系统解密暂不可用'
const protocolLabel = (protocol: RemoteModelProtocol) => protocol === 'gemini-native' ? 'Gemini 原生协议' : 'OpenAI 兼容协议'
const endpointHelp = computed(() => form.value.protocol === 'gemini-native'
  ? '填写服务根地址，例如 https://zzshu.cc；不要附加 /v1。保存后协议和地址不可修改。'
  : '通常填写以 /v1 结尾的 OpenAI 兼容地址。保存后协议和地址不可修改。')
function savedMessage(result: BookModelsSaved, action: string) {
  if (result.authority === 'files') return `${action}已保存到本书文件。其他作品保持不变。`
  const mirror = { synced: '可读镜像已同步。', pending: '可读镜像待同步，请到项目数据核对。', conflict: '可读镜像有外部修改，原文件已保留，请到项目数据核对。', failed: '镜像同步失败，正式结果已保存，请到项目数据重试。', 'not-applicable': '' }[result.mirrorStatus]
  return `${action}已保存到正式数据库。${mirror}`
}

async function run(work: () => Promise<void>) {
  if (pending.value) return
  const request = generation; pending.value = true; error.value = ''; message.value = ''
  try { await work() }
  catch (cause) { if (request === generation) error.value = cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : '操作未完成，请检查后重试；输入已保留。' }
  finally { if (request === generation) pending.value = false }
}
async function loadBook() {
  if (!props.bookAvailable) return
  const request = generation, value = await props.api.book()
  if (request !== generation) return
  book.value = value; bookDraft.value = routingDraft(value.settings); bookBaseline.value = JSON.stringify(bookDraft.value)
}
async function load() {
  const request = generation
  await run(async () => {
    const c = await props.api.list(); if (request !== generation) return; catalog.value = c
    const d = await props.api.defaults(); if (request !== generation) return
    defaults.value = d; defaultDraft.value = routingDraft(d.template); defaultBaseline.value = JSON.stringify(defaultDraft.value); defaultEdited.value = false
    await loadBook()
  })
}
function editConnection(c?: GlobalConnectionView) {
  if (showForm.value && JSON.stringify(form.value) !== formBaseline.value) { error.value = '当前接口还有未保存的输入，请先保存或取消编辑。'; return }
  selected.value = c ? { ...c } : null
  form.value = { name: c?.name ?? '', baseUrl: c?.baseUrl ?? '', protocol: c?.protocol ?? 'openai-compatible', apiKey: '', clearApiKey: false }
  formBaseline.value = JSON.stringify(form.value); showForm.value = true; probe.value = null
}
function cancelEdit() { form.value.apiKey = ''; form.value.clearApiKey = false; showForm.value = false; formBaseline.value = JSON.stringify(form.value) }
async function saveConnection() {
  await run(async () => {
    if (!catalog.value) throw Error('请先读取接口库。')
    const change = { ...form.value }, current = selected.value, revision = catalog.value.revision
    if (!change.name.trim() || !change.baseUrl.trim()) throw Error('请填写接口名称和服务地址。')
    const key = change.apiKey.trim() ? { apiKey: change.apiKey } : change.clearApiKey ? { clearApiKey: true } : {}
    catalog.value = current ? await props.api.update({ expectedRevision: revision, id: current.id, connectionRevision: current.revision, name: change.name, ...key })
      : await props.api.create({ expectedRevision: revision, name: change.name, baseUrl: change.baseUrl, protocol: change.protocol, ...(change.apiKey.trim() ? { apiKey: change.apiKey } : {}) })
    cancelEdit(); message.value = '全局接口已保存。其他书的型号和任务参数没有改变。'; emit('changed')
  })
}
async function toggle(c: GlobalConnectionView) {
  await run(async () => { catalog.value = await props.api.update({ expectedRevision: catalog.value!.revision, id: c.id, connectionRevision: c.revision, enabled: !c.enabled }); probe.value = null; message.value = c.enabled ? '已停用。所有引用它的书将停止新的模型请求，正文仍可编辑。' : '已恢复接口；没有自动发起模型请求。'; emit('changed') })
}
async function test(c: GlobalConnectionView, catalogOnly = false) {
  await run(async () => {
    probe.value = null
    const request = generation
    if (!probeModel.value.trim()) throw Error('请填写用于测试的模型型号；不会自动猜测或更换型号。')
    const input = { id: c.id, revision: c.revision, model: probeModel.value.trim() }
    const result = await (catalogOnly ? props.api.catalog(input) : props.api.test(input))
    if (request !== generation) return
    probe.value = result; message.value = result.message
  })
}
async function saveDefault(clear = false) {
  await run(async () => {
    if (!defaults.value || !catalog.value) throw Error('请先重新读取默认分配。')
    const template = clear ? null : compileRouting(defaultDraft.value, catalog.value).template
    defaults.value = await props.api.saveDefaults({ expectedRevision: defaults.value.revision, expectedCatalogRevision: catalog.value.revision, template })
    defaultDraft.value = routingDraft(defaults.value.template); defaultBaseline.value = JSON.stringify(defaultDraft.value); defaultEdited.value = false
    message.value = clear ? '已清空新书默认。已有作品保持不变。' : '默认分配已保存，只影响之后新建的作品。'
    try { catalog.value = await props.api.list() } catch { error.value = '默认分配已保存，但接口库刷新失败，请重新读取后再编辑。' }
  })
}
async function saveBook() {
  await run(async () => {
    if (!book.value || !catalog.value) throw Error('请先读取本书分配。')
    const result = await props.api.saveBook({ token: book.value.token, patch: compileRouting(bookDraft.value, catalog.value, book.value.settings).patch })
    bookDraft.value = routingDraft(result.settings); bookBaseline.value = JSON.stringify(bookDraft.value)
    message.value = savedMessage(result, '本书模型分配')
    await refreshAfterCommit(); emit('changed')
  })
}
async function previewDefaults() { await run(async () => { if (!book.value || !defaults.value) throw Error('请先读取分配。'); applyPreview.value = await props.api.previewApply({ bookRevision: book.value.revision, defaultRevision: defaults.value.revision }) }) }
async function refreshAfterCommit() { try { await loadBook() } catch { if (book.value) book.value.token = ''; error.value = '保存已经成功，但后续读取失败；请重新读取后再编辑。' } }
async function confirmDefaults() { await run(async () => { if (!applyPreview.value) return; const result = await props.api.confirmApply(applyPreview.value.token); applyPreview.value = null; message.value = savedMessage(result, '应用的默认分配'); await refreshAfterCommit(); emit('changed') }) }
async function previewReuse() { await run(async () => { if (!catalog.value || !reuseIds.value.length) throw Error('请先勾选要加入全局库的本书私有接口。'); reusePreview.value = await props.api.previewReuse({ selectedIds: [...reuseIds.value], expectedRevision: catalog.value.revision }) }) }
async function confirmReuse() { await run(async () => { if (!reusePreview.value) return; await props.api.confirmReuse(reusePreview.value.token); reusePreview.value = null; reuseIds.value = []; message.value = '所选接口已加入全局库，原书分配和私有密钥保持不变。请在任务模型或新书默认中明确选择。'; try { catalog.value = await props.api.list() } catch { error.value = '复用已完成，但接口库刷新失败，请重新读取；不要重复创建接口。' } }) }
function editPrivate(c: { id: string; name: string }) {
  if (privateForm.value && (privateForm.value.name !== privateForm.value.originalName || privateForm.value.apiKey || privateForm.value.clearApiKey)) { error.value = '请先保存或取消当前私有接口输入。'; return }
  privateForm.value = { id: c.id, name: c.name, originalName: c.name, apiKey: '', clearApiKey: false }
}
async function savePrivate(keyOnly: boolean) {
  await run(async () => {
    if (!book.value || !privateForm.value) throw Error('请先重新读取本书私有接口。')
    const input = { ...privateForm.value }, token = book.value.token
    if (keyOnly) {
      const configured = await props.api.savePrivateKey({ token, id: input.id, ...(input.clearApiKey ? { clearApiKey: true } : { apiKey: input.apiKey }) })
      privateForm.value.apiKey = ''; privateForm.value.clearApiKey = false
      message.value = configured ? '本书私有密钥已保存，其他作品和全局接口不变。' : '本书私有密钥已清除；正文仍可手写。'
    } else {
      const saved = await props.api.renamePrivate({ token, id: input.id, name: input.name })
      privateForm.value.originalName = input.name
      message.value = savedMessage(saved, '本书私有接口名称') + '密钥和地址没有改变。'
    }
    await refreshAfterCommit(); emit('changed')
  })
}
onMounted(load)
onBeforeUnmount(() => { generation++; form.value.apiKey = ''; if (privateForm.value) privateForm.value.apiKey = ''; emit('dirty', false); void props.api.cancelTest().catch(() => {}); void props.api.cancelPreviews().catch(() => {}) })
defineExpose({ dirty, reload: load })
</script>

<template>
  <div class="global-model-settings" data-testid="global-model-settings" :aria-busy="pending">
    <div v-if="error" class="model-notice error" role="alert">{{ error }}</div>
    <div v-if="message" class="model-notice" role="status">{{ message }}</div>
    <div v-if="pending" role="status">正在处理… <button class="text-action" type="button" @click="api.cancelTest()">停止接口测试</button></div>
    <header class="model-section-header"><div><h3>{{ page === 'routing' ? '本书模型分配' : '本机全局模型接口' }}</h3><p>{{ page === 'routing' ? '只修改当前作品的型号与参数，不会修改全局接口或其他作品。' : 'API 和密钥只保存一次，多本作品分别引用。密钥不会写入书稿、备份或模型上下文。' }}</p></div><ArchiveAction :disabled="pending || dirty" @click="load">重新读取</ArchiveAction></header>
    <template v-if="page === 'connection'">
      <p v-if="catalog && !catalog.connections.length" class="model-notice">还没有全局接口。可新增一个，或从下方本书私有接口预览复用。</p>
      <div class="model-connection-list">
        <article v-for="c in catalog?.connections" :key="c.id" :data-global-id="c.id">
          <header><b>{{ c.name }}</b><span>{{ protocolLabel(c.protocol) }} · {{ c.enabled ? '启用中' : '已停用' }} · 版本 {{ c.revision }}</span></header>
          <p class="model-endpoint">{{ c.baseUrl }}</p><p>{{ credentialLabel(c) }}</p>
          <div class="model-actions"><ArchiveAction :disabled="pending" @click="editConnection(c)">编辑名称 / 密钥</ArchiveAction><ArchiveAction :disabled="pending" @click="toggle(c)">{{ c.enabled ? '停用（影响所有引用作品）' : '恢复接口' }}</ArchiveAction><ArchiveAction :disabled="pending || !c.enabled || c.credentialState !== 'stored'" @click="test(c)">测试此接口</ArchiveAction><ArchiveAction :disabled="pending || !c.enabled || c.credentialState !== 'stored'" @click="test(c, true)">获取型号</ArchiveAction></div>
        </article>
      </div>
      <ArchiveFormField label="测试用型号" help="仅在点击测试或获取型号后联网，不发送书稿；可手动填写服务商提供的型号。"><input v-model="probeModel" maxlength="500" :disabled="pending" data-testid="global-probe-model" placeholder="例如接口中的 GPT / Gemini 型号"></ArchiveFormField>
      <details v-if="probe?.models.length"><summary>{{ catalog?.connections.find(c => c.id === probe?.id)?.name || '所选接口' }} · 接口返回的 {{ probe.models.length }} 个型号 · 接口版本 {{ probe.revision }}</summary><ul class="model-catalog"><li v-for="model in probe.models" :key="model">{{ model }}</li></ul></details>
      <ArchiveAction :disabled="pending" data-testid="global-add-connection" @click="editConnection()">新增全局接口</ArchiveAction>
      <form v-if="showForm" class="model-edit-form" data-testid="global-connection-form" @submit.prevent="saveConnection">
        <fieldset :disabled="pending"><legend>{{ selected ? '编辑共享接口' : '新增共享接口' }}</legend>
          <p>保存名称、替换密钥或停用会影响所有引用此接口的作品。协议和地址不能就地更换；需要变更时请新增接口。</p>
          <div class="model-fields"><ArchiveFormField label="接口名称"><input v-model="form.name" maxlength="80" required data-testid="global-connection-name"></ArchiveFormField><ArchiveFormField label="接口协议" help="已有接口的协议不可修改。"><select v-model="form.protocol" :disabled="Boolean(selected)" required data-testid="global-connection-protocol"><option value="openai-compatible">OpenAI 兼容协议</option><option value="gemini-native">Gemini 原生协议</option></select></ArchiveFormField><ArchiveFormField label="服务地址" :help="endpointHelp"><input v-model="form.baseUrl" type="url" :readonly="Boolean(selected)" maxlength="2048" required data-testid="global-connection-url" :placeholder="form.protocol === 'gemini-native' ? 'https://服务根地址' : 'https://服务地址/v1'"></ArchiveFormField><ArchiveFormField label="API Key" help="不会回显已存密钥。留空保持原密钥；新接口也可暂不填写。"><input v-model="form.apiKey" type="password" maxlength="4096" autocomplete="new-password" :disabled="form.clearApiKey" data-testid="global-connection-key"></ArchiveFormField></div>
          <label v-if="selected" class="model-check"><input v-model="form.clearApiKey" type="checkbox" :disabled="Boolean(form.apiKey)">明确清除已存密钥（影响所有引用作品）</label>
          <div class="model-actions"><ArchiveAction type="submit" variant="primary" data-testid="global-save-connection">保存全局接口</ArchiveAction><ArchiveAction @click="cancelEdit">取消编辑</ArchiveAction></div>
        </fieldset>
      </form>
      <details v-if="bookAvailable" class="model-private"><summary>本书私有接口 · 原书保持独立</summary><p>勾选后先预览，确认只加入全局库；不会改写本书当前分配。也可只管理本书名称和密钥。</p><div v-for="c in privateConnections" :key="c.id" class="model-actions"><label class="model-check"><input v-model="reuseIds" type="checkbox" :value="c.originalId" :disabled="pending">{{ c.name }} <span class="model-endpoint">{{ c.baseUrl }}</span></label><ArchiveAction :disabled="pending" @click="editPrivate(c)">管理本书私有接口</ArchiveAction></div><p v-if="!privateConnections.length">本书没有可复用的私有接口。</p><ArchiveAction :disabled="pending || !reuseIds.length" data-testid="preview-global-reuse" @click="previewReuse">预览加入全局库</ArchiveAction>
        <fieldset v-if="privateForm" :disabled="pending" class="model-edit-form"><legend>仅修改本书</legend><p>名称和密钥分别保存。地址保持不变；更换服务地址请新增全局接口后明确选择。</p><ArchiveFormField label="本书私有接口名称"><input v-model="privateForm.name" maxlength="80"></ArchiveFormField><ArchiveAction :disabled="privateForm.name === privateForm.originalName" @click="savePrivate(false)">仅保存名称</ArchiveAction><ArchiveFormField label="本书私有 API Key" help="不回显已存密钥；不会改动已复用到全局库的密钥。"><input v-model="privateForm.apiKey" type="password" autocomplete="new-password" maxlength="4096" :disabled="privateForm.clearApiKey"></ArchiveFormField><label class="model-check"><input v-model="privateForm.clearApiKey" type="checkbox" :disabled="Boolean(privateForm.apiKey)">明确清除本书私有密钥</label><div class="model-actions"><ArchiveAction :disabled="!privateForm.apiKey && !privateForm.clearApiKey" @click="savePrivate(true)">仅保存密钥变更</ArchiveAction><ArchiveAction @click="privateForm.apiKey = ''; privateForm = null">取消私有接口编辑</ArchiveAction></div></fieldset>
      </details>
      <section v-if="reusePreview" class="model-review" data-testid="global-reuse-preview"><h4>确认复用这些接口？</h4><p>只在本机全局库新增连接。原书、原密钥和原分配都不变。</p><p v-for="c in reusePreview.connections" :key="c.sourceConnectionId">{{ c.name }} · {{ c.baseUrl }} · {{ c.credentialState === 'stored' ? '可复用已存密钥' : '密钥暂不可用' }}</p><div class="model-actions"><ArchiveAction variant="primary" :disabled="pending" @click="confirmReuse">确认加入全局库</ArchiveAction><ArchiveAction :disabled="pending" @click="reusePreview = null; api.cancelPreviews()">取消</ArchiveAction></div></section>
      <details :open="defaultsOpen" class="model-defaults"><summary>新书默认模型分配 <span v-if="defaults">· 版本 {{ defaults.revision }}</span></summary><p>新书创建时复制这一版，之后各书独立。建议总纲和章纲选择 GPT，正文选择 Gemini；请填写接口实际支持的型号。</p><ModelRoutingForm v-model="defaultDraft" :options="globalOptions" :disabled="pending" @update:model-value="defaultEdited = true" @input="defaultEdited = true" @change="defaultEdited = true"/><div class="model-actions"><ArchiveAction variant="primary" :disabled="pending || !defaults" data-testid="save-new-book-defaults" @click="saveDefault()">保存新书默认分配</ArchiveAction><ArchiveAction :disabled="pending || !defaults?.template" @click="saveDefault(true)">清空默认（已有书不变）</ArchiveAction></div></details>
    </template>
    <template v-if="page === 'routing' && book">
      <ModelRoutingForm v-model="bookDraft" :options="bookOptions" :disabled="pending"/>
      <div class="model-actions"><ArchiveAction variant="primary" :disabled="pending" data-testid="save-book-models" @click="saveBook">保存本书分配</ArchiveAction><ArchiveAction :disabled="pending || !defaults?.template || dirty" @click="previewDefaults">预览应用新书默认</ArchiveAction></div>
      <section v-if="applyPreview" class="model-review" data-testid="apply-model-defaults-preview"><h4>本书将应用默认版本 {{ applyPreview.defaultRevision }}</h4><p>原私有接口仍保留；四项任务与统一模型参数将替换为此默认，其他作品不变。</p><table><thead><tr><th>分配项</th><th>当前</th><th>应用后</th></tr></thead><tbody><tr v-for="c in applyPreview.changes" :key="c.field"><td>{{ c.field }}</td><td>{{ c.before }}</td><td>{{ c.after }}</td></tr></tbody></table><div class="model-actions"><ArchiveAction variant="primary" :disabled="pending" @click="confirmDefaults">确认应用到本书</ArchiveAction><ArchiveAction :disabled="pending" @click="applyPreview = null; api.cancelPreviews()">取消</ArchiveAction></div></section>
    </template>
    <div v-if="dirty"><p role="status">有未保存的修改。各区域分别保存，离开前请处理当前输入。</p><ArchiveAction :disabled="pending" @click="cancelEdit(); privateForm = null; load()">放弃本页未保存修改并重新读取</ArchiveAction></div>
  </div>
</template>

<style scoped>
.global-model-settings { display:grid; gap:20px; container-type:inline-size; font-size:var(--form-text); line-height:1.6; min-width:0; }
.model-section-header, .model-connection-list article > header { display:flex; gap:16px; justify-content:space-between; align-items:start; }
h3,h4,p { margin:0; } h3 { font-size:var(--form-heading,20px); } p, article header span { font-size:var(--form-help,14px); }
.model-connection-list { display:grid; gap:16px; }
article, .model-review, .model-edit-form fieldset { border:1px solid var(--line); padding:20px; display:grid; gap:12px; min-width:0; }
.model-endpoint, td, li { overflow-wrap:anywhere; }
.model-notice { border-left:3px solid var(--jade); padding:12px 16px; background:var(--surface-muted,transparent); }
.model-notice.error { border-left-color:var(--danger); }
.model-fields { display:grid; gap:16px; grid-template-columns:repeat(2,minmax(0,1fr)); }
.model-fields > :last-child { grid-column:1/-1; }
.model-actions { display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
.model-check { display:flex; align-items:center; gap:10px; flex-wrap:wrap; } .model-check input { width:auto; }
input, select { width:100%; min-width:0; min-height:var(--form-control-height,40px); }
input:not([type=checkbox]), select { background:var(--surface); color:var(--ink); border:1px solid var(--line); padding:8px 10px; font:inherit; }
input[type=checkbox] { min-height:20px; }
input:focus-visible, select:focus-visible, summary:focus-visible { outline:2px solid var(--jade); outline-offset:2px; }
details { border-top:1px solid var(--line); padding-top:16px; }
details > :not(summary) { margin-top:16px; }
summary { cursor:pointer; font-weight:600; padding-block:8px; }
.model-catalog { max-height:240px; overflow:auto; }
table { width:100%; border-collapse:collapse; table-layout:fixed; } th,td { text-align:left; padding:8px; border-bottom:1px solid var(--line); }
@container (max-width:600px) { .model-fields { grid-template-columns:minmax(0,1fr); } .model-section-header { flex-wrap:wrap; } }
</style>
