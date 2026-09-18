import type { LocalModelScheduler } from '../../models/application/local-model-scheduler'
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { CompanionVoiceService } from '../application/companion-voice-service'
import { LocalVoiceRuntime } from '../adapters/companion-voice/local-runtime'
import { AppError } from '../../../core/errors/app-error'
import { toAppErrorDto } from '../../../../contracts/ipc'
import { companionSessionId, decodeCompanionOpen, decodeCompanionRequest, decodeCompanionRuntimeOptions, companionVoiceResultDecoders, voiceId } from '../../../../contracts/companion/companion-voice-contracts'
import type { ProjectSummary } from '../../../../contracts/index'

export function registerCompanionVoice(root: string, worker: string, scheduler?: LocalModelScheduler) {
  const stop = () => { inference.stop(); speech.stop() }
  const releaseText = () => inference.stop()
  const inference = new LocalVoiceRuntime(root, worker, scheduler, 'text', releaseText)
  const speech = new LocalVoiceRuntime(root, worker, scheduler, 'speech', releaseText)
  const service = new CompanionVoiceService({
    async prepareText(signal) {
      const result = await inference.run({ action: 'prepare-text' }, signal)
      if (result.header.prepared !== true || result.pcm.length) throw new Error('TEXT_PREPARE_INVALID')
    },
    stopText: () => inference.stop(),
    stopSpeech: () => speech.stop(),
    async prepare(voice, signal) {
      const result = await speech.run({ action:'prepare', voice }, signal)
      if (result.header.prepared !== true || result.pcm.length) throw new Error('VOICE_PREPARE_INVALID')
    },
    async chat(text, context, history, signal, delta) {
      const result = await inference.run({ action: 'chat', text, context, history }, signal, delta)
      if (typeof result.header.text !== 'string' || result.header.text.length > 600 || result.pcm.length) throw new Error('VOICE_RESULT_INVALID')
      return result.header.text
    },
    async speak(text, voice, signal, audio) { await speech.run({ action: 'tts', text, voice }, signal, undefined, pcm => audio(new Uint8Array(pcm))) },
    stop,
    cancel: () => { inference.cancel(); speech.cancel() },
  }, randomUUID, () => new Date())
  const owners = new Set<number>()
  const authorize = (event: IpcMainInvokeEvent) => {
    if (!owners.has(event.sender.id) || !event.senderFrame || event.senderFrame !== event.sender.mainFrame || event.sender.isDestroyed()) throw new AppError('FEATURE_UNAVAILABLE', '只能在主窗口打开人物对话。', { recoverable: true })
  }
  // The generic registrar discards the event; this scoped envelope retains exact owner/frame.
  function register<T>(channel: keyof typeof companionVoiceResultDecoders, decode: (args: unknown[]) => T, handle: (event: IpcMainInvokeEvent, input: T) => unknown) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      try {
        authorize(event)
        let input: T
        try { input = decode(args) } catch { throw new AppError('VALIDATION_ERROR', '人物对话请求格式无效。', { recoverable: true }) }
        const value = await handle(event, input)
        companionVoiceResultDecoders[channel](value)
        return { ok: true, value }
      } catch (error) {
        const safe = error instanceof AppError ? error : new AppError('FEATURE_UNAVAILABLE', '本地语音暂时不可用。可以停止后重试，或关闭声音继续文字交流。', { recoverable: true })
        return { ok: false, error: toAppErrorDto(safe) }
      }
    })
  }
  const one = (args: unknown[]) => { if (args.length !== 1) throw new Error('VOICE_ARGUMENTS'); return args[0] }
  const none = (args: unknown[]) => { if (args.length) throw new Error('VOICE_ARGUMENTS') }
  register('companion-voice:status', none, async () => {
    const [textInstalled, speechInstalled] = await Promise.all([inference.available(), speech.available()])
    return { installed: textInstalled && speechInstalled, textInstalled, speechInstalled, profile: 'gpt-sovits-v2-fp16' as const }
  })
  register('companion-voice:configure', args => decodeCompanionRuntimeOptions(one(args)), (_event, options) => service.configure(options))
  register('companion-voice:warmup', none, () => service.warmup())
  register('companion-voice:suspend', none, () => { service.clear(); return true })
  register('companion-voice:prepare', args => voiceId(one(args)), (_event, voice) => service.prepare(voice))
  register('companion-voice:open', args => decodeCompanionOpen(one(args)), (event, input) => service.open(event.sender.id, input.continueWorkId))
  register('companion-voice:request', args => decodeCompanionRequest(one(args)), (event, input) => service.request(event.sender.id, input, value => { authorize(event); event.sender.send('companion-voice:event', value) }))
  register('companion-voice:cancel', args => companionSessionId(one(args)), (event, id) => service.cancel(event.sender.id, id))
  register('companion-voice:close', args => companionSessionId(one(args)), (event, id) => service.close(event.sender.id, id))
  return {
    clear: () => service.clear(),
    shutdown: () => service.shutdown(),
    updateLibrary(items: ProjectSummary[], continueProjectId?: string | null) { service.updateLibrary(items.map(item => ({ id: item.id, title: item.title, chapter: item.manuscript?.lastEditedChapter?.title || null })), continueProjectId) },
    attach(window: BrowserWindow) {
      owners.add(window.webContents.id)
      const owner = window.webContents.id
      window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) service.clear() })
      window.webContents.once('destroyed', () => { owners.delete(owner); service.shutdown() })
    },
  }
}
