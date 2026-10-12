import type { ModelProfile } from '../models/types'
import type { CreativePolicyRecord } from '@lanjian/writing-plugin-contracts'
import type { NovelGenreId } from './genres'

export type SourceClassification = { sourceId: string; genreId: NovelGenreId; revision: number; updatedAt: string | null }
export type ClassificationRequest = { sourceId: string; sourceVersion: string; genreId: NovelGenreId; expectedRevision: number }
export type ImportClassification = { sourceId: string; genreId: NovelGenreId; expectedRevision: number }

export type InspirationSource = {
  id: string; version: string; revision: number; kind: 'novel' | 'video'; title: string; url?: string
  platform?: 'bilibili' | 'douyin'; author: string; format: string; method: 'novel' | 'subtitle' | 'asr'
  language: string; capturedAt: string; totalCharacters: number; segmentCount: number; auxiliaryCount:number; duration: number | null
  acquisitionCoverage:'complete'|'partial'; visualCoverage: 'none' | 'partial'; notice: string
}
export type InspirationSegment = {
  id: string; sourceId: string; version: string; index: number; title: string; text: string; purpose:'story'|'auxiliary'; contentHash:string
  start: number; end: number; startSeconds: number | null; endSeconds: number | null
}
export type InspirationCard = {
  id: string; sourceId: string; sourceVersion: string; segmentIds: string[]; kind: 'scene' | 'arc'
  title: string; narrative: string; tags: string[]; characters: string[]; conflict: string; choice: string
  outcome: string; turn: string; foreshadowing: string; evidence: Array<{ segmentId: string; quote: string }>
  model: string; modelFingerprint: string; extractionVersion: number; createdAt: string; stale: boolean
  creativePolicy?: CreativePolicyRecord[]
}
export type InspirationJob = {
  id: string; sourceId: string; sourceVersion: string; revision: number
  status: 'running' | 'succeeded' | 'paused-limit' | 'cancelled' | 'failed' | 'interrupted' | 'usage-unconfirmed'
  stage: 'extracting' | 'summarizing'; total: number; processed: number; calls: number; maxCalls: number
  profile: ModelProfile; fingerprint: string; notice: string; createdAt: string; updatedAt: string
  creativePolicy?: CreativePolicyRecord[]
  units: Array<{ segmentId: string; status: 'prepared' | 'sent' | 'completed' | 'failed' | 'unknown'; cardIds: string[] }>
  skippedSegmentIds:string[]
  summaryStatus: 'pending' | 'sent' | 'completed' | 'unknown'; cardIds: string[]
  summaries: Array<{ key: string; inputCardIds: string[]; status: 'sent' | 'completed' | 'failed' | 'unknown'; cardIds: string[] }>
}
export type InspirationImportDocument = { name: string; dataBase64: string }
export type InspirationImportPreview = { token: string; sources: InspirationSource[]; samples:Array<{sourceId:string;text:string}>; warnings: string[]; bytes: number; classifications?: SourceClassification[] }
export type InspirationSearch = { query: string; kind?: 'novel' | 'video'; cardKind?: 'scene' | 'arc'; sourceId?: string; tag?: string; offset?: number; limit?: number }
export type InspirationSearchResult = { cards: InspirationCard[]; sources: InspirationSource[]; total: number; nextOffset: number }
export type InspirationReadSource = { source: InspirationSource; segments: InspirationSegment[]; nextOffset: number }
export type InspirationExtractionRequest = { sourceId: string; sourceVersion: string; operationId: string; profile: ModelProfile; maxCalls: number; includeAuxiliary?:boolean }
export type InspirationSelection = { token: string; operationId: string; bookId: string; bookTitle: string; card: InspirationCard; source: InspirationSource; content: string }
export type InspirationSelectionReceipt = { operationId: string; bookId: string; sourceId: string; sourceVersion: string; cardId: string; materialId: string; createdAt: string }
export type InspirationCapabilities = { subtitles: boolean; videoAudio: boolean; asr: boolean; preparing: boolean; visual: boolean; notice: string }
export type InspirationVideoJob = { id:string; url:string; status:'running'|'succeeded'|'failed'|'cancelled'|'interrupted'; stage:'subtitles'|'audio'|'transcribing'|'ready'; progress:number; notice:string; preview:InspirationImportPreview|null; createdAt:string; updatedAt:string }
export type InspirationApi = {
  listSources(): Promise<InspirationSource[]>
  listClassifications(): Promise<SourceClassification[]>
  setClassification(input: ClassificationRequest): Promise<SourceClassification>
  importPreview(input: { documents: InspirationImportDocument[] }): Promise<InspirationImportPreview>
  importCommit(token: string, classifications?: ImportClassification[]): Promise<InspirationSource[]>
  videoPreview(input: { url: string; operationId:string }): Promise<InspirationVideoJob>
  listVideoJobs():Promise<InspirationVideoJob[]>
  cancelVideoPreparation():Promise<InspirationCapabilities>
  videoJob(id:string):Promise<InspirationVideoJob>
  stopVideo(id:string):Promise<InspirationVideoJob>
  capabilities(): Promise<InspirationCapabilities>
  prepareVideoRuntime(): Promise<InspirationCapabilities>
  search(input: InspirationSearch): Promise<InspirationSearchResult>
  readSource(input: { sourceId: string; sourceVersion: string; offset: number; limit: number }): Promise<InspirationReadSource>
  readEvidence(id:string):Promise<InspirationReadSource>
  readCard(id: string): Promise<InspirationCard>
  extract(input: InspirationExtractionRequest): Promise<InspirationJob>
  getJob(id: string): Promise<InspirationJob>
  listJobs(): Promise<InspirationJob[]>
  stop(id: string): Promise<InspirationJob>
  resume(input: { jobId: string; expectedRevision: number }): Promise<InspirationJob>
  prepareSelection(input: { bookId: string; cardId: string; sourceVersion: string; operationId: string }): Promise<InspirationSelection>
  commitSelection(token: string): Promise<InspirationSelectionReceipt>
}
