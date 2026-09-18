import type { IpcRegistrar } from '../../../platform/ipc/validated-ipc'
import { registerValidatedIpc } from '../../../platform/ipc/validated-ipc'
import { FieldAssistantService, type FieldAssistantPorts } from '../application/field-assistant-service'
import { AssistantConversationService } from '../application/assistant-conversation-service'
import { draftAssistantSample } from '../application/assistant-sample-service'
import { decodeAssistantConversationArgs } from '../../../../contracts/assistant/assistant-conversation-contracts'
import { FieldAssistantStore } from '../adapters/field-assistant-store'
import { AppError } from '../../../core/errors/app-error'
import { fieldSpec } from '../domain/assistant-field-target'
import { decodeFieldAcknowledgementArgs, decodeFieldApplicationArgs, decodeFieldIdArgs, decodeFieldRequestArgs, decodeFieldScopeArgs } from '../../../../contracts/assistant/field-assistant-contracts'
import { decodeApplicationAssistantModelArgs } from '../../../../contracts/assistant/field-assistant-contracts'
import { decodeNoArgs } from '../../../../contracts/ipc'
import { createHash, randomUUID } from 'node:crypto'
import type { ProjectService } from '../../library/application/project-service'
import type { WorkspaceService } from '../../library/application/workspace-service'
import type { SettingsStore } from '../../../platform/settings/settings-store'
import { AiClient } from '../../models/application/ai-client'

export function registerFieldAssistant(ipc:IpcRegistrar, ports:{projects:ProjectService;workspace:WorkspaceService;settings:SettingsStore;ai:AiClient;appRoot:string}) {
  const store=new FieldAssistantStore(ports.appRoot)
  ports.workspace.setDefinitionAssistantSources(async (root,ids,profile) => {
    const tasks=await store.read(root)
    return ids.map(id=>{
      const candidate=tasks.find(task=>task.candidate?.id===id)?.candidate
      const field=candidate?.target.fieldId.replace(/^(definition|AppShell)\.bookProfile\./,'')
      if(!candidate||candidate.status!=='applied'||!field||!Object.hasOwn(profile,field)||field===candidate.target.fieldId)throw new AppError('CONFLICT','字段修改来源已变化，请重新核对候选后保存。',{recoverable:true})
      return {id:randomUUID(),candidateId:candidate.id,taskId:candidate.operationId,field,model:candidate.model,appliedAt:candidate.appliedAt,savedAt:new Date().toISOString(),resultHash:createHash('sha256').update(JSON.stringify(profile[field as keyof typeof profile])).digest('hex'),source:'ai-assisted-author-draft'}
    })
  })
  registerValidatedIpc(ipc,'assistant:application-model',decodeNoArgs,()=>ports.settings.aiSettings())
  registerValidatedIpc(ipc,'assistant:save-application-model',decodeApplicationAssistantModelArgs,input=>ports.settings.updateAiSettings(input))
  const scopeByTask=new Map<string,string|null>()
  const assertScope=async(scope:string|null)=>{
    if(scope!==null && (await ports.projects.currentSummary()).id!==scope)throw new AppError('CONFLICT','已切换作品，请从当前页面重新发起助笔。',{recoverable:true})
  }
  // Application help uses only application model settings; never the previously opened book.
  const applicationAi=new AiClient({
    async resolve(){const config=await ports.settings.aiSettings();if(!config.apiKeyConfigured)throw new AppError('FEATURE_UNAVAILABLE','作品库尚未配置应用模型。你仍可查看使用说明，或打开作品后使用该作品的模型。',{recoverable:true});return {kind:'openai-compatible',connectionId:'application',connectionName:'应用模型',baseUrl:config.baseUrl,apiKey:await ports.settings.apiKey(),profile:{connectionId:'application',model:config.model,temperature:.6,topP:1,maxTokens:8192}}},
    async resolveConnection(){const config=await ports.settings.aiSettings();return {kind:'openai-compatible',connectionId:'application',connectionName:'应用模型',baseUrl:config.baseUrl,apiKey:await ports.settings.apiKey()}}
  })
  const fieldPorts:FieldAssistantPorts={
    assertScope,
    async context(target){
      await assertScope(target.workItemId)
      const spec=fieldSpec(target.fieldId)
      const help=`当前区域：${spec.group}；输入：${spec.label}。只准备一个字段的修改候选，采用到草稿后沿用页面原有保存或确认步骤。`
      if(!target.workItemId||spec.scope==='application'||spec.save==='query'||spec.save==='preference'||/设置|模型/.test(spec.group))return help
      const profile=await ports.workspace.bookProfile()
      const definition={genre:profile.genre,subgenre:profile.subgenre,coreIdea:profile.coreIdea,audienceScale:profile.audienceScale,defaultPov:profile.defaultPov,narrativeDistance:profile.narrativeDistance,writingStyle:profile.writingStyle}
      if(spec.group==='作品定义'||spec.group==='素材')return `${help}\n已保存作品定义：${JSON.stringify(definition)}`
      const [foundation,realms,system,power,cheat]=await Promise.all([ports.workspace.foundation(true),ports.workspace.realms(true),ports.workspace.systemTemplate(),ports.workspace.powerSystem(true),ports.workspace.cheatSystem(true)])
      const context=JSON.stringify({definition,worldView:foundation.worldView,useRealms:foundation.useRealms,useSystem:foundation.useSystem,realms,power,cheat,system})
      if(context.length>90000)throw new AppError('VALIDATION_ERROR','当前背景超过字段辅助的上下文容量，请缩小内容后重试。',{recoverable:true})
      await assertScope(target.workItemId)
      return `${help}\n已保存背景（不是待批准事实）：${context}`
    },
    async prepareModel(request){await assertScope(request.target.workItemId);return (request.target.workItemId?ports.ai:applicationAi).prepareCompletion('outline',request.model,request.connectionId,request.maxTokensOverride)},
    readTasks:scope=>store.read(scope),writeTask:task=>store.write(task)
  }
  const service=new FieldAssistantService(fieldPorts)
  const conversation=new AssistantConversationService({
    assertScope,context:target=>fieldPorts.context(target),
    async draftSample(input,instruction,signal,progress){
      await assertScope(input.workItemId)
      const [profile,foundation,realms,power,cheat,system]=await Promise.all([ports.workspace.bookProfile(),ports.workspace.foundation(true),ports.workspace.realms(true),ports.workspace.powerSystem(true),ports.workspace.cheatSystem(true),ports.workspace.systemTemplate()])
      const context=JSON.stringify({genre:profile.genre,writingStyle:profile.writingStyle,worldView:foundation.worldView,useRealms:foundation.useRealms,useSystem:foundation.useSystem,realms,power,cheat,system})
      const model=await ports.ai.prepareCompletion('prose',input.model,input.connectionId,input.maxTokensOverride)
      await assertScope(input.workItemId)
      return draftAssistantSample(input,instruction,{complete:async(...args)=>{await assertScope(input.workItemId);return model.complete(...args)},...(model.completeMessages?{completeMessages:async(...args:Parameters<NonNullable<typeof model.completeMessages>>)=>{await assertScope(input.workItemId);return model.completeMessages!(...args)}}:{})},context,signal,progress)
    },
    async prepare(input){await assertScope(input.workItemId);return (input.workItemId?ports.ai:applicationAi).prepareToolConversation('outline',input.model,input.connectionId,input.maxTokensOverride)},
    async cancelField(task){await service.cancel(task.id,task.target.workItemId)},
    async startField(input){const task=await service.start(input);scopeByTask.set(task.id,task.target.workItemId);return task}
  })
  registerValidatedIpc(ipc,'assistant:conversation',decodeAssistantConversationArgs,input=>conversation.run(input))
  registerValidatedIpc(ipc,'assistant:cancel-conversation',decodeFieldIdArgs,id=>conversation.cancel(id))
  registerValidatedIpc(ipc,'assistant:conversation-progress',decodeFieldIdArgs,id=>conversation.progress(id))
  const scopeFor=async(id:string)=>scopeByTask.has(id)?scopeByTask.get(id)!:(await ports.projects.currentSummary()).id
  registerValidatedIpc(ipc,'assistant:preview-field',decodeFieldRequestArgs,input=>service.preview(input))
  registerValidatedIpc(ipc,'assistant:start-field',decodeFieldRequestArgs,async input=>{const task=await service.start(input);scopeByTask.set(task.id,task.target.workItemId);return task})
  registerValidatedIpc(ipc,'assistant:field-task',decodeFieldIdArgs,async id=>service.task(id,await scopeFor(id)))
  registerValidatedIpc(ipc,'assistant:cancel-field',decodeFieldIdArgs,async id=>service.cancel(id,await scopeFor(id)))
  registerValidatedIpc(ipc,'assistant:recent-fields',decodeFieldScopeArgs,async scope=>{const tasks=await service.recent(scope);for(const task of tasks)scopeByTask.set(task.id,scope);return tasks})
  registerValidatedIpc(ipc,'assistant:prepare-field',decodeFieldApplicationArgs,input=>service.prepareApplication(input))
  registerValidatedIpc(ipc,'assistant:acknowledge-field',decodeFieldAcknowledgementArgs,input=>service.acknowledge(input.token,input.action))
  return service
}
