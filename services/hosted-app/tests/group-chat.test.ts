import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fixture } from './helpers.ts'
import { unwrapValidatedIpcResponse } from '../../../desktop/src/contracts/core/ipc-response'
import type { GroupSessionView } from '../../../desktop/src/contracts/group-chat/group-chat'

test('account-owned bookless group meters two member models, creates once, and adopts through original book service',async t=>{
  const calls:any[]=[]
  const f=fixture(t,async(_url,init)=>{
    const body=JSON.parse(String(init?.body));calls.push(body)
    const results=body.messages.filter((m:any)=>m.role==='tool')
    const tool=(name:string,args:unknown)=>({id:`call-${calls.length}-${name}`,type:'function',function:{name:body.tools.find((v:any)=>v.function.name.includes(`_${name}_`))?.function.name??name,arguments:JSON.stringify(args)}})
    let message
    if(body.tools.some((v:any)=>v.function.name.includes('_save_character_candidate_')))message=results.length?{role:'assistant',content:'人物候选等待作者核对。'}:{role:'assistant',content:'人物有明确的动机。',tool_calls:[tool('save_character_candidate',{name:'林舟',description:'为了找回母亲的记忆而修复旧物，害怕忘记她的声音。'})]}
    else if(body.tools.some((v:any)=>v.function.name.includes('_save_macro_event_candidate_')))message=results.length?{role:'assistant',content:'四要素事件候选等待作者核对。'}:{role:'assistant',content:'从一次修复抉择展开故事。',tool_calls:[tool('save_macro_event_candidate',{title:'旧信的代价',time:'第一日雨夜',characters:['林舟'],location:'旧城修复铺',event:'林舟修复母亲留下的旧信',result:'他听见信中的告别，却忘记了母亲的声音'})]}
    else if(body.model==='fixture-chief')message=results.length?{role:'assistant',content:'世界观成员接续筹备。'}:{role:'assistant',content:'先确定故事的核心。',tool_calls:[tool('save_preparation_candidate',{kind:'definition',title:'核心设想',content:'雨夜修复师能听见旧物记忆。'}),tool('delegate_to_member',{memberId:'world',instruction:'完善世界并请求建书'})]}
    else message={role:'assistant',content:'世界观候选已经整理。',tool_calls:[tool('save_preparation_candidate',{kind:'world',title:'世界规则',content:'每次修复都会付出一段记忆。'}),tool('request_book_creation',{title:'雨夜修复师',summary:'记忆与选择'})]}
    return new Response(JSON.stringify({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:20,completion_tokens:10}}),{headers:{'content-type':'application/json'}})
  })
  const user=await f.login(),foreign=await f.login('456')
  for(const id of ['chief','world']){
    f.models.update('admin',id,{name:id,protocol:'openai-compatible',baseUrl:'https://provider.example/v1',model:`fixture-${id}`,enabled:true,maxInputTokens:100000,maxOutputTokens:4096,expectedRevision:0,apiKey:'synthetic-key'})
    f.credits.updatePrice('admin',id,{expectedVersion:0,policy:{mode:'tokens',inputPerMillion:100000,outputPerMillion:100000}})
  }
  f.models.select('admin',{modelId:'chief',expectedRevision:0})
  const request=async(name:string,args:unknown[]=[],who=user)=>f.app.inject({method:'POST',url:`/api/desktop/library/group-chat/${name}`,cookies:who.cookies,headers:who.headers,payload:{args,operation:randomUUID()}})
  const call=async<T=GroupSessionView>(name:string,args:unknown[]=[])=>{const reply=await request(name,args);assert.equal(reply.statusCode,200,reply.body);return unwrapValidatedIpcResponse<T>(`group-chat:${name}`,reply.json())}
  let s=await call('create',['隔离筹备群'])
  assert.equal(f.books.list(user.me.user.id).length,0)
  const catalog=await call<any>('modelCatalog');assert.equal(catalog.connections.connections.length,2);assert.ok(!JSON.stringify(catalog).includes('synthetic-key'))
  s=await call('saveMember',[{sessionId:s.id,expectedRevision:s.revision,memberId:'world',profile:{connectionId:'global-hosted-world',model:'fixture-world',temperature:.6,topP:.9,maxTokens:2048}}])
  const command={sessionId:s.id,expectedRevision:s.revision,operationId:randomUUID(),message:'筹备并创建这本小说'}
  s=await call('send',[command]);await (await f.groups.account(user.me.user.id)).groups.drain(s.id)
  s=await call('get',[{sessionId:s.id,limit:100}]);assert.equal(s.status,'waiting-creation',s.notice)
  assert.deepEqual(calls.map(c=>c.model),['fixture-chief','fixture-chief','fixture-world'])
  assert.equal(f.books.list(user.me.user.id).length,0,'preparation never inserts a placeholder book')
  assert.equal(f.db.get('SELECT COUNT(*) AS n FROM group_model_attempts')?.n,3)
  assert.equal(f.credits.wallet(user.me.user.id).balance,9991)
  await call('send',[command]);assert.equal(calls.length,3,'lost response retries do not send or charge again')
  const blocked=await request('get',[{sessionId:s.id,limit:100}],foreign)
  assert.equal(blocked.json().ok,false);assert.ok(!blocked.body.includes('每次修复'))
  const preview=await f.app.inject({method:'POST',url:'/api/desktop/library/model-connections/previewCreation',cookies:user.cookies,headers:user.headers,payload:{args:[true],operation:randomUUID()}})
  const token=unwrapValidatedIpcResponse<any>('model-connections:previewCreation',preview.json()).token
  const creation={sessionId:s.id,expectedRevision:s.revision,creationId:s.creation!.id,token,project:{name:'雨夜修复师',parentPath:'账户书库'}}
  const created=await call<any>('createBook',[creation]);s=created.session
  await call('createBook',[creation]);assert.equal(f.books.list(user.me.user.id).length,1)
  assert.ok(!JSON.stringify(created).includes(f.root));assert.equal(s.book!.id,created.result.project.id)
  const candidate=s.candidates.find(c=>c.kind==='world')!
  const adoption=await call<any>('prepareAdoption',[{sessionId:s.id,expectedRevision:s.revision,candidateId:candidate.id}])
  assert.equal(await f.runtimes.run(user.me.user.id,s.book!.id,async r=>(await r.workspace.foundation(true)).worldView),'')
  s=await call('adopt',[adoption.token]);assert.equal(s.candidates.find(c=>c.id===candidate.id)!.status,'adopted')
  await call('adopt',[adoption.token]);assert.equal(f.books.list(user.me.user.id).length,1,'completed adoption receipt settles an identical retry')
  assert.equal(await f.runtimes.run(user.me.user.id,s.book!.id,async r=>(await r.workspace.foundation(true)).worldView),'每次修复都会付出一段记忆。')
  const definition=s.candidates.find(c=>c.kind==='definition')!
  const stale=await call<any>('prepareAdoption',[{sessionId:s.id,expectedRevision:s.revision,candidateId:definition.id}])
  await f.runtimes.run(user.me.user.id,s.book!.id,async r=>r.workspace.saveBookProfile({...await r.workspace.bookProfile(),coreIdea:'作者在预览后修改的新想法'}))
  await assert.rejects(call('adopt',[stale.token]))
  assert.equal(await f.runtimes.run(user.me.user.id,s.book!.id,async r=>(await r.workspace.bookProfile()).coreIdea),'作者在预览后修改的新想法','stale preview never replaces a later author save')
  for(const memberId of ['character','outline'] as const){
    s=await call('send',[{sessionId:s.id,expectedRevision:s.revision,operationId:randomUUID(),message:'生成一个结构化候选',memberId}]);await(await f.groups.account(user.me.user.id)).groups.drain(s.id)
    s=await call('get',[{sessionId:s.id,limit:100}]);assert.equal(s.status,'idle',s.notice)
    const structured=s.candidates.find(c=>c.memberId===memberId&&c.domainDraft)!
    const preview=await call<any>('prepareAdoption',[{sessionId:s.id,expectedRevision:s.revision,candidateId:structured.id}])
    if(memberId==='character')assert.equal(await f.runtimes.run(user.me.user.id,s.book!.id,async r=>(await r.manuscripts.storyEntities(r.root)).length),0)
    else assert.equal(await f.runtimes.run(user.me.user.id,s.book!.id,async r=>(await r.events.projection.read()).approved.length),0)
    s=await call('adopt',[preview.token]);assert.equal(s.candidates.find(c=>c.id===structured.id)!.status,'adopted')
  }
  assert.equal(await f.runtimes.run(user.me.user.id,s.book!.id,async r=>(await r.manuscripts.storyEntities(r.root))[0]!.canonicalName),'林舟')
  const event=await f.runtimes.run(user.me.user.id,s.book!.id,async r=>(await r.events.projection.read()).approved[0]!)
  assert.equal(event.content.time,'第一日雨夜');assert.deepEqual(event.content.characters,['林舟']);assert.equal(event.content.location,'旧城修复铺');assert.equal(event.content.evidenceRefs.length,1)
  assert.equal(event.creator,'author','the original material adoption records the author decision')
  assert.equal(await f.runtimes.run(user.me.user.id,s.book!.id,async r=>(await r.research.listSources()).sources.find(source=>source.id===event.content.evidenceRefs[0]!.sourceId)!.provider),'group-chat','AI preparation provenance survives adoption')
  const before=calls.length
  s=await call('saveMember',[{sessionId:s.id,expectedRevision:s.revision,memberId:'editor',profile:{connectionId:'global-hosted-chief',model:'fixture-chief',maxTokens:32768,temperature:.7,topP:1}}]).catch(()=>s)
  assert.equal(calls.length,before,'member configuration never dispatches paid inference')
})

test('preparation restart marks sends uncertain without replay or a fake book',async t=>{
  const f=fixture(t),user=await f.login(),id=randomUUID(),sessionId=randomUUID()
  f.db.run('INSERT INTO group_model_jobs VALUES(?,?,?,?,?,?,?, ?,NULL,?,?)',id,user.me.user.id,sessionId,null,'chief',1,1,'running',f.db.now(),f.db.now())
  f.db.run('INSERT INTO group_model_attempts VALUES(?,?,NULL, ?,NULL,NULL,?)',randomUUID(),id,'sent',f.db.now())
  f.jobs.recoverAfterRestart()
  assert.equal(f.db.get('SELECT status FROM group_model_jobs WHERE id=?',id)?.status,'interrupted')
  assert.equal(f.db.get('SELECT status FROM group_model_attempts WHERE job_id=?',id)?.status,'unknown')
  assert.equal(f.books.list(user.me.user.id).length,0)
})


test('standard creation saves genre once and opens an account-owned existing book group without inference', async t => {
  const f = fixture(t), author = await f.login(), foreign = await f.login('654')
  const request = async (channel: string, args: unknown[], who = author) => f.app.inject({ method: 'POST', url: `/api/desktop/library/${channel}`, cookies: who.cookies, headers: who.headers, payload: { args, operation: randomUUID() } })
  const preview = await request('model-connections/previewCreation', [true])
  const token = unwrapValidatedIpcResponse<any>('model-connections:previewCreation', preview.json()).token
  const input = { name: '都市回声', genre: '都市奇幻', parentPath: '账户书库' }
  const created = await request('model-connections/createProject', [{ token, project: input }])
  assert.equal(created.statusCode, 200, created.body)
  const result = unwrapValidatedIpcResponse<any>('model-connections:createProject', created.json()), bookId = result.project.id
  const genre = () => f.runtimes.run(author.me.user.id, bookId, async r => (await r.workspace.bookProfile()).genre)
  assert.equal(await genre(), '都市奇幻')
  const [first, second] = await Promise.all([request('group-chat/openBook', [bookId]), request('group-chat/openBook', [bookId])])
  const a = unwrapValidatedIpcResponse<GroupSessionView>('group-chat:openBook', first.json()), b = unwrapValidatedIpcResponse<GroupSessionView>('group-chat:openBook', second.json())
  assert.equal(a.id, b.id); assert.equal(a.book?.id, bookId); assert.equal(a.members.length, 7)
  assert.ok(!JSON.stringify(a).includes(f.root)); assert.equal(f.db.get('SELECT COUNT(*) AS n FROM group_model_attempts')?.n, 0)
  const rejected = await request('group-chat/openBook', [bookId], foreign)
  assert.equal(rejected.json().ok, false); assert.ok(!rejected.body.includes('都市回声'))
  await f.runtimes.run(author.me.user.id, bookId, async r => r.workspace.saveBookProfile({ ...await r.workspace.bookProfile(), genre: '作者后改的悬疑' }))
  const retry = await request('model-connections/createProject', [{ token, project: input }])
  assert.equal(retry.statusCode, 200, retry.body); assert.equal(await genre(), '作者后改的悬疑')
  assert.equal(f.books.list(author.me.user.id).length, 1)
})
