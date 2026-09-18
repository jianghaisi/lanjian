import assert from 'node:assert/strict'
import test from 'node:test'
import { FieldAssistantService, type FieldAssistantPorts } from '../../../src/main/modules/assistant/application/field-assistant-service'
import { decodeFieldRequest, decodeFieldTask, type FieldRequest, type FieldTask } from '../../../src/contracts/assistant/field-assistant-contracts'
import { validateFieldValue } from '../../../src/main/modules/assistant/domain/assistant-field-target'

const request=():FieldRequest=>({operationId:'operation-1',target:{fieldId:'definition.bookProfile.coreIdea',instanceId:'draft-1',editorSessionId:'session-1',workItemId:'book-a',pageId:'profile',label:'核心设想',revision:1,value:'旧设想'},instruction:'改写核心设想'})
function fixture(){
  let scope:string|null='book-a',context='已保存的定义',output='{"value":"新设想"}',wait:Promise<void>|null=null
  const tasks=new Map<string,FieldTask>(),calls:string[]=[]
  const ports:FieldAssistantPorts={
    async assertScope(expected){if(expected!==scope)throw new Error('scope changed')},async context(){return context},
    async prepareModel(){return {model:'fixture-model',connectionId:'fixture',async complete(instruction){calls.push(instruction);if(wait)await wait;return {content:output}}}},
    async readTasks(expected){return [...tasks.values()].filter(t=>t.target.workItemId===expected).map(t=>structuredClone(t))},async writeTask(task){tasks.set(task.id,structuredClone(task))}
  }
  const service=new FieldAssistantService(ports)
  return {service,tasks,calls,scope(v:string|null){scope=v},context(v:string){context=v},output(v:string){output=v},wait(v:Promise<void>){wait=v}}
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
  await assert.rejects(()=>f.service.acknowledge(permit.token,'applied'))
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
