import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import JSZip from 'jszip'
import { PluginAuthoringService } from '../../../src/main/modules/writing-plugins/application/authoring-service'
import { PluginMarketplaceService } from '../../../src/main/modules/writing-plugins/application/marketplace-service'
import { PluginCompositionService } from '../../../src/main/modules/writing-plugins/application/composition-service'
import { BundledPluginService } from '../../../src/main/modules/writing-plugins/application/bundled-service'
import { WritingPluginManager } from '../../../src/main/modules/writing-plugins/application/plugin-manager'
import { PluginDraftStore } from '../../../src/main/modules/writing-plugins/adapters/draft-store'
import { PluginPackageStore, readPluginZipFile } from '../../../src/main/modules/writing-plugins/adapters/package-store'
import { buildPluginContent, buildPluginDraft } from '../../../src/main/modules/writing-plugins/adapters/draft-builder'
import { bundledPackagePorts } from '../../../src/main/modules/writing-plugins/adapters/bundled-packages'
import { pluginDraftTemplate } from '../../../src/main/modules/writing-plugins/domain/draft-templates'
import { authoringResultDecoders, draftLimits, type DraftTemplate } from '../../../src/contracts/writing-plugins/authoring'
import { decodeNoArgs } from '../../../src/contracts/ipc'
import { createWritingPluginsBridge } from '../../../src/preload/writing-plugins-bridge'
import { workbench, data } from '../../helpers/plugin-workbench'

async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-package-copy-'))), storage = join(root, 'app')
  await mkdir(storage)
  const store = new PluginDraftStore(storage), manager = new WritingPluginManager(new PluginPackageStore(storage), async () => {})
  let selected: string | null = null, selections = 0, onPick = async () => {}
  const authoring = new PluginAuthoringService(store, { build: buildPluginDraft, persist: b => store.persist(b), chooseExport: async () => null, chooseSource: async () => null,
    choosePackage: async () => { selections++; await onPick(); return selected ? readPluginZipFile(selected) : null }, installed: async () => { throw new Error('Copy must not require installation') } }, manager)
  const ports = { authoring, manager, bundled: new BundledPluginService(bundledPackagePorts(storage), manager, authoring), market: new PluginMarketplaceService(authoring, manager, null), composition: new PluginCompositionService(manager), choosePackage: async () => null }
  async function source(template: DraftTemplate = 'code') {
    const content = pluginDraftTemplate('community.shared-plugin', template), manifest = JSON.parse(content.manifestText)
    manifest.version = '2.3.4'; manifest.assets = ['notes.txt']
    if (template === 'code') manifest.capabilities = ['host.future-capability']
    content.manifestText = JSON.stringify(manifest)
    content.files.push({ path: 'notes.txt', content: '\ufeff保留原始 BOM、标点和换行。\r\n' })
    if (template === 'code') content.files[0].content = `throw new Error('Source must remain data-only');\n${content.files[0].content}`
    const built = await buildPluginContent(content), path = join(root, `${template}.zip`)
    await writeFile(path, built.bytes)
    return { ...built, path, content }
  }
  return { root, storage, store, authoring, manager, ports, source, choose: (path: string | null) => { selected = path }, onPick: (fn: typeof onPick) => { onPick = fn }, selections: () => selections }
}

test('cancel is a zero-write read and the bridge exposes only the no-argument named operation', async () => {
  const f = await setup()
  assert.equal(await f.authoring.importPackage(), null); assert.deepEqual(await readdir(f.storage), [])
  assert.deepEqual(decodeNoArgs([]), []); assert.throws(() => decodeNoArgs([{ path: 'C:/author.zip' }]))
  assert.equal(authoringResultDecoders['writing-plugins:import-draft-package'](null), null)
  let called: unknown[] = []
  const bridge = createWritingPluginsBridge(async <T>(...args: unknown[]) => { called = args; return null as T })
  assert.equal(await bridge.importDraftPackage(), null); assert.deepEqual(called, ['writing-plugins:import-draft-package'])
})

test('all templates copy directly with fresh personal identity, exact files including BOM and direct upstream; no install or execution', async () => {
  const f = await setup()
  for (const template of ['context', 'workflow', 'code'] as const) {
    const source = await f.source(template); f.choose(source.path)
    const first = authoringResultDecoders['writing-plugins:import-draft-package'](await f.authoring.importPackage())!
    const second = (await f.authoring.importPackage())!
    assert.notEqual(first.id, second.id); assert.notEqual(first.pluginId, source.pkg.manifest.id)
    assert.equal(first.pluginId, `personal.${first.id}`); assert.equal(first.revision, 1)
    assert.deepEqual(first.upstream, { pluginId: source.pkg.manifest.id, version: '2.3.4', digest: source.pkg.digest })
    assert.deepEqual(first.files, source.content.files)
    assert.deepEqual(JSON.parse(first.manifestText), { ...source.pkg.manifest, id: first.pluginId, version: '1.0.0', name: `${source.pkg.manifest.name}（派生）` })
    const built = await f.authoring.validate({ id: first.id, revision: 1 }); assert.equal(built.manifest.id, first.pluginId)
    await f.authoring.save({ id: first.id, revision: 1, manifestText: first.manifestText, files: first.files.map(file => ({ ...file, content: file.content + '\n编辑个人副本' })) })
    assert.deepEqual(await readFile(source.path), source.bytes)
  }
  assert.deepEqual((await f.manager.list()).plugins, []); assert.deepEqual(await readdir(f.storage), ['plugin-drafts.json'])
  assert.equal((await f.authoring.list()).length, 6)
})

test('corrupt ZIP, missing/extra files and malformed declarations leave existing drafts and source bytes intact', async () => {
  const f = await setup(), existing = await f.authoring.create('context'), source = await f.source()
  const before = await readFile(join(f.storage, 'plugin-drafts.json')), broken = join(f.root, 'broken.zip')
  for (const change of ['corrupt', 'missing', 'capability', 'undeclared']) {
    const zip = await JSZip.loadAsync(source.bytes)
    if (change === 'missing') zip.remove('main.js')
    if (change === 'capability') zip.file('lanjian-plugin.json', JSON.stringify({ ...source.pkg.manifest, capabilities: ['bad capability'] }))
    if (change === 'undeclared') zip.file('private.txt', 'must not be copied')
    await writeFile(broken, change === 'corrupt' ? 'not a zip' : await zip.generateAsync({ type: 'nodebuffer' }))
    const original = await readFile(broken); f.choose(broken)
    await assert.rejects(f.authoring.importPackage(), { code: 'VALIDATION_ERROR' })
    assert.deepEqual(await readFile(broken), original); assert.deepEqual(await readFile(join(f.storage, 'plugin-drafts.json')), before)
  }
  assert.deepEqual(await f.authoring.list(), [existing]); assert.deepEqual((await f.manager.list()).plugins, [])
})

test('non-UTF-8 assets fail in the unchanged production package parser before creating a draft', async () => {
  const f = await setup(), source = await f.source(), zip = await JSZip.loadAsync(source.bytes)
  zip.file('notes.txt', new Uint8Array([0xff, 0x80, 0]))
  await writeFile(source.path, await zip.generateAsync({ type: 'nodebuffer' })); f.choose(source.path)
  await assert.rejects(readPluginZipFile(source.path), { code: 'VALIDATION_ERROR' })
  await assert.rejects(f.authoring.importPackage(), { code: 'VALIDATION_ERROR' })
  assert.deepEqual(await readdir(f.storage), [])
  assert.deepEqual((await f.manager.list()).plugins, []); assert.deepEqual(await f.authoring.list(), [])
})

test('valid large package and exhausted draft capacity fail before replacing draft storage', async () => {
  const f = await setup(), source = await f.source(), zip = await JSZip.loadAsync(source.bytes)
  const m = { ...source.pkg.manifest, assets: ['notes.txt', 'second.txt'] }
  zip.file('lanjian-plugin.json', JSON.stringify(m)); zip.file('notes.txt', 'a'.repeat(1700000)); zip.file('second.txt', 'b'.repeat(1700000))
  const large = join(f.root, 'large.zip'); await writeFile(large, await zip.generateAsync({ type: 'nodebuffer' })); f.choose(large)
  await readPluginZipFile(large)
  await assert.rejects(f.authoring.importPackage(), (error: unknown) => { assert.match((error as Error).message, /草稿的限制/); return true })
  assert.deepEqual(await readdir(f.storage), [])
  const original = await f.authoring.create('context')
  const full = Array.from({ length: draftLimits.count }, () => { const id = randomUUID(), pluginId = `personal.${id}`; return { ...original, id, pluginId, manifestText: JSON.stringify({ ...JSON.parse(original.manifestText), id: pluginId }) } })
  await writeFile(join(f.storage, 'plugin-drafts.json'), JSON.stringify(full)); const before = await readFile(join(f.storage, 'plugin-drafts.json'))
  f.choose(source.path); await assert.rejects(f.authoring.importPackage(), { code: 'VALIDATION_ERROR' })
  assert.deepEqual(await readFile(join(f.storage, 'plugin-drafts.json')), before); assert.equal((await f.authoring.list()).length, draftLimits.count)
})

test('model package copy uses the same picker/service, rejects paths and replays only the original receipt', async () => {
  const f = await setup(), source = await f.source(), w = workbench(f.ports)
  f.choose(source.path)
  await assert.rejects(w.execute('import_plugin_package', { path: source.path }), { code: 'AI_RESPONSE_INVALID' }); assert.equal(f.selections(), 0)
  const receipt = data(await w.execute('import_plugin_package', {}, 'copy-once'))
  assert.equal(receipt.upstream.digest, source.pkg.digest); assert.equal(receipt.pluginId, `personal.${receipt.id}`)
  assert.deepEqual(data(await w.execute('import_plugin_package', {}, 'copy-once')), receipt); assert.equal(f.selections(), 1)
  assert.equal((await f.authoring.list()).length, 1); assert.deepEqual((await f.manager.list()).plugins, [])
  assert.equal(JSON.stringify(receipt).includes(f.root), false)
  f.choose(null)
  assert.equal(data(await w.execute('import_plugin_package', {}, 'cancel-once')).status, 'cancelled')
  f.choose(source.path)
  assert.equal(data(await w.execute('import_plugin_package', {}, 'cancel-once')).status, 'cancelled'); assert.equal(f.selections(), 2)
})

test('model cancellation while the picker is open prevents creating a late draft', async () => {
  const f = await setup(), source = await f.source(), controller = new AbortController(), w = workbench(f.ports, 'book-a', controller)
  f.choose(source.path); f.onPick(async () => { controller.abort() })
  await assert.rejects(w.execute('import_plugin_package', {}))
  assert.deepEqual(await readdir(f.storage), []); assert.deepEqual(await f.authoring.list(), [])
})
