import type { BootScorePosition, SoundId } from './ui-sound-catalog'

export interface BootSoundFrame {
  seconds: number; arrayWait?: number | null; handoff: number; visible: boolean; reduced: boolean; cinematic: boolean; error: boolean; bypass: boolean
}
export function bootScore(frame: BootSoundFrame): BootScorePosition | null {
  if (!frame.visible || !frame.cinematic || frame.reduced || frame.error || frame.bypass || frame.handoff >= 0) return null
  if (frame.seconds < 12) return { id: 'B15', offset: frame.seconds }
  if (frame.seconds < 20) return { id: 'B16', offset: frame.arrayWait == null ? frame.seconds - 12 : 8 + frame.arrayWait }
  if (frame.seconds < 33) return { id: 'B17', offset: frame.seconds - 20 }
  return { id: 'B18' }
}
const bootCues: readonly [number, SoundId][] = [
  [1, 'V01'],
]
export function createBootCueTracker() {
  let time = -1, handoff = -1
  const seen = new Set<string>()
  return (frame: BootSoundFrame): SoundId[] => {
    const cues: SoundId[] = []
    const eligible = frame.visible && frame.cinematic && !frame.reduced && !frame.error && !frame.bypass
    const collect = (key: string, id: SoundId, crossed: boolean, late: boolean) => {
      if (!crossed || seen.has(key)) return
      seen.add(key)
      if (eligible && !late) cues.push(id)
    }
    for (const [at, id] of bootCues) collect(`${at}:${id}`, id, time < at && frame.seconds >= at, frame.seconds - at > .25)
    collect('handoff', 'B19', handoff < 0 && frame.handoff >= 0, frame.handoff > .25)
    time = frame.seconds; handoff = frame.handoff
    return cues
  }
}

export interface LoadingSoundFrame { phase: string; error: string; impact: boolean; quick: boolean; reduced: boolean }
export function createLoadingCueTracker() {
  let phase = '', error = '', mounted = false
  return (frame: LoadingSoundFrame): SoundId[] => {
    const cues: SoundId[] = []
    if (frame.impact) {
      if (frame.error && frame.error !== error) cues.push('U12')
      else if (!frame.error && frame.phase === 'ready' && (phase !== 'ready' || !!error)) cues.push(...(frame.quick || frame.reduced ? ['U03' as const] : ['L04' as const, 'L05' as const]))
      else if (!frame.error && !frame.quick && !frame.reduced) {
        if (!mounted) cues.push('L01')
        else if (frame.phase !== phase) cues.push('L03')
      }
    }
    mounted = true; phase = frame.phase; error = frame.error
    return cues
  }
}

export interface QuickWorkspaceFrame { generation: number; visible: boolean; replay: boolean; phase: string; impact: boolean }
/** Memory restores deliberately have no loading component. Observe their real ready transition. */
export function createQuickWorkspaceCueTracker() {
  let generation: number | undefined, complete = false
  return (frame: QuickWorkspaceFrame | undefined) => {
    if (!frame) {
      const stop = generation !== undefined && !complete
      generation = undefined; complete = false
      return { stop, confirm: false }
    }
    const stop = generation !== frame.generation
    if (stop) { generation = frame.generation; complete = false }
    const confirm = !complete && !frame.visible && !frame.replay && frame.impact && frame.phase === 'ready'
    if (frame.phase === 'ready') complete = true
    return { stop, confirm }
  }
}
