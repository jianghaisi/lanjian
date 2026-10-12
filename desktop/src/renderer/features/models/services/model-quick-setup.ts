import { modelConnectionResults, type ModelConnectionsApi, type ModelDefaultsView, type ModelProbe, type ModelProbeResult } from '../../../../contracts/models/model-connections-contracts'
import { decodeParameterPolicy } from '../../../../contracts/models/parameter-policy'
import { compileRouting, copySharedProfiles, routingDraft } from './model-connections-state'

/** Verify the result against the requested identity/intent and detach reactive data. */
export function checkedModelProbe(input: ModelProbe, value: ModelProbeResult): ModelProbeResult {
  const result = modelConnectionResults.test(value)
  if (result.id !== input.id || result.revision !== input.revision || result.model !== input.model || (result.thinkingLevel ?? 'default') !== (input.thinkingLevel ?? 'default')) {
    throw Error('测试回执与选中的接口、型号或思考设置不一致，请重新测试。')
  }
  const expected = input.parameterPolicy ?? (input.thinkingLevel === undefined ? { version: 1 as const, mode: 'auto' as const } : undefined)
  if (result.success && (expected
    ? !result.parameterPolicy || !result.parameterFingerprint || JSON.stringify(result.parameterPolicy) !== JSON.stringify(decodeParameterPolicy(expected))
    : result.parameterPolicy !== undefined)) {
    throw Error('测试结果未确认当前参数，请重新测试；不会自动更改参数。')
  }
  return result
}

// Keep the saved connection identity across test/default failures. Retrying the
// last two steps must never create another connection or choose by display name.
export async function finishQuickSetup(api: ModelConnectionsApi, connectionId: string, model: string): Promise<ModelDefaultsView> {
  const catalog = await api.list()
  const connection = catalog.connections.find(item => item.id === connectionId)
  if (!connection?.enabled) throw Error('这个接口已停用或移除，请重新选择。')
  if (!model.trim()) throw Error('请填写服务商提供的模型型号。')
  const defaults = await api.defaults()
  const input: ModelProbe = { id: connection.id, revision: connection.revision, model: model.trim(), parameterPolicy: { version: 1, mode: 'auto' } }
  const result = checkedModelProbe(input, await api.test(input))
  if (!result.success) throw Error(result.message)
  const draft = routingDraft(null)
  draft.routingMode = 'shared'
  draft.profiles.shared = { ...draft.profiles.shared, selection: `global:${connection.id}`, model: model.trim() }
  const template = compileRouting(copySharedProfiles(draft), catalog).template
  return api.saveDefaults({ expectedRevision: defaults.revision, expectedCatalogRevision: catalog.revision, template })
}

export async function saveTestedModelDefault(api: ModelConnectionsApi, result: ModelProbeResult): Promise<ModelDefaultsView> {
  if (!result.success || !result.model.trim()) throw Error('请先选择测试通过的模型。')
  // Capture the explicit choice before any async read; neither a changed row nor
  // a nested reactive policy may replace the selection while it is being saved.
  result = checkedModelProbe({ id: result.id, revision: result.revision, model: result.model,
    ...(result.parameterPolicy ? { parameterPolicy: result.parameterPolicy } : result.thinkingLevel !== undefined ? { thinkingLevel: result.thinkingLevel } : {}) }, result)
  const catalog = await api.list(), connection = catalog.connections.find(item => item.id === result.id)
  if (!connection?.enabled || connection.revision !== result.revision) throw Error('接口或密钥已变化，请重新获取模型并测试。')
  const defaults = await api.defaults(), draft = routingDraft(null)
  draft.profiles.shared = result.thinkingLevel && result.thinkingLevel !== 'default'
    ? { selection: `global:${connection.id}`, model: result.model, temperature: 0, topP: 1, maxTokens: 8192, thinkingLevel: result.thinkingLevel }
    : { selection: `global:${connection.id}`, model: result.model, parameterPolicy: result.parameterPolicy ?? { version: 1, mode: 'auto' } }
  const template = compileRouting(copySharedProfiles(draft), catalog).template
  return api.saveDefaults({ expectedRevision: defaults.revision, expectedCatalogRevision: catalog.revision, template })
}
