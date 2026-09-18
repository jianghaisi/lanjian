import { AppError } from '../../../core/errors/app-error'
import { connectionReuseOperationId, decodeConnectionReuseReceipt, globalConnectionId, nextConnectionRevision,
  MAX_GLOBAL_CONNECTIONS, MAX_CONNECTION_REUSE_RECEIPTS, type ConnectionReuseReceipt,
  type GlobalConnectionRepository, type ModelConnectionSecrets, type StoredGlobalConnection } from '../domain/model-connections'
import { CONNECTION_REUSE_TTL_MS, decodeLegacyReusePreview, legacyReuseConflict,
  type LegacyConnectionSource, type LegacyConnectionSnapshot, type LegacyReusePreview,
  type LegacyReuseScope, type LegacyReuseResult } from '../domain/legacy-connection-reuse'
import { credentialUnavailable, decryptModelConnectionKey, encryptModelConnectionKey } from './model-connection-secrets'

type Retained = { token: string; scope: LegacyReuseScope; generation: number; expiresAt: number;
  expectedRevision: number; source: LegacyConnectionSnapshot }

/** One instance per authorized main window. No renderer path/key input; no book writes. */
export class LegacyConnectionReuseService {
  private generation = 0
  private retained?: Retained
  private pending?: { token: string; scope: LegacyReuseScope; generation: number; promise: Promise<LegacyReuseResult> }
  constructor(private readonly repository: GlobalConnectionRepository, private readonly source: LegacyConnectionSource,
    private readonly secrets: ModelConnectionSecrets, private readonly currentScope: () => LegacyReuseScope | null,
    private readonly newId: () => string, private readonly newToken: () => string, private readonly now: () => number = Date.now) {}

  cancel(): void { this.generation++; this.retained = undefined }

  async preview(value: unknown): Promise<LegacyReusePreview> {
    const input = decodeLegacyReusePreview(value)
    this.cancel()
    const generation = this.generation, scope = this.scope()
    const destination = await this.repository.read()
    if (destination.document.revision !== input.expectedRevision) throw legacyReuseConflict()
    this.checkCapacity(destination.document.connections.length, destination.document.reuseReceipts?.length ?? 0, input.selectedIds.length)
    const source = await this.source.capture(scope.bookRoot, input.selectedIds)
    this.assertScope(scope, generation)
    const token = connectionReuseOperationId(this.newToken())
    if (destination.document.reuseReceipts?.some(r => r.operationId === token)) throw legacyReuseConflict()
    const expiresAt = this.now() + CONNECTION_REUSE_TTL_MS
    this.retained = { token, scope, generation, source, expectedRevision: input.expectedRevision, expiresAt }
    let available = false
    try { available = this.secrets.available() } catch { /* presence only */ }
    return { token, expiresAt, expectedRevision: input.expectedRevision, connections: source.connections.map(c => ({
      sourceConnectionId: c.id, name: c.name, baseUrl: c.baseUrl,
      credentialState: !c.encryptedApiKey ? 'missing' : available ? 'stored' : 'unavailable'
    })) }
  }

  async receipt(tokenValue: unknown): Promise<LegacyReuseResult | null> {
    const token = connectionReuseOperationId(tokenValue), scope = this.scope(), generation = this.generation
    const identity = await this.source.identity(scope.bookRoot)
    const document = (await this.repository.read()).document
    if (await this.source.identity(scope.bookRoot) !== identity) throw legacyReuseConflict()
    this.assertScope(scope, generation)
    const receipt = document.reuseReceipts?.find(r => r.operationId === token && r.sourceIdentity === identity)
    return receipt ? result(receipt) : null
  }

  async confirm(tokenValue: unknown): Promise<LegacyReuseResult> {
    const token = connectionReuseOperationId(tokenValue)
    if (this.pending) {
      if (this.pending.token !== token) throw legacyReuseConflict()
      // A second caller must still belong to the retained source/window.
      this.assertScope(this.pending.scope, this.pending.generation)
      return structuredClone(await this.pending.promise)
    }
    const scope = this.scope(), generation = this.generation
    const promise = this.confirmNow(token)
    this.pending = { token, scope, generation, promise }
    try { return structuredClone(await promise) }
    finally { if (this.pending?.promise === promise) this.pending = undefined }
  }

  private async confirmNow(token: string): Promise<LegacyReuseResult> {
    const existing = await this.receipt(token)
    if (existing) return existing
    const retained = this.retained
    if (!retained || retained.token !== token) throw legacyReuseConflict()
    const guard = async () => {
      this.checkRetained(retained)
      await retained.source.assertCurrent()
      this.checkRetained(retained)
    }
    await guard()
    const snapshot = await this.repository.read()
    this.checkRetained(retained)
    if (snapshot.document.revision !== retained.expectedRevision) throw legacyReuseConflict()
    this.checkCapacity(snapshot.document.connections.length, snapshot.document.reuseReceipts?.length ?? 0, retained.source.connections.length)
    const ids = new Set(snapshot.document.connections.map(c => c.id))
    const connections: StoredGlobalConnection[] = retained.source.connections.map(c => {
      const id = globalConnectionId(this.newId())
      if (ids.has(id)) throw legacyReuseConflict()
      ids.add(id)
      if (!c.encryptedApiKey) throw credentialUnavailable()
      let key = decryptModelConnectionKey(this.secrets, c.encryptedApiKey)
      try { return { id, name: c.name, baseUrl: c.baseUrl, protocol: 'openai-compatible', enabled: true, revision: 1, encryptedApiKey: encryptModelConnectionKey(this.secrets, key) } }
      finally { key = '' }
    })
    const receipt = decodeConnectionReuseReceipt({ operationId: token, sourceIdentity: retained.source.sourceIdentity,
      sourceFingerprint: retained.source.sourceFingerprint, connectionIds: connections.map(c => c.id) })
    await this.repository.commit(snapshot, { ...snapshot.document, revision: nextConnectionRevision(snapshot.document.revision),
      connections: [...snapshot.document.connections, ...connections], reuseReceipts: [...(snapshot.document.reuseReceipts ?? []), receipt] },
    { recheck: guard, assertActive: () => this.checkRetained(retained) })
    if (this.retained === retained) this.retained = undefined
    return result(receipt)
  }

  private scope(): LegacyReuseScope {
    const scope = this.currentScope()
    if (!scope || !scope.windowId || !scope.bookRoot || !Number.isSafeInteger(scope.generation) || scope.generation < 0) throw legacyReuseConflict()
    return { ...scope }
  }
  private assertScope(expected: LegacyReuseScope, generation: number): void {
    const current = this.scope()
    if (this.generation !== generation || current.windowId !== expected.windowId || current.bookRoot !== expected.bookRoot
      || current.generation !== expected.generation) throw legacyReuseConflict()
  }
  private checkRetained(retained: Retained): void {
    this.assertScope(retained.scope, retained.generation)
    if (this.retained !== retained || this.now() >= retained.expiresAt) throw legacyReuseConflict()
  }
  private checkCapacity(count: number, receipts: number, added: number): void {
    if (count + added > MAX_GLOBAL_CONNECTIONS || receipts >= MAX_CONNECTION_REUSE_RECEIPTS) {
      throw new AppError('VALIDATION_ERROR', '全局接口或复用记录数量已达上限，无法加入本次选择。', { recoverable: true })
    }
  }
}

function result(receipt: ConnectionReuseReceipt): LegacyReuseResult {
  return { operationId: receipt.operationId, connectionIds: [...receipt.connectionIds] }
}
