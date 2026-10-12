import type { InspirationApi, InspirationSelectionReceipt } from './types'
import { decodeSourceClassification, decodeClassificationRequest, decodeImportClassifications } from './validation'
import { decodeInspirationCard, decodeInspirationExtraction, decodeInspirationJob, decodeInspirationSearch, decodeInspirationSegment, decodeInspirationSource, inspirationDecode, inspirationHash, inspirationId, inspirationInt, inspirationObject, inspirationText, safeInspirationUrl } from './validation'

const list = inspirationDecode.array
const noArgs = (a: unknown[]) => { if(a.length) throw new Error('INSPIRATION_ARGS'); return [] as [] }
const single = <T>(decode: (v:unknown)=>T) => (a:unknown[]):[T] => { if(a.length!==1)throw new Error('INSPIRATION_ARGS');return [decode(a[0])] }
export function decodeSelectionReceipt(v:unknown):InspirationSelectionReceipt {
  const o=inspirationObject(v,['operationId','bookId','sourceId','sourceVersion','cardId','materialId','createdAt'])
  return {operationId:inspirationId(o.operationId),bookId:inspirationText(o.bookId,32767,1),sourceId:inspirationId(o.sourceId),sourceVersion:inspirationHash(o.sourceVersion),cardId:inspirationId(o.cardId),materialId:inspirationText(o.materialId,512,1),createdAt:inspirationText(o.createdAt,40,1)}
}
export const inspirationResults={
  listSources:(v:unknown)=>list(v,decodeInspirationSource),
  listClassifications:(v:unknown)=>list(v,decodeSourceClassification),
  setClassification:decodeSourceClassification,
  importPreview:(v:unknown)=>{const o=inspirationObject(v,['token','sources','samples','warnings','bytes','classifications']);return {token:inspirationId(o.token),sources:list(o.sources,decodeInspirationSource,20),samples:list(o.samples,v=>{const s=inspirationObject(v,['sourceId','text']);return {sourceId:inspirationId(s.sourceId),text:inspirationText(s.text,2800)}},20),warnings:list(o.warnings,v=>inspirationText(v,2000),200),bytes:inspirationInt(o.bytes,64*1024*1024),...(o.classifications===undefined?{}:{classifications:list(o.classifications,decodeSourceClassification,20)})}},
  importCommit:(v:unknown)=>list(v,decodeInspirationSource,20),
  capabilities:(v:unknown)=>{const o=inspirationObject(v,['subtitles','videoAudio','asr','preparing','visual','notice']);return {subtitles:inspirationDecode.bool(o.subtitles),videoAudio:inspirationDecode.bool(o.videoAudio),asr:inspirationDecode.bool(o.asr),preparing:inspirationDecode.bool(o.preparing),visual:inspirationDecode.bool(o.visual),notice:inspirationText(o.notice,2000)}},
  search:(v:unknown)=>{const o=inspirationObject(v,['cards','sources','total','nextOffset']);return {cards:list(o.cards,decodeInspirationCard,50),sources:list(o.sources,decodeInspirationSource),total:inspirationInt(o.total,1e7),nextOffset:inspirationInt(o.nextOffset,1e7,-1)}},
  readSource:(v:unknown)=>{const o=inspirationObject(v,['source','segments','nextOffset']);return {source:decodeInspirationSource(o.source),segments:list(o.segments,decodeInspirationSegment,20),nextOffset:inspirationInt(o.nextOffset,10000,-1)}},
  readEvidence:(v:unknown)=>inspirationResults.readSource(v),
  readCard:decodeInspirationCard,extract:decodeInspirationJob,getJob:decodeInspirationJob,listJobs:(v:unknown)=>list(v,decodeInspirationJob),stop:decodeInspirationJob,resume:decodeInspirationJob,
  prepareSelection:(v:unknown)=>{const o=inspirationObject(v,['token','operationId','bookId','bookTitle','card','source','content']);return {token:inspirationId(o.token),operationId:inspirationId(o.operationId),bookId:inspirationText(o.bookId,32767,1),bookTitle:inspirationText(o.bookTitle,300,1),card:decodeInspirationCard(o.card),source:decodeInspirationSource(o.source),content:inspirationText(o.content,20000,1)}},
  commitSelection:decodeSelectionReceipt
}
export const inspirationArgs={
  listSources:noArgs,listClassifications:noArgs,setClassification:single(decodeClassificationRequest),capabilities:noArgs,prepareVideoRuntime:noArgs,cancelVideoPreparation:noArgs,listVideoJobs:noArgs,listJobs:noArgs,
  importPreview:single(v=>{const o=inspirationObject(v,['documents']);const documents=list(o.documents,v=>{const d=inspirationObject(v,['name','dataBase64']);return {name:inspirationText(d.name,300,1),dataBase64:inspirationText(d.dataBase64,32*1024*1024,1)}},20);if(!documents.length||documents.reduce((n,d)=>n+d.dataBase64.length,0)>32*1024*1024)throw new Error('INSPIRATION_SIZE');return {documents}}),
  importCommit:(a:unknown[]):[string,import('./types').ImportClassification[]|undefined]=>{if(a.length<1||a.length>2)throw new Error('INSPIRATION_ARGS');return [inspirationId(a[0]),a.length===2?decodeImportClassifications(a[1]):undefined]},videoJob:single(inspirationId),stopVideo:single(inspirationId),videoPreview:single(v=>{const o=inspirationObject(v,['url','operationId']);return {url:safeInspirationUrl(o.url),operationId:inspirationId(o.operationId)}}),
  search:single(decodeInspirationSearch),readCard:single(inspirationId),readEvidence:single(inspirationId),getJob:single(inspirationId),stop:single(inspirationId),extract:single(decodeInspirationExtraction),commitSelection:single(inspirationId),
  readSource:single(v=>{const o=inspirationObject(v,['sourceId','sourceVersion','offset','limit']);return {sourceId:inspirationId(o.sourceId),sourceVersion:inspirationHash(o.sourceVersion),offset:inspirationInt(o.offset,10000),limit:inspirationInt(o.limit,20,1)}}),
  resume:single(v=>{const o=inspirationObject(v,['jobId','expectedRevision']);return {jobId:inspirationId(o.jobId),expectedRevision:inspirationInt(o.expectedRevision,1e9,1)}}),
  prepareSelection:single(v=>{const o=inspirationObject(v,['bookId','cardId','sourceVersion','operationId']);return {bookId:inspirationText(o.bookId,32767,1),cardId:inspirationId(o.cardId),sourceVersion:inspirationHash(o.sourceVersion),operationId:inspirationId(o.operationId)}})
}
export function decodeVideoJob(v:unknown):import('./types').InspirationVideoJob {
  const o=inspirationObject(v,['id','url','status','stage','progress','notice','preview','createdAt','updatedAt'])
  if(!['running','succeeded','failed','cancelled','interrupted'].includes(String(o.status))||!['subtitles','audio','transcribing','ready'].includes(String(o.stage)))throw new Error('INSPIRATION_VIDEO_JOB')
  return {id:inspirationId(o.id),url:safeInspirationUrl(o.url),status:o.status as import('./types').InspirationVideoJob['status'],stage:o.stage as import('./types').InspirationVideoJob['stage'],progress:inspirationInt(o.progress,100),notice:inspirationText(o.notice,2000),preview:o.preview===null?null:inspirationResults.importPreview(o.preview),createdAt:inspirationText(o.createdAt,40,1),updatedAt:inspirationText(o.updatedAt,40,1)}
}
export const inspirationIpcResults=Object.fromEntries(Object.entries({...inspirationResults,listVideoJobs:(v:unknown)=>list(v,decodeVideoJob),cancelVideoPreparation:inspirationResults.capabilities,videoPreview:decodeVideoJob,videoJob:decodeVideoJob,stopVideo:decodeVideoJob,prepareVideoRuntime:inspirationResults.capabilities}).map(([name,decode])=>[`inspiration:${name}`,decode]))
export function createInspirationBridge(invoke:<T>(channel:string,...args:unknown[])=>Promise<T>):InspirationApi {
  const call=<T>(name:string,...args:unknown[])=>invoke<T>(`inspiration:${name}`,...args.map(a=>JSON.parse(JSON.stringify(a))))
  return {listSources:()=>call('listSources'),listClassifications:()=>call('listClassifications'),setClassification:v=>call('setClassification',v),importPreview:v=>call('importPreview',v),importCommit:(v,c)=>c===undefined?call('importCommit',v):call('importCommit',v,c),videoPreview:v=>call('videoPreview',v),listVideoJobs:()=>call('listVideoJobs'),cancelVideoPreparation:()=>call('cancelVideoPreparation'),videoJob:v=>call('videoJob',v),stopVideo:v=>call('stopVideo',v),capabilities:()=>call('capabilities'),prepareVideoRuntime:()=>call('prepareVideoRuntime'),search:v=>call('search',v),readSource:v=>call('readSource',v),readCard:v=>call('readCard',v),readEvidence:v=>call('readEvidence',v),extract:v=>call('extract',v),getJob:v=>call('getJob',v),listJobs:()=>call('listJobs'),stop:v=>call('stop',v),resume:v=>call('resume',v),prepareSelection:v=>call('prepareSelection',v),commitSelection:v=>call('commitSelection',v)}
}
