import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Http } from '../src/api/http.ts'
import { WritingApi } from '../src/api/writing.ts'
import { DraftStore, acknowledge } from '../src/experience/drafts.ts'

test('draft recovery isolates account/book/document and cannot mark new edits saved', () => {
  const values = new Map<string, string>(), storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) } }
  const a = new DraftStore(storage, 'user-a', 'book-a'), b = new DraftStore(storage, 'user-b', 'book-a'), c = new DraftStore(storage, 'user-a', 'book-b')
  a.write('chapter:1', 'rev1', '作者输入')
  assert.equal(b.read('chapter:1'), null); assert.equal(c.read('chapter:1'), null)
  assert.equal(a.read('chapter:1')?.data, '作者输入'); assert.equal(a.read('chapter:2'), null)
  assert.equal(acknowledge('提交版本', '新修改', (a, b) => a === b), false)
})
test('named clients capture book id, validate incoming shapes and send only same-origin session headers', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const client = new Http(async (url, init) => { calls.push({ url: String(url), init }); return new Response('{}', { headers: { 'content-type': 'application/json' } }) })
  const api = new WritingApi(client), id = randomUUID()
  await assert.rejects(api.book(id).chapters())
  assert.equal(calls[0]!.url, `/api/books/${id}/chapters`)
  assert.equal(calls[0]!.init?.credentials, 'same-origin')
  assert.equal(calls[0]!.init?.redirect, 'error')
  assert.throws(() => api.book('../foreign'))
})
test('first anonymous visit differs from expiration of a known login', async () => {
  const client = new Http(async () => new Response(JSON.stringify({ error: { code: 'login-required', message: '请先登录' } }), { status: 401 }))
  let expired = 0; client.onExpired = () => { expired++ }
  await assert.rejects(client.me()); assert.equal(expired, 0)
  client.session = { user: { id: randomUUID(), username: '测试', name: '测试', role: 'member', disabled: false }, csrfToken: 'fake', wallet: { balance: 10000, reserved: 0, available: 10000 } }
  await assert.rejects(client.me()); assert.equal(expired, 1); assert.equal(client.session, null)
})
