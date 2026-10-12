import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalModelService } from '../../../src/main/modules/models/application/local-model-service'
import { LocalInstallationStore } from '../../../src/main/modules/models/adapters/local-models/installation-store'
import { localModelCatalog } from '../../../src/main/modules/models/adapters/local-models/catalog'
import type { LocalModelView } from '../../../src/contracts/models/local-model-contracts'
import type { LocalTextRequest } from '../../../src/main/modules/models/domain/model-provider'
import { ExistingModelAssets } from '../../../src/main/modules/models/adapters/local-models/existing-assets'
const manifest=localModelCatalog[0],assets={root:'fixture',modelPath:'model',python:'python',sitePackages:'packages',fingerprint:'verified'}
function fixture(toolWorks=true){
  let found=true;let rows:LocalModelView[]=[];let installed=0
  const service=new LocalModelService([manifest],{discover:async()=>found,prepare:async(_m,signal,progress)=>{signal.throwIfAborted();progress('verifying',85,'verified');return assets}},
    {run:async(_assets,input:LocalTextRequest)=>({content:input.schema?(JSON.stringify(input.schema.oneOf?toolWorks?{kind:'tool',name:'model_probe',arguments:{status:'ok'}}:{kind:'message',content:'no tool'}:{status:'ok'})):'检测成功',finishReason:'stop',promptTokens:10,completionTokens:5,seconds:.01}),stop(){}},
    {read:async()=>rows,save:async v=>{rows=structuredClone(v)}},
    {prepare:async a=>{installed++;return a}})
  return {service,missing:()=>{found=false},installed:()=>installed,rows:()=>rows}
}
test('existing assets use shared preparation and only verified tool-capable models become ready',async()=>{
  const f=fixture();assert.equal((await f.service.list())[0].state,'detected')
  assert.equal((await f.service.inspect(manifest.id)).state,'ready');assert.equal(f.installed(),1)
  assert.deepEqual(f.rows()[0].capabilities,manifest.capabilities)
  f.missing();assert.equal(await f.service.ready(manifest.id),false)
  assert.equal((await fixture(false).service.inspect(manifest.id)).state,'failed')
  await assert.rejects(f.service.complete({model:manifest.id,profile:{connectionId:'local:llama-cpp',model:manifest.id,maxTokens:512,temperature:.5,topP:.9},messages:[]}),/超市完成检测/)
})
test('inspection cancellation is scoped to its owning window',async()=>{
  const f=fixture(),pending=f.service.inspect(manifest.id,7)
  assert.throws(()=>f.service.cancel(manifest.id,8),/其他窗口/)
  assert.equal(f.service.cancel(manifest.id,7),true)
  assert.equal((await pending).state,'cancelled')
  assert.equal((await f.service.inspect(manifest.id,7)).state,'ready')
})
test('machine installation store rejects corrupt records without replacing them',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'lanjian-local-install-')),file=join(directory,'installations.json'),store=new LocalInstallationStore(file)
  assert.deepEqual(await store.read(),[])
  const view=(await fixture().service.inspect(manifest.id));await store.save([view]);assert.deepEqual(await store.read(),[view])
  await writeFile(file,'{bad');await assert.rejects(store.read());assert.equal(await readFile(file,'utf8'),'{bad')
})

test('duplicate installation IDs reject the entire snapshot and preserve exact bytes',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'lanjian-local-duplicate-')),file=join(directory,'installations.json'),store=new LocalInstallationStore(file)
  const ready=await fixture().service.inspect(manifest.id)
  for(const patch of [{},{state:'failed',capabilities:[]},{revision:'older-revision'}]){
    const bytes=Buffer.from(JSON.stringify({version:1,models:[ready,{...ready,...patch}]},null,2)+'\n')
    await writeFile(file,bytes)
    await assert.rejects(store.read(),{code:'STORAGE_ERROR',recoverable:true,message:'模型超市记录无法读取，原文件已保留。'})
    assert.deepEqual(await readFile(file),bytes)
    assert.deepEqual(await readdir(directory),['installations.json'])
  }
})

test('duplicate records block service use without side effects and allow explicit record recovery',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'lanjian-local-duplicate-retry-')),file=join(directory,'installations.json'),store=new LocalInstallationStore(file)
  const ready=await fixture().service.inspect(manifest.id)
  const bytes=Buffer.from(JSON.stringify({version:1,models:[ready,{...ready,state:'failed',capabilities:[]}]}))
  await writeFile(file,bytes)
  const calls={discover:0,info:0,prepare:0,install:0,run:0,save:0}
  const service=new LocalModelService([manifest],{
    discover:async()=>{calls.discover++;return true},
    installationInfo:async()=>{calls.info++;return {canDownload:true,downloadBytes:1,requiredDiskBytes:1}},
    prepare:async()=>{calls.prepare++;return assets},
    install:async()=>{calls.install++;return assets}
  },{run:async()=>{calls.run++;throw Error('must not probe')},stop(){}},
  {read:()=>store.read(),save:async rows=>{calls.save++;await store.save(rows)}})
  for(const operation of [()=>service.list(),()=>service.ready(manifest.id),()=>service.inspect(manifest.id,7),()=>service.install(manifest.id,7)]){
    await assert.rejects(operation(),{code:'STORAGE_ERROR',recoverable:true})
    assert.deepEqual(await readFile(file),bytes)
  }
  assert.deepEqual(calls,{discover:0,info:0,prepare:0,install:0,run:0,save:0})
  // Restore only this test-owned record; production must never silently repair it.
  const restored=Buffer.from(JSON.stringify({version:1,models:[ready]}))
  await writeFile(file,restored)
  assert.equal((await service.list())[0].state,'ready')
  assert.deepEqual(calls,{discover:1,info:1,prepare:0,install:0,run:0,save:0})
  assert.deepEqual(await readFile(file),restored)
})

test('rejected duplicate saves preserve prior records and do not poison subsequent writes',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'lanjian-local-duplicate-save-')),file=join(directory,'installations.json'),store=new LocalInstallationStore(file)
  const ready=await fixture().service.inspect(manifest.id)
  const sibling={...ready,id:'fixture-sibling',name:ready.name}
  await store.save([ready,sibling]);const before=await readFile(file)
  await assert.rejects(store.save([ready,{...ready,state:'failed',capabilities:[]},sibling]),/LOCAL_MODEL_CONTRACT/)
  assert.deepEqual(await readFile(file),before)
  assert.deepEqual(await readdir(directory),['installations.json'])
  const next={...ready,state:'cancelled' as const,capabilities:[],progress:0}
  const rejected=assert.rejects(store.save([next,ready]),/LOCAL_MODEL_CONTRACT/)
  const saved=store.save([next,sibling])
  await Promise.all([rejected,saved])
  assert.deepEqual(await store.read(),[next,sibling])
  assert.deepEqual(await readdir(directory),['installations.json'])
})

test('existing-resource preparation distinguishes truncated files and wrong hashes without overwriting either',async()=>{
  const root=await mkdtemp(join(tmpdir(),'lanjian-local-assets-'))
  await mkdir(join(root,'venv/Lib/site-packages/llama_cpp'),{recursive:true});await mkdir(join(root,'python'))
  await writeFile(join(root,'python/python.exe'),'fixture never executed')
  await writeFile(join(root,'venv/pyvenv.cfg'),'home = '+join(root,'python'))
  await writeFile(join(root,'venv/Lib/site-packages/llama_cpp/llama.py'),'fixture')
  const modelPath=join(root,'fixture.gguf'),bytes=Buffer.from('fixture-weight')
  const tiny={...manifest,files:[{...manifest.files[0],relativePath:'fixture.gguf',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}]}
  const source=new ExistingModelAssets(root),signal=new AbortController().signal
  await writeFile(modelPath,bytes.subarray(0,3));assert.equal(await source.discover(tiny),true)
  await assert.rejects(source.prepare(tiny,signal,()=>{}),/不完整/);assert.equal((await readFile(modelPath)).length,3)
  const wrong=Buffer.alloc(bytes.length,65);await writeFile(modelPath,wrong)
  await assert.rejects(source.prepare(tiny,signal,()=>{}),/校验未通过/);assert.deepEqual(await readFile(modelPath),wrong)
  await writeFile(modelPath,bytes);assert.equal((await source.prepare(tiny,signal,()=>{})).modelPath,await realpath(modelPath))
})

test('scope clear cancels a request still checking assets before it can spawn a late worker',async()=>{
  const ready=await fixture().service.inspect(manifest.id)
  let announce!:()=>void;const started=new Promise<void>(resolve=>{announce=resolve});let runtimeCalls=0
  const service=new LocalModelService([manifest],{discover:async()=>true,prepare:async(_m,signal)=>{announce();await new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('scope cancelled')),{once:true})});return assets}},
    {run:async()=>{runtimeCalls++;throw Error('must not start')},stop(){}},{read:async()=>[ready],save:async()=>{}})
  const result=service.complete({model:manifest.id,profile:{connectionId:'local:llama-cpp',model:manifest.id,maxTokens:512,temperature:.5,topP:.9},messages:[{role:'user',content:'写'}]})
  await started;service.clear();await assert.rejects(result,/scope cancelled/);assert.equal(runtimeCalls,0)
})

test('installation is a background owner-bound operation, stale cancellation cannot stop a new attempt',async()=>{
  let calls=0
  const f=fixture(),source={discover:async()=>false,prepare:async()=>assets,
    installationInfo:async()=>({canDownload:true,downloadBytes:100,requiredDiskBytes:200}),
    install:async(_m:unknown,signal:AbortSignal)=>{calls++;await new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true}));return assets}}
  const service=new LocalModelService([manifest],source,{run:async()=>{throw Error('must not probe')},stop(){}},{read:async()=>[],save:async()=>{}})
  const first=await service.install(manifest.id,7)
  assert.ok(first.operationId)
  assert.equal((await service.install(manifest.id,7)).operationId,first.operationId)
  await assert.rejects(service.install(manifest.id,8),/另一/)
  assert.throws(()=>service.cancel(manifest.id,8,first.operationId),/其他窗口/)
  await new Promise(r=>setTimeout(r,0));assert.equal(calls,1)
  assert.equal(service.cancel(manifest.id,7,first.operationId),true)
  for(let n=0;n<20&&(await service.list())[0].operationId;n++)await new Promise(r=>setTimeout(r,1))
  assert.equal((await service.list())[0].state,'cancelled')
  const second=await service.install(manifest.id,7)
  assert.notEqual(second.operationId,first.operationId)
  assert.equal(service.cancel(manifest.id,7,first.operationId),false)
  service.clearOwner(8);assert.equal((await service.list())[0].operationId,second.operationId)
  await new Promise(r=>setTimeout(r,0));service.clearOwner(7)
  for(let n=0;n<20&&(await service.list())[0].operationId;n++)await new Promise(r=>setTimeout(r,1))
  assert.equal((await service.list())[0].state,'cancelled')
})

test('interrupted install survives restart without network and failed readiness persistence cannot become ready',async()=>{
  const f=fixture(),ready=await f.service.inspect(manifest.id)
  let prepareCalls=0
  const source={discover:async()=>false,prepare:async()=>{prepareCalls++;return assets}}
  const stored={...ready,state:'downloading' as const,operation:'install' as const,operationId:'00000000-0000-0000-0000-000000000001'}
  const service=new LocalModelService([manifest],source,{run:async()=>{throw Error('no inference')},stop(){}},{read:async()=>[stored],save:async()=>{throw Error('no write')}})
  const [view]=await service.list();assert.equal(view.state,'interrupted');assert.equal(view.operationId,undefined);assert.equal(prepareCalls,0)
  const broken=new LocalModelService([manifest],{discover:async()=>true,prepare:async()=>assets},{run:async(_a,input)=>({content:input.schema?(input.schema as {oneOf?:unknown}).oneOf?'{"kind":"tool","name":"model_probe","arguments":{"status":"ok"}}':'{"status":"ok"}':'检测成功',finishReason:'stop',promptTokens:1,completionTokens:1,seconds:0}),stop(){}},
    {read:async()=>[],save:async rows=>{if(rows.some(r=>r.state==='ready'))throw Error('disk failed')}})
  assert.equal((await broken.inspect(manifest.id)).state,'failed')
  assert.equal((await broken.list())[0].state,'failed')
})
