import { contextBridge, ipcRenderer } from 'electron'
import { decodeCompanionSettings, type CompanionSettingsApi } from '../contracts/companion/companion-settings'
export function exposeCompanionSettingsBridge(owner: boolean): void {
  async function request(channel: string, input?: unknown) {
    const result = await ipcRenderer.invoke(channel, input === undefined ? undefined : JSON.parse(JSON.stringify(input)))
    if (!result?.ok) throw new Error(result?.error?.message || '伙伴设置暂不可用。')
    return decodeCompanionSettings(result.value)
  }
  const api: CompanionSettingsApi = {
    get: () => request('companion-settings:get'),
    importVoice: voice => owner ? request('companion-settings:import', voice) : Promise.reject(new Error('只能由主窗口迁移设置。')),
    update: patch => request('companion-settings:update', patch),
    recover: () => request('companion-settings:recover'),
    onChange: listener => {
      const callback = (_event: Electron.IpcRendererEvent, value: unknown) => { try { listener(decodeCompanionSettings(value)) } catch { /* invalid state cannot replace saved preferences */ } }
      ipcRenderer.on('companion-settings:changed', callback)
      return () => ipcRenderer.removeListener('companion-settings:changed', callback)
    }
  }
  contextBridge.exposeInMainWorld('companionSettings', api)
}
