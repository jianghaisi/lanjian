import type { AnchorProjection, TextAnchor } from './types'

export type TextChange = { from: number; to: number; insert: string }
const contextLength = 80

export function createTextAnchor(text: string, start: number, end: number, versionId: string, documentHash: string): TextAnchor {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > text.length
    || splitsSurrogate(text, start) || splitsSurrogate(text, end) || !versionId || !/^[a-f0-9]{64}$/.test(documentHash)) {
    throw new Error('无效的文本定位依据。')
  }
  return { start, end, quote: text.slice(start, end), before: text.slice(Math.max(0, start - contextLength), start),
    after: text.slice(end, end + contextLength), versionId, documentHash }
}

/** No fuzzy matching. Without a verified identical snapshot, even the old
 * position must have a unique quote-and-context match. */
export function locateTextAnchor(text: string, anchor: TextAnchor, verifiedHash?: string): AnchorProjection {
  const missing: AnchorProjection = { start: anchor.start, end: anchor.end, status: 'needs-relocation' }
  if (verifiedHash === anchor.documentHash && text.slice(anchor.start, anchor.end) === anchor.quote) {
    return { start: anchor.start, end: anchor.end, status: 'located' }
  }
  const needle = anchor.before + anchor.quote + anchor.after
  if (!needle) return text === '' ? { start: 0, end: 0, status: 'located' } : missing
  const first = text.indexOf(needle)
  if (first < 0 || text.indexOf(needle, first + 1) !== -1) return missing
  const start = first + anchor.before.length
  return { start, end: start + anchor.quote.length, status: 'located' }
}

/** Changes refer to the old document and must be sorted, as in ChangeSet.
 * An edit overlapping the quote invalidates it; it never guesses new text. */
export function mapAnchorProjection(anchor: AnchorProjection, changes: readonly TextChange[]): AnchorProjection {
  if (anchor.status !== 'located') return anchor
  let shift = 0, previousEnd = 0
  for (const change of changes) {
    if (!Number.isSafeInteger(change.from) || change.from < previousEnd || change.to < change.from) throw new Error('文本变更顺序无效。')
    previousEnd = change.to
    const insertion = change.from === change.to
    const overlaps = insertion
      ? change.from > anchor.start && change.from < anchor.end || anchor.start === anchor.end && change.from === anchor.start
      : change.from < anchor.end && change.to > anchor.start || anchor.start === anchor.end && change.from <= anchor.start && change.to > anchor.start
    if (overlaps) return { ...anchor, status: 'needs-relocation' }
    if (change.to <= anchor.start) shift += change.insert.length - (change.to - change.from)
  }
  return { start: anchor.start + shift, end: anchor.end + shift, status: 'located' }
}

function splitsSurrogate(text: string, offset: number): boolean {
  return offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]!) && /[\uDC00-\uDFFF]/.test(text[offset]!)
}
