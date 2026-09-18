import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { AiClient } from '../../../src/main/modules/models/application/ai-client'
import type { AiFunctionTool, AiToolMessage } from '../../../src/contracts/assistant/assistant-conversation-contracts'
const tool:AiFunctionTool={type:'function',function:{name:'list_editable_fields',description:'查看字段',parameters:{type:'object',properties:{},required:[],additionalProperties:false}}}
test('real HTTP carries tools/tool_calls and tool results with a frozen model route',async()=>{
  const bodies:any[]=[],server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);bodies.push(input);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:bodies.length===1?{content:null,tool_calls:[{id:'call-1',type:'function',function:{name:'list_editable_fields',arguments:'{}'}}]}:{content:'可以帮你完善核心设想。'}}]}))})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as {port:number}).port
  const config={kind:'openai-compatible' as const,connectionId:'fixture',connectionName:'fixture',baseUrl:`http://127.0.0.1:${port}`,apiKey:'isolated-key',profile:{connectionId:'fixture',model:'fixture-model',temperature:.6,topP:1,maxTokens:4096}}
  try{
    const client=new AiClient({async resolve(){return config},async resolveConnection(){return config}}),prepared=await client.prepareToolConversation('outline');config.profile.model='changed-after-prepare'
    const messages:AiToolMessage[]=[{role:'user',content:'修改核心设想'}],signal=new AbortController().signal
    const first=await prepared.step(messages,[tool],signal);assert.equal(first.toolCalls[0].function.name,'list_editable_fields')
    messages.push({role:'assistant',content:null,tool_calls:first.toolCalls},{role:'tool',tool_call_id:'call-1',content:'[]'})
    assert.match((await prepared.step(messages,[tool],signal)).content,/核心设想/)
    assert.equal(bodies[0].tool_choice,'auto');assert.equal(bodies[0].parallel_tool_calls,false);assert.deepEqual(bodies[0].tools,[tool]);assert.equal(bodies[1].model,'fixture-model');assert.equal(bodies[1].messages[2].tool_call_id,'call-1')
    const plain=await client.prepareCompletion('prose');config.profile.model='another-later-change'
    await plain.completeMessages!([{role:'system',content:'写后续'},{role:'assistant',content:'人物已离开邮局。'},{role:'user',content:'继续'}])
    assert.equal(bodies[2].model,'changed-after-prepare');assert.equal(bodies[2].messages[1].role,'assistant');assert.equal(bodies[2].tools,undefined)
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
})
