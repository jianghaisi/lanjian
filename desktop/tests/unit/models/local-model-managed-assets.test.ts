import test from 'node:test'
import assert from 'node:assert/strict'
import fs, { mkdir, mkdtemp, readFile, rename, writeFile, readdir, symlink, realpath } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { ManagedModelAssets } from '../../../src/main/modules/models/adapters/local-models/managed-model-assets'
import { ModelDownloader } from '../../../src/main/modules/models/adapters/local-models/model-download'
import { localModelCatalog } from '../../../src/main/modules/models/adapters/local-models/catalog'
import { runtimeProfile } from '../../../src/main/modules/models/adapters/local-models/runtime-profile'
import { LocalModelService } from '../../../src/main/modules/models/application/local-model-service'
import type { LocalModelView } from '../../../src/contracts/models/local-model-contracts'
import { AppError } from '../../../src/main/core/errors/app-error'

async function fixture(legacy=false){
  const root=await realpath(await mkdtemp(join(tmpdir(),'lanjian-managed-presence-'))), legacyRoot=join(root,'legacy')
  const weight=Buffer.from('fixture model; never executed'), digest=(data:Buffer)=>createHash('sha256').update(data).digest('hex')
  const manifest={...localModelCatalog[0],files:[{...localModelCatalog[0].files[0],relativePath:'fixture.gguf',bytes:weight.length,sha256:digest(weight)}]}
  await mkdir(join(root,'downloads'));await writeFile(join(root,'downloads',manifest.files[0].sha256+'.asset'),weight)
  const directory=randomUUID(), runtime=join(root,'runtimes',directory)
  const files=[]
  for(const path of [runtimeProfile.python,runtimeProfile.sitePackages+'/llama_cpp/llama.py']){
    const bytes=Buffer.from('fixture '+path), target=join(runtime,path)
    await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes)
    files.push({path,bytes:bytes.length,sha256:digest(bytes)})
  }
  const receiptPath=join(root,'runtime-current.json')
  await writeFile(receiptPath,JSON.stringify({version:1,profile:runtimeProfile.id,directory,files}))
  if(legacy){
    await mkdir(join(legacyRoot,'python'),{recursive:true});await mkdir(join(legacyRoot,'venv/Lib/site-packages/llama_cpp'),{recursive:true})
    await writeFile(join(legacyRoot,'python/python.exe'),'legacy fixture')
    await writeFile(join(legacyRoot,'venv/pyvenv.cfg'),'home = '+join(legacyRoot,'python'))
    await writeFile(join(legacyRoot,'venv/Lib/site-packages/llama_cpp/llama.py'),'legacy fixture')
    await writeFile(join(legacyRoot,'fixture.gguf'),weight)
  }
  let downloads=0, writes=0, probes=0
  const source=new ManagedModelAssets(root,legacyRoot,new ModelDownloader(join(root,'downloads'),async()=>{downloads++;throw Error('listing must not download')}))
  const ready:LocalModelView={id:manifest.id,name:manifest.name,family:manifest.family,description:manifest.description,revision:manifest.revision,bytes:weight.length,quantization:manifest.quantization,license:manifest.license,state:'ready',capabilities:[...manifest.capabilities],contextTokens:manifest.contextTokens,maxOutputTokens:manifest.maxOutputTokens,recommendedOutputTokens:manifest.recommendedOutputTokens,progress:100,message:'ready fixture',canDownload:true}
  const service=new LocalModelService([manifest],source,{run:async()=>{probes++;throw Error('listing must not probe')},stop(){}},{read:async()=>[ready],save:async()=>{writes++}})
  return {root,runtime,receiptPath,source,manifest,service,activity:()=>({downloads,writes,probes})}
}

for(const missing of ['runtime','python','packages','llama'])test(`missing managed ${missing} cannot keep a previous ready model selectable`,async()=>{
  const f=await fixture(), receipt=await readFile(f.receiptPath)
  assert.equal((await f.service.list())[0].state,'ready')
  const target=missing==='runtime'?f.runtime:join(f.runtime,missing==='python'?runtimeProfile.python:missing==='packages'?runtimeProfile.sitePackages:runtimeProfile.sitePackages+'/llama_cpp/llama.py')
  await rename(target,target+'.preserved')
  const [view]=await f.service.list()
  assert.equal(view.state,'not-installed');assert.deepEqual(view.capabilities,[]);assert.equal(await f.service.ready(f.manifest.id),false)
  const runtimeBytes=runtimeProfile.files.reduce((n,file)=>n+file.bytes,0), expanded=runtimeProfile.files.reduce((n,file)=>n+file.expandedBytes,0)
  assert.equal(view.downloadBytes,runtimeBytes);assert.equal(view.requiredDiskBytes,runtimeBytes+expanded+256*1024*1024)
  assert.deepEqual(await readFile(f.receiptPath),receipt);assert.deepEqual(f.activity(),{downloads:0,writes:0,probes:0})
  await rename(target+'.preserved',target)
  assert.equal((await f.service.list())[0].state,'ready');assert.equal((await f.source.installationInfo(f.manifest)).downloadBytes,0)
})

test('managed discovery follows the selected receipt even when complete legacy resources also exist',async()=>{
  const f=await fixture(true), receipt=await readFile(f.receiptPath)
  await rename(f.runtime,f.runtime+'.preserved')
  assert.equal(await f.source.discover(f.manifest),false)
  assert.equal((await f.source.installationInfo(f.manifest)).downloadBytes,runtimeProfile.files.reduce((n,file)=>n+file.bytes,0))
  await assert.rejects(f.source.prepare(f.manifest,new AbortController().signal,()=>{}))
  assert.deepEqual(await readFile(f.receiptPath),receipt);assert.deepEqual(f.activity(),{downloads:0,writes:0,probes:0})
})

for(const mode of ['null','array','bad-json','null-file','traversal','ads','duplicate','missing-python','missing-llama','unknown-version'] as const)test(`invalid runtime receipt ${mode} fails safely before listing, preparation or installation`,async()=>{
  const f=await fixture(true),r=JSON.parse(await readFile(f.receiptPath,'utf8'))
  let invalid:unknown=r
  if(mode==='null')invalid=null
  if(mode==='array')invalid=[]
  if(mode==='null-file')r.files.push(null)
  if(mode==='traversal')r.files[0].path='../escape.exe'
  if(mode==='ads')r.files[0].path='python/python.exe:stream'
  if(mode==='duplicate')r.files.push({...r.files[0],path:r.files[0].path.toUpperCase()})
  if(mode==='missing-python')r.files.shift()
  if(mode==='missing-llama')r.files.pop()
  if(mode==='unknown-version')r.version=2
  const raw=mode==='bad-json'?'{incomplete':JSON.stringify(invalid)
  await writeFile(f.receiptPath,raw)
  const before=await readdir(f.root),signal=new AbortController().signal
  for(const run of [()=>f.source.discover(f.manifest),()=>f.source.installationInfo(f.manifest),()=>f.source.prepare(f.manifest,signal,()=>{}),()=>f.source.install(f.manifest,signal,()=>{})]){
    await assert.rejects(run(),(error:unknown)=>error instanceof AppError&&error.recoverable&&/记录无效.*原记录已保留/.test(error.message))
  }
  assert.equal(await readFile(f.receiptPath,'utf8'),raw);assert.deepEqual(await readdir(f.root),before)
  assert.deepEqual(f.activity(),{downloads:0,writes:0,probes:0})
})

test('a linked runtime is rejected rather than rebuilt or replaced',async()=>{
  const f=await fixture(true),receipt=await readFile(f.receiptPath),original=await readFile(join(f.runtime,runtimeProfile.python))
  assert.equal(dirname(f.runtime),join(f.root,'runtimes'))
  const preserved=f.runtime+'.preserved';await rename(f.runtime,preserved);await symlink(preserved,f.runtime,'junction')
  await assert.rejects(f.source.install(f.manifest,new AbortController().signal,()=>{}),/安装目录包含链接/)
  assert.deepEqual(f.activity(),{downloads:0,writes:0,probes:0});assert.deepEqual(await readFile(f.receiptPath),receipt)
  assert.deepEqual(await readFile(join(preserved,runtimeProfile.python)),original)
})

test('a receipt changed after installation preflight is preserved without starting repair downloads',async()=>{
  const f=await fixture(),invalid='{interrupted external edit'
  await assert.rejects(f.source.install(f.manifest,new AbortController().signal,()=>{writeFileSync(f.receiptPath,invalid)}),/记录无效.*原记录已保留/)
  assert.equal(await readFile(f.receiptPath,'utf8'),invalid);assert.deepEqual(f.activity(),{downloads:0,writes:0,probes:0})
})

for(const code of ['EACCES','EPERM'] as const)test(`runtime ${code} must not trigger replacement downloads`,async t=>{
  const f=await fixture(),receipt=await readFile(f.receiptPath),python=join(f.runtime,runtimeProfile.python),originalStat=fs.stat
  const fault=Object.assign(Error('fixture access failure'),{code})
  t.mock.method(fs,'stat',async(path:Parameters<typeof fs.stat>[0])=>{if(path===python)throw fault;return originalStat(path)})
  syncBuiltinESMExports()
  try{
    await assert.rejects(f.source.install(f.manifest,new AbortController().signal,()=>{}),error=>error===fault)
    assert.deepEqual(f.activity(),{downloads:0,writes:0,probes:0});assert.deepEqual(await readFile(f.receiptPath),receipt)
  }finally{t.mock.restoreAll();syncBuiltinESMExports()}
})

for(const damage of ['missing-runtime','missing-python','size','hash'] as const)test(`explicit installation can still rebuild a runtime with ${damage}`,async()=>{
  const f=await fixture(),receipt=await readFile(f.receiptPath),python=join(f.runtime,runtimeProfile.python)
  let preserved=python
  if(damage==='missing-runtime'){
    assert.equal(dirname(f.runtime),join(f.root,'runtimes'));await rename(f.runtime,f.runtime+'.preserved');preserved=join(f.runtime+'.preserved',runtimeProfile.python)
  }else if(damage==='missing-python'){await rename(python,python+'.preserved');preserved=python+'.preserved'}
  else await writeFile(python,Buffer.alloc(damage==='size'?1:(await readFile(python)).length,65))
  const original=await readFile(preserved)
  await assert.rejects(f.source.install(f.manifest,new AbortController().signal,()=>{}),/listing must not download/)
  assert.equal(f.activity().downloads,1,'only confirmed missing/bad files should reach the download boundary')
  assert.deepEqual(await readFile(f.receiptPath),receipt);assert.deepEqual(await readFile(preserved),original)
})

test('valid historical profile-prefixed runtime directories remain reusable',async()=>{
  const f=await fixture(),r=JSON.parse(await readFile(f.receiptPath,'utf8'))
  assert.equal(dirname(f.runtime),join(f.root,'runtimes'))
  r.directory=runtimeProfile.id+'-'+r.directory
  const historical=join(f.root,'runtimes',r.directory);await rename(f.runtime,historical);await writeFile(f.receiptPath,JSON.stringify(r))
  assert.equal((await f.source.install(f.manifest,new AbortController().signal,()=>{})).root,historical)
  assert.deepEqual(f.activity(),{downloads:0,writes:0,probes:0})
})
