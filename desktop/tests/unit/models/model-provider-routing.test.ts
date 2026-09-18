import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AiClient } from '../../../src/main/modules/models/application/ai-client'
import { ProjectAiService } from '../../../src/main/modules/models/application/project-ai-service'
import type { ProjectService } from '../../../src/main/modules/library/application/project-service'
import type { SettingsStore } from '../../../src/main/platform/settings/settings-store'
import type { LocalTextProvider, TextCompletionInput } from '../../../src/main/modules/models/domain/model-provider'
import { LOCAL_CONNECTION_ID as id, LOCAL_QWEN_ID as model } from '../../../src/contracts/models/local-model-contracts'

const profile = {connectionId:id,model,temperature:.6,topP:.9,maxTokens:2048}
function localProvider() {
  const calls:TextCompletionInput[]=[]
  const local:LocalTextProvider={listModels:async()=>[model],ready:async()=>true,limits:()=>({contextTokens:8192,systemReserveTokens:512,maxOutputTokens:4096,recommendedOutputTokens:2048}),complete:async input=>{calls.push(input);await input.onDelta?.('本地文字','本地文字');return {content:'本地文字'}},toolStep:async()=>({content:'工具结果',toolCalls:[]})}
  return {local,calls}
}

test('native assistant history keeps its roles and frozen local budget across later changes',async t=>{
  const {local,calls}=localProvider(),selected={...profile}
  t.mock.method(globalThis,'fetch',()=>{throw Error('local messages must not use HTTP')})
  const ai=new AiClient({resolve:async()=>({kind:'local',connectionId:id,connectionName:'本地',profile:selected}),resolveConnection:async()=>{throw Error('must not resolve credentials')}},local)
  const prepared=await ai.prepareCompletion('prose')
  selected.maxTokens=4096
  await prepared.completeMessages!([{role:'system',content:'只写新情节'},{role:'assistant',content:'林浩走进雪原。'},{role:'user',content:'继续'}])
  assert.equal(calls[0].profile.maxTokens,2048);assert.equal(calls[0].messages[1].role,'assistant');assert.equal(calls[0].messages[2].content,'继续')
})
test('local routes use no HTTP or remote credential path, including tools and deltas',async t=>{
  const {local,calls}=localProvider()
  t.mock.method(globalThis,'fetch',()=>{throw Error('unexpected HTTP')})
  const ai=new AiClient({resolve:async()=>({kind:'local',connectionId:id,connectionName:'本地',profile}),resolveConnection:async()=>{throw Error('unexpected credential resolver')}},local)
  assert.deepEqual(await ai.listModels({connectionId:id}),{models:[model]})
  assert.deepEqual(await ai.listModels(),{models:[model]})
  for(const task of ['outline','chapterOutline','prose','review'] as const)assert.equal((await ai.complete('编写','旧文','职责',task)).content,'本地文字')
  const deltas:string[]=[]
  await ai.streamComplete('继续','','','prose',undefined,model,s=>{deltas.push(s)},id,512)
  assert.deepEqual(deltas,['本地文字']);assert.equal(calls.at(-1)?.profile.maxTokens,512)
  assert.equal((await (await ai.prepareToolConversation('outline',model,id,1024)).step([],[],new AbortController().signal)).content,'工具结果')
  await assert.rejects(ai.complete('写','','','prose',undefined,model,id,8192),/最多输出/)
  assert.equal(calls.length,5)
})
test('remote preparation resolves once and preserves a frozen credential/profile snapshot',async t=>{
  let resolves=0
  const c={kind:'openai-compatible' as const,connectionId:'primary',connectionName:'API',baseUrl:'https://api.example.test/v1',apiKey:'fixture-only',profile:{...profile,connectionId:'primary',model:'unknown-new-model',maxTokens:777}}
  const ai=new AiClient({resolve:async()=>{resolves++;return c},resolveConnection:async()=>c})
  let payload:Record<string,unknown>={}
  t.mock.method(globalThis,'fetch',async(_url:unknown,init:RequestInit)=>{payload=JSON.parse(String(init.body));assert.equal(new Headers(init.headers).get('Authorization'),'Bearer fixture-only');return new Response(JSON.stringify({choices:[{message:{content:'remote'}}]}),{status:200})})
  const prepared=await ai.prepareCompletion('prose')
  c.apiKey='changed';c.profile.maxTokens=999
  assert.equal((await prepared.complete('写')).content,'remote')
  assert.equal(resolves,1);assert.equal(payload.max_tokens,777);assert.equal(payload.model,'unknown-new-model')
})
test('v3 local settings survive read, save, reopen and missing installation without fallback',async()=>{
  const root=await mkdtemp(join(tmpdir(),'lanjian-local-routing-'));await mkdir(join(root,'.webnovel'))
  const file=join(root,'.webnovel/ai-settings.json')
  const stored={version:3,connections:[],routingMode:'shared',shared:profile,tasks:Object.fromEntries(['outline','chapterOutline','prose','review'].map(t=>[t,profile]))}
  await writeFile(file,JSON.stringify(stored))
  let writes=0,keys=0
  const settings={projectApiKeyConfigured:async()=>{keys++;return false},projectApiKey:async()=>{keys++;throw Error('no key')},removeProjectApiKeys:async()=>{writes++}} as unknown as SettingsStore
  const projects={currentPath:async()=>root} as ProjectService
  const local={...localProvider().local,ready:async()=>false}
  const service=new ProjectAiService(projects,settings,undefined,local)
  const before=await readFile(file,'utf8')
  assert.equal((await service.get()).modelConfigured,false)
  assert.equal((await service.resolve('prose')).kind,'local')
  assert.equal(await readFile(file,'utf8'),before);assert.equal(keys,0);assert.equal(writes,0)
  const saved=await service.update({connections:[],shared:{maxTokens:1024}})
  assert.equal(saved.shared.maxTokens,1024);assert.equal(saved.connections.length,1);assert.equal(saved.connections[0].kind,'local')
  assert.equal((await new ProjectAiService(projects,settings,undefined,local).resolve('review')).profile.maxTokens,1024)
  const disk=JSON.parse(await readFile(file,'utf8'));assert.deepEqual(disk.connections,[])
  await writeFile(file,'{broken');await assert.rejects(service.get(),/原文件已保留/);assert.equal(await readFile(file,'utf8'),'{broken')
  await writeFile(file,JSON.stringify({...stored,version:99}));await assert.rejects(service.get(),/版本不受支持/)
})

test('an explicit remote catalog/test remains usable while the default model is local',async t=>{
  let defaultReads=0
  const c={kind:'openai-compatible' as const,connectionId:'remote',connectionName:'remote',baseUrl:'https://api.example.test/v1',apiKey:'fixture-key'}
  const ai=new AiClient({resolve:async()=>{defaultReads++;throw Error('unused default')},resolveConnection:async()=>c})
  t.mock.method(globalThis,'fetch',async(url:string,init:RequestInit)=>{
    assert.equal(new Headers(init.headers).get('Authorization'),'Bearer fixture-key')
    return new Response(JSON.stringify(url.endsWith('/models')?{data:[{id:'remote-model'}]}:{choices:[{message:{content:'正常'}}]}))
  })
  assert.deepEqual(await ai.listModels({connectionId:'remote'}),{models:['remote-model']})
  assert.equal((await ai.testConnection({connectionId:'remote',model:'remote-model'})).success,true)
  assert.equal(defaultReads,0)
})

test('a prepared local writing profile stays local and keeps its budget after defaults change',async()=>{
  const {local,calls}=localProvider()
  const ai=new AiClient({resolve:async()=>{throw Error('changed to cloud')},resolveConnection:async()=>{throw Error('cloud key')}},local)
  const chosen={...profile,maxTokens:512,temperature:.2}
  const frozen=ai.withLocalProfile(chosen);chosen.maxTokens=8192;chosen.temperature=1.5
  await frozen.streamComplete('写','','','prose')
  assert.equal(calls[0].profile.maxTokens,512);assert.equal(calls[0].profile.temperature,.2)
})
