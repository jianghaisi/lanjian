import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { AppError } from '../../../core/errors/app-error'
import { toAppErrorDto } from '../../../../contracts/ipc'
import { decodePetCareRequest, type PetCareState } from '../../../../contracts/companion/companion-care'
import type { CompanionSettings } from '../../../../contracts/companion/companion-settings'
import { CompanionCareStore } from '../adapters/companion-care-store'
import { CompanionCareService } from '../application/companion-care-service'
export function registerCompanionCare(directory:string,authorize:(event:IpcMainInvokeEvent,ownerOnly?:boolean)=>void,preferences:()=>Promise<CompanionSettings>,publish:(channel:string,value:unknown)=>void){
  const service=new CompanionCareService(new CompanionCareStore(directory))
  let state:PetCareState|undefined, settings:CompanionSettings|undefined, active=false, disposed=false, busy=false, epoch=0, previous=performance.now()
  const emit=(value:PetCareState)=>{state=value;publish('companion-care:changed',value);publish('companion-care:error','');return value}
  const configure=(value:CompanionSettings)=>{
    // Reads and notifications may finish in a different order. Only a current
    // care toggle changes the clock boundary; appearance/voice changes do not.
    if(settings&&value.revision<settings.revision)return
    if(settings?.careEnabled!==value.careEnabled){epoch++;previous=performance.now()}
    settings=value
  }
  const readPreferences=async()=>{const value=await preferences();configure(value);return settings??value}
  for(const action of ['get','act','recover'] as const)ipcMain.handle(`companion-care:${action}`,async(event,input:unknown)=>{
    try{
      authorize(event,action==='recover')
      if(action!=='act'&&input!==undefined)throw new Error('PET_CARE_ARGUMENTS')
      const request=action==='act'?decodePetCareRequest(input):undefined
      const current=await readPreferences();authorize(event)
      if(request&&!current.careEnabled&&request.action.type!=='focus-cancel')throw new AppError('CONFLICT','养成已暂停，可在完整设置中开启。',{recoverable:true})
      // Only temporal transitions invalidate ticks. Ordinary care and receipt
      // retries share the store queue without throwing away online seconds.
      const resetsClock=action==='recover'||!!request&&['focus-start','focus-pause','focus-resume','focus-cancel','sleep','wake'].includes(request.action.type)
      if(resetsClock){epoch++;previous=performance.now()}
      const result=request?await service.act(request):action==='recover'?await service.recover():await service.get()
      if(resetsClock){epoch++;previous=performance.now()}
      return{ok:true,value:emit(result)}
    }catch(reason){const error=reason instanceof AppError?reason:new AppError('VALIDATION_ERROR','养成请求无效，请重试。',{recoverable:true});return{ok:false,error:toAppErrorDto(error)}}
  })
  const timer=setInterval(()=>{
    if(busy||disposed)return
    const now=performance.now(), elapsed=(now-previous)/1000;previous=now
    if(!active)return
    const token=epoch;busy=true
    void readPreferences().then(async current=>{
      if(disposed||token!==epoch||!active||!current.careEnabled)return
      emit(await service.tick(elapsed,()=>!disposed&&token===epoch&&active))
    }).catch(()=>{if(!disposed)publish('companion-care:error','养成进度暂未保存，请打开照料面板检查后重试。')}).finally(()=>{busy=false})
  },5000);timer.unref()
  return{
    setActive(value:boolean){if(active!==value){epoch++;previous=performance.now()}active=value},
    configure,
    activity(){return{roam:settings?.roam??false,follow:settings?.followCursor??false,reduced:!state||!settings?.careEnabled||(settings?.reducedMotion??true),sleeping:state?.sleeping??false,focus:state?.focus?.status==='running'}},
    shutdown(){disposed=true;active=false;epoch++;clearInterval(timer);for(const action of ['get','act','recover'])ipcMain.removeHandler(`companion-care:${action}`)},
  }
}
