export const CINEMATIC_DURATION = 33
export const ARRAY_GATE = 19.9999
export const ARRAY_REPEAT_DURATION = 8
export const HANDOFF_DURATION = 1.65
export const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n))
export const progress = (time: number, start: number, end: number) => end <= start ? Number(time >= end) : clamp((time - start) / (end - start))
export const ease = (n: number) => { const p = clamp(n); return p * p * p * (p * (p * 6 - 15) + 10) }
export type CinematicStage = 'access' | 'mark' | 'identity' | 'scan' | 'welcome' | 'array' | 'extract' | 'inspect' | 'await-click'
export function cinematicStage(t: number): CinematicStage {
  if (t < 1) return 'access'
  if (t < 3) return 'mark'
  if (t < 5) return 'identity'
  if (t < 9) return 'scan'
  if (t < 12) return 'welcome'
  if (t < 20) return 'array'
  if (t < 25) return 'extract'
  if (t < CINEMATIC_DURATION) return 'inspect'
  return 'await-click'
}
export function advanceCinematic(time: number, delta: number, ready: boolean, visible: boolean) {
  if (!visible) return time
  const next = time + clamp(delta, 0, .1)
  return Math.min(next, !ready && time <= ARRAY_GATE ? ARRAY_GATE : CINEMATIC_DURATION)
}
/** Readiness releases a held array only at the end of the current forward sweep. */
export function advanceArrayWait(elapsed:number,delta:number,ready:boolean,visible:boolean):number|null {
  if(!visible)return elapsed
  const next=elapsed+clamp(delta,0,.1)
  return ready&&Math.floor(next/ARRAY_REPEAT_DURATION)>Math.floor(elapsed/ARRAY_REPEAT_DURATION)?null:next
}
export function repeatWaveTime(elapsed:number){return 12.4+elapsed%ARRAY_REPEAT_DURATION}
export function typed(text: string, time: number, start: number, duration: number) {
  return Array.from(text).slice(0, Math.floor(progress(time, start, start + duration) * Array.from(text).length)).join('')
}
/** One wave travels along camera-right, once; no returning crest or repeating oscillation. */
export function archiveWave(row: number, lane: number, time: number) {
  const screenAxis = row * .92 * .56 + lane * 7.2 * .83
  const center = -25 + progress(time, 12.8, 19.6) * 50
  const d = screenAxis - center
  const crest = 3.2 * Math.exp(-.5 * (d / 2.9) ** 2)
  return crest * ease(progress(time,12.6,13.3)) * (1-ease(progress(time,19.6,20.4)))
}
export function archiveLift(time: number) {
  return .55 * ease(progress(time, 20.4, 21.6)) + 4.65 * ease(progress(time, 22, 25))
}
export function structureSeparation(time: number) {
  return ease(progress(time, 26.5, 28)) * (1 - ease(progress(time, 29.2, 30.5)))
}
/** Large enough to begin beyond the viewport; settles at an architectural scale. */
export function scanScale(time: number) { return 1 + 1.8 * Math.exp(-Math.max(0, time - 5) * 2.5) }
/** A left-to-right cover crosses each cut, fully concealing the stage swap. */
export function shutterOffset(time:number,start:number,band=0) {
  const cover=ease(progress(time,start+band*.035,start+.3))
  const uncover=ease(progress(time,start+.44+band*.035,start+.78))
  return -105*(1-cover)+105*uncover
}
/** The array follows the same screen-space direction as its traveling crest. */
export function archiveOpen(row:number,lane:number,time:number) {
  const axis=row*.92*.56+lane*7.2*.83
  const start=11.72+clamp((axis+25)/50)*.8
  return ease(progress(time,start,start+.85))
}
/** Small, non-oscillating press response before the shared-element travel. */
export function handoffPress(time:number) {
  return 1-.012*ease(progress(time,0,.075))*(1-ease(progress(time,.075,.2)))
}
export interface ScreenRect { x: number; y: number; width: number; height: number }
/** Fixed layout + compositor transform; no per-frame width/height or container-query reflow. */
export function rectTransform(layout:ScreenRect,paint:ScreenRect){
  return `translate3d(${paint.x-layout.x}px,${paint.y-layout.y}px,0) scale(${paint.width/Math.max(1,layout.width)},${paint.height/Math.max(1,layout.height)})`
}
export function interpolateRect(a: ScreenRect, b: ScreenRect, p: number): ScreenRect {
  const t = clamp(p)
  return { x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t, width:a.width+(b.width-a.width)*t, height:a.height+(b.height-a.height)*t }
}
