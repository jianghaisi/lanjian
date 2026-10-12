import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AppError } from '../../../../core/errors/app-error'
import { localPromptProfiles, type VerifiedModelAssets } from '../../domain/local-models'
import { LocalModelScheduler } from '../../application/local-model-scheduler'
import { encodeLocalFrame, LocalFrameReader } from './protocol'
import type { LocalTextRequest, LocalTextResult } from '../../domain/model-provider'
export type { LocalTextRequest, LocalTextResult } from '../../domain/model-provider'
export class LocalTextRuntime {
  private child?:ChildProcessWithoutNullStreams
  private resourceKey?:string
  private pending?:{id:string;resolve:(r:LocalTextResult)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>;sequence:number;content:string;delta?:(s:string,all:string)=>void|Promise<void>;delivery:Promise<void>}
  private idle?:ReturnType<typeof setTimeout>
  constructor(private worker:string,private scheduler:LocalModelScheduler=new LocalModelScheduler()){}
  get pid(){return this.child?.pid}
  async run(assets:VerifiedModelAssets,input:LocalTextRequest,signal?:AbortSignal,delta?:(s:string,all:string)=>void|Promise<void>):Promise<LocalTextResult>{
    const release=await this.scheduler.acquire('writing',()=>this.stop(),signal)
    const abort=()=>this.stop('CANCELLED')
    try{
      if(signal?.aborted)throw new AppError('CONFLICT','本地生成已停止。',{recoverable:true})
      clearTimeout(this.idle)
      if(!localPromptProfiles.includes(assets.promptProfile??'qwen3'))throw this.error('INPUT_INVALID')
      const key=JSON.stringify([assets.python,assets.sitePackages,assets.modelPath,assets.fingerprint,assets.promptProfile??'qwen3'])
      if(this.child&&this.resourceKey!==key)this.stop()
      if(!this.child){this.start(assets);this.resourceKey=key}
      signal?.addEventListener('abort',abort,{once:true})
      const result=await new Promise<LocalTextResult>((resolve,reject)=>{
        const id=randomUUID(),timer=setTimeout(()=>this.stop('TIMEOUT'),300_000)
        this.pending={id,resolve,reject,timer,sequence:0,content:'',delta,delivery:Promise.resolve()}
        try{this.child!.stdin.write(encodeLocalFrame({v:1,id,...input}))}catch{this.stop('INPUT_INVALID')}
      })
      if(result.finishReason==='length')throw this.error('OUTPUT_LIMIT')
      if(input.action==='complete'&&!result.content.trim())throw this.error('INFERENCE_FAILED')
      return result
    }finally{signal?.removeEventListener('abort',abort);release();this.idle=setTimeout(()=>this.stop(),120_000);this.idle.unref()}
  }
  private start(assets:VerifiedModelAssets){
    const root=assets.root
    const descriptor=JSON.stringify({modelPath:assets.modelPath,sitePackages:assets.sitePackages,promptProfile:assets.promptProfile??'qwen3'})
    const child=spawn(assets.python,['-I','-B','-u',this.worker,root,descriptor],{cwd:root,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{
      SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:join(root,'temp'),TMP:join(root,'temp'),
      PATH:join(process.env.SystemRoot||'C:/Windows','System32'),PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',
      HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1',OMP_NUM_THREADS:'4',MKL_NUM_THREADS:'4'
    }})
    this.child=child;const reader=new LocalFrameReader()
    child.stdout.on('data',(chunk:Buffer)=>{
      if(this.child!==child)return
      try{for(const frame of reader.push(chunk)){
        const p=this.pending
        if(!p||frame.id!==p.id||frame.v!==1)throw Error('STALE')
        if(frame.kind==='delta'){
          if(frame.seq!==p.sequence++||typeof frame.text!=='string'||Buffer.byteLength(frame.text)>32768)throw Error('DELTA')
          p.content+=frame.text;if(Buffer.byteLength(p.content)>256*1024)throw Error('LIMIT')
          const text=frame.text,all=p.content
          const delivery=p.delivery=p.delivery.then(async()=>{if(this.pending===p)await p.delta?.(text,all)})
          // Only the current tail may resume; earlier deltas can finish while
          // a later consumer from the same pipe batch is still waiting.
          child.stdout.pause();void delivery.then(()=>{if(this.child===child&&this.pending===p&&p.delivery===delivery)child.stdout.resume()},()=>{if(this.child===child&&this.pending===p)this.stop('INFERENCE_FAILED')})
        }else if(frame.kind==='error'){
          clearTimeout(p.timer);this.pending=undefined;p.reject(this.error(typeof frame.code==='string'?frame.code:'INFERENCE_FAILED'))
          // Discarded deliveries no longer own this reusable pipe's pause.
          child.stdout.resume()
        }else if(frame.kind==='result'){
          if(typeof frame.content!=='string'||frame.content!==p.content && frame.content!==''||!['stop','length'].includes(String(frame.finishReason))||
             !Number.isSafeInteger(frame.promptTokens)||!Number.isSafeInteger(frame.completionTokens)||typeof frame.seconds!=='number'||!Number.isFinite(frame.seconds))throw Error('RESULT')
          // The deadline includes delivery, and a late consumer belongs only to
          // this request. It must never stop a replacement model's worker.
          void p.delivery.then(()=>{if(this.pending===p){clearTimeout(p.timer);this.pending=undefined;p.resolve(frame as unknown as LocalTextResult)}},()=>{if(this.child===child&&this.pending===p)this.stop('INFERENCE_FAILED')})
        }else throw Error('FRAME')
      }}catch{this.stop('PROTOCOL_FAILED')}
    })
    child.stderr.on('data',()=>{})
    child.stdin.on('error',()=>{if(this.child===child)this.stop('WORKER_EXIT')})
    child.on('error',()=>{if(this.child===child)this.stop('WORKER_EXIT')})
    child.on('exit',()=>{if(this.child===child)this.stop('WORKER_EXIT')})
  }
  stop(code='CANCELLED'){
    clearTimeout(this.idle);const p=this.pending;this.pending=undefined
    if(p){clearTimeout(p.timer);p.reject(this.error(code))}
    const child=this.child;this.child=undefined;this.resourceKey=undefined;if(child){child.stdin.destroy();child.kill()}
  }
  private error(code:string){
    const messages:Record<string,string>={REASONING_INCOMPLETE:'本地模型尚未完成思考，未得到可用正文；请缩小请求范围或调整输出预算后重试。',CONTEXT_LIMIT:'本次内容超过本地模型的上下文容量，请缩小请求范围；必需写作依据未被删除。',OUTPUT_BUDGET:'本次输出预算不适用于本地模型，请调整后重试。',OUTPUT_LIMIT:'本地模型达到输出上限，结果尚未完整；请缩小范围或增加允许的输出预算。',CANCELLED:'本地生成已停止。',TIMEOUT:'本地生成耗时过长，已停止，请缩小范围后重试。'}
    return new AppError(code==='CANCELLED'?'CONFLICT':'FEATURE_UNAVAILABLE',messages[code]||'本地模型运行失败，请在模型超市重新检测后重试。',{recoverable:true,details:{reasonCode:Object.hasOwn(messages,code)?code:'INFERENCE_FAILED'}})
  }
}

