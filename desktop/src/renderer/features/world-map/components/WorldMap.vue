<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import StudioIcon from '../../../ui/StudioIcon.vue'
import type { WorldMapDocument, WorldMapEvent, WorldMapImageCandidate, WorldMapStylePreset, WorldMapView } from '../../../../contracts/world-map/world-map'
import { copyWorldMapMarker, createWorldMapLocationIndex } from '../../../../contracts/world-map/world-map-locations'

type Marker = WorldMapDocument['markers'][number]
const props = withDefaults(defineProps<{ view: WorldMapView | null; loading: boolean; error: string; saving: boolean; saveError: string
  background?: string | null; backgroundError?: string; candidate?: WorldMapImageCandidate | null; generating?: boolean; adopting?: boolean; generationError?: string
  focusLocation?: string; aiConnections?: Array<{ id: string; name: string; apiKeyConfigured: boolean }> }>(), {
  focusLocation: '',
  background: null,
  backgroundError: '',
  candidate: null,
  generating: false,
  adopting: false,
  generationError: '',
  aiConnections: () => []
})
const emit = defineEmits<{
  save: [document: WorldMapDocument]
  retry: []
  openChapter: [chapterId: number]
  openEvent: [event: { source: WorldMapEvent['source']; sourceId: string }]
  openCharacter: [name: string]
  dirty: [dirty: boolean]
  generate: [input: { connectionId: string; model: string; stylePreset: WorldMapStylePreset }]
  cancelGeneration: []
  adopt: []
  discardCandidate: []
}>()
const copy = (value: WorldMapDocument): WorldMapDocument => value.version === 2
  ? { version: 2, markers: value.markers.map(copyWorldMapMarker), background: value.background ? { ...value.background } : null }
  : { version: 1, markers: value.markers.map(copyWorldMapMarker) }
const withMarkers = (value: WorldMapDocument, markers: Marker[]): WorldMapDocument => value.version === 2 ? { ...value, markers } : { version: 1, markers }
const fingerprint = (value: WorldMapDocument) => JSON.stringify([...value.markers].sort((a, b) => a.location < b.location ? -1 : a.location > b.location ? 1 : 0).map(marker => [marker.location, marker.x, marker.y, [...(marker.sourceLocations ?? [])].sort()]))
const baseline = ref<WorldMapDocument>({ version: 1, markers: [] })
const baselineRevision = ref('')
const draft = ref<WorldMapDocument>({ version: 1, markers: [] })
const pending = ref<string | null>(null)
const externalChange = ref(false)
const savedNotice = ref('')
const dismissedSaveError = ref(false)
const confirmDiscard = ref(false)
const query = ref('')
const throughPosition = ref<number | null>(null)
const selectedLocation = ref('')
const selectedEventId = ref('')
const placing = ref('')
const plot = ref<HTMLElement>()
const coordinateX = ref<string | number>('')
const coordinateY = ref<string | number>('')
const coordinateError = ref('')
const eventLimit = ref(60)
const locationLimit = ref(120)
const generatorOpen = ref(false)
const inspectorOpen = ref(false)
const editMode = ref(false)
const showLabels = ref(true)
const undoHistory = ref<Marker[][]>([])
let submittedHistoryLength = 0
const canvas = ref<HTMLElement>()
const imageModel = ref('gpt-image-1')
const imageConnectionId = ref('')
const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
const panning = ref(false)
const draggingPin = ref(false)
let workItemId = ''
let drag: { pointerId: number; location: string; clientX: number; clientY: number; original: Marker; moved: boolean } | null = null
let panDrag: { pointerId: number; clientX: number; clientY: number; x: number; y: number; moved: boolean } | null = null
let suppressCanvasClick = false
let suppressPinClick = false
const dirty = computed(() => fingerprint(draft.value) !== fingerprint(baseline.value))
const canEdit = computed(() => !!props.view && !props.loading && !props.error && !externalChange.value)
const canAdjust = computed(() => canEdit.value && editMode.value && !props.adopting)
const canUndo = computed(() => canAdjust.value && undoHistory.value.length > 0 && pending.value === null && !props.saving && !draggingPin.value)
const chapterIndex = computed(() => new Map((props.view?.chapters ?? []).map(chapter => [chapter.id, chapter])))
const chapterChoices = computed(() => [...(props.view?.chapters ?? [])].sort((a, b) => a.position - b.position))
const unassignedCount = computed(() => (props.view?.events ?? []).filter(event => event.chapterId === null || !chapterIndex.value.has(event.chapterId)).length)
const normalize = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase()
const locationProjection = computed(() => createWorldMapLocationIndex(draft.value.markers))
const events = computed(() => {
  const term = normalize(query.value)
  return (props.view?.events ?? []).filter(event => {
    const chapter = event.chapterId === null ? undefined : chapterIndex.value.get(event.chapterId)
    if (throughPosition.value !== null && (!chapter || chapter.position > throughPosition.value)) return false
    return !term || normalize([event.title, event.time, event.location, ...locationProjection.value.locationsFor(event.location), event.event, event.result, ...event.characters].join('\n')).includes(term)
  })
})
const markerIndex = computed(() => new Map(draft.value.markers.map(marker => [marker.location, marker])))
const locations = computed(() => {
  const names = new Set(events.value.flatMap(event => locationProjection.value.locationsFor(event.location)))
  // Retain saved pins whose source event was removed, without leaking locations
  // outside a chapter cutoff. Existing pins are never silently deleted.
  if (throughPosition.value === null) for (const marker of draft.value.markers) {
    if (!query.value.trim() || normalize(marker.location).includes(normalize(query.value))) names.add(marker.location)
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'zh-CN'))
})
const pins = computed(() => draft.value.markers.filter(marker => locations.value.includes(marker.location)))
const unplaced = computed(() => locations.value.filter(location => !markerIndex.value.has(location)))
const selectedMarker = computed(() => markerIndex.value.get(selectedLocation.value))
const relatedEvents = computed(() => selectedLocation.value ? events.value.filter(event => locationProjection.value.locationsFor(event.location).includes(selectedLocation.value)) : events.value)
const displayedEvents = computed(() => relatedEvents.value.slice(0, eventLimit.value))
const displayedLocations = computed(() => locations.value.slice(0, locationLimit.value))
const selectedEvent = computed(() => events.value.find(event => event.id === selectedEventId.value) ?? null)
const selectedEventPlaces = computed(() => selectedEvent.value ? locationProjection.value.locationsFor(selectedEvent.value.location).filter(name => markerIndex.value.has(name)) : [])
const selectedChapter = computed(() => selectedEvent.value?.chapterId ? chapterIndex.value.get(selectedEvent.value.chapterId) : undefined)
const people = computed(() => [...new Set((selectedEvent.value ? [selectedEvent.value] : relatedEvents.value).flatMap(event => event.characters).map(name => name.trim()).filter(Boolean))])
const mirrorNotice = computed(() => ({ synced: '', pending: '定位已进入正式数据，可读镜像待同步。', conflict: '可读镜像有外部改动，冲突已保留；不会覆盖外部文件。', failed: '可读镜像同步失败，正式数据与镜像状态请分别核对。' })[props.view?.mirrorStatus ?? 'synced'])
const sourceLocations = computed(() => new Set([...(props.view?.events ?? []).map(event => event.location.trim()), ...draft.value.markers.map(marker => marker.location)].filter(Boolean)))
const selectedConnection = computed(() => props.aiConnections.find(connection => connection.id === imageConnectionId.value))
const canGenerate = computed(() => !!props.view && sourceLocations.value.size > 0 && !!imageModel.value.trim() && !!selectedConnection.value?.apiKeyConfigured && !dirty.value && !externalChange.value && !props.loading && !props.saving && !props.error && !props.generating && !props.adopting)
const mapTransform = computed(() => `translate(${panX.value}px, ${panY.value}px) scale(${zoom.value})`)

function install(view: WorldMapView) {
  baseline.value = copy(view.document); draft.value = copy(view.document); baselineRevision.value = view.revision
  pending.value = null; externalChange.value = false; confirmDiscard.value = false; placing.value = ''; coordinateError.value = ''; drag = null
  undoHistory.value = []; submittedHistoryLength = 0; draggingPin.value = false
}
watch(() => props.view, view => {
  if (!view) return
  if (view.workItemId !== workItemId) {
    workItemId = view.workItemId; install(view); selectedLocation.value = ''; selectedEventId.value = ''; query.value = ''; throughPosition.value = null; savedNotice.value = ''; dismissedSaveError.value = false
    editMode.value = false; showLabels.value = true; inspectorOpen.value = false; panDrag = null; panning.value = false; suppressCanvasClick = false; suppressPinClick = false; resetView(); return
  }
  if (pending.value !== null && fingerprint(view.document) === pending.value) {
    undoHistory.value = undoHistory.value.slice(submittedHistoryLength)
    baseline.value = copy(view.document); baselineRevision.value = view.revision; pending.value = null; externalChange.value = false
    savedNotice.value = dirty.value ? '本次提交已保存，后续调整仍待保存。' : '地点定位已保存。'
  } else if (view.revision !== baselineRevision.value) {
    if (!dirty.value && pending.value === null) install(view)
    else { externalChange.value = true; pending.value = null; savedNotice.value = '' }
  }
}, { immediate: true })
watch(() => props.saveError, error => { if (error) { pending.value = null; savedNotice.value = ''; dismissedSaveError.value = false } })
watch([dirty, pending], ([changed, saving]) => emit('dirty', changed || saving !== null), { immediate: true })
watch(selectedMarker, marker => { coordinateX.value = marker?.x ?? ''; coordinateY.value = marker?.y ?? ''; coordinateError.value = '' })
watch(selectedLocation, () => { const marker = selectedMarker.value; coordinateX.value = marker?.x ?? ''; coordinateY.value = marker?.y ?? ''; coordinateError.value = ''; placing.value = '' })
watch([locations, events], () => {
  locationLimit.value = 120; eventLimit.value = 60
  if (selectedLocation.value && !locations.value.includes(selectedLocation.value)) { selectedLocation.value = ''; placing.value = '' }
  if (selectedEventId.value && !events.value.some(event => event.id === selectedEventId.value)) selectedEventId.value = ''
})
watch(selectedLocation, () => { eventLimit.value = 60 })
// Wait for v-model to commit text (including IME) before changing the layout.
watch(query, value => { if (value.trim()) inspectorOpen.value = true })
watch(() => props.aiConnections, connections => {
  if (!connections.some(connection => connection.id === imageConnectionId.value && connection.apiKeyConfigured)) imageConnectionId.value = connections.find(connection => connection.apiKeyConfigured)?.id ?? connections[0]?.id ?? ''
}, { immediate: true, deep: true })

let appliedFocus = ''
watch([() => props.focusLocation, () => props.view], ([location]) => {
  if (!location) return
  const target = locationProjection.value.locationsFor(location).find(name => locations.value.includes(name))
  if (!target) return
  const key = `${props.view?.workItemId}:${location}`
  if (key === appliedFocus) return
  appliedFocus = key
  selectLocation(target)
}, { immediate: true })
async function focusOnLocation(location = selectedLocation.value) {
  const identity = workItemId
  await nextTick()
  if (identity !== workItemId || selectedLocation.value !== location) return
  const marker = markerIndex.value.get(location), bounds = plot.value?.getBoundingClientRect(), viewport = canvas.value?.getBoundingClientRect()
  if (!marker || !bounds || !viewport) return
  panX.value += viewport.left + viewport.width / 2 - (bounds.left + bounds.width * marker.x / 100)
  panY.value += viewport.top + viewport.height / 2 - (bounds.top + bounds.height * marker.y / 100)
}
function selectLocation(location: string, focus = true) { selectedLocation.value = location; selectedEventId.value = ''; inspectorOpen.value = true; if (focus) void focusOnLocation(location) }
function selectEvent(event: WorldMapEvent) {
  const places = locationProjection.value.locationsFor(event.location)
  selectLocation(places.includes(selectedLocation.value) ? selectedLocation.value : places[0] ?? '')
  selectedEventId.value = event.id
}
function focusEventPlace(location: string) {
  const eventId = selectedEventId.value
  selectLocation(location)
  selectedEventId.value = eventId
}
function clickPin(location: string) { if (suppressPinClick) { suppressPinClick = false; return } selectLocation(location, false) }
function setEditMode(value: boolean) {
  if (value && !canEdit.value) return
  cancelDrag(); editMode.value = value; placing.value = ''; suppressCanvasClick = false
  if (value) inspectorOpen.value = true
}
function rememberMarkers() {
  if (undoHistory.value.length >= 50 && pending.value !== null) submittedHistoryLength = Math.max(0, submittedHistoryLength - 1)
  undoHistory.value = [...undoHistory.value, draft.value.markers.map(copyWorldMapMarker)].slice(-50)
}
function undoMarkerChange() {
  if (!canUndo.value) return
  const previous = undoHistory.value.at(-1)!
  undoHistory.value = undoHistory.value.slice(0, -1)
  draft.value = withMarkers(draft.value, previous.map(copyWorldMapMarker))
  placing.value = ''; coordinateError.value = ''; savedNotice.value = ''; confirmDiscard.value = false
}
function changeThrough(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'all') throughPosition.value = null
  else { const position = Number(value); if (chapterChoices.value.some(chapter => chapter.position === position)) throughPosition.value = position }
}
function putMarker(location: string, x: number, y: number, remember = true) {
  if (!canAdjust.value || !location || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) return
  if (location.length > 500) { coordinateError.value = '这个地点名称超过 500 个字符，请先在来源事件中整理地点名称。'; return }
  if (!markerIndex.value.has(location) && draft.value.markers.length >= 2000) { coordinateError.value = '本书已达到 2000 个定位标记，请先移除不再需要的定位。'; return }
  const previous = markerIndex.value.get(location)
  const marker = { ...previous, location, x, y }
  if (previous?.x === x && previous.y === y) return
  if (remember) rememberMarkers()
  const exists = markerIndex.value.has(location)
  draft.value = withMarkers(draft.value, exists ? draft.value.markers.map(item => item.location === location ? marker : item) : [...draft.value.markers, marker])
  savedNotice.value = ''; confirmDiscard.value = false; coordinateError.value = ''
}
function applyCoordinates() {
  if (!canAdjust.value) return
  if (coordinateX.value === '' || coordinateY.value === '') { coordinateError.value = '请填写 X 和 Y 坐标，范围为 0–100。'; return }
  const x = Number(coordinateX.value), y = Number(coordinateY.value)
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) { coordinateError.value = 'X 和 Y 都必须在 0–100 之间。'; return }
  putMarker(selectedLocation.value, x, y); placing.value = ''
}
function point(event: PointerEvent | MouseEvent) {
  const bounds = plot.value?.getBoundingClientRect()
  if (!bounds || !bounds.width || !bounds.height) return null
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return null
  const percent = (value: number) => Math.round(Math.max(0, Math.min(100, value)) * 100) / 100
  return { x: percent((event.clientX - bounds.left) / bounds.width * 100), y: percent((event.clientY - bounds.top) / bounds.height * 100) }
}
function placeOnCanvas(event: MouseEvent) {
  if (suppressCanvasClick) { suppressCanvasClick = false; return }
  if (!placing.value || !canAdjust.value || (event.target as HTMLElement).closest('button,.map-view-controls')) return
  const position = point(event)
  if (position) { putMarker(placing.value, position.x, position.y); placing.value = ''; inspectorOpen.value = true }
  else coordinateError.value = '请在地图图片范围内落点，不要点击图片外的留白。'
}
function beginPlace() {
  if (!canEdit.value || !selectedLocation.value) return
  if (selectedLocation.value.length > 500) { coordinateError.value = '这个地点名称超过 500 个字符，请先在来源事件中整理地点名称。'; return }
  setEditMode(true); placing.value = selectedLocation.value; coordinateError.value = ''; inspectorOpen.value = false
  void nextTick(() => canvas.value?.focus({ preventScroll: true }))
}
function startDrag(event: PointerEvent, marker: Marker) {
  if (event.button !== 0 || !canAdjust.value || drag) return
  event.preventDefault()
  ;(event.currentTarget as HTMLElement).focus({ preventScroll: true })
  suppressPinClick = false
  selectedLocation.value = marker.location; selectedEventId.value = ''
  drag = { pointerId: event.pointerId, location: marker.location, clientX: event.clientX, clientY: event.clientY, original: copyWorldMapMarker(marker), moved: false }
  draggingPin.value = true
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function moveDrag(event: PointerEvent) {
  if (!drag || drag.pointerId !== event.pointerId) return
  if (!canAdjust.value) { cancelDrag(); return }
  if (!drag.moved && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) <= 4) return
  const position = point(event)
  if (!position) return
  if (!drag.moved) { rememberMarkers(); drag.moved = true }
  suppressPinClick = true
  putMarker(drag.location, position.x, position.y, false)
}
function finishDrag(event: PointerEvent) { if (drag?.pointerId === event.pointerId) { drag = null; draggingPin.value = false } }
function cancelDrag() {
  if (drag?.moved) {
    const original = drag.original
    draft.value = withMarkers(draft.value, draft.value.markers.map(marker => marker.location === original.location ? { ...original } : marker))
    undoHistory.value = undoHistory.value.slice(0, -1)
  }
  drag = null; draggingPin.value = false; suppressPinClick = false
}
function moveWithKeys(event: KeyboardEvent, marker: Marker) {
  const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
  const direction = directions[event.key]
  if (!direction || !canAdjust.value || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || draggingPin.value) return
  event.preventDefault(); selectedLocation.value = marker.location; selectedEventId.value = ''
  const amount = event.shiftKey ? 5 : 1
  putMarker(marker.location, Math.max(0, Math.min(100, marker.x + direction[0] * amount)), Math.max(0, Math.min(100, marker.y + direction[1] * amount)))
}
function removePin() {
  if (!canAdjust.value || !selectedMarker.value) return
  rememberMarkers()
  draft.value = withMarkers(draft.value, draft.value.markers.filter(marker => marker.location !== selectedLocation.value))
  placing.value = ''; savedNotice.value = ''
}
function requestSave() {
  if (!dirty.value || !canEdit.value || props.saving || pending.value !== null || !props.view) return
  const submitted = copy(draft.value); submittedHistoryLength = undoHistory.value.length; pending.value = fingerprint(submitted); savedNotice.value = ''; dismissedSaveError.value = false; emit('save', submitted)
}
function requestReload() { if (!props.loading && !props.saving) emit('retry') }
function resetDraft() { if (props.view && !props.saving) { install(props.view); dismissedSaveError.value = true; savedNotice.value = '未保存的坐标调整已放弃，事件和正文不变。' } }
function requestGeneration() { if (canGenerate.value) emit('generate', { connectionId: imageConnectionId.value, model: imageModel.value.trim(), stylePreset: 'paper-atlas' }) }
function startPan(event: PointerEvent) {
  if (event.button !== 0 || placing.value || panDrag || (event.target as HTMLElement).closest('.map-pin,.map-view-controls,button')) return
  event.preventDefault()
  ;(event.currentTarget as HTMLElement).focus({ preventScroll: true })
  panDrag = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: panX.value, y: panY.value, moved: false }
  panning.value = true
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function movePan(event: PointerEvent) {
  if (!panDrag || panDrag.pointerId !== event.pointerId) return
  const dx = event.clientX - panDrag.clientX, dy = event.clientY - panDrag.clientY
  if (Math.hypot(dx, dy) > 3) { panDrag.moved = true; suppressCanvasClick = true }
  if (panDrag.moved) { panX.value = panDrag.x + dx; panY.value = panDrag.y + dy }
}
function finishPan(event: PointerEvent) { if (panDrag?.pointerId === event.pointerId) { panDrag = null; panning.value = false } }
function zoomTo(next: number, event?: WheelEvent) {
  const value = Math.max(.5, Math.min(3, Math.round(next * 100) / 100))
  if (value === zoom.value) return
  if (event) {
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect(), cx = event.clientX - bounds.left - bounds.width / 2, cy = event.clientY - bounds.top - bounds.height / 2
    const worldX = (cx - panX.value) / zoom.value, worldY = (cy - panY.value) / zoom.value
    panX.value = cx - worldX * value; panY.value = cy - worldY * value
  }
  zoom.value = value
}
function onWheel(event: WheelEvent) { zoomTo(zoom.value * (event.deltaY < 0 ? 1.12 : .89), event) }
function centerView() { panX.value = 0; panY.value = 0 }
function resetView() { zoom.value = 1; centerView() }
function onMapKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || props.candidate || generatorOpen.value) return
  const target = event.target as HTMLElement
  if (target.closest('input,textarea,select,[contenteditable="true"]')) return
  if (event.key === 'Escape') {
    if (placing.value) { placing.value = ''; coordinateError.value = '' }
    else if (editMode.value) setEditMode(false)
    else if (inspectorOpen.value) inspectorOpen.value = false
    else return
    event.preventDefault(); return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey && canUndo.value) { event.preventDefault(); undoMarkerChange(); return }
  if (target !== canvas.value || event.ctrlKey || event.metaKey || event.altKey) return
  const directions: Record<string, [number, number]> = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }
  const direction = directions[event.key]
  if (direction) { panX.value += direction[0]; panY.value += direction[1] }
  else if (event.key === '+' || event.key === '=') zoomTo(zoom.value * 1.2)
  else if (event.key === '-') zoomTo(zoom.value / 1.2)
  else if (event.key === '0') resetView()
  else if (event.key === 'Home') centerView()
  else return
  event.preventDefault()
}
defineExpose({ resetDraft, requestSave })
</script>

<template>
  <section class="world-map" data-testid="world-map-view" :style="{ '--map-marker-scale': 1 / zoom }" :aria-busy="loading || saving" aria-label="小说地点沙盘" @keydown="onMapKeydown">
    <header class="map-heading">
      <div class="map-title"><h2>世界地图</h2><span class="map-code">WORLD ATLAS / 2D</span></div>
      <label class="map-search"><StudioIcon name="search" :size="17"/><input v-assist-field="{ id: 'WorldMap.query', read: () => query, write: value => { query = String(value) } }" v-model="query" type="search" maxlength="200" placeholder="搜索地点、事件或人物…" aria-label="搜索地图事件与地点" data-testid="map-search" :disabled="loading && !view"></label>
      <div class="map-toolbar">
        <button type="button" popovertarget="map-generation-settings" :aria-expanded="generatorOpen" :disabled="!view || loading" data-testid="map-generation-settings-trigger"><StudioIcon name="spark" :size="15"/><span>{{ generating ? '正在生成…' : generationError ? '生成异常' : '生成地图' }}</span><small>BETA</small></button>
        <button type="button" :aria-expanded="inspectorOpen" :disabled="!view" @click="inspectorOpen = !inspectorOpen"><StudioIcon name="list" :size="15"/>地点档案</button>
      </div>
    </header>
    <section id="map-generation-settings" popover="auto" class="map-generation-settings" aria-label="生成本书地图" @toggle="generatorOpen = ($event as ToggleEvent).newState === 'open'">
      <header><div><small>IMAGE GENERATION / BETA</small><h3>生成本书地图</h3></div><button type="button" popovertarget="map-generation-settings" popovertargetaction="hide" aria-label="关闭生成设置">×</button></header>
      <section class="map-generator" aria-label="AI 地图底图 Beta">
        <div class="generator-intro"><span class="beta-beacon" aria-hidden="true"></span><div><b>纸雕沙盘</b><small>使用你确认的地图提示词，不混入其他美术风格。</small></div></div>
        <p class="generator-description">米白纸雕 · 深玉绿海洋 · 微缩地标<br>地点与建筑用途依据当前小说；文字与选中反馈由页面显示。</p>
        <div class="generator-route">
          <label><span>图像接口</span><select v-model="imageConnectionId" :disabled="generating || adopting"><option value="" disabled>选择已配置接口</option><option v-for="connection in aiConnections" :key="connection.id" :value="connection.id" :disabled="!connection.apiKeyConfigured">{{ connection.name }}{{ connection.apiKeyConfigured ? '' : ' · 缺少密钥' }}</option></select></label>
          <label><span>图像模型</span><input v-assist-field="{ id: 'WorldMap.imageModel', read: () => imageModel, write: value => { imageModel = String(value) } }" v-model="imageModel" maxlength="200" spellcheck="false" placeholder="例如 gpt-image-1" :disabled="generating || adopting"></label>
        </div>
        <p class="generator-note">仅发送提炼后的作品定义、地点与正式事件摘要，不发送整本正文。当前 {{ sourceLocations.size }} 个地点，单次最多提取 40 个；可能产生所选接口的调用费用。</p>
        <p v-if="!selectedConnection?.apiKeyConfigured" class="generator-note">请先在设置中配置可用的图像接口。</p>
        <p v-if="dirty" class="generator-error">先保存或放弃坐标调整，再生成底图。</p><p v-else-if="!sourceLocations.size" class="generator-note">请先在纪事中填写事件地点。</p>
        <p v-if="generationError" class="generator-error" role="alert">{{ generationError }}</p>
        <div class="generator-actions"><button v-if="generating" type="button" @click="emit('cancelGeneration')">停止等待</button><button v-else type="button" class="generate-map-action" data-testid="map-generate" :disabled="!canGenerate" @click="requestGeneration">{{ adopting ? '正在采用…' : background ? '重新生成底图' : '生成地图底图' }} ↗</button></div>
      </section>
    </section>

    <div v-if="loading && !view" class="map-state" role="status"><h3>正在展开事件与地点</h3><p>只读取现有记录；等待期间可以随时切换页面。</p></div>
    <div v-else-if="!view" class="map-state" :role="error ? 'alert' : 'status'"><h3>{{ error ? '地点沙盘暂时无法读取' : '还没有载入作品地图' }}</h3><p>{{ error || '读取作品后，可以为已有事件的地点标注位置。' }}</p><button type="button" data-testid="map-retry" @click="emit('retry')">重新读取</button></div>
    <template v-else>
      <div v-if="error || externalChange" class="map-notice map-error" role="alert"><p>{{ externalChange ? '正式定位已由其他操作更新。你的本次调整仍保留；请先放弃本次调整并载入最新坐标，再继续编辑。' : error }}</p><button v-if="!externalChange" type="button" data-testid="map-retry" @click="emit('retry')">重试读取</button></div>
      <div class="map-body" :class="{ 'inspector-closed': !inspectorOpen }">
        <section class="map-stage" aria-label="作者标注的平面位置">
          <div ref="canvas" class="map-canvas" tabindex="0" :class="{ placing: !!placing, panning, annotating: editMode }" data-testid="map-canvas" aria-label="地点沙盘，拖动或方向键平移，加减键缩放，0适应画面；标注模式才会修改地点" @click="placeOnCanvas" @pointerdown="startPan" @pointermove="movePan" @pointerup="finishPan" @pointercancel="finishPan" @wheel.prevent="onWheel" @lostpointercapture="finishPan">
            <div class="map-coordinate-label top">ATLAS / {{ String(locations.length).padStart(4, '0') }}</div><div class="map-coordinate-label bottom">作者标注 · 非真实比例</div>
            <div class="map-mode-tools" role="group" aria-label="地图操作模式">
              <button type="button" :aria-pressed="!editMode" data-testid="map-browse-mode" @click.stop="setEditMode(false)">浏览</button>
              <button type="button" :aria-pressed="editMode" :disabled="!canEdit || adopting" data-testid="map-edit-mode" @click.stop="setEditMode(true)">标注</button>
              <button type="button" :disabled="!canUndo" data-testid="map-undo" title="撤销最近一次标注（Ctrl+Z）；尚未保存" @click.stop="undoMarkerChange">撤销</button>
              <button type="button" :aria-pressed="showLabels" :disabled="!pins.length" data-testid="map-labels" title="显示或隐藏覆盖层地名，不修改图片中的文字" @click.stop="showLabels = !showLabels">地名</button>
            </div>
            <div ref="plot" class="map-plot" :style="{ transform: mapTransform, '--map-ratio': view.document.version === 2 && view.document.background ? view.document.background.width / view.document.background.height : 1.5 }">
              <img v-if="background" class="map-background" :src="background" alt="根据当前小说内容生成的地图底图"><div v-if="background" class="map-background-shade" aria-hidden="true"></div>
              <svg v-else class="map-grid" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path v-for="n in 9" :key="n" :d="`M${n * 10} 0V100 M0 ${n * 10}H100`"/><path class="map-axis" d="M0 0H100V100H0Z M50 0V100 M0 50H100"/></svg>
              <button v-for="marker in pins" :key="marker.location" class="map-pin" :class="{ selected: selectedLocation === marker.location, 'label-left': marker.x > 65 }" :style="{ left: `${marker.x}%`, top: `${marker.y}%` }" type="button" data-testid="map-pin" :data-location="marker.location" :aria-label="`${marker.location}，X ${marker.x}，Y ${marker.y}。${editMode ? '可拖动或用方向键移动' : '点击查看地点档案，浏览模式不会改变坐标'}`" :title="marker.location" :aria-pressed="selectedLocation === marker.location" @click.stop="clickPin(marker.location)" @pointerdown.stop="startDrag($event, marker)" @pointermove.stop="moveDrag" @pointerup.stop="finishDrag" @pointercancel="cancelDrag" @lostpointercapture="finishDrag" @keydown="moveWithKeys($event, marker)">
                <i class="map-ground-rings" aria-hidden="true"></i>
                <i v-if="selectedLocation === marker.location" class="map-beacon" aria-hidden="true"></i>
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle class="map-pin-ring" cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5"/></svg>
                <span v-if="showLabels">{{ marker.location }}</span>
              </button>
            </div>
            <div class="map-view-controls" aria-label="地图视图控制"><button type="button" aria-label="缩小地图" :disabled="zoom <= .5" @click.stop="zoomTo(zoom / 1.2)">−</button><output>{{ Math.round(zoom * 100) }}%</output><button type="button" aria-label="放大地图" :disabled="zoom >= 3" @click.stop="zoomTo(zoom * 1.2)">＋</button><button type="button" @click.stop="resetView" title="完整显示底图，重置缩放与位置">适应画面</button><button type="button" @click.stop="centerView" title="保留缩放，将画面移回中心">回到中心</button></div>
            <p v-if="backgroundError" class="map-background-error" role="alert">{{ backgroundError }}</p>
            <div v-if="!background && !pins.length" class="map-empty-grid"><span class="map-empty-symbol" aria-hidden="true">⌖</span><small>YOUR WORLD, UNFOLDED.</small><b>{{ locations.length ? '让故事有一张自己的地图' : '故事的空间，从这里展开' }}</b><p>{{ locations.length ? '已有地点已整理好。生成纸雕底图，或先标注它们的位置。' : '先在事件中记录地点，再为这本小说展开地图。' }}</p><div class="map-empty-actions"><button type="button" popovertarget="map-generation-settings" :disabled="!locations.length">生成本书地图 ↗</button><button v-if="locations.length" type="button" @click.stop="inspectorOpen = true">查看 {{ locations.length }} 个地点</button></div><small>AI 生图 BETA · 不会自动调用接口</small></div>
            <div class="map-canvas-caption"><span>{{ editMode ? '标注模式 · Esc 返回浏览' : '浏览模式 · 拖动 / 缩放' }}</span><button type="button" disabled title="真实三维暂未开放，当前是二维图片沙盘">3D BETA</button></div>
            <div v-if="background && !draft.markers.length && locations.length && !editMode" class="map-onboarding">
              <span>底图已就绪，地点尚未绑定</span><button type="button" @click.stop="setEditMode(true)">标注已有地点 ↗</button>
            </div>
            <div v-if="placing" class="map-placement-hint" role="status">请在图片内点击，为「{{ placing }}」定位（Esc 取消） <button type="button" data-testid="map-stop-place" @click.stop="placing = ''; coordinateError = ''">取消定位</button></div>
            <p v-if="placing && coordinateError" class="map-placement-error" role="alert">{{ coordinateError }}</p>
          </div>
        </section>

        <Transition name="map-dossier"><aside v-if="inspectorOpen" class="map-inspector" aria-label="地点与事件档案"><header><button class="map-inspector-close" type="button" aria-label="关闭地点档案" @click="inspectorOpen = false">×</button><span class="map-code">LOCATION DOSSIER</span><h3>{{ selectedLocation || selectedEvent?.title || '事件档案' }}</h3><p>{{ selectedLocation ? `${relatedEvents.length} 项关联事件` : '选择地点或事件，查看参与人物和来源。' }}</p></header><div class="map-inspector-scroll" tabindex="0" aria-label="可滚动的事件详情">
          <div class="map-filters"><label>事件范围<select v-assist-field="{id:'WorldMap.throughPosition',read:()=>throughPosition===null?'all':throughPosition,write:value=>{throughPosition=value==='all'?null:Number(value)}}" :value="throughPosition === null ? 'all' : throughPosition" data-testid="map-through-chapter" aria-label="地图事件截至章节" @change="changeThrough"><option value="all">全书 · 含未绑定章节事件</option><option v-for="chapter in chapterChoices" :key="chapter.id" :value="chapter.position">截至第 {{ chapter.position }} 章</option></select></label><p class="map-scope-note">{{ events.length }} 项事件 · {{ locations.length }} 个地点。<span v-if="unassignedCount">{{ unassignedCount }} 项事件未绑定章节。</span>按记录原文显示，不推算距离。</p></div><section class="map-location-index"><header><h4>地点索引</h4><span>{{ pins.length }} 已定位 · {{ unplaced.length }} 未定位</span></header><div class="map-location-list" aria-label="地点索引"><button v-for="location in displayedLocations" :key="location" type="button" data-testid="map-location" :data-location="location" :aria-pressed="selectedLocation === location" :class="{ selected: selectedLocation === location }" @click="selectLocation(location)"><i aria-hidden="true">{{ markerIndex.has(location) ? '◆' : '+' }}</i><span>{{ location }}</span><small>{{ markerIndex.has(location) ? '已定位' : '未定位' }}</small></button><button v-if="locations.length > locationLimit" type="button" @click="locationLimit += 120">再显示地点（剩余 {{ locations.length - locationLimit }}）</button><p v-if="!locations.length">没有符合当前筛选的地点。</p></div></section>
          <section v-if="selectedLocation" class="map-location-editor"><div class="map-location-actions"><button v-if="selectedMarker" type="button" data-testid="map-focus-location" @click="focusOnLocation()">在图中居中</button><button type="button" data-testid="map-place" :disabled="!canEdit || adopting" @click="beginPlace">{{ selectedMarker ? '重新定位' : '定位' }} <span aria-hidden="true">↗</span></button><button v-if="selectedMarker && editMode" type="button" class="map-remove" data-testid="map-remove" :disabled="!canAdjust" @click="removePin">移除定位</button></div><form v-if="editMode" class="map-coordinate-form" @submit.prevent="applyCoordinates"><label>X / 横向 %<input v-assist-field="{ id: 'WorldMap.coordinateX', read: () => coordinateX, write: value => { coordinateX = Number(value) } }" v-model="coordinateX" type="number" min="0" max="100" step="any" data-testid="map-x" aria-label="地点横向坐标，0到100" :disabled="!canAdjust"></label><label>Y / 纵向 %<input v-assist-field="{ id: 'WorldMap.coordinateY', read: () => coordinateY, write: value => { coordinateY = Number(value) } }" v-model="coordinateY" type="number" min="0" max="100" step="any" data-testid="map-y" aria-label="地点纵向坐标，0到100" :disabled="!canAdjust"></label><button type="submit" data-testid="map-apply-coordinates" :disabled="!canAdjust">应用坐标</button></form><p v-if="coordinateError" class="map-coordinate-error" role="alert">{{ coordinateError }}</p><button v-if="!editMode" type="button" :disabled="!canEdit" @click="setEditMode(true)">编辑地点坐标</button><small v-if="editMode">仅调整沙盘标注；移除定位不会删除地点事件。</small></section>
          <section v-if="people.length" class="map-people"><h4>事件参与人物</h4><div><button v-for="name in people" :key="name" type="button" @click="emit('openCharacter', name)">{{ name }} <span aria-hidden="true">↗</span></button></div><small>同场出现不等于人物关系。</small></section>
          <article v-if="selectedEvent" class="map-event-dossier" data-testid="map-event-detail"><span class="map-code">{{ selectedEvent.source === 'direct' ? '作者纪事' : '正式事件' }}</span><h4>{{ selectedEvent.title || '未命名事件' }}</h4><dl><div><dt>故事时间</dt><dd>{{ selectedEvent.time || '未记录' }}</dd></div><div><dt>地点原文</dt><dd>{{ selectedEvent.location || '未记录' }}</dd></div><div><dt>发生的事</dt><dd>{{ selectedEvent.event || '未补充' }}</dd></div><div><dt>结果</dt><dd>{{ selectedEvent.result || '未记录' }}</dd></div></dl>
            <div v-if="selectedEventPlaces.length" class="map-event-places" aria-label="事件已关联的地图地标"><small>已关联地标 · 不代表全部场景</small><div><button v-for="place in selectedEventPlaces" :key="place" type="button" :aria-pressed="selectedLocation === place" @click="focusEventPlace(place)">{{ place }} <span aria-hidden="true">↗</span></button></div></div>
            <div class="map-event-actions"><button type="button" data-testid="map-open-event" @click="emit('openEvent', { source: selectedEvent.source, sourceId: selectedEvent.sourceId })">打开事件记录 ↗</button><button v-if="selectedChapter" type="button" data-testid="map-open-chapter" :data-chapter-id="selectedChapter.id" @click="emit('openChapter', selectedChapter.id)">第 {{ selectedChapter.position }} 章 ↗</button><small v-else>该事件没有明确关联当前目录章节。</small></div></article>
          <section class="map-events"><header><h4>{{ selectedLocation ? '这个地点的事件' : '当前范围内的事件' }}</h4><button v-if="selectedLocation" type="button" @click="selectedLocation = ''; selectedEventId = ''">全部事件</button></header><div class="map-event-list"><button v-for="event in displayedEvents" :key="event.id" type="button" data-testid="map-event" :data-event-id="event.id" :aria-pressed="selectedEventId === event.id" :class="{ selected: selectedEventId === event.id }" @click="selectEvent(event)"><span>{{ event.time || '时间未记录' }}</span><b>{{ event.title || '未命名事件' }}</b><small>{{ event.location || '地点未记录' }} · {{ event.source === 'direct' ? '作者纪事' : '正式事件' }}</small></button><button v-if="relatedEvents.length > eventLimit" type="button" @click="eventLimit += 60">再显示事件（剩余 {{ relatedEvents.length - eventLimit }}）</button><p v-if="!relatedEvents.length">这个范围内没有关联事件，已有定位仍保留。</p></div></section>
        </div></aside></Transition>
      </div>
      <footer v-if="dirty || externalChange || saving || saveError || savedNotice || mirrorNotice" class="map-footer"><div class="map-save-status" aria-live="polite"><p v-if="saveError && !dismissedSaveError" class="map-coordinate-error" role="alert">保存未完成：{{ saveError }} 本次坐标仍保留。 <button type="button" data-testid="map-save-retry" :disabled="loading || saving" @click="requestReload">重新读取</button></p><p v-else-if="savedNotice">{{ savedNotice }} <button type="button" aria-label="关闭保存提示" @click="savedNotice = ''">×</button></p><p v-else>{{ dirty ? '本次只保存地点坐标，不改写事件、人物和正文。' : '位置由你定义。可拖动标记或用方向键微调。' }}</p><small v-if="mirrorNotice">{{ mirrorNotice }}</small></div><div v-if="dirty || externalChange || saving" class="map-save-actions"><button type="button" data-testid="map-cancel" :disabled="(!dirty && !externalChange) || saving" @click="confirmDiscard = true">放弃本次调整</button><button type="button" class="control-button primary save-action" data-testid="map-save" :disabled="!dirty || !canEdit || saving || pending !== null" @click="requestSave"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h13l3 3v15H4Z M8 3v6h8V3 M8 21v-8h8v8"/></svg>{{ saving ? '保存中…' : '保存地点定位' }}</button></div><div v-if="confirmDiscard" class="map-discard-confirm" role="group" aria-label="确认放弃未保存的地图调整"><p>放弃本次未保存的坐标调整？事件与正文不会改变。</p><button type="button" data-testid="map-confirm-discard" @click="resetDraft">确认放弃</button><button type="button" @click="confirmDiscard = false">继续调整</button></div></footer>
      <div v-if="candidate" class="map-candidate-backdrop"><section class="map-candidate" role="dialog" aria-modal="true" aria-labelledby="map-candidate-title"><header><div><span class="map-code">GENERATED PREVIEW / 尚未采用</span><h3 id="map-candidate-title">这张底图是否符合小说？</h3></div><button type="button" aria-label="放弃生成预览" @click="emit('discardCandidate')">×</button></header><div class="candidate-stage"><img :src="candidate.image.dataUrl" alt="AI 生成的小说地图候选预览"><span>PREVIEW</span></div><footer><p>使用了 {{ candidate.promptSummary.locations }} 个地点、{{ candidate.promptSummary.events }} 项事件摘要 · {{ candidate.connectionName }} / {{ candidate.model }}。地点名称仍由页面覆盖，不采用图片里的文字。</p><div><button type="button" :disabled="adopting" @click="emit('discardCandidate')">放弃</button><button type="button" :disabled="adopting" @click="requestGeneration">重新生成</button><button type="button" class="candidate-adopt" data-testid="map-adopt-image" :disabled="adopting || dirty" @click="emit('adopt')">{{ adopting ? '正在采用…' : '使用这张' }}</button></div></footer></section></div>
    </template>
  </section>
</template>

<style scoped src="../../../assets/world-map.css"></style>
