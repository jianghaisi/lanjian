import { createBuiltinRegistry } from '../../../src/main/modules/writing-plugins/adapters/builtin'
import { fieldCapabilities } from '../../../src/main/modules/writing-plugins/adapters/builtin/fields'
import { pluginLimits } from '@lanjian/writing-plugin-contracts'
import { objectSchema, textSchema } from '@lanjian/writing-plugin-contracts'
import { modelToolName } from '../../../src/main/modules/writing-plugins/application/registry'
import assert from 'node:assert/strict'
import test from 'node:test'
import { AssistantConversationService, type AssistantConversationPorts } from '../../../src/main/modules/assistant/application/assistant-conversation-service'
import { decodeAssistantConversationRequest, decodeAssistantConversationResult, decodeAssistantConversationProgress, type AssistantConversationRequest, type AiToolStep } from '../../../src/contracts/assistant/assistant-conversation-contracts'
import { assistantWorkspaces } from '../../../src/contracts/assistant/assistant-workspace-contracts'
import { targetForLeaf } from '../../../src/renderer/features/library/services/workspace-navigation'
import type { FieldRequest } from '../../../src/contracts/assistant/field-assistant-contracts'
const request=():AssistantConversationRequest=>({operationId:'op-1',workItemId:'book-a',page:'profile',message:'把核心设想改成旧物能说话',chapterId:null,selectedCharacters:0,history:[],targets:[{fieldId:'definition.bookProfile.coreIdea',instanceId:'draft-1',editorSessionId:'session-1',workItemId:'book-a',pageId:'profile',label:'核心设想',revision:1,value:'原始设想'}]})
const call=(name:string,args:unknown={}):AiToolStep=>({content:'',toolCalls:[{id:'call-'+name,type:'function',function:{name,arguments:JSON.stringify(args)}}]})
function fixture(replies:AiToolStep[]){
  const started:FieldRequest[]=[],cancelled:string[]=[],seen:unknown[]=[]
  let scope:string|null='book-a'
  const ports:AssistantConversationPorts={async assertScope(expected){if(expected!==scope)throw new Error('scope conflict')},async context(){return '原始背景'},async prepare(){return {async step(messages,tools){seen.push(structuredClone({messages,tools}));return replies.shift()!}}},async startField(input){started.push(input);return {id:input.operationId,target:input.target,status:'running',createdAt:'2026-09-11',updatedAt:'2026-09-11'}},async cancelField(task){cancelled.push(task.id)}}
  return {ports,service:new AssistantConversationService(ports,input=>createBuiltinRegistry(ports,input),new Set(fieldCapabilities)),started,cancelled,seen,scope(value:string|null){scope=value}}
}
test('conversation invokes list/read/edit on the exact draft without a chapter',async()=>{
  const f=fixture([call('list_editable_fields'),call('read_field',{targetId:'draft-1'}),call('edit_field',{targetId:'draft-1',instruction:'旧物可以说话'})])
  const result=await f.service.run(decodeAssistantConversationRequest(request()))
  assert.equal(result.kind,'field');assert.equal(f.started.length,1);assert.equal(f.started[0].target.value,'原始设想');assert.equal(f.started[0].instruction,'旧物可以说话');assert.equal(result.tools.length,3)
  assert.match(JSON.stringify(f.seen[2]),/原始背景/);assert.doesNotMatch(JSON.stringify(f.seen[0]),/原始设想/)
})
test('help and ambiguity use dialogue without creating a task',async()=>{
  for(const text of ['你好，请告诉我你的想法。','你想修改沈砚还是林雨的人物名称？']){const f=fixture([{content:text,toolCalls:[]}]);assert.equal((await f.service.run(request())).message,text);assert.equal(f.started.length,0)}
})
test('unread edits get tool feedback; unexposed actions and targets fail',async()=>{
  const f=fixture([call('edit_field',{targetId:'draft-1',instruction:'修改'}),{content:'请说明设想。',toolCalls:[]}]);await f.service.run(request());assert.equal(f.started.length,0);assert.match(JSON.stringify(f.seen[1]),/请先调用/)
  for(const reply of [call('write_file',{path:'book.json'}),call('read_field',{targetId:'invented'}),call('edit_field',{targetId:'draft-1',instruction:'改',save:true})])await assert.rejects(()=>fixture([reply]).service.run(request()))
})
test('prose tools are book-wide and locate chapters when none is selected',async()=>{
  const f=fixture([call('manuscript_assistant',{instruction:'润色所选段落'})]);const r=request();r.chapterId=1;r.page='chapters';r.selectedCharacters=20
  assert.equal((await f.service.run(r)).kind,'prose');assert.equal(f.started.length,0)
  const reveal=await fixture([call('manuscript_assistant',{instruction:'润色所选段落'})]).service.run({...r,page:'world'});assert.equal(reveal.kind,'navigate');assert.equal(reveal.workspaceId,'chapters')
  const locate=await fixture([call('manuscript_assistant',{instruction:'续写'})]).service.run(request());assert.equal(locate.kind,'navigate');assert.equal(locate.workspaceId,'chapters')
  const changed=fixture([]);changed.scope('book-b');await assert.rejects(()=>changed.service.run(request()));assert.equal(changed.seen.length,0)
})

test('book tools can locate another workspace without granting arbitrary navigation',async()=>{
  const f=fixture([call('open_workspace',{workspaceId:'world'})])
  const result=decodeAssistantConversationResult(await f.service.run(request()))
  assert.equal(result.kind,'navigate');assert.equal(result.workspaceId,'world');assert.equal(f.started.length,0)
  for(const destination of ['settings','file:///private','other-book'])await assert.rejects(()=>fixture([call('open_workspace',{workspaceId:destination})]).service.run(request()))
  assert.throws(()=>decodeAssistantConversationResult({kind:'navigate',message:'x',tools:[],workspaceId:'invented'}))
  assert.throws(()=>decodeAssistantConversationResult({kind:'navigate',message:'x',tools:[]}))
  for(const item of assistantWorkspaces)assert.ok(targetForLeaf(item.id),'Assistant destination must resolve through the real navigation tree: '+item.id)
})

test('field discovery locates an unloaded definition instead of substituting the visible premise',async()=>{
  const f=fixture([call('list_editable_fields'),call('open_workspace',{workspaceId:'profile'})])
  const result=await f.service.run({...request(),page:'world',message:'请把作品定义里的计划卷数改为2，其他内容保持原样。'})
  assert.equal(f.seen.length,1,'The real lookup tool locates the unique field without another model round')
  assert.deepEqual(result.tools,['查找计划卷数'])
  assert.equal(result.kind,'navigate');assert.equal(result.workspaceId,'profile');assert.equal(f.started.length,0)
})

test('reading a persistent cross-page field reveals its workspace before editing',async()=>{
  const f=fixture([call('read_field',{targetId:'draft-1'})])
  const result=await f.service.run({...request(),page:'world'})
  assert.equal(result.kind,'navigate');assert.equal(result.workspaceId,'profile');assert.equal(f.started.length,0)
  assert.deepEqual(result.tools,['定位核心设想'])
})

test('independent prose samples execute actual generation without a field or chapter',async()=>{
  const f=fixture([call('write_sample',{instruction:'创作1000字测试小说'})]);let drafted=false
  f.ports.draftSample=async(input,instruction,signal)=>{drafted=true;assert.equal(input.chapterId,null);assert.match(instruction,/1000/);assert.equal(signal.aborted,false);return '雨落在老街的石板上。'}
  const result=await f.service.run({...request(),message:'帮我写一个1000字正文的测试小说，我就测试本地模型用的'})
  assert.equal(drafted,true);assert.equal(f.started.length,0);assert.match(result.message,/未写入正文/);assert.match(result.message,/雨落/)
})

test('cancelled samples and samples from a switched book cannot publish late output',async()=>{
  for(const change of ['cancel','switch']){
    const f=fixture([call('write_sample',{instruction:'试写'})]);let entered!:()=>void,release!:()=>void
    const ready=new Promise<void>(r=>entered=r),pending=new Promise<void>(r=>release=r)
    f.ports.draftSample=async()=>{entered();await pending;return '迟到样稿'}
    const running=f.service.run(request());await ready
    if(change==='cancel')await f.service.cancel('op-1');else f.scope('book-b')
    release();await assert.rejects(()=>running);assert.equal(f.started.length,0)
  }
})
test('cancellation during task creation also cancels the field handoff',async()=>{
  const f=fixture([call('read_field',{targetId:'draft-1'}),call('edit_field',{targetId:'draft-1',instruction:'修改'})]),original=f.ports.startField
  let release!:()=>void,entered!:()=>void
  const ready=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r)
  f.ports.startField=async input=>{entered();await gate;return original(input)}
  const run=f.service.run(request());await ready;await f.service.cancel('op-1');release();await assert.rejects(()=>run);assert.deepEqual(f.cancelled,['op-1'])
})
test('conversation decoder rejects cross-book targets, extra keys and oversized history',()=>{
  const r=request();for(const value of [{...r,path:'x'},{...r,targets:[{...r.targets[0],workItemId:'book-b'}]},{...r,history:Array(13).fill({role:'user',content:'x'})}])assert.throws(()=>decodeAssistantConversationRequest(value))
})

test('loop progress is scoped, bounded, and removed after completion',async()=>{
  const f=fixture([]);let entered!:()=>void,release!:()=>void
  const ready=new Promise<void>(r=>entered=r),pending=new Promise<void>(r=>release=r)
  f.ports.prepare=async()=>({async step(){entered();await pending;return {content:'讨论回答',toolCalls:[]}}})
  const running=f.service.run(request());await ready
  const progress=decodeAssistantConversationProgress(await f.service.progress('op-1'))
  assert.ok(progress);assert.match(progress.message,/下一步/)
  f.scope('book-b');await assert.rejects(()=>f.service.progress('op-1'));f.scope('book-a')
  release();await running;assert.equal(await f.service.progress('op-1'),null)
  assert.throws(()=>decodeAssistantConversationProgress({operationId:'op',step:1,message:'x',prompt:'private'}))
  assert.throws(()=>decodeAssistantConversationProgress({operationId:'op',step:101,message:'x'}))
})

test('an exhausted tool loop cannot be presented as task completion',async()=>{
  const f=fixture(Array.from({length:pluginLimits.modelSteps},()=>call('list_editable_fields')))
  await assert.rejects(()=>f.service.run(request()),/尚未完成目标/)
})

test('a newly registered plugin is discovered and invoked without a conversation name branch',async()=>{
  const name=modelToolName('example.writing','new_tool')
  const f=fixture([call('discover_tools',{query:'示例扩展'}),call(name,{}),{content:'扩展结果已读取。',toolCalls:[]}])
  const service=new AssistantConversationService(f.ports,input=>{
    const registry=createBuiltinRegistry(f.ports,input)
    registry.register({pluginId:'example.writing',id:'new_tool',version:'1.0.0',description:'示例扩展',effect:'derive',capabilities:['fields.read'],inputSchema:objectSchema({}),outputSchema:objectSchema({text:textSchema(100)}),isAvailable:()=>true,execute:async()=>({kind:'completed',value:{text:'新工具生成的写作建议'},evidence:[]})})
    return registry
  },new Set(fieldCapabilities))
  assert.equal((await service.run(request())).message,'扩展结果已读取。')
  assert.match(JSON.stringify(f.seen[2]),/新工具生成的写作建议/)
})
