import { useAssistantMemory } from './use-assistant-memory'
import { assistantContext } from '../services/assistant-context'
import { assistantAnswerText, recordAssistantAnswer } from '../services/assistant-answer-transcript'
import type { AssistantTurn } from '../services/assistant-presentation'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import type { FieldAssistantApi, FieldCandidate, FieldContext, FieldTask } from '../../../../contracts/assistant/field-assistant-contracts'
import type { AssistantConversationRequest } from '../../../../contracts/assistant/assistant-conversation-contracts'
import type { AssistantRunRefresh, AssistantRunView } from '../../../../contracts/assistant/assistant-run-contracts'
import { decodeAuthorAnswers, type AuthorAnswer, type AuthorAnswerSubmission } from '../../../../contracts/assistant/author-interaction-contracts'
import { assistantFieldWorkspace, isAssistantWorkspaceId } from '../../../../contracts/assistant/assistant-workspace-contracts'
import type { AssistantWorkspaceId } from '../../../../contracts/assistant/assistant-workspace-contracts'
import { assistantFieldCatalog } from '../../../../contracts/assistant/assistant-field-catalog'
import { applyFieldDraft, availableFields, fieldAssistantIntent, fieldIsComposing, fieldIsCurrent, fieldRegistry, fieldScope, undoFieldDraft, markFieldSource, clearFieldSource } from '../services/assistant-field-registry'

type ConversationOptions={page():string;chapterId():number|null;selectedCharacters():number;proseSnapshot():string;requiresPreview():boolean;navigate?(id:AssistantWorkspaceId):Promise<void>;prose(input:{message:string;taskId?:string;operationId?:string;model?:string;connectionId?:string;maxTokensOverride?:number}):Promise<void>}
export function useFieldAssistant(api:FieldAssistantApi,options:ConversationOptions){
  const selectedKey=ref(''),instruction=ref(''),busy=ref(false),error=ref(''),preview=ref<FieldContext[]>([]),task=ref<FieldTask|null>(null),history=ref<FieldTask[]>([])
  const historyState=reactive({loading:false,loaded:false,error:''}),runHistoryState=reactive({loading:false,loaded:false,error:''})
  let historyReadVersion=0,runHistoryReadVersion=0,disposed=false
  const turns=ref<AssistantTurn[]>([])
  const memory=useAssistantMemory(instruction,turns)
  const candidate=ref<FieldCandidate|null>(null),applying=ref(false),undo=ref<Awaited<ReturnType<typeof applyFieldDraft>>|null>(null),receiptToken=ref('')
  const pendingReceipt=shallowRef<{token:string;action:'applied'|'undone';candidateId:string}|null>(null)
  const receiptPending=computed(()=>Boolean(pendingReceipt.value))
  let fieldReadVersion=0
  const context=computed(()=>{
    const values=turns.value.map(turn=>({...turn}))
    const last=[...values].reverse().find(turn=>turn.role==='assistant'&&!turn.incomplete)
    if(last&&candidate.value)last.content+='\n上一份字段建议（对话背景，不是已保存内容）：'+JSON.stringify({label:candidate.value.target.label,status:candidate.value.status,value:String(candidate.value.after)})
    return assistantContext(values)
  })
  const model=ref(''),connectionId=ref(''),maxTokensOverride=ref(2048),reviewText=ref('')
  const reviewPreparing=ref(false),reviewedSource=ref('')
  let previewVersion=0
  function invalidatePreview(){previewVersion++;reviewPreparing.value=false}
  let generation=0,timer:ReturnType<typeof setTimeout>|undefined,conversationId='',reviewedRequest=''
  const progressText=ref('')
  const run=ref<AssistantRunView|null>(null),runHistory=ref<AssistantRunView[]>([]),answerBusy=ref(false)
  const runStatusError=ref(''),refreshingRun=ref(false)
  let statusReadVersion=0
  const inScope=(epoch:number,scope:string|null)=>epoch===generation&&scope===fieldScope.workItemId
  let runTimer:ReturnType<typeof setTimeout>|undefined
  const delivered=new Set<string>(),handledHandoffs=new Set<string>()
  let pendingAnswer:AuthorAnswerSubmission|undefined
  const waiting=computed(()=>Boolean(run.value&&!['completed','failed','cancelled'].includes(run.value.status)))
  let progressTimer:ReturnType<typeof setTimeout>|undefined
  async function pollProgress(epoch:number){
    if(epoch!==generation||!busy.value||!api.conversationProgress)return
    const id=conversationId
    try{if(id){const status=await api.conversationProgress(id);if(status&&epoch===generation&&id===conversationId)progressText.value=status.message}}catch{}
    if(epoch===generation&&busy.value)progressTimer=setTimeout(()=>void pollProgress(epoch),800)
  }
  const selected=computed(()=>fieldRegistry.get(selectedKey.value))
  const currentCandidate=computed(()=>Boolean(candidate.value&&fieldIsCurrent(selectedKey.value,candidate.value.target)))
  const canUndo=computed(()=>Boolean(!receiptPending.value&&undo.value&&fieldIsCurrent(undo.value.key,undo.value.target)))
  const message=computed(()=>pendingReceipt.value?(pendingReceipt.value.action==='applied'?'已回填到本页，操作记录尚未确认。当前文字已保留，请重试确认。':'本页输入已恢复，撤销记录尚未确认。重试只更新记录，不会改动文字。'):candidate.value?.status==='applied'&&undo.value&&!canUndo.value?(fieldIsComposing(undo.value.key)?'正在输入，结束输入后再撤销本次回填。':'当前输入或目标已变化，本次回填不能再直接撤销；当前内容会保留。'):candidate.value?.status==='applied'?'已应用到字段。请按该页面原有方式保存或执行；也可以继续修改。':candidate.value?.status==='undone'?'已撤销本次回填。':candidate.value&&!currentCandidate.value?'目标或输入已变化，这份候选不能直接采用。':'')
  watch(()=>fieldScope.workItemId,async scope=>{
    const restored=await memory.open(scope,()=>{
      detach();historyReadVersion++;runHistoryReadVersion++;history.value=[];Object.assign(historyState,{loading:false,loaded:false,error:''});Object.assign(runHistoryState,{loading:false,loaded:false,error:''});run.value=null;runHistory.value=[];pendingAnswer=undefined;answerBusy.value=false;applying.value=false;selectedKey.value='';instruction.value='';task.value=null;candidate.value=null;preview.value=[];undo.value=null;receiptToken.value='';pendingReceipt.value=null;error.value='';turns.value=[];reviewedRequest='';reviewText.value='';delivered.clear();handledHandoffs.clear()
    })
    if(!restored)return
    for(const turn of turns.value)if(turn.role==='assistant'&&turn.runId&&!turn.incomplete)delivered.add(turn.runId)
    void refreshHistory();void refreshRuns()
  },{immediate:true})
  async function refreshHistory(){
    if(disposed)return
    const scope=fieldScope.workItemId,scopeEpoch=fieldScope.epoch,version=++historyReadVersion
    const current=()=>!disposed&&scope===fieldScope.workItemId&&scopeEpoch===fieldScope.epoch&&version===historyReadVersion
    historyState.loading=true;historyState.error=''
    try{const records=await api.recent(scope);if(current()){history.value=records.filter(item=>item.target.workItemId===scope);historyState.loaded=true}}
    catch{if(current())historyState.error='修改记录暂时无法读取，请重试。'}
    finally{if(current())historyState.loading=false}
  }
  function request(operationId:string=crypto.randomUUID()):AssistantConversationRequest{
    // The visible premise and persistent cross-page premise edit the same draft.
    const fields=availableFields.value.filter(entry=>entry.target.fieldId!=='definition.bookProfile.coreIdea'||!entry.element||!availableFields.value.some(other=>other.target.fieldId===entry.target.fieldId&&!other.element))
    const focused=fieldRegistry.get(fieldAssistantIntent.key)
    const equivalent=fields.find(entry=>entry.key===focused?.key)||fields.find(entry=>entry.target.fieldId===focused?.target.fieldId&&entry.target.fieldId==='definition.bookProfile.coreIdea')
    const recent=context.value.history
    return JSON.parse(JSON.stringify({operationId,workItemId:fieldScope.workItemId,page:options.page(),message:instruction.value.trim(),targets:fields.map(entry=>entry.target),...(equivalent?{focusedTargetId:equivalent.target.instanceId}:{}),chapterId:options.chapterId(),selectedCharacters:options.selectedCharacters(),history:recent,...(model.value?{model:model.value}:{}),...(connectionId.value?{connectionId:connectionId.value}:{}),...(connectionId.value==='local:llama-cpp'?{maxTokensOverride:maxTokensOverride.value}:{})}))
  }
  const reviewKey=(input:AssistantConversationRequest)=>JSON.stringify({...input,operationId:''})
  const sourceKey=(input:AssistantConversationRequest,prose:string)=>JSON.stringify([{...input,operationId:'',editorFingerprint:undefined},prose])
  const currentReviewSource=computed(()=>sourceKey(request(''),options.proseSnapshot()))
  const reviewCurrent=computed(()=>Boolean(reviewText.value)&&reviewedSource.value===currentReviewSource.value)
  watch(currentReviewSource,invalidatePreview,{flush:'sync'})
  async function preparePreview(input:AssistantConversationRequest,prose=options.proseSnapshot()){
    const epoch=generation,version=++previewVersion,source=sourceKey(input,prose),groups=new Set<string>(),contexts:FieldContext[]=[]
    const current=()=>!disposed&&epoch===generation&&version===previewVersion&&source===currentReviewSource.value
    if(!current())return
    reviewPreparing.value=true
    try{
      if(api.runs&&!input.editorFingerprint)input={...input,editorFingerprint:await editorFingerprint(prose)}
      if(!current())return
      for(const target of input.targets){
        const group=assistantFieldCatalog[target.fieldId].group
        if(groups.has(group))continue;groups.add(group)
        contexts.push(await api.preview({operationId:crypto.randomUUID(),target,instruction:input.message,...(input.model?{model:input.model}:{}),...(input.connectionId?{connectionId:input.connectionId}:{}),...(input.maxTokensOverride===undefined?{}:{maxTokensOverride:input.maxTokensOverride})}))
        if(!current())return
      }
      if(current()){preview.value=contexts;reviewText.value=JSON.stringify({message:input.message,page:input.page,history:input.history,fields:input.targets.map(t=>({label:t.label,value:t.value})),backgrounds:contexts.map(c=>c.context)},null,2);reviewedRequest=reviewKey(input);reviewedSource.value=source}
    }catch(e){if(current())error.value=safeError(e)}
    finally{if(epoch===generation&&version===previewVersion)reviewPreparing.value=false}
  }
  async function previewContext(){error.value='';if(instruction.value.trim())await preparePreview(request())}
  async function send(){
    const book=fieldScope.workItemId;if(memory.loading.value)await memory.ready();if(book!==fieldScope.workItemId)return
    if(memory.loading.value||busy.value||applying.value||receiptPending.value||waiting.value||!instruction.value.trim())return
    error.value='';runStatusError.value='';refreshingRun.value=false;statusReadVersion++;const submittedDraft=instruction.value;let input=request(),proseSnapshot=options.proseSnapshot()
    const epoch=++generation;invalidatePreview();busy.value=true
    try{
      if(api.runs)input.editorFingerprint=await editorFingerprint(proseSnapshot)
      if(epoch!==generation)return
      if(options.requiresPreview()&&reviewedRequest!==reviewKey(input)){await preparePreview(input,proseSnapshot);if(inScope(epoch,book))busy.value=false;return}
      candidate.value=null;undo.value=null;receiptToken.value='';preview.value=[];reviewText.value='';reviewedRequest='';task.value=null
      turns.value.push({role:'user',content:input.message});const sentTurn=turns.value.at(-1)!;if(instruction.value===submittedDraft)instruction.value='';conversationId=input.operationId
      progressText.value='正在理解目标并选择工具……';void pollProgress(epoch)
      if(api.runs){
        const started=await api.runs.start(input)
        if(inScope(epoch,book)){sentTurn.runId=started.id;await receiveRun(started,epoch,true,proseSnapshot)}
        return
      }
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
          if(!instruction.value)instruction.value=input.message
          await preparePreview(input,proseSnapshot);if(!inScope(epoch,book))return;busy.value=false;return
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
    finally{if(epoch===generation){clearTimeout(progressTimer);progressText.value='';conversationId='';if(task.value?.status!=='running'&&run.value?.status!=='running')busy.value=false}}
  }
  async function poll(epoch:number,id:string){
    if(receiptPending.value)return
    const readVersion=fieldReadVersion
    try{const result=await api.task(id);if(epoch!==generation||readVersion!==fieldReadVersion||receiptPending.value)return;task.value=result
      if(result.status==='running'){timer=setTimeout(()=>void poll(epoch,id),450);return}
      busy.value=false;candidate.value=result.candidate||null;const answer=turns.value.at(-1);if(answer?.role==='assistant'&&result.candidate)answer.content='“'+result.target.label+'”的修改建议已准备好，可以比较后应用。';if(result.error)error.value=result.error;void refreshHistory()
    }catch(e){if(epoch===generation&&readVersion===fieldReadVersion&&!receiptPending.value){error.value=safeError(e);busy.value=false}}
  }
  function detach(){generation++;invalidatePreview();applying.value=false;statusReadVersion++;runStatusError.value='';refreshingRun.value=false;clearTimeout(timer);clearTimeout(progressTimer);clearTimeout(runTimer);progressText.value='';busy.value=false;conversationId=''}
  async function cancel(){
    const active=run.value,epoch=generation,scope=fieldScope.workItemId
    const operation=conversationId,id=task.value?.status==='running'?task.value.id:''
    if(active&&api.runs){
      try{
        const current=await api.runs.status(active.id)
        if(!inScope(epoch,scope)||run.value?.id!==active.id)return
        const cancelled=await api.runs.cancel({runId:current.id,expectedRevision:current.revision})
        if(!inScope(epoch,scope)||run.value?.id!==active.id)return
        // Any earlier status read can no longer republish the stopped state.
        statusReadVersion++;refreshingRun.value=false;runStatusError.value=''
        await receiveRun(cancelled,epoch)
      }catch(e){if(inScope(epoch,scope))error.value=safeError(e);return}
    }
    if(!inScope(epoch,scope))return
    detach()
    if(operation)await api.cancelConversation(operation).catch(()=>{})
    if(!inScope(epoch+1,scope))return
    if(id)await api.cancel(id).catch(()=>{})
  }
  async function apply(){
    if(!candidate.value||applying.value||receiptPending.value)return
    const value=candidate.value,key=selectedKey.value,epoch=generation,scope=fieldScope.workItemId
    const current=()=>inScope(epoch,scope)&&candidate.value?.id===value.id&&selectedKey.value===key
    if(!fieldIsCurrent(key,value.target)){error.value='当前输入已变化，请重新生成。';return}
    let change:Awaited<ReturnType<typeof applyFieldDraft>>|undefined
    applying.value=true;fieldReadVersion++;error.value=''
    try{
      const permit=await api.prepareApplication({candidateId:value.id,target:JSON.parse(JSON.stringify(fieldRegistry.get(key)!.target))})
      if(!current())return
      if(!fieldIsCurrent(key,permit.target))throw new Error('目标或草稿已变化，未回填。')
      change=await applyFieldDraft(key,value,current)
      if(!current())return
      undo.value=change;receiptToken.value=permit.token
      pendingReceipt.value={token:permit.token,action:'applied',candidateId:value.id}
      await confirmReceipt(epoch,scope)
    }catch(e){
      if(!current())return
      error.value=safeError(e)
      if(change){try{undoFieldDraft(change);undo.value=null;receiptToken.value=''}catch{error.value+=' 已保留采用后继续输入的内容。'}}
    }finally{if(inScope(epoch,scope)&&candidate.value?.id===value.id){applying.value=false;if(!receiptPending.value)await pollRun(epoch)}}
  }
  async function undoApply(){
    if(!undo.value||!candidate.value||applying.value||receiptPending.value)return
    const change=undo.value,value=candidate.value,token=receiptToken.value,epoch=generation,scope=fieldScope.workItemId
    const current=()=>inScope(epoch,scope)&&candidate.value?.id===value.id&&undo.value===change
    applying.value=true;fieldReadVersion++;error.value=''
    try{
      undoFieldDraft(change)
      pendingReceipt.value={token,action:'undone',candidateId:value.id}
      await confirmReceipt(epoch,scope)
    }catch(e){if(current())error.value=safeError(e)}
    finally{if(inScope(epoch,scope)&&candidate.value?.id===value.id){applying.value=false;if(!receiptPending.value)await pollRun(epoch)}}
  }
  async function confirmReceipt(epoch:number,scope:string|null){
    const receipt=pendingReceipt.value;if(!receipt)return
    const current=()=>inScope(epoch,scope)&&pendingReceipt.value===receipt&&candidate.value?.id===receipt.candidateId
    try{
      const result=await api.acknowledge({token:receipt.token,action:receipt.action})
      if(!current())return
      candidate.value=result
      if(receipt.action==='applied')markFieldSource(result)
      else{clearFieldSource(result);undo.value=null;receiptToken.value=''}
      pendingReceipt.value=null;void refreshHistory()
    }catch(e){if(current())error.value=safeError(e)}
  }
  async function retryReceipt(){
    const receipt=pendingReceipt.value;if(!receipt||applying.value)return
    const epoch=generation,scope=fieldScope.workItemId
    applying.value=true;error.value=''
    try{await confirmReceipt(epoch,scope)}
    finally{if(inScope(epoch,scope)&&candidate.value?.id===receipt.candidateId){applying.value=false;if(!receiptPending.value)await pollRun(epoch)}}
  }
  function selectTaskTarget(value:FieldTask){
    const match=availableFields.value.find(e=>e.target.editorSessionId===value.target.editorSessionId&&e.target.instanceId===value.target.instanceId)
    selectedKey.value=match?.key||''
    const visible=match?.element?match:value.target.fieldId==='definition.bookProfile.coreIdea'?availableFields.value.find(e=>e.element&&e.target.fieldId===value.target.fieldId):undefined
    visible?.element?.scrollIntoView({block:'center',behavior:'smooth'})
    visible?.element?.focus({preventScroll:true})
  }
  function viewTask(value:FieldTask){detach();applying.value=false;pendingReceipt.value=null;receiptToken.value='';run.value=null;task.value=value;candidate.value=value.candidate||null;preview.value=[];reviewText.value='';undo.value=null;selectTaskTarget(value)}
  async function editorFingerprint(value:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('')}
  async function refreshContext():Promise<AssistantRunRefresh>{const value=request();return {editorFingerprint:await editorFingerprint(options.proseSnapshot()),page:value.page,targets:value.targets,chapterId:value.chapterId,selectedCharacters:value.selectedCharacters,...(value.focusedTargetId?{focusedTargetId:value.focusedTargetId}:{})}}
  async function refreshRuns(restoreCurrent=true){
    if(disposed)return
    if(!api.runs||!fieldScope.workItemId){runHistoryState.loaded=true;return}
    const scope=fieldScope.workItemId,scopeEpoch=fieldScope.epoch,epoch=generation,version=++runHistoryReadVersion
    const current=()=>!disposed&&scope===fieldScope.workItemId&&scopeEpoch===fieldScope.epoch&&version===runHistoryReadVersion
    runHistoryState.loading=true;runHistoryState.error=''
    try{
      let values:AssistantRunView[]
      try{values=await api.runs.recent()}catch{if(current())runHistoryState.error='创作任务暂时无法读取，请重试。';return}
      if(!current())return
      values=values.filter(item=>item.workItemId===scope);runHistory.value=values;runHistoryState.loaded=true
      if(restoreCurrent&&!run.value&&epoch===generation){const value=values.find(item=>!['completed','failed','cancelled'].includes(item.status))||values.find(item=>item.id===memory.runId.value);if(value)await receiveRun(value,epoch,false)}
    }catch(e){if(current()&&epoch===generation)error.value=safeError(e)}
    finally{if(current())runHistoryState.loading=false}
  }
  async function receiveRun(value:AssistantRunView,epoch:number,automatic=false,proseSnapshot=options.proseSnapshot()){
    if(epoch!==generation||value.workItemId!==fieldScope.workItemId)return
    if(receiptPending.value||applying.value){run.value=value;busy.value=value.status==='running';return}
    if(['failed','cancelled','interrupted'].includes(value.status)&&run.value?.partial&&!turns.value.some(turn=>turn.runId===value.id&&turn.incomplete))turns.value.push({role:'assistant',content:run.value.partial,runId:value.id,incomplete:true})
    run.value=value;memory.runId.value=value.id;busy.value=value.status==='running';progressText.value=value.message
    if (['completed','cancelled'].includes(value.status) && memory.questionDraft.value?.runId===value.id) memory.questionDraft.value=null
    if(value.result&&!delivered.has(value.id)){delivered.add(value.id);turns.value.push({role:'assistant',content:value.result.message,tools:value.result.tools,runId:value.id})}
    if(value.status==='failed'||value.status==='interrupted')error.value=value.message
    const handoff=value.handoff
    if(automatic&&!value.needsResume&&handoff?.result.kind==='field'&&handoff.result.task){const page=assistantFieldWorkspace(handoff.result.task.target.fieldId);if(page&&page!==options.page()&&options.navigate){await options.navigate(page);await nextTick();if(epoch!==generation)return}}
    if(handoff?.result.kind==='field'&&handoff.result.task){const isNew=task.value?.id!==handoff.result.task.id;task.value=handoff.result.task;if(isNew)selectTaskTarget(task.value);await poll(epoch,task.value.id)}
    const handoffKey=handoff ? handoff.id+':'+(handoff.taskId||'new') : ''
    if(automatic&&!value.needsResume&&handoff&&!handledHandoffs.has(handoffKey)){
      handledHandoffs.add(handoffKey)
      try{
        if(handoff.result.kind==='navigate'){
          if(!options.navigate)throw new Error('目标页面无法打开。')
          await options.navigate(handoff.result.workspaceId!);await nextTick()
          if(epoch!==generation)return
          if(options.requiresPreview()){error.value='新页面已定位，请核对本次发送内容后点击继续。';await preparePreview({...request(),message:value.goal});return}
          await acknowledgeRun(epoch);return
        }
        if(handoff.result.kind==='prose'&&handoff.taskId)await options.prose({message:handoff.result.instruction!,taskId:handoff.taskId})
        if(handoff.result.kind==='prose'&&!handoff.taskId){
          if(value.needsResume||value.page!==options.page()||!value.editorFingerprint||value.editorFingerprint!==await editorFingerprint(proseSnapshot)||proseSnapshot!==options.proseSnapshot())throw new Error('正文或选段已变化，请核对后继续。')
          if(epoch!==generation)return
          await options.prose({message:handoff.result.instruction!,operationId:handoff.id,...(value.model?{model:value.model}:{}),...(value.connectionId?{connectionId:value.connectionId}:{}),...(value.maxTokensOverride===undefined?{}:{maxTokensOverride:value.maxTokensOverride})})
        }
      }catch(e){error.value=safeError(e)}
    }
    clearTimeout(runTimer)
    if(!value.needsResume&&(value.status==='running'||value.status==='waiting-adoption'))runTimer=setTimeout(()=>void pollRun(epoch),800)
  }
  async function pollRun(epoch:number,manual=false){
    const active=run.value,scope=fieldScope.workItemId
    if(!api.runs||!active||!inScope(epoch,scope))return
    const readVersion=++statusReadVersion
    clearTimeout(runTimer)
    refreshingRun.value=manual
    const current=()=>inScope(epoch,scope)&&run.value?.id===active.id&&readVersion===statusReadVersion
    try{
      let value:AssistantRunView
      try{value=await api.runs.status(active.id)}catch(e){
        if(current())runStatusError.value=safeError(e)
        return
      }
      if(!current())return
      runStatusError.value=''
      if(receiptPending.value||applying.value){run.value=value;busy.value=value.status==='running';return}
      if(!manual&&value.status==='waiting-adoption'&&!value.needsResume){run.value=value;await acknowledgeRun(epoch);return}
      await receiveRun(value,epoch,!manual)
    }catch(e){if(current()){error.value=safeError(e);busy.value=false}}
    finally{if(current())refreshingRun.value=false}
  }
  async function refreshRunStatus(){await pollRun(generation,true)}
  async function acknowledgeRun(epoch:number){
    const value=run.value;if(!value?.handoff||!api.runs||receiptPending.value||applying.value)return
    const context=await refreshContext()
    if(!inScope(epoch,value.workItemId)||run.value?.id!==value.id||receiptPending.value||applying.value)return
    const result=await api.runs.acknowledgeHandoff({runId:value.id,expectedRevision:value.revision,handoffId:value.handoff.id,context})
    if(epoch===generation)await receiveRun(result,epoch,true)
  }
  async function restorePage(value:AssistantRunView,epoch:number){
    const page=value.handoff?.result.kind==='navigate'?value.handoff.result.workspaceId!:value.page
    if(page!==options.page()&&isAssistantWorkspaceId(page)&&options.navigate){await options.navigate(page);await nextTick()}
    if(epoch!==generation||fieldScope.workItemId!==value.workItemId)throw new Error('作品已切换，请回到任务所属作品。')
  }
  async function resumeRun(){
    const value=run.value;if(!api.runs||!value||answerBusy.value||receiptPending.value)return
    const epoch=generation,scope=fieldScope.workItemId,current=()=>inScope(epoch,scope)&&run.value?.id===value.id
    answerBusy.value=true;error.value=''
    try{
      await restorePage(value,epoch);if(!current())return
      const fresh=await api.runs.status(value.id);if(!current())return
      const context=await refreshContext();if(!current())return
      const result=await api.runs.resume({runId:value.id,expectedRevision:fresh.revision,context})
      if(current()){run.value=result;runStatusError.value='';if(result.handoff?.result.kind==='navigate')await acknowledgeRun(epoch);else await receiveRun(result,epoch,true)}
    }catch(e){if(current())error.value=safeError(e)}finally{if(current())answerBusy.value=false}
  }
  async function submitAnswers(answers:AuthorAnswer[]){
    const value=run.value;if(!api.runs||!value?.question||answerBusy.value)return
    const epoch=generation,scope=fieldScope.workItemId,current=()=>inScope(epoch,scope)&&run.value?.id===value.id
    answerBusy.value=true;error.value=''
    try{
      const snapshot=decodeAuthorAnswers(answers),content=assistantAnswerText(value.question,snapshot)
      await restorePage(value,epoch);if(!current())return
      const serialized=JSON.stringify(snapshot)
      if(!pendingAnswer||pendingAnswer.runId!==value.id||pendingAnswer.questionId!==value.question.id||pendingAnswer.questionVersion!==value.question.version||JSON.stringify(pendingAnswer.answers)!==serialized)pendingAnswer={runId:value.id,questionId:value.question.id,questionVersion:value.question.version,answerSubmissionId:crypto.randomUUID(),answers:snapshot}
      const submission=pendingAnswer
      const fresh=await api.runs.status(value.id);if(!current())return
      if(fresh.question?.id===value.question.id){
        const context=await refreshContext();if(!current())return
        await api.runs.resume({runId:value.id,expectedRevision:fresh.revision,context});if(!current())return
      }
      const receipt=await api.runs.answer(submission);if(!current())return
      recordAssistantAnswer(turns.value,submission,receipt,content)
      if(memory.questionDraft.value?.runId===value.id&&memory.questionDraft.value.questionId===submission.questionId&&memory.questionDraft.value.questionVersion===submission.questionVersion)memory.questionDraft.value=null
      pendingAnswer=undefined
      await pollRun(epoch)
    }catch(e){if(current())error.value=safeError(e)}finally{if(current())answerBusy.value=false}
  }
  async function viewRun(value:AssistantRunView){
    detach();applying.value=false;pendingReceipt.value=null;const epoch=generation;run.value=value;error.value='';candidate.value=null;task.value=null;undo.value=null;receiptToken.value='';preview.value=[];reviewText.value=''
    if(!turns.value.some(turn=>turn.runId===value.id))turns.value.push({role:'user',content:value.goal,runId:value.id})
    try{await receiveRun(await api.runs!.status(value.id),epoch,false)}catch(e){if(inScope(epoch,value.workItemId)){runStatusError.value=safeError(e);busy.value=value.status==='running'}}
  }
  async function rejectCandidate(){
    if(!task.value||!api.reject||applying.value||receiptPending.value)return
    const id=task.value.id,candidateId=candidate.value?.id,epoch=generation,scope=fieldScope.workItemId
    const current=()=>inScope(epoch,scope)&&task.value?.id===id&&candidate.value?.id===candidateId
    applying.value=true;fieldReadVersion++;error.value=''
    try{
      const result=await api.reject(id);if(!current())return
      task.value=result;candidate.value=result.candidate||null
    }catch(e){if(current())error.value=safeError(e)}
    finally{if(inScope(epoch,scope)&&task.value?.id===id){applying.value=false;await pollRun(epoch)}}
  }
  onBeforeUnmount(()=>{disposed=true;historyReadVersion++;runHistoryReadVersion++;historyState.loading=false;runHistoryState.loading=false;detach()})
  return {memory,context,run,runHistory,historyState,runHistoryState,waiting,answerBusy,runStatusError,refreshingRun,refreshRunStatus,submitAnswers,resumeRun,refreshRuns,viewRun,rejectCandidate,selectedKey,selected,instruction,busy,error,progressText,preview,reviewText,reviewPreparing,reviewCurrent,turns,task,history,candidate,applying,undo,canUndo,receiptPending,retryReceipt,currentCandidate,message,model,connectionId,maxTokensOverride,send,cancel,apply,undoApply,previewContext,refreshHistory,viewTask}
}
function safeError(error:unknown){return error&&typeof error==='object'&&'message' in error?String(error.message):'操作未完成，当前输入已保留。'}
