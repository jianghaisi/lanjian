import type { AiSettings, AiSettingsUpdate, AiTask,ModelProfile } from '../../../../contracts/index'
import { LOCAL_CONNECTION_ID,type LocalModelView } from '../../../../contracts/models/local-model-contracts'
export function localModelAssignment(settings:AiSettings,model:LocalModelView,target:'shared'|AiTask):AiSettingsUpdate{
  if(model.state!=='ready')throw new Error('请先检测本地模型')
  const profile=(old:ModelProfile):ModelProfile=>({...old,connectionId:LOCAL_CONNECTION_ID,model:model.id,maxTokens:model.recommendedOutputTokens})
  if(target==='shared')return {routingMode:'shared',shared:profile(settings.shared)}
  // Switching from shared retains the shared choice for every other task.
  const tasks={...settings.tasks}
  if(settings.routingMode==='shared')for(const key of Object.keys(tasks) as AiTask[])tasks[key]={...settings.shared}
  tasks[target]=profile(tasks[target])
  return {routingMode:'perTask',tasks}
}

