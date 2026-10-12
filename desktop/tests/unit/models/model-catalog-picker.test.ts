import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import { transformWithEsbuild } from 'vite'
import * as Vue from 'vue'
import * as Icons from '@lucide/vue'
import * as Catalog from '../../../src/renderer/features/models/services/model-catalog'
import * as Local from '../../../src/contracts/models/local-model-contracts'
import { hostedModelMode } from '../../../src/renderer/features/models/services/hosted-model-mode'

// Compile the real setup and run its watchers in Vue. Native DOM/IME behavior
// is also exercised by model-parameter-guidance-smoke.mjs.
const source = await readFile(new URL('../../../src/renderer/features/models/components/ModelCatalogPicker.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'catalog-picker' }).content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/g, (_, names: string) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = Vue;`)
  .replace(/import[^\n]+from ['"][^'"]+local-model-contracts['"];?/g, 'const { isLocalConnection } = Local;')
  .replace(/import[^\n]+from ['"][^'"]+hosted-model-mode['"];?/g, '')
  .replace(/import[^\n]+from ['"][^'"]+model-catalog['"];?/g, 'const { classifyModelFamily, manualModelDisabledReason, modelRouteKey } = Catalog;')
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]@lucide\/vue['"];?/g, (_, names: string) => `const { ${names} } = Icons;`)
const compiled = await transformWithEsbuild(script, 'ModelCatalogPicker.ts', { loader: 'ts' })
const load = new Function('Vue', 'Icons', 'Catalog', 'Local', 'document', 'window', 'hostedModelMode', compiled.code.replace('export default', 'return'))
type State = {
  open: boolean; manualConnectionId: string; manualModel: string; composing: boolean
  toggle(): Promise<void>; choose(choice: Catalog.ModelCatalogChoice | null): void; chooseManual(): void
  handleKeydown(event: KeyboardEvent): void; handleManualEnter(event: KeyboardEvent): void
}
function fixture() {
  const connections = [{ id: 'global-one', name: 'One', baseUrl: 'https://example.invalid', enabled: true }]
  const choices = Catalog.buildModelCatalog(connections, { 'global-one': ['writer-a', 'writer-b'] })
  const props = Vue.reactive({ connections, choices, connectionId: 'global-one', model: 'writer-a', disabled: false, allowEmpty: true, allowManual: true })
  const selected: (Catalog.ModelCatalogChoice | null)[] = []
  const events = { addEventListener() {}, removeEventListener() {} }
  const component = load(Vue, Icons, Catalog, Local, events, events, hostedModelMode)
  component.render = () => null
  let instance!: Vue.ComponentInternalInstance
  const setup = component.setup
  component.setup = (props: unknown, context: unknown) => { instance = Vue.getCurrentInstance()!; return setup(props, context) }
  const renderer = Vue.createRenderer<object, object>({
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    setText() {}, setElementText() {}, patchProp() {}, insert() {}, remove() {},
    parentNode: () => null, nextSibling: () => null
  })
  const app = renderer.createApp({ render: () => Vue.h(component, { ...props, onSelect: (choice: Catalog.ModelCatalogChoice | null) => selected.push(choice) }) })
  app.mount({})
  const state = (instance as unknown as { setupState: State }).setupState
  return { props, state, selected, unmount: () => app.unmount() }
}
function key(key: string, isComposing = false, keyCode = 0) {
  let prevented = false, stopped = false
  return { event: { key, isComposing, keyCode, preventDefault: () => { prevented = true }, stopPropagation: () => { stopped = true } } as KeyboardEvent,
    prevented: () => prevented, stopped: () => stopped }
}

test('pending state closes an already open picker and rejects queued list/manual/follow selections', async t => {
  const f = fixture(); t.after(f.unmount)
  await f.state.toggle(); assert.equal(f.state.open, true)
  f.state.manualModel = 'manual-writer'
  f.props.disabled = true; await Vue.nextTick()
  assert.equal(f.state.open, false)
  f.state.choose(f.props.choices[1]); f.state.chooseManual(); f.state.choose(null)
  assert.equal(f.selected.length, 0)
  f.props.disabled = false; await Vue.nextTick()
  await f.state.toggle(); f.state.choose(f.props.choices[1])
  assert.equal(f.selected[0]?.model, 'writer-b')
})

test('disable during the opening tick cancels opening', async t => {
  const f = fixture(); t.after(f.unmount)
  const opening = f.state.toggle(); f.props.disabled = true
  await opening; await Vue.nextTick()
  assert.equal(f.state.open, false)
  assert.equal(f.selected.length, 0)
})

test('a changed source closes the old picker and does not accept its retained choice', async t => {
  const f = fixture(); t.after(f.unmount)
  await f.state.toggle(); const old = f.props.choices[1]
  f.props.connectionId = 'global-two'; await Vue.nextTick()
  assert.equal(f.state.open, false)
  f.state.choose(old); assert.equal(f.selected.length, 0)
})

test('queued catalog choices are rechecked against current availability', async t => {
  const f = fixture(); t.after(f.unmount)
  await f.state.toggle(); const old = f.props.choices[1]
  f.props.choices = f.props.choices.map(c => c.key === old.key ? { ...c, disabledReason: '已停用' } : c)
  await Vue.nextTick(); f.state.choose(old); assert.equal(f.selected.length, 0)
  f.props.choices = []; await Vue.nextTick(); f.state.choose(old); assert.equal(f.selected.length, 0)
})

test('a disabled connection cannot be selected through either the catalog or manual entry', async t => {
  const f = fixture(); t.after(f.unmount)
  await f.state.toggle(); const old = f.props.choices[1]
  f.state.manualModel = 'manual-writer'
  f.props.connections[0].enabled = false; await Vue.nextTick()
  f.state.choose(old); f.state.chooseManual()
  assert.equal(f.selected.length, 0)
  assert.equal(f.state.manualModel, 'manual-writer')
})

test('closing and reopening clears the composition state from the removed input', async t => {
  const f = fixture(); t.after(f.unmount)
  await f.state.toggle(); f.state.composing = true
  await f.state.toggle(); assert.equal(f.state.open, false)
  await f.state.toggle(); f.state.choose(f.props.choices[1])
  assert.equal(f.selected[0]?.model, 'writer-b')
})

test('IME Enter and Escape preserve manual input and keep the picker open', async t => {
  const f = fixture(); t.after(f.unmount)
  await f.state.toggle(); f.state.manualModel = '写作模型'
  for (const [composing, keyCode] of [[true, 0], [false, 229]] as const) {
    const escape = key('Escape', composing, keyCode)
    f.state.handleKeydown(escape.event)
    assert.equal(escape.prevented(), false); assert.equal(escape.stopped(), false)
    assert.equal(f.state.open, true); assert.equal(f.state.manualModel, '写作模型')
    assert.equal(f.selected.length, 0)
    const enter = key('Enter', composing, keyCode)
    f.state.handleManualEnter(enter.event)
    assert.equal(enter.prevented(), false)
  }
  f.state.composing = true
  const composingEnter = key('Enter'); f.state.handleManualEnter(composingEnter.event)
  f.state.chooseManual(); assert.equal(f.selected.length, 0)
  f.state.composing = false
  const enter = key('Enter'); f.state.handleManualEnter(enter.event)
  assert.equal(enter.prevented(), true); assert.equal(f.selected[0]?.model, '写作模型')
  assert.equal(f.state.open, false)
})

test('normal Escape closes without selecting and follow choice remains available after reopening', async t => {
  const f = fixture(); t.after(f.unmount)
  await f.state.toggle(); const escape = key('Escape'); f.state.handleKeydown(escape.event)
  assert.equal(f.state.open, false); assert.equal(escape.prevented(), true)
  assert.equal(f.selected.length, 0)
  await f.state.toggle(); f.state.choose(null); assert.deepEqual(f.selected, [null])
})
