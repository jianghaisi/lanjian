import { ContractError, record, text } from './validation.js'
export interface ReferenceBookView {
  version: string; title: string; introduction: string; permission: string
  guide: string; chapters: { title: string; content: string; notes: string }[]
}
function prose(value: unknown, max = 100000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw new ContractError()
  return value
}
export function decodeReferenceBook(value: unknown): ReferenceBookView {
  const p = record(value, ['version', 'title', 'introduction', 'permission', 'guide', 'chapters'])
  if (!Array.isArray(p.chapters) || !p.chapters.length || p.chapters.length > 20) throw new ContractError()
  return { version: text(p.version, 100), title: text(p.title, 200), introduction: text(p.introduction, 1000), permission: text(p.permission, 1000), guide: prose(p.guide),
    chapters: p.chapters.map(value => { const c = record(value, ['title', 'content', 'notes']); return { title: text(c.title, 200), content: prose(c.content), notes: prose(c.notes) } }) }
}
