import { AppError } from '../../../core/errors/app-error'
import { BOOK_MODEL_TASKS, bookModelSource } from '../domain/book-model-settings'
import { bookModelRequestConflict, type BookModelRequestScope, type BookModelSourceReader,
  type GlobalModelCredentialReader, type PrivateModelCredentialReader } from '../domain/book-model-resolution'
import { globalConnectionId, type ModelConnectionSecrets } from '../domain/model-connections'
import type { ModelRequestGuard, ModelSettingsResolver, ResolvedModelConnection } from '../domain/model-provider'
import type { AiTask, ModelProfile } from '../../../../contracts/index'
import { credentialUnavailable, decryptModelConnectionKey } from './model-connection-secrets'
import type { ModelCatalogEntry } from '../../../../contracts/models/model-catalog-metadata'

/** Read-only, main-process composition. No current-book writes, defaults or public key getter. */
export class BookModelResolver implements ModelSettingsResolver {
  constructor(
    private readonly books: BookModelSourceReader,
    private readonly privateKeys: PrivateModelCredentialReader,
    private readonly globals: GlobalModelCredentialReader,
    private readonly secrets: ModelConnectionSecrets,
    private readonly currentScope: () => BookModelRequestScope | null,
    private readonly catalogEntries?: (id: string, revision: number) => ModelCatalogEntry[] | undefined
  ) {}

  async resolve(task: AiTask, connectionIdOverride?: string): Promise<ResolvedModelConnection & { profile: ModelProfile }> {
    if (!BOOK_MODEL_TASKS.includes(task)) throw new AppError('VALIDATION_ERROR', '模型任务类型无效。', { recoverable: true })
    const active = this.currentScope()
    if (!active || !active.windowId || !Number.isSafeInteger(active.generation) || active.generation < 0 || !active.bookRoot) throw bookModelRequestConflict()
    const scope = { ...active }
    const assertActive = () => {
      const current = this.currentScope()
      if (!current || current.windowId !== scope.windowId || current.generation !== scope.generation || current.bookRoot !== scope.bookRoot) throw bookModelRequestConflict()
    }
    const snapshot = await this.books.capture(scope.bookRoot)
    assertActive()
    const settings = snapshot.settings
    const selected = settings.routingMode === 'shared' ? settings.shared : settings.tasks[task]
    // A colon-prefixed one-off choice is explicit and cannot collide with a book alias.
    const source = connectionIdOverride?.startsWith('global:')
      ? { kind: 'global' as const, id: connectionIdOverride, globalConnectionId: globalConnectionId(connectionIdOverride.slice(7)) }
      : bookModelSource(settings, connectionIdOverride ?? selected.connectionId)
    const profile = Object.freeze({ ...structuredClone(selected), connectionId: source.id })
    const guard = (credentialCheck?: () => Promise<void>): ModelRequestGuard => Object.freeze({
      assertActive,
      recheck: async () => {
        assertActive()
        await snapshot.assertCurrent()
        assertActive()
        if (credentialCheck) await credentialCheck()
        assertActive()
      }
    })
    if (source.kind === 'local') {
      return Object.freeze({ kind: 'local', connectionId: source.id, connectionName: '本地推理', profile, requestGuard: guard() })
    }
    if (source.kind === 'legacy-private') {
      const credential = await this.privateKeys.capture(snapshot.bookRoot, source.originalConnectionId)
      const requestGuard = guard(credential.assertCurrent)
      await requestGuard.recheck()
      assertActive()
      const apiKey = decryptModelConnectionKey(this.secrets, credential.encryptedApiKey)
      return Object.freeze({ kind: 'openai-compatible', connectionId: source.id, connectionName: source.name,
        baseUrl: source.baseUrl, apiKey, profile, requestGuard })
    }
    const view = await this.globals.list()
    assertActive()
    const connection = view.connections.find(c => c.id === source.globalConnectionId)
    if (!connection) throw new AppError('NOT_FOUND', '引用的全局模型接口已不存在，请重新分配。', { recoverable: true })
    if (!connection.enabled || connection.credentialState !== 'stored') throw credentialUnavailable()
    const credential = await this.globals.prepareCredential(connection.id, connection.revision)
    const requestGuard = guard(credential.assertCurrent)
    await requestGuard.recheck()
    return credential.use(async apiKey => {
      assertActive()
      return Object.freeze({ kind: credential.protocol, connectionId: source.id, connectionName: credential.connectionName,
        baseUrl: credential.baseUrl, apiKey, profile, requestGuard, catalogEntries: structuredClone(this.catalogEntries?.(connection.id, connection.revision)) })
    })
  }

  async resolveConnection(connectionId: string): Promise<ResolvedModelConnection> {
    // Explicit book aliases do not require the unused default's remote credentials.
    return this.resolve('prose', connectionId)
  }
}
