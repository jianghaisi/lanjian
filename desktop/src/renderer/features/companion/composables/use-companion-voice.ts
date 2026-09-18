import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { CompanionAudioPlayer } from '../services/companion-audio-player'
import { type CompanionVoiceRequest } from '../../../../contracts/companion/companion-voice-contracts'
import { useCompanionVoicePreferences } from './use-companion-voice-preferences'
import type { CompanionNoticeReason } from '../../../../contracts/companion/companion-presence'
import { companionRuntimeOptions } from './use-companion-runtime'

export function useCompanionVoice(continueWorkId: Ref<string | null>, options: { autoOpen?: boolean; input?: Ref<string> } = {}) {
  const api = window.novelDesktop?.companionVoice
  const text = ref('欢迎回来。可以问我时间、继续创作的作品，或聊聊你的灵感。')
  const input = options.input || ref(''), error = ref(''), ready = ref(false), busy = ref(false), playing = ref(false), phase = ref('准备本地对话…')
  const { preferences } = useCompanionVoicePreferences()
  if (!preferences.value.textModel) text.value = '现在是预设陪伴模式。可以问我时间、当前页面，或继续创作的作品。'
  const voice = computed(() => preferences.value.voice), volume = computed(() => preferences.value.volume), mute = computed(() => preferences.value.mute)
  let session = '', request = '', generation = 0, sequence = 0, unsubscribe: (() => void) | undefined, disposed = false
  const player = new CompanionAudioPlayer(value => { playing.value = value })
  const stateLabel = computed(() => playing.value ? '正在说话' : busy.value ? phase.value : ready.value ? preferences.value.textModel ? '智能对话 · 不会修改作品' : '预设陪伴 · 未启用文字模型' : phase.value)
  watch([volume, mute], () => {
    player.volume(mute.value ? 0 : volume.value)
  })
  function stop() {
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
      await api.configure(companionRuntimeOptions(preferences.value))
      if (token !== generation || disposed) return
      const result = await api.open({ continueWorkId: continueWorkId.value ? 'library-current' : null })
      if (token !== generation || disposed) { void api.close(result.sessionId).catch(() => {}); return }
      session = result.sessionId; ready.value = true
    } catch { if (token === generation && !disposed) phase.value = '无法开启本地对话，请关闭后重试。' }
  }
  async function run(action: CompanionVoiceRequest['action'] = 'chat', notice?: CompanionNoticeReason) {
    if (!api || !session || busy.value || (action === 'chat' && !input.value.trim())) return
    stop()
    const token = generation, submitted = input.value
    error.value = ''; busy.value = true; phase.value = '加载本地模型…'
    if (action === 'notice' || action === 'tap') text.value = ''
    request = crypto.randomUUID(); sequence = 0
    try {
      if (!mute.value) await player.prepare(volume.value)
      if (token !== generation) return
      const result = await api.request({ sessionId: session, requestId: request, action, text: action === 'chat' ? submitted : '', voice: voice.value, mute: mute.value, ...(action === 'notice' ? {notice} : {}) })
      if (token !== generation || disposed) return
      text.value = result.text
      if (action === 'chat' && input.value === submitted) input.value = ''
    } catch (reason) {
      if (token !== generation || disposed) return
      player.stop()
      error.value = reason && typeof reason === 'object' && 'message' in reason && typeof reason.message === 'string' ? reason.message : '本地对话失败，请重试。'
    } finally { if (token === generation) busy.value = false }
  }
  onMounted(() => {
    unsubscribe = api?.onEvent(event => {
      if (event.sessionId !== session || event.requestId !== request || disposed) return
      if (event.sequence !== sequence++) { stop(); error.value = '音频顺序异常，已停止播放，请重试。'; return }
      try {
        switch (event.kind) {
          case 'text': text.value = event.text; break
          case 'phase': phase.value = event.phase === 'thinking' ? '正在思考…' : '正在合成声音…'; break
          case 'audio': if (!mute.value) player.enqueue(event.pcm); break
        }
      } catch { stop(); error.value = '无法播放这段声音，请重试。' }
    })
    if (options.autoOpen !== false) void open()
  })
  watch(continueWorkId, () => { text.value = '继续创作的作品已更新，可以重新和我交流。'; input.value = ''; if (options.autoOpen !== false) void open(); else close() })
  watch(() => [preferences.value.textModel, preferences.value.mute, preferences.value.voice], () => { stop(); if (session) text.value = preferences.value.textModel ? '已切换为智能对话，可以重新发送。' : '已切换为预设陪伴，可以查询时间或当前作品。' })
  onBeforeUnmount(() => { disposed = true; close(); unsubscribe?.(); player.dispose() })
  return { text, input, error, ready, busy, playing, stateLabel, run, stop, open, close }
}
