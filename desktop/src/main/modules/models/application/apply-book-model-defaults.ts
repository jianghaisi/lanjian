import { AppError, isAppError } from '../../../core/errors/app-error'
import { assignmentConflict, type BookModelAssignmentWriter } from '../domain/book-model-assignments'
import { BOOK_MODEL_TASKS, decodeBookModelSettings, referenceBookModelSettings, type BookModelSettings } from '../domain/book-model-settings'
import type { BookModelRequestScope, BookModelSourceReader } from '../domain/book-model-resolution'
import type { NewBookModelDefaults } from './new-book-model-defaults'

/** One retained, expiring preview. Applying a default is distinct from editing the app template. */
export class ApplyBookModelDefaults {
  private pending?: { token: string; confirm: () => Promise<Awaited<ReturnType<BookModelAssignmentWriter['save']>>> }
  private generation = 0
  constructor(private readonly books: BookModelSourceReader, private readonly writer: BookModelAssignmentWriter,
    private readonly defaults: NewBookModelDefaults, private readonly scope: () => BookModelRequestScope | null,
    private readonly newToken: () => string, private readonly now: () => number = Date.now) {}

  cancel(): void { this.pending = undefined; this.generation++ }

  async preview(expectedBookRevision: string, expectedDefaultRevision: number) {
    this.cancel()
    const generation = this.generation, current = this.scope()
    if (!current) throw assignmentConflict()
    const scope = { ...current }, expiresAt = this.now() + 15 * 60_000
    const assertActive = () => {
      const active = this.scope()
      if (generation !== this.generation || this.now() >= expiresAt || !active || active.windowId !== scope.windowId
        || active.bookRoot !== scope.bookRoot || active.generation !== scope.generation) throw assignmentConflict()
    }
    const source = await this.books.capture(scope.bookRoot)
    assertActive()
    if (source.documentFingerprint !== expectedBookRevision) throw assignmentConflict()
    const prepared = await this.defaults.capture(expectedDefaultRevision, assertActive), copied = await prepared.copy()
    if (!copied) throw new AppError('VALIDATION_ERROR', '尚未保存新书默认分配，请先配置默认分配。', { recoverable: true })
    const previous = referenceBookModelSettings(source.settings)
    const privateReferences = previous.references.filter(r => r.kind === 'legacy-private')
    const occupied = new Set(privateReferences.map(r => r.id)), aliases = new Map<string, string>()
    const references = copied.references.map((r, i) => {
      let id = r.id, n = i
      while (occupied.has(id)) id = `default-${++n}`
      occupied.add(id); aliases.set(r.id, id)
      return { ...r, id }
    })
    const remap = (p: typeof copied.shared) => ({ ...p, connectionId: aliases.get(p.connectionId) ?? p.connectionId })
    const next = decodeBookModelSettings({ ...copied, version: source.settings.version === 5 ? 5 : copied.version, references: [...privateReferences, ...references],
      shared: remap(copied.shared), tasks: Object.fromEntries(BOOK_MODEL_TASKS.map(t => [t, remap(copied.tasks[t])])) })
    const guard = { assertActive, recheck: async () => { assertActive(); await source.assertCurrent(); await prepared.guard.recheck(); assertActive() } }
    await guard.recheck()
    const token = this.newToken()
    let busy = false
    this.pending = { token, confirm: async () => {
      assertActive()
      if (busy) throw assignmentConflict()
      busy = true
      try {
        await guard.recheck()
        const result = await this.writer.save(source, next, guard)
        this.cancel()
        return result
      } catch (error) {
        if (isAppError(error)) throw error
        throw new AppError('STORAGE_ERROR', '无法确认默认分配的应用结果，请重新读取本书配置后核对。', { recoverable: true })
      } finally { busy = false }
    } }
    return { token, expiresAt, bookRevision: source.documentFingerprint, defaultRevision: prepared.revision,
      before: decodeBookModelSettings(source.settings), after: decodeBookModelSettings(next),
      changes: profileChanges(source.settings, next) }
  }

  async confirm(token: string) {
    if (!this.pending || this.pending.token !== token) throw assignmentConflict()
    return this.pending.confirm()
  }
}

function profileChanges(before: BookModelSettings, after: BookModelSettings) {
  const result: Array<{ field: string; before: string; after: string }> = []
  if (before.routingMode !== after.routingMode) result.push({ field: 'routingMode', before: before.routingMode, after: after.routingMode })
  for (const slot of ['shared', ...BOOK_MODEL_TASKS] as const) {
    const a = slot === 'shared' ? before.shared : before.tasks[slot], b = slot === 'shared' ? after.shared : after.tasks[slot]
    for (const key of ['connectionId', 'model', 'temperature', 'topP', 'maxTokens', 'thinkingLevel', 'parameterPolicy'] as const) {
      const previous = key === 'thinkingLevel' ? a[key] ?? 'default' : a[key]
      const next = key === 'thinkingLevel' ? b[key] ?? 'default' : b[key]
      if (JSON.stringify(previous) !== JSON.stringify(next)) result.push({ field: `${slot}.${key}`, before: previous === undefined ? '自动 / 未设置' : typeof previous === 'object' ? JSON.stringify(previous) : String(previous), after: next === undefined ? '自动 / 未设置' : typeof next === 'object' ? JSON.stringify(next) : String(next) })
    }
  }
  return result
}
