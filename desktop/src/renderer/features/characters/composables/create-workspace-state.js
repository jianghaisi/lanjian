import { computed, ref } from 'vue'
import { projectCharacterAtlas } from '../services/character-atlas'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createCharactersState(ports) {
  const characterLines = ref({ version: 1, workItemId: '', source: 'legacy-accepted-prose', lines: [] })

  const characterLinesLoaded = ref(false)

  const characterLinesLoading = ref(false)

  const characterLinesError = ref('')

  const characterDisplayMode = ref('cards')

  const characterAtlasThroughPosition = ref(null)

  const foreshadowLedger = ref({ foreshadows: [], actions: [] })

  const foreshadowLedgerLoaded = ref(false)

  const selectedForeshadowId = ref('')

  const foreshadowDraft = ref({ action: 'plant', title: '', foreshadowId: '', legacyChapterId: '', description: '' })

  const characterAliases = ref([])

  const characterAliasDraft = ref({ canonicalName: '', aliasesText: '' })

  const characterAliasesLoaded = ref(false)

  const storyEntities = ref([])

  const storyEntityRelations = ref([])

  const storyEntitiesLoaded = ref(false)

  const storyEntityDraft = ref({
    id: '',
    entityType: 'character',
    canonicalName: '',
    profileJson: '{}',
    status: 'approved'
  })

  const storyRelationDraft = ref({ subjectEntityId: '', predicate: '', objectEntityId: '', notes: '' })

  const resourceLedger = ref({ balances: [], entries: [] })

  const resourceLedgerDraft = ref({ resourceEntityId: '', delta: '', eventId: '', note: '' })

  const characterState = ref(null)

  const characterStateIssue = computed(
    () => ports.workspaceBootstrapIssues.value.find((item) => item.id === 'characterStateUnreadable') || null
  )

  const characterAtlasCards = computed(() =>
    projectCharacterAtlas(
      characterLines.value,
      characterAtlasThroughPosition.value,
      new Set(ports.chapters.value.map((item) => item.id))
    )
  )

  const selectedForeshadow = computed(
    () => foreshadowLedger.value.foreshadows.find((item) => item.id === selectedForeshadowId.value) || null
  )

  const selectedForeshadowActions = computed(() =>
    foreshadowLedger.value.actions
      .filter((item) => item.foreshadowId === selectedForeshadowId.value)
      .slice()
      .reverse()
  )

  const characterContinuityFindings = computed(() =>
    ports.allCharacterFindings.value.filter(
      (finding) => !finding.findingStatus || ['open', 'accepted'].includes(finding.findingStatus)
    )
  )

  return {
    characterLines,
    characterLinesLoaded,
    characterLinesLoading,
    characterLinesError,
    characterDisplayMode,
    characterAtlasThroughPosition,
    foreshadowLedger,
    foreshadowLedgerLoaded,
    selectedForeshadowId,
    foreshadowDraft,
    characterAliases,
    characterAliasDraft,
    characterAliasesLoaded,
    storyEntities,
    storyEntityRelations,
    storyEntitiesLoaded,
    storyEntityDraft,
    storyRelationDraft,
    resourceLedger,
    resourceLedgerDraft,
    characterState,
    characterStateIssue,
    characterAtlasCards,
    selectedForeshadow,
    selectedForeshadowActions,
    characterContinuityFindings
  }
}
