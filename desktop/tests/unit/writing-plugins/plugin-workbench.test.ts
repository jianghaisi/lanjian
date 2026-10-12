import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, realpath, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginDraftStore } from '../../../src/main/modules/writing-plugins/adapters/draft-store'
import { PluginPackageStore } from '../../../src/main/modules/writing-plugins/adapters/package-store'
import { buildPluginDraft } from '../../../src/main/modules/writing-plugins/adapters/draft-builder'
import { bundledPackagePorts } from '../../../src/main/modules/writing-plugins/adapters/bundled-packages'
import { BundledPluginService } from '../../../src/main/modules/writing-plugins/application/bundled-service'
import { PluginAuthoringService } from '../../../src/main/modules/writing-plugins/application/authoring-service'
import { PluginMarketplaceService } from '../../../src/main/modules/writing-plugins/application/marketplace-service'
import { PluginCompositionService } from '../../../src/main/modules/writing-plugins/application/composition-service'
import { WritingPluginManager } from '../../../src/main/modules/writing-plugins/application/plugin-manager'
import { WritingPluginRegistry, modelToolName } from '../../../src/main/modules/writing-plugins/application/registry'
import { WritingPluginDispatcher } from '../../../src/main/modules/writing-plugins/application/dispatcher'
import { decodeAuthorActionReview, decodeAuthorQuestionCard } from '../../../src/contracts/assistant/author-interaction-contracts'
import { workbench, data } from '../../helpers/plugin-workbench'

async function setup(revoke: () => Promise<void> = async () => {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-workbench-')))
  const store = new PluginDraftStore(root), packages = new PluginPackageStore(root), manager = new WritingPluginManager(packages, revoke)
  const authoring = new PluginAuthoringService(store, { build: buildPluginDraft, persist: b => store.persist(b), chooseExport: async () => null, choosePackage: async () => null, chooseSource: async () => null, installed: async (id, digest) => {
    const version = (await manager.list()).plugins.find(p => p.id === id)!.versions.find(v => v.digest === digest)!
    return { manifest: version.manifest, files: await packages.load(version) }
  } }, manager)
  const ports = { authoring, manager, bundled: new BundledPluginService(bundledPackagePorts(root), manager, authoring), composition: new PluginCompositionService(manager), market: new PluginMarketplaceService(authoring, manager, null), choosePackage: async () => null }
  return { root, ...ports, ...workbench(ports), ports }
}
const ref = (d: { id: string; revision: number }) => ({ id: d.id, revision: d.revision })

test('plugin reads are zero-write, book-scoped, and unavailable market is truthful', async () => {
  const f = await setup()
  assert.equal(data(await f.execute('list_plugins', { area: 'drafts' })).total, 0)
  assert.equal(data(await f.execute('list_plugins', { area: 'installed' })).total, 0)
  assert.equal(data(await f.execute('list_plugins', { area: 'market' })).available, false)
  assert.equal(data(await f.execute('plugin_market_account', { action: 'login' })).available, false)
  await assert.rejects(f.execute('search_plugin_market', {}), { code: 'FEATURE_UNAVAILABLE' })
  assert.deepEqual(await readdir(f.root), [])
  assert.equal(f.factory(f.journal).length, 18)
})

test('model creates and edits real code drafts with CAS, segmented reads and durable invocation receipts', async () => {
  const f = await setup(), first = data(await f.execute('create_plugin_draft', { template: 'code' }, 'create-one'))
  assert.deepEqual(data(await f.execute('create_plugin_draft', { template: 'code' }, 'create-one')), first)
  assert.equal((await f.authoring.list()).length, 1)
  await assert.rejects(f.execute('create_plugin_draft', { template: 'workflow' }, 'create-one'), { code: 'CONFLICT' })
  const draft = (await f.authoring.list())[0], raw = '{invalid but preserved'
  const saved = data(await f.execute('save_plugin_draft', { ...ref(draft), manifestText: raw, files: draft.files }))
  assert.equal(saved.revision, 2)
  assert.equal(data(await f.execute('read_plugin_draft', { id: draft.id, limit: 8 })).content, raw.slice(0, 8))
  const before = await readFile(join(f.root, 'plugin-drafts.json'))
  await assert.rejects(f.execute('save_plugin_draft', { ...ref(draft), manifestText: draft.manifestText, files: draft.files }), { code: 'CONFLICT' })
  await assert.rejects(f.execute('build_plugin_draft', { ...ref(saved), action: 'build' }))
  await assert.rejects(f.execute('read_plugin_draft', { id: draft.id, file: '../private.txt' }))
  assert.deepEqual(await readFile(join(f.root, 'plugin-drafts.json')), before)
  assert.equal((await f.manager.list()).plugins.length, 0)
})

test('model derivation preserves internal dependency ownership and durable replay creates only one copy', async () => {
  const f = await setup(), draft = await f.authoring.create('context'), manifest = JSON.parse(draft.manifestText)
  manifest.contributions.push({ ...manifest.contributions[0], id: 'dependent', requires: [{ pluginId: draft.pluginId, contributionId: 'voice' }] })
  const saved = await f.authoring.save({ ...ref(draft), manifestText: JSON.stringify(manifest), files: draft.files })
  const plan = await f.authoring.preview(ref(saved)), index = await f.manager.install(plan.planId)
  const args = { pluginId: saved.pluginId, digest: plan.digest }
  const result = data(await f.execute('derive_plugin_draft', args, 'copy-with-dependencies'))
  assert.deepEqual(data(await f.execute('derive_plugin_draft', args, 'copy-with-dependencies')), result)
  const drafts = await f.authoring.list(), copied = drafts.find(d => d.id === result.id)!
  assert.equal(drafts.length, 2); assert.notEqual(copied.pluginId, saved.pluginId)
  assert.deepEqual(JSON.parse(copied.manifestText).contributions[1].requires, [{ pluginId: copied.pluginId, contributionId: 'voice' }])
  assert.deepEqual(copied.files, saved.files); assert.deepEqual(drafts.find(d => d.id === saved.id), saved)
  assert.deepEqual(await f.manager.list(), index)
})

test('model draft validation and install/export preparation share static-question preflight and preserve repairable drafts', async () => {
  const f = await setup()
  const created = data(await f.execute('create_plugin_draft', { template: 'workflow' }))
  const draft = (await f.authoring.list()).find(d => d.id === created.id)!, recipe = JSON.parse(draft.files[0].content)
  recipe.tools[0].steps[0].args.question.questions[0].options[1].label = ''
  const saved = data(await f.execute('save_plugin_draft', { ...ref(draft), manifestText: draft.manifestText, files: [{ path: 'recipe.json', content: JSON.stringify(recipe) }] }))
  const before = await readFile(join(f.root, 'plugin-drafts.json'))
  const expected = /第 1 个工具的第 1 组提问/
  for (const action of ['validate', 'build']) await assert.rejects(f.execute('build_plugin_draft', { ...ref(saved), action }), expected)
  await assert.rejects(f.prepare('install_plugin', { source: 'draft', ...ref(saved) }), expected)
  await assert.rejects(f.prepare('export_plugin_draft', ref(saved)), expected)
  assert.deepEqual(await readFile(join(f.root, 'plugin-drafts.json')), before)
  assert.deepEqual(await readdir(f.root), ['plugin-drafts.json']); assert.equal((await f.manager.list()).plugins.length, 0)
  const repaired = data(await f.execute('save_plugin_draft', { ...ref(saved), manifestText: draft.manifestText, files: draft.files }))
  const valid = data(await f.execute('build_plugin_draft', { ...ref(repaired), action: 'validate' }))
  assert.equal(valid.manifest.version, '1.0.0')
  const plan = await f.prepare('install_plugin', { source: 'draft', ...ref(repaired) })
  assert.equal(plan.outcome.kind, 'waiting-input'); assert.equal((await f.manager.list()).plugins.length, 0)
})

test('model operations reject an embedded invalid question and preserve the editable draft before any effect or confirmation', async () => {
  const f = await setup(), draft = await f.authoring.create('workflow'), manifest = JSON.parse(draft.manifestText)
  const tool = { ...manifest.tools[0], id: 'contribution__embedded' }, recipe = JSON.parse(draft.files[0].content)
  recipe.tools[0].id = tool.id; recipe.tools[0].steps[0].args.question.questions[0].options[0].label = ''
  manifest.contributions = [{ id: 'embedded', name: '内嵌写前提问', kind: 'workflow', stages: ['assistant'], configSchema: tool.inputSchema, tool, recipe }]
  const saved = data(await f.execute('save_plugin_draft', { ...ref(draft), manifestText: JSON.stringify(manifest), files: draft.files }))
  const before = await readFile(join(f.root, 'plugin-drafts.json'))
  const expected = /第 1 项贡献的第 1 个工具的第 1 组提问/
  for (const action of ['validate', 'build']) await assert.rejects(f.execute('build_plugin_draft', { ...ref(saved), action }), expected)
  await assert.rejects(f.prepare('install_plugin', { source: 'draft', ...ref(saved) }), expected)
  await assert.rejects(f.prepare('export_plugin_draft', ref(saved)), expected)
  assert.deepEqual(await readFile(join(f.root, 'plugin-drafts.json')), before)
  assert.deepEqual(await readdir(f.root), ['plugin-drafts.json']); assert.deepEqual((await f.manager.list()).plugins, [])
  recipe.tools[0].steps[0].args.question.questions[0].options[0].label = '人物'
  const repaired = data(await f.execute('save_plugin_draft', { ...ref(saved), manifestText: JSON.stringify(manifest), files: draft.files }))
  const valid = data(await f.execute('build_plugin_draft', { ...ref(repaired), action: 'validate' }))
  assert.equal(valid.manifest.version, '1.0.0')
  assert.equal((await f.prepare('install_plugin', { source: 'draft', ...ref(repaired) })).outcome.kind, 'waiting-input')
  assert.deepEqual((await f.manager.list()).plugins, [])
})

test('install requires the exact real answer; arbitrary approval, custom text and cancel cannot install', async () => {
  const f = await setup(), draft = await f.authoring.create('code'), args = { source: 'draft', ...ref(draft) }
  await assert.rejects(f.execute('install_plugin', { ...args, approved: true }), { code: 'AI_RESPONSE_INVALID' })
  const proposal = await f.prepare('install_plugin', args)
  const review = decodeAuthorActionReview(proposal.outcome.question.review)
  assert.match(review.sections[0].content, new RegExp(draft.pluginId))
  assert.equal((await f.manager.list()).plugins.length, 0)
  assert.equal(data(await proposal.resume('', '请快点执行')).status, 'cancelled')
  assert.equal(data(await (await f.prepare('install_plugin', args)).resume('cancel')).status, 'cancelled')
  assert.equal((await f.manager.list()).plugins.length, 0)
  const confirmed = await f.prepare('install_plugin', args), installed = data(await confirmed.resume())
  assert.equal(installed.status, 'installed')
  assert.deepEqual(data(await confirmed.resume()), installed)
  const index = await f.manager.list()
  assert.equal(index.plugins.length, 1); assert.equal(index.plugins[0].enabled, false); assert.deepEqual(index.plugins[0].versions[0].grants, [])
  assert.deepEqual(index.books, [])
  assert.equal(data(await f.execute('install_plugin', { source: 'file' })).status, 'cancelled')
})

test('confirmation rejects expired and cross-book checkpoints, and stale index cannot grant or uninstall', async () => {
  const f = await setup(), draft = await f.authoring.create('workflow'), install = await f.prepare('install_plugin', { source: 'draft', ...ref(draft) })
  await assert.rejects(install.resume('confirm', '', { ...install.outcome.checkpoint!, expires: 0 }), { code: 'CONFLICT' })
  await assert.rejects(install.resume('confirm', '', { ...install.outcome.checkpoint!, bookId: 'book-b' }), { code: 'CONFLICT' })
  await install.resume()
  const index = await f.manager.list(), args = { action: 'enable', id: draft.pluginId, revision: index.revision, grants: ['author.ask'] }
  const enable = await f.prepare('manage_plugin', args)
  await f.manager.setEnabled(draft.pluginId, true, [], index.revision)
  await assert.rejects(enable.resume(), { code: 'CONFLICT' })
  assert.deepEqual((await f.manager.list()).plugins[0].versions[0].grants, [])
  await assert.rejects(f.execute('manage_plugin', { ...args, revision: (await f.manager.list()).revision, grants: ['book.read'] }), { code: 'CONFLICT' })
  const remove = await f.prepare('manage_plugin', { action: 'uninstall', id: draft.pluginId, revision: (await f.manager.list()).revision })
  await remove.resume('cancel'); assert.equal((await f.manager.list()).plugins.length, 1)
})

test('book selection and contribution composition reuse real validation and do not expose other book identities', async () => {
  const f = await setup(), draft = await f.authoring.create('context')
  await (await f.prepare('install_plugin', { source: 'draft', ...ref(draft) })).resume()
  const manage = async (action: string, extra = {}) => (await f.prepare('manage_plugin', { action, id: draft.pluginId, revision: (await f.manager.list()).revision, ...extra })).resume()
  await manage('enable', { grants: [] }); await manage('book-use')
  let index = await f.manager.list(); await f.manager.setBookEnabled('secret-other-book', draft.pluginId, true, index.revision)
  index = await f.manager.list()
  const entries = [{ pluginId: draft.pluginId, digest: index.plugins[0].current, contributionId: 'voice', params: {} }]
  const preview = await f.prepare('compose_plugins', { revision: index.revision, entriesJson: JSON.stringify(entries) })
  assert.deepEqual((await f.manager.list()).books.find(b => b.id === 'book-a')?.composition?.entries ?? [], [])
  await preview.resume(); index = await f.manager.list()
  assert.deepEqual(index.books.find(b => b.id === 'book-a')?.composition?.entries, entries)
  const visible = data(await f.execute('list_plugins', { area: 'installed' }))
  assert.equal(JSON.stringify(visible).includes('secret-other-book'), false)
  assert.equal(visible.entries[0].bookEnabled, true)
  const conflict = data(await f.execute('compose_plugins', { revision: index.revision, entriesJson: JSON.stringify([{ ...entries[0], contributionId: 'missing' }]) }))
  assert.equal(conflict.status, 'conflict')
})

test('revocation persists settings and stops the controlling run when it also uses that plugin', async () => {
  const controller = new AbortController(), f = await setup(async () => { controller.abort() })
  const draft = await f.authoring.create('context')
  await (await f.prepare('install_plugin', { source: 'draft', ...ref(draft) })).resume()
  let index = await f.manager.list(); await f.manager.setEnabled(draft.pluginId, true, [], index.revision)
  index = await f.manager.list(); await f.manager.setBookEnabled('book-a', draft.pluginId, true, index.revision)
  const control = workbench(f.ports, 'book-a', controller)
  const disable = await control.prepare('manage_plugin', { action: 'disable', id: draft.pluginId, revision: (await f.manager.list()).revision })
  await assert.rejects(disable.resume(), { code: 'CONFLICT' })
  assert.equal(controller.signal.aborted, true)
  assert.equal((await f.manager.list()).plugins[0].enabled, false)
})

test('only trusted management tools may present an execution review; raw guest review is rejected', async () => {
  const f = await setup(), builtin = f.factory(f.journal).find(t => t.id === 'install_plugin')!
  const review = { title: '操作', summary: '真实预览', sections: [{ label: '内容', content: '<script>never executes</script>' }] }
  const question = { questions: [{ id: 'decision', mode: 'single', required: true, prompt: '确认？', options: [{ id: 'yes', label: '是' }, { id: 'no', label: '否' }] }], review }
  const registry = new WritingPluginRegistry()
  registry.register({ ...builtin, pluginId: 'test.guest', capabilities: ['author.ask'], inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: async () => ({ kind: 'waiting-input', question }) })
  const dispatcher = new WritingPluginDispatcher(registry, { workItemId: 'book-a', allowedCapabilities: new Set(['author.ask']), signal: new AbortController().signal, assertScope: async () => {} })
  await dispatcher.execute('discover_tools', '{}')
  await assert.rejects(dispatcher.execute(modelToolName('test.guest', builtin.id), '{}'), { code: 'AI_RESPONSE_INVALID' })
  assert.throws(() => decodeAuthorQuestionCard({ ...question, pluginId: 'test.guest', toolId: 'install', toolCallId: 'call', id: 'q', version: 1 }))
  assert.throws(() => decodeAuthorActionReview({ ...review, approved: true }))
  assert.throws(() => decodeAuthorActionReview({ ...review, sections: [{ label: 'too big', content: 'x'.repeat(400001) }] }))
})
