import { computed, ref } from 'vue'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createReviewState(ports) {
  const consistencyOverview = ref(null)

  const findingHistory = ref(null)

  const findingResolutionError = ref('')

  const factBatches = ref([])

  const factReviewBusy = ref(false)

  const factExtractionBusy = ref(false)

  const factExtractionJobId = ref('')

  const factExtractionRetryId = ref('')

  const factExtractionRawResult = ref('')

  const dismissingConflictId = ref('')

  const decidingContinuityFindingId = ref('')

  const consistencyEvaluationSummary = ref(null)

  const consistencyEvaluationJob = ref(null)

  const realTrialReport = ref(null)

  const realTrialIssue = ref('')

  const realTrialChapterId = ref(null)

  const factExtractionDescription = computed(() =>
    !ports.chapterPlanning.value?.confirmedBodyVersionId
      ? '先确认本章正文，再从确认版提炼候选；不会改正文。'
      : ports.chapterPlanning.value.hasUnconfirmedChanges
        ? '当前仍有修订草稿；本次只读取上一次确认版，不会混入草稿。'
        : '从当前确认版提炼候选；不会改正文，也不会阻塞写作。'
  )

  const realTrialAvailableChapters = computed(() =>
    ports.chapters.value.filter((item) => item.bodyVersionId && item.storageMode === 'sqlite')
  )

  const realTrialSelectedChapter = computed(
    () => realTrialAvailableChapters.value.find((item) => item.id === realTrialChapterId.value) || null
  )

  const realTrialExistingRecord = computed(
    () => realTrialReport.value?.chapters.find((item) => item.legacyChapterId === realTrialChapterId.value) || null
  )

  return {
    consistencyOverview,
    findingHistory,
    findingResolutionError,
    factBatches,
    factReviewBusy,
    factExtractionBusy,
    factExtractionJobId,
    factExtractionRetryId,
    factExtractionRawResult,
    dismissingConflictId,
    decidingContinuityFindingId,
    consistencyEvaluationSummary,
    consistencyEvaluationJob,
    realTrialReport,
    realTrialIssue,
    realTrialChapterId,
    factExtractionDescription,
    realTrialAvailableChapters,
    realTrialSelectedChapter,
    realTrialExistingRecord
  }
}
