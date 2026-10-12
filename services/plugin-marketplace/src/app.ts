import Fastify, { type FastifyRequest } from 'fastify'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { codePluginLimits, decodeMarketQuery, decodePublishRequest, marketDigest, marketId, marketInt, marketOperation, marketRecord, marketText, pluginCategories } from '@lanjian/writing-plugin-contracts'
import { CatalogStore } from './adapters/catalog-store.ts'
import { PackageStore } from './adapters/package-store.ts'
import { PublishService } from './application/publish-service.ts'
import { MarketError, deny, type IdentityPort } from './domain/releases.ts'

const input = <T>(decode: () => T): T => { try { return decode() } catch { return deny(400, 'invalid-request') } }

export async function createMarketApp(root: string, identity: IdentityPort) {
  await mkdir(root, { recursive: true })
  const catalog = new CatalogStore(join(root, 'catalog.sqlite')), packages = await PackageStore.open(join(root, 'packages')), service = new PublishService(catalog, packages)
  await service.reconcile()
  const app = Fastify({ logger: false, bodyLimit: codePluginLimits.zipBytes, requestTimeout: 30000, connectionTimeout: 10000, keepAliveTimeout: 5000 })
  const rate = new Map<string, { expires: number; count: number }>()
  const uploads = new WeakSet<FastifyRequest>(); let incomingUploads = 0
  const releaseUpload = (request: FastifyRequest) => { if (uploads.delete(request)) incomingUploads-- }
  app.addHook('onRequest', async request => {
    const now = Date.now()
    for (const [ip, value] of rate) if (value.expires < now) rate.delete(ip)
    let entry = rate.get(request.ip)
    if (!entry) { if (rate.size >= 2048) return deny(429, 'request-limit'); entry = { expires: now + 60000, count: 0 }; rate.set(request.ip, entry) }
    if (++entry.count > 120) return deny(429, 'request-limit')
    if (request.method === 'PUT' && request.url.startsWith('/uploads/')) {
      if (incomingUploads >= 2) return deny(429, 'upload-busy')
      incomingUploads++; uploads.add(request)
    }
  })
  app.addHook('onResponse', async request => releaseUpload(request))
  app.addHook('onError', async request => releaseUpload(request))
  app.addHook('onTimeout', async request => releaseUpload(request))
  app.addHook('onRequestAbort', async request => releaseUpload(request))
  app.addContentTypeParser('application/zip', { parseAs: 'buffer' }, (_request, body, done) => done(null, body))
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof MarketError) return reply.status(error.status).send({ error: error.code })
    const code = (error as { statusCode?: number }).statusCode
    return reply.status(code === 413 ? 413 : code && code >= 400 && code < 500 ? code : 500).send({ error: code === 413 ? 'package-too-large' : 'request-failed' })
  })
  app.get('/health', async () => ({ ok: true }))
  app.get('/categories', async () => pluginCategories)
  app.post('/catalog', { bodyLimit: 4096 }, async request => catalog.catalog(input(() => decodeMarketQuery(request.body))))
  app.post('/versions', { bodyLimit: 8192 }, async request => { const v = input(() => marketRecord(request.body, ['pluginId', 'query'])); return catalog.catalog(input(() => decodeMarketQuery(v.query)), input(() => marketId(v.pluginId))) })
  app.post('/mine', { bodyLimit: 128 }, async request => { const owner = await identity(request.headers.authorization), v = input(() => marketRecord(request.body, ['offset', 'limit'])); return catalog.mine(owner.id, input(() => marketInt(v.offset, 0, 1000000)), input(() => marketInt(v.limit, 1, 10))) })
  app.get<{ Params: { operation: string } }>('/public/:operation', async request => {
    const release = catalog.get(input(() => marketOperation(request.params.operation)))
    if (release.state !== 'published') return deny(404, 'release-unavailable')
    return release
  })
  app.post('/uploads/prepare', { bodyLimit: codePluginLimits.manifestBytes + 4096 }, async request => catalog.prepare((await identity(request.headers.authorization)).id, input(() => decodePublishRequest(request.body))))
  app.put<{ Params: { operation: string } }>('/uploads/:operation', { preParsing: async request => { await identity(request.headers.authorization) } }, async request => {
    const owner = await identity(request.headers.authorization), ticket = input(() => marketText(request.headers['x-upload-ticket'], 36))
    if (!Buffer.isBuffer(request.body)) return deny(400, 'package-required')
    return service.commit(input(() => marketOperation(request.params.operation)), owner.id, ticket, request.body)
  })
  app.get<{ Params: { operation: string } }>('/releases/:operation', async request => catalog.get(input(() => marketOperation(request.params.operation)), (await identity(request.headers.authorization)).id))
  app.post<{ Params: { operation: string } }>('/releases/:operation/withdraw', { bodyLimit: 128 }, async request => {
    const operation = input(() => marketOperation(request.params.operation)), owner = await identity(request.headers.authorization), release = catalog.get(operation, owner.id)
    return release.state === 'withdrawn' ? release : catalog.transition(operation, 'published', 'withdrawn')
  })
  app.get<{ Params: { operation: string; digest: string } }>('/download/:operation/:digest', async (request, reply) => reply.type('application/zip').header('Cache-Control', 'no-store').send(await service.download(input(() => marketOperation(request.params.operation)), input(() => marketDigest(request.params.digest)))))
  app.addHook('onClose', async () => catalog.close())
  return { app, catalog, packages, service }
}
