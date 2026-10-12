import type { TextChange } from './anchors'
/** For snapshot-based undo/external synchronization, preserve unchanged prefix
 * and suffix. This is exact equality, never approximate quote matching. */
export function snapshotChange(before: string, after: string): TextChange[] {
  if (before === after) return []
  let from = 0, oldEnd = before.length, newEnd = after.length
  while (from < oldEnd && from < newEnd && before[from] === after[from]) from++
  if (from > 0 && /[\uD800-\uDBFF]/.test(before[from - 1]!)) from--
  while (oldEnd > from && newEnd > from && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd-- }
  if (oldEnd < before.length && /[\uDC00-\uDFFF]/.test(before[oldEnd]!)) { oldEnd++; newEnd++ }
  return [{ from, to: oldEnd, insert: after.slice(from, newEnd) }]
}
