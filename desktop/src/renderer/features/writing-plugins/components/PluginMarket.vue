<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { categoryLabel, pluginCategories, type MarketQuery, type MarketRelease } from '@lanjian/writing-plugin-contracts'
import ArchiveAction from '../../../ui/ArchiveAction.vue'
import StudioIcon from '../../../ui/StudioIcon.vue'
import { pluginError } from '../plugin-error'
import { capabilityLabels, effectLabels, stageLabels } from '../plugin-labels'
import type { BundledPlugin } from '../../../../contracts/writing-plugins/bundled'
import type { MarketStatus } from '../../../../contracts/writing-plugins/marketplace'
import type { PluginInstallPreview, PluginManagementView, WritingPluginsApi } from '../../../../contracts/writing-plugins/management-contracts'

const props = defineProps<{ api: WritingPluginsApi; installed: PluginManagementView | null; active?: boolean; local?: boolean }>()
const emit = defineEmits<{ preview: [preview: PluginInstallPreview]; create: []; library: []; derived: [id: string]; manage: [id: string, digest: string] }>()
type CatalogEntry = MarketRelease | BundledPlugin
const isBundled = (entry: CatalogEntry): entry is BundledPlugin => 'origin' in entry
const entryKey = (entry: CatalogEntry) => isBundled(entry) ? entry.manifest.id : entry.operationId
const sourceLabel = (entry: CatalogEntry) => isBundled(entry) ? '官方 · 随应用提供' : entry.distribution === 'official' ? '官方' : '社区'
const detailTitleId = props.local ? 'bundled-detail-title' : 'market-detail-title'
const status = ref<MarketStatus | null>(null), page = ref<{ releases: CatalogEntry[]; nextOffset: number | null } | null>(null)
const selected = ref<CatalogEntry | null>(null), versions = ref<CatalogEntry[]>([])
const busy = ref(false), error = ref(''), notice = ref(''), composing = ref(false), recordsOpen = ref(false)
const query = ref(''), categories = ref<string[]>([]), tags = ref(''), extraCategories = ref('')
const source = ref<MarketQuery['source']>('all'), applied = ref<MarketQuery | null>(null), lastFetched = ref('')
const previousOffsets = ref<number[]>([])
const versionOffset = ref(0), nextVersions = ref<number | null>(null)
const detailHeading = ref<HTMLElement | null>(null), catalog = ref<HTMLElement | null>(null)
const detailDialog = ref<HTMLDialogElement | null>(null)
const closingDetail = ref(false)
let alive = true, timer: ReturnType<typeof setTimeout> | undefined, detailOperation = '', detailEpoch = 0
const labels = { uploading: '待上传', validating: '自动校验中', published: '已公开', 'validation-failed': '校验失败', withdrawn: '已下架' }
const sources = [{ id: 'all', name: '全部来源' }, { id: 'official', name: '官方' }, { id: 'community', name: '社区' }] as const
const categoryIcons: Record<string, string> = { genre: 'definition', style: 'manuscript', workflow: 'events', worldbuilding: 'world', characters: 'definition', plot: 'outline', research: 'research', review: 'research', interaction: 'spark', format: 'manuscript', tools: 'settings' }
const changes = computed(() => {
  const release = selected.value, plugin = props.installed?.plugins.find(p => p.id === release?.manifest.id)
  if (!release || !plugin) return ''
  const current = plugin.versions.find(v => v.digest === plugin.current)!
  return plugin.versions.some(v => v.digest === release.digest) ? '此版本已经安装，可在“已安装”中管理。' : `本机当前为 ${current.manifest.version}。安装此版本后，可在“已安装”中核对权限并切换。`
})
const isMyRelease = (entry: CatalogEntry) => !isBundled(entry) && status.value?.auth.state === 'signed-in' && entry.publisherId === status.value.auth.publisherId
const isInstalled = (release: CatalogEntry) => props.installed?.plugins.some(p => p.id === release.manifest.id && p.versions.some(v => v.digest === release.digest))
const split = (value: string) => value.split(/[,，]/).map(s => s.trim()).filter(Boolean)
const filters = (offset = 0): MarketQuery => ({ query: query.value.trim(), categories: [...new Set([...categories.value, ...split(extraCategories.value)])], tags: [...new Set(split(tags.value))], source: source.value, offset, limit: 10 })
const unapplied = computed(() => applied.value && JSON.stringify(filters(applied.value.offset)) !== JSON.stringify(applied.value))
const appliedDescription = computed(() => {
  const value = applied.value
  if (!value) return ''
  return [value.query && `“${value.query}”`, value.source !== 'all' && sources.find(s => s.id === value.source)?.name, ...value.categories.map(id => categoryLabel(id)), ...value.tags.map(t => `#${t}`)].filter(Boolean).join(' · ') || '全部插件'
})
async function act(operation: () => Promise<void>, current = () => alive) {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try { await operation() } catch (cause) { if (current()) error.value = pluginError(cause, '插件操作失败，请重试。') }
  finally { if (alive) busy.value = false }
}
async function refreshStatus() {
  if (props.local) return
  const result = await props.api.marketStatus()
  if (!alive) return
  status.value = result; scheduleAuthPoll()
}
function scheduleAuthPoll() {
  clearTimeout(timer)
  if (status.value?.auth.state === 'waiting' && props.active !== false) timer = setTimeout(() => { if (busy.value) scheduleAuthPoll(); else void act(refreshStatus) }, 1500)
}
async function retry() {
  if (props.local) await search()
  else if (!status.value) await act(async () => { await refreshStatus(); if (status.value?.available) await loadCatalog() })
  else if (selected.value) await detail(selected.value, versionOffset.value)
  else await search()
}
async function loadCatalog(offset = 0) {
  const request = filters(offset)
  let result: { releases: CatalogEntry[]; nextOffset: number | null }
  if (props.local) {
    const entries = (await props.api.bundledPlugins()).filter(p => {
      const m = p.manifest
      return `${m.name} ${m.description} ${(m.tags ?? []).join(' ')}`.toLocaleLowerCase().includes(request.query.toLocaleLowerCase()) && request.categories.every(c => m.categoryIds?.includes(c)) && request.tags.every(t => m.tags?.includes(t))
    })
    result = { releases: entries.slice(offset, offset + request.limit), nextOffset: offset + request.limit < entries.length ? offset + request.limit : null }
  } else result = await props.api.marketCatalog(request)
  if (!alive) return
  if (!offset) previousOffsets.value = []
  else if (applied.value && offset > applied.value.offset) previousOffsets.value.push(applied.value.offset)
  else if (previousOffsets.value.at(-1) === offset) previousOffsets.value.pop()
  page.value = result; applied.value = request; lastFetched.value = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
async function search(offset = 0) { if (!composing.value) await act(() => loadCatalog(offset)) }
async function chooseCategory(id: string) {
  if (busy.value || composing.value) return
  categories.value = categories.value.includes(id) ? categories.value.filter(c => c !== id) : [...categories.value, id]
  await search()
}
async function clearFilters() {
  if (busy.value || composing.value) return
  query.value = ''; categories.value = []; tags.value = ''; extraCategories.value = ''; source.value = 'all'; await search()
}
async function detail(release: CatalogEntry, offset = 0, trigger?: EventTarget | null) {
  if (busy.value) return
  const epoch = ++detailEpoch, current = () => alive && epoch === detailEpoch
  if (trigger instanceof HTMLElement) {
    detailOperation = entryKey(release); selected.value = release; versions.value = []; versionOffset.value = 0; nextVersions.value = null
  }
  await act(async () => {
    if (isBundled(release)) { versions.value = [release]; selected.value = release; return }
    const result = await props.api.marketVersions(release.manifest.id, { query: '', categories: [], tags: [], source: 'all', offset, limit: 10 })
    if (!current()) return
    const found = result.releases.find(v => v.operationId === release.operationId) ?? result.releases[0]
    if (!found) { error.value = '该插件暂无可下载的公开版本，请刷新列表。'; return }
    selected.value = found; versions.value = result.releases; versionOffset.value = offset; nextVersions.value = result.nextOffset
  }, current)
}
async function back() {
  if (closingDetail.value) return
  const epoch = ++detailEpoch
  if (detailDialog.value?.open) {
    closingDetail.value = true
    await nextTick()
    await Promise.allSettled(detailDialog.value.getAnimations({ subtree: true }).map(animation => animation.finished))
    if (!alive || epoch !== detailEpoch) return
    detailDialog.value.close()
  }
  closingDetail.value = false; selected.value = null; recordsOpen.value = false; error.value = ''
  await nextTick()
  const trigger = Array.from(catalog.value?.querySelectorAll<HTMLElement>('[data-release-id]') ?? []).find(el => el.dataset.releaseId === detailOperation)
  ;(trigger && !trigger.matches(':disabled') ? trigger : catalog.value)?.focus({ preventScroll: true })
}
async function download() {
  if (closingDetail.value) return
  const release = selected.value, epoch = detailEpoch, current = () => alive && epoch === detailEpoch
  // Snapshot before contextBridge: Vue proxies are rejected on entry.
  if (release && versions.value.length) await act(async () => {
    const preview = isBundled(release) ? await props.api.previewBundledPlugin({ pluginId: release.manifest.id, digest: release.digest }) : await props.api.previewDownload(JSON.parse(JSON.stringify(release)))
    if (current()) { detailDialog.value?.close(); emit('preview', preview) }
  }, current)
}
async function copyPersonal() {
  const release = selected.value, epoch = detailEpoch
  if (!release || !isBundled(release) || closingDetail.value) return
  await act(async () => {
    const draft = await props.api.deriveBundledPlugin({ pluginId: release.manifest.id, digest: release.digest })
    if (alive && epoch === detailEpoch && props.active !== false) { detailDialog.value?.close(); selected.value = null; emit('derived', draft.id) }
  })
}
function manageInstalled() {
  const release = selected.value
  if (!release || busy.value || closingDetail.value || !isInstalled(release)) return
  ++detailEpoch; detailDialog.value?.close(); selected.value = null
  emit('manage', release.manifest.id, release.digest)
}
async function login() { await act(async () => { await props.api.marketLogin(); await refreshStatus(); if (alive) notice.value = '请在系统浏览器完成登录，再返回这里。' }) }
async function operation(id: string, kind: 'refresh' | 'retry' | 'withdraw') {
  await act(async () => {
    const result = await (kind === 'refresh' ? props.api.refreshPublication(id) : kind === 'retry' ? props.api.retryPublication(id) : props.api.withdrawPublication(id))
    await refreshStatus()
    if (alive) { notice.value = `版本${labels[result.state]}。`; if (kind === 'withdraw') { page.value = null; selected.value = null; await loadCatalog() } }
  })
}
onMounted(() => { void act(async () => { await refreshStatus(); if (alive && (props.local || status.value?.available)) await loadCatalog() }) })
watch(() => props.active, active => { if (active) void act(refreshStatus); else { ++detailEpoch; clearTimeout(timer) } })
// Keep the catalog mounted. Native dialog supplies focus containment and an inert
// background; explicitly leave the top layer while the install preview is shown.
watch([selected, () => props.active], async () => {
  await nextTick()
  if (!alive) return
  if (selected.value && props.active !== false) {
    if (!detailDialog.value?.open) { detailDialog.value?.showModal(); detailHeading.value?.focus({ preventScroll: true }) }
  } else {
    if (closingDetail.value) selected.value = null
    detailDialog.value?.close(); closingDetail.value = false
  }
})
onBeforeUnmount(() => { alive = false; ++detailEpoch; clearTimeout(timer); detailDialog.value?.close() })
</script>

<template>
  <section class="plugin-market" :data-testid="local ? 'plugin-library' : 'plugin-market'" :aria-busy="busy" @compositionstart="composing = true" @compositionend="composing = false">
    <header class="market-heading">
      <p class="muted">{{ local ? '随应用提供的官方插件，无需市场服务器。选择安装，或复制为自己的版本。' : '发现适合自己的题材、文风、流程与写作工具。' }}</p>
      <div v-if="status?.available" class="account-actions">
        <button v-if="status.auth.state === 'signed-in'" type="button" class="text-button" :disabled="busy" :aria-pressed="recordsOpen" @click="recordsOpen = !recordsOpen; selected = null; act(refreshStatus)">我的发布</button>
        <button v-if="status.auth.state === 'signed-in'" type="button" class="text-button muted" :disabled="busy" @click="act(async () => { await api.marketLogout(); recordsOpen = false; await refreshStatus() })">退出账号</button>
        <button v-else type="button" class="text-button" :disabled="busy || status.auth.state === 'waiting'" @click="login">{{ status.auth.state === 'waiting' ? '等待浏览器登录…' : '登录以发布' }}</button>
        <ArchiveAction compact :disabled="busy" @click="emit('create')"><StudioIcon name="plus" :size="14" />创建插件</ArchiveAction>
      </div>
    </header>
    <p v-if="error && !selected" role="alert" class="message error">{{ error }}<span v-if="page"> 已保留 {{ lastFetched }} 的查询结果。</span><button class="text-button" type="button" :disabled="busy" @click="retry">重试</button></p>
    <p v-if="status?.auth.state === 'failed'" role="alert" class="message">登录未完成或已过期，可以重新打开系统浏览器登录。</p>
    <p v-if="notice" role="status" class="message">{{ notice }}</p>
    <p v-if="!local && !status && !error" role="status" class="muted">正在读取市场状态…</p>
    <div v-if="!local && status && !status.available" class="market-empty disconnected">
      <div class="empty-mark"><StudioIcon name="definition" :size="30" /></div>
      <p class="market-kicker">创作始终可以继续</p><h4>公共市场尚未连接</h4>
      <p>公共市场用于在线分享与下载；本地插件库、我的创作和已安装插件不受影响。</p>
      <div class="actions"><ArchiveAction variant="primary" @click="emit('library')">浏览本地插件库</ArchiveAction><ArchiveAction @click="emit('create')">创建我的插件</ArchiveAction><ArchiveAction :disabled="busy" @click="act(async () => { await refreshStatus(); if (status?.available) await loadCatalog() })">重新检查</ArchiveAction></div>
    </div>
    <template v-if="local || status?.available">
      <section v-if="recordsOpen && status" class="publications">
        <button type="button" class="text-button back-button" @click="back"><StudioIcon name="undo" :size="15" />返回市场</button>
        <div class="section-heading"><h4>我的发布</h4><button type="button" class="text-button" :disabled="busy" @click="act(refreshStatus)">刷新状态</button></div>
        <p class="muted">在“我的创作”中编辑插件，核对发布预览后提交。自动校验通过即可公开。</p>
        <p v-if="!status.pending.length && !status.publications.length" class="market-empty">还没有发布记录。先把你的写作方法做成一个插件。</p>
        <article v-for="pending in status.pending" :key="pending.operationId" class="publication-row"><div><strong>{{ pending.name }}</strong><small>{{ pending.version }} · 结果待确认</small></div><div class="actions"><ArchiveAction compact :disabled="busy" @click="operation(pending.operationId, 'refresh')">查询状态</ArchiveAction><ArchiveAction compact :disabled="busy" @click="operation(pending.operationId, 'retry')">查询后继续上传</ArchiveAction></div></article>
        <article v-for="release in status.publications" :key="entryKey(release)" class="publication-row"><div><strong>{{ release.manifest.name }}</strong><small>{{ release.manifest.version }} · {{ labels[release.state] }}</small><p v-if="release.failure" class="muted">包校验失败或上传中断，请修改后使用新版本号。</p></div><div class="actions"><ArchiveAction compact :disabled="busy" @click="operation(release.operationId, 'refresh')">查询状态</ArchiveAction><ArchiveAction v-if="release.state === 'published'" compact :disabled="busy" @click="operation(release.operationId, 'withdraw')">下架此版本</ArchiveAction></div></article>
      </section>
      <div v-else class="market-browser">
        <form class="market-search" @submit.prevent="search()"><div class="search-input"><StudioIcon name="search" :size="18" /><input v-model="query" :disabled="busy" maxlength="200" :aria-label="local ? '本地插件关键词' : '市场关键词'" placeholder="搜索插件、题材或写作方法" /></div><ArchiveAction type="submit" variant="primary" :disabled="busy || composing">查找插件</ArchiveAction></form>
        <div class="market-filters">
          <div v-if="!local" class="filter-row"><span class="filter-label">来源</span><div class="filter-options"><button v-for="item in sources" :key="item.id" type="button" :aria-pressed="source === item.id" :disabled="busy || composing" @click="source = item.id; search()">{{ item.name }}</button></div></div>
          <div class="filter-row"><span class="filter-label" title="同时匹配所选分类">分类<small>可多选</small></span><div class="filter-options categories"><button type="button" :aria-pressed="!categories.length && !extraCategories.trim()" :disabled="busy || composing" @click="categories = []; extraCategories = ''; search()">全部</button><button v-for="category in pluginCategories" :key="category.categoryId" type="button" :aria-pressed="categories.includes(category.categoryId)" :disabled="busy || composing" @click="chooseCategory(category.categoryId)">{{ category.name }}</button></div></div>
          <details class="advanced-filters"><summary>更多筛选<span v-if="tags.trim() || extraCategories.trim()"> · 已填写</span></summary><form class="advanced-fields" @submit.prevent="search()"><label>标签<input v-model="tags" :disabled="busy" maxlength="983" placeholder="例如：仙侠，慢节奏" /></label><label>扩展分类<input v-model="extraCategories" :disabled="busy" maxlength="1295" placeholder="输入分类 ID，多个用逗号分隔" /></label><ArchiveAction type="submit" compact :disabled="busy || composing">应用筛选</ArchiveAction></form></details>
        </div>
        <div class="results-heading"><div><h4>{{ appliedDescription || '发现插件' }}</h4><p class="muted">{{ busy ? '正在查找…' : page ? `本页 ${page.releases.length} 个插件` : '浏览与下载无需登录' }}<span v-if="lastFetched"> · {{ lastFetched }} 更新</span></p></div><button v-if="query || categories.length || tags || extraCategories || source !== 'all'" type="button" class="text-button" :disabled="busy || composing" @click="clearFilters">清空筛选</button></div>
        <p v-if="unapplied" class="muted" role="status">筛选已修改，点击“查找插件”应用。当前仍显示上次结果。</p>
        <div ref="catalog" class="catalog" tabindex="-1" :aria-label="local ? '本地插件列表' : '市场插件列表'" data-testid="market-catalog">
          <button v-for="release in page?.releases ?? []" :key="entryKey(release)" type="button" :disabled="busy" class="catalog-item" aria-haspopup="dialog" :data-release-id="entryKey(release)" @click="detail(release, 0, $event.currentTarget)"><span class="card-heading"><span class="plugin-mark"><StudioIcon :name="categoryIcons[release.manifest.categoryIds?.[0] ?? 'tools'] || 'definition'" :size="22" /></span><span class="card-identity"><span class="source-label">{{ sourceLabel(release) }}<span v-if="isMyRelease(release)"> · 我发布的</span></span><strong :title="release.manifest.name">{{ release.manifest.name }}</strong></span><StudioIcon name="chevron-right" :size="16" /></span><span class="card-description">{{ release.manifest.description }}</span><span class="card-footer"><span class="card-categories">{{ release.manifest.categoryIds?.map(id => categoryLabel(id)).join(' · ') || '写作插件' }}</span><small>{{ isInstalled(release) ? '已安装' : `v${release.manifest.version}` }}</small></span></button>
        </div>
        <div v-if="page && !page.releases.length && !busy" class="market-empty"><StudioIcon name="search" :size="28" /><h4>没有找到匹配的插件</h4><p>换一个关键词，或减少筛选条件再试试。</p><button type="button" class="text-button" @click="clearFilters">查看全部插件</button></div>
        <div v-if="page && (applied?.offset || page.nextOffset !== null)" class="pagination"><ArchiveAction compact :disabled="busy || !applied?.offset || !!unapplied" @click="search(previousOffsets.at(-1) ?? 0)">上一页</ArchiveAction><span>第 {{ previousOffsets.length + 1 }} 页</span><ArchiveAction compact :disabled="busy || page.nextOffset === null || !!unapplied" @click="search(page.nextOffset!)">下一页</ArchiveAction></div>
        <footer class="market-footnote"><StudioIcon name="definition" :size="15" /><span>{{ local ? '随应用提供，无需下载 · 安装后，由你决定开放哪些能力。' : '浏览与下载无需登录 · 安装后，由你决定开放哪些能力。' }}</span></footer>
      </div>
      <dialog ref="detailDialog" class="detail" :class="{ 'detail-closing': closingDetail }" :data-testid="local ? 'bundled-detail' : 'market-detail'" :aria-labelledby="detailTitleId" :aria-busy="busy" @cancel.prevent="back" @keydown.esc.stop>
        <template v-if="selected">
        <header class="detail-header"><div class="detail-title"><span class="plugin-mark"><StudioIcon :name="categoryIcons[selected.manifest.categoryIds?.[0] ?? 'tools'] || 'definition'" :size="26" /></span><div><p class="market-kicker">{{ sourceLabel(selected) }}<span v-if="isMyRelease(selected)"> · 我发布的</span></p><h3 :id="detailTitleId" ref="detailHeading" tabindex="-1">{{ selected.manifest.name }}</h3><div class="chips"><span v-for="id in selected.manifest.categoryIds" :key="id">{{ categoryLabel(id) }}</span><span v-for="tag in selected.manifest.tags" :key="tag">#{{ tag }}</span></div></div></div><button type="button" class="detail-close" aria-label="关闭插件详情" @click="back"><StudioIcon name="close" :size="18" /></button></header>
        <div class="detail-scroll">
          <p v-if="error" role="alert" class="message error">{{ error }}<button class="text-button" type="button" :disabled="busy" @click="retry">重试</button></p>
          <p v-if="busy" role="status" class="muted">正在读取插件内容…</p>
        <div class="detail-layout">
          <div class="detail-content">
            <p class="description">{{ selected.manifest.description }}</p>
            <section class="detail-section"><h4>它能怎样帮助写作</h4><ul class="impact-list"><li v-for="tool in selected.manifest.tools" :key="tool.id"><span>{{ tool.description }}</span><small>{{ effectLabels[tool.effect] || tool.effect }}</small></li><li v-for="contribution in selected.manifest.contributions ?? []" :key="contribution.id"><span>{{ contribution.name }}</span><small>{{ contribution.stages.map(stage => stageLabels[stage] || stage).join(' · ') }}</small><details v-if="contribution.kind === 'context-fragment'" class="guidance-preview"><summary>查看完整写作指导</summary><p>{{ contribution.text }}</p></details><p v-if="contribution.requires?.length" class="muted">需要搭配：<span v-for="dep in contribution.requires" :key="`${dep.pluginId}.${dep.contributionId}`">{{ dep.pluginId }} / {{ dep.contributionId }} </span></p><p v-if="contribution.exclusiveGroup" class="muted">与同组贡献互斥：{{ contribution.exclusiveGroup }}</p></li></ul><p v-if="!selected.manifest.tools.length && !selected.manifest.contributions?.length" class="muted">此版本尚未声明写作工具或贡献。</p></section>
            <section class="detail-section"><h4>需要你允许的能力</h4><ul class="permission-list"><li v-for="cap in selected.manifest.capabilities" :key="cap">{{ capabilityLabels[cap] || cap }}</li></ul><p v-if="!selected.manifest.capabilities.length" class="muted">无需额外权限。</p></section>
            <details class="technical-details"><summary>版本与来源信息</summary><p v-if="!isBundled(selected) && selected.upstream">派生自 {{ selected.upstream.pluginId }} · {{ selected.upstream.version }}</p><p>插件标识：{{ selected.manifest.id }}</p><p>版本摘要</p><code>{{ selected.digest }}</code></details>
          </div>
          <aside class="install-card" aria-label="下载此版本">
            <h4>安装到岚笺</h4><label>{{ local ? '随应用版本' : '公开版本' }}<select :value="entryKey(selected)" :disabled="busy" @change="selected = versions.find(v => entryKey(v) === ($event.target as HTMLSelectElement).value) ?? selected"><option v-for="version in versions" :key="entryKey(version)" :value="entryKey(version)">{{ version.manifest.version }}</option></select></label>
            <div v-if="versionOffset || nextVersions !== null" class="actions"><button v-if="versionOffset" type="button" class="text-button" :disabled="busy" @click="detail(selected)">最新版本</button><button v-if="nextVersions !== null" type="button" class="text-button" :disabled="busy" @click="detail(selected, nextVersions!)">更早版本</button></div>
            <p v-if="changes" class="muted">{{ changes }}</p><ArchiveAction v-if="isInstalled(selected)" variant="primary" :disabled="busy" @click="manageInstalled">管理已安装</ArchiveAction><ArchiveAction v-else variant="primary" :disabled="busy || !versions.length" @click="download">{{ local ? '预览并安装' : '下载并预览安装' }}</ArchiveAction><ArchiveAction v-if="local" :disabled="busy" @click="copyPersonal">复制后修改</ArchiveAction>
            <p class="muted">先核对安装内容，再选择权限与适用作品。</p><p class="validation-note">{{ local ? '官方随应用提供 · 本地安装' : '包格式自动校验通过' }}<br /><span>{{ local ? '写作指导插件需在“这本书的写作组合”中选用；修改请创建个人副本。' : '未经人工审核；写作效果请试用判断。' }}</span></p>
          </aside>
        </div>
        </div>
        </template>
      </dialog>
    </template>
  </section>
</template>

<style scoped>
.guidance-preview{margin-top:10px;font-size:13px}.guidance-preview summary{cursor:pointer;color:var(--jade)}.guidance-preview p{margin-top:10px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8;border-left:2px solid var(--line);padding-left:12px}
.plugin-market{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;min-width:0;font:400 14px/1.6 var(--sans);color:var(--ink)}
h3,h4,p{margin:0}h3{font:600 24px/1.45 var(--serif);letter-spacing:.025em}h4{font:600 17px/1.5 var(--serif)}button,input,select{font:inherit}button{cursor:pointer}button:disabled{cursor:default;opacity:.5}:focus-visible{outline:2px solid var(--jade);outline-offset:3px}
.market-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}.market-heading>div:first-child{display:grid;gap:5px}.market-kicker{font-size:11px;letter-spacing:.12em;color:var(--jade)}.muted{color:var(--ink-muted);font-size:12px;line-height:1.7}.account-actions,.actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.text-button{border:0;padding:3px 0;background:none;color:var(--jade);font-size:12px;text-align:left}.text-button:hover{text-decoration:underline;text-underline-offset:4px}.message{padding:12px 16px;background:var(--paper);border-left:2px solid var(--jade);font-size:13px;overflow-wrap:anywhere}.message .text-button{margin-left:12px}.error{color:var(--danger,#b74536);border-color:currentColor}
.market-browser{display:grid;gap:12px;min-width:0}.market-search{display:flex;align-items:stretch;gap:10px}.search-input{display:flex;align-items:center;gap:10px;flex:1;min-width:0;border:1px solid var(--line-strong,var(--line));padding:0 14px;background:var(--surface);color:var(--ink-muted)}.search-input:focus-within{outline:2px solid var(--jade);outline-offset:2px}.search-input input{border:0;background:transparent;color:var(--ink);outline:none;min-width:0;width:100%;padding:8px 0;box-shadow:none}.market-filters{display:grid;gap:8px;padding-bottom:12px;border-bottom:1px solid var(--line)}.filter-row{display:flex;align-items:start;gap:18px}.filter-label{flex:0 0 42px;padding-top:5px;font-size:12px;color:var(--ink-muted)}.filter-label small{display:block;font-size:10px}.filter-options{display:flex;flex-wrap:wrap;gap:6px}.filter-options button{padding:3px 11px;border:1px solid transparent;background:transparent;color:var(--ink);font-size:12px;border-radius:2px}.filter-options button:hover{border-color:var(--line)}.filter-options button[aria-pressed=true]{color:var(--jade);background:color-mix(in srgb,var(--jade) 9%,transparent);border-color:color-mix(in srgb,var(--jade) 26%,transparent)}.advanced-filters{margin-left:60px;font-size:12px;color:var(--ink-muted)}summary{cursor:pointer;list-style-position:inside}.advanced-fields{display:flex;align-items:end;gap:12px;flex-wrap:wrap;padding-top:12px}.advanced-fields label{flex:1;min-width:150px}label{display:grid;gap:6px;font-size:12px}label input,select{width:100%;box-sizing:border-box;min-width:0;padding:8px 10px;border:1px solid var(--line);background:var(--surface);color:var(--ink)}
.results-heading,.section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.results-heading h4{font-size:16px}.results-heading>div{min-width:0;overflow-wrap:anywhere}.catalog{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr));gap:12px;min-width:0}.catalog-item{display:flex;flex-direction:column;gap:8px;padding:14px;text-align:left;border:1px solid var(--line);border-radius:var(--radius-panel,2px);background:var(--surface);color:var(--ink);min-width:0;overflow-wrap:anywhere;transition:border-color .15s,background .15s}.catalog-item:hover{border-color:var(--jade);background:var(--paper)}.catalog-item .plugin-mark{flex-basis:32px;width:32px;height:32px}.card-heading{display:flex;align-items:center;gap:10px;min-width:0}.card-heading>svg{margin-left:auto;flex-shrink:0;color:var(--ink-muted)}.plugin-mark{display:flex;align-items:center;justify-content:center;flex:0 0 44px;width:44px;height:44px;border:1px solid var(--line);background:var(--paper);color:var(--jade)}.card-identity{display:grid;gap:1px;min-width:0}.source-label{font-size:10px;letter-spacing:.08em;color:var(--ink-muted)}.card-identity strong{font:600 17px/1.4 var(--serif);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.card-description{font-size:12px;line-height:1.7;color:var(--ink-muted);display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}.card-footer{margin-top:auto;display:flex;align-items:end;justify-content:space-between;gap:12px;font-size:11px;color:var(--ink-muted)}.card-categories{display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}.card-footer small{flex-shrink:0;font-size:11px;color:var(--jade)}.pagination{display:flex;align-items:center;justify-content:center;gap:18px;font-size:12px;color:var(--ink-muted)}.market-footnote{display:flex;align-items:center;gap:8px;padding-top:8px;font-size:11px;color:var(--ink-muted)}
.market-empty{display:grid;justify-items:center;gap:14px;text-align:center;padding:46px 24px;border:1px solid var(--line);background:var(--paper);color:var(--ink-muted);font-size:13px}.market-empty h4{color:var(--ink);font-size:21px}.market-empty .actions{margin-top:8px}.empty-mark{color:var(--jade);padding:16px;border:1px solid var(--line);margin-bottom:4px}.disconnected{padding-block:52px}.detail{display:none;box-sizing:border-box;width:min(900px,calc(100vw - 48px));max-width:none;max-height:calc(100dvh - 64px);margin:auto;padding:0;border:1px solid var(--line-strong,var(--line));border-radius:var(--radius-panel,2px);background:var(--surface);color:var(--ink);font:400 14px/1.6 var(--sans);box-shadow:0 24px 80px #0004;overflow:hidden}.detail[open]{display:flex;flex-direction:column}.detail::backdrop{background:#11191680}.detail-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:24px 28px;border-bottom:1px solid var(--line);flex-shrink:0}.detail-close{display:grid;place-items:center;flex:0 0 32px;width:32px;height:32px;border:1px solid var(--line);background:transparent;color:var(--ink-muted)}.detail-close:hover{color:var(--jade);border-color:var(--jade);background:var(--paper)}.detail-scroll{display:grid;gap:16px;min-height:0;overflow:auto;overscroll-behavior:contain;padding:24px 28px;scrollbar-gutter:stable}.back-button{display:flex;align-items:center;gap:6px;justify-self:start}.detail-title{display:flex;align-items:flex-start;gap:16px;min-width:0;max-height:35dvh;overflow:auto;padding:3px}.detail-title>.plugin-mark{width:48px;height:48px;flex-basis:48px}.detail-title>div{min-width:0;overflow-wrap:anywhere}.detail-title h3{margin:3px 0 9px}.chips{display:flex;flex-wrap:wrap;gap:6px}.chips>span{padding:2px 7px;border:1px solid var(--line);font-size:11px;color:var(--ink-muted)}.detail-layout{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:28px;align-items:start}.detail-content{display:grid;gap:24px;min-width:0;overflow-wrap:anywhere}.description{font-size:14px;line-height:1.9}.detail-section{display:grid;gap:12px;padding-top:20px;border-top:1px solid var(--line)}.impact-list{list-style:none;display:grid;gap:14px;margin:0;padding:0;font-size:13px}.impact-list li{display:grid;gap:4px}.impact-list small{color:var(--jade);font-size:11px}.permission-list{margin:0;padding-left:18px;font-size:13px;line-height:1.9}.install-card{display:grid;gap:16px;padding:22px;border:1px solid var(--line);border-top:3px solid var(--jade);background:var(--paper);min-width:0;overflow-wrap:anywhere}.validation-note{border-top:1px solid var(--line);padding-top:14px;font-size:11px;color:var(--jade);line-height:1.9}.validation-note span{color:var(--ink-muted)}.technical-details{font-size:12px;color:var(--ink-muted);border-top:1px solid var(--line);padding-top:16px}.technical-details p{margin-top:12px}code{font-size:11px;overflow-wrap:anywhere}.publications{display:grid;gap:18px;min-width:0}.publication-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:18px 0;border-top:1px solid var(--line);flex-wrap:wrap;overflow-wrap:anywhere}.publication-row>div:first-child{min-width:0}.publication-row strong{font:600 17px/1.5 var(--serif)}.publication-row small{display:block;color:var(--ink-muted);font-size:12px;margin-top:4px}
@container (max-width:720px){.market-heading{gap:14px}.market-heading h3{font-size:22px}.account-actions{width:100%;justify-content:flex-end}.detail-title h3{font-size:22px}}
@container (max-width:480px){.catalog{grid-template-columns:minmax(0,1fr)}.filter-row{gap:10px}.advanced-filters{margin-left:52px}.market-search{flex-wrap:wrap}.market-search>.search-input{flex-basis:100%}.filter-options button{padding:5px 8px}}
@media(max-width:760px){.detail{width:calc(100vw - 24px);max-height:calc(100dvh - 32px)}.detail-header{padding:18px;gap:12px}.detail-scroll{padding:18px}.detail-layout{grid-template-columns:minmax(0,1fr);gap:24px}.detail-title>.plugin-mark{display:none}.detail-title h3{font-size:21px}}
@media(prefers-reduced-motion:reduce){.catalog-item{transition:none}}
.detail[open]{animation:plugin-detail-enter var(--duration-panel) ease-out both}
.detail[open]::backdrop{animation:plugin-backdrop-enter var(--duration-panel) ease-out both}
.detail[open].detail-closing{pointer-events:none;animation:plugin-detail-leave var(--duration-fast) ease-in both}
.detail[open].detail-closing::backdrop{animation:plugin-backdrop-leave var(--duration-fast) ease-in both}
@keyframes plugin-detail-enter{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes plugin-detail-leave{from{opacity:1;transform:none}to{opacity:0;transform:translateY(6px)}}
@keyframes plugin-backdrop-enter{from{opacity:0}to{opacity:1}}
@keyframes plugin-backdrop-leave{from{opacity:1}to{opacity:0}}
</style>
