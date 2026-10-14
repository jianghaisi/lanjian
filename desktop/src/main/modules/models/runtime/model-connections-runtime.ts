import { groupModelPorts } from '../application/creation-team-models'
import { decodeCatalogSnapshot, type ModelCatalogSnapshot } from '../../../../contracts/models/model-catalog-metadata'
import type { ModelProfile } from '../../../../contracts/models/types'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { randomUUID, createHash } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import type { BookModelRequestScope } from '../domain/book-model-resolution'
import type { ModelConnectionSecrets } from '../domain/model-connections'
import type { LocalTextProvider } from '../domain/model-provider'
import { ModelConnectionsService } from '../application/model-connections-service'
import { NewBookModelDefaults } from '../application/new-book-model-defaults'
import { BookModelAssignments } from '../application/book-model-assignments'
import { BookModelResolver } from '../application/book-model-resolver'
import { ApplyBookModelDefaults } from '../application/apply-book-model-defaults'
import { LegacyConnectionReuseService } from '../application/legacy-connection-reuse'
import { BookPrivateModelConnections } from '../application/book-private-model-connections'
import { SettingsStore } from '../../../platform/settings/settings-store'
import type { WorkspaceWriteCoordinator } from '../../../core/application/workspace-write-coordinator'
import { ModelConnectionsStore } from '../adapters/model-connections-store'
import { FileBookModelSource } from '../adapters/book-model-source'
import { FilePrivateModelCredentials } from '../adapters/private-model-credentials'
import { FileLegacyConnectionSource } from '../adapters/legacy-connection-source'
import { BookModelAssignmentStore } from '../adapters/book-model-assignment-store'
import { bookModelConfigInputs } from '../adapters/book-model-configs'
import { modelConnectionArgs, modelConnectionResults, decodeModelCreationResult, type ModelProbe, type ModelCatalogQuery, type BookModelsSaved } from '../../../../contracts/models/model-connections-contracts'
import { decodeProjectCreateArgs, toAppErrorDto } from '../../../../contracts/ipc'
import { projectSummary } from '../../../../contracts/app/ipc-project-result-contracts'
import { AiClient } from '../application/ai-client'
import { compileRemoteConfig } from '../domain/generation-config'
import { BookModelsService } from '../application/book-models-service'
import type { ProjectService } from '../../library/application/project-service'
import type { SqliteManuscriptService } from '../../manuscript/application/sqlite-manuscript-service'

export function registerModelConnections(ipc: IpcMain, globalModelRoot: string, userData: string, secrets: ModelConnectionSecrets,
  projects: ProjectService, formal: SqliteManuscriptService, writes: WorkspaceWriteCoordinator, local: LocalTextProvider,
  change: <T>(operation: () => Promise<T>, preserveCreation?: boolean) => Promise<T>, settings: SettingsStore,
  profileSecrets: ModelConnectionSecrets = secrets, onLeaveBook: () => void = () => {}) {
  const repository = new ModelConnectionsStore(globalModelRoot), globals = new ModelConnectionsService(repository, secrets, () => `global-${randomUUID()}`)
  const modelCatalogs = new Map<string, ModelCatalogSnapshot>()
  const cachedEntries = (id: string, revision: number) => { const c = modelCatalogs.get(id); return c?.revision === revision ? c.entries : undefined }
  const defaults = new NewBookModelDefaults(repository, bookModelConfigInputs, cachedEntries), books = new FileBookModelSource(), keys = new FilePrivateModelCredentials(userData)
  let owner: number | null = null, generation = 0, bookRoot: string | null = null, changing = false, creationEpoch = 0, bookOpen = true
  const scope = (): BookModelRequestScope | null => {
    const execution = projects.executionIdentity
    if (execution && owner !== null) return { windowId: String(owner), generation: 0, bookRoot: execution.root }
    return owner !== null && bookRoot && !changing ? { windowId: String(owner), generation, bookRoot } : null
  }
  const ensureScope = async (): Promise<BookModelRequestScope> => {
    if (projects.executionIdentity) {
      await projects.currentPath()
      const captured = scope()
      if (!captured) throw conflict()
      return captured
    }
    if (owner === null || changing || !bookOpen) throw conflict()
    const observed = generation, windowId = owner, root = await projects.currentPath()
    if (observed !== generation || owner !== windowId || changing) throw conflict()
    if (bookRoot !== null && bookRoot !== root) { generation++; reuse.cancel(); application.cancel(); edit = undefined }
    bookRoot = root
    return scope()!
  }
  const writer = new BookModelAssignmentStore(formal, writes), assignments = new BookModelAssignments(books, writer, globals, scope, cachedEntries)
  const privateConnections = new BookPrivateModelConnections(books, writer, settings, scope)
  const resolver = new BookModelResolver(books, keys, globals, profileSecrets, scope, cachedEntries)
  const projectAi = new BookModelsService(books, keys, globals, assignments, resolver, ensureScope, scope, local, () => profileSecrets.available())
  const application = new ApplyBookModelDefaults(books, writer, defaults, scope, randomUUID)
  const reuse = new LegacyConnectionReuseService(repository, new FileLegacyConnectionSource(userData), profileSecrets, scope, () => `global-${randomUUID()}`, () => `reuse-${randomUUID()}`)
  let edit: { token: string; expiresAt: number; capability: Awaited<ReturnType<BookModelAssignments['read']>>; privateEdit: Awaited<ReturnType<BookPrivateModelConnections['read']>> } | undefined
  let creation: { token: string; withoutDefaults: boolean; prepared: Awaited<ReturnType<NewBookModelDefaults['capture']>>; assertActive: () => void } | undefined
  let probeController: AbortController | undefined
  const cancelPreviews = () => { application.cancel(); reuse.cancel(); edit = undefined; creation = undefined; creationEpoch++; return true }
  const windowGuard = () => { const captured = owner; const assertActive = () => { if (captured === null || owner !== captured) throw conflict() }; return { assertActive, recheck: async () => assertActive() } }
  const safeSaved = (settings: BookModelsSaved['settings'], result: { authority: BookModelsSaved['authority']; mirrorStatus: BookModelsSaved['mirrorStatus'] }): BookModelsSaved => ({ settings, authority: result.authority, mirrorStatus: result.mirrorStatus })
  const probe = async (input: ModelCatalogQuery & Pick<ModelProbe, 'thinkingLevel' | 'parameterPolicy'>, catalogOnly: boolean) => {
    if (catalogOnly) modelCatalogs.delete(input.id)
    probeController?.abort()
    const controller = new AbortController(); probeController = controller
    const windowId = owner, credential = await globals.prepareCredential(input.id, input.revision)
    const assertActive = () => { controller.signal.throwIfAborted(); if (owner === null || owner !== windowId) throw conflict() }
    const guard = { assertActive, recheck: async () => { assertActive(); await credential.assertCurrent(); assertActive() } }
    const value = await credential.use(async apiKey => {
      const parameterPolicy = input.parameterPolicy ?? (input.thinkingLevel === undefined ? { version: 1 as const, mode: 'auto' as const } : undefined)
      const profile: ModelProfile = parameterPolicy ? { connectionId: input.id, model: input.model ?? '', parameterPolicy } : { connectionId: input.id, model: input.model ?? '', temperature: 0, topP: 1, maxTokens: credential.protocol === 'gemini-native' ? 8192 : 128, thinkingLevel: input.thinkingLevel }
      const resolved = { kind: credential.protocol, connectionId: input.id, connectionName: credential.connectionName,
          baseUrl: credential.baseUrl, apiKey, requestGuard: guard, profile, catalogEntries: cachedEntries(input.id, input.revision) }
      const probeConfig = catalogOnly ? resolved : { ...resolved, generation: compileRemoteConfig(resolved, 'prose', undefined, 'probe').generation }
      const ai = new AiClient({ resolve: async () => probeConfig, resolveConnection: async () => probeConfig })
      if (catalogOnly) {
        const result = await ai.listCatalog({ connectionId: input.id }, controller.signal)
        assertActive()
        if (result.models.length > 2000 || result.models.some(m => typeof m !== 'string' || !m || m.length > 500 || /[\u0000-\u001f\u007f]/.test(m) || (apiKey && m.includes(apiKey)))) {
          throw new AppError('AI_RESPONSE_INVALID', '接口返回的模型列表无效，请检查接口后重新获取。', { recoverable: true })
        }
        const entries = 'entries' in result ? result.entries : result.models.map(id => ({ id }))
        if (apiKey && JSON.stringify(entries).includes(apiKey)) throw new AppError('AI_RESPONSE_INVALID', '接口返回的型号资料无效。', { recoverable: true })
        const catalog = decodeCatalogSnapshot({ connectionId: input.id, revision: input.revision, protocol: credential.protocol, fetchedAt: new Date().toISOString(), complete: true, entries })
        await guard.recheck()
        modelCatalogs.set(input.id, catalog)
        return { models: catalog.entries.map(e => e.id), catalog }
      }
      const effective = await ai.generationFor('prose')
      const completion = await ai.complete('这是连接测试。请只回复：连接正常', '', '', 'prose', controller.signal)
      assertActive()
      return { models: [] as string[], ...(completion.diagnostics && !JSON.stringify(completion.diagnostics).includes(apiKey) ? { diagnostics: completion.diagnostics } : {}), ...(parameterPolicy ? { parameterPolicy } : {}), parameterFingerprint: createHash('sha256').update(JSON.stringify({ id: input.id, revision: input.revision, model: input.model, effective })).digest('hex') }
    })
    return { ...input, model: input.model ?? '', testedAt: new Date().toISOString(), success: true, message: catalogOnly ? '已获取接口提供的型号列表，未修改分配。' : '文字测试通过，尚未验证工具调用；未发送书稿内容。', ...value }
  }
  const handlers = {
    list: async () => { const view = await globals.list(); for (const [id, cached] of modelCatalogs) if (!view.connections.some(c => c.id === id && c.revision === cached.revision && c.enabled)) modelCatalogs.delete(id); return view }, create: (input: unknown) => globals.create(input, windowGuard()), update: (input: unknown) => globals.update(input, windowGuard()),
    remove: (input: unknown) => globals.remove(input, windowGuard()),
    defaults: () => defaults.get(), saveDefaults: (input: unknown) => defaults.save(input, windowGuard()),
    book: async () => {
      const current = await ensureScope(), capability = await assignments.read(), source = await books.capture(current.bookRoot)
      if (capability.revision !== source.documentFingerprint || scope()?.generation !== current.generation) throw conflict()
      const privateEdit = await privateConnections.read()
      if (privateEdit.revision !== capability.revision) throw conflict()
      const token = randomUUID(); edit = { token, capability, privateEdit, expiresAt: Date.now() + 15 * 60_000 }
      return { token, revision: capability.revision, bookIdentity: source.sourceIdentity, settings: capability.settings }
    },
    saveBook: async (input: { token: string; patch: unknown }) => {
      if (!edit || edit.token !== input.token || Date.now() >= edit.expiresAt) throw conflict()
      const result = await edit.capability.save(input.patch)
      edit = undefined
      return safeSaved(result.settings, result)
    },
    renamePrivate: async (input: { token: string; id: string; name: string }) => {
      if (!edit || edit.token !== input.token || Date.now() >= edit.expiresAt) throw conflict()
      const result = await edit.privateEdit.rename(input.id, input.name); edit = undefined; return result
    },
    savePrivateKey: async (input: { token: string; id: string; apiKey?: string; clearApiKey?: boolean }) => {
      if (!edit || edit.token !== input.token || Date.now() >= edit.expiresAt) throw conflict()
      const result = await edit.privateEdit.saveKey(input.id, input); edit = undefined; return result
    },
    previewApply: async (input: { bookRevision: string; defaultRevision: number }) => { await ensureScope(); return application.preview(input.bookRevision, input.defaultRevision) },
    confirmApply: async (token: string) => { const result = await application.confirm(token); edit = undefined; return safeSaved(JSON.parse(result.content), result) },
    previewReuse: async (input: unknown) => { await ensureScope(); return reuse.preview(input) }, confirmReuse: (token: string) => reuse.confirm(token), reuseReceipt: async (token: string) => { await ensureScope(); return reuse.receipt(token) }, cancelPreviews,
    leaveBook: () => { bookOpen = false; generation++; bookRoot = null; onLeaveBook(); return cancelPreviews() },
    test: (input: ModelProbe) => probe(input, false), catalog: (input: ModelCatalogQuery) => probe(input, true), cancelTest: () => { probeController?.abort(); return true },
    previewCreation: async (withoutDefaults: boolean) => {
      creation = undefined; const epoch = ++creationEpoch, windowId = owner, expiresAt = Date.now() + 15 * 60_000
      const assertActive = () => { if (owner === null || owner !== windowId || epoch !== creationEpoch || Date.now() >= expiresAt) throw conflict() }
      // Explicit manual creation can bypass an unavailable template, never silently claim inheritance.
      const view = withoutDefaults ? { revision: 0, catalogRevision: 0, template: null, references: [] } : await defaults.get()
      const prepared = withoutDefaults ? { revision: 0, summary: view, guard: { assertActive, recheck: async () => assertActive() }, copy: async () => { assertActive(); return null } } : await defaults.capture(view.revision, assertActive)
      assertActive(); const token = randomUUID(); creation = { token, withoutDefaults, prepared, assertActive }
      return { token, defaults: prepared.summary, withoutDefaults }
    },
    createProject: async (input: { token: string; project: unknown }) => {
      const [project] = decodeProjectCreateArgs([input.project]), pending = creation
      if (!pending || pending.token !== input.token) throw conflict()
      pending.assertActive()
      const result = await change(() => projects.createWithModels(project, pending.prepared), true)
      if (result.status === 'created') { creation = undefined; creationEpoch++ }
      return result
    },
    retryCreation: async (input: { token: string; operationId: string }) => {
      const pending = creation
      if (!pending || pending.token !== input.token) throw conflict()
      pending.assertActive()
      const result = await change(() => projects.retryCreation(input.operationId, pending.prepared), true)
      if (result.status === 'created') { creation = undefined; creationEpoch++ }
      return result
    }
  }
  const authorize = (event: IpcMainInvokeEvent) => {
    if (owner !== event.sender.id || event.sender.isDestroyed() || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) throw new AppError('FEATURE_UNAVAILABLE', '请在应用主窗口管理模型接口。', { recoverable: true })
  }
  for (const method of Object.keys(handlers) as Array<keyof typeof handlers>) {
    ipc.handle(`model-connections:${method}`, async (event, ...args: unknown[]) => {
      try {
        authorize(event)
        const decoded = modelConnectionArgs[method](args)
        const handler = handlers[method] as (...args: unknown[]) => unknown
        const value = await handler(...decoded)
        authorize(event)
        const result = method === 'createProject' || method === 'retryCreation'
          ? decodeModelCreationResult(value, v => projectSummary(v, 'project')) : modelConnectionResults[method](value)
        return { ok: true, value: result }
      } catch (error) { return { ok: false, error: toAppErrorDto(error) } }
    })
  }
  return { projectAi, globals, defaults, groupCreation: { create: handlers.createProject, retry: handlers.retryCreation,
    validateBeforeCreate: async (input: { token: string; project: unknown }) => { decodeProjectCreateArgs([input.project]); const pending = creation; if (!pending || pending.token !== input.token) throw conflict(); pending.assertActive(); await pending.prepared.guard.recheck(); await pending.prepared.copy() }
  }, groupModels: groupModelPorts(globals, defaults, local, cachedEntries),
    async create(input: unknown) {
      const preview = await handlers.previewCreation(false)
      const result = await handlers.createProject({ token: preview.token, project: input })
      if (result.status === 'partial') throw new AppError(result.code, result.message, { recoverable: true, details: { operationId: result.operationId } })
      return { project: result.project }
    },
    beginChange(preserveCreation = false) { if (changing) throw conflict(); changing = true; bookOpen = true; generation++; bookRoot = null; application.cancel(); reuse.cancel(); edit = undefined; if (!preserveCreation) { creation = undefined; creationEpoch++ } },
    endChange() { changing = false },
    attach(window: BrowserWindow) { owner = window.webContents.id; generation++; window.webContents.once('destroyed', () => { owner = null; generation++; cancelPreviews(); probeController?.abort() }) }
  }
}
function conflict() { return new AppError('CONFLICT', '操作或作品已变化，请刷新当前内容后重试。', { recoverable: true }) }
