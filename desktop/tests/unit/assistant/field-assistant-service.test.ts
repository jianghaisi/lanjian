import assert from 'node:assert/strict'
import test from 'node:test'
import { FieldAssistantService, type FieldAssistantPorts } from '../../../src/main/modules/assistant/application/field-assistant-service'
import { decodeFieldRequest, decodeFieldTask, type FieldRequest, type FieldTask } from '../../../src/contracts/assistant/field-assistant-contracts'
import { validateFieldValue } from '../../../src/main/modules/assistant/domain/assistant-field-target'
import { storyOutlineFieldIds } from '../../../src/contracts/planning/outline-story-guidance'

const request=():FieldRequest=>({operationId:'operation-1',target:{fieldId:'definition.bookProfile.coreIdea',instanceId:'draft-1',editorSessionId:'session-1',workItemId:'book-a',pageId:'profile',label:'核心设想',revision:1,value:'旧设想'},instruction:'改写核心设想'})
function fixture(){
  let scope:string|null='book-a',context='已保存的定义',output='{"value":"新设想"}',wait:Promise<void>|null=null,writeFailure:'before'|'after'|null=null,writeCount=0
  const tasks=new Map<string,FieldTask>(),calls:string[]=[]
  const ports:FieldAssistantPorts={
    async assertScope(expected){if(expected!==scope)throw new Error('scope changed')},async context(){return context},
    async prepareModel(){return {model:'fixture-model',connectionId:'fixture',async complete(instruction){calls.push(instruction);if(wait)await wait;return {content:output}}}},
    async readTasks(expected){return [...tasks.values()].filter(t=>t.target.workItemId===expected).map(t=>structuredClone(t))},async writeTask(task){writeCount++;if(writeFailure==='before')throw new Error('before commit');tasks.set(task.id,structuredClone(task));if(writeFailure==='after')throw new Error('after commit')}
  }
  const service=new FieldAssistantService(ports)
  return {service,tasks,calls,ports,writes:()=>writeCount,failWrite(v:typeof writeFailure){writeFailure=v},scope(v:string|null){scope=v},context(v:string){context=v},output(v:string){output=v},wait(v:Promise<void>){wait=v}}
}
async function settled(f:ReturnType<typeof fixture>){for(let i=0;i<100;i++){const task=f.tasks.get('operation-1');if(task?.status!=='running')return task!;await new Promise(r=>setTimeout(r,2))}throw new Error('task did not finish')}

test('preview is zero-write; candidate remains non-canon until explicit, single-use application',async()=>{
  const f=fixture(),r=request();const preview=await f.service.preview(r)
  assert.equal(preview.target.value,'旧设想');assert.equal(f.tasks.size,0);assert.equal(f.calls.length,0)
  await f.service.start(r);const task=decodeFieldTask(await settled(f));assert.equal(task.candidate?.after,'新设想')
  assert.equal(task.candidate?.status,'candidate');assert.equal(r.target.value,'旧设想')
  const permit=await f.service.prepareApplication({candidateId:task.candidate!.id,target:r.target})
  await assert.rejects(()=>f.service.prepareApplication({candidateId:task.candidate!.id,target:r.target}))
  const applied=await f.service.acknowledge(permit.token,'applied');assert.equal(applied.status,'applied')
  const writes=f.writes();assert.deepEqual(await f.service.acknowledge(permit.token,'applied'),applied);assert.equal(f.writes(),writes)
  assert.equal((await f.service.acknowledge(permit.token,'undone')).status,'undone')
})
test('unknown target and hidden side effects never cross the argument boundary',()=>{
  assert.throws(()=>decodeFieldRequest({...request(),target:{...request().target,fieldId:'settings.apiKey'}}))
  assert.throws(()=>decodeFieldRequest({...request(),target:{...request().target,path:'config.json'}}))
  assert.throws(()=>decodeFieldRequest({...request(),approve:true}))
  assert.throws(()=>decodeFieldRequest({...request(),target:{...request().target,value:{nested:'payload'}}}))
})
test('a changed draft, object identity, book or dependency refuses application',async()=>{
  const f=fixture(),r=request();await f.service.start(r);const task=await settled(f)
  for(const target of [{...r.target,value:'继续手写'},{...r.target,revision:2},{...r.target,instanceId:'other-row'},{...r.target,editorSessionId:'new-editor'}])await assert.rejects(()=>f.service.prepareApplication({candidateId:task.candidate!.id,target}))
  f.context('上游已修改');await assert.rejects(()=>f.service.prepareApplication({candidateId:task.candidate!.id,target:r.target}))
  f.scope('book-b');await assert.rejects(()=>f.service.task(task.id,'book-a'))
})
test('cancellation and a provider that ignores abort cannot publish a late candidate',async()=>{
  const f=fixture();let release!:()=>void;f.wait(new Promise<void>(r=>{release=r}));await f.service.start(request())
  await new Promise(r=>setTimeout(r,5));await f.service.cancel('operation-1','book-a');release();await new Promise(r=>setTimeout(r,10))
  assert.equal(f.tasks.get('operation-1')?.status,'cancelled');assert.equal(f.tasks.get('operation-1')?.candidate,undefined)
})
test('malformed model output, extra actions, wrong type and invalid enum stay out of drafts',async()=>{
  for(const output of ['not JSON','{"value":"合法文字","save":true}','{"value":{"path":"overwrite"}}']){
    const f=fixture();f.output(output);await f.service.start(request());const task=await settled(f);assert.equal(task.status,'failed');assert.equal(task.candidate,undefined)
  }
  assert.throws(()=>validateFieldValue({...request().target,fieldId:'definition.bookProfile.plannedVolumes'},0))
  assert.throws(()=>validateFieldValue({...request().target,fieldId:'definition.bookProfile.genre',options:['玄幻','都市']},'invented'))
})

test('unchanged model output is not a completed or applicable modification',async()=>{
  const f=fixture();f.output('{"value":"旧设想"}');await f.service.start(request())
  const task=await settled(f)
  assert.equal(task.status,'failed');assert.equal(task.candidate,undefined);assert.match(task.error!,/与当前输入相同/)
})
test('application forms work with no book and never inherit book context',async()=>{
  const f=fixture();f.scope(null);f.context('应用界面帮助');const r=request();r.target={...r.target,fieldId:'AppShell.createForm.name',workItemId:null,pageId:'library',value:''}
  const context=await f.service.preview(r);assert.equal(context.context,'应用界面帮助');await f.service.start(r);assert.equal((await settled(f)).status,'completed')
})

test('interrupted field tasks recover as interrupted without a second model request or write',async()=>{
  const f=fixture(),r=request();f.tasks.set(r.operationId,{id:r.operationId,target:r.target,status:'running',createdAt:'2026-09-11',updatedAt:'2026-09-11'})
  assert.equal((await f.service.recent('book-a'))[0].status,'failed');assert.equal((await f.service.task(r.operationId,'book-a')).status,'failed')
  assert.equal(f.tasks.get(r.operationId)?.status,'running');assert.equal(f.calls.length,0)
})

test('concurrent duplicate generation and application receipts are single use',async()=>{
  const f=fixture(),r=request();await Promise.all([f.service.start(r),f.service.start(r)]);const task=await settled(f);assert.equal(f.calls.length,1)
  const permit=await f.service.prepareApplication({candidateId:task.candidate!.id,target:r.target})
  const results=await Promise.allSettled([f.service.acknowledge(permit.token,'applied'),f.service.acknowledge(permit.token,'applied')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
})

test('scalar and structured field families keep their declared type through candidate validation',async()=>{
  for(const [fieldId,value,options] of [['definition.bookProfile.plannedVolumes',3,undefined],['definition.bookProfile.genre','玄幻',['玄幻','都市']],['definition.bookProfile.autosaveEnabled',true,undefined],['AppShell.storyEntityDraft.profileJson','{"description":"测试人物"}',undefined]] as const){
    const f=fixture(),r=request();const before=typeof value==='number'?1:typeof value==='boolean'?false:fieldId.endsWith('genre')?'都市':'{}';r.target={...r.target,fieldId,value:before,...(options?{options:[...options]}:{})};f.output(JSON.stringify({value}));await f.service.start(r);const task=await settled(f);assert.equal(task.status,'completed',task.error || 'typed field candidate');assert.equal(task.candidate?.after,value)
  }
})

for(const phase of ['before','after'] as const)for(const action of ['applied','undone'] as const)test(`${action} confirmation recovers ${phase}-commit failure without repeating a committed transition`,async()=>{
  const f=fixture(),r=request();await f.service.start(r);const task=await settled(f)
  const permit=await f.service.prepareApplication({candidateId:task.candidate!.id,target:r.target})
  if(action==='undone')await f.service.acknowledge(permit.token,'applied')
  const writes=f.writes();f.failWrite(phase)
  await assert.rejects(()=>f.service.acknowledge(permit.token,action))
  const stored=structuredClone(f.tasks.get(r.operationId)!)
  assert.equal(stored.candidate?.status,phase==='after'?action:action==='applied'?'candidate':'applied')
  f.failWrite(null)
  const result=await f.service.acknowledge(permit.token,action)
  assert.equal(result.status,action);assert.equal(f.writes(),writes+(phase==='after'?1:2))
  if(phase==='after')assert.deepEqual(result,stored.candidate)
  const confirmedWrites=f.writes(),confirmed=structuredClone(f.tasks.get(r.operationId))
  assert.deepEqual(await f.service.acknowledge(permit.token,action),result)
  assert.equal(f.writes(),confirmedWrites);assert.deepEqual(f.tasks.get(r.operationId),confirmed)
})

test('receipt replay cannot apply again after undo, enter another book, or use an unknown/expired permit',async t=>{
  const f=fixture(),r=request();await f.service.start(r);const task=await settled(f)
  const permit=await f.service.prepareApplication({candidateId:task.candidate!.id,target:r.target})
  await assert.rejects(()=>f.service.acknowledge(permit.token,'undone'))
  await f.service.acknowledge(permit.token,'applied');await f.service.acknowledge(permit.token,'undone')
  const writes=f.writes();await assert.rejects(()=>f.service.acknowledge(permit.token,'applied'))
  f.scope('book-b');await assert.rejects(()=>f.service.acknowledge(permit.token,'undone'));f.scope('book-a')
  await assert.rejects(()=>f.service.acknowledge('unknown','applied'))
  const future=Date.now()+25*3600000;t.mock.method(Date,'now',()=>future)
  await assert.rejects(()=>f.service.acknowledge(permit.token,'undone'));assert.equal(f.writes(),writes)
})

test('an authorized failed confirmation can retry beyond the initial 60 second write window',async t=>{
  const f=fixture(),r=request();await f.service.start(r);const task=await settled(f)
  const permit=await f.service.prepareApplication({candidateId:task.candidate!.id,target:r.target})
  f.failWrite('before');await assert.rejects(()=>f.service.acknowledge(permit.token,'applied'));f.failWrite(null)
  const later=Date.now()+120000;t.mock.method(Date,'now',()=>later)
  assert.equal((await f.service.acknowledge(permit.token,'applied')).status,'applied')
})

test('scope changes during the receipt read fail before writing or returning success',async()=>{
  const f=fixture(),r=request();await f.service.start(r);const task=await settled(f)
  const permit=await f.service.prepareApplication({candidateId:task.candidate!.id,target:r.target})
  const read=f.ports.readTasks,writes=f.writes()
  f.ports.readTasks=async scope=>{const records=await read(scope);f.scope('book-b');return records}
  await assert.rejects(()=>f.service.acknowledge(permit.token,'applied'))
  assert.equal(f.writes(),writes);assert.equal(f.tasks.get(r.operationId)?.candidate?.status,'candidate')
})

test('every declared human outline field uses a frozen route, one name correction and re-review',async()=>{
  for(const fieldId of storyOutlineFieldIds){
    const f=fixture(),r=request();r.target={...r.target,fieldId,value:'林舟在档案室核对旧信。'}
    f.context('本书人物林舟在档案室。其他、吉他是正常词语。')
    const outputs=[{value:'林舟询问管理员，他核对旧信。'}, {issues:[{category:'character-name',quote:'他核对旧信',parentQuote:'本书人物林舟',reason:'核对动作属于已命名的林舟，应使用完整姓名。',needsAuthor:false}]}, {value:'林舟询问管理员，林舟核对旧信。'}, {issues:[]}]
    let prepared=0
    f.ports.prepareModel=async()=>{prepared++;return{model:'frozen-model',connectionId:'frozen-connection',complete:async(instruction,_draft,context)=>{
      f.calls.push(instruction);assert.match(context,/完整姓名/)
      const value=outputs.shift();assert.notEqual(value,undefined);return{content:JSON.stringify(value)}
    }}}
    await f.service.start(r);const task=decodeFieldTask(await settled(f))
    assert.equal(task.status,'completed',`${fieldId}: ${task.error}`);assert.equal(task.candidate?.after,'林舟询问管理员，林舟核对旧信。')
    assert.equal(task.candidate?.connectionId,'frozen-connection');assert.equal(f.calls.length,4);assert.equal(prepared,1)
    assert.match(f.calls[1],/姓名专项只检查下列人读字段：\["林舟询问管理员，他核对旧信。"\]/)
    assert.match(f.calls[2],/只含 value 字段/)
  }
})

test('ambiguous outline names preserve bounded failure evidence across decoding without an applicable candidate',async()=>{
  const f=fixture(),r=request();r.target={...r.target,fieldId:'AppShell.chapterOutline'}
  const candidate={value:'程见微和姜听澜停下，她拿过手机。'}
  const outputs=[candidate,{issues:[{category:'character-name',quote:'她拿过手机',parentQuote:'',reason:'不能确定动作归属，需要作者核对。',needsAuthor:true}]}]
  f.ports.prepareModel=async()=>({model:'m',connectionId:'c',complete:async(instruction)=>{f.calls.push(instruction);return{content:JSON.stringify(outputs.shift())}}})
  await f.service.start(r);const task=decodeFieldTask(await settled(f))
  assert.equal(task.status,'failed');assert.equal(task.candidate,undefined);assert.equal(f.calls.length,2)
  assert.match(task.error!,/需要作者核对/);assert.match(task.rawResult!,/full-names-v1/)
  assert.equal(JSON.parse(task.rawResult!).originalContent,JSON.stringify(candidate))
  assert.equal(decodeFieldTask({...task,rawResult:undefined}).rawResult,undefined)
  assert.throws(()=>decodeFieldTask({...task,rawResult:{}}));assert.throws(()=>decodeFieldTask({...task,rawResult:'x'.repeat(2_000_001)}))
})

test('changed outline background or cancellation during review cannot publish late text',async()=>{
  for(const change of ['background','cancel'] as const){
    const f=fixture(),r=request();r.target={...r.target,fieldId:'AppShell.totalOutline'}
    let release!:()=>void,reviewStarted!:()=>void
    const paused=new Promise<void>(resolve=>{release=resolve}),started=new Promise<void>(resolve=>{reviewStarted=resolve})
    f.ports.prepareModel=async()=>({model:'m',connectionId:'c',complete:async(instruction)=>{
      f.calls.push(instruction)
      if(f.calls.length===1)return{content:JSON.stringify({value:'林舟询问管理员。'})}
      reviewStarted();await paused;return{content:'{"issues":[]}'}
    }})
    await f.service.start(r);await started
    if(change==='background')f.context('正式依据已经变化');else await f.service.cancel(r.operationId,r.target.workItemId)
    release();await new Promise(resolve=>setTimeout(resolve,10));const task=await settled(f)
    assert.equal(task.status,change==='cancel'?'cancelled':'failed');assert.equal(task.candidate,undefined);assert.equal(f.calls.length,2)
  }
})

test('ordinary prose, setting templates and numeric fields do not inherit outline name review',async()=>{
  for(const fieldId of ['AppShell.systemTemplate','AppShell.foundation.sourceNotes','definition.bookProfile.coreIdea']){
    const f=fixture(),r=request();r.target={...r.target,fieldId};f.output('{"value":"她走进门，其他人弹吉他。"}')
    await f.service.start(r);assert.equal((await settled(f)).candidate?.after,'她走进门，其他人弹吉他。');assert.equal(f.calls.length,1)
  }
})
