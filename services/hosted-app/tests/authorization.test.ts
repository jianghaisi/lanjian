import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'

test('anonymous and ordinary users cannot access admin, including direct HTTP writes', async t => {
  const f = fixture(t), user = await f.login(), admin = await f.login('42')
  assert.equal((await f.app.inject({ url: '/api/admin/users' })).statusCode, 401)
  assert.equal((await f.app.inject({ url: '/api/admin/users', cookies: user.cookies })).statusCode, 403)
  const grant = { userId: user.me.user.id, amount: 1000, operation: 'grant_0001', note: '活动' }
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/admin/credits', cookies: user.cookies, headers: user.headers, payload: grant })).statusCode, 403)
  for (const headers of [{}, { ...admin.headers, origin: 'https://evil.example' }, { ...admin.headers, 'x-csrf-token': user.me.csrfToken }]) {
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/admin/credits', cookies: admin.cookies, headers, payload: grant })).statusCode, 403)
  }
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/admin/credits', cookies: admin.cookies, headers: admin.headers, payload: grant })).statusCode, 200)
  assert.equal(f.credits.wallet(user.me.user.id).balance, 11000)
})
test('books bind authenticated owner, reject owner injection and hide other tenants', async t => {
  const f = fixture(t), a = await f.login('101'), b = await f.login('102')
  const options = { method: 'POST' as const, url: '/api/books', cookies: a.cookies, headers: a.headers }
  assert.equal((await f.app.inject({ ...options, payload: { title: 'A', operation: 'book_0001', ownerId: b.me.user.id } })).statusCode, 400)
  const created = await f.app.inject({ ...options, payload: { title: 'A', operation: 'book_0001' } })
  assert.equal(created.statusCode, 200)
  const id = created.json().id
  assert.equal((await f.app.inject({ url: `/api/books/${id}`, cookies: b.cookies })).statusCode, 404)
  assert.deepEqual((await f.app.inject({ url: '/api/books', cookies: b.cookies })).json(), { books: [] })
  assert.equal((await f.app.inject({ ...options, payload: { title: 'A', operation: 'book_0001' } })).json().id, id)
  assert.equal((await f.app.inject({ ...options, payload: { title: 'Changed', operation: 'book_0001' } })).statusCode, 409)
})
test('disabled accounts lose sessions and cannot log in or reserve', async t => {
  const f = fixture(t), user = await f.login(), admin = await f.login('42')
  const result = await f.app.inject({ method: 'PUT', url: `/api/admin/users/${user.me.user.id}/status`, cookies: admin.cookies, headers: admin.headers, payload: { disabled: true } })
  assert.equal(result.statusCode, 200)
  assert.equal((await f.app.inject({ url: '/api/me', cookies: user.cookies })).statusCode, 401)
  assert.throws(() => f.identity.ensureUser({ subject: '123', username: 'writer', name: '作者' }), /account-disabled/)
  f.credits.updatePrice(admin.me.user.id, 'model', { expectedVersion: 0, policy: { mode: 'request', points: 100 } })
  assert.throws(() => f.credits.reserve(user.me.user.id, 'reserve_1', 'model', 100, 1), /account-disabled/)
  const self = await f.app.inject({ method: 'PUT', url: `/api/admin/users/${admin.me.user.id}/status`, cookies: admin.cookies, headers: admin.headers, payload: { disabled: true } })
  assert.equal(self.statusCode, 409)
})
