import { inspirationIpcResults } from '../inspiration/bridge'
import { decodeGroupBookCreated } from '../group-chat/creation'
import { decodeGroupAdoptionPreview } from '../group-chat/adoption'
import { decodeGroupView } from '../group-chat/group-chat'
import { groupChatResults } from '../group-chat/group-chat'
import { decodeParameterPolicy } from '../models/parameter-policy'
import { localModelResultDecoders, isLocalConnection, isModelConnectionId } from '../models/local-model-contracts'
import { decodeReceipt, reviewResultDecoders } from '../document-review/validation'
import { annotationResultDecoders } from '../document-review/annotation-validation'
import { revisionGenerationResultDecoders } from '../document-review/generation-validation'
import { modelConnectionResults, decodeModelCreationResult } from '../models/model-connections-contracts'
import type {
  AiConnectionTestResult,
  AiSettings,
  AppErrorDto,
  Chapter,
  ChapterMirrorRecoveryPreview,
  ChapterMirrorRecoveryResult,
  ChapterAutosaveFinalizeResult,
  ChapterAutosaveStageResult,
  ChapterRevision,
  DeletedChapterSummary,
  ConsistencyEvaluationJob,
  ConsistencyEvaluationSummary,
  GenreCatalogItem,
  IpcResponse,
  ManuscriptAutosaveCheckpoint,
  ModelProfile,
  ProjectSummary,
  WorkspaceRestoreOpenResult
} from '../index'
import { workflowIpcValueDecoders } from './ipc-result-contracts'
import { companionVoiceResultDecoders } from '../companion/companion-voice-contracts'
import { importIpcValueDecoders } from '../app/ipc-import-result-contracts'
import { planningIpcValueDecoders } from '../planning/ipc-planning-result-contracts'
import { projectIpcValueDecoders } from '../app/ipc-project-result-contracts'
import { researchIpcValueDecoders } from '../worldbuilding/ipc-research-result-contracts'
import { workspaceConfigIpcValueDecoders } from '../library/ipc-workspace-config-result-contracts'
import { workspaceDataIpcValueDecoders } from '../library/ipc-workspace-data-result-contracts'
import { decodeWorldMapBackgroundView, decodeWorldMapCancelResult, decodeWorldMapImageCandidate, decodeWorldMapLayoutView, decodeWorldMapView } from '../world-map/world-map'
import { eventIpcValueDecoders } from '../timeline/event-contracts'
import { settlementResultDecoders } from '../timeline/prose-event-settlement-contracts'
import { decodeThinkingLevel } from '../models/thinking-level'

type ValueDecoder = (value: unknown, path: string) => unknown

const valueDecoders: Readonly<Record<string, ValueDecoder>> = {
  ...inspirationIpcResults,
  ...groupChatResults,
  'group-chat:saveDraft': (v, p) => boolean(v, p),
  'group-chat:createBook': decodeGroupBookCreated, 'group-chat:prepareAdoption': decodeGroupAdoptionPreview, 'group-chat:adopt': decodeGroupView,
  ...reviewResultDecoders,
  ...annotationResultDecoders,
  ...revisionGenerationResultDecoders,
  'ai:background-tasks': (value, path) => {
    array(value, path).forEach((item, index) => {
      const row = object(item, `${path}[${index}]`)
      for (const key of ['bookId', 'bookPath', 'bookTitle', 'taskId', 'kind', 'status']) boundedString(row[key], `${path}[${index}].${key}`, 32_767)
      if (row.chapterId !== undefined && (!Number.isSafeInteger(row.chapterId) || Number(row.chapterId) < 1)) fail(`${path}[${index}].chapterId`)
      if (Object.keys(row).some(key => !['bookId', 'bookPath', 'bookTitle', 'taskId', 'kind', 'status', 'chapterId'].includes(key))) fail(path)
    })
    return value
  },
  ...eventIpcValueDecoders,
  ...settlementResultDecoders,
  ...Object.fromEntries(Object.entries(modelConnectionResults).map(([name, decode]) => [`model-connections:${name}`, decode])),
  'model-connections:createProject': value => decodeModelCreationResult(value, v => projectSummary(v, 'project')),
  'model-connections:retryCreation': value => decodeModelCreationResult(value, v => projectSummary(v, 'project')),
  ...localModelResultDecoders,
  ...companionVoiceResultDecoders,
  ...workflowIpcValueDecoders,
  ...importIpcValueDecoders,
  ...planningIpcValueDecoders,
  ...projectIpcValueDecoders,
  ...researchIpcValueDecoders,
  ...workspaceConfigIpcValueDecoders,
  ...workspaceDataIpcValueDecoders,
  'workspace:get-world-map': decodeWorldMapView,
  'workspace:save-world-map': decodeWorldMapLayoutView,
  'workspace:generate-world-map-image': decodeWorldMapImageCandidate,
  'workspace:cancel-world-map-image': decodeWorldMapCancelResult,
  'workspace:adopt-world-map-image': decodeWorldMapLayoutView,
  'workspace:get-world-map-background': decodeWorldMapBackgroundView,
  'app:version': (value, path) => {
    const version = boundedString(value, path, 100)
    if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version)) fail(path)
    return value
  },
  'workspace:bootstrap': workspaceBootstrap,
  'workspace:recheck-load-issues': workspaceLoadCheck,
  'projects:list': (value, path) => {
    const result = object(value, path)
    array(result.projects, `${path}.projects`).forEach((item, index) => projectSummary(item, `${path}.projects[${index}]`))
    if (result.continueProjectId !== undefined && result.continueProjectId !== null) {
      boundedString(result.continueProjectId, `${path}.continueProjectId`, 32_767)
      if (!(result.projects as ProjectSummary[]).some(project => project.id === result.continueProjectId)) fail(`${path}.continueProjectId`)
    }
    return value
  },
  'projects:create': projectEnvelope,
  'projects:import': projectEnvelope,
  'projects:workspace-restore-commit': nullable((value, path) => workspaceRestoreOpenResult(value, path)),
  'chapters:create': chapter,
  'chapters:list': chapterList,
  'chapters:get': chapter,
  'chapters:update': chapter,
  'chapters:reorder': chapterList,
  'chapters:autosave-stage': autosaveStageResult,
  'chapters:autosave-finalize': autosaveFinalizeResult,
  'chapters:autosave-recoveries': (value, path) => {
    array(value, path).forEach((item, index) => autosaveCheckpoint(item, `${path}[${index}]`))
    return value
  },
  'chapters:autosave-discard': autosaveCheckpoint,
  'chapters:preserve-draft': (value, path) => {
    const result = object(value, path)
    literal(result.success, true, `${path}.success`)
    boundedString(result.recoveryRelativePath, `${path}.recoveryRelativePath`, 32_767)
    return value
  },
  'chapters:delete': (value, path) => {
    const result = object(value, path)
    literal(result.success, true, `${path}.success`)
    literal(result.recovery, 'chapter-trash', `${path}.recovery`)
    return value
  },
  'chapters:trash-list': deletedChapterList,
  'chapters:restore': chapter,
  'chapters:stats': chapterStats,
  'chapters:revisions': (value, path) => {
    const result = boundedArray(value, path, 500)
    result.forEach((item, index) => chapterRevision(item, `${path}[${index}]`))
    return value
  },
  'chapters:name-current-revision': chapterRevision,
  'chapters:restore-revision': chapter,
  'chapters:preview-external-mirror': chapterMirrorRecoveryPreview,
  'chapters:adopt-external-mirror': chapterMirrorRecoveryResult,
  'chapter-outlines:preview-external-mirror': (value, path) => {
    const result = object(value, path)
    const token = boundedString(result.token, `${path}.token`, 64)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) fail(`${path}.token`)
    positiveInteger(result.chapterId, `${path}.chapterId`)
    boundedString(result.sqliteContent, `${path}.sqliteContent`, 2_000_000)
    boundedString(result.externalContent, `${path}.externalContent`, 2_000_000)
    dateString(result.expiresAt, `${path}.expiresAt`)
    return value
  },
  'chapter-outlines:adopt-external-mirror': (value, path) => {
    const result = object(value, path)
    workflowIpcValueDecoders['outlines:get-planned-chapter']!(result.outline, `${path}.outline`)
    identifier(result.previousOutlineVersionId, `${path}.previousOutlineVersionId`)
    if (!/^[0-9a-f]{64}$/.test(boundedString(result.importedExternalHash, `${path}.importedExternalHash`, 64))) fail(`${path}.importedExternalHash`)
    boolean(result.mirrorPending, `${path}.mirrorPending`)
    return value
  },
  'ai:get-settings': aiSettings,
  'ai:update-settings': aiSettings,
  'ai:list-models': aiModels,
  'ai:test': aiConnectionTest,
  'ai:latest-consistency-evaluation': nullable(consistencyEvaluationSummary),
  'ai:start-consistency-evaluation': consistencyEvaluationJob,
  'ai:consistency-evaluation-job': consistencyEvaluationJob,
  'ai:cancel-consistency-evaluation': consistencyEvaluationJob,
  'ai:genres': genreCatalog,
  'ai:complete': aiCompletion,
  'ai:apply-writing-agent-artifact': (value, path) => {
    const result = object(value, path)
    validateNestedChannel('ai:writing-agent-task', result.task, `${path}.task`)
    validateNestedChannel('chapters:get', result.chapter, `${path}.chapter`)
    boolean(result.insertedVersion, `${path}.insertedVersion`)
    return value
  }
}

/** Every renderer-facing channel whose successful value is checked before use. */
export const registeredIpcResultChannels = Object.freeze(Object.keys(valueDecoders))

function workspaceBootstrap(value: unknown, path: string): unknown {
  const result = object(value, path)
  literal(result.version, 1, `${path}.version`)
  const workItem = object(result.workItem, `${path}.workItem`)
  const id = boundedString(workItem.id, `${path}.workItem.id`, 32_767)
  const workItemPath = boundedString(workItem.path, `${path}.workItem.path`, 32_767)
  if (!id.trim() || !workItemPath.trim() || id !== workItemPath) fail(`${path}.workItem`)
  validateNestedChannel('chapters:list', result.chapters, `${path}.chapters`)
  validateNestedChannel('outlines:list', result.outlines, `${path}.outlines`)
  validateNestedChannel('workspace:get-timeline', result.timeline, `${path}.timeline`)
  validateNestedChannel('workspace:get-realms', result.realms, `${path}.realms`)
  validateNestedChannel('workspace:get-power-system', result.powerSystem, `${path}.powerSystem`)
  validateNestedChannel('workspace:get-cheat-system', result.cheatSystem, `${path}.cheatSystem`)
  validateNestedChannel('workspace:get-system-template', result.systemTemplate, `${path}.systemTemplate`)
  validateNestedChannel('workspace:get-foundation', result.foundation, `${path}.foundation`)
  validateNestedChannel('workspace:get-book-profile', result.bookProfile, `${path}.bookProfile`)
  if (result.aiSettings !== null) validateNestedChannel('ai:get-settings', result.aiSettings, `${path}.aiSettings`)
  validateNestedChannel('research:get-settings', result.researchSettings, `${path}.researchSettings`)
  validateNestedChannel('projects:migration-preview', result.migration, `${path}.migration`)
  validateNestedChannel('research:list-sources', result.sources, `${path}.sources`)
  validateNestedChannel('research:list-events', result.events, `${path}.events`)
  if (result.eventProjection !== null) validateNestedChannel('events:projection', result.eventProjection, `${path}.eventProjection`)
  validateNestedChannel('planning:draft', result.planningDraft, `${path}.planningDraft`)
  validateNestedChannel('workspace:get-prompt-profile', result.promptProfile, `${path}.promptProfile`)
  validateNestedChannel('imports:recoverable-manifests', result.importRecoveries, `${path}.importRecoveries`)
  validateNestedChannel('imports:continuation-analysis', result.continuation, `${path}.continuation`)
  const issues = boundedArray(result.issues, `${path}.issues`, 9)
  const ids = issues.map((issue, index) => bootstrapIssue(issue, `${path}.issues[${index}]`))
  if (new Set(ids).size !== ids.length) fail(`${path}.issues`)
  if (result.aiSettings === null && !ids.includes('modelSettingsUnreadable')) fail(`${path}.aiSettings`)
  return value
}

function validateNestedChannel(channel: string, value: unknown, path: string): void {
  const decoder = valueDecoders[channel]
  if (!decoder) fail(path)
  decoder(value, path)
}

function workspaceLoadCheck(value: unknown, path: string): unknown {
  const result = object(value, path)
  if (Object.keys(result).some(key => !['workItem', 'checkedIds', 'issues', 'aiSettings', 'eventProjection'].includes(key))) fail(path)
  const workItem = object(result.workItem, `${path}.workItem`)
  const id = boundedString(workItem.id, `${path}.workItem.id`, 32_767)
  if (!id.trim() || id !== workItem.path || Object.keys(workItem).some(key => !['id', 'path'].includes(key))) fail(`${path}.workItem`)
  const ids = boundedArray(result.checkedIds, `${path}.checkedIds`, 2).map(id => oneOf(id, ['modelSettingsUnreadable', 'unifiedEventsUnreadable'], `${path}.checkedIds`))
  if (!ids.length || new Set(ids).size !== ids.length) fail(`${path}.checkedIds`)
  const issues = boundedArray(result.issues, `${path}.issues`, 2).map((issue, index) => bootstrapIssue(issue, `${path}.issues[${index}]`))
  if (new Set(issues).size !== issues.length || issues.some(id => !ids.includes(id))) fail(`${path}.issues`)
  for (const [id, field, channel] of [
    ['modelSettingsUnreadable', 'aiSettings', 'ai:get-settings'],
    ['unifiedEventsUnreadable', 'eventProjection', 'events:projection']
  ]) {
    if (ids.includes(id) !== Object.hasOwn(result, field)) fail(`${path}.${field}`)
    if (!ids.includes(id)) continue
    if (issues.includes(id) && result[field] !== null) fail(`${path}.${field}`)
    if (id === 'modelSettingsUnreadable' && !issues.includes(id) && result[field] === null) fail(`${path}.${field}`)
    if (result[field] !== null) validateNestedChannel(channel, result[field], `${path}.${field}`)
  }
  return value
}

function bootstrapIssue(value: unknown, path: string): string {
  const result = object(value, path)
  const id = oneOf(result.id, ['planningDraftUnreadable', 'promptProfileUnreadable', 'researchSourcesUnreadable', 'researchEventsUnreadable', 'unifiedEventsUnreadable', 'outlinePlanningUnreadable', 'characterStateUnreadable', 'chapterOrderUnreadable', 'modelSettingsUnreadable'], `${path}.id`)
  const expected = {
    planningDraftUnreadable: ['planningDraft', 'quarantinePlanningDraft'],
    promptProfileUnreadable: ['promptProfile', 'quarantinePromptProfile'],
    researchSourcesUnreadable: ['researchSources', 'manualReview'],
    researchEventsUnreadable: ['researchEvents', 'manualReview'],
    unifiedEventsUnreadable: ['unifiedEvents', 'manualReview'],
    outlinePlanningUnreadable: ['outlinePlanning', 'manualReview'],
    characterStateUnreadable: ['characterState', 'manualReview'],
    chapterOrderUnreadable: ['chapterOrder', 'manualReview'],
    modelSettingsUnreadable: ['aiSettings', 'manualReview']
  } as const
  const [area, recovery] = expected[id as keyof typeof expected]
  literal(result.area, area, `${path}.area`)
  literal(result.recovery, recovery, `${path}.recovery`)
  boundedString(result.title, `${path}.title`, 500)
  boundedString(result.message, `${path}.message`, 10_000)
  if (Object.keys(result).some(key => !['id', 'area', 'recovery', 'title', 'message', 'reason'].includes(key))) fail(path)
  if (result.reason !== undefined) {
    if (!['unifiedEventsUnreadable', 'modelSettingsUnreadable'].includes(id)) fail(`${path}.reason`)
    oneOf(result.reason, ['busy', 'recovery-required', 'invalid-data', 'unavailable'], `${path}.reason`)
  }
  return id
}

export function unwrapValidatedIpcResponse<T>(channel: string, response: unknown): T {
  const envelope = validateIpcResponse(channel, response)
  if (!envelope.ok) throw envelope.error
  return envelope.value as T
}

/** Shared by preload and fixed hosted endpoints; errors retain the validated DTO. */
export function validateIpcResponse(channel: string, response: unknown): IpcResponse<unknown> {
  const envelope = ipcEnvelope(response, channel)
  if (!envelope.ok) return envelope
  try {
    const decoder = valueDecoders[channel]
    return { ok: true, value: decoder ? decoder(envelope.value, 'value') : envelope.value }
  } catch {
    throw invalidResponse(channel)
  }
}

export function unwrapIpcResponse<T>(response: IpcResponse<T>): T {
  if (response.ok) return response.value
  const error = new Error(response.error.message) as Error & AppErrorDto
  error.name = 'DesktopAppError'
  error.code = response.error.code
  error.recoverable = response.error.recoverable
  error.details = response.error.details
  throw error
}

function ipcEnvelope(value: unknown, channel: string): IpcResponse<unknown> {
  try {
    const envelope = object(value, 'response')
    boolean(envelope.ok, 'response.ok')
    if (envelope.ok === true) {
      if (!Object.prototype.hasOwnProperty.call(envelope, 'value')) fail('response.value')
      return { ok: true, value: envelope.value }
    }
    const error = object(envelope.error, 'response.error')
    const dto: AppErrorDto = {
      code: boundedString(error.code, 'response.error.code', 100),
      message: boundedString(error.message, 'response.error.message', 10_000),
      recoverable: boolean(error.recoverable, 'response.error.recoverable')
    }
    if (error.details !== undefined) dto.details = object(error.details, 'response.error.details')
    return { ok: false, error: dto }
  } catch {
    throw invalidResponse(channel)
  }
}

function projectEnvelope(value: unknown, path: string): unknown {
  const result = object(value, path)
  projectSummary(result.project, `${path}.project`)
  return value
}

function projectSummary(value: unknown, path: string): ProjectSummary {
  const result = object(value, path)
  for (const field of ['id', 'name', 'path', 'title', 'genre', 'updated_at'] as const) boundedString(result[field], `${path}.${field}`, 32_767)
  const manuscript = object(result.manuscript, `${path}.manuscript`)
  nonnegativeInteger(manuscript.chapterCount, `${path}.manuscript.chapterCount`)
  nonnegativeInteger(manuscript.fileCount, `${path}.manuscript.fileCount`)
  nonnegativeInteger(manuscript.wordCount, `${path}.manuscript.wordCount`)
  if (manuscript.lastEditedChapter !== undefined && manuscript.lastEditedChapter !== null) {
    const last = object(manuscript.lastEditedChapter, `${path}.manuscript.lastEditedChapter`)
    nonnegativeInteger(last.id, `${path}.manuscript.lastEditedChapter.id`)
    nonnegativeInteger(last.position, `${path}.manuscript.lastEditedChapter.position`)
    boundedString(last.title, `${path}.manuscript.lastEditedChapter.title`, 500)
    boundedString(last.updatedAt, `${path}.manuscript.lastEditedChapter.updatedAt`, 100)
  }
  oneOf(manuscript.status, ['ready', 'chapter-review', 'identity-review'], `${path}.manuscript.status`)
  if (manuscript.message !== undefined) boundedString(manuscript.message, `${path}.manuscript.message`, 10_000)
  return value as ProjectSummary
}

function chapterList(value: unknown, path: string): Chapter[] {
  const result = array(value, path)
  result.forEach((item, index) => chapter(item, `${path}[${index}]`))
  return value as Chapter[]
}

function deletedChapterList(value: unknown, path: string): DeletedChapterSummary[] {
  const result = boundedArray(value, path, 500)
  result.forEach((item, index) => {
    const entry = object(item, `${path}[${index}]`)
    if (positiveInteger(entry.id, `${path}[${index}].id`) > 1_000_000) fail(`${path}[${index}].id`)
    if (positiveInteger(entry.position, `${path}[${index}].position`) > 1_000_000) fail(`${path}[${index}].position`)
    boundedString(entry.title, `${path}[${index}].title`, 200)
    if (nonnegativeInteger(entry.word_count, `${path}[${index}].word_count`) > 2_000_000) fail(`${path}[${index}].word_count`)
    dateString(entry.deletedAt, `${path}[${index}].deletedAt`)
  })
  return value as DeletedChapterSummary[]
}

function chapter(value: unknown, path: string): Chapter {
  const result = object(value, path)
  positiveInteger(result.id, `${path}.id`)
  positiveInteger(result.position, `${path}.position`)
  boundedString(result.title, `${path}.title`, 200)
  boundedString(result.content, `${path}.content`, 2_000_000)
  nonnegativeInteger(result.word_count, `${path}.word_count`)
  boundedString(result.summary, `${path}.summary`, 100_000)
  if (result.revision !== undefined && !/^[0-9a-f]{64}$/i.test(boundedString(result.revision, `${path}.revision`, 64))) fail(`${path}.revision`)
  if (result.bodyVersionId !== undefined) identifier(result.bodyVersionId, `${path}.bodyVersionId`)
  if (result.storageMode !== undefined) oneOf(result.storageMode, ['files', 'sqlite'], `${path}.storageMode`)
  if (result.mirrorStatus !== undefined) oneOf(result.mirrorStatus, ['pending', 'synced', 'conflict', 'failed'], `${path}.mirrorStatus`)
  return value as Chapter
}

function chapterStats(value: unknown, path: string): Record<string, number> {
  const result = object(value, path)
  nonnegativeInteger(result.total_chapters, `${path}.total_chapters`)
  nonnegativeInteger(result.total_words, `${path}.total_words`)
  return value as Record<string, number>
}

function chapterRevision(value: unknown, path: string): ChapterRevision {
  const result = object(value, path)
  const id = boundedString(result.id, `${path}.id`, 64)
  if (!/^\d{13}-[0-9a-f-]{36}$/i.test(id)) fail(`${path}.id`)
  positiveInteger(result.chapterId, `${path}.chapterId`)
  boundedString(result.title, `${path}.title`, 200)
  boundedString(result.content, `${path}.content`, 2_000_000)
  nonnegativeInteger(result.word_count, `${path}.word_count`)
  dateString(result.createdAt, `${path}.createdAt`)
  oneOf(result.reason, ['legacy_import', 'manual', 'autosave', 'ai', 'restore'], `${path}.reason`)
  if (result.label !== undefined && result.label !== null) {
    const label = boundedString(result.label, `${path}.label`, 80)
    if (!label.trim()) fail(`${path}.label`)
  }
  if (result.isCurrent !== undefined) boolean(result.isCurrent, `${path}.isCurrent`)
  if (result.sourceTaskRunId !== undefined && result.sourceTaskRunId !== null) identifier(result.sourceTaskRunId, `${path}.sourceTaskRunId`)
  if (result.generationArtifactId !== undefined && result.generationArtifactId !== null) identifier(result.generationArtifactId, `${path}.generationArtifactId`)
  if (Boolean(result.sourceTaskRunId) !== Boolean(result.generationArtifactId)) fail(`${path}.generationArtifactId`)
  if (result.reviewedSource !== undefined) {
    const source = object(result.reviewedSource, `${path}.reviewedSource`)
    if (source.kind !== 'inline-review' || result.reason !== 'ai' || result.sourceTaskRunId || result.generationArtifactId) fail(`${path}.reviewedSource`)
    decodeReceipt(source.application)
  }
  if ((result.sourceTaskRunId || result.generationArtifactId) && result.reason !== 'ai') fail(`${path}.reason`)
  return value as ChapterRevision
}

function chapterMirrorRecoveryPreview(value: unknown, path: string): ChapterMirrorRecoveryPreview {
  const result = object(value, path)
  const token = boundedString(result.token, `${path}.token`, 64)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) fail(`${path}.token`)
  positiveInteger(result.chapterId, `${path}.chapterId`)
  boundedString(result.sqliteTitle, `${path}.sqliteTitle`, 200)
  nonnegativeInteger(result.sqliteCharacterCount, `${path}.sqliteCharacterCount`)
  boundedString(result.sqliteExcerpt, `${path}.sqliteExcerpt`, 240)
  boundedString(result.externalTitle, `${path}.externalTitle`, 200)
  nonnegativeInteger(result.externalCharacterCount, `${path}.externalCharacterCount`)
  boundedString(result.externalExcerpt, `${path}.externalExcerpt`, 240)
  dateString(result.expiresAt, `${path}.expiresAt`)
  return value as ChapterMirrorRecoveryPreview
}

function chapterMirrorRecoveryResult(value: unknown, path: string): ChapterMirrorRecoveryResult {
  const result = object(value, path)
  if (result.mirrorPending !== undefined) boolean(result.mirrorPending, `${path}.mirrorPending`)
  chapter(result.chapter, `${path}.chapter`)
  identifier(result.previousBodyVersionId, `${path}.previousBodyVersionId`)
  const importedHash = boundedString(result.importedExternalHash, `${path}.importedExternalHash`, 64)
  if (!/^[0-9a-f]{64}$/i.test(importedHash)) fail(`${path}.importedExternalHash`)
  return value as ChapterMirrorRecoveryResult
}

function aiSettings(value: unknown, path: string): AiSettings {
  const result = object(value, path)
  // Settings returned to the renderer are intentionally secret-free.  A
  // presence flag is enough for the UI; raw and encrypted keys stay in main.
  if (Object.prototype.hasOwnProperty.call(result, 'apiKey') || Object.prototype.hasOwnProperty.call(result, 'encryptedApiKey')) fail(`${path}.apiKey`)
  if (result.version !== 2 && result.version !== 3 && result.version !== 4 && result.version !== 5) fail(`${path}.version`)
  if (!Array.isArray(result.connections) || result.connections.length > 101) fail(`${path}.connections`)
  for (const [index, entry] of result.connections.entries()) {
    const connection = object(entry, `${path}.connections[${index}]`)
    if (Object.prototype.hasOwnProperty.call(connection, 'apiKey') || Object.prototype.hasOwnProperty.call(connection, 'encryptedApiKey')) fail(`${path}.connections[${index}].apiKey`)
    const id = boundedString(connection.id, `${path}.connections[${index}].id`, 80)
    if (!isModelConnectionId(id)) fail(`${path}.connections[${index}].id`)
    if (!boundedString(connection.name, `${path}.connections[${index}].name`, 80).trim()) fail(`${path}.connections[${index}].name`)
    if (connection.kind === 'local') {
      if (!isLocalConnection(id) || connection.runtimeId !== 'llama-cpp-python' || 'baseUrl' in connection || 'apiKeyConfigured' in connection) fail(path)
      continue
    }
    if (isLocalConnection(id) || connection.kind !== undefined && connection.kind !== 'openai-compatible' && connection.kind !== 'gemini-native') fail(path)
    const baseUrl = boundedString(connection.baseUrl, `${path}.connections[${index}].baseUrl`, 2_048)
    if (connection.scope !== undefined && connection.scope !== 'global' && connection.scope !== 'legacy-private') fail(path)
    if (connection.scope === 'global') {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(boundedString(connection.globalConnectionId, path, 80))) fail(path)
      boolean(connection.enabled, path)
    } else if ('globalConnectionId' in connection || 'enabled' in connection) fail(path)
    if (!/^https?:\/\//i.test(baseUrl) && !(connection.scope === 'global' && baseUrl === '' && connection.apiKeyConfigured === false)) fail(`${path}.connections[${index}].baseUrl`)
    boolean(connection.apiKeyConfigured, `${path}.connections[${index}].apiKeyConfigured`)
  }
  if (result.modelConfigured !== undefined) boolean(result.modelConfigured, `${path}.modelConfigured`)
  boolean(result.apiKeyConfigured, `${path}.apiKeyConfigured`)
  oneOf(result.routingMode, ['shared', 'perTask'], `${path}.routingMode`)
  modelProfile(result.shared, `${path}.shared`)
  const tasks = object(result.tasks, `${path}.tasks`)
  for (const task of ['outline', 'chapterOutline', 'prose', 'review'] as const) modelProfile(tasks[task], `${path}.tasks.${task}`)
  return value as AiSettings
}

function modelProfile(value: unknown, path: string): ModelProfile {
  const result = object(value, path)
  const connectionId = boundedString(result.connectionId, `${path}.connectionId`, 80)
  if (!isModelConnectionId(connectionId)) fail(`${path}.connectionId`)
  const model = boundedString(result.model, `${path}.model`, 500)
  if (!model.trim()) fail(`${path}.model`)
  if (Object.hasOwn(result, 'parameterPolicy')) {
    if (Object.keys(result).some(k => !['connectionId', 'model', 'parameterPolicy'].includes(k))) fail(path)
    decodeParameterPolicy(result.parameterPolicy)
    return value as ModelProfile
  }
  boundedNumber(result.temperature, `${path}.temperature`, 0, 2)
  boundedNumber(result.topP, `${path}.topP`, 0, 1)
  const maxTokens = boundedNumber(result.maxTokens, `${path}.maxTokens`, 128, 128_000)
  if (!Number.isInteger(maxTokens)) fail(`${path}.maxTokens`)
  if (Object.hasOwn(result, 'thinkingLevel')) decodeThinkingLevel(result.thinkingLevel)
  return value as ModelProfile
}

function aiModels(value: unknown, path: string): { models: string[] } {
  const result = object(value, path)
  stringArray(result.models, `${path}.models`, 10_000, 200)
  return value as { models: string[] }
}

function aiConnectionTest(value: unknown, path: string): AiConnectionTestResult {
  const result = object(value, path)
  boolean(result.success, `${path}.success`)
  boundedString(result.message, `${path}.message`, 10_000)
  boundedString(result.model, `${path}.model`, 200)
  stringArray(result.models, `${path}.models`, 10_000, 200)
  if (result.modelListWarning !== undefined) boundedString(result.modelListWarning, `${path}.modelListWarning`, 10_000)
  return value as AiConnectionTestResult
}

function consistencyEvaluationSummary(value: unknown, path: string): ConsistencyEvaluationSummary {
  const result = object(value, path)
  literal(result.version, 1, `${path}.version`)
  literal(result.suite, 'consistency-fixed-v2', `${path}.suite`)
  boundedString(result.modelVersion, `${path}.modelVersion`, 200)
  dateString(result.completedAt, `${path}.completedAt`)
  literal(result.reportRelativePath, '.webnovel/evaluations/consistency-fixed-v2.json', `${path}.reportRelativePath`)
  for (const field of [
    'sampleCount', 'evaluatedCount', 'unableToJudgeCount', 'semanticSampleCount', 'semanticEvaluatedCount',
    'semanticTruePositive', 'semanticFalsePositive', 'semanticFalseNegative', 'semanticUnableToJudge', 'warningCount'
  ] as const) nonnegativeInteger(result[field], `${path}.${field}`)
  if (Number(result.evaluatedCount) > Number(result.sampleCount)
    || Number(result.semanticEvaluatedCount) > Number(result.semanticSampleCount)
    || Number(result.semanticSampleCount) > Number(result.sampleCount)) fail(path)
  return value as ConsistencyEvaluationSummary
}

function consistencyEvaluationJob(value: unknown, path: string): ConsistencyEvaluationJob {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  const workItemId = boundedString(result.workItemId, `${path}.workItemId`, 32_767)
  if (!workItemId.trim()) fail(`${path}.workItemId`)
  const status = oneOf(result.status, ['running', 'completed', 'cancelled', 'failed'], `${path}.status`)
  const completed = nonnegativeInteger(result.completedBatches, `${path}.completedBatches`)
  const total = nonnegativeInteger(result.totalBatches, `${path}.totalBatches`)
  if (completed > total) fail(`${path}.completedBatches`)
  boundedString(result.message, `${path}.message`, 10_000)
  dateString(result.startedAt, `${path}.startedAt`)
  if (result.completedAt !== undefined) dateString(result.completedAt, `${path}.completedAt`)
  if (result.result !== undefined) consistencyEvaluationSummary(result.result, `${path}.result`)
  if (result.error !== undefined) {
    const error = object(result.error, `${path}.error`)
    boundedString(error.code, `${path}.error.code`, 100)
    boundedString(error.message, `${path}.error.message`, 10_000)
  }
  if (status === 'completed' && result.result === undefined) fail(`${path}.result`)
  if (status === 'failed' && result.error === undefined) fail(`${path}.error`)
  return value as ConsistencyEvaluationJob
}

function genreCatalog(value: unknown, path: string): { genres: GenreCatalogItem[] } {
  const result = object(value, path)
  const genres = boundedArray(result.genres, `${path}.genres`, 500)
  genres.forEach((item, index) => {
    const genre = object(item, `${path}.genres[${index}]`)
    const id = boundedString(genre.id, `${path}.genres[${index}].id`, 200)
    const name = boundedString(genre.name, `${path}.genres[${index}].name`, 200)
    if (!id.trim() || !name.trim()) fail(`${path}.genres[${index}]`)
    stringArray(genre.aliases, `${path}.genres[${index}].aliases`, 100, 200)
    stringArray(genre.substyles, `${path}.genres[${index}].substyles`, 500, 200)
  })
  return value as { genres: GenreCatalogItem[] }
}

function aiCompletion(value: unknown, path: string): { content: string } {
  const result = object(value, path)
  boundedString(result.content, `${path}.content`, 2_000_000)
  return value as { content: string }
}

function autosaveStageResult(value: unknown, path: string): ChapterAutosaveStageResult {
  const result = object(value, path)
  oneOf(result.storageMode, ['files', 'sqlite'], `${path}.storageMode`)
  if (result.checkpoint !== null) autosaveCheckpoint(result.checkpoint, `${path}.checkpoint`)
  chapter(result.chapter, `${path}.chapter`)
  boolean(result.merged, `${path}.merged`)
  boolean(result.idempotent, `${path}.idempotent`)
  return value as ChapterAutosaveStageResult
}

function autosaveFinalizeResult(value: unknown, path: string): ChapterAutosaveFinalizeResult {
  const result = object(value, path)
  oneOf(result.storageMode, ['files', 'sqlite'], `${path}.storageMode`)
  if (result.checkpoint !== null) autosaveCheckpoint(result.checkpoint, `${path}.checkpoint`)
  chapter(result.chapter, `${path}.chapter`)
  boolean(result.insertedVersion, `${path}.insertedVersion`)
  return value as ChapterAutosaveFinalizeResult
}

function autosaveCheckpoint(value: unknown, path: string): ManuscriptAutosaveCheckpoint {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  positiveInteger(result.chapterId, `${path}.chapterId`)
  boundedString(result.title, `${path}.title`, 200)
  boundedString(result.content, `${path}.content`, 2_000_000)
  if (!/^[0-9a-f]{64}$/i.test(boundedString(result.contentHash, `${path}.contentHash`, 64))) fail(`${path}.contentHash`)
  oneOf(result.status, ['staged', 'finalized', 'conflict', 'discarded'], `${path}.status`)
  identifier(result.baseBodyVersionId, `${path}.baseBodyVersionId`)
  nonnegativeInteger(result.mergeWindowMs, `${path}.mergeWindowMs`)
  for (const field of ['windowStartedAt', 'windowEndsAt', 'updatedAt'] as const) dateString(result[field], `${path}.${field}`)
  nullableIdentifier(result.conflictCurrentBodyVersionId, `${path}.conflictCurrentBodyVersionId`)
  nullableIdentifier(result.finalizedBodyVersionId, `${path}.finalizedBodyVersionId`)
  nonnegativeInteger(result.operationCount, `${path}.operationCount`)
  return value as ManuscriptAutosaveCheckpoint
}

function workspaceRestoreOpenResult(value: unknown, path: string): WorkspaceRestoreOpenResult {
  const result = object(value, path)
  for (const field of ['projectPath', 'projectName', 'restoredFrom'] as const) boundedString(result[field], `${path}.${field}`, 32_767)
  oneOf(result.storageMode, ['shadow', 'sqlite'], `${path}.storageMode`)
  nonnegativeInteger(result.chapterCount, `${path}.chapterCount`)
  literal(result.verified, true, `${path}.verified`)
  projectSummary(result.project, `${path}.project`)
  return value as WorkspaceRestoreOpenResult
}

function nullable(decoder: ValueDecoder): ValueDecoder {
  return (value, path) => value === null ? value : decoder(value, path)
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path)
  return value as Record<string, unknown>
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path)
  return value
}

function boundedArray(value: unknown, path: string, maximum: number): unknown[] {
  const result = array(value, path)
  if (result.length > maximum) fail(path)
  return result
}

function stringArray(value: unknown, path: string, maximumItems: number, maximumLength: number): string[] {
  const result = boundedArray(value, path, maximumItems)
  result.forEach((item, index) => boundedString(item, `${path}[${index}]`, maximumLength))
  return value as string[]
}

function boundedString(value: unknown, path: string, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum) fail(path)
  return value
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path)
  return value
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) fail(path)
  return Number(value)
}

function nonnegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(path)
  return Number(value)
}

function boundedNumber(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) fail(path)
  return value
}

function dateString(value: unknown, path: string): string {
  const result = boundedString(value, path, 100)
  if (!Number.isFinite(Date.parse(result))) fail(path)
  return result
}

function identifier(value: unknown, path: string): string {
  const result = boundedString(value, path, 256)
  if (!result.trim()) fail(path)
  return result
}

function nullableIdentifier(value: unknown, path: string): string | null {
  if (value === null) return value
  return identifier(value, path)
}

function oneOf(value: unknown, allowed: readonly string[], path: string): string {
  if (typeof value !== 'string' || !allowed.includes(value)) fail(path)
  return value
}

function literal(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) fail(path)
}

function fail(path: string): never {
  throw new TypeError(`Invalid IPC response at ${path}`)
}

function invalidResponse(channel: string): AppErrorDto {
  return {
    code: 'INTERNAL_ERROR',
    message: '应用内部返回的数据格式无效，已停止使用这份结果。请重试；若仍出现，请重新启动岚笺。',
    recoverable: true,
    details: { channel }
  }
}
