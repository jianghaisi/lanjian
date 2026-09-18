import { computed, ref } from 'vue'
import { planningChapterCatalog } from '../services/planning-directory'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createPlanningState(ports) {
  const totalOutline = ref('')

  const volumeOutline = ref('')

  const stageOutlines = ref([])

  const selectedStage = ref(null)

  const stageTitle = ref('')

  const stageOutline = ref('')

  const lastSavedStageTitle = ref('')

  const lastSavedStageOutline = ref('')

  const stageDraftTitle = ref('')

  const outlineMode = ref('total')

  const outlineInspectorOpen = ref(false)

  const selectedVolume = ref(null)

  const outlineEditor = ref(null)

  const outlineComposing = ref(false)

  const outlineLeaveDialog = ref(null)

  const outlineVolumeDialog = ref(null)

  const outlineLeavePending = ref(false)

  const outlineLoading = ref('')

  const outlineOpenError = ref('')

  const lastPlanningLeaf = ref('total-outline')

  const planningJob = ref(null)

  const planningDraft = ref(null)

  const planningDraftSaveState = ref('saved')

  const planningAdoptionPreview = ref(null)

  const planningVolumeStructurePreview = ref(null)

  const planningVolumeOutlinePreview = ref(null)

  const planningChapterDetailPreview = ref(null)

  const planningCharacterSeedPreview = ref(null)

  const planningWorldSeedPreview = ref(null)

  const planningPowerSystemPreview = ref(null)

  const planningCheatSystemPreview = ref(null)

  const planningAdoptionBusy = ref(false)

  const planningSkeletonJob = ref(null)

  const planningSkeletonStatus = ref({ exists: false, stale: false, chapterCount: 0, volumeCount: 0 })

  const planningDetailJob = ref(null)

  const planningDetailStatuses = ref([])

  const ideas = ref([])

  const ideaGenerations = ref([])

  const ideaGenerationInstruction = ref('')

  const ideaSourceTask = ref(null)

  const ideaSourceIssue = ref('')

  const ideaGenerationRunning = computed(() =>
    ideaGenerations.value.some((task) => ['queued', 'preparing', 'running', 'streaming'].includes(task.status))
  )

  const creatingIdea = ref(false)

  const ideaDraft = ref({ title: '', content: '', status: 'candidate' })

  const ideaGenerationSource = ref(null)

  const outlinePlanning = ref({
    totalRevision: 0,
    totalOutlineExists: false,
    externalChangeDetected: false,
    assignedEventIds: [],
    unplacedEventIds: [],
    volumes: [],
    chapterPlacements: [],
    eventChapterPlacements: []
  })

  const volumeDraft = ref('')

  const lastSavedTotalOutline = ref('')

  const expansionOpen = ref(false)

  const expansionSource = ref(null)

  const expansionTasks = ref([])

  const expansionLoading = ref(false)

  const expansionBusy = ref(false)

  const expansionError = ref('')

  const standaloneOutlineEntries = ref([])

  const plannedChapter = ref(null)

  const plannedChapterTitle = ref('')

  const plannedChapterContent = ref('')

  const plannedChapterBusy = ref(false)

  const plannedChapterStarting = ref(false)

  const plannedOutlineRecovery = ref(null)

  const plannedOutlineRecoveryError = ref('')

  const outlineRecoveryDrafts = ref([])

  const outlineRecoveryShelfError = ref('')

  const plannedChapterError = ref('')

  const plannedChapterComposing = ref(false)

  const plannedChapterDirty = computed(() =>
    Boolean(
      plannedChapter.value &&
        (plannedChapterTitle.value !== plannedChapter.value.title ||
          plannedChapterContent.value !== plannedChapter.value.content)
    )
  )

  const expansionPreview = ref(null)

  const expansionNotice = ref('')

  const expansionParentKey = computed(() =>
    outlineMode.value === 'total'
      ? 'total'
      : outlineMode.value === 'volume' && selectedVolume.value
        ? `volume-${selectedVolume.value}`
        : outlineMode.value === 'stage' && selectedStage.value
          ? `stage-${selectedStage.value}`
          : null
  )

  const lastSavedVolumeOutline = ref('')

  const planningMaterialsReady = computed(
    () =>
      ports.workflowStatus.value?.steps.some((step) => step.id === 'materials' && step.state === 'complete') === true
  )

  const outlinePlanningIssue = computed(
    () => ports.workspaceBootstrapIssues.value.find((item) => item.id === 'outlinePlanningUnreadable') || null
  )

  const outlineDocumentLocked = computed(() =>
    Boolean(outlinePlanningIssue.value || (ports.chapterOrderIssue.value && outlineMode.value === 'chapter'))
  )

  const outlineStorageKey = computed(() =>
    outlineMode.value === 'total'
      ? 'total'
      : `${outlineMode.value}:${outlineMode.value === 'volume' ? selectedVolume.value : outlineMode.value === 'stage' ? selectedStage.value : ports.selectedId.value}`
  )

  const outlineStorageDescription = computed(() => ports.outlineStorageFeedback.describe(outlineStorageKey.value))

  const planningRunning = computed(() => planningJob.value?.status === 'running')

  const planningSkeletonRunning = computed(() => planningSkeletonJob.value?.status === 'running')

  const planningDetailRunning = computed(() => planningDetailJob.value?.status === 'running')

  const planningTotalConfirmed = computed(() => outlinePlanning.value?.totalApproval?.status === 'confirmed')

  const planningVolumesConfirmed = computed(() =>
    Boolean(
      planningDraft.value?.volumes.length &&
        planningDraft.value.volumes.every(
          (volume) =>
            planningDraft.value?.adoption?.volumeOutlines?.some((item) => item.order === volume.order) &&
            outlinePlanning.value?.volumes?.find((item) => item.volume === volume.order)?.approval?.status ===
              'confirmed'
        )
    )
  )

  const planningSkeletonVolumes = computed(() =>
    (planningDraft.value?.volumes || []).map((volume) => ({
      ...volume,
      chapters: (planningDraft.value?.chapterSkeleton?.chapters || []).filter(
        (chapter) => chapter.volume === volume.order
      )
    }))
  )

  const planningDetailCandidates = computed(
    () => planningDraft.value?.chapterDetails?.flatMap((item) => item.chapters) || []
  )

  const planningFoundationAdoptedCount = computed(() => {
    const adoption = planningDraft.value?.adoption
    return (
      Number(Boolean(adoption?.characterSeeds)) +
      Number(Boolean(adoption?.worldSeed)) +
      Number(Boolean(adoption?.powerSystem)) +
      Number(Boolean(adoption?.cheatSystem))
    )
  })

  const planningFoundationReady = computed(() => planningFoundationAdoptedCount.value === 4)

  const planningAdoptionStageLabel = computed(() => {
    const adoption = planningDraft.value?.adoption
    if (!adoption?.characterSeeds) return '前置设定 0/4 · 先定人物'
    if (!adoption.worldSeed) return '前置设定 1/4 · 再定世界'
    if (!adoption.powerSystem) return '前置设定 2/4 · 再定力量'
    if (!adoption.cheatSystem) return '前置设定 3/4 · 再定特殊优势'
    if (!adoption.totalOutline) return '前置设定 4/4 · 总纲待采用'
    if (!adoption.volumeStructure) return `总纲已采用 · 正式版本 ${adoption.totalOutline.revision}`
    if (!planningTotalConfirmed.value) return '篇卷目录已建立 · 总纲待复核'
    if (ports.nextPlanningVolumeCandidate.value)
      return `总纲已确认 · 已采用 ${ports.adoptedPlanningVolumeCount.value}/${planningDraft.value?.volumes.length || 0} 卷`
    if (!planningVolumesConfirmed.value) return '卷纲候选已采用 · 等待逐卷确认'
    if (!planningDraft.value?.chapterSkeleton) return '篇卷已确认 · 章节安排待生成'
    if (planningSkeletonStatus.value.stale) return '上游已变化 · 章节安排待重生成'
    if (ports.nextPlanningDetailVolume.value)
      return `全书章节安排已保存 · ${planningDraft.value.chapterSkeleton.chapters.length} 章`
    if (ports.nextPlanningChapterDetailCandidate.value)
      return `详细章纲已齐 · 已写入 ${ports.adoptedPlanningChapterCount.value}/${planningDetailCandidates.value.length} 章`
    return `正式章纲已逐章写入 · ${ports.adoptedPlanningChapterCount.value} 章待复核`
  })

  const planningAdoptionMarker = computed(() => {
    if (!planningFoundationReady.value) return ['人', '界', '势', '异'][planningFoundationAdoptedCount.value] || '人'
    if (!planningDraft.value?.adoption?.totalOutline) return '纲'
    if (!planningDraft.value?.adoption?.volumeStructure) return '卷'
    if (!planningVolumesConfirmed.value) return ports.adoptedPlanningVolumeCount.value ? '审' : '采'
    if (ports.nextPlanningDetailVolume.value)
      return planningDraft.value?.chapterSkeleton && !planningSkeletonStatus.value.stale ? '目' : '章'
    return ports.nextPlanningChapterDetailCandidate.value ? '采' : '审'
  })

  const planningAdoptionGuidance = computed(() => {
    const adoption = planningDraft.value?.adoption
    if (!adoption?.characterSeeds) return '先核对人物种子；只建立稳定锚点，不生成虚构的章节状态。'
    if (!adoption.worldSeed) return '人物锚点已建立；下一步核对世界种子，不覆盖其他本书设定。'
    if (!adoption.powerSystem) return '世界种子已采用；下一步核对力量体系总述，不自动拆成境界。'
    if (!adoption.cheatSystem) return '力量体系已采用；下一步核对金手指或特殊优势，不改系统模板。'
    if (!adoption.totalOutline) return '四项前置设定已经明确；现在再采用基于这些设定生成的总纲。'
    if (!adoption.volumeStructure) return '下一步只建立卷号与卷名，不写卷纲正文。'
    if (!planningTotalConfirmed.value) return '目录已建立；先确认父级总纲，再逐卷采用卷纲正文。'
    if (ports.nextPlanningVolumeCandidate.value)
      return `已采用 ${ports.adoptedPlanningVolumeCount.value}/${planningDraft.value?.volumes.length || 0} 卷；每卷采用后仍需人工确认。`
    if (!planningVolumesConfirmed.value) return '卷纲候选已进入正式编辑区；逐卷确认后才会开放全书章节安排。'
    if (!planningDraft.value?.chapterSkeleton) return '篇卷均已确认；现在可以按卷生成全书章节安排，不会写正式章纲。'
    if (planningSkeletonStatus.value.stale)
      return planningSkeletonStatus.value.reason || '上游已经变化，请重新生成章节安排。'
    if (ports.nextPlanningDetailVolume.value) return '章节安排已保存为候选，可继续修改；详细章纲与正文尚未自动生成。'
    if (ports.nextPlanningChapterDetailCandidate.value)
      return `详细章纲候选已齐备；下一步只预览并写入第 ${ports.nextPlanningChapterDetailCandidate.value.chapter} 章，仍需人工复核。`
    return '详细章纲已逐章进入正式编辑区；请在谋篇区复核确认，正文仍不会自动生成。'
  })

  const planningStageLabel = computed(
    () =>
      ({
        blueprint: '创作蓝图',
        totalOutline: '全书总纲',
        volumePlan: '分卷规划'
      })[planningJob.value?.stage] || '准备中'
  )

  const ideaDraftDirty = computed(() => {
    if (creatingIdea.value) return Boolean(ideaDraft.value.title.trim() || ideaDraft.value.content.trim())
    const idea = ports.selectedIdea.value
    if (!idea) return false
    return (
      ideaDraft.value.title !== idea.title ||
      ideaDraft.value.content !== idea.content ||
      ideaDraft.value.status !== idea.status
    )
  })

  const selectedVolumeMeta = computed(
    () => outlinePlanning.value.volumes.find((item) => item.volume === selectedVolume.value) || null
  )

  const selectedStageMeta = computed(
    () => stageOutlines.value.find((item) => item.stage === selectedStage.value) || null
  )

  const selectedVolumeStages = computed(() =>
    stageOutlines.value.filter((stage) => stage.volume === ports.selectedChapterVolume.value)
  )

  const outlineFullCatalog = computed(() =>
    planningChapterCatalog(
      ports.chapters.value,
      standaloneOutlineEntries.value,
      outlinePlanning.value.chapterPlacements || [],
      outlinePlanning.value.volumes
    )
  )

  const planningOutlineReview = computed(() =>
    outlineMode.value === 'total'
      ? outlinePlanning.value.totalReview || null
      : outlineMode.value === 'volume'
        ? selectedVolumeMeta.value?.review || null
        : null
  )

  const planningOutlineApproval = computed(() =>
    outlineMode.value === 'total'
      ? outlinePlanning.value.totalApproval || null
      : outlineMode.value === 'volume'
        ? selectedVolumeMeta.value?.approval || null
        : null
  )

  const planningOutlineDirty = computed(() =>
    outlineMode.value === 'total'
      ? totalOutline.value !== lastSavedTotalOutline.value
      : outlineMode.value === 'volume'
        ? volumeOutline.value !== lastSavedVolumeOutline.value
        : outlineMode.value === 'stage'
          ? stageOutline.value !== lastSavedStageOutline.value || stageTitle.value !== lastSavedStageTitle.value
          : false
  )

  const planningReviewLabel = computed(
    () =>
      ({
        clear: '本地预审通过',
        attention: '有规划提示',
        acknowledged: '本版提示已知'
      })[planningOutlineReview.value?.status] || '等待预审'
  )

  const planningApprovalLabel = computed(
    () =>
      ({
        missing: '正文待写',
        'needs-review': '预审待处理',
        blocked: '等待总纲确认',
        ready: '可以正式确认',
        confirmed: '本版正式确认',
        stale: '正式确认已失效'
      })[planningOutlineApproval.value?.status] || '等待确认'
  )

  return {
    totalOutline,
    volumeOutline,
    stageOutlines,
    selectedStage,
    stageTitle,
    stageOutline,
    lastSavedStageTitle,
    lastSavedStageOutline,
    stageDraftTitle,
    outlineMode,
    outlineInspectorOpen,
    selectedVolume,
    outlineEditor,
    outlineComposing,
    outlineLeaveDialog,
    outlineVolumeDialog,
    outlineLeavePending,
    outlineLoading,
    outlineOpenError,
    lastPlanningLeaf,
    planningJob,
    planningDraft,
    planningDraftSaveState,
    planningAdoptionPreview,
    planningVolumeStructurePreview,
    planningVolumeOutlinePreview,
    planningChapterDetailPreview,
    planningCharacterSeedPreview,
    planningWorldSeedPreview,
    planningPowerSystemPreview,
    planningCheatSystemPreview,
    planningAdoptionBusy,
    planningSkeletonJob,
    planningSkeletonStatus,
    planningDetailJob,
    planningDetailStatuses,
    ideas,
    ideaGenerations,
    ideaGenerationInstruction,
    ideaSourceTask,
    ideaSourceIssue,
    ideaGenerationRunning,
    creatingIdea,
    ideaDraft,
    ideaGenerationSource,
    outlinePlanning,
    volumeDraft,
    lastSavedTotalOutline,
    expansionOpen,
    expansionSource,
    expansionTasks,
    expansionLoading,
    expansionBusy,
    expansionError,
    standaloneOutlineEntries,
    plannedChapter,
    plannedChapterTitle,
    plannedChapterContent,
    plannedChapterBusy,
    plannedChapterStarting,
    plannedOutlineRecovery,
    plannedOutlineRecoveryError,
    outlineRecoveryDrafts,
    outlineRecoveryShelfError,
    plannedChapterError,
    plannedChapterComposing,
    plannedChapterDirty,
    expansionPreview,
    expansionNotice,
    expansionParentKey,
    lastSavedVolumeOutline,
    planningMaterialsReady,
    outlinePlanningIssue,
    outlineDocumentLocked,
    outlineStorageKey,
    outlineStorageDescription,
    planningRunning,
    planningSkeletonRunning,
    planningDetailRunning,
    planningTotalConfirmed,
    planningVolumesConfirmed,
    planningSkeletonVolumes,
    planningDetailCandidates,
    planningFoundationAdoptedCount,
    planningFoundationReady,
    planningAdoptionStageLabel,
    planningAdoptionMarker,
    planningAdoptionGuidance,
    planningStageLabel,
    ideaDraftDirty,
    selectedVolumeMeta,
    selectedStageMeta,
    selectedVolumeStages,
    outlineFullCatalog,
    planningOutlineReview,
    planningOutlineApproval,
    planningOutlineDirty,
    planningReviewLabel,
    planningApprovalLabel
  }
}
