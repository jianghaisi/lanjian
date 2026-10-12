import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { PluginPackageStore } from '../../../src/main/modules/writing-plugins/adapters/package-store'
import { WritingPluginManager } from '../../../src/main/modules/writing-plugins/application/plugin-manager'

const schema = { type: 'object', additionalProperties: false, properties: {} }
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-plugin-store-')), app = join(root, 'app'), book = join(root, 'author-book.md')
  await mkdir(app); await writeFile(book, '作者正式内容不归插件所有。')
  const store = new PluginPackageStore(app), revoked: string[] = []
  const manager = new WritingPluginManager(store, async (id, book) => { revoked.push(`${id}:${book ?? '*'}`) })
  async function pkg(version = '1.0.0', capabilities: string[] = ['book.read']) {
    const manifest = { apiVersion: 1, id: 'author.rhythm', name: '节奏分析', version, description: '分析节奏', runtime: 'quickjs-js', entry: 'main.js', capabilities, tools: [{ id: 'rhythm', description: '分析', effect: 'read', capabilities, inputSchema: schema, outputSchema: schema }] }
    const bytes = await new JSZip().file('lanjian-plugin.json', JSON.stringify(manifest)).file('main.js', 'export function execute(){return {}}').generateAsync({ type: 'nodebuffer' })
    const path = join(root, `plugin-${version}.zip`); await writeFile(path, bytes); return path
  }
  async function install(path: string) { return manager.install((await manager.preview(manager.chooseNativeFile(path))).planId) }
  async function enabled() {
    let index = await install(await pkg())
    index = await manager.setEnabled('author.rhythm', true, ['book.read'], index.revision)
    return manager.setBookEnabled('book-a', 'author.rhythm', true, index.revision)
  }
  return { root, app, book, store, manager, revoked, pkg, install, enabled }
}
test('empty reads and preview write nothing; install is disabled and plan is single-use', async () => {
  const f = await setup(), file = await f.pkg()
  assert.deepEqual(await f.manager.list(), { format: 1, revision: 0, plugins: [], books: [] })
  const preview = await f.manager.preview(f.manager.chooseNativeFile(file))
  assert.deepEqual(await readdir(f.app), [])
  const index = await f.manager.install(preview.planId)
  assert.equal(index.plugins[0].enabled, false); assert.deepEqual(index.plugins[0].versions[0].grants, [])
  assert.deepEqual(await f.manager.capture('book-a'), [])
  await assert.rejects(f.manager.install(preview.planId))
  assert.equal(await readFile(f.book, 'utf8'), '作者正式内容不归插件所有。')
})
test('confirm re-reads hash and revision; changed ZIP and stale plan cannot install', async () => {
  const f = await setup(), file = await f.pkg(), plan = await f.manager.preview(f.manager.chooseNativeFile(file))
  await writeFile(file, 'changed after preview')
  await assert.rejects(f.manager.install(plan.planId)); assert.deepEqual(await readdir(f.app), [])
  const restored = await f.pkg(), first = await f.manager.preview(f.manager.chooseNativeFile(restored)), second = await f.manager.preview(f.manager.chooseNativeFile(restored))
  await f.manager.install(first.planId)
  await assert.rejects(f.manager.install(second.planId), { code: 'CONFLICT' })
})
test('application grants and independent book selection persist; unknown grants cannot be added', async () => {
  const f = await setup(), index = await f.enabled()
  const version = (await f.manager.capture('book-a'))[0]
  assert.deepEqual(await f.manager.capture('book-b'), [])
  await f.manager.authorize('book-a', 'author.rhythm', version.digest, 'book.read')
  await assert.rejects(f.manager.authorize('book-b', 'author.rhythm', version.digest, 'book.read'))
  await assert.rejects(f.manager.authorize('book-a', 'author.rhythm', version.digest, 'candidate.prepare'))
  await assert.rejects(f.manager.setEnabled('author.rhythm', true, ['filesystem'], index.revision))
  const restarted = new WritingPluginManager(new PluginPackageStore(f.app), async () => {})
  assert.deepEqual(await restarted.capture('book-a'), [version])
})
test('update installs immutable version; explicit selection accepts new grants and keeps old runs pinned', async () => {
  const f = await setup(); await f.enabled()
  const old = (await f.manager.capture('book-a'))[0], preview = await f.manager.preview(f.manager.chooseNativeFile(await f.pkg('2.0.0', ['book.read', 'model.generate'])))
  assert.deepEqual(preview.addedCapabilities, ['model.generate'])
  let index = await f.manager.install(preview.planId)
  assert.equal((await f.manager.capture('book-a'))[0].digest, old.digest)
  const update = index.plugins[0].versions.find(v => v.manifest.version === '2.0.0')!
  index = await f.manager.selectVersion('author.rhythm', update.digest, ['book.read', 'model.generate'], index.revision)
  assert.equal((await f.manager.capture('book-a'))[0].digest, update.digest)
  await f.manager.authorize('book-a', 'author.rhythm', old.digest, 'book.read')
  index = await f.manager.selectVersion('author.rhythm', old.digest, ['book.read'], index.revision)
  assert.equal((await f.manager.capture('book-a'))[0].digest, old.digest)
  assert.equal(index.plugins[0].versions.length, 2)
})
test('same semantic version with new bytes is rejected; duplicate same package is idempotent', async () => {
  const f = await setup(), path = await f.pkg(), original = await f.install(path)
  assert.deepEqual(await f.install(path), original)
  const zip = await JSZip.loadAsync(await readFile(path)); zip.file('main.js', 'export function execute(){return {changed:true}}')
  await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }))
  await assert.rejects(f.manager.preview(f.manager.chooseNativeFile(path)))
})
test('tampered entry disables plugin, preserves evidence and revokes pending invocations', async () => {
  const f = await setup(), index = await f.enabled(), version = index.plugins[0].versions[0]
  const entry = join(f.app, 'plugin-packages', 'author.rhythm', `1.0.0-${version.digest}`, 'main.js')
  await writeFile(entry, 'tampered')
  await assert.rejects(f.manager.loadAuthorized('book-a', 'author.rhythm', version.digest))
  assert.equal((await f.manager.list()).plugins[0].enabled, false)
  assert.deepEqual(f.revoked, ['author.rhythm:*']); assert.equal(await readFile(entry, 'utf8'), 'tampered')
})
test('disable/unselect/uninstall revoke before cleanup and leave manuscripts unchanged', async () => {
  const f = await setup(); let index = await f.enabled()
  index = await f.manager.setBookEnabled('book-a', 'author.rhythm', false, index.revision)
  assert.deepEqual(f.revoked, ['author.rhythm:book-a'])
  index = await f.manager.setEnabled('author.rhythm', false, ['book.read'], index.revision)
  index = await f.manager.uninstall('author.rhythm', index.revision)
  assert.deepEqual(index.plugins, []); assert.deepEqual(index.books[0].plugins, [])
  assert.deepEqual(await readdir(join(f.app, 'plugin-packages', 'author.rhythm')), [])
  assert.equal(await readFile(f.book, 'utf8'), '作者正式内容不归插件所有。')
})
test('corrupt and future index formats preserve original bytes and cannot become empty', async () => {
  for (const content of ['{broken', '{"format":2,"revision":0,"plugins":[],"books":[]}']) {
    const f = await setup(), path = join(f.app, 'plugin-index.json'); await writeFile(path, content)
    await assert.rejects(f.manager.list(), { code: 'STORAGE_ERROR' }); assert.equal(await readFile(path, 'utf8'), content)
    await assert.rejects(f.manager.preview(f.manager.chooseNativeFile(await f.pkg())))
    assert.equal(await readFile(path, 'utf8'), content)
  }
})
test('junction escape blocks install and uninstall without touching target files', async () => {
  const f = await setup(), outside = join(f.root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'keep.txt'), 'preserve')
  await symlink(outside, join(f.app, 'plugin-packages'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(f.install(await f.pkg()))
  assert.deepEqual(await readdir(outside), ['keep.txt'])
  const g = await setup(), index = await g.enabled(), version = index.plugins[0].versions[0]
  await symlink(outside, join(g.app, 'plugin-packages', 'author.rhythm', `1.0.0-${version.digest}`, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(g.manager.uninstall('author.rhythm', index.revision))
  assert.equal((await g.manager.list()).plugins[0].enabled, false); assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'preserve')
})
test('revocation can read authorization state without deadlocking the mutation lane', async () => {
  const f = await setup(); let index = await f.enabled()
  const manager = new WritingPluginManager(f.store, async () => { assert.equal((await manager.list()).plugins[0].enabled, false) })
  index = await manager.setEnabled('author.rhythm', false, [], index.revision)
  assert.equal(index.plugins[0].enabled, false)
})
