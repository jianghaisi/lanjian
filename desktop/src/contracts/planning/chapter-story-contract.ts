/** Execution data is separate from the author-facing narrative. No authority flags. */
export type ChapterStoryConstraints = {
  entryState: string
  beats: string[]
  exitState: string
  allowedFacts: string[]
  forbiddenEvents: string[]
  foreshadowActions: Array<{ action: 'plant' | 'advance' | 'misdirect' | 'resolve' | 'hold' | 'discard'; description: string }>
}
export type ChapterStoryContractPreview = { token: string; chapterId: number; outlineHash: string; constraints: ChapterStoryConstraints }

export function decodeChapterStoryConstraints(raw: unknown): ChapterStoryConstraints {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('写作约束结构无效')
  const v = raw as Record<string, unknown>
  if (Object.keys(v).some(key => !['entryState', 'beats', 'exitState', 'allowedFacts', 'forbiddenEvents', 'foreshadowActions'].includes(key))) throw new Error('写作约束含未知字段')
  const text = (value: unknown, max = 5000) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('写作约束缺少内容或过长')
    return value.trim()
  }
  const list = (value: unknown, min: number, max: number) => {
    if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error('写作约束项目数量无效')
    return value.map(item => text(item))
  }
  if (!Array.isArray(v.foreshadowActions) || v.foreshadowActions.length > 8) throw new Error('伏笔约束数量无效')
  const foreshadowActions = v.foreshadowActions.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(key => !['action', 'description'].includes(key))
      || !['plant', 'advance', 'misdirect', 'resolve', 'hold', 'discard'].includes(item.action)) throw new Error('伏笔约束无效')
    return { action: item.action as ChapterStoryConstraints['foreshadowActions'][number]['action'], description: text(item.description, 2000) }
  })
  return { entryState: text(v.entryState), beats: list(v.beats, 2, 8), exitState: text(v.exitState), allowedFacts: list(v.allowedFacts, 1, 12), forbiddenEvents: list(v.forbiddenEvents, 1, 12), foreshadowActions }
}
