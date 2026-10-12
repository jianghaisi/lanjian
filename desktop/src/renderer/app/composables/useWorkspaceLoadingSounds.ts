import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useUiSounds } from './useUiSounds'
import { createLoadingCueTracker, createQuickWorkspaceCueTracker, type LoadingSoundFrame, type QuickWorkspaceFrame } from '../services/ui-sound-timeline'

export function useWorkspaceLoadingSounds(read: () => LoadingSoundFrame) {
  const { player, store } = useUiSounds(), scope = player.scope('loading'), loop = player.scope('loading'), track = createLoadingCueTracker()
  const mounted = ref(false), waitingLong = ref(false), visible = ref(true), reduced = ref(false)
  let media: MediaQueryList | undefined
  const motion = () => { reduced.value = !!media?.matches }
  const frameNow = () => ({ ...read(), reduced: read().reduced || reduced.value })
  let timer: ReturnType<typeof setTimeout> | undefined
  const visibility = () => { visible.value = !document.hidden }
  watch(frameNow, frame => {
    if (!mounted.value) return
    if (frame.error || !frame.impact) scope.stop()
    for (const cue of track(frame)) void scope.play(cue)
  }, { flush: 'post' })
  watch(() => {
    const frame = frameNow(), p = store.preferences.value
    return mounted.value && waitingLong.value && visible.value && frame.impact && !frame.quick && !frame.reduced
      && !frame.error && frame.phase !== 'ready' && p.enabled && p.loading && p.waiting && p.volume > 0
  }, shouldLoop => {
    if (shouldLoop) void loop.play('L02'); else loop.stop()
  }, { flush: 'post' })
  onMounted(() => {
    media = matchMedia('(prefers-reduced-motion: reduce)'); motion(); media.addEventListener('change', motion)
    visibility(); document.addEventListener('visibilitychange', visibility)
    mounted.value = true
    for (const cue of track(frameNow())) void scope.play(cue)
    timer = setTimeout(() => { waitingLong.value = true }, 800)
  })
  onBeforeUnmount(() => { clearTimeout(timer); media?.removeEventListener('change', motion); document.removeEventListener('visibilitychange', visibility); scope.dispose(); loop.dispose() })
}

export function useQuickWorkspaceSounds(read: () => QuickWorkspaceFrame | undefined) {
  const { player } = useUiSounds(), scope = player.scope('loading'), track = createQuickWorkspaceCueTracker()
  watch(read, frame => {
    const action = track(frame)
    if (action.stop) { scope.stop(); if (frame?.impact) void player.preload(['U03']) }
    if (action.confirm) void scope.play('U03')
  }, { flush: 'sync' })
  onBeforeUnmount(scope.dispose)
}
