import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopPetApi, DesktopPetState } from '../contracts/companion/desktop-pet'

// Intentionally self-contained: a sandboxed secondary preload cannot require a
// generated shared chunk. It exposes neither writing-context updates nor book APIs.
async function request(channel: string, value?: unknown): Promise<DesktopPetState> {
  const response = await ipcRenderer.invoke(channel, value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
  if (!response || response.ok !== true) throw new Error(response?.error?.message || '桌面伙伴暂时不可用，请重试。')
  return response.value as DesktopPetState
}
const api: DesktopPetApi = {
  get: () => request('desktop-pet:get'),
  updateContext: () => Promise.reject(new Error('桌面伙伴不能修改写作状态。')),
  command: command => request('desktop-pet:command', command),
  onState: listener => {
    const callback = (_event: Electron.IpcRendererEvent, state: DesktopPetState) => listener(state)
    ipcRenderer.on('desktop-pet:state', callback)
    return () => ipcRenderer.removeListener('desktop-pet:state', callback)
  },
  onAction: () => () => {}
}
contextBridge.exposeInMainWorld('desktopPet', api)
