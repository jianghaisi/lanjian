import type { ProviderToolContent } from '../models/provider-tool-content'
import type { GenerationDiagnostics } from '../models/generation-diagnostics'
import type { GeminiToolPart } from '../models/gemini-tool-content'
import { localOutputOverride } from '../models/local-model-contracts'
import { isAssistantWorkspaceId, type AssistantWorkspaceId } from './assistant-workspace-contracts'
import { AppError } from '../core/app-error'
import { decodeFieldTarget, decodeFieldTask, type FieldTarget, type FieldTask } from './field-assistant-contracts'

export type AiFunctionTool = {type:'function';function:{name:string;description:string;parameters:Record<string,unknown>}}
export type AiToolCall = {id:string;type:'function';function:{name:string;arguments:string}}
export type AiToolMessage = {role:'system'|'user'|'assistant'|'tool';content:string|null;tool_calls?:AiToolCall[];tool_call_id?:string;geminiParts?:GeminiToolPart[];providerContent?:ProviderToolContent}
export type AiToolStep = {content:string;toolCalls:AiToolCall[];geminiParts?:GeminiToolPart[];providerContent?:ProviderToolContent;diagnostics?:GenerationDiagnostics}
export type AssistantConversationProgress = { operationId:string; step:number; message:string }

export type AssistantConversationRequest = {
  operationId:string;workItemId:string|null;page:string;message:string;editorFingerprint?:string
  targets:FieldTarget[];focusedTargetId?:string;chapterId:number|null;selectedCharacters:number
  history:Array<{role:'user'|'assistant';content:string}>;model?:string;connectionId?:string;maxTokensOverride?:number
}
export type AssistantConversationResult = {
  kind:'message'|'field'|'prose'|'navigate';message:string;tools:string[];task?:FieldTask;instruction?:string;workspaceId?:AssistantWorkspaceId
}
const invalid=():never=>{throw new AppError('VALIDATION_ERROR','助笔对话请求无效，请重新发送。',{recoverable:true})}
const obj=(v:unknown,keys:string[]):Record<string,unknown>=>!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k))?invalid():v as Record<string,unknown>
const str=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max?v:invalid()
const id=(v:unknown)=>{const s=str(v,200);return /^[\w.:-]+$/.test(s)?s:invalid()}
export function decodeAssistantConversationRequest(input:unknown):AssistantConversationRequest {
  const v=obj(input,['operationId','workItemId','page','message','editorFingerprint','targets','focusedTargetId','chapterId','selectedCharacters','history','model','connectionId','maxTokensOverride'])
  const workItemId=v.workItemId===null?null:str(v.workItemId,32767),message=str(v.message,12000)
  if(!message.trim()||!Array.isArray(v.targets)||v.targets.length>120||!Array.isArray(v.history)||v.history.length>12)return invalid()
  const targets=v.targets.map(decodeFieldTarget)
  if(targets.some(t=>t.workItemId!==workItemId)||new Set(targets.map(t=>t.instanceId)).size!==targets.length||JSON.stringify(targets).length>500000)return invalid()
  const history=v.history.map(item=>{const h=obj(item,['role','content']);if(h.role!=='user'&&h.role!=='assistant')return invalid();return {role:h.role as 'user'|'assistant',content:str(h.content,12000)}})
  if(JSON.stringify(history).length>60000||v.chapterId!==null&&(!Number.isSafeInteger(v.chapterId)||Number(v.chapterId)<1)||!Number.isSafeInteger(v.selectedCharacters)||Number(v.selectedCharacters)<0||Number(v.selectedCharacters)>5000000)return invalid()
  return {...(v.editorFingerprint===undefined?{}:{editorFingerprint:/^[a-f0-9]{64}$/.test(String(v.editorFingerprint))?String(v.editorFingerprint):invalid()}),...localOutputOverride(v.maxTokensOverride,v.connectionId),operationId:id(v.operationId),workItemId,page:str(v.page,200),message,targets,chapterId:v.chapterId as number|null,selectedCharacters:Number(v.selectedCharacters),history,...(v.focusedTargetId===undefined?{}:{focusedTargetId:id(v.focusedTargetId)}),...(v.model===undefined?{}:{model:str(v.model,200)}),...(v.connectionId===undefined?{}:{connectionId:id(v.connectionId)})}
}
export function decodeAssistantConversationResult(input:unknown):AssistantConversationResult {
  const v=obj(input,['kind','message','tools','task','instruction','workspaceId']);if(!['message','field','prose','navigate'].includes(String(v.kind))||!Array.isArray(v.tools)||v.tools.length>24)return invalid()
  const result:AssistantConversationResult={kind:v.kind as AssistantConversationResult['kind'],message:str(v.message,50000),tools:v.tools.map(t=>str(t,240))}
  if(v.task!==undefined)result.task=decodeFieldTask(v.task)
  if(v.instruction!==undefined)result.instruction=str(v.instruction,12000)
  if(v.workspaceId!==undefined){if(!isAssistantWorkspaceId(v.workspaceId)||result.kind!=='navigate')return invalid();result.workspaceId=v.workspaceId}
  if(result.kind==='navigate'&&!result.workspaceId)return invalid()
  if(result.kind==='field'&&!result.task||result.kind==='prose'&&!result.instruction)return invalid()
  return result
}
export const decodeAssistantConversationArgs=(args:unknown[]):[AssistantConversationRequest]=>args.length===1?[decodeAssistantConversationRequest(args[0])]:invalid()
export function decodeAssistantConversationProgress(input:unknown):AssistantConversationProgress|null {
  if(input===null)return null
  const v=obj(input,['operationId','step','message'])
  if(!Number.isSafeInteger(v.step)||Number(v.step)<0||Number(v.step)>100)return invalid()
  return {operationId:id(v.operationId),step:Number(v.step),message:str(v.message,240)}
}
export const assistantConversationResultDecoders={
  'assistant:conversation':decodeAssistantConversationResult,
  'assistant:conversation-progress':decodeAssistantConversationProgress,
  'assistant:cancel-conversation':(value:unknown)=>value===true?true:invalid()
}
