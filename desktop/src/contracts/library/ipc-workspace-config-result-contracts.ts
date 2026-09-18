import type {
  BookProfile,
  ContextBudgetPreferences,
  FoundationData,
  FoundationDraftProposal,
  FoundationStatus,
  PromptProfileView,
  RealmLevel,
  TimelineEvent
} from '../index'
import type { IpcValueDecoder } from '../core/ipc-result-contracts'
import { bookLengthLimits } from '../worldbuilding/book-length'

const bookProfileChannels = ['workspace:get-book-profile', 'workspace:save-book-profile']
const contextBudgetChannels = ['workspace:get-context-budget-preferences', 'workspace:save-context-budget-preferences']
const foundationChannels = ['workspace:get-foundation', 'workspace:save-foundation']
const timelineChannels = ['workspace:get-timeline', 'workspace:save-timeline']
const realmChannels = ['workspace:get-realms', 'workspace:save-realms']
const powerSystemChannels = ['workspace:get-power-system', 'workspace:save-power-system']
const cheatSystemChannels = ['workspace:get-cheat-system', 'workspace:save-cheat-system']
const systemTemplateChannels = ['workspace:get-system-template', 'workspace:save-system-template']
const promptProfileChannels = ['workspace:get-prompt-profile', 'workspace:save-prompt-override', 'workspace:reset-prompt-override']

export const workspaceConfigIpcValueDecoders: Readonly<Record<string, IpcValueDecoder>> = {
  ...Object.fromEntries(bookProfileChannels.map((channel) => [channel, bookProfile])),
  ...Object.fromEntries(contextBudgetChannels.map((channel) => [channel, contextBudgetPreferences])),
  ...Object.fromEntries(foundationChannels.map((channel) => [channel, foundation])),
  ...Object.fromEntries(timelineChannels.map((channel) => [channel, timelineEnvelope])),
  ...Object.fromEntries(realmChannels.map((channel) => [channel, realmEnvelope])),
  ...Object.fromEntries(powerSystemChannels.map((channel) => [channel, powerSystem])),
  ...Object.fromEntries(cheatSystemChannels.map((channel) => [channel, cheatSystem])),
  ...Object.fromEntries(systemTemplateChannels.map((channel) => [channel, systemTemplate])),
  ...Object.fromEntries(promptProfileChannels.map((channel) => [channel, promptProfile])),
  'workspace:generate-foundation-draft': foundationDraft,
  'workspace:get-foundation-status': foundationStatus,
  'workspace:recover-damaged-prompt-profile': promptProfileRecovery,
  'workspace:reveal-bootstrap-issue': bootstrapIssueReveal
}

function bookProfile(value: unknown, path: string): BookProfile {
  const result = object(value, path)
  if (result.revision !== undefined && (typeof result.revision !== 'string' || !/^[0-9a-f]{64}$/.test(result.revision))) fail(`${path}.revision`)
  requiredText(result.genre, `${path}.genre`, 80)
  text(result.subgenre, `${path}.subgenre`, 120)
  requiredText(result.coreIdea, `${path}.coreIdea`, 5_000)
  integer(result.plannedVolumes, `${path}.plannedVolumes`, 1, 100)
  integer(result.chaptersPerVolume, `${path}.chaptersPerVolume`, 1, 500)
  integer(result.targetWordsPerChapter, `${path}.targetWordsPerChapter`, 300, 50_000)
  integer(result.targetWords, `${path}.targetWords`, bookLengthLimits.minTotalWords, bookLengthLimits.maxTotalWords)
  for (const field of ['audienceScale', 'defaultPov', 'narrativeDistance', 'writingStyle'] as const) text(result[field], `${path}.${field}`, 2_000)
  oneOf(result.proseExpansionMode, ['web-serial', 'balanced', 'compact'], `${path}.proseExpansionMode`)
  oneOf(result.reviewStrictness, ['balanced', 'strict'], `${path}.reviewStrictness`)
  oneOf(result.chapterGenerationMode, ['reviewed'], `${path}.chapterGenerationMode`)
  bool(result.autosaveEnabled, `${path}.autosaveEnabled`)
  integer(result.autosaveDelayMs, `${path}.autosaveDelayMs`, 250, 60_000)
  integer(result.autosaveMergeWindowMs, `${path}.autosaveMergeWindowMs`, 1_000, 600_000)
  return value as BookProfile
}

function contextBudgetPreferences(value: unknown, path: string): ContextBudgetPreferences {
  const result = object(value, path)
  literal(result.version, 1, `${path}.version`)
  integer(result.inputBudgetTokens, `${path}.inputBudgetTokens`, 4_000, 1_000_000)
  integer(result.modelContextLimit, `${path}.modelContextLimit`, 16_000, 2_000_000)
  integer(result.outputReservePercent, `${path}.outputReservePercent`, 10, 60)
  integer(result.systemReserveTokens, `${path}.systemReserveTokens`, 1_000, 100_000)
  integer(result.recentSummaryCount, `${path}.recentSummaryCount`, 2, 5)
  integer(result.structuredRepairAttempts, `${path}.structuredRepairAttempts`, 0, 3)
  oneOf(result.minimumFactImportance, ['high', 'medium', 'low'], `${path}.minimumFactImportance`)
  bool(result.showFactConfirmations, `${path}.showFactConfirmations`)
  if (Number(result.modelContextLimit) - Math.floor(Number(result.modelContextLimit) * Number(result.outputReservePercent) / 100) - Number(result.systemReserveTokens) < 4_000) fail(`${path}.modelContextLimit`)
  const pinned = uniqueStringArray(result.pinnedEvidenceKeys, `${path}.pinnedEvidenceKeys`, 200, 300)
  const excluded = uniqueStringArray(result.excludedEvidenceKeys, `${path}.excludedEvidenceKeys`, 200, 300)
  if (pinned.some((key) => excluded.includes(key))) fail(`${path}.excludedEvidenceKeys`)
  if (result.alwaysConfirmBeforeSend !== undefined) bool(result.alwaysConfirmBeforeSend, `${path}.alwaysConfirmBeforeSend`)
  return value as ContextBudgetPreferences
}

function foundation(value: unknown, path: string): FoundationData {
  const result = object(value, path)
  oneOf(result.creationPath, ['research', 'materials'], `${path}.creationPath`)
  safeText(result.sourceNotes, `${path}.sourceNotes`, 100_000)
  safeText(result.worldView, `${path}.worldView`, 100_000)
  bool(result.useRealms, `${path}.useRealms`)
  bool(result.useSystem, `${path}.useSystem`)
  return value as FoundationData
}

function foundationDraft(value: unknown, path: string): FoundationDraftProposal {
  const result = object(value, path)
  requiredText(result.worldView, `${path}.worldView`, 100_000)
  const useRealms = bool(result.useRealms, `${path}.useRealms`)
  const levels = boundedArray(result.realms, `${path}.realms`, 100)
  levels.forEach((level, index) => realm(level, `${path}.realms[${index}]`))
  const useSystem = bool(result.useSystem, `${path}.useSystem`)
  const template = text(result.systemTemplate, `${path}.systemTemplate`, 100_000)
  requiredText(result.rationale, `${path}.rationale`, 20_000)
  if (useRealms && levels.length === 0) fail(`${path}.realms`)
  if (useSystem && !template.trim()) fail(`${path}.systemTemplate`)
  return value as FoundationDraftProposal
}

function foundationStatus(value: unknown, path: string): FoundationStatus {
  const result = object(value, path)
  const readyForChapterOutline = bool(result.readyForChapterOutline, `${path}.readyForChapterOutline`)
  const readyForProse = bool(result.readyForProse, `${path}.readyForProse`)
  const missing = stringArray(result.missing, `${path}.missing`, 100, 1_000)
  if (readyForProse && (!readyForChapterOutline || missing.length > 0)) fail(path)
  return value as FoundationStatus
}

function timelineEnvelope(value: unknown, path: string): unknown {
  const result = object(value, path)
  boundedArray(result.events, `${path}.events`, 10_000).forEach((event, index) => timelineEvent(event, `${path}.events[${index}]`))
  return value
}

function timelineEvent(value: unknown, path: string): TimelineEvent {
  const result = object(value, path)
  requiredText(result.id, `${path}.id`, 128)
  if (result.title !== undefined) text(result.title, `${path}.title`, 200)
  requiredText(result.time, `${path}.time`, 200)
  requiredText(result.characters, `${path}.characters`, 1_000)
  requiredText(result.location, `${path}.location`, 500)
  requiredText(result.event, `${path}.event`, 20_000)
  if (result.result !== undefined) text(result.result, `${path}.result`, 20_000)
  return value as TimelineEvent
}

function realmEnvelope(value: unknown, path: string): unknown {
  const result = object(value, path)
  boundedArray(result.levels, `${path}.levels`, 1_000).forEach((level, index) => realm(level, `${path}.levels[${index}]`))
  return value
}

function realm(value: unknown, path: string): RealmLevel {
  const result = object(value, path)
  requiredText(result.id, `${path}.id`, 128)
  requiredText(result.name, `${path}.name`, 120)
  requiredText(result.description, `${path}.description`, 5_000)
  return value as RealmLevel
}

function powerSystem(value: unknown, path: string): unknown {
  text(object(value, path).overview, `${path}.overview`, 1_000_000)
  return value
}

function cheatSystem(value: unknown, path: string): unknown {
  text(object(value, path).overview, `${path}.overview`, 100_000)
  return value
}

function systemTemplate(value: unknown, path: string): unknown {
  text(object(value, path).template, `${path}.template`, 100_000)
  return value
}

function promptProfile(value: unknown, path: string): PromptProfileView {
  rejectSecretFields(value, path)
  const result = object(value, path)
  literal(result.version, 1, `${path}.version`)
  requiredText(result.workItemId, `${path}.workItemId`, 32_767)
  requiredText(result.genreLabel, `${path}.genreLabel`, 500)
  fingerprint(result.genreFingerprint, `${path}.genreFingerprint`)
  fingerprint(result.storedGenreFingerprint, `${path}.storedGenreFingerprint`)
  bool(result.baselineChanged, `${path}.baselineChanged`)
  const storageMode = oneOf(result.storageMode, ['files', 'sqlite'], `${path}.storageMode`)
  if (result.mirrorStatus !== null) oneOf(result.mirrorStatus, ['pending', 'synced', 'conflict', 'failed'], `${path}.mirrorStatus`)
  if (storageMode === 'files' && result.mirrorStatus !== null) fail(`${path}.mirrorStatus`)
  const entries = boundedArray(result.entries, `${path}.entries`, 4)
  const tasks = entries.map((entry, index) => promptTemplate(entry, `${path}.entries[${index}]`))
  if (entries.length !== 4 || new Set(tasks).size !== 4 || !['outline', 'chapterOutline', 'prose', 'review'].every((task) => tasks.includes(task))) fail(`${path}.entries`)
  return value as PromptProfileView
}

function promptTemplate(value: unknown, path: string): string {
  const result = object(value, path)
  const task = oneOf(result.task, ['outline', 'chapterOutline', 'prose', 'review'], `${path}.task`)
  requiredText(result.label, `${path}.label`, 500)
  requiredText(result.description, `${path}.description`, 5_000)
  const builtIn = requiredText(result.builtIn, `${path}.builtIn`, 100_000)
  const override = text(result.override, `${path}.override`, 50_000)
  const effective = requiredText(result.effective, `${path}.effective`, 100_000)
  const customized = bool(result.customized, `${path}.customized`)
  if (customized ? (!override.trim() || effective !== override) : (override !== '' || effective !== builtIn)) fail(path)
  stringArray(result.guardrails, `${path}.guardrails`, 100, 10_000)
  const layers = boundedArray(result.authorityLayers, `${path}.authorityLayers`, 5)
  const ids = layers.map((layer, index) => promptAuthorityLayer(layer, `${path}.authorityLayers[${index}]`))
  if (layers.length !== 5 || new Set(ids).size !== layers.length
    || !['guardrails', 'canon', 'taskContext', 'taskStrategy', 'materials'].every((id) => ids.includes(id))) fail(`${path}.authorityLayers`)
  return task
}

function promptAuthorityLayer(value: unknown, path: string): string {
  const result = object(value, path)
  const id = oneOf(result.id, ['guardrails', 'canon', 'taskContext', 'taskStrategy', 'materials'], `${path}.id`)
  integer(result.order, `${path}.order`, 0, 10_000)
  requiredText(result.label, `${path}.label`, 500)
  requiredText(result.source, `${path}.source`, 5_000)
  requiredText(result.summary, `${path}.summary`, 10_000)
  return id
}

function promptProfileRecovery(value: unknown, path: string): unknown {
  const result = object(value, path)
  literal(result.success, true, `${path}.success`)
  safeRelativePath(result.recoveryRelativePath, `${path}.recoveryRelativePath`)
  return value
}

function bootstrapIssueReveal(value: unknown, path: string): unknown {
  const result = object(value, path)
  literal(result.success, true, `${path}.success`)
  oneOf(result.relativePath, [
    '.webnovel/planning/automatic-planning-draft.json',
    '.webnovel/config/prompt-profile.json',
    '.webnovel/research/sources.json',
    '.webnovel/research/events.json',
    '.webnovel/planning/outline-state.json',
    '.webnovel/story-state/characters.json',
    '.webnovel/manuscript/chapter-order.json'
  ], `${path}.relativePath`)
  return value
}

function rejectSecretFields(value: unknown, path: string): void {
  if (Array.isArray(value)) return value.forEach((item, index) => rejectSecretFields(item, `${path}[${index}]`))
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (['apiKey', 'encryptedApiKey'].includes(key)) fail(`${path}.${key}`)
    rejectSecretFields(item, `${path}.${key}`)
  }
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

function uniqueStringArray(value: unknown, path: string, maximumItems: number, maximumLength: number): string[] {
  const result = stringArray(value, path, maximumItems, maximumLength)
  if (result.some((item) => !item.trim()) || new Set(result).size !== result.length) fail(path)
  return result
}

function text(value: unknown, path: string, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum) fail(path)
  return value
}

function safeText(value: unknown, path: string, maximum: number): string {
  const result = text(value, path, maximum)
  if (result.includes('\0')) fail(path)
  return result
}

function requiredText(value: unknown, path: string, maximum: number): string {
  const result = text(value, path, maximum)
  if (!result.trim()) fail(path)
  return result
}

function fingerprint(value: unknown, path: string): string {
  const result = text(value, path, 64)
  if (!/^[0-9a-f]{64}$/i.test(result)) fail(path)
  return result
}

function safeRelativePath(value: unknown, path: string): string {
  const result = text(value, path, 32_767)
  if (!result.trim() || /(^|[\\/])\.\.([\\/]|$)/.test(result) || /^[a-z]:[\\/]|^[\\/]{1,2}/i.test(result)) fail(path)
  return result
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path)
  return value
}

function integer(value: unknown, path: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(path)
  return Number(value)
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
