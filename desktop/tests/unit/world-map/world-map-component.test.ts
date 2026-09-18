import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import { transformWithEsbuild } from 'vite'
import * as Vue from 'vue'
import type { WorldMapDocument, WorldMapEvent, WorldMapView } from '../../../src/contracts/world-map/world-map'
import * as MapLocations from '../../../src/contracts/world-map/world-map-locations'

type MapSetupState = {
  draft: WorldMapDocument; baseline: WorldMapDocument; unplaced: string[]; locations: string[]
  events: WorldMapEvent[]; selectedEvent: WorldMapEvent | null; pins: WorldMapDocument['markers']; unassignedCount: number
  relatedEvents: WorldMapEvent[]; selectedEventPlaces: string[]; focusEventPlace: (location: string) => void
  selectedLocation: string; inspectorOpen: boolean; clickPin: (location: string) => void; query: string; throughPosition: number | null; pending: string | null
  coordinateX: string | number; coordinateY: string | number; coordinateError: string
  dirty: boolean; externalChange: boolean; savedNotice: string
  editMode: boolean; showLabels: boolean; undoHistory: WorldMapDocument['markers'][]; canUndo: boolean; placing: string
  zoom: number; panX: number; panY: number; canvas?: HTMLElement; plot?: HTMLElement
  setEditMode: (value: boolean) => void; undoMarkerChange: () => void; beginPlace: () => void
  startDrag: (event: PointerEvent, marker: WorldMapDocument['markers'][number]) => void
  moveDrag: (event: PointerEvent) => void; finishDrag: (event: PointerEvent) => void; cancelDrag: () => void
  moveWithKeys: (event: KeyboardEvent, marker: WorldMapDocument['markers'][number]) => void
  onMapKeydown: (event: KeyboardEvent) => void; placeOnCanvas: (event: MouseEvent) => void; focusOnLocation: () => Promise<void>
  selectEvent: (event: WorldMapEvent) => void; selectLocation: (location: string) => void
  applyCoordinates: () => void; requestSave: () => void; requestReload: () => void; resetDraft: () => void; removePin: () => void
}

async function component() {
  const filename = new URL('../../../src/renderer/features/world-map/components/WorldMap.vue', import.meta.url)
  const { descriptor } = parse(await readFile(filename, 'utf8'))
  let code = compileScript(descriptor, { id: 'world-map-state-test' }).content
  code = code.replace(/import StudioIcon from [^\n]+\n/, 'const StudioIcon = {};\n')
  code = code.replace(/import\s*\{([^}]+)\}\s*from\s*['"][^'"]+world-map-locations['"];?/g, (_, names: string) => `const { ${names} } = MapLocations;`)
  code = code.replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/g, (_, names: string) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = Vue;`)
  const compiled = await transformWithEsbuild(code, 'world-map-state-test.ts', { loader: 'ts' })
  const result = new Function('Vue', 'MapLocations', compiled.code.replace('export default', 'return'))(Vue, MapLocations)
  result.render = () => Vue.h('div')
  return result
}

function view(): WorldMapView {
  return {
    workItemId: 'map-fixture', revision: 'a'.repeat(64), document: { version: 1, markers: [] }, mirrorStatus: null,
    chapters: [{ id: 42, position: 1, title: '码头来信' }, { id: 3, position: 2, title: '山城会面' }],
    events: [
      { id: 'canonical:early', source: 'canonical', sourceId: 'early', title: '读信', time: '第一天清晨', characters: ['沈砚'], location: '旧码头', event: '读到来信', result: '准备出发', chapterId: 42 },
      { id: 'canonical:later', source: 'canonical', sourceId: 'later', title: '会面', time: '次日晚', characters: ['沈砚', '林照'], location: '山城', event: '交换消息', result: '', chapterId: 3 },
      { id: 'direct:unassigned', source: 'direct', sourceId: 'unassigned', title: '风向', time: '日期未定', characters: ['林照'], location: '高塔', event: '观察风向', result: '', chapterId: null },
    ],
  }
}

async function mount(initial = view()) {
  const props = Vue.reactive({ view: initial, loading: false, error: '', saving: false, saveError: '', focusLocation: '' })
  const saves: WorldMapDocument[] = [], dirty: boolean[] = [], retries: true[] = []
  const renderer = Vue.createRenderer({
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, patchProp() {}, setElementText() {}, setText() {},
    parentNode: () => null, nextSibling: () => null,
  })
  const Component = await component()
  const app = renderer.createApp({ render: () => Vue.h(Component, { ...props, onSave: (document: WorldMapDocument) => saves.push(document), onDirty: (value: boolean) => dirty.push(value), onRetry: () => retries.push(true) }) })
  const wrapper = app.mount({})
  // This is a component state unit test, not a replacement for native clicks.
  const state = (wrapper.$.subTree.component! as Vue.ComponentInternalInstance & { setupState: MapSetupState }).setupState
  await Vue.nextTick()
  return { props, state, saves, dirty, retries, unmount: () => app.unmount() }
}

test('the shared pin/nameplate action opens and reopens dossiers without editing or moving the map', async () => {
  const source = view()
  source.document.markers = [{ location: '旧码头', x: 22, y: 30 }, { location: '山城', x: 75, y: 45 }]
  const original = JSON.stringify(source), ctx = await mount(source)
  try {
    for (const location of ['旧码头', '旧码头', '山城']) {
      ctx.state.inspectorOpen = false
      ctx.state.clickPin(location); await Vue.nextTick()
      assert.equal(ctx.state.selectedLocation, location)
      assert.equal(ctx.state.inspectorOpen, true)
      assert.equal(ctx.state.relatedEvents[0]?.location, location)
      assert.equal(ctx.state.dirty, false)
      assert.equal(ctx.state.panX, 0); assert.equal(ctx.state.panY, 0)
    }
    assert.equal(ctx.saves.length, 0)
    assert.equal(JSON.stringify(source), original)
  } finally { ctx.unmount() }
})

test('explicit composite bindings drive search, event dossiers, cross-place focus and chapter cutoff without mutating events', async () => {
  const source = view()
  source.events[0]!.location = '城南学舍、桥边住处与电车'
  source.document.markers = [
    { location: '学舍', x: 30, y: 40, sourceLocations: [source.events[0]!.location] },
    { location: '桥边居所', x: 65, y: 45, sourceLocations: [source.events[0]!.location, '山城'] },
  ]
  const original = JSON.stringify(source)
  const ctx = await mount(source)
  try {
    assert.deepEqual(ctx.state.locations, ['高塔', '桥边居所', '学舍'])
    assert.deepEqual(ctx.state.unplaced, ['高塔'])
    ctx.props.focusLocation = source.events[0]!.location; await Vue.nextTick()
    assert.equal(ctx.state.selectedLocation, '学舍')
    ctx.state.selectEvent(source.events[0]!); await Vue.nextTick()
    assert.deepEqual(ctx.state.selectedEventPlaces, ['学舍', '桥边居所'])
    ctx.state.focusEventPlace('桥边居所'); await Vue.nextTick()
    assert.equal(ctx.state.selectedEvent?.id, source.events[0]!.id)
    assert.equal(ctx.state.relatedEvents.length, 2)
    ctx.state.query = '桥边居所'; await Vue.nextTick()
    assert.equal(ctx.state.events.length, 2, 'search understands an explicit landmark alias')
    ctx.state.throughPosition = 1; await Vue.nextTick()
    assert.equal(ctx.state.events.length, 1)
    assert.equal(ctx.state.pins.length, 2, 'one early event can occur at both landmarks')
    ctx.state.query = '高塔'; await Vue.nextTick()
    assert.equal(ctx.state.pins.length, 0, 'chapter cutoff never leaks unassigned locations')
    assert.equal(JSON.stringify(source), original)
    assert.equal(ctx.saves.length, 0)
  } finally { ctx.unmount() }
})

test('coordinate editing, undo, detached saves and pin removal preserve explicit bindings and source events', async () => {
  const source = view()
  source.document.markers = [{ location: '海港', x: 22, y: 30, sourceLocations: ['旧码头', '山城'] }]
  const original = JSON.stringify(source)
  const ctx = await mount(source)
  try {
    ctx.state.setEditMode(true); ctx.state.selectLocation('海港'); await Vue.nextTick()
    ctx.state.coordinateX = 44; ctx.state.coordinateY = 55; ctx.state.applyCoordinates(); await Vue.nextTick()
    assert.deepEqual(ctx.state.draft.markers[0]!.sourceLocations, ['旧码头', '山城'])
    ctx.state.undoMarkerChange(); await Vue.nextTick()
    assert.equal(ctx.state.draft.markers[0]!.x, 22)
    assert.deepEqual(ctx.state.draft.markers[0]!.sourceLocations, ['旧码头', '山城'])
    ctx.state.coordinateX = 46; ctx.state.applyCoordinates(); await Vue.nextTick()
    ctx.state.requestSave(); await Vue.nextTick()
    assert.deepEqual(ctx.saves[0]!.markers[0]!.sourceLocations, ['旧码头', '山城'])
    ctx.saves[0]!.markers[0]!.sourceLocations!.push('隔离断言')
    assert.deepEqual(ctx.state.draft.markers[0]!.sourceLocations, ['旧码头', '山城'])
    ctx.props.saveError = '隔离测试失败'; await Vue.nextTick()
    ctx.state.removePin(); await Vue.nextTick()
    assert.ok(ctx.state.unplaced.includes('旧码头'))
    ctx.state.undoMarkerChange(); await Vue.nextTick()
    assert.deepEqual(ctx.state.relatedEvents.map(e => e.location), ['旧码头', '山城', '高塔'])
    assert.equal(JSON.stringify(source), original)
  } finally { ctx.unmount() }
})

test('world map has no automatic coordinates; chapter cutoff hides unassigned/future events without dropping saved markers', async () => {
  const source = view()
  source.document.markers.push({ location: '山城', x: 22.3456789, y: 44 })
  const original = JSON.stringify(source)
  const ctx = await mount(source)
  try {
    assert.equal(ctx.state.draft.markers.length, 1)
    assert.equal(ctx.state.unplaced.length, 2)
    ctx.state.selectEvent(source.events[1]!)
    ctx.state.throughPosition = 1
    await Vue.nextTick()
    assert.deepEqual(ctx.state.events.map((event: { id: string }) => event.id), ['canonical:early'])
    assert.deepEqual(ctx.state.locations, ['旧码头'])
    assert.equal(ctx.state.selectedEvent, null)
    assert.equal(ctx.state.pins.length, 0)
    assert.equal(ctx.state.draft.markers[0].x, 22.3456789)
    assert.equal(ctx.state.unassignedCount, 1)
    assert.equal(ctx.saves.length, 0)
    assert.equal(JSON.stringify(source), original)
  } finally { ctx.unmount() }
})

test('explicit save failure retains coordinates; matching acknowledgement does not erase edits made while saving', async () => {
  const ctx = await mount()
  try {
    ctx.state.setEditMode(true); ctx.state.selectLocation('旧码头'); await Vue.nextTick()
    ctx.state.coordinateX = 12.3456789; ctx.state.coordinateY = 25; ctx.state.applyCoordinates(); await Vue.nextTick()
    assert.equal(ctx.state.dirty, true)
    ctx.state.requestSave(); await Vue.nextTick()
    assert.equal(ctx.saves.length, 1)
    assert.equal(ctx.saves[0]!.markers[0]!.x, 12.3456789)
    ctx.props.saveError = '隔离测试：写入失败'; await Vue.nextTick()
    assert.equal(ctx.state.pending, null)
    assert.equal(ctx.state.draft.markers[0].x, 12.3456789)
    assert.equal(ctx.state.dirty, true)
    ctx.props.saveError = ''; await Vue.nextTick()
    ctx.state.requestSave(); await Vue.nextTick()
    ctx.props.saving = true; await Vue.nextTick()
    ctx.state.coordinateX = 28.5; ctx.state.applyCoordinates(); await Vue.nextTick()
    ctx.props.view = { ...ctx.props.view, revision: 'b'.repeat(64), document: ctx.saves[1]!, mirrorStatus: 'synced' }
    await Vue.nextTick()
    assert.equal(ctx.state.baseline.markers[0].x, 12.3456789)
    assert.equal(ctx.state.draft.markers[0].x, 28.5)
    assert.equal(ctx.state.dirty, true)
    ctx.props.saving = false; await Vue.nextTick()
    ctx.state.requestSave(); await Vue.nextTick()
    ctx.props.view = { ...ctx.props.view, revision: 'c'.repeat(64), document: ctx.saves[2]! }
    await Vue.nextTick()
    assert.equal(ctx.state.dirty, false)
    assert.equal(ctx.state.pending, null)
    assert.equal(ctx.dirty.at(-1), false)
    assert.match(ctx.state.savedNotice, /已保存/)
  } finally { ctx.unmount() }
})

test('external revision never overwrites dirty layout; explicit reset and book switch clear only local coordinates and filters', async () => {
  const ctx = await mount()
  try {
    ctx.state.setEditMode(true); ctx.state.selectLocation('旧码头'); await Vue.nextTick()
    ctx.state.coordinateX = 10; ctx.state.coordinateY = 20; ctx.state.applyCoordinates(); await Vue.nextTick()
    const events = JSON.stringify(ctx.props.view.events)
    ctx.props.view = { ...ctx.props.view, revision: 'b'.repeat(64), document: { version: 1, markers: [{ location: '高塔', x: 80, y: 90 }] } }
    await Vue.nextTick()
    assert.equal(ctx.state.externalChange, true)
    assert.equal(ctx.state.draft.markers[0].location, '旧码头')
    ctx.state.requestSave()
    assert.equal(ctx.saves.length, 0)
    ctx.state.resetDraft(); await Vue.nextTick()
    assert.equal(ctx.state.draft.markers[0].location, '高塔')
    assert.equal(ctx.state.dirty, false)
    assert.equal(ctx.state.externalChange, false)
    assert.equal(JSON.stringify(ctx.props.view.events), events)
    ctx.state.query = '高塔'; ctx.state.throughPosition = 1
    ctx.props.view = { ...view(), workItemId: 'other-book' }; await Vue.nextTick()
    assert.equal(ctx.state.query, '')
    assert.equal(ctx.state.throughPosition, null)
    assert.equal(ctx.state.selectedLocation, '')
    assert.equal(ctx.state.draft.markers.length, 0)
  } finally { ctx.unmount() }
})

test('numeric coordinate validation and pin removal do not alter source events or persisted input', async () => {
  const source = view()
  source.document.markers = [{ location: '旧码头', x: 20, y: 30 }]
  const original = JSON.stringify(source)
  const ctx = await mount(source)
  try {
    ctx.state.setEditMode(true); ctx.state.selectLocation('旧码头'); await Vue.nextTick()
    ctx.state.coordinateX = 101; ctx.state.coordinateY = 20; ctx.state.applyCoordinates()
    assert.match(ctx.state.coordinateError, /0–100/)
    assert.equal(ctx.state.draft.markers[0].x, 20)
    ctx.state.removePin(); await Vue.nextTick()
    assert.equal(ctx.state.draft.markers.length, 0)
    assert.equal(ctx.state.dirty, true)
    assert.equal(ctx.saves.length, 0)
    assert.equal(JSON.stringify(source), original)
  } finally { ctx.unmount() }
})

test('save-error reread requests fresh data without clearing draft and rejects duplicate reads while busy', async () => {
  const ctx = await mount()
  try {
    ctx.state.setEditMode(true); ctx.state.selectLocation('旧码头'); await Vue.nextTick()
    ctx.state.coordinateX = 17; ctx.state.coordinateY = 23; ctx.state.applyCoordinates(); await Vue.nextTick()
    ctx.props.saveError = '定位版本已变化，请重新读取。'; await Vue.nextTick()
    const draft = JSON.stringify(ctx.state.draft), baseline = JSON.stringify(ctx.state.baseline)
    ctx.state.requestReload(); await Vue.nextTick()
    assert.equal(ctx.retries.length, 1)
    assert.equal(JSON.stringify(ctx.state.draft), draft)
    assert.equal(JSON.stringify(ctx.state.baseline), baseline)
    assert.equal(ctx.state.dirty, true)
    ctx.props.loading = true; await Vue.nextTick(); ctx.state.requestReload()
    assert.equal(ctx.retries.length, 1)
    ctx.props.loading = false; ctx.props.saving = true; await Vue.nextTick(); ctx.state.requestReload()
    assert.equal(ctx.retries.length, 1)
    assert.equal(JSON.stringify(ctx.state.draft), draft)
    assert.equal(ctx.saves.length, 0)
  } finally { ctx.unmount() }
})

const pointer = (x: number, y: number, id = 1) => ({ button: 0, pointerId: id, clientX: x, clientY: y, preventDefault() {}, currentTarget: { setPointerCapture() {}, focus() {} }, target: { closest: () => null } }) as unknown as PointerEvent
const key = (value: string, extra: Partial<KeyboardEvent> = {}) => ({ key: value, preventDefault() {}, target: { closest: () => null }, ...extra }) as unknown as KeyboardEvent
const boundsElement = (left = 0, top = 0, width = 100, height = 100) => ({ getBoundingClientRect: () => ({ left, top, width, height, right: left + width, bottom: top + height }), focus() {} }) as unknown as HTMLElement

test('browse never changes markers; annotate keyboard edits and label visibility remain local until save', async () => {
  const source = view(); source.document.markers = [{ location: '旧码头', x: 20, y: 30 }]
  const original = JSON.stringify(source), ctx = await mount(source)
  try {
    ctx.state.selectLocation('旧码头'); await Vue.nextTick()
    ctx.state.coordinateX = 60; ctx.state.coordinateY = 70; ctx.state.applyCoordinates()
    ctx.state.moveWithKeys(key('ArrowRight'), ctx.state.draft.markers[0]!)
    ctx.state.startDrag(pointer(20, 30), ctx.state.draft.markers[0]!); ctx.state.moveDrag(pointer(50, 60))
    assert.equal(ctx.state.editMode, false); assert.equal(ctx.state.draft.markers[0]!.x, 20)
    assert.equal(ctx.state.dirty, false); assert.equal(ctx.state.undoHistory.length, 0)
    ctx.state.showLabels = false
    ctx.state.setEditMode(true)
    ctx.state.moveWithKeys(key('ArrowRight', { isComposing: true }), ctx.state.draft.markers[0]!)
    ctx.state.moveWithKeys(key('ArrowRight', { ctrlKey: true }), ctx.state.draft.markers[0]!)
    assert.equal(ctx.state.draft.markers[0]!.x, 20, 'IME and system-modified arrows cannot nudge a marker')
    ctx.state.moveWithKeys(key('ArrowRight'), ctx.state.draft.markers[0]!)
    await Vue.nextTick()
    assert.equal(ctx.state.draft.markers[0]!.x, 21); assert.equal(ctx.state.canUndo, true)
    ctx.state.onMapKeydown(key('z', { ctrlKey: true }))
    assert.equal(ctx.state.draft.markers[0]!.x, 20); assert.equal(ctx.state.dirty, false)
    assert.equal(ctx.saves.length, 0); assert.equal(JSON.stringify(source), original)
  } finally { ctx.unmount() }
})

test('a multi-frame drag is one undo; pointer cancellation restores the point without a phantom history step', async () => {
  const source = view(); source.document.markers = [{ location: '旧码头', x: 20, y: 30 }]
  const ctx = await mount(source)
  try {
    ctx.state.setEditMode(true); ctx.state.plot = boundsElement()
    ctx.state.startDrag(pointer(20, 30), ctx.state.draft.markers[0]!)
    ctx.state.moveDrag(pointer(23, 30)); assert.equal(ctx.state.dirty, false)
    ctx.state.moveDrag(pointer(40, 50)); ctx.state.moveDrag(pointer(50, 60)); ctx.state.finishDrag(pointer(50, 60))
    await Vue.nextTick()
    assert.equal(ctx.state.undoHistory.length, 1); assert.equal(ctx.state.canUndo, true)
    ctx.state.undoMarkerChange(); assert.equal(ctx.state.draft.markers[0]!.x, 20)
    ctx.state.startDrag(pointer(20, 30), ctx.state.draft.markers[0]!); ctx.state.moveDrag(pointer(40, 50)); ctx.state.cancelDrag()
    assert.equal(ctx.state.draft.markers[0]!.x, 20); assert.equal(ctx.state.undoHistory.length, 0)
    assert.equal(ctx.state.dirty, false); assert.equal(ctx.saves.length, 0)
  } finally { ctx.unmount() }
})

test('undo is capped at 50 actions; a pending receipt keeps only post-submit history even after rollover', async () => {
  const ctx = await mount()
  try {
    ctx.state.setEditMode(true); ctx.state.selectLocation('旧码头'); await Vue.nextTick()
    ctx.state.coordinateX = 0; ctx.state.coordinateY = 20; ctx.state.applyCoordinates(); ctx.state.requestSave()
    for (let x = 1; x <= 55; x++) { ctx.state.coordinateX = x; ctx.state.applyCoordinates() }
    assert.equal(ctx.state.undoHistory.length, 50)
    ctx.props.view = { ...ctx.props.view, revision: 'b'.repeat(64), document: ctx.saves[0]! }; await Vue.nextTick()
    assert.equal(ctx.state.undoHistory.length, 50)
    for (let i = 0; i < 50; i++) ctx.state.undoMarkerChange()
    assert.equal(ctx.state.draft.markers[0]!.x, 5); assert.equal(ctx.state.dirty, true)
    assert.equal(ctx.state.canUndo, false)
    ctx.state.resetDraft(); assert.equal(ctx.state.draft.markers[0]!.x, 0); assert.equal(ctx.state.dirty, false)
  } finally { ctx.unmount() }
})

test('placement rejects outside-image clicks; Escape cancels without consuming IME or text-field shortcuts', async () => {
  const ctx = await mount()
  try {
    ctx.state.selectLocation('旧码头'); await Vue.nextTick()
    ctx.state.plot = boundsElement(100, 100)
    ctx.state.beginPlace(); await Vue.nextTick()
    ctx.state.placeOnCanvas(pointer(50, 150) as unknown as MouseEvent)
    assert.match(ctx.state.coordinateError, /图片范围/); assert.equal(ctx.state.draft.markers.length, 0)
    ctx.state.onMapKeydown(key('Escape', { isComposing: true })); assert.equal(ctx.state.placing, '旧码头')
    ctx.state.onMapKeydown(key('Escape', { target: { closest: () => ({}) } as unknown as HTMLElement })); assert.equal(ctx.state.placing, '旧码头')
    ctx.state.onMapKeydown(key('Escape')); assert.equal(ctx.state.placing, ''); assert.equal(ctx.state.editMode, true)
    ctx.state.onMapKeydown(key('Escape')); assert.equal(ctx.state.editMode, false)
    ctx.state.beginPlace(); ctx.state.placeOnCanvas(pointer(125, 150) as unknown as MouseEvent)
    assert.deepEqual(ctx.state.draft.markers[0], { location: '旧码头', x: 25, y: 50 })
    ctx.state.undoMarkerChange(); assert.equal(ctx.state.draft.markers.length, 0)
  } finally { ctx.unmount() }
})

test('save receipt trims only pre-submit undo history; later edits can be undone to the new saved baseline', async () => {
  const ctx = await mount()
  try {
    ctx.state.setEditMode(true); ctx.state.selectLocation('旧码头'); await Vue.nextTick()
    ctx.state.coordinateX = 10; ctx.state.coordinateY = 20; ctx.state.applyCoordinates(); ctx.state.requestSave()
    ctx.props.saving = true; await Vue.nextTick()
    ctx.state.coordinateX = 30; ctx.state.applyCoordinates()
    assert.equal(ctx.state.canUndo, false)
    ctx.props.view = { ...ctx.props.view, revision: 'b'.repeat(64), document: ctx.saves[0]! }; ctx.props.saving = false
    await Vue.nextTick()
    assert.equal(ctx.state.undoHistory.length, 1); ctx.state.undoMarkerChange()
    assert.equal(ctx.state.draft.markers[0]!.x, 10); assert.equal(ctx.state.dirty, false)
    assert.equal(ctx.state.canUndo, false)
  } finally { ctx.unmount() }
})

test('focus-on-location centers the actual transformed point; book changes reset transient view and history', async () => {
  const source = view(); source.document.markers = [{ location: '旧码头', x: 20, y: 30 }]
  const ctx = await mount(source)
  try {
    ctx.state.plot = boundsElement(100, 50, 300, 200); ctx.state.canvas = boundsElement(0, 0, 500, 400)
    ctx.state.selectedLocation = '旧码头'; await ctx.state.focusOnLocation()
    assert.equal(ctx.state.panX, 90); assert.equal(ctx.state.panY, 90)
    ctx.state.setEditMode(true); ctx.state.showLabels = false; ctx.state.zoom = 2
    ctx.state.moveWithKeys(key('ArrowRight'), ctx.state.draft.markers[0]!)
    ctx.props.view = { ...view(), workItemId: 'another-book' }; await Vue.nextTick()
    assert.equal(ctx.state.editMode, false); assert.equal(ctx.state.showLabels, true)
    assert.equal(ctx.state.zoom, 1); assert.equal(ctx.state.panX, 0); assert.equal(ctx.state.panY, 0)
    assert.equal(ctx.state.undoHistory.length, 0)
  } finally { ctx.unmount() }
})
