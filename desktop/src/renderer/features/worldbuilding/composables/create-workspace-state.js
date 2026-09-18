import { computed, ref } from 'vue'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createWorldbuildingState(ports) {
  const preparationMode = ref('automatic')

  const realms = ref([])

  const powerSystem = ref({ overview: '' })

  const cheatSystem = ref({ overview: '' })

  const systemTemplate = ref('')

  const foundation = ref({
    creationPath: 'materials',
    sourceNotes: '',
    worldView: '',
    useRealms: false,
    useSystem: false
  })

  const bookProfile = ref({
    genre: '玄幻',
    subgenre: '',
    coreIdea: '',
    plannedVolumes: 3,
    chaptersPerVolume: 40,
    targetWordsPerChapter: 3000,
    targetWords: 360_000,
    audienceScale: '',
    defaultPov: '',
    narrativeDistance: '',
    writingStyle: '',
    proseExpansionMode: 'web-serial',
    reviewStrictness: 'balanced',
    chapterGenerationMode: 'reviewed',
    autosaveEnabled: true,
    autosaveDelayMs: 1500,
    autosaveMergeWindowMs: 30000
  })

  const foundationDraft = ref(null)

  const researchSettings = ref({
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2-0-lite-260428',
    apiKey: '',
    apiKeyConfigured: false
  })

  const researchResult = ref(null)

  const researchQuery = ref('')

  const sourceCards = ref([])

  const materialSection = ref('notes')

  const materialSearch = ref('')

  const creatingSource = ref(false)

  const sourceDraft = ref({ title: '', url: '', author: '', publishedAt: '', excerpt: '', userNotes: '' })

  const materialSectionInfo = computed(
    () =>
      ({
        notes: { title: '灵感与设定', description: '先记便签，再由你批准或提升为正式世界设定' },
        manual: { title: '自备资料', description: '整理本人导入或手工录入的可追溯资料' },
        research: { title: '联网采风', description: '检索公开资料，保留来源后再决定是否采用' },
        events: { title: '事件提炼', description: '把素材整理成时间、人物、地点与事件完整的候选事实' }
      })[materialSection.value]
  )

  const foundationMissing = computed(() => ports.workflowStatus.value?.missingForChapterOutline || ['正在核对创作前置'])

  const foundationReady = computed(() => Boolean(ports.workflowStatus.value?.readyForChapterOutline))

  const researchSourcesIssue = computed(
    () => ports.workspaceBootstrapIssues.value.find((item) => item.id === 'researchSourcesUnreadable') || null
  )

  const researchEventsIssue = computed(
    () => ports.workspaceBootstrapIssues.value.find((item) => item.id === 'researchEventsUnreadable') || null
  )

  const sourceDraftDirty = computed(() => {
    if (creatingSource.value) return Object.values(sourceDraft.value).some((value) => String(value || '').trim())
    const source = ports.selectedSource.value
    if (!source) return false
    return (
      sourceDraft.value.title !== source.title ||
      sourceDraft.value.excerpt !== source.excerpt ||
      sourceDraft.value.userNotes !== source.userNotes ||
      sourceDraft.value.url !== (source.url || '') ||
      sourceDraft.value.author !== (source.author || '') ||
      sourceDraft.value.publishedAt !== (source.publishedAt || '')
    )
  })

  return {
    preparationMode,
    realms,
    powerSystem,
    cheatSystem,
    systemTemplate,
    foundation,
    bookProfile,
    foundationDraft,
    researchSettings,
    researchResult,
    researchQuery,
    sourceCards,
    materialSection,
    materialSearch,
    creatingSource,
    sourceDraft,
    materialSectionInfo,
    foundationMissing,
    foundationReady,
    researchSourcesIssue,
    researchEventsIssue,
    sourceDraftDirty
  }
}
