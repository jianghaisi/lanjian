import { BOOK_MODEL_TASKS, bookModelSource, decodeBookModelSettings } from '../domain/book-model-settings'
import { AppError, isAppError } from '../../../core/errors/app-error'
import { applyBookModelAssignment, assignmentConflict, assignmentInvalid, type BookModelAssignmentWriter } from '../domain/book-model-assignments'
import type { BookModelRequestScope, BookModelSourceReader, GlobalModelCredentialReader } from '../domain/book-model-resolution'

/** Retained main-only edit capability. No current-book setter, secret or provider dependency. */
export class BookModelAssignments {
  constructor(private readonly books: BookModelSourceReader, private readonly writer: BookModelAssignmentWriter,
    private readonly globals: Pick<GlobalModelCredentialReader, 'list'>,
    private readonly currentScope: () => BookModelRequestScope | null) {}

  async read() {
    const current = this.currentScope()
    if (!current || !current.windowId || !current.bookRoot || !Number.isSafeInteger(current.generation) || current.generation < 0) throw assignmentConflict()
    const scope = { ...current }
    const assertActive = () => {
      const active = this.currentScope()
      if (!active || active.windowId !== scope.windowId || active.generation !== scope.generation || active.bookRoot !== scope.bookRoot) throw assignmentConflict()
    }
    const source = await this.books.capture(scope.bookRoot)
    assertActive()
    const baseline = decodeBookModelSettings(source.settings)
    let consumed = false
    return Object.freeze({
      settings: decodeBookModelSettings(baseline), revision: source.documentFingerprint,
      save: async (input: unknown) => {
        assertActive()
        if (consumed) throw assignmentConflict()
        const { settings, globalRevisions } = applyBookModelAssignment(baseline, input)
        const profiles = settings.routingMode === 'shared' ? [settings.shared] : BOOK_MODEL_TASKS.map(task => settings.tasks[task])
        const selected = new Set(profiles.map(p => bookModelSource(settings, p.connectionId)).flatMap(c => c.kind === 'global' ? [c.globalConnectionId] : []))
        // New attachments must be verified even if their profile is currently inactive.
        if (settings.version === 4) for (const c of settings.references) {
          if (c.kind === 'global' && (baseline.version !== 4 || !baseline.references.some(old => old.kind === 'global' && old.id === c.id && old.globalConnectionId === c.globalConnectionId))) selected.add(c.globalConnectionId)
        }
        if (globalRevisions.size !== selected.size || [...selected].some(id => !globalRevisions.has(id))) throw assignmentInvalid()
        let initial: Map<string, string> | undefined
        const referencesCurrent = async () => {
          if (!selected.size) return
          const view = await this.globals.list(), signatures = new Map<string, string>()
          assertActive()
          for (const id of selected) {
            const c = view.connections.find(c => c.id === id)
            if (!c || !c.enabled || c.revision !== globalRevisions.get(id)) throw assignmentConflict()
            signatures.set(id, JSON.stringify([c.id, c.name, c.baseUrl, c.revision, c.enabled]))
          }
          if (initial && [...signatures].some(([id, value]) => initial!.get(id) !== value)) throw assignmentConflict()
          initial = signatures
        }
        const assertEditable = () => { assertActive(); if (consumed) throw assignmentConflict() }
        const guard = { assertActive: assertEditable, recheck: async () => {
          assertEditable(); await source.assertCurrent(); assertEditable(); await referencesCurrent(); assertEditable()
        } }
        await guard.recheck()
        const committed = await this.writer.save(source, settings, guard).catch(error => {
          if (isAppError(error)) throw error
          throw new AppError('STORAGE_ERROR', '无法确认模型分配的保存结果，请重新读取当前作品后核对。', { recoverable: true })
        })
        consumed = true
        // Return the captured book's committed value, even if the UI has since switched.
        // Public integration must discard this result in a different window/book generation.
        return { settings: decodeBookModelSettings(JSON.parse(committed.content)), contentHash: committed.contentHash,
          revision: committed.revision, authority: committed.authority, mirrorStatus: committed.mirrorStatus,
          scope: { windowId: scope.windowId, generation: scope.generation, bookIdentity: source.sourceIdentity } }
      }
    })
  }
}
