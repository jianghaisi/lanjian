export const assistantSearchLimit = 1000
export type AssistantTextMatch = { start: number; end: number }

/** Literal matching against the original string keeps DOM UTF-16 offsets intact. */
export function assistantTextMatches(text: string, query: string, limit = assistantSearchLimit + 1): AssistantTextMatch[] {
  if (!query || limit <= 0) return []
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
  const matches: AssistantTextMatch[] = []
  let match: RegExpExecArray | null
  while (matches.length < limit && (match = pattern.exec(text))) matches.push({ start: match.index, end: match.index + match[0].length })
  return matches
}

export function nextAssistantMatch(active: number, count: number, direction: number): number {
  if (!count) return -1
  if (active < 0 || active >= count) return direction < 0 ? count - 1 : 0
  return (active + (direction < 0 ? -1 : 1) + count) % count
}
