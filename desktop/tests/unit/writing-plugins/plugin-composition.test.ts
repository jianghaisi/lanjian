import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validatePluginManifest, type CompositionEntry } from '@lanjian/writing-plugin-contracts'
import { inspectComposition, contributionContexts } from '../../../src/main/modules/writing-plugins/domain/composition'
import { decodePluginIndex, type PluginIndex, type PluginPackageStorePort } from '../../../src/main/modules/writing-plugins/domain/installed'
import { WritingPluginManager } from '../../../src/main/modules/writing-plugins/application/plugin-manager'
import { PluginManagement } from '../../../src/main/modules/writing-plugins/application/plugin-management'
import { decodePluginRunState } from '../../../src/main/modules/writing-plugins/domain/plugin-run'
import { decodeCompositionArgs, decodeCompositionPreview, inPluginView } from '../../../src/contracts/writing-plugins/contributions'
import { createContributionContextProvider, withContributionSnapshot } from '../../../src/main/modules/writing-plugins/runtime/contribution-context'

const digest = 'a'.repeat(64)
async function fixture() {
  const manifest = validatePluginManifest(JSON.parse(await readFile(new URL('../../../examples/writing-plugins/writing-composition/lanjian-plugin.json', import.meta.url), 'utf8')))
  const version = { manifest, digest, files: [{ path: 'lanjian-plugin.json', digest, bytes: 1 }, { path: 'main.js', digest, bytes: 1 }], installedAt: '2026-09-28T00:00:00.000Z', origin: 'local' as const, grants: [...manifest.capabilities] }
  const index: PluginIndex = { format: 1, revision: 0, plugins: [{ id: manifest.id, current: digest, enabled: true, versions: [version] }], books: [{ id: 'book-a', plugins: [manifest.id] }, { id: 'book-b', plugins: [manifest.id] }] }
  const entry = (contributionId: string, params: CompositionEntry['params'] = {}): CompositionEntry => ({ pluginId: manifest.id, digest, contributionId, params })
  return { manifest, version, index, entry }
}
test('composition conflicts are explicit: parameters, grants, missing dependencies, cycles, exclusivity, versions and budget', async () => {
  const { index, entry, manifest, version } = await fixture()
  const style = entry('style', { tone: '克制' })
  assert.deepEqual(inspectComposition(index, 'book-a', [style]).conflicts, [])
  assert.equal(inspectComposition(index, 'book-a', [entry('style')]).conflicts[0].code, 'parameters')
  version.grants = []; assert.equal(inspectComposition(index, 'book-a', [entry('check', { focus: '动机' })]).conflicts[0].code, 'permission'); version.grants = [...manifest.capabilities]
  const c = manifest.contributions![0]; c.requires = [{ pluginId: manifest.id, contributionId: 'reference' }]
  assert.ok(inspectComposition(index, 'book-a', [style]).conflicts.some(c => c.code === 'missing'))
  const reference = manifest.contributions![4]; reference.stages = [...c.stages]; reference.requires = [{ pluginId: manifest.id, contributionId: 'style' }]
  assert.ok(inspectComposition(index, 'book-a', [style, entry('reference')]).conflicts.some(c => c.code === 'cycle'))
  delete c.requires; delete reference.requires
  manifest.contributions!.push({ ...structuredClone(c), id: 'other' })
  assert.ok(inspectComposition(index, 'book-a', [style, entry('other', { tone: '热烈' })]).conflicts.some(c => c.code === 'exclusive'))
  const v2 = structuredClone(version); v2.digest = 'b'.repeat(64); v2.manifest.version = '2.0.0'; index.plugins[0].versions.push(v2)
  assert.ok(inspectComposition(index, 'book-a', [style, {...entry('reference'), digest:v2.digest}]).conflicts.some(c => c.code === 'version'))
  for (let i=0;i<3;i++) manifest.contributions!.push({ ...structuredClone(c), id:`long${i}`, exclusiveGroup:undefined, text:'长'.repeat(10000) } as typeof c)
  assert.ok(inspectComposition(index, 'book-a', [0,1,2].map(i=>entry(`long${i}`,{tone:'短'}))).conflicts.some(c => c.code === 'budget'))
})
test('preview is zero-write; one-use apply CAS checks scope inside manager lane and keeps book compositions independent', async () => {
  const { index: initial, entry } = await fixture(); let index = structuredClone(initial), book = 'book-a', writes = 0, switchOnRead = false
  const store: PluginPackageStorePort = { async read() { const copy = structuredClone(index); if (switchOnRead) { switchOnRead = false; book = 'book-b' }; return copy }, async write(next, expected) { assert.equal(index.revision, expected); writes++; index = decodePluginIndex(next) }, async load() { return new Map() }, async readZip() { throw Error('unused') }, async publish() { throw Error('unused') }, async remove() {} }
  const manager = new WritingPluginManager(store, async () => {}), ui = new PluginManagement(manager, { currentBook: async () => ({ id: book, title: book }), chooseZip: async () => null })
  let view = await ui.list(true)
  const preview = decodeCompositionPreview(await ui.previewComposition({ bookToken: view.book!.token, revision: view.revision, entries: [entry('style', { tone:'原书' })] }))
  assert.equal(writes, 0); await ui.applyComposition(preview.planId); assert.equal(writes,1)
  const frozen = await manager.captureComposition(book)
  await assert.rejects(ui.applyComposition(preview.planId))
  view = await ui.list(true)
  const stale = await ui.previewComposition({ bookToken:view.book!.token, revision:view.revision, entries:[] })
  await manager.setEnabled(index.plugins[0].id,true,initial.plugins[0].versions[0].grants,index.revision)
  await assert.rejects(ui.applyComposition(stale.planId)); assert.equal((await manager.captureComposition(book)).composition.revision,1)
  view=await ui.list(true); const scope = await ui.previewComposition({ bookToken:view.book!.token, revision:view.revision, entries:[] }); switchOnRead=true
  await assert.rejects(ui.applyComposition(scope.planId)); assert.equal(index.books[0].composition?.entries.length,1); assert.equal(index.books[1].composition,undefined)
  view=await ui.list(true); const next=await ui.previewComposition({ bookToken:view.book!.token, revision:view.revision, entries:[entry('style',{tone:'新书'})] }); await ui.applyComposition(next.planId)
  assert.equal(index.books[1].composition!.entries[0].params.tone,'新书'); assert.equal(frozen.composition.entries[0].params.tone,'原书')
  const run = decodePluginRunState({ pins:frozen.versions.map(v=>({id:v.manifest.id,version:v.manifest.version,digest:v.digest,grants:v.grants})),effects:[],composition:frozen.composition })
  assert.equal(run.composition!.revision,1)
  assert.throws(()=>decodePluginRunState({...run,pins:[]}))
})
test('context sources affect actual task data, stay optional/untrusted, and nested async candidates inherit frozen composition', async () => {
  const { index, entry, version }=await fixture(), composition={revision:1,entries:[entry('style',{tone:'克制'})]}
  const inspected=inspectComposition(index,'book-a',composition.entries), contexts=contributionContexts(inspected.resolved,'writing',composition)
  assert.match(contexts[0].content,/克制/); assert.equal(contexts[0].authority,'optional'); assert.equal(contexts[0].untrusted,true)
  const provider=createContributionContextProvider(async()=>({versions:[version],composition:{revision:2,entries:[entry('style',{tone:'热烈'})]}}))
  assert.match((await provider('writing'))[0].content,/热烈/)
  await withContributionSnapshot({versions:[version],composition},async()=> { await new Promise(r=>setTimeout(r,1)); assert.match((await provider('writing'))[0].content,/克制/); assert.equal((await provider('worldbuilding')).length,0) })
})
test('community and mine overlap only through trusted ownership; renderer cannot forge scope', () => {
  const provenance={distribution:'community' as const,createdByMe:true}
  assert.equal(inPluginView(provenance,'community'),true); assert.equal(inPluginView(provenance,'mine'),true); assert.equal(inPluginView(provenance,'official'),false)
  assert.equal(inPluginView({distribution:'local',createdByMe:false},'mine'),false)
  assert.throws(()=>decodeCompositionArgs([{bookToken:'C:/private',revision:0,entries:[]}]))
  assert.throws(()=>decodeCompositionArgs([{bookToken:'00000000-0000-4000-8000-000000000001',revision:0,entries:[],bookId:'book-b'}]))
})
