import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import { AppError } from '../../../core/errors/app-error'
import type { WorkspaceChapterRecord, WorkspaceCanonicalEventRecord, WorkspaceEventReadPort } from '../../../core/ports/workspace-database'
import { decodeSettlementDraft,decodeSettlementDecision,decodeSettlementReceipt,decodeSettlementCandidate,
 type SettlementSource,type SettlementCandidate,type SettlementDraft,type SettlementDecision,type SettlementPlan,type SettlementReceipt,type SettlementStatus } from '../../../../contracts/timeline/prose-event-settlement-contracts'
import { settlementConflict as conflict,settlementHash as hash,settlementEligibility,validateSettlementEvidence,fieldsOf,
 type SettlementCommand,type SettlementReadPort } from '../domain/prose-event-settlement'
import { CanonicalEventVersions } from './canonical-event-versions'
import type { StoryEventVersion,StorySourceEdge } from '../domain/story-event-version'
type Row=Record<string,SQLOutputValue>
type Owner={ projectId:string; identity():string; id():string; now():string; chapter(id:number):WorkspaceChapterRecord|undefined; read():WorkspaceEventReadPort;
 insertEvent(e:WorkspaceCanonicalEventRecord):void; updateEvent(id:string,v:StoryEventVersion):void; mirror():void }
export class ProseEventSettlementStorage implements SettlementReadPort{
 constructor(private db:DatabaseSync,private owner:Owner){}
 identity(){return this.owner.identity()}
 private get project(){return this.owner.projectId}
 private versions(){return new CanonicalEventVersions(this.db,this.project,this.owner.id)}
 private ready(){const r=this.owner.read();if(!r.eventMigrationReceipt()||!r.eventState())throw new AppError('FEATURE_UNAVAILABLE','请先在纪事中核对并转换正式事件。',{recoverable:true})}
 source(chapterId:number):SettlementSource{
  const identity=this.identity()
  this.ready()
  const row=this.db.prepare("SELECT id,current_body_version_id FROM chapters WHERE project_id=? AND legacy_chapter_id=? AND status<>'archived'").get(this.project,chapterId)
  if(!row)throw new AppError('NOT_FOUND','本章尚未保存或已移除。',{recoverable:true})
  const pending=this.db.prepare("SELECT id FROM autosave_checkpoints WHERE chapter_id=? AND status IN ('open','staged') LIMIT 1").get(String(row.id))
  if(pending)conflict('正文尚未完成版本保存，请先保存后核对事件。')
  const chapter=this.owner.chapter(chapterId)
  if(!chapter || chapter.content.length>2_000_000)conflict('请先保存正文；单章核对不能超过 200 万字符。')
  if(chapter.currentVersionId!==row.current_body_version_id)conflict('正文文件尚待保存或核对，不能结算旧版本。')
  const read=this.owner.read(),state=read.eventState()!,plans:SettlementPlan[]=[]
  let contract:string|null=null, ids:string[]=[]
  const contractEvents:SettlementSource['contractEvents']=[]
  if(read.formalOutlinePlanningStateReady()){
   const ledger=JSON.parse(read.outlinePlanningState().content)
   if(!Array.isArray(ledger.eventChapterPlacements)||!Array.isArray(ledger.chapterConfirmations))integrity()
   ids=ledger.eventChapterPlacements.filter((x:{chapterId:number})=>x.chapterId===chapterId).map((x:{eventId:string})=>x.eventId)
   if(ids.length>200 || new Set(ids).size!==ids.length || ids.some(x=>typeof x!=='string'))integrity()
   const confirmation=ledger.chapterConfirmations.find((x:{chapterId:number})=>x.chapterId===chapterId)
   if(confirmation){
    contract=hash(confirmation)
    if(!Array.isArray(confirmation.eventIds) || confirmation.eventIds.length>200 || confirmation.eventIds.some((id:unknown)=>typeof id!=='string'||!id) ||
      new Set(confirmation.eventIds).size!==confirmation.eventIds.length)integrity()
    const versions:unknown=confirmation.eventVersions??[]
    if(!Array.isArray(versions))integrity()
    const refs=new Map<string,string>()
    for(const item of versions){
     if(!item || typeof item.eventId!=='string' || typeof item.versionId!=='string' || !item.versionId ||
       !confirmation.eventIds.includes(item.eventId) || refs.has(item.eventId))integrity()
     refs.set(item.eventId,item.versionId)
    }
    for(const eventId of [...confirmation.eventIds].sort()){
     const versionId=refs.get(eventId)??null,version=versionId?this.event(eventId,versionId):null
     contractEvents.push({eventId,versionId,content:version?fieldsOf(version):null,current:Boolean(version && ids.includes(eventId) &&
       read.canonicalEventVersionHeads(eventId)?.approvedVersionId===versionId && state.lifecycles.some(l=>l.eventId===eventId&&l.state==='active'))})
    }
   }
  }
  for(const id of ids.sort()){
   const heads=read.canonicalEventVersionHeads(id),lifecycle=state.lifecycles.find(x=>x.eventId===id)
   if(!heads?.approvedVersionId||lifecycle?.state!=='active')continue
   const v=this.event(id,heads.approvedVersionId)
   if(v?.phase==='planned')plans.push({eventId:id,versionId:v.id,lifecycleId:lifecycle.id,content:fieldsOf(v)})
  }
  const base={chapterId,documentId:String(row.id),bodyVersionId:chapter.currentVersionId,bodyHash:hash(chapter.content),revision:chapter.revision,position:chapter.position}
  if(this.identity()!==identity)conflict('作品文件已被替换，请重新核对。')
  return {basis:{...base,fingerprint:hash({base,plans,contract,identity})},body:chapter.content,title:chapter.title,plans,contract,contractEvents}
 }
 private decode<T>(row:Row,decoder:(v:unknown)=>T):T{
  try{const json=String(row.payload_json);if(json.length>1_000_000||hash(json)!==row.content_hash)integrity();return decoder(JSON.parse(json))}
  catch(cause){if(cause instanceof AppError && cause.code==='DATABASE_INTEGRITY_FAILED')throw cause;throw new AppError('DATABASE_INTEGRITY_FAILED','事件结算证据无法验证，未替换原数据。',{recoverable:false,cause})}
 }
 drafts(chapterId:number):SettlementDraft[]{
  const rows=this.db.prepare(`SELECT d.* FROM event_settlement_drafts d JOIN chapters c ON c.id=d.chapter_id
   WHERE d.project_id=? AND c.legacy_chapter_id=? AND d.revision=(SELECT MAX(revision) FROM event_settlement_drafts WHERE id=d.id) ORDER BY d.seq LIMIT 1001`).all(this.project,chapterId)
  if(rows.length>1000)throw new AppError('VALIDATION_ERROR','本章候选超过核对上限，未截断记录。',{recoverable:true})
  return rows.map(row=>{const v=this.decode(row,decodeSettlementDraft);if(v.id!==row.id||v.revision!==row.revision||v.source.documentId!==row.chapter_id||v.source.chapterId!==chapterId)integrity();return v})
 }
 decisions(chapterId?:number):SettlementDecision[]{
  const rows=this.db.prepare(`SELECT d.*,c.legacy_chapter_id FROM event_settlement_decisions d JOIN chapters c ON c.id=d.chapter_id
    WHERE d.project_id=? ${chapterId===undefined?'':'AND c.legacy_chapter_id=?'} ORDER BY d.seq LIMIT ${chapterId===undefined?100001:2001}`).all(...(chapterId===undefined?[this.project]:[this.project,chapterId]))
  if(rows.length>(chapterId===undefined?100000:2000))throw new AppError('VALIDATION_ERROR','事件结算历史超过核对上限，未截断记录。',{recoverable:true})
  const heads=new Map<string,string>()
  return rows.map(row=>{const v=this.decode(row,decodeSettlementDecision)
   if(v.id!==row.id||v.eventId!==row.event_id||v.eventVersionId!==row.event_version_id||v.source.documentId!==row.chapter_id||
    v.source.bodyVersionId!==row.body_version_id||v.source.chapterId!==row.legacy_chapter_id||v.previousId!==(heads.get(v.eventId)??null))integrity()
   const event=this.event(v.eventId,v.eventVersionId)
   if(!event||!event.sources.some(e=>e.source.kind==='manuscript'&&e.source.id===v.source.documentId && (v.kind==='withdraw'||e.source.revision===v.source.bodyVersionId)))integrity()
   heads.set(v.eventId,v.id);return v})
 }
 event(eventId:string,versionId?:string):StoryEventVersion|null{
  const all=this.versions().list(eventId),head=this.versions().heads(eventId)?.approvedVersionId
  return all.find(v=>v.id===(versionId??head))??null
 }
 receipt(operationId:string):SettlementReceipt|null{
  const row=this.db.prepare('SELECT * FROM event_settlement_receipts WHERE project_id=? AND operation_id=?').get(this.project,operationId)
  if(!row)return null
  const v=this.decode(row,decodeSettlementReceipt)
  if(v.operationId!==row.operation_id||v.requestHash!==row.request_hash||!v.decisionIds.length)integrity()
  const decisions=this.decisions(v.chapterId)
  if(v.decisionIds.some(id=>!decisions.some(d=>d.id===id)))integrity()
  return v
 }
 saveDraft(source:SettlementSource,candidate:SettlementCandidate,id?:string,expectedRevision?:number,taskId:string|null=null):SettlementDraft{
  this.ready();decodeSettlementCandidate(candidate);validateSettlementEvidence(candidate,source.body,false)
  this.assertCurrent(source)
  const prior=id?this.drafts(source.basis.chapterId).find(d=>d.id===id):undefined
  if(id&&(!prior||prior.revision!==expectedRevision))conflict()
  const value:SettlementDraft={...candidate,id:id??this.owner.id(),revision:(prior?.revision??0)+1,source:source.basis,taskId:taskId??prior?.taskId??null,updatedAt:this.owner.now()}
  const json=JSON.stringify(value)
  this.db.prepare('INSERT INTO event_settlement_drafts(id,revision,project_id,chapter_id,payload_json,content_hash) VALUES (?,?,?,?,?,?)')
   .run(value.id,value.revision,this.project,source.basis.documentId,json,hash(json));return value
 }
 /** Final transaction guard repeats the contained file read and pinned database basis. */
 private assertCurrent(source:SettlementSource){
  const b=source.basis
  if(this.source(b.chapterId).basis.fingerprint!==b.fingerprint)conflict()
  const row=this.db.prepare(`SELECT c.current_body_version_id,c.status,c.seq,v.content_hash,p.text_authority,
   f.content_hash AS file_hash FROM chapters c JOIN body_versions v ON v.id=c.current_body_version_id JOIN projects p ON p.id=c.project_id
   LEFT JOIN manuscript_file_heads f ON f.document_id=c.id WHERE c.project_id=? AND c.id=? AND c.legacy_chapter_id=?`).get(this.project,b.documentId,b.chapterId)
  if(!row||row.status==='archived'||row.current_body_version_id!==b.bodyVersionId||row.content_hash!==b.bodyHash||
    (row.text_authority==='files-v1'&&row.file_hash!==b.bodyHash))conflict()
 }
 statuses():Map<string,SettlementStatus>{
  const decisions=this.decisions(),latest=new Map(decisions.map(d=>[d.eventId,d])),lifecycles=new Map(this.owner.read().eventState()?.lifecycles.map(l=>[l.eventId,l])??[])
  const sources=new Map<number,SettlementSource|null>(),result=new Map<string,SettlementStatus>()
  for(const d of latest.values()){
   if(!sources.has(d.source.chapterId)){
    try{sources.set(d.source.chapterId,this.source(d.source.chapterId))}
    catch(e){if(!(e instanceof AppError)||!['NOT_FOUND','CONFLICT'].includes(e.code))throw e;sources.set(d.source.chapterId,null)}
   }
   const source=sources.get(d.source.chapterId)??null,plans=new Map((source?.plans??[]).map(p=>[p.eventId,p]))
   const status=settlementEligibility(d,source,this.event(d.eventId),plans)
   const lifecycle=lifecycles.get(d.eventId)
   result.set(d.eventId,lifecycle?.state==='active'||status.state==='withdrawn'?status:{...status,state:'needs-review',reason:'实际事件已归档'})
  }
  return result
 }
 commit(command:SettlementCommand,assertActive:()=>void):SettlementReceipt{
  const expectedHash=hash({...command,requestHash:undefined})
  if(command.requestHash!==expectedHash)conflict()
  const prior=this.receipt(command.operationId)
  if(prior){if(prior.requestHash!==command.requestHash)conflict();return prior}
  this.ready();this.assertCurrent(command.source);assertActive()
  const decisions=this.decisions(command.source.basis.chapterId),latest=new Map(decisions.map(d=>[d.eventId,d]))
  const read=this.owner.read(),state=read.eventState()!,versions=this.versions(),ids=[...state.order.eventIds]
  const allDrafts=this.drafts(command.source.basis.chapterId),timestamp=this.owner.now(),results:string[]=[]
  const checkPrevious=(previous:SettlementDecision,head:string)=>{
   if(latest.get(previous.eventId)?.id!==previous.id||read.canonicalEventVersionHeads(previous.eventId)?.latestVersionId!==head||
     state.lifecycles.find(l=>l.eventId===previous.eventId)?.state!=='active')conflict()
  }
  const insert=(value:SettlementDecision)=>{
   const json=JSON.stringify(value);this.db.prepare(`INSERT INTO event_settlement_decisions(id,project_id,chapter_id,event_id,event_version_id,previous_id,body_version_id,payload_json,content_hash)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(value.id,this.project,value.source.documentId,value.eventId,value.eventVersionId,value.previousId,value.source.bodyVersionId,json,hash(json))
   results.push(value.id)
  }
  if(command.withdrawal){
   const {previous,reason,expectedEventHead}=command.withdrawal;checkPrevious(previous,expectedEventHead)
   insert({...previous,id:this.owner.id(),kind:'withdraw',previousId:previous.id,source:command.source.basis,quotes:[],plans:[],supplements:[],reason,createdAt:timestamp})
  }else{
   if(!command.items.length||command.items.length>20||ids.length+command.items.filter(i=>!i.previous).length>100000)conflict()
   for(const item of command.items){
    if(JSON.stringify(allDrafts.find(d=>d.id===item.draft.id))!==JSON.stringify(item.draft))conflict()
    if(item.draft.source.fingerprint!==command.source.basis.fingerprint)conflict()
    validateSettlementEvidence(item.draft,command.source.body,true)
    for(const plan of item.plans){
     if(read.canonicalEventVersionHeads(plan.eventId)?.approvedVersionId!==plan.versionId||
       state.lifecycles.find(l=>l.eventId===plan.eventId)?.id!==plan.lifecycleId||
       state.lifecycles.find(l=>l.eventId===plan.eventId)?.state!=='active')conflict()
    }
    if(item.previous)checkPrevious(item.previous,item.expectedEventHead!)
    const eventId=item.previous?.eventId??this.owner.id(),fields=item.draft.fields
    const content={...fields,evidenceRefs:[],confidence:1}
    const sources:StorySourceEdge[]=[{relation:'derived-from',source:{kind:'manuscript',id:command.source.basis.documentId,revision:command.source.basis.bodyVersionId}},
      ...item.plans.map(p=>({relation:item.selection.outcome==='realizes'?'realizes' as const:'deviates-from' as const,source:{kind:'event' as const,id:p.eventId,revision:p.versionId}}))]
    if(item.previous)sources.push({relation:'supersedes',source:{kind:'event',id:eventId,revision:item.expectedEventHead!}})
    if(!item.previous)this.owner.insertEvent({...content,id:eventId,status:'approved',createdAt:timestamp,approvedAt:timestamp})
    const version=versions.append(eventId,item.expectedEventHead,{content,status:'approved',creator:'author',granularity:'chapter-detail',
      phase:item.selection.outcome==='deviates-from'?'deviated':'realized',sources},timestamp)
    this.owner.updateEvent(eventId,version)
    if(!item.previous){
     this.db.prepare(`INSERT INTO event_lifecycle_versions(id,project_id,event_id,revision,previous_id,expected_event_version_id,state,created_at) VALUES (?,?,?,1,NULL,?,'active',?)`)
      .run(this.owner.id(),this.project,eventId,version.id,timestamp);ids.push(eventId)
    }
    insert({id:this.owner.id(),eventId,eventVersionId:version.id,previousId:item.previous?.id??null,kind:'confirm',source:command.source.basis,
      outcome:item.selection.outcome,plans:item.plans,quotes:item.draft.quotes,supplements:item.draft.supplements,reason:'',createdAt:timestamp})
   }
  }
  if(ids.length!==state.order.eventIds.length){
   const json=JSON.stringify(ids);this.db.prepare(`INSERT INTO event_display_order_versions(id,project_id,revision,previous_id,event_ids_json,content_hash,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(this.owner.id(),this.project,state.order.revision+1,state.order.id,json,hash(json),timestamp)
  }
  const receipt:SettlementReceipt={operationId:command.operationId,requestHash:command.requestHash,chapterId:command.source.basis.chapterId,decisionIds:results,committedAt:timestamp}
  const json=JSON.stringify(receipt)
  this.db.prepare('INSERT INTO event_settlement_receipts(operation_id,project_id,request_hash,payload_json,content_hash) VALUES (?,?,?,?,?)')
   .run(receipt.operationId,this.project,receipt.requestHash,json,hash(json))
  this.owner.mirror();assertActive();return receipt
 }
}
function integrity():never{throw new AppError('DATABASE_INTEGRITY_FAILED','事件结算的身份、历史或来源链不完整。',{recoverable:false})}
