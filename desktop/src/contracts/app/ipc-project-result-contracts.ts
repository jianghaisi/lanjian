import type {
  AutoBackupStatus,
  ManuscriptExportResult,
  ProjectMigrationPreview,
  ProjectMigrationResult,
  ProjectSummary,
  RealTrialChapterRecord,
  RealTrialConclusionRecord,
  RealTrialReport,
  WorkspaceBackupResult,
  WorkspaceRestorePreview
} from '../index'
import type { IpcValueDecoder } from '../core/ipc-result-contracts'
import { decodeLibraryOutlineResult } from '../library/library-outline-preview'

const successOnlyChannels = ['projects:remove-recent', 'projects:open-trash']
const autoBackupChannels = ['projects:auto-backup-get', 'projects:auto-backup-update', 'projects:auto-backup-run']
const realTrialChannels = ['projects:real-trial-report', 'projects:save-real-trial-chapter', 'projects:save-real-trial-conclusion']

export const projectIpcValueDecoders: Readonly<Record<string, IpcValueDecoder>> = {
  'projects:library-outline-preview': decodeLibraryOutlineResult,
  'projects:choose-directory': nullable(directoryPath),
  'projects:switch': projectSwitch,
  'projects:trash': projectTrash,
  'projects:status': projectStatus,
  'projects:migration-preview': projectMigrationPreview,
  'projects:migrate': projectMigrationResult,
  'projects:workspace-backup-create': nullable(workspaceBackupResult),
  'projects:manuscript-export': nullable(manuscriptExportResult),
  'projects:auto-backup-choose-directory': nullable(directoryPath),
  'projects:workspace-restore-preview': nullable(workspaceRestorePreview),
  ...Object.fromEntries(successOnlyChannels.map((channel) => [channel, successOnly])),
  ...Object.fromEntries(autoBackupChannels.map((channel) => [channel, autoBackupStatus])),
  ...Object.fromEntries(realTrialChannels.map((channel) => [channel, realTrialReport]))
}

function projectSwitch(value: unknown, path: string): unknown {
  const result = object(value, path)
  literal(result.success, true, `${path}.success`)
  directoryPath(result.path, `${path}.path`)
  return value
}

function projectTrash(value: unknown, path: string): unknown {
  const result = object(value, path)
  literal(result.success, true, `${path}.success`)
  literal(result.recovery, 'system-trash', `${path}.recovery`)
  requiredText(result.title, `${path}.title`, 200)
  return value
}

function successOnly(value: unknown, path: string): unknown {
  literal(object(value, path).success, true, `${path}.success`)
  return value
}

function projectStatus(value: unknown, path: string): unknown {
  const result = object(value, path)
  literal(result.initialized, true, `${path}.initialized`)
  const root = directoryPath(result.project_root, `${path}.project_root`)
  const project = projectSummary(result.project, `${path}.project`)
  if (project.path !== root || project.id !== project.path) fail(`${path}.project`)
  return value
}

export function projectSummary(value: unknown, path: string): ProjectSummary {
  const result = object(value, path)
  for (const field of ['id', 'name', 'path', 'title'] as const) requiredText(result[field], `${path}.${field}`, 32_767)
  for (const field of ['genre', 'updated_at'] as const) text(result[field], `${path}.${field}`, 32_767)
  const manuscript = object(result.manuscript, `${path}.manuscript`)
  count(manuscript.chapterCount, `${path}.manuscript.chapterCount`)
  count(manuscript.fileCount, `${path}.manuscript.fileCount`)
  count(manuscript.wordCount, `${path}.manuscript.wordCount`)
  if (manuscript.lastEditedChapter !== undefined && manuscript.lastEditedChapter !== null) {
    const last = object(manuscript.lastEditedChapter, `${path}.manuscript.lastEditedChapter`)
    count(last.id, `${path}.manuscript.lastEditedChapter.id`)
    count(last.position, `${path}.manuscript.lastEditedChapter.position`)
    text(last.title, `${path}.manuscript.lastEditedChapter.title`, 500)
    text(last.updatedAt, `${path}.manuscript.lastEditedChapter.updatedAt`, 100)
  }
  oneOf(manuscript.status, ['ready', 'chapter-review', 'identity-review'], `${path}.manuscript.status`)
  if (manuscript.message !== undefined) text(manuscript.message, `${path}.manuscript.message`, 10_000)
  return value as ProjectSummary
}

function projectMigrationPreview(value: unknown, path: string): ProjectMigrationPreview {
  const result = object(value, path)
  count(result.currentVersion, `${path}.currentVersion`)
  count(result.targetVersion, `${path}.targetVersion`)
  bool(result.required, `${path}.required`)
  oneOf(result.format, ['lanjian-current', 'lanjian-legacy'], `${path}.format`)
  bool(result.canMigrate, `${path}.canMigrate`)
  bool(result.reviewRequired, `${path}.reviewRequired`)
  stringArray(result.operations, `${path}.operations`, 100, 10_000)
  stringArray(result.warnings, `${path}.warnings`, 100, 10_000)
  boundedArray(result.issues, `${path}.issues`, 1_000).forEach((item, index) => {
    const issue = object(item, `${path}.issues[${index}]`)
    text(issue.id, `${path}.issues[${index}].id`, 200)
    oneOf(issue.severity, ['blocker', 'attention', 'info'], `${path}.issues[${index}].severity`)
    text(issue.title, `${path}.issues[${index}].title`, 500)
    text(issue.message, `${path}.issues[${index}].message`, 10_000)
    stringArray(issue.evidence, `${path}.issues[${index}].evidence`, 1_000, 32_767)
  })
  return value as ProjectMigrationPreview
}

function projectMigrationResult(value: unknown, path: string): ProjectMigrationResult {
  const result = object(value, path)
  projectMigrationPreview(value, path)
  bool(result.migrated, `${path}.migrated`)
  if (result.backupRelativePath !== undefined) safeRelativePath(result.backupRelativePath, `${path}.backupRelativePath`)
  return value as ProjectMigrationResult
}

function workspaceBackupResult(value: unknown, path: string): WorkspaceBackupResult {
  const result = object(value, path)
  directoryPath(result.backupPath, `${path}.backupPath`)
  text(result.backupName, `${path}.backupName`, 500)
  date(result.createdAt, `${path}.createdAt`)
  text(result.projectName, `${path}.projectName`, 500)
  oneOf(result.storageMode, ['shadow', 'sqlite'], `${path}.storageMode`)
  count(result.chapterCount, `${path}.chapterCount`)
  count(result.fileCount, `${path}.fileCount`)
  literal(result.verified, true, `${path}.verified`)
  return value as WorkspaceBackupResult
}

function manuscriptExportResult(value: unknown, path: string): ManuscriptExportResult {
  const result = object(value, path)
  oneOf(result.format, ['txt', 'markdown'], `${path}.format`)
  directoryPath(result.filePath, `${path}.filePath`)
  count(result.chapterCount, `${path}.chapterCount`)
  count(result.characterCount, `${path}.characterCount`)
  return value as ManuscriptExportResult
}

function autoBackupStatus(value: unknown, path: string): AutoBackupStatus {
  const result = object(value, path)
  bool(result.enabled, `${path}.enabled`)
  bool(result.backupOnFirstOpen, `${path}.backupOnFirstOpen`)
  const target = text(result.targetParentPath, `${path}.targetParentPath`, 32_767)
  if (result.enabled && !target.trim()) fail(`${path}.targetParentPath`)
  integer(result.intervalMinutes, `${path}.intervalMinutes`, 15, 1_440)
  integer(result.retentionCount, `${path}.retentionCount`, 1, 50)
  for (const field of ['lastCheckedAt', 'lastSuccessAt', 'nextDueAt'] as const) nullableDate(result[field], `${path}.${field}`)
  if (result.lastError !== null) text(result.lastError, `${path}.lastError`, 500)
  if (result.lastResult !== null) workspaceBackupResult(result.lastResult, `${path}.lastResult`)
  oneOf(result.state, ['disabled', 'needs-folder', 'ready', 'unchanged', 'backed-up', 'failed'], `${path}.state`)
  return value as AutoBackupStatus
}

function workspaceRestorePreview(value: unknown, path: string): WorkspaceRestorePreview {
  const result = object(value, path)
  nullableUuid(result.token, `${path}.token`)
  bool(result.canRestore, `${path}.canRestore`)
  text(result.projectName, `${path}.projectName`, 500)
  nullableDate(result.createdAt, `${path}.createdAt`)
  text(result.appVersion, `${path}.appVersion`, 100)
  if (result.storageMode !== null) oneOf(result.storageMode, ['shadow', 'sqlite'], `${path}.storageMode`)
  count(result.chapterCount, `${path}.chapterCount`)
  count(result.fileCount, `${path}.fileCount`)
  nullableDate(result.expiresAt, `${path}.expiresAt`)
  boundedArray(result.blockers, `${path}.blockers`, 1_000).forEach((item, index) => {
    const blocker = object(item, `${path}.blockers[${index}]`)
    text(blocker.code, `${path}.blockers[${index}].code`, 100)
    text(blocker.message, `${path}.blockers[${index}].message`, 10_000)
  })
  if (result.canRestore && (result.token === null || result.storageMode === null || result.createdAt === null || result.expiresAt === null)) fail(path)
  if (!result.canRestore && result.token !== null) fail(`${path}.token`)
  return value as WorkspaceRestorePreview
}

function realTrialReport(value: unknown, path: string): RealTrialReport {
  const result = object(value, path)
  literal(result.version, 1, `${path}.version`)
  literal(result.purpose, 'product-experience-and-cost-only', `${path}.purpose`)
  directoryPath(result.workItemId, `${path}.workItemId`)
  date(result.generatedAt, `${path}.generatedAt`)
  literal(result.reportRelativePath, '.webnovel/evaluations/real-chapter-trial-v1.json', `${path}.reportRelativePath`)
  text(result.scopeNotice, `${path}.scopeNotice`, 10_000)
  const chapters = boundedArray(result.chapters, `${path}.chapters`, 30)
  chapters.forEach((item, index) => realTrialChapter(item, `${path}.chapters[${index}]`))
  if (result.conclusion !== null) realTrialConclusion(result.conclusion, `${path}.conclusion`)
  const summary = object(result.summary, `${path}.summary`)
  count(summary.chapterCount, `${path}.summary.chapterCount`)
  literal(summary.targetMinimum, 20, `${path}.summary.targetMinimum`)
  literal(summary.targetMaximum, 30, `${path}.summary.targetMaximum`)
  oneOf(summary.status, ['collecting', 'review-ready', 'window-complete'], `${path}.summary.status`)
  for (const field of [
    'totalHumanMinutes', 'averageHumanMinutes', 'autosaveCheckpoints', 'autosaveFinalized', 'autosaveConflicts', 'autosavePending', 'autosaveDiscarded', 'aiTasks', 'aiSucceeded', 'aiCancelled', 'aiFailed', 'aiInterrupted',
    'aiRetries', 'diffAcceptedBlocks', 'diffRejectedBlocks', 'misappliedChanges', 'factCandidates', 'factDecisions', 'factBatchSubmittedDecisions', 'reviewDecisions', 'averageReviewDecisions',
    'falsePositiveFindings', 'usefulFindings', 'contextEstimatedTokens', 'averageSatisfaction'
  ] as const) nonnegativeNumber(summary[field], `${path}.summary.${field}`)
  count(summary.humanTimeRecordedChapters, `${path}.summary.humanTimeRecordedChapters`)
  for (const field of ['autosaveConflictFreeRate', 'aiSuccessRate', 'aiCancellationRate', 'aiRetryRate', 'diffAcceptanceRate', 'factDecisionRate', 'factBatchSubmissionRate', 'findingFalsePositiveRate', 'modelCostTotal'] as const) nullableNonnegativeNumber(summary[field], `${path}.summary.${field}`)
  if (summary.autosaveConflictFreeRate !== null) unitInterval(summary.autosaveConflictFreeRate, `${path}.summary.autosaveConflictFreeRate`)
  for (const field of ['aiSuccessRate', 'aiCancellationRate', 'aiRetryRate'] as const) if (summary[field] !== null) unitInterval(summary[field], `${path}.summary.${field}`)
  unitInterval(summary.modelCostCoverage, `${path}.summary.modelCostCoverage`)
  unitInterval(summary.humanTimeCoverage, `${path}.summary.humanTimeCoverage`)
  unitInterval(summary.continueNextChapterRate, `${path}.summary.continueNextChapterRate`)
  if (Number(summary.humanTimeRecordedChapters) > chapters.length) fail(`${path}.summary.humanTimeRecordedChapters`)
  if (Number(summary.autosaveFinalized) + Number(summary.autosaveConflicts) + Number(summary.autosavePending) + Number(summary.autosaveDiscarded) !== Number(summary.autosaveCheckpoints)) fail(`${path}.summary.autosaveCheckpoints`)
  if (Number(summary.aiSucceeded) + Number(summary.aiCancelled) + Number(summary.aiFailed) + Number(summary.aiInterrupted) > Number(summary.aiTasks)) fail(`${path}.summary.aiTasks`)
  if (Number(summary.aiRetries) > Number(summary.aiTasks)) fail(`${path}.summary.aiRetries`)
  if (summary.factBatchSubmissionRate !== null) unitInterval(summary.factBatchSubmissionRate, `${path}.summary.factBatchSubmissionRate`)
  if (Number(summary.factBatchSubmittedDecisions) > Number(summary.factDecisions)) fail(`${path}.summary.factBatchSubmittedDecisions`)
  boundedArray(summary.bypassedFeatures, `${path}.summary.bypassedFeatures`, 1_000).forEach((item, index) => {
    const feature = object(item, `${path}.summary.bypassedFeatures[${index}]`)
    text(feature.label, `${path}.summary.bypassedFeatures[${index}].label`, 2_000)
    count(feature.chapters, `${path}.summary.bypassedFeatures[${index}].chapters`)
  })
  if (Number(summary.chapterCount) !== chapters.length) fail(`${path}.summary.chapterCount`)
  return value as RealTrialReport
}

function realTrialChapter(value: unknown, path: string): RealTrialChapterRecord {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  positive(result.legacyChapterId, `${path}.legacyChapterId`)
  identifier(result.bodyVersionId, `${path}.bodyVersionId`)
  fingerprint(result.contentHash, `${path}.contentHash`)
  for (const field of ['planningMinutes', 'writingMinutes', 'aiEditingMinutes', 'factReviewMinutes'] as const) integer(result[field], `${path}.${field}`, 0, 1_440)
  for (const field of ['diffAcceptedBlocks', 'diffRejectedBlocks', 'misappliedChanges', 'falsePositiveFindings', 'usefulFindings'] as const) integer(result[field], `${path}.${field}`, 0, 100_000)
  nullableNonnegativeNumber(result.modelCost, `${path}.modelCost`)
  integer(result.satisfaction, `${path}.satisfaction`, 1, 5)
  bool(result.continueNextChapter, `${path}.continueNextChapter`)
  text(result.bypassedFeatures, `${path}.bypassedFeatures`, 2_000)
  text(result.notes, `${path}.notes`, 10_000)
  const automatic = object(result.automatic, `${path}.automatic`)
  for (const field of ['autosaveCheckpoints', 'autosaveFinalized', 'autosaveConflicts', 'autosavePending', 'autosaveDiscarded', 'aiTasks', 'aiSucceeded', 'aiCancelled', 'aiFailed', 'aiInterrupted', 'aiRetries', 'contextEstimatedTokens', 'factCandidates', 'factDecisions', 'factBatchSubmittedDecisions', 'findings', 'findingDecisions', 'usefulFindings', 'falsePositiveFindings', 'diffAcceptedBlocks', 'diffRejectedBlocks'] as const) count(automatic[field], `${path}.automatic.${field}`)
  if (Number(automatic.autosaveFinalized) + Number(automatic.autosaveConflicts) + Number(automatic.autosavePending) + Number(automatic.autosaveDiscarded) !== Number(automatic.autosaveCheckpoints)) fail(`${path}.automatic.autosaveCheckpoints`)
  if (Number(automatic.factBatchSubmittedDecisions) > Number(automatic.factDecisions)) fail(`${path}.automatic.factBatchSubmittedDecisions`)
  date(result.createdAt, `${path}.createdAt`)
  date(result.updatedAt, `${path}.updatedAt`)
  return value as RealTrialChapterRecord
}

function realTrialConclusion(value: unknown, path: string): RealTrialConclusionRecord {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  oneOf(result.decision, ['continue', 'narrow', 'adjust'], `${path}.decision`)
  for (const field of ['highPriorityProblems', 'mediumPriorityProblems', 'lowPriorityProblems'] as const) text(result[field], `${path}.${field}`, 4_000)
  text(result.rationale, `${path}.rationale`, 10_000)
  text(result.nextScope, `${path}.nextScope`, 10_000)
  count(result.chapterCountAtDecision, `${path}.chapterCountAtDecision`)
  date(result.createdAt, `${path}.createdAt`)
  date(result.updatedAt, `${path}.updatedAt`)
  return value as RealTrialConclusionRecord
}

function nullable(decoder: IpcValueDecoder): IpcValueDecoder {
  return (value, path) => value === null ? value : decoder(value, path)
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path)
  return value as Record<string, unknown>
}

function boundedArray(value: unknown, path: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail(path)
  return value
}

function stringArray(value: unknown, path: string, maximumItems: number, maximumLength: number): string[] {
  const result = boundedArray(value, path, maximumItems)
  result.forEach((item, index) => text(item, `${path}[${index}]`, maximumLength))
  return value as string[]
}

function text(value: unknown, path: string, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum) fail(path)
  return value
}

function requiredText(value: unknown, path: string, maximum: number): string {
  const result = text(value, path, maximum)
  if (!result.trim()) fail(path)
  return result
}

function directoryPath(value: unknown, path: string): string {
  const result = text(value, path, 32_767)
  if (!result.trim()) fail(path)
  return result
}

function safeRelativePath(value: unknown, path: string): string {
  const result = text(value, path, 32_767)
  if (!result.trim() || /(^|[\\/])\.\.([\\/]|$)/.test(result) || /^[a-z]:[\\/]|^[\\/]{1,2}/i.test(result)) fail(path)
  return result
}

function identifier(value: unknown, path: string): string {
  const result = text(value, path, 256)
  if (!result.trim()) fail(path)
  return result
}

function nullableUuid(value: unknown, path: string): string | null {
  if (value === null) return null
  const result = identifier(value, path)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) fail(path)
  return result
}

function fingerprint(value: unknown, path: string): string {
  const result = text(value, path, 64)
  if (!/^[0-9a-f]{64}$/i.test(result)) fail(path)
  return result
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path)
  return value
}

function count(value: unknown, path: string): number {
  return integer(value, path, 0, Number.MAX_SAFE_INTEGER)
}

function positive(value: unknown, path: string): number {
  return integer(value, path, 1, Number.MAX_SAFE_INTEGER)
}

function integer(value: unknown, path: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(path)
  return Number(value)
}

function nonnegativeNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(path)
  return value
}

function nullableNonnegativeNumber(value: unknown, path: string): number | null {
  return value === null ? null : nonnegativeNumber(value, path)
}

function unitInterval(value: unknown, path: string): number {
  const result = nonnegativeNumber(value, path)
  if (result > 1) fail(path)
  return result
}

function nullableDate(value: unknown, path: string): string | null {
  return value === null ? null : date(value, path)
}

function date(value: unknown, path: string): string {
  const result = text(value, path, 100)
  if (!Number.isFinite(Date.parse(result))) fail(path)
  return result
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
