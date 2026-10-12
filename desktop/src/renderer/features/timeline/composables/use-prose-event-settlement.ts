import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { SettlementCandidate, SettlementDraft, SettlementHistory, SettlementPage, SettlementPreview, SettlementSelection } from '../../../../contracts/timeline/prose-event-settlement-contracts'
type Props={workItemId:string;chapterId:number;body:string;title:string;disabled?:boolean}
const empty=():SettlementCandidate=>({fields:{time:'',characters:[],location:'',event:'',result:''},quotes:[],supplements:[]})
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value))
const busyStatus=(status:string)=>['queued','preparing','running','streaming','resuming'].includes(status)
export function useProseEventSettlement(props:Props,onSaved:()=>void){
 const api=()=>{if(!window.novelDesktop)throw new Error('桌面接口尚未就绪。');return window.novelDesktop.events}
 const open=ref(false),pending=ref(false),message=ref(''),page=ref<SettlementPage|null>(null),preview=ref<SettlementPreview|null>(null)
 const form=ref<SettlementCandidate>(empty()),editing=ref<{id:string;revision:number}|null>(null),replaces=ref<string>(),dirty=ref(false),composing=ref(false)
 const choices=reactive<Record<string,SettlementSelection&{selected:boolean}>>({}),withdrawReasons=reactive<Record<string,string>>({})
 const uncertain=ref<string|null>(null)
 let generation=0,poll:ReturnType<typeof setTimeout>|undefined
 const identity=computed(()=>JSON.stringify([props.workItemId,props.chapterId]))
 const key=computed(()=>'lanjian-settlement-draft-v1:'+identity.value)
 const locked=computed(()=>Boolean(props.disabled||composing.value||pending.value||!page.value||page.value.source.body!==props.body||page.value.source.title!==props.title))
 const fresh=computed(()=>page.value?.source.basis.fingerprint??'')
 const candidates=computed(()=>page.value?.drafts??[])
 const activeTasks=computed(()=>page.value?.tasks.filter(t=>busyStatus(t.status))??[])
 function persist(){
  try{localStorage.setItem(key.value,JSON.stringify({form:form.value,editing:editing.value,replaces:replaces.value,dirty:dirty.value,uncertain:uncertain.value}))}
  catch{message.value='本机恢复稿暂未保存，请先保存候选再离开。'}
 }
 function restore(){
  try{const value=JSON.parse(localStorage.getItem(key.value)||'null')
   if(value?.form){form.value=value.form;editing.value=value.editing;replaces.value=value.replaces;dirty.value=Boolean(value.dirty);uncertain.value=value.uncertain??null}
  }catch{message.value='本机候选恢复稿无法读取，请核对已保存候选。'}
 }
 const errorText=(error:unknown)=>error && typeof error==='object' && 'message' in error && typeof error.message==='string' ? error.message : '操作暂未完成，请保留候选并重试。'
 async function action(operation:()=>Promise<void>){
  if(pending.value)return
  const ticket=generation;pending.value=true;message.value=''
  try{await operation()}catch(error){if(ticket===generation)message.value=errorText(error)}finally{if(ticket===generation)pending.value=false}
 }
 async function refresh(){
  const ticket=generation,value=await api().chapterSettlement(props.chapterId)
  if(ticket!==generation)return
  if(page.value&&page.value.source.basis.fingerprint!==value.source.basis.fingerprint){preview.value=null;for(const c of Object.values(choices))c.selected=false}
  page.value=value
  for(const draft of value.drafts)if(!choices[draft.id]||choices[draft.id].draftRevision!==draft.revision)
   choices[draft.id]={draftId:draft.id,draftRevision:draft.revision,outcome:'new',plans:[],selected:false}
  schedule()
 }
 function schedule(){
  clearTimeout(poll)
  if(!open.value||!activeTasks.value.length)return
  const ticket=generation
  poll=setTimeout(async()=>{
   if(ticket!==generation)return
   try{
    const tasks=await Promise.all(activeTasks.value.map(t=>api().settlementTask(t.id)))
    if(ticket!==generation||!page.value)return
    for(const task of tasks){const i=page.value.tasks.findIndex(t=>t.id===task.id);if(i>=0)page.value.tasks[i]=task}
    if(tasks.some(t=>!busyStatus(t.status)))await refresh()
   }catch(error){if(ticket===generation)message.value=errorText(error)}
   finally{if(ticket===generation)schedule()}
  },1500)
 }
 async function recover(){
  if(!uncertain.value)return
  const ticket=generation,result=await api().settlementReceipt(uncertain.value)
  if(ticket!==generation)return
  message.value=result?'回执确认已保存，没有重复创建事件。':'已核对，本次尚无提交回执。请重新预览。'
  uncertain.value=null;preview.value=null;persist();await refresh();if(result)onSaved()
 }
 async function toggle(){
  open.value=!open.value
  if(open.value)await action(async()=>{await refresh();await recover()})
  else{clearTimeout(poll);preview.value=null;void api().cancelSettlement().catch(()=>undefined)}
 }
 function reset(){form.value=empty();editing.value=null;replaces.value=undefined;dirty.value=false;persist()}
 function edit(draft:SettlementDraft){
  form.value=clone({fields:draft.fields,quotes:draft.quotes,supplements:draft.supplements})
  editing.value={id:draft.id,revision:draft.revision};replaces.value=choices[draft.id]?.replaces;dirty.value=false;persist()
 }
 function review(history:SettlementHistory){
  form.value={fields:clone(history.fields),quotes:[],supplements:[...history.decision.supplements]}
  editing.value=null;replaces.value=history.decision.id;dirty.value=true;preview.value=null
  message.value='已保留原事件身份，请选择本版原句并保存复核候选。';persist()
 }
 function change(field?:keyof SettlementCandidate['fields']){
  dirty.value=true;preview.value=null
  if(field&&!form.value.supplements.includes(field))form.value.supplements.push(field)
  persist()
 }
 function addQuote(element:HTMLTextAreaElement|undefined){
  if(!element||locked.value)return
  const start=element.selectionStart,end=element.selectionEnd
  if(end<=start||end-start>2000||form.value.quotes.length>=5){message.value='请选择 1 至 2000 字符的连续原句，每项最多 5 段。';return}
  form.value.quotes.push({start,end,quote:page.value!.source.body.slice(start,end)});change()
 }
 async function save(){
  if(locked.value)return
  const ticket=generation
  await action(async()=>{
   const saved=await api().saveSettlementDraft({...clone(form.value),chapterId:props.chapterId,sourceFingerprint:fresh.value,
    ...(editing.value?{id:editing.value.id,expectedRevision:editing.value.revision}:{})})
   if(ticket!==generation)return
   await refresh()
   if(ticket!==generation)return
   const replacement=replaces.value
   choices[saved.id]={draftId:saved.id,draftRevision:saved.revision,outcome:'new',plans:[],selected:false,...(replacement?{replaces:replacement}:{})}
   edit(saved);message.value='候选已保存。选择结算方式后预览确认。'
  })
 }
 function choosePlan(draftId:string,eventId:string,checked:boolean){
  const choice=choices[draftId],plan=page.value?.source.plans.find(p=>p.eventId===eventId)
  if(!choice||!plan)return
  choice.plans=choice.plans.filter(p=>p.eventId!==eventId)
  if(checked)choice.plans.push({eventId,versionId:plan.versionId})
  preview.value=null
 }
 async function prepare(){
  if(locked.value||uncertain.value||dirty.value)return
  const selections=Object.values(choices).filter(c=>c.selected).map(({selected,...c})=>({...c,plans:c.outcome==='new'?[]:c.plans}))
  const ticket=generation
  await action(async()=>{const result=await api().previewSettlement({chapterId:props.chapterId,sourceFingerprint:fresh.value,selections:clone(selections)});if(ticket===generation)preview.value=result})
 }
 async function withdraw(history:SettlementHistory){
  if(locked.value||uncertain.value)return
  const ticket=generation
  await action(async()=>{
   const result=await api().previewSettlementWithdrawal({chapterId:props.chapterId,sourceFingerprint:fresh.value,decisionId:history.decision.id,reason:withdrawReasons[history.decision.id]||''})
   if(ticket===generation)preview.value=result
  })
 }
 async function commit(){
  if(locked.value||!preview.value||uncertain.value)return
  const ticket=generation,grant=preview.value
  uncertain.value=grant.operationId;persist();preview.value=null
  await action(async()=>{
   const result=await api().commitSettlement(grant.token)
   if(ticket!==generation)return
   uncertain.value=null;persist()
   for(const choice of Object.values(choices))choice.selected=false
   await refresh()
   if(ticket!==generation)return
   message.value=result.mirror.status==='synced'?'事件结算已确认。':'事件结算已确认，文件同步待处理；无需重复确认。'
   onSaved()
  })
 }
 async function start(){
  if(locked.value||!page.value?.source.body.trim())return
  const ticket=generation
  await action(async()=>{
   const task=await api().startSettlementExtraction({chapterId:props.chapterId,expectedWorkItemId:props.workItemId,sourceFingerprint:fresh.value,operationId:crypto.randomUUID()})
   if(ticket!==generation)return
   page.value!.tasks.unshift(task);schedule()
   if(busyStatus(task.status))message.value='正在提取候选；你可以切换作品，稍后返回核对。'
   else{
    await refresh()
    if(ticket===generation)message.value=task.status==='succeeded'?'候选提取已完成，请逐项核对。':'提取已结束，请查看任务状态和原始输出。'
   }
  })
 }
 async function stop(id:string){await action(async()=>{await api().stopSettlementTask(id);await refresh()})}
 watch(identity,()=>{
  generation++;clearTimeout(poll);open.value=false;pending.value=false;page.value=null;preview.value=null;message.value=''
  form.value=empty();editing.value=null;replaces.value=undefined;dirty.value=false;uncertain.value=null
  for(const k of Object.keys(choices))delete choices[k]
  restore();void api().cancelSettlement().catch(()=>undefined)
 },{immediate:true})
 watch(()=>[props.body,props.title,props.disabled],()=>{preview.value=null;void api().cancelSettlement().catch(()=>undefined)})
 onBeforeUnmount(()=>{generation++;clearTimeout(poll);persist();void api().cancelSettlement().catch(()=>undefined)})
 return {open,pending,message,page,preview,form,editing,replaces,dirty,composing,choices,withdrawReasons,uncertain,locked,fresh,candidates,activeTasks,
  toggle,refresh:()=>action(refresh),recover:()=>action(recover),reset,edit,review,change,addQuote,save,choosePlan,prepare,withdraw,commit,start,stop}
}
