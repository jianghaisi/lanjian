import { registerAdminRoutes } from '../admin/routes.ts'
import Fastify, { type FastifyRequest } from 'fastify'
import { ContractError, capabilities, boolean, integer, operation, record, text, uuid } from '@lanjian/hosted-contracts'
import type { HostedConfig } from '../config.ts'
import { IdentityService, type Authenticated } from '../identity/identity-service.ts'
import { type OAuthProvider } from '../identity/linuxdo.ts'
import { createAuthRuntime } from '../identity/auth-runtime.ts'
import { HostedDatabase } from '../storage/database.ts'
import { BookRegistry } from '../storage/books.ts'
import { CreditLedger } from '../credits/ledger.ts'
import { HostedError, fail } from './errors.ts'
import { registerWritingRoutes } from './writing-routes.ts'
import { AppError } from '../../../../desktop/src/contracts/core/app-error'
import { referenceBook, referenceMarkdown } from '../reference/book.ts'
import { ReferenceCopies } from '../reference/copies.ts'
import guestSnapshot from '../reference/guest-snapshot.json' with { type: 'json' }

export interface AppOptions { config: HostedConfig; database?: HostedDatabase; oauth?: OAuthProvider; modelFetcher?: typeof fetch }
export function buildApp(options: AppOptions) {
  const { config } = options
  const db = options.database ?? new HostedDatabase(config.dataDir)
  const identity = new IdentityService(db, config), books = new BookRegistry(db), credits = new CreditLedger(db)
  const authentication = createAuthRuntime(config, identity, options.oauth)
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024, requestTimeout: 30000, connectionTimeout: 15000, trustProxy: false,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } })
  const sessions = new WeakMap<FastifyRequest, Authenticated>()
  const auth = (request: FastifyRequest) => { const session = sessions.get(request); if (!session) fail('login-required'); return session }
  app.addHook('onReady', () => authentication.ready())
  const write = (request: FastifyRequest) => { const current = auth(request); identity.csrf(current, request.headers.origin, request.headers['x-csrf-token']); return current }
  const admin = (request: FastifyRequest, mutating = false) => {
    const current = mutating ? write(request) : auth(request)
    if (current.user.role !== 'admin') fail('admin-required')
    return current
  }
  const rates = new Map<string, { count: number; until: number }>()
  function rate(key: string, limit: number) {
    const now = db.now()
    if (rates.size >= 10000) for (const [id, bucket] of rates) if (bucket.until <= now) rates.delete(id)
    const previous = rates.get(key)
    if (previous && previous.until > now) { if (++previous.count > limit) fail('request-limit') }
    else { if (rates.size >= 10000) fail('request-limit'); rates.set(key, { count: 1, until: now + 60000 }) }
  }
  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'no-store').header('x-content-type-options', 'nosniff').header('referrer-policy', 'no-referrer')
    rate(`ip:${request.ip}`, 1200)
    if (request.url.startsWith('/api/') && !request.url.startsWith('/api/auth/linuxdo/')) {
      const current = await authentication.current(request)
      if (current) sessions.set(request, current)
    }
  })
  app.setErrorHandler((error, _request, reply) => {
    const domain = error instanceof AppError ? new HostedError(error.code === 'VALIDATION_ERROR' ? 'invalid-request' : error.code === 'CONFLICT' ? 'conflict' : error.code === 'NOT_FOUND' ? 'not-found' : error.code === 'FEATURE_UNAVAILABLE' ? 'configuration-required' : 'internal-error') : undefined
    const known = domain ?? (error instanceof HostedError ? error : error instanceof ContractError || (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 400)
      ? new HostedError('invalid-request') : error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 413
        ? new HostedError('request-too-large') : new HostedError('internal-error'))
    reply.code(known.status).send({ error: { code: known.code, message: known.publicMessage } })
  })
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: request.url.startsWith('/api/') && request.url.includes('/desktop/')
    ? { code: 'feature-unavailable', message: '网页版暂时没有这个功能。' }
    : { code: 'not-found', message: '内容不存在或不可访问。' } }))
  app.get('/health', async () => ({ status: 'ok' }))
  // Immutable bundled sample only: no identity, wallet, user book or model access.
  app.get('/api/guest-reference', async (_request, reply) => reply.header('cache-control', 'public, max-age=300').send(guestSnapshot))
  app.get('/api/capabilities', async () => ({ ...capabilities, loginConfigured: Boolean(config.oauth) }))
  app.get('/api/auth/linuxdo/start', async (request, reply) => {
    rate(`login:${request.ip}`, 60)
    if (!config.oauth) fail('configuration-required')
    const started = await authentication.start(request)
    return reply.header('set-cookie', started.cookies).redirect(started.url)
  })
  app.get('/api/auth/linuxdo/callback', async (request, reply) => {
    const response = await authentication.callback(request)
    const location = response.headers.get('location')
    reply.header('set-cookie', response.headers.getSetCookie())
    // Do not expose provider error_description, codes or library diagnostic pages.
    if (location === `${config.origin}/app`) return reply.redirect('/app')
    if (location) {
      const error = new URL(location, config.origin).searchParams.get('error')
      if (error === 'access_denied') return reply.redirect('/app?login=cancelled')
      if (error?.startsWith('state_')) fail('oauth-state-invalid')
    }
    fail('oauth-failed')
  })
  app.get('/api/me', async request => { const current = auth(request); return { user: current.user, wallet: credits.wallet(current.user.id), csrfToken: current.csrf, capabilities } })
  app.post('/api/auth/logout', async (request, reply) => {
    write(request)
    const response = await authentication.logout(request)
    if (!response.ok) fail('oauth-failed')
    return reply.header('set-cookie', response.headers.getSetCookie()).send({ ok: true })
  })
  app.get('/api/books', async request => ({ books: books.list(auth(request).user.id) }))
  app.post('/api/books', async request => { const current = write(request); rate(`books:${current.user.id}`, 30); return books.create(current.user.id, request.body) })
  app.get<{ Params: { id: string } }>('/api/books/:id', async request => books.get(auth(request).user.id, request.params.id))
  app.get('/api/credits', async request => { const id = auth(request).user.id; return { wallet: credits.wallet(id), entries: credits.entries(id), pending: credits.pending(id) } })
  app.get('/api/admin/users', async request => { admin(request); return { users: identity.list().map(user => ({ ...user, wallet: credits.wallet(user.id) })) } })
  app.post('/api/admin/credits', async request => credits.grant(admin(request, true).user.id, request.body))
  app.put<{ Params: { id: string } }>('/api/admin/users/:id/status', async request => {
    const current = admin(request, true), payload = record(request.body, ['disabled'])
    const user = identity.setDisabled(current.user.id, uuid(request.params.id), boolean(payload.disabled))
    if (user.disabled) await authentication.revokeBusinessUser(user.id)
    return user
  })
  app.get<{ Params: { modelId: string } }>('/api/admin/pricing/:modelId', async request => { admin(request); return credits.price(request.params.modelId) })
  app.put<{ Params: { modelId: string } }>('/api/admin/pricing/:modelId', async request => credits.updatePrice(admin(request, true).user.id, request.params.modelId, request.body))
  app.get('/api/admin/reservations', async request => { admin(request); return { reservations: credits.pending() } })
  app.post<{ Params: { id: string } }>('/api/admin/reservations/:id/reconcile', async request => {
    const current = admin(request, true), input = record(request.body, ['amount', 'operation', 'note'])
    return credits.reconcile(current.user.id, uuid(request.params.id), integer(input.amount), operation(input.operation), text(input.note, 200))
  })
  registerAdminRoutes({ app, db, books, credits, config, auth, write, admin, rate })
  const writing = registerWritingRoutes({ app, db, books, credits, config, auth, write, admin, rate, fetcher: options.modelFetcher })
  const referenceCopies = new ReferenceCopies(db, books, writing.runtimes)
  app.get('/api/reference-book', async () => ({ version: referenceBook.version, title: referenceBook.title,
    introduction: referenceBook.introduction, permission: referenceBook.permission,
    guide: referenceMarkdown().split('## 第1章')[0]!,
    chapters: referenceBook.chapters.map(c => ({ title: c.title, content: c.content,
      notes: `时间：${c.time}\n人物：${c.characters.join('、')}\n地点：${c.location}\n事件：${c.event}\n结果：${c.result}\n\n章纲：${c.outline}` })) }))
  app.get('/api/reference-book/export', async (_request, reply) => reply.header('content-type', 'text/plain; charset=utf-8')
    .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(referenceBook.title)}.md`).send(referenceMarkdown()))
  app.post('/api/reference-book/copy', async request => {
    const current = write(request); record(request.body ?? {}, []); rate(`reference:${current.user.id}`, 10)
    // Seeding five complete chapters commits several guarded V3 projections.
    // The authenticated operation may exceed the general idle socket window.
    request.raw.setTimeout?.(120000)
    return referenceCopies.copy(current.user.id)
  })
  app.addHook('preHandler', async request => {
    // Inspect decoded route parameters; encoded UUIDs must not bypass the
    // incomplete-copy guard while seeding owns the new book's contents.
    if (request.routeOptions.url?.startsWith('/api/books/')) {
      const params = request.params as { id?: string; bookId?: string }
      const id = params.bookId ?? params.id
      if (id && db.get('SELECT key FROM settings WHERE key=?', `reference-pending:${id}`)) fail('not-found')
    }
  })
  app.addHook('onClose', async () => { await writing.groups.close(); await writing.inspiration.close(); await writing.jobs.close(); authentication.close(); if (!options.database) db.close() })
  return { app, db, identity, authentication, books, credits, auth, write, admin, rate, referenceCopies, ...writing }
}
