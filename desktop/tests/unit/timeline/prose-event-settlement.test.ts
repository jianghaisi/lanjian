import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { type TestContext } from 'node:test'
import { WorkspaceWriteCoordinator } from '../../../src/main/core/application/workspace-write-coordinator'
import { ProseEventSettlementService } from '../../../src/main/modules/timeline/application/prose-event-settlement-service'
import { parseSettlementOutput, validateSettlementEvidence } from '../../../src/main/modules/timeline/domain/prose-event-settlement'
import { decodeSettlementPage,decodeSettlementPreviewInput } from '../../../src/contracts/timeline/prose-event-settlement-contracts'
import { EventMigrationReviewSession } from '../../../src/main/modules/timeline/application/event-migration-review-session'
import { EventMigrationCommitService } from '../../../src/main/modules/timeline/application/event-migration-commit-service'
import { EventProjectionService } from '../../../src/main/modules/timeline/application/event-projection-service'
import { LocalEventSourceSnapshotReader } from '../../../src/main/modules/timeline/adapters/event-source-snapshot'
import { eventReceiptHash } from '../../../src/main/modules/timeline/adapters/event-migration-receipt-evidence'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'
import { canonicalDirectory } from '../../../src/main/platform/storage/project-path'
import { WorkspaceBackupService } from '../../../src/main/modules/library/application/workspace-backup-service'
import { ManuscriptCommitJournal } from '../../../src/main/modules/manuscript/adapters/manuscript-commit-journal'
const stamp='2026-10-01T10:00:00.000Z'
const body='第一夜，林舟在古城敲门。\n门开了。'
const candidate={fields:{time:'第一夜',characters:['林舟'],location:'古城',event:'敲门',result:'门开了'},quotes:[{start:0,end:body.length,quote:body}],supplements:[]}
async function fixture(t:TestContext,files=false){
 const parent=await canonicalDirectory(tmpdir()),root=await canonicalDirectory(await mkdtemp(join(parent,'lanjian-settlement-')))
 t.after(async()=>{assert.equal(dirname(root),parent);assert.ok(root.startsWith(join(parent,'lanjian-settlement-')));await rm(root,{recursive:true,force:true})})
 const factory=new SqliteWorkspaceDatabaseFactory(()=>new Date(stamp),randomUUID)
 ;(await factory.open(root)).close()
 const path=join(root,'.webnovel','workspace.sqlite'),raw=new DatabaseSync(path)
 raw.prepare("INSERT INTO projects(id,name,status,legacy_manifest_hash,storage_mode,created_at,updated_at) VALUES ('book','隔离作品','active',?,'sqlite',?,?)").run('a'.repeat(64),stamp,stamp);raw.close()
 await mkdir(join(root,'.webnovel','config'),{recursive:true})
 await writeFile(join(root,'.webnovel','config','timeline.json'),JSON.stringify({version:1,events:[{id:'old-one',title:'旧事',time:'第一夜',characters:'林舟',location:'古城',event:'敲门'}]}))
 const scope={root,workItemId:'work',generation:1},currentScope=async()=>({...scope}),writes=new WorkspaceWriteCoordinator(),reader=new LocalEventSourceSnapshotReader(factory)
 const reviews=new EventMigrationReviewSession({capture:()=>reader.capture(scope)},currentScope,{nonce:randomUUID,now:()=>1000,sha256:eventReceiptHash})
 const migration=new EventMigrationCommitService(reviews,factory,reader,currentScope,writes),preview=await reviews.preview()
 const grant=await reviews.review(preview.previewId,{fingerprint:preview.fingerprint,rows:[{rowIndex:0,disposition:'keep-separate'}],acknowledgedGroups:[],acknowledgedPlanningFindings:[],acknowledgedMirrors:[]})
 await migration.commit(grant.token)
 const db=await factory.open(root)
 try{if(files)db.activateEmptyFileTextAuthority();db.writeFormalChapter({legacyChapterId:8,title:'第一章',content:body,reason:'manual'})}finally{db.close()}
 const service=new ProseEventSettlementService(factory,currentScope,writes)
 return {root,path,factory,scope,writes,service,currentScope,projection:new EventProjectionService(factory,currentScope,writes)}
}
type Fixture=Awaited<ReturnType<typeof fixture>>
async function prepare(f:Fixture,count=1,replaces?:string){
 const page=await f.service.page(8),drafts=[]
 for(let i=0;i<count;i++)drafts.push(await f.service.saveDraft({...candidate,chapterId:8,sourceFingerprint:page.source.basis.fingerprint}))
 return f.service.preview({chapterId:8,sourceFingerprint:page.source.basis.fingerprint,selections:drafts.map(d=>({draftId:d.id,draftRevision:d.revision,outcome:'new',plans:[],...(replaces?{replaces}:{})}))})
}
test('evidence is exact UTF-16 text; malformed and over-limit model output fails as a whole',()=>{
 validateSettlementEvidence(candidate,body,true)
 assert.throws(()=>validateSettlementEvidence({...candidate,quotes:[{start:0,end:2,quote:'假句'}]},body,true),{code:'CONFLICT'})
 assert.throws(()=>validateSettlementEvidence({...candidate,fields:{...candidate.fields,location:''}},body,true),{code:'VALIDATION_ERROR'})
 assert.deepEqual(parseSettlementOutput(JSON.stringify([candidate]),body),[candidate])
 assert.throws(()=>parseSettlementOutput(JSON.stringify(Array(31).fill(candidate)),body),{code:'AI_RESPONSE_INVALID'})
 assert.throws(()=>parseSettlementOutput(JSON.stringify([candidate,{...candidate,extra:true}]),body),{code:'AI_RESPONSE_INVALID'})
 assert.throws(()=>decodeSettlementPreviewInput({chapterId:8,sourceFingerprint:'a'.repeat(64),selections:[{draftId:'x',draftRevision:1,outcome:'realizes',plans:[]}]}),{code:'VALIDATION_ERROR'})
})
for(const files of [false,true])test(`confirm → stale → re-review → withdrawal preserves identity and history (${files?'files-v1':'legacy-sqlite'})`,async t=>{
 const f=await fixture(t,files),before=(await f.projection.read()).approved.length
 const preview=await prepare(f),committed=await f.service.commit(preview.token)
 assert.equal(committed.receipt.decisionIds.length,1)
 assert.deepEqual(await f.service.receipt(preview.operationId),committed.receipt)
 await assert.rejects(f.service.commit(preview.token),{code:'CONFLICT'})
 let page=await f.service.page(8),decision=page.history[0]!.decision
 assert.equal(page.history[0]!.status.state,'current');assert.equal((await f.projection.read()).approved.length,before+1)
 const db=await f.factory.open(f.root)
 try{db.writeFormalChapter({legacyChapterId:8,title:'第一章',content:body+'\n又有人来了。',reason:'manual'})}finally{db.close()}
 page=await f.service.page(8);assert.equal(page.history[0]!.status.state,'needs-review')
 const renewed=await prepare(f,1,decision.id);await f.service.commit(renewed.token)
 page=await f.service.page(8);assert.equal(page.history[0]!.decision.eventId,decision.eventId);assert.equal(page.history[0]!.status.state,'current')
 assert.equal(page.history[1]!.status.state,'superseded')
 const withdrawal=await f.service.previewWithdrawal({chapterId:8,sourceFingerprint:page.source.basis.fingerprint,decisionId:page.history[0]!.decision.id,reason:'本版不再成立'})
 await f.service.commit(withdrawal.token)
 const restarted=new ProseEventSettlementService(f.factory,f.currentScope,f.writes)
 page=await restarted.page(8);assert.equal(page.history[0]!.status.state,'withdrawn');assert.equal(page.history.length,3)
 assert.equal((await f.projection.read()).approved.length,before+1)
 assert.deepEqual(await restarted.receipt(preview.operationId),committed.receipt)
})
test('failure halfway through batch rolls back canonical versions, decisions and receipt',async t=>{
 const f=await fixture(t),preview=await prepare(f,2)
 const snapshot=()=>{const db=new DatabaseSync(f.path);try{return Object.fromEntries(['canonical_events','canonical_event_versions','event_lifecycle_versions','event_display_order_versions','event_settlement_decisions','event_settlement_receipts'].map(table=>[table,db.prepare('SELECT * FROM '+table).all()]))}finally{db.close()}}
 const before=snapshot(),raw=new DatabaseSync(f.path)
 raw.exec("CREATE TRIGGER settlement_test_failure BEFORE INSERT ON event_settlement_decisions WHEN (SELECT COUNT(*) FROM event_settlement_decisions)>0 BEGIN SELECT RAISE(ABORT,'injected'); END");raw.close()
 await assert.rejects(f.service.commit(preview.token))
 assert.deepEqual(snapshot(),before);assert.equal(await f.service.receipt(preview.operationId),null)
})
test('source or navigation change invalidates pending grants without creating facts',async t=>{
 const f=await fixture(t),preview=await prepare(f)
 f.service.cancel()
 await assert.rejects(f.service.commit(preview.token),{code:'CONFLICT'})
 assert.equal((await f.service.page(8)).history.length,0)
 const next=await prepare(f),db=await f.factory.open(f.root)
 try{db.writeFormalChapter({legacyChapterId:8,title:'第一章',content:'另一个版本。',reason:'manual'})}finally{db.close()}
 await assert.rejects(f.service.commit(next.token),{code:'CONFLICT'})
 assert.equal((await f.service.page(8)).history.length,0)
})

import { ProseEventExtractionService } from '../../../src/main/modules/timeline/application/prose-event-extraction-service'
import { AiClient } from '../../../src/main/modules/models/application/ai-client'
import { BookExecutionContext } from '../../../src/main/modules/library/application/book-execution-context'
import { LOCAL_CONNECTION_ID } from '../../../src/contracts/models/local-model-contracts'
import { contextBudgetStartingSuggestions } from '../../../src/contracts'
import { EventOperationService } from '../../../src/main/modules/timeline/application/event-operation-service'
import type { SettlementTask } from '../../../src/contracts/timeline/prose-event-settlement-contracts'
const waitTask=async(service:ProseEventExtractionService,id:string,expected:string)=>{
 for(let i=0;i<200;i++){const value=await service.status(id);if(!['queued','running'].includes(value.status)){assert.equal(value.status,expected,value.error??'');return value};await new Promise(r=>setTimeout(r,10))}
 return assert.fail('settlement extraction did not finish')
}
test('real AiClient review route retains raw output and candidates across book switches, independent failures, retries and restart',async t=>{
 const a=await fixture(t),b=await fixture(t),execution=new BookExecutionContext()
 let selected=a.root,calls=0
 const releases:Array<(value:string)=>void>=[]
 const projects={currentPath:async()=>await execution.path()??selected,currentSummary:async()=>({id:'work',path:await execution.path()??selected}),
  runBookTask:<T extends {id:string;status:string;chapterId?:number}>(_kind:string,start:()=>T|Promise<T>,_status:(id:string)=>T|Promise<T>)=>execution.run(selected,start)}
 const ai=new AiClient({resolve:async task=>{assert.equal(task,'review');return {kind:'local',connectionId:LOCAL_CONNECTION_ID,connectionName:'fixture',profile:{connectionId:LOCAL_CONNECTION_ID,model:'fixture-model',parameterPolicy:{version:1,mode:'auto'}}}},
  resolveConnection:async()=>({kind:'local',connectionId:LOCAL_CONNECTION_ID,connectionName:'fixture'})},{
   listModels:async()=>['fixture-model'],ready:async()=>true,limits:()=>({contextTokens:150000,systemReserveTokens:1000,maxOutputTokens:5000,recommendedOutputTokens:4000}),toolStep:async()=>assert.fail(),
   complete:async input=>{calls++;assert.ok(input.messages.some(m=>m.content.includes('本版正文')));return {content:await new Promise<string>(r=>releases.push(r))}}
 })
 const workspace={contextBudgetPreferences:async()=>({version:1 as const,...contextBudgetStartingSuggestions,pinnedEvidenceKeys:[],excludedEvidenceKeys:[]})}
 const make=()=>new ProseEventExtractionService(projects,a.factory,a.service,ai,workspace,a.writes),service=make()
 const request=async(f:Fixture)=>({chapterId:8,expectedWorkItemId:'work',operationId:randomUUID(),sourceFingerprint:(await f.service.page(8)).source.basis.fingerprint})
 const firstInput=await request(a),first=await service.start(firstInput)
 for(let i=0;i<100&&!releases.length;i++)await new Promise(r=>setTimeout(r,10))
 assert.equal((await service.start(firstInput)).id,first.id)
 selected=b.root
 await assert.rejects(service.stop(first.id),{code:'CONFLICT'})
 const second=await service.start(await request(b))
 for(let i=0;i<100&&releases.length<2;i++)await new Promise(r=>setTimeout(r,10))
 assert.equal(calls,2)
 releases[0]!(JSON.stringify([candidate]));releases[1]!('not valid JSON')
 const failed=await waitTask(service,second.id,'failed');assert.equal(failed.rawOutput,'not valid JSON');assert.equal(failed.drafts.length,0)
 selected=a.root
 const complete=await waitTask(service,first.id,'succeeded');assert.equal(complete.drafts.length,1);assert.deepEqual(complete.drafts[0]!.supplements,[])
 assert.equal((await a.service.page(8)).history.length,0)
 const restarted=make();assert.equal((await restarted.status(first.id)).drafts.length,1);assert.equal(calls,2)
 assert.equal((await a.service.page(8)).source.body,body);assert.equal((await b.service.page(8)).source.body,body)
})
test('multiple plans remain intact; relevant version drift invalidates actual facts while unrelated additions do not',async t=>{
 const f=await fixture(t),ops=new EventOperationService(f.factory,new LocalEventSourceSnapshotReader(f.factory),f.currentScope,f.writes,{nonce:randomUUID,now:()=>1000,sha256:eventReceiptHash})
 const plans:Awaited<ReturnType<typeof ops.commit>>[]=[]
 for(const event of ['敲门计划','询问计划']){
  const p=await ops.preview({kind:'create',content:{...candidate.fields,event,evidenceRefs:[],confidence:1},granularity:'macro',expectedOrderId:(await f.projection.read()).state.order.id})
  plans.push(await ops.commit(p.token))
 }
 const confirmedVersions=(await f.projection.read()).approved.filter(e=>plans.some(p=>p.receipt.eventId===e.eventId)).map(e=>({eventId:e.eventId,versionId:e.versionId,phase:e.phase}))
 const db=await f.factory.open(f.root)
 const ledger={version:1,total:{revision:1,hash:'a'.repeat(64)},assignments:[],volumes:[],chapterPlacements:[],manuscriptStarts:[],eventChapterPlacements:plans.map(p=>({eventId:p.receipt.eventId,chapterId:8,assignedAt:stamp,updatedAt:stamp})),chapters:[],chapterConfirmations:[{chapterId:8,outlineHash:'a'.repeat(64),basedOnTotalRevision:1,eventIds:confirmedVersions.map(e=>e.eventId),eventVersions:confirmedVersions,confirmedAt:stamp}],outlineReviewAcknowledgements:[],planningConfirmations:[]}
 try{const content=JSON.stringify(ledger);db.importOutlinePlanningState(content,eventReceiptHash(content))}finally{db.close()}
 const page=decodeSettlementPage(await f.service.page(8));assert.equal(page.source.plans.length,2)
 assert.equal(page.source.contractEvents.length,2);assert.ok(page.source.contractEvents.every(e=>e.current))
 const draft=await f.service.saveDraft({...candidate,chapterId:8,sourceFingerprint:page.source.basis.fingerprint})
 assert.ok(draft.supplements.includes('time'))
 const p=await f.service.preview({chapterId:8,sourceFingerprint:page.source.basis.fingerprint,selections:[{draftId:draft.id,draftRevision:draft.revision,outcome:'deviates-from',plans:page.source.plans.map(p=>({eventId:p.eventId,versionId:p.versionId}))}]})
 await f.service.commit(p.token)
 let view=await f.projection.read(),actual=view.approved.find(e=>e.settlement)!
 assert.equal(actual.phase,'deviated');assert.equal(actual.sources.filter(s=>s.relation==='deviates-from').length,2)
 assert.ok(page.source.plans.every(p=>view.approved.some(e=>e.eventId===p.eventId&&e.versionId===p.versionId&&e.phase==='planned')))
 const unrelated=await ops.preview({kind:'create',content:{...candidate.fields,event:'无关事件',evidenceRefs:[],confidence:1},granularity:'macro',expectedOrderId:view.state.order.id});await ops.commit(unrelated.token)
 assert.equal((await f.service.page(8)).history[0]!.status.state,'current')
 view=await f.projection.read()
 const plan=view.approved.find(e=>e.eventId===page.source.plans[0]!.eventId)!,life=view.state.lifecycles.find(l=>l.eventId===plan.eventId)!
 const changed=await ops.preview({kind:'edit',eventId:plan.eventId,expectedVersionId:plan.versionId,expectedLifecycleId:life.id,expectedOrderId:view.state.order.id,
  content:{...candidate.fields,event:'已修改的关联计划',evidenceRefs:[],confidence:1},granularity:'macro'})
 await ops.commit(changed.token)
 assert.equal((await f.service.page(8)).history[0]!.status.state,'needs-review')
 assert.ok(!(await f.projection.readForConsumer())!.approved.some(e=>e.eventId===actual.eventId))
 const source=(await f.service.page(8)).source,original=source.contractEvents.find(e=>e.eventId===plan.eventId)!
 assert.equal(original.current,false);assert.equal(original.versionId,plan.versionId);assert.equal(original.content!.event,plan.content.event)
 assert.equal(source.plans.find(e=>e.eventId===plan.eventId)!.content.event,'已修改的关联计划')
 const legacy={...ledger,chapterConfirmations:ledger.chapterConfirmations.map(({eventVersions,...confirmation})=>confirmation)}
 const writer=await f.factory.open(f.root)
 try{const old=JSON.stringify(ledger),next=JSON.stringify(legacy);writer.replaceOutlinePlanningState(eventReceiptHash(old),next,eventReceiptHash(next))}finally{writer.close()}
 assert.ok((await f.service.page(8)).source.contractEvents.every(e=>e.versionId===null&&e.content===null&&!e.current))
})
test('external file changes and same-text restored new versions invalidate evidence without overwriting history',async t=>{
 const f=await fixture(t,true),p=await prepare(f);await f.service.commit(p.token)
 const old=(await f.service.page(8)).source.basis.bodyVersionId,db=await f.factory.open(f.root)
 let path:string
 try{path=join(f.root,db.formalChapter(8)!.mirrorRelativePath);db.writeFormalChapter({legacyChapterId:8,title:'第一章',content:body+'变化',reason:'manual'});db.writeFormalChapter({legacyChapterId:8,title:'第一章',content:body,reason:'manual'})}finally{db.close()}
 const restored=await f.service.page(8);assert.notEqual(restored.source.basis.bodyVersionId,old);assert.equal(restored.history[0]!.status.state,'needs-review')
 const repeat=await prepare(f,1,restored.history[0]!.decision.id);await f.service.commit(repeat.token)
 await writeFile(path!,body+'外部改稿')
 const projection=await f.projection.read()
 assert.equal(projection.approved.find(e=>e.settlement)?.settlement?.state,'needs-review')
 assert.equal((await f.projection.readForConsumer())!.approved.filter(e=>e.settlement).length,0)
})
test('append-only decisions/receipts reject mutation, and mirror failure is not replayed as a new event',async t=>{
 const f=await fixture(t),service=new ProseEventSettlementService(f.factory,f.currentScope,f.writes,{retryCaptured:async()=>{throw new Error('mirror')}})
 const page=await service.page(8),draft=await service.saveDraft({...candidate,chapterId:8,sourceFingerprint:page.source.basis.fingerprint})
 const p=await service.preview({chapterId:8,sourceFingerprint:page.source.basis.fingerprint,selections:[{draftId:draft.id,draftRevision:draft.revision,outcome:'new',plans:[]}]})
 const result=await service.commit(p.token);assert.equal(result.mirror.status,'failed');assert.deepEqual(await service.receipt(p.operationId),result.receipt)
 const raw=new DatabaseSync(f.path)
 try{
  for(const table of ['event_settlement_drafts','event_settlement_decisions','event_settlement_receipts']){
   assert.throws(()=>raw.exec('DELETE FROM '+table),/immutable/)
   raw.exec('PRAGMA recursive_triggers=OFF')
   assert.throws(()=>raw.exec('INSERT OR REPLACE INTO '+table+' SELECT * FROM '+table),/replacement/)
  }
 }finally{raw.close()}
})

import { priorSettlements } from '../../../src/main/modules/timeline/domain/prose-event-settlement'
import { WorkspaceService } from '../../../src/main/modules/library/application/workspace-service'
import type { ProjectService } from '../../../src/main/modules/library/application/project-service'
test('all effective consumers lose withdrawn/stale occurrences; map locates source chapter without a plan placement',async t=>{
 const f=await fixture(t),p=await prepare(f);await f.service.commit(p.token)
 const project={currentPath:async()=>f.root,currentSummary:async()=>({id:'work',path:f.root})} as unknown as ProjectService
 const workspace=new WorkspaceService(project,undefined,undefined,undefined,undefined,undefined,undefined,{read:()=>f.projection.readForConsumer()})
 const history=(await f.service.page(8)).history[0]!,actual=history.decision.eventId
 assert.equal((await workspace.worldMapEvents()).find(e=>e.sourceId===actual)?.chapterId,8)
 const page=await f.service.page(8),withdraw=await f.service.previewWithdrawal({chapterId:8,sourceFingerprint:page.source.basis.fingerprint,decisionId:history.decision.id,reason:'不再成立'})
 await f.service.commit(withdraw.token)
 assert.ok(!(await workspace.worldMapEvents()).some(e=>e.sourceId===actual))
 assert.ok((await f.projection.read()).approved.some(e=>e.eventId===actual&&e.settlement?.state==='withdrawn'))
})
test('prior-fact selection uses active positions, excludes current/future/untracked, and bounds the recent window',()=>{
 const events=Array.from({length:40},(_,i)=>({id:String(100-i),settlement:{decisionId:'d'+i,chapterId:100-i,position:i+1,bodyVersionId:'b',state:'current' as const,reason:''}}))
 assert.equal(priorSettlements(events,undefined).length,0)
 assert.equal(priorSettlements(events,1).length,0)
 assert.deepEqual(priorSettlements(events,3).map(e=>e.id),['99','100'])
 assert.equal(priorSettlements(events,41).length,30)
 assert.equal(priorSettlements([{...events[0]!,settlement:{...events[0]!.settlement,state:'needs-review' as const}},{...events[1]!,settlement:{...events[1]!.settlement,state:'untracked' as const}}],40).length,0)
})
test('lost close response recovers a durable receipt and rejects a blind second confirmation',async t=>{
 const f=await fixture(t),factory={openEventReadOnly:f.factory.openEventReadOnly.bind(f.factory),openSettlementWrite:async(root:string)=>{
  const writer=await f.factory.openSettlementWrite(root);return {...writer,close:()=>{writer.close();throw new Error('lost close')}}
 }}
 const service=new ProseEventSettlementService(factory,f.currentScope,f.writes)
 const p=await prepare(f)
 // Create this service's own grant from the already-saved draft.
 const page=await service.page(8),draft=page.drafts[0]!
 const grant=await service.preview({chapterId:8,sourceFingerprint:page.source.basis.fingerprint,selections:[{draftId:draft.id,draftRevision:draft.revision,outcome:'new',plans:[]}]})
 await assert.rejects(service.commit(grant.token),{code:'STORAGE_ERROR'})
 const receipt=await f.service.receipt(grant.operationId);assert.ok(receipt)
 assert.equal((await f.service.page(8)).history.length,1)
 await assert.rejects(service.commit(grant.token),{code:'CONFLICT'})
 assert.equal(await f.service.receipt(p.operationId),null)
})

test('schema 48 upgrades only empty evidence tables; read-only older snapshots do not migrate and failed migration rolls back',async t=>{
 const f=await fixture(t),raw=new DatabaseSync(f.path)
 try{
  for(const table of ['event_settlement_receipts','event_settlement_decisions','event_settlement_drafts'])raw.exec('DROP TABLE '+table)
  raw.exec("DROP TRIGGER projects_schema_version_v48_after_insert; CREATE TRIGGER projects_schema_version_v47_after_insert AFTER INSERT ON projects BEGIN UPDATE projects SET current_schema_version = 47 WHERE id = NEW.id; END; UPDATE projects SET current_schema_version=47; DELETE FROM schema_migrations WHERE version=48; PRAGMA user_version=47;")
 }finally{raw.close()}
 const bytes=await import('node:fs/promises').then(fs=>fs.readFile(f.path))
 await assert.rejects(f.service.page(8),{code:'FEATURE_UNAVAILABLE'})
 assert.deepEqual(await import('node:fs/promises').then(fs=>fs.readFile(f.path)),bytes)
 const failure=new DatabaseSync(f.path)
 failure.exec("CREATE TRIGGER fail_settlement_migration BEFORE INSERT ON schema_migrations WHEN NEW.version=48 BEGIN SELECT RAISE(ABORT,'injected'); END");failure.close()
 await assert.rejects(f.factory.openExisting(f.root),{code:'DATABASE_MIGRATION_FAILED'})
 const check=new DatabaseSync(f.path)
 try{
  assert.equal(check.prepare('PRAGMA user_version').get()!.user_version,47)
  assert.equal(check.prepare("SELECT name FROM sqlite_schema WHERE name='event_settlement_drafts'").get(),undefined)
  check.exec('DROP TRIGGER fail_settlement_migration')
 }finally{check.close()}
 ;(await f.factory.openExisting(f.root))!.close()
 const source=await f.service.page(8);assert.equal(source.source.body,body);assert.equal(source.history.length,0)
 const after=await import('node:fs/promises').then(fs=>fs.readFile(f.path))
 await f.service.page(8);assert.deepEqual(await import('node:fs/promises').then(fs=>fs.readFile(f.path)),after)
})


async function settlementTree(root:string){
 const records:Record<string,string>={}
 for(const name of (await readdir(root,{recursive:true})).sort()){
  const path=join(root,name)
  if((await stat(path)).isFile())records[name]=createHash('sha256').update(await readFile(path)).digest('hex')
 }
 return records
}
function settlementRows(path:string){
 const db=new DatabaseSync(path,{readOnly:true})
 try{return Object.fromEntries(['projects','chapters','body_versions','canonical_events','canonical_event_versions','canonical_event_version_sources',
  'canonical_event_version_seals','canonical_event_version_heads','event_lifecycle_versions','event_display_order_versions',
  'event_settlement_drafts','event_settlement_decisions','event_settlement_receipts','mirror_entries'].map(table=>[table,db.prepare('SELECT * FROM '+table).all()]))}
 finally{db.close()}
}
for(const [table,action] of [
 ['canonical_events','INSERT'],['canonical_event_versions','INSERT'],['canonical_event_version_sources','INSERT'],
 ['canonical_event_version_seals','INSERT'],['canonical_event_version_heads','INSERT'],['event_lifecycle_versions','INSERT'],
 ['event_settlement_decisions','INSERT'],['event_display_order_versions','INSERT'],['event_settlement_receipts','INSERT'],['mirror_entries','UPDATE']
] as const)test('batch rollback at '+table+' preserves all facts, evidence, drafts and author files',async t=>{
 const f=await fixture(t,true),preview=await prepare(f,2),raw=new DatabaseSync(f.path)
 raw.exec("CREATE TRIGGER settlement_insert_fault BEFORE "+action+" ON "+table+" BEGIN SELECT RAISE(ABORT,'injected settlement fault'); END");raw.close()
 const before=settlementRows(f.path),bodyFile=await f.service.page(8)
 await assert.rejects(f.service.commit(preview.token))
 assert.deepEqual(settlementRows(f.path),before)
 assert.equal((await f.service.page(8)).source.body,bodyFile.source.body)
 assert.equal(await f.service.receipt(preview.operationId),null)
})

for(const mode of ['missing','invalid-utf8','archived','checkpoint','pending-journal'] as const)test('source refuses '+mode+' without modifying evidence or source files',async t=>{
 const f=await fixture(t,true),preview=await prepare(f),db=await f.factory.open(f.root)
 const chapter=db.formalChapter(8)!
 try{
  if(mode==='archived')db.archiveFormalChapter(8)
  if(mode==='checkpoint')db.stageAutosaveCheckpoint({legacyChapterId:8,clientOperationId:randomUUID(),baseBodyVersionId:chapter.currentVersionId,title:chapter.title,content:body+'尚未定稿'})
 }finally{db.close()}
 const file=join(f.root,chapter.mirrorRelativePath)
 if(mode==='missing')await rename(file,file+'.retained')
 if(mode==='invalid-utf8')await writeFile(file,Buffer.from([0xff,0xfe,0xff]))
 if(mode==='pending-journal'){
  const journal=new ManuscriptCommitJournal(f.root),next=body+'未完成事务',saved=journal.objects.write(next)
  journal.prepare('book',{name:'writeFormalChapter',args:[{legacyChapterId:8,title:chapter.title,content:next,reason:'manual'}]},[{relativePath:chapter.mirrorRelativePath,previousHash:eventReceiptHash(body),hash:saved.hash}])
 }
 const before=await settlementTree(f.root)
 await assert.rejects(f.service.page(8))
 await assert.rejects(f.service.commit(preview.token))
 assert.deepEqual(await settlementTree(f.root),before)
 assert.equal(await f.service.receipt(preview.operationId),null)
})

for(const target of ['root','database'] as const)test('a physically replaced '+target+' cannot reuse an identical-content settlement preview',async t=>{
 const f=await fixture(t,true),preview=await prepare(f),before=settlementRows(f.path)
 if(target==='root'){
  const parked=f.root+'-retained'
  assert.equal(dirname(parked),await canonicalDirectory(tmpdir()))
  assert.ok(parked.startsWith(join(dirname(f.root),'lanjian-settlement-')))
  await rename(f.root,parked)
  t.after(async()=>{assert.equal(dirname(parked),await canonicalDirectory(tmpdir()));await rm(parked,{recursive:true,force:true})})
  await cp(parked,f.root,{recursive:true,errorOnExist:true,force:false})
 }else{
  const retained=f.path+'.retained'
  await rename(f.path,retained);await copyFile(retained,f.path)
 }
 await assert.rejects(f.service.commit(preview.token),{code:'CONFLICT'})
 assert.deepEqual(settlementRows(f.path),before)
 assert.equal(await f.service.receipt(preview.operationId),null)
})

for(const files of [false,true])test('verified backup and new-copy restore retain settlement history, drafts and receipts ('+(files?'files-v1':'legacy-sqlite')+')',async t=>{
 const f=await fixture(t,files),preview=await prepare(f),result=await f.service.commit(preview.token)
 const source=await f.service.page(8)
 const unused=await f.service.saveDraft({...candidate,chapterId:8,sourceFingerprint:source.source.basis.fingerprint})
 await writeFile(join(f.root,'.webnovel','state.json'),JSON.stringify({project_info:{title:'隔离作品'},updated_at:stamp}))
 const backupParent=await canonicalDirectory(await mkdtemp(join(await canonicalDirectory(tmpdir()),'lanjian-settlement-backup-')))
 t.after(async()=>{assert.equal(dirname(backupParent),await canonicalDirectory(tmpdir()));await rm(backupParent,{recursive:true,force:true})})
 const restoreParent=join(backupParent,'restored');await mkdir(restoreParent)
 const backup=new WorkspaceBackupService(f.factory,async()=>f.root,async()=>'隔离作品',()=> 'test',()=>new Date(stamp),randomUUID,f.writes)
 const created=await backup.create(backupParent),before=await settlementTree(f.root),backupBytes=await settlementTree(created.backupPath)
 const review=await backup.previewRestore(created.backupPath);assert.ok(review.token)
 assert.deepEqual(await settlementTree(created.backupPath),backupBytes)
 const restored=await backup.restore(review.token,restoreParent)
 const root=await canonicalDirectory(restored.projectPath),service=new ProseEventSettlementService(f.factory,async()=>({root,workItemId:'restored',generation:1}),new WorkspaceWriteCoordinator())
 const after=await service.page(8)
 assert.equal(after.source.body,body)
 assert.equal(after.history[0]!.status.state,'current')
 assert.deepEqual(after.history[0]!.decision,source.history[0]!.decision)
 assert.deepEqual(await service.receipt(preview.operationId),result.receipt)
 assert.ok(after.drafts.some(d=>d.id===unused.id))
 assert.deepEqual(await settlementTree(f.root),before)
 assert.deepEqual(await settlementTree(created.backupPath),backupBytes)
})

for(const change of ['stop','root','database'] as const)test(`late provider output cannot create candidates after ${change}`,async t=>{
 const f=await fixture(t),execution=new BookExecutionContext()
 let release!:(raw:string)=>void,started=false,rejectedWrites=0,completedWrites=0
 const original=f.writes.run.bind(f.writes)
 t.mock.method(f.writes,'run',async<T>(root:string,operation:()=>Promise<T>|T)=>{
  try{const result=await original(root,operation);completedWrites++;return result}catch(error){rejectedWrites++;throw error}
 })
 const projects={currentPath:async()=>await execution.path()??f.root,currentSummary:async()=>({id:'work',path:f.root}),
  runBookTask:<T extends {id:string;status:string;chapterId?:number}>(_kind:string,start:()=>T|Promise<T>,_status:(id:string)=>T|Promise<T>)=>execution.run(f.root,start)}
 const ai=new AiClient({resolve:async()=>({kind:'local',connectionId:LOCAL_CONNECTION_ID,connectionName:'fixture',profile:{connectionId:LOCAL_CONNECTION_ID,model:'fixture-model',parameterPolicy:{version:1,mode:'auto'}}}),
  resolveConnection:async()=>({kind:'local',connectionId:LOCAL_CONNECTION_ID,connectionName:'fixture'})},{
  listModels:async()=>['fixture-model'],ready:async()=>true,limits:()=>({contextTokens:150000,systemReserveTokens:1000,maxOutputTokens:5000,recommendedOutputTokens:4000}),toolStep:async()=>assert.fail(),
  complete:async()=>({content:await new Promise<string>(r=>{release=r;started=true})})
 })
 const workspace={contextBudgetPreferences:async()=>({version:1 as const,...contextBudgetStartingSuggestions,pinnedEvidenceKeys:[],excludedEvidenceKeys:[]})}
 const service=new ProseEventExtractionService(projects,f.factory,f.service,ai,workspace,f.writes)
 const task=await service.start({chapterId:8,expectedWorkItemId:'work',operationId:randomUUID(),sourceFingerprint:(await f.service.page(8)).source.basis.fingerprint})
 for(let i=0;i<200&&!started;i++)await new Promise(r=>setTimeout(r,10))
 assert.ok(started)
 if(change==='stop')assert.equal((await service.stop(task.id)).status,'cancelled')
 else if(change==='database'){await rename(f.path,f.path+'.retained');await copyFile(f.path+'.retained',f.path)}
 else{
  const retained=f.root+'-retained',parent=await canonicalDirectory(tmpdir())
  assert.equal(dirname(retained),parent);assert.ok(retained.startsWith(join(parent,'lanjian-settlement-')))
  t.after(async()=>{assert.equal(dirname(retained),parent);await rm(retained,{recursive:true,force:true})})
  await rename(f.root,retained);await cp(retained,f.root,{recursive:true})
 }
 const before=settlementRows(f.path)
 const attemptsBefore=completedWrites+rejectedWrites
 release(JSON.stringify([candidate]))
 let finished=false
 for(let i=0;i<200;i++){
  if(completedWrites+rejectedWrites>attemptsBefore){finished=true;break}
  await new Promise(r=>setTimeout(r,10))
 }
 assert.ok(finished,'late completion and its error path must both finish')
 await f.writes.run(f.root,()=>undefined)
 const view=await service.status(task.id)
 assert.equal(view.status,change==='stop'?'cancelled':'interrupted')
 assert.deepEqual(view.drafts,[]);assert.deepEqual(settlementRows(f.path),before)
 assert.equal(view.rawOutput,undefined)
 assert.equal((await f.service.page(8)).source.body,body)
 if(change!=='stop'){assert.equal(view.rawOutput,undefined);await assert.rejects(service.stop(task.id),{code:'CONFLICT'})}
 service.shutdown()
})

test('the maximum twenty-item confirmation stays atomic and recovers one durable receipt',async t=>{
 const f=await fixture(t),preview=await prepare(f,20),result=await f.service.commit(preview.token)
 assert.equal(new Set(result.receipt.decisionIds).size,20)
 const page=await f.service.page(8)
 assert.equal(page.history.length,20);assert.ok(page.history.every(h=>h.status.state==='current'))
 assert.equal(new Set(page.history.map(h=>h.decision.eventId)).size,20)
 assert.equal(page.source.body,body);assert.deepEqual(await f.service.receipt(preview.operationId),result.receipt)
 await assert.rejects(f.service.commit(preview.token),{code:'CONFLICT'})
 assert.equal((await f.service.page(8)).history.length,20)
})
