/** Shared, pure projection of the author's volume/chapter plan. */
export const bookLengthLimits = {
  maxVolumes: 100,
  maxChaptersPerVolume: 500,
  minWordsPerChapter: 300,
  maxWordsPerChapter: 50_000,
  minTotalWords: 300,
  maxTotalWords: 100 * 500 * 50_000
} as const

export function calculateBookLength(plan: {
  plannedVolumes: unknown
  chaptersPerVolume: unknown
  targetWordsPerChapter: unknown
}): { chapters: number; targetWords: number } | null {
  const { plannedVolumes, chaptersPerVolume, targetWordsPerChapter } = plan
  const valid = (value: unknown, min: number, max: number): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
  if (!valid(plannedVolumes, 1, bookLengthLimits.maxVolumes)
    || !valid(chaptersPerVolume, 1, bookLengthLimits.maxChaptersPerVolume)
    || !valid(targetWordsPerChapter, bookLengthLimits.minWordsPerChapter, bookLengthLimits.maxWordsPerChapter)) return null
  const chapters = plannedVolumes * chaptersPerVolume
  return { chapters, targetWords: chapters * targetWordsPerChapter }
}
