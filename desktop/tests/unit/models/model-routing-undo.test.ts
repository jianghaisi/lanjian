import * as Rules from '../../../src/contracts/models/model-rule-registry'
import * as Protocols from '../../../src/contracts/models/model-connections'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import { transformWithEsbuild } from 'vite'
import * as Vue from 'vue'
import * as Local from '../../../src/contracts/models/local-model-contracts'
import * as Drafts from '../../../src/renderer/features/models/services/model-connections-state'
import * as Catalog from '../../../src/renderer/features/models/services/model-catalog'
import * as Generation from '../../../src/contracts/models/generation-parameters'
import type { GlobalConnectionsView } from '../../../src/contracts/models/model-connections'
import type { ModelCatalogSnapshot } from '../../../src/contracts/models/model-catalog-metadata'
import type { ParameterOverrides } from '../../../src/contracts/models/parameter-policy'

// Render both real SFC templates: a setup-only test cannot catch stale undo
// inside a reused parameter editor when copying the same model and source.
async function load(name: string, dependencies: Record<string, unknown>) {
  const source = await readFile(new URL(`../../../src/renderer/features/models/components/${name}.vue`, import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const script = compileScript(descriptor, { id: name, inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content
    .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/g, (_, names: string) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = Vue;`)
    .replace(/import[^\n]+from ['"][^'"]+local-model-contracts['"];?/g, 'const { LOCAL_CONNECTION_ID, LOCAL_QWEN_ID, LOCAL_QWEN_LIMITS } = Local;')
    .replace(/import[^\n]+from ['"][^'"]+model-connections-state['"];?/g, 'const { draftProfile, modelTaskLabels, copySharedProfiles, selectModel } = Drafts;')
    .replace(/import[^\n]+from ['"][^'"]+generation-parameters['"];?/g, 'const { compileGeneration, modelCapabilities } = Generation;')
    .replace(/import[^\n]+from ['"][^'"]+model-catalog['"];?/g, 'const { buildModelCatalog } = Catalog;')
    .replace(/import[^\n]+from ['"][^'"]+model-catalog-session['"];?/g, 'const { sessionModelCatalogs: catalogs } = Session;')
     .replace(/import[^\n]+from ['"][^'"]+model-rule-registry['"];?/g, 'const { MODEL_RULES } = Rules;')
  .replace(/import[^\n]+from ['"][^'"]+model-connections['"];?/g, 'const { remoteModelProtocol } = Protocols;')
  .replace(/import (Archive\w+|Model\w+) from [^\n]+/g, 'const $1 = Components.$1;')
  const compiled = await transformWithEsbuild(script, `${name}.ts`, { loader: 'ts' })
  return new Function(...Object.keys(dependencies), compiled.code.replace('export default', 'return'))(...Object.values(dependencies))
}
type Host = { tag: string; tagName: string; text: string; props: Record<string, any>; children: Host[]; parent: Host | null; options: Host[]; addEventListener(): void; removeEventListener(): void }
const node = (tag = '', text = ''): Host => ({ tag, tagName: tag.toUpperCase(), text, props: {}, children: [], parent: null, get options() { return this.children.filter(c => c.tag === 'option') }, addEventListener() {}, removeEventListener() {} })
function remove(child: Host) { if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1); child.parent = null }
const renderer = Vue.createRenderer<Host, Host>({
  createElement: tag => node(tag), createText: text => node('', text), createComment: () => node(),
  setText: (el, text) => { el.text = text }, setElementText: (el, text) => { el.text = text; el.children = [] },
  patchProp: (el, key, _, value) => { el.props[key] = value; if (key === 'value') Object.assign(el, { value, _value: value }) },
  insert: (child, parent, anchor) => { remove(child); parent.children.splice(anchor ? parent.children.indexOf(anchor) : parent.children.length, 0, child); child.parent = parent },
  remove, parentNode: el => el.parent, nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
})
const descendants = (root: Host): Host[] => [root, ...root.children.flatMap(descendants)]
const content = (root: Host): string => root.text + root.children.map(content).join('')
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const tasks = ['outline', 'chapterOutline', 'prose', 'review'] as const
const profile = (model = 'writer-alpha'): Drafts.ProfileDraft => ({ selection: 'global:global-fixture', model, parameterPolicy: { version: 1, mode: 'custom', overrides: { temperature: 0, maxTokens: 2048 } } })
const catalog: GlobalConnectionsView = { revision: 1, connections: [{ id: 'global-fixture', name: 'Fixture', protocol: 'gemini-native', baseUrl: 'https://example.test', revision: 1, enabled: true, credentialState: 'missing' }] }
async function fixture() {
  const components: Record<string, unknown> = {
    ArchiveAction: Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('button', slots.default?.()) }),
    ArchiveFormField: Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('div', slots.default?.({ controlProps: {} })) }),
    ModelCatalogPicker: Vue.defineComponent({ props: ['model'], emits: ['select'], setup: (_, { emit }) => () => Vue.h('button', { onClick: () => emit('select', { model: 'writer-alpha' }) }, '选择 writer-alpha') }),
  }
  const dependencies = { Rules, Protocols, Vue, Local, Drafts, Catalog, Generation, Components: components, Session: { sessionModelCatalogs: Vue.ref<Record<string, ModelCatalogSnapshot>>({ 'global:global-fixture': { connectionId: 'global-fixture', revision: 1, protocol: 'gemini-native', fetchedAt: '2026-10-01T00:00:00.000Z', complete: true, entries: [{ id: 'writer-alpha', maxTemperature: 2, outputTokenLimit: 8192 }, { id: 'writer-beta', maxTemperature: 2, outputTokenLimit: 8192 }] } }) } }
  components.ModelParameterEditor = await load('ModelParameterEditor', dependencies)
  const component = await load('ModelRoutingForm', dependencies)
  const draft = Vue.ref(Drafts.routingDraft(null)), disabled = Vue.ref(false)
  draft.value.routingMode = 'perTask'; draft.value.profiles.shared = profile()
  for (const slot of tasks) draft.value.profiles[slot] = profile('writer-beta')
  const root = node('root')
  const app = renderer.createApp({ render: () => Vue.h(component, { modelValue: draft.value, 'onUpdate:modelValue': (value: Drafts.RoutingDraft) => { draft.value = value }, disabled: disabled.value, options: catalog.connections.map(c => ({ ...c, value: `global:${c.id}`, label: c.name })) }) })
  app.mount(root)
  const slot = (name: Drafts.ModelSlot) => descendants(root).find(n => n.props['data-model-slot'] === name)!
  const buttons = (scope = root) => descendants(scope).filter(n => n.tag === 'button')
  const button = (label: string, scope = root) => { const found = buttons(scope).find(n => content(n) === label); assert.ok(found, `missing button: ${label}`); return found }
  const click = async (label: string, scope = root) => { button(label, scope).props.onClick(); await Vue.nextTick() }
  const mode = async (name: Drafts.ModelSlot, value: string) => { descendants(slot(name)).find(n => n.props['aria-label'] === `${Drafts.modelTaskLabels[name]}参数模式`)!.props.onChange({ target: { value } }); await Vue.nextTick() }
  const input = async (name: Drafts.ModelSlot, label: string, value: string, badInput = false) => {
    const control = descendants(slot(name)).find(n => n.props['aria-label'] === `${Drafts.modelTaskLabels[name]}${label}`)
    assert.ok(control, `missing input: ${label}`)
    control.props.onInput({ target: { value, valueAsNumber: value ? Number(value) : Number.NaN, validity: { badInput } } }); await Vue.nextTick()
  }
  const copy = () => click('把统一选择复制到四项任务')
  const undos = (scope = root) => buttons(scope).filter(n => content(n).startsWith('撤销')).map(content)
  return { draft, disabled, root, slot, button, click, mode, input, copy, undos, catalogs: dependencies.Session.sessionModelCatalogs, unmount: () => app.unmount() }
}

test('copy replaces all task drafts and removes pre-copy model/source undo actions', async t => {
  const f = await fixture(); t.after(f.unmount)
  for (const slot of tasks) await f.click('选择 writer-alpha', f.slot(slot))
  assert.equal(f.undos().filter(text => text === '撤销这次切换').length, 4)
  const shared = plain(f.draft.value.profiles.shared)
  await f.copy()
  assert.deepEqual(f.undos(), [], 'copied settings must not keep actions restoring pre-copy task profiles')
  for (const slot of tasks) assert.deepEqual(plain(f.draft.value.profiles[slot]), shared)
  const saved = Drafts.compileRouting(f.draft.value, catalog).template
  for (const slot of tasks) assert.deepEqual(saved.tasks[slot].parameterPolicy, shared.parameterPolicy)
})

test('same-model copy invalidates nested parameter undo and updates every task preview', async t => {
  const f = await fixture(); t.after(f.unmount)
  for (const slot of tasks) {
    await f.click('选择 writer-alpha', f.slot(slot))
    await f.mode(slot, 'custom')
  }
  assert.equal(f.undos().filter(text => text === '撤销参数模式调整').length, 4)
  await f.copy()
  for (const slot of tasks) {
    assert.deepEqual(f.undos(f.slot(slot)), [])
    assert.match(content(f.slot(slot)), /本次输出上限 2,048/)
  }
})

test('copy preserves shared undo and allows fresh task parameter changes to be undone', async t => {
  const f = await fixture(); t.after(f.unmount)
  f.draft.value.routingMode = 'shared'; await Vue.nextTick()
  await f.mode('shared', 'auto'); assert.deepEqual(f.undos(f.slot('shared')), ['撤销参数模式调整'])
  await f.copy(); assert.deepEqual(f.undos(f.slot('shared')), ['撤销参数模式调整'])
  await f.click('撤销参数模式调整', f.slot('shared'))
  assert.deepEqual(f.draft.value.profiles.shared.parameterPolicy, profile().parameterPolicy)
  assert.equal(f.draft.value.profiles.prose.parameterPolicy?.mode, 'auto', 'shared undo cannot change copied tasks')
  f.draft.value.routingMode = 'perTask'; await Vue.nextTick()
  await f.copy(); await f.mode('prose', 'auto')
  assert.deepEqual(f.undos(f.slot('prose')), ['撤销参数模式调整'])
  await f.click('撤销参数模式调整', f.slot('prose'))
  assert.deepEqual(f.draft.value.profiles.prose.parameterPolicy, profile().parameterPolicy)
})

test('copy has independent task profiles and retains incomplete numeric input validation', async t => {
  const f = await fixture(); t.after(f.unmount)
  f.draft.value.profiles.shared.parameterInputErrors = { temperature: true }
  await f.copy()
  for (const slot of tasks) assert.match(content(f.slot(slot)), /完整数字/)
  assert.throws(() => Drafts.compileRouting(f.draft.value, catalog), /完整数字/)
  delete f.draft.value.profiles.prose.parameterInputErrors?.temperature
  const policy = f.draft.value.profiles.prose.parameterPolicy
  assert.ok(policy?.mode === 'custom'); policy.overrides.temperature = .5
  assert.equal(f.draft.value.profiles.shared.parameterInputErrors?.temperature, true)
  assert.equal(f.draft.value.profiles.review.parameterInputErrors?.temperature, true)
  for (const slot of ['shared', 'review'] as const) assert.deepEqual(f.draft.value.profiles[slot].parameterPolicy, profile().parameterPolicy)
})

test('disabled copy callbacks preserve the draft and current undo', async t => {
  const f = await fixture(); t.after(f.unmount)
  await f.click('选择 writer-alpha', f.slot('prose'))
  const before = plain(f.draft.value), actions = f.undos()
  f.disabled.value = true; await Vue.nextTick(); await f.copy()
  assert.deepEqual(plain(f.draft.value), before)
  assert.deepEqual(f.undos(), actions)
})

const restoreCases: Array<{ key: keyof ParameterOverrides; label: string; value: ParameterOverrides[keyof ParameterOverrides] }> = [
  { key: 'temperature', label: '创造性', value: 0 },
  { key: 'topP', label: '采样范围', value: 0 },
  { key: 'thinking', label: '思考设置', value: { kind: 'effort', value: 'high' } },
  { key: 'thinking', label: '思考设置', value: { kind: 'budget', tokens: 128 } },
]
for (const entry of restoreCases) {
  test(`undo only restores ${entry.key} ${JSON.stringify(entry.value)} without reverting a later output budget`, async t => {
    const f = await fixture(); t.after(f.unmount)
    f.draft.value.routingMode = 'shared'; f.catalogs.value = {}
    f.draft.value.profiles.shared.parameterPolicy = { version: 1, mode: 'custom', overrides: { maxTokens: 2048, [entry.key]: entry.value } }
    await Vue.nextTick()
    const restore = descendants(f.slot('shared')).find(n => n.props['aria-label'] === `统一模型将${entry.label}恢复自动`)
    assert.ok(restore); restore.props.onClick(); await Vue.nextTick()
    await f.input('shared', '最大输出', '4096')
    await f.click('撤销这项参数调整', f.slot('shared'))
    const saved = Drafts.draftProfile(f.draft.value.profiles.shared, 'assigned-1')
    assert.deepEqual(saved.parameterPolicy, { version: 1, mode: 'custom', overrides: { [entry.key]: entry.value, maxTokens: 4096 } })
    assert.deepEqual(f.undos(), [])
  })
}

test('per-field undo preserves another field that was explicitly cleared after metadata returned', async t => {
  const f = await fixture(); t.after(f.unmount)
  const metadata = f.catalogs.value
  f.draft.value.routingMode = 'shared'; f.catalogs.value = {}; await Vue.nextTick()
  await f.click('此项恢复自动', f.slot('shared'))
  f.catalogs.value = metadata; await Vue.nextTick()
  await f.input('shared', '最大输出', '')
  await f.click('撤销这项参数调整', f.slot('shared'))
  assert.deepEqual(f.draft.value.profiles.shared.parameterPolicy, { version: 1, mode: 'custom', overrides: { temperature: 0 } })
  assert.match(content(f.slot('shared')), /四项任务输出上限 8,192/)
})

for (const repaired of [false, true]) {
  test(`per-field undo preserves the latest ${repaired ? 'repaired' : 'unfinished'} input state of other fields`, async t => {
    const f = await fixture(); t.after(f.unmount)
    f.draft.value.routingMode = 'shared'; await Vue.nextTick()
    await f.input('shared', '创造性', '', true)
    if (repaired) await f.input('shared', '最大输出', '', true)
    f.catalogs.value = {}; await Vue.nextTick()
    await f.click('此项恢复自动', f.slot('shared'))
    await f.input('shared', '最大输出', repaired ? '4096' : '', !repaired)
    await f.click('撤销这项参数调整', f.slot('shared'))
    assert.equal(f.draft.value.profiles.shared.parameterInputErrors?.temperature, true)
    assert.equal(f.draft.value.profiles.shared.parameterInputErrors?.maxTokens, repaired ? undefined : true)
    assert.throws(() => Drafts.draftProfile(f.draft.value.profiles.shared, 'assigned-1'), /完整数字/)
    f.catalogs.value = {}; await Vue.nextTick()
    await f.click('此项恢复自动', f.slot('shared'))
    if (repaired) {
      assert.deepEqual(Drafts.draftProfile(f.draft.value.profiles.shared, 'assigned-1').parameterPolicy, { version: 1, mode: 'custom', overrides: { maxTokens: 4096 } })
    } else assert.throws(() => Drafts.draftProfile(f.draft.value.profiles.shared, 'assigned-1'), /完整数字/)
  })
}

for (const badInput of [false, true]) {
  test(`new ${badInput ? 'unfinished' : 'valid'} input to the restored field expires its old undo`, async t => {
    const f = await fixture(); t.after(f.unmount)
    const metadata = f.catalogs.value
    f.draft.value.routingMode = 'shared'; f.catalogs.value = {}; await Vue.nextTick()
    await f.click('此项恢复自动', f.slot('shared'))
    f.catalogs.value = metadata; await Vue.nextTick()
    assert.deepEqual(f.undos(), ['撤销这项参数调整'], 'metadata reads alone preserve undo')
    await f.input('shared', '创造性', badInput ? '' : '0.7', badInput)
    assert.deepEqual(f.undos(), [], 'new input supersedes this field\'s earlier restore-to-auto action')
    if (badInput) assert.throws(() => Drafts.draftProfile(f.draft.value.profiles.shared, 'assigned-1'), /完整数字/)
    else assert.deepEqual(f.draft.value.profiles.shared.parameterPolicy, { version: 1, mode: 'custom', overrides: { temperature: .7, maxTokens: 2048 } })
  })
}

test('a queued undo callback cannot mutate a disabled editor', async t => {
  const f = await fixture(); t.after(f.unmount)
  f.draft.value.routingMode = 'shared'; f.catalogs.value = {}; await Vue.nextTick()
  await f.click('此项恢复自动', f.slot('shared'))
  const before = plain(f.draft.value)
  f.disabled.value = true; await Vue.nextTick(); await f.click('撤销这项参数调整', f.slot('shared'))
  assert.deepEqual(plain(f.draft.value), before)
  assert.deepEqual(f.undos(), ['撤销这项参数调整'])
})

test('shared form exposes each actual task budget instead of describing prose as the whole assignment', async t => {
  const f = await fixture(); t.after(f.unmount)
  f.draft.value.routingMode = 'shared'
  f.draft.value.profiles.shared = { ...profile(), parameterPolicy: { version: 1, mode: 'auto' } }
  f.catalogs.value['global:global-fixture'].entries[0].outputTokenLimit = 32768
  await Vue.nextTick()
  for (const [task, budget] of Object.entries({ outline: '16,384', chapterOutline: '8,192', prose: '16,384', review: '8,192' })) {
    const row = descendants(f.slot('shared')).find(node => node.props['data-budget-task'] === task)
    assert.ok(row); assert.ok(content(row).includes(budget))
  }
  await f.mode('shared', 'custom'); await f.input('shared', '最大输出', '4096')
  assert.match(content(f.slot('shared')), /四项任务输出上限[^]*4,096/)
  f.draft.value.routingMode = 'perTask'; await Vue.nextTick()
  assert.match(content(f.slot('prose')), /本次输出上限[^]*2,048/)
})
