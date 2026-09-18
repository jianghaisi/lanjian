import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ExistingModelAssets } from '../src/main/modules/models/adapters/local-models/existing-assets'
import { localModelCatalog } from '../src/main/modules/models/adapters/local-models/catalog'
import { LocalTextRuntime } from '../src/main/modules/models/adapters/local-models/text-runtime'
import type { AppError } from '../src/main/core/errors/app-error'
const output=resolve('artifacts/local-model-store/real-boundaries.json')
await mkdir(resolve('artifacts/local-model-store'),{recursive:true})
const runtime=new LocalTextRuntime(resolve('out/main/local-models/text-worker.py'))
const assets=await new ExistingModelAssets(resolve('../../.local/companion-voice')).prepare(localModelCatalog[0],new AbortController().signal,()=>{})
const request={action:'complete' as const,messages:[{role:'user' as const,content:'请写2000字的雨夜旧邮局故事，详细描述人物的动作、环境、对话和感受。'}],maxTokens:128,temperature:.7,topP:.9}
const evidence:Record<string,unknown>={}
try{
  const tokenized=await runtime.run(assets,{...request,action:'tokenize',maxTokens:2048,messages:[{role:'user',content:'旧邮局门口的雨一直下着。'.repeat(250)}]})
  evidence.longInput={...tokenized,characters:3000}
  await assert.rejects(runtime.run(assets,{...request,maxTokens:2048,messages:[{role:'user',content:'旧邮局门口的雨一直下着。'.repeat(1000)}]}),error=>{
    evidence.contextError=(error as AppError).details;return (error as AppError).details?.reasonCode==='CONTEXT_LIMIT'
  })
  let partial=''
  await assert.rejects(runtime.run(assets,request,undefined,(_s,all)=>{partial=all}),error=>{
    evidence.outputError=(error as AppError).details;return (error as AppError).details?.reasonCode==='OUTPUT_LIMIT'
  })
  assert.ok(partial.length>0);evidence.incompleteCharacters=partial.length
  const pid=runtime.pid!,start=Date.now();console.log('Context and output limits passed; observing the normal 120-second idle release.')
  await new Promise(r=>setTimeout(r,122000))
  let alive=true;try{process.kill(pid,0)}catch{alive=false}
  evidence.idle={pid,elapsedMs:Date.now()-start,alive};assert.equal(alive,false)
  console.log('PASS: final token limit, incomplete output rejection, actual idle PID exit')
}finally{runtime.stop();await writeFile(output,JSON.stringify(evidence,null,2));console.log(output)}
