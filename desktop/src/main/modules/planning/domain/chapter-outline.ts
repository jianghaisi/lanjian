const beatMarker = /^(?:[-*•]\s+|\d{1,3}[.、)）]\s*|[一二三四五六七八九十百]+[.、)）]\s*|(?:剧情)?节点\s*\d{1,3}[：:]?\s*)/
const forbiddenMarker = /^(?:禁止|不得|不可|不能|严禁|不要|避免)[：:]?\s*/
const entryStateMarker = /^(?:进入状态|入场状态|起始状态)[：:]?\s*/
const exitStateMarker = /^(?:退出状态|离场状态|结束状态)[：:]?\s*/
const allowedFactsMarker = /^(?:允许扩写|允许事实|可扩写)[：:]?\s*/
const foreshadowMarker = /^(?:伏笔|伏笔动作)[：:]?\s*/
const boundaryMarker = /^(?:进入状态|入场状态|起始状态|退出状态|离场状态|结束状态|允许扩写|允许事实|可扩写|伏笔|伏笔动作)[：:]?\s*/

export type ParsedChapterOutline = {
  requirements: string[]
  forbiddenEvents: string[]
  entryState: string
  exitState: string
  allowedFacts: string[]
  foreshadowActions: Array<{ id: string; action: 'plant' | 'advance' | 'misdirect' | 'resolve' | 'hold' | 'discard'; description: string }>
  invalidForeshadowLines: string[]
}
export type OutlineAuditIssue = {
  code: 'STORY_CONTRACT_REQUIRED' | 'OUTLINE_EMPTY' | 'TOO_FEW_BEATS' | 'TOO_MANY_BEATS' | 'DUPLICATE_BEAT' | 'MISSING_FORBIDDEN' | 'MISSING_ENTRY_STATE' | 'MISSING_EXIT_STATE' | 'MISSING_ALLOWED_FACTS' | 'INVALID_FORESHADOW_ACTION' | 'UNSTRUCTURED_BEATS'
  level: 'error' | 'warning'
  message: string
}

export function parseChapterOutline(outline: string): ParsedChapterOutline {
  const normalized = outline.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean)
  const forbiddenEvents = lines.filter((line) => forbiddenMarker.test(line)).map((line) => line.replace(forbiddenMarker, '').trim()).filter(Boolean)
  const entryState = lines.find((line) => entryStateMarker.test(line))?.replace(entryStateMarker, '').trim() || ''
  const exitState = lines.find((line) => exitStateMarker.test(line))?.replace(exitStateMarker, '').trim() || ''
  const allowedFacts = lines
    .filter((line) => allowedFactsMarker.test(line))
    .flatMap((line) => line.replace(allowedFactsMarker, '').split(/[；;]+/))
    .map((item) => item.trim())
    .filter(Boolean)
  const actionNames = { '埋设': 'plant', '推进': 'advance', '强化': 'advance', '误导': 'misdirect', '回收': 'resolve', '保持': 'hold', '废弃': 'discard' } as const
  const foreshadowLines = lines.filter((line) => foreshadowMarker.test(line))
  const parsedForeshadow = foreshadowLines.map((line) => {
    const value = line.replace(foreshadowMarker, '').trim()
    const match = value.match(/^(埋设|推进|强化|误导|回收|保持|废弃)[｜|：:]\s*(.+)$/)
    return match ? { action: actionNames[match[1] as keyof typeof actionNames], description: match[2].trim() } : null
  })
  const foreshadowActions = parsedForeshadow.filter((item): item is NonNullable<typeof item> => Boolean(item?.description)).map((item, index) => ({ id: `F${index + 1}`, ...item }))
  const invalidForeshadowLines = foreshadowLines.filter((_, index) => !parsedForeshadow[index])
  const marked = lines.filter((line) => beatMarker.test(line) && !forbiddenMarker.test(line) && !boundaryMarker.test(line))
  let requirements = marked.map((line) => line.replace(beatMarker, '').trim()).filter(Boolean)
  if (!requirements.length) {
    const unmarkedLines = lines.filter((line) => !forbiddenMarker.test(line) && !boundaryMarker.test(line))
    requirements = unmarkedLines.length > 1
      ? unmarkedLines
      : normalized.split(/\n\s*\n/).map((block) => block.replace(/\s+/g, ' ').trim()).filter((block) => block && !forbiddenMarker.test(block))
  }
  if (requirements.length === 1 && requirements[0].length > 120) {
    requirements = requirements[0].split(/(?<=[。！？；])/).map((item) => item.trim()).filter(Boolean)
  }
  return { requirements: requirements.slice(0, 20), forbiddenEvents, entryState, exitState, allowedFacts, foreshadowActions, invalidForeshadowLines }
}

export function auditChapterOutline(outline: string, formalEventCount = 0, constraints?: import('../../../../contracts/planning/chapter-story-contract').ChapterStoryConstraints): {
  issues: OutlineAuditIssue[]
  metrics: { beatCount: number; forbiddenCount: number; formalEventCount: number; boundaryCount: number; foreshadowCount: number }
} {
  const parsed = constraints ? { ...constraints, requirements: constraints.beats, invalidForeshadowLines: [] } : parseChapterOutline(outline)
  const issues: OutlineAuditIssue[] = []
  if (!outline.trim()) issues.push({ code: 'OUTLINE_EMPTY', level: 'error', message: '章纲还没有内容。' })
  if (parsed.requirements.length > 0 && parsed.requirements.length < 2) {
    issues.push({ code: 'TOO_FEW_BEATS', level: 'error', message: '至少写下 2 个有先后关系的剧情节点。' })
  }
  if (parsed.requirements.length > 12) {
    issues.push({ code: 'TOO_MANY_BEATS', level: 'error', message: '本章超过 12 个剧情节点，建议拆章后再确认。' })
  }
  const keys = parsed.requirements.map(normalizeBeat)
  if (new Set(keys).size !== keys.length) {
    issues.push({ code: 'DUPLICATE_BEAT', level: 'error', message: '章纲中有重复剧情节点，请合并或明确差异。' })
  }
  if (outline.trim() && !parsed.forbiddenEvents.length) {
    issues.push({ code: 'MISSING_FORBIDDEN', level: 'error', message: '请写至少一条“禁止/不得”事项，明确本章不能提前发生什么。' })
  }
  if (outline.trim() && !parsed.entryState) {
    issues.push({ code: 'MISSING_ENTRY_STATE', level: 'error', message: '请补充“进入状态”，写清本章开始时人物、地点与关键事实。' })
  }
  if (outline.trim() && !parsed.exitState) {
    issues.push({ code: 'MISSING_EXIT_STATE', level: 'error', message: '请补充“退出状态”，写清最后一个节点完成后必须停在哪里。' })
  }
  if (outline.trim() && !parsed.allowedFacts.length) {
    issues.push({ code: 'MISSING_ALLOWED_FACTS', level: 'error', message: '请补充“允许扩写”，限定可增加的对白、动作、环境或情绪事实。' })
  }
  if (parsed.invalidForeshadowLines.length) {
    issues.push({ code: 'INVALID_FORESHADOW_ACTION', level: 'error', message: '伏笔动作格式应为“伏笔：埋设｜内容”，动作可选埋设、推进（或强化）、误导、保持、回收、废弃。' })
  }
  const unstructured = parsed.requirements.filter((beat) => !['目标', '人物', '地点', '事件', '结果'].every((field) => new RegExp(`${field}\\s*[：:]`).test(beat))).length
  if (!constraints && parsed.requirements.length && unstructured) {
    issues.push({ code: 'UNSTRUCTURED_BEATS', level: 'warning', message: `${unstructured} 个节点尚未写全“目标、人物、地点、事件、结果”；可以确认，但生成前建议补齐。` })
  }
  return {
    issues,
    metrics: {
      beatCount: parsed.requirements.length,
      forbiddenCount: parsed.forbiddenEvents.length,
      formalEventCount,
      boundaryCount: Number(Boolean(parsed.entryState)) + Number(Boolean(parsed.exitState)) + Number(Boolean(parsed.allowedFacts.length)),
      foreshadowCount: parsed.foreshadowActions.length
    }
  }
}

function normalizeBeat(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s，。！？、；：,.!?;:]+/g, '')
}
