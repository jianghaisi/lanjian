import { conversationMessages } from './runs/prompt'
import { AppError } from '../../../core/errors/app-error'
import { WritingPluginDispatcher } from '../../writing-plugins/application/dispatcher'
import type { WritingPluginRegistry } from '../../writing-plugins/application/registry'
import type { AssistantConversationRequest, AssistantConversationResult, AssistantConversationProgress } from '../../../../contracts/assistant/assistant-conversation-contracts'
import type { FieldRequest, FieldTask, FieldTarget } from '../../../../contracts/assistant/field-assistant-contracts'
import type { AiFunctionTool, AiToolMessage, AiToolStep } from '../../../../contracts/assistant/assistant-conversation-contracts'
import { creativePolicyRun, type CreativePolicyRun } from '../../writing-plugins/domain/creative-policy'
import type { CreativePolicySnapshot } from '../../writing-plugins/domain/creative-policy-snapshot'
import { withCreativePolicyRun } from '../../writing-plugins/application/creative-policy-execution'

export type AssistantConversationPorts={
  assertScope(scope:string|null):Promise<void>
  context(target:FieldTarget):Promise<string>
  prepare(input:AssistantConversationRequest):Promise<{step(messages:AiToolMessage[],tools:AiFunctionTool[],signal:AbortSignal,onDelta?:(content:string)=>void):Promise<AiToolStep>}>
  startField(input:FieldRequest):Promise<FieldTask>
  cancelField(task:FieldTask):Promise<void>
  draftSample?(input:AssistantConversationRequest,instruction:string,signal:AbortSignal,progress:(message:string)=>void):Promise<string>
  creativePolicy?(input:AssistantConversationRequest,snapshot?:CreativePolicySnapshot):Promise<CreativePolicyRun>
}
export class AssistantConversationService {
  private running=new Map<string,{scope:string|null;controller:AbortController;result:Promise<AssistantConversationResult>}>()
  private statuses=new Map<string,AssistantConversationProgress>()
  constructor(private ports:AssistantConversationPorts, private registry:(input:AssistantConversationRequest)=>WritingPluginRegistry, private capabilities:ReadonlySet<string>){}
  async run(input:AssistantConversationRequest):Promise<AssistantConversationResult>{
    const old=this.running.get(input.operationId);if(old){if(old.scope!==input.workItemId)throw this.conflict();return old.result}
    input=structuredClone(input)
    const controller=new AbortController(),result=this.execute(input,controller.signal);this.running.set(input.operationId,{scope:input.workItemId,controller,result})
    this.statuses.set(input.operationId,{operationId:input.operationId,step:0,message:'正在理解目标并选择工具……'})
    try{return await result}finally{this.running.delete(input.operationId);this.statuses.delete(input.operationId)}
  }
  async progress(id:string){const operation=this.running.get(id);if(!operation)return null;await this.ports.assertScope(operation.scope);return this.statuses.has(id)?{...this.statuses.get(id)!}:null}
  private report(id:string,message:string){const status=this.statuses.get(id);if(status)this.statuses.set(id,{...status,step:Math.min(100,status.step+1),message})}
  async cancel(id:string){const operation=this.running.get(id);if(operation){await this.ports.assertScope(operation.scope);operation.controller.abort()}return true as const}
  private conflict(){return new AppError('CONFLICT','当前作品或对话已变化，请重新发送。',{recoverable:true})}
  private async execute(input:AssistantConversationRequest,signal:AbortSignal):Promise<AssistantConversationResult>{
    await this.ports.assertScope(input.workItemId)
    const policy=await this.ports.creativePolicy?.(input)??creativePolicyRun()
    const execute=async():Promise<AssistantConversationResult>=>{
    const model=await this.ports.prepare(input),trace:string[]=[]
    const assertFresh=async()=>{signal.throwIfAborted();await this.ports.assertScope(input.workItemId);await policy.assertAuthorized?.();signal.throwIfAborted()}
    const dispatcher=new WritingPluginDispatcher(this.registry(input),{workItemId:input.workItemId,allowedCapabilities:this.capabilities,signal,assertScope:assertFresh},message=>this.report(input.operationId,message))
    const messages=conversationMessages(input,[...policy.resolve('assistant-conversation'),...policy.resolve('genre-guidance',{genre:'',subgenre:''})])
    while(true){
      dispatcher.budget.modelStep()
      if(signal.aborted)throw this.conflict()
      await assertFresh()
      this.report(input.operationId,'正在核对已有结果并选择下一步……')
      const reply=await model.step(messages,dispatcher.definitions(),signal)
      if(signal.aborted)throw this.conflict()
      await assertFresh()
      if(!reply.toolCalls.length)return {kind:'message',message:reply.content,tools:trace}
      messages.push({role:'assistant',content:reply.content||null,tool_calls:reply.toolCalls,...(reply.providerContent?{providerContent:reply.providerContent}:{}),...(reply.geminiParts?{geminiParts:reply.geminiParts}:{})})
      for(const call of reply.toolCalls){
        this.report(input.operationId,'正在调用工具核对目标……')
        const outcome=await dispatcher.execute(call.function.name,call.function.arguments)
        await assertFresh()
        if(outcome.trace){trace.push(outcome.trace);if(trace.length>24)trace.shift()}
        if(outcome.kind==='handoff')return {...outcome.result,tools:[...trace,...outcome.result.tools].slice(-24)}
        if(outcome.kind==='failed')throw new AppError(outcome.code==='conflict'?'CONFLICT':outcome.code==='invalid'?'AI_RESPONSE_INVALID':'FEATURE_UNAVAILABLE',outcome.message,{recoverable:true})
        // Author question and adoption lifecycles are introduced by the next child;
        // a wait must never be reported as completed by the compatibility facade.
        if(outcome.kind!=='completed')throw new AppError('FEATURE_UNAVAILABLE','本轮工具正在等待作者处理，当前对话入口尚不能承接该状态。',{recoverable:true})
        messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify({...outcome.value as Record<string,unknown>,evidence:outcome.evidence})})
        if(JSON.stringify(messages).length>250000)throw new AppError('VALIDATION_ERROR','这次对话读取的内容过多，请缩小修改范围。',{recoverable:true})
      }
    }
    }
    return withCreativePolicyRun(policy,()=>policy.withContext?policy.withContext(execute):execute())
  }
}
