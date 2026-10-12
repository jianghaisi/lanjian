import { AppError } from '../../../core/errors/app-error'
import type { CompanionRuntimeOptions, CompanionVoiceEvent, CompanionVoiceId, CompanionVoiceRequest } from '../../../../contracts/companion/companion-voice-contracts'
import { CompanionNoticePolicy } from '../../../../contracts/companion/companion-presence'
import { companionPresetReply, companionTapReply } from './companion-presets'
import { companionPreparationError } from './companion-preparation-error'

export type CompanionLibraryProjection = { id: string; title: string; chapter: string | null }
export type CompanionInferencePort = {
  prepare(voice: CompanionVoiceId, signal: AbortSignal): Promise<void>
  prepareText(signal: AbortSignal): Promise<void>
  stopText(): void
  stopSpeech(): void
  chat(text: string, context: string, history: Array<{ role: 'user' | 'assistant'; content: string }>, signal: AbortSignal, delta: (text: string) => void): Promise<string>
  speak(text: string, voice: CompanionVoiceId, signal: AbortSignal, audio: (pcm: Uint8Array) => void): Promise<void>
  stop(): void
  cancel(): void
}
type Session = { id: string; owner: number; continueId: string | null; work?: CompanionLibraryProjection; page: '我的作品' | '写作工作台'; history: Array<{ role: 'user' | 'assistant'; content: string }>; lastReply: string; controller?: AbortController; seen: Set<string> }
export class CompanionVoiceService {
  private session?: Session
  private library: CompanionLibraryProjection[] = []
  private continueId: string | null = null
  private work: CompanionLibraryProjection | null = null
  private notices = new CompanionNoticePolicy()
  private preparation?: { voice: CompanionVoiceId; controller: AbortController; promise: Promise<boolean> }
  private textPreparation?: { controller: AbortController; promise: Promise<boolean> }
  private options: CompanionRuntimeOptions = { textModel: true, speechModel: true, preload: true, voice: 'ningguang' }
  private epoch = 0
  private active = true
  private tapIndex = 0
  private lastTap = -Infinity
  constructor(private readonly inference: CompanionInferencePort, private readonly id: () => string, private readonly now: () => Date, private readonly onEnd: (id: string, owner: number) => void = () => {}) {}
  configure(options: CompanionRuntimeOptions): boolean {
    const previous = this.options
    if (Object.keys(options).every(key => options[key as keyof CompanionRuntimeOptions] === previous[key as keyof CompanionRuntimeOptions])) return true
    this.options = { ...options }; this.epoch++
    if (previous.textModel !== options.textModel || previous.speechModel !== options.speechModel || previous.voice !== options.voice) {
      if (this.session?.controller) { this.session.controller.abort(); this.session.controller = undefined; this.inference.cancel() }
      if (this.session) { this.session.history = []; this.session.lastReply = '' }
    }
    if (!options.textModel || !options.preload) { this.textPreparation?.controller.abort(); this.textPreparation = undefined }
    if (!options.speechModel || !options.preload || previous.voice !== options.voice) { this.preparation?.controller.abort(); this.preparation = undefined }
    if (!options.textModel) this.inference.stopText()
    // Disabled speech blocks new calls; the selected engine stays resident until exit.
    // Changing voice replaces its weights on the next request, not the Python process.
    return true
  }
  async warmup(): Promise<boolean> {
    const epoch = this.epoch
    if (!this.active || !this.options.preload) return false
    let prepared = true
    if (this.options.textModel) {
      if (!this.textPreparation && !this.session?.controller) {
        const controller = new AbortController()
        const promise = this.inference.prepareText(controller.signal).then(() => !controller.signal.aborted)
        const job = { controller, promise }; this.textPreparation = job
        void promise.finally(() => { if (this.textPreparation === job) this.textPreparation = undefined }).catch(() => {})
      }
      prepared = this.textPreparation ? await this.textPreparation.promise.catch(error => { throw companionPreparationError(error) }) : false
    }
    if (epoch !== this.epoch || !this.active || !this.options.preload) return false
    if (this.options.speechModel) prepared = await this.prepare(this.options.voice).catch(error => { throw companionPreparationError(error) }) && prepared
    return prepared
  }
  async prepare(voice: CompanionVoiceId): Promise<boolean> {
    if (!this.active || !this.options.speechModel) return false
    if (this.preparation) return this.preparation.voice === voice ? this.preparation.promise : false
    if (this.session?.controller) return false
    const controller = new AbortController()
    const promise = this.inference.prepare(voice, controller.signal).then(() => !controller.signal.aborted)
    const job = { voice, controller, promise }; this.preparation = job
    try { return await promise } finally { if (this.preparation === job) this.preparation = undefined }
  }
  // Receives the already-confirmed library projection. Never scans books for conversation.
  updateLibrary(items: CompanionLibraryProjection[], continueProjectId?: string | null): void {
    this.active = true
    this.library = items.map(item => ({ ...item, title: item.title.slice(0, 200), chapter: item.chapter?.slice(0, 200) || null }))
    this.continueId = this.library.find(item => item.id === continueProjectId)?.id ?? this.library[0]?.id ?? null
    if (this.session?.page === '我的作品' && this.session.continueId && this.session.continueId !== this.continueId) this.endSession()
  }
  updateWork(work: CompanionLibraryProjection): void {
    if (this.session?.page === '写作工作台' && this.session.continueId !== work.id) this.endSession()
    this.work = { ...work, title: work.title.slice(0, 200), chapter: work.chapter?.slice(0, 200) || null }; this.active = true
  }
  open(owner: number, selector: string | null): { sessionId: string } {
    if (selector !== null && (selector === 'work-current' ? !this.work : selector !== 'library-current' || !this.continueId)) throw new AppError('CONFLICT', '作品已变化，请刷新后再交流。', { recoverable: true })
    const work = selector === 'work-current' ? this.work! : this.library.find(item => item.id === this.continueId)
    const continueId = selector === null ? null : work?.id ?? null
    this.endSession()
    const id = this.id()
    this.session = { id, owner, continueId, ...(selector === null || !work ? {} : { work: { ...work } }), page: selector === 'work-current' ? '写作工作台' : '我的作品', history: [], lastReply: '', seen: new Set() }
    return { sessionId: id }
  }
  private owned(owner: number, id: string): Session {
    if (!this.session || this.session.owner !== owner || this.session.id !== id) throw new AppError('CONFLICT', '对话已结束，请重新打开人物对话。', { recoverable: true })
    return this.session
  }
  cancel(owner: number, id: string): boolean {
    const session = this.owned(owner, id)
    // The renderer also cancels completed playback before a new request. Keep a warm
    // idle worker; speech cancellation discards output without unloading the engine.
    if (session.controller) { session.controller.abort(); session.controller = undefined; this.inference.cancel() }
    return true
  }
  close(owner: number, id: string): boolean { this.owned(owner, id); this.endSession(); return true }
  closeOwner(owner: number): void { if (this.session?.owner === owner) this.endSession() }
  private endSession(): void {
    if (this.session?.controller) { this.session.controller.abort(); this.inference.cancel() }
    if (this.session) this.onEnd(this.session.id, this.session.owner)
    this.session = undefined
  }
  clear(): void {
    this.active = false; this.epoch++; this.work = null
    this.textPreparation?.controller.abort(); this.textPreparation = undefined
    this.endSession(); this.inference.stopText()
    // Silent speech warmup belongs to the application, not the current library view.
  }
  shutdown(): void {
    this.clear(); this.preparation?.controller.abort(); this.preparation = undefined
    this.inference.stop()
  }
  async request(owner: number, input: CompanionVoiceRequest, emit: (event: CompanionVoiceEvent) => void): Promise<{ text: string }> {
    const session = this.owned(owner, input.sessionId)
    if (session.controller || session.seen.has(input.requestId) || session.seen.size >= 100) throw new AppError('CONFLICT', '请先停止上一轮，或重新打开对话。', { recoverable: true })
    session.seen.add(input.requestId)
    const controller = new AbortController(); session.controller = controller
    let sequence = 0
    const assertCurrent = () => { if (controller.signal.aborted || this.session !== session) throw new AppError('CONFLICT', '本轮对话已停止。', { recoverable: true }) }
    const send = (event: Omit<Extract<CompanionVoiceEvent, { kind: 'text' }>, 'sessionId' | 'requestId' | 'sequence'> | Omit<Extract<CompanionVoiceEvent, { kind: 'audio' }>, 'sessionId' | 'requestId' | 'sequence'> | { kind: 'phase'; phase: 'thinking' | 'synthesizing' }) => { assertCurrent(); emit({ ...event, sessionId: session.id, requestId: input.requestId, sequence: sequence++ }) }
    try {
      let reply = input.action === 'preview' ? '欢迎回来。故事还在等你继续。' : session.lastReply
      if (input.action === 'tap') {
        const now = this.now().getTime()
        if (now - this.lastTap < 3000) throw new AppError('CONFLICT', '请等这一句回应结束。', { recoverable: true })
        this.lastTap = now; reply = companionTapReply(this.tapIndex++)
      }
      if (input.action === 'notice') {
        const now = this.now(), work = session.work
        if (!input.notice || !this.notices.claim(input.notice, now, work?.id || null)) throw new AppError('CONFLICT', '这条陪伴提醒已略过。', { recoverable: true })
        reply = input.notice === 'late-night'
          ? '已经很晚了。灵感可以先记下来，今天也记得早点休息。'
          : `要开始创作《${work!.title.slice(0, 32)}》了吗？${work!.chapter ? '可以从上次的章节继续，我陪着你。' : '先写下此刻最想写的画面吧。'}`
      }
      if (input.action === 'chat') {
        const now = this.now(), work = session.work
        if (this.options.textModel) {
          send({ kind: 'phase', phase: 'thinking' })
          if (this.textPreparation) { await this.textPreparation.promise; assertCurrent() }
          // Both profiles share the writing-resource scheduler. Join a cold speech
          // preparation instead of exhausting its bounded 30-second waiter.
          // Text-only mode already aborts/removes that preparation in configure().
          if (this.preparation && this.options.speechModel) { await this.preparation.promise; assertCurrent() }
          const context = JSON.stringify({ time: now.toLocaleString('zh-CN', { hour12: false }), page: session.page, continueWork: work ? { title: work.title, chapter: work.chapter } : null, operation: '未提供确认的操作记录', permission: '只能交流，不能保存或修改作品' })
          reply = await this.inference.chat(input.text, context, session.history, controller.signal, text => send({ kind: 'text', text }))
        } else reply = companionPresetReply(input.text, { now, work, page: session.page })
        assertCurrent()
        if (!reply.trim() || reply.length > 600) throw new AppError('AI_RESPONSE_INVALID', '本地模型没有返回可用文字，请重试。', { recoverable: true })
        session.history = [...session.history, { role: 'user' as const, content: input.text.slice(0, 600) }, { role: 'assistant' as const, content: reply }].slice(-6)
        session.lastReply = reply
      }
      if (!reply) throw new AppError('VALIDATION_ERROR', '还没有可以重播的回复。', { recoverable: true })
      send({ kind: 'text', text: reply })
      if (!input.mute && this.options.speechModel) {
        send({ kind: 'phase', phase: 'synthesizing' })
        if (this.preparation) { await this.preparation.promise; assertCurrent() }
        // Short model replies are bounded. Long text remains visible; no silent audio truncation.
        if (reply.length > 180) throw new AppError('VALIDATION_ERROR', '回复较长，已保留文字；请让她简短回答后再播放。', { recoverable: true })
        await this.inference.speak(reply, input.voice, controller.signal, pcm => send({ kind: 'audio', pcm, sampleRate: 24000 }))
      }
      assertCurrent()
      return { text: reply }
    } finally { if (session.controller === controller) session.controller = undefined }
  }
}
