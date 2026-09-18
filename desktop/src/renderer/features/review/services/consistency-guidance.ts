import type { ConsistencyOverview } from '../../../../contracts/index'

// Suggestions and unknown checks are not prerequisites for writing.
export function consistencyGuidance(overview: ConsistencyOverview) {
  const requiredItem = overview.items.find(item => item.status === 'blocked')
  const optionalCount = overview.items.filter(item => item.status === 'attention').length
  const uncheckedCount = overview.items.filter(item => item.status === 'deferred').length
  return {
    requiredItem,
    heading: requiredItem ? 'AI 生成前，先处理这一项'
      : overview.readyForProse ? '可以继续写作，无需额外确认' : '可以手写正文，AI 生成还需准备',
    description: requiredItem ? requiredItem.summary
      : overview.readyForProse ? '进入书稿继续编辑，或到对话中请智能助笔续写。'
        : overview.blockers.join('；') || 'AI 生成条件尚未齐备，请先查看创作准备。',
    optionalNote: [
      ...(optionalCount ? [`${optionalCount} 项可选建议`] : []),
      ...(uncheckedCount ? [`${uncheckedCount} 项尚未检查`] : [])
    ].join('、')
  }
}
