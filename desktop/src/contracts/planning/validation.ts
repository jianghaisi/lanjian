import { invalid } from '../core/validation'

export const planningLimits = {
  maxOutlineVolume: 10_000,
  maxOutlineLength: 2_000_000,
  maxSourceNotesLength: 1_000_000,
  maxWorldViewLength: 1_000_000,
  maxTimelineEvents: 10_000,
  maxRealms: 1_000,
  maxSystemTemplateLength: 100_000
} as const

export function outlineVolume(value: unknown): number | 'total' {
  if (value === 'total') return value
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > planningLimits.maxOutlineVolume) {
    invalid('volume', `必须是 total 或 1 到 ${planningLimits.maxOutlineVolume} 的整数`)
  }
  return value as number
}
