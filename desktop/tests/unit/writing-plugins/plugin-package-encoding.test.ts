import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import JSZip from 'jszip'
import { PluginPackageStore, readPluginZipFile } from '../../../src/main/modules/writing-plugins/adapters/package-store'
import { WritingPluginManager } from '../../../src/main/modules/writing-plugins/application/plugin-manager'
import { PluginAuthoringService } from '../../../src/main/modules/writing-plugins/application/authoring-service'
import { PluginDraftStore } from '../../../src/main/modules/writing-plugins/adapters/draft-store'
import { buildPluginDraft } from '../../../src/main/modules/writing-plugins/adapters/draft-builder'

const schema = { type: 'object', additionalProperties: false, properties: {} }
const manifest = { apiVersion: 1, id: 'author.encoding', name: '编码兼容流程', description: '保留中文和文件标记', version: '1.0.0', runtime: 'declarative', entry: 'recipe.json', capabilities: [], tools: [{ id: 'echo', description: '返回原文', effect: 'derive', capabilities: [], inputSchema: schema, outputSchema: { ...schema, properties: { text: { type: 'string', maxLength: 100 } }, required: ['text'] } }], assets: ['notes.txt'] }
const recipe = { format: 1, tools: [{ id: 'echo', steps: [], result: { text: '中文中间\ufeff字符也要保留。' } }] }
async function fixture(t: TestContext, manifestBom: boolean, recipeBom: boolean) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-package-encoding-')))
  t.after(async () => {
    const checked = await realpath(root)
    assert.equal(dirname(checked), await realpath(tmpdir())); assert.ok(basename(checked).startsWith('lanjian-package-encoding-'))
    await rm(checked, { recursive: true, force: false })
  })
  const original = new Map([
    ['lanjian-plugin.json', Buffer.from((manifestBom ? '\ufeff' : '') + JSON.stringify(manifest))],
    ['recipe.json', Buffer.from((recipeBom ? '\ufeff' : '') + JSON.stringify(recipe))],
    ['notes.txt', Buffer.from('\ufeff第一行\r\n保留\ufeff第二行\r\n')]
  ])
  const zip = new JSZip(); for (const [path, bytes] of original) zip.file(path, bytes)
  const bytes = await zip.generateAsync({ type: 'nodebuffer' }), path = join(root, 'original.zip')
  await writeFile(path, bytes)
  const packages = new PluginPackageStore(root), manager = new WritingPluginManager(packages, async () => {})
  return { root, path, bytes, original, packages, manager }
}

for (const [manifestBom, recipeBom] of [[false, false], [true, false], [false, true], [true, true]]) {
  test(`preview → install → fresh store preserves exact bytes (manifest BOM ${manifestBom}, recipe BOM ${recipeBom})`, async t => {
    const f = await fixture(t, manifestBom!, recipeBom!), preview = await f.manager.preview(f.manager.chooseNativeFile(f.path))
    const index = await f.manager.install(preview.planId), plugin = index.plugins[0]!, version = plugin.versions[0]!
    assert.equal(version.digest, preview.digest); assert.equal(plugin.enabled, false)
    assert.deepEqual(version.grants, []); assert.deepEqual(index.books, [])
    const restored = new PluginPackageStore(f.root), loaded = await restored.load(version)
    assert.deepEqual(loaded, f.original); assert.deepEqual(await restored.read(), index)
    assert.deepEqual(await readFile(f.path), f.bytes)
    const again = await f.manager.preview(f.manager.chooseNativeFile(f.path))
    assert.deepEqual(await f.manager.install(again.planId), index)
  })
}

test('BOM package copies to a fresh personal draft, builds and installs without changing entry or assets', async t => {
  const f = await fixture(t, true, true), store = new PluginDraftStore(f.root)
  const service = new PluginAuthoringService(store, {
    build: buildPluginDraft, persist: b => store.persist(b), choosePackage: () => readPluginZipFile(f.path),
    chooseExport: async () => null, chooseSource: async () => null, installed: async () => { throw new Error('Must copy before installation') }
  }, f.manager)
  const copy = await service.importPackage(); assert.ok(copy)
  assert.notEqual(copy.pluginId, manifest.id)
  assert.deepEqual(copy.upstream, { pluginId: manifest.id, version: manifest.version, digest: (await readPluginZipFile(f.path)).digest })
  assert.deepEqual((await f.manager.list()).plugins, [])
  for (const file of copy.files) assert.deepEqual(Buffer.from(file.content), f.original.get(file.path))
  const preview = await service.preview({ id: copy.id, revision: copy.revision })
  const index = await f.manager.install(preview.planId), installed = index.plugins[0]!.versions[0]!
  const loaded = await new PluginPackageStore(f.root).load(installed)
  assert.equal(installed.manifest.id, copy.pluginId)
  for (const file of copy.files) assert.deepEqual(loaded.get(file.path), f.original.get(file.path))
  assert.deepEqual(await new PluginDraftStore(f.root).list(), [copy]); assert.deepEqual(await readFile(f.path), f.bytes)
})

test('BOM tolerance does not admit invalid UTF-8, repeated markers, UTF-16 or malformed recipes', async t => {
  const f = await fixture(t, true, true)
  for (const [path, bytes] of [
    ['lanjian-plugin.json', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf, 0xff]), Buffer.from(JSON.stringify(manifest))])],
    ['recipe.json', Buffer.from('\ufeff\ufeff' + JSON.stringify(recipe))],
    ['recipe.json', Buffer.from('\ufeff' + JSON.stringify(recipe), 'utf16le')],
    ['recipe.json', Buffer.from('\ufeff{"format":1,"tools":[]}')]
  ] as const) {
    const zip = await JSZip.loadAsync(f.bytes); zip.file(path, bytes)
    await writeFile(join(f.root, 'invalid.zip'), await zip.generateAsync({ type: 'nodebuffer' }))
    await assert.rejects(f.manager.preview(f.manager.chooseNativeFile(join(f.root, 'invalid.zip'))), { code: 'VALIDATION_ERROR' })
    assert.deepEqual((await f.manager.list()).plugins, [])
  }
  assert.deepEqual(await readFile(f.path), f.bytes)
})

test('removing a BOM from installed bytes still fails the original digest check and preserves evidence', async t => {
  const f = await fixture(t, true, true), index = await f.manager.install((await f.manager.preview(f.manager.chooseNativeFile(f.path))).planId)
  const version = index.plugins[0]!.versions[0]!, file = join(f.root, 'plugin-packages', manifest.id, `${manifest.version}-${version.digest}`, 'recipe.json')
  const changed = f.original.get('recipe.json')!.subarray(3); await writeFile(file, changed)
  await assert.rejects(new PluginPackageStore(f.root).load(version), { code: 'STORAGE_ERROR' })
  assert.deepEqual(await readFile(file), changed); assert.deepEqual(await f.packages.read(), index)
  assert.deepEqual(await readFile(f.path), f.bytes)
})
