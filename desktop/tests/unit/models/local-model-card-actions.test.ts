import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse, compileScript } from '@vue/compiler-sfc'
import { transformWithEsbuild } from 'vite'
import { renderToString } from '@vue/server-renderer'
import * as Vue from 'vue'
import type { LocalModelView } from '../../../src/contracts/models/local-model-contracts'

const source = await readFile(new URL('../../../src/renderer/features/models/components/LocalModelCard.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'model-card-actions', inlineTemplate: true }).content
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/g,
    (_, names: string) => `const { ${names.replace(/\s+as\s+/g, ': ')} } = Vue;`)
const compiled = await transformWithEsbuild(script, 'LocalModelCard.ts', { loader: 'ts' })
const component: Vue.Component = new Function('Vue', compiled.code.replace('export default', 'return'))(Vue)
const model: LocalModelView = {
  id: 'qwen3-1.7b-q8_0', name: 'Qwen3 1.7B', family: 'Qwen', description: '测试型号',
  revision: 'a'.repeat(40), bytes: 1800000000, quantization: 'Q8_0', license: 'Apache-2.0',
  state: 'failed', operation: 'inspect', capabilities: [], contextTokens: 8192,
  maxOutputTokens: 4096, recommendedOutputTokens: 2048, progress: 0,
  message: '检测未完成 <请重试>', canDownload: true, downloadBytes: 1000000, requiredDiskBytes: 2000000
}
const render = (patch: Partial<LocalModelView> = {}, props = {}) => renderToString(Vue.createSSRApp(component, {
  model: { ...model, ...patch }, active: false, preparing: false, assigned: '', target: 'prose', ...props
}))
const action = (html: string, kind: 'inspect' | 'install') => html.match(new RegExp(`<button[^>]*data-testid="${kind}-${model.id}"[^>]*>[\\s\\S]*?</button>`))?.[0]

for (const state of ['failed', 'cancelled', 'interrupted'] as const) {
  test(`${state} inspection offers a no-download retry before a separate explicit install`, async () => {
    const html = await render({ state })
    assert.match(action(html, 'inspect') || '', /重新检测/)
    assert.match(action(html, 'install') || '', /继续安装/)
    assert.ok(html.indexOf('inspect-' + model.id) < html.indexOf('install-' + model.id))
    assert.match(html, /重新检测不下载文件/)
    assert.match(html, /继续安装预计下载 1 MB · 需可用空间 2 MB/)
    assert.doesNotMatch(html, /assign-local-model/)
    assert.match(html, /检测未完成 &lt;请重试&gt;/)
  })
  test(`${state} installation still resumes installation`, async () => {
    const html = await render({ state, operation: 'install' })
    assert.match(action(html, 'install') || '', /继续安装/)
    assert.equal(action(html, 'inspect'), undefined)
    assert.doesNotMatch(html, /重新检测不下载文件/)
  })
}
test('inspection retry remains available without installation support', async () => {
  const html = await render({ canDownload: false })
  assert.match(action(html, 'inspect') || '', /重新检测/)
  assert.equal(action(html, 'install'), undefined)
  assert.match(html, /重新检测不下载文件/)
  assert.doesNotMatch(html, /预计下载|继续安装/)
})
test('busy and another preparation disable both recovery actions', async () => {
  for (const props of [{ busy: true }, { preparing: true }]) {
    const html = await render({}, props)
    assert.match(action(html, 'inspect') || '', /disabled/)
    assert.match(action(html, 'install') || '', /disabled/)
  }
})
test('active inspection exposes only its scoped stop control, including pending stop', async () => {
  const html = await render({ state: 'checking', operationId: 'a'.repeat(36) }, { active: true, preparing: true, stopping: true })
  assert.match(html, /<button[^>]*disabled[^>]*>正在停止…<\/button>/)
  assert.equal(action(html, 'inspect'), undefined)
  assert.equal(action(html, 'install'), undefined)
  assert.doesNotMatch(html, /重新检测不下载文件/)
})
test('ready and detected keep their existing detection and assignment rules', async () => {
  const ready = await render({ state: 'ready' })
  assert.match(action(ready, 'inspect') || '', /重新检测/)
  assert.match(ready, /assign-local-model/)
  assert.equal(action(ready, 'install'), undefined)
  const detected = await render({ state: 'detected' })
  assert.match(action(detected, 'inspect') || '', /检测并启用/)
  assert.doesNotMatch(detected, /assign-local-model/)
})
test('new and legacy records do not infer an inspection recovery from missing metadata', async () => {
  assert.match(action(await render({ operation: undefined }), 'install') || '', /继续安装/)
  const missing = await render({ state: 'not-installed', operation: 'inspect' })
  assert.match(action(missing, 'install') || '', /下载安装/)
  assert.equal(action(missing, 'inspect'), undefined)
})

for (const state of ['not-installed', 'ready', 'failed', 'cancelled'] as const) {
  test(`pending preparation from ${state} does not display the previous progress or stop type`, async () => {
    const html = await render({ state, operation: 'install', progress: 100, message: '上一轮完成', receivedBytes: 1000000, totalBytes: 1000000 }, { active: true, preparing: true })
    assert.match(html, /正在确认准备状态…/)
    assert.match(html, /data-state="pending"/)
    assert.match(html, /<button[^>]*disabled[^>]*>等待状态…<\/button>/)
    assert.match(html, /role="status"[^>]*>[\s\S]*?准备中<\/span>/)
    assert.doesNotMatch(html, /上一轮完成|100%|停止安装|停止检测|<progress|1 MB \/ 1 MB/)
  })
}
test('confirmed installation and inspection retain the exact reported phase, progress and stop action', async () => {
  for (const operation of ['install', 'inspect'] as const) {
    const html = await render({ state: operation === 'install' ? 'downloading' : 'checking', operation, operationId: 'b'.repeat(36), progress: 42, message: '当前操作', receivedBytes: 1000000, totalBytes: 2000000 }, { active: true, preparing: true })
    assert.match(html, /当前操作/); assert.match(html, /42%/); assert.match(html, /<progress[^>]*value="42"/)
    assert.match(html, /1 MB \/ 2 MB/)
    assert.match(html, new RegExp(operation === 'install' ? '停止安装' : '停止检测'))
    assert.doesNotMatch(html, /正在确认准备状态|等待状态/)
  }
})

test('a missing model without installation support explains its disabled action safely', async () => {
  const html = await render({ state: 'not-installed', canDownload: false, message: '当前环境暂不支持自动安装 <请检查环境>' })
  assert.match(html, /当前环境暂不支持自动安装 &lt;请检查环境&gt;/)
  assert.match(html, /<button[^>]*disabled[^>]*>暂不支持安装<\/button>/)
  assert.equal(action(html, 'inspect'), undefined); assert.equal(action(html, 'install'), undefined)
  assert.doesNotMatch(html, /assign-local-model|预计下载|需可用空间|检测并启用/)
})
test('an unverified but supported model still offers an enabled explicit download', async () => {
  const html = await render({ state: 'not-installed', canDownload: true, developmentStatus: 'unverified' })
  assert.match(html, /未开发实测/)
  assert.match(action(html, 'install') || '', /下载安装/)
  assert.doesNotMatch(action(html, 'install') || '', /disabled/)
  assert.doesNotMatch(html, /暂不支持安装/)
})
test('existing resources can be detected and ready models selected without automatic installation support', async () => {
  for (const state of ['detected', 'ready'] as const) {
    const html = await render({ state, canDownload: false })
    assert.ok(action(html, 'inspect')); assert.doesNotMatch(action(html, 'inspect')!, /disabled/)
    assert.equal(html.includes('assign-local-model'), state === 'ready')
    assert.doesNotMatch(html, /暂不支持安装/)
  }
})

test('an acknowledged stop is enabled while card progress still awaits its first matching status', async () => {
  const html = await render({ state: 'cancelled', operation: 'inspect', progress: 100, message: '上一轮检测结束', receivedBytes: 1000000, totalBytes: 1000000 }, {
    active: true, preparing: true, stopOperation: { id: model.id, operation: 'install', operationId: 'acknowledged-operation' }
  })
  const stop = html.match(/<button[^>]*>停止安装<\/button>/)?.[0]
  assert.ok(stop); assert.doesNotMatch(stop, /disabled/)
  assert.match(html, /data-state="pending"/); assert.match(html, /正在确认准备状态…/)
  assert.doesNotMatch(html, /100%|上一轮检测结束|停止检测|等待状态|<progress|1 MB \/ 1 MB/)
})

test('a different confirmed operation ID hides the old card progress and uses the new stop kind', async () => {
  const html = await render({ state: 'checking', operation: 'inspect', operationId: 'old-operation', progress: 93, message: '旧检测进度' }, {
    active: true, preparing: true, stopOperation: { id: model.id, operation: 'install', operationId: 'new-operation' }
  })
  assert.match(html, /正在确认准备状态…/); assert.match(html, /停止安装/)
  assert.doesNotMatch(html, /93%|旧检测进度|停止检测|<progress/)
})

test('stopping an acknowledged operation disables its card control while status is pending', async () => {
  const html = await render({}, { active: true, preparing: true, stopping: true,
    stopOperation: { id: model.id, operation: 'install', operationId: 'acknowledged-operation' } })
  assert.match(html, /<button[^>]*disabled[^>]*>正在停止…<\/button>/)
  assert.match(html, /正在确认准备状态…/)
  assert.doesNotMatch(html, /<progress/)
})

test('another model stop identity cannot enable this card waiting control', async () => {
  const html = await render({}, { active: true, preparing: true,
    stopOperation: { id: 'other-model', operation: 'install', operationId: 'other-operation' } })
  assert.match(html, /<button[^>]*disabled[^>]*>等待状态…<\/button>/)
  assert.doesNotMatch(html, /停止安装|停止检测/)
})
