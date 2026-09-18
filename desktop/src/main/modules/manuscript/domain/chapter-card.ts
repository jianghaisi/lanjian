export type ChapterCard = {
  goal: string
  entryState: string
  beats: string[]
  conflict: string
  characters: string[]
  pointOfView: string
  narrativeDistance: string
  exitChange: string
  hook: string
}

export type ChapterCardCompleteness = {
  complete: boolean
  missing: Array<keyof ChapterCard>
}

const requiredTextFields: Array<keyof Omit<ChapterCard, 'beats' | 'characters'>> = [
  'goal', 'entryState', 'conflict', 'pointOfView', 'narrativeDistance', 'exitChange', 'hook'
]

export function normalizeChapterCard(input: ChapterCard): ChapterCard {
  return {
    goal: boundedText(input.goal, '本章目标', 2_000),
    entryState: boundedText(input.entryState, '入口状态', 4_000),
    beats: boundedList(input.beats, '场景/节拍', 100, 2_000),
    conflict: boundedText(input.conflict, '本章冲突', 4_000),
    characters: boundedList(input.characters, '本章人物', 100, 200),
    pointOfView: boundedText(input.pointOfView, '视角', 200),
    narrativeDistance: boundedText(input.narrativeDistance, '叙述距离', 200),
    exitChange: boundedText(input.exitChange, '出口变化', 4_000),
    hook: boundedText(input.hook, '结尾钩子', 2_000)
  }
}

export function chapterCardCompleteness(card: ChapterCard): ChapterCardCompleteness {
  const missing: Array<keyof ChapterCard> = requiredTextFields.filter((field) => !card[field].trim())
  if (!card.beats.some((item) => item.trim())) missing.push('beats')
  if (!card.characters.some((item) => item.trim())) missing.push('characters')
  return { complete: missing.length === 0, missing }
}

function boundedText(value: unknown, label: string, maxLength: number): string {
  const normalized = String(value ?? '').trim()
  if (normalized.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 字符`)
  return normalized
}

function boundedList(values: unknown, label: string, maxItems: number, maxItemLength: number): string[] {
  if (!Array.isArray(values) || values.length > maxItems) throw new Error(`${label}条目不能超过 ${maxItems} 项`)
  return values.map((value) => boundedText(value, label, maxItemLength)).filter(Boolean)
}
