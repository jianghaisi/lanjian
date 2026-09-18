import type { ModelProfile } from '../../../../contracts/index'
import type { BookModelSettings, ReferencedBookModelSettings } from '../../../../contracts/models/book-model-settings'
import type { GlobalConnectionsView } from '../../../../contracts/models/model-connections'
import type { ModelDefaultTemplate } from '../../../../contracts/models/new-book-model-defaults'

export const modelTaskLabels = { shared: '统一模型', outline: '总纲 / 谋篇', chapterOutline: '章节大纲', prose: '正文创作', review: '审校' } as const
export type ModelSlot = keyof typeof modelTaskLabels
export type ProfileDraft = Omit<ModelProfile, 'connectionId'> & { selection: string }
export type RoutingDraft = { routingMode: 'shared' | 'perTask'; profiles: Record<ModelSlot, ProfileDraft> }
export function routingDraft(settings: BookModelSettings | ModelDefaultTemplate | null): RoutingDraft {
  const profiles = Object.fromEntries((Object.keys(modelTaskLabels) as ModelSlot[]).map(slot => {
    const p = settings ? slot === 'shared' ? settings.shared : settings.tasks[slot] : { connectionId: '', model: '', temperature: slot === 'review' ? 0.2 : 0.7, topP: 0.95, maxTokens: 4096 }
    let selection = ''
    if (p.connectionId === 'local:llama-cpp') selection = 'local'
    else if (settings && settings.version === 4) {
      const r = settings.references.find(r => r.id === p.connectionId)
      selection = r?.kind === 'global' ? `global:${r.globalConnectionId}` : `private:${p.connectionId}`
    } else if (settings) selection = `private:${p.connectionId}`
    const { connectionId: _, ...profile } = p
    return [slot, { ...profile, selection }]
  })) as Record<ModelSlot, ProfileDraft>
  return { routingMode: settings?.routingMode ?? 'perTask', profiles }
}
export function compileRouting(draft: RoutingDraft, catalog: GlobalConnectionsView, baseline?: BookModelSettings): { template: ModelDefaultTemplate; patch: unknown } {
  const oldReferences = baseline?.version === 4 ? baseline.references : []
  const privateIds = new Set(baseline?.version === 4 ? baseline.references.filter(r => r.kind === 'legacy-private').map(r => r.id) : baseline?.connections.map(r => r.id) ?? [])
  const occupied = new Set(privateIds), references: ReferencedBookModelSettings['references'] = [], ids = new Map<string, string>()
  const profiles = {} as Record<ModelSlot, ModelProfile>
  for (const slot of Object.keys(modelTaskLabels) as ModelSlot[]) {
    const { selection, ...p } = draft.profiles[slot]
    let connectionId = ''
    if (selection === 'local') connectionId = 'local:llama-cpp'
    else if (selection.startsWith('private:') && baseline) {
      connectionId = selection.slice(8)
      if (!privateIds.has(connectionId)) throw Error('本书私有接口已变化，请刷新后重试。')
    } else if (selection.startsWith('global:')) {
      const globalId = selection.slice(7), connection = catalog.connections.find(c => c.id === globalId)
      if (!connection?.enabled) throw Error('请选择可用的全局接口；不会自动替换失效的选择。')
      connectionId = ids.get(globalId) ?? ''
      if (!connectionId) {
        const existing = oldReferences.find(r => r.kind === 'global' && r.globalConnectionId === globalId)
        connectionId = existing?.id ?? `assigned-${ids.size + 1}`
        let n = ids.size + 1
        while (occupied.has(connectionId)) connectionId = `assigned-${++n}`
        occupied.add(connectionId); ids.set(globalId, connectionId)
        references.push({ kind: 'global', id: connectionId, globalConnectionId: globalId })
      }
    } else throw Error(`请先为“${modelTaskLabels[slot]}”选择接口并填写型号。`)
    profiles[slot] = { ...p, connectionId }
  }
  const { shared, ...tasks } = profiles
  const template: ModelDefaultTemplate = { version: 4, references: references as ModelDefaultTemplate['references'], routingMode: draft.routingMode, shared, tasks }
  const selected = new Set((draft.routingMode === 'shared' ? [shared] : Object.values(tasks)).map(p => p.connectionId))
  const required = references.filter(r => r.kind === 'global' && (selected.has(r.id) || !oldReferences.some(old => old.kind === 'global' && old.id === r.id && old.globalConnectionId === r.globalConnectionId)))
  const globalRevisions = [...new Set(required.map(r => r.kind === 'global' ? r.globalConnectionId : ''))].map(id => ({ id, revision: catalog.connections.find(c => c.id === id)!.revision }))
  return { template, patch: { routingMode: draft.routingMode, shared, tasks, globalReferences: references.map(r => ({ id: r.id, globalConnectionId: r.kind === 'global' ? r.globalConnectionId : '' })), globalRevisions } }
}
export function copySharedProfiles(draft: RoutingDraft): RoutingDraft {
  return { ...draft, profiles: Object.fromEntries(Object.keys(modelTaskLabels).map(slot => [slot, { ...draft.profiles.shared }])) as RoutingDraft['profiles'] }
}
