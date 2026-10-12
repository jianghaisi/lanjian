import type {
  ChapterEventDraft,
  ChapterEventAdoptionPreview,
  ChapterEventAdoptionResult,
  ChapterEventPreview,
  FormalSkeletonPreview,
  FormalSkeletonView,
  PlanningChapterDetailAdoptionPreview,
  PlanningChapterDetailAdoptionResult,
  PlanningChapterDetailJob,
  PlanningChapterDetailStatus,
  PlanningChapterSkeletonJob,
  PlanningChapterSkeletonStatus,
  PlanningCharacterSeedPreview,
  PlanningCharacterSeedResult,
  PlanningCheatSystemPreview,
  PlanningCheatSystemResult,
  PlanningDraftRecoveryResult,
  PlanningJob,
  PlanningPackageProposal,
  PlanningPowerSystemPreview,
  PlanningPowerSystemResult,
  PlanningTotalAdoptionPreview,
  PlanningTotalAdoptionResult,
  PlanningVolumeOutlinePreview,
  PlanningVolumeOutlineResult,
  PlanningVolumeStructurePreview,
  PlanningVolumeStructureResult,
  PlanningWorldSeedPreview,
  PlanningWorldSeedResult
} from './types'

export type DesktopPlanningApi = {
  generateChapterStory: (chapterId: number) => Promise<{ content: string }>
  prepareChapterStoryContract: (chapterId: number) => Promise<import('./chapter-story-contract').ChapterStoryContractPreview>
  adoptChapterStoryContract: (token: string) => Promise<import('./types').OutlinePlanningStatus>
  previewChapterEventAdoption: (proposalId: string, chapterId: number, event: ChapterEventDraft | ChapterEventDraft[]) => Promise<ChapterEventAdoptionPreview>
  adoptChapterEvent: (token: string) => Promise<ChapterEventAdoptionResult>
  recoverChapterEvent: (operationId: string) => Promise<ChapterEventAdoptionResult>
  previewChapterEvents: (proposalId: string, chapterId: number) => Promise<ChapterEventPreview>
  previewFormalSkeleton: (proposalId: string, volume: number) => Promise<FormalSkeletonPreview>
  adoptFormalSkeleton: (token: string) => Promise<FormalSkeletonView>
  start: () => Promise<PlanningJob>
  job: (jobId: string) => Promise<PlanningJob>
  cancel: (jobId: string) => Promise<PlanningJob>
  draft: () => Promise<PlanningPackageProposal | null>
  saveDraft: (proposal: PlanningPackageProposal) => Promise<PlanningPackageProposal>
  discardDraft: () => Promise<{ success: true }>
  recoverDamagedDraft: () => Promise<PlanningDraftRecoveryResult>
  previewTotalAdoption: (proposalId: string) => Promise<PlanningTotalAdoptionPreview>
  adoptTotal: (input: {
    proposalId: string
    candidateFingerprint: string
    currentFingerprint: string
  }) => Promise<PlanningTotalAdoptionResult>
  previewVolumeStructure: (proposalId: string) => Promise<PlanningVolumeStructurePreview>
  initializeVolumeStructure: (input: {
    proposalId: string
    candidateFingerprint: string
    currentFingerprint: string
    totalFingerprint: string
  }) => Promise<PlanningVolumeStructureResult>
  previewVolumeOutlineAdoption: (proposalId: string, order: number) => Promise<PlanningVolumeOutlinePreview>
  adoptVolumeOutline: (input: {
    proposalId: string
    order: number
    parentFingerprint: string
    candidateFingerprint: string
    currentFingerprint: string
  }) => Promise<PlanningVolumeOutlineResult>
  previewChapterDetailAdoption: (proposalId: string, chapterId: number) => Promise<PlanningChapterDetailAdoptionPreview>
  adoptChapterDetail: (input: {
    proposalId: string
    chapterId: number
    upstreamFingerprint: string
    candidateFingerprint: string
    currentFingerprint: string
  }) => Promise<PlanningChapterDetailAdoptionResult>
  previewCharacterSeedAdoption: (proposalId: string) => Promise<PlanningCharacterSeedPreview>
  adoptCharacterSeeds: (input: {
    proposalId: string
    candidateFingerprint: string
    currentFingerprint: string
  }) => Promise<PlanningCharacterSeedResult>
  previewWorldSeedAdoption: (proposalId: string) => Promise<PlanningWorldSeedPreview>
  adoptWorldSeed: (input: {
    proposalId: string
    candidateFingerprint: string
    currentFingerprint: string
  }) => Promise<PlanningWorldSeedResult>
  previewPowerSystemAdoption: (proposalId: string) => Promise<PlanningPowerSystemPreview>
  adoptPowerSystem: (input: {
    proposalId: string
    candidateFingerprint: string
    currentFingerprint: string
  }) => Promise<PlanningPowerSystemResult>
  previewCheatSystemAdoption: (proposalId: string) => Promise<PlanningCheatSystemPreview>
  adoptCheatSystem: (input: {
    proposalId: string
    candidateFingerprint: string
    currentFingerprint: string
  }) => Promise<PlanningCheatSystemResult>
  chapterSkeletonStatus: (proposalId: string) => Promise<PlanningChapterSkeletonStatus>
  startChapterSkeleton: (proposalId: string) => Promise<PlanningChapterSkeletonJob>
  chapterSkeletonJob: (jobId: string) => Promise<PlanningChapterSkeletonJob>
  cancelChapterSkeleton: (jobId: string) => Promise<PlanningChapterSkeletonJob>
  chapterDetailStatuses: (proposalId: string) => Promise<PlanningChapterDetailStatus[]>
  startChapterDetail: (proposalId: string, volume: number) => Promise<PlanningChapterDetailJob>
  chapterDetailJob: (jobId: string) => Promise<PlanningChapterDetailJob>
  cancelChapterDetail: (jobId: string) => Promise<PlanningChapterDetailJob>
}
