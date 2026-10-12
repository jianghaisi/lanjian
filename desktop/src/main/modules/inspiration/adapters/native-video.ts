import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { VideoPython } from './video-python'
import { ownedPath } from '../../models/adapters/local-models/install-files'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { access, lstat, mkdir, realpath, readdir, unlink, readFile } from 'node:fs/promises'
import { AppError } from '../../../core/errors/app-error'
import { resolvePortablePython } from '../../../platform/processes/portable-python-runtime'
import type { VideoAcquisition } from '../application/video-service'
import type { InspirationCapabilities } from '../../../../contracts/inspiration/types'
import { safeInspirationUrl } from '../../../../contracts/inspiration/validation'
import { sourceDocument } from '../domain/source'

export class NativeVideoAcquisition implements VideoAcquisition {
  private preparingController?:AbortController
  private preparing?:Promise<InspirationCapabilities>
  private readonly controllers=new Set<AbortController>()
  private ready=false
  private checked=0
  private checking?:Promise<void>
  private root:string
  private canonicalAppRoot?:string
  constructor(private readonly appRoot:string,private readonly portableRoot:string,private readonly worker:string){this.root=join(resolve(appRoot),'inspiration-video')}
  private async assertRoot(create=false){
    const canonical=await realpath(this.appRoot);if(this.canonicalAppRoot&&canonical!==this.canonicalAppRoot)throw new AppError('CONFLICT','视频运行目录已变化。',{recoverable:true})
    this.canonicalAppRoot=canonical;this.root=join(canonical,'inspiration-video')
    if(create)await mkdir(this.root,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error})
    const s=await lstat(this.root);if(!s.isDirectory()||s.isSymbolicLink()||await realpath(this.root)!==this.root)throw new AppError('CONFLICT','视频运行目录不可用。',{recoverable:true})
  }
  async capabilities():Promise<InspirationCapabilities>{
    if(!this.preparing){
      if(!this.checking&&Date.now()-this.checked>20_000)this.checking=(async()=>{try{await this.assertRoot();this.ready=(await this.run({action:'probe'},new AbortController().signal,()=>{})).ready===true}catch{this.ready=false}finally{this.checked=Date.now()}})().finally(()=>{this.checking=undefined})
      await this.checking
    }
    return {subtitles:true,videoAudio:this.ready,asr:this.ready,preparing:Boolean(this.preparing),visual:false,notice:this.preparing?'正在准备固定版本转写组件和模型。':this.ready?'B站优先字幕；B站/抖音可读取音频并本地转写。画面增强尚未配置。':'可优先读取B站公开字幕。准备视频转写后才能读取无字幕视频和抖音；首次下载约数百MB，会一并准备便携Python，无需另外安装写作模型。'}
  }
  prepare(){return this.preparing??=this.prepareNow().finally(()=>{this.preparing=undefined})}
  private async prepareNow(){const controller=new AbortController();this.controllers.add(controller);this.preparingController=controller
    try{await this.assertRoot(true);controller.signal.throwIfAborted();const r=await this.run({action:'prepare'},controller.signal,()=>{});this.ready=r.ready===true;if(!this.ready)throw this.unavailable();return {...await this.capabilities(),preparing:false,notice:'视频转写组件已准备完成。B站优先字幕，B站/抖音可读取音频并本地转写。'}}finally{this.controllers.delete(controller);this.preparingController=undefined}
  }
  async cancelPreparation(){this.preparingController?.abort();await this.preparing?.catch(()=>{});this.checked=0;return this.capabilities()}
  async acquire(url:string,signal:AbortSignal,progress:Parameters<VideoAcquisition['acquire']>[2],operationId?:string){
    url=safeInspirationUrl(url);if(!(await this.capabilities()).asr)throw this.unavailable()
    await this.assertRoot();await progress('audio',10)
    const jobId=operationId??randomUUID(),controller=new AbortController();this.controllers.add(controller)
    try{
      const result=await this.run({action:'acquire',url,jobId},AbortSignal.any([signal,controller.signal]),frame=>{if(frame.stage==='transcribing')return progress('transcribing',typeof frame.progress==='number'?Math.max(45,Math.min(98,Math.floor(frame.progress))):45)})
      signal.throwIfAborted()
      if(typeof result.title!=='string'||!result.title.trim()||typeof result.author!=='string'||typeof result.language!=='string'||typeof result.duration!=='number'||result.duration<=0||result.duration>3600||!Array.isArray(result.timed)||!result.timed.length)throw this.unavailable()
      return sourceDocument({title:result.title,author:result.author,format:'yt-dlp/faster-whisper',method:'asr',url,platform:new URL(url).hostname.endsWith('bilibili.com')?'bilibili':'douyin',language:String(result.language),duration:Number(result.duration),timed:result.timed as Parameters<typeof sourceDocument>[0]['timed']})
    }finally{
      this.controllers.delete(controller)
      // A killed worker cannot execute finally. Clean only its owned audio files;
      // partial transcripts remain available to diagnose or explicitly recover.
      const folder=join(this.root,'media',jobId)
      try{const s=await lstat(folder);if(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(folder)===folder)for(const name of await readdir(folder)){if(!/^audio\.[a-zA-Z0-9.]+$/.test(name))continue;const path=join(folder,name),f=await lstat(path);if(f.isFile()&&!f.isSymbolicLink()&&await realpath(path)===path)await unlink(path)}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    }
  }
  async partial(id:string){
    if(!/^[a-f0-9-]{36}$/.test(id))return null
    await this.assertRoot();const folder=await ownedPath(this.root,`media/${id}`)
    const read=async(name:string)=>{const file=await ownedPath(folder,name),s=await lstat(file);if(!s.isFile()||s.size>24*1024*1024)throw this.unavailable();return JSON.parse(await readFile(file,'utf8'))}
    try{const metadata=await read('metadata.json'),timed=await read('transcript.partial.json');if(!Array.isArray(timed)||!timed.length)return null
      return sourceDocument({...metadata,timed,format:'yt-dlp/faster-whisper',method:'asr',partial:true})
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'||error instanceof SyntaxError)return null;throw error}
  }
  private async run(request:Record<string,unknown>,signal:AbortSignal,progress:(frame:Record<string,unknown>)=>void|Promise<void>):Promise<Record<string,unknown>>{
    await access(this.worker);await this.assertRoot();signal.throwIfAborted()
    let python:string|undefined
    try{python=(await resolvePortablePython(this.portableRoot,join(this.portableRoot,'venv'))).python}catch{}
    if(!python){const runtime=new VideoPython(this.root);python=request.action==='prepare'?await runtime.prepare(signal):await runtime.resolve(signal)}
    if(!python)throw this.unavailable()
    await mkdir(await ownedPath(this.root,'temp'),{recursive:true,mode:0o700})
    return new Promise((resolveValue,reject)=>{
      const child=spawn(python,['-I','-B','-u','-X','utf8',this.worker,this.root],{cwd:this.root,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:join(this.root,'temp'),TMP:join(this.root,'temp'),PATH:join(process.env.SystemRoot??'C:/Windows','System32'),PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',HF_HUB_DISABLE_TELEMETRY:'1',OMP_NUM_THREADS:'2',MKL_NUM_THREADS:'2'}})
      let buffer='',bytes=0,result:Record<string,unknown>|undefined,failure:unknown,closed=false,pending=Promise.resolve();const decoder=new StringDecoder('utf8')
      const fail=(error:unknown)=>{if(failure)return;failure=error;if(closed)reject(error);else child.kill()}
      const abort=()=>fail(new AppError('CONFLICT','视频任务已停止。',{recoverable:true}))
      const timer=setTimeout(()=>fail(this.unavailable()),request.action==='probe'?10_000:request.action==='prepare'?20*60_000:15*60_000)
      signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()
      child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>24*1024*1024)return fail(this.unavailable());buffer+=decoder.write(chunk);let end:number;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const frame=JSON.parse(line) as Record<string,unknown>;if(typeof frame.ok==='boolean')result=frame;else pending=pending.then(()=>progress(frame)).catch(fail)}catch{return fail(this.unavailable())}}})
      child.stderr.resume();child.once('error',()=>fail(this.unavailable()))
      child.stdin.on('error',()=>fail(this.unavailable()))
      child.once('close',()=>{closed=true;clearTimeout(timer);signal.removeEventListener('abort',abort);void pending.then(()=>{if(failure)return reject(failure);if(result?.ok===true)resolveValue(result);else reject(request.action==='acquire'?videoAcquisitionError(result?.code):this.unavailable())})})
      child.stdin.end(`${JSON.stringify(request)}\n`)
    })
  }
  private unavailable(){return new AppError('FEATURE_UNAVAILABLE','视频音频/转写尚不可用，请主动准备视频转写组件，或使用可公开读取字幕的B站视频。',{recoverable:true})}
  shutdown(){for(const controller of this.controllers)controller.abort()}
}

export function videoAcquisitionError(code:unknown){
  const notices:Record<string,string>={
    RUNTIME_NOT_READY:'转写组件或模型不完整，请重新准备视频转写。',
    MEDIA_SIZE:'视频音频超过128MB，请使用更短的视频或分P。',
    VIDEO_DURATION:'视频超过60分钟或无法确认时长，请使用有明确时长的视频或分P。',
    PLATFORM_RATE_LIMIT:'平台暂时限制访问，请稍后重试；已完成的转写片段保留。',
    PLATFORM_AUTH_REQUIRED:'平台要求登录或验证，当前不能匿名读取。请使用可公开读取的视频，或导入你取得的字幕文本。',
    VIDEO_UNAVAILABLE:'视频已删除、设为私密或链接失效，请核对原链接。',
    VIDEO_NETWORK:'连接平台超时或网络不可用，请检查网络后重试。',
    MEDIA_ADDRESS_UNSUPPORTED:'平台返回了当前不支持的媒体地址，请使用其他公开链接或字幕文本。',
    VIDEO_READ_FAILED:'平台视频读取或语音识别失败，请核对原链接；已完成的转写片段保留，可查看后导入。'
  }
  return new AppError('FEATURE_UNAVAILABLE',notices[String(code)]??notices.VIDEO_READ_FAILED!,{recoverable:true})
}
