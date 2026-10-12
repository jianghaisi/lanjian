import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,rm,readFile,writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { InspirationStore } from '../../../src/main/modules/inspiration/adapters/inspiration-store'
import { InspirationService,type InspirationModels } from '../../../src/main/modules/inspiration/application/inspiration-service'
import { InspirationSelectionService,type InspirationBooks } from '../../../src/main/modules/inspiration/application/selection-service'
import { sourceDocument,inspirationDigest,serializeSourceDocument } from '../../../src/main/modules/inspiration/domain/source'
import { inspirationArgs } from '../../../src/contracts/inspiration/bridge'
import { safeInspirationUrl,decodeInspirationCard } from '../../../src/contracts/inspiration/validation'
import { BilibiliSubtitles } from '../../../src/main/modules/inspiration/adapters/bilibili-subtitles'
import { InspirationVideoService } from '../../../src/main/modules/inspiration/application/video-service'
import { NativeVideoAcquisition,videoAcquisitionError } from '../../../src/main/modules/inspiration/adapters/native-video'
import type { InspirationJob } from '../../../src/contracts/inspiration/types'
import { GroupChatService } from '../../../src/main/modules/group-chat/application/group-chat-service'
import { FileGroupSessionStore } from '../../../src/main/modules/group-chat/adapters/session-store'
import { createGroupTools } from '../../../src/main/modules/group-chat/adapters/group-tools'
import { GroupAdoptionService } from '../../../src/main/modules/group-chat/application/group-adoption-service'
import { groupMembers } from '../../../src/contracts/group-chat/group-chat'
import { modelToolName } from '../../../src/main/modules/writing-plugins/application/registry'
import type { AiToolMessage, AiToolStep } from '../../../src/contracts/assistant/assistant-conversation-contracts'
import type { SourceCard,SourceCardCreateInput } from '../../../src/contracts/worldbuilding/types'

const profile={connectionId:'global-test',model:'fixture',parameterPolicy:{version:2 as const,mode:'auto' as const}}
function response(instruction:string){const input=JSON.parse(instruction.split('\n').at(-1)!);const e=Array.isArray(input)?input.flatMap(c=>c.evidence).slice(0,2):[{segmentId:input.segmentId,quote:input.text.slice(0,30)}];return JSON.stringify({cards:[{title:'救人与记忆',narrative:'主角为了救人付出记忆，并承担后续代价。',tags:['救援','代价'],characters:['主角'],conflict:'救人会失去记忆',choice:'救人',outcome:'失去记忆',turn:'对方仍认得他',foreshadowing:'旧信',evidence:e}]})}
async function fixture(t:import('node:test').TestContext,complete:(s:string,a:AbortSignal)=>Promise<string>=async s=>response(s)){
  const root=await mkdtemp(join(tmpdir(),'lanjian-inspiration-')),store=new InspirationStore(root,'author'),models:InspirationModels={capture:async()=>({fingerprint:inspirationDigest(profile),complete})},library=new InspirationService(store,models)
  t.after(async()=>{await library.shutdown();await rm(root,{recursive:true,force:true})});return {root,store,library,models}
}
async function finish(library:InspirationService,id:string){for(let i=0;i<400;i++){const job=await library.getJob(id);if(job.status!=='running')return job;await delay(5)}throw new Error('JOB_DID_NOT_SETTLE')}
async function importNovel(library:InspirationService,text:string,title='参考小说'){const p=await library.importPreview([{name:`${title}.txt`,dataBase64:Buffer.from(text).toString('base64')}]);return (await library.importCommit(p.token))[0]}

test('long novels retain every source character, chapter offsets and Unicode timed text',()=>{
  const text='第一章 雨夜\n'+ '旧物带来记忆与代价。'.repeat(1300)+'\n第二章 重逢\n'+ '选择改变命运。'.repeat(600),d=sourceDocument({title:'长小说',format:'txt',text})
  assert.equal(d.text,text);assert.equal(d.segments.map(s=>s.text).join(''),text);assert.ok(d.segments.length>6);assert.ok(d.segments.some(s=>s.title==='第二章 重逢'))
  const video=sourceDocument({title:'影',format:'json',timed:[{start:2,end:5,text:'你好\r\n再见'},{start:10,end:13,text:'重逢'}],method:'subtitle'})
  assert.equal(video.segments.map(s=>s.text).join(''),video.text);assert.deepEqual(video.segments.map(s=>s.startSeconds),[2,10])
})
test('strict named contracts reject foreign fields, arbitrary URLs and oversized batches',()=>{
  for(const url of ['http://www.bilibili.com/video/BV123','https://127.0.0.1','https://www.bilibili.com.evil.test','https://user:pass@www.douyin.com/video/1','https://www.douyin.com:444/video/1'])assert.throws(()=>safeInspirationUrl(url))
  assert.throws(()=>inspirationArgs.readCard([randomUUID(),'extra']))
  assert.throws(()=>inspirationArgs.search([{query:'代价',owner:'foreign'}]))
  assert.throws(()=>inspirationArgs.importPreview([{documents:[]}]))
})

test('multi-megabyte novel import validates base64 without overflowing and rejects lossy encodings',async t=>{
  const {library,store}=await fixture(t)
  const text='第一章 长篇测试\n'+'读'.repeat(3_100_000)+'\n第二章 终点\n原文末尾仍在。'
  const input={name:'大体量小说.txt',dataBase64:Buffer.from(text).toString('base64')}
  const preview=await library.importPreview([input])
  const source=(await library.importCommit(preview.token))[0]
  assert.equal(source.totalCharacters,text.length)
  const stored=await store.document(source.id,source.version)
  assert.equal(stored.text,text)
  assert.equal(stored.segments.map(s=>s.text).join(''),text)
  for(const dataBase64 of ['@@==','YQ=','YQ===','YQ==\n','YR==','YQ==YQ==']){
    await assert.rejects(library.importPreview([{name:'坏编码.txt',dataBase64}]),/编码无效/)
  }
  await assert.rejects(library.importPreview([{name:'超限.txt',dataBase64:'A'.repeat(32*1024*1024+4)}]),/24MB/)
  assert.equal((await library.listSources()).length,1)
})
test('private sources deduplicate, retain old versions and reject consistent external tampering',async t=>{
  const f=await fixture(t),a=await importNovel(f.library,'第一章 雨夜\n主角打开旧信。'),same=await importNovel(f.library,'第一章 雨夜\n主角打开旧信。')
  assert.equal(a.id,same.id);assert.equal(a.version,same.version)
  const b=await importNovel(f.library,'第一章 雨夜\n主角没有打开旧信。');assert.equal(b.id,a.id);assert.equal(b.revision,2);assert.notEqual(b.version,a.version)
  assert.equal((await f.store.document(a.id,a.version)).text,'第一章 雨夜\n主角打开旧信。')
  const foreign=new InspirationStore(f.root,'other');assert.deepEqual(await foreign.listSources(),[]);await assert.rejects(foreign.document(a.id,a.version));foreign.close()
  const file=join(f.store.root,`${a.id}-${a.version}.json`),d=JSON.parse(await readFile(file,'utf8'));d.text=d.text.replace('打开','关闭');d.segments[0].text=d.text;await writeFile(file,JSON.stringify(d),'utf8');await assert.rejects(f.store.document(a.id,a.version),/归属已变化/)
})
test('bounded extraction covers all novel segments and summaries, resumes without rereading and caches success',async t=>{
  let calls=0;const f=await fixture(t,async s=>{calls++;const input=JSON.parse(s.split('\n').at(-1)!);if(Array.isArray(input)){assert.ok(input.every(c=>c.foreshadowing==='旧信'&&c.turn==='对方仍认得他'));assert.ok(input.every(c=>c.characters.includes('主角')))}return response(s)}),source=await importNovel(f.library,'第一章\n'+'救人需要付出记忆。'.repeat(900))
  const request={sourceId:source.id,sourceVersion:source.version,operationId:randomUUID(),profile,maxCalls:2}
  let job=await f.library.extract(request);job=await finish(f.library,job.id);assert.equal(job.status,'paused-limit');assert.equal(job.processed,2);assert.equal(calls,2)
  while(job.status==='paused-limit'){await f.library.resume({jobId:job.id,expectedRevision:job.revision});job=await finish(f.library,job.id)}
  assert.equal(job.status,'succeeded',job.notice);assert.equal(job.processed,source.segmentCount);assert.equal(job.units.length,source.segmentCount);assert.equal(job.summaryStatus,'completed')
  const immutable=await f.store.document(source.id,source.version),policy=await f.store.policy(job.id),savedJob=await f.library.getJob(job.id),savedCards=await f.library.search({query:''})
  await f.library.setClassification({sourceId:source.id,sourceVersion:source.version,genreId:'urban',expectedRevision:0})
  assert.deepEqual(await f.store.document(source.id,source.version),immutable);assert.deepEqual(await f.store.policy(job.id),policy);assert.deepEqual(await f.library.getJob(job.id),savedJob);assert.deepEqual(await f.library.search({query:''}),savedCards)
  const total=calls;assert.equal((await f.library.extract(request)).id,job.id);assert.equal((await f.library.extract({...request,operationId:randomUUID()})).id,job.id);assert.equal(calls,total)
  const result=await f.library.search({query:'救援'});assert.ok(result.cards.length>source.segmentCount);assert.ok(result.cards.every(c=>c.evidence.length));const arc=result.cards.find(c=>c.kind==='arc'&&c.segmentIds.length===source.segmentCount);assert.ok(arc)
  for(const card of result.cards){decodeInspirationCard(card);const d=await f.store.document(card.sourceId,card.sourceVersion);assert.ok(card.evidence.every(e=>d.segments.find(s=>s.id===e.segmentId)?.text.includes(e.quote)))}
})
test('invented quotations never publish cards, completed earlier results survive failure',async t=>{
  let n=0;const f=await fixture(t,async s=>{n++;return n===1?response(s):response(s).replace('主角','根本不存在的引文')}),source=await importNovel(f.library,'主角救人。'.repeat(1000))
  // Replace an actual citation, rather than only a narrative description.
  f.models.capture=async()=>({fingerprint:inspirationDigest(profile),complete:async s=>{n++;const r=JSON.parse(response(s));if(n>1)r.cards[0].evidence[0].quote='并不存在于源文本';return JSON.stringify(r)}})
  const job=await f.library.extract({sourceId:source.id,sourceVersion:source.version,operationId:randomUUID(),profile,maxCalls:8}),ended=await finish(f.library,job.id)
  assert.equal(ended.status,'failed');assert.equal(ended.processed,1);assert.equal((await f.library.search({query:''})).cards.length,1)
})
test('stop rejects a late received result and definite completed response remains resumable',async t=>{
  let entered!:()=>void,release!:(s:string)=>void;const enteredPromise=new Promise<void>(r=>entered=r),pending=new Promise<string>(r=>release=r)
  const f=await fixture(t,async()=>{entered();return pending}),source=await importNovel(f.library,'主角救下陌生人。')
  const job=await f.library.extract({sourceId:source.id,sourceVersion:source.version,operationId:randomUUID(),profile,maxCalls:8});await enteredPromise
  const stopping=f.library.stop(job.id);release(response(`\n${JSON.stringify({segmentId:(await f.store.document(source.id,source.version)).segments[0].id,text:'主角救下陌生人。'})}`));const stopped=await stopping
  assert.equal(stopped.status,'cancelled');assert.equal(stopped.processed,0);assert.equal((await f.library.search({query:''})).cards.length,0)
})
test('unknown sent attempts freeze, restart never dispatches inference',async t=>{
  let calls=0;const f=await fixture(t,async()=>{calls++;throw new Error('secret-provider-token')}),source=await importNovel(f.library,'主角救人，付出记忆。'),job=await f.library.extract({sourceId:source.id,sourceVersion:source.version,operationId:randomUUID(),profile,maxCalls:8})
  const ended=await finish(f.library,job.id);assert.equal(ended.status,'usage-unconfirmed');assert.ok(!ended.notice.includes('secret-provider-token'));await assert.rejects(f.library.resume({jobId:job.id,expectedRevision:ended.revision}));assert.equal(calls,1)
  await f.library.shutdown();const resumed=new InspirationService(new InspirationStore(f.root,'author'),f.models);assert.equal((await resumed.getJob(job.id)).status,'usage-unconfirmed');assert.equal(calls,1);await resumed.shutdown()
})
test('changed sources invalidate previews and selection commits once into each target book',async t=>{
  const f=await fixture(t),source=await importNovel(f.library,'主角救人，付出记忆。'),job=await f.library.extract({sourceId:source.id,sourceVersion:source.version,operationId:randomUUID(),profile,maxCalls:8});await finish(f.library,job.id)
  const card=(await f.library.search({query:''})).cards.find(c=>c.kind==='scene')!,materials=new Map<string,Map<string,string>>(),books:InspirationBooks={capture:async id=>{if(!['a','b'].includes(id))throw new Error('NOT_OWNED');const map=materials.get(id)??new Map();materials.set(id,map);return {id,title:id,identity:id,run:async work=>work(),find:async key=>map.get(key),add:async(_title,_content,key)=>{const id=randomUUID();map.set(key,id);return id}}}}
  const selections=new InspirationSelectionService(f.library,books)
  const a=await selections.prepare({bookId:'a',cardId:card.id,sourceVersion:card.sourceVersion,operationId:randomUUID()});assert.equal(materials.get('a')!.size,0)
  const receipt=await selections.commit(a.token);assert.deepEqual(await selections.commit(a.token),receipt);assert.equal(materials.get('a')!.size,1)
  await f.library.setClassification({sourceId:source.id,sourceVersion:source.version,genreId:'xianxia',expectedRevision:0});assert.deepEqual(await selections.commit(a.token),receipt)
  const b=await selections.prepare({bookId:'b',cardId:card.id,sourceVersion:card.sourceVersion,operationId:randomUUID()});await selections.commit(b.token);assert.equal(materials.get('b')!.size,1)
  const stale=await selections.prepare({bookId:'a',cardId:card.id,sourceVersion:card.sourceVersion,operationId:randomUUID()});await importNovel(f.library,'主角救人，没有付出记忆。');await assert.rejects(selections.commit(stale.token));assert.equal(materials.get('a')!.size,1)
})
test('BiliNote subtitle flow honors selected part, Chinese subtitles and actual timing',async()=>{
  const urls:string[]=[];const subtitles=new BilibiliSubtitles(async(input)=>{const u=String(input);urls.push(u);if(u.includes('/view?'))return Response.json({code:0,data:{title:'雨夜',owner:{name:'作者'},pages:[{cid:11,duration:30,part:'前半'},{cid:22,duration:60,part:'重逢'}]}});if(u.includes('/player/'))return Response.json({code:0,data:{subtitle:{subtitles:[{lan:'en',subtitle_url:'https://i0.hdslb.com/en.json'},{lan:'zh-CN',subtitle_url:'https://i0.hdslb.com/zh.json'}]}}});return Response.json({body:[{from:5,to:9,content:'主角失去了记忆。'}]})})
  const d=await subtitles.acquire('https://www.bilibili.com/video/BV12345/?p=2',new AbortController().signal);assert.ok(d);assert.ok(urls[1].includes('cid=22'));assert.ok(urls[2].endsWith('/zh.json'));assert.equal(d.segments[0].startSeconds,5);assert.equal(d.source.visualCoverage,'none');assert.ok(d.source.title.includes('P2'))
  await assert.rejects(subtitles.acquire('https://www.bilibili.com/video/BV12345/?p=999',new AbortController().signal))
})
test('subtitle video jobs never treat platform metadata as story and respect cancellation',async t=>{
  const f=await fixture(t),caps=async()=>({subtitles:true,videoAudio:false,asr:false,preparing:false,visual:false,notice:'没有转写能力'}),service=new InspirationVideoService(f.library,{canonical:async url=>url,acquire:async()=>null},{capabilities:caps,prepare:caps,acquire:async()=>{throw new Error('provider-private-url')}})
  t.after(()=>service.shutdown());const job=await service.start({url:'https://www.douyin.com/video/123',operationId:randomUUID()});for(let i=0;i<100;i++){if((await service.get(job.id)).status!=='running')break;await delay(5)}
  const ended=await service.get(job.id);assert.equal(ended.status,'failed');assert.equal(ended.preview,null);assert.deepEqual(await f.library.listSources(),[]);assert.ok(!ended.notice.includes('provider-private-url'))
})

test('explicit author notes are skipped without losing text, and adjacent subtitles share bounded inputs',async t=>{
  const f=await fixture(t),text='目录\n第一章 雨夜\n\n作者的话\n感谢读者。\n第一章 雨夜\n主角救人，失去记忆。',source=await importNovel(f.library,text)
  const d=await f.store.document(source.id,source.version);assert.equal(d.text,text);assert.ok(source.auxiliaryCount>=2)
  let j=await f.library.extract({sourceId:source.id,sourceVersion:source.version,operationId:randomUUID(),profile,maxCalls:8});j=await finish(f.library,j.id)
  assert.equal(j.status,'succeeded');assert.equal(j.total,source.segmentCount-source.auxiliaryCount);assert.equal(j.skippedSegmentIds.length,source.auxiliaryCount)
  const timed=Array.from({length:100},(_,i)=>({start:i*2,end:i*2+1,text:`第${i}句真实字幕。`})),video=sourceDocument({title:'长字幕',format:'json',method:'subtitle',timed})
  assert.equal(video.text,timed.map(s=>s.text).join('\n'));assert.ok(video.segments.length<5);assert.ok(video.segments.every(s=>s.endSeconds!-s.startSeconds!<=90))
})

test('pure scenery can complete without fabricated cards or an empty summary loop',async t=>{
  let calls=0;const f=await fixture(t,async()=>{calls++;return '{"cards":[]}'}),source=await importNovel(f.library,'天空很蓝，云缓缓飘过。')
  const j=await finish(f.library,(await f.library.extract({sourceId:source.id,sourceVersion:source.version,operationId:randomUUID(),profile,maxCalls:8})).id)
  assert.equal(j.status,'succeeded');assert.equal(j.processed,1);assert.equal(calls,1);assert.equal((await f.library.search({query:''})).total,0)
})

test('a source changed while inference is running cannot publish cards or completed coverage',async t=>{
  let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>entered=r),pending=new Promise<void>(r=>release=r)
  const f=await fixture(t,async instruction=>{entered();await pending;return response(instruction)}),source=await importNovel(f.library,'主角为了救人付出记忆。')
  const j=await f.library.extract({sourceId:source.id,sourceVersion:source.version,operationId:randomUUID(),profile,maxCalls:8});await ready
  await importNovel(f.library,'主角决定不救人。');release();const end=await finish(f.library,j.id)
  assert.equal(end.status,'failed');assert.equal(end.processed,0);assert.deepEqual(end.cardIds,[]);assert.equal((await f.library.search({query:''})).total,0)
})

test('acquired video text survives restart, refreshes review tokens and needs no repeated acquisition',async t=>{
  const f=await fixture(t),caps=async()=>({subtitles:true,videoAudio:false,asr:false,preparing:false,visual:false,notice:'字幕可用'});let calls=0
  const subtitles={canonical:async(url:string)=>url,acquire:async()=>{calls++;return sourceDocument({title:'真实字幕',format:'json',method:'subtitle',url:'https://www.bilibili.com/video/BV12345/',timed:[{start:2,end:4,text:'主角付出记忆救人。'}]})}},audio={capabilities:caps,prepare:caps,acquire:async()=>{throw new Error('should not download')}}
  const video=new InspirationVideoService(f.library,subtitles,audio),job=await video.start({url:'https://www.bilibili.com/video/BV12345/',operationId:randomUUID()})
  for(let i=0;i<100&&(await video.get(job.id)).status==='running';i++)await delay(5)
  const original=await video.get(job.id);assert.equal(original.status,'succeeded');assert.equal(original.preview!.samples[0].text,'主角付出记忆救人。')
  await video.shutdown();await f.library.shutdown()
  const reopened=new InspirationService(new InspirationStore(f.root,'author'),f.models),resumed=new InspirationVideoService(reopened,subtitles,audio)
  try{const restored=await resumed.get(job.id);assert.notEqual(restored.preview!.token,original.preview!.token);assert.equal(calls,1);assert.equal((await resumed.list()).length,1);await reopened.importCommit(restored.preview!.token);assert.equal((await reopened.listSources()).length,1)}finally{await resumed.shutdown();await reopened.shutdown()}
})

test('partial interrupted video can be reviewed but cannot replace an already complete source',async t=>{
  const f=await fixture(t),url='https://www.douyin.com/video/123',partial=sourceDocument({title:'语音片段',url,format:'json',method:'asr',partial:true,duration:60,timed:[{start:1,end:8,text:'主角付出代价。'}]})
  const caps=async()=>({subtitles:false,videoAudio:true,asr:true,preparing:false,visual:false,notice:'测试转写'}),video=new InspirationVideoService(f.library,{canonical:async u=>u,acquire:async()=>null},{capabilities:caps,prepare:caps,acquire:async()=>{throw new Error('cancelled worker')},partial:async()=>partial})
  try{const job=await video.start({url,operationId:randomUUID()});for(let i=0;i<100&&(await video.get(job.id)).status==='running';i++)await delay(5)
    const result=await video.get(job.id);assert.equal(result.status,'failed');assert.equal(result.preview!.sources[0].acquisitionCoverage,'partial');assert.ok(result.notice.includes('不能视为完整'));await f.library.importCommit(result.preview!.token)
    const complete=sourceDocument({title:'语音片段',url,format:'json',method:'asr',duration:60,timed:[{start:1,end:8,text:'主角付出代价。'},{start:20,end:30,text:'他最终找回记忆。'}]});await f.store.commitDocuments([complete]);await assert.rejects(f.store.commitDocuments([partial]),/不能替换/)
  }finally{await video.shutdown()}
})

test('actual group tools search and read private cards, require current evidence and gate author adoption',async t=>{
  const f=await fixture(t),source=await importNovel(f.library,'主角救人，付出记忆。');await finish(f.library,(await f.library.extract({sourceId:source.id,sourceVersion:source.version,operationId:randomUUID(),profile,maxCalls:8})).id)
  const call=(name:string,args:unknown):AiToolStep=>({content:'',toolCalls:[{id:randomUUID(),type:'function',function:{name:modelToolName('builtin.core',name),arguments:JSON.stringify(args)}}]})
  const step=async(messages:AiToolMessage[]):Promise<AiToolStep>=>{const results=messages.filter(m=>m.role==='tool'),value=results.length?JSON.parse(results.at(-1)!.content!).value:undefined
    if(!results.length)return call('search_inspiration_library',{query:'救援'})
    if(results.length===1)return call('read_inspiration_card',{cardId:value.cards[0].id})
    if(results.length===2)return call('save_inspiration_adaptation',{cardId:value.id,revision:value.revision,title:'保护证人的选择',content:'主角主动销毁旧信保护证人，证人替他找回身世。',changes:'重设动机、行动、代价与结局。'})
    return {content:'等待作者核对。',toolCalls:[]}}
  const store=new FileGroupSessionStore(f.root,'author'),groups=new GroupChatService('author',store,{defaults:async()=>groupMembers.map(m=>({memberId:m.id,profile})),capture:async()=>({identity:inspirationDigest(profile),model:{model:profile.model,connectionId:profile.connectionId,step:(m)=>step(m)},run:async work=>work()}),assertScope:async()=>{},inScope:async(_s,work)=>work(),tools:(s,w)=>createGroupTools(s,w,undefined,undefined,f.library)})
  const created=await groups.openBook({id:'a',title:'本书'},{root:'/private/a',physicalIdentity:'a'});await groups.send({sessionId:created.id,expectedRevision:created.revision,operationId:randomUUID(),message:'搜索救援情节并改编'});await groups.drain(created.id)
  const view=await groups.get({sessionId:created.id,limit:100});assert.equal(view.status,'idle',JSON.stringify(view));const candidate=view.candidates[0];assert.equal(candidate.kind,'adaptation');assert.ok(candidate.references![0].id.startsWith('inspiration:'))
  const materials:SourceCard[]=[],research={listSources:async()=>({sources:materials}),createSource:async(input:SourceCardCreateInput)=>{const card={...input,id:randomUUID(),capturedAt:new Date().toISOString(),contentHash:'fixture'} as SourceCard;materials.push(card);return card}}
  const adoption=new GroupAdoptionService(groups,async(id,work)=>work(await store.read(id)),{} as never,research,undefined,f.library)
  const preview=await adoption.prepare({sessionId:view.id,expectedRevision:view.revision,candidateId:candidate.id});assert.equal(materials.length,0);await importNovel(f.library,'主角拒绝救人。');await assert.rejects(adoption.adopt(preview.token));assert.equal(materials.length,0)
})

test('restart recovers only local partial speech, never downloads or transcribes automatically',async t=>{
  const f=await fixture(t),url='https://www.douyin.com/video/123',id=randomUUID(),now=new Date().toISOString()
  await f.store.saveVideo({id,url,status:'running',stage:'transcribing',progress:45,notice:'转写中',preview:null,createdAt:now,updatedAt:now})
  const partial=sourceDocument({title:'中断语音',url,format:'json',method:'asr',partial:true,timed:[{start:1,end:3,text:'主角选择救人。'}]})
  let calls=0;const caps=async()=>({subtitles:false,videoAudio:true,asr:true,preparing:false,visual:false,notice:'仅供测试'})
  const videos=new InspirationVideoService(f.library,{canonical:async()=>{calls++;throw new Error('no network')},acquire:async()=>{calls++;throw new Error('no network')}},{capabilities:caps,prepare:caps,acquire:async()=>{calls++;throw new Error('no inference')},partial:async job=>job===id?partial:null})
  try{const recovered=await videos.get(id);assert.equal(recovered.status,'interrupted');assert.equal(calls,0);assert.ok(recovered.notice.includes('不能视为完整'));assert.equal(recovered.preview!.samples[0].text,'主角选择救人。')
    await f.library.importCommit(recovered.preview!.token)
    const complete=sourceDocument({title:'中断语音',url,format:'json',method:'asr',timed:[{start:1,end:3,text:'主角选择救人。'}]})
    assert.notEqual(complete.source.version,partial.source.version)
    await f.store.commitDocuments([complete]);assert.equal((await f.library.listSources())[0].acquisitionCoverage,'complete')
  }finally{await videos.shutdown()}
})

test('failed multi-source import publishes no partial batch and preserves previous versions',async t=>{
  const f=await fixture(t),url='https://www.douyin.com/video/123'
  const complete=sourceDocument({title:'视频',url,method:'asr',format:'json',timed:[{start:0,end:3,text:'主角救人。'}]})
  await f.store.commitDocuments([complete])
  const novel=sourceDocument({title:'新小说',format:'txt',text:'主角寻找旧信。'})
  const partial=sourceDocument({title:'视频',url,method:'asr',format:'json',partial:true,timed:[{start:0,end:2,text:'主角救人。'}]})
  await assert.rejects(f.store.commitDocuments([novel,partial]),/部分视频/)
  assert.deepEqual((await f.store.listSources()).map(s=>s.id),[complete.source.id])
  await f.store.commitDocuments([novel]);assert.equal((await f.store.document(novel.source.id,novel.source.version)).text,novel.text)
})

test('imported escaped text above 50MB remains readable within the same 64MB stored limit',async t=>{
  const f=await fixture(t),d=sourceDocument({title:'大文本',format:'txt',text:'"'.repeat(13_000_000)})
  assert.ok(Buffer.byteLength(serializeSourceDocument(d))>50*1024*1024)
  const p=f.library.stagePreview([d],13_000_000),s=(await f.library.importCommit(p.token))[0]
  assert.equal((await f.store.document(s.id,s.version)).text,d.text)
  const videoId=randomUUID();await f.store.saveVideoResult(videoId,d)
  assert.equal((await f.store.videoResult(videoId))?.text,d.text)
  const tooLarge=sourceDocument({title:'超大转写',format:'json',method:'asr',timed:[{start:0,end:20,text:'中'.repeat(12_000_000)}]})
  await assert.rejects(f.store.saveVideoResult(randomUUID(),tooLarge),/超过64MB/)
  assert.equal((await f.store.videoResult(videoId))?.text,d.text)
})

test('recent causal context is bounded and completed non-story segments do not make the final arc partial',async t=>{
  const inputs:string[]=[];const f=await fixture(t,async instruction=>{inputs.push(instruction);const input=JSON.parse(instruction.split('\n').at(-1)!);return !Array.isArray(input)&&input.text.includes('纯风景')?'{"cards":[]}':response(instruction)})
  const source=await importNovel(f.library,'第一章 钥匙\n旧钥匙可以开门。\n第二章 风景\n纯风景，无人行动。\n第三章 开门\n主角拿钥匙开门，救出伙伴。')
  const job=await finish(f.library,(await f.library.extract({sourceId:source.id,sourceVersion:source.version,operationId:randomUUID(),profile,maxCalls:8})).id)
  assert.equal(job.status,'succeeded')
  const third=JSON.parse(inputs[2].split('\n').at(-1)!);assert.equal(third.priorContext.length,1)
  assert.match(inputs[3],/实际覆盖2\/2个有情节/)
  const arc=(await f.library.search({query:'',sourceId:source.id})).cards.find(c=>c.kind==='arc')!
  assert.ok(!arc.title.startsWith('片段汇总：'))
})

test('short links permit four checked hops, normalize official Douyin shares and reject foreign redirects',async()=>{
  let calls=0
  const subtitles=new BilibiliSubtitles(async()=>new Response(null,{status:302,headers:{location:++calls===4?'https://www.bilibili.com/video/BV12345':`https://b23.tv/hop${calls}`}}))
  assert.equal(await subtitles.canonical('https://b23.tv/start',new AbortController().signal),'https://www.bilibili.com/video/BV12345');assert.equal(calls,4)
  const methods:string[]=[];const douyin=new BilibiliSubtitles(async(_url,options)=>{methods.push(options?.method??'GET');return options?.method==='HEAD'?new Response(null,{status:405}):new Response(null,{status:302,headers:{location:'https://www.iesdouyin.com/share/video/123456/?from=share'}})})
  assert.equal(await douyin.canonical('https://v.douyin.com/test',new AbortController().signal),'https://www.douyin.com/video/123456');assert.deepEqual(methods,['HEAD','GET'])
  let unsafeReads=0;const unsafe=new BilibiliSubtitles(async()=>{unsafeReads++;return new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}})})
  await assert.rejects(unsafe.canonical('https://b23.tv/test',new AbortController().signal));assert.equal(unsafeReads,1)
  assert.match(videoAcquisitionError('PLATFORM_AUTH_REQUIRED').message,/登录/);assert.match(videoAcquisitionError('secret-url').message,/平台视频读取/)
})

test('concurrent capability reads await the same readiness probe',async()=>{
  const native=new NativeVideoAcquisition('/unused','/unused','/unused')
  let resolve!:(r:Record<string,unknown>)=>void,calls=0
  Object.assign(native,{assertRoot:async()=>{},run:async()=>{calls++;return new Promise<Record<string,unknown>>(r=>{resolve=r})}})
  const first=native.capabilities(),second=native.capabilities();await new Promise(r=>setImmediate(r));resolve({ready:true})
  assert.ok((await Promise.all([first,second])).every(c=>c.asr));assert.equal(calls,1)
})

test('schema one migration preserves sources and future schemas are not overwritten',async t=>{
  const f=await fixture(t),source=await importNovel(f.library,'主角打开旧信。');f.store.close()
  const file=join(f.store.root,'library.sqlite');let db=new DatabaseSync(file);db.exec('DROP TABLE source_classifications; DROP TABLE video_results; DROP TABLE job_policies; PRAGMA user_version=1');db.close()
  const migrated=new InspirationStore(f.root,'author');assert.equal((await migrated.document(source.id,source.version)).text,'主角打开旧信。');migrated.close()
  db=new DatabaseSync(file);assert.equal(db.prepare('PRAGMA user_version').get()?.user_version,4);db.exec('PRAGMA user_version=9');db.close()
  const future=new InspirationStore(f.root,'author');await assert.rejects(future.listSources(),{code:'UNSUPPORTED_PROJECT_VERSION'});future.close()
  db=new DatabaseSync(file);assert.equal(db.prepare('PRAGMA user_version').get()?.user_version,9);db.close()
})

test('competing source publication never corrupts the committed immutable version',async t=>{
  const f=await fixture(t),initial=await importNovel(f.library,'原始故事。'),other=new InspirationStore(f.root,'author')
  try{
  const a=sourceDocument({title:initial.title,format:'txt',text:'新故事甲。'}),b=sourceDocument({title:initial.title,format:'txt',text:'新故事乙。'})
  const results=await Promise.allSettled([f.store.commitDocuments([a]),other.commitDocuments([b])]);assert.ok(results.some(r=>r.status==='fulfilled'))
  const sources=await f.store.listSources();assert.equal(sources.length,1);assert.equal(sources[0].id,initial.id)
  assert.ok(['新故事甲。','新故事乙。'].includes((await f.store.document(sources[0].id,sources[0].version)).text))
  assert.equal((await f.store.document(initial.id,initial.version)).text,'原始故事。')
  }finally{other.close()}
})
