import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, realpath, readdir, readFile, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginMarketStore } from '../../../src/main/modules/writing-plugins/adapters/market-store'
import { pluginDraftTemplate } from '../../../src/main/modules/writing-plugins/domain/draft-templates'
import { decodeMarketJournal } from '../../../src/main/modules/writing-plugins/domain/marketplace'
import type { MarketRelease } from '@lanjian/writing-plugin-contracts'
const fixture = () => {
  const bytes = Buffer.from('synthetic opaque package bytes'), digest = createHash('sha256').update(bytes).digest('hex')
  const request = { operationId: randomUUID(), digest, bytes: bytes.length, upstream: null, manifest: JSON.parse(pluginDraftTemplate(`personal.${randomUUID()}`, 'code').manifestText) }
  const release: MarketRelease = { ...request, publisherId: 'a'.repeat(64), state: 'published', distribution: 'community', createdAt: new Date().toISOString(), failure: null, manualReview: false }
  return { bytes, request, release }
}
test('market journal is zero-write on reads, restart-safe, origin-bound and preserves corrupt bytes', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-market-store-'))), origin = 'https://market.example.test', store = new PluginMarketStore(root, origin), f = fixture()
  assert.deepEqual((await store.read()).intents, []); assert.deepEqual(await readdir(root), [])
  await store.intent({ request: f.request, publisherId: f.release.publisherId, release: null }, f.bytes); await store.release(f.release)
  assert.equal((await new PluginMarketStore(root, origin).read()).intents[0].release!.digest, f.release.digest)
  await assert.rejects(new PluginMarketStore(root, 'https://other.example.test').read())
  const path = join(root, 'plugin-market.json'); await writeFile(path, '{broken')
  await assert.rejects(store.read()); await assert.rejects(store.download(f.release, f.bytes)); assert.equal(await readFile(path, 'utf8'), '{broken')
})
test('market receipt cannot substitute release metadata, and linked cache cannot write outside the controlled root', async () => {
  const f = fixture(), intent = { request: f.request, publisherId: f.release.publisherId, release: f.release }
  assert.throws(() => decodeMarketJournal({ origin: 'https://market.example.test', downloads: [], intents: [{ ...intent, release: { ...f.release, manifest: { ...f.release.manifest, name: 'substituted' } } }] }))
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-market-link-'))), outside = join(root, 'outside'), profile = join(root, 'profile')
  await mkdir(outside); await mkdir(profile); await symlink(outside, join(profile, 'plugin-market-packages'), process.platform === 'win32' ? 'junction' : 'dir')
  const store = new PluginMarketStore(profile, 'https://market.example.test'); await assert.rejects(store.download(f.release, f.bytes)); assert.deepEqual(await readdir(outside), [])
})
