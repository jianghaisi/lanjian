<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import type { FieldAssistantApi } from '../../../../contracts/assistant/field-assistant-contracts'
import type { ModelCatalogChoice, ModelConnectionSummary } from '../../models/services/model-catalog'
import AssistantTaskHistory from './AssistantTaskHistory.vue'
import { copyAssistantText } from '../services/assistant-clipboard'
import { useAssistantReading } from '../composables/use-assistant-reading'
import { useAssistantPanelWidth } from '../composables/use-assistant-panel-width'
import AssistantReplyComparison from './AssistantReplyComparison.vue'
import type { AssistantRunView } from '../../../../contracts/assistant/assistant-run-contracts'
import type { AuthorAnswer } from '../../../../contracts/assistant/author-interaction-contracts'
import { fieldScope, availableFields, fieldAssistantIntent, fieldRegistry } from '../services/assistant-field-registry'
import { useFieldAssistant } from '../composables/use-field-assistant'
import AssistantChatSurface from './AssistantChatSurface.vue'
import AssistantDocument from './AssistantDocument.vue'
import AssistantSendReview from './AssistantSendReview.vue'
import { assistantCharacterCount, appendAssistantQuote, appendAssistantRequest, assistantInstructionLimit, type AssistantTurn } from '../services/assistant-presentation'
import FieldAssistantCandidate from './FieldAssistantCandidate.vue'
import AuthorQuestionCard from './AuthorQuestionCard.vue'
import StudioIcon from '../../../ui/StudioIcon.vue'
import ModelCatalogPicker from '../../models/components/ModelCatalogPicker.vue'
import ApplicationModelSettings from '../../models/components/ApplicationModelSettings.vue'
import type { AssistantWorkspaceId } from '../../../../contracts/assistant/assistant-workspace-contracts'

const props=defineProps<{api:FieldAssistantApi;page:string;pageLabel:string;hasBook:boolean;hasChapter:boolean;chapterId?:number|null;selectedCharacters?:number;proseSnapshot?:string;taskActive:boolean;visible?:boolean;alwaysConfirmBeforeSend?:boolean;models?:ModelCatalogChoice[];connections?:ModelConnectionSummary[];navigateHandler?:(id:AssistantWorkspaceId)=>Promise<void>;proseHandler?:(input:{message:string;taskId?:string;operationId?:string;model?:string;connectionId?:string;maxTokensOverride?:number})=>Promise<void>}>()
const open=defineModel<boolean>('open',{required:true}),mode=defineModel<string>('mode',{required:true})
// A Teleport root cannot inherit a parent's v-show. Hide the actual panel while
// retaining the author's open preference and the mounted draft owner.
const shown=computed(()=>open.value&&props.visible!==false)
const portal=ref<HTMLDialogElement|null>(null),composer=ref<HTMLTextAreaElement>(),taskHistory=ref<InstanceType<typeof AssistantTaskHistory>>()
const assistant=useFieldAssistant(props.api,{page:()=>props.page,chapterId:()=>props.chapterId||null,selectedCharacters:()=>props.selectedCharacters||0,proseSnapshot:()=>props.proseSnapshot||'',requiresPreview:()=>Boolean(props.hasBook&&props.alwaysConfirmBeforeSend),navigate:async id=>{if(!props.navigateHandler)throw new Error('当前作品暂时无法定位目标。');await props.navigateHandler(id)},prose:async input=>{if(!props.proseHandler)throw new Error('请先打开要处理的章节。');await props.proseHandler(input)}})
const {memory,context,run,runHistory,historyState,runHistoryState,waiting,answerBusy,runStatusError,refreshingRun,instruction,busy,error,progressText,reviewText,reviewPreparing,reviewCurrent,turns,history,candidate,applying,undo,canUndo,receiptPending,currentCandidate,message,model,connectionId,maxTokensOverride}=assistant
const {questionDraft,position:readingPosition,revision:restoreRevision,loading:restoringChat,saving:chatSaving,saveError:chatSaveError,canRetry:canRetrySave}=memory
const answerDraftStatus=computed(()=>restoringChat.value?'正在恢复回答…':chatSaveError.value?'回答尚未保存':chatSaving.value?'正在保存…':questionDraft.value?.runId===run.value?.id&&questionDraft.value?.questionId===run.value?.question?.id&&questionDraft.value?.questionVersion===run.value?.question?.version?'回答已保留在本机':'填写后保留草稿，提交后才会继续')
const pendingContent=ref<HTMLElement>()
const pendingJump=computed(()=>receiptPending.value?'查看待确认操作':run.value?.question&&run.value.status==='waiting-input'?'查看待答问题':candidate.value?.status==='candidate'?'查看修改候选':waiting.value&&!busy.value?'查看待处理任务':'')
const pendingKey=computed(()=>JSON.stringify([pendingJump.value,run.value?.id,run.value?.question?.id,run.value?.question?.version,candidate.value?.id]))
const sendReview=ref<InstanceType<typeof AssistantSendReview>>()
function scrollChatTarget(target?:HTMLElement){
  const scroll=target?.closest<HTMLElement>('[data-testid="copilot-chat-view-scroll"]')
  if(target&&scroll)scroll.scrollTo({top:scroll.scrollTop+target.getBoundingClientRect().top-scroll.getBoundingClientRect().top-8,behavior:'instant'})
}
async function revealPending(){
  if(!pendingJump.value)return
  const focus=chatFocusRequest(),key=pendingKey.value
  const target=()=>receiptPending.value?pendingContent.value?.querySelector<HTMLButtonElement>('[data-field-receipt-retry]')||pendingContent.value:pendingContent.value
  await focus(target,()=>pendingKey.value===key,()=>scrollChatTarget(target()))
}
async function revealReview(){
  const text=reviewText.value
  await chatFocusRequest()(()=>sendReview.value?.element,()=>Boolean(text)&&reviewText.value===text,()=>scrollChatTarget(sendReview.value?.element))
}
async function returnToComposer(){await chatFocusRequest()(()=>composer.value)}
async function prepareReview(action:()=>Promise<void>){
  const focus=chatFocusRequest(),draft=instruction.value
  await action()
  const text=reviewText.value
  await focus(()=>sendReview.value?.element,()=>Boolean(text)&&reviewText.value===text&&reviewCurrent.value&&!busy.value&&!error.value&&instruction.value===draft,()=>scrollChatTarget(sendReview.value?.element))
}
const conversation=ref<HTMLElement>(),showFind=ref(false),contextOpen=ref(false),findInput=ref<HTMLInputElement>()
const findToggle=ref<HTMLButtonElement>()
let composeVersion=0,focusVersion=0,disposed=false,findReturn:HTMLElement|null=null
function chatFocusRequest(){
  const ticket=++focusVersion,epoch=fieldScope.epoch,page=props.page,origin=document.activeElement
  return async(target:()=>HTMLElement|undefined,accept:()=>boolean=()=>true,after?:()=>void)=>{
    await nextTick()
    if(disposed||ticket!==focusVersion||epoch!==fieldScope.epoch||page!==props.page||!shown.value||mode.value!=='agent'||!accept())return false
    const active=document.activeElement
    // Only our own removed/hidden control may hand focus back through the body.
    if(active!==origin&&!(active===document.body&&(!origin?.isConnected||!origin.getClientRects().length)))return false
    const element=target()
    if(!element?.isConnected||!element.getClientRects().length||element.matches(':disabled')||element.closest('[inert]'))return false
    element.focus({preventScroll:true});after?.();return true
  }
}
const replyComparison=ref<InstanceType<typeof AssistantReplyComparison>>()
function locateReply(turn:AssistantTurn){
  if(!shown.value||mode.value!=='agent'||turn.role!=='assistant')return
  const index=turns.value.indexOf(turn)
  if(index<0)return
  const target=conversation.value?.querySelector<HTMLElement>(`:scope > .assistant-chat-message[data-turn-index="${index}"]`)
  const scroll=target?.closest<HTMLElement>('[data-testid="copilot-chat-view-scroll"]')
  if(!target?.getClientRects().length||!scroll)return
  scroll.scrollTo({top:scroll.scrollTop+target.getBoundingClientRect().top-scroll.getBoundingClientRect().top-8,behavior:'instant'})
  target.focus({preventScroll:true})
}
const findEnabled=computed(()=>shown.value&&mode.value==='agent'&&showFind.value)
const {query:findQuery,matches:findMatches,active:findActive,limited:findLimited,searching:findSearching,headings,jump:jumpMatch,jumpHeading}=useAssistantReading(conversation,findEnabled)
const findStatus=computed(()=>!findQuery.value?'输入关键词':findSearching.value?'查找中…':!findMatches.value?'没有匹配':findActive.value<0?`${findLimited.value?'前':'共'} ${findMatches.value} 处`:`${findActive.value+1} / ${findMatches.value}${findLimited.value?'+':''}`)
const panelWidth=useAssistantPanelWidth(),expandedWidth=panelWidth.width
watch(()=>fieldScope.workItemId,()=>{findQuery.value='';showFind.value=false})
async function returnFromHistory(){const focus=chatFocusRequest();mode.value='agent';await focus(()=>composer.value)}
function resumeHistory(item:AssistantRunView){assistant.viewRun(item);void returnFromHistory()}
function editRequest(text:string){void compose(text)}
function retryRequest(){void editRequest([...turns.value].reverse().find(t=>t.role==='user'&&!t.answerSubmissionId)?.content||run.value?.goal||'')}
watch(()=>fieldAssistantIntent.serial,async()=>{const focus=chatFocusRequest();portal.value=fieldRegistry.get(fieldAssistantIntent.key)?.element?.closest('dialog[open]') as HTMLDialogElement|null;open.value=true;mode.value='agent';await focus(()=>composer.value)})
watch(open,value=>{if(value){void assistant.refreshHistory();void assistant.refreshRuns()}})
watch(mode,value=>{if(value==='tasks'){void assistant.refreshHistory();void assistant.refreshRuns()}})
async function submitQuestionAnswers(answers:AuthorAnswer[]){
  const focus=chatFocusRequest(),id=run.value?.id
  await assistant.submitAnswers(answers)
  await focus(()=>composer.value,()=>run.value?.id===id&&(run.value?.status==='running'||run.value?.status==='completed'))
}
const expanded=ref(false), copied=ref<number|null>(null), copyError=ref(''), quoteError=ref(''), composeNotice=ref('')
const canSend=computed(()=>Boolean(instruction.value.trim())&&instruction.value.length<=assistantInstructionLimit&&!busy.value&&!applying.value&&!receiptPending.value&&!props.taskActive&&!waiting.value&&!answerBusy.value&&!restoringChat.value&&!reviewPreparing.value)
const composerStatus=computed(()=>{
  if(receiptPending.value)return '文字已保留，本次操作记录待确认。'
  if(runStatusError.value)return '进度暂时无法读取，原任务可能仍在运行。'
  if(reviewPreparing.value)return '正在准备发送核对，输入内容会保留。'
  if(busy.value)return progressText.value||'正在处理本轮要求……'
  if(waiting.value){
    if(run.value?.needsResume)return '任务待恢复，请先核对上方内容。'
    if(run.value?.status==='waiting-input')return '等待你的回答，请先完成上方的问题。'
    return run.value?.message||'请先处理上方的任务，再继续发送。'
  }
  if(props.taskActive)return '写作任务进行中，可以先在这里写下下一条要求。'
  return run.value?.status==='cancelled'?'本轮已停止，可以修改要求后再次发送。':''
})
let capturedQuote:{index:number;text:string|null}|null=null,clipboardVersion=0
watch(instruction,()=>{quoteError.value='';composeNotice.value=''}, {flush:'sync'})
async function submitMessage(){if(canSend.value)await prepareReview(reviewText.value&&!reviewCurrent.value?assistant.previewContext:assistant.send)}
function composerKeydown(event:KeyboardEvent){
  if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.isComposing&&event.keyCode!==229){event.preventDefault();void submitMessage()}
}
function selectedMessageText(event:Event){
  const body=(event.currentTarget as HTMLElement).closest('article')?.querySelector('.assistant-message-body')
  const selection=window.getSelection()
  if(!body||!selection||selection.isCollapsed||!selection.rangeCount)return null
  const range=selection.getRangeAt(0)
  return body.contains(range.startContainer)&&body.contains(range.endContainer)?selection.toString():null
}
function captureQuote(index:number,event:Event){capturedQuote={index,text:selectedMessageText(event)}}
async function quoteTurn(index:number,event:Event){
  const turn=turns.value[index];if(!turn)return
  copyError.value=''
  const fromPointer=event instanceof MouseEvent&&event.detail>0&&capturedQuote?.index===index
  const selection=fromPointer?capturedQuote!.text:selectedMessageText(event);capturedQuote=null
  const result=appendAssistantQuote(instruction.value,selection??turn.content,turn.role)
  if(result.value===undefined){quoteError.value=result.error;return}
  const focus=chatFocusRequest(),value=result.value
  instruction.value=value;quoteError.value=''
  await focus(()=>composer.value,()=>instruction.value===value,()=>composer.value?.setSelectionRange(value.length,value.length))
}
watch(turns,()=>{clipboardVersion++;copied.value=null;copyError.value='';quoteError.value='';capturedQuote=null})
const contextFields=computed(()=>availableFields.value.filter(item=>item.element&&item.target.pageId===props.page))
async function copyTurn(index:number){
  const turn=turns.value[index];if(!turn)return
  copied.value=null
  const ticket=++clipboardVersion,epoch=fieldScope.epoch,text=turn.content
  const current=()=>ticket===clipboardVersion&&epoch===fieldScope.epoch&&shown.value&&mode.value==='agent'&&turns.value[index]===turn&&turn.content===text
  quoteError.value=''
  try{if(await copyAssistantText(text,current)){copied.value=index;copyError.value=''}}catch{if(current())copyError.value='复制未完成，可以直接选择文字复制。'}
}
async function openFind(){
  const focus=chatFocusRequest(),origin=document.activeElement
  if(origin instanceof HTMLElement&&!origin.closest('.assistant-find-bar'))findReturn=origin
  mode.value='agent';showFind.value=true
  await focus(()=>findInput.value,()=>showFind.value,()=>findInput.value?.select())
}
async function closeFind(){
  const focus=chatFocusRequest(),origin=findReturn;findReturn=null;showFind.value=false
  await focus(()=>origin?.isConnected&&origin.getClientRects().length&&!origin.matches(':disabled')&&!origin.closest('[inert]')?origin:findToggle.value,()=>!showFind.value)
}
function findKeydown(event:KeyboardEvent){
  if(event.isComposing||event.keyCode===229)return
  if(event.key==='Enter'){event.preventDefault();event.stopPropagation();jumpMatch(event.shiftKey?-1:1)}
}
function panelKeydown(event:KeyboardEvent){
  if(event.isComposing||event.keyCode===229)return
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'){event.preventDefault();event.stopPropagation();if(mode.value==='tasks')void taskHistory.value?.focusFind();else void openFind();return}
  if(event.key==='Escape'&&((mode.value==='agent'&&showFind.value)||expanded.value)){event.preventDefault();event.stopPropagation();if(mode.value==='agent'&&showFind.value)void closeFind();else expanded.value=false}
}
watch(open,value=>{if(!value)expanded.value=false})
function closePortal(event:Event){if(event.target===portal.value){portal.value=null;closeAssistant()}}
onMounted(()=>document.addEventListener('close',closePortal,true))
function closeAssistant(){composeVersion++;focusVersion++;findReturn=null;composeNotice.value='';open.value=false}
function selectMode(value:string){composeVersion++;focusVersion++;if(value!=='agent')findReturn=null;composeNotice.value='';mode.value=value}
watch([shown,mode],([visible,tab],[wasVisible,previousTab])=>{if((wasVisible&&!visible)||(previousTab!==tab&&tab!=='agent')){composeVersion++;focusVersion++;findReturn=null;composeNotice.value=''}}, {flush:'sync'})
watch([()=>props.page,()=>fieldScope.epoch],()=>{composeVersion++;focusVersion++;findReturn=null;composeNotice.value=''}, {flush:'sync'})
onBeforeUnmount(()=>{disposed=true;composeVersion++;focusVersion++;clipboardVersion++;findReturn=null;document.removeEventListener('close',closePortal,true)})
async function compose(text:string){
  const version=++composeVersion,epoch=fieldScope.epoch,focus=chatFocusRequest()
  if(!await memory.ready()||disposed||version!==composeVersion||epoch!==fieldScope.epoch)return false
  const previous=instruction.value,result=appendAssistantRequest(previous,text)
  copyError.value='';quoteError.value='';composeNotice.value=''
  if(result.value===undefined){quoteError.value=result.error;return false}
  open.value=true;mode.value='agent';instruction.value=result.value
  composeNotice.value=previous===result.value?'这条要求已在输入框中，可继续修改。':previous?'已追加到当前输入，原草稿已保留。':'已填入输入框，可修改后发送。'
  return focus(()=>composer.value,()=>version===composeVersion&&instruction.value===result.value,()=>composer.value?.setSelectionRange(instruction.value.length,instruction.value.length))
}
async function sendInstruction(text:string){if(await compose(text)&&instruction.value===text)await submitMessage()}
defineExpose({sendInstruction,compose})
</script>
<template>
  <Teleport :disabled="!portal" :to="portal || 'body'">
  <Transition name="workbench-drawer">
  <aside v-show="shown" :inert="!shown || undefined" :aria-hidden="!shown" id="assistant-drawer" class="assistant-panel global-assistant-host assistant-workspace" :style="{'--assistant-expanded-width':expandedWidth+'px'}" :class="{'application-assistant':!hasBook,'dialog-assistant':Boolean(portal),'assistant-expanded':expanded}" role="complementary" aria-label="智能助笔" data-testid="assistant-sidebar" :data-layout="expanded?'expanded':'sidebar'" @keydown="panelKeydown">
    <div v-if="expanded" class="assistant-overlay-resizer" role="separator" tabindex="0" aria-label="调整宽屏助笔宽度" aria-orientation="vertical" :aria-valuenow="expandedWidth" :aria-valuemin="480" :aria-valuemax="1200" @pointerdown="panelWidth.begin" @keydown="panelWidth.keyboard" @dblclick="panelWidth.reset" title="拖动调整宽度；双击恢复默认"/>
    <header><div><StudioIcon name="spark" :size="18"/><span>智能助笔</span></div><nav class="assistant-mode-switch" aria-label="智能助笔区域"><button v-for="tab in [{id:'agent',label:'对话'},{id:'checks',label:'核对'},{id:'tasks',label:'任务'}]" :key="tab.id" type="button" :class="{active:mode===tab.id}" :aria-pressed="mode===tab.id" :data-testid="`assistant-mode-${tab.id}`" @click="selectMode(tab.id)">{{ tab.label }}<span v-if="tab.id==='tasks'&&(taskActive||busy)" class="assistant-task-dot" aria-label="有待处理任务"></span></button></nav><button type="button" class="assistant-expand" data-testid="assistant-expand" :aria-label="expanded?'收起宽屏助笔':'展开宽屏助笔'" :aria-pressed="expanded" :title="expanded?'收起宽屏助笔':'展开宽屏助笔'" @click="expanded=!expanded"><StudioIcon name="panel" :size="17"/></button><button type="button" aria-label="关闭智能助笔侧栏" @click="closeAssistant"><StudioIcon name="close" :size="17"/></button></header>
    <div class="assistant-panel-body">
      <section v-show="mode==='agent'" class="assistant-mode-page assistant-agent-page" data-testid="assistant-agent-page">
        <section class="field-assistant" data-testid="field-assistant-panel">
          <details class="assistant-context-bar" data-testid="assistant-context-bar">
            <summary><span>{{ pageLabel }}</span><span v-if="selectedCharacters">已选 {{ selectedCharacters }} 字</span><span>查看当前内容</span></summary>
            <p>这里展示当前页面可供助笔定位的内容。具体读取哪些资料，由本次任务决定。</p>
            <dl v-if="contextFields.length"><template v-for="field in contextFields" :key="field.key"><dt>{{ field.target.label }}</dt><dd>{{ field.target.value === ''?'（空白）':field.target.value }}</dd></template></dl>
            <p v-else>可以直接描述要处理的设定、人物或章节，助笔会定位对应位置。</p>
          </details>
          <div class="assistant-reading-tools"><button ref="findToggle" type="button" :aria-expanded="showFind" @click="showFind?closeFind():openFind()">查找对话</button><select v-if="headings.length" aria-label="跳转回复标题" value="" @change="jumpHeading(Number(($event.target as HTMLSelectElement).value));($event.target as HTMLSelectElement).value='' "><option value="" disabled>回复目录 · {{ headings.length }} 节</option><option v-for="(heading,i) in headings" :key="i" :value="i">{{ heading.label }}</option></select><button v-if="replyComparison?.available" type="button" data-testid="assistant-open-comparison" @click="replyComparison?.openComparison()">比较回复</button><span v-if="restoringChat">恢复会话中…</span><span v-else-if="chatSaving">正在保存…</span><span v-else-if="!chatSaveError&&hasBook">会话已保留在本机</span></div>
          <div v-if="showFind" class="assistant-find-bar" role="search" aria-label="助笔对话查找"><div class="assistant-find-controls"><input ref="findInput" v-model="findQuery" data-testid="assistant-find" type="search" maxlength="256" aria-label="查找对话全文" aria-describedby="assistant-find-status" placeholder="输入关键词查找全文" @keydown="findKeydown"><span id="assistant-find-status" role="status" aria-live="polite" aria-atomic="true">{{ findStatus }}</span><button type="button" :disabled="!findMatches" @click="jumpMatch(-1)" aria-label="上一处匹配" title="上一处 · Shift+Enter">↑</button><button type="button" :disabled="!findMatches" @click="jumpMatch(1)" aria-label="下一处匹配" title="下一处 · Enter">↓</button><button type="button" @click="closeFind" aria-label="关闭对话查找" title="关闭 · Escape">×</button></div><p v-if="findLimited" class="assistant-find-limit" role="status">仅显示前 {{ findMatches }} 处，请输入更具体的关键词。</p></div>
          <AssistantChatSurface :turns="turns" :busy="busy" :position="readingPosition" :restore-revision="restoreRevision" :scope-epoch="fieldScope.epoch" :loading="restoringChat" :visible="shown&&mode==='agent'" @position="readingPosition=$event">
          <div ref="conversation" class="assistant-conversation" aria-label="助笔对话记录">
            <div v-if="!turns.length&&!candidate" class="field-assistant-intro"><span>围绕这部作品，一起推敲</span><h3>说说你想怎么改</h3><p>可以把背景、目标和顾虑一起说清楚。助笔会定位相关内容，需要你决定时先提问，修改后给你完整候选。</p><div class="assistant-starters"><button type="button" @click="compose('帮我完善核心设想，重点检查主角目标、核心冲突和故事悬念。我的想法是：')"><b>推敲设想</b><span>梳理主角目标、冲突与悬念</span></button><button type="button" @click="compose('帮我完善人物设定，重点补足动机、关系与成长变化。要讨论的人物是：')"><b>完善人物</b><span>把动机与经历接到情节里</span></button><button v-if="hasChapter" type="button" @click="compose('结合本章大纲和已有正文，帮我续写接下来的情节。希望突出：')"><b>接着写</b><span>围绕本章目标推进情节</span></button><button type="button" @click="compose('先与我讨论以下情节的几种写法，比较人物动机、节奏和后续影响，暂不修改原文。情节是：')"><b>讨论写法</b><span>比较方案，再决定怎么写</span></button></div><p class="assistant-reading-note">快捷入口只填入要求，已有草稿会保留；修改候选经你确认后才会回填。</p></div>
            <article v-for="(turn,index) in turns" :key="index" class="assistant-chat-message" :class="turn.role" :data-turn-index="index" tabindex="-1" :data-speaker="turn.role" :data-answer-submission="turn.answerSubmissionId" :aria-label="turn.answerSubmissionId?'你已提交的回答':turn.role==='user'?'你发送的消息':'智能助笔回复'">
              <header class="assistant-message-meta" :class="{'assistant-message-reading-header':turn.role==='assistant'}">
                <span class="assistant-speaker"><span class="assistant-speaker-mark" aria-hidden="true"><StudioIcon v-if="turn.role==='assistant'" name="spark" :size="13"/><svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg></span><b>{{ turn.role==='user'?(turn.answerSubmissionId?'你 · 回答':'你 · 写作要求'):'智能助笔' }}</b></span>
                <span v-if="turn.answerSubmissionId" class="assistant-message-count">已提交回答</span><span v-if="turn.incomplete" class="assistant-message-count">未完成片段</span><span class="assistant-message-count">{{ assistantCharacterCount(turn.content).toLocaleString() }} 字</span>
                <div v-if="turn.role==='assistant'" class="assistant-message-actions"><button type="button" :aria-label="`复制第 ${index+1} 条消息`" @click="copyTurn(index)">{{ copied===index?'已复制':'复制' }}</button><button type="button" :aria-label="`引用第 ${index+1} 条消息`" title="引用到输入框；可先选中消息中的几句话" @pointerdown="captureQuote(index,$event)" @click="quoteTurn(index,$event)">引用</button></div>
              </header>
              <div class="assistant-message-body"><AssistantDocument v-if="turn.role==='assistant'" :content="turn.content"/><p v-else>{{ turn.content }}</p></div>
              <details v-if="turn.tools?.length" class="assistant-tool-receipt" open><summary>处理记录 · {{ turn.tools.length }} 步</summary><ol><li v-for="(step,i) in turn.tools" :key="i">{{ step }}</li></ol></details>
              <footer v-if="turn.role==='user'" class="assistant-message-actions"><button type="button" :aria-label="`复制第 ${index+1} 条消息`" @click="copyTurn(index)">{{ copied===index?'已复制':'复制' }}</button><button type="button" :aria-label="`引用第 ${index+1} 条消息`" title="引用到输入框；可先选中消息中的几句话" @pointerdown="captureQuote(index,$event)" @click="quoteTurn(index,$event)">引用</button><button v-if="!turn.answerSubmissionId" type="button" @click="editRequest(turn.content)">编辑后再发</button></footer>
            </article>
            <article v-if="busy&&run?.partial" class="assistant-chat-message assistant assistant-streaming"><header class="assistant-message-meta">智能助笔 · {{ runStatusError?'进度待刷新':'正在回复' }}</header><div class="assistant-message-body"><AssistantDocument :content="run.partial"/></div></article>
            <AssistantReplyComparison ref="replyComparison" :turns="turns" :scope-epoch="fieldScope.epoch" :active="shown&&mode==='agent'" @locate="locateReply"/>
            <div ref="pendingContent" class="assistant-pending-content" data-testid="assistant-pending-content" tabindex="-1" :aria-label="pendingJump || '本轮处理结果'">
            <AuthorQuestionCard v-if="run?.question && run.status==='waiting-input'" v-model:draft="questionDraft" :run-id="run.id" :draft-status="answerDraftStatus" :question="run.question" :book-title="run.bookTitle" :busy="answerBusy" :unavailable="Boolean(runStatusError)||refreshingRun" :needs-resume="run.needsResume" @submit="submitQuestionAnswers" @defer="closeAssistant" @cancel="assistant.cancel" @resume="assistant.resumeRun"/>
            <section v-else-if="waiting&&!busy" class="assistant-run-wait" role="status"><p>{{ run?.message }}</p><button v-if="run?.needsResume || run?.status==='paused-limit' || run?.handoff?.result.kind==='navigate'" type="button" class="control-button primary" :disabled="answerBusy||Boolean(runStatusError)||refreshingRun" @click="assistant.resumeRun">核对后继续</button><button type="button" class="control-button secondary" @click="assistant.cancel">停止任务</button></section>
            <FieldAssistantCandidate v-if="candidate" :candidate="candidate" :current="currentCandidate" :busy="applying||(!receiptPending&&(Boolean(runStatusError)||refreshingRun))" :confirmation-pending="receiptPending" :has-undo="Boolean(undo)" :can-undo="canUndo" :message="message" @apply="assistant.apply" @undo="assistant.undoApply" @retry="assistant.retryReceipt"/>
            <button v-if="candidate?.status==='candidate' && !receiptPending && api.reject" type="button" class="control-button secondary" :disabled="applying||Boolean(runStatusError)||refreshingRun" @click="assistant.rejectCandidate">不用这份候选</button>
            </div>
            <div v-if="hasChapter" class="assistant-prose-results"><slot name="prose"/></div>
            <AssistantSendReview v-if="reviewText" ref="sendReview" :text="reviewText" :current="reviewCurrent" @return-input="returnToComposer"/>

          </div>
          <template #composer><form class="field-assistant-composer" @submit.prevent="submitMessage">
            <details v-if="turns.length" class="assistant-context-budget" data-testid="assistant-context-budget" @toggle="contextOpen=($event.target as HTMLDetailsElement).open"><summary>本次带入 {{ context.included }} 条历史<span v-if="context.omitted"> · {{ context.omitted }} 条未带入</span><span v-if="context.excerpted"> · {{ context.excerpted }} 条首尾摘录</span></summary><p>优先最近对话，上限 12 条；超长消息保留首尾并标注省略。历史全文仍在上方。当前要求完整发送，字段与资料可通过「查看本次发送内容」核对。</p><details v-for="(entry,i) in (contextOpen?context.history:[])" :key="i"><summary>{{ entry.role==='user'?'你':'助笔' }} · {{ entry.content.length }} 字符</summary><pre>{{ entry.content }}</pre></details><button type="button" :disabled="!instruction.trim()||busy||restoringChat" :aria-disabled="reviewPreparing" @click="!reviewPreparing&&prepareReview(assistant.previewContext)">查看本次发送内容</button></details>
            <p v-if="chatSaveError" class="field-assistant-error" role="alert">{{ chatSaveError }} <button v-if="canRetrySave" type="button" @click="memory.retry">重试保存</button></p>
            <div v-if="composerStatus||pendingJump||runStatusError||error||copyError||quoteError||composeNotice||reviewText" class="assistant-composer-status" data-testid="assistant-composer-status">
              <p v-if="composerStatus" class="assistant-chat-progress" role="status"><StudioIcon v-if="busy" name="spark" :size="13"/>{{ composerStatus }}</p>
              <div v-if="runStatusError||pendingJump||(reviewText&&!busy)" class="assistant-status-actions">
                <button v-if="runStatusError" type="button" data-testid="assistant-refresh-status" :disabled="refreshingRun" @click="assistant.refreshRunStatus">{{ refreshingRun?'正在读取…':'重新读取状态' }}</button>
                <button v-if="pendingJump" type="button" data-testid="assistant-reveal-pending" @click="revealPending">{{ pendingJump }} ↑</button>
                <button v-if="reviewText&&!busy" type="button" data-testid="assistant-reveal-review" @click="revealReview">查看发送核对 ↑</button>
              </div>
              <p v-if="runStatusError" class="field-assistant-error" role="alert">{{ runStatusError }} 已保留本轮文字，重新读取不会重发要求。</p>
              <p v-if="reviewText&&!busy" role="status">{{ reviewCurrent?'发送内容已准备好，核对后确认发送。':'要求或资料已变化，请更新核对后再发送。' }}</p>
              <p v-if="error" class="field-assistant-error" role="alert">{{ error }}</p><button v-if="!busy&&!waiting&&!receiptPending&&!runStatusError&&(error||run?.status==='cancelled')" type="button" @click="retryRequest">修改原要求后重试</button>
              <p v-if="copyError||quoteError" role="status">{{ copyError||quoteError }}</p>
              <p v-if="composeNotice" role="status" data-testid="assistant-compose-notice">{{ composeNotice }}</p>
            </div>
            <label for="assistant-message-draft" class="assistant-composer-label">你的下一条要求</label>
            <textarea id="assistant-message-draft" ref="composer" :disabled="restoringChat" v-model="instruction" data-testid="field-assistant-instruction" aria-label="给智能助笔发送消息" :maxlength="assistantInstructionLimit" rows="2" aria-describedby="assistant-composer-help" placeholder="描述你的想法，或引用上面的内容继续追问……" @keydown="composerKeydown"/>
            <div id="assistant-composer-help" class="assistant-composer-meta"><span>Enter 换行 · Ctrl＋Enter 发送</span><span :class="{'at-limit':instruction.length>=assistantInstructionLimit}">{{ instruction.length.toLocaleString() }} / {{ assistantInstructionLimit.toLocaleString() }}</span></div>
            <footer><ModelCatalogPicker v-if="hasBook&&connections?.length" :choices="models||[]" :connections="connections||[]" :model="model" :connection-id="connectionId" label="" :disabled="busy||taskActive" compact allow-empty allow-manual empty-label="跟随任务模型" @select="choice=>{model=choice?.model||'';connectionId=choice?.connectionId||''}"/><button v-if="busy&&!reviewPreparing" type="button" class="control-button secondary" @click="assistant.cancel">停止</button><button v-else type="submit" class="control-button primary" data-testid="send-field-assistant" :disabled="!canSend&&!reviewPreparing" :aria-disabled="!canSend" aria-label="发送给智能助笔"><StudioIcon name="arrow" :size="16"/>{{ reviewPreparing?'准备核对…':reviewText?(reviewCurrent?'确认发送':'更新核对'):'发送' }}</button></footer>
            <label v-if="connectionId === 'local:llama-cpp'" class="local-output-budget">本次最大输出 <input v-model.number="maxTokensOverride" type="number" min="128" max="4096" step="128" :disabled="busy||taskActive" aria-label="本次本地最大输出"> tokens（建议 2048）</label>
            <ApplicationModelSettings v-if="!hasBook" :api="api"/>
          </form></template>
          </AssistantChatSurface>
        </section>
      </section>
      <section v-show="mode==='checks'" class="assistant-mode-page assistant-check-page" data-testid="assistant-check-page"><slot v-if="hasBook" name="checks"/><p v-else class="field-empty">打开作品后，可在这里核对创作进度与内容一致性。</p></section>
      <section v-show="mode==='tasks'" class="assistant-mode-page assistant-task-page" data-testid="assistant-task-page">
        <AssistantTaskHistory ref="taskHistory" :api="api" :runs="runHistory" :fields="history" :run-state="runHistoryState" :field-state="historyState" :active="shown&&mode==='tasks'" :has-book="hasBook" :busy="busy" :applying="applying" :receipt-pending="receiptPending" @refresh-runs="assistant.refreshRuns(false)" @refresh-fields="assistant.refreshHistory" @return-dialogue="returnFromHistory" @view-run="resumeHistory"><slot name="tasks"/></AssistantTaskHistory>
      </section>
    </div>
  </aside>
  </Transition>
  </Teleport>
</template>

<style scoped>
button[aria-disabled="true"]{opacity:.55;cursor:not-allowed}
.local-output-budget{display:flex;align-items:center;gap:.35rem;flex-wrap:wrap;font-size:.72rem;color:var(--muted);padding:.35rem 0}.local-output-budget input{width:5.2rem;padding:.3rem;border:1px solid var(--line);color:var(--ink);background:var(--surface)}
</style>

<style src="../assets/assistant-workspace.css"></style>
