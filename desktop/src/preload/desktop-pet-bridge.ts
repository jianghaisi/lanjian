import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopPetApi, DesktopPetState } from '../contracts/companion/desktop-pet'

// Separate named bridge: the pet preload never exposes manuscript or provider APIs.
export function exposeDesktopPetBridge(owner = false): void {
  async function request(channel: string, value?: unknown): Promise<DesktopPetState> {
    const response = await ipcRenderer.invoke(channel, value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
    if (!response || response.ok !== true) throw new Error(response?.error?.message || '桌面伙伴暂时不可用，请重试。')
    return response.value as DesktopPetState
  }
  const api: DesktopPetApi = {
    get: () => request('desktop-pet:get'),
    updateContext: context => owner ? request('desktop-pet:context', context) : Promise.reject(new Error('桌面伙伴不能修改写作状态。')),
    command: command => request('desktop-pet:command', command),
    onState: listener => {
      const callback = (_event: Electron.IpcRendererEvent, state: DesktopPetState) => listener(state)
      ipcRenderer.on('desktop-pet:state', callback)
      return () => ipcRenderer.removeListener('desktop-pet:state', callback)
    },
    onAction: listener => {
      const callback = (_event: Electron.IpcRendererEvent, action: unknown) => {
        if (action === 'return-to-writing' || action === 'settings' || action === 'mode-detailed' || action === 'mode-chibi') listener(action)
      }
      if (owner) ipcRenderer.on('desktop-pet:action', callback)
      return () => ipcRenderer.removeListener('desktop-pet:action', callback)
    }
  }
  contextBridge.exposeInMainWorld('desktopPet', api)
}
