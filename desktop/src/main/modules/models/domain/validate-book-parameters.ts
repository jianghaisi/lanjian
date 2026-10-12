import { BOOK_MODEL_TASKS, bookModelSource, type BookModelSettings } from './book-model-settings'
import { compileGeneration } from '../../../../contracts/models/generation-parameters'
import type { ModelCatalogEntry } from '../../../../contracts/models/model-catalog-metadata'

export type CatalogMetadataReader = (id: string, revision: number) => ModelCatalogEntry[] | undefined
/** Untouched inactive intent can survive an unavailable source; activation or editing must revalidate it. */
export function bookParameterValidationSlots(settings: BookModelSettings, baseline?: BookModelSettings) {
  return (['shared', ...BOOK_MODEL_TASKS] as const).filter(slot => {
    if (!baseline || (slot === 'shared') === (settings.routingMode === 'shared')) return true
    const p = slot === 'shared' ? settings.shared : settings.tasks[slot]
    const before = slot === 'shared' ? baseline.shared : baseline.tasks[slot]
    const source = bookModelSource(settings, p.connectionId), original = bookModelSource(baseline, before.connectionId)
    return JSON.stringify(p) !== JSON.stringify(before)
      || source.kind !== original.kind
      || (source.kind === 'global' && original.kind === 'global' && source.globalConnectionId !== original.globalConnectionId)
      || (source.kind === 'legacy-private' && original.kind === 'legacy-private' && (source.originalConnectionId !== original.originalConnectionId || source.baseUrl !== original.baseUrl))
  })
}
export function validateBookParameters(settings: BookModelSettings, connections: Array<{ id: string; baseUrl: string; revision: number; protocol?: 'openai-compatible' | 'gemini-native' | 'anthropic-native' | 'openai-responses' }>, metadata?: CatalogMetadataReader, baseline?: BookModelSettings) {
  for (const slot of bookParameterValidationSlots(settings, baseline)) {
    const p = slot === 'shared' ? settings.shared : settings.tasks[slot]
    if (!p.parameterPolicy) continue // Explicit legacy values remain lossless until changed.
    const source = bookModelSource(settings, p.connectionId)
    if (source.kind === 'local') continue // Manifest validation belongs to the injected budget validator.
    const c = source.kind === 'global' ? connections.find(c => c.id === source.globalConnectionId) : undefined
    if (source.kind === 'global' && !c) continue // Source owner reports missing/disabled references.
    const entry = c ? metadata?.(c.id, c.revision)?.find(e => e.id === p.model) : undefined
    // Shared intent must fit every task's automatic budget, including the smaller chapter/review limits.
    for (const task of slot === 'shared' ? BOOK_MODEL_TASKS : [slot]) {
      compileGeneration(p, task, { protocol: c?.protocol ?? 'openai-compatible', baseUrl: c?.baseUrl ?? (source.kind === 'legacy-private' ? source.baseUrl : ''), model: p.model,
        metadata: entry })
    }
  }
}
