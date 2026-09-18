import { bookLengthLimits } from './book-length'

export const bookProfileLimits = {
  ...bookLengthLimits,
  maxWritingConstraintLength: 2_000,
  minAutosaveDelayMs: 250,
  maxAutosaveDelayMs: 60_000,
  minAutosaveMergeWindowMs: 1_000,
  maxAutosaveMergeWindowMs: 600_000
} as const
