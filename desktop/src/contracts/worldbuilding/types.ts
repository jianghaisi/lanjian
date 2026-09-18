export type GenreCatalogItem = { id: string; name: string; aliases: string[]; substyles: string[] }

export type ResearchSettings = {
  baseUrl: string
  model: string
  apiKeyConfigured: boolean
}

export type ResearchSource = { title: string; url: string }

export type SourceType = 'manual' | 'web' | 'toutiao' | 'douyin-baike' | 'douyin-video' | 'other'

export type SourceCard = {
  id: string
  provider: string
  sourceType: SourceType
  externalId?: string
  url?: string
  title: string
  author?: string
  publishedAt?: string
  capturedAt: string
  updatedAt?: string
  excerpt: string
  userNotes: string
  /** Traceable pages cited by an aggregated web-research result. */
  references?: ResearchSource[]
  contentHash: string
}

export type SourceCardCreateInput = Pick<SourceCard, 'title' | 'excerpt' | 'userNotes'> &
  Partial<Pick<SourceCard, 'url' | 'author' | 'publishedAt' | 'sourceType' | 'provider' | 'references'>>

export type SourceCardUpdateInput = Pick<SourceCard, 'title' | 'userNotes'> &
  Partial<Pick<SourceCard, 'url' | 'excerpt' | 'author' | 'publishedAt'>>

export type ResearchResult = {
  query: string
  content: string
  sources: ResearchSource[]
  searchedQueries: string[]
  webSearchCalls: number
  model: string
}

export type ProseExpansionMode = 'web-serial' | 'balanced' | 'compact'

export type ReviewStrictness = 'balanced' | 'strict'

export type ChapterGenerationMode = 'fast' | 'reviewed'

export type BookProfile = {
  /** Main-issued compare-and-swap token; never a field-assistant editing target. */
  revision?: string
  /** Request-only references. Main resolves and verifies source metadata. */
  assistantCandidateIds?: string[]
  genre: string
  subgenre: string
  coreIdea: string
  plannedVolumes: number
  chaptersPerVolume: number
  targetWordsPerChapter: number
  /** Derived from the three length-plan factors; not an independently editable target. */
  targetWords: number
  audienceScale: string
  defaultPov: string
  narrativeDistance: string
  writingStyle: string
  proseExpansionMode: ProseExpansionMode
  reviewStrictness: ReviewStrictness
  /** Missing/fast on older projects; current projection and new saves use reviewed (full flow). */
  chapterGenerationMode?: ChapterGenerationMode
  autosaveEnabled: boolean
  autosaveDelayMs: number
  autosaveMergeWindowMs: number
}

export type FoundationDraftProposal = {
  worldView: string
  useRealms: boolean
  realms: RealmLevel[]
  useSystem: boolean
  systemTemplate: string
  rationale: string
}

export type RealmLevel = { id: string; name: string; description: string }

export type PowerSystemData = { overview: string }

export type CheatSystemData = { overview: string }

export type FoundationData = {
  /** @deprecated Legacy display preference. Material origin is now recorded per SourceCard. */
  creationPath: 'research' | 'materials'
  sourceNotes: string
  worldView: string
  useRealms: boolean
  useSystem: boolean
}

export type FoundationStatus = {
  readyForChapterOutline: boolean
  readyForProse: boolean
  missing: string[]
}
