import type {
  ChapterOutlineReview,
  OutlineDocument,
  OutlineList,
  OutlinePlanningStatus,
  OutlineUpdateResult,
  OutlineVolume,
  PlannedChapterOutline,
  PlannedChapterOutlineUpdate,
  PlannedChapterStartInput,
  PlannedChapterStartResult,
  StageOutlineUpdateResult,
  VolumeOutline
} from './types'

export type DesktopOutlinesApi = {
  list: () => Promise<OutlineList>
  getPlannedChapter: (chapterId: number) => Promise<PlannedChapterOutline>
  updatePlannedChapter: (input: PlannedChapterOutlineUpdate) => Promise<PlannedChapterOutline>
  startPlannedChapter: (input: PlannedChapterStartInput) => Promise<PlannedChapterStartResult>
  get: (volume: OutlineVolume) => Promise<OutlineDocument>
  update: (volume: OutlineVolume, content: string) => Promise<OutlineUpdateResult>
  tree: () => Promise<{ volumes: VolumeOutline[] }>
  planningStatus: (chapterId?: number) => Promise<OutlinePlanningStatus>
  assignEvent: (eventId: string) => Promise<OutlinePlanningStatus>
  unassignEvent: (eventId: string) => Promise<OutlinePlanningStatus>
  createVolume: (title: string) => Promise<OutlinePlanningStatus>
  renameVolume: (volume: number, title: string) => Promise<OutlinePlanningStatus>
  createStage: (volume: number, title: string) => Promise<StageOutlineUpdateResult>
  updateStage: (stage: number, title: string, content: string) => Promise<StageOutlineUpdateResult>
  placeChapterInStage: (
    chapterId: number,
    stage: number | null,
    volume: number | null
  ) => Promise<StageOutlineUpdateResult | { success: true; stage: null; storageMode: 'sqlite' }>
  placeEvent: (eventId: string, volume: number | null) => Promise<OutlinePlanningStatus>
  placeEventInChapter: (eventId: string, chapterId: number) => Promise<OutlinePlanningStatus>
  placeChapter: (chapterId: number, volume: number | null) => Promise<OutlinePlanningStatus>
  reviewChapter: (chapterId: number) => Promise<ChapterOutlineReview>
  confirmChapter: (chapterId: number) => Promise<OutlinePlanningStatus>
  acknowledgeReview: (volume: OutlineVolume) => Promise<OutlinePlanningStatus>
  confirmPlanning: (volume: OutlineVolume) => Promise<OutlinePlanningStatus>
}
