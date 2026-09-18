import { AppError } from '../../../core/errors/app-error'
import { BOOK_MODEL_TASKS, decodeBookModelSettings, referenceBookModelSettings, type BookModelSettings } from './book-model-settings'
import type { BookModelSnapshot } from './book-model-resolution'
import { connectionRecord, connectionRevision, globalConnectionId } from './model-connections'
import type { ModelRequestGuard } from './model-provider'
import type { WorkspaceMirrorStatus } from '../../../core/ports/workspace-database'

export type BookModelAssignmentCommit = {
  content: string; contentHash: string; revision: number | null
  authority: 'files' | 'sqlite'; mirrorStatus: WorkspaceMirrorStatus | 'not-applicable'
}
export interface BookModelAssignmentWriter {
  save(source: BookModelSnapshot, settings: BookModelSettings, guard: ModelRequestGuard): Promise<BookModelAssignmentCommit>
}
export interface FormalBookModelAssignmentWriter {
  saveBookModelAssignment(source: BookModelSnapshot, content: string, guard: ModelRequestGuard): Promise<BookModelAssignmentCommit>
}

/** Profile patches and explicit global aliases only. No private CRUD, credentials or default revision override. */
export function applyBookModelAssignment(current: BookModelSettings, value: unknown): {
  settings: BookModelSettings; globalRevisions: Map<string, number>
} {
  try {
    const r = connectionRecord(value, ['routingMode', 'shared', 'tasks', 'globalReferences', 'globalRevisions'])
    if (!['routingMode', 'shared', 'tasks', 'globalReferences'].some(k => Object.hasOwn(r, k))) throw assignmentInvalid()
    const base = Object.hasOwn(r, 'globalReferences') ? referenceBookModelSettings(current) : current
    const fields = ['connectionId', 'model', 'temperature', 'topP', 'maxTokens']
    const tasks = Object.hasOwn(r, 'tasks') ? connectionRecord(r.tasks, BOOK_MODEL_TASKS) : {}
    let references: unknown = base.version === 4 ? base.references : undefined
    if (Object.hasOwn(r, 'globalReferences')) {
      if (!Array.isArray(r.globalReferences) || r.globalReferences.length > 100) throw assignmentInvalid()
      references = [...referenceBookModelSettings(current).references.filter(c => c.kind === 'legacy-private'),
        ...Array.from(r.globalReferences, value => {
          const c = connectionRecord(value, ['id', 'globalConnectionId'])
          return { kind: 'global' as const, id: c.id, globalConnectionId: globalConnectionId(c.globalConnectionId) }
        })]
    }
    const settings = decodeBookModelSettings({ ...base,
      ...(references ? { references } : {}),
      routingMode: Object.hasOwn(r, 'routingMode') ? r.routingMode : base.routingMode,
      shared: { ...base.shared, ...(Object.hasOwn(r, 'shared') ? connectionRecord(r.shared, fields) : {}) },
      tasks: Object.fromEntries(BOOK_MODEL_TASKS.map(task => [task, { ...base.tasks[task],
        ...(Object.hasOwn(tasks, task) ? connectionRecord(tasks[task], fields) : {}) }])) })
    const globalRevisions = new Map<string, number>()
    if (Object.hasOwn(r, 'globalRevisions')) {
      if (!Array.isArray(r.globalRevisions) || r.globalRevisions.length > 100) throw assignmentInvalid()
      for (const value of r.globalRevisions) {
        const c = connectionRecord(value, ['id', 'revision']), id = globalConnectionId(c.id)
        if (globalRevisions.has(id)) throw assignmentInvalid()
        globalRevisions.set(id, connectionRevision(c.revision, 1))
      }
    }
    return { settings, globalRevisions }
  } catch { throw assignmentInvalid() }
}
export function assignmentConflict(): AppError {
  return new AppError('CONFLICT', '作品或模型分配已变化，请重新读取后再保存；未覆盖其他分配。', { recoverable: true })
}
export function assignmentInvalid(): AppError {
  return new AppError('VALIDATION_ERROR', '作品模型分配格式无效，请检查选择和参数后重试。', { recoverable: true })
}
