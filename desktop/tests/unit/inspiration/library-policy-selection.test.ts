import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { validatePluginManifest, type CompositionEntry } from '@lanjian/writing-plugin-contracts'
import { InspirationService, type InspirationModels } from '../../../src/main/modules/inspiration/application/inspiration-service'
import { InspirationStore } from '../../../src/main/modules/inspiration/adapters/inspiration-store'
import { inspirationDigest } from '../../../src/main/modules/inspiration/domain/source'
import { buildPluginContent } from '../../../src/main/modules/writing-plugins/adapters/draft-builder'
import { PluginPackageStore } from '../../../src/main/modules/writing-plugins/adapters/package-store'
import { WritingPluginManager } from '../../../src/main/modules/writing-plugins/application/plugin-manager'
import { PluginManagement } from '../../../src/main/modules/writing-plugins/application/plugin-management'
import { createLibraryCreativePolicyProvider } from '../../../src/main/modules/writing-plugins/runtime/library-policy-provider'
import { withContributionSnapshot } from '../../../src/main/modules/writing-plugins/runtime/contribution-context'
import { creativePolicyRun } from '../../../src/main/modules/writing-plugins/domain/creative-policy'
import { withCreativePolicyRun, currentCreativePolicyRun } from '../../../src/main/modules/writing-plugins/application/creative-policy-execution'
import type { InstalledVersion } from '../../../src/main/modules/writing-plugins/domain/installed'

const text = '资料员选择标签甲，审核员记录标签甲并保留核对依据。'
const profile = { connectionId: 'global-metadata-fixture', model: 'metadata-fixture', parameterPolicy: { version: 2 as const, mode: 'auto' as const } }
const request = (source: { id: string; version: string }, maxCalls = 2) => ({ sourceId: source.id, sourceVersion: source.version, operationId: randomUUID(), profile, maxCalls })
async function settle(library: InspirationService, id: string) {
  for (let i = 0; i < 1000; i++) { const job = await library.getJob(id); if (job.status !== 'running') return job; await delay(5) }
  throw Error('Synthetic metadata job did not settle')
}
async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-library-selection-')))
  let manager = new WritingPluginManager(new PluginPackageStore(root), async () => {})
  const management = () => new PluginManagement(manager, { async currentBook() { return null }, async chooseZip() { return null } })
  let ui = management()
  const versions: InstalledVersion[] = []
  for (const version of ['1.0.0', '1.1.0']) {
    const manifest = validatePluginManifest({ apiVersion: 1, id: 'personal.library-selection', version, name: '合成资料方法', description: '仅验证元数据方法与参数', runtime: 'quickjs-js', entry: 'main.js', capabilities: [], tools: [], assets: ['extract.md', 'summary.md'], contributions: [
      ...['extract', 'summary'].map(id => ({ id, name: id, kind: 'creative-policy', slot: id === 'extract' ? 'inspiration-extract' : 'inspiration-summary', mode: 'replace', asset: `${id}.md`, stages: ['assistant'], configSchema: { type: 'object', properties: { tag: { type: 'string', maxLength: 50 } }, required: ['tag'], additionalProperties: false } })),
      { id: 'other', name: '其他方法', kind: 'creative-policy', slot: 'prose', mode: 'replace', asset: 'extract.md', stages: ['writing'], configSchema: { type: 'object', properties: { tag: { type: 'string', maxLength: 50 } }, required: ['tag'], additionalProperties: false } }
    ] })
    const built = await buildPluginContent({ manifestText: JSON.stringify(manifest), files: [{ path: 'main.js', content: 'export function execute(){throw Error("No tools allowed")}' }, { path: 'extract.md', content: `D2_EXTRACT_${version} {{tag}}` }, { path: 'summary.md', content: `D2_SUMMARY_${version} {{tag}}` }] })
    const path = join(root, `${version}.zip`); await writeFile(path, built.bytes)
    const plan = await manager.preview(manager.chooseNativeFile(path)); await manager.install(plan.planId)
    versions.push((await manager.list()).plugins[0].versions.find(v => v.digest === plan.digest)!)
  }
  await manager.setEnabled(versions[0].manifest.id, true, [], (await manager.list()).revision)
  const policies = createLibraryCreativePolicyProvider(() => manager)
  const calls: string[] = [], hooks: { complete?: () => Promise<void> } = {}
  let captures = 0
  const models: InspirationModels = { capture: async () => {
    captures++; return { fingerprint: inspirationDigest(profile), complete: async instruction => {
      calls.push(instruction); await hooks.complete?.()
      const input = JSON.parse(instruction.split('\n').at(-1)!)
      const evidence = Array.isArray(input) ? input.flatMap(c => c.evidence).slice(0, 1) : [{ segmentId: input.segmentId, quote: input.text }]
      return JSON.stringify({ cards: [{ title: '标签核对', narrative: '保留来源中的标签核对信息。', tags: [], characters: [], conflict: '', choice: '', outcome: '', turn: '', foreshadowing: '', evidence }] })
    } }
  } }
  let store = new InspirationStore(root, 'author'), library = new InspirationService(store, models, policies)
  t.after(async () => { await library.shutdown(); assert.equal(dirname(root), parent); assert.ok(root.startsWith(join(parent, 'lanjian-library-selection-'))); await rm(root, { recursive: true, force: true }) })
  const imported = await library.importPreview([{ name: '合成元数据.txt', dataBase64: Buffer.from(text).toString('base64') }])
  const source = (await library.importCommit(imported.token))[0]
  const entry = (version: InstalledVersion, contributionId: string, tag = 'ORIGINAL'): CompositionEntry => ({ pluginId: version.manifest.id, digest: version.digest, contributionId, params: { tag } })
  return { root, versions, policies, calls, hooks, source, entry, get captures() { return captures }, get manager() { return manager }, get store() { return store }, get library() { return library },
    async select(version?: InstalledVersion, tag = 'ORIGINAL') {
      const view = await ui.list(false), entries = version ? ['extract', 'summary'].map(id => entry(version, id, tag)) : []
      const preview = await ui.previewLibraryComposition({ libraryToken: view.library!.token, revision: view.revision, entries })
      assert.deepEqual(preview.conflicts, []); await ui.applyComposition(preview.planId)
    },
    async reopen() { await library.shutdown(); manager = new WritingPluginManager(new PluginPackageStore(root), async () => {}); ui = management(); store = new InspirationStore(root, 'author'); library = new InspirationService(store, models, policies) }
  }
}

test('real installed library selection reaches extraction, ignores book ALS and resumes original methods after selection change and restart', async t => {
  const f = await fixture(t); await f.select(f.versions[0])
  const book = { ...creativePolicyRun(), resolve: () => { throw Error('Inherited book policy must never be used') } }
  const paused = await withContributionSnapshot({ versions: [], composition: { revision: 73, entries: [] } }, () => withCreativePolicyRun(book, async () => {
    const job = await settle(f.library, (await f.library.extract(request(f.source, 1))).id)
    assert.equal(currentCreativePolicyRun(), book); return job
  }))
  assert.equal(paused.status, 'paused-limit'); assert.match(f.calls[0], /D2_EXTRACT_1\.0\.0 ORIGINAL/)
  const original = await f.store.policy(paused.id); assert.ok(original)
  await f.select(f.versions[1], 'NEW_SELECTION'); await f.reopen()
  assert.equal(f.calls.length, 1)
  const opened = await f.library.getJob(paused.id)
  const done = await settle(f.library, (await f.library.resume({ jobId: paused.id, expectedRevision: opened.revision })).id)
  assert.equal(done.status, 'succeeded', done.notice); assert.match(f.calls[1], /D2_SUMMARY_1\.0\.0 ORIGINAL/)
  assert.deepEqual(await f.store.policy(done.id), original)
  const fresh = await settle(f.library, (await f.library.extract(request(f.source))).id)
  assert.equal(fresh.status, 'succeeded', fresh.notice); assert.equal(f.calls.length, 4)
  assert.ok(f.calls.slice(2).every(call => call.includes('1.1.0 NEW_SELECTION')))
  await f.select()
  assert.ok((await f.policies.restore!(original)).resolve('inspiration-extract').some(method => method.text.includes('D2_EXTRACT_1.0.0 ORIGINAL')))
  assert.deepEqual((await f.manager.list()).books, [], 'no synthetic book identity or membership')
})

test('global disable during an actual library response prevents late cards and remains disabled across restart', async t => {
  const f = await fixture(t); await f.select(f.versions[0])
  f.hooks.complete = async () => { f.hooks.complete = undefined; await f.manager.setEnabled(f.versions[0].manifest.id, false, [], (await f.manager.list()).revision) }
  const job = await settle(f.library, (await f.library.extract(request(f.source))).id)
  assert.equal(job.status, 'failed'); assert.equal(f.calls.length, 1); assert.deepEqual(job.cardIds, [])
  assert.equal((await f.library.search({ query: '' })).total, 0)
  await f.reopen(); const before = f.captures
  await assert.rejects(f.library.extract(request(f.source)), { code: 'CONFLICT' })
  assert.equal(f.captures, before); assert.equal(f.calls.length, 1)
})

test('library restore rejects another method scope and real installed-byte damage before model capture', async t => {
  const f = await fixture(t); await f.select(f.versions[0])
  const original = (await f.policies()).snapshot!()
  await assert.rejects(f.policies.restore!({ ...original, composition: { ...original.composition, entries: [f.entry(f.versions[0], 'other')] } }), { code: 'CONFLICT' })
  const v = f.versions[0]
  await writeFile(join(f.root, 'plugin-packages', v.manifest.id, `${v.manifest.version}-${v.digest}`, 'extract.md'), 'damaged synthetic asset')
  await assert.rejects(f.library.extract(request(f.source)))
  assert.equal(f.captures, 0); assert.equal(f.calls.length, 0)
  assert.equal((await f.manager.list()).plugins[0].enabled, false)
})

test('a pure official original snapshot does not read an unrelated current installation index during restore', async t => {
  const f = await fixture(t), run = await f.policies()
  const methods = run.resolve('inspiration-extract'), original = run.snapshot!()
  assert.deepEqual(original.installed, []); assert.deepEqual(original.composition.entries, [])
  await writeFile(join(f.root, 'plugin-index.json'), '{damaged current index')
  const restored = await f.policies.restore!(original)
  assert.ok(methods.length)
  assert.deepEqual(restored.resolve('inspiration-extract'), methods)
  assert.deepEqual(restored.snapshot!(), original)
  await assert.rejects(f.policies(), 'new captures must still reject the damaged current selection')
})
