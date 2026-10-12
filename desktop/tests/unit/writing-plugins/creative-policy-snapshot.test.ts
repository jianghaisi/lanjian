import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { creativePolicyRun, withCreativePolicy } from '../../../src/main/modules/writing-plugins/domain/creative-policy'
import { assertReleasedCreativePolicy, decodeCreativePolicySnapshot, restoreCreativePolicy } from '../../../src/main/modules/writing-plugins/domain/creative-policy-snapshot'
import { createCreativePolicyProvider } from '../../../src/main/modules/writing-plugins/runtime/creative-policy-provider'
import { PluginPackageStore } from '../../../src/main/modules/writing-plugins/adapters/package-store'
import { PluginDraftStore } from '../../../src/main/modules/writing-plugins/adapters/draft-store'
import { buildPluginDraft } from '../../../src/main/modules/writing-plugins/adapters/draft-builder'
import { bundledPackagePorts } from '../../../src/main/modules/writing-plugins/adapters/bundled-packages'
import { PluginAuthoringService } from '../../../src/main/modules/writing-plugins/application/authoring-service'
import { BundledPluginService } from '../../../src/main/modules/writing-plugins/application/bundled-service'
import { PluginCompositionService } from '../../../src/main/modules/writing-plugins/application/composition-service'
import { WritingPluginManager } from '../../../src/main/modules/writing-plugins/application/plugin-manager'

async function fixture(t: test.TestContext) {
  const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-policy-snapshot-')))
  assert.ok(root.startsWith(parent + sep))
  t.after(async () => { assert.equal(await realpath(root), root); assert.ok(root.startsWith(parent + sep)); await rm(root, { recursive: true, force: true }) })
  const packages = new PluginPackageStore(root), manager = new WritingPluginManager(packages, async () => {}), store = new PluginDraftStore(root)
  const authoring = new PluginAuthoringService(store, { build: buildPluginDraft, persist: b => store.persist(b), chooseExport: async () => null, choosePackage: async () => null, chooseSource: async () => null,
    installed: async (id, digest) => { const source = await manager.loadAuthorized('book-a', id, digest); return { manifest: source.version.manifest, files: source.files } } }, manager)
  const bundled = new BundledPluginService(bundledPackagePorts(root), manager, authoring), composition = new PluginCompositionService(manager)
  const original = (await bundled.list()).find(p => p.manifest.id === 'lanjian.official.story-planning')!
  const draft = await bundled.derive({ pluginId: original.manifest.id, digest: original.digest })
  const manifest = JSON.parse(draft.manifestText)
  manifest.contributions[0].configSchema = { type: 'object', properties: { focus: { type: 'string', maxLength: 100 } }, required: ['focus'], additionalProperties: false }
  let edited = await authoring.save({ id: draft.id, revision: draft.revision, manifestText: JSON.stringify(manifest), files: draft.files.map(f => f.path === 'foundation.md' ? { ...f, content: 'ORIGINAL_METHOD {{focus}}' } : f) })
  async function install() {
    const built = await authoring.build({ id: edited.id, revision: edited.revision }), preview = await authoring.preview({ id: edited.id, revision: edited.revision })
    let index = await manager.install(preview.planId); index = await manager.setEnabled(draft.pluginId, true, [], index.revision)
    await manager.setBookEnabled('book-a', draft.pluginId, true, index.revision)
    return { pluginId: draft.pluginId, digest: built.digest, contributionId: 'foundation', params: { focus: 'ORIGINAL_PARAMS' } }
  }
  async function select(entry: Awaited<ReturnType<typeof install>>) {
    const preview = await composition.preview('book-a', [entry], (await manager.list()).revision, async () => {})
    assert.deepEqual(preview.conflicts, []); await composition.apply(preview.planId)
  }
  const entry = await install(); await select(entry)
  const provider = (owner = manager, book = 'book-a') => createCreativePolicyProvider(() => owner.captureComposition(book), async version => (await owner.loadAuthorized(book, version.manifest.id, version.digest)).files,
    async ref => owner.loadAuthorized(book, ref.pluginId, ref.digest))
  return { root, manager, provider, entry, select, update: async () => {
    manifest.version = '1.2.1'
    edited = await authoring.save({ id: edited.id, revision: edited.revision, manifestText: JSON.stringify(manifest), files: edited.files.map(f => f.path === 'foundation.md' ? { ...f, content: 'NEW_METHOD {{focus}}' } : f) })
    return install()
  } }
}

test('default reference snapshots round-trip without author content, permissions or capturing new composition', async () => {
  const run = creativePolicyRun(), snapshot = run.snapshot!()
  const restored = await restoreCreativePolicy(async () => { throw Error('must not capture') }, JSON.parse(JSON.stringify(snapshot)))
  assert.deepEqual(restored.resolve('prose'), run.resolve('prose'))
  snapshot.composition.revision = 99; snapshot.released[0].digest = '0'.repeat(64)
  assert.equal(run.snapshot!().composition.revision, 0); assert.notEqual(run.snapshot!().released[0].digest, snapshot.released[0].digest)
  assert.ok(!JSON.stringify(run.snapshot!()).includes('grants')); assert.ok(!JSON.stringify(run.snapshot!()).includes('manifest'))
})

test('closed snapshot decoding rejects foreign fields, missing/duplicate references, overflow and unknown format', async () => {
  const snapshot = creativePolicyRun().snapshot!()
  for (const bad of [null, { ...snapshot, format: 2 }, { ...snapshot, grants: [] }, { ...snapshot, released: [{ ...snapshot.released[0], path: 'C:/private' }] },
    { ...snapshot, released: [snapshot.released[0], snapshot.released[0]] }, { ...snapshot, installed: [{ ...snapshot.released[0], digest: 'invalid' }] },
    { ...snapshot, installed: Array.from({ length: 101 }, () => snapshot.released[0]) }, { ...snapshot, slotParams: { unknown: {} } },
    { ...snapshot, slotParams: { prose: { focus: 'x'.repeat(9000) } } },
    { ...snapshot, composition: { revision: 0, entries: [{ pluginId: 'personal.missing', digest: 'a'.repeat(64), contributionId: 'prose', params: {} }] } },
    { ...snapshot, composition: { revision: 0, entries: [] }, installed: [{ ...snapshot.released[0], version: 'x'.repeat(300000) }] }]) {
    assert.throws(() => decodeCreativePolicySnapshot(bad), { code: 'CONFLICT' })
  }
  const changed = structuredClone(snapshot); changed.released[0].digest = '0'.repeat(64)
  assert.throws(() => assertReleasedCreativePolicy(changed), { code: 'CONFLICT' })
})

test('book-derived genre defaults are fixed at first resolution and survive JSON recovery', async () => {
  const run = creativePolicyRun(), params = { genre: '仙侠', subgenre: '' }, source = run.resolve('genre-guidance', params)
  params.genre = '悬疑'
  assert.deepEqual(run.resolve('genre-guidance', params), source)
  const snapshot = JSON.parse(JSON.stringify(run.snapshot!()))
  const restored = await restoreCreativePolicy(async () => { throw Error('never capture') }, snapshot)
  assert.deepEqual(restored.resolve('genre-guidance', { genre: '悬疑', subgenre: '' }), source)
  snapshot.slotParams['genre-guidance'].genre = '悬疑'; assert.equal(run.snapshot!().slotParams['genre-guidance']!.genre, '仙侠')
})

test('real installation, stored JSON and a fresh manager restore the original retained version and parameters after update', async t => {
  const f = await fixture(t), run = await f.provider()(), original = run.resolve('foundation'), snapshot = JSON.parse(JSON.stringify(run.snapshot!()))
  const newer = await f.update(); await f.select({ ...newer, params: { focus: 'NEW_PARAMS' } })
  assert.match((await f.provider()()).resolve('foundation')[0].text, /NEW_METHOD NEW_PARAMS/)
  const restarted = new WritingPluginManager(new PluginPackageStore(f.root), async () => {})
  const provider = f.provider(restarted)
  const restored = await restoreCreativePolicy(provider, snapshot)
  assert.deepEqual(restored.resolve('foundation'), original)
  assert.match(restored.resolve('foundation')[0].text, /ORIGINAL_METHOD ORIGINAL_PARAMS/)
  await restored.assertAuthorized!()
  assert.deepEqual(restored.snapshot!(), snapshot)
})

test('serialized references grant no book access; revoked original versions block restore and late operations', async t => {
  const f = await fixture(t), run = await f.provider()(), snapshot = run.snapshot!()
  await assert.rejects(restoreCreativePolicy(f.provider(f.manager, 'book-b'), snapshot), { code: 'CONFLICT' })
  await assert.rejects(restoreCreativePolicy(async () => creativePolicyRun(), snapshot), { code: 'FEATURE_UNAVAILABLE' })
  let sends = 0
  const restored = await restoreCreativePolicy(f.provider(), snapshot)
  await assert.rejects(withCreativePolicy(restored, async () => {
    sends++; await f.manager.setBookEnabled('book-a', f.entry.pluginId, false, (await f.manager.list()).revision); return 'synthetic field result'
  }), { code: 'CONFLICT' })
  await assert.rejects(restoreCreativePolicy(f.provider(), snapshot), { code: 'CONFLICT' })
  await assert.rejects(withCreativePolicy(restored, async () => { sends++; return '' }), { code: 'CONFLICT' }); assert.equal(sends, 1)
})

test('restoring the actual original installed bytes detects tampering and never substitutes current/default text', async t => {
  const f = await fixture(t), run = await f.provider()(), snapshot = run.snapshot!()
  const installed = await f.manager.authorize('book-a', f.entry.pluginId, f.entry.digest)
  await writeFile(join(f.root, 'plugin-packages', installed.manifest.id, `${installed.manifest.version}-${installed.digest}`, 'foundation.md'), 'changed bytes')
  await assert.rejects(restoreCreativePolicy(f.provider(), snapshot))
  assert.equal((await f.manager.list()).plugins.find(p => p.id === f.entry.pluginId)!.enabled, false)
})

test('restore validates authoritative loaded identity and copies references before asynchronous resolution', async t => {
  const f = await fixture(t), run = await f.provider()(), snapshot = run.snapshot!()
  const loaded = await f.manager.loadAuthorized('book-a', f.entry.pluginId, f.entry.digest)
  let loads = 0
  const provider = createCreativePolicyProvider(async () => { throw Error('never capture current') }, async () => loaded.files, async ref => {
    loads++; assert.equal(ref.digest, f.entry.digest)
    snapshot.composition.entries[0].params.focus = 'MUTATED'; snapshot.installed[0].digest = '0'.repeat(64)
    await Promise.resolve(); return loaded
  })
  const restored = await restoreCreativePolicy(provider, snapshot)
  assert.match(restored.resolve('foundation')[0].text, /ORIGINAL_PARAMS/); assert.equal(loads, 1)
  const wrong = createCreativePolicyProvider(async () => { throw Error('never capture') }, async () => loaded.files, async () => ({ ...loaded, version: { ...loaded.version, digest: '0'.repeat(64) } }))
  await assert.rejects(restoreCreativePolicy(wrong, run.snapshot!()), { code: 'CONFLICT' })
})
