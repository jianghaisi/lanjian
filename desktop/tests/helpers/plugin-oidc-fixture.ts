import { createServer } from 'node:http'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { marketplaceCallback } from '../../src/main/modules/writing-plugins/adapters/marketplace-auth'

/** Synthetic protocol server for negative tests only. This does not count as
 * Keycloak/system-browser acceptance. No fixture secret is an author credential. */
export async function oidcFixture() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }), codes = new Map<string, URL>()
  let origin = '', tokenRequests = 0, claims: Record<string, unknown> = {}, tokenWait: Promise<void> | null = null
  const jwt = (value: unknown) => { const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url'), body = Buffer.from(JSON.stringify(value)).toString('base64url'), input = `${header}.${body}`; return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}` }
  const server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.url === '/.well-known/openid-configuration') { response.end(JSON.stringify({ issuer: origin, authorization_endpoint: origin + '/authorize', token_endpoint: origin + '/token', jwks_uri: origin + '/jwks', response_types_supported: ['code'], grant_types_supported: ['authorization_code'], id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], subject_types_supported: ['public'] })); return }
    if (request.url === '/jwks') { response.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }] })); return }
    if (request.url !== '/token') { response.statusCode = 404; response.end('{}'); return }
    tokenRequests++; let body = ''; for await (const part of request) body += part
    const params = new URLSearchParams(body), url = codes.get(params.get('code') ?? '')
    codes.delete(params.get('code') ?? '')
    if (!url || params.get('grant_type') !== 'authorization_code' || params.get('redirect_uri') !== marketplaceCallback || params.get('client_id') !== 'desktop-test' || createHash('sha256').update(params.get('code_verifier') ?? '').digest('base64url') !== url.searchParams.get('code_challenge')) { response.statusCode = 400; response.end('{"error":"invalid_grant"}'); return }
    if (tokenWait) await tokenWait
    const now = Math.floor(Date.now() / 1000), common = { iss: origin, sub: 'fixture-author', iat: now, exp: now + 300 }
    response.end(JSON.stringify({ access_token: jwt({ ...common, aud: 'market-test', scope: 'plugins:publish' }), token_type: 'Bearer', expires_in: 300, id_token: jwt({ ...common, aud: 'desktop-test', nonce: url.searchParams.get('nonce'), ...claims }) }))
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  origin = `http://127.0.0.1:${address.port}`
  return {
    origin, jwk: { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }, tokenRequests: () => tokenRequests,
    claims: (value: Record<string, unknown>) => { claims = value }, waitForToken: (value: Promise<void>) => { tokenWait = value },
    code(authUrl: string) { const url = new URL(authUrl), code = randomUUID(); codes.set(code, url); return `${marketplaceCallback}?code=${code}&state=${url.searchParams.get('state')}&iss=${encodeURIComponent(origin)}` },
    close: () => new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()) })
  }
}
