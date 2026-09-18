import type { PlanningChapterDetailEntry } from '../../../../contracts/index'

export function renderPlanningChapterDetail(entry: PlanningChapterDetailEntry): string {
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
