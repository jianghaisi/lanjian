import { createHash } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import { decodeSettlementCandidate, type SettlementCandidate, type SettlementDecision, type SettlementDraft, type SettlementFields,
  type SettlementPlan, type SettlementSource, type SettlementStatus, type SettlementSelection, type SettlementReceipt } from '../../../../contracts/timeline/prose-event-settlement-contracts'
import type { StoryEventVersion } from './story-event-version'
export const settlementTaskType = 'prose_event_extraction'
export const settlementHash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
export function settlementConflict(message='正文、计划或结算已经变化，请重新核对。'): never { throw new AppError('CONFLICT',message,{recoverable:true}) }
export function validateSettlementEvidence(candidate: SettlementCandidate, body: string, complete: boolean) {
  decodeSettlementCandidate({fields:candidate.fields,quotes:candidate.quotes,supplements:candidate.supplements})
  if (candidate.quotes.some(q=>body.slice(q.start,q.end)!==q.quote)) settlementConflict('引用与本版正文不一致，请重新选择原句。')
  const f=candidate.fields
  if(complete && (!candidate.quotes.length || !f.time.trim() || !f.characters.length || !f.location.trim() || !f.event.trim()))
    throw new AppError('VALIDATION_ERROR','请补齐时间、人物、地点、事件和正文原句。',{recoverable:true})
}
export function fieldsOf(version: StoryEventVersion): SettlementFields {
  return {time:version.content.time,characters:[...version.content.characters],location:version.content.location,event:version.content.event,result:version.content.result??''}
}
export function parseSettlementOutput(raw: string, body: string): SettlementCandidate[] {
  if(raw.length>1_000_000) throw new AppError('AI_RESPONSE_INVALID','事件提取结果过长，未确认任何事件。',{recoverable:true})
  let parsed: unknown
  try { parsed=JSON.parse(raw.trim().replace(/^\`\`\`(?:json)?\s*/i,'').replace(/\s*\`\`\`$/,'')) } catch { parsed=null }
  if(!Array.isArray(parsed) || parsed.length>30) throw new AppError('AI_RESPONSE_INVALID','事件提取格式无效或超过 30 项，结果已保留。',{recoverable:true})
  try { return parsed.map(v=>{const candidate=decodeSettlementCandidate(v);validateSettlementEvidence(candidate,body,false);
    if(!candidate.quotes.length || candidate.supplements.length) throw new Error('model evidence');return candidate}) }
  catch(cause){throw new AppError('AI_RESPONSE_INVALID','事件提取的原句或字段无效，未确认任何事件。',{recoverable:true,cause})}
}
export type SettlementPreparedItem = { draft: SettlementDraft; selection: SettlementSelection; plans: SettlementPlan[]; previous: SettlementDecision | null; expectedEventHead: string | null }
export type SettlementCommand = { operationId: string; requestHash: string; source: SettlementSource; items: SettlementPreparedItem[]; withdrawal: {previous:SettlementDecision;reason:string;expectedEventHead:string} | null }
export type SettlementReadPort = {
  /** Opaque physical root/database identity, private to main. */
  identity(): string
  source(chapterId:number): SettlementSource
  drafts(chapterId:number): SettlementDraft[]
  decisions(chapterId?:number): SettlementDecision[]
  receipt(operationId:string): SettlementReceipt | null
  event(eventId:string,versionId?:string): StoryEventVersion | null
  statuses(): Map<string,SettlementStatus>
}
export type SettlementWritePort = SettlementReadPort & {
  saveDraft(source: SettlementSource,candidate: SettlementCandidate,id?:string,expectedRevision?:number,taskId?:string): SettlementDraft
  commit(command:SettlementCommand,assertActive:()=>void): SettlementReceipt
  saveDrafts(source:SettlementSource,candidates:SettlementCandidate[],taskId:string):SettlementDraft[]
  close():void
}
export function settlementEligibility(decision: SettlementDecision, source: SettlementSource | null, event: StoryEventVersion | null,
  currentPlans: Map<string,{versionId:string;lifecycleId:string}>, latestId=decision.id): SettlementStatus {
  const status: SettlementStatus={decisionId:decision.id,chapterId:decision.source.chapterId,position:source?.basis.position??decision.source.position,
    bodyVersionId:decision.source.bodyVersionId,state:'current',reason:''}
  if(latestId!==decision.id) return {...status,state:'superseded',reason:'已有后续复核记录'}
  if(decision.kind==='withdraw') return {...status,state:'withdrawn',reason:decision.reason}
  if(!source || source.basis.documentId!==decision.source.documentId || source.basis.bodyVersionId!==decision.source.bodyVersionId ||
    source.basis.bodyHash!==decision.source.bodyHash || source.basis.revision!==decision.source.revision)
    return {...status,state:'needs-review',reason:'正文版本或章节状态已变化'}
  if(event?.id!==decision.eventVersionId) return {...status,state:'needs-review',reason:'实际事件版本已变化'}
  if(decision.plans.some(p=>{const current=currentPlans.get(p.eventId);return current?.versionId!==p.versionId || current.lifecycleId!==p.lifecycleId}))
    return {...status,state:'needs-review',reason:'关联计划已变化'}
  return status
}

/** Current managed settlements can be prior facts only before the target's active position.
 * This is the recent 30-record window; context compilation still enforces its token budget. */
export function priorSettlements<T extends {settlement?: Readonly<SettlementStatus>}>(events:readonly T[],position:number|undefined):T[]{
 if(position===undefined)return []
 return events.filter(e=>e.settlement?.state==='current' && e.settlement.position<position)
  .sort((a,b)=>b.settlement!.position-a.settlement!.position).slice(0,30)
}
