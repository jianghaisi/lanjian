import { resolve } from 'node:path'
export function serviceConfig(env: NodeJS.ProcessEnv) {
  const issuer = new URL(env.MARKET_OIDC_ISSUER ?? ''), jwks = new URL(env.MARKET_OIDC_JWKS ?? ''), test = env.MARKET_TEST_LOOPBACK === '1'
  for (const url of [issuer, jwks]) if (url.username || url.password || url.hash || url.search || url.protocol !== 'https:' && !(test && url.protocol === 'http:' && url.hostname === '127.0.0.1')) throw new Error('Configure trusted HTTPS identity endpoints')
  if (issuer.origin !== jwks.origin) throw new Error('JWKS must share trusted issuer origin')
  const audience = env.MARKET_OIDC_AUDIENCE ?? '', root = env.MARKET_DATA_DIR, port = Number(env.MARKET_PORT ?? 43120)
  if (!audience || !root || !Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Missing marketplace deployment configuration')
  return { issuer: issuer.href.replace(/\/$/, ''), jwks, audience, root: resolve(root), port, host: test ? '127.0.0.1' : env.MARKET_HOST ?? '127.0.0.1' }
}
