import { decodeMarketPage, decodeMarketQuery, decodeMarketRelease, decodePublishRequest, marketDigest, marketLimits, marketOperation, marketRecord, marketText, type MarketQuery, type PublishRequest } from '@lanjian/writing-plugin-contracts'
import { AppError } from '../../../core/errors/app-error'
import type { MarketplaceDeployment } from './marketplace-auth'

export class MarketplaceClient {
  constructor(private readonly deployment: MarketplaceDeployment, private readonly token: () => string) {}
  private async request(path: string, method: string, body?: unknown, authenticated = false, bytes?: Uint8Array, ticket?: string) {
    try {
      const response = await fetch(this.deployment.origin + path, { method, redirect: 'error', signal: AbortSignal.timeout(marketLimits.requestMs), headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(bytes ? { 'content-type': 'application/zip' } : {}), ...(authenticated ? { authorization: `Bearer ${this.token()}` } : {}), ...(ticket ? { 'x-upload-ticket': ticket } : {}) }, body: bytes ? Buffer.from(bytes) : body === undefined ? undefined : JSON.stringify(body) })
      if (!response.ok) { await response.body?.cancel(); throw new AppError(response.status === 404 ? 'NOT_FOUND' : response.status === 409 ? 'CONFLICT' : 'FEATURE_UNAVAILABLE', response.status === 401 || response.status === 403 ? '市场身份或发布权限无效，请重新登录。' : response.status === 404 ? '这个市场版本已失效或不可见。' : response.status === 429 ? '市场暂时繁忙，请稍后查询发布状态。' : '市场请求未完成，请查询状态后重试。', { recoverable: true }) }
      const max = path.startsWith('/download/') ? 10 * 1024 * 1024 : marketLimits.responseBytes
      if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw new Error('Response too large') }
      const reader = response.body?.getReader(), chunks: Uint8Array[] = []; let size = 0
      if (!reader) throw new Error('Empty response')
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > max) throw new Error('Response too large'); chunks.push(chunk.value) } }
      finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
      return Buffer.concat(chunks, size)
    } catch (cause) { if (cause instanceof AppError) throw cause; throw new AppError('FEATURE_UNAVAILABLE', '无法连接插件市场。已安装插件和本地草稿仍可使用；发布结果未知时请先查询状态。', { recoverable: true, cause }) }
  }
  private async json(path: string, method: string, body?: unknown, auth = false) { return JSON.parse((await this.request(path, method, body, auth)).toString('utf8')) as unknown }
  async catalog(query: MarketQuery) { return decodeMarketPage(await this.json('/catalog', 'POST', decodeMarketQuery(query))) }
  async versions(pluginId: string, query: MarketQuery) { return decodeMarketPage(await this.json('/versions', 'POST', { pluginId, query: decodeMarketQuery(query) })) }
  async prepare(input: PublishRequest) {
    const result = marketRecord(await this.json('/uploads/prepare', 'POST', decodePublishRequest(input), true), ['release', 'ticket', 'expires'])
    const release = decodeMarketRelease(result.release), ticket = marketText(result.ticket, 36)
    if (release.operationId !== input.operationId || release.digest !== input.digest || release.manifest.id !== input.manifest.id || release.manifest.version !== input.manifest.version) throw new AppError('CONFLICT', '市场返回了不同的发布版本。', { recoverable: true })
    return { release, ticket }
  }
  async commit(operation: string, ticket: string, bytes: Uint8Array) { return decodeMarketRelease(JSON.parse((await this.request(`/uploads/${marketOperation(operation)}`, 'PUT', undefined, true, bytes, ticket)).toString('utf8'))) }
  async status(operation: string) { return decodeMarketRelease(await this.json(`/releases/${marketOperation(operation)}`, 'GET', undefined, true)) }
  async publicRelease(operation: string) { return decodeMarketRelease(await this.json(`/public/${marketOperation(operation)}`, 'GET')) }
  async withdraw(operation: string) { return decodeMarketRelease(await this.json(`/releases/${marketOperation(operation)}/withdraw`, 'POST', {}, true)) }
  async download(operation: string, digest: string) { return this.request(`/download/${marketOperation(operation)}/${marketDigest(digest)}`, 'GET') }
}
