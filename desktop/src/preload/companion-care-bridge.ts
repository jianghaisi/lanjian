import { contextBridge, ipcRenderer } from 'electron'
import { decodePetCareRequest, decodePetCareState, type CompanionCareApi } from '../contracts/companion/companion-care'
export function exposeCompanionCareBridge():void{
  async function request(action:string,input?:unknown){
    const result=await ipcRenderer.invoke(`companion-care:${action}`,input)
    if(!result?.ok)throw new Error(result?.error?.message||'养成暂不可用，请重试。')
    return decodePetCareState(result.value)
  }
  const api:CompanionCareApi={get:()=>request('get'),act:input=>request('act',decodePetCareRequest(input)),recover:()=>request('recover'),
    onChange(listener){const receive=(_event:Electron.IpcRendererEvent,value:unknown)=>{try{listener(decodePetCareState(value))}catch{/* reject malformed state */}};ipcRenderer.on('companion-care:changed',receive);return()=>ipcRenderer.removeListener('companion-care:changed',receive)},
    onError(listener){const receive=(_event:Electron.IpcRendererEvent,value:unknown)=>{if(typeof value==='string'&&value.length<=180)listener(value)};ipcRenderer.on('companion-care:error',receive);return()=>ipcRenderer.removeListener('companion-care:error',receive)},
  }
  contextBridge.exposeInMainWorld('companionCare',api)
}
