import { assertJson } from './schema.ts'
import { validatePluginManifest, type PluginManifest } from './manifest.ts'
import { codePluginLimits } from './limits.ts'
export type ReleaseState = 'uploading' | 'validating' | 'published' | 'validation-failed' | 'withdrawn'
export type UpstreamReference = { pluginId: string; version: string; digest: string }
export type PublishRequest = { operationId: string; manifest: PluginManifest; digest: string; bytes: number; upstream: UpstreamReference | null }
export type MarketRelease = PublishRequest & { state: ReleaseState; distribution: 'official' | 'community'; publisherId: string; createdAt: string; failure: 'invalid-package' | 'interrupted' | null; manualReview: false }
export type MarketQuery = { query: string; categories: string[]; tags: string[]; source: 'all' | 'official' | 'community'; offset: number; limit: number }
export type MarketPage = { releases: MarketRelease[]; nextOffset: number | null }
export const marketLimits = { responseBytes: 3 * 1024 * 1024, pageSize: 10, pendingUploads: 8, ticketMs: 10 * 60_000, validationConcurrency: 2, requestMs: 30000 } as const
const bad = (): never => { throw new Error('Invalid marketplace data') }
export function marketRecord(v: unknown, keys: string[]): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== keys.length || Object.keys(v).some(k => !keys.includes(k))) return bad(); return v as Record<string, unknown> }
export function marketText(v: unknown, max: number): string { if (typeof v !== 'string' || v.length > max) return bad(); return v }
export function marketDigest(v: unknown) { const s = marketText(v, 64); if (!/^[a-f0-9]{64}$/.test(s)) bad(); return s }
export function marketId(v: unknown) { const s = marketText(v, 128); if (!/^[a-z][a-z0-9.-]{0,127}$/.test(s) || s.startsWith('builtin.')) bad(); return s }
export function marketOperation(v: unknown) { const s = marketText(v, 36); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s)) bad(); return s }
export function marketInt(v: unknown, min: number, max: number): number { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) return bad(); return v }
export function decodeUpstream(v: unknown): UpstreamReference | null {
  if (v === null) return null
  const o = marketRecord(v, ['pluginId', 'version', 'digest']), version = marketText(o.version, 64)
  if (!/^\d+\.\d+\.\d+$/.test(version)) bad()
  return { pluginId: marketId(o.pluginId), version, digest: marketDigest(o.digest) }
}
export function decodePublishRequest(value: unknown): PublishRequest {
  assertJson(value, codePluginLimits.manifestBytes + 4096)
  const v = marketRecord(value, ['operationId', 'manifest', 'digest', 'bytes', 'upstream'])
  return { operationId: marketOperation(v.operationId), manifest: validatePluginManifest(v.manifest), digest: marketDigest(v.digest), bytes: marketInt(v.bytes, 1, codePluginLimits.zipBytes), upstream: decodeUpstream(v.upstream) }
}
export function decodeMarketRelease(value: unknown): MarketRelease {
  const v = marketRecord(value, ['operationId', 'manifest', 'digest', 'bytes', 'upstream', 'state', 'distribution', 'publisherId', 'createdAt', 'failure', 'manualReview'])
  const request = decodePublishRequest({ operationId: v.operationId, manifest: v.manifest, digest: v.digest, bytes: v.bytes, upstream: v.upstream })
  if (typeof v.state !== 'string' || !['uploading', 'validating', 'published', 'validation-failed', 'withdrawn'].includes(v.state) || typeof v.distribution !== 'string' || !['official', 'community'].includes(v.distribution) || v.manualReview !== false || v.failure !== null && v.failure !== 'invalid-package' && v.failure !== 'interrupted') bad()
  if ((v.state === 'validation-failed') !== (v.failure !== null)) bad()
  if (typeof v.createdAt !== 'string' || !Number.isFinite(Date.parse(v.createdAt))) bad()
  return { ...request, state: v.state as ReleaseState, distribution: v.distribution as MarketRelease['distribution'], publisherId: marketDigest(v.publisherId), createdAt: marketText(v.createdAt, 40), failure: v.failure as MarketRelease['failure'], manualReview: false }
}
export function decodeMarketQuery(value: unknown): MarketQuery {
  const v = marketRecord(value, ['query', 'categories', 'tags', 'source', 'offset', 'limit'])
  const strings = (v: unknown) => { if (!Array.isArray(v) || v.length > 16) return bad(); return [...new Set(v.map(x => marketText(x, 80)))] }
  if (typeof v.source !== 'string' || !['all', 'official', 'community'].includes(v.source)) bad()
  return { query: marketText(v.query, 200), categories: strings(v.categories), tags: strings(v.tags), source: v.source as MarketQuery['source'], offset: marketInt(v.offset, 0, 1000000), limit: marketInt(v.limit, 1, marketLimits.pageSize) }
}
export function decodeMarketPage(value: unknown): MarketPage {
  assertJson(value, marketLimits.responseBytes)
  const v = marketRecord(value, ['releases', 'nextOffset'])
  if (!Array.isArray(v.releases) || v.releases.length > marketLimits.pageSize) bad()
  return { releases: (v.releases as unknown[]).map(decodeMarketRelease), nextOffset: v.nextOffset === null ? null : marketInt(v.nextOffset, 0, 1000000) }
}
