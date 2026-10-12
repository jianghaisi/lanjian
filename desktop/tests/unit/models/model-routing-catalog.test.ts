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
import type { ModelCatalogSnapshot } from '../../../src/contracts/models/model-catalog-metadata'
import type { ModelConnectionsApi, ModelCatalogQuery, ModelProbeResult } from '../../../src/contracts/models/model-connections-contracts'
import { unwrapValidatedIpcResponse } from '../../../src/contracts/core/ipc-response'

const source = await readFile(new URL('../../../src/renderer/features/models/components/ModelRoutingForm.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'routing-catalog' }).content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/g, (_, names: string) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = Vue;`)
  .replace(/import[^\n]+from ['"][^'"]+local-model-contracts['"];?/g, 'const { LOCAL_CONNECTION_ID, LOCAL_QWEN_ID, LOCAL_QWEN_LIMITS } = Local;')
  .replace(/import[^\n]+from ['"][^'"]+model-connections-state['"];?/g, 'const { modelTaskLabels, copySharedProfiles, selectModel } = Drafts;')
  .replace(/import[^\n]+from ['"][^'"]+model-catalog['"];?/g, 'const { buildModelCatalog } = Catalog;')
  .replace(/import[^\n]+from ['"][^'"]+model-catalog-session['"];?/g, 'const { sessionModelCatalogs: catalogs } = Session;')
   .replace(/import[^\n]+from ['"][^'"]+model-rule-registry['"];?/g, 'const { MODEL_RULES } = Rules;')
  .replace(/import[^\n]+from ['"][^'"]+model-connections['"];?/g, 'const { remoteModelProtocol } = Protocols;')
  .replace(/import (Archive\w+|Model\w+) from [^\n]+/g, 'const $1 = {};')
const compiled = await transformWithEsbuild(script, 'ModelRoutingForm.ts', { loader: 'ts' })
const load = new Function('Rules', 'Protocols', 'Vue', 'Local', 'Drafts', 'Catalog', 'Session', compiled.code.replace('export default', 'return'))
type State = { errors: Record<string, string | { revision: number; message: string }>; loading: string; fetchModels(slot: Drafts.ModelSlot): Promise<void> }
const snapshot: ModelCatalogSnapshot = { connectionId: 'global-fixture', revision: 1, protocol: 'gemini-native', fetchedAt: '2026-10-01T00:00:00.000Z', complete: true, entries: [{ id: 'writer', maxTemperature: 2, outputTokenLimit: 8192 }] }
const receipt = (patch: Partial<ModelProbeResult> = {}): ModelProbeResult => ({ id: 'global-fixture', revision: 1, model: '', models: ['writer'], catalog: snapshot, testedAt: snapshot.fetchedAt, success: true, message: '已获取型号', ...patch })
function fixture() {
  const catalogs = Vue.ref<Record<string, ModelCatalogSnapshot>>({ 'global:global-fixture': snapshot })
  const draft = Vue.ref(Drafts.routingDraft(null))
  draft.value.profiles.shared = { selection: 'global:global-fixture', model: 'writer', parameterPolicy: { version: 1, mode: 'custom', overrides: { temperature: 0, maxTokens: 2048 } } }
  const props = Vue.reactive({ disabled: false, options: [{ value: 'global:global-fixture', label: 'Fixture', protocol: 'gemini-native', baseUrl: 'https://example.test', revision: 1, disabled: false }] })
  const calls: ModelCatalogQuery[] = [], busy: boolean[] = []
  const api = { catalog: async (input: ModelCatalogQuery) => { calls.push(input); return receipt() }, cancelTest: async () => true } satisfies Pick<ModelConnectionsApi, 'catalog' | 'cancelTest'>
  const component = load(Rules, Protocols, Vue, Local, Drafts, Catalog, { sessionModelCatalogs: catalogs })
  component.render = () => null
  let instance!: Vue.ComponentInternalInstance
  const setup = component.setup
  component.setup = (props: unknown, context: unknown) => { instance = Vue.getCurrentInstance()!; return setup(props, context) }
  const renderer = Vue.createRenderer<object, object>({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {}, patchProp() {}, insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null })
  const app = renderer.createApp({ render: () => Vue.h(component, { ...props, api, modelValue: draft.value, 'onUpdate:modelValue': (value: Drafts.RoutingDraft) => { draft.value = value }, onBusy: (value: boolean) => { busy.push(value) } }) })
  app.mount({})
  const state = (instance as unknown as { setupState: State }).setupState
  const error = () => { const value = state.errors['global:global-fixture']; return typeof value === 'string' ? value : value?.message ?? '' }
  return { props, api, state, draft, catalogs, calls, busy, error, unmount: () => app.unmount() }
}
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const rejectIpc = (message: string) => unwrapValidatedIpcResponse<ModelProbeResult>('model-connections:catalog', { ok: false, error: { code: 'AI_CONNECTION_ERROR', message, recoverable: true } })

for (const message of ['密钥无效，请检查全局 API 密钥。', '接口当前限流，请稍后重试。', '接口配置已变化，请重新读取。']) {
  test(`catalog failure retains the validated IPC reason: ${message}`, async t => {
    const f = fixture(); t.after(f.unmount); const before = plain(f.draft.value)
    f.api.catalog = async () => rejectIpc(message)
    await f.state.fetchModels('shared')
    assert.equal(f.error(), message)
    assert.deepEqual(plain(f.draft.value), before)
    assert.equal(f.catalogs.value['global:global-fixture'], undefined)
    assert.equal(f.state.loading, ''); assert.equal(f.busy.at(-1), false)
  })
}

test('unexpected errors have a readable fallback; an explicit retry recovers without changing the assignment', async t => {
  const f = fixture(); t.after(f.unmount); const before = plain(f.draft.value)
  f.api.catalog = async () => { throw { message: 42, diagnostic: 'not-for-display' } }
  await f.state.fetchModels('shared')
  assert.match(f.error(), /获取失败/); assert.doesNotMatch(f.error(), /42|not-for-display/)
  f.api.catalog = async () => receipt(); await f.state.fetchModels('shared')
  assert.equal(f.error(), ''); assert.equal(f.catalogs.value['global:global-fixture']?.entries[0].id, 'writer')
  assert.deepEqual(plain(f.draft.value), before)
})

for (const change of ['revision', 'disabled', 'removed'] as const) {
  test(`late catalog failure does not describe a ${change} source`, async t => {
    const f = fixture(); t.after(f.unmount)
    let reject!: (cause: unknown) => void
    f.api.catalog = () => new Promise<ModelProbeResult>((_, no) => { reject = no })
    const pending = f.state.fetchModels('shared')
    if (change === 'revision') f.props.options[0].revision++
    else if (change === 'disabled') f.props.options[0].disabled = true
    else f.props.options = []
    await Vue.nextTick(); reject(new Error('旧接口失败')); await pending
    assert.equal(f.error(), ''); assert.equal(f.state.loading, '')
    assert.equal(f.busy.at(-1), false)
  })
}

test('an already visible error clears when that interface revision changes', async t => {
  const f = fixture(); t.after(f.unmount)
  f.api.catalog = async () => { throw new Error('旧密钥失效') }
  await f.state.fetchModels('shared'); assert.equal(f.error(), '旧密钥失效')
  f.props.options[0].revision++; await Vue.nextTick()
  assert.equal(f.error(), '')
})

test('a mismatched success receipt is described as a source conflict, never as success', async t => {
  const f = fixture(); t.after(f.unmount)
  f.api.catalog = async () => receipt({ id: 'global-other' })
  await f.state.fetchModels('shared')
  assert.match(f.error(), /接口已变化/); assert.doesNotMatch(f.error(), /已获取型号/)
  assert.equal(f.catalogs.value['global:global-fixture'], undefined)
})

test('unmount ignores a late failure and releases pending state to its parent', async () => {
  const f = fixture(); let reject!: (cause: unknown) => void
  f.api.catalog = () => new Promise<ModelProbeResult>((_, no) => { reject = no })
  const pending = f.state.fetchModels('shared'); f.unmount()
  reject(new Error('已离开的目录失败')); await pending
  assert.equal(f.error(), ''); assert.equal(f.busy.at(-1), false)
})
