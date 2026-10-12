import assert from 'node:assert/strict'
import test from 'node:test'
import { MarketplaceAuth, marketplaceCallback, marketplaceDeployment } from '../../../src/main/modules/writing-plugins/adapters/marketplace-auth'
import { oidcFixture } from '../../helpers/plugin-oidc-fixture'

test('PKCE S256 code exchange verifies ID token signature/nonce and keeps credentials in memory only', async t => {
  const fixture = await oidcFixture(); t.after(() => fixture.close()); let opened = ''
  const auth = new MarketplaceAuth({ origin: fixture.origin, issuer: fixture.origin, clientId: 'desktop-test', testLoopback: true }, async url => { opened = url })
  await auth.begin(); const url = new URL(opened)
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.equal(url.searchParams.get('redirect_uri'), marketplaceCallback)
  assert.ok(url.searchParams.get('state')); assert.ok(url.searchParams.get('nonce')); assert.equal(url.searchParams.has('code_verifier'), false)
  const callback = fixture.code(opened) + '&session_state=oidc-session-hint'
  assert.equal(await auth.callback(callback.replace('state=', 'unexpected=')), false); assert.equal(fixture.tokenRequests(), 0)
  assert.equal(await auth.callback(callback.replace('/oauth/callback', '/other')), false)
  assert.equal(await auth.callback(callback + '&access_token=forged'), false)
  assert.equal(await auth.callback(callback), true); assert.equal(auth.view().state, 'signed-in'); assert.ok(auth.token())
  assert.equal(JSON.stringify(auth.view()).includes(auth.token()), false)
  assert.equal(await auth.callback(callback), false); assert.equal(fixture.tokenRequests(), 1)
  auth.logout(); assert.throws(() => auth.token()); assert.equal(auth.view().state, 'signed-out')
  assert.equal(new MarketplaceAuth({ origin: fixture.origin, issuer: fixture.origin, clientId: 'desktop-test', testLoopback: true }, async () => {}).view().state, 'signed-out')
})
test('wrong ID token nonce, audience, issuer and expiry fail before a session can be retained', async t => {
  const fixture = await oidcFixture(); t.after(() => fixture.close())
  for (const claims of [{ nonce: 'forged' }, { aud: 'other-client' }, { iss: 'https://wrong.example' }, { exp: 1 }]) {
    fixture.claims(claims); let opened = ''
    const auth = new MarketplaceAuth({ origin: fixture.origin, issuer: fixture.origin, clientId: 'desktop-test', testLoopback: true }, async url => { opened = url })
    await auth.begin(); assert.equal(await auth.callback(fixture.code(opened)), false); assert.equal(auth.view().state, 'failed'); assert.throws(() => auth.token())
  }
})
test('cancelled, duplicate-field, expired and cold-start callbacks cannot open a session', async t => {
  const fixture = await oidcFixture(); t.after(() => fixture.close()); let opened = '', now = Date.now()
  const auth = new MarketplaceAuth({ origin: fixture.origin, issuer: fixture.origin, clientId: 'desktop-test', testLoopback: true }, async url => { opened = url }, () => now)
  assert.equal(await auth.callback(marketplaceCallback + '?code=unknown&state=unknown'), false)
  await auth.begin(); const callback = fixture.code(opened); assert.equal(await auth.callback(callback + '&code=duplicate'), false)
  auth.logout(); assert.equal(await auth.callback(callback), false)
  await auth.begin(); now += 601000; assert.equal(await auth.callback(fixture.code(opened)), false); assert.equal(fixture.tokenRequests(), 0)
})
test('logout while token exchange is pending defeats a late successful result', async t => {
  const fixture = await oidcFixture(); t.after(() => fixture.close()); let opened = '', release!: () => void
  fixture.waitForToken(new Promise<void>(r => { release = r }))
  const auth = new MarketplaceAuth({ origin: fixture.origin, issuer: fixture.origin, clientId: 'desktop-test', testLoopback: true }, async url => { opened = url })
  await auth.begin(); const pending = auth.callback(fixture.code(opened))
  while (!fixture.tokenRequests()) await new Promise(r => setTimeout(r, 10))
  auth.logout(); release(); assert.equal(await pending, false); assert.equal(auth.view().state, 'signed-out'); assert.throws(() => auth.token())
})
test('trusted deployment rejects credentials, arbitrary HTTP and packaged test identities', () => {
  assert.equal(marketplaceDeployment({}, true), null)
  const env = { LANJIAN_MARKET_ORIGIN: 'http://127.0.0.1:43120', LANJIAN_MARKET_ISSUER: 'http://127.0.0.1:43121/realms/test', LANJIAN_MARKET_CLIENT_ID: 'desktop-test', LANJIAN_MARKET_TEST_LOOPBACK: '1', LANJIAN_USER_DATA_PATH: 'isolated' }
  assert.equal(marketplaceDeployment(env, false)?.testLoopback, true)
  assert.throws(() => marketplaceDeployment(env, true)); assert.throws(() => marketplaceDeployment({ ...env, LANJIAN_USER_DATA_PATH: undefined }, false))
  assert.throws(() => marketplaceDeployment({ ...env, LANJIAN_MARKET_ISSUER: 'http://untrusted.invalid' }, false))
  assert.throws(() => marketplaceDeployment({ ...env, LANJIAN_MARKET_ORIGIN: 'https://user:password@example.invalid' }, false))
})
