import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { setImmediate } from 'node:timers/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import { transformWithEsbuild } from 'vite'
import * as Vue from 'vue'
import { useLocalModels } from '../../../src/renderer/features/models/composables/use-local-models'
import { LOCAL_CONNECTION_ID, type LocalModelsApi, type LocalModelView } from '../../../src/contracts/models/local-model-contracts'
import type { AiSettings } from '../../../src/contracts/index'

const source = await readFile(new URL('../../../src/renderer/features/models/components/LocalModelStore.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'availability-sync', inlineTemplate: true }).content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/g,
    (_, names: string) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = Vue;`)
  .replace(/import ArchivePageHeader from [^\n]+/, 'const ArchivePageHeader = { setup(_, { slots }) { return () => Vue.h("header", {}, slots.default?.()) } };')
  .replace(/import LocalModelCard from [^\n]+/, 'const LocalModelCard = Card;')
  .replace(/import \{ useLocalModels \} from [^\n]+/, '')
  .replace(/import \{ LOCAL_CONNECTION_ID \} from [^\n]+/, '')
const compiled = await transformWithEsbuild(script, 'LocalModelStore.ts', { loader: 'ts' })
const loadComponent = new Function('Vue', 'useLocalModels', 'LOCAL_CONNECTION_ID', 'Card', compiled.code.replace('export default', 'return'))

function row(patch: Partial<LocalModelView> = {}): LocalModelView {
  return { id: 'fixture', name: 'Fixture', family: 'Qwen', description: '', revision: 'revision-one', bytes: 1,
    quantization: 'Q8_0', license: 'MIT', state: 'not-installed', capabilities: [], contextTokens: 8192,
    maxOutputTokens: 4096, recommendedOutputTokens: 2048, progress: 0, message: '待安装', canDownload: true, ...patch }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
async function mount(rows: LocalModelView[], overrides: Partial<LocalModelsApi> = {}) {
  const profile = { connectionId: LOCAL_CONNECTION_ID, model: 'fixture', temperature: .6, topP: .9, maxTokens: 2048 }
  const settings: AiSettings = { version: 3, connections: [], apiKeyConfigured: false, routingMode: 'shared', shared: profile,
    tasks: { outline: { ...profile }, chapterOutline: { ...profile }, prose: { ...profile }, review: { ...profile } } }
  const originalSettings = structuredClone(settings), changes: string[][] = []
  const api: LocalModelsApi = { list: async () => structuredClone(rows), inspect: async () => row(), install: async () => row(), cancel: async () => true, ...overrides }
  let state!: ReturnType<typeof useLocalModels>, inspectCard!: () => Promise<void>
  const Card = Vue.defineComponent({
    props: { model: { type: Object as Vue.PropType<LocalModelView>, required: true }, stopOperation: Object as Vue.PropType<Pick<LocalModelView, 'id' | 'operationId' | 'operation'>> },
    setup(props) {
      const instance = Vue.getCurrentInstance()!; inspectCard = () => instance.vnode.props!.onInspect()
      return () => Vue.h('article', { 'data-model-id': props.model.id, 'data-stop-id': props.stopOperation?.operationId })
    }
  })
  // Keep real component/composable lifecycles; unrelated DOM form directives
  // are covered by the native catalog checks, not this in-memory renderer.
  const component = loadComponent({ ...Vue, vModelText: {}, vModelSelect: {} }, (api: LocalModelsApi) => { state = useLocalModels(api); return state }, LOCAL_CONNECTION_ID, Card)
  type Node = { children: Node[]; parent?: Node; text: string; props: Record<string, unknown>; focus(): void }
  const node = (text = ''): Node => ({ children: [], text, props: {}, focus() {} })
  const renderer = Vue.createRenderer<Node, Node>({
    createElement: () => node(), createText: node, createComment: () => node(),
    setText: (target, text) => { target.text = text },
    setElementText: (target, text) => { target.text = text; target.children = [] },
    patchProp: (target, key, _previous, value) => { target.props[key] = value },
    insert(child, parent, anchor) {
      if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
      child.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
    },
    remove(child) { if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1) },
    parentNode: child => child.parent || null,
    nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] || null
  })
  const app = renderer.createApp(component, { api, settings, onChanged: () => changes.push(state.models.value.filter(m => m.state === 'ready').map(m => m.id)) })
  const root = node(); app.mount(root); await setImmediate()
  const flatten = (target: Node): Node[] => [target, ...target.children.flatMap(flatten)]
  const find = (id: string) => flatten(root).find(n => n.props['data-testid'] === id)
  const text = (target?: Node) => target ? flatten(target).map(n => n.text).join('') : ''
  return { api, state, changes, settings, originalSettings, inspectCard: () => inspectCard(), unmount: () => app.unmount(),
    text: (id: string) => text(find(id)),
    activeBanner: () => {
      const banner = flatten(root).find(n => String(n.props.class || '').includes('store-active'))
      return { text: text(banner), disabled: banner && flatten(banner).find(n => n.props.onClick)?.props.disabled }
    },
    stopFromBanner: () => {
      const banner = flatten(root).find(n => String(n.props.class || '').includes('store-active'))
      const button = banner && flatten(banner).find(n => n.props.onClick)
      assert.ok(button); assert.notEqual(button.props.disabled, true)
      return (button.props.onClick as () => Promise<void>)()
    },
    cardStopId: (id: string) => flatten(root).find(n => n.props['data-model-id'] === id)?.props['data-stop-id'],
    cardIds: () => flatten(root).filter(n => n.props['data-model-id']).map(n => n.props['data-model-id']),
    click: async (id: string) => { const target = find(id); assert.ok(target, `missing ${id}`); (target.props.onClick as () => void)(); await Vue.nextTick() },
    control: async (label: string, value: string) => { const target = flatten(root).find(n => n.props['aria-label'] === label); assert.ok(target, `missing ${label}`); (target.props['onUpdate:modelValue'] as (value: string) => void)(value); await Vue.nextTick() },
    publish: async (next: LocalModelView[]) => { rows = next; await state.refresh(); await setImmediate() } }
}

test('a successor banner remains stoppable while an earlier stop refresh is held', async t => {
  const slow = deferred<LocalModelView[]>(), nextStop = deferred<boolean>(), calls: string[][] = []
  const f = await mount([row({ state: 'downloading', operation: 'install', operationId: 'old-operation' })], {
    cancel: async (id, operation) => { calls.push([id, operation]); return operation === 'old-operation' ? true : nextStop.promise }
  }); t.after(() => { f.unmount(); slow.resolve([]); nextStop.resolve(false) })
  f.api.list = () => slow.promise; const previous = f.stopFromBanner(); await setImmediate()
  assert.match(f.activeBanner().text, /正在停止/); assert.equal(f.activeBanner().disabled, true)
  f.api.list = async () => [row({ id: 'second', name: '另一型号', state: 'checking', operation: 'inspect', operationId: 'new-operation' })]
  await f.state.refresh(); await Vue.nextTick()
  assert.match(f.activeBanner().text, /另一型号.*停止检测/); assert.equal(f.activeBanner().disabled, false)
  const next = f.stopFromBanner(); await Vue.nextTick()
  assert.match(f.activeBanner().text, /正在停止/); assert.equal(f.activeBanner().disabled, true)
  slow.resolve([row({ state: 'cancelled', operation: 'install' })]); await previous; await Vue.nextTick()
  assert.match(f.activeBanner().text, /另一型号.*正在停止/); assert.equal(f.activeBanner().disabled, true)
  f.api.list = async () => [row({ id: 'second', state: 'cancelled', operation: 'inspect' })]
  nextStop.resolve(true); await next; await Vue.nextTick()
  assert.equal(f.activeBanner().text, '')
  assert.deepEqual(calls, [['fixture', 'old-operation'], ['second', 'new-operation']])
  assert.deepEqual(f.settings, f.originalSettings)
})

test('first successful catalog synchronizes availability, including an empty catalog', async () => {
  for (const rows of [[], [row()], [row({ state: 'ready' })]]) {
    const f = await mount(rows)
    try { assert.equal(f.changes.length, 1); assert.deepEqual(f.settings, f.originalSettings) }
    finally { f.unmount() }
  }
})
test('background install completion, readiness loss and recovery synchronize without changing assignments', async t => {
  const f = await mount([row()]); t.after(f.unmount); f.changes.length = 0
  await f.publish([row({ state: 'downloading', operation: 'install', progress: 42 })])
  assert.equal(f.changes.length, 0)
  await f.publish([row({ state: 'ready', operation: 'install' })])
  assert.deepEqual(f.changes, [['fixture']])
  await f.publish([row({ state: 'failed', operation: 'inspect' })])
  await f.publish([row({ state: 'ready', operation: 'inspect' })])
  assert.deepEqual(f.changes, [['fixture'], [], ['fixture']])
  assert.deepEqual(f.settings, f.originalSettings)
})
test('stable polls, reordering and progress changes do not repeat the parent refresh', async t => {
  const f = await mount([row({ state: 'ready' }), row({ id: 'second' })]); t.after(f.unmount); f.changes.length = 0
  await f.publish([row({ id: 'second', state: 'downloading', progress: 10 }), row({ state: 'ready' })])
  await f.publish([row({ state: 'ready', message: '新提示' }), row({ id: 'second', state: 'downloading', progress: 90 })])
  await f.state.refresh(); await setImmediate()
  assert.equal(f.changes.length, 0)
})
test('same ready count with another identity or revision still refreshes availability', async t => {
  const f = await mount([row({ state: 'ready' })]); t.after(f.unmount); f.changes.length = 0
  await f.publish([row({ id: 'second', state: 'ready' })])
  await f.publish([row({ id: 'second', state: 'ready', revision: 'revision-two' })])
  assert.equal(f.changes.length, 2)
})
test('read failure and recovery each synchronize once, even without a ready model', async t => {
  const f = await mount([row()]); t.after(f.unmount); f.changes.length = 0
  f.api.list = async () => { throw Error('fixture read error') }
  await f.state.refresh(); await f.state.refresh(); await setImmediate()
  assert.equal(f.changes.length, 1)
  f.api.list = async () => [row()]
  await f.state.refresh(); await f.state.refresh(); await setImmediate()
  assert.equal(f.changes.length, 2)
})
test('a stale read cannot notify a false readiness change', async t => {
  const f = await mount([row({ state: 'ready' })]); t.after(f.unmount); f.changes.length = 0
  const slow = deferred<LocalModelView[]>(); f.api.list = () => slow.promise
  const old = f.state.refresh()
  f.api.list = async () => [row({ state: 'ready' })]; await f.state.refresh()
  slow.resolve([row()]); await old; await setImmediate()
  assert.equal(f.changes.length, 0)
})
test('manual inspection uses the same notification path without a duplicate completion event', async t => {
  const f = await mount([row()]); t.after(f.unmount); f.changes.length = 0
  f.api.inspect = async () => row({ state: 'ready' }); f.api.list = async () => [row({ state: 'ready' })]
  await f.inspectCard(); await setImmediate()
  assert.deepEqual(f.changes, [['fixture']])
})
test('leaving the store during inspection never notifies a later page', async () => {
  const pending = deferred<LocalModelView>(), f = await mount([row()], { inspect: () => pending.promise })
  f.changes.length = 0
  const checking = f.inspectCard(); f.unmount()
  pending.resolve(row({ state: 'ready' })); await checking; await setImmediate()
  assert.equal(f.changes.length, 0)
})

test('scope counts and visible rows distinguish ready, attention, uninstalled and active states', async t => {
  const states = ['not-installed', 'detected', 'downloading', 'verifying', 'installing', 'checking', 'ready', 'failed', 'cancelled', 'interrupted'] as const
  const f = await mount(states.map(state => row({ id: state, state }))); t.after(f.unmount); f.changes.length = 0
  assert.match(f.text('model-scope-all'), /全部模型\s*10/)
  assert.match(f.text('model-scope-ready'), /本机可用\s*1/)
  assert.match(f.text('model-scope-attention'), /待处理\s*4/)
  await f.click('model-scope-ready'); assert.deepEqual(f.cardIds(), ['ready'])
  await f.click('model-scope-attention'); assert.deepEqual(f.cardIds(), ['detected', 'failed', 'cancelled', 'interrupted'])
  await f.click('model-scope-all'); assert.equal(f.cardIds().length, 10)
  assert.equal(f.changes.length, 0); assert.deepEqual(f.settings, f.originalSettings)
})
test('scope composes with search, family and ordering, while reset restores the full catalog', async t => {
  const f = await mount([
    row({ id: 'glm-ready', name: 'GLM', family: 'GLM', state: 'ready', bytes: 30 }),
    row({ id: 'qwen-large', name: 'Qwen large', state: 'ready', bytes: 20 }),
    row({ id: 'qwen-small', name: 'Qwen small', state: 'ready', bytes: 10 }),
    row({ id: 'qwen-failed', state: 'failed' })
  ]); t.after(f.unmount); f.changes.length = 0
  await f.click('model-scope-ready'); await f.control('筛选模型系列', 'Qwen'); await f.control('模型排列方式', 'size')
  assert.deepEqual(f.cardIds(), ['qwen-small', 'qwen-large'])
  await f.control('搜索模型', ' small '); assert.deepEqual(f.cardIds(), ['qwen-small'])
  assert.match(f.text('model-scope-ready'), /本机可用\s*3/, 'tab count is the full scope, not the search count')
  await f.control('搜索模型', '不存在'); assert.equal(f.cardIds().length, 0)
  await f.click('reset-model-filters'); assert.equal(f.cardIds().length, 4)
  assert.equal(f.changes.length, 0)
})
test('visible filter summary resets matching results without preparation, assignment or order changes', async t => {
  const calls: string[] = []
  const f = await mount([row({ id: 'large', name: 'Large', bytes: 8, state: 'ready' }), row({ id: 'small', name: 'Small', bytes: 1, family: 'GLM' })], {
    install: async () => { calls.push('install'); return row() },
    inspect: async () => { calls.push('inspect'); return row() },
    cancel: async () => { calls.push('cancel'); return true }
  }); t.after(f.unmount); f.changes.length = 0
  assert.equal(f.text('model-filter-summary'), '')
  await f.control('模型排列方式', 'size')
  await f.click('model-scope-ready'); await f.control('筛选模型系列', 'Qwen'); await f.control('搜索模型', '  Large  ')
  assert.deepEqual(f.cardIds(), ['large'])
  assert.match(f.text('model-filter-summary'), /本机可用.*Qwen.*Large/)
  await f.click('clear-model-filters')
  assert.equal(f.text('model-filter-summary'), '')
  assert.deepEqual(f.cardIds(), ['small', 'large'], 'the chosen size order survives reset')
  assert.deepEqual(calls, []); assert.deepEqual(f.changes, [])
  assert.deepEqual(f.settings, f.originalSettings)
})

test('current scope follows ready loss and recovery instead of retaining stale rows', async t => {
  const f = await mount([row({ state: 'ready' })]); t.after(f.unmount)
  await f.click('model-scope-ready')
  await f.publish([row({ state: 'failed' })]); assert.deepEqual(f.cardIds(), [])
  assert.match(f.text('model-scope-ready'), /本机可用\s*0/)
  assert.match(f.text('model-scope-attention'), /待处理\s*1/)
  await f.click('model-scope-attention'); assert.deepEqual(f.cardIds(), ['fixture'])
  await f.publish([row({ state: 'ready' })]); assert.deepEqual(f.cardIds(), [])
  await f.click('model-scope-ready'); assert.deepEqual(f.cardIds(), ['fixture'])
})
test('loading and failed reads show unknown counts; a successful empty result alone shows zero', async t => {
  const first = deferred<LocalModelView[]>(), f = await mount([], { list: () => first.promise }); t.after(f.unmount)
  for (const id of ['all', 'ready', 'attention']) assert.match(f.text('model-scope-' + id), /—/)
  assert.match(f.text('model-store-count'), /正在读取/)
  first.resolve([]); await setImmediate()
  for (const id of ['all', 'ready', 'attention']) assert.match(f.text('model-scope-' + id), /0/)
  assert.match(f.text('model-store-count'), /0.*个型号可选/)
  f.api.list = async () => { throw Error('read error') }; await f.state.refresh(); await Vue.nextTick()
  for (const id of ['all', 'ready', 'attention']) assert.match(f.text('model-scope-' + id), /—/)
  assert.match(f.text('model-store-count'), /目录暂不可用/)
  assert.equal(f.text('reset-model-filters'), '')
  f.api.list = async () => [row({ state: 'ready' })]; await f.state.refresh(); await Vue.nextTick()
  assert.match(f.text('model-scope-ready'), /本机可用\s*1/)
})

for (const action of ['install', 'inspect'] as const) {
  test(`pending ${action} banner hides old progress until the actual operation arrives`, async t => {
    const pending = deferred<LocalModelView>(), calls: string[][] = []
    const stale = row({ state: 'cancelled', operation: action === 'install' ? 'inspect' : 'install', progress: 100, message: '上一轮完成' })
    const f = await mount([stale], { [action]: () => pending.promise, cancel: async (id, operation) => { calls.push([id, operation]); return true } }); t.after(f.unmount)
    const operation = f.state[action]('fixture'); await setImmediate()
    assert.match(f.activeBanner().text, /正在确认准备状态…/)
    assert.match(f.activeBanner().text, /等待状态…/)
    assert.doesNotMatch(f.activeBanner().text, /上一轮完成|100%|停止安装|停止检测/)
    assert.equal(f.activeBanner().disabled, true)
    await f.state.cancel(); assert.deepEqual(calls, [])
    const active = row({ state: action === 'install' ? 'downloading' : 'checking', operation: action, operationId: 'actual-operation', progress: 42, message: '当前操作' })
    await f.publish([active])
    assert.match(f.activeBanner().text, /当前操作 · 42%/)
    assert.match(f.activeBanner().text, new RegExp(action === 'install' ? '停止安装' : '停止检测'))
    assert.equal(f.activeBanner().disabled, false)
    await f.state.cancel(); assert.deepEqual(calls, [['fixture', 'actual-operation']])
    await f.publish([row({ state: 'ready' })]); pending.resolve(row({ state: 'ready' })); await operation; await setImmediate()
    assert.equal(f.activeBanner().text, '')
    assert.deepEqual(f.settings, f.originalSettings)
  })
}

test('unreadable progress retains an explicit stop banner without stale cards or assignment changes', async t => {
  const calls: string[][] = [], pending = deferred<boolean>()
  const active = row({ state: 'downloading', operation: 'install', operationId: 'observed-operation', progress: 42, message: '旧下载进度' })
  const f = await mount([active, row({ id: 'ready-model', state: 'ready' })], {
    cancel: async (id, operation) => { calls.push([id, operation]); return pending.promise }
  }); t.after(f.unmount)
  await f.click('model-scope-ready'); f.changes.length = 0
  f.api.list = async () => { throw Error('read failed') }; await f.state.refresh(); await Vue.nextTick()
  assert.deepEqual(f.cardIds(), []); assert.match(f.text('model-scope-ready'), /—/)
  assert.match(f.activeBanner().text, /Fixture.*状态暂时无法读取，仍可尝试停止本次准备。.*停止安装/)
  assert.doesNotMatch(f.activeBanner().text, /42%|旧下载进度/); assert.equal(f.activeBanner().disabled, false)
  const stopped = f.state.cancel(); await Vue.nextTick()
  assert.match(f.activeBanner().text, /正在停止…/); assert.equal(f.activeBanner().disabled, true)
  pending.resolve(true); await stopped; await Vue.nextTick()
  assert.match(f.activeBanner().text, /状态暂时无法读取/); assert.doesNotMatch(f.activeBanner().text, /已停止/)
  assert.deepEqual(calls, [['fixture', 'observed-operation']]); assert.deepEqual(f.changes, [[]])
  f.api.list = async () => [row({ state: 'cancelled' }), row({ id: 'ready-model', state: 'ready' })]
  await f.state.refresh(); await Vue.nextTick()
  assert.equal(f.activeBanner().text, ''); assert.deepEqual(f.cardIds(), ['ready-model'])
  assert.deepEqual(f.settings, f.originalSettings)
})

test('a rejected stop remains retryable during read failure and false stop removes only its banner', async t => {
  const f = await mount([row({ state: 'checking', operation: 'inspect', operationId: 'observed-operation' })], {
    cancel: async () => { throw { code: 'CONFLICT', message: '不能停止其他窗口的模型准备。' } }
  }); t.after(f.unmount)
  f.api.list = async () => { throw Error('unreadable') }; await f.state.refresh(); await f.state.cancel(); await Vue.nextTick()
  assert.match(f.text('local-model-action-error'), /不能停止其他窗口/)
  assert.match(f.activeBanner().text, /停止检测/); assert.equal(f.activeBanner().disabled, false)
  assert.match(f.state.error.value, /暂时无法读取/)
  f.api.cancel = async () => false; await f.state.cancel(); await Vue.nextTick()
  assert.equal(f.activeBanner().text, ''); assert.deepEqual(f.cardIds(), [])
  assert.match(f.state.error.value, /暂时无法读取/); assert.deepEqual(f.settings, f.originalSettings)
})

test('acknowledged install keeps a stop banner when its first status read fails without publishing receipt progress', async t => {
  const calls: string[][] = []
  const f = await mount([row({ state: 'cancelled', operation: 'inspect', progress: 100, message: '上一轮检测结束' })], {
    install: async () => row({ state: 'verifying', operation: 'install', operationId: 'acknowledged-operation', progress: 12, message: '启动回执阶段' }),
    cancel: async (id, operation) => { calls.push([id, operation]); return true }
  }); t.after(f.unmount)
  f.api.list = async () => { throw Error('first active status unavailable') }
  await f.state.install('fixture'); await Vue.nextTick()
  assert.deepEqual(f.cardIds(), []); assert.match(f.text('model-scope-all'), /—/)
  assert.match(f.activeBanner().text, /Fixture.*状态暂时无法读取.*停止安装/)
  assert.doesNotMatch(f.activeBanner().text, /100%|12%|上一轮检测|启动回执阶段/)
  assert.equal(f.activeBanner().disabled, false); assert.equal(f.text('local-model-action-error'), '')
  await f.state.cancel(); assert.deepEqual(calls, [['fixture', 'acknowledged-operation']])
  assert.deepEqual(f.settings, f.originalSettings)
  f.api.list = async () => [row({ state: 'cancelled', operation: 'install' })]; await f.state.refresh(); await Vue.nextTick()
  assert.equal(f.activeBanner().text, ''); assert.deepEqual(f.cardIds(), ['fixture'])
})

test('start acknowledgement enables matching stop controls before a slow list returns progress', async t => {
  const slow = deferred<LocalModelView[]>()
  const f = await mount([row({ state: 'cancelled', operation: 'inspect', progress: 100, message: '上一轮检测' }), row({ id: 'other' })], {
    install: async () => row({ state: 'verifying', operation: 'install', operationId: 'acknowledged-operation', progress: 12, message: '回执进度' })
  }); t.after(() => { f.unmount(); slow.resolve([]) })
  f.api.list = () => slow.promise; const pending = f.state.install('fixture'); await setImmediate()
  assert.match(f.activeBanner().text, /正在确认准备状态….*停止安装/)
  assert.equal(f.activeBanner().disabled, false)
  assert.doesNotMatch(f.activeBanner().text, /上一轮检测|回执进度|100%|12%|停止检测/)
  assert.equal(f.cardStopId('fixture'), 'acknowledged-operation'); assert.equal(f.cardStopId('other'), undefined)
  assert.equal(f.state.models.value[0].operationId, undefined, 'receipt must not rewrite the old catalog DTO')
  await f.control('搜索模型', 'other'); assert.deepEqual(f.cardIds(), ['other'])
  assert.equal(f.activeBanner().disabled, false)
  slow.resolve([row({ state: 'downloading', operation: 'install', operationId: 'acknowledged-operation', progress: 42, message: '实际进度' }), row({ id: 'other' })])
  await pending; await Vue.nextTick()
  assert.match(f.activeBanner().text, /实际进度 · 42%/)
  assert.deepEqual(f.settings, f.originalSettings)
})

test('the acknowledged banner stops immediately and an older delayed list cannot restore that operation', async t => {
  const slow = deferred<LocalModelView[]>(), stopped = deferred<boolean>(), calls: string[][] = []
  const f = await mount([row()], { install: async () => row({ state: 'verifying', operation: 'install', operationId: 'acknowledged-operation' }),
    cancel: async (id, operation) => { calls.push([id, operation]); return stopped.promise } })
  t.after(() => { f.unmount(); slow.resolve([]); stopped.resolve(true) })
  f.api.list = () => slow.promise; const pending = f.state.install('fixture'); await setImmediate()
  const cancelling = f.stopFromBanner(); await Vue.nextTick()
  assert.match(f.activeBanner().text, /正在停止…/); assert.equal(f.activeBanner().disabled, true)
  await f.state.cancel(); assert.deepEqual(calls, [['fixture', 'acknowledged-operation']])
  f.api.list = async () => [row({ state: 'cancelled', operation: 'install' })]
  stopped.resolve(true); await cancelling; await Vue.nextTick()
  assert.equal(f.activeBanner().text, '', 'confirmed stop must remove pending presentation before the old read returns')
  slow.resolve([row({ state: 'downloading', operation: 'install', operationId: 'acknowledged-operation', progress: 42 })]); await pending; await Vue.nextTick()
  assert.equal(f.activeBanner().text, ''); assert.equal(f.state.models.value[0].state, 'cancelled')
  assert.deepEqual(f.settings, f.originalSettings)
})
