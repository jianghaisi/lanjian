import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultWelcomeCredits } from '@lanjian/hosted-contracts'
import { fixture } from './helpers.ts'
import { buildApp } from '../src/http/app.ts'

async function attempt(f: ReturnType<typeof fixture>) {
  const start = await f.app.inject('/api/auth/linuxdo/start')
  assert.equal(start.statusCode, 302, start.body)
  return { state: new URL(start.headers.location!).searchParams.get('state')!, cookies: Object.fromEntries(start.cookies.map(c => [c.name, c.value])) }
}
test('Better Auth binds state to browser, consumes it once, rejects expiry before exchange', async t => {
  const f = fixture(t), first = await attempt(f), second = await attempt(f)
  const url = `/api/auth/linuxdo/callback?state=${first.state}&code=fixture`
  assert.equal((await f.app.inject({ url, cookies: second.cookies })).statusCode, 400)
  assert.equal(f.calls(), 0)
  const good = await f.app.inject({ url, cookies: first.cookies })
  assert.equal(good.statusCode, 302, good.body)
  const session = good.cookies.find(c => c.name.endsWith('.session_token'))!
  assert.ok(session.httpOnly); assert.ok(session.secure); assert.equal(session.sameSite, 'Lax')
  assert.equal((await f.app.inject({ url, cookies: first.cookies })).statusCode, 400)
  assert.equal(f.calls(), 1)
  const expiring = await attempt(f)
  f.authentication.database.exec("UPDATE verification SET expiresAt=0, value=json_set(value,'$.expiresAt',0)")
  assert.equal((await f.app.inject({ url: `/api/auth/linuxdo/callback?state=${expiring.state}&code=x`, cookies: expiring.cookies })).statusCode, 400)
  assert.equal(f.calls(), 1)
})
test('provider cancellation is consumed by the library and creates no account', async t => {
  const f = fixture(t), pending = await attempt(f)
  const url = `/api/auth/linuxdo/callback?state=${pending.state}&error=access_denied&error_description=secret-sentinel`
  const result = await f.app.inject({ url, cookies: pending.cookies })
  assert.equal(result.headers.location, '/app?login=cancelled'); assert.equal(f.calls(), 0)
  assert.equal(f.identity.list().length, 0)
  assert.equal((await f.app.inject({ url, cookies: pending.cookies })).statusCode, 400)
  assert.ok(!result.body.includes('secret-sentinel'))
})
test('stable subject preserves business identity and grants exactly 10 points once', async t => {
  const f = fixture(t), first = await f.login(), second = await f.login()
  assert.equal(first.me.user.id, second.me.user.id)
  assert.equal(first.me.wallet.balance, defaultWelcomeCredits)
  const users = await Promise.all(Array.from({ length: 8 }, () => Promise.resolve().then(() => f.identity.ensureUser({ subject: '123', username: 'renamed', name: '新名字' }))))
  for (const user of users) assert.equal(user.id, first.me.user.id)
  assert.equal(f.credits.entries(first.me.user.id).filter(x => x.kind === 'welcome').length, 1)
  assert.equal(f.db.get("SELECT name FROM sqlite_master WHERE name='sessions'"), undefined)
  assert.equal(f.db.get("SELECT name FROM sqlite_master WHERE name='oauth_states'"), undefined)
  assert.notEqual(f.authentication.database.prepare('SELECT accessToken FROM account').get()?.accessToken, 'fixture', 'library encrypts stored provider tokens')
  assert.equal(f.authentication.database.prepare('SELECT emailVerified FROM user').get()?.emailVerified, 0)
})
test('library session survives reopening, CSRF logout revokes one session, expiry rejects', async t => {
  const f = fixture(t), first = await f.login(), second = await f.login()
  const reopened = buildApp({ config: f.config })
  try { assert.equal((await reopened.app.inject({ url: '/api/me', cookies: first.cookies })).json().user.id, first.me.user.id) }
  finally { await reopened.app.close() }
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/auth/logout', cookies: first.cookies })).statusCode, 403)
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/auth/logout', cookies: first.cookies, headers: first.headers })).statusCode, 200)
  assert.equal((await f.app.inject({ url: '/api/me', cookies: first.cookies })).statusCode, 401)
  assert.equal((await f.app.inject({ url: '/api/me', cookies: second.cookies })).statusCode, 200)
  f.authentication.database.exec('UPDATE session SET expiresAt=0')
  assert.equal((await f.app.inject({ url: '/api/me', cookies: second.cookies })).statusCode, 401)
})
test('old schema migration retires custom sessions without changing existing books or ledger', async t => {
  const f = fixture(t), user = await f.login(), id = user.me.user.id
  const book = f.books.create(id, { title: '升级前作品', operation: 'migration_book' })
  // Reconstruct the actual v2 schema, before preparation job tables existed.
  f.db.connection.exec('DROP TABLE group_model_attempts; DROP TABLE group_model_jobs; CREATE TABLE sessions(hash TEXT); CREATE TABLE oauth_states(hash TEXT); PRAGMA user_version=2;')
  const reopened = buildApp({ config: f.config })
  try {
    assert.equal(reopened.identity.ensureUser({ subject: '123', username: '作者改名', name: '作者' }).id, id)
    assert.equal(reopened.books.get(id, book.id).title, book.title)
    assert.equal(reopened.credits.wallet(id).balance, 10000)
    assert.equal(reopened.credits.entries(id).filter(x => x.kind === 'welcome').length, 1)
    assert.equal((await reopened.app.inject({ url: '/api/me', cookies: { '__Host-lanjian_session': 'x'.repeat(43) } })).statusCode, 401)
    assert.equal(reopened.db.get("SELECT name FROM sqlite_master WHERE name='sessions'"), undefined)
    assert.equal(reopened.db.get('PRAGMA user_version')?.user_version, 4)
  } finally { await reopened.app.close() }
})
