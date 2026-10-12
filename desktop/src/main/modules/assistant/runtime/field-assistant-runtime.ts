import type { IpcRegistrar } from '../../../platform/ipc/validated-ipc'
import { registerValidatedIpc } from '../../../platform/ipc/validated-ipc'
import { FieldAssistantService, type FieldAssistantPorts } from '../application/field-assistant-service'
import { AssistantConversationService, type AssistantConversationPorts } from '../application/assistant-conversation-service'
import { createBuiltinRegistry } from '../../writing-plugins/adapters/builtin'
import { fieldCapabilities } from '../../writing-plugins/adapters/builtin/fields'
import { domainCapabilities, type WritingDomainPorts } from '../../writing-plugins/adapters/builtin/domain-ports'
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
import { registerAssistantRuns } from './assistant-runs-runtime'
import type { WritingAgentTaskService } from '../application/writing-agent-task-service'
import type { GuestRunner } from '../../writing-plugins/domain/guest'
import { storyOutlineFieldIds } from '../../../../contracts/planning/outline-story-guidance'
import { creativePolicyRun, type CaptureCreativePolicy } from '../../writing-plugins/domain/creative-policy'
import { restoreCreativePolicy } from '../../writing-plugins/domain/creative-policy-snapshot'
import { currentCreativePolicyRun } from '../../writing-plugins/application/creative-policy-execution'

export function registerFieldAssistant(ipc:IpcRegistrar, ports:{projects:ProjectService;workspace:WorkspaceService;settings:SettingsStore;ai:AiClient;appRoot:string;domains:WritingDomainPorts;writing:WritingAgentTaskService;pluginRunner:GuestRunner;onPluginRevoked?:(id:string,bookId?:string)=>Promise<void>;applicationAi?:AiClient;creativePolicy?:CaptureCreativePolicy}) {
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
  const applicationAi=ports.applicationAi ?? new AiClient({
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
      const planningMaterials=storyOutlineFieldIds.has(target.fieldId)?await ports.workspace.planningMaterials():undefined
      const context=JSON.stringify({definition,worldView:foundation.worldView,useRealms:foundation.useRealms,useSystem:foundation.useSystem,realms,power,cheat,system,...(planningMaterials===undefined?{}:{planningMaterials,outlineScope:'只有本书正式总纲、实体与已批准素材；目标没有可验证卷章身份，不推定当前卷/章父级。'})})
      if(context.length>90000)throw new AppError('VALIDATION_ERROR','当前背景超过字段辅助的上下文容量，请缩小内容后重试。',{recoverable:true})
      await assertScope(target.workItemId)
      return `${help}\n已保存背景（不是待批准事实）：${context}`
    },
    async prepareModel(request){await assertScope(request.target.workItemId);return (request.target.workItemId?ports.ai:applicationAi).prepareCompletion('outline',request.model,request.connectionId,request.maxTokensOverride)},
    readTasks:scope=>store.read(scope),writeTask:task=>store.write(task)
  }
  const service=new FieldAssistantService(fieldPorts,ports.creativePolicy)
  const conversationPorts:AssistantConversationPorts={
    assertScope,context:target=>fieldPorts.context(target),
    async creativePolicy(input,snapshot){
      await assertScope(input.workItemId)
      const capture=input.workItemId&&ports.creativePolicy?ports.creativePolicy:async()=>creativePolicyRun()
      const policy=snapshot?await restoreCreativePolicy(capture,snapshot):await capture()
      const profile=input.workItemId?await ports.workspace.bookProfile():undefined
      policy.resolve('genre-guidance',{genre:profile?.genre||'',subgenre:profile?.subgenre||''})
      policy.resolve('assistant-conversation')
      await policy.assertAuthorized?.()
      return policy
    },
    async draftSample(input,instruction,signal,progress){
      signal.throwIfAborted()
      if(!input.workItemId||!input.chapterId)throw new AppError('VALIDATION_ERROR','对话样稿须从已确认总纲、卷纲与章纲的对应章节发起；请先审阅大纲。',{recoverable:true})
      await assertScope(input.workItemId)
      const readiness=await ports.workspace.foundationStatus(input.chapterId)
      if(!readiness.readyForProse)throw new AppError('VALIDATION_ERROR',`请先完善并由作者确认当前大纲：${readiness.missing.join('、')}`,{recoverable:true})
      const original=(await ports.workspace.chapterContractVersion(input.chapterId)).fingerprint
      const policy=currentCreativePolicyRun()??await conversationPorts.creativePolicy!(input)
      policy.resolve('assistant-sample')
      const constraints=await ports.workspace.currentRevisionConstraintsFingerprint()
      const ai=await ports.ai.captureRun(['prose'],input.connectionId)
      const identity=await ai.completionIdentity('prose',input.model,input.connectionId,input.maxTokensOverride)
      const model=await ai.prepareCompletion('prose',input.model,input.connectionId,input.maxTokensOverride)
      const context=await ports.workspace.promptContext(input.chapterId,'prose',{policyManaged:true})
      const guard=async()=>{
        signal.throwIfAborted();await assertScope(input.workItemId)
        if((await ports.workspace.chapterContractVersion(input.chapterId!)).fingerprint!==original
          ||await ports.workspace.currentRevisionConstraintsFingerprint()!==constraints
          ||await ports.ai.completionIdentity('prose',input.model,input.connectionId,input.maxTokensOverride)!==identity)throw new AppError('CONFLICT','样稿的原大纲确认、正式依据或模型已变化，请重新核对后发起。',{recoverable:true})
        await policy.assertAuthorized?.();signal.throwIfAborted()
      }
      await guard()
      return draftAssistantSample(input,instruction,model,context,signal,progress,{policy,assertAuthorized:guard})
    },
    async prepare(input){await assertScope(input.workItemId);const ai=await(input.workItemId?ports.ai:applicationAi).captureRun(['outline'],input.connectionId);return ai.prepareToolConversation('outline',input.model,input.connectionId,input.maxTokensOverride)},
    async cancelField(task){await service.cancel(task.id,task.target.workItemId)},
    async startField(input){const task=await service.start(input);scopeByTask.set(task.id,task.target.workItemId);return task}
  }
  const conversation=new AssistantConversationService(conversationPorts,input=>createBuiltinRegistry(conversationPorts,input,ports.domains),new Set([...fieldCapabilities,...domainCapabilities]))
  const pluginRuntime=registerAssistantRuns(ipc,ports,service,conversationPorts),runs=pluginRuntime.runs
  registerValidatedIpc(ipc,'assistant:conversation',decodeAssistantConversationArgs,input=>input.workItemId?ports.projects.runInCurrentBook(()=>runs.compatibility(input)):conversation.run(input))
  registerValidatedIpc(ipc,'assistant:cancel-conversation',decodeFieldIdArgs,id=>ports.projects.runInCurrentBook(async()=>{const run=(await runs.recent()).find(r=>r.operationId===id);if(run)await runs.cancel({runId:run.id,expectedRevision:run.revision});else await conversation.cancel(id);return true}))
  registerValidatedIpc(ipc,'assistant:conversation-progress',decodeFieldIdArgs,id=>ports.projects.runInCurrentBook(async()=>{const run=(await runs.recent()).find(r=>r.operationId===id);return run?{operationId:id,step:Math.min(100,run.step),message:run.message}:conversation.progress(id)}))
  const scopeFor=async(id:string)=>scopeByTask.has(id)?scopeByTask.get(id)!:(await ports.projects.currentSummary()).id
  registerValidatedIpc(ipc,'assistant:reject-field',decodeFieldIdArgs,async id=>service.reject(id,(await ports.projects.currentSummary()).id))
  registerValidatedIpc(ipc,'assistant:preview-field',decodeFieldRequestArgs,input=>service.preview(input))
  registerValidatedIpc(ipc,'assistant:start-field',decodeFieldRequestArgs,async input=>{const task=await service.start(input);scopeByTask.set(task.id,task.target.workItemId);return task})
  registerValidatedIpc(ipc,'assistant:field-task',decodeFieldIdArgs,async id=>service.task(id,await scopeFor(id)))
  registerValidatedIpc(ipc,'assistant:cancel-field',decodeFieldIdArgs,async id=>service.cancel(id,await scopeFor(id)))
  registerValidatedIpc(ipc,'assistant:recent-fields',decodeFieldScopeArgs,async scope=>{const tasks=await service.recent(scope);for(const task of tasks)scopeByTask.set(task.id,scope);return tasks})
  registerValidatedIpc(ipc,'assistant:prepare-field',decodeFieldApplicationArgs,input=>service.prepareApplication(input))
  registerValidatedIpc(ipc,'assistant:acknowledge-field',decodeFieldAcknowledgementArgs,input=>service.acknowledge(input.token,input.action))
  return { fields:service, runs, plugins:pluginRuntime.manager, setPluginToolFactory:pluginRuntime.setPluginToolFactory, abortForShutdown:()=>{ void pluginRuntime.dispose() } }
}
