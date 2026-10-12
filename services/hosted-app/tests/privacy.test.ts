import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'
import { buildApp } from '../src/http/app.ts'
import { linuxDoIdentity, boundedJson } from '../src/identity/linuxdo.ts'

test('public OAuth errors omit secrets and unregistered auth endpoints stay closed', async t => {
  const f = fixture(t); f.failProvider()
  const start = await f.app.inject('/api/auth/linuxdo/start'), state = new URL(start.headers.location!).searchParams.get('state')!
  const result = await f.app.inject({ url: `/api/auth/linuxdo/callback?state=${state}&code=secret-code`, cookies: Object.fromEntries(start.cookies.map(c => [c.name, c.value])) })
  assert.equal(result.statusCode, 502)
  for (const secret of ['secret-sentinel', 'bearer-secret', 'private', 'secret-code', 'stack']) assert.ok(!result.body.includes(secret))
  for (const url of ['/api/test/login', '/api/auth/sign-up/email', '/api/auth/update-user', '/api/auth/link-social', '/api/auth/get-access-token']) {
    assert.equal((await f.app.inject({ method: 'POST', url, payload: { role: 'admin', linuxdoSubject: '42' } })).statusCode, 404)
  }
})
test('real library performs Linux DO exchange and maps only stable numeric provider identity', async t => {
  const f = fixture(t), calls: { url: string; headers: Headers; body: string }[] = [], previous = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers), body: String(init?.body ?? '') })
    return new Response(JSON.stringify(calls.length === 1 ? { access_token: 'synthetic-upstream-token', token_type: 'Bearer' } : { id: 123, username: 'author', name: '作者', active: true, trust_level: 4 }), { headers: { 'content-type': 'application/json' } })
  }
  const live = buildApp({ config: f.config })
  try {
    const start = await live.app.inject('/api/auth/linuxdo/start'), url = new URL(start.headers.location!)
    assert.equal(url.origin, 'https://connect.linux.do'); assert.equal(url.pathname, '/oauth2/authorize')
    assert.equal(url.searchParams.get('redirect_uri'), `${f.config.origin}/api/auth/linuxdo/callback`)
    const callback = await live.app.inject({ url: `/api/auth/linuxdo/callback?state=${url.searchParams.get('state')}&code=wire-test`, cookies: Object.fromEntries(start.cookies.map(c => [c.name, c.value])) })
    assert.equal(callback.statusCode, 302, callback.body)
    assert.equal(calls[0]?.url, 'https://connect.linux.do/oauth2/token')
    assert.equal(calls[0]?.headers.get('authorization'), `Basic ${Buffer.from('fixture:secret-sentinel').toString('base64')}`)
    assert.equal(new URLSearchParams(calls[0]!.body).get('code'), 'wire-test')
    assert.equal(calls[1]?.headers.get('authorization'), 'Bearer synthetic-upstream-token')
  } finally { globalThis.fetch = previous; await live.app.close() }
  assert.deepEqual(linuxDoIdentity({ id: 123, username: 'author', name: '作者' }), { subject: '123', username: 'author', name: '作者' })
  for (const value of [{ id: 1.5, username: 'x' }, { id: 'rename', username: 'x' }, { id: 123, username: 'x', silenced: true }]) assert.throws(() => linuxDoIdentity(value), /oauth-failed/)
  await assert.rejects(boundedJson(new Response('x'.repeat(70000))), /oauth-failed/)
})
