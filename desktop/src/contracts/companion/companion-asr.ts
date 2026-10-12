import { companionRecord } from './companion-settings'
export type CompanionAsrInput = { captureId: string; sampleRate: 16000; pcm: Uint8Array }
export type CompanionInputDevice = { id: string; label: string }
export type CompanionAsrApi = {
  status(): Promise<{ installed: boolean }>
  begin(): Promise<{ captureId: string }>
  transcribe(input: CompanionAsrInput): Promise<{ text: string }>
  cancel(captureId: string): Promise<boolean>
  devices(): Promise<CompanionInputDevice[]>
  publishDevices(devices: CompanionInputDevice[]): Promise<boolean>
}
export function decodeInputDevices(value: unknown): CompanionInputDevice[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error('ASR_DEVICES_INVALID')
  return value.map(device => {
    const item = companionRecord(device, ['id', 'label'])
    if (typeof item.id !== 'string' || item.id.length > 256 || typeof item.label !== 'string' || item.label.length > 160) throw new Error('ASR_DEVICES_INVALID')
    return { id: item.id, label: item.label }
  })
}
export function decodeCaptureId(value: unknown): string {
  if (typeof value !== 'string' || !/^[\da-f-]{36}$/i.test(value)) throw new Error('ASR_CAPTURE_INVALID')
  return value
}
export function decodeAsrInput(value: unknown): CompanionAsrInput {
  const input = companionRecord(value, ['captureId', 'sampleRate', 'pcm'])
  if (input.sampleRate !== 16000 || !(input.pcm instanceof Uint8Array) || input.pcm.byteLength < 3200 || input.pcm.byteLength > 960000 || input.pcm.byteLength % 2) throw new Error('ASR_PCM_INVALID')
  return { captureId: decodeCaptureId(input.captureId), sampleRate: 16000, pcm: input.pcm }
}
