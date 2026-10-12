import { assertJson, decodeMarketRelease, decodePublishRequest, marketDigest, marketRecord, marketText, type MarketPage, type MarketQuery, type MarketRelease, type PublishRequest } from '@lanjian/writing-plugin-contracts'
import type { MarketStatus } from '../../../../contracts/writing-plugins/marketplace'
export interface MarketAuthPort {
  view(): MarketStatus['auth']
  token(): string
  begin(): Promise<MarketStatus['auth']>
  logout(): MarketStatus['auth']
}
export interface MarketClientPort {
  catalog(query: MarketQuery): Promise<MarketPage>
  versions(pluginId: string, query: MarketQuery): Promise<MarketPage>
  prepare(request: PublishRequest): Promise<{ release: MarketRelease; ticket: string }>
  commit(operation: string, ticket: string, bytes: Uint8Array): Promise<MarketRelease>
  status(operation: string): Promise<MarketRelease>
  publicRelease(operation: string): Promise<MarketRelease>
  withdraw(operation: string): Promise<MarketRelease>
  download(operation: string, digest: string): Promise<Uint8Array>
}
export type MarketIntent = { publisherId: string; request: PublishRequest; release: MarketRelease | null }
export type MarketJournal = { origin: string; intents: MarketIntent[]; downloads: MarketRelease[] }
export interface MarketStorePort {
  read(): Promise<MarketJournal>
  intent(intent: MarketIntent, bytes: Uint8Array): Promise<void>
  release(release: MarketRelease): Promise<void>
  download(release: MarketRelease, bytes: Uint8Array): Promise<string>
  bytes(digest: string): Promise<Uint8Array>
}
export function decodeMarketJournal(v: unknown): MarketJournal {
  assertJson(v, 8 * 1024 * 1024)
  const value = marketRecord(v, ['origin', 'intents', 'downloads'])
  const list = (raw: unknown) => { if (!Array.isArray(raw) || raw.length > 64) throw new Error('Invalid market journal'); return raw }
  const intents = list(value.intents).map(raw => {
    const item = marketRecord(raw, ['publisherId', 'request', 'release']), request = decodePublishRequest(item.request), release = item.release === null ? null : decodeMarketRelease(item.release), publisherId = marketDigest(item.publisherId)
    if (release && (release.operationId !== request.operationId || release.digest !== request.digest || release.bytes !== request.bytes || release.publisherId !== publisherId || JSON.stringify(release.manifest) !== JSON.stringify(request.manifest) || JSON.stringify(release.upstream) !== JSON.stringify(request.upstream))) throw new Error('Invalid release receipt')
    return { publisherId, request, release }
  })
  if (new Set(intents.map(i => i.request.operationId)).size !== intents.length) throw new Error('Duplicate operation')
  return { origin: marketText(value.origin, 2048), intents, downloads: list(value.downloads).map(decodeMarketRelease) }
}
