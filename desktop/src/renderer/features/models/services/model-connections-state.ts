import { isReferencedBookSettings } from '../../../../contracts/models/book-model-settings'
import { decodeParameterPolicy, parameterError, type ParameterOverrides, type ParameterPolicy } from '../../../../contracts/models/parameter-policy'
import type { LegacyModelProfile } from '../../../../contracts/models/types'
import { assertThinkingProtocol } from '../../../../contracts/models/thinking-level'
import type { ModelProfile } from '../../../../contracts/index'
import type { BookModelSettings, ReferencedBookModelSettings } from '../../../../contracts/models/book-model-settings'
import type { GlobalConnectionsView } from '../../../../contracts/models/model-connections'
import type { ModelDefaultTemplate } from '../../../../contracts/models/new-book-model-defaults'

export const modelTaskLabels = { shared: '统一模型', outline: '总纲 / 谋篇', chapterOutline: '章节大纲', prose: '正文创作', review: '审校' } as const
export type ModelSlot = keyof typeof modelTaskLabels
export type ProfileDraft = Partial<Omit<LegacyModelProfile, 'connectionId' | 'parameterPolicy'>> & {
  selection: string; model: string; parameterPolicy?: ParameterPolicy
  // Native number inputs can report value='' for unfinished nonempty input.
  // Keep that state dirty and unsavable without changing the last valid intent.
  parameterInputErrors?: Partial<Record<keyof ParameterOverrides, true>>
}
export type RoutingDraft = { routingMode: 'shared' | 'perTask'; profiles: Record<ModelSlot, ProfileDraft> }
export function routingDraft(settings: BookModelSettings | ModelDefaultTemplate | null): RoutingDraft {
  const profiles = Object.fromEntries((Object.keys(modelTaskLabels) as ModelSlot[]).map(slot => {
    const p = settings ? slot === 'shared' ? settings.shared : settings.tasks[slot] : { connectionId: '', model: '', parameterPolicy: { version: 1, mode: 'auto' } }
    let selection = ''
    if (p.connectionId === 'local:llama-cpp') selection = 'local'
    else if (settings && isReferencedBookSettings(settings)) {
      const r = settings.references.find(r => r.id === p.connectionId)
      selection = r?.kind === 'global' ? `global:${r.globalConnectionId}` : `private:${p.connectionId}`
    } else if (settings) selection = `private:${p.connectionId}`
    const { connectionId: _, ...profile } = p
    return [slot, { ...JSON.parse(JSON.stringify(profile)), ...(p.parameterPolicy ? {} : { thinkingLevel: p.thinkingLevel ?? 'default' }), selection }]
  })) as Record<ModelSlot, ProfileDraft>
  return { routingMode: settings?.routingMode ?? 'shared', profiles }
}
export function compileRouting(draft: RoutingDraft, catalog: GlobalConnectionsView, baseline?: BookModelSettings): { template: ModelDefaultTemplate; patch: unknown } {
  const oldReferences = baseline && isReferencedBookSettings(baseline) ? baseline.references : []
  const privateIds = new Set(baseline && isReferencedBookSettings(baseline) ? baseline.references.filter(r => r.kind === 'legacy-private').map(r => r.id) : baseline?.connections.map(r => r.id) ?? [])
  const occupied = new Set([...privateIds, ...oldReferences.map(r => r.id)]), references: ReferencedBookModelSettings['references'] = [], ids = new Map<string, string>()
  const before = baseline ? routingDraft(baseline) : undefined
  const requiredGlobals = new Set<string>()
  const profiles = {} as Record<ModelSlot, ModelProfile>
  for (const slot of Object.keys(modelTaskLabels) as ModelSlot[]) {
    const own = draft.profiles[slot]
    const inactive = (slot === 'shared') !== (draft.routingMode === 'shared')
    const retained = inactive && before && JSON.stringify(own) === JSON.stringify(before.profiles[slot])
    const fallback = draft.routingMode === 'shared' ? draft.profiles.shared : draft.profiles.prose
    const { selection, ...p } = inactive && !own.selection && !own.model ? fallback : own
    let connectionId = ''
    if (selection === 'local') connectionId = 'local:llama-cpp'
    else if (selection.startsWith('private:') && baseline) {
      connectionId = selection.slice(8)
      if (!privateIds.has(connectionId)) throw Error('本书私有接口已变化，请刷新后重试。')
    } else if (selection.startsWith('global:')) {
      const globalId = selection.slice(7), connection = catalog.connections.find(c => c.id === globalId)
      if (!connection?.enabled && !retained) throw Error('请选择可用的全局接口；不会自动替换失效的选择。')
      if (!retained) requiredGlobals.add(globalId)
      const retainedId = retained && baseline ? (slot === 'shared' ? baseline.shared : baseline.tasks[slot]).connectionId : undefined
      const existing = oldReferences.find(r => r.kind === 'global' && r.globalConnectionId === globalId && (!retainedId || r.id === retainedId))
      connectionId = retainedId ?? ids.get(globalId) ?? existing?.id ?? ''
      if (!connectionId) {
        let n = ids.size + 1
        connectionId = `assigned-${n}`
        while (occupied.has(connectionId)) connectionId = `assigned-${++n}`
      }
      occupied.add(connectionId); ids.set(globalId, connectionId)
      if (!references.some(r => r.id === connectionId)) references.push({ ...existing, kind: 'global', id: connectionId, globalConnectionId: globalId })
    } else throw Error(`请先为“${modelTaskLabels[slot]}”选择接口并填写型号。`)
    const protocol = selection.startsWith('global:') ? catalog.connections.find(c => c.id === selection.slice(7))?.protocol : selection === 'local' ? 'local' : 'openai-compatible'
    if (!retained) assertThinkingProtocol(p.thinkingLevel, protocol)
    // Preserve the exact inactive intent, including absent legacy defaults.
    profiles[slot] = draftProfile(retained && baseline ? (slot === 'shared' ? baseline.shared : baseline.tasks[slot]) : p, connectionId)
  }
  const { shared, ...tasks } = profiles
  const template: ModelDefaultTemplate = { version: Object.values(profiles).some(p => p.parameterPolicy) ? 5 : 4, references: references as ModelDefaultTemplate['references'], routingMode: draft.routingMode, shared, tasks }
  const required = references.filter(r => r.kind === 'global' && (requiredGlobals.has(r.globalConnectionId) || !oldReferences.some(old => old.kind === 'global' && old.id === r.id && old.globalConnectionId === r.globalConnectionId)))
  const globalRevisions = [...new Set(required.map(r => r.kind === 'global' ? r.globalConnectionId : ''))].map(id => ({ id, revision: catalog.connections.find(c => c.id === id)!.revision }))
  return { template, patch: { routingMode: draft.routingMode, shared, tasks, globalReferences: references.map(r => ({ id: r.id, globalConnectionId: r.kind === 'global' ? r.globalConnectionId : '' })), globalRevisions } }
}
export function copySharedProfiles(draft: RoutingDraft): RoutingDraft {
  return { ...draft, profiles: Object.fromEntries(Object.keys(modelTaskLabels).map(slot => [slot, JSON.parse(JSON.stringify(draft.profiles.shared))])) as RoutingDraft['profiles'] }
}

export function draftProfile(p: Omit<ProfileDraft, 'selection'>, connectionId: string): ModelProfile {
  const labels = { temperature: '创造性', topP: '采样范围', maxTokens: '最大输出', thinking: '思考预算', reasoning: '思考设置', topK: '候选词数' }
  const invalid = (Object.keys(labels) as Array<keyof ParameterOverrides>).filter(key => p.parameterInputErrors?.[key])
  if (invalid.length) parameterError(`${invalid.map(key => labels[key]).join('、')}：请输入完整数字，或清空以使用自动。`)
  return p.parameterPolicy ? { connectionId, model: p.model, parameterPolicy: decodeParameterPolicy(p.parameterPolicy) }
    : { connectionId, model: p.model, temperature: p.temperature!, topP: p.topP!, maxTokens: p.maxTokens!, ...(p.thinkingLevel === undefined ? {} : { thinkingLevel: p.thinkingLevel }) }
}
export function selectModel(p: ProfileDraft, model: string, selection = p.selection): ProfileDraft {
  return { selection, model, parameterPolicy: { version: 1, mode: 'auto' } }
}
