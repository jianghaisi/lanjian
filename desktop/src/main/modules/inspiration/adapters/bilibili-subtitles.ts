import { AppError } from '../../../core/errors/app-error'
import { safeInspirationUrl } from '../../../../contracts/inspiration/validation'
import { sourceDocument, type SourceDocument } from '../domain/source'

/** BiliNote's view → selected cid → preferred Chinese subtitle → timed body flow. */
export class BilibiliSubtitles {
  constructor(private readonly fetcher:typeof fetch=fetch){}
  private async read(url:string,signal:AbortSignal,subtitle=false):Promise<unknown>{
    const target=new URL(url)
    if(target.protocol!=='https:'||target.username||target.password||target.port||!(target.hostname==='api.bilibili.com'||subtitle&&/(?:^|\.)hdslb\.com$/.test(target.hostname)))throw new AppError('VALIDATION_ERROR','视频字幕地址不受支持。',{recoverable:true})
    const response=await this.fetcher(target,{signal:AbortSignal.any([signal,AbortSignal.timeout(30_000)]),redirect:'error',headers:{'User-Agent':'Mozilla/5.0','Referer':'https://www.bilibili.com/'}})
    if(!response.ok)throw platformFailure(response.status)
    if(Number(response.headers.get('content-length')??0)>4*1024*1024)throw new AppError('VALIDATION_ERROR','字幕超出4MB容量。',{recoverable:true})
    const reader=response.body?.getReader();if(!reader)throw new AppError('FEATURE_UNAVAILABLE','字幕内容不可读取。',{recoverable:true})
    const chunks:Uint8Array[]=[];let size=0
    try{for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>4*1024*1024)throw new AppError('VALIDATION_ERROR','字幕超出4MB容量。',{recoverable:true});chunks.push(r.value)}}finally{await reader.cancel().catch(()=>{})}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  async canonical(input:string,signal:AbortSignal):Promise<string>{
    let url=safeInspirationUrl(input)
    for(let n=0;n<=4;n++){
      const parsed=new URL(url)
      if(['iesdouyin.com','www.iesdouyin.com','m.douyin.com'].includes(parsed.hostname)){
        const id=/^\/(?:share\/)?video\/(\d+)\/?$/.exec(parsed.pathname)?.[1]
        if(!id)throw new AppError('VALIDATION_ERROR','请提供单个抖音视频链接。',{recoverable:true})
        return `https://www.douyin.com/video/${id}`
      }
      if(!['b23.tv','v.douyin.com'].includes(parsed.hostname))return url
      if(n===4)break
      const options={redirect:'manual' as const,signal:AbortSignal.any([signal,AbortSignal.timeout(20_000)])}
      let r=await this.fetcher(url,{...options,method:'HEAD'})
      if(r.status===405){await r.body?.cancel();r=await this.fetcher(url,{...options,method:'GET'});await r.body?.cancel()}
      if(r.status<300||r.status>=400||!r.headers.get('location'))throw new AppError('FEATURE_UNAVAILABLE','短链接无法展开，请粘贴平台完整视频链接。',{recoverable:true})
      url=safeInspirationUrl(new URL(r.headers.get('location')!,url).href)
    }
    throw new AppError('VALIDATION_ERROR','视频短链接跳转过多。',{recoverable:true})
  }
  async acquire(input:string,signal:AbortSignal):Promise<SourceDocument|null>{
    const url=await this.canonical(input,signal),parsed=new URL(url)
    if(!parsed.hostname.endsWith('bilibili.com'))return null
    const bv=/\/video\/(BV[a-zA-Z0-9]+)/.exec(parsed.pathname)?.[1]
    if(!bv)throw new AppError('VALIDATION_ERROR','请提供B站视频链接，分P可保留?p=页码。',{recoverable:true})
    const page=Number(parsed.searchParams.get('p')??1);if(!Number.isSafeInteger(page)||page<1||page>1000)throw new AppError('VALIDATION_ERROR','视频分P页码无效。',{recoverable:true})
    const view=await this.read(`https://api.bilibili.com/x/web-interface/view?bvid=${bv}`,signal) as {code:number;data?:{title:string;owner?:{name:string};pages?:Array<{cid:number;duration:number;part:string}>}}
    if(view.code!==0)throw platformFailure(view.code)
    const selected=view.data?.pages?.[page-1];if(!selected)throw new AppError('VALIDATION_ERROR','此视频没有该分P，请核对页码。',{recoverable:true})
    if(!Number.isFinite(selected.duration)||selected.duration<=0||!Number.isSafeInteger(selected.cid)||typeof view.data?.title!=='string')throw new AppError('FEATURE_UNAVAILABLE','平台返回的视频资料不完整。',{recoverable:true})
    if(selected.duration>3600)throw new AppError('VALIDATION_ERROR','单次视频最长60分钟，请选择分P或拆分素材。',{recoverable:true})
    const player=await this.read(`https://api.bilibili.com/x/player/v2?bvid=${bv}&cid=${selected.cid}`,signal) as {code:number;data?:{subtitle?:{subtitles?:Array<{lan:string;subtitle_url:string}>}}}
    if(player.code!==0)throw platformFailure(player.code)
    const subtitles=player.data?.subtitle?.subtitles??[],entry=subtitles.find(s=>/^zh(?:-|$)/.test(s.lan))??subtitles.find(s=>/^ai-zh/.test(s.lan))??subtitles[0]
    if(!entry)return null
    const data=await this.read(new URL(entry.subtitle_url,'https://www.bilibili.com').href,signal,true) as {body?:Array<{from:number;to:number;content:string}>}
    if(!Array.isArray(data.body)||!data.body.length)return null
    return sourceDocument({title:`${view.data!.title}${view.data!.pages!.length>1?` · P${page} ${selected.part}`:''}`,author:view.data?.owner?.name,format:'bilibili-json',url:`https://www.bilibili.com/video/${bv}/?p=${page}`,platform:'bilibili',method:'subtitle',language:entry.lan,duration:selected.duration,timed:data.body.map(s=>({start:s.from,end:s.to,text:s.content}))})
  }
}
function platformFailure(code:number){
  const message=[412,429,-412].includes(code)?'平台暂时限制访问，请稍后重试。':[401,403,-101,-403].includes(code)?'平台要求登录或验证，当前字幕不能匿名读取。':[404,-404,62002].includes(code)?'视频已删除、设为私密或链接失效，请核对原链接。':'平台未返回可读取的字幕，请核对视频是否公开。'
  return new AppError('FEATURE_UNAVAILABLE',message,{recoverable:true})
}
