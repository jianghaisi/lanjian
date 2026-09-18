import type { ConsistencyFinding } from '../index'

type RankedTerm = { value: string; priority: number; order: number }

export function findingChapterPositions(finding: Pick<ConsistencyFinding, 'fromChapter' | 'toChapter'>): number[] {
  return [...new Set([finding.toChapter, finding.fromChapter])]
    .filter((value) => Number.isSafeInteger(value) && value > 0)
}

export function findingEvidenceSearchTerms(evidence: readonly string[]): string[] {
  const ranked: RankedTerm[] = []
  evidence.forEach((source, order) => {
    const value = source.trim()
    if (!value || /^(?:既有人物锚点|锚点来源)[：:]/.test(value)) return
    const exact = value.match(/^正文逐字证据[：:]\s*(.+)$/s)
    const paragraph = value.match(/^第\s*\d+\s*段[：:]\s*(.+)$/s)
    const hit = value.match(/^命中[：:]\s*[“"](.+?)[”"]\s*$/s)
    const claim = value.match(/^正文中的新声明[：:]\s*(.+)$/s)
    if (exact?.[1]) ranked.push({ value: exact[1].trim(), priority: 100, order })
    else if (paragraph?.[1]) ranked.push({ value: paragraph[1].trim(), priority: 90, order })
    else if (hit?.[1]) ranked.push({ value: hit[1].trim(), priority: 85, order })
    else if (claim?.[1]) ranked.push({ value: claim[1].trim(), priority: 70, order })
    else ranked.push({ value, priority: 80, order })
  })
  return ranked
    .filter((item) => item.value.length >= 2 && item.value.length <= 500)
    .sort((left, right) => right.priority - left.priority || left.order - right.order)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.value === item.value) === index)
    .map((item) => item.value)
}
