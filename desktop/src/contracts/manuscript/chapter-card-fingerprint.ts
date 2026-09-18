type FingerprintableChapterCard = {
  status?: unknown
  goal?: unknown
  entryState?: unknown
  beats?: unknown
  conflict?: unknown
  characters?: unknown
  pointOfView?: unknown
  narrativeDistance?: unknown
  exitChange?: unknown
  hook?: unknown
}

export function chapterCardFingerprint(card: FingerprintableChapterCard | null | undefined): string {
  if (!card) return 'chapter-card:none'
  const value = JSON.stringify({
    status: String(card.status || ''),
    goal: String(card.goal || ''),
    entryState: String(card.entryState || ''),
    beats: Array.isArray(card.beats) ? card.beats.map(String) : [],
    conflict: String(card.conflict || ''),
    characters: Array.isArray(card.characters) ? card.characters.map(String) : [],
    pointOfView: String(card.pointOfView || ''),
    narrativeDistance: String(card.narrativeDistance || ''),
    exitChange: String(card.exitChange || ''),
    hook: String(card.hook || '')
  })
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ (code + index), 0x85ebca6b)
  }
  return `chapter-card:${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}
