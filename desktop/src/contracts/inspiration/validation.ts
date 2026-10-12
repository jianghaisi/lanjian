import { AppError } from '../core/app-error'
import { decodeGroupProfile } from '../group-chat/group-chat'
import { validatePolicyRecords, type CreativePolicyRecord } from '@lanjian/writing-plugin-contracts'
import type { InspirationCard, InspirationSource, InspirationSegment, InspirationJob, InspirationExtractionRequest, InspirationSearch } from './types'
import type { SourceClassification, ClassificationRequest, ImportClassification } from './types'
import { NOVEL_GENRE_IDS } from './genres'

const invalid = (): never => { throw new AppError('VALIDATION_ERROR', '知识库数据格式无效，请重新读取或核对输入。', { recoverable: true }) }
export const inspirationObject = (v: unknown, keys: readonly string[]): Record<string, unknown> => !v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k)) ? invalid() : v as Record<string, unknown>
export const inspirationText = (v: unknown, max = 200, min = 0): string => typeof v === 'string' && v.length <= max && v.trim().length >= min ? v : invalid()
export const inspirationId = (v: unknown): string => /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(inspirationText(v, 36, 36)) ? String(v) : invalid()
export const inspirationHash = (v: unknown): string => /^[a-f\d]{64}$/.test(inspirationText(v, 64, 64)) ? String(v) : invalid()
export const inspirationInt = (v: unknown, max: number, min = 0): number => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max ? Number(v) : invalid()
const oneOf = <const T extends string>(v: unknown, values: readonly T[]): T => values.includes(v as T) ? v as T : invalid()
const array = <T>(v: unknown, decode: (v: unknown) => T, max = 10000): T[] => Array.isArray(v) && v.length <= max ? v.map(decode) : invalid()
const bool = (v: unknown) => typeof v === 'boolean' ? v : invalid()
const seconds = (v: unknown): number | null => v === null ? null : typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 86400 ? v : invalid()
export function decodeInspirationPolicyRecords(value: unknown, slots: readonly string[] = ['inspiration-extract', 'inspiration-summary']): CreativePolicyRecord[] {
  try {
    const records = validatePolicyRecords(value)
    if (!records.length || records.some(r => !slots.includes(r.slot) || r.mode === 'disabled') || slots.some(slot => !records.some(r => r.slot === slot))) return invalid()
    return records
  } catch { return invalid() }
}
export function safeInspirationUrl(v: unknown): string {
  const s = inspirationText(v, 2000, 1); let url: URL
  try { url = new URL(s) } catch { return invalid() }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return invalid()
  if (!['bilibili.com', 'www.bilibili.com', 'b23.tv', 'douyin.com', 'www.douyin.com', 'v.douyin.com', 'm.douyin.com', 'www.iesdouyin.com', 'iesdouyin.com'].includes(url.hostname)) return invalid()
  return url.href
}
export function decodeInspirationSource(v: unknown): InspirationSource {
  const o = inspirationObject(v, ['id','version','revision','kind','title','url','platform','author','format','method','language','capturedAt','totalCharacters','segmentCount','auxiliaryCount','duration','acquisitionCoverage','visualCoverage','notice'])
  return { id: inspirationId(o.id), version: inspirationHash(o.version), revision: inspirationInt(o.revision, 1e9, 1), kind: oneOf(o.kind, ['novel','video']), title: inspirationText(o.title, 300, 1), ...(o.url === undefined ? {} : {url: safeInspirationUrl(o.url)}), ...(o.platform === undefined ? {} : { platform: oneOf(o.platform, ['bilibili','douyin']) }), author: inspirationText(o.author, 300), format: inspirationText(o.format, 100), method: oneOf(o.method, ['novel','subtitle','asr']), language: inspirationText(o.language, 100), capturedAt: inspirationText(o.capturedAt, 40, 1), totalCharacters: inspirationInt(o.totalCharacters, 20000000), segmentCount: inspirationInt(o.segmentCount, 10000, 1), auxiliaryCount:inspirationInt(o.auxiliaryCount,10000), duration: seconds(o.duration), acquisitionCoverage:oneOf(o.acquisitionCoverage??'complete',['complete','partial']), visualCoverage: oneOf(o.visualCoverage,['none','partial']), notice: inspirationText(o.notice, 2000) }
}
export function decodeInspirationSegment(v: unknown): InspirationSegment {
  const o = inspirationObject(v,['id','sourceId','version','index','title','text','purpose','contentHash','start','end','startSeconds','endSeconds'])
  const r = {id: inspirationId(o.id), sourceId: inspirationId(o.sourceId), version: inspirationHash(o.version), index: inspirationInt(o.index,10000), title: inspirationText(o.title,300,1), text: inspirationText(o.text,8000,1), purpose:oneOf(o.purpose,['story','auxiliary']), contentHash:inspirationHash(o.contentHash), start: inspirationInt(o.start,20000000), end: inspirationInt(o.end,20000000), startSeconds: seconds(o.startSeconds), endSeconds: seconds(o.endSeconds)}
  if(r.end-r.start!==r.text.length || (r.startSeconds!==null && (r.endSeconds===null || r.endSeconds<r.startSeconds)))return invalid()
  return r
}
export function decodeInspirationCard(v: unknown): InspirationCard {
  const o = inspirationObject(v,['id','sourceId','sourceVersion','segmentIds','kind','title','narrative','tags','characters','conflict','choice','outcome','turn','foreshadowing','evidence','model','modelFingerprint','extractionVersion','createdAt','stale','creativePolicy'])
  const r = { id: inspirationId(o.id), sourceId: inspirationId(o.sourceId), sourceVersion: inspirationHash(o.sourceVersion), segmentIds: array(o.segmentIds,inspirationId,10000), kind: oneOf(o.kind,['scene','arc']), title: inspirationText(o.title,200,1), narrative: inspirationText(o.narrative,14000,1), tags: array(o.tags,v=>inspirationText(v,50,1),12), characters: array(o.characters,v=>inspirationText(v,100,1),20), conflict: inspirationText(o.conflict,2000), choice: inspirationText(o.choice,2000), outcome: inspirationText(o.outcome,2000), turn: inspirationText(o.turn,2000), foreshadowing: inspirationText(o.foreshadowing,2000), evidence: array(o.evidence,v=>{const e=inspirationObject(v,['segmentId','quote']);return {segmentId:inspirationId(e.segmentId),quote:inspirationText(e.quote,500,1)}},24), model: inspirationText(o.model,300,1), modelFingerprint: inspirationHash(o.modelFingerprint), extractionVersion: inspirationInt(o.extractionVersion,100,1), createdAt: inspirationText(o.createdAt,40,1), stale: bool(o.stale) } satisfies InspirationCard
  if(!r.segmentIds.length || !r.evidence.length || new Set(r.segmentIds).size!==r.segmentIds.length || r.evidence.some(e=>!r.segmentIds.includes(e.segmentId)))return invalid()
  return {...r, ...(o.creativePolicy === undefined ? {} : {creativePolicy: decodeInspirationPolicyRecords(o.creativePolicy, [r.kind === 'scene' ? 'inspiration-extract' : 'inspiration-summary'])})}
}
export function decodeInspirationJob(v: unknown): InspirationJob {
  const o=inspirationObject(v,['id','sourceId','sourceVersion','revision','status','stage','total','processed','calls','maxCalls','profile','fingerprint','notice','createdAt','updatedAt','units','summaryStatus','cardIds','summaries','skippedSegmentIds','creativePolicy'])
  const r={id:inspirationId(o.id),sourceId:inspirationId(o.sourceId),sourceVersion:inspirationHash(o.sourceVersion),revision:inspirationInt(o.revision,1e9,1),status:oneOf(o.status,['running','succeeded','paused-limit','cancelled','failed','interrupted','usage-unconfirmed']),stage:oneOf(o.stage,['extracting','summarizing']),total:inspirationInt(o.total,10000,1),processed:inspirationInt(o.processed,10000),calls:inspirationInt(o.calls,1e6),maxCalls:inspirationInt(o.maxCalls,48,1),profile:decodeGroupProfile(o.profile),fingerprint:inspirationHash(o.fingerprint),notice:inspirationText(o.notice,2000),createdAt:inspirationText(o.createdAt,40),updatedAt:inspirationText(o.updatedAt,40),units:array(o.units,v=>{const u=inspirationObject(v,['segmentId','status','cardIds']);return {segmentId:inspirationId(u.segmentId),status:oneOf(u.status,['prepared','sent','completed','failed','unknown']),cardIds:array(u.cardIds,inspirationId,4)}},10000),summaryStatus:oneOf(o.summaryStatus,['pending','sent','completed','unknown']),cardIds:array(o.cardIds,inspirationId,60000)}
  const summaries=array(o.summaries,v=>{const s=inspirationObject(v,['key','inputCardIds','status','cardIds']);return {key:inspirationHash(s.key),inputCardIds:array(s.inputCardIds,inspirationId,6),status:oneOf(s.status,['sent','completed','failed','unknown']),cardIds:array(s.cardIds,inspirationId,1)}},20000)
  if(r.cardIds.length!==new Set(r.cardIds).size||r.units.length>r.total||r.units.some(u=>u.cardIds.some(id=>!r.cardIds.includes(id)))||summaries.some(s=>s.cardIds.some(id=>!r.cardIds.includes(id)))||r.status==='succeeded'&&(r.processed!==r.total||r.summaryStatus!=='completed')||r.processed>r.total || new Set(r.units.map(u=>u.segmentId)).size!==r.units.length || r.processed!==r.units.filter(u=>u.status==='completed').length)return invalid()
  return {...r,summaries,skippedSegmentIds:array(o.skippedSegmentIds,inspirationId,10000), ...(o.creativePolicy === undefined ? {} : {creativePolicy: decodeInspirationPolicyRecords(o.creativePolicy)})} as InspirationJob
}
export function decodeInspirationExtraction(v: unknown): InspirationExtractionRequest {
  const o=inspirationObject(v,['sourceId','sourceVersion','operationId','profile','maxCalls','includeAuxiliary']);return {sourceId:inspirationId(o.sourceId),sourceVersion:inspirationHash(o.sourceVersion),operationId:inspirationId(o.operationId),profile:decodeGroupProfile(o.profile),maxCalls:inspirationInt(o.maxCalls,48,1),includeAuxiliary:o.includeAuxiliary===undefined?false:bool(o.includeAuxiliary)}
}
export function decodeInspirationSearch(v: unknown): InspirationSearch {
  const o=inspirationObject(v,['query','kind','cardKind','sourceId','tag','offset','limit']);return {query:inspirationText(o.query,500),...(o.kind===undefined?{}:{kind:oneOf(o.kind,['novel','video'])}),...(o.cardKind===undefined?{}:{cardKind:oneOf(o.cardKind,['scene','arc'])}),...(o.sourceId===undefined?{}:{sourceId:inspirationId(o.sourceId)}),...(o.tag===undefined?{}:{tag:inspirationText(o.tag,50)}),offset:inspirationInt(o.offset??0,100000),limit:inspirationInt(o.limit??30,50,1)}
}
export function decodeSourceClassification(v: unknown): SourceClassification {
  const o=inspirationObject(v,['sourceId','genreId','revision','updatedAt'])
  const revision=inspirationInt(o.revision,1e9)
  const updatedAt=o.updatedAt===null?null:inspirationText(o.updatedAt,40,1)
  if((revision===0)!==(updatedAt===null))return invalid()
  return {sourceId:inspirationId(o.sourceId),genreId:oneOf(o.genreId,NOVEL_GENRE_IDS),revision,updatedAt}
}
export function decodeClassificationRequest(v: unknown): ClassificationRequest {
  const o=inspirationObject(v,['sourceId','sourceVersion','genreId','expectedRevision'])
  return {sourceId:inspirationId(o.sourceId),sourceVersion:inspirationHash(o.sourceVersion),genreId:oneOf(o.genreId,NOVEL_GENRE_IDS),expectedRevision:inspirationInt(o.expectedRevision,1e9)}
}
export function decodeImportClassifications(v: unknown): ImportClassification[] {
  const values=array(v,value=>{const o=inspirationObject(value,['sourceId','genreId','expectedRevision']);return {sourceId:inspirationId(o.sourceId),genreId:oneOf(o.genreId,NOVEL_GENRE_IDS),expectedRevision:inspirationInt(o.expectedRevision,1e9)}},20)
  if(new Set(values.map(value=>value.sourceId)).size!==values.length)return invalid()
  return values
}
export const inspirationDecode = {array, bool}
