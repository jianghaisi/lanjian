import { registerInspirationRoutes } from './inspiration-routes.ts'
import { readSite } from '../admin/site-store.ts'
import type { FastifyInstance, FastifyRequest, FastifyReply, HTTPMethods } from 'fastify'
import { integer, operation, record, uuid } from '@lanjian/hosted-contracts'
import * as decode from '../../../../desktop/src/contracts/ipc'
import { buildManuscriptExport, safeExportFileName } from '../../../../desktop/src/main/modules/manuscript/application/manuscript-export-service'
import type { Authenticated } from '../identity/identity-service.ts'
import type { HostedConfig } from '../config.ts'
import { HostedDatabase, digest, dbString } from '../storage/database.ts'
import { BookRegistry } from '../storage/books.ts'
import { CreditLedger } from '../credits/ledger.ts'
import { BookRuntimes, type BookRuntime } from '../writing/book-runtime.ts'
import { publicValue } from '../writing/public-value.ts'
import { ModelStore } from '../models/model-store.ts'
import { MeteredModels } from '../models/metered-client.ts'
import { HostedJobs } from '../tasks/jobs.ts'
import { assertTenantSpace } from '../files/quota.ts'
import { fail } from './errors.ts'
import { registerDomainRoutes } from './domain-routes.ts'
import { registerDesktopLibraryRoutes } from './desktop-library-routes.ts'
import { registerDesktopBookRoutes } from './desktop-book-routes.ts'
import { registerDesktopFileRoutes } from './desktop-file-routes.ts'
import { registerGroupChatRoutes } from './group-chat-routes.ts'

export interface WritingRouteContext {
  app: FastifyInstance; db: HostedDatabase; books: BookRegistry; credits: CreditLedger; config: HostedConfig
  auth: (request: FastifyRequest) => Authenticated
  write: (request: FastifyRequest) => Authenticated
  admin: (request: FastifyRequest, mutating?: boolean) => Authenticated
  rate: (key: string, limit: number) => void
  fetcher?: typeof fetch
}
export type BookRequest = FastifyRequest<{ Params: Record<string, string> }>
export function registerWritingRoutes(ctx: WritingRouteContext) {
  const { app, db, auth, write, admin } = ctx
  const runtimes = new BookRuntimes(db, ctx.books), models = new ModelStore(db, ctx.config)
  const meter = new MeteredModels(db, models, ctx.credits, ctx.fetcher), jobs = new HostedJobs(db, runtimes, meter)
  runtimes.modelAi = meter.ai
  const libraryModels = registerDesktopLibraryRoutes(ctx, runtimes, models)
  const desktopRuntime = registerDesktopBookRoutes(ctx, runtimes, jobs, models)
  const inspiration = registerInspirationRoutes(ctx, runtimes, models, meter)
  const groups = registerGroupChatRoutes(ctx, runtimes, jobs, models, meter, libraryModels, desktopRuntime, async owner => (await inspiration.account(owner)).library)
  registerDesktopFileRoutes(ctx, runtimes)
  const route = (method: HTTPMethods, path: string, run: (r: BookRuntime, request: BookRequest, reply: FastifyReply) => Promise<unknown>) => {
    app.route<{ Params: Record<string, string> }>({ method, url: `/api/books/:bookId${path}`, handler: async (request, reply) => {
      const current = method === 'GET' ? auth(request) : write(request), id = uuid(request.params.bookId)
      ctx.rate(`book-api:${current.user.id}`, 300)
      const work = () => runtimes.run(current.user.id, id, async r => {
        if (method !== 'GET') {
          const running = db.get("SELECT id FROM jobs WHERE owner_id=? AND status IN ('queued','running')", current.user.id)
          await assertTenantSpace(db.root, current.user.id, id, Buffer.byteLength(JSON.stringify(request.body ?? {})) * 3 + 128 * 1024 + (running ? 8 * 1024 * 1024 : 0), readSite(db).limits)
        }
        const result = await run(r, request, reply)
        return reply.sent ? result : publicValue(result, r.root, id)
      })
      // V3 reads also assemble file/SQLite snapshots. Order HTTP reads with writes
      // so an old tab's refresh cannot inspect a half-published mirror.
      return runtimes.mutations.run(id, work)
    } })
  }
  function definition<T>(path: string, read: (r: BookRuntime) => Promise<T>, parse: (v: unknown) => T, save: (r: BookRuntime, v: T) => Promise<T>) {
    route('GET', path, async r => { const data = await read(r); return { data, revision: digest(JSON.stringify(data)) } })
    route('PUT', path, async (r, request) => {
      const p = record(request.body, ['data', 'expectedRevision']), data = parse(p.data), previous = await read(r)
      if (p.expectedRevision !== digest(JSON.stringify(previous))) fail('conflict')
      const result = await save(r, data)
      return { data: result, revision: digest(JSON.stringify(result)) }
    })
  }
  definition('/profile', r => r.workspace.bookProfile(), v => decode.decodeBookProfileArgs([v])[0], (r, v) => r.workspace.saveBookProfile(v))
  definition('/foundation', r => r.workspace.foundation(), v => decode.decodeFoundationArgs([v])[0], (r, v) => r.workspace.saveFoundation(v))
  definition('/realms', r => r.workspace.realms(), v => ({ levels: decode.decodeRealmsArgs([record(v, ['levels']).levels])[0] }), (r, v) => r.workspace.saveRealms(v.levels))
  definition('/power-system', r => r.workspace.powerSystem(), v => decode.decodePowerSystemArgs([v])[0], (r, v) => r.workspace.savePowerSystem(v))
  definition('/cheat-system', r => r.workspace.cheatSystem(), v => decode.decodeCheatSystemArgs([v])[0], (r, v) => r.workspace.saveCheatSystem(v))
  definition('/system-template', r => r.workspace.systemTemplate(), v => ({ template: decode.decodeSystemTemplateArgs([record(v, ['template']).template])[0] }), (r, v) => r.workspace.saveSystemTemplate(v.template))
  route('GET', '/workspace', async r => ({
    chapters: await r.documents.chapters(), outlines: await r.documents.outlines(), planning: await r.planning.status(),
    profile: await r.workspace.bookProfile(), foundationStatus: await r.workspace.foundationStatus(), sources: await r.research.listSources(),
    events: await r.events.projection.read(), characters: await r.manuscripts.storyEntities(r.root), planningPackage: await jobs.services(r).packages.get()
  }))
  route('GET', '/chapters', r => r.documents.chapters())
  route('POST', '/chapters', async (r, request) => {
    const p = record(request.body, ['operation']), key = operation(p.operation), scope = `chapter:${request.params.bookId}`
    const old = db.get('SELECT result FROM receipts WHERE scope=? AND operation=?', scope, key)
    if (old) {
      const receipt = record(JSON.parse(dbString(old.result)))
      if (receipt.status !== 'complete') fail('conflict')
      return r.documents.chapter(integer(receipt.id, 1, 100000))
    }
    if ((await r.documents.chapters()).length >= 500) fail('quota-exceeded')
    db.run('INSERT INTO receipts VALUES(?,?,?,?,?)', scope, key, digest('{}'), JSON.stringify({ status: 'pending' }), db.now())
    const chapter = await r.documents.createChapter()
    db.run('UPDATE receipts SET result=? WHERE scope=? AND operation=?', JSON.stringify({ status: 'complete', id: chapter.id }), scope, key)
    return chapter
  })
  route('GET', '/chapters/:id', (r, request) => r.documents.chapter(integer(Number(request.params.id), 1, 100000)))
  route('PUT', '/chapters/:id', async (r, request) => {
    const p = record(request.body, ['title', 'content', 'expectedRevision'])
    if (typeof p.expectedRevision !== 'string' || !p.expectedRevision) fail('invalid-request')
    const [id, data] = decode.decodeChapterUpdateArgs([Number(request.params.id), p])
    return r.documents.updateChapter(id, data)
  })
  route('GET', '/chapters/:id/history', (r, request) => r.documents.revisions(integer(Number(request.params.id), 1, 100000)))
  route('POST', '/chapters/:id/restore', async (r, request) => {
    const p = record(request.body, ['revisionId', 'expectedRevision']), id = integer(Number(request.params.id), 1, 100000)
    if ((await r.documents.chapter(id)).revision !== p.expectedRevision) fail('conflict')
    const [, version] = decode.decodeChapterRevisionArgs([id, p.revisionId])
    return r.documents.restoreRevision(id, version)
  })
  route('GET', '/export', async (r, request, reply) => {
    const q = record(request.query, ['format']), format = q.format ?? 'markdown'
    if (format !== 'markdown' && format !== 'txt') fail('invalid-request')
    const snapshot = await r.exports.prepare(), content = buildManuscriptExport(snapshot.title, snapshot.chapters, format)
    const filename = `${safeExportFileName(snapshot.title)}.${format === 'markdown' ? 'md' : 'txt'}`
    return reply.header('content-type', 'text/plain; charset=utf-8').header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`).send(content)
  })
  route('GET', '/outlines/:volume', (r, request) => r.documents.outline(decode.decodeOutlineVolumeArgs([request.params.volume === 'total' ? 'total' : Number(request.params.volume)])[0]))
  route('PUT', '/outlines/:volume', async (r, request) => {
    const p = record(request.body, ['content', 'expectedRevision']), [volume, content] = decode.decodeOutlineUpdateArgs([request.params.volume === 'total' ? 'total' : Number(request.params.volume), p.content])
    if (p.expectedRevision !== digest((await r.documents.outline(volume)).content)) fail('conflict')
    return r.planning.updateOutline(volume, content)
  })
  route('POST', '/outlines/:volume/confirm', async (r, request) => r.planning.confirmPlanningOutline(decode.decodeOutlineVolumeArgs([request.params.volume === 'total' ? 'total' : Number(request.params.volume)])[0]))
  route('POST', '/outlines/:volume/acknowledge', async (r, request) => r.planning.acknowledgeOutlineReview(decode.decodeOutlineVolumeArgs([request.params.volume === 'total' ? 'total' : Number(request.params.volume)])[0]))
  route('GET', '/planning/status', async (r, request) => {
    const q = record(request.query, ['chapterId']), chapterId = q.chapterId === undefined ? undefined : integer(Number(q.chapterId), 1, 100000)
    return { planning: await r.planning.status(chapterId), foundation: await r.workspace.foundationStatus(chapterId) }
  })
  route('GET', '/chapter-outlines/:id', (r, request) => r.documents.chapterOutline(integer(Number(request.params.id), 1, 100000)))
  route('PUT', '/chapter-outlines/:id', async (r, request) => {
    const p = record(request.body, ['content', 'expectedRevision', 'volume']), [id, content] = decode.decodeChapterOutlineUpdateArgs([Number(request.params.id), p.content])
    const volume = p.volume === undefined ? undefined : integer(p.volume, 1, 100)
    if (p.expectedRevision !== digest((await r.documents.chapterOutline(id)).content)) fail('conflict')
    return r.planning.updateChapterOutline(id, content, volume)
  })
  route('POST', '/chapter-outlines/:id/confirm', (r, request) => r.planning.confirmChapterOutline(integer(Number(request.params.id), 1, 100000)))
  route('POST', '/volumes', (r, request) => r.planning.createVolume(decode.decodeOutlineVolumeCreateArgs([record(request.body, ['title']).title])[0]))
  route('GET', '/sources', r => r.research.listSources())
  route('POST', '/sources', (r, request) => r.research.createSource(decode.decodeSourceCardCreateArgs([request.body])[0]))
  route('PUT', '/sources/:id', async (r, request) => {
    const p = record(request.body, ['data', 'expectedRevision']), id = uuid(request.params.id)
    const source = (await r.research.listSources()).sources.find(item => item.id === id)
    if (!source) fail('not-found')
    if (p.expectedRevision !== source.contentHash) fail('conflict')
    const [, data] = decode.decodeSourceCardUpdateArgs([id, p.data])
    return r.research.updateSource(id, data)
  })
  route('GET', '/characters', r => r.manuscripts.storyEntities(r.root))
  route('POST', '/characters', async (r, request) => {
    const { expectedUpdatedAt, ...input } = record(request.body)
    const data = decode.decodeStoryEntityArgs([input])[0]
    if (data.id) {
      const previous = (await r.manuscripts.storyEntities(r.root)).find(item => item.id === data.id)
      if (!previous) fail('not-found')
      if (previous.updatedAt !== expectedUpdatedAt) fail('conflict')
    } else if (expectedUpdatedAt !== undefined) fail('invalid-request')
    return r.manuscripts.saveStoryEntity(r.root, data)
  })
  route('GET', '/events', r => r.events.projection.read())
  route('POST', '/events/preview', (r, request) => r.events.operations.preview(decode.decodeEventOperationPreviewArgs([request.body])[0]))
  route('POST', '/events/commit', (r, request) => r.events.operations.commit(decode.decodeEventOperationTokenArgs([record(request.body, ['token']).token])[0]))
  route('POST', '/events/initialize-preview', r => r.events.stateInitialization.preview())
  route('POST', '/events/initialize-commit', (r, request) => r.events.stateInitialization.commit(decode.decodeEventOperationTokenArgs([record(request.body, ['token']).token])[0]))
  route('POST', '/events/:id/place', (r, request) => r.planning.placeEvent(uuid(request.params.id), record(request.body, ['volume']).volume === null ? null : integer(record(request.body).volume, 1, 100)))
  route('POST', '/events/:id/chapter', (r, request) => r.planning.placeEventInChapter(uuid(request.params.id), integer(record(request.body, ['chapterId']).chapterId, 1, 100000)))
  route('GET', '/jobs', async (_r, request) => jobs.list(auth(request).user.id, request.params.bookId!))
  // Long-running generation releases the HTTP write lane after creating its durable job.
  app.post<{ Params: { bookId: string } }>('/api/books/:bookId/jobs', request => jobs.start(write(request).user.id, uuid(request.params.bookId), request.body))
  app.get<{ Params: { bookId: string; id: string } }>('/api/books/:bookId/jobs/:id', request => jobs.view(auth(request).user.id, uuid(request.params.bookId), uuid(request.params.id)))
  app.post<{ Params: { bookId: string; id: string } }>('/api/books/:bookId/jobs/:id/cancel', request => jobs.cancel(write(request).user.id, uuid(request.params.bookId), uuid(request.params.id)))
  route('POST', '/writing/apply', (r, request) => jobs.services(r).approvals.apply(decode.decodeWritingAgentArtifactApplicationArgs([request.body])[0]))
  app.get('/api/models', async request => { auth(request); const m = models.selected(); return { models: m ? [{ id: m.id, name: m.name, model: m.model, maxOutputTokens: m.maxOutputTokens, price: ctx.credits.price(m.id) }] : [] } })
  app.get('/api/admin/models', async request => { admin(request); return { models: models.list() } })
  app.get('/api/admin/active-model', async request => { admin(request); return models.selection() })
  app.put('/api/admin/active-model', async request => {
    const actor = admin(request, true).user.id, input = record(request.body, ['modelId', 'expectedRevision'])
    if (input.modelId !== null && ctx.credits.price(String(input.modelId)).policy.mode === 'unconfigured') fail('pricing-required')
    return models.select(actor, input)
  })
  app.put<{ Params: { id: string } }>('/api/admin/models/:id', async request => models.update(admin(request, true).user.id, request.params.id, request.body))
  registerDomainRoutes({ route, jobs })
  return { runtimes, models, meter, jobs, groups, inspiration, route }
}
export type HostedWritingRoutes = ReturnType<typeof registerWritingRoutes>
