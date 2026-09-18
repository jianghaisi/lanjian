export type PlanningOutlineScope = 'total' | 'volume'

export type PlanningOutlineAuditIssue = {
  code:
    | 'OUTLINE_EMPTY'
    | 'OUTLINE_TOO_BRIEF'
    | 'CAUSE_CHAIN_UNCLEAR'
    | 'EVENTS_WAITING_FOR_VOLUME'
    | 'VOLUME_WITHOUT_EVENTS'
    | 'VOLUME_WITHOUT_CHAPTERS'
    | 'EVENT_LOAD_HIGH'
  level: 'warning' | 'info'
  message: string
  suggestion: string
}

export type PlanningOutlineAuditInput = {
  scope: PlanningOutlineScope
  content: string
  eventCount: number
  chapterCount: number
  volumeCount?: number
  unplacedEventCount?: number
}

const causalCue = /因为|由于|导致|因此|所以|从而|于是|结果|迫使|引发|继而|进而|以致/g

export function auditPlanningOutline(input: PlanningOutlineAuditInput): {
  issues: PlanningOutlineAuditIssue[]
  metrics: { characterCount: number; sectionCount: number; causalCueCount: number; eventCount: number; chapterCount: number }
} {
  const content = input.content.replace(/\r\n?/g, '\n').trim()
  const characterCount = content.replace(/\s/g, '').length
  const sectionCount = content ? content.split(/\n+/).map((line) => line.trim()).filter(Boolean).length : 0
  const causalCueCount = content.match(causalCue)?.length || 0
  const issues: PlanningOutlineAuditIssue[] = []

  if (!content) {
    issues.push({
      code: 'OUTLINE_EMPTY',
      level: 'warning',
      message: input.scope === 'total' ? '总纲尚未写下故事主线。' : '本卷还没有阶段大纲。',
      suggestion: input.scope === 'total' ? '先写核心冲突、关键转折与结局方向。' : '先写本卷目标、主要阻力与卷末落点。'
    })
  } else if (characterCount < (input.scope === 'total' ? 80 : 50)) {
    issues.push({
      code: 'OUTLINE_TOO_BRIEF',
      level: 'warning',
      message: input.scope === 'total' ? '总纲信息较少，后续分卷可能缺少稳定边界。' : '卷纲信息较少，章纲可能难以判断本卷推进范围。',
      suggestion: input.scope === 'total' ? '可补充开局、至少一次转折和最终落点。' : '可补充阶段起点、转折、代价与卷末状态。'
    })
  }

  if (content && causalCueCount === 0) {
    issues.push({
      code: 'CAUSE_CHAIN_UNCLEAR',
      level: 'info',
      message: '暂未识别到明确的因果连接。',
      suggestion: '可用“因为、导致、因此、迫使”等词写清事件为什么推动下一步；若原文已经清楚，可以忽略。'
    })
  }

  if (input.scope === 'total' && (input.volumeCount || 0) > 0 && (input.unplacedEventCount || 0) > 0) {
    issues.push({
      code: 'EVENTS_WAITING_FOR_VOLUME',
      level: 'warning',
      message: `有 ${input.unplacedEventCount} 项正式事件已进总纲但尚未归卷。`,
      suggestion: '把事件归入实际发生的篇卷，避免后续章纲缺少阶段约束。'
    })
  }

  if (input.scope === 'volume' && input.eventCount === 0) {
    issues.push({
      code: 'VOLUME_WITHOUT_EVENTS',
      level: 'warning',
      message: '本卷尚未引用正式事件。',
      suggestion: '若使用事件库，请先归入本卷；完全手写且不使用事件库时可以忽略。'
    })
  }

  if (input.scope === 'volume' && input.chapterCount === 0) {
    issues.push({
      code: 'VOLUME_WITHOUT_CHAPTERS',
      level: 'info',
      message: '本卷尚未承载任何章节。',
      suggestion: '可以先写卷纲，再把实际章节归入本卷。'
    })
  }

  if (input.scope === 'volume' && input.eventCount > 12) {
    issues.push({
      code: 'EVENT_LOAD_HIGH',
      level: 'info',
      message: `本卷承载 ${input.eventCount} 项正式事件，阶段密度较高。`,
      suggestion: '核对是否需要拆卷，或确认每项事件都有足够章节承载。'
    })
  }

  return {
    issues,
    metrics: { characterCount, sectionCount, causalCueCount, eventCount: input.eventCount, chapterCount: input.chapterCount }
  }
}
