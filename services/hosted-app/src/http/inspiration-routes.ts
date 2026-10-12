import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { operation,record } from '@lanjian/hosted-contracts'
import { InspirationStore } from '../../../../desktop/src/main/modules/inspiration/adapters/inspiration-store'
import { InspirationService, InspirationCallFailure } from '../../../../desktop/src/main/modules/inspiration/application/inspiration-service'
import { InspirationSelectionService,type InspirationBooks } from '../../../../desktop/src/main/modules/inspiration/application/selection-service'
import { InspirationVideoService } from '../../../../desktop/src/main/modules/inspiration/application/video-service'
import { BilibiliSubtitles } from '../../../../desktop/src/main/modules/inspiration/adapters/bilibili-subtitles'
import { inspirationModels } from '../../../../desktop/src/main/modules/inspiration/adapters/original-ports'
import { registerInspiration } from '../../../../desktop/src/main/modules/inspiration/runtime/ipc'
import { validateIpcResponse } from '../../../../desktop/src/contracts/core/ipc-response'
import { inspirationArgs } from '../../../../desktop/src/contracts/inspiration/bridge'
import { AppError } from '../../../../desktop/src/contracts/core/app-error'
import type { IpcRegistrar } from '../../../../desktop/src/main/platform/ipc/validated-ipc'
import type { GroupModelCapability } from '../../../../desktop/src/main/modules/group-chat/application/group-chat-service'
import { withModelExecution } from '../../../../desktop/src/main/modules/models/application/model-execution-context'
import { tenantParent } from '../files/tenant-root.ts'
import { assertTenantSpace } from '../files/quota.ts'
import { readSite } from '../admin/site-store.ts'
import { digest,dbNumber } from '../storage/database.ts'
import { fail } from './errors.ts'
import type { WritingRouteContext } from './writing-routes.ts'
import type { BookRuntimes } from '../writing/book-runtime.ts'
import type { MeteredModels } from '../models/metered-client.ts'
import type { ModelStore } from '../models/model-store.ts'

export function registerInspirationRoutes(ctx:WritingRouteContext,runtimes:BookRuntimes,models:ModelStore,meter:MeteredModels){
  const accounts=new Map<string,Promise<Awaited<ReturnType<typeof compose>>>>()
  async function compose(owner:string){
    const appRoot=dirname(await tenantParent(ctx.db.root,owner,true))
    const guard=async(extra=0)=>{if(ctx.db.get('SELECT disabled FROM users WHERE id=?',owner)?.disabled!==0)fail('account-disabled');if(dirname(await tenantParent(ctx.db.root,owner,false))!==appRoot)fail('conflict');await assertTenantSpace(ctx.db.root,owner,null,extra,readSite(ctx.db).limits)}
    const library=new InspirationService(new InspirationStore(appRoot,owner,guard),inspirationModels(async(profile,sourceId):Promise<GroupModelCapability>=>{
      await guard();if(!profile.connectionId.startsWith('global-hosted-'))fail('invalid-request')
      const model=models.get(profile.connectionId.slice('global-hosted-'.length)),price=ctx.credits.price(model.id)
      if(!model.enabled||!model.keyConfigured||model.model!==profile.model||profile.maxTokens!==undefined&&profile.maxTokens>model.maxOutputTokens)fail('configuration-required')
      if(price.policy.mode==='unconfigured')fail('pricing-required')
      return {identity:digest(JSON.stringify({profile,revision:model.revision,price:price.version,extractionVersion:1})),model:{step:async(...args)=>(await meter.ai.prepareToolConversation('outline')).step(...args)},
        async run<T>(work:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
          await guard();signal?.throwIfAborted()
          const id=randomUUID(),preparation=`inspiration:${sourceId}`,controller=new AbortController()
          ctx.db.transaction(()=>{
            const total=dbNumber(ctx.db.get("SELECT (SELECT COUNT(*) FROM jobs WHERE status IN ('queued','running'))+(SELECT COUNT(*) FROM group_model_jobs WHERE status='running') AS count")?.count)
            if(total>=readSite(ctx.db).limits.concurrentJobs||ctx.db.get("SELECT id FROM jobs WHERE owner_id=? AND status IN ('queued','running')",owner)||ctx.db.get("SELECT id FROM group_model_jobs WHERE owner_id=? AND status='running'",owner))fail('request-limit')
            ctx.db.run('INSERT INTO group_model_jobs VALUES(?,?,?,?,?,?,?, ?,NULL,?,?)',id,owner,preparation,null,model.id,model.revision,price.version,'running',ctx.db.now(),ctx.db.now())
          })
          let scope:ReturnType<MeteredModels['createScope']>|undefined,complete=false
          const abort=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort()
          const timeout=setTimeout(abort,10*60_000)
          try{scope=meter.createScope(id,owner,null,model.id,model.revision,price.version,controller,preparation);return await meter.run(scope,async()=>withModelExecution(meter.groupConnection(profile),async()=>{const result=await work();signal?.throwIfAborted();complete=true;return result}))}
          catch(error){const attempts=ctx.db.all('SELECT status FROM group_model_attempts WHERE job_id=?',id);if(!scope?.calls)throw new InspirationCallFailure('not-sent','调用尚未发送，请核对额度、模型参数和上下文容量。');if(attempts.length&&attempts.every(a=>a.status==='known'))throw new InspirationCallFailure('received','模型已返回并完成费用核对，但结果无法解析；已完成片段保留。');throw error}
          finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);if(scope)await meter.finish(scope,complete);ctx.db.run('UPDATE group_model_jobs SET status=?,updated_at=? WHERE id=?',controller.signal.aborted?'cancelled':complete?'succeeded':'failed',ctx.db.now(),id)}
        }}
    }))
    const books:InspirationBooks={capture:id=>runtimes.run(owner,id,async r=>{
      const captured=await r.projects.captureCreatedBook(r.root),identity=JSON.stringify(captured.identity)
      return {id,title:captured.summary.title,identity,run:work=>runtimes.mutations.run(id,()=>runtimes.run(owner,id,async current=>{if(JSON.stringify((await current.projects.captureCreatedBook(current.root)).identity)!==identity)fail('conflict');return work()})),find:async provenance=>(await r.research.listSources()).sources.find(s=>s.provider==='inspiration-library'&&s.userNotes===provenance)?.id,add:async(title,content,provenance)=>(await r.research.createSource({title,excerpt:content,userNotes:provenance,sourceType:'manual',provider:'inspiration-library'})).id}
    })}
    // Hosted processes never import or prepare the native downloader/ASR worker.
    // Subtitle acquisition is explicit; absent operator speech/vision is truthful.
    const caps=async()=>({subtitles:true,videoAudio:false,asr:false,preparing:false,visual:false,notice:'在线版可读取B站公开字幕。站长尚未开放带计量的远程音频转写/画面能力；无字幕视频和抖音暂不可提取。'})
    const video=new InspirationVideoService(library,new BilibiliSubtitles(),{capabilities:caps,prepare:async()=>{throw new AppError('FEATURE_UNAVAILABLE','在线版不安装本地模型。请使用桌面版转写，或等待站长开放远程能力。',{recoverable:true})},acquire:async()=>{throw new AppError('FEATURE_UNAVAILABLE','此视频需要音频转写，站长尚未开放对应远程能力。',{recoverable:true})}})
    const handlers=new Map<string,Parameters<IpcRegistrar['handle']>[1]>()
    registerInspiration({handle:(name,handler)=>{handlers.set(name,handler)}},library,new InspirationSelectionService(library,books),video)
    return {library,video,handlers,guard}
  }
  function account(owner:string){let entry=accounts.get(owner);if(!entry){if(accounts.size>=128)fail('request-limit');entry=compose(owner).catch(error=>{accounts.delete(owner);throw error});accounts.set(owner,entry)}return entry}
  for(const name of Object.keys(inspirationArgs))ctx.app.post(`/api/desktop/library/inspiration/${name}`,{bodyLimit:name==='importPreview'?34*1024*1024:2*1024*1024},async request=>{
    const current=ctx.write(request),input=record(request.body,['args','operation']);operation(input.operation);if(!Array.isArray(input.args))fail('invalid-request');ctx.rate(`inspiration:${current.user.id}`,300)
    const owned=await account(current.user.id);await owned.guard();return validateIpcResponse(`inspiration:${name}`,await owned.handlers.get(`inspiration:${name}`)!(undefined,...input.args))
  })
  return {account,close:async()=>{await Promise.allSettled([...accounts.values()].map(async p=>{const owned=await p;await owned.video.shutdown();await owned.library.shutdown()}))}}
}
