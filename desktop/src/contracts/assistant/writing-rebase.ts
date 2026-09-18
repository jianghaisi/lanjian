import { buildWritingAgentDiff } from './writing-diff'

export type WritingRebaseChoice = 'current' | 'candidate'
export type WritingRebaseConflict = { id: string; current: string; candidate: string }
type Edit = { start: number; end: number; text: string; side: WritingRebaseChoice }

/** Three-way, bounded by the existing diff limits. Never silently resolves overlapping edits. */
export function rebaseWritingAgentText(base: string, current: string, candidate: string, choices: Record<string, WritingRebaseChoice> = {}) {
  const changes = [...edits(base, current, 'current'), ...edits(base, candidate, 'candidate')]
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const groups: Edit[][] = []
  for (const edit of changes) {
    const last = groups.at(-1)
    // Boundary insertions are intentionally reviewed together with adjacent replacements.
    if (last && edit.start <= Math.max(...last.map(item => item.end))) last.push(edit)
    else groups.push([edit])
  }
  // Locate precisely, but ask the author about complete sentences, not isolated Chinese characters.
  const regions = groups.map(group => {
    let start = group[0].start
    let end = Math.max(...group.map(item => item.end))
    const mine = group.filter(item => item.side === 'current')
    const theirs = group.filter(item => item.side === 'candidate')
    if (mine.length && theirs.length && render(base, start, end, mine) !== render(base, start, end, theirs)) {
      while (start > 0 && !/[。！？!?；;\r\n]/.test(base[start - 1])) start--
      while (end < base.length && !/[。！？!?；;\r\n]/.test(base[end])) end++
      if (end < base.length) end++
    }
    return { start, end, changes: group }
  }).sort((a, b) => a.start - b.start || a.end - b.end)
  const expanded: typeof regions = []
  for (const region of regions) {
    const previous = expanded.at(-1)
    if (previous && (region.start < previous.end || (region.start === previous.end && (region.start === region.end || previous.start === previous.end)))) {
      previous.end = Math.max(previous.end, region.end)
      previous.changes.push(...region.changes)
      previous.changes.sort((a, b) => a.start - b.start || a.end - b.end)
    } else expanded.push(region)
  }
  const conflicts: WritingRebaseConflict[] = []
  let cursor = 0
  let content = ''
  for (const { start, end, changes: group } of expanded) {
    const mine = group.filter(item => item.side === 'current')
    const theirs = group.filter(item => item.side === 'candidate')
    const left = render(base, start, end, mine)
    const right = render(base, start, end, theirs)
    content += base.slice(cursor, start)
    if (mine.length && theirs.length && left !== right) {
      const id = `conflict-${conflicts.length + 1}`
      conflicts.push({ id, current: left, candidate: right })
      content += choices[id] === 'candidate' ? right : left
    } else content += mine.length ? left : right
    cursor = end
  }
  content += base.slice(cursor)
  const allowed = new Set(conflicts.map(item => item.id))
  if (Object.entries(choices).some(([id, choice]) => !allowed.has(id) || !['current', 'candidate'].includes(choice))) {
    throw new Error('合并选择与当前比较不一致，请重新核对。')
  }
  return { content, conflicts, unresolved: conflicts.filter(item => !choices[item.id]).length }
}

function edits(base: string, next: string, side: WritingRebaseChoice): Edit[] {
  let offset = 0
  const result: Edit[] = []
  const blocks = buildWritingAgentDiff(base, next).flatMap(block =>
    block.kind === 'change' && Math.max(block.before.length, block.after.length) <= 500
      ? buildWritingAgentDiff(block.before, block.after, 'character') : [block])
  for (const block of blocks) {
    if (block.kind === 'change') {
      let prefix = 0
      let suffix = 0
      while (prefix < Math.min(block.before.length, block.after.length) && block.before[prefix] === block.after[prefix]) prefix++
      while (suffix < Math.min(block.before.length, block.after.length) - prefix
        && block.before[block.before.length - suffix - 1] === block.after[block.after.length - suffix - 1]) suffix++
      result.push({ start: offset + prefix, end: offset + block.before.length - suffix, text: block.after.slice(prefix, block.after.length - suffix), side })
    }
    offset += block.before.length
  }
  return result
}

function render(base: string, start: number, end: number, changes: Edit[]): string {
  let cursor = start
  let result = ''
  for (const change of changes) {
    result += base.slice(cursor, change.start) + change.text
    cursor = change.end
  }
  return result + base.slice(cursor, end)
}
