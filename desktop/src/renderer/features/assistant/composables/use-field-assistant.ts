import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { FieldAssistantApi, FieldCandidate, FieldContext, FieldTask } from '../../../../contracts/assistant/field-assistant-contracts'
import type { AssistantConversationRequest } from '../../../../contracts/assistant/assistant-conversation-contracts'
import type { AssistantWorkspaceId } from '../../../../contracts/assistant/assistant-workspace-contracts'
import { assistantFieldCatalog } from '../../../../contracts/assistant/assistant-field-catalog'
import { applyFieldDraft, availableFields, fieldAssistantIntent, fieldIsCurrent, fieldRegistry, fieldScope, undoFieldDraft, markFieldSource, clearFieldSource } from '../services/assistant-field-registry'

type ConversationOptions={page():string;chapterId():number|null;selectedCharacters():number;proseSnapshot():string;requiresPreview():boolean;navigate?(id:AssistantWorkspaceId):Promise<void>;prose(input:{message:string;model?:string;connectionId?:string;maxTokensOverride?:number}):Promise<void>}
export function useFieldAssistant(api:FieldAssistantApi,options:ConversationOptions){
  const selectedKey=ref(''),instruction=ref(''),busy=ref(false),error=ref(''),preview=ref<FieldContext[]>([]),task=ref<FieldTask|null>(null),history=ref<FieldTask[]>([])
  const turns=ref<Array<{role:'user'|'assistant';content:string;tools?:string[]}>>([])
  const candidate=ref<FieldCandidate|null>(null),applying=ref(false),undo=ref<Awaited<ReturnType<typeof applyFieldDraft>>|null>(null),receiptToken=ref('')
  const model=ref(''),connectionId=ref(''),maxTokensOverride=ref(2048),reviewText=ref('')
  let generation=0,timer:ReturnType<typeof setTimeout>|undefined,conversationId='',reviewedRequest=''
  const progressText=ref('')
  let progressTimer:ReturnType<typeof setTimeout>|undefined
  async function pollProgress(epoch:number){
    if(epoch!==generation||!busy.value||!api.conversationProgress)return
    const id=conversationId
    try{if(id){const status=await api.conversationProgress(id);if(status&&epoch===generation&&id===conversationId)progressText.value=status.message}}catch{}
    if(epoch===generation&&busy.value)progressTimer=setTimeout(()=>void pollProgress(epoch),800)
  }
  const selected=computed(()=>fieldRegistry.get(selectedKey.value))
  const currentCandidate=computed(()=>Boolean(candidate.value&&fieldIsCurrent(selectedKey.value,candidate.value.target)))
  const message=computed(()=>candidate.value?.status==='applied'?'已应用到字段。请按该页面原有方式保存或执行；也可以继续修改。':candidate.value?.status==='undone'?'已撤销本次回填。':candidate.value&&!currentCandidate.value?'目标或输入已变化，这份候选不能直接采用。':'')
  watch(()=>fieldScope.workItemId,()=>{
    void cancel();selectedKey.value='';instruction.value='';task.value=null;candidate.value=null;preview.value=[];undo.value=null;receiptToken.value='';error.value='';turns.value=[];reviewedRequest='';reviewText.value=''
    void refreshHistory()
  })
  async function refreshHistory(){const scope=fieldScope.workItemId;try{const records=await api.recent(scope);if(scope===fieldScope.workItemId)history.value=records}catch{history.value=[]}}
  function request():AssistantConversationRequest{
    // The visible premise and persistent cross-page premise edit the same draft.
    const fields=availableFields.value.filter(entry=>entry.target.fieldId!=='definition.bookProfile.coreIdea'||!entry.element||!availableFields.value.some(other=>other.target.fieldId===entry.target.fieldId&&!other.element))
    const focused=fieldRegistry.get(fieldAssistantIntent.key)
    const equivalent=fields.find(entry=>entry.key===focused?.key)||fields.find(entry=>entry.target.fieldId===focused?.target.fieldId&&entry.target.fieldId==='definition.bookProfile.coreIdea')
    const recent=turns.value.slice(-12).map(turn=>({role:turn.role,content:turn.content.slice(0,3500)}))
    const lastAnswer=[...recent].reverse().find(turn=>turn.role==='assistant')
    if(lastAnswer&&candidate.value)lastAnswer.content+='\n上一份字段建议（对话背景，不是已保存内容）：'+JSON.stringify({label:candidate.value.target.label,status:candidate.value.status,value:String(candidate.value.after).slice(0,6000)})
    return JSON.parse(JSON.stringify({operationId:crypto.randomUUID(),workItemId:fieldScope.workItemId,page:options.page(),message:instruction.value.trim(),targets:fields.map(entry=>entry.target),...(equivalent?{focusedTargetId:equivalent.target.instanceId}:{}),chapterId:options.chapterId(),selectedCharacters:options.selectedCharacters(),history:recent,...(model.value?{model:model.value}:{}),...(connectionId.value?{connectionId:connectionId.value}:{}),...(connectionId.value==='local:llama-cpp'?{maxTokensOverride:maxTokensOverride.value}:{})}))
  }
  const reviewKey=(input:AssistantConversationRequest)=>JSON.stringify({...input,operationId:''})
  async function preparePreview(input:AssistantConversationRequest){
    const epoch=generation,groups=new Set<string>(),contexts:FieldContext[]=[]
    for(const target of input.targets){
      const group=assistantFieldCatalog[target.fieldId].group
      if(groups.has(group))continue;groups.add(group)
      contexts.push(await api.preview({operationId:crypto.randomUUID(),target,instruction:input.message,...(input.model?{model:input.model}:{}),...(input.connectionId?{connectionId:input.connectionId}:{}),...(input.maxTokensOverride===undefined?{}:{maxTokensOverride:input.maxTokensOverride})}))
      if(epoch!==generation)return
    }
    if(epoch===generation){preview.value=contexts;reviewText.value=JSON.stringify({message:input.message,page:input.page,history:input.history,fields:input.targets.map(t=>({label:t.label,value:t.value})),backgrounds:contexts.map(c=>c.context)},null,2);reviewedRequest=reviewKey(input)}
  }
  async function previewContext(){error.value='';if(!instruction.value.trim())return;try{await preparePreview(request())}catch(e){error.value=safeError(e)}}
  async function send(){
    if(busy.value||applying.value||!instruction.value.trim())return
    error.value='';let input=request(),proseSnapshot=options.proseSnapshot()
    const epoch=++generation;busy.value=true
    try{
      if(options.requiresPreview()&&reviewedRequest!==reviewKey(input)){await preparePreview(input);busy.value=false;return}
      candidate.value=null;undo.value=null;receiptToken.value='';preview.value=[];reviewText.value='';reviewedRequest='';task.value=null
      turns.value.push({role:'user',content:input.message});instruction.value='';conversationId=input.operationId
      progressText.value='正在理解目标并选择工具……';void pollProgress(epoch)
      let result=await api.conversation(input)
      const visited=new Set<string>(),routingTrace:string[]=[]
      while(result.kind==='navigate'){
        if(epoch!==generation)return
        const destination=result.workspaceId!
        if(!options.navigate||visited.has(destination)||visited.size>=4)throw new Error('未能定位可处理的目标，当前内容已保留。请说明具体字段、人物或章节。')
        visited.add(destination);routingTrace.push(...result.tools)
        await options.navigate(destination);await nextTick()
        if(epoch!==generation||fieldScope.workItemId!==input.workItemId)return
        // Refresh live targets after navigation, retaining the author's exact request and model choice.
        const refreshed=request()
        input={...refreshed,message:input.message,history:input.history,model:input.model,connectionId:input.connectionId,maxTokensOverride:input.maxTokensOverride}
        proseSnapshot=options.proseSnapshot();conversationId=input.operationId
        if(options.requiresPreview()){
          if(turns.value.at(-1)?.role==='user'&&turns.value.at(-1)?.content===input.message)turns.value.pop()
          await preparePreview(input);instruction.value=input.message;busy.value=false;return
        }
        result=await api.conversation(input)
      }
      if(epoch!==generation){if(result.task)void api.cancel(result.task.id).catch(()=>{});return}
      turns.value.push({role:'assistant',content:result.message,tools:[...routingTrace,...result.tools]})
      if(result.kind==='field'&&result.task){
        task.value=result.task;selectTaskTarget(result.task);await poll(epoch,result.task.id)
      }else if(result.kind==='prose'){
        if(input.chapterId!==options.chapterId()||input.page!==options.page()||proseSnapshot!==options.proseSnapshot())throw new Error('当前章节、正文或选段已变化，请重新发送这条要求。')
        await options.prose({message:result.instruction!,...(input.model?{model:input.model}:{}),...(input.connectionId?{connectionId:input.connectionId}:{}),...(input.maxTokensOverride===undefined?{}:{maxTokensOverride:input.maxTokensOverride})})
      }
    }catch(e){if(epoch===generation){error.value=safeError(e);if(!instruction.value)instruction.value=input.message}}
    finally{if(epoch===generation){clearTimeout(progressTimer);progressText.value='';conversationId='';if(task.value?.status!=='running')busy.value=false}}
  }
  async function poll(epoch:number,id:string){
    try{const result=await api.task(id);if(epoch!==generation)return;task.value=result
      if(result.status==='running'){timer=setTimeout(()=>void poll(epoch,id),450);return}
      busy.value=false;candidate.value=result.candidate||null;const answer=turns.value.at(-1);if(answer?.role==='assistant'&&result.candidate)answer.content='“'+result.target.label+'”的修改建议已准备好，可以比较后应用。';if(result.error)error.value=result.error;void refreshHistory()
    }catch(e){if(epoch===generation){error.value=safeError(e);busy.value=false}}
  }
  async function cancel(){
    generation++;clearTimeout(timer);clearTimeout(progressTimer);progressText.value='';busy.value=false
    const operation=conversationId,id=task.value?.status==='running'?task.value.id:'';conversationId=''
    if(operation)await api.cancelConversation(operation).catch(()=>{})
    if(id)await api.cancel(id).catch(()=>{})
  }
  async function apply(){
    if(!candidate.value||applying.value)return
    const value=candidate.value,key=selectedKey.value,epoch=generation
    if(!fieldIsCurrent(key,value.target)){error.value='当前输入已变化，请重新生成。';return}
    applying.value=true;error.value=''
    try{
      const permit=await api.prepareApplication({candidateId:value.id,target:JSON.parse(JSON.stringify(fieldRegistry.get(key)!.target))})
      if(epoch!==generation||!fieldIsCurrent(key,permit.target))throw new Error('目标或草稿已变化，未回填。')
      const change=await applyFieldDraft(key,value);undo.value=change;receiptToken.value=permit.token
      candidate.value=await api.acknowledge({token:permit.token,action:'applied'})
      markFieldSource(candidate.value)
      void refreshHistory()
    }catch(e){error.value=safeError(e);if(undo.value){try{undoFieldDraft(undo.value);undo.value=null}catch{error.value+=' 已保留采用后继续输入的内容。'}}}finally{applying.value=false}
  }
  async function undoApply(){
    if(!undo.value||applying.value)return;applying.value=true;error.value=''
    try{undoFieldDraft(undo.value);candidate.value=await api.acknowledge({token:receiptToken.value,action:'undone'});clearFieldSource(candidate.value);undo.value=null;void refreshHistory()}catch(e){error.value=safeError(e)}finally{applying.value=false}
  }
  function selectTaskTarget(value:FieldTask){
    const match=availableFields.value.find(e=>e.target.editorSessionId===value.target.editorSessionId&&e.target.instanceId===value.target.instanceId)
    selectedKey.value=match?.key||''
    const visible=match?.element?match:value.target.fieldId==='definition.bookProfile.coreIdea'?availableFields.value.find(e=>e.element&&e.target.fieldId===value.target.fieldId):undefined
    visible?.element?.scrollIntoView({block:'center',behavior:'smooth'})
    visible?.element?.focus({preventScroll:true})
  }
  function viewTask(value:FieldTask){task.value=value;candidate.value=value.candidate||null;preview.value=[];reviewText.value='';undo.value=null;selectTaskTarget(value)}
  onBeforeUnmount(()=>{void cancel()})
  return {selectedKey,selected,instruction,busy,error,progressText,preview,reviewText,turns,task,history,candidate,applying,undo,currentCandidate,message,model,connectionId,maxTokensOverride,send,cancel,apply,undoApply,previewContext,refreshHistory,viewTask}
}
function safeError(error:unknown){return error&&typeof error==='object'&&'message' in error?String(error.message):'操作未完成，当前输入已保留。'}
