import { invalid } from '../core/validation'

export const chapterLimits = {
  maxId: 1_000_000,
  maxTitleLength: 200,
  maxContentLength: 2_000_000
} as const

export function chapterId(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > chapterLimits.maxId) {
    invalid('chapterId', `必须是 1 到 ${chapterLimits.maxId} 的整数`)
  }
  return value as number
}
