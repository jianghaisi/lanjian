import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { validateValue, type JsonObject, type JsonValue } from '@lanjian/writing-plugin-contracts'
import { bundledPluginSources } from '../../../src/main/modules/writing-plugins/domain/bundled-plugins'
import { buildPluginContent, buildPluginDraft } from '../../../src/main/modules/writing-plugins/adapters/draft-builder'
import { bundledPackagePorts } from '../../../src/main/modules/writing-plugins/adapters/bundled-packages'
import { PluginDraftStore } from '../../../src/main/modules/writing-plugins/adapters/draft-store'
import { PluginPackageStore } from '../../../src/main/modules/writing-plugins/adapters/package-store'
import { PluginAuthoringService } from '../../../src/main/modules/writing-plugins/application/authoring-service'
import { BundledPluginService } from '../../../src/main/modules/writing-plugins/application/bundled-service'
import { WritingPluginManager } from '../../../src/main/modules/writing-plugins/application/plugin-manager'
import { executeGuest } from '../../../src/main/modules/writing-plugins/runtime/guest-engine'
import type { GuestBroker } from '../../../src/main/modules/writing-plugins/domain/guest'

const built = Promise.all(bundledPluginSources().map(buildPluginContent))
const wasm = readFile(createRequire(import.meta.url).resolve('@jitl/quickjs-wasmfile-release-sync/wasm')).then(b => new Uint8Array(b).buffer)
async function pkg(id: string) { const result = (await built).find(p => p.pkg.manifest.id === `lanjian.bundled.${id}`); assert.ok(result); return result.pkg }
async function run(id: string, input: JsonObject, broker: GuestBroker = async () => { throw Error('No host call allowed') }) {
  const p = await pkg(id), tool = p.manifest.tools[0]
  validateValue(tool.inputSchema, input)
  const result = await executeGuest({ invocationId: 'new-bundled', toolId: tool.id, source: new TextDecoder().decode(p.files.get('main.js')), input }, await wasm, broker, new AbortController().signal)
  if (result.ok) validateValue(tool.outputSchema, result.value)
  return result
}
function value(result: Awaited<ReturnType<typeof executeGuest>>) { assert.ok(result.ok, JSON.stringify(result)); return result.value as JsonObject }

test('new deterministic catalog preserves all eight immutable releases and carries portable upstream notices', async () => {
  const packages = await built
  assert.equal(packages.length, 16)
  assert.deepEqual(packages.slice(0, 8).map(p => p.pkg.digest), [
    '88500cd1cf078147195ed8a87c331b1140fa4e5a67279fc9435267ad910a0da7',
    '495bff9f842ca68e78bee9805bbad211c0be9284b0ed4bcbad8368698e6a7a80',
    '3db22b6f703c77ecada2fcc1b573adaca1aaeaf6bba1768f19734b4a151b9a07',
    'eac106bff83e4993a39843d702a6b688e5298f773ba2ee4795997f26391d32ee',
    '08a60ee959b2fdacb651d202eb6fc974c1c14c3d67e934e668310f778e6beaa1',
    'a1f8711a051581f4689cab5fd984c71257b097b962e4bef5a74eb151ce414b28',
    '3b79298679827015b767d8096603ecdeb18d95cee05640ba9c6edfafd3d6d334',
    'ea5d8e61c04be2e8da6c6174c63d8b759299c70a6f287b61b15f596e8d9b478a'
  ])
  for (const { pkg: p } of packages.slice(8, 13)) {
    assert.equal(p.manifest.tools.length, 1); assert.equal(p.manifest.tools[0].effect, 'derive')
    assert.deepEqual(p.manifest.assets, ['NOTICE.txt'])
    assert.match(new TextDecoder().decode(p.files.get('NOTICE.txt')), /MIT License/)
    assert.ok(p.files.get('main.js')!.length < 2 * 1024 * 1024)
  }
  const notice = new TextDecoder().decode((await pkg('chinese-conversion')).files.get('NOTICE.txt'))
  assert.match(notice, /Apache License/); assert.match(notice, /opencc-data/)
})

test('pure spacing guest preserves original Unicode, line endings and whitespace and makes no SDK request', async () => {
  const input = '主角获得10点EXP。\r\n\r\n保留🌙  '
  const result = value(await run('chinese-spacing', { text: input }))
  assert.equal(result.original, input); assert.equal(result.text, '主角获得 10 点 EXP。\r\n\r\n保留🌙  '); assert.equal(result.changed, true)
  assert.equal(value(await run('chinese-spacing', { text: result.text })).changed, false)
  assert.equal(value(await run('chinese-spacing', { text: '' })).text, '')
  assert.deepEqual((await pkg('chinese-spacing')).manifest.capabilities, [])
  const limit = '汉'.repeat(12000); assert.equal(value(await run('chinese-spacing', { text: limit })).original, limit)
  await assert.rejects(run('chinese-spacing', { text: limit + '汉' }))
})

test('actual OpenCC dictionaries distinguish character and regional phrase modes without network or model', async () => {
  const original = '头发发展，软件鼠标自行车。\r\n🌙  '
  for (const [mode, expected] of [
    ['to-traditional', '頭髮發展，軟件鼠標自行車。\r\n🌙  '],
    ['to-taiwan-phrases', '頭髮發展，軟體滑鼠腳踏車。\r\n🌙  '],
    ['to-hongkong', '頭髮發展，軟件鼠標自行車。\r\n🌙  ']
  ]) {
    const result = value(await run('chinese-conversion', { text: original, mode }))
    assert.equal(result.original, original); assert.equal(result.text, expected); assert.equal(result.changed, true)
  }
  assert.equal(value(await run('chinese-conversion', { text: '頭髮發展，軟體滑鼠。', mode: 'to-simplified' })).text, '头发发展，软体滑鼠。')
  assert.equal(value(await run('chinese-conversion', { text: '', mode: 'to-simplified' })).changed, false)
  assert.deepEqual((await pkg('chinese-conversion')).manifest.capabilities, [])
  for (const mode of ['__proto__', 'unknown', 'cn']) await assert.rejects(run('chinese-conversion', { text: original, mode }))
  await assert.rejects(run('chinese-conversion', { text: original, mode: 'to-traditional', path: 'private.txt' }))
})

function sources(model: (input: JsonObject) => JsonValue, calls: { method: string; input: JsonObject }[], changes: Record<string, string> = {}): GuestBroker {
  return async (method, input) => {
    const args = input as JsonObject; calls.push({ method, input: args })
    if (method === 'model.generate') return model(args)
    assert.equal(method, 'book.read')
    if (args.kind === 'context') return { context: changes.context ?? '人物甲、乙互不信任。境界须积累。系统模板：[任务]。' }
    if (args.kind === 'outline') return { key: args.key, content: changes[String(args.key)] ?? (args.key === 'total' ? '总纲：合作找回失物，关系缓慢改变。' : '章纲：雨夜在客栈相遇。'), revision: 'saved-outline-r1' }
    assert.equal(args.kind, 'manuscript'); assert.equal(args.chapterId, 7)
    return { chapterId: 7, title: '雨夜', content: changes.chapter ?? '甲说：“这是初次见面。”', revision: 'saved-chapter-r3' }
  }
}

test('romance and scene tools read actual saved hierarchy once, call the book model and only return suggestions', async () => {
  for (const [id, marker] of [['romance-arc', '关系转折'], ['scene-rhythm', '场景表']]) {
    const calls: { method: string; input: JsonObject }[] = []
    const result = value(await run(id, { outlineKey: 'stage-2', focus: '保留双方独立目标' }, sources(input => {
      assert.match(String(input.instruction), new RegExp(marker)); assert.match(String(input.instruction), /动态境界和固定系统/)
      for (const text of ['总纲：合作', '章纲：雨夜', '系统模板', '保留双方独立目标']) assert.ok(String(input.draft).includes(text))
      return { text: '合成规划建议，仅用于协议验证。', notice: '' }
    }, calls)))
    assert.equal(result.text, '合成规划建议，仅用于协议验证。'); assert.match(String(result.notice), /未写入/)
    assert.deepEqual(result.truncatedSources, [])
    assert.deepEqual(calls.map(c => [c.method, c.input.kind ?? 'model', c.input.key ?? '']), [['book.read', 'context', ''], ['book.read', 'outline', 'total'], ['book.read', 'outline', 'stage-2'], ['model.generate', 'model', '']])
  }
})

test('chapter audit grounds its request in selected saved prose and versions and does not invent a cold read', async () => {
  const calls: { method: string; input: JsonObject }[] = []
  const result = value(await run('chapter-consistency', { outlineKey: 'total', chapterId: 7, focus: '检查知情范围' }, sources(input => {
    assert.match(String(input.instruction), /不编造引文/); assert.match(String(input.instruction), /待核实/)
    assert.match(String(input.draft), /初次见面/); assert.match(String(input.draft), /saved-chapter-r3/)
    return { text: '待核实：已保存片段与总纲的初识关系。', notice: '' }
  }, calls)))
  assert.equal(calls.length, 4); assert.deepEqual(calls[2], { method: 'book.read', input: { kind: 'manuscript', chapterId: 7 } })
  assert.match(String(result.notice), /不代表已读全书/)
})

test('missing sources, invalid keys, empty or failed model results fail without later SDK calls or formal writes', async () => {
  const input = { outlineKey: 'total', focus: '' }
  let calls: { method: string; input: JsonObject }[] = []
  assert.equal((await run('scene-rhythm', input, sources(() => { throw Error('must not generate') }, calls, { total: '' }))).ok, false)
  assert.equal(calls.length, 2)
  calls = []
  assert.equal((await run('romance-arc', { ...input, outlineKey: '../other-book' }, sources(() => ({}), calls))).ok, false)
  assert.deepEqual(calls, [])
  const invalidOutputs: JsonValue[] = [{ text: '', notice: '' }, { text: '  ', notice: '' }, { notice: '' }]
  for (const output of invalidOutputs) {
    assert.equal((await run('scene-rhythm', input, sources(() => output, []))).ok, false)
  }
  assert.equal((await run('scene-rhythm', input, async () => { throw Error('Unavailable source') })).ok, false)
  await assert.rejects(run('chapter-consistency', { ...input, chapterId: 0 }))
  await assert.rejects(run('scene-rhythm', { ...input, bookId: 'other-book' }))
})

test('source and report ceilings are explicit and valid at maximum Chinese input sizes', async () => {
  const calls: { method: string; input: JsonObject }[] = []
  const result = value(await run('chapter-consistency', { outlineKey: 'stage-2', chapterId: 7, focus: '关'.repeat(2000) }, sources(input => {
    assert.ok(Buffer.byteLength(JSON.stringify(input)) < 128 * 1024)
    assert.match(String(input.draft), /材料已截断/)
    return { text: '报'.repeat(35000), notice: '' }
  }, calls, { context: '设'.repeat(9000), total: '总'.repeat(8000), 'stage-2': '章'.repeat(8000), chapter: '文'.repeat(13000) })))
  assert.equal((result.truncatedSources as JsonValue[]).length, 5)
  assert.ok(String(result.text).length <= 32000); assert.match(String(result.notice), /不能视为完整审校/)
})

test('new packages use real disabled installation and personal copy/rebuild retains exact sources and notices', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-new-bundled-')))
  const store = new PluginDraftStore(root), packages = new PluginPackageStore(root), manager = new WritingPluginManager(packages, async () => {})
  const authoring = new PluginAuthoringService(store, { build: buildPluginDraft, persist: b => store.persist(b), chooseExport: async () => null, choosePackage: async () => null, chooseSource: async () => null, installed: async () => { throw Error('Not used') } }, manager)
  const bundled = new BundledPluginService(bundledPackagePorts(root), manager, authoring)
  const entries = (await bundled.list()).slice(8, 13); assert.deepEqual(await readdir(root), [])
  for (const entry of entries) {
    const ref = { pluginId: entry.manifest.id, digest: entry.digest }
    const copy = await bundled.derive(ref), source = await pkg(entry.manifest.id.replace('lanjian.bundled.', ''))
    assert.notEqual(copy.pluginId, entry.manifest.id); assert.deepEqual(copy.upstream, { ...ref, version: '1.0.0' })
    for (const file of copy.files) assert.equal(file.content, new TextDecoder().decode(source.files.get(file.path)))
    await authoring.build({ id: copy.id, revision: copy.revision })
    const state = await manager.install((await bundled.preview(ref)).planId), installed = state.plugins.find(p => p.id === entry.manifest.id)!
    assert.equal(installed.enabled, false); assert.deepEqual(installed.versions[0].grants, []); assert.deepEqual(state.books, [])
  }
  assert.deepEqual((await bundled.list()).slice(8, 13), entries)
})
