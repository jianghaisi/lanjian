import type { LocalModelScheduler } from '../../models/application/local-model-scheduler'
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { CompanionVoiceService } from '../application/companion-voice-service'
import { LocalVoiceRuntime } from '../adapters/companion-voice/local-runtime'
import { AppError } from '../../../core/errors/app-error'
import { toAppErrorDto } from '../../../../contracts/ipc'
import { companionSessionId, decodeCompanionOpen, decodeCompanionRequest, decodeCompanionRuntimeOptions, companionVoiceResultDecoders, voiceId } from '../../../../contracts/companion/companion-voice-contracts'
import type { ProjectSummary } from '../../../../contracts/index'
import { registerCompanionSettings } from './companion-settings-runtime'
import { CompanionAsrService } from '../application/companion-asr-service'
import { registerCompanionCare } from './companion-care-runtime'
import { decodeAsrInput, decodeCaptureId, decodeInputDevices, type CompanionInputDevice } from '../../../../contracts/companion/companion-asr'

export function registerCompanionVoice(root: string, worker: string, scheduler?: LocalModelScheduler, settingsDirectory = root, currentWork?: () => Promise<ProjectSummary>) {
  const owners = new Map<number, { window: BrowserWindow; kind: 'main' | 'pet'; active: boolean }>()
  let scopeEpoch = 0
  const stop = () => { inference.stop(); speech.stop() }
  const releaseText = () => inference.stop()
  const inference = new LocalVoiceRuntime(root, worker, scheduler, 'text', releaseText)
  const speech = new LocalVoiceRuntime(root, worker, scheduler, 'speech', releaseText)
  const asr = new CompanionAsrService(async (pcm, signal) => {
    const result = await inference.run({ action: 'asr', sampleRate: 16000, pcm: Buffer.from(pcm) }, signal)
    if (typeof result.header.text !== 'string' || result.header.text.length > 2000 || result.pcm.length) throw new Error('ASR_RESULT_INVALID')
    return result.header.text
  })
  const service = new CompanionVoiceService({
    async prepareText(signal) {
      const result = await inference.run({ action: 'prepare-text' }, signal)
      if (result.header.prepared !== true || result.pcm.length) throw new Error('TEXT_PREPARE_INVALID')
    },
    stopText: () => { if (!asr.active) inference.stop() },
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
    cancel: () => { if (!asr.active) inference.cancel(); speech.cancel() },
  }, randomUUID, () => new Date(), (id, owner) => {
    const host = owners.get(owner)?.window
    if (host && !host.isDestroyed()) host.webContents.send('companion-voice:reset', id)
  })
  const authorize = (event: IpcMainInvokeEvent, ownerOnly = false) => {
    if (!owners.has(event.sender.id) || (ownerOnly && owners.get(event.sender.id)?.kind !== 'main') || !event.senderFrame || event.senderFrame !== event.sender.mainFrame || event.sender.isDestroyed()) throw new AppError('FEATURE_UNAVAILABLE', '只能在已授权的伙伴窗口操作。', { recoverable: true })
  }
  const preferences = registerCompanionSettings(settingsDirectory, authorize, value => {
    care.configure(value)
    if (!value.microphone.enabled) asr.cancel()
    service.configure({ textModel: value.voice.textModel, speechModel: !value.voice.mute, preload: value.voice.preload, voice: value.voice.voice })
    for (const host of owners.values()) if (!host.window.isDestroyed()) host.window.webContents.send('companion-settings:changed', value)
  })
  const care = registerCompanionCare(settingsDirectory, authorize, () => preferences.read(), (channel, value) => {
    for (const host of owners.values()) if (!host.window.isDestroyed()) host.window.webContents.send(channel, value)
  })
  let inputDevices: CompanionInputDevice[] = []
  for (const action of ['status', 'begin', 'transcribe', 'cancel', 'devices', 'publish-devices'] as const) ipcMain.handle(`companion-asr:${action}`, async (event, input: unknown) => {
    try {
      authorize(event)
      if (action === 'devices') { if (input !== undefined) throw new Error('ASR_ARGUMENTS'); return { ok: true, value: inputDevices } }
      if (action === 'status') {
        if (input !== undefined) throw new Error('ASR_ARGUMENTS')
        return { ok: true, value: { installed: await inference.available('asr') } }
      }
      const host = owners.get(event.sender.id)
      if (host?.kind !== 'pet') throw new AppError('FEATURE_UNAVAILABLE', '请从桌宠聊天框主动录音。', { recoverable: true })
      if (action === 'publish-devices') {
        if (!asr.permitted(event.sender.id)) throw new Error('ASR_CAPTURE_INVALID')
        inputDevices = decodeInputDevices(input); return { ok: true, value: true }
      }
      if (action === 'cancel') return { ok: true, value: asr.cancel(event.sender.id, decodeCaptureId(input)) }
      const audio = action === 'transcribe' ? decodeAsrInput(input) : undefined
      const epoch = scopeEpoch, saved = await preferences.read()
      authorize(event)
      if (!host.active || !host.window.isFocused() || epoch !== scopeEpoch || !saved.microphone.enabled) throw new AppError('CONFLICT', '录音已暂停，请在桌宠聊天框重新开始。', { recoverable: true })
      if (action === 'begin') {
        if (input !== undefined) throw new Error('ASR_ARGUMENTS')
        if (!await inference.available('asr')) throw new AppError('FEATURE_UNAVAILABLE', '尚未安装本地识别模型，文字输入仍可使用。', { recoverable: true })
        if (!(await preferences.read()).microphone.enabled) throw new AppError('CONFLICT', '麦克风输入已关闭。', { recoverable: true })
        authorize(event)
        if (epoch !== scopeEpoch || !host.active || !host.window.isFocused()) throw new AppError('CONFLICT', '录音已取消。', { recoverable: true })
        // Stop previous CPU work before giving the same worker to ASR. Speech remains resident.
        service.clear()
        return { ok: true, value: asr.begin(event.sender.id) }
      }
      const result = await asr.transcribe(event.sender.id, audio!)
      authorize(event)
      if (epoch !== scopeEpoch || !host.active) throw new AppError('CONFLICT', '作品已切换，识别结果已丢弃。', { recoverable: true })
      return { ok: true, value: result }
    } catch (reason) {
      const error = reason instanceof AppError ? reason : new AppError('FEATURE_UNAVAILABLE', '本地识别未完成，请取消后重试；文字输入仍可使用。', { recoverable: true })
      return { ok: false, error: toAppErrorDto(error) }
    }
  })
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
  register('companion-voice:configure', args => decodeCompanionRuntimeOptions(one(args)), async (_event, options) => {
    const saved = await preferences.read()
    return service.configure(saved.revision ? { textModel: saved.voice.textModel, speechModel: !saved.voice.mute, preload: saved.voice.preload, voice: saved.voice.voice } : options)
  })
  register('companion-voice:warmup', none, () => service.warmup())
  register('companion-voice:suspend', none, event => { service.closeOwner(event.sender.id); return true })
  register('companion-voice:prepare', args => voiceId(one(args)), (_event, voice) => service.prepare(voice))
  register('companion-voice:open', args => decodeCompanionOpen(one(args)), async (event, input) => {
    asr.cancel()
    const host = owners.get(event.sender.id), epoch = scopeEpoch
    if (host?.kind === 'pet') {
      if (!host.active || !currentWork) throw new AppError('CONFLICT', '请在已打开的作品中和伙伴交流。', { recoverable: true })
      const work = await currentWork()
      authorize(event)
      if (!host.active || epoch !== scopeEpoch) throw new AppError('CONFLICT', '作品已切换，请重新打开对话。', { recoverable: true })
      service.updateWork({ id: work.id, title: work.title, chapter: work.manuscript?.lastEditedChapter?.title || null })
      return service.open(event.sender.id, 'work-current')
    }
    if (input.continueWorkId === 'work-current') throw new AppError('VALIDATION_ERROR', '当前窗口不支持此对话作用域。', { recoverable: true })
    return service.open(event.sender.id, input.continueWorkId)
  })
  register('companion-voice:request', args => decodeCompanionRequest(one(args)), (event, input) => service.request(event.sender.id, input, value => { authorize(event); event.sender.send('companion-voice:event', value) }))
  register('companion-voice:cancel', args => companionSessionId(one(args)), (event, id) => service.cancel(event.sender.id, id))
  register('companion-voice:close', args => companionSessionId(one(args)), (event, id) => service.close(event.sender.id, id))
  return {
    clear: () => { scopeEpoch++; asr.cancel(); service.clear() },
    shutdown: () => { care.shutdown(); asr.cancel(); service.shutdown() },
    activity: () => care.activity(),
    microphonePermitted: (window: BrowserWindow) => asr.permitted(window.webContents.id),
    updateLibrary(items: ProjectSummary[], continueProjectId?: string | null) { service.updateLibrary(items.map(item => ({ id: item.id, title: item.title, chapter: item.manuscript?.lastEditedChapter?.title || null })), continueProjectId) },
    attach(window: BrowserWindow, kind: 'main' | 'pet' = 'main') {
      owners.set(window.webContents.id, { window, kind, active: kind === 'main' })
      const owner = window.webContents.id
      window.on('blur', () => asr.cancel(owner))
      window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) { asr.cancel(owner); service.closeOwner(owner) } })
      window.webContents.once('destroyed', () => { if (kind === 'pet') care.setActive(false); asr.cancel(owner); service.closeOwner(owner); owners.delete(owner) })
    },
    setPetActive(window: BrowserWindow, active: boolean) {
      const host = owners.get(window.webContents.id)
      if (host?.kind === 'pet') { host.active = active; care.setActive(active); if (!active) { asr.cancel(window.webContents.id); service.closeOwner(window.webContents.id) } }
    },
  }
}
