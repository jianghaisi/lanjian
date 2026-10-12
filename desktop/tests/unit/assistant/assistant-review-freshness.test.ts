import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer, nextTick, reactive } from 'vue'
import { useFieldAssistant } from '../../../src/renderer/features/assistant/composables/use-field-assistant'
import { registerAssistantField, updateFieldScope } from '../../../src/renderer/features/assistant/services/assistant-field-registry'
import type { FieldAssistantApi, FieldContext, FieldRequest } from '../../../src/contracts/assistant/field-assistant-contracts'
import type { AssistantConversationRequest } from '../../../src/contracts/assistant/assistant-conversation-contracts'
import type { AssistantRunView } from '../../../src/contracts/assistant/assistant-run-contracts'

function deferred<T>() { let resolve!: (value:T)=>void, reject!: (error:Error)=>void; const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject} }
let sequence=0
async function fixture(runs=false){
  const book=`review-${++sequence}`,state=reactive({page:'profile',text:'原设想',prose:'原正文',selection:0})
  updateFieldScope(book,'profile','作品定义')
  const field=registerAssistantField({id:'definition.bookProfile.coreIdea',read:()=>state.text,write:value=>{state.text=String(value)},identity:()=>state})
  const requests:FieldRequest[]=[],sent:AssistantConversationRequest[]=[]
  const context=(input:FieldRequest):FieldContext=>({target:input.target,context:`背景：${input.instruction}`,fingerprint:'fixture',model:'fixture',connectionId:'fixture'})
  let prepare=(input:FieldRequest)=>Promise.resolve(context(input))
  const api={recent:async()=>[],preview:(input:FieldRequest)=>{requests.push(input);return prepare(input)},conversation:async(input:AssistantConversationRequest)=>{sent.push(input);return {kind:'message',message:'回复',tools:[]}},...(runs?{runs:{recent:async()=>[],start:async(input:AssistantConversationRequest):Promise<AssistantRunView>=>{sent.push(input);return {id:'review-run',operationId:input.operationId,workItemId:book,bookTitle:'示例',page:state.page,goal:input.message,status:'completed',revision:1,step:1,message:'完成',tools:[],createdAt:'',updatedAt:'',needsResume:false,result:{kind:'message',message:'回复',tools:[]}}}}}:{})} as unknown as FieldAssistantApi
  let assistant!:ReturnType<typeof useFieldAssistant>
  const renderer=createRenderer({createComment:()=>({}),insert(){},remove(){},parentNode:()=>null,nextSibling:()=>null} as any)
  const app=renderer.createApp({setup(){assistant=useFieldAssistant(api,{page:()=>state.page,chapterId:()=>1,selectedCharacters:()=>state.selection,proseSnapshot:()=>state.prose,requiresPreview:()=>true,async prose(){}});return()=>null}})
  app.mount({});await assistant.memory.ready();await nextTick()
  assistant.instruction.value='要求A'
  return {assistant,state,book,requests,sent,context,prepare:(fn:typeof prepare)=>{prepare=fn},close:()=>{app.unmount();field.dispose()}}
}

test('reverse preview completion cannot replace the latest explicit review',async t=>{
  const f=await fixture();t.after(f.close);const first=deferred<FieldContext>(),second=deferred<FieldContext>()
  f.prepare(()=>f.requests.length===1?first.promise:second.promise)
  const a=f.assistant.previewContext();f.assistant.instruction.value='要求B';const b=f.assistant.previewContext()
  second.resolve(f.context(f.requests[1]!));await b;const latest=f.assistant.reviewText.value
  first.resolve(f.context(f.requests[0]!));await a
  assert.equal(f.assistant.reviewText.value,latest);assert.equal(JSON.parse(latest).message,'要求B')
})

test('superseded preview error cannot replace a later successful review',async t=>{
  const f=await fixture();t.after(f.close);const old=deferred<FieldContext>();f.prepare(()=>old.promise)
  const a=f.assistant.previewContext();f.assistant.instruction.value='新要求';f.prepare(input=>Promise.resolve(f.context(input)));await f.assistant.previewContext()
  old.reject(new Error('旧请求失败'));await a
  assert.equal(f.assistant.error.value,'');assert.equal(JSON.parse(f.assistant.reviewText.value).message,'新要求')
})

test('two previews of the same input still publish only the newer invocation',async t=>{
  const f=await fixture();t.after(f.close);const first=deferred<FieldContext>(),second=deferred<FieldContext>()
  f.prepare(()=>f.requests.length===1?first.promise:second.promise)
  const a=f.assistant.previewContext(),b=f.assistant.previewContext()
  second.resolve({...f.context(f.requests[1]!),context:'较新背景'});await b
  first.resolve({...f.context(f.requests[0]!),context:'较旧背景'});await a
  assert.deepEqual(JSON.parse(f.assistant.reviewText.value).backgrounds,['较新背景'])
})

test('current preview failure retains the previous snapshot and supports explicit retry',async t=>{
  const f=await fixture();t.after(f.close);await f.assistant.previewContext();const original=f.assistant.reviewText.value
  f.assistant.instruction.value='修改后的要求';f.prepare(async()=>{throw new Error('本次核对暂时失败')});await f.assistant.previewContext()
  assert.equal(f.assistant.error.value,'本次核对暂时失败');assert.equal(f.assistant.reviewText.value,original);assert.equal(f.assistant.reviewCurrent.value,false);assert.equal(f.assistant.reviewPreparing.value,false)
  f.prepare(input=>Promise.resolve(f.context(input)));await f.assistant.previewContext()
  assert.equal(f.assistant.error.value,'');assert.equal(f.assistant.reviewCurrent.value,true);assert.equal(f.sent.length,0)
})

for(const change of ['draft','field','page','model','selection','prose','history'] as const)test(`review becomes stale when ${change} changes, preserving the complete snapshot`,async t=>{
  const f=await fixture();t.after(f.close);await f.assistant.previewContext();const original=f.assistant.reviewText.value
  assert.equal(f.assistant.reviewCurrent.value,true)
  if(change==='draft')f.assistant.instruction.value='新的要求'
  if(change==='field')f.state.text='作者新资料'
  if(change==='page'){f.state.page='world';updateFieldScope(f.book,'world','世界设定')}
  if(change==='model')f.assistant.model.value='另一模型'
  if(change==='selection')f.state.selection=3
  if(change==='prose')f.state.prose='新正文'
  if(change==='history')f.assistant.turns.value.push({role:'user',content:'另一轮要求'})
  assert.equal(f.assistant.reviewCurrent.value,false);assert.equal(f.assistant.reviewText.value,original)
  await f.assistant.previewContext();assert.equal(f.assistant.reviewCurrent.value,true);assert.equal(f.sent.length,0)
})

test('typing while preview waits cancels preparing state and rejects its late result',async t=>{
  const f=await fixture();t.after(f.close);const gate=deferred<FieldContext>();f.prepare(()=>gate.promise)
  const pending=f.assistant.previewContext();assert.equal(f.assistant.reviewPreparing.value,true)
  f.assistant.instruction.value='等待时继续输入'
  assert.equal(f.assistant.reviewPreparing.value,false)
  gate.resolve(f.context(f.requests[0]!));await pending
  assert.equal(f.assistant.reviewText.value,'');assert.equal(f.assistant.instruction.value,'等待时继续输入')
})

for(const leave of ['book','unmount'] as const)test(`late preview failure after ${leave} does not publish state`,async t=>{
  const f=await fixture();if(leave==='book')t.after(f.close);const gate=deferred<FieldContext>();f.prepare(()=>gate.promise)
  const pending=f.assistant.previewContext()
  if(leave==='book'){updateFieldScope('other-review-book','profile','作品定义');await nextTick();await f.assistant.memory.ready();f.assistant.instruction.value='另一部作品'}else f.close()
  gate.reject(new Error('旧核对失败'));await pending
  assert.equal(f.assistant.reviewText.value,'');assert.equal(f.assistant.error.value,'');assert.equal(f.assistant.reviewPreparing.value,false)
})

test('an explicitly prepared current run review sends once without requiring a second preview',async t=>{
  const f=await fixture(true);t.after(f.close)
  await f.assistant.previewContext();assert.equal(f.requests.length,1);assert.equal(f.assistant.reviewCurrent.value,true)
  await f.assistant.send();assert.equal(f.requests.length,1);assert.equal(f.sent.length,1);assert.equal(f.sent[0]?.message,'要求A');assert.ok(f.sent[0]?.editorFingerprint)
})

test('changed input requires a new preview before the normal confirmation sends',async t=>{
  const f=await fixture(true);t.after(f.close);await f.assistant.previewContext();f.assistant.instruction.value='要求B'
  await f.assistant.send();assert.equal(f.sent.length,0);assert.equal(JSON.parse(f.assistant.reviewText.value).message,'要求B')
  await f.assistant.send();assert.equal(f.sent.length,1);assert.equal(f.sent[0]?.message,'要求B')
})
