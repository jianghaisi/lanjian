export type TxtImportOwnership = 'owned' | 'material' | 'external'

export type TxtCreationMethod = 'human' | 'ai' | 'mixed'

export type TxtImportChapterPreview = {
  sourceIndex: number
  order: number
  chapterNumber?: number
  title: string
  wordCount: number
  preview: string
  status: 'ready' | 'review'
  issues: string[]
  selectedByDefault: boolean
}

export type TxtImportPreview = {
  token: string
  fileName: string
  suggestedTitle: string
  sourceFormat: 'TXT' | 'Markdown' | 'Word'
  encoding: string
  bytes: number
  characterCount: number
  wordCount: number
  chapterCount: number
  detectedHeadings: boolean
  chapters: TxtImportChapterPreview[]
  recommendedChapterCount: number
  reviewRequired: boolean
  warnings: string[]
}

export type TxtImportRequest = {
  expectedWorkItemId?: string
  token: string
  ownership: TxtImportOwnership
  creationMethod?: TxtCreationMethod
  title?: string
  selectedChapterIndexes?: number[]
}

export type TxtImportResult = {
  ownership: TxtImportOwnership
  title: string
  importedChapterIds: number[]
  importedSourceIds?: string[]
}

export type DocumentImportRole = 'manuscript' | 'material' | 'external' | 'skip'

export type DocumentImportManifestFile = TxtImportPreview & {
  recommendedRole: Exclude<DocumentImportRole, 'external' | 'skip'>
  recommendationReason: string
}

export type DocumentImportManifest = {
  id: string
  files: DocumentImportManifestFile[]
  totalBytes: number
  totalWordCount: number
  warnings: string[]
}

export type DocumentImportManifestRequest = {
  expectedWorkItemId?: string
  id: string
  files: Array<TxtImportRequest | { token: string; ownership: 'skip'; title: string }>
}

export type DocumentImportManifestResult = {
  id: string
  status: 'completed'
  results: TxtImportResult[]
}

export type DocumentImportRecovery = {
  id: string
  status: 'ready' | 'committing' | 'interrupted' | 'needs-review'
  createdAt: string
  completedCount: number
  totalCount: number
  canResume: boolean
  message: string
  files: Array<{
    fileName: string
    ownership: TxtImportOwnership | 'skip'
    status: 'pending' | 'running' | 'completed' | 'skipped' | 'review'
  }>
}
