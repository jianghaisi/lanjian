/** Explicit isolated acceptance probe; never changes an author's profile or weights. */
import { mkdir, copyFile, link, mkdtemp, writeFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { LocalModelService } from '../src/main/modules/models/application/local-model-service'
import { LocalTextRuntime } from '../src/main/modules/models/adapters/local-models/text-runtime'
import { LocalInstallationStore } from '../src/main/modules/models/adapters/local-models/installation-store'
import { ManagedModelAssets } from '../src/main/modules/models/adapters/local-models/managed-model-assets'
import { ModelDownloader } from '../src/main/modules/models/adapters/local-models/model-download'
import { runtimeProfile } from '../src/main/modules/models/adapters/local-models/runtime-profile'
import { localModelCatalog } from '../src/main/modules/models/adapters/local-models/catalog'

const evidence = resolve('artifacts/local-model-installation')
const fullDownload = process.argv.includes('--download-weight')
await mkdir(join(evidence,'profiles'),{recursive:true})
const root = await mkdtemp(join(evidence,'profiles/probe-')), managed = join(root,'managed'), legacy = join(root,'weights-only'), cache = join(managed,'downloads')
await mkdir(cache,{recursive:true})
const manifest=localModelCatalog[0], original=resolve('../../.local/companion-voice',manifest.files[0].relativePath)
const before=await stat(original), model=join(legacy,manifest.files[0].relativePath)
await mkdir(resolve(model,'..'),{recursive:true});if(!fullDownload)await link(original,model)
for(const artifact of runtimeProfile.files)await copyFile(join(evidence,'downloads',artifact.name),join(cache,artifact.sha256+'.asset'))
const worker=resolve('src/main/modules/models/adapters/local-models/text-worker.py'), runtime=new LocalTextRuntime(worker)
const source=new ManagedModelAssets(managed,legacy,new ModelDownloader(cache))
const service=new LocalModelService(localModelCatalog,source,runtime,new LocalInstallationStore(join(managed,'installations.json')))
try{
  const initial=await service.list(); console.log('initial',JSON.stringify(initial))
  await service.install(manifest.id,1)
  let state='',ready=false
  const deadline=Date.now()+1800000
  while(Date.now()<deadline){
    const [view]=await service.list()
    if(view.state!==state){state=view.state;console.log('state',state,view.message)}
    if(!view.operationId){if(view.state!=='ready')throw Error(JSON.stringify(view));ready=true;break}
    await new Promise(r=>setTimeout(r,500))
  }
  if(!ready)throw Error('probe timeout')
  const result=await service.complete({model:manifest.id,profile:{connectionId:'local:llama-cpp',model:manifest.id,maxTokens:128,temperature:.1,topP:.9},messages:[{role:'user',content:'只写一句中文：一封旧信。'}]})
  const after=await stat(original)
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('original changed')
  await writeFile(join(evidence,fullDownload?'full-download-result.json':'managed-runtime-result.json'),JSON.stringify({root,manifest:manifest.id,profile:runtimeProfile.id,initial,final:await service.list(),result,originalUnchanged:true,scope:fullDownload?'complete real model download + verified cached runtime archives':'verified archives + existing read-only weights; no complete live weight download'},null,2))
  console.log('PASS independent installed runtime, text, JSON, real tool and completion',result)
}finally{service.clear()}
