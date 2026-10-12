import { localModelAssignment } from './use-model-settings'
import { isLocalConnection } from '../../../../contracts/models/local-model-contracts'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createModelsConnectionsActions(ports) {
  let savingAi = false, localRefreshGeneration = 0

  async function refreshLocalModels() {
    await readLocalModelState('模型状态暂时无法刷新，请稍后重试。')
  }

  async function readLocalModelState(failureMessage) {
    const generation = ++localRefreshGeneration, source = ports.ai.value, bookId = ports.current.value?.id
    const current = () => generation === localRefreshGeneration && ports.ai.value === source && ports.current.value?.id === bookId
    try {
      const [settings, models] = await Promise.all([ports.desktop.ai.getSettings(), ports.desktop.localModels.list()])
      if (!current()) return
      source.modelConfigured = settings.modelConfigured
      ports.localModelViews.value = models
    } catch {
      if (!current()) return
      ports.localModelViews.value = []
      ports.notice(failureMessage)
    }
  }

  async function useLocalModel(model, target) {
    const patch = localModelAssignment(ports.ai.value, model, target)
    const saved = await persistAi(patch)
    if (!saved || ports.ai.value !== saved.settings || ports.current.value?.id !== saved.bookId) return
    await readLocalModelState('模型方案已保存，但模型状态暂时无法刷新，请稍后重试。')
  }

  async function saveAi() {
    await persistAi({})
  }

  async function persistAi(patch) {
    if (savingAi) return
    const source = ports.ai.value, bookId = ports.current.value?.id
    // Selection stays separate from the displayed projection until main confirms.
    const update = ports.plainDto({ routingMode: source.routingMode, shared: source.shared, tasks: source.tasks, ...patch })
    savingAi = true; localRefreshGeneration++
    try {
      return await ports.guard(async () => {
        const result = await ports.desktop.ai.updateSettings(update)
        if (ports.ai.value !== source || ports.current.value?.id !== bookId) return
        ports.ai.value = {
          ...result,
          connections: result.connections.map((connection) => ({ ...connection, apiKey: '', clearApiKey: false }))
        }
        ports.removedAiConnectionIds.value = []
        ports.notice('当前书稿的模型方案已保存')
        return { settings: ports.ai.value, bookId }
      })
    } finally {
      savingAi = false
    }
  }

  function addAiConnection() {
    const id = `provider-${crypto.randomUUID()}`
    ports.ai.value.connections.push({
      id,
      name: `接口 ${ports.ai.value.connections.length + 1}`,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      apiKeyConfigured: false,
      clearApiKey: false
    })
  }

  function requestRemoveAiConnection(id) {
    if (ports.ai.value.connections.length <= 1) return ports.notice('至少需要保留一个模型接口')
    const connection = ports.ai.value.connections.find((item) => item.id === id)
    const fallback = ports.ai.value.connections.find((item) => item.id !== id)
    if (!connection || !fallback) return
    const affected = [
      ports.ai.value.shared.connectionId === id ? '统一模型' : '',
      ...Object.entries(ports.taskLabels)
        .filter(([key]) => ports.ai.value.tasks[key].connectionId === id)
        .map(([, label]) => label)
    ].filter(Boolean)
    ports.aiConnectionDeletePreview.value = {
      connectionId: id,
      connectionName: connection.name,
      fallbackConnectionId: fallback.id,
      affected
    }
  }

  function confirmRemoveAiConnection() {
    const preview = ports.aiConnectionDeletePreview.value
    if (!preview) return
    const id = preview.connectionId
    const fallback = ports.ai.value.connections.find(
      (connection) => connection.id === preview.fallbackConnectionId && connection.id !== id
    )
    if (!fallback) return
    ports.ai.value.connections = ports.ai.value.connections.filter((connection) => connection.id !== id)
    for (const profile of [ports.ai.value.shared, ...Object.values(ports.ai.value.tasks)]) {
      if (profile.connectionId === id) profile.connectionId = fallback.id
    }
    if (!ports.removedAiConnectionIds.value.includes(id)) ports.removedAiConnectionIds.value.push(id)
    delete ports.availableModelsByConnection.value[id]
    ports.aiModelChecks.value = ports.aiModelChecks.value.filter((item) => item.connectionId !== id)
    ports.aiConnectionResult.value = null
    ports.aiConnectionDeletePreview.value = null
    ports.notice(`已移除接口并把相关任务暂时改到“${fallback.name}”；保存后生效`)
  }

  function requestClearAiCredential(connection) {
    ports.aiCredentialClearPreview.value = { connectionId: connection.id, connectionName: connection.name }
  }

  function confirmClearAiCredential() {
    const preview = ports.aiCredentialClearPreview.value
    const connection = ports.ai.value.connections.find((item) => item.id === preview?.connectionId)
    if (!connection) return
    connection.apiKey = ''
    connection.clearApiKey = true
    ports.invalidateAiConnectionValidation(connection.id)
    ports.aiCredentialClearPreview.value = null
    ports.notice(`“${connection.name}”的密钥将在保存全部接口后清除`)
  }

  function connectionName(id) {
    return ports.ai.value.connections.find((connection) => connection.id === id)?.name || '未选择接口'
  }

  function connectionDraft(connection) {
    if (isLocalConnection(connection.id)) return { connectionId: connection.id }
    return { connectionId: connection.id, baseUrl: connection.baseUrl, apiKey: connection.apiKey || undefined }
  }

  async function refreshAiModelCatalog(force = false) {
    if (ports.aiCatalogLoading.value || !ports.current.value) return
    ports.localModelViews.value = await ports.desktop.localModels.list().catch(() => [])
    const candidates = ports.ai.value.connections.filter(
      (connection) =>
        ports.connectionCanTest(connection) &&
        (force || !Object.prototype.hasOwnProperty.call(ports.availableModelsByConnection.value, connection.id))
    )
    if (!candidates.length) return
    const generation = ++ports.aiCatalogRefreshGeneration
    ports.aiCatalogLoading.value = true
    try {
      const results = await Promise.all(
        candidates.map(async (connection) => {
          try {
            const response = await ports.desktop.ai.listModels(connectionDraft(connection))
            return {
              connectionId: connection.id,
              baseUrl: connection.baseUrl,
              models: response.models || [],
              success: true
            }
          } catch {
            return { connectionId: connection.id, baseUrl: connection.baseUrl, models: [], success: false }
          }
        })
      )
      if (generation !== ports.aiCatalogRefreshGeneration) return
      const nextModels = { ...ports.availableModelsByConnection.value }
      const unavailable = new Set(ports.aiCatalogUnavailableConnectionIds.value)
      for (const result of results) {
        const connection = ports.ai.value.connections.find((item) => item.id === result.connectionId)
        if (!connection || connection.baseUrl !== result.baseUrl) continue
        if (result.success) {
          nextModels[result.connectionId] = [...new Set(result.models.map((model) => model?.trim()).filter(Boolean))]
          unavailable.delete(result.connectionId)
        } else {
          unavailable.add(result.connectionId)
        }
      }
      ports.availableModelsByConnection.value = nextModels
      ports.aiCatalogUnavailableConnectionIds.value = [...unavailable]
    } finally {
      if (generation === ports.aiCatalogRefreshGeneration) ports.aiCatalogLoading.value = false
    }
  }

  function selectProfileModel(profile, choice) {
    if (!choice) return
    profile.connectionId = choice.connectionId
    profile.model = choice.model
    if (isLocalConnection(choice.connectionId)) profile.maxTokens = choice.recommendedOutputTokens || 2048
    ports.invalidateAiRoutingValidation()
  }

  async function testAi(targetConnectionId = '') {
    const routes =
      ports.ai.value.routingMode === 'shared'
        ? [
            {
              key: 'shared',
              label: '统一模型',
              connectionId: ports.ai.value.shared.connectionId,
              model: ports.ai.value.shared.model.trim()
            }
          ]
        : Object.entries(ports.taskLabels).map(([key, label]) => ({
            key,
            label,
            connectionId: ports.ai.value.tasks[key].connectionId,
            model: ports.ai.value.tasks[key].model.trim()
          }))
    const connections = targetConnectionId
      ? ports.ai.value.connections.filter((connection) => connection.id === targetConnectionId)
      : ports.ai.value.connections.filter((connection) => routes.some((route) => route.connectionId === connection.id))
    if (targetConnectionId) ports.invalidateAiConnectionValidation(targetConnectionId, false)
    else ports.invalidateAiRoutingValidation()
    ports.aiTesting.value = true
    try {
      const result = await ports.guard(async () => {
        const checks = []
        const warnings = []
        await Promise.all(
          connections.map(async (connection) => {
            const draft = connectionDraft(connection)
            let listedModels = []
            try {
              listedModels = (await ports.desktop.ai.listModels(draft)).models
              ports.availableModelsByConnection.value = {
                ...ports.availableModelsByConnection.value,
                [connection.id]: listedModels
              }
            } catch (error) {
              warnings.push(`${connection.name}：${error?.message || '模型列表接口不可用'}`)
            }
            const assignedRoutes = routes.filter((route) => route.connectionId === connection.id)
            const models = [...new Set(assignedRoutes.map((route) => route.model).filter(Boolean))]
            if (!models.length && listedModels[0]) models.push(listedModels[0])
            if (!models.length) {
              checks.push({
                key: `connection-${connection.id}`,
                label: connection.name,
                connectionId: connection.id,
                model: '',
                success: false,
                message: '接口没有分配模型，且未返回模型列表'
              })
              return
            }
            const probes = await Promise.all(
              models.map((model) => ports.desktop.ai.testConnection({ ...draft, model }))
            )
            const probeByModel = new Map(probes.map((probe) => [probe.model, probe]))
            if (assignedRoutes.length) {
              checks.push(
                ...assignedRoutes.map((route) => ({
                  ...route,
                  ...(probeByModel.get(route.model) || { success: false, message: '模型名称为空' })
                }))
              )
            } else {
              const probe = probes[0]
              checks.push({
                key: `connection-${connection.id}`,
                label: connection.name,
                connectionId: connection.id,
                ...probe
              })
            }
            const discovered = probes.flatMap((probe) => probe.models || [])
            if (discovered.length)
              ports.availableModelsByConnection.value = {
                ...ports.availableModelsByConnection.value,
                [connection.id]: [...new Set(discovered)]
              }
            for (const probe of probes)
              if (probe.modelListWarning) warnings.push(`${connection.name}：${probe.modelListWarning}`)
          })
        )
        ports.aiModelChecks.value = targetConnectionId
          ? [...ports.aiModelChecks.value.filter((item) => item.connectionId !== targetConnectionId), ...checks]
          : checks
        const failed = checks.filter((item) => !item.success)
        return {
          success: failed.length === 0,
          message: failed.length
            ? `${failed.map((item) => `${item.label}“${item.model || '未填写'}”`).join('、')}不可用。每个模型只会使用自己绑定的接口。`
            : `${checks.length} 个模型路由均已通过所属接口的真实生成测试。`,
          model: checks[0]?.model || '',
          models: connections.flatMap((connection) => ports.availableModelsByConnection.value[connection.id] || []),
          modelListWarning: warnings.join('；') || undefined
        }
      })
      ports.aiConnectionResult.value = result
      ports.notice(result.message)
    } finally {
      ports.aiTesting.value = false
    }
  }

  return {
    refreshLocalModels,
    useLocalModel,
    saveAi,
    addAiConnection,
    requestRemoveAiConnection,
    confirmRemoveAiConnection,
    requestClearAiCredential,
    confirmClearAiCredential,
    connectionName,
    connectionDraft,
    refreshAiModelCatalog,
    selectProfileModel,
    testAi
  }
}
