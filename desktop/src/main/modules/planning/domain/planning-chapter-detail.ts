import { createHash } from 'node:crypto'
import type { PlanningChapterDetailEntry } from '../../../../contracts/index'

export function renderPlanningChapterDetail(entry: PlanningChapterDetailEntry): string {
  if (entry.storyContent !== undefined) return `# 第 ${entry.chapter} 章 · ${entry.title.trim()}\n所属卷：第 ${entry.volume} 卷\n\n${entry.storyContent.trim()}\n`
  const actionLabels = { plant: '埋设', advance: '推进', misdirect: '误导', resolve: '回收', hold: '保持', discard: '废弃' } as const
  const foreshadow = entry.foreshadowActions
    .map((item) => `${actionLabels[item.action]}｜${item.description}`)
    .join('；')
  return [
    `进入状态：${entry.entryState}`,
    ...entry.beats.map((beat, index) => `${index + 1}. ${beat}`),
    ...(foreshadow ? [`伏笔：${foreshadow}`] : []),
    `退出状态：${entry.exitState}`,
    `允许扩写：${entry.allowedFacts.join('；')}`,
    `禁止：${entry.forbiddenEvents.join('；')}`
  ].join('\n')
}

export function chapterDetailFingerprint(entry: PlanningChapterDetailEntry): string {
  const value = entry.storyContent === undefined ? renderPlanningChapterDetail(entry) : JSON.stringify({
    chapter: entry.chapter, volume: entry.volume, volumeChapter: entry.volumeChapter, title: entry.title,
    storyContent: entry.storyContent, entryState: entry.entryState, beats: entry.beats, exitState: entry.exitState,
    allowedFacts: entry.allowedFacts, forbiddenEvents: entry.forbiddenEvents, foreshadowActions: entry.foreshadowActions
  })
  return createHash('sha256').update(value).digest('hex')
}
