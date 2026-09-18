import type { ChapterOutlineDocument, OutlineMirrorRecoveryPreview, OutlineMirrorRecoveryResult } from './types'

export type DesktopChapterOutlinesApi = {
  list: () => Promise<ChapterOutlineDocument[]>
  get: (chapterId: number) => Promise<ChapterOutlineDocument>
  update: (chapterId: number, content: string) => Promise<ChapterOutlineDocument>
  previewExternalMirror: (chapterId: number) => Promise<OutlineMirrorRecoveryPreview>
  adoptExternalMirror: (token: string) => Promise<OutlineMirrorRecoveryResult>
}
