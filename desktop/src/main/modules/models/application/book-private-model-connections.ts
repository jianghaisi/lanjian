import { AppError } from '../../../core/errors/app-error'
import { decodeBookModelSettings, referenceBookModelSettings } from '../domain/book-model-settings'
import { modelConnectionName } from '../domain/model-connections'
import type { BookModelSourceReader, BookModelRequestScope } from '../domain/book-model-resolution'
import type { BookModelAssignmentWriter } from '../domain/book-model-assignments'
import type { ModelRequestGuard } from '../domain/model-provider'

type KeyEditor = { preparePrivateModelKeys(root: string, ids: string[]): Promise<{ save(id: string, input: { apiKey?: string; clearApiKey?: boolean }, guard: ModelRequestGuard): Promise<boolean> }> }

/** Private metadata and credential edits are explicit, separately acknowledged operations. */
export class BookPrivateModelConnections {
  constructor(private readonly books: BookModelSourceReader, private readonly writer: BookModelAssignmentWriter,
    private readonly keys: KeyEditor, private readonly currentScope: () => BookModelRequestScope | null) {}

  async read() {
    const active = this.currentScope()
    if (!active) throw conflict()
    const scope = { ...active }, source = await this.books.capture(scope.bookRoot)
    const privateRefs = referenceBookModelSettings(source.settings).references.filter(r => r.kind === 'legacy-private')
    const keys = privateRefs.length ? await this.keys.preparePrivateModelKeys(source.bookRoot, privateRefs.map(r => r.originalConnectionId)) : undefined
    let consumed = false, busy = false
    const assertActive = () => {
      const current = this.currentScope()
      if (consumed || !current || current.windowId !== scope.windowId || current.generation !== scope.generation || current.bookRoot !== scope.bookRoot) throw conflict()
    }
    const guard = { assertActive, recheck: async () => { assertActive(); await source.assertCurrent(); assertActive() } }
    await guard.recheck()
    const perform = async <T>(id: string, operation: (originalId: string) => Promise<T>): Promise<T> => {
      assertActive()
      const ref = privateRefs.find(r => r.id === id)
      if (!ref || busy) throw conflict()
      busy = true
      try { await guard.recheck(); const value = await operation(ref.originalConnectionId); consumed = true; return value }
      finally { busy = false }
    }
    return { revision: source.documentFingerprint,
      rename: (id: string, value: string) => perform(id, async () => {
        const name = modelConnectionName(value), settings = decodeBookModelSettings(source.settings)
        if (settings.version === 4) settings.references = settings.references.map(r => r.id === id && r.kind === 'legacy-private' ? { ...r, name } : r)
        else settings.connections = settings.connections.map(c => c.id === id ? { ...c, name } : c)
        const saved = await this.writer.save(source, settings, guard)
        return { settings: decodeBookModelSettings(JSON.parse(saved.content)), authority: saved.authority, mirrorStatus: saved.mirrorStatus }
      }),
      saveKey: (id: string, input: { apiKey?: string; clearApiKey?: boolean }) => perform(id, originalId => { if (!keys) throw conflict(); return keys.save(originalId, input, guard) })
    }
  }
}
function conflict() { return new AppError('CONFLICT', '本书私有接口或操作已变化，请重新读取后保存。', { recoverable: true }) }
