import { randomUUID } from 'node:crypto'
import { AppError, isAppError } from '../../../core/errors/app-error'
import type { WorkspaceDatabaseFactory, WorkspaceEventReadPort } from '../../../core/ports/workspace-database'
import { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'
import { decodeSettlementDraftInput,decodeSettlementPreviewInput,decodeSettlementWithdrawal,
 type SettlementDraftInput,type SettlementPreviewInput,type SettlementWithdrawalInput,type SettlementPreview,type SettlementPage,
 type SettlementSource,type SettlementCandidate,type SettlementCommit } from '../../../../contracts/timeline/prose-event-settlement-contracts'
import { settlementHash as hash,settlementConflict as conflict,validateSettlementEvidence,fieldsOf,
 type SettlementCommand,type SettlementReadPort } from '../domain/prose-event-settlement'
import type { EventSnapshotScope } from '../domain/event-source-snapshot'
import type { EventMirrorFeedback } from '../domain/event-mirror'
type Pending={token:string;expiresAt:number;generation:number;scope:EventSnapshotScope;command:SettlementCommand}
export class ProseEventSettlementService{
 private generation=0
 private pending:Pending|null=null
 constructor(private databases:Pick<WorkspaceDatabaseFactory,'openEventReadOnly'|'openSettlementWrite'>,private scope:()=>Promise<EventSnapshotScope>,private writes:WorkspaceWriteCoordinator,
  private mirrors?:{retryCaptured(root:string):Promise<EventMirrorFeedback>},private now=()=>Date.now()){}
 cancel(){this.generation++;this.pending=null;return true}
 private async assertScope(scope:EventSnapshotScope,generation:number){
  const current=await this.scope()
  if(generation!==this.generation||current.root!==scope.root||current.workItemId!==scope.workItemId||current.generation!==scope.generation)conflict('作品或核对页面已变化，请重新预览。')
 }
 async withRead<T>(root:string,action:(store:SettlementReadPort,read:WorkspaceEventReadPort)=>T):Promise<T>{
  const read=await this.databases.openEventReadOnly?.(root)
  try{if(!read||read.bookRoot!==root||!read.settlements)throw unavailable();return action(read.settlements(),read)}
  catch(e){throw safe(e)}finally{read?.close()}
 }
 async sourceForTask(){const scope=await this.scope();return {scope,source:(id:number)=>this.withRead(scope.root,s=>s.source(id))}}
 async page(chapterId:number,recent?:()=>Promise<SettlementPage['tasks']>):Promise<SettlementPage>{
  const scope=await this.scope(),generation=this.generation
  const page=await this.withRead(scope.root,store=>{
   const source=store.source(chapterId),decisions=store.decisions(chapterId),statuses=store.statuses(),latest=new Map(decisions.map(d=>[d.eventId,d.id]))
   return {source,drafts:store.drafts(chapterId),history:decisions.map(decision=>{
    const status=statuses.get(decision.eventId)!,version=store.event(decision.eventId,decision.eventVersionId)
    if(!version)conflict()
    return {decision,status:latest.get(decision.eventId)===decision.id?status:{...status,decisionId:decision.id,state:'superseded' as const,reason:'已有后续复核记录'},fields:fieldsOf(version)}
   }).reverse(),tasks:[]}
  })
  const tasks=recent?await recent():[]
  await this.assertScope(scope,generation);return {...page,tasks}
 }
 async saveDraft(value:SettlementDraftInput){
  const input=decodeSettlementDraftInput(value),scope=await this.scope(),generation=this.generation
  return this.writes.run(scope.root,async()=>{
   await this.assertScope(scope,generation)
   const writer=await this.databases.openSettlementWrite?.(scope.root)
   try{
    if(!writer)throw unavailable()
    const source=writer.source(input.chapterId)
    if(source.basis.fingerprint!==input.sourceFingerprint)conflict()
    await this.assertScope(scope,generation)
    const prior=input.id?writer.drafts(input.chapterId).find(d=>d.id===input.id):undefined
    const supplements=new Set(prior?.supplements??[])
    for(const field of Object.keys(input.fields) as Array<keyof typeof input.fields>){
     if(JSON.stringify(input.fields[field])!==JSON.stringify(prior?.fields[field]) && (Array.isArray(input.fields[field])?input.fields[field].length:Boolean(input.fields[field])))supplements.add(field)
    }
    return writer.saveDraft(source,{fields:input.fields,quotes:input.quotes,supplements:[...supplements]},input.id,input.expectedRevision)
   }catch(e){throw safe(e)}finally{writer?.close()}
  })
 }
 async saveExtracted(root:string,source:SettlementSource,candidates:SettlementCandidate[],taskId:string,assertActive:()=>void|Promise<void>=()=>{}){
  return this.writes.run(root,async()=>{
   await assertActive()
   const writer=await this.databases.openSettlementWrite?.(root)
   try{
    if(!writer)throw unavailable()
    if(writer.source(source.basis.chapterId).basis.fingerprint!==source.basis.fingerprint)conflict()
    const existing=writer.drafts(source.basis.chapterId).filter(d=>d.taskId===taskId)
    if(existing.length){if(existing.length!==candidates.length)conflict('提取候选保存未完成，原始输出已保留。');return existing}
    await assertActive();return writer.saveDrafts(source,candidates,taskId)
   }catch(e){throw safe(e)}finally{writer?.close()}
  })
 }
 async preview(value:SettlementPreviewInput):Promise<SettlementPreview>{
  this.cancel()
  const input=decodeSettlementPreviewInput(value),scope=await this.scope(),generation=this.generation
  const prepared=await this.withRead(scope.root,store=>{
   const source=store.source(input.chapterId)
   if(source.basis.fingerprint!==input.sourceFingerprint)conflict()
   const drafts=store.drafts(input.chapterId),decisions=store.decisions(input.chapterId),latest=new Map(decisions.map(d=>[d.eventId,d.id]))
   const items=input.selections.map(selection=>{
    const draft=drafts.find(d=>d.id===selection.draftId&&d.revision===selection.draftRevision)
    if(!draft||draft.source.fingerprint!==source.basis.fingerprint)conflict('候选引用的正文或计划已变化，请编辑并重新保存候选。')
    validateSettlementEvidence(draft,source.body,true)
    const plans=selection.plans.map(p=>{const plan=source.plans.find(x=>x.eventId===p.eventId&&x.versionId===p.versionId);if(!plan)conflict();return plan})
    const previous=selection.replaces?decisions.find(d=>d.id===selection.replaces)??null:null
    if(selection.replaces&&(!previous||latest.get(previous.eventId)!==previous.id))conflict()
    const expectedEventHead=previous?store.event(previous.eventId)?.id??null:null
    if(previous&&!expectedEventHead)conflict()
    return {draft,selection,plans,previous,expectedEventHead}
   })
   return {source,items,withdrawal:null}
  })
  await this.assertScope(scope,generation)
  return this.grant(scope,generation,prepared)
 }
 async previewWithdrawal(value:SettlementWithdrawalInput):Promise<SettlementPreview>{
  this.cancel()
  const input=decodeSettlementWithdrawal(value),scope=await this.scope(),generation=this.generation
  const prepared=await this.withRead(scope.root,store=>{
   const source=store.source(input.chapterId),decisions=store.decisions(input.chapterId),previous=decisions.find(d=>d.id===input.decisionId)
   if(source.basis.fingerprint!==input.sourceFingerprint||!previous||previous.kind==='withdraw'||decisions.filter(d=>d.eventId===previous.eventId).at(-1)?.id!==previous.id)conflict()
   const expectedEventHead=store.event(previous.eventId)?.id
   if(!expectedEventHead)conflict()
   return {source,items:[],withdrawal:{previous,reason:input.reason,expectedEventHead}}
  })
  await this.assertScope(scope,generation);return this.grant(scope,generation,prepared)
 }
 private grant(scope:EventSnapshotScope,generation:number,prepared:Omit<SettlementCommand,'operationId'|'requestHash'>):SettlementPreview{
  const command:SettlementCommand={...prepared,operationId:randomUUID(),requestHash:''}
  command.requestHash=hash({...command,requestHash:undefined})
  const pending:Pending={token:randomUUID(),expiresAt:this.now()+900000,generation,scope,command}
  this.pending=pending
  return {token:pending.token,operationId:command.operationId,expiresAt:pending.expiresAt,withdrawal:command.withdrawal?.reason??null,
   items:command.items.map(i=>({fields:i.draft.fields,quotes:i.draft.quotes,outcome:i.selection.outcome,plans:i.plans,...(i.previous?{replaces:i.previous.eventId}:{})}))}
 }
 async commit(token:string):Promise<SettlementCommit>{
  const p=this.pending;this.pending=null
  if(!p||p.token!==token||p.expiresAt<=this.now()||p.generation!==this.generation)conflict('确认已失效，请重新预览；如已提交请先查询回执。')
  const assertActive=()=>{if(p.generation!==this.generation||p.expiresAt<=this.now())conflict()}
  const receipt=await this.writes.run(p.scope.root,async()=>{
   await this.assertScope(p.scope,p.generation);assertActive()
   const writer=await this.databases.openSettlementWrite?.(p.scope.root)
   let receipt
   try{
    if(!writer)throw unavailable()
    const source=writer.source(p.command.source.basis.chapterId)
    if(source.basis.fingerprint!==p.command.source.basis.fingerprint||source.body!==p.command.source.body)conflict()
    await this.assertScope(p.scope,p.generation)
    receipt=writer.commit(p.command,assertActive)
   }catch(e){throw safe(e)}finally{
    try{writer?.close()}catch(cause){throw new AppError('STORAGE_ERROR','连接未正常结束，请查询本次操作回执确认是否保存成功。',{recoverable:true,cause})}
   }
   return receipt
  })
  let mirror:EventMirrorFeedback={status:'pending',issue:'unavailable'}
  if(this.mirrors)try{mirror=await this.mirrors.retryCaptured(p.scope.root)}catch{mirror={status:'failed',issue:'storage-error'}}
  return {receipt,mirror}
 }
 async receipt(operationId:string){
  const scope=await this.scope(),generation=this.generation
  const result=await this.withRead(scope.root,s=>s.receipt(operationId));await this.assertScope(scope,generation);return result
 }
}
function unavailable(){return new AppError('FEATURE_UNAVAILABLE','当前作品尚未准备正文事件结算，请先完成正式事件转换。',{recoverable:true})}
function safe(e:unknown){return isAppError(e)?e:new AppError('STORAGE_ERROR','事件结算暂未完成，请保留候选并核对存储状态。',{recoverable:true,cause:e})}
