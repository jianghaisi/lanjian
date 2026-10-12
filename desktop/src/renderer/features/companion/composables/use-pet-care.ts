import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { PetCareAction, PetCareRequest, PetCareState } from '../../../../contracts/companion/companion-care'
export function usePetCare(){
  const api=window.companionCare,state=ref<PetCareState>(),error=ref(''),busy=ref(false)
  let disposed=false,stop:(()=>void)|undefined,stopError:(()=>void)|undefined,pending:PetCareRequest|undefined
  function receive(value:PetCareState){if(!disposed&&value.revision>=(state.value?.revision??0)){state.value=value;if(pending&&value.receipts.some(receipt=>receipt.id===pending!.requestId))pending=undefined}}
  async function load(){try{if(!api)throw new Error('当前环境不支持本地养成。');receive(await api.get());if(!disposed){error.value='';pending=undefined}}catch{if(!disposed)error.value='养成档案未能读取，原记录已保留。请重试或进入设置备份恢复。'}}
  async function act(action:PetCareAction):Promise<boolean>{
    if(busy.value)return false
    if(!api||!state.value){error.value||='养成档案尚未就绪，请重新读取后再试。';return false}
    if(pending&&JSON.stringify(action)!==JSON.stringify(pending.action)){error.value='上一项操作结果尚未确认，请先重试或重新读取。';return false}
    // A background tick may advance the confirmed revision after a failure.
    // Explicit retry keeps the receipt ID/action but uses the latest projection.
    const input=pending?{...pending,revision:state.value.revision}:{requestId:crypto.randomUUID(),revision:state.value.revision,action};pending=input;busy.value=true;error.value=''
    try{receive(await api.act(input));pending=undefined;return true}
    catch(reason){if(!disposed)error.value=reason instanceof Error?reason.message:'操作未完成，请重试。';return false}
    finally{if(!disposed)busy.value=false}
  }
  onMounted(()=>{stop=api?.onChange(receive);stopError=api?.onError(value=>{if(!disposed&&(value||!pending))error.value=value});void load()})
  onBeforeUnmount(()=>{disposed=true;stop?.();stopError?.()})
  // Read on explicit retry; pending remains the single owner of the request ID.
  return{state,error,busy,act,load,get pendingAction(){return pending?.action},retry:()=>pending?act(pending.action):load()}
}
