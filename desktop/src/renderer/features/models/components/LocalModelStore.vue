<script setup lang="ts">
import ArchivePageHeader from '../../../ui/ArchivePageHeader.vue'
import LocalModelCard from './LocalModelCard.vue'
import { computed, ref, watch } from 'vue'
import type { AiSettings, AiTask } from '../../../../contracts/index'
import type { LocalModelsApi, LocalModelView } from '../../../../contracts/models/local-model-contracts'
import { LOCAL_CONNECTION_ID } from '../../../../contracts/models/local-model-contracts'
import { useLocalModels } from '../composables/use-local-models'
const props = defineProps<{ api: LocalModelsApi; settings: AiSettings; busy?: boolean }>()
const emit = defineEmits<{ use: [model: LocalModelView, target: 'shared' | AiTask]; changed: [] }>()
const { models, loading, checking, stopping, activeOperation, error, actionError, refresh, inspect, install, cancel, dismissActionError } = useLocalModels(props.api)
let lastAvailability: string | undefined
watch([models, error], () => {
  const ready = models.value.filter(m => m.state === 'ready').map(m => [m.id, m.revision]).sort(([a], [b]) => a.localeCompare(b))
  const availability = JSON.stringify([Boolean(error.value), ready])
  if (availability === lastAvailability) return
  lastAvailability = availability
  // Background preparation and resource loss must also refresh writing availability.
  emit('changed')
})
const scopes = [{ value: 'all', label: '全部模型' }, { value: 'ready', label: '本机可用' }, { value: 'attention', label: '待处理' }] as const
const query = ref(''), scope = ref<(typeof scopes)[number]['value']>('all'), family = ref(''), order = ref('catalog')
const searchInput = ref<HTMLInputElement | null>(null)
const activeFilters = computed(() => [
  scope.value === 'all' ? '' : scopes.find(item => item.value === scope.value)!.label,
  family.value ? '系列：' + family.value : '',
  query.value.trim() ? '关键词：' + query.value.trim() : ''
].filter(Boolean))
const targets = ref<Record<string, 'shared' | AiTask>>({})
const families = computed(() => [...new Set(models.value.map(m => m.family))])
const modelsByScope = computed(() => ({
  all: models.value,
  ready: models.value.filter(m => m.state === 'ready'),
  attention: models.value.filter(m => ['detected', 'failed', 'cancelled', 'interrupted'].includes(m.state))
}))
const countsKnown = computed(() => !loading.value && !error.value)
const activeModel = computed(() => models.value.find(m => m.id === checking.value))
const activePreparation = computed(() => activeOperation.value?.id === checking.value ? activeOperation.value : activeModel.value)
const visible = computed(() => {
  const needle = query.value.trim().toLowerCase()
  const rows = modelsByScope.value[scope.value].filter(m => (!family.value || m.family === family.value) && (!needle || [m.name, m.id, m.family, m.description, m.publisher].join(' ').toLowerCase().includes(needle)))
  if (order.value === 'size') rows.sort((a, b) => a.bytes - b.bytes)
  else if (order.value === 'name') rows.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  return rows
})
const assignments = (id: string) => props.settings.routingMode === 'shared'
  ? props.settings.shared.connectionId === LOCAL_CONNECTION_ID && props.settings.shared.model === id ? '全部写作任务' : ''
  : Object.entries(props.settings.tasks).filter(([, p]) => p.connectionId === LOCAL_CONNECTION_ID && p.model === id).map(([key]) => ({ outline: '总纲', chapterOutline: '章纲', prose: '正文', review: '审校' }[key])).join('、')
function resetFilters() {
  query.value = ''; family.value = ''; scope.value = 'all'
  searchInput.value?.focus()
}
</script>
<template>
  <section class="local-model-store" data-testid="local-model-store">
    <ArchivePageHeader variant="display" class="store-heading" eyebrow="MODEL MARKET / 模型资源 · BETA" title="模型超市" description="为总纲、章纲、正文与审校，选择合适的本机助手。">
      <div class="store-count" data-testid="model-store-count"><strong>{{ countsKnown ? models.length : '—' }}</strong><span>{{ countsKnown ? '个型号可选' : loading ? '正在读取' : '目录暂不可用' }}</span><small v-if="countsKnown">{{ modelsByScope.ready.length }} 个本机可用</small></div>
    </ArchivePageHeader>
    <div class="store-intro">
      <ol aria-label="模型使用步骤"><li><b>01</b>按需下载</li><li><b>02</b>本机检测</li><li><b>03</b>选用写作</li></ol>
      <p>新增型号尚未开发实测，安装后会在你的设备上检测；生成效果以实际使用为准。</p>
    </div>
    <div class="store-tabs" role="group" aria-label="模型范围">
      <button v-for="item in scopes" :key="item.value" type="button" :aria-pressed="scope === item.value" :class="{ active: scope === item.value }" :data-testid="'model-scope-' + item.value" @click="scope = item.value">{{ item.label }} <span>{{ countsKnown ? modelsByScope[item.value].length : '—' }}</span></button>
    </div>
    <p v-if="scope === 'attention'" class="store-scope-note">包含待检测、准备失败、已停止或中断的型号。</p>
    <div class="store-toolbar">
      <label class="store-search"><span>搜索模型</span><span class="store-search-field"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg><input ref="searchInput" v-model="query" aria-label="搜索模型" placeholder="搜索名称、系列或用途" type="search"></span></label>
      <label><span>模型系列</span><select v-model="family" aria-label="筛选模型系列"><option value="">全部系列</option><option v-for="item in families" :key="item" :value="item">{{ item }}</option></select></label>
      <label><span>排列方式</span><select v-model="order" aria-label="模型排列方式"><option value="catalog">目录顺序</option><option value="size">体积从小到大</option><option value="name">按名称</option></select></label>
    </div>
    <div v-if="activeFilters.length" class="store-filter-summary" role="group" aria-label="当前筛选" data-testid="model-filter-summary">
      <span>筛选中</span>
      <ul><li v-for="filter in activeFilters" :key="filter" :title="filter">{{ filter }}</li></ul>
      <button type="button" data-testid="clear-model-filters" @click="resetFilters">重置筛选<span aria-hidden="true"> ↺</span></button>
    </div>
    <div v-if="activePreparation" class="store-active" role="status"><div><strong>{{ activePreparation.name }}</strong><span v-if="error">状态暂时无法读取，仍可尝试停止本次准备。</span><span v-else-if="activeModel?.operationId && activeModel.operationId === activePreparation.operationId">{{ activeModel.message }} · {{ activeModel.progress }}%</span><span v-else>正在确认准备状态…</span></div><button type="button" :disabled="stopping || !activePreparation.operationId" @click="cancel">{{ stopping ? '正在停止…' : !activePreparation.operationId ? '等待状态…' : activePreparation.operation === 'install' ? '停止安装' : '停止检测' }}</button></div>
    <p v-if="error" role="alert" class="store-error">{{ error }} <button type="button" @click="refresh">重新读取</button></p>
    <p v-if="actionError" role="alert" class="store-error" data-testid="local-model-action-error">{{ actionError }} <button type="button" @click="dismissActionError">关闭提示</button></p>
    <p v-if="loading" role="status" class="store-empty">正在读取模型目录……</p>
    <div v-else-if="!error && !visible.length" class="store-empty"><strong>{{ scope === 'ready' ? '还没有匹配的可用模型' : scope === 'attention' ? '没有匹配的待处理模型' : '没有找到匹配的模型' }}</strong><p>可以调整关键词或查看全部型号。</p><button type="button" data-testid="reset-model-filters" @click="resetFilters">查看全部模型</button></div>
    <template v-else-if="!error">
      <div class="store-result"><span><i aria-hidden="true" />型号目录 <small>CATALOG</small> <b>{{ visible.length }}</b> 个型号</span><span>Windows x64 · CPU 运行</span></div>
      <div class="model-grid">
        <LocalModelCard v-for="model in visible" :key="model.id" :model="model" :active="checking === model.id" :preparing="!!checking" :stopping="stopping" :stop-operation="activeOperation?.id === model.id ? activeOperation : undefined" :busy="busy" :assigned="assignments(model.id)" :target="targets[model.id] || 'shared'"
          @update:target="targets[model.id] = $event" @install="install(model.id)" @inspect="inspect(model.id)" @cancel="cancel" @use="emit('use', model, targets[model.id] || 'shared')" />
      </div>
    </template>
    <footer class="store-note"><strong>模型留在本机，选择由你决定。</strong><p>下载和选用是两个独立步骤，安装不会更改已有写作分配。停止后可继续下载，已有资源优先复用。</p></footer>
  </section>
</template>
<style scoped>
.local-model-store {
  --market-accent: var(--folio-action, #efa348);
  --market-dark: var(--dark, #222b25);
  --market-light: var(--dark-text, #f3f3ec);
  container-type: inline-size;
  max-width: 76rem;
  margin: 0 auto;
  padding-bottom: 1rem;
  color: var(--ink);
}
.narrative-terminal.redesigned-studio.archive-workspace .local-model-store > .store-heading {
  flex-wrap: nowrap;
  min-height: 0;
  margin: 0;
  padding-bottom: 1.2rem;
  gap: 1.4rem;
}
.narrative-terminal.redesigned-studio.archive-workspace .local-model-store .store-heading :deep(h2) {
  font: 600 var(--page-heading-size)/1.3 var(--serif);
  letter-spacing: .025em;
}
.narrative-terminal.redesigned-studio.archive-workspace .local-model-store .store-heading :deep(.archive-page-heading-copy) {
  border-left-width: 3px;
  padding-left: 1rem;
}
.store-count { display: grid; text-align: right; gap: .3rem; padding-left: 1.2rem; border-left: 1px solid var(--line); white-space: nowrap; }
.store-count strong { color: var(--muted); font: 700 clamp(3rem, 7cqi, 4.8rem)/.9 "Bahnschrift Condensed", "Arial Narrow", var(--sans); letter-spacing: -.04em; font-variant-numeric: tabular-nums; }
.store-count span { font-size: .62rem; color: var(--muted); }
.store-count small { font-size: .64rem; color: var(--jade); margin-top: .2rem; }
.store-intro { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 1.5rem; margin: 1rem 0 .6rem; padding: .8rem 1rem; background: var(--market-dark); color: var(--market-light); border: 1px solid var(--line-strong); }
.store-intro ol { display: flex; flex-wrap: wrap; gap: 1rem; list-style: none; margin: 0; padding: 0; }
.store-intro li { display: flex; align-items: center; gap: .4rem; font: 500 .78rem/1.5 var(--serif); white-space: nowrap; }
.store-intro b { color: var(--market-accent); font: 500 .56rem/1 var(--sans); font-variant-numeric: tabular-nums; letter-spacing: .05em; }
.store-intro p { border-left: 1px solid color-mix(in srgb, var(--market-light) 25%, transparent); padding-left: 1.2rem; margin: 0; color: color-mix(in srgb, var(--market-light) 82%, transparent); font-size: .64rem; line-height: 1.65; }
.store-tabs { display: flex; flex-wrap: wrap; gap: 0 1.5rem; border-bottom: 1px solid var(--line-strong); }
.store-tabs button { position: relative; min-height: 2.75rem; min-width: 4rem; padding: .65rem 0; border: 0; border-radius: 0; background: none; color: var(--muted); font: 500 .85rem/1.5 var(--serif); cursor: pointer; }
.store-tabs button.active { color: var(--ink); }
.store-tabs button.active::after { content: ''; position: absolute; inset-inline: 0; bottom: -1px; height: 3px; background: var(--market-accent); }
.store-tabs span { color: var(--muted); margin-left: .4rem; font: .6rem/1 var(--sans); font-variant-numeric: tabular-nums; }
.store-scope-note { margin: .6rem 0; color: var(--muted); font-size: .7rem; line-height: 1.7; }
.store-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) 8.5rem 9rem; gap: 1rem; margin: .85rem 0; }
.store-toolbar label { display: grid; gap: .3rem; min-width: 0; }
.store-toolbar label > span:first-child { color: var(--muted); font-size: .59rem; }
.store-toolbar input, .store-toolbar select { box-sizing: border-box; min-width: 0; width: 100%; min-height: 2.25rem; padding: .4rem .5rem; border: 0; border-bottom: 1px solid var(--line-strong); border-radius: 0; background: color-mix(in srgb, var(--surface) 55%, transparent); color: var(--ink); font: .73rem/1.5 var(--sans); }
.store-search-field { display: flex; align-items: center; position: relative; }
.store-search-field svg { position: absolute; left: .55rem; width: .95rem; height: .95rem; color: var(--muted); pointer-events: none; }
.store-search input { padding-left: 2rem; }
.store-search input::placeholder { color: var(--muted); }
.store-filter-summary { display: flex; align-items: center; flex-wrap: wrap; gap: .45rem .7rem; margin: -.15rem 0 .85rem; padding: .45rem .65rem; border-left: 2px solid var(--market-accent); background: color-mix(in srgb, var(--surface) 60%, transparent); color: var(--muted); font-size: .64rem; }
.store-filter-summary > span { flex: none; }
.store-filter-summary ul { display: flex; flex-wrap: wrap; gap: .4rem; flex: 1 1 10rem; min-width: 0; list-style: none; padding: 0; margin: 0; }
.store-filter-summary li { min-width: 0; max-width: min(100%, 17rem); padding: .15rem .4rem; border: 1px solid var(--line); color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.5; }
.store-filter-summary button { flex: none; min-height: 2rem; padding: .3rem .4rem; border: 0; border-radius: 0; background: transparent; color: var(--jade); font: inherit; cursor: pointer; }
.store-filter-summary button:hover { background: var(--jade-wash); }
.store-result { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin: 1.1rem 0 .7rem; color: var(--muted); font-size: .62rem; }
.store-result > span:first-child { display: flex; align-items: center; gap: .4rem; }
.store-result i { height: .85rem; width: 3px; background: var(--market-accent); }
.store-result small { font-size: .48rem; letter-spacing: .1em; margin-right: .4rem; }
.store-result b { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
.model-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: .8rem; }
.store-active { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .8rem 1rem; border: 1px solid var(--line-strong); border-left: 3px solid var(--jade); background: var(--jade-wash); color: var(--ink); font-size: .74rem; }
.store-active > div { display: grid; gap: .3rem; min-width: 0; overflow-wrap: anywhere; }
.store-active strong { font: 600 .88rem/1.5 var(--serif); }
.store-active span { font-size: .68rem; }
.store-active button { white-space: nowrap; }
.store-active button, .store-empty button, .store-error button { min-height: 2rem; padding: .4rem .7rem; border: 1px solid var(--line-strong); border-radius: 0; background: var(--surface); color: var(--ink); font: .73rem/1.5 var(--sans); cursor: pointer; }
.store-active button:disabled { opacity: .5; cursor: not-allowed; }
.store-empty { padding: 3rem 1rem; margin: .8rem 0; border: 1px dashed var(--line-strong); text-align: center; color: var(--muted); font-size: .75rem; line-height: 1.8; }
.store-empty strong { color: var(--ink); font: 600 1.1rem/1.6 var(--serif); }
.store-error { display: flex; align-items: center; justify-content: space-between; gap: .7rem; padding: .65rem .8rem; border: 1px solid color-mix(in srgb, var(--danger, #a64c3c) 38%, var(--line)); background: var(--surface); color: var(--danger, #a64c3c); font-size: .73rem; line-height: 1.7; }
.store-error button { flex: none; }
.store-note { display: flex; justify-content: space-between; gap: 1.5rem; margin-top: 1.4rem; padding-top: .8rem; border-top: 1px solid var(--line-strong); color: var(--muted); font-size: .63rem; line-height: 1.8; }
.store-note strong { flex: none; color: var(--ink); font: 500 .78rem/1.7 var(--serif); }
.store-note p { margin: 0; max-width: 40rem; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--focus, var(--jade)); outline-offset: 3px; }
.narrative-terminal.redesigned-studio.archive-workspace .local-model-store .store-toolbar .store-search .store-search-field input:focus { outline: none; box-shadow: none; border-bottom-color: var(--market-accent); }
@container (min-width: 980px) { .model-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@container (max-width: 760px) { .store-intro { grid-template-columns: 1fr; gap: .45rem; } .store-intro p { padding: 0; border: 0; } .store-note { display: block; } .store-note p { margin-top: .3rem; } }
@container (max-width: 680px) { .model-grid { grid-template-columns: 1fr; } .store-toolbar { grid-template-columns: minmax(0, 1fr) 7.5rem 8rem; gap: .65rem; } }
@container (max-width: 520px) { .store-toolbar { grid-template-columns: 1fr 1fr; } .store-search { grid-column: 1 / -1; } .store-count { padding-left: .7rem; } .store-count strong { font-size: 3rem; } .store-result small { display: none; } }
@container (max-width: 390px) { .store-count { display: none; } .store-toolbar { grid-template-columns: 1fr; } .store-result, .store-error { flex-wrap: wrap; } .store-active { align-items: start; } }
</style>
