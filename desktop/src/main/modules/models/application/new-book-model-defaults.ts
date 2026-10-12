import { isReferencedBookSettings } from '../../../../contracts/models/book-model-settings'
import { validateBookParameters, type CatalogMetadataReader } from '../domain/validate-book-parameters'
import { AppError, isAppError } from '../../../core/errors/app-error'
import { decodeBookModelSettings, type ReferencedBookModelSettings } from '../domain/book-model-settings'
import { connectionRevision, nextConnectionRevision, type GlobalConnectionDocument, type GlobalConnectionRepository,
  type GlobalConnectionCommitGuard } from '../domain/model-connections'
import { decodeModelDefaultTemplate, decodeModelDefaultsSave, defaultsConflict, type ModelDefaultTemplate,
  type ModelDefaultBudgetValidator } from '../domain/new-book-model-defaults'

/** App-scoped template authority. No current book, filesystem, key codec or provider access. */
export class NewBookModelDefaults {
  constructor(private readonly repository: GlobalConnectionRepository, private readonly validateBudgets: ModelDefaultBudgetValidator, private readonly metadata?: CatalogMetadataReader) {}

  async get() { return this.view((await this.repository.read()).document) }

  async save(value: unknown, guard?: GlobalConnectionCommitGuard) {
    const input = decodeModelDefaultsSave(value)
    if (input.template) this.checkBudgets(input.template)
    guard?.assertActive()
    const snapshot = await this.repository.read()
    guard?.assertActive()
    const current = snapshot.document.newBookDefaults
    if (input.expectedCatalogRevision !== snapshot.document.revision || input.expectedRevision !== (current?.revision ?? 0)) throw defaultsConflict()
    this.selected(snapshot.document, input.template)
    if (guard) { await guard.recheck(); guard.assertActive() }
    if (JSON.stringify(current?.template ?? null) === JSON.stringify(input.template)) {
      const latest = await this.repository.read()
      guard?.assertActive()
      if (latest.fingerprint !== snapshot.fingerprint || latest.document.revision !== snapshot.document.revision) throw defaultsConflict()
      return this.view(latest.document)
    }
    const next = { ...snapshot.document, revision: nextConnectionRevision(snapshot.document.revision),
      newBookDefaults: { revision: nextConnectionRevision(current?.revision ?? 0), template: input.template } }
    const committed = await this.repository.commit(snapshot, next, guard).catch(error => {
      if (isAppError(error)) throw error
      throw new AppError('STORAGE_ERROR', '无法确认默认分配的保存结果，请重新读取后核对。', { recoverable: true })
    })
    return this.view(committed.document)
  }

  /** Private creation capability. Future initializer must recheck again at publication. */
  async capture(expectedRevision: number, assertActive: () => void) {
    connectionRevision(expectedRevision)
    assertActive()
    const snapshot = await this.repository.read()
    assertActive()
    const revision = snapshot.document.newBookDefaults?.revision ?? 0
    if (revision !== expectedRevision) throw defaultsConflict()
    const template = snapshot.document.newBookDefaults?.template ?? null
    if (template) this.checkBudgets(template)
    const templateStamp = JSON.stringify(snapshot.document.newBookDefaults ?? null)
    const selectedStamp = this.selected(snapshot.document, template)
    const recheck = async () => {
      assertActive()
      const current = (await this.repository.read()).document
      assertActive()
      if (JSON.stringify(current.newBookDefaults ?? null) !== templateStamp || this.selected(current, template) !== selectedStamp) throw defaultsConflict()
    }
    return Object.freeze({ revision, summary: this.view(snapshot.document),
      guard: Object.freeze({ recheck, assertActive }),
      copy: async (): Promise<ReferencedBookModelSettings | null> => {
        await recheck()
        if (!template) return null // Explicit unconfigured result, never a manufactured cloud profile.
        const settings = decodeBookModelSettings({ ...template, defaultRevision: revision })
        if (!isReferencedBookSettings(settings)) throw defaultsConflict()
        return settings
      }
    })
  }

  private checkBudgets(template: ModelDefaultTemplate): void {
    // Validate all five copied slots, including those inactive in the chosen routing mode.
    this.validateBudgets({ ...template, routingMode: 'shared' })
    this.validateBudgets({ ...template, routingMode: 'perTask' })
  }

  private selected(document: GlobalConnectionDocument, template: ModelDefaultTemplate | null): string {
    if (template) validateBookParameters(template, document.connections, this.metadata)
    const ids = [...new Set(template?.references.map(r => r.globalConnectionId) ?? [])].sort()
    return JSON.stringify(ids.map(id => {
      const c = document.connections.find(c => c.id === id)
      if (!c || !c.enabled) throw defaultsConflict()
      return [c.id, c.name, c.baseUrl, c.enabled, c.revision]
    }))
  }

  private view(document: GlobalConnectionDocument) {
    const template = document.newBookDefaults?.template ?? null
    return { revision: document.newBookDefaults?.revision ?? 0, catalogRevision: document.revision,
      template: template ? decodeModelDefaultTemplate(template) : null,
      references: [...new Set(template?.references.map(r => r.globalConnectionId) ?? [])].map(id => {
        const c = document.connections.find(c => c.id === id)
        return { id, state: !c ? 'missing' as const : c.enabled ? 'enabled' as const : 'disabled' as const,
          ...(c ? { name: c.name, baseUrl: c.baseUrl, revision: c.revision } : {}) }
      }) }
  }
}
