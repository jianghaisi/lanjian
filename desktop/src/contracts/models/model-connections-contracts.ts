import { decodeGenerationDiagnostics, type GenerationDiagnostics } from './generation-diagnostics'
import { AppError, type AppErrorCode } from '../core/app-error'
import { connectionRecord as record, connectionRevision as revision, globalConnectionId as id, modelConnectionEndpoint as endpoint,
  modelConnectionName as name, connectionReuseOperationId as reuseToken, decodeConnectionCreate, decodeConnectionUpdate, decodeConnectionRemove,
  modelConnectionKey, remoteModelProtocol, type ConnectionCreate, type ConnectionUpdate, type ConnectionRemove, type GlobalConnectionsView } from './model-connections'
import { decodeBookModelSettings, type BookModelSettings } from './book-model-settings'
import { decodeModelDefaultTemplate, decodeModelDefaultsSave, type ModelDefaultsSave, type ModelDefaultTemplate } from './new-book-model-defaults'
import { decodeLegacyReusePreview, legacyConnectionId, type LegacyReusePreview, type LegacyReuseResult } from './legacy-connection-reuse'
import type { ProjectCreateInput, ProjectSummary } from '../index'
import { decodeThinkingLevel, type ThinkingLevel } from './thinking-level'
import { decodeParameterPolicy, type ParameterPolicy } from './parameter-policy'
import { decodeCatalogSnapshot, type ModelCatalogSnapshot } from './model-catalog-metadata'

export type ModelDefaultsView = { revision: number; catalogRevision: number; template: ModelDefaultTemplate | null;
  references: Array<{ id: string; state: 'missing' | 'enabled' | 'disabled'; name?: string; baseUrl?: string; revision?: number }> }
export type BookModelsView = { token: string; revision: string; bookIdentity: string; settings: BookModelSettings }
export type BookModelsSaved = { settings: BookModelSettings; authority: 'files' | 'sqlite'; mirrorStatus: 'not-applicable' | 'pending' | 'synced' | 'conflict' | 'failed' }
export type DefaultApplicationPreview = { token: string; expiresAt: number; bookRevision: string; defaultRevision: number;
  before: BookModelSettings; after: BookModelSettings; changes: Array<{ field: string; before: string; after: string }> }
export type ModelProbe = { id: string; revision: number; model: string; thinkingLevel?: ThinkingLevel; parameterPolicy?: ParameterPolicy }
export type ModelCatalogQuery = { id: string; revision: number; model?: string }
export type ModelProbeResult = { id: string; revision: number; model: string; thinkingLevel?: ThinkingLevel; parameterPolicy?: ParameterPolicy; parameterFingerprint?: string; diagnostics?: GenerationDiagnostics; catalog?: ModelCatalogSnapshot; testedAt: string; success: boolean; message: string; models: string[] }
export type ModelCreationPreview = { token: string; defaults: ModelDefaultsView; withoutDefaults: boolean }
export type PartialProjectCreation = { status: 'partial'; operationId: string; title: string; code: AppErrorCode; message: string; modelsWritten: boolean }
export type ModelCreationResult = { status: 'created'; project: ProjectSummary } | PartialProjectCreation
export type ModelConnectionsApi = {
  list(): Promise<GlobalConnectionsView>
  create(input: ConnectionCreate): Promise<GlobalConnectionsView>
  update(input: ConnectionUpdate): Promise<GlobalConnectionsView>
  remove(input: ConnectionRemove): Promise<GlobalConnectionsView>
  defaults(): Promise<ModelDefaultsView>
  saveDefaults(input: ModelDefaultsSave): Promise<ModelDefaultsView>
  book(): Promise<BookModelsView>
  saveBook(input: { token: string; patch: unknown }): Promise<BookModelsSaved>
  renamePrivate(input: { token: string; id: string; name: string }): Promise<BookModelsSaved>
  savePrivateKey(input: { token: string; id: string; apiKey?: string; clearApiKey?: boolean }): Promise<boolean>
  previewApply(input: { bookRevision: string; defaultRevision: number }): Promise<DefaultApplicationPreview>
  confirmApply(token: string): Promise<BookModelsSaved>
  previewReuse(input: { selectedIds: string[]; expectedRevision: number }): Promise<LegacyReusePreview>
  confirmReuse(token: string): Promise<LegacyReuseResult>
  reuseReceipt(token: string): Promise<LegacyReuseResult | null>
  cancelPreviews(): Promise<boolean>
  leaveBook(): Promise<boolean>
  test(input: ModelProbe): Promise<ModelProbeResult>
  catalog(input: ModelCatalogQuery): Promise<ModelProbeResult>
  cancelTest(): Promise<boolean>
  previewCreation(withoutDefaults: boolean): Promise<ModelCreationPreview>
  createProject(input: { token: string; project: ProjectCreateInput }): Promise<ModelCreationResult>
  retryCreation(input: { token: string; operationId: string }): Promise<ModelCreationResult>
}

function invalid(): never { throw new AppError('VALIDATION_ERROR', '模型接口请求或结果格式无效。', { recoverable: true }) }
function token(v: unknown): string { if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) invalid(); return v }
function text(v: unknown, max = 500): string { if (typeof v !== 'string' || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) invalid(); return v }
function bool(v: unknown): boolean { if (typeof v !== 'boolean') invalid(); return v }
function hash(v: unknown): string { const s = text(v, 128); if (!/^[a-f0-9]{64}$/.test(s)) invalid(); return s }
function array<T>(v: unknown, decode: (v: unknown) => T, max = 100): T[] { if (!Array.isArray(v) || v.length > max) invalid(); return Array.from(v, decode) }
function probe(v: unknown): ModelProbe { const r = record(v, ['id', 'revision', 'model', 'thinkingLevel', 'parameterPolicy']); const model = text(r.model); if (!model.trim() || (Object.hasOwn(r, 'thinkingLevel') && Object.hasOwn(r, 'parameterPolicy'))) invalid(); return { id: id(r.id), revision: revision(r.revision, 1), model, ...(Object.hasOwn(r, 'thinkingLevel') ? { thinkingLevel: decodeThinkingLevel(r.thinkingLevel) } : {}), ...(Object.hasOwn(r, 'parameterPolicy') ? { parameterPolicy: decodeParameterPolicy(r.parameterPolicy) } : {}) } }
function noArgs(args: unknown[]): [] { if (args.length) invalid(); return [] }
const one = <T>(decode: (v: unknown) => T) => (args: unknown[]): [T] => { if (args.length !== 1) invalid(); return [decode(args[0])] }

export const modelConnectionArgs = {
  list: noArgs, create: one(decodeConnectionCreate), update: one(decodeConnectionUpdate), remove: one(decodeConnectionRemove), defaults: noArgs, saveDefaults: one(decodeModelDefaultsSave),
  book: noArgs,
  saveBook: one(v => { const r = record(v, ['token', 'patch']); const patch = record(r.patch, ['routingMode', 'shared', 'tasks', 'globalReferences', 'globalRevisions']); return { token: token(r.token), patch: structuredClone(patch) } }),
  renamePrivate: one(v => { const r = record(v, ['token', 'id', 'name']); return { token: token(r.token), id: legacyConnectionId(r.id), name: name(r.name) } }),
  savePrivateKey: one(v => { const r = record(v, ['token', 'id', 'apiKey', 'clearApiKey']);
    if (Object.hasOwn(r, 'apiKey') === Object.hasOwn(r, 'clearApiKey') || (Object.hasOwn(r, 'clearApiKey') && r.clearApiKey !== true)) invalid()
    return { token: token(r.token), id: legacyConnectionId(r.id), ...(Object.hasOwn(r, 'apiKey') ? { apiKey: modelConnectionKey(r.apiKey) } : { clearApiKey: true }) }
  }),
  previewApply: one(v => { const r = record(v, ['bookRevision', 'defaultRevision']); return { bookRevision: hash(r.bookRevision), defaultRevision: revision(r.defaultRevision) } }),
  confirmApply: one(token), previewReuse: one(decodeLegacyReusePreview), confirmReuse: one(reuseToken), reuseReceipt: one(reuseToken), cancelPreviews: noArgs, leaveBook: noArgs,
  test: one(probe), catalog: one(v => { const r = record(v, ['id', 'revision', 'model']); return { id: id(r.id), revision: revision(r.revision, 1), ...(Object.hasOwn(r, 'model') ? { model: text(r.model) } : {}) } }), cancelTest: noArgs, previewCreation: one(bool),
  // project fields are decoded with the existing ProjectCreate owner in main.
  createProject: one(v => { const r = record(v, ['token', 'project']); return { token: token(r.token), project: r.project } }),
  retryCreation: one(v => { const r = record(v, ['token', 'operationId']); return { token: token(r.token), operationId: token(r.operationId) } })
}

export function decodeGlobalConnectionsView(v: unknown): GlobalConnectionsView {
  const r = record(v, ['revision', 'connections'])
  return { revision: revision(r.revision), connections: array(r.connections, v => {
    const c = record(v, ['id', 'name', 'baseUrl', 'protocol', 'enabled', 'revision', 'credentialState'])
    if (!['missing', 'stored', 'unavailable'].includes(String(c.credentialState))) invalid()
    return { id: id(c.id), name: name(c.name), baseUrl: endpoint(c.baseUrl), protocol: remoteModelProtocol(c.protocol), enabled: bool(c.enabled), revision: revision(c.revision, 1), credentialState: c.credentialState as 'missing' | 'stored' | 'unavailable' }
  }) }
}
export function decodeModelDefaultsView(v: unknown): ModelDefaultsView {
  const r = record(v, ['revision', 'catalogRevision', 'template', 'references'])
  return { revision: revision(r.revision), catalogRevision: revision(r.catalogRevision), template: r.template === null ? null : decodeModelDefaultTemplate(r.template),
    references: array(r.references, v => { const c = record(v, ['id', 'state', 'name', 'baseUrl', 'revision'])
      if (!['missing', 'enabled', 'disabled'].includes(String(c.state))) invalid()
      if (c.state === 'missing') { if (['name', 'baseUrl', 'revision'].some(k => Object.hasOwn(c, k))) invalid(); return { id: id(c.id), state: 'missing' as const } }
      return { id: id(c.id), state: c.state as 'enabled' | 'disabled', name: name(c.name), baseUrl: endpoint(c.baseUrl), revision: revision(c.revision, 1) }
    }) }
}
function book(v: unknown): BookModelsView { const r = record(v, ['token', 'revision', 'bookIdentity', 'settings']); return { token: token(r.token), revision: hash(r.revision), bookIdentity: hash(r.bookIdentity), settings: decodeBookModelSettings(r.settings) } }
function saved(v: unknown): BookModelsSaved {
  const r = record(v, ['settings', 'authority', 'mirrorStatus'])
  if (!['files', 'sqlite'].includes(String(r.authority)) || !['not-applicable', 'pending', 'synced', 'conflict', 'failed'].includes(String(r.mirrorStatus))) invalid()
  return { settings: decodeBookModelSettings(r.settings), authority: r.authority as BookModelsSaved['authority'], mirrorStatus: r.mirrorStatus as BookModelsSaved['mirrorStatus'] }
}
function reuse(v: unknown): LegacyReuseResult { const r = record(v, ['operationId', 'connectionIds']); return { operationId: reuseToken(r.operationId), connectionIds: array(r.connectionIds, id, 20) } }
function reusePreview(v: unknown): LegacyReusePreview { const r = record(v, ['token', 'expiresAt', 'expectedRevision', 'connections']); return { token: reuseToken(r.token), expiresAt: revision(r.expiresAt, 1), expectedRevision: revision(r.expectedRevision), connections: array(r.connections, v => {
  const c = record(v, ['sourceConnectionId', 'name', 'baseUrl', 'credentialState'])
  if (!['missing', 'stored', 'unavailable'].includes(String(c.credentialState))) invalid()
  return { sourceConnectionId: legacyConnectionId(c.sourceConnectionId), name: name(c.name), baseUrl: endpoint(c.baseUrl), credentialState: c.credentialState as 'missing' | 'stored' | 'unavailable' }
}, 20) } }
function applyPreview(v: unknown): DefaultApplicationPreview {
  const r = record(v, ['token', 'expiresAt', 'bookRevision', 'defaultRevision', 'before', 'after', 'changes'])
  return { token: token(r.token), expiresAt: revision(r.expiresAt, 1), bookRevision: hash(r.bookRevision), defaultRevision: revision(r.defaultRevision, 1),
    before: decodeBookModelSettings(r.before), after: decodeBookModelSettings(r.after), changes: array(r.changes, v => { const c = record(v, ['field', 'before', 'after']); return { field: text(c.field, 80), before: text(c.before), after: text(c.after) } }, 40) }
}
function probeResult(v: unknown): ModelProbeResult {
  const r = record(v, ['id', 'revision', 'model', 'thinkingLevel', 'parameterPolicy', 'parameterFingerprint', 'diagnostics', 'catalog', 'testedAt', 'success', 'message', 'models'])
  const testedAt = text(r.testedAt, 30); if (!Number.isFinite(Date.parse(testedAt))) invalid()
  const catalog = Object.hasOwn(r, 'catalog') ? decodeCatalogSnapshot(r.catalog) : undefined
  const models = array(r.models, v => text(v), 2000)
  if (catalog && (catalog.connectionId !== r.id || catalog.revision !== r.revision || JSON.stringify(catalog.entries.map(e => e.id)) !== JSON.stringify(models))) invalid()
  return { id: id(r.id), revision: revision(r.revision, 1), model: text(r.model), ...(Object.hasOwn(r, 'thinkingLevel') ? { thinkingLevel: decodeThinkingLevel(r.thinkingLevel) } : {}),
    ...(Object.hasOwn(r, 'parameterPolicy') ? { parameterPolicy: decodeParameterPolicy(r.parameterPolicy) } : {}), ...(Object.hasOwn(r, 'parameterFingerprint') ? { parameterFingerprint: hash(r.parameterFingerprint) } : {}),
    ...(Object.hasOwn(r, 'diagnostics') ? { diagnostics: decodeGenerationDiagnostics(r.diagnostics) } : {}),
    ...(catalog ? { catalog } : {}), testedAt, success: bool(r.success), message: text(r.message), models }
}
export function decodeModelCreationResult(v: unknown, projectDecoder: (v: unknown) => ProjectSummary): ModelCreationResult {
  const r = record(v, ['status', 'project', 'operationId', 'title', 'code', 'message', 'modelsWritten'])
  if (r.status === 'created') { record(v, ['status', 'project']); return { status: 'created', project: projectDecoder(r.project) } }
  record(v, ['status', 'operationId', 'title', 'code', 'message', 'modelsWritten'])
  if (r.status !== 'partial' || !['CONFLICT', 'STORAGE_ERROR', 'VALIDATION_ERROR', 'FEATURE_UNAVAILABLE', 'PATH_ESCAPE'].includes(String(r.code))) invalid()
  return { status: 'partial', operationId: token(r.operationId), title: text(r.title, 500), code: r.code as PartialProjectCreation['code'], message: text(r.message), modelsWritten: bool(r.modelsWritten) }
}
export const modelConnectionResults = {
  list: decodeGlobalConnectionsView, create: decodeGlobalConnectionsView, update: decodeGlobalConnectionsView, remove: decodeGlobalConnectionsView,
  defaults: decodeModelDefaultsView, saveDefaults: decodeModelDefaultsView, book, saveBook: saved, previewApply: applyPreview, confirmApply: saved,
  renamePrivate: saved, savePrivateKey: bool,
  previewReuse: reusePreview, confirmReuse: reuse, reuseReceipt: (v: unknown) => v === null ? null : reuse(v), cancelPreviews: bool, leaveBook: bool,
  test: probeResult, catalog: probeResult, cancelTest: bool,
  previewCreation: (v: unknown): ModelCreationPreview => { const r = record(v, ['token', 'defaults', 'withoutDefaults']); return { token: token(r.token), defaults: decodeModelDefaultsView(r.defaults), withoutDefaults: bool(r.withoutDefaults) } }
}
