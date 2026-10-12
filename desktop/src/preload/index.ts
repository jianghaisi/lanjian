import { contextBridge, ipcRenderer } from 'electron'
import { exposeDesktopPetBridge } from './desktop-pet-bridge'
import { createCompanionVoiceBridge } from './companion-voice-bridge'
import { exposeCompanionSettingsBridge } from './companion-settings-bridge'
import { exposeCompanionAsrBridge } from './companion-asr-bridge'
import { exposeCompanionCareBridge } from './companion-care-bridge'
import { createDesktopApi } from '../contracts/core/create-desktop-api'
import { unwrapValidatedIpcResponse } from '../contracts/core/ipc-response'

exposeDesktopPetBridge(true)
exposeCompanionSettingsBridge(true)
exposeCompanionAsrBridge()
exposeCompanionCareBridge()

const invokeValidated = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
  const response: unknown = await ipcRenderer.invoke(channel, ...args)
  // Reject with a plain structured-cloneable DTO. Electron strips custom
  // properties from Error objects crossing contextBridge, including the
  // conflict code and safe recovery details needed by the renderer.
  return unwrapValidatedIpcResponse<T>(channel, response)
}

let windowShown = false
const windowShownListeners = new Set<() => void>()
ipcRenderer.on('app:window-shown', () => {
  windowShown = true
  for (const listener of windowShownListeners) listener()
})

const desktopApi = createDesktopApi(invokeValidated, {
  app: {
    version: () => invokeValidated('app:version'),
    onWindowShown: (listener) => {
      windowShownListeners.add(listener)
      if (windowShown) queueMicrotask(listener)
      return () => windowShownListeners.delete(listener)
    },
    onBeforeClose: (listener) => {
      const callback = () => listener()
      ipcRenderer.on('app:before-close', callback)
      return () => ipcRenderer.removeListener('app:before-close', callback)
    },
    readyToClose: (success) => ipcRenderer.send('app:close-ready', success),
    showSelectionAiMenu: () => ipcRenderer.send('app:show-selection-ai-menu'),
    onSelectionAiAction: (listener) => {
      const allowed = new Set(['rewrite', 'expand', 'compress', 'custom', 'polish'])
      const callback = (_event: Electron.IpcRendererEvent, skill: unknown) => {
        if (typeof skill === 'string' && allowed.has(skill)) listener(skill as 'rewrite' | 'expand' | 'compress' | 'custom' | 'polish')
      }
      ipcRenderer.on('app:selection-ai-action', callback)
      return () => ipcRenderer.removeListener('app:selection-ai-action', callback)
    }
  },
  companionVoice: createCompanionVoiceBridge()
})

contextBridge.exposeInMainWorld('novelDesktop', desktopApi)
