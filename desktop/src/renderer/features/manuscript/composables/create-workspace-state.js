import { computed, ref } from 'vue'
import { buildWritingAgentDiff } from '../../../../contracts/assistant/writing-diff'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createManuscriptState(ports) {
  const editorFocusMode = ref(false)

  const manuscriptEditor = ref(null)

  const chapterDeleteTarget = ref(null)

  const chapterTrashOpen = ref(false)

  const chapterTrashEntries = ref([])

  const revisions = ref([])

  const selectedRevisionId = ref(null)

  const revisionViewMode = ref('changes')

  const revisionLabelDraft = ref('')

  const recoveryBusyId = ref('')

  const chapters = ref([])

  const selectedId = ref(null)

  const chapterTitle = ref('')

  const chapterTreeQuery = ref('')

  const quickChapterOpen = ref(null)

  const quickChapterItems = computed(() =>
    chapters.value.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      position: ports.chapterPosition(chapter.id),
      wordCount: chapter.word_count || 0
    }))
  )

  const chapterContent = ref('')

  const chapterOutline = ref('')

  const selectedCharacterLineId = ref('')

  const selectedTimelineVolume = ref(0)

  const selectedPromptTask = ref('outline')

  const chapterDerivatives = ref(null)

  const selectedIdeaGenerations = computed(() =>
    ports.ideaGenerations.value.filter((task) => task.ideaId === selectedIdeaId.value)
  )

  const selectedIdeaId = ref('')

  const selectedSourceId = ref('')

  const manuscriptSelection = ref(null)

  const manuscriptInsertionAnchor = ref(null)

  const chapterPlanning = ref(null)

  const chapterCardOpen = ref(false)

  const chapterCardSaving = ref(false)

  const chapterCardAdoption = ref(null)

  const chapterCardDraft = ref({
    status: 'draft',
    goal: '',
    entryState: '',
    beatsText: '',
    conflict: '',
    charactersText: '',
    pointOfView: '',
    narrativeDistance: '',
    exitChange: '',
    hook: ''
  })

  const chapterSummaryDraft = ref('')

  const chapterSummaryStatus = ref('')

  const pendingCharacterSettlements = ref({})

  const pendingAiSourceTaskIds = ref({})

  const saveState = ref('saved')

  const manuscriptSaveError = ref(null)

  const manuscriptConflict = ref(null)

  const manuscriptRecoveryItems = ref([])

  const manuscriptRecoveryBusyId = ref('')

  const lastSavedAt = ref(null)

  const lastSavedChapterOutline = ref('')

  const chapterOrderIssue = computed(
    () => ports.workspaceBootstrapIssues.value.find((item) => item.id === 'chapterOrderUnreadable') || null
  )

  const manuscriptSaveErrorMessage = computed(() => manuscriptSaveError.value?.message || '')

  const manuscriptConflictView = computed(() =>
    manuscriptConflict.value
      ? {
          reason: manuscriptConflict.value.reason,
          baseTitle: ports.lastSavedChapter.title,
          baseContent: ports.lastSavedChapter.content,
          localTitle: chapterTitle.value,
          localContent: chapterContent.value,
          externalChapter: manuscriptConflict.value.externalChapter,
          expectedRevision: manuscriptConflict.value.expectedRevision
        }
      : null
  )

  const chapterLifecycleActions = computed(() =>
    (
      ({
        PLANNED: [{ value: 'DRAFTING', label: '开始起草' }],
        DRAFTING: [
          { value: 'REVIEWABLE', label: '提交审阅' },
          { value: 'REVISING', label: '转入修订' }
        ],
        REVIEWABLE: [
          { value: 'CONFIRMED', label: '确认定稿' },
          { value: 'REVISING', label: '继续修订' }
        ],
        CONFIRMED: [{ value: 'REVISING', label: '重新修订' }],
        REVISING: [
          { value: 'DRAFTING', label: '回到起草' },
          { value: 'REVIEWABLE', label: '再次审阅' },
          { value: 'CONFIRMED', label: '完成修订' }
        ],
        ARCHIVED: [{ value: chapterPlanning.value?.archivedFromStatus, label: '恢复原状态' }]
      })[chapterPlanning.value?.lifecycleStatus] || []
    ).filter((item) => item.value)
  )

  const selectedPromptEntry = computed(
    () => ports.promptProfile.value?.entries.find((entry) => entry.task === selectedPromptTask.value) || null
  )

  const saveStatusLabel = computed(() => {
    if (!ports.current.value) return '本地工作台'
    if (saveState.value === 'dirty') return '有改动待保存'
    if (saveState.value === 'saving') return '正在保存到本地'
    if (saveState.value === 'checkpoint')
      return ports.sqliteStorageStatus.value?.textAuthority === 'files-v1'
        ? '正文文件已保存 · 正在整理历史'
        : '已形成恢复草稿 · 正在合并版本'
    if (saveState.value === 'local') return '仅本机恢复草稿 · 尚未正式保存'
    if (saveState.value === 'error') return '保存失败，请重试'
    if (!lastSavedAt.value) return '本地保存'
    return `已保存 ${new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(lastSavedAt.value)}`
  })

  const selectedRevision = computed(
    () => revisions.value.find((item) => item.id === selectedRevisionId.value) || revisions.value[0] || null
  )

  const selectedRevisionDiff = computed(() =>
    selectedRevision.value
      ? buildWritingAgentDiff(selectedRevision.value.content || '', chapterContent.value || '')
      : []
  )

  const selectedRevisionChanges = computed(() => selectedRevisionDiff.value.filter((block) => block.kind === 'change'))

  const revisionDiffSummary = computed(() => {
    const changed = selectedRevisionChanges.value
    return {
      blocks: changed.length,
      historicalCharacters: changed.reduce((total, block) => total + block.before.length, 0),
      currentCharacters: changed.reduce((total, block) => total + block.after.length, 0),
      titleChanged: Boolean(selectedRevision.value && selectedRevision.value.title !== chapterTitle.value)
    }
  })

  const selectedEventSource = computed(
    () => ports.sourceCards.value.find((item) => item.id === ports.eventDraft.value.sourceId) || null
  )

  const selectedCharacterLine = computed(
    () => ports.characterAtlasCards.value.find((item) => item.characterId === selectedCharacterLineId.value) || null
  )

  const selectedTimelineVolumeMeta = computed(
    () => ports.timelineVolumeCards.value.find((item) => item.volume === selectedTimelineVolume.value) || null
  )

  const selectedSource = computed(
    () => ports.sourceCards.value.find((item) => item.id === selectedSourceId.value) || null
  )

  const selectedIdea = computed(() => ports.ideas.value.find((item) => item.id === selectedIdeaId.value) || null)

  const selectedIdeaSourceOption = computed(() => {
    const source = selectedIdea.value?.generationSource
    return source && ports.ideaSourceTask.value?.id === source.taskId
      ? ports.ideaSourceTask.value.proposal?.options?.[source.optionIndex] || null
      : null
  })

  const selectedChapterVolume = computed(
    () =>
      ports.outlinePlanning.value.chapterPlacements.find((item) => item.chapterId === selectedId.value)?.volume || null
  )

  const selectedChapterStage = computed(
    () => ports.stageOutlines.value.find((stage) => stage.chapterIds.includes(selectedId.value)) || null
  )

  const selectedChapterRecord = computed(() => chapters.value.find((item) => item.id === selectedId.value) || null)

  const selectedChapterPosition = computed(() => selectedChapterRecord.value?.position || null)

  const chapterDerivativeEntries = computed(() => {
    const derivatives = chapterDerivatives.value
    const entry = (id, label, counts, emptyHint) => {
      if (!derivatives?.bodyVersionId) return { id, label, state: 'empty', summary: '正文尚未形成正式版本' }
      if (counts?.stale)
        return {
          id,
          label,
          state: 'stale',
          summary: counts.current
            ? `当前 ${counts.current} 项有效 · 旧正文 ${counts.stale} 项已过期`
            : `旧正文 ${counts.stale} 项已过期，需按当前正文重新生成`
        }
      if (counts?.current) return { id, label, state: 'current', summary: `${counts.current} 项绑定当前正文` }
      return { id, label, state: 'empty', summary: emptyHint }
    }
    return [
      entry('facts', '重要变化', derivatives?.factBatches, '尚未提炼本章变化'),
      entry('summary', '承接摘要', derivatives?.summaries, '尚未确认章末承接'),
      entry('checks', '一致性检查', derivatives?.ruleRuns, '尚未留下本章检查记录')
    ]
  })

  const chapterOutlineDirty = computed(() => chapterOutline.value !== lastSavedChapterOutline.value)

  const chapterReview = computed(() => ports.outlinePlanning.value.chapter?.review || null)

  const chapterReviewLabel = computed(
    () =>
      ({
        missing: '章纲待写',
        'needs-changes': '结构待补',
        ready: '可以确认',
        confirmed: '本版已确认',
        stale: '确认已失效'
      })[chapterReview.value?.status] || '等待审核'
  )

  const chapterCardAdoptionFields = computed(() => {
    const adoption = chapterCardAdoption.value
    const card = chapterPlanning.value?.card
    if (!adoption || !card) return []
    const labels = {
      goal: '本章目标',
      beats: '节拍 / 场景',
      conflict: '核心冲突',
      characters: '出场人物',
      exitChange: '退出变化',
      hook: '章末钩子'
    }
    return ['goal', 'beats', 'conflict', 'characters', 'exitChange', 'hook'].flatMap((key) => {
      const proposed = adoption.option[key]
      if (!proposed || (Array.isArray(proposed) && !proposed.length)) return []
      const currentValue = card[key]
      return [
        {
          key,
          label: labels[key],
          current: Array.isArray(currentValue) ? currentValue.join(' → ') : currentValue,
          proposed: Array.isArray(proposed) ? proposed.join(' → ') : proposed,
          action:
            key === 'beats' || key === 'characters'
              ? '补入，不删除现有内容'
              : currentValue?.trim()
                ? '替换当前内容'
                : '填入空白栏位'
        }
      ]
    })
  })

  const selectedResourceBalance = computed(
    () =>
      ports.resourceLedger.value.balances.find(
        (item) => item.resourceEntityId === ports.resourceLedgerDraft.value.resourceEntityId
      ) || null
  )

  const selectedResourceEntries = computed(() =>
    ports.resourceLedger.value.entries.filter(
      (item) => item.resourceEntityId === ports.resourceLedgerDraft.value.resourceEntityId
    )
  )

  return {
    editorFocusMode,
    manuscriptEditor,
    chapterDeleteTarget,
    chapterTrashOpen,
    chapterTrashEntries,
    revisions,
    selectedRevisionId,
    revisionViewMode,
    revisionLabelDraft,
    recoveryBusyId,
    chapters,
    selectedId,
    chapterTitle,
    chapterTreeQuery,
    quickChapterOpen,
    quickChapterItems,
    chapterContent,
    chapterOutline,
    selectedCharacterLineId,
    selectedTimelineVolume,
    selectedPromptTask,
    chapterDerivatives,
    selectedIdeaGenerations,
    selectedIdeaId,
    selectedSourceId,
    manuscriptSelection,
    manuscriptInsertionAnchor,
    chapterPlanning,
    chapterCardOpen,
    chapterCardSaving,
    chapterCardAdoption,
    chapterCardDraft,
    chapterSummaryDraft,
    chapterSummaryStatus,
    pendingCharacterSettlements,
    pendingAiSourceTaskIds,
    saveState,
    manuscriptSaveError,
    manuscriptConflict,
    manuscriptRecoveryItems,
    manuscriptRecoveryBusyId,
    lastSavedAt,
    lastSavedChapterOutline,
    chapterOrderIssue,
    manuscriptSaveErrorMessage,
    manuscriptConflictView,
    chapterLifecycleActions,
    selectedPromptEntry,
    saveStatusLabel,
    selectedRevision,
    selectedRevisionDiff,
    selectedRevisionChanges,
    revisionDiffSummary,
    selectedEventSource,
    selectedCharacterLine,
    selectedTimelineVolumeMeta,
    selectedSource,
    selectedIdea,
    selectedIdeaSourceOption,
    selectedChapterVolume,
    selectedChapterStage,
    selectedChapterRecord,
    selectedChapterPosition,
    chapterDerivativeEntries,
    chapterOutlineDirty,
    chapterReview,
    chapterReviewLabel,
    chapterCardAdoptionFields,
    selectedResourceBalance,
    selectedResourceEntries
  }
}
