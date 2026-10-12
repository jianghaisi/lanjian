import { decodeMarketPage, decodeMarketQuery, decodeMarketRelease, decodePublishRequest, marketOperation, marketRecord, marketText, marketDigest, type MarketPage, type MarketQuery, type MarketRelease, type PublishRequest } from '@lanjian/writing-plugin-contracts'
import { boundedBoolean, enumValue, exactArgs, exactRecord, invalid, uuid } from '../core/validation'
import { decodeDraftBuild, decodeDraftRef, type DraftBuild, type DraftRef } from './authoring'
import { decodePluginInstallPreview, type PluginInstallPreview } from './management-contracts'
export type MarketStatus = { available: boolean; auth: { state: 'signed-out' | 'waiting' | 'signed-in' | 'failed'; publisherId: string | null }; publications: MarketRelease[]; pending: { operationId: string; name: string; version: string }[] }
export type PublishPreview = { planId: string; publisherId: string; request: PublishRequest; build: DraftBuild }
export type PluginMarketplaceApi = {
  marketStatus(): Promise<MarketStatus>
  marketLogin(): Promise<MarketStatus>
  marketLogout(): Promise<MarketStatus>
  marketCatalog(query: MarketQuery): Promise<MarketPage>
  marketVersions(pluginId: string, query: MarketQuery): Promise<MarketPage>
  previewPublish(ref: DraftRef): Promise<PublishPreview>
  publish(planId: string): Promise<MarketRelease>
  refreshPublication(operationId: string): Promise<MarketRelease>
  retryPublication(operationId: string): Promise<MarketRelease>
  withdrawPublication(operationId: string): Promise<MarketRelease>
  previewDownload(release: MarketRelease): Promise<PluginInstallPreview>
}
export function decodeMarketStatus(value: unknown): MarketStatus {
  const v = exactRecord(value, 'market', ['available', 'auth', 'publications', 'pending']), auth = exactRecord(v.auth, 'auth', ['state', 'publisherId'])
  if (!Array.isArray(v.publications) || v.publications.length > 64 || !Array.isArray(v.pending) || v.pending.length > 64) return invalid('publications', '数量无效')
  return { available: boundedBoolean(v.available, 'available'), auth: { state: enumValue(auth.state, 'state', ['signed-out', 'waiting', 'signed-in', 'failed']), publisherId: auth.publisherId === null ? null : marketDigest(auth.publisherId) }, publications: v.publications.map(decodeMarketRelease), pending: v.pending.map(raw => { const p = marketRecord(raw, ['operationId', 'name', 'version']); return { operationId: marketOperation(p.operationId), name: marketText(p.name, 200), version: marketText(p.version, 64) } }) }
}
export function decodePublishPreview(value: unknown): PublishPreview {
  const v = exactRecord(value, 'publish', ['planId', 'publisherId', 'request', 'build']), request = decodePublishRequest(v.request), build = decodeDraftBuild(v.build)
  if (request.digest !== build.digest || request.manifest.id !== build.manifest.id || request.manifest.version !== build.manifest.version) invalid('publish', '版本不一致')
  return { planId: uuid(v.planId, 'planId'), publisherId: marketDigest(v.publisherId), request, build }
}
const one = (args: unknown[]) => { exactArgs(args, 1); return args[0] }
export const decodeMarketQueryArgs = (args: unknown[]): [MarketQuery] => [decodeMarketQuery(one(args))]
export const decodePublishRefArgs = (args: unknown[]): [DraftRef] => [decodeDraftRef(one(args))]
export const decodeReleaseArgs = (args: unknown[]): [MarketRelease] => [decodeMarketRelease(one(args))]
export const decodeOperationArgs = (args: unknown[]): [string] => [marketOperation(one(args))]
export function decodeVersionsArgs(args: unknown[]): [string, MarketQuery] { exactArgs(args, 2); return [marketText(args[0], 128), decodeMarketQuery(args[1])] }
export const marketplaceResultDecoders = {
  'writing-plugins:market-status': decodeMarketStatus,
  'writing-plugins:market-login': decodeMarketStatus,
  'writing-plugins:market-logout': decodeMarketStatus,
  'writing-plugins:market-catalog': decodeMarketPage,
  'writing-plugins:market-versions': decodeMarketPage,
  'writing-plugins:preview-publish': decodePublishPreview,
  'writing-plugins:publish': decodeMarketRelease,
  'writing-plugins:refresh-publication': decodeMarketRelease,
  'writing-plugins:retry-publication': decodeMarketRelease,
  'writing-plugins:withdraw-publication': decodeMarketRelease,
  'writing-plugins:preview-download': decodePluginInstallPreview
}
