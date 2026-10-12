import assert from 'node:assert/strict'
import test from 'node:test'
import { cp, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { request as httpRequest } from 'node:http'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import JSZip from 'jszip'
import { decodeMarketPage, decodeMarketRelease, type PluginManifest } from '@lanjian/writing-plugin-contracts'
import { createMarketApp } from '../src/app.ts'
import { oidcIdentity } from '../src/adapters/oidc-auth.ts'

const keys = await generateKeyPair('RS256'), jwks = createLocalJWKSet({ keys: [await exportJWK(keys.publicKey)] })
const issuer = 'https://identity.example.test/realm', audience = 'writing-plugin-market'
const auth = oidcIdentity(issuer, audience, jwks)
async function token(subject = 'author-a', options: { issuer?: string; audience?: string; exp?: number; scope?: string } = {}) {
  return new SignJWT({ scope: options.scope ?? 'plugins:publish' }).setProtectedHeader({ alg: 'RS256' }).setIssuer(options.issuer ?? issuer).setAudience(options.audience ?? audience).setSubject(subject).setIssuedAt().setExpirationTime(options.exp ?? Math.floor(Date.now() / 1000) + 300).sign(keys.privateKey)
}
async function fixture(t: { after(fn: () => Promise<unknown>): void }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-market-'))), server = await createMarketApp(root, auth)
  await server.app.listen({ host: '127.0.0.1', port: 0 }); t.after(() => server.app.close())
  const address = server.app.server.address(); assert.ok(address && typeof address === 'object')
  const base = `http://127.0.0.1:${address.port}`, a = await token(), b = await token('author-b')
  const json = (path: string, data?: unknown, credential?: string) => fetch(base + path, { method: data === undefined ? 'GET' : 'POST', headers: { ...(data === undefined ? {} : { 'content-type': 'application/json' }), ...(credential ? { authorization: `Bearer ${credential}` } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) })
  return { ...server, root, base, a, b, json }
}
const query = { query: '', categories: [], tags: [], source: 'all', offset: 0, limit: 10 }
async function bundle(id = `personal.${randomUUID()}`, version = '1.0.0') {
  const schema = { type: 'object', properties: {}, additionalProperties: false } as const
  const manifest: PluginManifest = { id, name: '仙侠审阅工具', description: '合成测试，不含作品数据', version, apiVersion: 1, runtime: 'quickjs-js', entry: 'main.js', tools: [{ id: 'review', description: '测试工具', effect: 'derive', capabilities: [], inputSchema: schema, outputSchema: schema }], capabilities: [], categoryIds: ['genre', 'review'], tags: ['仙侠'] }
  const bytes = await new JSZip().file('lanjian-plugin.json', JSON.stringify(manifest)).file('main.js', 'export async function execute() { return {} }').generateAsync({ type: 'nodebuffer' })
  return { bytes, request: { operationId: randomUUID(), manifest, bytes: bytes.length, digest: createHash('sha256').update(bytes).digest('hex'), upstream: null } }
}
async function commit(f: Awaited<ReturnType<typeof fixture>>, pkg: Awaited<ReturnType<typeof bundle>>, credential = f.a) {
  const response = await f.json('/uploads/prepare', pkg.request, credential); assert.equal(response.status, 200)
  const prepared = await response.json() as { ticket: string }
  return fetch(`${f.base}/uploads/${pkg.request.operationId}`, { method: 'PUT', headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/zip', 'x-upload-ticket': prepared.ticket }, body: pkg.bytes })
}
test('real HTTP: explicit submit validates and publishes; independent anonymous client discovers exact bytes; private state is not listed', async t => {
  const f = await fixture(t), pkg = await bundle()
  assert.deepEqual(decodeMarketPage(await (await f.json('/catalog', query)).json()).releases, [])
  await f.json('/uploads/prepare', pkg.request, f.a)
  assert.deepEqual(decodeMarketPage(await (await f.json('/catalog', query)).json()).releases, [])
  const release = decodeMarketRelease(await (await commit(f, pkg)).json())
  assert.equal(release.state, 'published'); assert.equal(release.distribution, 'community'); assert.equal(release.manualReview, false)
  const otherClient = decodeMarketPage(await (await f.json('/catalog', { ...query, categories: ['genre', 'review'], tags: ['仙侠'], query: '审阅' })).json())
  assert.equal(otherClient.releases[0].digest, pkg.request.digest)
  const download = await fetch(`${f.base}/download/${release.operationId}/${release.digest}`); assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), pkg.bytes)
  assert.equal((await f.json(`/releases/${release.operationId}`, undefined, f.b)).status, 404)
  assert.deepEqual(decodeMarketPage(await (await f.json('/mine', { offset: 0, limit: 10 }, f.b)).json()).releases, [])
})
test('ownership and immutable versions are server controlled; forged official and extra upload fields fail', async t => {
  const f = await fixture(t), pkg = await bundle(); await commit(f, pkg)
  assert.equal((await f.json('/uploads/prepare', { ...pkg.request, operationId: randomUUID() }, f.a)).status, 409)
  const next = await bundle(pkg.request.manifest.id, '1.0.1')
  assert.equal((await f.json('/uploads/prepare', next.request, f.b)).status, 403)
  assert.equal((await f.json('/uploads/prepare', { ...next.request, official: true }, f.a)).status, 400)
  assert.equal((await f.json('/uploads/prepare', { ...next.request, manifest: { ...next.request.manifest, official: true } }, f.a)).status, 400)
  assert.equal((await f.json('/uploads/prepare', { ...next.request, manuscript: 'private' }, f.a)).status, 400)
})
test('idempotence, changed operations, invalid package and withdrawn downloads preserve immutable evidence', async t => {
  const f = await fixture(t), pkg = await bundle(), first = decodeMarketRelease(await (await commit(f, pkg)).json())
  assert.deepEqual(await (await commit(f, pkg)).json(), first)
  assert.equal((await f.json('/uploads/prepare', { ...pkg.request, digest: 'f'.repeat(64) }, f.a)).status, 409)
  const bad = await bundle(); bad.bytes = Buffer.from('not a zip'); bad.request.bytes = bad.bytes.length; bad.request.digest = createHash('sha256').update(bad.bytes).digest('hex')
  assert.equal((await (await commit(f, bad)).json() as { state: string }).state, 'validation-failed')
  assert.equal(decodeMarketPage(await (await f.json('/catalog', query)).json()).releases.length, 1)
  assert.equal((await f.json(`/releases/${first.operationId}/withdraw`, {}, f.b)).status, 404)
  assert.equal((await f.json(`/releases/${first.operationId}/withdraw`, {}, f.a)).status, 200)
  assert.equal((await fetch(`${f.base}/download/${first.operationId}/${first.digest}`)).status, 404)
  assert.deepEqual(await f.packages.read(first.digest), pkg.bytes)
})
test('signed fixture verifies issuer, audience, expiry and publication scope (not a browser login acceptance test)', async t => {
  const f = await fixture(t), pkg = await bundle()
  for (const credential of [undefined, await token('a', { issuer: 'https://forged.invalid' }), await token('a', { audience: 'wrong' }), await token('a', { exp: 1 }), await token('a', { scope: 'openid' })]) {
    assert.ok([401, 403].includes((await f.json('/uploads/prepare', pkg.request, credential)).status))
  }
  assert.equal((await f.json('/uploads/prepare', pkg.request, f.a)).status, 200)
})
test('restart reconciles object-before-catalog crash; offline consistent backup restores an independent service', async t => {
  const f = await fixture(t), pkg = await bundle(); await f.json('/uploads/prepare', pkg.request, f.a)
  f.catalog.transition(pkg.request.operationId, 'uploading', 'validating'); await f.packages.put(pkg.bytes, pkg.request.digest)
  await f.app.close()
  const restoredRoot = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-market-restore-'))); await cp(f.root, restoredRoot, { recursive: true })
  const recovered = await createMarketApp(restoredRoot, auth); t.after(() => recovered.app.close())
  assert.equal(recovered.catalog.get(pkg.request.operationId).state, 'published'); assert.deepEqual(await recovered.packages.read(pkg.request.digest), pkg.bytes)
  const orphan = await bundle(), owner = await auth(`Bearer ${f.a}`); recovered.catalog.prepare(owner.id, orphan.request); recovered.catalog.transition(orphan.request.operationId, 'uploading', 'validating')
  await recovered.service.reconcile(); assert.equal(recovered.catalog.get(orphan.request.operationId).state, 'validation-failed')
  await writeFile(join(restoredRoot, 'packages', `${pkg.request.digest}.zip`), 'tampered')
  await assert.rejects(recovered.service.download(pkg.request.operationId, pkg.request.digest))
  assert.deepEqual(await readFile(join(f.root, 'packages', `${pkg.request.digest}.zip`)), pkg.bytes)
})

test('expired tickets, unsupported capabilities and undeclared private files cannot become public', async t => {
  const f = await fixture(t), expired = await bundle(), prepared = await (await f.json('/uploads/prepare', expired.request, f.a)).json() as { ticket: string }
  const db = new DatabaseSync(join(f.root, 'catalog.sqlite')); db.prepare('UPDATE releases SET expires=0 WHERE operation=?').run(expired.request.operationId); db.close()
  const response = await fetch(`${f.base}/uploads/${expired.request.operationId}`, { method: 'PUT', headers: { authorization: `Bearer ${f.a}`, 'content-type': 'application/zip', 'x-upload-ticket': prepared.ticket }, body: expired.bytes })
  assert.equal(response.status, 409); await f.service.reconcile(); assert.equal(f.catalog.get(expired.request.operationId).failure, 'interrupted')
  for (const mode of ['undeclared', 'capability'] as const) {
    const pkg = await bundle(), zip = await JSZip.loadAsync(pkg.bytes)
    if (mode === 'undeclared') zip.file('private-manuscript.txt', 'must not be distributed')
    else { pkg.request.manifest.capabilities = ['network.fetch']; zip.file('lanjian-plugin.json', JSON.stringify(pkg.request.manifest)) }
    pkg.bytes = await zip.generateAsync({ type: 'nodebuffer' }); pkg.request.bytes = pkg.bytes.length; pkg.request.digest = createHash('sha256').update(pkg.bytes).digest('hex')
    const result = await commit(f, pkg); assert.equal(result.status, 200); assert.equal(decodeMarketRelease(await result.json()).state, 'validation-failed')
  }
  assert.deepEqual(decodeMarketPage(await (await f.json('/catalog', query)).json()).releases, [])
})

test('HTTP body and incoming upload concurrency are bounded before buffering a third upload', async t => {
  const f = await fixture(t)
  assert.equal((await f.json('/catalog', { ...query, query: 'x'.repeat(5000) })).status, 413)
  const sockets: ReturnType<typeof httpRequest>[] = []
  t.after(async () => { sockets.forEach(socket => socket.destroy()) })
  for (let i = 0; i < 2; i++) {
    const arrived = new Promise<void>(resolve => f.app.server.once('request', () => setImmediate(resolve)))
    const socket = httpRequest(`${f.base}/uploads/${randomUUID()}`, { method: 'PUT', headers: { authorization: `Bearer ${f.a}`, 'content-type': 'application/zip', 'content-length': '100' } })
    socket.on('error', () => {}); sockets.push(socket); socket.flushHeaders(); socket.write('x'); await arrived
  }
  const third = await fetch(`${f.base}/uploads/${randomUUID()}`, { method: 'PUT', headers: { authorization: `Bearer ${f.a}`, 'content-type': 'application/zip' }, body: 'small' })
  assert.equal(third.status, 429)
  sockets.forEach(socket => socket.destroy())
})

test('public version pages and owner pages are bounded and retain immutable older versions', async t => {
  const f = await fixture(t), first = await bundle()
  await commit(f, first)
  for (let i = 1; i < 12; i++) await commit(f, await bundle(first.request.manifest.id, `1.0.${i}`))
  const page = decodeMarketPage(await (await f.json('/versions', { pluginId: first.request.manifest.id, query })).json())
  assert.equal(page.releases.length, 10); assert.equal(page.nextOffset, 10)
  const older = decodeMarketPage(await (await f.json('/versions', { pluginId: first.request.manifest.id, query: { ...query, offset: page.nextOffset } })).json())
  assert.equal(older.releases.length, 2); assert.equal(older.nextOffset, null); assert.equal(older.releases[1].digest, first.request.digest)
  assert.equal(decodeMarketPage(await (await f.json('/mine', { offset: 0, limit: 10 }, f.a)).json()).releases.length, 10)
  assert.equal(decodeMarketPage(await (await f.json('/catalog', query)).json()).releases.length, 1)
})
