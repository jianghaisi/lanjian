import { createHash, randomUUID } from 'node:crypto'
import type { InspirationSource, InspirationSegment, InspirationCard } from '../../../../contracts/inspiration/types'
import { decodeInspirationCard, inspirationObject, inspirationText } from '../../../../contracts/inspiration/validation'
import { AppError } from '../../../core/errors/app-error'

export const inspirationDigest = (v: unknown) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex')
export type SourceDocument = { source: InspirationSource; text: string; segments: InspirationSegment[] }
export const SOURCE_DOCUMENT_BYTES = 64 * 1024 * 1024
export const serializeSourceDocument = (document:SourceDocument) => `${JSON.stringify(document,null,2)}\n`
export type TimedText = { start: number; end: number; text: string }
export function sourceDocument(input: { title: string; author?: string; format: string; text?: string; timed?: TimedText[]; url?: string; platform?: 'bilibili' | 'douyin'; method?: 'subtitle' | 'asr'; language?: string; duration?: number; partial?:boolean }): SourceDocument {
  const timed=input.timed?.map(t=>{if(!Number.isFinite(t.start)||!Number.isFinite(t.end)||t.start<0||t.end<t.start||t.end>86400||typeof t.text!=='string')throw new AppError('AI_RESPONSE_INVALID','视频时间段无效。',{recoverable:true});return {...t,text:t.text.replace(/\r\n?/g,'\n').trim()}}).filter(t=>t.text)
  const text=(timed?.map(t=>t.text).join('\n') ?? input.text ?? '').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n')
  if(!text.trim()||text.length>20000000)throw new AppError('VALIDATION_ERROR','来源为空或超过单份2000万字符的容量，请拆分后导入。',{recoverable:true})
  const id=randomUUID(), version=inspirationDigest({title:input.title,text,timed,url:input.url,method:input.method,partial:input.partial===true}), segments:InspirationSegment[]=[]
  let offset=0,title=input.title,purpose:'story'|'auxiliary'='story'
  // Preserve every character and chapter boundary; long chapters are split rather
  // than replacing the middle with a summary or claiming complete coverage.
  const append=(body:string, startSeconds:number|null=null,endSeconds:number|null=null)=>{
    for(let at=0;at<body.length;){
      let end=Math.min(at+2800,body.length)
      if(end<body.length){const paragraph=body.lastIndexOf('\n',end);if(paragraph>at+1400)end=paragraph+1;else{const sentence=[...body.slice(at+1400,end).matchAll(/[。！？]/g)].at(-1);if(sentence)end=at+1400+sentence.index!+1}if(/[\uD800-\uDBFF]/.test(body[end-1]))end--}
      const value=body.slice(at,end);if(value.trim())segments.push({id:randomUUID(),sourceId:id,version,index:segments.length,title,text:value,purpose,contentHash:inspirationDigest(value),start:offset+at,end:offset+end,startSeconds,endSeconds});at=end
    }
    offset+=body.length
  }
  if(timed?.length){
    // Adjacent subtitle lines form one bounded input instead of paying once per
    // short spoken sentence. Gaps, 90 seconds and 2800 characters split groups.
    for(let at=0;at<timed.length;){let end=at+1,length=timed[at].text.length
      while(end<timed.length&&timed[end].start-timed[end-1].end<=4&&timed[end].end-timed[at].start<=90&&length+timed[end].text.length+1<=2800){length+=timed[end].text.length+1;end++}
      title=`${input.title} · ${Math.floor(timed[at].start)}秒`
      append(timed.slice(at,end).map(t=>t.text).join('\n')+(end<timed.length?'\n':''),timed[at].start,timed[end-1].end);at=end
    }
  }
  else {
    const headings=[...text.matchAll(/^(?:目录[ \t]*$|作者的话[ \t]*$|作者有话说[ \t]*$|上架感言[ \t]*$|广告[ \t]*$|第[零一二三四五六七八九十百千万\d]+[章节卷回部]|chapter\s+\d+)[^\n]{0,90}$/gimu)]
    const starts=[...new Set([0,...headings.map(h=>h.index!)])].sort((a,b)=>a-b)
    for(let i=0;i<starts.length;i++){const body=text.slice(starts[i],starts[i+1]??text.length);title=headings.find(h=>h.index===starts[i])?.[0]??input.title;purpose=/^(?:目录|作者的话|作者有话说|上架感言|广告)$/.test(title.trim())||body.trim()===title.trim()?'auxiliary':'story';append(body)}
  }
  if(!segments.length||segments.length>10000)throw new AppError('VALIDATION_ERROR','来源分片数量超出容量，请拆成多份。',{recoverable:true})
  return {text,segments,source:{id,version,revision:1,kind:timed?'video':'novel',title:input.title.slice(0,300),author:input.author??'',format:input.format,method:input.method??'novel',language:input.language??'unknown',capturedAt:new Date().toISOString(),totalCharacters:text.length,segmentCount:segments.length,auxiliaryCount:segments.filter(s=>s.purpose==='auxiliary').length,duration:input.duration??null,acquisitionCoverage:input.partial?'partial':'complete',visualCoverage:'none',notice:input.partial?'这是中断前实际获得的部分语音，不包含后续剧情；画面未分析。':timed?'剧情依据来自字幕/语音；尚未分析画面，不能据此补出无台词动作。':'完整原文已保留，提取覆盖按实际完成片段计算。',...(input.url?{url:input.url}:{}),...(input.platform?{platform:input.platform}:{})}}
}
export function decodeExtractedCards(response: string, document: SourceDocument, segments: InspirationSegment[], model: string, fingerprint: string, kind: 'scene' | 'arc'): InspirationCard[] {
  let parsed: unknown
  try{parsed=JSON.parse(response.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''))}catch{throw new AppError('AI_RESPONSE_INVALID','模型没有返回可核对的情节结构，已完成片段保留。',{recoverable:true})}
  const o=inspirationObject(parsed,['cards'])
  if(!Array.isArray(o.cards)||(kind==='arc'&&o.cards.length!==1)||o.cards.length>(kind==='arc'?1:3))throw new AppError('AI_RESPONSE_INVALID','情节卡数量无效。',{recoverable:true})
  return o.cards.map(v=>{
    const c=inspirationObject(v,['title','narrative','tags','characters','conflict','choice','outcome','turn','foreshadowing','evidence'])
    if(!Array.isArray(c.evidence)||!c.evidence.length)throw new AppError('AI_RESPONSE_INVALID','情节卡缺少原文依据。',{recoverable:true})
    inspirationText(c.narrative,kind==='scene'?1600:2400,1)
    for(const key of ['conflict','choice','outcome','turn','foreshadowing'])inspirationText(c[key],600)
    if(c.evidence.length>4)throw new AppError('AI_RESPONSE_INVALID','引用过多，提取结果超出单卡预算。',{recoverable:true})
    const evidence=c.evidence.map(v=>{const e=inspirationObject(v,['segmentId','quote']);const segment=segments.find(s=>s.id===e.segmentId),quote=inspirationText(e.quote,500,1);if(!segment||!segment.text.includes(quote))throw new AppError('AI_RESPONSE_INVALID','模型引用不在实际已读片段中，未保存该结果。',{recoverable:true});return {segmentId:segment.id,quote}})
    return decodeInspirationCard({...c,id:randomUUID(),sourceId:document.source.id,sourceVersion:document.source.version,segmentIds:kind==='arc'?segments.map(s=>s.id):[...new Set(evidence.map(e=>e.segmentId))],kind,evidence,model,modelFingerprint:fingerprint,extractionVersion:1,createdAt:new Date().toISOString(),stale:false})
  })
}
