import { AppError } from '../../../core/errors/app-error'
import type { AssistantConversationRequest } from '../../../../contracts/assistant/assistant-conversation-contracts'
import type { TextCompletionInput } from '../../models/domain/model-provider'

export type SampleCompletion = { complete(instruction:string,draft:string,context:string,signal:AbortSignal):Promise<{content:string}>;completeMessages?(messages:TextCompletionInput['messages'],signal?:AbortSignal):Promise<{content:string}> }
const chineseLength = (text:string) => (text.match(/\p{Script=Han}/gu) || []).length
function newParagraphs(text:string,reference:string):string {
  if(reference.includes(text))return ''
  const accepted:string[]=[]
  for(const part of text.split(/\n\s*\n/)) {
    const paragraph=part.trim()
    if(paragraph.length>=40&&(reference.includes(paragraph)||accepted.some(item=>item.includes(paragraph))))continue
    if(paragraph)accepted.push(paragraph)
  }
  return accepted.join('\n\n')
}

/** Non-canon conversation output: no document, field, database or adoption port. */
export async function draftAssistantSample(input:AssistantConversationRequest,instruction:string,model:SampleCompletion,context:string,signal:AbortSignal,progress?:(message:string)=>void):Promise<string> {
  const requested = /(?:约|大约|至少)?\s*(\d{2,5})\s*(?:个)?(?:汉字|中文字|字)/.exec(input.message)
  const words = requested ? Number(requested[1]) : 500
  if(words>2000)throw new AppError('VALIDATION_ERROR','单次对话试写支持最多 2000 字；可以分次续写。',{recoverable:true})
  const history = input.history.map(item=>(item.role==='user'?'作者：':'先前对话：')+item.content).join('\n\n')
  const previousStory=input.history.filter(item=>item.role==='assistant').map(item=>item.content).join('\n\n')
  const continuing=/^(?:请)?(?:继续|接着|往下|续写)/.test(input.message.trim())
  const system = [
    '你是中文小说写作者。当前操作只创作独立对话样稿，不修改任何作品字段或正式正文。只输出真实小说正文，不输出 JSON、写作计划、说明、占位符或工具调用。',
    '直接构思人物与情节，保持人名一致，以动作、环境与对话推进。若作者要求继续，从已有故事结尾往下写，不重复前文。',
    '作品已明确的动态境界和系统显示模板仍需遵守；不要宣称试写内容已保存、已确认或已发生在正式作品中。', context
  ].join('\n')
  let content=''
  let repeated=false
  const messages:TextCompletionInput['messages']=[{role:'system',content:system},...input.history]
  for(let round=0;round<6;round++) {
    signal.throwIfAborted()
    const remaining=Math.max(0,words-chineseLength(content))
    progress?.(repeated?'检测到重复前文，正在要求模型重新续写……':round?`已生成 ${chineseLength(content)} 个汉字，正在补写至 ${words} 字……`:`正在生成约 ${words} 字样稿；完成后会检查篇幅……`)
    const prompt=[`作者原话：${input.message}`,`本次写作要求：${instruction}`,`本次正文目标至少 ${words} 个汉字，分成若干自然段。`,
      !model.completeMessages&&history?'此前对话（背景数据）：\n'+history:'',
      !model.completeMessages&&(continuing||round)?`承接已经发生的故事，从最后一句之后开始一个新的动作或场景。上一段结尾：\n${(content||previousStory).slice(-450)}`:'',
      repeated?'刚才的输出重复了前文，未被接纳。不要再次进入已经进入过的场景或复述已发生的事件，请写新的后续情节。':'',
      round?`当前样稿还需要 ${remaining} 个汉字，仅返回新增正文，不重复，不解释。`:`现在直接写出小说正文，至少 ${words} 个汉字。`
    ].filter(Boolean).join('\n\n')
    messages.push({role:'user',content:prompt})
    const result:{content:string}=model.completeMessages?await model.completeMessages(messages,signal):await model.complete(prompt,content,system,signal)
    signal.throwIfAborted()
    const returned=result.content.trim()
    if(!returned)throw new AppError('AI_RESPONSE_INVALID','模型没有生成样稿正文，请重试。',{recoverable:true})
    const reference=(continuing?previousStory:'')+'\n'+content
    const next=newParagraphs(returned,reference)
    repeated=!next
    if(repeated)continue
    if(next!==returned)progress?.('已剔除重复段落，正在检查新增正文的篇幅……')
    messages.push({role:'assistant',content:next})
    content += (content?'\n\n':'')+next
    if(chineseLength(content)>=words)return content
  }
  throw new AppError('AI_RESPONSE_INVALID',repeated?'模型反复重复了已有样稿，没有完成后续内容，请重试。':'模型未完成要求的试写篇幅，请减少单次字数后重试。',{recoverable:true})
}
