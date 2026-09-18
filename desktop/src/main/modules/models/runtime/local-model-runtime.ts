import { ipcMain,type BrowserWindow,type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { LocalModelScheduler } from '../application/local-model-scheduler'
import { LocalModelService } from '../application/local-model-service'
import { ExistingModelAssets } from '../adapters/local-models/existing-assets'
import { LocalInstallationStore } from '../adapters/local-models/installation-store'
import { LocalTextRuntime } from '../adapters/local-models/text-runtime'
import { localModelCatalog } from '../adapters/local-models/catalog'
import { localModelId,localModelResultDecoders } from '../../../../contracts/models/local-model-contracts'
import { toAppErrorDto } from '../../../../contracts/ipc'
import { AppError } from '../../../core/errors/app-error'
export function registerLocalModels(root:string,worker:string,userData:string){
  const scheduler=new LocalModelScheduler(),runtime=new LocalTextRuntime(worker,scheduler)
  const service=new LocalModelService(localModelCatalog,new ExistingModelAssets(root),runtime,new LocalInstallationStore(join(userData,'local-models/installations.json')))
  const owners=new Set<number>()
  const authorize=(e:IpcMainInvokeEvent)=>{if(!owners.has(e.sender.id)||!e.senderFrame||e.senderFrame!==e.sender.mainFrame||e.sender.isDestroyed())throw new AppError('FEATURE_UNAVAILABLE','请在主窗口使用本地模型商店。',{recoverable:true})}
  for(const channel of ['local-models:list','local-models:inspect','local-models:cancel'] as const){
    ipcMain.handle(channel,async(event,...args:unknown[])=>{
      try{
        authorize(event)
        if(args.length!==(channel==='local-models:list'?0:1))throw new AppError('VALIDATION_ERROR','模型商店请求格式无效。',{recoverable:true})
        let id=''
        if(args.length){try{id=localModelId(args[0])}catch{throw new AppError('VALIDATION_ERROR','模型标识无效。',{recoverable:true})}}
        const value=channel==='local-models:list'?await service.list():channel==='local-models:inspect'?await service.inspect(id,event.sender.id):service.cancel(id,event.sender.id)
        authorize(event);localModelResultDecoders[channel](value)
        return {ok:true,value}
      }catch(error){return {ok:false,error:toAppErrorDto(error instanceof AppError?error:new AppError('FEATURE_UNAVAILABLE','本地模型商店暂时不可用，请重试。',{recoverable:true}))}}
    })
  }
  return {service,scheduler,runtime,clear:()=>{service.clear();scheduler.stop('writing')},attach(window:BrowserWindow){
    const owner=window.webContents.id
    owners.add(owner)
    window.webContents.once('destroyed',()=>{owners.delete(owner);service.clear();scheduler.stop('writing')})
  }}
}

