import manifest from '../../../assets/visuals/pet-videos/manifest.json'
import type { PetAnimation } from './pet-action-motion'
import type { PetVideoClip } from './pet-video-player'

export type PetVideoId = keyof typeof manifest
export function petVideoAvailable(intent: PetAnimation) { return intent in manifest }
export function petVideoClip(intent: PetAnimation): PetVideoClip {
  // The rejected handshake is intentionally absent from the shipped manifest.
  const id: PetVideoId = intent in manifest ? intent as PetVideoId : 'idle'
  const clip = manifest[id]
  return { id, url: new URL(`../../../assets/visuals/pet-videos/${id}.webm`, import.meta.url).href,
    frames: clip.frames, fps: clip.fps, loop: clip.loop }
}
