import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { PluginManagement } from '../../../src/main/modules/writing-plugins/application/plugin-management'
import { WritingPluginManager } from '../../../src/main/modules/writing-plugins/application/plugin-manager'
import { PluginPackageStore } from '../../../src/main/modules/writing-plugins/adapters/package-store'
import { decodePluginBookArgs, decodePluginEnableArgs, decodePluginInstallPreview, decodePluginManagementView, decodePluginTokenArgs, decodePluginVersionArgs } from '../../../src/contracts/writing-plugins/management-contracts'
import { createWritingPluginsBridge } from '../../../src/preload/writing-plugins-bridge'

test('native package token → disabled installation → explicit grants → book token; projection has no paths or other books', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-management-')); t.after(() => rm(root, { recursive: true, force: true }))
  const schema = { type: 'object', additionalProperties: false, properties: {} }, id = 'author.management'
  const manifest = { apiVersion: 1, id, name: '本地插件', description: '隔离测试', version: '1.0.0', runtime: 'quickjs-js', entry: 'main.js', capabilities: ['book.read'], tools: [{ id: 'read', description: '读取', effect: 'read', capabilities: ['book.read'], inputSchema: schema, outputSchema: schema }] }
  const zip = join(root, 'private-source.zip'); await writeFile(zip, await new JSZip().file('lanjian-plugin.json', JSON.stringify(manifest)).file('main.js', 'export function execute(){return {}}').generateAsync({ type: 'nodebuffer' }))
  let book = { id: 'C:\\private\\book-a', title: '原书' }, cancelled = false
  const store = new PluginPackageStore(root), read = store.read.bind(store)
  let switchDuringRead = false
  store.read = async () => { const index = await read(); if (switchDuringRead) { switchDuringRead = false; book = { id: 'C:\\private\\book-b', title: '新书' } }; return index }
  const manager = new WritingPluginManager(store, async () => {})
  const service = new PluginManagement(manager, { currentBook: async () => book, chooseZip: async () => cancelled ? null : zip })
  const token = await service.choosePackage(); assert.ok(token && !token.includes(root))
  const preview = decodePluginInstallPreview(await manager.preview(token!))
  await manager.install(preview.planId)
  let view = decodePluginManagementView(await service.list(true)); assert.equal(view.plugins[0].enabled, false); assert.deepEqual(view.plugins[0].versions[0].grants, [])
  assert.ok(!JSON.stringify(view).includes('private')); assert.ok(!JSON.stringify(view).includes('files'))
  await assert.rejects(service.setBookEnabled({ id, enabled: true, revision: view.revision, bookToken: view.book!.token }))
  await manager.setEnabled(id, true, ['book.read'], view.revision)
  view = await service.list(true)
  switchDuringRead = true
  await assert.rejects(service.setBookEnabled({ id, enabled: true, revision: view.revision, bookToken: view.book!.token }), { code: 'CONFLICT' })
  assert.deepEqual((await manager.list()).books, [], 'scope must be checked after the queued index read, before membership persistence')
  book = { id: 'C:\\private\\book-a', title: '原书' }
  view = await service.list(true); const original = view.book!.token
  book = { id: 'C:\\private\\book-b', title: '新书' }
  await assert.rejects(service.setBookEnabled({ id, enabled: true, revision: view.revision, bookToken: original }), { code: 'CONFLICT' })
  assert.deepEqual((await manager.list()).books, [])
  view = await service.list(true)
  await service.setBookEnabled({ id, enabled: true, revision: view.revision, bookToken: view.book!.token })
  view = await service.list(true); assert.equal(view.plugins[0].bookEnabled, true)
  assert.equal((await manager.capture('C:\\private\\book-a')).length, 0)
  assert.equal((await manager.capture(book.id)).length, 1)
  const stale = view.book!.token; await service.list(false)
  await assert.rejects(service.setBookEnabled({ id, enabled: false, revision: view.revision, bookToken: stale }))
  cancelled = true; assert.equal(await service.choosePackage(), null)
  const restart = new PluginManagement(new WritingPluginManager(new PluginPackageStore(root), async () => {}), { currentBook: async () => book, chooseZip: async () => null })
  assert.equal((await restart.list(true)).plugins[0].bookEnabled, true)
})

test('management IPC rejects paths, unknown fields, unsupported grants, forged book identity and oversized arguments', () => {
  const base = { id: 'author.test', revision: 0 }, token = '00000000-0000-4000-8000-000000000001'
  assert.throws(() => decodePluginTokenArgs(['C:\\private\\plugin.zip']))
  assert.throws(() => decodePluginBookArgs([{ ...base, enabled: true, bookToken: token, bookId: 'another-book' }]))
  assert.throws(() => decodePluginEnableArgs([{ ...base, enabled: true, grants: ['filesystem'] }]))
  assert.throws(() => decodePluginEnableArgs([{ ...base, enabled: 'true', grants: [] }]))
  assert.throws(() => decodePluginEnableArgs([{ ...base, enabled: true, grants: ['book.read', 'book.read'] }]))
  assert.throws(() => decodePluginVersionArgs([{ ...base, digest: '../v1', grants: [] }]))
  assert.throws(() => decodePluginTokenArgs([token, 'extra']))
  assert.throws(() => decodePluginManagementView({ revision: 0, book: null, plugins: [], path: 'private' }))
})

test('preload exposes only named management operations and passes plain data', async () => {
  const calls: unknown[][] = [], bridge = createWritingPluginsBridge(async <T>(...args: unknown[]) => { calls.push(args); return true as T })
  await bridge.list(false); await bridge.choosePackage(); await bridge.setEnabled({ id: 'author.test', revision: 0, enabled: false, grants: [] })
  assert.deepEqual(calls.map(c => c[0]), ['writing-plugins:list', 'writing-plugins:choose-package', 'writing-plugins:set-enabled'])
  assert.equal('execute' in bridge, false); assert.equal('invoke' in bridge, false)
})
