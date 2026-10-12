import { decodeUser, decodeWallet, record, text, type UserView, type WalletView } from '@lanjian/hosted-contracts'
export class ApiError extends Error { constructor(readonly code: string, message: string, readonly status: number) { super(message) } }
export interface Session { user: UserView; wallet: WalletView; csrfToken: string }
export class Http {
  session: Session | null = null
  onExpired: () => void = () => undefined
  constructor(private readonly fetcher: typeof fetch = (...args) => globalThis.fetch(...args)) {}
  async request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const response = await this.fetcher(path, { method, credentials: 'same-origin', redirect: 'error', headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(method === 'GET' ? {} : { 'x-csrf-token': this.session?.csrfToken ?? '' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const value: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      if (response.status === 401) { const previous = this.session; this.session = null; if (previous) this.onExpired() }
      const p = value && typeof value === 'object' ? record(value) : {}
      const e = p.error && typeof p.error === 'object' ? record(p.error) : p
      throw new ApiError(typeof e.code === 'string' ? e.code : 'http-error', typeof e.message === 'string' ? e.message : '请求未完成，已保留当前输入。', response.status)
    }
    return value
  }
  async me(): Promise<Session> {
    const p = record(await this.request('/api/me'))
    this.session = { user: decodeUser(p.user), wallet: decodeWallet(p.wallet), csrfToken: text(p.csrfToken, 200) }
    return this.session
  }
  async logout() { await this.request('/api/auth/logout', 'POST'); this.session = null }
}
export const http = new Http()
export const messageOf = (e: unknown) => e instanceof Error ? e.message : '操作未完成，请重试。'
