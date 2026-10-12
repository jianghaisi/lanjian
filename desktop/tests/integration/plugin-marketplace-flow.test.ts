import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, realpath, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMarketApp } from '../../../services/plugin-marketplace/dist/app.js'
import { oidcIdentity } from '../../../services/plugin-marketplace/dist/adapters/oidc-auth.js'
import { oidcFixture } from '../helpers/plugin-oidc-fixture'
import { AppError } from '../../src/main/core/errors/app-error'
import { MarketplaceAuth } from '../../src/main/modules/writing-plugins/adapters/marketplace-auth'
import { MarketplaceClient } from '../../src/main/modules/writing-plugins/adapters/market-client'
import { PluginMarketStore } from '../../src/main/modules/writing-plugins/adapters/market-store'
import { PluginDraftStore } from '../../src/main/modules/writing-plugins/adapters/draft-store'
import { PluginPackageStore } from '../../src/main/modules/writing-plugins/adapters/package-store'
import { readPluginPackage } from '../../src/main/modules/writing-plugins/adapters/package-reader'
import { buildPluginDraft } from '../../src/main/modules/writing-plugins/adapters/draft-builder'
import { bundledPackagePorts } from '../../src/main/modules/writing-plugins/adapters/bundled-packages'
import { BundledPluginService } from '../../src/main/modules/writing-plugins/application/bundled-service'
import { PluginAuthoringService } from '../../src/main/modules/writing-plugins/application/authoring-service'
import { PluginMarketplaceService } from '../../src/main/modules/writing-plugins/application/marketplace-service'
import { WritingPluginManager } from '../../src/main/modules/writing-plugins/application/plugin-manager'
import { PluginCompositionService } from '../../src/main/modules/writing-plugins/application/composition-service'
import { workbench, data } from '../helpers/plugin-workbench'

const query = { query: '', categories: [], tags: [], source: 'all' as const, offset: 0, limit: 10 }
test('model tools use real public catalog and immutable publication, and only author confirmation permits upload or withdrawal', async t => {
  const f = await fixture(t), owner = await f.client(), anonymous = await f.client()
  const attach = (client: typeof owner) => workbench({ ...client, composition: new PluginCompositionService(client.manager), choosePackage: async () => null })
  const a = attach(owner), b = attach(anonymous)
  await owner.login()
  const draft = await owner.authoring.create('code'), args = { id: draft.id, revision: draft.revision }
  const cancelled = await a.prepare('publish_plugin', args)
  assert.match(JSON.stringify(cancelled.outcome.question.review), /main.js/)
  assert.equal(f.requests.length, 0)
  await cancelled.resume('cancel'); assert.equal(f.requests.length, 0)
  const publish = await a.prepare('publish_plugin', args), release = data(await publish.resume())
  assert.equal(release.state, 'published'); assert.equal(release.distribution, 'community')
  assert.deepEqual(data(await publish.resume()), release)
  assert.equal(f.requests.filter(r => r.startsWith('PUT')).length, 1)
  const catalog = data(await b.execute('search_plugin_market', {}))
  assert.equal(catalog.releases[0].digest, release.digest)
  const detail = data(await b.execute('read_market_plugin', { operationId: release.operationId }))
  assert.equal(detail.manifest.id, draft.pluginId)
  const install = await b.prepare('install_plugin', { source: 'market', operationId: release.operationId, digest: release.digest })
  assert.equal((await anonymous.manager.list()).plugins.length, 0)
  await install.resume(); assert.equal((await anonymous.manager.list()).plugins[0].enabled, false)
  const staleDownload = await b.prepare('install_plugin', { source: 'market', operationId: release.operationId, digest: release.digest })
  const withdrawal = await a.prepare('manage_plugin_publication', { action: 'withdraw', operationId: release.operationId })
  assert.equal(data(await b.execute('search_plugin_market', {})).releases.length, 1)
  await withdrawal.resume()
  assert.equal(data(await b.execute('search_plugin_market', {})).releases.length, 0)
  await assert.rejects(staleDownload.resume())
  assert.equal((await anonymous.manager.list()).plugins.length, 1)
  const status = data(await a.execute('list_plugins', { area: 'market' }))
  assert.equal(status.entries[0].state, 'withdrawn')
  assert.equal(/access_token|refresh_token|clientRoot|draftsPath/.test(JSON.stringify(status)), false)
})

test('model publication confirmation rejects a draft edited after preview without uploading', async t => {
  const f = await fixture(t), owner = await f.client(); await owner.login()
  const a = workbench({ ...owner, composition: new PluginCompositionService(owner.manager), choosePackage: async () => null })
  const draft = await owner.authoring.create('code'), publish = await a.prepare('publish_plugin', { id: draft.id, revision: draft.revision })
  await owner.authoring.save({ ...draft, files: [{ ...draft.files[0], content: draft.files[0].content + '// changed' }] })
  await assert.rejects(publish.resume(), { code: 'CONFLICT' })
  assert.deepEqual(f.requests, [])
})
async function fixture(t: { after(fn: () => Promise<unknown>): void }) {
  const identity = await oidcFixture(); t.after(() => identity.close())
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-market-desktop-'))), server = await createMarketApp(join(root, 'server'), oidcIdentity(identity.origin, 'market-test', new URL('/jwks', identity.origin)))
  t.after(() => server.app.close()); const requests: string[] = []; server.app.addHook('onRequest', async (request: { method: string; url: string }) => { requests.push(`${request.method} ${request.url}`) })
  await server.app.listen({ host: '127.0.0.1', port: 0 }); const address = server.app.server.address(); if (!address || typeof address === 'string') throw new Error('Missing address')
  const origin = `http://127.0.0.1:${address.port}`
  async function client() {
    const clientRoot = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-market-client-'))), drafts = new PluginDraftStore(clientRoot), packages = new PluginPackageStore(clientRoot), manager = new WritingPluginManager(packages, async () => {})
    const authoring = new PluginAuthoringService(drafts, { build: buildPluginDraft, persist: b => drafts.persist(b), chooseExport: async () => null, choosePackage: async () => null, chooseSource: async () => null, installed: async (id, digest) => { const version = (await manager.list()).plugins.find(p => p.id === id)!.versions.find(v => v.digest === digest)!; return { manifest: version.manifest, files: await packages.load(version) } } }, manager)
    let opened = ''
    const deployment = { origin, issuer: identity.origin, clientId: 'desktop-test', testLoopback: true }, auth = new MarketplaceAuth(deployment, async url => { opened = url }), http = new MarketplaceClient(deployment, () => auth.token()), store = new PluginMarketStore(clientRoot, origin)
    const market = new PluginMarketplaceService(authoring, manager, { auth, client: http, store, validate: readPluginPackage })
    return { root: clientRoot, authoring, manager, auth, http, store, market, bundled: new BundledPluginService(bundledPackagePorts(clientRoot), manager, authoring), login: async () => { await market.login(); assert.equal(await auth.callback(identity.code(opened)), true) } }
  }
  return { root, server, origin, client, requests }
}
test('real service and two isolated desktop clients: private draft zero-upload, publish, anonymous download, default-disabled install and provenance', async t => {
  const f = await fixture(t), a = await f.client(), b = await f.client()
  const draft = await a.authoring.create('code'), privateDraft = await a.authoring.create('context')
  await a.authoring.save({ id: privateDraft.id, revision: privateDraft.revision, manifestText: 'PRIVATE-NOVEL-SECRET-DO-NOT-UPLOAD', files: privateDraft.files })
  await writeFile(join(a.root, 'unrelated-manuscript.txt'), 'PRIVATE-NOVEL-SECRET-DO-NOT-UPLOAD')
  assert.deepEqual(f.requests, []); await a.login()
  const preview = await a.market.preview({ id: draft.id, revision: draft.revision }); assert.deepEqual(f.requests, [])
  const release = await a.market.publish(preview.planId); assert.equal(release.state, 'published'); await assert.rejects(a.market.publish(preview.planId))
  assert.equal((await b.market.catalog(query)).releases[0].digest, release.digest)
  const install = await b.market.previewDownload({ ...release, distribution: 'official' }); await b.market.beforeInstall(install.planId); await b.manager.install(install.planId)
  const index = await b.manager.list(); assert.equal(index.plugins[0].enabled, false); assert.deepEqual(index.plugins[0].versions[0].grants, [])
  assert.deepEqual(await b.market.provenance(release.manifest.id, release.digest), { distribution: 'community', createdByMe: false })
  assert.deepEqual(await a.market.provenance(release.manifest.id, release.digest), { distribution: 'community', createdByMe: true })
  const bytes = await f.server.packages.read(release.digest); assert.equal(bytes.includes(Buffer.from('PRIVATE-NOVEL-SECRET-DO-NOT-UPLOAD')), false)
  const archive = await readPluginPackage(bytes); assert.deepEqual([...archive.files.keys()], ['lanjian-plugin.json', 'main.js'])
  assert.equal(await readFile(join(a.root, 'unrelated-manuscript.txt'), 'utf8'), 'PRIVATE-NOVEL-SECRET-DO-NOT-UPLOAD')
  assert.equal((await b.market.status()).auth.state, 'signed-out')
})
test('stale draft and changed identity invalidate publication preview before any upload', async t => {
  const f = await fixture(t), a = await f.client(); await a.login(); const draft = await a.authoring.create('code')
  const p = await a.market.preview({ id: draft.id, revision: draft.revision })
  const saved = await a.authoring.save({ id: draft.id, revision: draft.revision, manifestText: draft.manifestText, files: [{ ...draft.files[0], content: draft.files[0].content + '//new' }] })
  await assert.rejects(a.market.publish(p.planId)); assert.deepEqual(f.requests, [])
  const another = await a.market.preview({ id: saved.id, revision: saved.revision }); await a.market.logout(); await assert.rejects(a.market.publish(another.planId)); assert.deepEqual(f.requests, [])
})
test('unknown commit result is persisted and resolved by status without creating a second version', async t => {
  const f = await fixture(t), a = await f.client(); await a.login(); const draft = await a.authoring.create('code'), p = await a.market.preview({ id: draft.id, revision: draft.revision })
  const commit = a.http.commit.bind(a.http)
  a.http.commit = async (...args) => { await commit(...args); throw new AppError('FEATURE_UNAVAILABLE', 'synthetic lost response') }
  await assert.rejects(a.market.publish(p.planId)); assert.equal((await a.market.status()).pending[0].operationId, p.request.operationId)
  a.http.commit = commit
  const recovered = await a.market.retry(p.request.operationId); assert.equal(recovered.state, 'published'); assert.equal(f.requests.filter(r => r.startsWith('PUT')).length, 1)
  assert.equal((await a.market.status()).pending.length, 0)
})
test('withdrawal between download and confirmation blocks install and preserves existing installed version', async t => {
  const f = await fixture(t), a = await f.client(), b = await f.client(); await a.login()
  const draft = await a.authoring.create('code'), release = await a.market.publish((await a.market.preview({ id: draft.id, revision: draft.revision })).planId)
  const first = await b.market.previewDownload(release); await b.market.beforeInstall(first.planId); await b.manager.install(first.planId)
  const again = await b.market.previewDownload(release), before = await readFile(join(b.root, 'plugin-index.json'))
  await a.market.withdraw(release.operationId); await assert.rejects(b.market.beforeInstall(again.planId))
  assert.deepEqual(await readFile(join(b.root, 'plugin-index.json')), before); assert.deepEqual((await b.market.catalog(query)).releases, [])
  const index = await b.manager.list(); assert.equal(index.plugins[0].current, release.digest)
})
test('tampered download and offline errors leave local drafts and installed packages usable', async t => {
  const f = await fixture(t), a = await f.client(), b = await f.client(); await a.login()
  const draft = await a.authoring.create('code'), release = await a.market.publish((await a.market.preview({ id: draft.id, revision: draft.revision })).planId)
  const originalDownload = b.http.download.bind(b.http); b.http.download = async () => Buffer.from('tampered response')
  await assert.rejects(b.market.previewDownload(release)); assert.equal((await b.manager.list()).plugins.length, 0); assert.deepEqual(await readdir(b.root), [])
  b.http.download = originalDownload; await f.server.app.close()
  await assert.rejects(b.market.catalog(query)); assert.ok(await b.authoring.create('context')); assert.equal((await b.authoring.list()).length, 1)
  await assert.rejects(a.market.refresh(release.operationId)); assert.equal((await a.market.status()).publications[0].state, 'published')
})

test('published changes require a new immutable version; added permissions, explicit switching and rollback preserve prior grants', async t => {
  const f = await fixture(t), a = await f.client(), b = await f.client(); await a.login()
  const draft = await a.authoring.create('code'), first = await a.market.publish((await a.market.preview({ id: draft.id, revision: draft.revision })).planId)
  const install = await b.market.previewDownload(first); await b.market.beforeInstall(install.planId); let index = await b.manager.install(install.planId)
  index = await b.manager.setEnabled(draft.pluginId, true, [], index.revision); index = await b.manager.setBookEnabled('synthetic-book', draft.pluginId, true, index.revision)
  const changed = await a.authoring.save({ ...draft, files: [{ ...draft.files[0], content: draft.files[0].content + '//changed' }] })
  await assert.rejects(a.authoring.build({ id: changed.id, revision: changed.revision }))
  const manifest = JSON.parse(changed.manifestText); manifest.version = '1.1.0'; manifest.capabilities = ['book.read']
  const next = await a.authoring.save({ ...changed, manifestText: JSON.stringify(manifest) }), second = await a.market.publish((await a.market.preview({ id: next.id, revision: next.revision })).planId)
  const update = await b.market.previewDownload(second); assert.deepEqual(update.addedCapabilities, ['book.read'])
  await b.market.beforeInstall(update.planId); index = await b.manager.install(update.planId)
  assert.equal(index.plugins[0].current, first.digest); assert.equal(index.plugins[0].enabled, true)
  assert.deepEqual(index.plugins[0].versions.find(v => v.digest === second.digest)!.grants, [])
  index = await b.manager.selectVersion(draft.pluginId, second.digest, [], index.revision)
  await assert.rejects(b.manager.authorize('synthetic-book', draft.pluginId, second.digest, 'book.read'))
  index = await b.manager.setEnabled(draft.pluginId, true, ['book.read'], index.revision)
  await b.manager.authorize('synthetic-book', draft.pluginId, second.digest, 'book.read')
  index = await b.manager.selectVersion(draft.pluginId, first.digest, [], index.revision)
  assert.equal(index.plugins[0].current, first.digest); assert.equal(index.plugins[0].versions.length, 2)
  await f.server.app.close(); assert.equal((await b.manager.capture('synthetic-book'))[0].digest, first.digest)
})
