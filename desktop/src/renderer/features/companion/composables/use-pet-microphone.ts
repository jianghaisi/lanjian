import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { useCompanionSettings } from './use-companion-settings'
import { microphonePcm } from '../services/pet-microphone-pcm'

export function usePetMicrophone(draft: Ref<string>, scope: Ref<string | null>, stopPlayback: () => void) {
  const api = window.companionAsr, { settings } = useCompanionSettings()
  const phase = ref<'idle' | 'requesting' | 'recording' | 'transcribing'>('idle'), error = ref(''), seconds = ref(0), alternative = ref('')
  const level = ref(0)
  const active = computed(() => phase.value !== 'idle')
  let generation = 0, draftRevision = 0, captureId = '', stream: MediaStream | undefined, context: AudioContext | undefined, node: AudioWorkletNode | undefined
  let chunks: Float32Array[] = [], total = 0, timer: ReturnType<typeof setInterval> | undefined, flush: (() => void) | undefined
  watch(draft, () => { draftRevision++ }, { flush: 'sync' })
  function release() {
    clearInterval(timer); timer = undefined
    if (node) { node.port.onmessage = null; node.disconnect(); node.port.close(); node = undefined }
    stream?.getTracks().forEach(track => { track.onended = null; track.stop() }); stream = undefined
    if (context) { void context.close().catch(() => {}); context = undefined }
    flush?.(); flush = undefined; chunks = []; total = 0; level.value = 0
  }
  function cancel() {
    generation++; const id = captureId; captureId = ''; release(); phase.value = 'idle'
    if (id) void api?.cancel(id).catch(() => {})
  }
  async function start() {
    if (!api || active.value || alternative.value || !scope.value || !settings.value.microphone.enabled) return
    const token = ++generation, revision = draftRevision
    phase.value = 'requesting'; error.value = ''; alternative.value = ''; seconds.value = 0; stopPlayback()
    try {
      const grant = await api.begin()
      if (token !== generation) { void api.cancel(grant.captureId).catch(() => {}); return }
      captureId = grant.captureId
      const device = settings.value.microphone.deviceId
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: { ...(device ? { deviceId: { exact: device } } : {}), channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false })
      if (token !== generation) { acquired.getTracks().forEach(track => track.stop()); return }
      stream = acquired
      // Device IDs are partition-specific. Publish only IDs from the pet's actual capture session.
      void navigator.mediaDevices.enumerateDevices().then(devices => {
        if (token === generation) return api.publishDevices(devices.filter(device => device.kind === 'audioinput').slice(0, 32).map(device => ({ id: device.deviceId, label: device.label.slice(0, 160) })))
      }).catch(() => {})
      stream.getTracks().forEach(track => { track.onended = () => { cancel(); error.value = '麦克风已断开，请检查设备后重试。' } })
      const audio = new AudioContext(); context = audio
      await audio.audioWorklet.addModule(new URL('../services/pet-capture-worklet.js', import.meta.url).href)
      if (token !== generation) return
      node = new AudioWorkletNode(audio, 'pet-capture')
      node.port.onmessage = event => {
        if (token !== generation) return
        if (event.data === 'flushed') { flush?.(); return }
        if (event.data === 'limit') { void finish(revision); return }
        if (event.data instanceof Float32Array && total + event.data.length <= audio.sampleRate * 30 + 2048) { chunks.push(event.data); total += event.data.length; level.value = Math.min(1, Math.sqrt(event.data.reduce((sum, sample) => sum + sample * sample, 0) / event.data.length) * 5) }
      }
      const silence = audio.createGain(); silence.gain.value = 0
      audio.createMediaStreamSource(acquired).connect(node); node.connect(silence); silence.connect(audio.destination)
      await audio.resume()
      if (token !== generation) return
      phase.value = 'recording'
      const started = performance.now()
      timer = setInterval(() => { seconds.value = Math.min(30, Math.floor((performance.now() - started) / 1000)); if (seconds.value >= 30) void finish(revision) }, 200)
      recordingRevision = revision
    } catch (reason) {
      if (token !== generation) return
      cancel()
      const name = reason instanceof DOMException ? reason.name : ''
      error.value = name === 'NotAllowedError' ? '麦克风权限未开启，请在系统隐私设置中允许后重试。' : name === 'NotFoundError' || name === 'OverconstrainedError' ? '未找到所选麦克风，请重新选择输入设备。' : reason instanceof Error && reason.message.length < 160 && !name ? reason.message : '无法开始录音，请检查麦克风后重试。'
    }
  }
  let recordingRevision = 0
  async function finish(revision = recordingRevision) {
    if (phase.value === 'requesting') { cancel(); return }
    if (phase.value !== 'recording' || !api) return
    const token = generation, id = captureId, rate = context?.sampleRate ?? 0
    phase.value = 'transcribing'; clearInterval(timer)
    try {
      await new Promise<void>(resolve => { const timeout = setTimeout(resolve, 150); flush = () => { clearTimeout(timeout); resolve() }; node?.port.postMessage('flush') })
      if (token !== generation) return
      const pcm = microphonePcm(chunks, rate); release()
      const result = await api.transcribe({ captureId: id, sampleRate: 16000, pcm })
      if (token !== generation) return
      if (!result.text) error.value = '没有识别出文字，可以重新录制。'
      else if (draftRevision === revision && !draft.value) draft.value = result.text
      else alternative.value = result.text
    } catch (reason) {
      if (token === generation) error.value = reason instanceof Error && reason.message.length < 160 ? reason.message : '识别失败，请重试。'
    } finally { if (token === generation) { captureId = ''; release(); phase.value = 'idle'; void api.cancel(id).catch(() => {}) } }
  }
  function discardAlternative() { alternative.value = ''; error.value = '' }
  function useAlternative() {
    if (!alternative.value || active.value || !scope.value) return
    const separator = draft.value && !draft.value.endsWith('\n') ? '\n' : ''
    const next = draft.value + separator + alternative.value
    if (next.length > 2000) {
      error.value = '追加后超过 2000 字，请先缩短草稿或分次发送。识别文字仍保留在下方。'
      return
    }
    draft.value = next; discardAlternative()
  }
  function visibility() { if (document.hidden) cancel() }
  window.addEventListener('blur', cancel); document.addEventListener('visibilitychange', visibility)
  navigator.mediaDevices?.addEventListener('devicechange', cancel)
  watch(scope, () => { cancel(); alternative.value = ''; error.value = '' }, { flush: 'sync' })
  watch([() => settings.value.microphone.enabled, () => settings.value.microphone.deviceId, () => settings.value.microphone.mode], cancel, { flush: 'sync' })
  onBeforeUnmount(() => { cancel(); window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', visibility); navigator.mediaDevices?.removeEventListener('devicechange', cancel) })
  return { phase, active, seconds, level, error, alternative, start, finish: () => finish(), cancel, useAlternative, discardAlternative }
}
