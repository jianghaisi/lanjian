import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { CompanionAudioPlayer } from '../services/companion-audio-player'
import { type CompanionVoiceRequest, type CompanionVoiceApi } from '../../../../contracts/companion/companion-voice-contracts'
import { useCompanionVoicePreferences } from './use-companion-voice-preferences'
import type { CompanionNoticeReason } from '../../../../contracts/companion/companion-presence'
import { companionRuntimeOptions } from './use-companion-runtime'

export type CompanionChatEvent =
  | { kind: 'start'; id: string; text: string }
  | { kind: 'text'; id: string; text: string }
  | { kind: 'complete'; id: string; text: string }
  | { kind: 'stopped'; id: string }
  | { kind: 'failed'; id: string; error: string }

function emptyPlayback() {
  return { context: 'unchecked' as AudioContextState | 'unknown' | 'unchecked', received: 0, queued: 0, ended: 0,
    firstAudioMs: null as number | null, settled: false, failure: null as 'audio' | 'request' | 'sequence' | null }
}

export function useCompanionVoice(continueWorkId: Ref<string | null>, options: { autoOpen?: boolean; input?: Ref<string>; api?: CompanionVoiceApi; pet?: boolean; onChat?: (event: CompanionChatEvent) => void } = {}) {
  const api = options.api ?? window.novelDesktop?.companionVoice
  const text = ref('欢迎回来。可以问我时间、继续创作的作品，或聊聊你的灵感。')
  const input = options.input || ref(''), error = ref(''), ready = ref(false), busy = ref(false), playing = ref(false), phase = ref('准备本地对话…')
  const { preferences, ready: settingsReady } = useCompanionVoicePreferences()
  if (!preferences.value.textModel) text.value = '现在是预设陪伴模式。可以问我时间、当前页面，或继续创作的作品。'
  const voice = computed(() => preferences.value.voice), volume = computed(() => preferences.value.volume), mute = computed(() => preferences.value.mute)
  let session = '', request = '', generation = 0, sequence = 0, unsubscribe: (() => void) | undefined, disposed = false
  let chatRequest = ''
  let unsubscribeReset: (() => void) | undefined
  // Counts contain no PCM/text. Natural ends are distinct from stop/dispose and inter-fragment gaps.
  const playback = ref(emptyPlayback())
  let requestStarted = 0
  const player = new CompanionAudioPlayer(value => { playing.value = value }, event => { playback.value[event]++ }, state => {
    // Initial readiness comes from awaited prepare(); ignore idle/stopped and superseded contexts.
    if (request && !disposed && playback.value.context !== 'unchecked') playback.value.context = state
  })
  const stateLabel = computed(() => playing.value ? '正在说话' : busy.value ? phase.value : ready.value ? preferences.value.textModel ? '智能对话 · 不会修改作品' : '预设陪伴 · 未启用文字模型' : phase.value)
  watch([volume, mute], () => {
    player.volume(mute.value ? 0 : volume.value)
  })
  function failChat(message: string) {
    if (chatRequest) options.onChat?.({ kind: 'failed', id: chatRequest, error: message })
    chatRequest = ''
  }
  function stop() {
    if (chatRequest) options.onChat?.({ kind: 'stopped', id: chatRequest })
    chatRequest = ''
    generation++; request = ''; busy.value = false; player.stop()
    if (session) void api?.cancel(session).catch(() => {})
  }
  function close() {
    stop()
    const previous = session; session = ''; ready.value = false; phase.value = '本地对话已关闭。'
    if (previous) void api?.close(previous).catch(() => {})
  }
  async function open() {
    stop()
    error.value = ''; phase.value = '准备本地对话…'
    const previous = session; session = ''; ready.value = false
    const token = generation
    if (previous) await api?.close(previous).catch(() => {})
    if (!api || disposed) { phase.value = '当前环境不支持本地语音。'; return }
    if (token !== generation) return
    try {
      await settingsReady
      if (token !== generation || disposed) return
      await api.configure(companionRuntimeOptions(preferences.value))
      if (token !== generation || disposed) return
      const result = await api.open({ continueWorkId: options.pet ? 'work-current' : continueWorkId.value ? 'library-current' : null })
      if (token !== generation || disposed) { void api.close(result.sessionId).catch(() => {}); return }
      session = result.sessionId; ready.value = true
    } catch { if (token === generation && !disposed) phase.value = '无法开启本地对话，请关闭后重试。' }
  }
  async function run(action: CompanionVoiceRequest['action'] = 'chat', notice?: CompanionNoticeReason) {
    if (!api || !session || busy.value || (action === 'chat' && !input.value.trim())) return
    stop()
    const token = generation, submitted = input.value
    playback.value = emptyPlayback(); requestStarted = performance.now()
    error.value = ''; busy.value = true; phase.value = '加载本地模型…'
    if (action === 'notice' || action === 'tap') text.value = ''
    request = crypto.randomUUID(); sequence = 0
    if (action === 'chat') {
      chatRequest = request
      options.onChat?.({ kind: 'start', id: request, text: submitted })
    }
    try {
      if (!mute.value) {
        const context = await player.prepare(volume.value)
        if (token !== generation || disposed) return
        playback.value.context = context
      }
      if (token !== generation) return
      const result = await api.request({ sessionId: session, requestId: request, action, text: action === 'chat' ? submitted : '', voice: voice.value, mute: mute.value, ...(action === 'notice' ? {notice} : {}) })
      if (token !== generation || disposed) return
      text.value = result.text
      if (chatRequest) options.onChat?.({ kind: 'complete', id: chatRequest, text: result.text })
      chatRequest = ''
      playback.value.settled = true
      if (action === 'chat' && input.value === submitted) input.value = ''
    } catch (reason) {
      if (token !== generation || disposed) return
      playback.value.failure = playback.value.context === 'unchecked' && !mute.value ? 'audio' : 'request'
      player.stop()
      error.value = reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string' ? reason.message : '本地对话失败，请重试。'
      failChat(error.value)
    } finally { if (token === generation) busy.value = false }
  }
  onMounted(() => {
    unsubscribeReset = api?.onReset?.(id => { if (id === session) { close(); phase.value = '对话已结束，可重新打开。' } })
    unsubscribe = api?.onEvent(event => {
      if (event.sessionId !== session || event.requestId !== request || disposed) return
      if (event.sequence !== sequence++) { playback.value.failure = 'sequence'; failChat('音频顺序异常，已停止播放，请重试。'); stop(); error.value = '音频顺序异常，已停止播放，请重试。'; return }
      try {
        switch (event.kind) {
          case 'text':
            text.value = event.text
            if (chatRequest) options.onChat?.({ kind: 'text', id: chatRequest, text: event.text })
            break
          case 'phase': phase.value = event.phase === 'thinking' ? '正在思考…' : '正在合成声音…'; break
          case 'audio':
            if (!mute.value) {
              playback.value.received++
              playback.value.firstAudioMs ??= performance.now() - requestStarted
              player.enqueue(event.pcm)
            }
            break
        }
      } catch { playback.value.failure = 'audio'; failChat('无法播放这段声音，请重试。'); stop(); error.value = '无法播放这段声音，请重试。' }
    })
    if (options.autoOpen !== false) void open()
  })
  watch(continueWorkId, () => { text.value = '继续创作的作品已更新，可以重新和我交流。'; input.value = ''; if (options.autoOpen !== false) void open(); else close() })
  watch(() => [preferences.value.textModel, preferences.value.mute, preferences.value.voice], () => { stop(); if (session) text.value = preferences.value.textModel ? '已切换为智能对话，可以重新发送。' : '已切换为预设陪伴，可以查询时间或当前作品。' })
  onBeforeUnmount(() => { disposed = true; close(); unsubscribe?.(); unsubscribeReset?.(); player.dispose() })
  return { text, input, error, ready, busy, playing, stateLabel, playback, run, stop, open, close }
}
