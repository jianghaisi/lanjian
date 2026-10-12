import { ipcRenderer } from 'electron'
import { decodeCompanionEvent, type CompanionVoiceApi } from '../contracts/companion/companion-voice-contracts'
import { unwrapValidatedIpcResponse } from '../contracts/core/ipc-response'
export function createCompanionVoiceBridge(): CompanionVoiceApi {
  const invokeValidated = async <T>(channel: string, ...args: unknown[]): Promise<T> => unwrapValidatedIpcResponse<T>(channel, await ipcRenderer.invoke(channel, ...args))
  return {
    onReset: listener => {
      const callback = (_event: Electron.IpcRendererEvent, id: unknown) => { if (typeof id === 'string' && /^[\w-]{1,80}$/.test(id)) listener(id) }
      ipcRenderer.on('companion-voice:reset', callback)
      return () => ipcRenderer.removeListener('companion-voice:reset', callback)
    },
    status: () => invokeValidated('companion-voice:status'),
    configure: options => invokeValidated('companion-voice:configure', { ...options }),
    warmup: () => invokeValidated('companion-voice:warmup'),
    suspend: () => invokeValidated('companion-voice:suspend'),
    prepare: voice => invokeValidated('companion-voice:prepare', voice),
    open: input => invokeValidated('companion-voice:open', { continueWorkId: input.continueWorkId }),
    request: input => invokeValidated('companion-voice:request', { ...input }),
    cancel: id => invokeValidated('companion-voice:cancel', id),
    close: id => invokeValidated('companion-voice:close', id),
    onEvent(listener) {
      const callback = (_event: Electron.IpcRendererEvent, value: unknown) => {
        let event
        try { event = decodeCompanionEvent(value) } catch { return }
        listener(event)
      }
      ipcRenderer.on('companion-voice:event', callback)
      return () => ipcRenderer.removeListener('companion-voice:event', callback)
    },
  }
}
