export type DialogueRect = { left: number; top: number; right: number; bottom: number }
export type DialoguePlacement = { kind: 'above' | 'right' | 'unavailable'; left: number; top: number; width: number; height: number }
export const DIALOGUE_GAP = 12
export function intersects(a: DialogueRect, b: DialogueRect, gap = 0): boolean {
  return a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap
}
export function intersection(a: DialogueRect, b: DialogueRect): DialogueRect | null {
  const value = { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) }
  return value.right > value.left && value.bottom > value.top ? value : null
}
/** Floating CSS-pixel geometry. Never resize art, insert a spacer or move other modules. */
export function placeCompanionDialogue(input: {
  safe: DialogueRect; stage: DialogueRect; character: DialogueRect[]; protectedUi?: DialogueRect[]
  desired: { width: number; height: number }; preference?: 'auto' | 'above' | 'right'
}): DialoguePlacement {
  const { safe, stage } = input
  const available = intersection(safe, stage) || safe
  const width = Math.max(1, Math.min(input.desired.width, (safe.right - safe.left) * .38, safe.right - safe.left - DIALOGUE_GAP * 2))
  const height = Math.max(1, Math.min(input.desired.height, safe.bottom - safe.top - DIALOGUE_GAP * 2))
  const left = Math.max(safe.left + DIALOGUE_GAP, Math.min(available.right - width + Math.min(80, width * .18), safe.right - width - DIALOGUE_GAP))
  const top = Math.max(available.top, safe.top) + DIALOGUE_GAP
  const valid = (candidate: DialoguePlacement) => {
    const rect = { left: candidate.left, top: candidate.top, right: candidate.left + candidate.width, bottom: candidate.top + candidate.height }
    return rect.left >= safe.left && rect.top >= safe.top && rect.right <= safe.right && rect.bottom <= safe.bottom
      && [...input.character, ...(input.protectedUi || [])].every(protectedRect => !intersects(rect, protectedRect, DIALOGUE_GAP))
  }
  const above: DialoguePlacement = { kind: 'above', left, top, width, height }
  const bandRight = (y: number) => Math.max(stage.right, ...input.character.filter(rect => rect.top < y + height + DIALOGUE_GAP && rect.bottom > y - DIALOGUE_GAP).map(rect => rect.right)) + DIALOGUE_GAP
  const rightCandidates = [top, Math.max(top, Math.min(...input.character.map(rect => rect.top)) + 20)].filter(Number.isFinite).map(y => ({ ...above, kind: 'right' as const, top: y, left: bandRight(y) }))
  const candidates = input.preference === 'right' ? [...rightCandidates, above] : [above, ...rightCandidates]
  if (input.character.length) {
    for (const candidate of candidates) if (valid(candidate)) return candidate
  }
  // Content can sit behind this dismissible overlay. Only art and explicit protected
  // UI avoid it; the popup never participates in page layout.
  for (let y = top; y + height <= safe.bottom - DIALOGUE_GAP; y += 16) {
    const x = bandRight(y)
    const free = safe.right - x - DIALOGUE_GAP
    if (free < Math.min(220, width)) continue
    const candidate: DialoguePlacement = { kind: 'right', left: x, top: y, width: Math.min(width, free), height }
    if (valid(candidate)) return candidate
  }
  // If art covers the entire usable viewport, do not claim a safe floating position.
  return { ...above, kind: 'unavailable' }
}
