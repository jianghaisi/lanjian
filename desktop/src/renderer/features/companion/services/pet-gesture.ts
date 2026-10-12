/** Screen deltas stay stable while Electron moves the native window. */
export function petDragThreshold(start: { x: number; y: number }, current: { x: number; y: number }, scale = 1): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= 6 * scale
}
export function petDragTilt(velocityX: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : Math.max(-10, Math.min(10, -velocityX / 150))
}
