import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir, cpus, totalmem } from 'node:os'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { LocalModelService } from '../src/main/modules/models/application/local-model-service'
import { LocalTextRuntime } from '../src/main/modules/models/adapters/local-models/text-runtime'
import { ExistingModelAssets } from '../src/main/modules/models/adapters/local-models/existing-assets'
import { LocalInstallationStore } from '../src/main/modules/models/adapters/local-models/installation-store'
import { localModelCatalog } from '../src/main/modules/models/adapters/local-models/catalog'
const temp=await mkdtemp(join(tmpdir(),'lanjian-local-model-probe-'))
const runtime=new LocalTextRuntime(resolve('src/main/modules/models/adapters/local-models/text-worker.py'))
const model=localModelCatalog[0]!
const observations:unknown[]=[]
const measured={stop:()=>runtime.stop(),run:async(...args:Parameters<LocalTextRuntime['run']>)=>{const start=Date.now();const result=await runtime.run(...args);let rss=0;try{rss=Number(execFileSync('powershell.exe',['-NoProfile','-Command',`(Get-Process -Id ${runtime.pid}).WorkingSet64`],{windowsHide:true,encoding:'utf8'}).trim())}catch{};observations.push({action:args[1].action,structured:Boolean(args[1].schema),...result,content:undefined,elapsedMs:Date.now()-start,pid:runtime.pid,rss});return result}}
const service=new LocalModelService(localModelCatalog,new ExistingModelAssets(resolve('../../.local/companion-voice')),measured,new LocalInstallationStore(join(temp,'installations.json')))
try {
  const before=Date.now();const status=await service.inspect(model.id);console.log(JSON.stringify({status,elapsedMs:Date.now()-before}))
  if(status.state!=='ready')throw new Error('Model probe failed')
  const profile={connectionId:'local:llama-cpp',model:model.id,temperature:.7,topP:.9,maxTokens:process.argv.includes('--quick')?128:2048}
  const output=await service.complete({model:model.id,profile,messages:[{role:'system',content:'你是中文小说写作助手。只输出正文，不使用标题。'}, {role:'user',content:process.argv.includes('--quick')?'用50字写少女在雨夜发现一封旧信的情景。':'写一篇1200字的中文小说正文，写足六个较长的自然段，每段至少150字。第一段描写雨夜旧邮局；第二段成年档案员沈清清点来信；第三段管理员周伯解释退信流程；第四段沈清发现自己十年前寄出的信；第五段两人对照旧登记册验证寄信人；第六段她翻到背面发现日期，比当年晚了一天。没有超能力，只有沈清和周伯。保持悬念，只输出六段正文。'}]})
  await writeFile(join(temp,'prose.txt'),output.content,'utf8');console.log(JSON.stringify({characters:output.content.length,output:output.content,elapsedMs:Date.now()-before}))
  const controller=new AbortController();let abortedAt=0,pid=0
  try{await service.complete({model:model.id,profile:{...profile,maxTokens:2048},signal:controller.signal,messages:[{role:'user',content:'详细写一篇1200字的旧邮局故事。'}],onDelta:()=>{pid=runtime.pid||0;abortedAt=Date.now();controller.abort()}});throw Error('cancel was ignored')}
  catch(error){if(!controller.signal.aborted)throw error;await new Promise(r=>setTimeout(r,300));let alive=true;try{process.kill(pid,0)}catch{alive=false};observations.push({cancelMs:Date.now()-abortedAt,pid,alive});if(alive)throw Error('worker survived cancellation')}
}finally{runtime.stop();await writeFile(join(temp,'metrics.json'),JSON.stringify({cpu:cpus()[0]?.model,ram:totalmem(),threads:4,context:8192,observations},null,2));console.log('Evidence: '+temp)}
