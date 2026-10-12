import { onBeforeUnmount, watch } from 'vue'
import { useUiSounds } from './useUiSounds'
import { bootScore, createBootCueTracker, type BootSoundFrame } from '../services/ui-sound-timeline'

export function useBootSounds(frame: () => BootSoundFrame) {
  const { player, store } = useUiSounds(), scope = player.scope('boot'), score = player.scope('boot'), track = createBootCueTracker()
  watch([frame, store.preferences], ([value, preferences]) => {
    if (!value.visible || value.reduced || !value.cinematic || value.error || value.bypass
      || !preferences.enabled || !preferences.boot || preferences.volume <= 0) { scope.stop(); score.stop() }
    else {
      const position = bootScore(value)
      void score.score(position ? { ...position, sampledAt: performance.now() } : null)
    }
    // Consume skipped/muted cue crossings as well; never replay the brand on recovery.
    for (const cue of track(value)) void scope.play(cue, cue === 'V01' ? value.seconds - 1 : value.handoff)
  // Consume a complete, rendered frame, not the intermediate arrayWait/seconds
  // pair while the animation releases its readiness gate.
  }, { immediate: true, flush: 'post' })
  onBeforeUnmount(() => { scope.dispose(); score.dispose() })
  return scope
}
