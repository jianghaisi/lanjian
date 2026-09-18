export type TimelineCandidate = {
  title: string
  time: string
  characters: string
  location: string
  event: string
  result: string
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function timelineEventTitle(event: string, explicitTitle = ''): string {
  const title = cleanText(explicitTitle)
  if (title) return title.slice(0, 36)
  const normalized = cleanText(event).replace(/\s+/g, ' ')
  if (!normalized) return '未命名事件'
  const firstSentence = normalized.split(/[。！？!?；;\n]/, 1)[0]?.trim() || normalized
  return firstSentence.length > 28 ? `${firstSentence.slice(0, 28)}…` : firstSentence
}

function extractJsonArray(raw: string): unknown[] {
  const unfenced = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = unfenced.indexOf('[')
  const end = unfenced.lastIndexOf(']')
  if (start < 0 || end <= start) throw new Error('模型没有返回可识别的事件数组，请重试或调整提示词')
  const parsed: unknown = JSON.parse(unfenced.slice(start, end + 1))
  if (!Array.isArray(parsed)) throw new Error('模型返回的事件格式不正确')
  return parsed
}

export function parseTimelineCandidates(raw: string): TimelineCandidate[] {
  const seen = new Set<string>()
  const candidates: TimelineCandidate[] = []
  for (const item of extractJsonArray(raw).slice(0, 30)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const value = item as Record<string, unknown>
    const time = cleanText(value.time)
    const characters = Array.isArray(value.characters)
      ? value.characters.map(cleanText).filter(Boolean).join('、')
      : cleanText(value.characters)
    const location = cleanText(value.location)
    const event = cleanText(value.event)
    if (!time || !characters || !location || !event) continue
    const key = `${time}\n${characters}\n${location}\n${event}`.toLocaleLowerCase('zh-CN')
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({
      title: timelineEventTitle(event, cleanText(value.title)),
      time,
      characters,
      location,
      event,
      result: cleanText(value.result)
    })
  }
  if (!candidates.length) throw new Error('模型没有生成完整的时间、人物、地点和事件，请重试')
  return candidates
}
