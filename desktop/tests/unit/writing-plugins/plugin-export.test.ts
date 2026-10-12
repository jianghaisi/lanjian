import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, readdir, realpath, rename, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { decodeDraftExportArgs, decodeDraftExportResult } from '../../../src/contracts/writing-plugins/authoring'
import { createWritingPluginsBridge } from '../../../src/preload/writing-plugins-bridge'
import { PluginAuthoringService } from '../../../src/main/modules/writing-plugins/application/authoring-service'
import { PluginMarketplaceService } from '../../../src/main/modules/writing-plugins/application/marketplace-service'
import { PluginCompositionService } from '../../../src/main/modules/writing-plugins/application/composition-service'
import { BundledPluginService } from '../../../src/main/modules/writing-plugins/application/bundled-service'
import { WritingPluginManager } from '../../../src/main/modules/writing-plugins/application/plugin-manager'
import { PluginDraftStore } from '../../../src/main/modules/writing-plugins/adapters/draft-store'
import { PluginPackageStore, readPluginZipFile } from '../../../src/main/modules/writing-plugins/adapters/package-store'
import { buildPluginDraft } from '../../../src/main/modules/writing-plugins/adapters/draft-builder'
import { bundledPackagePorts } from '../../../src/main/modules/writing-plugins/adapters/bundled-packages'
import { pluginExportDestination } from '../../../src/main/modules/writing-plugins/adapters/plugin-export'
import type { PluginExportDestination } from '../../../src/main/modules/writing-plugins/domain/authoring'
import { AppError } from '../../../src/main/core/errors/app-error'
import { workbench, data } from '../../helpers/plugin-workbench'

const ref = (d: { id: string; revision: number }) => ({ id: d.id, revision: d.revision })
async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-plugin-export-'))), storage = join(root, 'app'), output = join(root, 'exports')
  await mkdir(storage); await mkdir(output)
  const store = new PluginDraftStore(storage), manager = new WritingPluginManager(new PluginPackageStore(storage), async () => {})
  let picker: () => Promise<PluginExportDestination | null> = async () => null, selections = 0
  const authoring = new PluginAuthoringService(store, { build: buildPluginDraft, persist: b => store.persist(b), choosePackage: async () => null, chooseSource: async () => null, installed: async () => { throw new Error('not used') }, chooseExport: async () => { selections++; return picker() } }, manager)
  const ports = { authoring, manager, bundled: new BundledPluginService(bundledPackagePorts(storage), manager, authoring), composition: new PluginCompositionService(manager), market: new PluginMarketplaceService(authoring, manager, null), choosePackage: async () => null }
  const draft = await authoring.create('code'), build = await authoring.validate(ref(draft)), input = { ...ref(draft), digest: build.digest }
  const target = join(output, '我的插件.zip')
  return { root, storage, output, target, store, manager, authoring, draft, build, input, ports, selections: () => selections, choose: (next: typeof picker) => { picker = next } }
}

test('preview/cancel exports nothing and does not freeze a version; exact ZIP installs independently without grants', async () => {
  const f = await setup(), before = await readFile(join(f.storage, 'plugin-drafts.json'))
  assert.equal(await f.authoring.export(f.input), null)
  assert.deepEqual(await readdir(f.storage), ['plugin-drafts.json']); assert.deepEqual(await readdir(f.output), [])
  f.choose(() => pluginExportDestination(f.target, f.storage))
  const exported = decodeDraftExportResult(await f.authoring.export(f.input))!
  assert.deepEqual(exported, { draftId: f.draft.id, revision: f.draft.revision, digest: f.build.digest, fileName: '我的插件.zip' })
  const bytes = await readFile(f.target), parsed = await readPluginZipFile(f.target)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), f.build.digest)
  assert.deepEqual(parsed.manifest, f.build.manifest); assert.deepEqual([...parsed.files.keys()].sort(), f.build.files.map(file => file.path).sort())
  assert.equal(new TextDecoder().decode(parsed.files.get('main.js')), f.draft.files[0].content)
  assert.deepEqual(await readFile(join(f.storage, 'plugin-drafts.json')), before)
  assert.equal((await f.manager.list()).plugins.length, 0)
  const other = await setup(), plan = await other.manager.preview(other.manager.chooseNativeFile(f.target)), installed = await other.manager.install(plan.planId)
  assert.equal(installed.plugins[0].current, f.build.digest); assert.equal(installed.plugins[0].enabled, false)
  assert.deepEqual(installed.plugins[0].versions[0].grants, []); assert.deepEqual(installed.books, [])
})

test('strict export DTO and named bridge reject paths/approval and never return a host directory', async () => {
  const f = await setup()
  assert.deepEqual(decodeDraftExportArgs([f.input]), [f.input])
  for (const extra of [{ path: f.target }, { approved: true }, { fileName: 'another.zip' }]) assert.throws(() => decodeDraftExportArgs([{ ...f.input, ...extra }]))
  assert.throws(() => decodeDraftExportArgs([{ ...f.input, digest: 'wrong' }]))
  const result = { draftId: f.draft.id, revision: 1, digest: f.build.digest, fileName: 'ok.zip' }
  assert.throws(() => decodeDraftExportResult({ ...result, fileName: f.target }))
  assert.throws(() => decodeDraftExportResult({ ...result, path: f.target }))
  let called: unknown[] = []
  const bridge = createWritingPluginsBridge(async <T>(...args: unknown[]) => { called = args; return null as T })
  assert.equal(await bridge.exportDraft(f.input), null); assert.deepEqual(called, ['writing-plugins:export-draft', f.input])
})

test('wrong digest, stale revision and a draft edited during native selection cannot export', async () => {
  const f = await setup()
  await assert.rejects(f.authoring.export({ ...f.input, digest: '0'.repeat(64) }), { code: 'CONFLICT' })
  await assert.rejects(f.authoring.export({ ...f.input, revision: 2 }), { code: 'CONFLICT' }); assert.equal(f.selections(), 0)
  f.choose(async () => {
    await f.authoring.save({ ...ref(f.draft), manifestText: f.draft.manifestText, files: [{ path: 'main.js', content: f.draft.files[0].content + '\n// newer draft' }] })
    return pluginExportDestination(f.target, f.storage)
  })
  await assert.rejects(f.authoring.export(f.input), { code: 'CONFLICT' })
  assert.deepEqual(await readdir(f.output), []); assert.deepEqual(await readdir(f.storage), ['plugin-drafts.json'])
})

test('same version content cannot replace a shared package; failures retain the old target and allow exact retry', async () => {
  const f = await setup(); await writeFile(f.target, 'original file')
  f.choose(async () => { const destination = await pluginExportDestination(f.target, f.storage); return { ...destination, write: async (bytes, beforeCommit) => {
    let checks = 0
    await destination.write(bytes, async () => { await beforeCommit(); if (++checks === 2) throw new AppError('CONFLICT', '模拟提交失效') })
  } } })
  await assert.rejects(f.authoring.export(f.input), { code: 'CONFLICT' })
  assert.equal(await readFile(f.target, 'utf8'), 'original file'); assert.deepEqual(await readdir(f.output), ['我的插件.zip'])
  f.choose(() => pluginExportDestination(f.target, f.storage)); await f.authoring.export(f.input)
  const oldBytes = await readFile(f.target)
  const changed = await f.authoring.save({ ...ref(f.draft), manifestText: f.draft.manifestText, files: [{ path: 'main.js', content: f.draft.files[0].content + '\n// changed' }] })
  const changedBuild = await f.authoring.validate(ref(changed))
  await assert.rejects(f.authoring.export({ ...ref(changed), digest: changedBuild.digest }), { code: 'CONFLICT' })
  assert.deepEqual(await readFile(f.target), oldBytes)
})

test('export adapter rejects protected/invalid/link targets and intervening target or parent changes', async () => {
  const f = await setup(), guard = async () => {}
  await assert.rejects(pluginExportDestination(join(f.storage, 'internal.zip'), f.storage), { code: 'VALIDATION_ERROR' })
  await mkdir(join(f.storage, '..private'))
  await assert.rejects(pluginExportDestination(join(f.storage, '..private', 'internal.zip'), f.storage), { code: 'VALIDATION_ERROR' })
  await assert.rejects(pluginExportDestination(join(f.output, 'bad.txt'), f.storage), { code: 'VALIDATION_ERROR' })
  await mkdir(join(f.output, 'folder.zip')); await assert.rejects(pluginExportDestination(join(f.output, 'folder.zip'), f.storage), { code: 'CONFLICT' })
  await symlink(f.storage, join(f.output, 'link.zip'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(pluginExportDestination(join(f.output, 'link.zip'), f.storage), { code: 'CONFLICT' })
  const destination = await pluginExportDestination(f.target, f.storage)
  await writeFile(f.target, 'another writer')
  await assert.rejects(destination.write(new Uint8Array([1]), guard), { code: 'CONFLICT' }); assert.equal(await readFile(f.target, 'utf8'), 'another writer')
  const another = await pluginExportDestination(f.target, f.storage)
  const moved = join(f.root, 'moved'); await rename(f.output, moved)
  await symlink(f.storage, f.output, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(another.write(new Uint8Array([2]), guard), { code: 'CONFLICT' })
  assert.equal(await readFile(join(moved, '我的插件.zip'), 'utf8'), 'another writer')
  assert.deepEqual((await readdir(f.storage)).sort(), ['..private', 'plugin-drafts.json'])
  await assert.rejects(pluginExportDestination(join(f.output, 'internal.zip'), f.storage), { code: 'VALIDATION_ERROR' })
})

test('draft changes immediately before atomic commit preserve destination bytes and remove only the temporary file', async () => {
  const f = await setup(); await writeFile(f.target, 'preserved')
  f.choose(async () => {
    const destination = await pluginExportDestination(f.target, f.storage)
    return { ...destination, write: (bytes, check) => {
      let calls = 0
      return destination.write(bytes, async () => {
        if (++calls === 2) await f.authoring.save({ ...ref(f.draft), manifestText: f.draft.manifestText, files: f.draft.files })
        await check()
      })
    } }
  })
  await assert.rejects(f.authoring.export(f.input), { code: 'CONFLICT' })
  assert.equal(await readFile(f.target, 'utf8'), 'preserved'); assert.deepEqual(await readdir(f.output), ['我的插件.zip'])
})

test('model export requires an exact author answer, shares native selection, and replays only its durable receipt', async () => {
  const f = await setup(), w = workbench(f.ports), args = ref(f.draft)
  f.choose(() => pluginExportDestination(f.target, f.storage))
  await assert.rejects(w.execute('export_plugin_draft', { ...args, approved: true }), { code: 'AI_RESPONSE_INVALID' })
  await assert.rejects(w.execute('export_plugin_draft', { ...args, path: f.target }), { code: 'AI_RESPONSE_INVALID' })
  const proposal = await w.prepare('export_plugin_draft', args)
  assert.match(JSON.stringify(proposal.outcome.question), new RegExp(f.build.digest)); assert.equal(f.selections(), 0)
  assert.equal(data(await proposal.resume('', '我同意')).status, 'cancelled')
  assert.equal(data(await (await w.prepare('export_plugin_draft', args)).resume('cancel')).status, 'cancelled'); assert.equal(f.selections(), 0)
  const accepted = await w.prepare('export_plugin_draft', args), result = data(await accepted.resume())
  assert.equal(result.status, 'exported'); assert.equal(result.fileName, '我的插件.zip')
  assert.deepEqual(data(await accepted.resume()), result); assert.equal(f.selections(), 1)
  assert.equal(JSON.stringify(result).includes(f.root), false)
  assert.equal((await readPluginZipFile(f.target)).digest, result.digest)
  f.choose(async () => null)
  assert.equal(data(await (await w.prepare('export_plugin_draft', args)).resume()).status, 'cancelled')
})

test('cancelled model scope during the native picker prevents package persistence and file output', async () => {
  const f = await setup(), controller = new AbortController(), w = workbench(f.ports, 'book-a', controller)
  f.choose(async () => { controller.abort(); return pluginExportDestination(f.target, f.storage) })
  await assert.rejects((await w.prepare('export_plugin_draft', ref(f.draft))).resume())
  assert.deepEqual(await readdir(f.output), []); assert.deepEqual(await readdir(f.storage), ['plugin-drafts.json'])
})
