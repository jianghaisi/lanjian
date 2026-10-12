export const soundFiles = {
  B15: 'B15-boot-prelude.wav', B16: 'B16-boot-wave-loop.wav', B17: 'B17-boot-resolve.wav',
  B18: 'B18-boot-idle-loop.wav', B19: 'B19-boot-exit.wav', V01: 'V01-lanjian.mp3',
  L01: 'L01-load-impact-start.wav', L02: 'L02-load-wait-loop.wav', L03: 'L03-load-step.wav',
  L04: 'L04-load-ready.wav', L05: 'L05-load-reveal.wav',
  U01: 'U01-ui-hover.wav', U02: 'U02-ui-click.wav', U03: 'U03-ui-confirm.wav', U04: 'U04-ui-back.wav',
  U05: 'U05-ui-navigate.wav', U06: 'U06-ui-toggle-on.wav', U07: 'U07-ui-toggle-off.wav',
  U08: 'U08-ui-panel-open.wav', U09: 'U09-ui-panel-close.wav', U10: 'U10-ui-success.wav',
  U11: 'U11-ui-warning.wav', U12: 'U12-ui-error.wav',
} as const
export type SoundId = keyof typeof soundFiles
export type BootScoreId = 'B15' | 'B16' | 'B17' | 'B18'
/** Undefined offset is a free-running idle loop; other offsets follow the visible clock. */
export interface BootScorePosition { id: BootScoreId; offset?: number; sampledAt?: number }
export const BOOT_CROSSFADE_SECONDS = .8
export function isBootScore(id: SoundId): id is BootScoreId { return id === 'B15' || id === 'B16' || id === 'B17' || id === 'B18' }
export function scoreLoops(id: BootScoreId) { return id === 'B16' || id === 'B18' }
export type SoundCategory = 'boot' | 'loading' | 'interaction'
export function soundCategory(id: SoundId): SoundCategory {
  return id.startsWith('B') || id === 'V01' ? 'boot' : id.startsWith('L') ? 'loading' : 'interaction'
}
export function soundUrl(id: SoundId, base: string): string {
  const browser = typeof window !== 'undefined' && window.novelDesktop?.app.platform === 'browser'
  const file = soundFiles[id]
  return new URL(browser && file.endsWith('.wav') ? `sounds/web-v1/${file.replace('.wav', '.mp3')}` : `sounds/v1/${file}`, base).href
}
export function soundGain(id: SoundId): number { return id === 'V01' ? .55 : 1 }
export function soundThrottle(id: SoundId): { key: string; ms: number } {
  // Its active-source guard deduplicates the loop. A fast hide/show must be able
  // to resume immediately, without losing the only visibility-change request.
  if (id === 'L02') return { key: id, ms: 0 }
  if (id === 'U01') return { key: 'hover', ms: 150 }
  if (['U10', 'U11', 'U12'].includes(id)) return { key: 'result', ms: 500 }
  if (['U08', 'U09'].includes(id)) return { key: 'control', ms: 70 }
  if (id.startsWith('U')) return { key: 'control', ms: 70 }
  return { key: id, ms: id === 'L03' ? 160 : 60 }
}
