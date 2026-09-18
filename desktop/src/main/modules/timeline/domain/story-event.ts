export type StoryEventIdentity = {
  time: string
  characters: string | readonly string[]
  location: string
  event: string
}

export function normalizeStoryText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/[\s，。！？、；：,.!?;:]+/g, '')
}

export function storyEventSignature(event: StoryEventIdentity): string {
  const characters = Array.isArray(event.characters)
    ? event.characters
    : String(event.characters).split(/[、,，;；/|]+/)
  return [
    normalizeStoryText(event.time),
    characters.map((item) => normalizeStoryText(item)).filter(Boolean).sort().join('|'),
    normalizeStoryText(event.location),
    normalizeStoryText(event.event)
  ].join('::')
}
