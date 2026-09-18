import { AppError } from '../../../core/errors/app-error'
import { BOOK_MODEL_TASKS, decodeBookModelSettings, referenceBookModelSettings, type BookModelSettings } from '../domain/book-model-settings'
import type { BookModelRequestScope, BookModelSourceReader, PrivateModelCredentialReader } from '../domain/book-model-resolution'
import type { LocalTextProvider, ModelSettingsResolver } from '../domain/model-provider'
import type { ModelConnectionsService } from './model-connections-service'
import type { BookModelAssignments } from './book-model-assignments'
import { LOCAL_CONNECTION_ID } from '../../../../contracts/models/local-model-contracts'
import type { AiSettings, AiSettingsUpdate, AiTask, AiProviderConnection } from '../../../../contracts/index'

/** Production safe projection and retained profile edits. No legacy bulk writer or credential export. */
export class BookModelsService implements ModelSettingsResolver {
  constructor(private readonly books: BookModelSourceReader, private readonly keys: PrivateModelCredentialReader,
    private readonly globals: ModelConnectionsService, private readonly assignments: BookModelAssignments,
    private readonly resolver: ModelSettingsResolver, private readonly ensureScope: () => Promise<BookModelRequestScope>,
    private readonly currentScope: () => BookModelRequestScope | null,
    private readonly local?: Pick<LocalTextProvider, 'ready'>, private readonly credentialAvailable: () => boolean = () => true) {}

  async read() {
    const scope = await this.ensureScope(), edit = await this.assignments.read()
    this.checkScope(scope)
    return { edit, scope }
  }

  async get(): Promise<AiSettings> {
    const scope = await this.ensureScope(), source = await this.books.capture(scope.bookRoot)
    const result = await this.project(source.settings, scope.bookRoot)
    this.checkScope(scope)
    return result
  }

  async captureView(expectedRoot: string) {
    const scope = await this.ensureScope()
    if (scope.bookRoot !== expectedRoot) throw new AppError('CONFLICT', '作品已变化，请重试。', { recoverable: true })
    const source = await this.books.capture(scope.bookRoot), settings = await this.project(source.settings, scope.bookRoot)
    const guard = { assertActive: () => this.checkScope(scope), recheck: async () => { this.checkScope(scope); await source.assertCurrent(); this.checkScope(scope) } }
    await guard.recheck()
    return { settings, document: source.settings, guard }
  }

  async update(input: AiSettingsUpdate): Promise<AiSettings> {
    // Retired bulk UI cannot accidentally rewrite a shared endpoint/key through book settings.
    if (['connections', 'removeConnectionIds', 'baseUrl', 'apiKey', 'clearApiKey'].some(k => Object.hasOwn(input, k))) {
      throw new AppError('VALIDATION_ERROR', '接口请在“全局模型接口”或本书私有接口中单独保存；作品保存只修改本书模型分配。', { recoverable: true })
    }
    const { edit, scope } = await this.read()
    const current = edit.settings
    const patched = decodeBookModelSettings({ ...current, routingMode: input.routingMode ?? current.routingMode,
      shared: { ...current.shared, ...input.shared }, tasks: Object.fromEntries(BOOK_MODEL_TASKS.map(t => [t, { ...current.tasks[t], ...input.tasks?.[t] }])) })
    const active = patched.routingMode === 'shared' ? [patched.shared] : BOOK_MODEL_TASKS.map(t => patched.tasks[t])
    const selected = new Set(active.flatMap(p => referenceBookModelSettings(patched).references.filter(r => r.kind === 'global' && r.id === p.connectionId).map(r => r.kind === 'global' ? r.globalConnectionId : '')))
    const catalog = selected.size ? await this.globals.list() : undefined
    const globalRevisions = [...selected].map(id => {
      const connection = catalog?.connections.find(c => c.id === id)
      if (!connection) throw new AppError('CONFLICT', '全局接口不可用，请重新分配。', { recoverable: true })
      return { id, revision: connection.revision }
    })
    const result = await edit.save({ ...input, globalRevisions })
    const projected = await this.project(result.settings, scope.bookRoot)
    this.checkScope(scope)
    return projected
  }

  async resolve(task: AiTask, connectionId?: string) { await this.ensureScope(); return this.resolver.resolve(task, connectionId) }
  async resolveConnection(id: string) { await this.ensureScope(); return this.resolver.resolveConnection(id) }

  private checkScope(scope: BookModelRequestScope) {
    const active = this.currentScope()
    if (!active || active.bookRoot !== scope.bookRoot || active.generation !== scope.generation || active.windowId !== scope.windowId) throw new AppError('CONFLICT', '作品已切换，请重新读取模型分配。', { recoverable: true })
  }

  private async project(settings: BookModelSettings, root: string): Promise<AiSettings> {
    const references = referenceBookModelSettings(settings).references
    const catalog = references.some(r => r.kind === 'global') ? await this.globals.list() : undefined
    const connections: AiProviderConnection[] = await Promise.all(references.map(async r => {
      if (r.kind === 'global') {
        const c = catalog?.connections.find(c => c.id === r.globalConnectionId)
        return { kind: c?.protocol ?? 'openai-compatible' as const, id: r.id, name: c?.name ?? r.lastKnownName ?? '缺失的全局接口', baseUrl: c?.baseUrl ?? '',
          scope: 'global' as const, globalConnectionId: r.globalConnectionId, enabled: c?.enabled ?? false,
          apiKeyConfigured: Boolean(c?.enabled && c.credentialState === 'stored') }
      }
      let configured = false
      try { await this.keys.capture(root, r.originalConnectionId); configured = this.credentialAvailable() }
      catch (error) { if (!(error instanceof AppError) || error.code !== 'FEATURE_UNAVAILABLE') throw error }
      return { kind: 'openai-compatible' as const, id: r.id, name: r.name, baseUrl: r.baseUrl, scope: 'legacy-private' as const, apiKeyConfigured: configured }
    }))
    if (this.local) connections.push({ kind: 'local', id: LOCAL_CONNECTION_ID, name: '本地推理', runtimeId: 'llama-cpp-python' })
    const active = settings.routingMode === 'shared' ? [settings.shared] : BOOK_MODEL_TASKS.map(t => settings.tasks[t])
    const keyConfigured = (id: string) => connections.some(c => c.id === id && c.apiKeyConfigured)
    return { version: settings.version, routingMode: settings.routingMode, shared: { ...settings.shared },
      tasks: structuredClone(settings.tasks), connections, apiKeyConfigured: active.every(p => keyConfigured(p.connectionId)),
      modelConfigured: (await Promise.all(active.map(p => p.connectionId === LOCAL_CONNECTION_ID ? this.local?.ready(p.model) ?? false : keyConfigured(p.connectionId)))).every(Boolean) }
  }
}
