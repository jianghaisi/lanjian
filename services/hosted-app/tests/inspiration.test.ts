import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { fixture } from './helpers.ts'
import { unwrapValidatedIpcResponse } from '../../../desktop/src/contracts/core/ipc-response'
import type { InspirationImportPreview,InspirationJob,InspirationSelection,InspirationSource,SourceClassification } from '../../../desktop/src/contracts/inspiration/types'
import { assertTenantSpace } from '../src/files/quota.ts'
import { readSite } from '../src/admin/site-store.ts'

function output(body:any){const input=JSON.parse(body.messages.at(-1).content.split('\n').at(-1)),evidence=Array.isArray(input)?input[0].evidence:[{segmentId:input.segmentId,quote:input.text.slice(0,24)}];return JSON.stringify({cards:[{title:'救人的代价',narrative:'主角救下陌生人，却忘记了对方。',tags:['救人'],characters:['主角'],conflict:'救人与记忆冲突',choice:'救人',outcome:'失去记忆',turn:'被救者认识他',foreshadowing:'旧信',evidence}]})}
test('private cross-book library meters original transport once, isolates accounts and commits source into actual book materials',async t=>{
  let calls=0;const f=fixture(t,async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body));return Response.json({choices:[{message:{role:'assistant',content:output(body)},finish_reason:'stop'}],usage:{prompt_tokens:30,completion_tokens:20}})})
  const author=await f.login(),foreign=await f.login('456')
  f.models.update('admin','extract',{name:'情节模型',protocol:'openai-compatible',baseUrl:'https://provider.example/v1',model:'fixture-extract',enabled:true,maxInputTokens:100000,maxOutputTokens:4096,expectedRevision:0,apiKey:'PRIVATE_SENTINEL'})
  f.credits.updatePrice('admin','extract',{expectedVersion:0,policy:{mode:'request',points:10}})
  const request=(name:string,args:unknown[]=[],who=author)=>f.app.inject({method:'POST',url:`/api/desktop/library/inspiration/${name}`,cookies:who.cookies,headers:who.headers,payload:{args,operation:randomUUID()}})
  const call=async<T>(name:string,args:unknown[]=[])=>{const r=await request(name,args);assert.equal(r.statusCode,200,r.body);assert.ok(!r.body.includes('PRIVATE_SENTINEL'));assert.ok(!r.body.includes(f.root));return unwrapValidatedIpcResponse<T>(`inspiration:${name}`,r.json())}
  const preview=await call<InspirationImportPreview>('importPreview',[{documents:[{name:'都市奇幻.txt',dataBase64:Buffer.from('第一章 雨夜\n主角救下陌生人，却付出记忆。').toString('base64')}]}]);assert.equal(f.books.list(author.me.user.id).length,0)
  const source=(await call<InspirationSource[]>('importCommit',[preview.token]))[0],profile={connectionId:'global-hosted-extract',model:'fixture-extract',maxTokens:4096,temperature:.7,topP:.95}
  const command={sourceId:source.id,sourceVersion:source.version,operationId:randomUUID(),profile,maxCalls:8}
  const job=await call<InspirationJob>('extract',[command]);let ended=job
  for(let i=0;i<200;i++){ended=await call<InspirationJob>('getJob',[job.id]);if(ended.status!=='running')break;await delay(10)}
  assert.equal(ended.status,'succeeded',ended.notice);assert.equal(calls,2);assert.equal(f.credits.wallet(author.me.user.id).balance,9980);assert.equal(f.db.get('SELECT COUNT(*) AS n FROM group_model_attempts')?.n,2)
  assert.equal((await call<InspirationJob>('extract',[{...command,operationId:randomUUID()}])).id,job.id);assert.equal(calls,2)
  const results=await call<any>('search',[{query:'救人'}]);assert.equal(results.cards.length,2);assert.ok(!JSON.stringify(results).includes('PRIVATE_SENTINEL'))
  const original=await call('readSource',[{sourceId:source.id,sourceVersion:source.version,offset:0,limit:2}])
  const category=await call<SourceClassification>('setClassification',[{sourceId:source.id,sourceVersion:source.version,genreId:'urban',expectedRevision:0}])
  assert.equal(category.genreId,'urban');assert.deepEqual(await call('readSource',[{sourceId:source.id,sourceVersion:source.version,offset:0,limit:2}]),original)
  assert.deepEqual(await call('readCard',[results.cards[0].id]),results.cards[0]);assert.equal(calls,2)
  const foreignCategories=await request('listClassifications',[],foreign);assert.deepEqual(unwrapValidatedIpcResponse('inspiration:listClassifications',foreignCategories.json()),[])
  assert.equal((await request('setClassification',[{sourceId:source.id,sourceVersion:source.version,genreId:'xianxia',expectedRevision:category.revision}],foreign)).json().ok,false)
  assert.equal((await request('setClassification',[{sourceId:source.id,sourceVersion:source.version,genreId:'xianxia',expectedRevision:category.revision,owner:author.me.user.id}])).json().ok,false)
  const arcs=await call<any>('search',[{query:'',sourceId:source.id,cardKind:'arc'}]);assert.equal(arcs.cards.length,1);assert.equal(arcs.cards[0].kind,'arc')
  const foreignList=await request('listSources',[],foreign);assert.deepEqual(unwrapValidatedIpcResponse('inspiration:listSources',foreignList.json()),[])
  const blocked=await request('readCard',[results.cards[0].id],foreign);assert.equal(blocked.json().ok,false);assert.ok(!blocked.body.includes('主角救下'))
  const a=f.books.create(author.me.user.id,{title:'新书甲',operation:randomUUID()}),b=f.books.create(author.me.user.id,{title:'新书乙',operation:randomUUID()}),foreignBook=f.books.create(foreign.me.user.id,{title:'其他人的书',operation:randomUUID()})
  const card=results.cards[0]
  for(const book of [a,b]){const selection=await call<InspirationSelection>('prepareSelection',[{bookId:book.id,cardId:card.id,sourceVersion:card.sourceVersion,operationId:randomUUID()}]);assert.equal(await f.runtimes.run(author.me.user.id,book.id,async r=>(await r.research.listSources()).sources.length),0);const receipt=await call('commitSelection',[selection.token]);assert.deepEqual(await call('commitSelection',[selection.token]),receipt);const material=await f.runtimes.run(author.me.user.id,book.id,async r=>(await r.research.listSources()).sources);assert.equal(material.length,1);assert.equal(material[0].provider,'inspiration-library');assert.ok(material[0].userNotes.includes(card.sourceVersion));assert.equal(await f.runtimes.run(author.me.user.id,book.id,async r=>(await r.documents.chapters()).length),0)}
  const foreignSelection=await request('prepareSelection',[{bookId:foreignBook.id,cardId:card.id,sourceVersion:card.sourceVersion,operationId:randomUUID()}]);assert.equal(foreignSelection.json().ok,false)
  await assert.rejects(assertTenantSpace(f.db.root,author.me.user.id,null,0,{...readSite(f.db).limits,userMiB:0}),/quota/)
})
test('hosted library rejects unknown usage retries, unauthorized writes and local video preparation',async t=>{
  let calls=0;const f=fixture(t,async()=>{calls++;throw new Error('PRIVATE_PROVIDER_SENTINEL')});const author=await f.login()
  f.models.update('admin','extract',{name:'情节模型',protocol:'openai-compatible',baseUrl:'https://provider.example/v1',model:'fixture',enabled:true,maxInputTokens:100000,maxOutputTokens:4096,expectedRevision:0,apiKey:'PRIVATE_SENTINEL'})
  f.credits.updatePrice('admin','extract',{expectedVersion:0,policy:{mode:'request',points:10}})
  const request=(name:string,args:unknown[]=[],headers=author.headers)=>f.app.inject({method:'POST',url:`/api/desktop/library/inspiration/${name}`,cookies:author.cookies,headers,payload:{args,operation:randomUUID()}})
  const call=async<T>(name:string,args:unknown[]=[])=>unwrapValidatedIpcResponse<T>(`inspiration:${name}`,(await request(name,args)).json())
  assert.equal((await request('listSources',[],{origin:author.headers.origin,'x-csrf-token':'wrong'})).statusCode,403)
  const p=await call<InspirationImportPreview>('importPreview',[{documents:[{name:'参考.txt',dataBase64:Buffer.from('主角救人。').toString('base64')}]}]),source=(await call<InspirationSource[]>('importCommit',[p.token]))[0]
  const j=await call<InspirationJob>('extract',[{sourceId:source.id,sourceVersion:source.version,operationId:randomUUID(),profile:{connectionId:'global-hosted-extract',model:'fixture',maxTokens:4096,temperature:.7,topP:.95},maxCalls:8}]);let ended=j;for(let i=0;i<100;i++){ended=await call<InspirationJob>('getJob',[j.id]);if(ended.status!=='running')break;await delay(10)}
  assert.equal(ended.status,'usage-unconfirmed');assert.equal(calls,1);assert.ok(!ended.notice.includes('PRIVATE'));assert.equal(f.credits.wallet(author.me.user.id).reserved,10)
  const retry=await request('resume',[{jobId:j.id,expectedRevision:ended.revision}]);assert.equal(retry.json().ok,false);assert.equal(calls,1)
  const caps=await call<any>('capabilities');assert.equal(caps.asr,false);assert.equal(caps.visual,false);assert.equal((await request('prepareVideoRuntime')).json().ok,false)
})
