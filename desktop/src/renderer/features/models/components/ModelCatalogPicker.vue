<script setup lang="ts">
import { isLocalConnection } from '../../../../contracts/models/local-model-contracts'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { classifyModelFamily, modelRouteKey, type ModelCatalogChoice, type ModelConnectionSummary, type ModelFamilyId } from '../services/model-catalog'

const props = withDefaults(defineProps<{
  choices: ModelCatalogChoice[]
  connections: ModelConnectionSummary[]
  model?: string
  connectionId?: string
  label?: string
  disabled?: boolean
  compact?: boolean
  allowEmpty?: boolean
  emptyLabel?: string
  allowManual?: boolean
  testId?: string
}>(), {
  model: '',
  connectionId: '',
  label: '模型',
  emptyLabel: '跟随当前操作的模型分配'
})

const emit = defineEmits<{ select: [choice: ModelCatalogChoice | null] }>()
const root = ref<HTMLElement>()
const searchInput = ref<HTMLInputElement>()
const open = ref(false)
const query = ref('')
const activeFamily = ref<'all' | ModelFamilyId>('all')
const manualOpen = ref(false)
const manualConnectionId = ref('')
const manualModel = ref('')
const trigger = ref<HTMLButtonElement>()
const panel = ref<HTMLElement>()
const panelStyle = ref({ left: '0px', top: '0px', visibility: 'hidden' as 'hidden' | 'visible' })

const selectedKey = computed(() => modelRouteKey(props.connectionId, props.model))
const selectedChoice = computed(() => props.choices.find((choice) => choice.key === selectedKey.value) || null)
const selectedFamily = computed(() => selectedChoice.value?.family || (props.model ? classifyModelFamily(props.model) : null))
const visibleFamilies = computed(() => {
  const ids = new Set(props.choices.map((choice) => choice.family.id))
  return [...new Map(props.choices.map((choice) => [choice.family.id, choice.family])).values()]
    .filter((family) => ids.has(family.id))
    .sort((left, right) => left.order - right.order)
})
const filteredChoices = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  return props.choices.filter((choice) => (activeFamily.value === 'all' || choice.family.id === activeFamily.value)
    && (!needle || `${choice.model} ${choice.connectionName} ${choice.connectionHost} ${choice.family.label}`.toLocaleLowerCase().includes(needle)))
})
const groupedChoices = computed(() => visibleFamilies.value.map((family) => ({
  family,
  choices: filteredChoices.value.filter((choice) => choice.family.id === family.id)
})).filter((group) => group.choices.length))
const triggerTitle = computed(() => selectedChoice.value?.model || props.model || props.emptyLabel)
const triggerSubtitle = computed(() => {
  if (selectedChoice.value) return `${selectedChoice.value.family.label} · ${selectedChoice.value.connectionName}`
  if (props.model) return `${selectedFamily.value?.label || '其他'} · ${props.connections.find((item) => item.id === props.connectionId)?.name || '接口待核对'}`
  return '按任务设置自动选择'
})

watch(() => props.connections, (connections) => {
  if (!connections.some((item) => item.id === manualConnectionId.value && !isLocalConnection(item.id))) manualConnectionId.value = connections.find(item => !isLocalConnection(item.id))?.id || ''
}, { immediate: true, deep: true })

// Search means search the entire catalog, not only a previously chosen brand.
watch(query, () => { activeFamily.value = 'all' })

onMounted(() => {
  document.addEventListener('pointerdown', handleOutsidePointer)
  window.addEventListener('resize', positionPanel)
  document.addEventListener('scroll', handleScroll, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleOutsidePointer)
  window.removeEventListener('resize', positionPanel)
  document.removeEventListener('scroll', handleScroll, true)
})

function positionPanel() {
  if (!open.value || !trigger.value || !panel.value) return
  const anchor = trigger.value.getBoundingClientRect()
  const width = panel.value.offsetWidth, height = panel.value.offsetHeight
  const left = Math.max(12, Math.min(props.compact ? anchor.right - width : anchor.left, window.innerWidth - width - 12))
  const preferredTop = anchor.bottom + height + 8 <= window.innerHeight - 12 ? anchor.bottom + 8 : anchor.top - height - 8
  const top = Math.max(12, Math.min(preferredTop, window.innerHeight - height - 12))
  panelStyle.value = { left: `${left}px`, top: `${top}px`, visibility: 'visible' }
}

function handleScroll(event: Event) {
  if (open.value && !panel.value?.contains(event.target as Node)) positionPanel()
}

async function toggle() {
  if (props.disabled) return
  open.value = !open.value
  if (!open.value) return
  query.value = ''
  activeFamily.value = 'all'
  manualOpen.value = false
  manualConnectionId.value = props.connections.find(item => item.id === props.connectionId && !isLocalConnection(item.id))?.id || props.connections.find(item => !isLocalConnection(item.id))?.id || ''
  panelStyle.value.visibility = 'hidden'
  await nextTick()
  positionPanel()
  searchInput.value?.focus()
}

function choose(choice: ModelCatalogChoice | null) {
  if (choice?.disabledReason) return
  emit('select', choice)
  close()
}

function close() {
  open.value = false
  trigger.value?.focus()
}

function chooseManual() {
  const connection = props.connections.find((item) => item.id === manualConnectionId.value && !isLocalConnection(item.id))
  const model = manualModel.value.trim()
  if (!connection || connection.disabledReason || connection.enabled === false || !model) return
  const family = classifyModelFamily(model)
  choose({
    key: modelRouteKey(connection.id, model),
    connectionId: connection.id,
    connectionName: connection.name.trim() || '未命名接口',
    connectionHost: safeHost(connection.baseUrl),
    model,
    label: `${model} · ${connection.name.trim() || '未命名接口'}`,
    family,
    duplicateModel: props.choices.some((item) => item.model.toLocaleLowerCase('en-US') === model.toLocaleLowerCase('en-US') && item.connectionId !== connection.id),
    discovered: false
  })
  manualModel.value = ''
}

function handleOutsidePointer(event: PointerEvent) {
  if (open.value && root.value && !root.value.contains(event.target as Node) && !panel.value?.contains(event.target as Node)) open.value = false
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
  }
}

function safeHost(value = '') {
  try { return new URL(value).host || '地址待填写' } catch { return '地址待核对' }
}
</script>

<template>
  <div ref="root" class="model-catalog-picker" :class="{ compact, open }" @keydown="handleKeydown">
    <span v-if="label" class="model-catalog-label">{{ label }}</span>
    <button ref="trigger" class="model-catalog-trigger" type="button" :disabled="disabled" :aria-expanded="open" aria-haspopup="dialog" :data-testid="testId" :data-model="model" :data-connection-id="connectionId" :title="`${triggerTitle} · ${triggerSubtitle}`" @click="toggle">
      <span v-if="selectedFamily" class="model-family-mark">{{ selectedFamily.mark }}</span>
      <span v-else class="model-family-mark quiet">模</span>
      <span class="model-trigger-copy"><b>{{ triggerTitle }}</b><small>{{ triggerSubtitle }}</small></span>
      <span class="model-trigger-chevron" aria-hidden="true">⌄</span>
    </button>

    <Teleport to="body">
    <section v-if="open" ref="panel" class="model-catalog-panel" :class="{ 'manual-open': manualOpen, 'compact-panel': compact }" :style="panelStyle" :data-picker="testId" role="dialog" aria-label="选择模型及所属接口" @keydown="handleKeydown">
      <header>
        <div><b>选择模型</b><small>选择后自动使用条目右侧标明的接口</small></div>
        <button type="button" aria-label="关闭模型选择" @click="close">×</button>
      </header>
      <label v-if="!manualOpen" class="model-catalog-search"><span aria-hidden="true">⌕</span><input v-assist-field="{ id: 'ModelCatalogPicker.query', read: () => query, write: value => { query = String(value) } }" ref="searchInput" v-model="query" type="search" placeholder="搜索所有模型或接口名称" aria-label="搜索模型或接口名称"></label>
      <nav v-if="!manualOpen" class="model-family-tabs" aria-label="模型分类">
        <button type="button" :aria-pressed="activeFamily === 'all'" :class="{ active: activeFamily === 'all' }" @click="activeFamily = 'all'">全部 <i>{{ choices.length }}</i></button>
        <button v-for="family in visibleFamilies" :key="family.id" type="button" :data-family="family.id" :aria-pressed="activeFamily === family.id" :class="{ active: activeFamily === family.id }" @click="activeFamily = family.id">{{ family.label }} <i>{{ choices.filter((choice) => choice.family.id === family.id).length }}</i></button>
      </nav>
      <div v-if="!manualOpen" class="model-catalog-scroll">
        <button v-if="allowEmpty && !query && activeFamily === 'all'" class="model-follow-choice" type="button" :class="{ selected: !model }" @click="choose(null)"><span class="model-family-mark quiet">随</span><span><b>{{ emptyLabel }}</b><small>根据本次操作采用设置页中的任务模型</small></span></button>
        <section v-for="group in groupedChoices" :key="group.family.id" class="model-family-group">
          <header><span>{{ group.family.mark }}</span><b>{{ group.family.label }}</b><small>{{ group.choices.length }} 个可选路由</small></header>
          <div class="model-choice-list">
            <button v-for="choice in group.choices" :key="choice.key" type="button" :class="{ selected: choice.key === selectedKey }" :disabled="Boolean(choice.disabledReason)" :title="choice.disabledReason" :data-model="choice.model" :data-connection-id="choice.connectionId" @click="choose(choice)">
              <span class="model-choice-main"><b>{{ choice.model }}</b><small>{{ choice.disabledReason || (isLocalConnection(choice.connectionId) ? '本机可用' : choice.discovered ? '接口已返回此模型' : '手动指定或已分配') }}</small></span>
              <span class="model-route-owner"><em>{{ choice.connectionName }}</em><small>{{ choice.connectionHost }}</small></span>
              <i v-if="choice.duplicateModel" title="同名模型也存在于其他接口">同名</i>
            </button>
          </div>
        </section>
        <p v-if="!groupedChoices.length" class="model-catalog-empty">没有匹配的模型。{{ allowManual ? '可以在下方手动指定模型 ID 和接口。' : '请到设置的接口连接页读取模型目录。' }}</p>
      </div>
      <footer v-if="allowManual && connections.some(c => !isLocalConnection(c.id))" class="model-manual-entry" :class="{ open: manualOpen }">
        <button type="button" :aria-expanded="manualOpen" @click="manualOpen = !manualOpen"><span>{{ manualOpen ? '使用服务商提供的完整名称' : '找不到要用的模型？' }}</span><b>{{ manualOpen ? '返回模型目录' : '手动指定模型 ID' }}</b></button>
        <div v-if="manualOpen">
          <label>使用哪个接口<select v-model="manualConnectionId" aria-label="手动模型所属接口"><option v-for="connection in connections.filter(c => !isLocalConnection(c.id))" :key="connection.id" :value="connection.id" :disabled="connection.enabled === false || Boolean(connection.disabledReason)">{{ connection.name || '未命名接口' }} · {{ safeHost(connection.baseUrl) }}{{ connection.enabled === false ? ' · 已停用' : '' }}</option></select></label>
          <label>模型 ID<input v-assist-field="{ id: 'ModelCatalogPicker.manualModel', read: () => manualModel, write: value => { manualModel = String(value) } }" v-model="manualModel" aria-label="手动模型 ID" spellcheck="false" placeholder="服务商提供的完整模型 ID" @keydown.enter.prevent="chooseManual"></label>
          <button type="button" :disabled="!manualConnectionId || !manualModel.trim()" @click="chooseManual">使用此模型</button>
        </div>
      </footer>
    </section>
    </Teleport>
  </div>
</template>

<style scoped>
.model-catalog-picker { position: relative; min-width: 0; display: grid; gap: 6px; color: var(--ink); font-family: var(--sans); }
.model-catalog-label { color: var(--muted); font-size: 9px; }
.model-catalog-trigger { width: 100%; min-height: 48px; display: grid; grid-template-columns: 32px minmax(0, 1fr) 18px; align-items: center; gap: 9px; padding: 6px 9px; border: 1px solid var(--line); border-radius: 2px; background: rgba(255, 253, 247, .84); color: var(--ink); text-align: left; cursor: pointer; }
.model-catalog-trigger:hover:not(:disabled), .open .model-catalog-trigger { border-color: rgba(39, 85, 72, .55); box-shadow: inset 0 -2px 0 rgba(39, 85, 72, .16); }
.model-catalog-trigger:focus-visible { outline: 2px solid rgba(39, 85, 72, .34); outline-offset: 2px; }
.model-catalog-trigger:disabled { cursor: default; opacity: .58; }
.model-family-mark { width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid rgba(47, 75, 65, .34); border-radius: 50%; background: var(--jade-wash); color: var(--jade-deep); font: 600 10px/1 var(--serif); }
.model-family-mark.quiet { border-style: dashed; border-color: var(--line-strong); background: transparent; color: var(--muted); }
.model-trigger-copy { min-width: 0; display: grid; gap: 3px; }
.model-trigger-copy b { overflow: hidden; font: 600 12px/1.2 var(--sans); text-overflow: ellipsis; white-space: nowrap; }
.model-trigger-copy small { overflow: hidden; color: var(--muted); font: 400 9px/1.2 var(--sans); text-overflow: ellipsis; white-space: nowrap; }
.model-trigger-chevron { color: var(--muted); font-size: 16px; transform: translateY(-2px); transition: transform .16s ease; }
.open .model-trigger-chevron { transform: rotate(180deg) translateY(1px); }
.model-catalog-panel { position: fixed; z-index: 120; width: min(560px, calc(100vw - 48px)); height: min(330px, calc(100vh - 96px)); display: grid; grid-template-rows: auto auto auto minmax(64px, 1fr) auto; overflow: hidden; border: 1px solid var(--line-strong); border-radius: 4px; background: #f7f3e9; color: var(--ink); font-family: var(--sans); box-shadow: 0 22px 58px rgba(33, 31, 26, .22), 0 3px 9px rgba(33, 31, 26, .12); animation: catalog-reveal .14s ease-out; }
.model-catalog-panel::before { position: absolute; inset: 0; pointer-events: none; content: ''; background: repeating-linear-gradient(0deg, transparent 0 31px, rgba(82, 69, 49, .025) 31px 32px); }
.model-catalog-panel > * { position: relative; }
.model-catalog-panel > header { min-height: 56px; display: flex; align-items: center; justify-content: space-between; padding: 11px 14px 9px; border-bottom: 1px solid var(--line); }
.model-catalog-panel > header div { display: grid; gap: 3px; }
.model-catalog-panel > header b { font: 600 15px/1.2 var(--serif); }
.model-catalog-panel > header small { display: block !important; color: var(--muted); font-size: 9px; }
.model-catalog-panel > header > button { width: 30px; height: 30px; border: 0; background: transparent; color: var(--muted); font-size: 18px; cursor: pointer; }
.model-catalog-search { min-height: 42px; display: grid; grid-template-columns: 22px minmax(0, 1fr); align-items: center; margin: 10px 12px 6px; padding: 0 9px; border: 1px solid var(--line); background: rgba(255, 254, 249, .82); }
.model-catalog-search span { color: var(--muted); font-size: 18px; }
.model-catalog-search input { width: 100%; height: 38px; padding: 0; border: 0; outline: 0; background: transparent; color: var(--ink); font: 500 11px/1 var(--sans); }
.model-family-tabs { display: flex; flex-wrap: wrap; gap: 5px; padding: 3px 12px 9px; }
.model-family-tabs::-webkit-scrollbar { display: none; }
.model-family-tabs button { flex: 0 0 auto; min-height: 28px; padding: 0 9px; border: 1px solid transparent; border-radius: 14px; background: rgba(101, 91, 72, .07); color: var(--muted); font: 600 9px/1 var(--sans); cursor: pointer; }
.model-family-tabs button.active { border-color: rgba(47, 75, 65, .34); background: var(--jade-wash); color: var(--jade-deep); }
.model-family-tabs i { margin-left: 3px; font-style: normal; opacity: .62; }
.model-catalog-scroll { min-height: 0; overflow: auto; padding: 0 12px 12px; scrollbar-width: thin; scrollbar-color: rgba(70, 78, 67, .35) transparent; }
.model-follow-choice { width: 100%; min-height: 54px; display: grid; grid-template-columns: 32px minmax(0, 1fr); align-items: center; gap: 9px; margin-bottom: 9px; padding: 8px; border: 1px dashed var(--line-strong); background: rgba(255, 253, 247, .54); color: var(--ink); text-align: left; cursor: pointer; }
.model-follow-choice > span:last-child { min-width: 0; display: grid; gap: 3px; }
.model-follow-choice b { font-size: 11px; }
.model-follow-choice small { color: var(--muted); font-size: 9px; }
.model-follow-choice.selected { border-style: solid; border-color: var(--jade); background: var(--jade-wash); }
.model-family-group { display: grid; gap: 6px; margin-top: 9px; }
.model-family-group > header { display: grid; grid-template-columns: 24px auto 1fr; align-items: center; gap: 6px; color: var(--ink-2); }
.model-family-group > header > span { width: 22px; height: 22px; display: grid; place-items: center; border: 1px solid var(--line-strong); border-radius: 50%; color: var(--jade-deep); font: 600 8px/1 var(--serif); }
.model-family-group > header b { font: 600 11px/1 var(--serif); }
.model-family-group > header small { display: block !important; color: var(--muted); font-size: 8px; }
.model-choice-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.model-choice-list > button { min-width: 0; min-height: 62px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 8px 9px; border: 1px solid var(--line); background: rgba(255, 253, 247, .72); color: var(--ink); text-align: left; cursor: pointer; }
.model-choice-list > button:hover { border-color: rgba(47, 75, 65, .42); background: #fffdf7; transform: translateY(-1px); }
.model-choice-list > button.selected { border-color: var(--jade); background: var(--jade-wash); box-shadow: inset 3px 0 0 var(--jade); }
.model-choice-main, .model-route-owner { min-width: 0; display: grid; gap: 4px; }
.model-choice-main b { overflow: hidden; font: 600 10px/1.2 var(--sans); text-overflow: ellipsis; white-space: nowrap; }
.model-choice-main small, .model-route-owner small { overflow: hidden; color: var(--muted); font: 400 8px/1.2 var(--sans); text-overflow: ellipsis; white-space: nowrap; }
.model-route-owner { max-width: 130px; justify-items: end; text-align: right; }
.model-route-owner em { max-width: 100%; overflow: hidden; color: var(--jade-deep); font: 600 9px/1.2 var(--sans); text-overflow: ellipsis; white-space: nowrap; }
.model-choice-list > button > i { grid-column: 1 / -1; width: max-content; margin-top: -5px; padding: 2px 5px; border: 1px solid rgba(155, 72, 51, .24); color: var(--cinnabar); font: 600 7px/1 var(--sans); font-style: normal; letter-spacing: .06em; }
.model-catalog-empty { margin: 14px 0; padding: 18px; border: 1px dashed var(--line-strong); color: var(--muted); font: 400 10px/1.7 var(--sans); text-align: center; }
.model-manual-entry { border-top: 1px solid var(--line); background: rgba(232, 226, 213, .55); }
.model-manual-entry > button { width: 100%; min-height: 38px; display: flex; align-items: center; justify-content: space-between; padding: 0 13px; border: 0; background: transparent; color: var(--muted); cursor: pointer; }
.model-manual-entry > button span { font-size: 9px; }
.model-manual-entry > button b { color: var(--jade-deep); font-size: 9px; }
.model-manual-entry > div { display: grid; grid-template-columns: minmax(0, 1fr); align-items: end; gap: 12px; padding: 12px; }
.model-catalog-panel.manual-open { grid-template-rows: auto minmax(0, 1fr); }
.model-catalog-panel.manual-open .model-manual-entry { min-height: 0; overflow: auto; }
.model-catalog-panel :is(button, input, select):focus-visible { outline: 2px solid var(--jade); outline-offset: 2px; }
.model-manual-entry label { display: grid; gap: 4px; color: var(--muted); font-size: 8px; }
.model-manual-entry select, .model-manual-entry input { width: 100%; height: 34px; padding: 0 7px; border: 1px solid var(--line); background: #fffdf7; color: var(--ink); font: 500 10px/1 var(--sans); }
.model-manual-entry > div > button { height: 34px; padding: 0 10px; border: 1px solid var(--jade); background: var(--jade-deep); color: #fffdf7; font: 600 9px/1 var(--sans); cursor: pointer; }
.model-manual-entry > div > button:disabled { cursor: default; opacity: .45; }
.compact { display: block; }
.compact .model-catalog-label { display: none; }
.compact .model-catalog-trigger { min-height: 28px; grid-template-columns: 21px minmax(0, 1fr) 12px; gap: 5px; padding: 2px 5px; border: 0; border-radius: 14px; background: rgba(115, 105, 84, .07); }
.compact .model-family-mark { width: 20px; height: 20px; font-size: 7px; }
.compact .model-trigger-copy { gap: 1px; }
.compact .model-trigger-copy b { font-size: 9px; }
.compact .model-trigger-copy small { font-size: 7px; }
.model-catalog-panel.compact-panel { width: min(520px, calc(100vw - 32px)); height: min(440px, calc(100vh - 120px)); }
@keyframes catalog-reveal { from { opacity: 0; transform: translateY(-5px) scale(.99); } to { opacity: 1; transform: none; } }
@media (max-width: 720px) {
  .model-choice-list { grid-template-columns: minmax(0, 1fr); }
  .model-manual-entry > div { grid-template-columns: 1fr; }
  .model-manual-entry > div > button { width: 100%; }
}
@media (prefers-reduced-motion: reduce) { .model-catalog-panel { animation: none; } .model-choice-list > button { transform: none !important; } }
</style>
