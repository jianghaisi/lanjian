export type PetRect = { left: number; top: number; right: number; bottom: number }
/** Presentation-only docking: never place an automatically repositioned pet over prose. */
export function placeCompanion(x: number, y: number, width: number, height: number, viewport: { width: number; height: number }, protectedRect?: PetRect | null) {
  const margin = 8
  const maxX = Math.max(margin, viewport.width - width - margin)
  const maxY = Math.max(margin, viewport.height - height - margin)
  let left = Math.max(margin, Math.min(maxX, x))
  const top = Math.max(Math.min(64, maxY), Math.min(maxY, y))
  if (protectedRect && top < protectedRect.bottom && top + height > protectedRect.top && left < protectedRect.right && left + width > protectedRect.left) {
    const leftDock = protectedRect.left - width - margin
    const rightDock = protectedRect.right + margin
    const available = [leftDock, rightDock].filter(candidate => candidate >= margin && candidate <= maxX)
    if (available.length) left = available.reduce((best, candidate) => Math.abs(candidate - left) < Math.abs(best - left) ? candidate : best)
  }
  return { x: left, y: top }
}
