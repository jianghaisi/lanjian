import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { CompanionNoticePolicy, companionHoverMs, type CompanionNoticeReason } from '../../../../contracts/companion/companion-presence'
import { useCompanionVoice } from './use-companion-voice'
import { useCompanionVoicePreferences } from './use-companion-voice-preferences'
import { companionPreparation } from './use-companion-runtime'

// Shared across library remounts, not persisted as conversation/history.
const policy = new CompanionNoticePolicy()
export function useCompanionPresence(scope: Ref<string | null>, hover: Ref<boolean>, manual: Ref<boolean>) {
  const voice = useCompanionVoice(scope, {autoOpen:false})
  const {preferences} = useCompanionVoicePreferences()
  const active = ref(false), caption = ref(''), status = ref(''), tapped = ref(false)
  let disposed = false, lastTap = -Infinity, responseFinished = false
  let dismissal: ReturnType<typeof setTimeout> | undefined
  const visible = computed(() => active.value && (tapped.value || preferences.value.subtitles) && !!caption.value)
  let epoch = 0, typedAt = -Infinity, hoverTimer: ReturnType<typeof setTimeout> | undefined, expiry: ReturnType<typeof setTimeout> | undefined, clockTimer: ReturnType<typeof setInterval> | undefined, initial: ReturnType<typeof setTimeout> | undefined
  function foreground() { return !manual.value && !document.hidden && document.hasFocus() && !document.querySelector('dialog[open], [data-testid="app-boot"]') }
  function allowed() { return preferences.value.proactive && foreground() && Date.now() - typedAt > 6000 }
  function cancel() {
    epoch++; responseFinished = false; clearTimeout(hoverTimer); clearTimeout(expiry); clearTimeout(dismissal)
    active.value = false; caption.value = ''; status.value = ''; voice.close()
  }
  async function show(reason?: CompanionNoticeReason) {
    const token = ++epoch
    responseFinished = false; active.value = true; tapped.value = !reason; caption.value = ''; status.value = ''
    // A notice is never queued to play after it stopped being relevant.
    expiry = setTimeout(cancel, reason ? 22_000 : 180_000)
    await voice.open()
    if (disposed || token !== epoch || !foreground() || (reason === 'continue-hover' && !hover.value)) { if (token === epoch) cancel(); return }
    if (!voice.ready.value) { caption.value = '本地声音暂未就绪，可以在设置中检查。'; status.value = voice.stateLabel.value; clearTimeout(expiry); expiry = setTimeout(cancel,6000); return }
    await voice.run(reason ? 'notice' : 'tap',reason)
    if (token !== epoch) return
    responseFinished = true
    if (voice.error.value) { status.value = voice.error.value; if (!caption.value) caption.value = '这次回应未能完成。' }
    finishWhenQuiet()
  }
  async function remind(reason: CompanionNoticeReason) {
    if (!allowed() || companionPreparation.value.startsWith('后台准备中') || active.value || voice.busy.value || voice.playing.value || !policy.claim(reason,new Date(),scope.value)) return
    await show(reason)
  }
  function tap() {
    if (!foreground() || voice.busy.value || voice.playing.value || Date.now() - lastTap < 3000) return
    cancel(); lastTap = Date.now(); void show()
  }
  watch(voice.text, text => { if (active.value && text) caption.value = text })
  watch(voice.stateLabel, label => { if (active.value) status.value = voice.busy.value ? label : '' })
  function finishWhenQuiet() {
    clearTimeout(dismissal)
    // An empty audio queue between generated fragments is not the end of a reply.
    if (active.value && responseFinished && !voice.busy.value && !voice.playing.value) {
      clearTimeout(expiry)
      dismissal = setTimeout(cancel, voice.error.value ? 6000 : 4500)
    }
  }
  watch([voice.busy, voice.playing], finishWhenQuiet)
  watch(hover, value => {
    clearTimeout(hoverTimer)
    if (value) hoverTimer = setTimeout(() => { if (hover.value) void remind('continue-hover') },companionHoverMs)
    else if (active.value && !tapped.value) cancel()
  })
  watch([scope,manual,() => preferences.value.proactive,() => preferences.value.textModel,() => preferences.value.mute,() => preferences.value.voice], cancel)
  function keydown(event: KeyboardEvent) { if (event.key.length === 1 || event.key === 'Backspace' || event.isComposing) { typedAt = Date.now(); cancel() } }
  function hidden() { if (document.hidden || !document.hasFocus()) cancel() }
  onMounted(() => {
    initial = setTimeout(() => { void remind('late-night') },8000)
    clockTimer = setInterval(() => { void remind('late-night') },60_000)
    window.addEventListener('blur',hidden); document.addEventListener('visibilitychange',hidden); document.addEventListener('keydown',keydown)
  })
  onBeforeUnmount(() => { disposed = true; cancel(); clearTimeout(dismissal); clearTimeout(initial); clearInterval(clockTimer); window.removeEventListener('blur',hidden); document.removeEventListener('visibilitychange',hidden); document.removeEventListener('keydown',keydown) })
  return {visible,caption,status,playing:voice.playing,cancel,tap}
}
