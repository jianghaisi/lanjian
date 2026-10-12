import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { validatePluginManifest, type CompositionEntry } from '@lanjian/writing-plugin-contracts'
import { decodePluginIndex, type PluginIndex, type PluginPackageStorePort } from '../../../src/main/modules/writing-plugins/domain/installed'
import { inspectLibraryComposition } from '../../../src/main/modules/writing-plugins/domain/composition'
import { WritingPluginManager } from '../../../src/main/modules/writing-plugins/application/plugin-manager'
import { PluginManagement } from '../../../src/main/modules/writing-plugins/application/plugin-management'
import { decodeLibraryCompositionArgs } from '../../../src/contracts/writing-plugins/contributions'
import { decodePluginManagementView } from '../../../src/contracts/writing-plugins/management-contracts'

function fixture() {
  const manifest = validatePluginManifest({ apiVersion: 1, id: 'personal.library-methods', version: '1.0.0', name: '资料方法', description: '合成元数据方法', runtime: 'quickjs-js', entry: 'main.js', capabilities: [], tools: [], assets: ['method.md'], contributions: [
    ...['extract', 'summary', 'other-extract'].map(id => ({ id, name: id, kind: 'creative-policy', slot: id === 'summary' ? 'inspiration-summary' : 'inspiration-extract', mode: 'replace', asset: 'method.md', stages: ['assistant'], configSchema: { type: 'object', properties: { tag: { type: 'string', maxLength: 20 } }, required: ['tag'], additionalProperties: false } })),
    { id: 'prose', name: '正文方法', kind: 'creative-policy', slot: 'prose', mode: 'replace', asset: 'method.md', stages: ['writing'], configSchema: { type: 'object', properties: {}, additionalProperties: false } }
  ] })
  const digest = 'a'.repeat(64), files = ['lanjian-plugin.json', 'main.js', 'method.md'].map(path => ({ path, bytes: 1, digest }))
  const version = { manifest, digest, files, installedAt: '2026-10-12T00:00:00.000Z', origin: 'local' as const, grants: [] }
  let index: PluginIndex = { format: 1, revision: 0, plugins: [{ id: manifest.id, current: digest, enabled: true, versions: [version] }], books: [] }
  let writes = 0, loads = 0
  const hooks: { load?: () => Promise<void>; write?: () => void } = {}
  const store: PluginPackageStorePort = {
    async read() { return structuredClone(index) },
    async write(next, expected) { hooks.write?.(); assert.equal(index.revision, expected); index = decodePluginIndex(structuredClone(next)); writes++ },
    async load() { loads++; await hooks.load?.(); return new Map() },
    async readZip() { throw Error('unused') }, async publish() { throw Error('unused') }, async remove() {}
  }
  const manager = new WritingPluginManager(store, async () => {}), ui = new PluginManagement(manager, { async currentBook() { return { id: 'book-a', title: '作品甲' } }, async chooseZip() { return null } })
  const entry = (contributionId: string, params: CompositionEntry['params'] = { tag: '原参数' }): CompositionEntry => ({ pluginId: manifest.id, digest, contributionId, params })
  return { manager, ui, store, entry, hooks, get writes() { return writes }, get loads() { return loads }, get index() { return structuredClone(index) } }
}

test('library preview is zero-write and applies without an open book; old index shape and book membership are preserved', async () => {
  const f = fixture(), before = f.index
  assert.deepEqual(decodePluginIndex(before), before)
  const view = decodePluginManagementView(await f.ui.list(false))
  assert.equal(view.book, null); assert.deepEqual(view.library?.composition, { revision: 0, entries: [] })
  const preview = await f.ui.previewLibraryComposition({ libraryToken: view.library!.token, revision: view.revision, entries: [f.entry('extract'), f.entry('summary')] })
  assert.deepEqual(preview.conflicts, []); assert.equal(f.writes, 0)
  await f.ui.applyComposition(preview.planId)
  assert.equal(f.writes, 1); assert.deepEqual(f.index.books, before.books)
  assert.equal(f.index.library?.revision, 1)
  assert.equal((await f.manager.captureLibraryComposition()).versions.length, 1)
  assert.deepEqual((await f.manager.captureComposition('book-a')).versions, [])
  await assert.rejects(f.ui.applyComposition(preview.planId), { code: 'CONFLICT' })
})

test('library rejects other creative slots, missing parameters, exclusive methods and forged scope fields', async () => {
  const f = fixture(), view = await f.ui.list(true)
  const preview = await f.ui.previewLibraryComposition({ libraryToken: view.library!.token, revision: view.revision, entries: [f.entry('prose', {})] })
  assert.equal(preview.conflicts[0].code, 'permission')
  await assert.rejects(f.ui.applyComposition(preview.planId), { code: 'CONFLICT' })
  assert.equal(inspectLibraryComposition(f.index, [f.entry('extract', {})]).conflicts[0].code, 'parameters')
  assert.ok(inspectLibraryComposition(f.index, [f.entry('extract'), f.entry('other-extract')]).conflicts.some(c => c.code === 'exclusive'))
  await assert.rejects(f.ui.previewLibraryComposition({ libraryToken: view.book!.token, revision: view.revision, entries: [] }), { code: 'CONFLICT' })
  assert.throws(() => decodeLibraryCompositionArgs([{ libraryToken: randomUUID(), revision: 0, entries: [], bookToken: randomUUID() }]))
  assert.throws(() => decodePluginIndex({ ...f.index, library: { revision: 0, entries: [], bookId: 'forged' } }))
  assert.equal(f.writes, 0)
})

test('library plans reject refresh, revision drift, in-lane scope changes and storage failure without losing the saved composition', async () => {
  const f = fixture()
  const preview = async () => { const v = await f.ui.list(false); return f.ui.previewLibraryComposition({ libraryToken: v.library!.token, revision: v.revision, entries: [f.entry('extract')] }) }
  let p = await preview(); await f.ui.list(false)
  await assert.rejects(f.ui.applyComposition(p.planId), { code: 'CONFLICT' })
  p = await preview(); await f.manager.setEnabled(f.entry('extract').pluginId, true, [], f.index.revision)
  await assert.rejects(f.ui.applyComposition(p.planId), { code: 'CONFLICT' })
  p = await preview(); const before = f.index
  f.hooks.load = async () => { await f.ui.list(false) }
  await assert.rejects(f.ui.applyComposition(p.planId), { code: 'CONFLICT' }); assert.deepEqual(f.index, before)
  f.hooks.load = undefined; p = await preview()
  const failedWrite = new Error('synthetic storage failure'); f.hooks.write = () => { throw failedWrite }
  await assert.rejects(f.ui.applyComposition(p.planId), error => error === failedWrite); assert.deepEqual(f.index, before)
})

test('library byte loading rechecks global enablement and current selection does not revoke original versions', async () => {
  const f = fixture(), ref = f.entry('extract')
  await f.manager.applyLibraryComposition([ref], f.index.revision, async () => {})
  const original = (await f.manager.captureLibraryComposition()).versions[0]
  await f.manager.applyLibraryComposition([], f.index.revision, async () => {})
  assert.equal((await f.manager.loadLibraryAuthorized(original.manifest.id, original.digest)).version.digest, original.digest)
  f.hooks.load = async () => { f.hooks.load = undefined; await f.manager.setEnabled(ref.pluginId, false, [], f.index.revision) }
  await assert.rejects(f.manager.loadLibraryAuthorized(ref.pluginId, ref.digest), { code: 'CONFLICT' })
  assert.deepEqual(f.index.books, [])
})
