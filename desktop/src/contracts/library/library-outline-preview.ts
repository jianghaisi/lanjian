import { AppError } from '../core/app-error'

export type LibraryOutlineRequest = { path: string; offset: number }
export type LibraryOutlineChapter = { id: number; title: string; volume: number | null; status: 'draft' | 'confirmed' | 'unknown'; wordCount: number | null; updatedAt: string; canOpen: boolean }
export type LibraryOutlinePreview = {
  source: 'sqlite' | 'files'
  chapters: LibraryOutlineChapter[]
  volumes: Array<{ id: number; title: string }>
  totalChapters: number
  offset: number
  nextOffset: number | null
  notice: string
}
export const libraryOutlinePageSize = 60

export function decodeLibraryOutlineArgs(args: unknown[]): [LibraryOutlineRequest] {
  const input = args[0] as LibraryOutlineRequest | undefined
  if (args.length !== 1 || !input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['path', 'offset'].includes(key))
    || typeof input.path !== 'string' || !/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(input.path) || input.path.length > 32767 || input.path.includes('\0')
    || !Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > 1_000_000) {
    throw new AppError('VALIDATION_ERROR', '作品目录预览参数无效。')
  }
  return [{ path: input.path, offset: input.offset }]
}

export function decodeLibraryOutlineResult(value: unknown): LibraryOutlinePreview {
  const input = value as LibraryOutlinePreview
  const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0
  const text = (value: unknown, max = 500) => typeof value === 'string' && value.length <= max
  if (!input || !['sqlite', 'files'].includes(input.source) || !count(input.totalChapters) || !count(input.offset)
    || !(input.nextOffset === null || count(input.nextOffset)) || !text(input.notice, 2000)
    || !Array.isArray(input.chapters) || input.chapters.length > libraryOutlinePageSize
    || !Array.isArray(input.volumes) || input.volumes.length > libraryOutlinePageSize
    || input.volumes.some(volume => !volume || !count(volume.id) || volume.id < 1 || !text(volume.title))
    || input.chapters.some(chapter => !chapter || !count(chapter.id) || chapter.id < 1 || !text(chapter.title)
      || !(chapter.volume === null || count(chapter.volume)) || !['draft', 'confirmed', 'unknown'].includes(chapter.status)
      || !(chapter.wordCount === null || count(chapter.wordCount)) || !text(chapter.updatedAt, 100) || typeof chapter.canOpen !== 'boolean')) {
    throw new Error('Invalid library outline response')
  }
  return input
}
