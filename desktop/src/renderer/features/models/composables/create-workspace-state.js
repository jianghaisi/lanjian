import { computed, ref } from 'vue'
import { buildModelCatalog } from '../services/model-catalog'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createModelsState(ports) {
  const modelSettingsDirty = ref(false)

  const createModelsPreview = ref(null)

  const partialCreation = ref(null)

  const importModelsPreview = ref(null)

  const partialImportCreation = ref(null)

  const oneOffGlobalConnections = ref([])

  const availableModelsByConnection = ref({})

  const aiCatalogLoading = ref(false)

  const aiCatalogUnavailableConnectionIds = ref([])

  const aiConnectionResult = ref(null)

  const aiModelChecks = ref([])

  const aiTesting = ref(false)

  const aiConnectionDeletePreview = ref(null)

  const aiCredentialClearPreview = ref(null)

  const aiInstruction = ref('依据总纲、时间线和设定续写本章，保持人物动机与实力一致。')

  const duplicateAiConnectionNames = computed(() => {
    const counts = new Map()
    for (const connection of ports.ai.value.connections) {
      const name = connection.name.trim().toLocaleLowerCase()
      if (name) counts.set(name, (counts.get(name) || 0) + 1)
    }
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name))
  })

  const localModelViews = ref([])

  const modelCatalogChoices = computed(() =>
    buildModelCatalog(
      ports.ai.value.connections,
      availableModelsByConnection.value,
      [ports.ai.value.shared, ...Object.values(ports.ai.value.tasks)],
      localModelViews.value
    )
  )

  return {
    modelSettingsDirty,
    createModelsPreview,
    partialCreation,
    importModelsPreview,
    partialImportCreation,
    oneOffGlobalConnections,
    availableModelsByConnection,
    aiCatalogLoading,
    aiCatalogUnavailableConnectionIds,
    aiConnectionResult,
    aiModelChecks,
    aiTesting,
    aiConnectionDeletePreview,
    aiCredentialClearPreview,
    aiInstruction,
    duplicateAiConnectionNames,
    localModelViews,
    modelCatalogChoices
  }
}
