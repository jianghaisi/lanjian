import { computed, ref } from 'vue'
import { subgenresForGenre } from '../../../../contracts/worldbuilding/genre-catalog'
import { buildModelCatalog } from '../../models/services/model-catalog'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createAssistantState(ports) {
  const contextBudgetPreferences = ref({
    version: 1,
    inputBudgetTokens: 120000,
    modelContextLimit: 150000,
    outputReservePercent: 25,
    systemReserveTokens: 10000,
    recentSummaryCount: 3,
    structuredRepairAttempts: 1,
    minimumFactImportance: 'medium',
    showFactConfirmations: false,
    pinnedEvidenceKeys: [],
    excludedEvidenceKeys: [],
    alwaysConfirmBeforeSend: false
  })

  const assistantOpen = ref(false)

  const assistantMode = ref('agent')

  const taskCenterItems = ref([])

  const taskCenterLoading = ref(false)

  const taskCenterBusyId = ref('')

  const promptProfile = ref(null)

  const promptDraft = ref('')

  const contextFactPack = ref(null)

  const writingAgentTurns = ref([])

  const writingRebase = ref(null)

  const writingRebaseBusy = ref(false)

  const writingAgentApplyingTurnId = ref('')

  const writingAgentTasks = ref([])

  const writingAgentRunning = ref(false)

  const writingAgentContextPreview = ref(null)

  const writingAgentContextPreviewBusy = ref(false)

  const writingAgentQuickAction = ref(null)

  const bookSubgenreOptions = computed(() => subgenresForGenre(ports.bookProfile.value.genre).map(([label]) => label))

  const assistantAvailable = computed(() => Boolean(ports.desktop))

  const embeddedWritingAgent = ref(null)

  const writingAgentModelChoices = computed(() =>
    buildModelCatalog(
      ports.oneOffConnections.value,
      ports.availableModelsByConnection.value,
      [ports.ai.value.shared, ...Object.values(ports.ai.value.tasks)],
      ports.localModelViews.value
    )
  )

  const activeWritingAgentTask = computed(
    () =>
      [...writingAgentTasks.value]
        .reverse()
        .find(
          (task) =>
            task.workItemId === ports.current.value?.id &&
            task.chapterId === ports.selectedId.value &&
            ['queued', 'resuming', 'preparing', 'running', 'streaming'].includes(task.status)
        ) || null
  )

  const promptDraftDirty = computed(() =>
    Boolean(
      ports.selectedPromptEntry.value && promptDraft.value.trim() !== ports.selectedPromptEntry.value.effective.trim()
    )
  )

  return {
    contextBudgetPreferences,
    assistantOpen,
    assistantMode,
    taskCenterItems,
    taskCenterLoading,
    taskCenterBusyId,
    promptProfile,
    promptDraft,
    contextFactPack,
    writingAgentTurns,
    writingRebase,
    writingRebaseBusy,
    writingAgentApplyingTurnId,
    writingAgentTasks,
    writingAgentRunning,
    writingAgentContextPreview,
    writingAgentContextPreviewBusy,
    writingAgentQuickAction,
    bookSubgenreOptions,
    assistantAvailable,
    embeddedWritingAgent,
    writingAgentModelChoices,
    activeWritingAgentTask,
    promptDraftDirty
  }
}
