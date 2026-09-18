import { isLocalConnection } from '../../../../contracts/models/local-model-contracts'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createModelsConnectionOptionsActions(ports) {
  function modelChoices(currentModel = '', connectionId = '') {
    const assigned = [ports.ai.value.shared, ...Object.values(ports.ai.value.tasks)]
      .filter((profile) => !connectionId || profile.connectionId === connectionId)
      .map((profile) => profile.model)
    const discovered = connectionId
      ? ports.availableModelsByConnection.value[connectionId] || []
      : Object.values(ports.availableModelsByConnection.value).flat()
    return [
      ...new Set(
        [currentModel, ...assigned, ...(connectionId ? [] : [ports.researchSettings.value.model]), ...discovered]
          .map((model) => model?.trim())
          .filter(Boolean)
      )
    ]
  }

  function isDuplicateAiConnectionName(connection) {
    return ports.duplicateAiConnectionNames.value.has(connection.name.trim().toLocaleLowerCase())
  }

  function connectionHost(connection) {
    try {
      return new URL(connection.baseUrl).host || '地址待填写'
    } catch {
      return '地址待核对'
    }
  }

  function connectionOptionLabel(connection) {
    return `${connection.name || '未命名接口'} · ${connectionHost(connection)}`
  }

  function connectionModels(connectionId) {
    return ports.availableModelsByConnection.value[connectionId] || []
  }

  function invalidateAiConnectionValidation(connectionId, clearModels = true) {
    ports.aiConnectionResult.value = null
    ports.aiModelChecks.value = ports.aiModelChecks.value.filter((item) => item.connectionId !== connectionId)
    if (clearModels) {
      const next = { ...ports.availableModelsByConnection.value }
      delete next[connectionId]
      ports.availableModelsByConnection.value = next
    }
  }

  function invalidateAiRoutingValidation() {
    ports.aiConnectionResult.value = null
    ports.aiModelChecks.value = []
  }

  function handleConnectionNameInput(connection) {
    invalidateAiConnectionValidation(connection.id, false)
  }

  function handleConnectionKeyInput(connection) {
    connection.clearApiKey = false
    invalidateAiConnectionValidation(connection.id)
  }

  function connectionCredentialStatus(connection) {
    if (connection.clearApiKey) return '密钥将在保存时清除'
    if (connection.apiKey) return connection.apiKeyConfigured ? '替换密钥待保存' : '新密钥待保存'
    return connection.apiKeyConfigured ? '密钥已安全保存' : '尚未保存密钥'
  }

  function connectionCanTest(connection) {
    if (isLocalConnection(connection.id)) return true
    return Boolean(connection.apiKey || (connection.apiKeyConfigured && !connection.clearApiKey))
  }

  function modelCheckFor(model = '', connectionId = '') {
    return (
      ports.aiModelChecks.value.find(
        (item) => item.model === model.trim() && (!connectionId || item.connectionId === connectionId)
      ) || null
    )
  }

  return {
    modelChoices,
    isDuplicateAiConnectionName,
    connectionHost,
    connectionOptionLabel,
    connectionModels,
    invalidateAiConnectionValidation,
    invalidateAiRoutingValidation,
    handleConnectionNameInput,
    handleConnectionKeyInput,
    connectionCredentialStatus,
    connectionCanTest,
    modelCheckFor
  }
}
