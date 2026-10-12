<script setup lang="ts">
import { pluginError } from '../plugin-error'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import ArchiveAction from '../../../ui/ArchiveAction.vue'
import StudioIcon from '../../../ui/StudioIcon.vue'
import { capabilityLabels as labels } from '../plugin-labels'
import PluginFilters from './PluginFilters.vue'
import BookPluginComposition from './BookPluginComposition.vue'
import PersonalPlugins from './PersonalPlugins.vue'
import PluginMarket from './PluginMarket.vue'
import { categoryLabel, inPluginView } from '../../../../contracts/writing-plugins/contributions'
import { supportedPluginCapabilities, type PluginInstallPreview, type PluginManagementView, type PluginVersionView, type WritingPluginsApi } from '../../../../contracts/writing-plugins/management-contracts'

const props = defineProps<{ api: WritingPluginsApi; bookScopeKey: string | null }>()
const view = ref<PluginManagementView | null>(null), preview = ref<PluginInstallPreview | null>(null)
const busy = ref(false), error = ref(''), notice = ref('')
const section = ref<'library' | 'installed' | 'market' | 'personal'>('library')
const personalDraftId = ref('')
const installedList = ref<HTMLElement | null>(null)
const marketVisited = ref(false), personalVisited = ref(false), previewSource = ref('本地安装包，发布者未验证')
function navigate(next: typeof section.value) {
  section.value = next; preview.value = null; notice.value = ''
  if (next === 'market') marketVisited.value = true
  if (next === 'personal') personalVisited.value = true
}
function openPersonalCopy(id: string) { personalDraftId.value = id; navigate('personal'); notice.value = '已创建个人副本，可以自由编辑；原插件保持不变。' }
const editing = ref<string | null>(null), chosenDigest = ref(''), acceptedGrants = ref<string[]>([]), removing = ref<string | null>(null)
let alive = true
onBeforeUnmount(() => { alive = false })
const supported = (cap: string) => supportedPluginCapabilities.includes(cap as typeof supportedPluginCapabilities[number])
const activePlugin = computed(() => view.value?.plugins.find(p => p.id === editing.value))
const selectedVersion = computed(() => activePlugin.value?.versions.find(v => v.digest === chosenDigest.value))
const currentVersion = (p: NonNullable<PluginManagementView['plugins']>[number]) => p.versions.find(v => v.digest === p.current)!
const addedCapabilities = computed(() => {
  const plugin = activePlugin.value
  return plugin ? selectedVersion.value?.manifest.capabilities.filter(cap => !currentVersion(plugin).manifest.capabilities.includes(cap)) ?? [] : []
})
const source = ref<'all' | 'official' | 'community' | 'mine'>('all'), category = ref(''), query = ref('')
const categories = computed(() => [...new Set(view.value?.plugins.flatMap(p => currentVersion(p).manifest.categoryIds ?? []) ?? [])].sort())
const filtered = computed(() => view.value?.plugins.filter(p => {
  const m = currentVersion(p).manifest
  return inPluginView(p.provenance, source.value) && (!category.value || m.categoryIds?.includes(category.value)) && `${m.name} ${m.description} ${(m.tags ?? []).join(' ')}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())
}) ?? [])
const availableTools = (v: PluginVersionView) => v.manifest.tools.filter(t => t.capabilities.every(c => supported(c) && v.grants.includes(c))).length
const hasLibraryMethods = (v: PluginVersionView) => v.manifest.contributions?.some(c => c.kind === 'creative-policy' && ['inspiration-extract', 'inspiration-summary'].includes(c.slot))
const selectableTools = computed(() => selectedVersion.value?.manifest.tools.filter(t => t.capabilities.every(c => supported(c) && acceptedGrants.value.includes(c))).length ?? 0)
const selectableContributions = computed(() => selectedVersion.value?.manifest.contributions?.filter(c => c.kind === 'context-fragment' || c.kind === 'creative-policy' || c.kind === 'team-preset' || (c.kind === 'tool-reference' ? selectedVersion.value?.manifest.tools.find(t => t.id === c.toolId)?.capabilities : c.tool.capabilities)?.every(cap => supported(cap) && acceptedGrants.value.includes(cap))).length ?? 0)
async function reload() { const result = await props.api.list(Boolean(props.bookScopeKey)); if (alive) view.value = result }
async function act(operation: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try { await operation() }
  catch (cause) { if (alive) error.value = pluginError(cause, '操作未完成，请刷新后重试。') }
  finally { if (alive) busy.value = false }
}
function edit(id: string, digest?: string) {
  const p = view.value?.plugins.find(p => p.id === id)
  if (!p || digest && !p.versions.some(v => v.digest === digest)) {
    editing.value = null
    throw new Error('这个插件版本已不在本机，请刷新目录后重新安装。')
  }
  editing.value = id; removing.value = null; chooseVersion(digest ?? p.current)
}
async function revealInstalled(id: string, digest: string) {
  source.value = 'all'; category.value = ''; query.value = ''; navigate('installed')
  edit(id, digest)
  await nextTick()
  if (!alive || section.value !== 'installed' || editing.value !== id) return
  const row = Array.from(installedList.value?.querySelectorAll<HTMLElement>('[data-plugin-id]') ?? []).find(el => el.dataset.pluginId === id)
  row?.focus({ preventScroll: true }); row?.querySelector('.plugin-editor')?.scrollIntoView({ block: 'nearest' })
}
async function manageInstalled(id: string, digest: string) {
  await act(async () => {
    await reload()
    if (alive) await revealInstalled(id, digest)
  })
}
function chooseVersion(digest: string) {
  chosenDigest.value = digest
  acceptedGrants.value = [...(activePlugin.value?.versions.find(v => v.digest === digest)?.grants ?? [])].filter(supported)
}
async function choosePackage() {
  await act(async () => {
    const token = await props.api.choosePackage(); if (!token || !alive) return
    const result = await props.api.previewInstall(token); if (alive) { preview.value = result; previewSource.value = '本地安装包，发布者未验证'; editing.value = null; removing.value = null }
  })
}
async function install() {
  const plan = preview.value!
  await act(async () => {
    await props.api.install(plan.planId); if (!alive) return
    await reload(); if (!alive) return
    await revealInstalled(plan.manifest.id, plan.digest)
    if (!alive) return
    notice.value = chosenDigest.value !== activePlugin.value?.current
      ? '此版本已安装，尚未切换。请核对下方版本与权限。'
      : activePlugin.value?.enabled ? '此版本已安装，可核对现有权限。' : '已安装。选择所需权限后可启用插件。'
  })
}
async function saveAuthorization() {
  const p = activePlugin.value!, revision = view.value!.revision, digest = chosenDigest.value, grants = [...acceptedGrants.value]
  await act(async () => {
    if (digest !== p.current) await props.api.selectVersion({ id: p.id, revision, digest, grants })
    else await props.api.setEnabled({ id: p.id, revision, enabled: true, grants })
    if (!alive) return
    editing.value = null; await reload(); notice.value = digest !== p.current
      ? p.enabled ? '应用版本已切换。已固定版本的组合和进行中的任务保持原版本。' : '版本已切换，插件仍未启用。请在“版本与权限”中确认权限后启用。'
      : '插件已启用，可继续选择知识库方法或本书组合。'
  })
}
async function disable(id: string) { const revision = view.value!.revision; await act(async () => { await props.api.setEnabled({ id, revision, enabled: false, grants: [] }); if (!alive) return; editing.value = null; await reload(); notice.value = '已停用，后续调用和结果发布将被阻止。' }) }
async function bookToggle(id: string, enabled: boolean) {
  const snapshot = view.value!; if (!snapshot.book) return
  await act(async () => { await props.api.setBookEnabled({ id, enabled, revision: snapshot.revision, bookToken: snapshot.book!.token }); if (!alive) return; await reload(); const plugin = view.value?.plugins.find(p => p.id === id); notice.value = enabled ? plugin && !currentVersion(plugin).manifest.tools.length ? '已为本书启用，请在下方“这本书的写作组合”中选用指导。' : '本书的新任务可以发现这个插件的工具。' : '本书已停止使用，相关插件任务已取消。' })
}
async function uninstall(id: string) { const revision = view.value!.revision; await act(async () => { await props.api.uninstall({ id, revision }); if (!alive) return; removing.value = null; editing.value = null; await reload(); notice.value = '插件已卸载。作品内容保留。' }) }
onMounted(() => { void act(reload) })
</script>

<template>
  <section class="writing-plugins" data-testid="writing-plugin-settings" :aria-busy="busy">
    <div class="plugin-navigation">
      <nav aria-label="写作插件页面">
        <button type="button" :aria-current="section === 'library' ? 'page' : undefined" data-testid="plugins-nav-library" :disabled="busy" @click="navigate('library')">本地插件库</button>
        <button type="button" :aria-current="section === 'installed' ? 'page' : undefined" data-testid="plugins-nav-installed" :disabled="busy" @click="navigate('installed')">已安装<span v-if="view">{{ view.plugins.length }}</span></button>
        <button type="button" :aria-current="section === 'personal' ? 'page' : undefined" data-testid="plugins-nav-personal" :disabled="busy" @click="navigate('personal')">我的创作</button>
        <button type="button" :aria-current="section === 'market' ? 'page' : undefined" data-testid="plugins-nav-market" :disabled="busy" @click="navigate('market')">公共市场</button>
      </nav>
      <ArchiveAction compact :disabled="busy" data-testid="plugin-choose" @click="choosePackage"><StudioIcon name="plus" :size="14" />安装插件包</ArchiveAction>
    </div>
    <p v-if="error" class="plugin-error" role="alert">{{ error }} 可刷新状态，或重新选择安装包。</p>
    <p v-if="notice" class="plugin-notice" role="status">{{ notice }}</p>
    <p v-if="busy" role="status">正在处理…</p>
    <div class="plugin-content">
    <Transition name="plugin-page"><PluginMarket local v-show="section === 'library' && !preview" :inert="section !== 'library' || !!preview" :active="section === 'library' && !preview" :api="api" :installed="view" @manage="manageInstalled" @derived="openPersonalCopy" @create="navigate('personal')" @preview="preview = $event; previewSource = '官方随应用提供的本地插件'" /></Transition>
    <Transition name="plugin-page"><PersonalPlugins v-if="personalVisited" v-show="section === 'personal' && !preview" :inert="section !== 'personal' || !!preview" :active="section === 'personal' && !preview" :open-draft-id="personalDraftId" :api="api" @action="notice = ''" @preview="preview = $event; previewSource = '本机创建的插件'" /></Transition>
    <Transition name="plugin-page"><PluginMarket v-if="marketVisited" v-show="section === 'market' && !preview" :inert="section !== 'market' || !!preview" :active="section === 'market' && !preview" :api="api" :installed="view" @manage="manageInstalled" @library="navigate('library')" @create="navigate('personal')" @preview="preview = $event; previewSource = '市场版本，下载摘要已校验'" /></Transition>

    <Transition name="plugin-page"><article v-if="preview" class="plugin-panel" data-testid="plugin-preview">
      <p class="plugin-eyebrow">安装前核对 · {{ previewSource }}</p>
      <h3>{{ preview.manifest.name }} <span>{{ preview.manifest.version }}</span></h3>
      <p>{{ preview.manifest.description }}</p>
      <p>{{ preview.manifest.tools.length }} 个工具 · {{ preview.fileCount }} 个文件 · {{ (preview.unpackedBytes / 1024).toFixed(1) }} KB</p>
      <p v-if="preview.existingVersion">当前版本 {{ preview.existingVersion }}。安装后可手动切换，已开始的任务继续使用原版本。</p>
      <ul v-if="preview.manifest.capabilities.length"><li v-for="cap in preview.manifest.capabilities" :key="cap">{{ labels[cap] || cap }} <span v-if="!supported(cap)">（暂不支持）</span><span v-else-if="preview.addedCapabilities.includes(cap)"> · 待授权</span></li></ul>
      <p v-else>无需额外权限。</p>
      <details><summary>查看工具与包摘要</summary><ul><li v-for="tool in preview.manifest.tools" :key="tool.id">{{ tool.id }}：{{ tool.description }}</li></ul><code>{{ preview.digest }}</code></details>
      <p>安装不会自动启用或授权。候选内容仍需通过写作流程确认采用。</p>
      <div class="plugin-actions"><ArchiveAction :disabled="busy" @click="preview = null">取消</ArchiveAction><ArchiveAction variant="primary" :disabled="busy" data-testid="plugin-install" @click="install">确认安装</ArchiveAction></div>
    </article></Transition>

    <Transition name="plugin-page"><section ref="installedList" :inert="section !== 'installed' || !!preview" v-show="section === 'installed' && !preview" class="installed-plugins" aria-label="已安装插件">
    <div class="plugin-toolbar"><p>管理插件的权限与使用范围。</p><ArchiveAction compact :disabled="busy" @click="act(reload)">刷新</ArchiveAction></div>
    <div v-if="view && !view.plugins.length" class="plugin-empty"><StudioIcon name="folder" :size="28" /><h3>从一个写作插件开始</h3><p>本地插件库已随软件提供，也可以亲手创建自己的写作方法。</p><div class="plugin-actions"><ArchiveAction variant="primary" @click="navigate('library')">浏览本地插件库</ArchiveAction><ArchiveAction @click="navigate('personal')">创建我的插件</ArchiveAction></div></div>
    <p v-if="view?.book" class="plugin-scope">本书使用范围：{{ view.book.title }}</p>
    <p v-else-if="view" class="plugin-scope">打开作品后，可为每本书单独选择插件。</p>
    <PluginFilters v-if="view?.plugins.length" :source="source" v-model:category="category" v-model:query="query" :categories="categories" :count="filtered.length" @update:source="source = $event as typeof source" />
    <p v-if="view?.plugins.length && !filtered.length" class="plugin-empty">这个筛选下暂无插件。可切换类别或清空查找词。</p>
    <article v-for="plugin in filtered" :key="plugin.id" class="plugin-panel" :data-plugin-id="plugin.id" tabindex="-1">
      <div class="plugin-heading"><h3>{{ currentVersion(plugin).manifest.name }}</h3><span class="plugin-status">{{ plugin.enabled ? '应用已启用' : '已安装 · 未启用' }}</span></div>
      <p>{{ currentVersion(plugin).manifest.description }}</p>
      <p class="plugin-meta">当前 {{ currentVersion(plugin).manifest.version }}<span v-if="plugin.versions.length > 1"> · 已安装 {{ plugin.versions.length }} 个版本</span> · {{ currentVersion(plugin).manifest.runtime === 'declarative' ? '声明式插件' : '代码插件' }} · {{ plugin.provenance.distribution === 'local' ? '本地安装，发布者未验证' : plugin.provenance.distribution === 'official' ? '官方发布' : '社区发布' }}<span v-if="plugin.provenance.createdByMe"> · 我创建的</span></p>
      <p v-if="currentVersion(plugin).manifest.categoryIds?.length" class="plugin-meta">{{ currentVersion(plugin).manifest.categoryIds!.map(id => categoryLabel(id)).join(' · ') }}<span v-for="tag in currentVersion(plugin).manifest.tags ?? []" :key="tag"> · #{{ tag }}</span></p>
      <p v-if="currentVersion(plugin).manifest.tools.length">已授权工具 {{ availableTools(currentVersion(plugin)) }} / {{ currentVersion(plugin).manifest.tools.length }}<span v-if="!availableTools(currentVersion(plugin))"> · 授权后助笔才能使用相关工具。</span></p>
      <p v-else-if="hasLibraryMethods(currentVersion(plugin)) && !view?.book">知识库方法插件 · 启用后，在下方“知识库的提取方法”中选用。</p><p v-else>写作指导插件 · 启用并选择“本书使用”后，在下方“这本书的写作组合”中选用。</p>
      <div class="plugin-actions">
        <ArchiveAction :disabled="busy" @click="edit(plugin.id)">版本与权限</ArchiveAction>
        <ArchiveAction :disabled="busy" @click="act(async () => { const draft = await api.deriveDraft({ pluginId: plugin.id, digest: plugin.current }); if (alive) openPersonalCopy(draft.id) })">派生到我的插件</ArchiveAction>
        <ArchiveAction v-if="plugin.enabled" :disabled="busy" @click="disable(plugin.id)">停用插件</ArchiveAction>
        <ArchiveAction v-if="view?.book" :disabled="busy || (!plugin.enabled && !plugin.bookEnabled)" @click="bookToggle(plugin.id, !plugin.bookEnabled)">{{ plugin.bookEnabled ? '取消本书使用' : '本书使用' }}</ArchiveAction>
        <ArchiveAction variant="danger" :disabled="busy" @click="removing = plugin.id; editing = null">卸载</ArchiveAction>
      </div>
      <form v-if="editing === plugin.id && selectedVersion" class="plugin-editor" @submit.prevent="saveAuthorization">
        <label>使用版本<select :value="chosenDigest" :disabled="busy" @change="chooseVersion(($event.target as HTMLSelectElement).value)"><option v-for="version in plugin.versions" :key="version.digest" :value="version.digest">{{ version.manifest.version }}{{ version.digest === plugin.current ? '（当前）' : '' }}</option></select></label>
        <div v-if="chosenDigest !== plugin.current" class="plugin-version-review" aria-label="版本切换核对">
          <p><strong>当前 {{ currentVersion(plugin).manifest.version }} → 待切换 {{ selectedVersion.manifest.version }}</strong></p>
          <p>{{ selectedVersion.manifest.name }} · {{ selectedVersion.manifest.description }}</p>
          <p class="plugin-meta">{{ selectedVersion.manifest.tools.length }} 个工具 · {{ selectedVersion.manifest.contributions?.length ?? 0 }} 项写作贡献</p>
          <p>{{ addedCapabilities.length ? '相对当前版本的新增权限已在下方标出，请按需选择。' : '相对当前版本没有新增权限，请核对这个版本已保存的授权。' }}正在进行的任务和单独固定版本的作品组合保持原版本。</p>
          <p v-if="!plugin.enabled">插件尚未启用。切换版本后，仍需确认权限并启用。</p>
        </div>
        <fieldset :disabled="busy"><legend>允许的能力</legend><label v-for="cap in selectedVersion.manifest.capabilities" :key="cap" class="plugin-grant"><input v-model="acceptedGrants" type="checkbox" :value="cap" :disabled="!supported(cap)" />{{ labels[cap] || cap }}<span v-if="addedCapabilities.includes(cap)" class="plugin-new-capability">新增权限</span><span v-if="!supported(cap)">（暂不支持）</span></label><p v-if="!selectedVersion.manifest.capabilities.length">这个版本无需额外权限。</p></fieldset>
        <p>本次授权后有 {{ selectableTools }} 个工具、{{ selectableContributions }} 项贡献可用。读取权限允许插件使用相应作品内容；模型调用沿用作品模型设置。</p>
        <div class="plugin-actions"><ArchiveAction :disabled="busy" @click="editing = null">取消</ArchiveAction><ArchiveAction type="submit" variant="primary" :disabled="busy || (!selectableTools && !selectableContributions)">{{ chosenDigest === plugin.current ? '确认权限并启用' : '确认切换版本' }}</ArchiveAction></div>
      </form>
      <div v-if="removing === plugin.id" class="plugin-editor" role="group" aria-label="确认卸载">
        <p>卸载会取消这个插件的待答和运行任务，并移除所有已安装版本。已保存的作品内容保留。</p>
        <div class="plugin-actions"><ArchiveAction :disabled="busy" @click="removing = null">取消</ArchiveAction><ArchiveAction variant="danger" :disabled="busy" @click="uninstall(plugin.id)">确认卸载</ArchiveAction></div>
      </div>
    </article>
    <BookPluginComposition v-if="view?.library" scope="library" book-scope-key="knowledge-library-methods" :api="api" :view="view" :disabled="busy" @manage="manageInstalled" @install="choosePackage" @applied="act(async () => { await reload(); notice = '知识库方法已保存，后续提取使用新组合。' })" />
    <BookPluginComposition v-if="view?.book && bookScopeKey" :api="api" :view="view" :book-scope-key="bookScopeKey" :disabled="busy" @manage="manageInstalled" @install="choosePackage" @applied="act(async () => { await reload(); notice = '本书组合已保存，后续任务使用新组合。' })" />
    </section></Transition>
    </div>
  </section>
</template>

<style scoped>
/* The shared category strip uses negative gutters that differ from the compact
   settings padding. Keep this page's strip within its actual content width. */
:global(.narrative-terminal.redesigned-studio .settings-editor.settings-page:has(> .writing-plugins) > .settings-category-navigation) { margin-inline: 0; padding-inline: 0; min-width: 0; }
/* Compact only this feature's surrounding heading; the shared settings scale remains intact. */
:global(.narrative-terminal.redesigned-studio .settings-editor.settings-page:has(> .writing-plugins) > .settings-category-navigation) { margin-bottom: 18px; }
:global(.narrative-terminal.redesigned-studio .settings-editor.settings-page:has(> .writing-plugins) > .archive-page-heading) { min-height: 40px; padding-bottom: 14px; margin-bottom: 18px; align-items: center; }
:global(.narrative-terminal.redesigned-studio .settings-editor.settings-page:has(> .writing-plugins) > .archive-page-heading::after) { content: none; }
:global(.narrative-terminal.redesigned-studio .settings-editor.settings-page:has(> .writing-plugins) > .archive-page-heading > div) { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }
:global(.narrative-terminal.redesigned-studio .settings-editor.settings-page:has(> .writing-plugins) > .archive-page-heading > div > .eyebrow) { display: none; }
:global(.narrative-terminal.redesigned-studio .settings-editor.settings-page:has(> .writing-plugins) > .archive-page-heading p) { margin: 0; font-size: 12px; }
.writing-plugins { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; width: 100%; min-width: 0; max-width: 1120px; box-sizing: border-box; color: var(--ink); container-type: inline-size; }
.plugin-content { display:grid;min-width:0;align-items:start; }
.plugin-content > * { grid-area:1 / 1;min-width:0; }
.plugin-page-enter-active { transition:opacity var(--duration-panel) ease-out,transform var(--duration-panel) ease-out; }
.plugin-page-leave-active { transition:opacity var(--duration-fast) ease-in;pointer-events:none; }
.plugin-page-enter-from { opacity:0;transform:translateY(6px); }
.plugin-page-leave-to { opacity:0; }
.plugin-navigation { display:flex; align-items:center; justify-content:space-between; gap:12px; border-bottom:1px solid var(--line); padding-bottom:10px; flex-wrap:wrap; }
.plugin-navigation nav { display:flex; gap:24px; }
.plugin-navigation nav button { position:relative; display:flex; align-items:center; gap:7px; background:none; border:0; padding:8px 0; color:var(--ink-muted); font:500 14px/1.4 var(--sans); cursor:pointer; }
.plugin-navigation nav button[aria-current] { color:var(--jade); font-weight:600; }
.plugin-navigation nav button[aria-current]::after { content:''; position:absolute; height:2px; background:var(--jade); inset: auto 0 -11px; }
.plugin-navigation nav span { font-size:11px; background:var(--paper); padding:1px 5px; }
.plugin-navigation button:focus-visible { outline:2px solid var(--jade); outline-offset:4px; }
.installed-plugins { display:grid; grid-template-columns:minmax(0,1fr); gap:18px; min-width:0; }
.plugin-toolbar, .plugin-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.plugin-toolbar p { max-width: 470px; margin: 0; }
.plugin-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.plugin-panel { border: 1px solid var(--line); border-radius: var(--radius-panel, 2px); padding: 24px; background: var(--surface); min-width:0; overflow-wrap:anywhere; }
.plugin-panel h3 { font-size: 19px; margin: 0; }.plugin-panel h3 span { font-size: 14px; margin-left: 10px; }
.plugin-panel p, .plugin-panel li { line-height: 1.7; }.plugin-panel ul { padding-left: 22px; }
.plugin-meta, .plugin-scope, .plugin-eyebrow { font-size: 13px; opacity: .75; }
.plugin-status { color: var(--jade); font-size: 13px; white-space: nowrap; }
.plugin-editor { margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--line); }
.plugin-version-review { margin-top:16px; padding:12px 16px; border-left:2px solid var(--jade); background:var(--paper); font-size:13px; }
.plugin-version-review p { margin:6px 0; }.plugin-new-capability { font-size:12px; color:var(--jade); }
.plugin-editor select { display: block; margin-top: 8px; padding: 8px 12px; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 6px; min-width: 220px; }
.plugin-editor fieldset { margin: 18px 0; padding: 12px 16px; border: 1px solid var(--line); border-radius: 8px; }
.plugin-grant { display: flex; align-items: center; gap: 10px; padding: 6px 0; }.plugin-grant input { accent-color: var(--jade); }
.plugin-empty { padding: 40px 24px; border: 1px solid var(--line); text-align: center; display:grid; gap:14px; justify-items:center; background:var(--paper); }.plugin-empty h3,.plugin-empty p{margin:0}.plugin-empty h3{font:600 21px/1.5 var(--serif)}.plugin-empty p{color:var(--ink-muted);font-size:13px;line-height:1.7}
.plugin-error { color: var(--danger, #b14c42); }.plugin-notice { color: var(--jade); }
code { overflow-wrap: anywhere; font-size: 12px; }summary { cursor: pointer; }details { margin: 14px 0; }
@media (max-width: 760px) { .plugin-toolbar, .plugin-heading { align-items: flex-start; flex-direction: column; }.plugin-panel { padding: 18px; } }
</style>
