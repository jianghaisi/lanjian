import { createHash } from 'node:crypto'
import * as oidc from 'openid-client'
import { AppError } from '../../../core/errors/app-error'

export const marketplaceCallback = 'cn.zuolan.novelwriter:/oauth/callback'
export type MarketplaceDeployment = { origin: string; issuer: string; clientId: string; testLoopback: boolean }
export type MarketplaceAuthView = { state: 'signed-out' | 'waiting' | 'signed-in' | 'failed'; publisherId: string | null }
export function marketplaceDeployment(env: NodeJS.ProcessEnv, packaged: boolean): MarketplaceDeployment | null {
  if (!env.LANJIAN_MARKET_ORIGIN) return null
  const origin = new URL(env.LANJIAN_MARKET_ORIGIN), issuer = new URL(env.LANJIAN_MARKET_ISSUER ?? ''), clientId = env.LANJIAN_MARKET_CLIENT_ID ?? ''
  const testLoopback = !packaged && !!env.LANJIAN_USER_DATA_PATH && env.LANJIAN_MARKET_TEST_LOOPBACK === '1'
  for (const url of [origin, issuer]) if (url.username || url.password || url.hash || url.search || url.protocol !== 'https:' && !(testLoopback && url.protocol === 'http:' && url.hostname === '127.0.0.1')) throw new Error('Invalid marketplace deployment')
  if (origin.pathname !== '/' || !clientId || clientId.length > 256) throw new Error('Invalid marketplace deployment')
  return { origin: origin.origin, issuer: issuer.href.replace(/\/$/, ''), clientId, testLoopback }
}
export class MarketplaceAuth {
  private generation = 0
  private pending: { config: oidc.Configuration; state: string; nonce: string; verifier: string; expires: number; generation: number } | null = null
  private credentials: { token: string; publisherId: string; expires: number } | null = null
  private state: MarketplaceAuthView['state'] = 'signed-out'
  constructor(private readonly deployment: MarketplaceDeployment, private readonly openBrowser: (url: string) => Promise<void>, private readonly clock = Date.now) {}
  view(): MarketplaceAuthView {
    if (this.pending && this.pending.expires <= this.clock()) { this.pending = null; this.state = 'failed' }
    if (this.credentials && this.credentials.expires <= this.clock()) { this.credentials = null; this.state = 'signed-out' }
    return { state: this.state, publisherId: this.credentials?.publisherId ?? null }
  }
  token(): string { this.view(); if (!this.credentials) throw new AppError('FEATURE_UNAVAILABLE', '请先登录插件市场，再提交发布。', { recoverable: true }); return this.credentials.token }
  logout() { this.generation++; this.pending = null; this.credentials = null; this.state = 'signed-out'; return this.view() }
  async begin() {
    this.logout(); const generation = this.generation; this.state = 'waiting'
    try {
      const config = await oidc.discovery(new URL(this.deployment.issuer), this.deployment.clientId, { token_endpoint_auth_method: 'none' }, oidc.None(), { timeout: 10, ...(this.deployment.testLoopback ? { execute: [oidc.allowInsecureRequests] } : {}) })
      const metadata = config.serverMetadata()
      oidc.enableNonRepudiationChecks(config)
      for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri]) {
        if (!endpoint || new URL(endpoint).origin !== new URL(this.deployment.issuer).origin) throw new Error('Untrusted identity endpoint')
      }
      if (generation !== this.generation) return this.view()
      const verifier = oidc.randomPKCECodeVerifier(), state = oidc.randomState(), nonce = oidc.randomNonce(), challenge = await oidc.calculatePKCECodeChallenge(verifier)
      if (generation !== this.generation) return this.view()
      this.pending = { config, state, nonce, verifier, expires: this.clock() + 10 * 60_000, generation }
      const url = oidc.buildAuthorizationUrl(config, { redirect_uri: marketplaceCallback, scope: 'openid plugins:publish', code_challenge: challenge, code_challenge_method: 'S256', state, nonce })
      await this.openBrowser(url.href); return this.view()
    } catch (cause) { if (generation === this.generation) { this.pending = null; this.state = 'failed' }; throw new AppError('FEATURE_UNAVAILABLE', '市场登录未能启动，请检查网络后重试。', { recoverable: true, cause }) }
  }
  async callback(raw: string): Promise<boolean> {
    this.view(); const pending = this.pending
    if (!pending || raw.length > 8192) return false
    let url: URL
    try { url = new URL(raw) } catch { return false }
    if (url.protocol !== 'cn.zuolan.novelwriter:' || url.pathname !== '/oauth/callback' || url.host || url.username || url.password || url.hash || url.searchParams.get('state') !== pending.state) return false
    const keys = [...url.searchParams.keys()]
    if (new Set(keys).size !== keys.length || keys.some(k => !['code', 'state', 'iss', 'session_state', 'error', 'error_description'].includes(k))) return false
    this.pending = null
    try {
      const response = await oidc.authorizationCodeGrant(pending.config, url, { expectedState: pending.state, expectedNonce: pending.nonce, pkceCodeVerifier: pending.verifier, idTokenExpected: true })
      const claims = response.claims(), ttl = response.expiresIn()
      if (!claims?.sub || !Number.isFinite(ttl) || !ttl || ttl <= 0 || !response.access_token || response.access_token.length > 16384 || claims.iss !== this.deployment.issuer) throw new Error('Invalid identity response')
      if (pending.generation !== this.generation || pending.expires <= this.clock()) return false
      this.credentials = { token: response.access_token, publisherId: createHash('sha256').update(JSON.stringify([claims.iss, claims.sub])).digest('hex'), expires: this.clock() + Math.min(ttl, 3600) * 1000 }
      this.state = 'signed-in'; return true
    } catch { if (pending.generation === this.generation) this.state = 'failed'; return false }
  }
}
