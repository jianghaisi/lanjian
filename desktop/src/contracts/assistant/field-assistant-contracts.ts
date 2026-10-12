import { localOutputOverride } from '../models/local-model-contracts'
import type { CreativePolicyRecord } from '@lanjian/writing-plugin-contracts'
import { decodeCreativePolicyRecords } from '../writing-plugins/creative-policy'
/** Field candidates are draft edits. They never carry a generic object path or approval tool. */
export type FieldValue = string | number | boolean
export type FieldKind = 'text' | 'markdown' | 'json' | 'number' | 'boolean' | 'enum'
export type FieldSpec = { label: string; kind: FieldKind; maxLength?: number; min?: number; max?: number; step?: number; options?: readonly FieldValue[]; scope: 'book' | 'application' | 'either'; group: string; save: 'draft' | 'preference' | 'query'; aliases?: readonly string[] }
export type FieldTarget = {
  fieldId: string; instanceId: string; editorSessionId: string; workItemId: string | null
  pageId: string; label: string; revision: number; value: FieldValue; options?: FieldValue[]
}
export type FieldRequest = { operationId: string; target: FieldTarget; instruction: string; model?: string; connectionId?: string; maxTokensOverride?: number }
export type FieldContext = { target: FieldTarget; context: string; fingerprint: string; model: string; connectionId: string }
export type FieldCandidate = {
  creativePolicy?: CreativePolicyRecord[]
  id: string; operationId: string; target: FieldTarget; before: FieldValue; after: FieldValue
  dependencyFingerprint: string; model: string; connectionId: string; createdAt: string
  status: 'candidate' | 'applied' | 'undone' | 'rejected'; appliedAt?: string
}
export type FieldTask = { id: string; target: FieldTarget; status: 'running' | 'completed' | 'failed' | 'cancelled'; createdAt: string; updatedAt: string; error?: string; candidate?: FieldCandidate; rawResult?: string }
export type FieldApplicationInput = { candidateId: string; target: FieldTarget }
export type FieldApplicationPermit = { token: string; candidateId: string; target: FieldTarget; value: FieldValue }
export type FieldAssistantApi = {
  runs?: import('./assistant-run-contracts').AssistantRunsApi
  reject?(taskId: string): Promise<FieldTask>
  conversation(input:import('./assistant-conversation-contracts').AssistantConversationRequest):Promise<import('./assistant-conversation-contracts').AssistantConversationResult>
  cancelConversation(operationId:string):Promise<boolean>
  conversationProgress?(operationId:string):Promise<import('./assistant-conversation-contracts').AssistantConversationProgress|null>
  applicationModel(): Promise<ApplicationAssistantModel>
  saveApplicationModel(input: {baseUrl:string;model:string;apiKey?:string}): Promise<ApplicationAssistantModel>
  preview(input: FieldRequest): Promise<FieldContext>
  start(input: FieldRequest): Promise<FieldTask>
  task(id: string): Promise<FieldTask>
  cancel(id: string): Promise<FieldTask>
  recent(workItemId: string | null): Promise<FieldTask[]>
  prepareApplication(input: FieldApplicationInput): Promise<FieldApplicationPermit>
  acknowledge(input: { token: string; action: 'applied' | 'undone' }): Promise<FieldCandidate>
}
export type ApplicationAssistantModel = {baseUrl:string;model:string;apiKeyConfigured:boolean}

// Both sides use these decoders. Unknown keys and unbounded context are rejected.
import { AppError } from '../core/app-error'
import { fieldSpec } from './field-target'
function invalid(): never { throw new AppError('VALIDATION_ERROR', '智能助笔请求或返回内容无效，请重新打开面板。', { recoverable: true }) }
function record(v: unknown, keys: string[]): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) return invalid()
  return v as Record<string, unknown>
}
function string(v: unknown, max = 200): string { if (typeof v !== 'string' || v.length > max) return invalid(); return v }
function number(v: unknown): number { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) return invalid(); return v }
function scalar(v: unknown): FieldValue { if (typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) return v; return string(v, 100000) }
function id(v: unknown): string { const s = string(v); if (!/^[\w.:-]{1,200}$/.test(s)) return invalid(); return s }
export function decodeFieldTarget(value: unknown): FieldTarget {
  return decodeTarget(value)
}
function decodeTarget(value: unknown, recorded = false): FieldTarget {
  const v = record(value, ['fieldId','instanceId','editorSessionId','workItemId','pageId','label','revision','value','options'])
  const fieldId = id(v.fieldId)
  // Retired total-word candidates remain readable history, never a new writable capability.
  const scope = recorded && fieldId === 'definition.bookProfile.targetWords' ? 'either' : fieldSpec(fieldId).scope
  const workItemId = v.workItemId === null ? null : string(v.workItemId, 32767)
  if (scope === 'book' && !workItemId) return invalid()
  const options = v.options === undefined ? undefined : Array.isArray(v.options) && v.options.length <= 1000 ? v.options.map(scalar) : invalid()
  return {fieldId, instanceId: id(v.instanceId), editorSessionId: id(v.editorSessionId), workItemId, pageId: id(v.pageId), label: string(v.label, 240), revision: number(v.revision), value: scalar(v.value), ...(options ? { options } : {})}
}
export function decodeFieldRequest(value: unknown): FieldRequest {
  const v = record(value, ['operationId','target','instruction','model','connectionId','maxTokensOverride'])
  const instruction = string(v.instruction, 12000)
  if (!instruction.trim()) return invalid()
  return {...localOutputOverride(v.maxTokensOverride,v.connectionId),operationId: id(v.operationId), target: decodeFieldTarget(v.target), instruction, ...(v.model === undefined ? {} : {model:string(v.model)}), ...(v.connectionId === undefined ? {} : {connectionId:id(v.connectionId)})}
}
export function decodeFieldCandidate(value: unknown): FieldCandidate {
  const v = record(value, ['id','operationId','target','before','after','dependencyFingerprint','model','connectionId','createdAt','status','appliedAt','creativePolicy'])
  if (!['candidate','applied','undone','rejected'].includes(String(v.status))) return invalid()
  return {id:id(v.id),operationId:id(v.operationId),target:decodeTarget(v.target, true),before:scalar(v.before),after:scalar(v.after),dependencyFingerprint:id(v.dependencyFingerprint),model:string(v.model),connectionId:string(v.connectionId),createdAt:string(v.createdAt),status:v.status as FieldCandidate['status'],...(v.appliedAt === undefined ? {} : {appliedAt:string(v.appliedAt)}),...(v.creativePolicy === undefined ? {} : {creativePolicy:decodeCreativePolicyRecords(v.creativePolicy)})}
}
export function decodeFieldTask(value: unknown): FieldTask {
  const v = record(value, ['id','target','status','createdAt','updatedAt','error','candidate','rawResult'])
  if (!['running','completed','failed','cancelled'].includes(String(v.status))) return invalid()
  return {id:id(v.id),target:decodeTarget(v.target, true),status:v.status as FieldTask['status'],createdAt:string(v.createdAt),updatedAt:string(v.updatedAt),...(v.error === undefined ? {} : {error:string(v.error,500)}),...(v.candidate === undefined ? {} : {candidate:decodeFieldCandidate(v.candidate)}),...(v.rawResult === undefined ? {} : {rawResult:string(v.rawResult,2_000_000)})}
}
export function decodeFieldContext(value: unknown): FieldContext {
  const v = record(value,['target','context','fingerprint','model','connectionId','maxTokensOverride'])
  return {target:decodeFieldTarget(v.target),context:string(v.context,100000),fingerprint:id(v.fingerprint),model:string(v.model),connectionId:string(v.connectionId)}
}
export function decodeFieldPermit(value: unknown): FieldApplicationPermit {
  const v=record(value,['token','candidateId','target','value'])
  return {token:id(v.token),candidateId:id(v.candidateId),target:decodeFieldTarget(v.target),value:scalar(v.value)}
}
export const decodeFieldRequestArgs = (args: unknown[]): [FieldRequest] => args.length === 1 ? [decodeFieldRequest(args[0])] : invalid()
export const decodeFieldIdArgs = (args: unknown[]): [string] => args.length === 1 ? [id(args[0])] : invalid()
export const decodeFieldScopeArgs = (args: unknown[]): [string | null] => args.length === 1 ? [args[0] === null ? null : string(args[0],32767)] : invalid()
export const decodeFieldApplicationArgs = (args: unknown[]): [FieldApplicationInput] => {
  if(args.length!==1)return invalid();const v=record(args[0],['candidateId','target']);return [{candidateId:id(v.candidateId),target:decodeFieldTarget(v.target)}]
}
export const decodeFieldAcknowledgementArgs = (args: unknown[]): [{token:string;action:'applied'|'undone'}] => {
  if(args.length!==1)return invalid();const v=record(args[0],['token','action']);if(v.action!=='applied'&&v.action!=='undone')return invalid();return [{token:id(v.token),action:v.action}]
}
export const fieldAssistantResultDecoders = {
  'assistant:reject-field': decodeFieldTask,
  'assistant:application-model':decodeApplicationAssistantModel,
  'assistant:save-application-model':decodeApplicationAssistantModel,
  'assistant:preview-field': decodeFieldContext, 'assistant:start-field':decodeFieldTask, 'assistant:field-task':decodeFieldTask, 'assistant:cancel-field':decodeFieldTask,
  'assistant:recent-fields': (value:unknown) => Array.isArray(value) && value.length <= 100 ? value.map(decodeFieldTask) : invalid(),
  'assistant:prepare-field':decodeFieldPermit, 'assistant:acknowledge-field':decodeFieldCandidate
}
export function decodeApplicationAssistantModel(value:unknown):ApplicationAssistantModel {
  const v=record(value,['baseUrl','model','apiKeyConfigured']);if(typeof v.apiKeyConfigured!=='boolean')return invalid()
  return {baseUrl:string(v.baseUrl,2000),model:string(v.model),apiKeyConfigured:v.apiKeyConfigured}
}
export function decodeApplicationAssistantModelArgs(args:unknown[]):[{baseUrl:string;model:string;apiKey?:string}]{
  if(args.length!==1)return invalid();const v=record(args[0],['baseUrl','model','apiKey'])
  const baseUrl=string(v.baseUrl,2000),model=string(v.model).trim();let url:URL
  try{url=new URL(baseUrl)}catch{return invalid()}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!model)return invalid()
  return [{baseUrl,model,...(v.apiKey===undefined?{}:{apiKey:string(v.apiKey,4000)})}]
}
