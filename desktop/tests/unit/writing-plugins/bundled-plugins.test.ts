import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readdir, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import type { JsonObject, JsonValue } from '@lanjian/writing-plugin-contracts'
import { decodeBundledPlugins } from '../../../src/contracts/writing-plugins/bundled'
import { decodeDeriveArgs } from '../../../src/contracts/writing-plugins/authoring'
import { bundledPackagePorts } from '../../../src/main/modules/writing-plugins/adapters/bundled-packages'
import { PluginDraftStore } from '../../../src/main/modules/writing-plugins/adapters/draft-store'
import { PluginPackageStore } from '../../../src/main/modules/writing-plugins/adapters/package-store'
import { buildPluginDraft } from '../../../src/main/modules/writing-plugins/adapters/draft-builder'
import { PluginAuthoringService } from '../../../src/main/modules/writing-plugins/application/authoring-service'
import { BundledPluginService } from '../../../src/main/modules/writing-plugins/application/bundled-service'
import { PluginMarketplaceService } from '../../../src/main/modules/writing-plugins/application/marketplace-service'
import { PluginCompositionService } from '../../../src/main/modules/writing-plugins/application/composition-service'
import { WritingPluginManager } from '../../../src/main/modules/writing-plugins/application/plugin-manager'
import { PluginManagement } from '../../../src/main/modules/writing-plugins/application/plugin-management'
import { contributionContexts } from '../../../src/main/modules/writing-plugins/domain/composition'
import { executeGuest } from '../../../src/main/modules/writing-plugins/runtime/guest-engine'
import { declarativeSource } from '../../../src/main/modules/writing-plugins/runtime/declarative-source'
import { workbench, data } from '../../helpers/plugin-workbench'

async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-bundled-')))
  const store = new PluginDraftStore(root), packages = new PluginPackageStore(root), manager = new WritingPluginManager(packages, async () => {})
  const authoring = new PluginAuthoringService(store, { build: buildPluginDraft, persist: b => store.persist(b), chooseExport: async () => null, choosePackage: async () => null, chooseSource: async () => null, installed: async (id, digest) => {
    const version = (await manager.list()).plugins.find(p => p.id === id)!.versions.find(v => v.digest === digest)!
    return { manifest: version.manifest, files: await packages.load(version) }
  } }, manager)
  const ports = bundledPackagePorts(root), bundled = new BundledPluginService(ports, manager, authoring)
  const services = { bundled, manager, authoring, composition: new PluginCompositionService(manager), market: new PluginMarketplaceService(authoring, manager, null), choosePackage: async () => null }
  return { root, ports, ...services, ...workbench(services) }
}
const ref = (p: { manifest: { id: string }; digest: string }) => ({ pluginId: p.manifest.id, digest: p.digest })

test('shipped catalog is deterministic, bounded, detached from callers and zero-write without market or installation', async () => {
  const f = await setup(), entries = await f.bundled.list()
  assert.equal(entries.length, 16); assert.deepEqual(decodeBundledPlugins(entries), entries)
  assert.deepEqual(await new BundledPluginService(bundledPackagePorts(f.root), f.manager, f.authoring).list(), entries)
  assert.deepEqual((await f.manager.list()).plugins, []); assert.deepEqual(await f.authoring.list(), [])
  assert.deepEqual(await readdir(f.root), [])
  const original = entries[0].manifest.name; entries[0].manifest.name = '伪造的标题'
  assert.equal((await f.bundled.list())[0].manifest.name, original)
  for (const p of entries) assert.equal(await f.bundled.official(p.manifest.id, p.digest), true)
  assert.equal(await f.bundled.official(entries[0].manifest.id, '0'.repeat(64)), false)
  assert.equal(await f.bundled.official('personal.forged', entries[0].digest), false)
  assert.throws(() => decodeBundledPlugins([{ ...entries[0], distribution: 'official' }]))
  assert.throws(() => decodeBundledPlugins([entries[0], entries[0]]))
  assert.throws(() => decodeDeriveArgs([{ ...ref(entries[0]), path: 'C:/private' }]))
  await assert.rejects(f.bundled.preview({ ...ref(entries[0]), digest: '0'.repeat(64) }), { code: 'CONFLICT' })
  assert.deepEqual(await readdir(f.root), [])
})

test('local install uses unchanged CAS preview and permissions; uninstall keeps shipped catalog available', async () => {
  const f = await setup(), entry = (await f.bundled.list())[6]
  const stale = await f.bundled.preview(ref(entry)), plan = await f.bundled.preview(ref(entry))
  assert.deepEqual((await f.manager.list()).plugins, [])
  const installed = await f.manager.install(plan.planId)
  assert.equal(installed.plugins[0].enabled, false); assert.deepEqual(installed.plugins[0].versions[0].grants, []); assert.deepEqual(installed.books, [])
  await assert.rejects(f.manager.install(stale.planId), { code: 'CONFLICT' })
  const management = new PluginManagement(f.manager, { currentBook: async () => null, chooseZip: async () => null, provenance: async (id, digest) => ({ distribution: await f.bundled.official(id, digest) ? 'official' : 'local', createdByMe: await f.authoring.owns(id) }) })
  assert.deepEqual((await management.list(false)).plugins[0].provenance, { distribution: 'official', createdByMe: false })
  await f.manager.uninstall(entry.manifest.id, installed.revision)
  assert.equal((await f.bundled.list()).length, 16); assert.equal((await f.manager.list()).plugins.length, 0)
})

test('copy before install creates owned source with upstream and independent identity; editing cannot overwrite bundled release', async () => {
  const f = await setup(), entry = (await f.bundled.list())[0], copy = await f.bundled.derive(ref(entry))
  assert.notEqual(copy.pluginId, entry.manifest.id); assert.equal(await f.authoring.owns(copy.pluginId), true)
  assert.deepEqual(copy.upstream, { ...ref(entry), version: entry.manifest.version })
  assert.deepEqual(JSON.parse(copy.manifestText).contributions, entry.manifest.contributions)
  assert.deepEqual((await f.manager.list()).plugins, [])
  const manifest = JSON.parse(copy.manifestText); manifest.name = '我自己的仙侠'; manifest.contributions[0].text = '个人写作偏好'
  const edited = await f.authoring.save({ id: copy.id, revision: copy.revision, manifestText: JSON.stringify(manifest), files: copy.files })
  const built = await f.authoring.build({ id: edited.id, revision: edited.revision })
  assert.equal(await f.bundled.official(copy.pluginId, built.digest), false)
  assert.deepEqual((await f.bundled.list())[0], entry)
  assert.equal((await new PluginDraftStore(f.root).list())[0].manifestText, edited.manifestText)
  await assert.rejects(buildPluginDraft({ ...edited, manifestText: JSON.stringify({ ...manifest, id: entry.manifest.id }) }))
})

test('actual shipped counter and workflow execute in QuickJS, and workflow waits for real answers', async () => {
  const f = await setup(), packages = await f.ports.load()
  const wasm = new Uint8Array(await readFile(createRequire(import.meta.url).resolve('@jitl/quickjs-wasmfile-release-sync/wasm'))).buffer
  for (const pkg of packages.filter(p => ['lanjian.bundled.writing-focus', 'lanjian.bundled.text-count'].includes(p.manifest.id))) {
    const { manifest } = pkg, code = new TextDecoder().decode(pkg.files.get(manifest.entry)), workflow = manifest.runtime === 'declarative'
    const source = workflow ? declarativeSource(code, manifest) : code, calls: string[] = []
    let checkpoint: JsonValue = null
    let result = await executeGuest({ invocationId: workflow ? 'workflow' : 'counter', toolId: manifest.tools[0].id, source, input: workflow ? {} : { text: '你好🌏\n\n 第二段 ' } }, wasm, async (method, input) => { calls.push(method); checkpoint = (input as JsonObject).checkpoint; return {} }, new AbortController().signal)
    assert.equal(result.ok, true, JSON.stringify(result))
    if (workflow) {
      assert.deepEqual(calls, ['interaction.request'])
      result = await executeGuest({ invocationId: 'resume', toolId: 'choose_focus', source, input: {}, continuation: { checkpoint, answer: { answers: [{ id: 'focus', chosenOptionIds: ['character'], customText: '', skipped: false }, { id: 'constraints', chosenOptionIds: [], customText: '保留人物原先动机', skipped: false }] } } }, wasm, async () => { throw new Error('must not ask again') }, new AbortController().signal)
      assert.equal(result.ok, true); if (result.ok) { assert.match(String((result.value as JsonObject).text), /依据真实回答/); assert.deepEqual((result.value as JsonObject).answers, [{ id: 'focus', chosenOptionIds: ['character'], customText: '', skipped: false }, { id: 'constraints', chosenOptionIds: [], customText: '保留人物原先动机', skipped: false }]) }
    } else if (result.ok) assert.deepEqual(result.value, { characters: 10, nonWhitespace: 6, paragraphs: 2 })
    assert.deepEqual(calls, workflow ? ['interaction.request'] : [])
  }
})

test('bundled writing guidance enters real scoped composition only after enable, book selection and explicit composition', async () => {
  const f = await setup(), entry = (await f.bundled.list())[0]
  let index = await f.manager.install((await f.bundled.preview(ref(entry))).planId)
  const entries = [{ ...ref(entry), contributionId: 'guidance', params: {} }]
  assert.equal((await f.manager.captureComposition('book-a')).resolved.length, 0)
  assert.ok((await f.composition.preview('book-a', entries, index.revision, async () => {})).conflicts.length)
  index = await f.manager.setEnabled(entry.manifest.id, true, [], index.revision)
  index = await f.manager.setBookEnabled('book-a', entry.manifest.id, true, index.revision)
  assert.equal((await f.manager.captureComposition('book-a')).resolved.length, 0)
  await f.composition.apply((await f.composition.preview('book-a', entries, index.revision, async () => {})).planId)
  const captured = await f.manager.captureComposition('book-a')
  const fragments = contributionContexts(captured.resolved, 'writing', captured.composition)
  assert.equal(contributionContexts(captured.resolved, 'worldbuilding', captured.composition).length, 1)
  assert.equal(fragments.length, 1); assert.equal(fragments[0].authority, 'optional'); assert.equal(fragments[0].untrusted, true)
  assert.match(fragments[0].content, /境界/); assert.match(fragments[0].content, /固定系统模板/)
  assert.equal((await f.manager.captureComposition('book-b')).resolved.length, 0)
})

test('model can discover and copy bundled plugins offline; installation still waits for host confirmation and journals effects', async () => {
  const f = await setup(), listed = data(await f.execute('list_plugins', { area: 'bundled', query: '字数' }))
  assert.equal(listed.total, 1); assert.equal(f.factory(f.journal).length, 18)
  assert.deepEqual(await readdir(f.root), [])
  const entry = listed.entries[0], args = { source: 'bundled', ...ref(entry) }
  const copied = data(await f.execute('derive_plugin_draft', args, 'copy-offline'))
  assert.deepEqual(data(await f.execute('derive_plugin_draft', args, 'copy-offline')), copied)
  assert.equal((await f.authoring.list()).length, 1)
  await assert.rejects(f.execute('install_plugin', { ...args, approved: true }))
  const cancel = await f.prepare('install_plugin', args); await cancel.resume('cancel')
  assert.equal((await f.manager.list()).plugins.length, 0)
  const install = await f.prepare('install_plugin', args)
  assert.match(JSON.stringify(install.outcome.question.review), /片段字数统计/)
  const result = data(await install.resume()); assert.equal(result.status, 'installed')
  assert.deepEqual(data(await install.resume()), result)
  assert.equal((await f.manager.list()).plugins[0].enabled, false)
  assert.equal(data(await f.execute('list_plugins', { area: 'market' })).available, false)
})
