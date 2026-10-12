import videos from '../../../assets/visuals/pet-videos/manifest.json'

export const petAnimations = [
  { intent: 'idle', label: '待机', group: '日常', cycle: 3200 },
  { intent: 'blink', label: '眨眼', group: '日常', cycle: 480 },
  { intent: 'greet', label: '招呼', group: '日常', cycle: 1300 },
  { intent: 'pat', label: '摸头', group: '互动', cycle: 1300 },
  { intent: 'handshake', label: '握手', group: '互动', cycle: 1300 },
  { intent: 'drag', label: '提起', group: '日常', cycle: 1200 },
  { intent: 'land', label: '放下', group: '日常', cycle: 700 },
  { intent: 'thinking', label: '思考', group: '交流', cycle: 2400 },
  { intent: 'speaking', label: '说话', group: '交流', cycle: 800 },
  { intent: 'listening', label: '倾听', group: '交流', cycle: 2400 },
  { intent: 'writing', label: '陪写', group: '交流', cycle: 1300 },
  { intent: 'success', label: '完成', group: '交流', cycle: 1300 },
  { intent: 'warning', label: '困惑', group: '交流', cycle: 1300 },
  { intent: 'stretch', label: '伸懒腰', group: '日常', cycle: 2600 },
  { intent: 'playing', label: '小游戏', group: '互动', cycle: 1300 },
  { intent: 'eating', label: '喂食', group: '照料', cycle: 1300 },
  { intent: 'drinking', label: '喝水', group: '照料', cycle: 1300 },
  { intent: 'sleeping', label: '睡觉', group: '照料', cycle: 3200 }
] as const
export type PetAnimation = typeof petAnimations[number]['intent']
export const petActionDuration = 2600
export function petFrameCount(intent: PetAnimation) { return registration[intent].frames.length }
export const petTransitionDuration = 180
export const petActionRestDuration = 160
const oneShotActions: readonly PetAnimation[] = ['blink', 'greet', 'pat', 'handshake', 'success', 'warning', 'stretch', 'playing', 'eating', 'drinking']
export function petPlaybackDuration(intent: PetAnimation) {
  if (intent in videos) {
    const video = videos[intent as keyof typeof videos]
    return video.durationMs + (video.loop || intent === 'blink' ? 0 : petActionRestDuration)
  }
  const clip = petAnimations.find(item => item.intent === intent)!
  // Hold the final drawn pose across several render ticks before returning.
  // A new user action can still replace it immediately.
  const rest = intent !== 'blink' && oneShotActions.includes(intent) ? petActionRestDuration : 0
  return (intent === 'blink' ? clip.cycle : Math.max(petActionDuration, clip.cycle)) + petTransitionDuration + rest
}
export function petClipLoops(intent: PetAnimation) { return intent !== 'land' && !oneShotActions.includes(intent) }
export function isPetAnimation(value: string): value is PetAnimation {
  return petAnimations.some(item => item.intent === value)
}

/** Time sampling, never one-frame-per-tick: identical playback at 30/60/144 Hz.
 * Read the authored count from the atlas; interpolation is not a new drawing. */
export function samplePetClip(intent: PetAnimation, elapsed: number, reduced = false) {
  const clip = petAnimations.find(item => item.intent === intent)!
  const count = petFrameCount(intent), last = count - 1
  const still = Math.floor(count / 2) - 1
  if (reduced) return { frame: still, next: still, mix: 0 }
  const time = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0
  // Landing ends at a planted pose; it must never loop back into the air.
  const duration = intent === 'land' || intent === 'blink' ? clip.cycle : Math.max(petActionDuration, clip.cycle)
  const progress = petClipLoops(intent) ? time % clip.cycle / clip.cycle * count : Math.min(last, time / duration * last)
  const frame = Math.floor(progress), fraction = progress - frame
  return { frame, next: petClipLoops(intent) ? (frame + 1) % count : Math.min(last, frame + 1),
    mix: fraction }
}

export function resolvePetAnimation(intent: string, state: string, speaking: boolean, settling: boolean): PetAnimation {
  if (intent === 'drag') return 'drag'
  if (settling) return 'land'
  if (intent !== 'idle' && isPetAnimation(intent)) return intent
  if (speaking) return 'speaking'
  return isPetAnimation(state) ? state : 'idle'
}
import registration from '../../../assets/visuals/pet-sequences/registration.json'
