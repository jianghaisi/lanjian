import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'

test('worldbook edits require current revision and remain private to the owning book', async t => {
  const f = fixture(t), author = await f.login(), other = await f.login('456')
  const book = f.books.create(author.me.user.id, { title: '世界书', operation: 'worldbook_0001' })
  const url = `/api/books/${book.id}/characters`
  const post = (payload: unknown, identity = author) => f.app.inject({ method: 'POST', url, cookies: identity.cookies, headers: identity.headers, payload })
  const input = { canonicalName: '林舟', entityType: 'character', status: 'candidate', profileJson: '{}' }
  const created = await post(input)
  assert.equal(created.statusCode, 200, created.body)
  const first = created.json()
  const update = { ...input, id: first.id, expectedUpdatedAt: first.updatedAt, canonicalName: '林舟·修订', status: 'approved' }
  const saved = await post(update)
  assert.equal(saved.statusCode, 200, saved.body)
  assert.equal((await post(update)).statusCode, 409)
  assert.equal((await post({ ...update, expectedUpdatedAt: undefined })).statusCode, 409)
  assert.equal((await post({ ...update, expectedUpdatedAt: saved.json().updatedAt }, other)).statusCode, 404)
  const view = (await f.app.inject({ url, cookies: author.cookies })).json()
  assert.equal(view[0].canonicalName, '林舟·修订')
  assert.equal(view[0].status, 'approved')
  // Navigation fans out reads while another tab saves. All calls share the
  // same book lane, including read-side snapshot assembly.
  const concurrent = await Promise.all([
    post({ ...update, expectedUpdatedAt: saved.json().updatedAt, canonicalName: '林舟·最终' }),
    f.app.inject({ url: `/api/books/${book.id}/workspace`, cookies: author.cookies }),
    f.app.inject({ url, cookies: author.cookies }),
    f.app.inject({ url: `/api/books/${book.id}/foundation`, cookies: author.cookies })
  ])
  for (const response of concurrent) assert.equal(response.statusCode, 200, response.body)
})
