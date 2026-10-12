import { AppError } from '../core/app-error'
export type SettlementOutcome = 'realizes' | 'deviates-from' | 'new'
export type SettlementQuote = { start: number; end: number; quote: string }
export type SettlementFields = { time: string; characters: string[]; location: string; event: string; result: string }
export type SettlementPlan = { eventId: string; versionId: string; lifecycleId: string; content: SettlementFields }
export type SettlementBasis = { chapterId: number; documentId: string; bodyVersionId: string; bodyHash: string; revision: string; position: number; fingerprint: string }
export type SettlementContractEvent = { eventId: string; versionId: string | null; content: SettlementFields | null; current: boolean }
export type SettlementSource = { basis: SettlementBasis; title: string; body: string; plans: SettlementPlan[]; contract: string | null; contractEvents: SettlementContractEvent[] }
export type SettlementCandidate = { fields: SettlementFields; quotes: SettlementQuote[]; supplements: Array<keyof SettlementFields> }
export type SettlementDraft = SettlementCandidate & { id: string; revision: number; source: SettlementBasis; taskId: string | null; updatedAt: string }
export type SettlementDraftInput = SettlementCandidate & { chapterId: number; sourceFingerprint: string; id?: string; expectedRevision?: number }
export type SettlementSelection = { draftId: string; draftRevision: number; outcome: SettlementOutcome; plans: Array<{ eventId: string; versionId: string }>; replaces?: string }
export type SettlementPreviewInput = { chapterId: number; sourceFingerprint: string; selections: SettlementSelection[] }
export type SettlementWithdrawalInput = { chapterId: number; sourceFingerprint: string; decisionId: string; reason: string }
export type SettlementDecision = { id: string; eventId: string; eventVersionId: string; previousId: string | null; kind: 'confirm' | 'withdraw';
  source: SettlementBasis; outcome: SettlementOutcome; plans: SettlementPlan[]; quotes: SettlementQuote[]; supplements: Array<keyof SettlementFields>; reason: string; createdAt: string }
export type SettlementStatus = { decisionId: string; chapterId: number; position: number; bodyVersionId: string; state: 'current' | 'needs-review' | 'withdrawn' | 'superseded' | 'untracked'; reason: string }
export type SettlementHistory = { decision: SettlementDecision; status: SettlementStatus; fields: SettlementFields }
export type SettlementTask = { id: string; chapterId: number; status: string; error: string | null; drafts: SettlementDraft[]; rawOutput?: string }
export type SettlementPage = { source: SettlementSource; drafts: SettlementDraft[]; history: SettlementHistory[]; tasks: SettlementTask[] }
export type SettlementPreview = { token: string; operationId: string; expiresAt: number; items: Array<{ fields: SettlementFields; quotes: SettlementQuote[]; outcome: SettlementOutcome; plans: SettlementPlan[]; replaces?: string }>; withdrawal: string | null }
export type SettlementReceipt = { operationId: string; requestHash: string; chapterId: number; decisionIds: string[]; committedAt: string }
export type SettlementCommit = { receipt: SettlementReceipt; mirror: { status: string; issue: string } }
export type SettlementStartInput = { chapterId: number; expectedWorkItemId: string; operationId: string; sourceFingerprint: string }
export type SettlementApi = {
  chapterSettlement(chapterId: number): Promise<SettlementPage>
  saveSettlementDraft(input: SettlementDraftInput): Promise<SettlementDraft>
  previewSettlement(input: SettlementPreviewInput): Promise<SettlementPreview>
  previewSettlementWithdrawal(input: SettlementWithdrawalInput): Promise<SettlementPreview>
  commitSettlement(token: string): Promise<SettlementCommit>
  cancelSettlement(): Promise<boolean>
  settlementReceipt(operationId: string): Promise<SettlementReceipt | null>
  startSettlementExtraction(input: SettlementStartInput): Promise<SettlementTask>
  settlementTask(id: string): Promise<SettlementTask>
  stopSettlementTask(id: string): Promise<SettlementTask>
}
export function settlementInvalid(message = '事件结算数据无效，请重新核对。'): never { throw new AppError('VALIDATION_ERROR', message, { recoverable: true }) }
export function settlementObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) settlementInvalid()
  const row = value as Record<string, unknown>
  if (Object.keys(row).some(k => !keys.includes(k))) settlementInvalid()
  return row
}
export function settlementText(value: unknown, max = 200, empty = false): string {
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || (!empty && !value.trim())) settlementInvalid()
  return value
}
export function settlementNumber(value: unknown, min = 1, max = 1_000_000): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) settlementInvalid()
  return Number(value)
}
function list(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) settlementInvalid(); return value }
export function settlementHash(value: unknown): string { const s = settlementText(value, 64); if (!/^[a-f0-9]{64}$/.test(s)) settlementInvalid(); return s }
export function decodeSettlementFields(value: unknown): SettlementFields {
  const r = settlementObject(value, ['time','characters','location','event','result'])
  return { time: settlementText(r.time,500,true), characters: list(r.characters,100).map(x=>settlementText(x,200)),
    location: settlementText(r.location,500,true), event: settlementText(r.event,20_000,true), result: settlementText(r.result,20_000,true) }
}
export function decodeSettlementQuote(value: unknown): SettlementQuote {
  const r=settlementObject(value,['start','end','quote']),start=settlementNumber(r.start,0,2_000_000),end=settlementNumber(r.end,1,2_000_000)
  const quote=settlementText(r.quote,2000); if(end<=start || end-start!==quote.length) settlementInvalid('原文引用范围无效。')
  return {start,end,quote}
}
export function decodeSettlementCandidate(value: unknown): SettlementCandidate {
  const r=settlementObject(value,['fields','quotes','supplements'])
  const supplements=list(r.supplements,5).map(x=>settlementText(x)) as Array<keyof SettlementFields>
  if(new Set(supplements).size!==supplements.length || supplements.some(x=>!['time','characters','location','event','result'].includes(x))) settlementInvalid()
  return {fields:decodeSettlementFields(r.fields),quotes:list(r.quotes,5).map(decodeSettlementQuote),supplements}
}
export function decodeSettlementBasis(value: unknown): SettlementBasis {
  const r=settlementObject(value,['chapterId','documentId','bodyVersionId','bodyHash','revision','position','fingerprint'])
  return {chapterId:settlementNumber(r.chapterId), documentId:settlementText(r.documentId),bodyVersionId:settlementText(r.bodyVersionId),
    bodyHash:settlementHash(r.bodyHash),revision:settlementText(r.revision),position:settlementNumber(r.position,0),fingerprint:settlementHash(r.fingerprint)}
}
export function decodeSettlementPlan(value: unknown): SettlementPlan {
  const r=settlementObject(value,['eventId','versionId','lifecycleId','content'])
  return {eventId:settlementText(r.eventId),versionId:settlementText(r.versionId),lifecycleId:settlementText(r.lifecycleId),content:decodeSettlementFields(r.content)}
}
export function decodeSettlementDraftInput(value: unknown): SettlementDraftInput {
  const r=settlementObject(value,['chapterId','sourceFingerprint','id','expectedRevision','fields','quotes','supplements'])
  if((r.id===undefined)!==(r.expectedRevision===undefined)) settlementInvalid()
  return {...decodeSettlementCandidate({fields:r.fields,quotes:r.quotes,supplements:r.supplements}),chapterId:settlementNumber(r.chapterId),
    sourceFingerprint:settlementHash(r.sourceFingerprint),...(r.id===undefined?{}:{id:settlementText(r.id),expectedRevision:settlementNumber(r.expectedRevision)})}
}
export function decodeSettlementDraft(value: unknown): SettlementDraft {
  const r=settlementObject(value,['id','revision','source','taskId','updatedAt','fields','quotes','supplements'])
  return {...decodeSettlementCandidate({fields:r.fields,quotes:r.quotes,supplements:r.supplements}),id:settlementText(r.id),revision:settlementNumber(r.revision),
    source:decodeSettlementBasis(r.source),taskId:r.taskId===null?null:settlementText(r.taskId),updatedAt:settlementText(r.updatedAt)}
}
export function decodeSettlementSelection(value: unknown): SettlementSelection {
  const r=settlementObject(value,['draftId','draftRevision','outcome','plans','replaces'])
  if(!['new','realizes','deviates-from'].includes(String(r.outcome))) settlementInvalid()
  const plans=list(r.plans,20).map(v=>{const p=settlementObject(v,['eventId','versionId']);return {eventId:settlementText(p.eventId),versionId:settlementText(p.versionId)}})
  if(new Set(plans.map(p=>p.eventId)).size!==plans.length || (r.outcome==='new'?plans.length!==0:plans.length===0)) settlementInvalid('请选择对应计划；新增事件无需关联计划。')
  return {draftId:settlementText(r.draftId),draftRevision:settlementNumber(r.draftRevision),outcome:r.outcome as SettlementOutcome,plans,
    ...(r.replaces===undefined?{}:{replaces:settlementText(r.replaces)})}
}
export function decodeSettlementPreviewInput(value: unknown): SettlementPreviewInput {
  const r=settlementObject(value,['chapterId','sourceFingerprint','selections']),selections=list(r.selections,20).map(decodeSettlementSelection)
  if(!selections.length || new Set(selections.map(x=>x.draftId)).size!==selections.length ||
    new Set(selections.flatMap(x=>x.replaces?[x.replaces]:[])).size!==selections.filter(x=>x.replaces).length) settlementInvalid()
  return {chapterId:settlementNumber(r.chapterId),sourceFingerprint:settlementHash(r.sourceFingerprint),selections}
}
export function decodeSettlementWithdrawal(value: unknown): SettlementWithdrawalInput {
  const r=settlementObject(value,['chapterId','sourceFingerprint','decisionId','reason'])
  return {chapterId:settlementNumber(r.chapterId),sourceFingerprint:settlementHash(r.sourceFingerprint),decisionId:settlementText(r.decisionId),reason:settlementText(r.reason,2000)}
}
export function decodeSettlementStart(value: unknown): SettlementStartInput {
  const r=settlementObject(value,['chapterId','expectedWorkItemId','operationId','sourceFingerprint'])
  return {chapterId:settlementNumber(r.chapterId),expectedWorkItemId:settlementText(r.expectedWorkItemId,1000),operationId:settlementText(r.operationId),sourceFingerprint:settlementHash(r.sourceFingerprint)}
}
export function decodeSettlementDecision(value: unknown): SettlementDecision {
  const r=settlementObject(value,['id','eventId','eventVersionId','previousId','kind','source','outcome','plans','quotes','supplements','reason','createdAt'])
  if(!['confirm','withdraw'].includes(String(r.kind)) || !['new','realizes','deviates-from'].includes(String(r.outcome))) settlementInvalid()
  const candidate=decodeSettlementCandidate({fields:{time:'',characters:[],location:'',event:'',result:''},quotes:r.quotes,supplements:r.supplements})
  return {id:settlementText(r.id),eventId:settlementText(r.eventId),eventVersionId:settlementText(r.eventVersionId),previousId:r.previousId===null?null:settlementText(r.previousId),
    kind:r.kind as 'confirm'|'withdraw',source:decodeSettlementBasis(r.source),outcome:r.outcome as SettlementOutcome,plans:list(r.plans,20).map(decodeSettlementPlan),
    quotes:candidate.quotes,supplements:candidate.supplements,reason:settlementText(r.reason,2000,true),createdAt:settlementText(r.createdAt)}
}
export function decodeSettlementStatus(value: unknown): SettlementStatus {
  const r=settlementObject(value,['decisionId','chapterId','position','bodyVersionId','state','reason'])
  if(!['current','needs-review','withdrawn','superseded','untracked'].includes(String(r.state))) settlementInvalid()
  return {decisionId:settlementText(r.decisionId,200,true),chapterId:settlementNumber(r.chapterId,0),position:settlementNumber(r.position,0),bodyVersionId:settlementText(r.bodyVersionId,200,true),
    state:r.state as SettlementStatus['state'],reason:settlementText(r.reason,500,true)}
}
export function decodeSettlementReceipt(value: unknown): SettlementReceipt {
  const r=settlementObject(value,['operationId','requestHash','chapterId','decisionIds','committedAt'])
  const ids=list(r.decisionIds,20).map(x=>settlementText(x))
  if(!ids.length||new Set(ids).size!==ids.length)settlementInvalid()
  return {operationId:settlementText(r.operationId),requestHash:settlementHash(r.requestHash),chapterId:settlementNumber(r.chapterId),
    decisionIds:ids,committedAt:settlementText(r.committedAt)}
}
export function decodeSettlementTask(value: unknown): SettlementTask {
  const r=settlementObject(value,['id','chapterId','status','error','drafts','rawOutput'])
  if(!['queued','preparing','running','streaming','resuming','succeeded','failed','interrupted','cancelled'].includes(String(r.status)))settlementInvalid()
  return {id:settlementText(r.id),chapterId:settlementNumber(r.chapterId),status:settlementText(r.status),error:r.error===null?null:settlementText(r.error,1000),
    drafts:list(r.drafts,30).map(decodeSettlementDraft),...(r.rawOutput===undefined?{}:{rawOutput:settlementText(r.rawOutput,1_000_000,true)})}
}
export function decodeSettlementContractEvent(value: unknown): SettlementContractEvent {
  const r=settlementObject(value,['eventId','versionId','content','current'])
  if(typeof r.current!=='boolean' || (r.versionId===null && (r.content!==null || r.current)) || (r.current && r.content===null))settlementInvalid()
  return {eventId:settlementText(r.eventId),versionId:r.versionId===null?null:settlementText(r.versionId),content:r.content===null?null:decodeSettlementFields(r.content),current:r.current}
}
export function decodeSettlementPage(value: unknown): SettlementPage {
  const r=settlementObject(value,['source','drafts','history','tasks']),s=settlementObject(r.source,['basis','title','body','plans','contract','contractEvents'])
  return {source:{basis:decodeSettlementBasis(s.basis),title:settlementText(s.title,1000,true),body:settlementText(s.body,2_000_000,true),
    plans:list(s.plans,200).map(decodeSettlementPlan),contract:s.contract===null?null:settlementHash(s.contract),contractEvents:list(s.contractEvents,200).map(decodeSettlementContractEvent)},
    drafts:list(r.drafts,1000).map(decodeSettlementDraft),history:list(r.history,2000).map(v=>{const x=settlementObject(v,['decision','status','fields']);
      return {decision:decodeSettlementDecision(x.decision),status:decodeSettlementStatus(x.status),fields:decodeSettlementFields(x.fields)}}),
    tasks:list(r.tasks,30).map(decodeSettlementTask)}
}
export function decodeSettlementPreview(value: unknown): SettlementPreview {
  const r=settlementObject(value,['token','operationId','expiresAt','items','withdrawal'])
  return {token:settlementText(r.token),operationId:settlementText(r.operationId),expiresAt:settlementNumber(r.expiresAt,1,Number.MAX_SAFE_INTEGER),
    items:list(r.items,20).map(v=>{const x=settlementObject(v,['fields','quotes','outcome','plans','replaces']);
      if(!['new','realizes','deviates-from'].includes(String(x.outcome))) settlementInvalid()
      return {fields:decodeSettlementFields(x.fields),quotes:list(x.quotes,5).map(decodeSettlementQuote),outcome:x.outcome as SettlementOutcome,
        plans:list(x.plans,20).map(decodeSettlementPlan),...(x.replaces===undefined?{}:{replaces:settlementText(x.replaces)})}}),
    withdrawal:r.withdrawal===null?null:settlementText(r.withdrawal,2000)}
}
export const settlementResultDecoders: Record<string,(v:unknown)=>unknown> = {
  'events:settlement-page':decodeSettlementPage,'events:settlement-draft':decodeSettlementDraft,
  'events:settlement-preview':decodeSettlementPreview,'events:settlement-withdraw':decodeSettlementPreview,
  'events:settlement-commit':v=>{const r=settlementObject(v,['receipt','mirror']),m=settlementObject(r.mirror,['status','issue']);
    if(!['synced','pending','conflict','failed'].includes(String(m.status))) settlementInvalid()
    return {receipt:decodeSettlementReceipt(r.receipt),mirror:{status:settlementText(m.status),issue:settlementText(m.issue)}}},
  'events:settlement-receipt':v=>v===null?null:decodeSettlementReceipt(v),
  'events:settlement-cancel':v=>{if(typeof v!=='boolean')settlementInvalid();return v},
  'events:settlement-start':decodeSettlementTask,'events:settlement-task':decodeSettlementTask,'events:settlement-stop':decodeSettlementTask
}
