import * as Rules from '../../../src/contracts/models/model-rule-registry'
import * as Protocols from '../../../src/contracts/models/model-connections'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import { transformWithEsbuild } from 'vite'
import * as Vue from 'vue'
import * as Generation from '../../../src/contracts/models/generation-parameters'
import * as Drafts from '../../../src/renderer/features/models/services/model-connections-state'
import type { GlobalConnectionsView } from '../../../src/contracts/models/model-connections'

const source = await readFile(new URL('../../../src/renderer/features/models/components/ModelParameterEditor.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'parameter-input' }).content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/g, (_, names: string) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = Vue;`)
  .replace(/import[^\n]+from ['"][^'"]+generation-parameters['"];?/g, 'const { compileGeneration, modelCapabilities } = Generation;')
  .replace(/import[^\n]+from ['"][^'"]+model-connections-state['"];?/g, 'const { draftProfile, modelTaskLabels } = Drafts;')
   .replace(/import[^\n]+from ['"][^'"]+model-rule-registry['"];?/g, 'const { MODEL_RULES } = Rules;')
  .replace(/import[^\n]+from ['"][^'"]+model-connections['"];?/g, 'const { remoteModelProtocol } = Protocols;')
  .replace(/import (Archive\w+) from [^\n]+/g, 'const $1 = {};')
const compiled = await transformWithEsbuild(script, 'ModelParameterEditor.ts', { loader: 'ts' })
const load = new Function('Rules', 'Protocols', 'Vue', 'Generation', 'Drafts', compiled.code.replace('export default', 'return'))
type State = {
  preview: { error: string }; previous?: Drafts.ProfileDraft
  number(key: 'temperature' | 'topP' | 'maxTokens', event: Event): void
  budget(event: Event): void; mode(value: string): void
  bindRule(value: string): void; reasoningBudget(event: Event): void
  reasoning(key: string, value: string): void
  clearUnconfirmed(key: string): void
  unconfirmed: Array<{ key: string; value: string }>
}
const catalog: GlobalConnectionsView = { revision: 1, connections: [{ id: 'global-fixture', name: 'Fixture', protocol: 'gemini-native', baseUrl: 'https://generativelanguage.googleapis.com', enabled: true, revision: 1, credentialState: 'missing' }] }
function fixture(task: Drafts.ModelSlot = 'prose') {
  const profile = Vue.ref<Drafts.ProfileDraft>({ selection: 'global:global-fixture', model: 'gemini-2.5-flash', parameterPolicy: { version: 1, mode: 'custom', overrides: { temperature: 0, topP: .8, maxTokens: 2048, thinking: { kind: 'budget', tokens: 128 } } } })
  const disabled = Vue.ref(false), component = load(Rules, Protocols, Vue, Generation, Drafts)
  component.render = () => null
  let instance!: Vue.ComponentInternalInstance
  const setup = component.setup
  component.setup = (props: unknown, context: unknown) => { instance = Vue.getCurrentInstance()!; return setup(props, context) }
  const renderer = Vue.createRenderer<object, object>({
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    setText() {}, setElementText() {}, patchProp() {}, insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null
  })
  const app = renderer.createApp({ render: () => Vue.h(component, { modelValue: profile.value, 'onUpdate:modelValue': (value: Drafts.ProfileDraft) => { profile.value = value },
    target: { protocol: 'gemini-native', baseUrl: catalog.connections[0].baseUrl, model: profile.value.model }, task, label: '统一模型', disabled: disabled.value }) })
  app.mount({})
  return { profile, disabled, state: (instance as unknown as { setupState: State }).setupState, unmount: () => app.unmount() }
}
const input = (value: string, badInput = false) => ({ target: { value, valueAsNumber: value ? Number(value) : Number.NaN, validity: { badInput } } }) as unknown as Event
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value))

test('v2 rule replacement retains incompatible reasoning visibly; incomplete budgets stay blocked until corrected', async t => {
  const f = fixture(); t.after(f.unmount)
  f.state.bindRule('gemini-2.5-flash'); await Vue.nextTick()
  const p = f.profile.value.parameterPolicy
  assert.ok(p?.version === 2 && p.mode === 'custom')
  assert.deepEqual(p.overrides.reasoning, { budgetTokens: 128 }); assert.equal(p.overrides.thinking, undefined)
  f.state.reasoningBudget(input('', true)); await Vue.nextTick()
  assert.match(f.state.preview.error, /完整数字/)
  f.state.reasoning('mode', ''); await Vue.nextTick()
  assert.match(f.state.preview.error, /完整数字/)
  f.state.reasoningBudget(input('0')); await Vue.nextTick(); assert.equal(f.state.preview.error, '')
  f.state.bindRule('gemini-3.8-flash'); await Vue.nextTick()
  assert.ok(f.state.unconfirmed.some(i => i.key === 'reasoning' && i.value === '0 tokens'))
  assert.notEqual(f.state.preview.error, '')
  f.state.clearUnconfirmed('reasoning'); await Vue.nextTick(); assert.equal(f.state.preview.error, '')
  f.state.reasoning('effort', 'medium'); await Vue.nextTick(); assert.equal(f.state.preview.error, '')
  assert.equal(f.profile.value.parameterPolicy?.version === 2 && f.profile.value.parameterPolicy.ruleId, 'gemini-3.8-flash')
  const selected = Drafts.selectModel(f.profile.value, 'another-writer')
  assert.equal(selected.parameterPolicy?.version === 2 && selected.parameterPolicy.ruleId, false)
})

for (const key of ['temperature', 'topP', 'maxTokens', 'thinking'] as const) {
  test(`${key}: unfinished native numeric input retains the prior value and blocks preview/save until corrected`, async t => {
    const f = fixture(); t.after(f.unmount)
    const before = plain(f.profile.value), policy = plain(f.profile.value.parameterPolicy)
    const enter = (value: string, badInput = false) => key === 'thinking' ? f.state.budget(input(value, badInput)) : f.state.number(key, input(value, badInput))
    enter('', true); await Vue.nextTick()
    assert.deepEqual(f.profile.value.parameterPolicy, policy)
    assert.notDeepEqual(plain(f.profile.value), before, 'invalid input must keep the navigation/save draft dirty')
    assert.match(f.state.preview.error, /完整数字/)
    assert.throws(() => Drafts.draftProfile(f.profile.value, 'assigned-1'), { code: 'VALIDATION_ERROR', message: /完整数字/ })
    const draft = Drafts.routingDraft(null); draft.profiles.shared = plain(f.profile.value)
    assert.throws(() => Drafts.compileRouting(draft, catalog), /完整数字/)
    const copied = Drafts.copySharedProfiles(draft)
    assert.throws(() => Drafts.compileRouting(copied, catalog), /完整数字/)
    enter(key === 'maxTokens' ? '4096' : '0'); await Vue.nextTick()
    assert.equal(f.state.preview.error, '')
    const saved = Drafts.draftProfile(f.profile.value, 'assigned-1')
    assert.equal('parameterInputErrors' in saved, false)
    assert.ok(saved.parameterPolicy?.mode === 'custom')
    assert.deepEqual(saved.parameterPolicy.overrides[key], key === 'thinking' ? { kind: 'budget', tokens: 0 } : key === 'maxTokens' ? 4096 : 0)
    enter(''); await Vue.nextTick()
    const cleared = Drafts.draftProfile(f.profile.value, 'assigned-1')
    assert.ok(cleared.parameterPolicy?.mode === 'custom')
    assert.equal(Object.hasOwn(cleared.parameterPolicy.overrides, key), false, 'only real clearing restores automatic')
  })
}

test('repairing a different field cannot clear an unfinished input', async t => {
  const f = fixture(); t.after(f.unmount)
  f.state.number('temperature', input('', true)); await Vue.nextTick()
  f.state.number('maxTokens', input('4096')); await Vue.nextTick()
  assert.throws(() => Drafts.draftProfile(f.profile.value, 'assigned-1'), /完整数字/)
  f.state.number('temperature', input('0')); await Vue.nextTick()
  assert.equal(f.state.preview.error, '')
})

test('automatic mode and model switching explicitly discard invalid input; undo restores the guarded draft', async t => {
  const f = fixture(); t.after(f.unmount)
  f.state.number('temperature', input('', true)); await Vue.nextTick()
  f.state.mode('auto'); await Vue.nextTick()
  assert.equal(f.state.preview.error, '')
  assert.ok(f.state.previous)
  const previous = plain(f.state.previous)
  assert.throws(() => Drafts.draftProfile(previous, 'assigned-1'), /完整数字/)
  f.profile.value = previous; await Vue.nextTick()
  assert.match(f.state.preview.error, /完整数字/)
  f.profile.value = Drafts.selectModel(f.profile.value, 'another-writer'); await Vue.nextTick()
  assert.equal(f.state.preview.error, '')
})

test('queued input callbacks cannot mutate a disabled parameter editor', async t => {
  const f = fixture(); t.after(f.unmount)
  const before = plain(f.profile.value)
  f.disabled.value = true; await Vue.nextTick()
  f.state.number('temperature', input('', true)); f.state.budget(input('0')); f.state.mode('auto')
  await Vue.nextTick(); assert.deepEqual(plain(f.profile.value), before)
})

test('shared preview identifies a task whose smaller output budget cannot fit the selected thinking budget', async t => {
  const f = fixture('shared'); t.after(f.unmount)
  f.profile.value.parameterPolicy = { version: 1, mode: 'custom', overrides: { thinking: { kind: 'budget', tokens: 12000 } } }
  await Vue.nextTick()
  assert.match(f.state.preview.error, /章节大纲.*思考预算/)
  assert.match(f.state.preview.error, /12000.*8192.*降低思考预算/)
  f.state.number('maxTokens', input('16384')); await Vue.nextTick()
  assert.equal(f.state.preview.error, '')
})

test('out-of-range input names the field and remains editable until explicit correction or clearing', async t => {
  const f = fixture(); t.after(f.unmount)
  f.state.number('topP', input('1.2')); await Vue.nextTick()
  assert.match(f.state.preview.error, /采样范围.*top_p.*0.*1.*清空/)
  assert.ok(f.profile.value.parameterPolicy?.mode === 'custom')
  assert.equal(f.profile.value.parameterPolicy.overrides.topP, 1.2)
  assert.throws(() => Drafts.draftProfile(f.profile.value, 'assigned-1'), /采样范围.*0.*1/)
  f.state.number('maxTokens', input('3072')); await Vue.nextTick()
  assert.match(f.state.preview.error, /采样范围/, 'editing another parameter must not hide the original invalid value')
  f.state.number('topP', input('')); await Vue.nextTick()
  assert.equal(f.state.preview.error, '')
  const saved = Drafts.draftProfile(f.profile.value, 'assigned-1')
  assert.ok(saved.parameterPolicy?.mode === 'custom')
  assert.equal(saved.parameterPolicy.overrides.topP, undefined)
  assert.equal(saved.parameterPolicy.overrides.maxTokens, 3072)
  assert.equal(saved.parameterPolicy.overrides.temperature, 0)
})
