import type { CharacterLinePoint, CharacterLinesView } from '../../../../contracts/index'

export type CharacterAtlasCard = {
  characterId: string
  name: string
  points: CharacterLinePoint[]
  latest: CharacterLinePoint | null
  /** Distinct source chapters with explicit presence, not carried state snapshots. */
  appearanceCount: number
  locations: string[]
}

export type CharacterStateDetail = { label: string; value: string }

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0
}

/** Read-only projection of a single validated main-process character-lines view. */
export function projectCharacterAtlas(
  lines: CharacterLinesView,
  throughPosition: number | null,
  validChapterIds?: ReadonlySet<number>
): CharacterAtlasCard[] {
  // Only explicit null means the whole book. An invalid selection must not
  // accidentally reveal future names, locations or states.
  if (throughPosition !== null && (!Number.isFinite(throughPosition) || throughPosition < 0)) return []
  const cards: CharacterAtlasCard[] = []
  for (const line of lines.lines) {
    const points = line.points
      .map((point, index) => ({ point, index }))
      .filter(({ point }) => (!validChapterIds || validChapterIds.has(point.chapterId))
        && (throughPosition === null || point.chapterPosition <= throughPosition))
      .sort((left, right) => left.point.chapterPosition - right.point.chapterPosition || left.index - right.index)
      .map(({ point }) => point)
    const latest = points.at(-1)
    if (!latest) continue
    cards.push({
      characterId: line.characterId,
      // The line heading may carry a later name; use the selected-time snapshot.
      name: latest.name,
      points,
      latest,
      appearanceCount: new Set(points.filter(point => point.present).map(point => point.chapterId)).size,
      locations: [...new Set(points.map(point => point.location).filter(hasText))]
    })
  }
  return cards
}

/** Existing recorded statements only. No inferred relationships or default state. */
export function characterStateDetails(point: CharacterLinePoint | null): CharacterStateDetail[] {
  if (!point) return []
  const details: CharacterStateDetail[] = []
  const add = (label: string, value: string | undefined) => {
    if (hasText(value)) details.push({ label, value })
  }
  add('地点', point.location)
  add('目标', point.goal)
  add('关系', point.relationships?.filter(hasText).join('；'))
  add('已知', point.knowledge?.filter(hasText).join('；'))
  add('持有', point.possession)
  add('状态', point.injury)
  add('实力', point.power)
  if (point.vitality === 'alive') add('生死', '存活')
  else if (point.vitality === 'dead') add('生死', '死亡')
  return details
}
