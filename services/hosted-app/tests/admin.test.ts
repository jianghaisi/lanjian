import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'
import { readSite } from '../src/admin/site-store.ts'

test('all administration routes enforce roles and writes require same-origin CSRF', async t => {
  const f = fixture(t), member = await f.login(), admin = await f.login('42')
  const endpoints = [
    ['GET', '/api/admin/site'], ['PUT', '/api/admin/site'], ['GET', '/api/admin/activity'], ['GET', `/api/admin/users/${member.me.user.id}/credits`],
    ['GET', '/api/admin/models'], ['PUT', '/api/admin/models/test'], ['GET', '/api/admin/reservations'], ['POST', `/api/admin/reservations/${member.me.user.id}/reconcile`],
    ['GET', '/api/admin/pricing/test'], ['PUT', '/api/admin/pricing/test']
  ] as const
  for (const [method, url] of endpoints) {
    assert.equal((await f.app.inject({ method, url })).statusCode, 401, url)
    assert.equal((await f.app.inject({ method, url, cookies: member.cookies, headers: member.headers })).statusCode, 403, url)
    if (method !== 'GET') assert.equal((await f.app.inject({ method, url, cookies: admin.cookies })).statusCode, 403, url)
  }
})
test('site configuration is validated, revision-bound, audited and enforced on new books', async t => {
  const f = fixture(t), admin = await f.login('42'), member = await f.login()
  const payload = readSite(f.db); payload.links.project = 'https://example.com/project'; payload.limits.booksPerUser = 1
  const put = (body: unknown) => f.app.inject({ method: 'PUT', url: '/api/admin/site', cookies: admin.cookies, headers: admin.headers, payload: body as object })
  assert.equal((await put({ ...payload, links: { ...payload.links, download: 'javascript:alert(1)' } })).statusCode, 400)
  assert.equal((await put({ ...payload, limits: { ...payload.limits, concurrentJobs: 0 } })).statusCode, 400)
  assert.equal((await put(payload)).statusCode, 200)
  assert.equal((await put(payload)).statusCode, 409)
  assert.deepEqual(Object.keys((await f.app.inject('/api/site')).json()).sort(), ['links', 'loginConfigured', 'welcomePoints'])
  assert.equal(f.books.create(member.me.user.id, { title: 'one', operation: 'new_book_1' }).title, 'one')
  assert.throws(() => f.books.create(member.me.user.id, { title: 'two', operation: 'new_book_2' }), /quota-exceeded/)
  assert.equal((await f.app.inject({ url: '/api/admin/activity', cookies: admin.cookies })).json().audit[0].action, 'site-update')
})
test('management receipts preserve grants and prices, secret and prose never appear in activity', async t => {
  const f = fixture(t), admin = await f.login('42'), member = await f.login()
  const call = (url: string, payload: object, method: 'PUT' | 'POST' = 'PUT') => f.app.inject({ method, url, payload, cookies: admin.cookies, headers: admin.headers })
  const grant = { userId: member.me.user.id, amount: 10000, operation: 'grant_admin_test', note: '体验积分' }
  const first = await call('/api/admin/credits', grant, 'POST'), again = await call('/api/admin/credits', grant, 'POST')
  assert.deepEqual(first.json(), again.json()); assert.equal(f.credits.wallet(member.me.user.id).balance, 20000)
  const fields = { name: 'model', protocol: 'openai-compatible', baseUrl: 'https://example.com/v1', model: 'model', enabled: true, maxInputTokens: 1000, maxOutputTokens: 256, expectedRevision: 0, apiKey: 'admin-secret-sentinel' }
  assert.equal((await call('/api/admin/models/test', fields)).statusCode, 200)
  await call('/api/admin/pricing/test', { expectedVersion: 0, policy: { mode: 'request', points: 1000 } })
  const old = f.credits.reserve(member.me.user.id, 'old_price_test', 'test', 1000, 1); f.credits.markSent(old.id); f.credits.markUnknown(old.id)
  await call('/api/admin/pricing/test', { expectedVersion: 1, policy: { mode: 'tokens', inputPerMillion: 2000, outputPerMillion: 6000 } })
  assert.deepEqual(f.credits.price('test', old.priceVersion).policy, { mode: 'request', points: 1000 })
  const settle = { amount: 500, operation: 'reconcile_admin_test', note: 'provider receipt checked' }
  assert.equal((await call(`/api/admin/reservations/${old.id}/reconcile`, settle, 'POST')).statusCode, 200)
  assert.equal((await call(`/api/admin/reservations/${old.id}/reconcile`, settle, 'POST')).statusCode, 200)
  assert.equal(f.credits.wallet(member.me.user.id).balance, 19500)
  for (const url of ['/api/admin/models', '/api/admin/activity', '/api/site', `/api/admin/users/${member.me.user.id}/credits`]) {
    const res = await f.app.inject({ url, cookies: admin.cookies }); assert.equal(res.statusCode, 200); assert.ok(!res.body.includes(fields.apiKey))
  }
})
