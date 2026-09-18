import { ref,onMounted,onBeforeUnmount } from 'vue'
import type { LocalModelsApi,LocalModelView } from '../../../../contracts/models/local-model-contracts'
export function useLocalModels(api:LocalModelsApi){
  const models=ref<LocalModelView[]>([]),loading=ref(false),checking=ref(''),error=ref('')
  let disposed=false,timer:ReturnType<typeof setInterval>|undefined,epoch=0
  async function refresh(){const current=++epoch;try{const rows=await api.list();if(!disposed&&current===epoch)models.value=rows}catch{if(!disposed)error.value='模型商店暂时无法读取，请重试。'}}
  async function inspect(id:string){if(checking.value)return;checking.value=id;error.value=''
    timer=setInterval(()=>void refresh(),500)
    try{await api.inspect(id);await refresh()}catch{if(!disposed)error.value='模型检测未完成，请重试。'}
    finally{clearInterval(timer);if(!disposed)checking.value=''}
  }
  async function cancel(){if(checking.value)await api.cancel(checking.value)}
  onMounted(async()=>{loading.value=true;await refresh();if(!disposed)loading.value=false})
  onBeforeUnmount(()=>{disposed=true;epoch++;clearInterval(timer);if(checking.value)void api.cancel(checking.value).catch(()=>{})})
  return {models,loading,checking,error,refresh,inspect,cancel}
}

