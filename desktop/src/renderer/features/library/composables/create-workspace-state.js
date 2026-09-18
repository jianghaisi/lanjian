import { computed, ref } from 'vue'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createLibraryState(ports) {
  const libraryModelsDialog = ref(null)

  const libraryModelsOpen = ref(false)

  const workspaceOpening = ref(null)

  const projectsLoaded = ref(false)

  const projects = ref([])

  const continueProjectId = ref(null)

  const projectTrashTarget = ref(null)

  const projectTrashConfirmation = ref('')

  const recentlyTrashedProject = ref(null)

  const txtImportEntry = ref('inside-work-item')

  const txtPreview = ref(null)

  const txtMaterialPreview = ref(null)

  const importManifest = ref(null)

  const manifestRoles = ref({})

  const manifestChapterSelections = ref({})

  const importCreatedProject = ref(null)

  const importRecoveries = ref([])

  const continuationAnalysis = ref(null)

  const continuationManifestId = ref('')

  const continuationBlockedReason = ref('')

  const continuationProjectDefinitionPreview = ref(null)

  const continuationExistingPlotPreview = ref(null)

  const continuationExistingPlotDraft = ref({ time: '', characters: '', location: '', event: '' })

  const continuationCharacterEditorOpen = ref(false)

  const continuationCharacterPreview = ref(null)

  const continuationCharacterDraft = ref({ name: '', role: '', arcSeed: '' })

  const continuationWorldViewPreview = ref(null)

  const continuationPowerSystemPreview = ref(null)

  const continuationCheatSystemPreview = ref(null)

  const continuationTotalOutlinePreview = ref(null)

  const continuationVolumeOutlinePreview = ref(null)

  const continuationVolumeTarget = ref(0)

  const continuationChapterOutlinePreview = ref(null)

  const continuationChapterTarget = ref(0)

  const txtImport = ref({
    ownership: 'owned',
    creationMethod: 'mixed',
    destination: 'new',
    title: '',
    parentPath: '',
    genre: '玄幻',
    externalConfirmed: false,
    selectedChapterIndexes: []
  })

  const createForm = ref({
    name: '',
    parentPath: '',
    genre: '玄幻',
    subgenre: '',
    coreIdea: '',
    plannedVolumes: 3,
    chaptersPerVolume: 40,
    targetWordsPerChapter: 3000
  })

  const createErrors = ref({ name: '', parentPath: '' })

  const createNameInput = ref(null)

  const createTrigger = ref(null)

  const newProjectGuide = ref(null)

  const profileSavedSnapshot = ref('')

  const profileSaveProgress = ref('saved')

  const profileSavedAt = ref(null)

  const workflowStatus = ref(null)

  const migrationPreview = ref(null)

  const sqliteShadowPreview = ref(null)

  const sqliteShadowResult = ref(null)

  const sqliteStorageStatus = ref(null)

  const sqliteActivationPreview = ref(null)

  const sqliteActivationResult = ref(null)

  const workspaceBackupResult = ref(null)

  const workspaceRestorePreview = ref(null)

  const autoBackupStatus = ref({
    enabled: false,
    targetParentPath: '',
    backupOnFirstOpen: true,
    intervalMinutes: 30,
    retentionCount: 10,
    lastCheckedAt: null,
    lastSuccessAt: null,
    nextDueAt: null,
    lastError: null,
    lastResult: null,
    state: 'disabled'
  })

  const autoBackupDraft = ref({
    enabled: false,
    targetParentPath: '',
    backupOnFirstOpen: true,
    intervalMinutes: 30,
    retentionCount: 10
  })

  const autoBackupRunning = ref(false)

  const autoBackupLoading = ref(false)

  const autoBackupDraftDirty = ref(false)

  const workspaceLoadError = ref('')

  const workspaceBootstrapIssues = ref([])

  const projectWordCount = computed(() => ports.chapters.value.reduce((sum, item) => sum + (item.word_count || 0), 0))

  const continuationSelectedVolumeReceipt = computed(
    () =>
      continuationAnalysis.value?.adoption?.volumeOutlines?.find(
        (item) => item.volume === continuationVolumeTarget.value
      ) || null
  )

  const continuationSelectedVolumeConfirmed = computed(
    () =>
      ports.outlinePlanning.value?.volumes?.find((item) => item.volume === continuationVolumeTarget.value)?.approval
        ?.status === 'confirmed'
  )

  const continuationEligibleChapters = computed(() =>
    ports.chapters.value.filter((chapter) => {
      const placement = ports.outlinePlanning.value?.chapterPlacements?.find((item) => item.chapterId === chapter.id)
      if (!placement) return false
      const receipt = continuationAnalysis.value?.adoption?.volumeOutlines?.find(
        (item) => item.volume === placement.volume
      )
      const volume = ports.outlinePlanning.value?.volumes?.find((item) => item.volume === placement.volume)
      return Boolean(receipt && volume?.approval?.status === 'confirmed' && ports.planningTotalConfirmed.value)
    })
  )

  const continuationSelectedChapterReceipt = computed(
    () =>
      continuationAnalysis.value?.adoption?.chapterOutlines?.find(
        (item) => item.chapterId === continuationChapterTarget.value
      ) || null
  )

  const continuationSelectedChapterConfirmed = computed(
    () =>
      ports.selectedId.value === continuationChapterTarget.value &&
      ports.outlinePlanning.value?.chapter?.review?.status === 'confirmed'
  )

  const txtCanImport = computed(() => {
    if (!txtPreview.value || !txtImport.value.title.trim()) return false
    if (txtImportEntry.value === 'create-from-files' && importManifest.value) {
      const roles = importManifest.value.files.map((file) => manifestRoles.value[file.token] || '')
      if (roles.some((role) => !role) || !roles.includes('manuscript')) return false
      if (roles.includes('external') && !txtImport.value.externalConfirmed) return false
      const manuscriptFiles = importManifest.value.files.filter(
        (file) => manifestRoles.value[file.token] === 'manuscript'
      )
      if (manuscriptFiles.some((file) => !(manifestChapterSelections.value[file.token] || []).length)) return false
      return Boolean(txtImport.value.parentPath)
    }
    if (txtImport.value.ownership === 'external')
      return Boolean(ports.current.value && txtImport.value.externalConfirmed)
    if (txtImport.value.ownership === 'material') return Boolean(ports.current.value)
    if (!txtImport.value.selectedChapterIndexes.length) return false
    if (txtImport.value.destination === 'new') return Boolean(txtImport.value.parentPath)
    return Boolean(ports.current.value)
  })

  return {
    libraryModelsDialog,
    libraryModelsOpen,
    workspaceOpening,
    projectsLoaded,
    projects,
    continueProjectId,
    projectTrashTarget,
    projectTrashConfirmation,
    recentlyTrashedProject,
    txtImportEntry,
    txtPreview,
    txtMaterialPreview,
    importManifest,
    manifestRoles,
    manifestChapterSelections,
    importCreatedProject,
    importRecoveries,
    continuationAnalysis,
    continuationManifestId,
    continuationBlockedReason,
    continuationProjectDefinitionPreview,
    continuationExistingPlotPreview,
    continuationExistingPlotDraft,
    continuationCharacterEditorOpen,
    continuationCharacterPreview,
    continuationCharacterDraft,
    continuationWorldViewPreview,
    continuationPowerSystemPreview,
    continuationCheatSystemPreview,
    continuationTotalOutlinePreview,
    continuationVolumeOutlinePreview,
    continuationVolumeTarget,
    continuationChapterOutlinePreview,
    continuationChapterTarget,
    txtImport,
    createForm,
    createErrors,
    createNameInput,
    createTrigger,
    newProjectGuide,
    profileSavedSnapshot,
    profileSaveProgress,
    profileSavedAt,
    workflowStatus,
    migrationPreview,
    sqliteShadowPreview,
    sqliteShadowResult,
    sqliteStorageStatus,
    sqliteActivationPreview,
    sqliteActivationResult,
    workspaceBackupResult,
    workspaceRestorePreview,
    autoBackupStatus,
    autoBackupDraft,
    autoBackupRunning,
    autoBackupLoading,
    autoBackupDraftDirty,
    workspaceLoadError,
    workspaceBootstrapIssues,
    projectWordCount,
    continuationSelectedVolumeReceipt,
    continuationSelectedVolumeConfirmed,
    continuationEligibleChapters,
    continuationSelectedChapterReceipt,
    continuationSelectedChapterConfirmed,
    txtCanImport
  }
}
