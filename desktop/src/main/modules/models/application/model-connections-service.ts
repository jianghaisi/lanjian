import { AppError } from '../../../core/errors/app-error'
import {
  connectionRevision, decodeConnectionCreate, decodeConnectionUpdate, decodeConnectionRemove, globalConnectionId,
  nextConnectionRevision, MAX_GLOBAL_CONNECTIONS, effectiveRemoteModelProtocol,
  type GlobalConnectionRepository, type GlobalConnectionsView, type GlobalConnectionDocument,
  type ModelConnectionSecrets, type StoredGlobalConnection, type GlobalConnectionCommitGuard
} from '../domain/model-connections'
import { encryptModelConnectionKey, decryptModelConnectionKey, credentialUnavailable as unavailable } from './model-connection-secrets'

/** Main-process only; no book path, provider call, migration or public secret getter. */
export class ModelConnectionsService {
  constructor(
    private readonly repository: GlobalConnectionRepository,
    private readonly secrets: ModelConnectionSecrets,
    private readonly newId: () => string
  ) {}

  async list(): Promise<GlobalConnectionsView> {
    return this.view((await this.repository.read()).document)
  }

  async create(value: unknown, guard?: GlobalConnectionCommitGuard): Promise<GlobalConnectionsView> {
    const input = decodeConnectionCreate(value)
    guard?.assertActive()
    const snapshot = await this.repository.read()
    guard?.assertActive()
    this.checkRevision(snapshot.document.revision, input.expectedRevision)
    if (snapshot.document.connections.length >= MAX_GLOBAL_CONNECTIONS) {
      throw new AppError('VALIDATION_ERROR', '全局模型接口数量已达上限。', { recoverable: true })
    }
    const id = globalConnectionId(this.newId())
    if (snapshot.document.connections.some(c => c.id === id)) throw conflict()
    const connection: StoredGlobalConnection = { id, name: input.name, baseUrl: input.baseUrl, protocol: input.protocol, enabled: true, revision: 1 }
    if (input.apiKey !== undefined) connection.encryptedApiKey = encryptModelConnectionKey(this.secrets, input.apiKey)
    const committed = await this.repository.commit(snapshot, {
      ...snapshot.document, revision: nextConnectionRevision(snapshot.document.revision),
      connections: [...snapshot.document.connections, connection]
    }, guard)
    return this.view(committed.document)
  }

  async update(value: unknown, guard?: GlobalConnectionCommitGuard): Promise<GlobalConnectionsView> {
    const input = decodeConnectionUpdate(value)
    guard?.assertActive()
    const snapshot = await this.repository.read()
    guard?.assertActive()
    this.checkRevision(snapshot.document.revision, input.expectedRevision)
    const current = snapshot.document.connections.find(c => c.id === input.id)
    if (!current) throw missing()
    this.checkRevision(current.revision, input.connectionRevision)
    const next = { ...current }
    if (input.name !== undefined) next.name = input.name
    if (input.enabled !== undefined) next.enabled = input.enabled
    if (input.apiKey !== undefined) next.encryptedApiKey = encryptModelConnectionKey(this.secrets, input.apiKey)
    if (input.clearApiKey) delete next.encryptedApiKey
    if (next.name === current.name && next.enabled === current.enabled && next.encryptedApiKey === current.encryptedApiKey) {
      if (guard) { await guard.recheck(); guard.assertActive() }
      const latest = await this.repository.read()
      guard?.assertActive()
      if (latest.fingerprint !== snapshot.fingerprint) throw conflict()
      return this.view(snapshot.document)
    }
    next.revision = nextConnectionRevision(current.revision)
    const committed = await this.repository.commit(snapshot, {
      ...snapshot.document, revision: nextConnectionRevision(snapshot.document.revision),
      connections: snapshot.document.connections.map(c => c.id === next.id ? next : c)
    }, guard)
    return this.view(committed.document)
  }

  async remove(value: unknown, guard?: GlobalConnectionCommitGuard): Promise<GlobalConnectionsView> {
    const input = decodeConnectionRemove(value)
    guard?.assertActive()
    const snapshot = await this.repository.read()
    guard?.assertActive()
    this.checkRevision(snapshot.document.revision, input.expectedRevision)
    const current = snapshot.document.connections.find(c => c.id === input.id)
    if (!current) throw missing()
    this.checkRevision(current.revision, input.connectionRevision)
    const committed = await this.repository.commit(snapshot, {
      ...snapshot.document, revision: nextConnectionRevision(snapshot.document.revision),
      connections: snapshot.document.connections.filter(c => c.id !== input.id)
    }, guard)
    return this.view(committed.document)
  }

  /** Private provider capability, deliberately non-serializable and not part of IPC. */
  async prepareCredential(idValue: string, expectedConnectionRevision: number): Promise<{
    connectionId: string
    connectionName: string
    baseUrl: string
    protocol: import('../domain/model-connections').RemoteModelProtocol
    assertCurrent(): Promise<void>
    use<T>(send: (apiKey: string) => Promise<T>): Promise<T>
  }> {
    const id = globalConnectionId(idValue)
    connectionRevision(expectedConnectionRevision, 1)
    const snapshot = await this.repository.read()
    const connection = snapshot.document.connections.find(c => c.id === id)
    if (!connection) throw missing()
    this.checkRevision(connection.revision, expectedConnectionRevision)
    if (!connection.enabled || !connection.encryptedApiKey) throw unavailable()
    const retained = { ...connection }
    const assertCurrent = async () => {
      const current = (await this.repository.read()).document.connections.find(c => c.id === id)
      if (!current || !current.enabled || current.revision !== retained.revision
        || current.baseUrl !== retained.baseUrl || current.protocol !== retained.protocol
        || current.encryptedApiKey !== retained.encryptedApiKey) throw conflict()
    }
    return Object.freeze({
      connectionId: id, connectionName: retained.name, baseUrl: retained.baseUrl, protocol: effectiveRemoteModelProtocol(retained),
      assertCurrent,
      use: async <T>(send: (apiKey: string) => Promise<T>): Promise<T> => {
        await assertCurrent()
        let key = decryptModelConnectionKey(this.secrets, retained.encryptedApiKey!)
        try { return await send(key) } finally { key = '' }
      }
    })
  }

  private checkRevision(actual: number, expected: number): void {
    if (actual !== expected) throw conflict()
  }

  private view(document: GlobalConnectionDocument): GlobalConnectionsView {
    let available = false
    try { available = this.secrets.available() } catch { /* unavailable, never decrypt during listing */ }
    return { revision: document.revision, connections: document.connections.map(c => ({
      id: c.id, name: c.name, baseUrl: c.baseUrl, protocol: effectiveRemoteModelProtocol(c), enabled: c.enabled, revision: c.revision,
      credentialState: !c.encryptedApiKey ? 'missing' : available ? 'stored' : 'unavailable'
    })) }
  }
}

function conflict(): AppError { return new AppError('CONFLICT', '模型接口已变化，请刷新后重试。', { recoverable: true }) }
function missing(): AppError { return new AppError('NOT_FOUND', '模型接口已不存在，请重新选择。', { recoverable: true }) }
