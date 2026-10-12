import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { InspirationStore } from '../../../src/main/modules/inspiration/adapters/inspiration-store'
import { InspirationService } from '../../../src/main/modules/inspiration/application/inspiration-service'
import { sourceDocument, decodeExtractedCards, inspirationDigest } from '../../../src/main/modules/inspiration/domain/source'
import { inspirationArgs, createInspirationBridge } from '../../../src/contracts/inspiration/bridge'
import type { InspirationImportPreview } from '../../../src/contracts/inspiration/types'
import type { NovelGenreId } from '../../../src/contracts/inspiration/genres'

async function fixture(t:test.TestContext){
  const root=await mkdtemp(join(tmpdir(),'lanjian-genres-')),store=new InspirationStore(root,'author')
  let captures=0
  const library=new InspirationService(store,{capture:async()=>{captures++;throw new Error('metadata must not request a model')}})
  t.after(async()=>{await library.shutdown();await rm(root,{recursive:true,force:true})})
  return {root,store,library,get captures(){return captures}}
}
const preview=(library:InspirationService,title='参考小说',text='第一章 选择\n主角救出了同伴。')=>library.importPreview([{name:`${title}.txt`,dataBase64:Buffer.from(text).toString('base64')}])
const choice=(p:InspirationImportPreview,genreId:NovelGenreId)=>({...p.classifications![0],genreId})
// Import intent is intentionally narrower than the read projection.
const choices=(p:InspirationImportPreview,genreId:NovelGenreId)=>{const c=choice(p,genreId);return [{sourceId:c.sourceId,genreId:c.genreId,expectedRevision:c.revision}]}

test('classification survives reopen while source bytes, content versions and extraction tables stay unchanged',async t=>{
  const f=await fixture(t),p=await preview(f.library),[s]=await f.library.importCommit(p.token,choices(p,'urban'))
  const file=join(f.store.root,`${s.id}-${s.version}.json`),before=await readFile(file)
  const db=new DatabaseSync(join(f.store.root,'library.sqlite'))
  const snapshot=()=>['sources','versions','cards','jobs','operations','selections','job_policies'].map(table=>db.prepare(`SELECT * FROM ${table}`).all())
  const original=snapshot(),c=(await f.library.listClassifications())[0]
  const result=await f.library.setClassification({sourceId:s.id,sourceVersion:s.version,genreId:'xianxia',expectedRevision:c.revision})
  assert.equal(result.revision,2);assert.deepEqual(snapshot(),original);assert.deepEqual(await readFile(file),before);db.close()
  assert.deepEqual(await f.library.setClassification({sourceId:s.id,sourceVersion:s.version,genreId:'xianxia',expectedRevision:2}),result)
  f.store.close();assert.equal((await f.store.listClassifications())[0].genreId,'xianxia');assert.equal(f.captures,0)
})

test('duplicate, new-content and known-old-version imports retain category and final stable source identity',async t=>{
  const f=await fixture(t),p=await preview(f.library),[s]=await f.library.importCommit(p.token,choices(p,'urban'))
  for(const text of ['第一章 选择\n主角救出了同伴。','第一章 改变\n同伴决定返回故乡。','第一章 选择\n主角救出了同伴。']){
    const next=await preview(f.library,'参考小说',text);assert.equal(next.classifications![0].genreId,'urban')
    const [actual]=await f.library.importCommit(next.token);assert.equal(actual.id,s.id);assert.equal((await f.library.listClassifications())[0].genreId,'urban')
  }
  const next=await preview(f.library),[actual]=await f.library.importCommit(next.token,choices(next,'xianxia'))
  assert.equal(actual.id,s.id);assert.equal((await f.library.listClassifications())[0].sourceId,s.id)
  assert.equal((await f.library.listClassifications())[0].genreId,'xianxia');assert.equal((await f.library.listSources()).length,1)
})

test('repeated confirmation acknowledges exactly the original intent; another intent cannot reuse it',async t=>{
  const f=await fixture(t),p=await preview(f.library),intent=choices(p,'urban'),first=await f.library.importCommit(p.token,intent)
  assert.deepEqual(await f.library.importCommit(p.token,intent),first)
  await assert.rejects(f.library.importCommit(p.token,choices(p,'xianxia')),{code:'CONFLICT'})
  assert.equal((await f.library.listClassifications())[0].revision,1)
})

test('stale category previews roll back the entire batch and preserve the current author choice',async t=>{
  const f=await fixture(t),initial=await preview(f.library),[s]=await f.library.importCommit(initial.token)
  const p=await f.library.importPreview(['新小说','参考小说'].map(title=>({name:`${title}.txt`,dataBase64:Buffer.from('新故事。').toString('base64')})))
  await f.library.setClassification({sourceId:s.id,sourceVersion:s.version,genreId:'urban',expectedRevision:0})
  await assert.rejects(f.library.importCommit(p.token,p.classifications!.map(c=>({sourceId:c.sourceId,genreId:'xianxia',expectedRevision:c.revision}))),{code:'CONFLICT'})
  assert.deepEqual(await f.library.listSources(),[s]);assert.equal((await f.library.listClassifications())[0].genreId,'urban')
})

test('metadata insert failure publishes no source or category from a multi-novel batch',async t=>{
  const f=await fixture(t),initial=await preview(f.library,'占位'),[s]=await f.library.importCommit(initial.token)
  const db=new DatabaseSync(join(f.store.root,'library.sqlite'))
  db.exec("CREATE TRIGGER fail_category BEFORE INSERT ON source_classifications WHEN NEW.genre_id='xianxia' BEGIN SELECT RAISE(ABORT,'blocked write'); END")
  const p=await f.library.importPreview(['甲','乙'].map(title=>({name:`${title}.txt`,dataBase64:Buffer.from('选择。').toString('base64')})))
  await assert.rejects(f.library.importCommit(p.token,p.classifications!.map((c,i)=>({sourceId:c.sourceId,genreId:i?'xianxia':'urban',expectedRevision:c.revision}))))
  assert.deepEqual(await f.library.listSources(),[s]);assert.equal(db.prepare('SELECT count(*) AS n FROM source_classifications').get()?.n,0);db.close()
})

test('category CAS enforces owner, content version, metadata revision and novel kind',async t=>{
  const f=await fixture(t),p=await preview(f.library),[s]=await f.library.importCommit(p.token)
  const request={sourceId:s.id,sourceVersion:s.version,genreId:'urban' as const,expectedRevision:0},other=new InspirationStore(f.root,'foreign')
  await assert.rejects(other.setClassification(request),{code:'NOT_FOUND'});assert.deepEqual(await other.listClassifications(),[]);other.close()
  const concurrent=new InspirationStore(f.root,'author')
  const results=await Promise.allSettled([f.store.setClassification(request),concurrent.setClassification({...request,genreId:'xianxia'})]);concurrent.close()
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1)
  await assert.rejects(f.library.setClassification({...request,sourceVersion:'0'.repeat(64)}),{code:'CONFLICT'})
  const video=sourceDocument({title:'视频',format:'json',method:'subtitle',timed:[{start:0,end:2,text:'救援。'}]})
  await f.store.commitDocuments([video]);await assert.rejects(f.store.setClassification({...request,sourceId:video.source.id,sourceVersion:video.source.version}),{code:'CONFLICT'})
  assert.equal((await f.store.listClassifications()).length,1)
})

for(const version of [1,2,3])test(`schema ${version} migrates transactionally with immutable text and unclassified legacy novels`,async t=>{
  const f=await fixture(t),p=await preview(f.library),[s]=await f.library.importCommit(p.token),file=join(f.store.root,`${s.id}-${s.version}.json`),before=await readFile(file)
  f.store.close();const db=new DatabaseSync(join(f.store.root,'library.sqlite'))
  db.exec('DROP TABLE source_classifications');if(version<3)db.exec('DROP TABLE job_policies');if(version===1)db.exec('DROP TABLE video_results');db.exec(`PRAGMA user_version=${version}`);db.close()
  assert.deepEqual(await f.library.listSources(),[s]);assert.deepEqual(await f.library.listClassifications(),[{sourceId:s.id,genreId:'unclassified',revision:0,updatedAt:null}]);assert.deepEqual(await readFile(file),before)
  f.store.close();const upgraded=new DatabaseSync(join(f.store.root,'library.sqlite'));assert.equal(upgraded.prepare('PRAGMA user_version').get()?.user_version,4);upgraded.close()
})

test('failed legacy migration rolls back intermediate tables and preserves declared schema',async t=>{
  const f=await fixture(t),p=await preview(f.library);await f.library.importCommit(p.token);f.store.close()
  const file=join(f.store.root,'library.sqlite'),db=new DatabaseSync(file)
  db.exec('DROP TABLE video_results; DROP TABLE job_policies; PRAGMA user_version=1');db.close()
  await assert.rejects(f.library.listSources());const check=new DatabaseSync(file)
  assert.equal(check.prepare('PRAGMA user_version').get()?.user_version,1)
  assert.equal(check.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('video_results','job_policies')").get()?.n,0)
  assert.equal(check.prepare('SELECT count(*) AS n FROM sources').get()?.n,1);check.close()
})

test('named bridge keeps the single-token call and rejects forged, duplicated and oversized classifications',async()=>{
  const id=randomUUID(),c={sourceId:id,genreId:'urban' as const,expectedRevision:0},input={...c,sourceVersion:'a'.repeat(64)}
  assert.deepEqual(inspirationArgs.importCommit([id]),[id,undefined]);assert.deepEqual(inspirationArgs.setClassification([input]),[input])
  for(const invalid of [{...input,owner:'foreign'},{...input,genreId:'unknown'},{...input,expectedRevision:-1}])assert.throws(()=>inspirationArgs.setClassification([invalid]))
  for(const invalid of [[c,c],Array.from({length:21},()=>({...c,sourceId:randomUUID()})),[{...c,path:'private'}]])assert.throws(()=>inspirationArgs.importCommit([id,invalid]))
  assert.throws(()=>inspirationArgs.search([{query:'',cardKind:'unknown'}]))
  const sent:unknown[][]=[],bridge=createInspirationBridge(async<T>(...args:unknown[])=>{sent.push(args);return [] as T})
  await bridge.importCommit(id);await bridge.importCommit(id,[c]);assert.equal(sent[0].length,2);assert.equal(sent[1].length,3)
})

test('scene and arc pagination filter in storage before paging and never cross the selected source',async t=>{
  const f=await fixture(t),p=await preview(f.library),[s]=await f.library.importCommit(p.token),other=await preview(f.library,'另一本');await f.library.importCommit(other.token)
  const doc=await f.store.document(s.id,s.version),segment=doc.segments[0],response=JSON.stringify({cards:[{title:'选择',narrative:'主角救出了同伴。',tags:[],characters:[],conflict:'',choice:'救人',outcome:'同伴获救',turn:'',foreshadowing:'',evidence:[{segmentId:segment.id,quote:segment.text}]}]})
  const base=decodeExtractedCards(response,doc,[segment],'fixture',inspirationDigest('fixture'),'scene')[0],db=new DatabaseSync(join(f.store.root,'library.sqlite'))
  for(let i=0;i<37;i++){const c={...base,id:randomUUID(),kind:i<2?'arc':'scene'};db.prepare('INSERT INTO cards VALUES(?,?,?,?,?,?)').run(c.id,c.sourceId,c.sourceVersion,c.kind,'选择',JSON.stringify(c))}db.close()
  const arcs=await f.library.search({query:'',sourceId:s.id,cardKind:'arc',offset:0,limit:30});assert.equal(arcs.total,2);assert.ok(arcs.cards.every(c=>c.kind==='arc'));assert.equal(arcs.nextOffset,-1)
  const first=await f.library.search({query:'',sourceId:s.id,cardKind:'scene',offset:0,limit:30}),second=await f.library.search({query:'',sourceId:s.id,cardKind:'scene',offset:first.nextOffset,limit:30})
  assert.equal(first.total,35);assert.equal(first.cards.length,30);assert.equal(second.cards.length,5);assert.equal(new Set([...first.cards,...second.cards].map(c=>c.id)).size,35)
  assert.equal((await f.library.search({query:'',sourceId:other.sources[0].id,cardKind:'arc',offset:0,limit:30})).total,0)
})
