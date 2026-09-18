import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
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
  await assert.rejects(f.service.complete({model:manifest.id,profile:{connectionId:'local:llama-cpp',model:manifest.id,maxTokens:512,temperature:.5,topP:.9},messages:[]}),/商店完成检测/)
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
