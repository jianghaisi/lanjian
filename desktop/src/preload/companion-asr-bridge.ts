import { contextBridge, ipcRenderer } from 'electron'
import { decodeAsrInput, decodeCaptureId, decodeInputDevices, type CompanionAsrApi } from '../contracts/companion/companion-asr'
export function exposeCompanionAsrBridge(): void {
  async function request(action: string, input?: unknown): Promise<unknown> {
    const reply = await ipcRenderer.invoke(`companion-asr:${action}`, input)
    if (!reply?.ok) throw new Error(reply?.error?.message || '本地识别暂不可用。')
    return reply.value
  }
  const api: CompanionAsrApi = {
    devices: async () => decodeInputDevices(await request('devices')),
    async publishDevices(devices) { return await request('publish-devices', decodeInputDevices(devices)) === true },
    async status() { const result = await request('status') as { installed?: unknown }; if (typeof result?.installed !== 'boolean') throw new Error('识别状态无效。'); return { installed: result.installed } },
    async begin() { const result = await request('begin') as { captureId?: unknown }; return { captureId: decodeCaptureId(result?.captureId) } },
    async transcribe(value) { const result = await request('transcribe', decodeAsrInput(value)) as { text?: unknown }; if (typeof result?.text !== 'string' || result.text.length > 2000) throw new Error('识别结果无效。'); return { text: result.text } },
    async cancel(id) { const result = await request('cancel', decodeCaptureId(id)); if (result !== true) throw new Error('录音取消失败。'); return true },
  }
  contextBridge.exposeInMainWorld('companionAsr', api)
}
