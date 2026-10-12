import { AppError } from '../core/app-error'
import { isReferencedBookSettings, BOOK_MODEL_TASKS, MAX_BOOK_MODEL_REFERENCES, decodeBookModelSettings, type BookModelRouting, type ReferencedBookModelSettings } from './book-model-settings'
import { connectionRecord, connectionRevision, nextConnectionRevision } from './model-connection-values'

export type ModelDefaultTemplate = BookModelRouting & {
  version: 4 | 5; references: Array<{ kind: 'global'; id: string; globalConnectionId: string }>
}
export type StoredModelDefaults = { revision: number; template: ModelDefaultTemplate | null }
export type ModelDefaultsSave = { expectedRevision: number; expectedCatalogRevision: number; template: ModelDefaultTemplate | null }
export type ModelDefaultBudgetValidator = (settings: ReferencedBookModelSettings) => void

/** A portable template contains selections only, never private aliases or machine diagnostics. */
export function decodeModelDefaultTemplate(value: unknown): ModelDefaultTemplate {
  try {
    const r = connectionRecord(value, ['version', 'references', 'routingMode', 'shared', 'tasks'])
    if ((r.version !== 4 && r.version !== 5) || !Array.isArray(r.references) || r.references.length > MAX_BOOK_MODEL_REFERENCES) throw defaultsInvalid()
    for (const item of r.references) {
      const ref = connectionRecord(item, ['kind', 'id', 'globalConnectionId'])
      if (ref.kind !== 'global') throw defaultsInvalid()
    }
    const settings = decodeBookModelSettings(r)
    if (!isReferencedBookSettings(settings)) throw defaultsInvalid()
    const used = new Set([settings.shared, ...BOOK_MODEL_TASKS.map(t => settings.tasks[t])].map(p => p.connectionId))
    const references = settings.references.map(ref => {
      if (ref.kind !== 'global' || !used.has(ref.id)) throw defaultsInvalid()
      return { kind: 'global' as const, id: ref.id, globalConnectionId: ref.globalConnectionId }
    })
    return { version: settings.version, references, routingMode: settings.routingMode, shared: settings.shared, tasks: settings.tasks }
  } catch { throw defaultsInvalid() }
}

export function decodeStoredModelDefaults(value: unknown, catalogRevision: number): StoredModelDefaults {
  const r = connectionRecord(value, ['revision', 'template'])
  const revision = connectionRevision(r.revision, 1)
  if (revision > catalogRevision) throw defaultsInvalid()
  return { revision, template: r.template === null ? null : decodeModelDefaultTemplate(r.template) }
}

export function decodeModelDefaultsSave(value: unknown): ModelDefaultsSave {
  try {
    const r = connectionRecord(value, ['expectedRevision', 'expectedCatalogRevision', 'template'])
    return { expectedRevision: connectionRevision(r.expectedRevision), expectedCatalogRevision: connectionRevision(r.expectedCatalogRevision),
      template: r.template === null ? null : decodeModelDefaultTemplate(r.template) }
  } catch { throw defaultsInvalid() }
}

export function assertModelDefaultsTransition(before: StoredModelDefaults | undefined, after: StoredModelDefaults | undefined): void {
  if (!before && !after) return
  if (!after) throw defaultsInvalid() // Clearing retains its revision tombstone.
  const changed = JSON.stringify(before?.template ?? null) !== JSON.stringify(after.template)
  if (!before && !changed) throw defaultsInvalid() // An absent clear is a no-op.
  const revision = before?.revision ?? 0
  if (after.revision !== (changed ? nextConnectionRevision(revision) : revision)) throw defaultsInvalid()
}

export function defaultsInvalid(): AppError {
  return new AppError('VALIDATION_ERROR', '新书默认模型分配格式无效，请检查接口选择和参数。', { recoverable: true })
}
export function defaultsConflict(): AppError {
  return new AppError('CONFLICT', '默认分配、所选接口或操作范围已变化，请刷新预览后重试。', { recoverable: true })
}
