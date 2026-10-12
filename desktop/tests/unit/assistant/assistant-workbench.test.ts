import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope, nextTick, ref } from 'vue'
import { assistantContext } from '../../../src/renderer/features/assistant/services/assistant-context'
import { emptyAssistantMemory, validateAssistantMemory, type AssistantMemory } from '../../../src/renderer/features/assistant/services/assistant-memory'
import { useAssistantMemory } from '../../../src/renderer/features/assistant/composables/use-assistant-memory'
import { decodeAssistantConversationRequest } from '../../../src/contracts/assistant/assistant-conversation-contracts'
import { consumeToolStream } from '../../../src/main/modules/models/adapters/openai-tool-stream'

test('context preserves a long answer tail, declares excerpts, and stays within the actual IPC budget',()=>{
  const turns=Array.from({length:20},(_,i)=>({role:(i%2?'assistant':'user') as 'assistant'|'user',content:`开头${i}`+'\n"字'.repeat(15000)+`末尾${i}`}))
  const result=assistantContext(turns)
  assert.ok(result.omitted>0);assert.ok(result.excerpted>0);assert.ok(result.history.at(-1)!.content.endsWith('末尾19'))
  assert.ok(result.history.every(t=>t.content.length<=12000));assert.ok(JSON.stringify(result.history).length<=60000)
  assert.doesNotThrow(()=>decodeAssistantConversationRequest({operationId:'budget',workItemId:'book',page:'profile',message:'本次完整要求',targets:[],chapterId:null,selectedCharacters:0,history:result.history}))
  assert.deepEqual(assistantContext([{role:'assistant',content:'完整'}, {role:'assistant',content:'半截',incomplete:true}]).history,[{role:'assistant',content:'完整'}])
})
test('full short history is kept and oversized memory refuses truncation',()=>{
  const turns=[{role:'user' as const,content:'保留这句话'}];assert.deepEqual(assistantContext(turns),{history:turns,included:1,omitted:0,excerpted:0})
  assert.throws(()=>validateAssistantMemory({...emptyAssistantMemory(),turns:[{role:'assistant',content:'字'.repeat(50001)}]}),/未覆盖/)
  assert.equal(validateAssistantMemory({...emptyAssistantMemory(),draft:'未发送草稿'}).draft,'未发送草稿')
})
test('book switches serialize writes; failure retains draft, retry saves it, late reads cannot overwrite another book',async()=>{
  const scope=effectScope(),draft=ref(''),turns=ref<AssistantMemory['turns']>([]),records=new Map<string,AssistantMemory>();let fail=false, release:(()=>void)|undefined
  const memory=scope.run(()=>useAssistantMemory(draft,turns,{async read(book){if(book==='slow')await new Promise<void>(done=>release=done);return records.get(book)??emptyAssistantMemory()},async write(book,key,value){if(fail)throw Error('disk');records.set(book,{...(records.get(book)??emptyAssistantMemory()),[key]:structuredClone(value)})}}))!
  const reset=()=>{draft.value='';turns.value=[]},settle=async()=>{await nextTick();await new Promise(r=>setTimeout(r,0))}
  try{
    await memory.open('A',reset);draft.value='作品 A 草稿';turns.value.push({role:'user',content:'A 要求'});await settle()
    await memory.open('B',reset);assert.equal(draft.value,'');draft.value='作品 B 草稿';await settle()
    await memory.open('A',reset);assert.equal(draft.value,'作品 A 草稿');assert.equal(turns.value[0]?.content,'A 要求')
    fail=true;draft.value='保存失败也保留';await settle();assert.match(memory.saveError.value,/未完成/);assert.equal(draft.value,'保存失败也保留')
    await memory.open('B',reset);await memory.open('A',reset);assert.match(memory.saveError.value,/保存未完成/);assert.equal(draft.value,'保存失败也保留')
    fail=false;memory.retry();await settle();assert.equal(records.get('A')?.draft,'保存失败也保留');assert.equal(memory.saveError.value,'')
    const slow=memory.open('slow',reset);await settle();await memory.open('B',reset);release!();await slow;assert.equal(draft.value,'作品 B 草稿')
  }finally{scope.stop()}
})
test('a successful draft write cannot hide an unsaved oversized conversation',async()=>{
  const scope=effectScope(),draft=ref(''),turns=ref<AssistantMemory['turns']>([])
  const memory=scope.run(()=>useAssistantMemory(draft,turns,{async read(){return emptyAssistantMemory()},async write(){}}))!
  try{await memory.open('A',()=>{});turns.value=[{role:'assistant',content:'字'.repeat(50001)}];await nextTick();draft.value='另一个字段仍可保存';await new Promise(r=>setTimeout(r,0));assert.match(memory.saveError.value,/未覆盖/)}finally{scope.stop()}
})
test('unreadable records are never overwritten by a subsequent book switch',async()=>{
  const scope=effectScope(),draft=ref(''),turns=ref<AssistantMemory['turns']>([]);let writes=0
  const memory=scope.run(()=>useAssistantMemory(draft,turns,{async read(){throw Error('corrupt')},async write(){writes++}}))!
  try{const reset=()=>{draft.value='';turns.value=[]};await memory.open('A',reset);draft.value='待备份';await memory.open('B',reset);await memory.open('A',reset);memory.retry();await nextTick();assert.equal(draft.value,'待备份');assert.equal(writes,0);assert.match(memory.saveError.value,/未覆盖/)}finally{scope.stop()}
})
const frame=(delta:unknown,finish_reason?:string)=>`data: ${JSON.stringify({choices:[{delta,finish_reason}]})}\r\n\r\n`
function response(text:string){const bytes=new TextEncoder().encode(text);return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=7)controller.enqueue(bytes.slice(i,i+7));controller.close()}}),{headers:{'Content-Type':'text/event-stream'}})}
test('SSE handles split UTF8 and arguments without exposing unfinished tools',async()=>{
  const seen:string[]=[]
  const result=await consumeToolStream(response(frame({content:'正在查看。'})+frame({tool_calls:[{index:0,id:'c1',type:'function',function:{name:'read_field',arguments:'{"id":'}}]})+frame({tool_calls:[{index:0,function:{arguments:'"雨夜"}'}}]},'tool_calls')+'data: [DONE]\n\n'),new AbortController().signal,text=>seen.push(text))
  assert.deepEqual(seen,['正在查看。']);assert.deepEqual(JSON.parse(result.toolCalls[0]!.function.arguments),{id:'雨夜'})
  assert.equal(result.toolCalls[0]!.function.name,'read_field')
})
test('SSE rejects truncation, malformed JSON, output budget termination and oversized text',async()=>{
  for(const raw of [frame({content:'半截'}),frame({content:'半截'})+'data: [DONE]\n\n','data: nope\n\n',frame({content:'半截'},'length'),frame({content:'字'.repeat(50001)},'stop')])await assert.rejects(consumeToolStream(response(raw),new AbortController().signal,()=>{}))
})
test('SSE publishes progressively and cancellation never becomes a completed reply',async()=>{
  const controller=new AbortController(),seen:string[]=[]
  await assert.rejects(consumeToolStream(response(frame({content:'第一段'})+frame({content:'第二段'},'stop')),controller.signal,text=>{seen.push(text);controller.abort()}))
  assert.deepEqual(seen,['第一段'])
  const complete=await consumeToolStream(response(frame({content:'一'})+frame({content:'二'},'stop')+'data: [DONE]\n\n'),new AbortController().signal,text=>seen.push(text))
  assert.equal(complete.content,'一二');assert.deepEqual(complete.toolCalls,[])
})
