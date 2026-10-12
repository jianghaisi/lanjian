import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'

test('guest reads only the bundled reference and gains no identity, credits or write authority', async t => {
  const f = fixture(t)
  const initial = f.db.all('SELECT * FROM users')
  const snapshot = await f.app.inject('/api/guest-reference')
  assert.equal(snapshot.statusCode, 200)
  const sample = snapshot.json()
  assert.ok(Object.keys(sample.responses).length >= 70)
  for (let chapter = 1; chapter <= 5; chapter++) assert.ok(sample.responses[JSON.stringify(['chapters:get', [chapter]])].value.content.length > 100)
  assert.ok(!snapshot.body.includes(f.root))
  assert.ok(!/"apiKey":"[^"]+"/.test(snapshot.body))
  for (const [method, url, payload] of [
    ['GET','/api/me',undefined], ['GET','/api/admin/users',undefined],
    ['POST','/api/reference-book/copy',{}], ['POST','/api/books',{title:'改写'}],
    ['POST',`/api/books/${sample.bookId}/desktop/chapters/update`,{args:[1,{content:'入侵'}],operation:'guest_write_denied'}],
    ['POST',`/api/books/${sample.bookId}/desktop/ai/complete`,{args:['入侵'],operation:'guest_ai_denied'}],
  ] as const) assert.equal((await f.app.inject({method,url,payload})).statusCode,401,url)
  assert.deepEqual(f.db.all('SELECT * FROM users'),initial)
  assert.deepEqual((await f.app.inject('/api/guest-reference')).json(),sample)
  assert.equal(f.db.all('SELECT * FROM jobs').length,0)
})
