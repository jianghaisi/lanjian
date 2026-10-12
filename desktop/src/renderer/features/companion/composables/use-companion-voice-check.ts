import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { CompanionVoiceApi } from '../../../../contracts/companion/companion-voice-contracts'
import { companionVoices } from '../../../../contracts/companion/companion-voice-contracts'
import { useCompanionVoicePreferences } from './use-companion-voice-preferences'
import type { useCompanionVoice } from './use-companion-voice'

const labels = { settings: '声音开关与音量', installation: '语音文件', session: '测试会话', preparation: '当前音色准备', audio: '播放通道', synthesis: '合成与接收音频', playback: '播放队列结束' }
type StepId = keyof typeof labels
type Step = { id: StepId; label: string; state: '未检查' | '检查中' | '通过' | '未就绪' | '失败' | '已停止'; detail: string; ms: number; started: number }
type Result = 'idle' | 'running' | 'confirm' | 'heard' | 'unheard' | 'failed' | 'stopped'

/** On-demand, memory-only evidence. No polling, model ownership or persistent report. */
export function useCompanionVoiceCheck(voice: ReturnType<typeof useCompanionVoice>, api = window.novelDesktop?.companionVoice as CompanionVoiceApi | undefined) {
  const { preferences, ready: settingsReady, error: settingsError } = useCompanionVoicePreferences()
  const steps = ref<Step[]>([]), result = ref<Result>('idle'), message = ref(''), selectedVoice = ref('')
  const active = computed(() => result.value === 'running')
  let epoch = 0, timer: ReturnType<typeof setInterval> | undefined, waiting: StepId = 'settings', deadline = 0
  function clearTimer() { if (timer !== undefined) clearInterval(timer); timer = undefined }
  function step(id: StepId) { return steps.value.find(item => item.id === id)! }
  function begin(id: StepId, timeout = 15_000) {
    waiting = id; deadline = performance.now() + timeout
    Object.assign(step(id), { state: '检查中', started: performance.now() })
  }
  function finish(id: StepId, detail: string, state: Step['state'] = '通过') {
    const item = step(id)
    Object.assign(item, { state, detail, ms: Math.max(0, performance.now() - item.started) })
  }
  function end(next: Result, detail: string) { epoch++; clearTimer(); result.value = next; message.value = detail }
  function fail(id: StepId, detail: string, state: Step['state'] = '失败') {
    if (!active.value) return
    finish(id, detail, state)
    for (const item of steps.value) if (item.state === '检查中') finish(item.id, '检测未完成', '已停止')
    end('failed', detail); voice.close()
  }
  function cancel() {
    if (active.value) {
      for (const item of steps.value) if (item.state === '检查中') finish(item.id, '本次检测已停止', '已停止')
      end('stopped', '已停止。不会卸载常驻语音模型；可以重新检测。')
      voice.close()
    } else if (result.value !== 'idle') {
      end('idle', ''); steps.value = []; selectedVoice.value = ''
    }
  }
  function observe() {
    if (!active.value || !steps.value.length || step('audio').state === '未检查') return
    const audio = voice.playback.value
    if (audio.failure) {
      fail(audio.failure === 'request' ? 'synthesis' : 'audio', audio.failure === 'request' ? '语音合成未完成，请稍后重试。' : '音频播放未完成，请重试。')
      return
    }
    if (audio.context !== 'unchecked') {
      if (audio.context !== 'running') { fail('audio', '播放通道未就绪，尚不能确认播放。请重新点击检测。', '未就绪'); return }
      if (step('audio').state === '检查中') {
        finish('audio', '播放通道已运行；不代表扬声器已出声')
        begin('synthesis', 190_000)
      }
    }
    if (audio.received && step('synthesis').state === '检查中') {
      step('synthesis').detail = `已收到 ${audio.received} 段音频，等待合成结束`
    }
    if (!audio.settled) return // An empty queue between fragments is NOT completion.
    if (!audio.received) { fail('synthesis', '请求已结束，但未收到音频。请重试。'); return }
    if (step('synthesis').state === '检查中') {
      finish('synthesis', `收到 ${audio.received} 段音频；首段 ${(audio.firstAudioMs! / 1000).toFixed(1)} 秒`)
      begin('playback', 35_000)
    }
    if (audio.queued === audio.received && audio.ended === audio.queued) {
      finish('playback', `${audio.ended} 段音频自然播放结束`)
      end('confirm', '软件播放已完成。你听到测试语音了吗？')
    }
  }
  async function start() {
    if (active.value || voice.busy.value || voice.playing.value) return
    const token = ++epoch
    result.value = 'running'; message.value = '正在检查声音设置…'
    steps.value = Object.entries(labels).map(([id, label]) => ({ id: id as StepId, label, state: '未检查', detail: '', ms: 0, started: 0 }))
    selectedVoice.value = ''
    begin('settings')
    timer = setInterval(() => {
      for (const item of steps.value) if (item.state === '检查中') item.ms = Math.max(0, performance.now() - item.started)
      if (performance.now() > deadline) fail(waiting, '等待此步骤超时。已停止本次检测，可稍后重试；模型不会因此卸载。', '未就绪')
    }, 250)
    const current = () => token === epoch && active.value
    try {
      await settingsReady
      if (!current()) return
      if (settingsError.value) { fail('settings', '声音设置尚未成功读取或保存。请先重试设置，再检测。', '未就绪'); return }
      selectedVoice.value = companionVoices.find(item => item.id === preferences.value.voice)!.label
      if (preferences.value.mute) { fail('settings', '语音功能已关闭。请先开启“语音模型”，再检测。', '未就绪'); return }
      if (preferences.value.volume === 0) { fail('settings', '应用音量为 0。请调高音量后再检测。', '未就绪'); return }
      finish('settings', `音量 ${Math.round(preferences.value.volume * 100)}%`)
      begin('installation')
      if (!api) { fail('installation', '当前环境不支持本地语音检测。', '未就绪'); return }
      const status = await api.status()
      if (!current()) return
      if (!status.speechInstalled) { fail('installation', '未找到完整语音资产。请检查本地语音安装后重试。', '未就绪'); return }
      finish('installation', '语音文件可用；尚不代表模型已加载')
      begin('session')
      await voice.open() // Existing saved-options configuration and session ownership.
      if (!current()) return
      if (!voice.ready.value) { fail('session', '无法开启测试会话，请关闭设置后重试。', '未就绪'); return }
      finish('session', '测试会话已开启')
      begin('preparation', 610_000)
      message.value = '正在准备当前音色；首次加载可能较久。'
      const prepared = await api.prepare(preferences.value.voice) // Never warmup Qwen.
      if (!current()) return
      if (!prepared) { fail('preparation', '当前语音未就绪，可能仍有其他语音任务。请稍后重试。', '未就绪'); return }
      finish('preparation', '当前音色已完成准备')
      // The shared player resumes only on this explicit interaction; failure is observable.
      begin('audio'); message.value = '正在播放测试语音…'
      await voice.run('preview')
      if (!current()) return
      observe()
    } catch (reason) {
      let detail = `${labels[waiting]}未完成，请稍后重试。`
      // Only the existing main-sanitized error envelope may supply diagnostic copy.
      if (reason && typeof reason === 'object' && 'code' in reason
        && (reason.code === 'FEATURE_UNAVAILABLE' || reason.code === 'CONFLICT')
        && 'message' in reason && typeof reason.message === 'string' && reason.message.length <= 300) detail = reason.message
      if (current()) fail(waiting, detail)
    }
  }
  function confirm(heard: boolean) {
    if (result.value !== 'confirm') return
    end(heard ? 'heard' : 'unheard', heard ? '你已确认听到声音，本次检测完成。' : '软件播放已结束，但你未听到。请检查系统音量、输出设备，以及音量混合器中的岚笺音量。这里无法检测扬声器或系统混音器。')
  }
  watch(voice.playback, observe, { deep: true, flush: 'sync' })
  watch(voice.ready, value => { if (!value && active.value && ['preparation', 'audio', 'synthesis', 'playback'].includes(waiting)) cancel() }, { flush: 'sync' })
  watch(() => [preferences.value.voice, preferences.value.textModel, preferences.value.mute, preferences.value.volume], () => {
    if (!(active.value && waiting === 'settings')) cancel()
  }, { flush: 'sync' })
  onBeforeUnmount(cancel)
  return { steps, result, message, selectedVoice, active, start, cancel, confirm }
}
