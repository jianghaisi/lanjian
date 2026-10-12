<script setup lang="ts">
import type { LocalModelsApi, LocalModelView } from '../../../../contracts/models/local-model-contracts'
import { isReferencedBookSettings } from '../../../../contracts/models/book-model-settings'
import { computed, nextTick, onMounted, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { ModelConnectionsApi, ModelDefaultsView, BookModelsView, BookModelsSaved, DefaultApplicationPreview, ModelProbeResult } from '../../../../contracts/models/model-connections-contracts'
import type { GlobalConnectionsView, GlobalConnectionView, RemoteModelProtocol } from '../../../../contracts/models/model-connections'
import type { LegacyReusePreview } from '../../../../contracts/models/legacy-connection-reuse'
import { routingDraft, compileRouting, selectModel, modelTaskLabels, type ModelSlot } from '../services/model-connections-state'
import ArchiveAction from '../../../ui/ArchiveAction.vue'
import ArchiveFormField from '../../../ui/ArchiveFormField.vue'
import ModelRoutingForm from './ModelRoutingForm.vue'
import { saveTestedModelDefault } from '../services/model-quick-setup'
import ModelTestPanel from './ModelTestPanel.vue'
const props = withDefaults(defineProps<{ api: ModelConnectionsApi; localApi?: LocalModelsApi; bookAvailable?: boolean; page?: 'connection' | 'routing'; embedded?: boolean; returnLabel?: string }>(), { page: 'connection', returnLabel: '返回创作' })
const localModels = ref<LocalModelView[]>([]), localError = ref('')
onMounted(async () => { if (props.localApi) { try { localModels.value = await props.localApi.list() } catch { localError.value = '本地型号资料读取失败，请到模型超市重新检测。' } } })
const emit = defineEmits<{ changed: []; dirty: [value: boolean]; navigate: [page: 'connection' | 'routing']; return: [] }>()
const catalog = ref<GlobalConnectionsView | null>(null), defaults = ref<ModelDefaultsView | null>(null), book = ref<BookModelsView | null>(null)
const defaultDraft = ref(routingDraft(null)), bookDraft = ref(routingDraft(null)), defaultsOpen = ref(false)
const defaultBaseline = ref(''), bookBaseline = ref(''), defaultEdited = ref(false)
const defaultFormEpoch = ref(0)
const selected = ref<GlobalConnectionView | null>(null), form = ref<{ name: string; baseUrl: string; protocol: RemoteModelProtocol; apiKey: string; clearApiKey: boolean }>({ name: '', baseUrl: '', protocol: 'openai-compatible', apiKey: '', clearApiKey: false })
const formBaseline = ref(JSON.stringify(form.value)), showForm = ref(false)
const removal = ref<{ connection: GlobalConnectionView; catalogRevision: number } | null>(null)
const activeConnectionId = ref('')
const availableConnections = computed(() => catalog.value?.connections.filter(c => c.enabled) ?? [])
const retiredConnections = computed(() => catalog.value?.connections.filter(c => !c.enabled) ?? [])
const activeConnection = computed(() => catalog.value?.connections.find(c => c.id === activeConnectionId.value))
const privateForm = ref<{ id: string; name: string; originalName: string; apiKey: string; clearApiKey: boolean } | null>(null)
const pending = ref(false), error = ref(''), message = ref(''), probeId = ref(''), probeBusy = ref(false)
const mutationPending = ref(false)
type ValidationDraft = 'book' | 'defaults'
let validationFailure: { scope: ValidationDraft; snapshot: string; message: string } | undefined
const probeConnection = computed(() => catalog.value?.connections.find(item => item.id === probeId.value && item.enabled))
const reusePreview = ref<LegacyReusePreview | null>(null), applyPreview = ref<DefaultApplicationPreview | null>(null), reuseIds = ref<string[]>([])
// The immutable preview includes an IPC patch; deep reactive proxies cannot cross contextBridge.
const transferTarget = ref(''), transferPreview = shallowRef<{ token: string; patch: unknown; changes: Array<{ slot: string; before: string; after: string; model: string }> } | null>(null)
let generation = 0
const dirty = computed(() => mutationPending.value || probeBusy.value || (showForm.value && JSON.stringify(form.value) !== formBaseline.value)
  || Boolean(privateForm.value && (privateForm.value.name !== privateForm.value.originalName || privateForm.value.apiKey || privateForm.value.clearApiKey))
  || (defaultEdited.value && JSON.stringify(defaultDraft.value) !== defaultBaseline.value)
  || Boolean(book.value && JSON.stringify(bookDraft.value) !== bookBaseline.value))
watch(dirty, value => emit('dirty', value))
watch(defaultDraft, value => { defaultEdited.value = JSON.stringify(value) !== defaultBaseline.value }, { deep: true, flush: 'sync' })
watch([() => JSON.stringify(bookDraft.value), () => JSON.stringify(defaultDraft.value)], ([bookValue, defaultValue]) => {
  const failed = validationFailure
  if (failed && (failed.scope === 'book' ? bookValue : defaultValue) !== failed.snapshot) {
    if (error.value === failed.message) error.value = ''
    validationFailure = undefined
  }
})
const privateConnections = computed(() => !book.value ? [] : isReferencedBookSettings(book.value.settings)
  ? book.value.settings.references.flatMap(r => r.kind === 'legacy-private' ? [{ id: r.id, originalId: r.originalConnectionId, name: r.name, baseUrl: r.baseUrl }] : [])
  : book.value.settings.connections.map(c => ({ ...c, originalId: c.id })))
const globalOptions = computed(() => [
  ...(catalog.value?.connections.map(c => ({ value: `global:${c.id}`, label: `${c.name}${c.enabled ? '' : ' · 已停用'}`, disabled: !c.enabled, protocol: c.protocol, baseUrl: c.baseUrl, revision: c.revision })) ?? []),
  { value: 'local', label: '本地推理 · 无需密钥', protocol: 'local' }
])
const bookOptions = computed(() => [...globalOptions.value, ...privateConnections.value.map(c => ({ value: `private:${c.id}`, label: `${c.name} · 旧私有配置`, baseUrl: c.baseUrl, protocol: 'openai-compatible' }))])
const credentialLabel = (c: GlobalConnectionView) => c.credentialState === 'stored' ? '密钥已存储 · 尚不代表连接可用' : c.credentialState === 'missing' ? '未配置密钥' : '系统解密暂不可用'
const protocolLabel = (protocol: RemoteModelProtocol) => ({ 'gemini-native': 'Gemini 原生协议', 'openai-compatible': 'OpenAI Chat 兼容协议', 'openai-responses': 'OpenAI Responses', 'anthropic-native': 'Anthropic Messages' })[protocol]
const endpointHelp = computed(() => form.value.protocol === 'gemini-native'
  ? '填写服务根地址，例如 https://zzshu.cc；不要附加 /v1。保存后协议和地址不可修改。'
  : '填写服务商指定的 API 地址，通常以 /v1 结尾；Messages 也支持服务根地址。保存后协议和地址不可修改。')
function savedMessage(result: BookModelsSaved, action: string) {
  if (result.authority === 'files') return `${action}已保存到本书文件。其他作品保持不变。`
  const mirror = { synced: '可读镜像已同步。', pending: '可读镜像待同步，请到项目数据核对。', conflict: '可读镜像有外部修改，原文件已保留，请到项目数据核对。', failed: '镜像同步失败，正式结果已保存，请到项目数据重试。', 'not-applicable': '' }[result.mirrorStatus]
  return `${action}已保存到正式数据库。${mirror}`
}

async function run(work: () => Promise<void>, locksNavigation = true, validationDraft?: ValidationDraft) {
  if (pending.value || probeBusy.value) return
  const snapshot = validationDraft ? JSON.stringify(validationDraft === 'book' ? bookDraft.value : defaultDraft.value) : ''
  validationFailure = undefined
  const request = generation; pending.value = true; mutationPending.value = locksNavigation; error.value = ''; message.value = ''
  try { await work() }
  catch (cause) {
    if (request !== generation) return
    const text = cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : '操作未完成，请检查后重试；输入已保留。'
    const failed = validationDraft && cause && typeof cause === 'object' && 'code' in cause && cause.code === 'VALIDATION_ERROR'
      ? { scope: validationDraft, snapshot, message: text } : undefined
    // Only parameter rejection describes this exact draft; storage/conflict/read errors still need recovery.
    if (failed && snapshot !== JSON.stringify(failed.scope === 'book' ? bookDraft.value : defaultDraft.value)) return
    error.value = text; validationFailure = failed
  }
  finally { if (request === generation) { pending.value = false; mutationPending.value = false } }
}
async function loadBook() {
  if (!props.bookAvailable) return
  const request = generation, value = await props.api.book()
  if (request !== generation) return
  book.value = value; bookDraft.value = routingDraft(value.settings); bookBaseline.value = JSON.stringify(bookDraft.value)
}
async function load() {
  removal.value = null; transferPreview.value = null
  const request = generation
  await run(async () => {
    const c = await props.api.list(); if (request !== generation) return; catalog.value = c
    if (!c.connections.some(c => c.id === activeConnectionId.value)) activeConnectionId.value = c.connections.find(c => c.enabled)?.id ?? ''
    const d = await props.api.defaults(); if (request !== generation) return
    defaults.value = d; defaultDraft.value = routingDraft(d.template); defaultBaseline.value = JSON.stringify(defaultDraft.value); defaultEdited.value = false
    defaultFormEpoch.value++
    await loadBook()
  }, false)
}
function selectConnection(c: GlobalConnectionView) {
  if (dirty.value) return
  cancelEdit(); removal.value = null; probeId.value = ''; activeConnectionId.value = c.id
}
function editConnection(c?: GlobalConnectionView) {
  if (showForm.value && JSON.stringify(form.value) !== formBaseline.value) { error.value = '当前接口还有未保存的输入，请先保存或取消编辑。'; return }
  selected.value = c ? { ...c } : null
  if (c) activeConnectionId.value = c.id
  form.value = { name: c?.name ?? '', baseUrl: c?.baseUrl ?? '', protocol: c?.protocol ?? 'openai-compatible', apiKey: '', clearApiKey: false }
  formBaseline.value = JSON.stringify(form.value); showForm.value = true; probeId.value = ''
}
function cancelEdit() { form.value.apiKey = ''; form.value.clearApiKey = false; showForm.value = false; formBaseline.value = JSON.stringify(form.value) }
async function saveConnection() {
  await run(async () => {
    if (!catalog.value) throw Error('请先读取接口库。')
    const change = { ...form.value }, current = selected.value, revision = catalog.value.revision
    const knownIds = new Set(catalog.value.connections.map(c => c.id)), request = generation
    if (!change.name.trim() || !change.baseUrl.trim()) throw Error('请填写接口名称和服务地址。')
    const key = change.apiKey.trim() ? { apiKey: change.apiKey } : change.clearApiKey ? { clearApiKey: true } : {}
    catalog.value = current ? await props.api.update({ expectedRevision: revision, id: current.id, connectionRevision: current.revision, name: change.name, ...key })
      : await props.api.create({ expectedRevision: revision, name: change.name, baseUrl: change.baseUrl, protocol: change.protocol, ...(change.apiKey.trim() ? { apiKey: change.apiKey } : {}) })
    if (request !== generation) return
    activeConnectionId.value = current?.id ?? catalog.value.connections.find(c => !knownIds.has(c.id))?.id ?? ''
    cancelEdit(); message.value = '全局接口已保存。其他书的型号和任务参数没有改变。'; emit('changed')
  })
}
async function toggle(c: GlobalConnectionView) {
  await run(async () => { catalog.value = await props.api.update({ expectedRevision: catalog.value!.revision, id: c.id, connectionRevision: c.revision, enabled: !c.enabled }); probeId.value = ''; message.value = c.enabled ? '已停用。所有引用它的书将停止新的模型请求，正文仍可编辑。' : '已恢复接口；没有自动发起模型请求。'; emit('changed') })
}
function requestRemoval(c: GlobalConnectionView) {
  if (pending.value || dirty.value || !catalog.value) return
  removal.value = { connection: { ...c }, catalogRevision: catalog.value.revision }
}
async function confirmRemoval() {
  if (dirty.value || !removal.value) return
  const captured = removal.value, request = generation
  await run(async () => {
    const result = await props.api.remove({ expectedRevision: captured.catalogRevision,
      id: captured.connection.id, connectionRevision: captured.connection.revision })
    if (request !== generation) return
    catalog.value = result; removal.value = null; probeId.value = ''; cancelEdit()
    activeConnectionId.value = result.connections[0]?.id ?? ''
    message.value = '接口及已存密钥已删除。引用它的作品和新书默认需要重新选择接口；正文仍可编辑。'
    emit('changed')
    try { const value = await props.api.defaults(); if (request === generation) defaults.value = value }
    catch { if (request === generation) error.value = '接口已删除，但默认分配刷新失败，请重新读取。' }
  })
}
async function saveDefault(clear = false) {
  await run(async () => {
    if (!defaults.value || !catalog.value) throw Error('请先重新读取默认分配。')
    const template = clear ? null : compileRouting(defaultDraft.value, catalog.value).template
    defaults.value = await props.api.saveDefaults({ expectedRevision: defaults.value.revision, expectedCatalogRevision: catalog.value.revision, template })
    defaultDraft.value = routingDraft(defaults.value.template); defaultBaseline.value = JSON.stringify(defaultDraft.value); defaultEdited.value = false
    defaultFormEpoch.value++
    message.value = clear ? '已清空新书默认。已有作品保持不变。' : '默认分配已保存，只影响之后新建的作品。'
    try { catalog.value = await props.api.list() } catch { error.value = '默认分配已保存，但接口库刷新失败，请重新读取后再编辑。' }
  }, true, 'defaults')
}
async function saveBook(returnAfter = false) {
  let saved = false
  await run(async () => {
    if (!book.value || !catalog.value) throw Error('请先读取本书分配。')
    const request = generation
    const result = await props.api.saveBook({ token: book.value.token, patch: compileRouting(bookDraft.value, catalog.value, book.value.settings).patch })
    if (request !== generation) return
    bookDraft.value = routingDraft(result.settings); bookBaseline.value = JSON.stringify(bookDraft.value)
    message.value = savedMessage(result, '本书模型分配')
    await refreshAfterCommit(); emit('changed')
    saved = !error.value
  }, true, 'book')
  await nextTick()
  if (saved && returnAfter) emit('return')
}
async function chooseTestedDefault(result: ModelProbeResult) {
  await run(async () => {
    const request = generation, value = await saveTestedModelDefault(props.api, result)
    if (request !== generation) return
    defaults.value = value; defaultDraft.value = routingDraft(value.template)
    defaultBaseline.value = JSON.stringify(defaultDraft.value); defaultEdited.value = false
    defaultFormEpoch.value++
    message.value = `已将 ${result.model} 设为新书默认。当前作品和其他已有作品保持原分配。`
    try { const value = await props.api.list(); if (request === generation) catalog.value = value }
    catch { if (request === generation) error.value = '新书默认已保存，但接口列表刷新失败，请重新读取后再编辑。' }
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
function previewTransfer() {
  if (!book.value || !catalog.value || dirty.value) return
  const target = catalog.value.connections.find(c => c.id === transferTarget.value && c.enabled)
  if (!target) { error.value = '请选择已有的全局接口。'; return }
  const next = JSON.parse(JSON.stringify(bookDraft.value)) as typeof bookDraft.value
  const changes = [] as Array<{ slot: string; before: string; after: string; model: string }>
  for (const slot of Object.keys(modelTaskLabels) as ModelSlot[]) {
    const p = next.profiles[slot]
    if (!p.selection.startsWith('private:')) continue
    changes.push({ slot: modelTaskLabels[slot], before: privateConnections.value.find(c => `private:${c.id}` === p.selection)?.name ?? '旧私有接口', after: target.name, model: p.model })
    next.profiles[slot] = selectModel(p, p.model, `global:${target.id}`)
  }
  if (!changes.length) { error.value = '当前分配没有使用旧私有接口。'; return }
  try { transferPreview.value = { token: book.value.token, patch: compileRouting(next, catalog.value, book.value.settings).patch, changes } }
  catch (e) { error.value = e instanceof Error ? e.message : '无法预览，请重新读取。' }
}
async function confirmTransfer() {
  const preview = transferPreview.value
  if (!preview) return
  await run(async () => {
    const result = await props.api.saveBook({ token: preview.token, patch: preview.patch })
    transferPreview.value = null; bookDraft.value = routingDraft(result.settings); bookBaseline.value = JSON.stringify(bookDraft.value)
    message.value = savedMessage(result, '转用全局接口') + '旧模型配置已保留恢复副本，旧私有密钥没有删除。'
    await refreshAfterCommit(); emit('changed')
  })
}
onMounted(load)
onBeforeUnmount(() => { generation++; form.value.apiKey = ''; if (privateForm.value) privateForm.value.apiKey = ''; emit('dirty', false); void props.api.cancelTest().catch(() => {}); void props.api.cancelPreviews().catch(() => {}) })
defineExpose({ dirty, reload: load })
</script>

<template>
  <div class="global-model-settings" data-testid="global-model-settings" :aria-busy="pending">
    <header class="model-section-header">
      <div><p>{{ page === 'routing' ? '只对当前作品生效。保存模型后，就可以回到原位置继续写作。' : '接口保存一次，各本作品分别选择型号。' }}</p></div>
      <ArchiveAction compact :disabled="pending || dirty" @click="load">重新读取</ArchiveAction>
    </header>
    <div v-if="error" class="model-notice error" role="alert">{{ error }}</div>
    <div v-if="message" class="model-notice" role="status">{{ message }}</div>
    <p v-if="pending" role="status">正在处理，请稍候…</p>
    <template v-if="page === 'connection'">
      <div class="connection-workspace">
        <nav class="connection-index" aria-label="已保存的 API 接口">
          <div class="connection-index-heading"><div><span class="archive-kicker">API INDEX / 接口索引</span><b>我的接口 <small>{{ availableConnections.length }}</small></b></div><ArchiveAction compact :disabled="dirty || (showForm && !selected)" data-testid="global-add-connection" @click="editConnection()">添加</ArchiveAction></div>
          <p v-if="catalog && !availableConnections.length" class="empty-copy">还没有启用的接口。添加服务地址和密钥后，即可为作品选择模型。</p>
          <article v-for="c in availableConnections" :key="c.id" :data-global-id="c.id">
            <button type="button" class="connection-select" :class="{ selected: activeConnectionId === c.id && !(showForm && !selected) }" :aria-current="activeConnectionId === c.id && !(showForm && !selected) ? 'true' : undefined" :disabled="pending || dirty" @click="selectConnection(c)">
              <b>{{ c.name }}</b><span>{{ protocolLabel(c.protocol) }}</span><small>{{ !c.enabled ? '已停用' : c.credentialState === 'stored' ? '已保存密钥' : credentialLabel(c) }}</small>
            </button>
          </article>
          <details v-if="retiredConnections.length" class="connection-maintenance" data-testid="retired-connections">
            <summary>已停用接口 · {{ retiredConnections.length }}</summary>
            <article v-for="c in retiredConnections" :key="c.id" :data-global-id="c.id">
              <button type="button" class="connection-select" :class="{ selected: activeConnectionId === c.id }" :disabled="pending || dirty" @click="selectConnection(c)"><b>{{ c.name }}</b><small>已停用 · 可恢复</small></button>
            </article>
          </details>
        </nav>
        <section class="connection-detail" aria-label="接口详情">
      <form v-if="showForm" class="model-edit-form" data-testid="global-connection-form" @submit.prevent="saveConnection">
        <fieldset :disabled="pending"><legend class="form-legend">{{ selected ? '编辑共享接口' : '添加 API 接口' }}</legend><header class="connection-form-heading"><span class="archive-kicker">CONNECTION / 接口配置</span><h4>{{ selected ? '编辑共享接口' : '添加 API 接口' }}</h4></header>
          <p v-if="selected">名称和密钥的变更会影响所有引用此接口的作品。</p>
          <div class="model-fields"><ArchiveFormField label="接口名称" v-slot="{ controlProps }"><input v-bind="controlProps" v-model="form.name" maxlength="80" required data-testid="global-connection-name"></ArchiveFormField><ArchiveFormField label="接口协议" help="按服务商说明选择；保存后不可修改。" v-slot="{ controlProps }"><select v-bind="controlProps" aria-label="接口协议" v-model="form.protocol" :disabled="Boolean(selected)" required data-testid="global-connection-protocol"><option value="openai-compatible">OpenAI 兼容协议</option><option value="gemini-native">Gemini 原生协议</option><option value="anthropic-native">Anthropic Messages</option><option value="openai-responses">OpenAI Responses</option></select></ArchiveFormField><ArchiveFormField label="服务地址" :help="endpointHelp" v-slot="{ controlProps }"><input v-bind="controlProps" v-model="form.baseUrl" type="url" :readonly="Boolean(selected)" maxlength="2048" required data-testid="global-connection-url" :placeholder="form.protocol === 'gemini-native' ? 'https://服务根地址' : 'https://服务地址/v1'"></ArchiveFormField><ArchiveFormField label="密钥（API Key）" help="不会回显已存密钥。留空保持原密钥；新接口也可暂不填写。" v-slot="{ controlProps }"><input v-bind="controlProps" v-model="form.apiKey" type="password" maxlength="4096" autocomplete="new-password" :disabled="form.clearApiKey" data-testid="global-connection-key"></ArchiveFormField></div>
          <label v-if="selected" class="model-check"><input v-model="form.clearApiKey" type="checkbox" :disabled="Boolean(form.apiKey)">明确清除已存密钥（影响所有引用作品）</label>
          <div class="model-actions"><ArchiveAction type="submit" variant="primary" data-testid="global-save-connection">保存接口</ArchiveAction><ArchiveAction @click="cancelEdit">取消</ArchiveAction></div>
        </fieldset>
      </form>

          <template v-if="activeConnection && !showForm">
            <div class="connection-dossier">
              <header class="connection-detail-heading"><div><span class="archive-kicker">SHARED CONNECTION / 共享接口</span><h4>{{ activeConnection.name }}</h4></div><ArchiveAction compact :disabled="pending || dirty" @click="editConnection(activeConnection)">编辑接口 ↗</ArchiveAction></header>
              <div class="connection-facts"><div><span>接口协议</span><b>{{ protocolLabel(activeConnection.protocol) }}</b></div><div><span>使用状态</span><b>{{ activeConnection.enabled ? '已启用' : '已停用' }}</b></div></div>
              <div class="connection-address"><span>服务地址</span><p class="model-endpoint">{{ activeConnection.baseUrl }}</p></div>
              <p class="credential-status">{{ credentialLabel(activeConnection) }}</p>
            </div>
            <div class="connection-next-actions">
              <ArchiveAction v-if="!probeConnection" class="connection-step inspect" :disabled="dirty || !activeConnection.enabled || activeConnection.credentialState !== 'stored'" data-testid="open-model-tests" @click="probeId = activeConnection.id"><span><b>获取模型与测试</b><small>查看目录 · 按需测试</small></span><span aria-hidden="true">↗</span></ArchiveAction>
              <ArchiveAction v-if="bookAvailable" class="connection-step assign" :disabled="pending || dirty" data-testid="configure-book-models" @click="emit('navigate', 'routing')"><span><b>为本书选择模型</b><small>选择型号 · 继续创作</small></span><span aria-hidden="true">→</span></ArchiveAction>
            </div>
            <p v-if="!probeConnection" class="detail-help">测试可选，点击时才发出请求；也可直接选择或填写型号。</p>
            <template v-if="probeConnection">
              <ModelTestPanel :key="`${probeConnection.id}:${probeConnection.revision}`" :api="api" :connection="probeConnection" :disabled="pending || defaultEdited" allow-default @busy="probeBusy = $event" @choose="chooseTestedDefault" />
              <ArchiveAction compact :disabled="probeBusy" @click="probeId = ''">收起模型列表</ArchiveAction>
            </template>
            <details class="connection-maintenance"><summary>停用或删除接口</summary><p>会影响所有引用此接口的作品。</p><div class="model-actions"><ArchiveAction :disabled="pending || dirty" @click="toggle(activeConnection)">{{ activeConnection.enabled ? '停用接口' : '恢复接口' }}</ArchiveAction><ArchiveAction variant="danger" :disabled="pending || dirty" data-testid="delete-global-connection" @click="requestRemoval(activeConnection)">删除接口</ArchiveAction></div></details>
            <section v-if="removal" class="model-review" data-testid="delete-global-connection-confirm" role="region" aria-label="确认删除接口">
              <h4>删除“{{ removal.connection.name }}”？</h4><p class="model-endpoint">{{ removal.connection.baseUrl }}</p><p>将删除接口及本机保存的密钥。引用它的作品和新书默认需要重新选择接口，书稿保留。已经发出的请求可能继续完成。</p>
              <div class="model-actions"><ArchiveAction variant="danger" :disabled="pending || dirty" data-testid="confirm-delete-global-connection" @click="confirmRemoval">确认删除接口和密钥</ArchiveAction><ArchiveAction :disabled="pending" data-testid="cancel-delete-global-connection" @click="removal = null">取消</ArchiveAction></div>
            </section>
          </template>
          <div v-else-if="!showForm && catalog" class="connection-empty"><span class="archive-kicker">YOUR WRITING CONNECTION / 创作接口</span><h4>为创作，接入一个模型。</h4><p>准备服务商提供的地址和密钥。之后选择模型，各本作品可独立使用。</p><ArchiveAction variant="primary" :disabled="pending" data-testid="empty-add-connection" @click="editConnection()">添加 API 接口</ArchiveAction><p class="detail-help">暂时不配置，也可以继续手动写作。</p></div>
        </section>
      </div>
      <details :open="defaultsOpen" class="model-defaults"><summary>新作品的初始模型 <span v-if="defaults?.template">· {{ defaults.template.routingMode === 'shared' ? defaults.template.shared.model : '按任务分别设置' }}</span><span v-else>· 暂未设置</span><span v-if="defaults?.references.some(r => r.state !== 'enabled')" class="error"> · 引用的接口不可用，请重新选择</span></summary><p>仅在新建作品时复制。修改后，已有作品保持原来的型号和参数。</p><ModelRoutingForm :key="defaultFormEpoch" v-model="defaultDraft" :options="globalOptions" :api="api" :local-models="localModels" :disabled="pending || probeBusy || showForm" @busy="probeBusy = $event"/><div class="model-actions"><ArchiveAction variant="primary" :disabled="pending || probeBusy || !defaults" data-testid="save-new-book-defaults" @click="saveDefault()">保存新书默认分配</ArchiveAction><ArchiveAction :disabled="pending || probeBusy || !defaults?.template" @click="saveDefault(true)">清空默认</ArchiveAction></div></details>

    </template>
    <template v-if="page === 'routing' && book">
      <div v-if="!catalog?.connections.length && !privateConnections.length" class="model-notice"><p>先添加一个 API 接口，或选择已安装的本地模型。</p><ArchiveAction :disabled="pending || dirty" @click="emit('navigate', 'connection')">添加 API 接口</ArchiveAction></div>
      <p v-if="localError" class="error" role="alert">{{ localError }}</p><ModelRoutingForm :key="book.token" v-model="bookDraft" :options="bookOptions" :api="api" :local-models="localModels" :disabled="pending" @busy="probeBusy = $event"/>
      <footer class="book-model-actions"><div class="model-actions"><ArchiveAction variant="primary" :disabled="pending || probeBusy || !book.token" data-testid="save-book-models" @click="saveBook()">保存本书模型</ArchiveAction><ArchiveAction v-if="embedded" :disabled="pending || probeBusy || !book.token" data-testid="save-book-models-return" @click="saveBook(true)">保存并{{ returnLabel }}</ArchiveAction></div><span class="save-state">{{ JSON.stringify(bookDraft) === bookBaseline ? '当前配置已保存' : '修改尚未保存' }}</span></footer>
      <details v-if="defaults?.template" class="model-defaults"><summary>从新书默认复制分配</summary><p>预览后再确认，会替换本书的型号和参数。</p><ArchiveAction :disabled="pending || dirty" @click="previewDefaults">预览应用新书默认</ArchiveAction></details>
      <section v-if="applyPreview" class="model-review" data-testid="apply-model-defaults-preview"><h4>本书将应用默认版本 {{ applyPreview.defaultRevision }}</h4><p>原私有接口仍保留；四项任务与统一模型参数将替换为此默认，其他作品不变。</p><table><thead><tr><th>分配项</th><th>当前</th><th>应用后</th></tr></thead><tbody><tr v-for="c in applyPreview.changes" :key="c.field"><td>{{ c.field }}</td><td>{{ c.before }}</td><td>{{ c.after }}</td></tr></tbody></table><div class="model-actions"><ArchiveAction variant="primary" :disabled="pending" @click="confirmDefaults">确认应用到本书</ArchiveAction><ArchiveAction :disabled="pending" @click="applyPreview = null; api.cancelPreviews()">取消</ArchiveAction></div></section>

    </template>
    <details v-if="book && privateConnections.length" class="model-private" data-testid="legacy-organize"><summary>整理旧配置</summary><p>保留型号，参数切换为自动；只修改这本书，不复制密钥、不新增重复接口。</p><div class="model-actions"><ArchiveFormField label="已有全局 API" v-slot="{ controlProps }"><select v-bind="controlProps" aria-label="已有全局 API" v-model="transferTarget" :disabled="pending || dirty"><option value="">请选择</option><option v-for="c in catalog?.connections" :key="c.id" :value="c.id" :disabled="!c.enabled">{{ c.name }}</option></select></ArchiveFormField><ArchiveAction :disabled="pending || dirty || !transferTarget" data-testid="preview-transfer-global" @click="previewTransfer">预览转用</ArchiveAction></div>
      <section v-if="transferPreview" class="model-review" data-testid="transfer-global-preview"><h4>确认这本书的接口调整</h4><p v-for="c in transferPreview.changes" :key="c.slot">{{ c.slot }}：{{ c.before }} → {{ c.after }}；型号 {{ c.model }}；参数 → 自动</p><p>确认时核对本书与全局接口版本，先保留旧模型配置；原私有密钥不会删除。请核对目标 API 支持这些型号。</p><div class="model-actions"><ArchiveAction variant="primary" :disabled="pending || dirty" data-testid="confirm-transfer-global" @click="confirmTransfer">确认转用并保存</ArchiveAction><ArchiveAction :disabled="pending" @click="transferPreview = null">取消</ArchiveAction></div></section>
      <details v-if="page === 'connection'" class="model-private"><summary>恢复旧私有配置 / 加入全局库</summary><p>推荐转用已经保存的全局接口。下方创建入口仅用于全局库尚无对应接口时；旧私有密钥保留，供恢复旧配置。</p><div v-for="c in privateConnections" :key="c.id" class="model-actions"><label class="model-check"><input v-model="reuseIds" type="checkbox" :value="c.originalId" :disabled="pending">{{ c.name }} <span class="model-endpoint">{{ c.baseUrl }}</span></label><ArchiveAction :disabled="pending" @click="editPrivate(c)">恢复旧私有配置…</ArchiveAction></div><p v-if="!privateConnections.length">本书没有可复用的私有接口。</p><ArchiveAction :disabled="pending || !reuseIds.length" data-testid="preview-global-reuse" @click="previewReuse">预览加入全局库</ArchiveAction>
        <fieldset v-if="privateForm" :disabled="pending" class="model-edit-form"><legend>仅修改本书</legend><p>名称和密钥分别保存。地址保持不变；更换服务地址请新增全局接口后明确选择。</p><ArchiveFormField label="本书私有接口名称" v-slot="{ controlProps }"><input v-bind="controlProps" v-model="privateForm.name" maxlength="80"></ArchiveFormField><ArchiveAction :disabled="privateForm.name === privateForm.originalName" @click="savePrivate(false)">仅保存名称</ArchiveAction><ArchiveFormField label="本书私有 API Key" help="不回显已存密钥；不会改动已复用到全局库的密钥。" v-slot="{ controlProps }"><input v-bind="controlProps" v-model="privateForm.apiKey" type="password" autocomplete="new-password" maxlength="4096" :disabled="privateForm.clearApiKey"></ArchiveFormField><label class="model-check"><input v-model="privateForm.clearApiKey" type="checkbox" :disabled="Boolean(privateForm.apiKey)">明确清除本书私有密钥</label><div class="model-actions"><ArchiveAction :disabled="!privateForm.apiKey && !privateForm.clearApiKey" @click="savePrivate(true)">仅保存密钥变更</ArchiveAction><ArchiveAction @click="privateForm.apiKey = ''; privateForm = null">取消私有接口编辑</ArchiveAction></div></fieldset>
      </details>
      <section v-if="reusePreview" class="model-review" data-testid="global-reuse-preview"><h4>确认复用这些接口？</h4><p>只在本机全局库新增连接。原书、原密钥和原分配都不变。</p><p v-for="c in reusePreview.connections" :key="c.sourceConnectionId">{{ c.name }} · {{ c.baseUrl }} · {{ c.credentialState === 'stored' ? '可复用已存密钥' : '密钥暂不可用' }}</p><div class="model-actions"><ArchiveAction variant="primary" :disabled="pending" @click="confirmReuse">确认加入全局库</ArchiveAction><ArchiveAction :disabled="pending" @click="reusePreview = null; api.cancelPreviews()">取消</ArchiveAction></div></section>

    </details>

    <div v-if="dirty && !pending && !probeBusy" class="draft-actions"><span role="status">有未保存的修改</span><ArchiveAction compact @click="cancelEdit(); privateForm = null; load()">放弃本页修改</ArchiveAction></div>
  </div>
</template>

<style scoped>
.global-model-settings { display:grid; gap:16px; container-type:inline-size; font-size:var(--form-text); line-height:1.6; min-width:0; }
.model-section-header { display:flex; gap:16px; justify-content:space-between; align-items:center; }
h3,h4,p { margin:0; } h3 { font-size:var(--form-heading,20px); } p { font-size:var(--form-help,14px); }
.model-section-header p { color:var(--muted); }
.archive-kicker { display:block; color:var(--muted); font:9px/1.5 var(--sans); letter-spacing:.12em; }
.model-review, .model-edit-form fieldset { border:1px solid var(--line-strong); padding:20px; display:grid; gap:16px; min-width:0; background:var(--surface); }
.model-edit-form fieldset { margin:0; border-top:3px solid #eaa247; }
.form-legend { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
.connection-form-heading { margin:-20px -20px 0; padding:18px 20px; background:#25372c; color:#f5f3eb; }.connection-form-heading .archive-kicker { color:#ecb365; }.connection-form-heading h4 { margin-top:6px; color:#f5f3eb; font:600 24px/1.4 var(--serif); }
.model-endpoint, td, li { overflow-wrap:anywhere; }
.model-notice { border:1px solid var(--line); border-left:3px solid var(--jade); padding:10px 14px; background:var(--surface); font-size:13px; }
.model-notice.error { border-left-color:var(--danger); }
.model-defaults .error { color:var(--danger); }
.model-fields { display:grid; gap:18px; grid-template-columns:repeat(2,minmax(0,1fr)); }
.model-fields > :nth-child(n+3) { grid-column:1/-1; }
.model-actions { display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
.model-check { display:flex; align-items:center; gap:10px; flex-wrap:wrap; } .model-check input { width:auto; }
input, select { width:100%; min-width:0; min-height:var(--form-control-height,40px); }
input:not([type=checkbox]), select { background:var(--surface); color:var(--ink); border:1px solid var(--line-strong); border-radius:0; padding:8px 10px; font:inherit; }
input[type=checkbox] { min-height:20px; }
input:focus-visible, select:focus-visible, summary:focus-visible { outline:2px solid var(--jade); outline-offset:2px; }
details { border-top:1px solid var(--line); padding-top:12px; }
details > :not(summary) { margin-top:16px; }
summary { cursor:pointer; font-weight:600; padding-block:8px; }
.model-defaults > summary,.model-private > summary { font:600 16px/1.5 var(--serif); }
.model-defaults > summary > span { font:12px/1.5 var(--sans); color:var(--muted); }
.model-catalog { max-height:240px; overflow:auto; }
table { width:100%; border-collapse:collapse; table-layout:fixed; } th,td { text-align:left; padding:8px; border-bottom:1px solid var(--line); }
.connection-workspace { display:grid; grid-template-columns:minmax(180px,220px) minmax(0,1fr); gap:20px; min-width:0; }
.connection-index { display:flex; flex-direction:column; gap:10px; min-width:0; border-top:2px solid var(--ink); }
.connection-index-heading { display:flex; gap:10px; align-items:center; justify-content:space-between; padding:14px 0 10px; border-bottom:1px solid var(--line); }
.connection-index-heading b { display:block; margin-top:3px; font:600 20px/1.4 var(--serif); }
.connection-index-heading small { color:var(--muted); font:12px var(--sans); margin-left:4px; }
.connection-select { position:relative; width:100%; text-align:left; display:grid; gap:6px; padding:16px; border:1px solid var(--line); background:var(--surface); color:var(--ink); font:inherit; cursor:pointer; overflow-wrap:anywhere; }
.connection-select b { font:600 16px/1.4 var(--serif); }
.connection-select span, .connection-select small { color:var(--muted); font-size:11px; }
.connection-select.selected { border-color:#698573; background:#26372d; color:#f5f3eb; box-shadow:inset 3px 0 #eaa247; }
.connection-select.selected span,.connection-select.selected small { color:#c4d0c6; }
.connection-select.selected::after { content:'↗'; position:absolute; right:10px; top:10px; color:#eaa247; font-size:12px; }
.connection-select:focus-visible { outline:2px solid var(--jade); outline-offset:2px; }
.connection-select:disabled { cursor:default; }
.connection-detail { min-width:0; display:flex; flex-direction:column; align-items:stretch; gap:14px; }
.connection-dossier { position:relative; padding:22px 24px 18px; border:4px double #809d8c; color:#f5f3eb; background:linear-gradient(#c7d6cd08 1px,transparent 1px),linear-gradient(90deg,#c7d6cd08 1px,transparent 1px),linear-gradient(115deg,#303d37,#19241f 75%); background-size:48px 48px,48px 48px,auto; }
.connection-dossier .archive-kicker { color:#ecb365; }
.connection-detail-heading { display:flex; gap:14px; align-items:center; justify-content:space-between; padding-left:12px; border-left:3px solid #eaa247; }
.connection-detail-heading > div { min-width:0; }
.connection-detail-heading h4 { margin-top:6px; color:#f5f3eb; font:600 28px/1.3 var(--serif); overflow-wrap:anywhere; }
.global-model-settings .connection-detail-heading button.archive-action.control-button { flex:none; color:#d3e0d5; background:transparent; border-color:#a2b8a855; font-size:12px; }
.global-model-settings .connection-detail-heading button.archive-action.control-button:hover { background:#d3e0d515; color:#f5f3eb; border-color:#91aa99; }
.connection-facts { display:grid; grid-template-columns:minmax(0,1fr) minmax(100px,.6fr); margin-top:24px; border-block:1px solid #a2b8a836; }
.connection-facts > div { display:grid; gap:5px; padding:12px 0; }
.connection-facts > div + div { padding-left:22px; border-left:1px solid #a2b8a836; }
.connection-facts span,.connection-address > span { color:#b2c2b7; font-size:11px; }
.connection-facts b { font:500 14px/1.5 var(--sans); }
.connection-address { display:grid; gap:4px; padding-top:14px; }
.connection-address p { color:#f5f3eb; font-size:13px; }
.connection-dossier .credential-status { margin-top:12px; padding-top:12px; border-top:1px solid #a2b8a836; color:#b2c2b7; font-size:11px; }
.connection-next-actions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
.global-model-settings button.connection-step.archive-action { display:flex; justify-content:space-between; align-items:center; gap:12px; min-height:76px; padding:14px 16px; border-radius:0; text-align:left; white-space:normal; }
.connection-step > span:first-child { display:grid; gap:4px; }
.connection-step b { font:600 19px/1.3 var(--serif); }
.connection-step small { font:11px/1.4 var(--sans); opacity:.8; }
.connection-step > span:last-child { flex:none; font-size:22px; padding-left:14px; border-left:1px solid currentColor; }
.global-model-settings button.connection-step.inspect.control-button { background:var(--surface); color:var(--ink); border-color:var(--line-strong); }
.global-model-settings button.connection-step.assign.control-button { background:#efa348; color:#202722; border-color:#d8933f; }
.global-model-settings button.connection-step.assign.control-button:hover:not(:disabled) { background:#ffb760; color:#202722; border-color:#d8933f; }
.connection-empty { position:relative; min-height:310px; padding:32px; display:flex; flex-direction:column; align-items:flex-start; justify-content:center; gap:18px; border:4px double #809d8c; color:#f5f3eb; background:linear-gradient(#c7d6cd08 1px,transparent 1px),linear-gradient(90deg,#c7d6cd08 1px,transparent 1px),#25332b; background-size:48px 48px; }
.connection-empty .archive-kicker { color:#ecb365; }
.connection-empty h4 { color:#f5f3eb; font:600 30px/1.4 var(--serif); }
.connection-empty > p { color:#c4d0c6; max-width:30em; }
.global-model-settings .connection-empty button.archive-action.primary { border:1px solid #d8933f; border-radius:0; background:#efa348; color:#202722; }
.global-model-settings .connection-empty button.archive-action.primary:hover:not(:disabled) { background:#ffb760; color:#202722; border-color:#d8933f; }
.empty-copy,.detail-help { color:var(--muted); font-size:12px; }
.connection-maintenance { margin-top:2px; }
.connection-maintenance summary { color:var(--muted); font-size:12px; font-weight:400; }
.book-model-actions { position:sticky; bottom:-32px; z-index:8; display:flex; flex-wrap:wrap; gap:12px; align-items:center; justify-content:space-between; padding:14px 16px; border:1px solid var(--line-strong); border-left:3px solid #eaa247; background:var(--surface); box-shadow:0 -4px 16px color-mix(in srgb,var(--ink) 5%,transparent); }
.global-model-settings .book-model-actions button.archive-action.primary { background:#efa348; border-color:#d8933f; color:#202722; border-radius:0; }
.global-model-settings .book-model-actions button.archive-action.primary:hover:not(:disabled) { background:#ffb760; color:#202722; border-color:#d8933f; }
.save-state { display:flex; align-items:center; gap:7px; color:var(--muted); font-size:12px; }
.save-state::before { content:''; width:5px; height:5px; background:currentColor; }
.draft-actions { display:flex; flex-wrap:wrap; gap:12px; align-items:center; justify-content:space-between; }
.draft-actions > span { color:var(--muted); font-size:var(--form-help); }
@container (max-width:760px) { .connection-workspace { grid-template-columns:minmax(0,1fr); gap:16px; }.connection-index { flex-direction:row; flex-wrap:wrap; gap:8px; }.connection-index-heading { width:100%; padding:8px 0; }.connection-index-heading > div { display:flex; align-items:baseline; gap:12px; }.connection-index-heading .archive-kicker { display:none; }.connection-index article { min-width:0; flex:1 1 180px; }.connection-select { padding:10px 14px; gap:3px; }.connection-select small { display:none; }.connection-index .empty-copy { padding-block:8px; } }
@container (max-width:600px) { .model-fields { grid-template-columns:minmax(0,1fr); }.model-section-header { flex-wrap:wrap; gap:8px; }.connection-dossier { padding:18px; }.connection-detail-heading { flex-wrap:wrap; }.connection-detail-heading h4 { font-size:24px; }.global-model-settings button.connection-step.archive-action { padding:12px; gap:8px; }.connection-step b { font-size:17px; }.connection-step > span:last-child { padding-left:8px; }.connection-empty { padding:24px; }.book-model-actions { bottom:-20px; padding:12px; }.global-model-settings .book-model-actions button.archive-action { font-size:12px; } }
@container (max-width:380px) { .connection-next-actions { grid-template-columns:minmax(0,1fr); }.global-model-settings button.connection-step.archive-action { min-height:64px; } }
</style>
