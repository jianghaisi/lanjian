import { createHash } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { deny, type IdentityPort } from '../domain/releases.ts'

export function oidcIdentity(issuer: string, audience: string, jwks: URL | JWTVerifyGetKey): IdentityPort {
  const key = jwks instanceof URL ? createRemoteJWKSet(jwks, { timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 600000 }) : jwks
  return async authorization => {
    if (!authorization?.startsWith('Bearer ') || authorization.length > 16384) return deny(401, 'login-required')
    try {
      const { payload } = await jwtVerify(authorization.slice(7), key, { issuer, audience, algorithms: ['RS256', 'ES256'], requiredClaims: ['sub', 'iss', 'aud', 'exp', 'iat'], maxTokenAge: '1h', clockTolerance: 5 })
      if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 512 || typeof payload.scope !== 'string' || !payload.scope.split(' ').includes('plugins:publish')) return deny(403, 'publish-scope-required')
      return { id: createHash('sha256').update(JSON.stringify([payload.iss, payload.sub])).digest('hex') }
    } catch { return deny(401, 'invalid-identity') }
  }
}
