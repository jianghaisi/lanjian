import { AppError } from '../../../core/errors/app-error'
import type { InspirationCapabilities, InspirationVideoJob } from '../../../../contracts/inspiration/types'
import type { SourceDocument } from '../domain/source'
import type { InspirationService } from './inspiration-service'
export type VideoAcquisition = {capabilities():Promise<InspirationCapabilities>;prepare():Promise<InspirationCapabilities>;cancelPreparation?():Promise<InspirationCapabilities>;acquire(url:string,signal:AbortSignal,progress:(stage:'audio'|'transcribing',percent:number)=>Promise<void>,jobId?:string):Promise<SourceDocument>;partial?(jobId:string):Promise<SourceDocument|null>}
export type SubtitleAcquisition = {canonical(url:string,signal:AbortSignal):Promise<string>;acquire(url:string,signal:AbortSignal):Promise<SourceDocument|null>}
export class InspirationVideoService {
  private readonly failures=new Set<string>()
  private readonly live=new Map<string,{controller:AbortController;promise:Promise<void>}>()
  private recovering?:Promise<void>
  private lane:Promise<unknown>=Promise.resolve()
  constructor(private readonly library:InspirationService,private readonly subtitles:SubtitleAcquisition,private readonly audio:VideoAcquisition){}
  capabilities(){return this.audio.capabilities()}
  prepare(){return this.audio.prepare()}
  cancelPreparation(){return this.audio.cancelPreparation?.()??this.audio.capabilities()}
  async list(){await this.recover();if(this.failures.size)throw new AppError('STORAGE_ERROR','视频结果保存失败，请检查存储；原资料保留。',{recoverable:true});return this.library.store.videoJobs()}
  private recover(){return this.recovering??=this.library.store.videoJobs().then(async jobs=>{
    for(const job of jobs)if(job.status==='running'){
      const document=await this.library.store.videoResult(job.id)??await this.audio.partial?.(job.id)
      if(document){
        await this.library.store.saveVideoResult(job.id,document)
        job.preview=this.library.stagePreview([document],Buffer.byteLength(JSON.stringify(document)),[document.source.notice])
      }
      job.status='interrupted'
      job.notice=document?'应用关闭时视频提取中断，已获取文字保留供核对；没有自动下载或转写。':'应用关闭时视频提取中断，请重新发起；没有自动下载或转写。'
      if(document?.source.acquisitionCoverage==='partial')job.notice+=' 仅包含中断前的部分语音，不能视为完整视频。'
      job.updatedAt=new Date().toISOString()
      await this.library.store.saveVideo(job)
    }
  })}
  start(input:{url:string;operationId:string}):Promise<InspirationVideoJob>{const r=this.lane.then(()=>this.startNow(input));this.lane=r.then(()=>{},()=>{});return r}
  private async startNow(input:{url:string;operationId:string}){
    await this.recover();const old=(await this.library.store.videoJobs()).find(j=>j.id===input.operationId)
    if(old){if(old.url!==input.url)throw new AppError('CONFLICT','视频请求编号已用于其他链接。',{recoverable:true});return this.get(old.id)}
    if(this.live.size)throw new AppError('FEATURE_UNAVAILABLE','已有视频提取进行中，请停止或等待完成。',{recoverable:true})
    const job:InspirationVideoJob={id:input.operationId,url:input.url,status:'running',stage:'subtitles',progress:0,notice:'正在展开链接并读取所选视频字幕。',preview:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}
    await this.library.store.saveVideo(job)
    const controller=new AbortController(),promise=this.run(job,controller.signal).finally(()=>this.live.delete(job.id));this.live.set(job.id,{controller,promise});void promise.catch(()=>this.failures.add(job.id))
    return structuredClone(job)
  }
  async get(id:string){await this.recover();if(this.failures.has(id))throw new AppError('STORAGE_ERROR','视频结果保存失败，已有来源保留；请检查存储后重新打开。',{recoverable:true});const job=(await this.library.store.videoJobs()).find(j=>j.id===id);if(!job)throw new AppError('NOT_FOUND','视频任务不属于此知识库。',{recoverable:true});if((job.status==='succeeded'||job.preview)&&(!job.preview||!this.library.previewExists(job.preview.token))){const document=await this.library.store.videoResult(id);if(!document)throw new AppError('STORAGE_ERROR','已获取的视频来源缺失，原任务保留。',{recoverable:true});job.preview=this.library.stagePreview([document],Buffer.byteLength(JSON.stringify(document)),[document.source.notice]);await this.library.store.saveVideo(job)}return job}
  async stop(id:string){const active=this.live.get(id);active?.controller.abort();await active?.promise.catch(()=>{});return this.get(id)}
  private async run(job:InspirationVideoJob,signal:AbortSignal){
    try{
      const url=await this.subtitles.canonical(job.url,signal)
      let document:SourceDocument|null=null
      try{document=await this.subtitles.acquire(url,signal)}catch(error){if(!(error instanceof AppError&&error.code==='FEATURE_UNAVAILABLE'))throw error}
      if(!document)document=await this.audio.acquire(url,signal,async(stage,percent)=>{signal.throwIfAborted();job.stage=stage;job.progress=percent;job.notice=stage==='audio'?'字幕不可读取，正在获取受限长度的音频。':'正在转写语音，保留每段的实际时间。';job.updatedAt=new Date().toISOString();await this.library.store.saveVideo(job)},job.id)
      signal.throwIfAborted()
      await this.library.store.saveVideoResult(job.id,document);signal.throwIfAborted()
      job.preview=this.library.stagePreview([document],Buffer.byteLength(JSON.stringify(document)),[document.source.notice])
      job.status='succeeded';job.stage='ready';job.progress=100;job.notice='字幕/语音已就绪，请核对来源后收入知识库；剧情提取需另行选择模型。'
    }catch(error){const partial=await this.audio.partial?.(job.id).catch(()=>null);if(partial){await this.library.store.saveVideoResult(job.id,partial);job.preview=this.library.stagePreview([partial],Buffer.byteLength(JSON.stringify(partial)),[partial.source.notice])}job.status=signal.aborted?'cancelled':'failed';job.notice=signal.aborted?'已停止视频提取，未收入知识库。':error instanceof AppError?error.message:'平台提取失败，请核对链接、平台限制和已准备的转写能力。'}
    if(job.preview?.sources.some(s=>s.acquisitionCoverage==='partial'))job.notice+=' 中断前已转写的部分文字保留，可核对后单独入库，不能视为完整视频。'
    job.updatedAt=new Date().toISOString();await this.library.store.saveVideo(job)
  }
  async shutdown(){for(const active of this.live.values())active.controller.abort();await Promise.allSettled([...this.live.values()].map(v=>v.promise))}
}
