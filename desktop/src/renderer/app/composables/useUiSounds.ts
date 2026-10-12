import { onBeforeUnmount, onMounted, provide, watch } from 'vue'
import { interactionFeedbackKey, type InteractionCue } from '../../ui/interaction-feedback'
import { soundFiles, type SoundId } from '../services/ui-sound-catalog'
import { UiSoundPlayer } from '../services/ui-sound-player'
import { installSoundEvents } from '../services/ui-sound-events'
import { useSoundPreferences } from './useSoundPreferences'

const cues: Record<InteractionCue, SoundId> = {
  click: 'U02', confirm: 'U03', back: 'U04', navigate: 'U05', on: 'U06', off: 'U07',
  open: 'U08', close: 'U09', success: 'U10', warning: 'U11', error: 'U12',
}
function createSounds() {
  const store = useSoundPreferences()
  const player = new UiSoundPlayer({ preferences: () => store.preferences.value,
    visible: () => typeof document !== 'undefined' && !document.hidden,
    base: () => document.baseURI })
  const interaction = player.scope(), panels = player.scope()
  let activation = -Infinity, resultEpoch = 0
  const feedback = { play(cue: InteractionCue) {
    if (cue === 'open' || cue === 'close') { panels.stop(); void panels.play(cues[cue]) }
    else void interaction.play(cues[cue])
  } }
  return { player, feedback, store,
    activate: () => { activation = performance.now() },
    cancelResults: () => { resultEpoch++ },
    beginResult() {
      if (typeof document === 'undefined' || document.hidden || performance.now() - activation > 500) return undefined
      const epoch = resultEpoch
      return (cue: 'success' | 'error') => { if (epoch === resultEpoch) feedback.play(cue) }
    },
  }
}
let shared: ReturnType<typeof createSounds> | undefined
export function useUiSounds() { return shared ??= createSounds() }

/** Install once in the main shell; not in the detached companion window. */
export function useRootSoundFeedback() {
  const sounds = useUiSounds()
  provide(interactionFeedbackKey, sounds.feedback)
  let uninstall: (() => void) | undefined
  const stopWatch = watch(sounds.store.preferences, () => sounds.player.syncPreferences(), { deep: true, flush: 'sync' })
  onMounted(() => {
    const hover = sounds.player.scope()
    uninstall = installSoundEvents(document, {
      play: sounds.feedback.play, hover: () => { void hover.play('U01') }, activate: sounds.activate,
      unlock: () => { void sounds.player.unlock() },
      hide: () => { sounds.player.stop(); sounds.cancelResults() },
    })
    void sounds.player.preload(window.novelDesktop?.app.platform === 'browser' ? ['B15', 'V01', 'U02'] : Object.keys(soundFiles) as SoundId[])
  })
  onBeforeUnmount(() => { uninstall?.(); stopWatch(); sounds.cancelResults(); sounds.player.dispose(); shared = undefined })
  return sounds
}
