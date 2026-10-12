// A versioned extension of the existing entity profile; unknown legacy fields
// remain untouched and are never implicitly promoted to public worldbook text.
export type WorldbookEntry = {
  version: 1
  aliases: string[]
  description: string
  authorNotes: string
  alwaysInclude: boolean
  chapterIds: number[]
  secrets: Array<{ id: string; text: string; revealChapterId: number | null; knownBy: string[] }>
}

export const emptyWorldbookEntry = (): WorldbookEntry => ({
  version: 1, aliases: [], description: '', authorNotes: '', alwaysInclude: false, chapterIds: [], secrets: []
})

export function readWorldbookProfile(profile: unknown): WorldbookEntry | null {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile) || !Object.hasOwn(profile, 'worldbook')) return null
  const value = (profile as Record<string, unknown>).worldbook
  const fail = (): never => { throw new Error('世界书格式无效，请核对版本、文字长度和引用。') }
  const object = (v: unknown, keys: string[]): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) return fail()
    return v as Record<string, unknown>
  }
  const text = (v: unknown, max: number): string => typeof v === 'string' && v.length <= max ? v : fail()
  const list = <T>(v: unknown, max: number, decode: (item: unknown) => T): T[] => {
    if (!Array.isArray(v) || v.length > max) return fail()
    const result = v.map(decode)
    if (new Set(result.map(item => JSON.stringify(item))).size !== result.length) return fail()
    return result
  }
  const chapter = (v: unknown): number => Number.isSafeInteger(v) && Number(v) > 0 ? Number(v) : fail()
  const id = (v: unknown): string => {
    const result = text(v, 100)
    return /^[a-zA-Z0-9_-]+$/.test(result) ? result : fail()
  }
  const row = object(value, ['version', 'aliases', 'description', 'authorNotes', 'alwaysInclude', 'chapterIds', 'secrets'])
  if (row.version !== 1 || typeof row.alwaysInclude !== 'boolean') return fail()
  const secrets = list(row.secrets, 50, v => {
    const item = object(v, ['id', 'text', 'revealChapterId', 'knownBy'])
    return { id: id(item.id), text: text(item.text, 10000),
      revealChapterId: item.revealChapterId === null ? null : chapter(item.revealChapterId), knownBy: list(item.knownBy, 100, id) }
  })
  if (new Set(secrets.map(item => item.id)).size !== secrets.length) return fail()
  return { version: 1, description: text(row.description, 30000), authorNotes: text(row.authorNotes, 30000),
    aliases: list(row.aliases, 50, v => { const alias = text(v, 160).trim(); return alias || fail() }),
    alwaysInclude: row.alwaysInclude, chapterIds: list(row.chapterIds, 200, chapter), secrets }
}

export function writeWorldbookProfile(profileJson: string, worldbook: WorldbookEntry): string {
  const profile = JSON.parse(profileJson)
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('旧档案不是对象，请先在高级编辑中核对，原数据未改动。')
  readWorldbookProfile({ worldbook })
  return JSON.stringify({ ...profile, worldbook }, null, 2)
}
