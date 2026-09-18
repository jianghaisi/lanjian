import { intersection, type DialogueRect } from './companion-dialogue-placement'

/** Bottom of the character column, not a normal-flow row or part of the art transform. */
export function placeCompanionComposer(safe: DialogueRect, stage: DialogueRect, desiredHeight = 140) {
  const region = intersection(safe, stage) || safe
  const gap = 12
  const width = Math.max(1, Math.min(400, region.right - region.left - gap * 2))
  const height = Math.max(1, Math.min(desiredHeight, region.bottom - region.top - gap * 2))
  const left = region.left + Math.max(0, (region.right - region.left - width) / 2)
  const top = Math.max(region.top, region.bottom - height - gap)
  return { left, top, right: left + width, bottom: top + height, width, height }
}
