import type {
  Chapter,
  ChapterAutosaveFinalizeResult,
  ChapterAutosaveStageInput,
  ChapterAutosaveStageResult,
  ChapterMirrorRecoveryPreview,
  ChapterMirrorRecoveryResult,
  ChapterPlanningRecord,
  ChapterPlanningUpdate,
  ChapterRevision,
  ChapterRevisionReason,
  DeletedChapterSummary,
  ManuscriptAutosaveCheckpoint,
  ManuscriptDraftRecoveryResult
} from './types'

export type DesktopChaptersApi = {
  create: () => Promise<Chapter>
  list: () => Promise<Chapter[]>
  get: (id: number) => Promise<Chapter>
  update: (
    id: number,
    data: {
      title?: string
      content?: string
      reason?: ChapterRevisionReason
      expectedRevision?: string
      sourceTaskRunId?: string
      generationArtifactId?: string
      workItemId?: string
      workItemPath?: string
    }
  ) => Promise<Chapter>
  stageAutosave: (id: number, data: ChapterAutosaveStageInput) => Promise<ChapterAutosaveStageResult>
  finalizeAutosave: (checkpointId: string) => Promise<ChapterAutosaveFinalizeResult>
  autosaveRecoveries: () => Promise<ManuscriptAutosaveCheckpoint[]>
  discardAutosaveRecovery: (checkpointId: string) => Promise<ManuscriptAutosaveCheckpoint>
  preserveDraft: (
    id: number,
    data: { title: string; content: string; baseRevision?: string; workItemId?: string; workItemPath?: string }
  ) => Promise<ManuscriptDraftRecoveryResult>
  reorder: (id: number, position: number) => Promise<Chapter[]>
  delete: (id: number) => Promise<{ success: boolean; recovery: 'chapter-trash' }>
  trashList: () => Promise<DeletedChapterSummary[]>
  restore: (id: number) => Promise<Chapter>
  stats: () => Promise<Record<string, number>>
  revisions: (id: number) => Promise<ChapterRevision[]>
  nameCurrentRevision: (id: number, label: string) => Promise<ChapterRevision>
  restoreRevision: (id: number, revisionId: string) => Promise<Chapter>
  previewExternalMirror: (id: number) => Promise<ChapterMirrorRecoveryPreview>
  adoptExternalMirror: (token: string) => Promise<ChapterMirrorRecoveryResult>
  getPlanning: (id: number) => Promise<ChapterPlanningRecord | null>
  updatePlanning: (id: number, input: ChapterPlanningUpdate) => Promise<ChapterPlanningRecord>
}
