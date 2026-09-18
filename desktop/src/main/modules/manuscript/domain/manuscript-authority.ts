import type { Chapter, ChapterMirrorRecoveryPreview, ChapterMirrorRecoveryResult, ChapterOutlineDocument, ChapterRevision, ChapterRevisionReason, DeletedChapterSummary, OutlineList, OutlineUpdateResult, OutlineVolume, StageOutlineUpdateResult, PlannedChapterOutline, PlannedChapterOutlineUpdate } from '../../../../contracts/index'

import type { PlannedChapterStartInput, PlannedChapterStartResult } from '../../../../contracts/index'

export type ManuscriptAutosaveCheckpoint = {
  id: string
  chapterId: number
  title: string
  content: string
  contentHash: string
  status: 'staged' | 'finalized' | 'conflict' | 'discarded'
  baseBodyVersionId: string
  mergeWindowMs: number
  windowStartedAt: string
  windowEndsAt: string
  updatedAt: string
  conflictCurrentBodyVersionId: string | null
  finalizedBodyVersionId: string | null
  operationCount: number
}

export type ManuscriptAutosaveStageInput = {
  title: string
  content: string
  clientOperationId: string
  baseBodyVersionId?: string
  expectedRevision?: string
  mergeWindowMs?: number
}

export type ManuscriptAutosaveStageResult = {
  storageMode: 'files' | 'sqlite'
  checkpoint: ManuscriptAutosaveCheckpoint | null
  chapter: Chapter
  merged: boolean
  idempotent: boolean
}

export type ManuscriptAutosaveFinalizeResult = {
  storageMode: 'files' | 'sqlite'
  checkpoint: ManuscriptAutosaveCheckpoint | null
  chapter: Chapter
  insertedVersion: boolean
}

export interface ManuscriptAuthority {
  active(workItemId: string): Promise<boolean>
  validate(workItemId: string): Promise<void>
  chapters(workItemId: string): Promise<Chapter[]>
  manuscriptRevision(workItemId: string): Promise<string>
  updateChapter(workItemId: string, id: number, data: {
    title?: string
    content?: string
    reason?: ChapterRevisionReason
    expectedRevision?: string
    sourceTaskRunId?: string
    generationArtifactId?: string
  }): Promise<Chapter>
  stageAutosave(workItemId: string, id: number, input: ManuscriptAutosaveStageInput): Promise<ManuscriptAutosaveStageResult>
  finalizeAutosave(workItemId: string, checkpointId: string): Promise<ManuscriptAutosaveFinalizeResult>
  autosaveRecoveries(workItemId: string, id?: number): Promise<ManuscriptAutosaveCheckpoint[]>
  discardAutosaveRecovery(workItemId: string, checkpointId: string): Promise<ManuscriptAutosaveCheckpoint>
  reorderChapter(workItemId: string, id: number, position: number): Promise<Chapter[]>
  revisions(workItemId: string, id: number): Promise<ChapterRevision[]>
  nameCurrentRevision(workItemId: string, id: number, label: string): Promise<ChapterRevision>
  restoreRevision(workItemId: string, id: number, revisionId: string): Promise<Chapter>
  previewExternalMirror(workItemId: string, id: number): Promise<ChapterMirrorRecoveryPreview>
  adoptExternalMirror(workItemId: string, token: string, beforeCommit?: () => Promise<void>): Promise<ChapterMirrorRecoveryResult>
  previewExternalOutlineMirror(workItemId: string, id: number): Promise<import('../../../../contracts/index').OutlineMirrorRecoveryPreview>
  adoptExternalOutlineMirror(workItemId: string, token: string, beforeCommit?: () => Promise<void>): Promise<import('../../../../contracts/index').OutlineMirrorRecoveryResult>
  deleteChapter(workItemId: string, id: number): Promise<{ success: boolean; recovery: 'chapter-trash' }>
  trashedChapters(workItemId: string): Promise<DeletedChapterSummary[]>
  restoreChapter(workItemId: string, id: number): Promise<Chapter>
  outlineActive(workItemId: string): Promise<boolean>
  outlines(workItemId: string): Promise<OutlineList>
  getPlannedChapter(workItemId: string, chapterId: number): Promise<PlannedChapterOutline>
  updatePlannedChapter(workItemId: string, input: PlannedChapterOutlineUpdate): Promise<PlannedChapterOutline>
  startPlannedChapter(workItemId: string, input: PlannedChapterStartInput): Promise<PlannedChapterStartResult>
  createChapter(workItemId: string, minimumId?: number): Promise<Chapter>
  chapterOutlines(workItemId: string): Promise<ChapterOutlineDocument[]>
  updateOutline(workItemId: string, volume: OutlineVolume, content: string): Promise<OutlineUpdateResult>
  updateChapterOutline(workItemId: string, chapterId: number, content: string, plannedVolume?: number): Promise<ChapterOutlineDocument>
  createStage(workItemId: string, volume: number, title: string): Promise<StageOutlineUpdateResult>
  updateStage(workItemId: string, stage: number, title: string, content: string): Promise<StageOutlineUpdateResult>
  placeChapterInStage(workItemId: string, chapterId: number, stage: number | null, volume: number | null): Promise<StageOutlineUpdateResult | { success: true; stage: null; storageMode: 'sqlite' }>
}
