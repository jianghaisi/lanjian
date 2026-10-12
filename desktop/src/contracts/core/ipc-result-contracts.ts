import { decodeChapterStoryConstraints } from '../planning/chapter-story-contract'
import { decodeLiteraryFindings } from '../review/literary-findings'
import { decodeChapterUpstreamReview } from '../planning/upstream-review-contracts'
import { fieldAssistantResultDecoders } from '../assistant/field-assistant-contracts'
import { assistantConversationResultDecoders } from '../assistant/assistant-conversation-contracts'
import { assistantRunResultDecoders, decodeAssistantRunView } from '../assistant/assistant-run-contracts'
import { decodeAuthorAnswerReceipt, interactionArray } from '../assistant/author-interaction-contracts'
import { writingPluginResultDecoders } from '../writing-plugins/management-contracts'
import { authoringResultDecoders } from '../writing-plugins/authoring'
import { marketplaceResultDecoders } from '../writing-plugins/marketplace'
import { bundledPluginResultDecoders } from '../writing-plugins/bundled'
export type IpcValueDecoder = (value: unknown, path: string) => unknown

const planningStatusChannels = [
  'outlines:decide-upstream-review', 'outlines:planning-status', 'outlines:acknowledge-review', 'outlines:confirm-planning',
  'outlines:assign-event', 'outlines:unassign-event', 'outlines:create-volume', 'outlines:rename-volume',
  'outlines:place-event', 'outlines:place-event-in-chapter', 'outlines:place-chapter', 'outlines:confirm-chapter'
]
const writingTaskChannels = [
  'ai:start-writing-agent', 'ai:writing-agent-task', 'ai:pause-writing-agent-task',
  'ai:resume-writing-agent-task', 'ai:cancel-writing-agent-task', 'ai:retry-writing-agent-task',
  'ai:dismiss-writing-agent-task', 'ai:decide-writing-agent-artifact'
]
const factJobChannels = [
  'workspace:start-fact-extraction', 'workspace:fact-extraction-job',
  'workspace:cancel-fact-extraction', 'workspace:retry-fact-extraction'
]

export const workflowIpcValueDecoders: Readonly<Record<string, IpcValueDecoder>> = {
  ...writingPluginResultDecoders,
  ...authoringResultDecoders,
  ...marketplaceResultDecoders,
  ...bundledPluginResultDecoders,
  ...fieldAssistantResultDecoders,
  ...assistantConversationResultDecoders,
  ...assistantRunResultDecoders,
  'assistant-runs:recent': value => interactionArray(value, 100, decodeAssistantRunView),
  'author-interactions:answer': decodeAuthorAnswerReceipt,
  'projects:sqlite-shadow-preview': migrationPreview('shadow'),
  'projects:sqlite-shadow-import': migrationCommit('shadow'),
  'projects:sqlite-storage-status': sqliteStorageStatus,
  'projects:sqlite-activation-preview': migrationPreview('activation'),
  'projects:sqlite-activation-commit': migrationCommit('activation'),
  'projects:sqlite-mirrors-retry': countRecord(['pending', 'conflicts', 'failed']),
  'projects:readable-mirrors-rebuild': countRecord(['checked', 'recreated', 'upToDate', 'conflicts', 'failed']),
  'projects:sqlite-storage-rollback': migrationCommit('rollback'),
  'chapters:get-planning': nullable(chapterPlanning),
  'chapters:update-planning': chapterPlanning,
  'outlines:list': outlineList,
  'outlines:get-planned-chapter': plannedChapter,
  'outlines:update-planned-chapter': plannedChapter,
  'outlines:start-planned-chapter': plannedChapterStart,
  'outlines:get': outlineDocument,
  'outlines:update': outlineUpdate,
  'outlines:tree': outlineTree,
  'outlines:create-stage': stageUpdate,
  'outlines:update-stage': stageUpdate,
  'outlines:place-chapter-in-stage': stageUpdate,
  'outlines:review-chapter': chapterReview,
  'chapter-outlines:list': listOf(chapterOutlineDocument),
  'chapter-outlines:get': chapterOutlineDocument,
  'chapter-outlines:update': chapterOutlineDocument,
  'ai:run-writing-agent': writingTurn,
  'ai:preview-writing-agent-context': writingContextPreview,
  'ai:list-writing-agent-tasks': listOf(writingTask),
  'ai:settle-writing-agent': characterStateResult,
  'workspace:get-context-fact-pack': contextFactPack,
  'workspace:list-fact-batches': listOf(factBatch),
  'workspace:decide-fact-changes': factBatch,
  'workspace:list-fact-extraction-jobs': listOf(factJob),
  'workspace:approved-facts-before': listOf(approvedFact),
  ...Object.fromEntries(planningStatusChannels.map((channel) => [channel, planningStatusResult])),
  ...Object.fromEntries(writingTaskChannels.map((channel) => [channel, writingTask])),
  ...Object.fromEntries(factJobChannels.map((channel) => [channel, factJob]))
}

function migrationPreview(kind: 'shadow' | 'activation'): IpcValueDecoder {
  return (value, path) => {
    const result = object(value, path)
    nullableIdentifier(result.token, `${path}.token`)
    bool(result[kind === 'shadow' ? 'canImport' : 'canActivate'], `${path}.${kind === 'shadow' ? 'canImport' : 'canActivate'}`)
    if (kind === 'shadow') text(result.targetRelativePath, `${path}.targetRelativePath`, 32_767)
    count(result.chapterCount, `${path}.chapterCount`)
    count(result.totalWords, `${path}.totalWords`)
    nullableDate(result.expiresAt, `${path}.expiresAt`)
    array(result.blockers, `${path}.blockers`).forEach((item, index) => {
      const blocker = object(item, `${path}.blockers[${index}]`)
      text(blocker.code, `${path}.blockers[${index}].code`, 100)
      text(blocker.message, `${path}.blockers[${index}].message`, 10_000)
    })
    return value
  }
}

function migrationCommit(kind: 'shadow' | 'activation' | 'rollback'): IpcValueDecoder {
  return (value, path) => {
    const result = object(value, path)
    literal(result.storageMode, kind === 'activation' ? 'sqlite' : 'shadow', `${path}.storageMode`)
    count(result.chapterCount, `${path}.chapterCount`)
    literal(result.verified, true, `${path}.verified`)
    if (kind === 'shadow') {
      text(result.targetRelativePath, `${path}.targetRelativePath`, 32_767)
      literal(result.sourceFilesChanged, false, `${path}.sourceFilesChanged`)
      count(result.insertedVersions, `${path}.insertedVersions`)
      count(result.unchangedVersions, `${path}.unchangedVersions`)
    } else if (kind === 'activation') {
      count(result.pendingMirrors, `${path}.pendingMirrors`)
      count(result.conflicts, `${path}.conflicts`)
    }
    return value
  }
}

function sqliteStorageStatus(value: unknown, path: string): unknown {
  const result = object(value, path)
  if (result.textAuthority !== undefined) oneOf(result.textAuthority, ['legacy-sqlite', 'files-v1'], `${path}.textAuthority`)
  oneOf(result.storageMode, ['files', 'shadow', 'sqlite'], `${path}.storageMode`)
  bool(result.databaseExists, `${path}.databaseExists`)
  count(result.chapterCount, `${path}.chapterCount`)
  count(result.outlineCount, `${path}.outlineCount`)
  oneOf(result.outlineStorageMode, ['files', 'sqlite'], `${path}.outlineStorageMode`)
  oneOf(result.promptStorageMode, ['files', 'sqlite'], `${path}.promptStorageMode`)
  nullableEnum(result.promptMirrorStatus, ['pending', 'synced', 'conflict', 'failed'], `${path}.promptMirrorStatus`)
  for (const field of ['outlinePendingMirrors', 'outlineConflictMirrors', 'outlineFailedMirrors', 'pendingMirrors', 'conflictMirrors', 'failedMirrors']) count(result[field], `${path}.${field}`)
  return value
}

function outlineList(value: unknown, path: string): unknown {
  const result = object(value, path)
  if (result.total !== null) text(object(result.total, `${path}.total`).content, `${path}.total.content`, 2_000_000)
  array(result.volumes, `${path}.volumes`).forEach((item, index) => volumeOutline(item, `${path}.volumes[${index}]`))
  if (result.stages !== undefined) array(result.stages, `${path}.stages`).forEach((item, index) => stageOutline(item, `${path}.stages[${index}]`))
  if (result.chapterOutlines !== undefined) array(result.chapterOutlines, `${path}.chapterOutlines`).forEach((item, index) => chapterOutlineEntry(item, `${path}.chapterOutlines[${index}]`))
  return value
}

function volumeOutline(value: unknown, path: string): unknown {
  const result = object(value, path)
  positive(result.volume, `${path}.volume`)
  text(result.title, `${path}.title`, 200)
  text(result.content, `${path}.content`, 2_000_000)
  return value
}

function stageOutline(value: unknown, path: string): unknown {
  const result = object(value, path)
  positive(result.stage, `${path}.stage`)
  positive(result.volume, `${path}.volume`)
  text(result.title, `${path}.title`, 200)
  text(result.content, `${path}.content`, 2_000_000)
  array(result.chapterIds, `${path}.chapterIds`).forEach((item, index) => positive(item, `${path}.chapterIds[${index}]`))
  if (result.mirrorStatus !== undefined) mirrorStatus(result.mirrorStatus, `${path}.mirrorStatus`)
  return value
}

function chapterOutlineEntry(value: unknown, path: string): unknown {
  const result = object(value, path)
  positive(result.chapterId, `${path}.chapterId`)
  text(result.title, `${path}.title`, 200)
  fingerprint(result.revision, `${path}.revision`)
  nullablePositive(result.volume, `${path}.volume`)
  nullablePositive(result.stage, `${path}.stage`)
  bool(result.hasManuscript, `${path}.hasManuscript`)
  mirrorStatus(result.mirrorStatus, `${path}.mirrorStatus`)
  return value
}

function plannedChapter(value: unknown, path: string): unknown {
  chapterOutlineEntry(value, path)
  text(object(value, path).content, `${path}.content`, 2_000_000)
  return value
}

function plannedChapterStart(value: unknown, path: string): unknown {
  const result = object(value, path)
  chapterShape(result.chapter, `${path}.chapter`)
  bool(result.created, `${path}.created`)
  bool(result.mirrorPending, `${path}.mirrorPending`)
  return value
}

function outlineDocument(value: unknown, path: string): unknown {
  const result = object(value, path)
  text(result.content, `${path}.content`, 2_000_000)
  if (result.volume !== undefined) positive(result.volume, `${path}.volume`)
  return value
}

function outlineUpdate(value: unknown, path: string): unknown {
  const result = object(value, path)
  literal(result.success, true, `${path}.success`)
  outlineScope(result.volume, `${path}.volume`)
  text(result.content, `${path}.content`, 2_000_000)
  if (result.storageMode !== undefined) oneOf(result.storageMode, ['files', 'sqlite'], `${path}.storageMode`)
  if (result.mirrorStatus !== undefined) mirrorStatus(result.mirrorStatus, `${path}.mirrorStatus`)
  return value
}

function outlineTree(value: unknown, path: string): unknown {
  const result = object(value, path)
  array(result.volumes, `${path}.volumes`).forEach((item, index) => volumeOutline(item, `${path}.volumes[${index}]`))
  return value
}

function stageUpdate(value: unknown, path: string): unknown {
  const result = object(value, path)
  literal(result.success, true, `${path}.success`)
  literal(result.storageMode, 'sqlite', `${path}.storageMode`)
  if (result.stage !== null) stageOutline(result.stage, `${path}.stage`)
  return value
}

export function planningStatusResult(value: unknown, path: string): unknown {
  const result = object(value, path)
  count(result.totalRevision, `${path}.totalRevision`)
  bool(result.totalOutlineExists, `${path}.totalOutlineExists`)
  bool(result.externalChangeDetected, `${path}.externalChangeDetected`)
  planningReview(result.totalReview, `${path}.totalReview`)
  planningApproval(result.totalApproval, `${path}.totalApproval`)
  for (const field of ['assignedEventIds', 'unplacedEventIds'] as const) stringArray(result[field], `${path}.${field}`, 256)
  array(result.volumes, `${path}.volumes`).forEach((item, index) => planningVolume(item, `${path}.volumes[${index}]`))
  array(result.chapterPlacements, `${path}.chapterPlacements`).forEach((item, index) => {
    const placement = object(item, `${path}.chapterPlacements[${index}]`)
    positive(placement.chapterId, `${path}.chapterPlacements[${index}].chapterId`)
    positive(placement.volume, `${path}.chapterPlacements[${index}].volume`)
  })
  array(result.eventChapterPlacements, `${path}.eventChapterPlacements`).forEach((item, index) => {
    const placement = object(item, `${path}.eventChapterPlacements[${index}]`)
    identifier(placement.eventId, `${path}.eventChapterPlacements[${index}].eventId`)
    positive(placement.chapterId, `${path}.eventChapterPlacements[${index}].chapterId`)
  })
  if (result.chapter !== undefined) chapterPlanningStatus(result.chapter, `${path}.chapter`)
  return value
}

function planningVolume(value: unknown, path: string): void {
  const result = object(value, path)
  positive(result.volume, `${path}.volume`)
  text(result.title, `${path}.title`, 200)
  stringArray(result.eventIds, `${path}.eventIds`, 256)
  oneOf(result.origin, ['planned', 'existing-outline'], `${path}.origin`)
  count(result.revision, `${path}.revision`)
  bool(result.outlineExists, `${path}.outlineExists`)
  bool(result.externalChangeDetected, `${path}.externalChangeDetected`)
  planningReview(result.review, `${path}.review`)
  planningApproval(result.approval, `${path}.approval`)
}

function planningReview(value: unknown, path: string): void {
  const result = object(value, path)
  outlineScope(result.scope, `${path}.scope`)
  oneOf(result.status, ['clear', 'attention', 'acknowledged'], `${path}.status`)
  array(result.issues, `${path}.issues`).forEach((item, index) => {
    const issue = object(item, `${path}.issues[${index}]`)
    text(issue.code, `${path}.issues[${index}].code`, 100)
    oneOf(issue.level, ['warning', 'info'], `${path}.issues[${index}].level`)
    text(issue.message, `${path}.issues[${index}].message`, 10_000)
    text(issue.suggestion, `${path}.issues[${index}].suggestion`, 10_000)
  })
  countRecord(['characterCount', 'sectionCount', 'causalCueCount', 'eventCount', 'chapterCount'])(result.metrics, `${path}.metrics`)
  fingerprint(result.fingerprint, `${path}.fingerprint`)
  if (result.acknowledgedAt !== undefined) date(result.acknowledgedAt, `${path}.acknowledgedAt`)
}

function planningApproval(value: unknown, path: string): void {
  const result = object(value, path)
  outlineScope(result.scope, `${path}.scope`)
  oneOf(result.status, ['missing', 'needs-review', 'blocked', 'ready', 'confirmed', 'stale'], `${path}.status`)
  bool(result.canConfirm, `${path}.canConfirm`)
  text(result.reason, `${path}.reason`, 10_000)
  fingerprint(result.fingerprint, `${path}.fingerprint`, true)
  if (result.confirmedAt !== undefined) date(result.confirmedAt, `${path}.confirmedAt`)
}

function chapterPlanningStatus(value: unknown, path: string): void {
  const result = object(value, path)
  positive(result.chapterId, `${path}.chapterId`)
  bool(result.hasContent, `${path}.hasContent`)
  if (result.volume !== undefined) positive(result.volume, `${path}.volume`)
  for (const field of ['basedOnTotalRevision', 'basedOnVolumeRevision', 'volumeRevision'] as const) if (result[field] !== undefined) count(result[field], `${path}.${field}`)
  bool(result.stale, `${path}.stale`)
  oneOf(result.reason, ['missing', 'untracked', 'current', 'upstream-changed'], `${path}.reason`)
  chapterReview(result.review, `${path}.review`)
  if (result.contractVersion !== undefined) {
    const version = object(result.contractVersion, `${path}.contractVersion`)
    if (version.storyConstraints !== undefined) { try { decodeChapterStoryConstraints(version.storyConstraints) } catch { invalid(`${path}.contractVersion.storyConstraints`) } }
    for (const field of ['fingerprint', 'totalFingerprint', 'outlineHash'] as const) fingerprint(version[field], `${path}.contractVersion.${field}`)
    if (version.volumeFingerprint !== undefined) fingerprint(version.volumeFingerprint, `${path}.contractVersion.volumeFingerprint`)
    stringArray(version.eventIds, `${path}.contractVersion.eventIds`, 256)
    if (version.eventApprovedRevision !== undefined) fingerprint(version.eventApprovedRevision, `${path}.contractVersion.eventApprovedRevision`)
    if (version.eventVersions !== undefined) array(version.eventVersions, `${path}.contractVersion.eventVersions`).forEach((item, index) => {
      const event = object(item, `${path}.contractVersion.eventVersions[${index}]`)
      identifier(event.eventId, `${path}.contractVersion.eventVersions[${index}].eventId`)
      identifier(event.versionId, `${path}.contractVersion.eventVersions[${index}].versionId`)
      oneOf(event.phase, ['planned', 'realized', 'deviated', 'legacy-unknown'], `${path}.contractVersion.eventVersions[${index}].phase`)
    })
    date(version.confirmedAt, `${path}.contractVersion.confirmedAt`)
  }
}

function chapterReview(value: unknown, path: string): unknown {
  const result = object(value, path)
  if (result.upstream !== undefined) decodeChapterUpstreamReview(result.upstream)
  oneOf(result.status, ['missing', 'needs-changes', 'ready', 'confirmed', 'stale'], `${path}.status`)
  bool(result.canConfirm, `${path}.canConfirm`)
  array(result.issues, `${path}.issues`).forEach((item, index) => {
    const issue = object(item, `${path}.issues[${index}]`)
    text(issue.code, `${path}.issues[${index}].code`, 100)
    oneOf(issue.level, ['error', 'warning'], `${path}.issues[${index}].level`)
    text(issue.message, `${path}.issues[${index}].message`, 10_000)
  })
  countRecord(['beatCount', 'forbiddenCount', 'formalEventCount', 'boundaryCount', 'foreshadowCount'])(result.metrics, `${path}.metrics`)
  if (result.confirmedAt !== undefined) date(result.confirmedAt, `${path}.confirmedAt`)
  return value
}

function chapterPlanning(value: unknown, path: string): unknown {
  const result = object(value, path)
  positive(result.legacyChapterId, `${path}.legacyChapterId`)
  nullableIdentifier(result.outlineLegacyKey, `${path}.outlineLegacyKey`)
  oneOf(result.lifecycleStatus, ['PLANNED', 'DRAFTING', 'REVIEWABLE', 'CONFIRMED', 'REVISING', 'ARCHIVED'], `${path}.lifecycleStatus`)
  nullableEnum(result.archivedFromStatus, ['PLANNED', 'DRAFTING', 'REVIEWABLE', 'CONFIRMED', 'REVISING'], `${path}.archivedFromStatus`)
  identifier(result.currentBodyVersionId, `${path}.currentBodyVersionId`)
  nullableIdentifier(result.confirmedBodyVersionId, `${path}.confirmedBodyVersionId`)
  nullableDate(result.confirmedAt, `${path}.confirmedAt`)
  bool(result.hasUnconfirmedChanges, `${path}.hasUnconfirmedChanges`)
  const card = object(result.card, `${path}.card`)
  oneOf(card.status, ['empty', 'draft', 'confirmed'], `${path}.card.status`)
  for (const field of ['goal', 'entryState', 'conflict', 'pointOfView', 'narrativeDistance', 'exitChange', 'hook'] as const) text(card[field], `${path}.card.${field}`, 10_000)
  stringArray(card.beats, `${path}.card.beats`, 10_000)
  stringArray(card.characters, `${path}.card.characters`, 500)
  return value
}

function chapterOutlineDocument(value: unknown, path: string): unknown {
  const result = object(value, path)
  positive(result.chapterId, `${path}.chapterId`)
  text(result.content, `${path}.content`, 2_000_000)
  if (result.storageMode !== undefined) oneOf(result.storageMode, ['files', 'sqlite'], `${path}.storageMode`)
  if (result.mirrorStatus !== undefined) mirrorStatus(result.mirrorStatus, `${path}.mirrorStatus`)
  return value
}

function writingContextPreview(value: unknown, path: string): unknown {
  const result = object(value, path)
  literal(result.version, 1, `${path}.version`)
  identifier(result.workItemId, `${path}.workItemId`)
  positive(result.chapterId, `${path}.chapterId`)
  writingSkill(result.skill, `${path}.skill`)
  oneOf(result.status, ['ready', 'blocked'], `${path}.status`)
  for (const field of ['tokenBudget', 'estimatedTokens', 'remainingTokens'] as const) count(result[field], `${path}.${field}`)
  bool(result.truncated, `${path}.truncated`)
  fingerprint(result.contentHash, `${path}.contentHash`)
  array(result.items, `${path}.items`).forEach((item, index) => {
    const context = object(item, `${path}.items[${index}]`)
    for (const field of ['id', 'label', 'sourceType', 'preview'] as const) text(context[field], `${path}.items[${index}].${field}`, field === 'preview' ? 2_000_000 : 10_000)
    oneOf(context.authority, ['required', 'pinned', 'related', 'optional'], `${path}.items[${index}].authority`)
    bool(context.included, `${path}.items[${index}].included`)
    bool(context.required, `${path}.items[${index}].required`)
    oneOf(context.mode, ['full', 'compressed', 'truncated', 'excluded'], `${path}.items[${index}].mode`)
    count(context.estimatedTokens, `${path}.items[${index}].estimatedTokens`)
    count(context.characters, `${path}.items[${index}].characters`)
    stringArray(context.reasons, `${path}.items[${index}].reasons`, 10_000)
  })
  if (result.blockedMessage !== undefined) text(result.blockedMessage, `${path}.blockedMessage`, 10_000)
  return value
}

function writingTask(value: unknown, path: string): unknown {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  identifier(result.workItemId, `${path}.workItemId`)
  positive(result.chapterId, `${path}.chapterId`)
  oneOf(result.status, ['queued', 'resuming', 'preparing', 'running', 'streaming', 'paused', 'succeeded', 'cancelled', 'failed', 'interrupted'], `${path}.status`)
  positive(result.attempt, `${path}.attempt`)
  text(result.message, `${path}.message`, 100_000)
  text(result.baseDraft, `${path}.baseDraft`, 2_000_000)
  for (const field of ['parentTaskRunId', 'model'] as const) if (result[field] !== undefined) identifier(result[field], `${path}.${field}`)
  for (const field of ['preferredSkill', 'skill'] as const) if (result[field] !== undefined) writingSkill(result[field], `${path}.${field}`)
  if (result.selection !== undefined) selection(result.selection, `${path}.selection`)
  if (result.insertionAnchor !== undefined) insertionAnchor(result.insertionAnchor, `${path}.insertionAnchor`)
  for (const field of ['startedAt', 'completedAt'] as const) if (result[field] !== undefined) date(result[field], `${path}.${field}`)
  if (result.error !== undefined) errorSummary(result.error, `${path}.error`)
  if (result.artifact !== undefined) artifactRef(result.artifact, `${path}.artifact`)
  if (result.partial !== undefined) {
    const partial = object(result.partial, `${path}.partial`)
    artifactRef(partial, `${path}.partial`)
    text(partial.content, `${path}.partial.content`, 2_000_000)
    date(partial.updatedAt, `${path}.partial.updatedAt`)
  }
  if (result.contextPackage !== undefined) contextPackage(result.contextPackage, `${path}.contextPackage`)
  if (result.turn !== undefined) writingTurn(result.turn, `${path}.turn`)
  return value
}

function writingTurn(value: unknown, path: string): unknown {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  identifier(result.workItemId, `${path}.workItemId`)
  positive(result.chapterId, `${path}.chapterId`)
  date(result.createdAt, `${path}.createdAt`)
  identifier(result.model, `${path}.model`)
  if (result.chapterCardFingerprint !== undefined) fingerprint(result.chapterCardFingerprint, `${path}.chapterCardFingerprint`)
  const skill = object(result.skill, `${path}.skill`)
  writingSkill(skill.id, `${path}.skill.id`)
  text(skill.label, `${path}.skill.label`, 200)
  text(result.answer, `${path}.answer`, 2_000_000)
  array(result.tools, `${path}.tools`).forEach((item, index) => {
    const tool = object(item, `${path}.tools[${index}]`)
    oneOf(tool.id, ['currentChapter', 'chapterContract', 'contextFacts', 'consistencyGate'], `${path}.tools[${index}].id`)
    text(tool.label, `${path}.tools[${index}].label`, 200)
    text(tool.summary, `${path}.tools[${index}].summary`, 10_000)
  })
  if (result.candidate !== undefined) writingCandidate(result.candidate, `${path}.candidate`)
  if (result.chapterCardOptions !== undefined) array(result.chapterCardOptions, `${path}.chapterCardOptions`).forEach((item, index) => chapterCardOption(item, `${path}.chapterCardOptions[${index}]`))
  if (result.proposal !== undefined) chapterProposal(result.proposal, `${path}.proposal`)
  return value
}

function writingCandidate(value: unknown, path: string): void {
  const result = object(value, path)
  oneOf(result.mode, ['append', 'replaceSelection', 'insertAtAnchor'], `${path}.mode`)
  text(result.content, `${path}.content`, 2_000_000)
  fingerprint(result.baseDraftFingerprint, `${path}.baseDraftFingerprint`)
  if (result.selection !== undefined) selection(result.selection, `${path}.selection`)
  if (result.insertionAnchor !== undefined) insertionAnchor(result.insertionAnchor, `${path}.insertionAnchor`)
  if (result.diff !== undefined) array(result.diff, `${path}.diff`).forEach((item, index) => {
    const block = object(item, `${path}.diff[${index}]`)
    identifier(block.id, `${path}.diff[${index}].id`)
    oneOf(block.kind, ['equal', 'change'], `${path}.diff[${index}].kind`)
    text(block.before, `${path}.diff[${index}].before`, 2_000_000)
    text(block.after, `${path}.diff[${index}].after`, 2_000_000)
  })
}

function chapterCardOption(value: unknown, path: string): void {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  text(result.title, `${path}.title`, 200)
  text(result.rationale, `${path}.rationale`, 10_000)
  for (const field of ['goal', 'conflict', 'exitChange', 'hook'] as const) if (result[field] !== undefined) text(result[field], `${path}.${field}`, 10_000)
  for (const field of ['beats', 'characters'] as const) if (result[field] !== undefined) stringArray(result[field], `${path}.${field}`, 10_000)
}

function chapterProposal(value: unknown, path: string): void {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  positive(result.chapterId, `${path}.chapterId`)
  date(result.createdAt, `${path}.createdAt`)
  text(result.content, `${path}.content`, 2_000_000)
  object(result.contract, `${path}.contract`)
  const report = object(result.report, `${path}.report`)
  bool(report.passed, `${path}.report.passed`)
  text(report.summary, `${path}.report.summary`, 100_000)
  if (report.literaryFindings !== undefined) {
    const findings = decodeLiteraryFindings(report.literaryFindings, `${path}.report.literaryFindings`)
    if (report.passed && findings.some(finding => finding.severity === 'blocking')) invalid(`${path}.report.passed`)
  }
}

function contextPackage(value: unknown, path: string): void {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  identifier(result.compilerVersion, `${path}.compilerVersion`)
  fingerprint(result.contentHash, `${path}.contentHash`)
  for (const field of ['tokenBudget', 'estimatedTokens', 'characterCount', 'contextCount'] as const) count(result[field], `${path}.${field}`)
  bool(result.truncated, `${path}.truncated`)
  date(result.createdAt, `${path}.createdAt`)
  writingSkill(result.skill, `${path}.skill`)
  array(result.contexts, `${path}.contexts`)
}

export function characterStateResult(value: unknown, path: string): unknown {
  const result = object(value, path)
  literal(result.version, 1, `${path}.version`)
  identifier(result.workItemId, `${path}.workItemId`)
  for (const field of ['anchors', 'events', 'snapshots', 'pendingConflicts'] as const) array(result[field], `${path}.${field}`)
  return value
}

function factBatch(value: unknown, path: string): unknown {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  identifier(result.workItemId, `${path}.workItemId`)
  positive(result.chapterId, `${path}.chapterId`)
  identifier(result.bodyVersionId, `${path}.bodyVersionId`)
  fingerprint(result.contentHash, `${path}.contentHash`)
  oneOf(result.status, ['PENDING', 'IN_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'SUPERSEDED', 'STALE'], `${path}.status`)
  nullableIdentifier(result.extractorTaskRunId, `${path}.extractorTaskRunId`)
  jsonText(result.countsJson, `${path}.countsJson`)
  array(result.changes, `${path}.changes`).forEach((item, index) => factChange(item, `${path}.changes[${index}]`))
  date(result.createdAt, `${path}.createdAt`)
  date(result.updatedAt, `${path}.updatedAt`)
  return value
}

function factChange(value: unknown, path: string): void {
  const result = object(value, path)
  for (const field of ['id', 'batchId', 'candidateType', 'subjectType', 'predicate', 'normalizedKey'] as const) identifier(result[field], `${path}.${field}`)
  nullableIdentifier(result.subjectId, `${path}.subjectId`)
  for (const field of ['subjectJson', 'objectJson', 'evidenceJson'] as const) jsonText(result[field], `${path}.${field}`)
  if (result.confidence !== null) finite(result.confidence, `${path}.confidence`, 0, 1)
  oneOf(result.importance, ['high', 'medium', 'low'], `${path}.importance`)
  oneOf(result.changeType, ['NEW', 'CHANGED', 'CONFIRMS', 'CONTRADICTS', 'LOW_VALUE'], `${path}.changeType`)
  nullableIdentifier(result.matchedFactId, `${path}.matchedFactId`)
  oneOf(result.decisionStatus, ['PENDING', 'APPROVED', 'REJECTED', 'DEFERRED'], `${path}.decisionStatus`)
  if (result.editedObjectJson !== null) jsonText(result.editedObjectJson, `${path}.editedObjectJson`)
  date(result.createdAt, `${path}.createdAt`)
  date(result.updatedAt, `${path}.updatedAt`)
}

function factJob(value: unknown, path: string): unknown {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  identifier(result.workItemId, `${path}.workItemId`)
  positive(result.chapterId, `${path}.chapterId`)
  oneOf(result.status, ['running', 'completed', 'cancelled', 'failed', 'interrupted'], `${path}.status`)
  date(result.startedAt, `${path}.startedAt`)
  if (result.attempt !== undefined) positive(result.attempt, `${path}.attempt`)
  if (result.parentTaskId !== undefined) identifier(result.parentTaskId, `${path}.parentTaskId`)
  if (result.completedAt !== undefined) date(result.completedAt, `${path}.completedAt`)
  if (result.batch !== undefined) factBatch(result.batch, `${path}.batch`)
  if (result.error !== undefined) errorSummary(result.error, `${path}.error`)
  if (result.rawResult !== undefined) text(result.rawResult, `${path}.rawResult`, 180_000)
  return value
}

function approvedFact(value: unknown, path: string): unknown {
  const result = object(value, path)
  for (const field of ['id', 'subjectType', 'predicate', 'normalizedKey'] as const) identifier(result[field], `${path}.${field}`)
  nullableIdentifier(result.subjectId, `${path}.subjectId`)
  jsonText(result.objectJson, `${path}.objectJson`)
  oneOf(result.importance, ['high', 'medium', 'low'], `${path}.importance`)
  nullableIdentifier(result.supersedesFactId, `${path}.supersedesFactId`)
  date(result.approvedAt, `${path}.approvedAt`)
  bool(result.sourceCurrent, `${path}.sourceCurrent`)
  array(result.sources, `${path}.sources`).forEach((item, index) => {
    const source = object(item, `${path}.sources[${index}]`)
    identifier(source.id, `${path}.sources[${index}].id`)
    positive(source.chapterId, `${path}.sources[${index}].chapterId`)
    identifier(source.bodyVersionId, `${path}.sources[${index}].bodyVersionId`)
    fingerprint(source.contentHash, `${path}.sources[${index}].contentHash`)
    text(source.quote, `${path}.sources[${index}].quote`, 100_000)
    jsonText(source.spanJson, `${path}.sources[${index}].spanJson`)
    bool(source.current, `${path}.sources[${index}].current`)
  })
  return value
}

function contextFactPack(value: unknown, path: string): unknown {
  const result = object(value, path)
  literal(result.version, 1, `${path}.version`)
  identifier(result.workItemId, `${path}.workItemId`)
  if (result.chapterId !== undefined) positive(result.chapterId, `${path}.chapterId`)
  stringArray(result.queryTerms, `${path}.queryTerms`, 10_000)
  const structured = object(result.structured, `${path}.structured`)
  if (structured.eventApprovedRevision !== undefined) fingerprint(structured.eventApprovedRevision, `${path}.structured.eventApprovedRevision`)
  for (const field of ['canonicalEvents', 'characterSnapshots', 'characterAliases'] as const) array(structured[field], `${path}.structured.${field}`)
  array(structured.approvedFacts, `${path}.structured.approvedFacts`).forEach((item, index) => approvedFact(item, `${path}.structured.approvedFacts[${index}]`))
  if (structured.latestApprovedSummary !== undefined) {
    const summary = object(structured.latestApprovedSummary, `${path}.structured.latestApprovedSummary`)
    positive(summary.chapterId, `${path}.structured.latestApprovedSummary.chapterId`)
    identifier(summary.bodyVersionId, `${path}.structured.latestApprovedSummary.bodyVersionId`)
    text(summary.content, `${path}.structured.latestApprovedSummary.content`, 2_000_000)
    date(summary.createdAt, `${path}.structured.latestApprovedSummary.createdAt`)
  }
  if (structured.recentApprovedSummaries !== undefined) {
    const summaries = array(structured.recentApprovedSummaries, `${path}.structured.recentApprovedSummaries`)
    summaries.forEach((item, index) => {
      const summary = object(item, `${path}.structured.recentApprovedSummaries[${index}]`)
      positive(summary.chapterId, `${path}.structured.recentApprovedSummaries[${index}].chapterId`)
      identifier(summary.bodyVersionId, `${path}.structured.recentApprovedSummaries[${index}].bodyVersionId`)
      text(summary.content, `${path}.structured.recentApprovedSummaries[${index}].content`, 2_000_000)
      date(summary.createdAt, `${path}.structured.recentApprovedSummaries[${index}].createdAt`)
    })
    if (summaries.length > 5) invalid(`${path}.structured.recentApprovedSummaries`)
  }
  array(result.evidence, `${path}.evidence`)
  if (result.materials !== undefined) {
    array(result.materials, `${path}.materials`).forEach((item, index) => {
      const material = object(item, `${path}.materials[${index}]`)
      identifier(material.sourceId, `${path}.materials[${index}].sourceId`)
      if (!text(material.title, `${path}.materials[${index}].title`, 200).trim()) invalid(`${path}.materials[${index}].title`)
      if (!text(material.provider, `${path}.materials[${index}].provider`, 200).trim()) invalid(`${path}.materials[${index}].provider`)
      oneOf(material.sourceType, ['manual', 'web', 'toutiao', 'douyin-baike', 'douyin-video', 'other'], `${path}.materials[${index}].sourceType`)
      fingerprint(material.contentHash, `${path}.materials[${index}].contentHash`)
      text(material.excerpt, `${path}.materials[${index}].excerpt`, 20_000)
      text(material.userNotes, `${path}.materials[${index}].userNotes`, 20_000)
      if (material.url !== undefined) text(material.url, `${path}.materials[${index}].url`, 2_000)
      if (!text(material.reason, `${path}.materials[${index}].reason`, 1_000).trim()) invalid(`${path}.materials[${index}].reason`)
      count(material.score, `${path}.materials[${index}].score`)
    })
  }
  if (result.materialBudget !== undefined) {
    const materialBudget = object(result.materialBudget, `${path}.materialBudget`)
    countRecord(['maxCharacters', 'usedCharacters', 'omittedEvidenceCount'])(materialBudget, `${path}.materialBudget`)
    oneOf(materialBudget.searchMode, ['sqlite', 'files'], `${path}.materialBudget.searchMode`)
  }
  countRecord(['maxCharacters', 'usedCharacters', 'omittedEvidenceCount'])(result.budget, `${path}.budget`)
  return value
}

function chapterShape(value: unknown, path: string): void {
  const result = object(value, path)
  positive(result.id, `${path}.id`)
  positive(result.position, `${path}.position`)
  text(result.title, `${path}.title`, 200)
  text(result.content, `${path}.content`, 2_000_000)
  count(result.word_count, `${path}.word_count`)
  text(result.summary, `${path}.summary`, 100_000)
}

function selection(value: unknown, path: string): void {
  const result = object(value, path)
  count(result.start, `${path}.start`)
  count(result.end, `${path}.end`)
  text(result.text, `${path}.text`, 2_000_000)
  if (Number(result.end) < Number(result.start)) invalid(path)
}

function insertionAnchor(value: unknown, path: string): void {
  const result = object(value, path)
  count(result.offset, `${path}.offset`)
  text(result.before, `${path}.before`, 100_000)
  text(result.after, `${path}.after`, 100_000)
}

function artifactRef(value: unknown, path: string): void {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  oneOf(result.status, ['partial', 'complete', 'invalid', 'discarded', 'applied'], `${path}.status`)
}

function errorSummary(value: unknown, path: string): void {
  const result = object(value, path)
  text(result.code, `${path}.code`, 100)
  text(result.message, `${path}.message`, 10_000)
}

function writingSkill(value: unknown, path: string): string {
  return oneOf(value, ['continue', 'rewrite', 'expand', 'compress', 'custom', 'polish', 'review', 'query', 'plan'], path)
}

function outlineScope(value: unknown, path: string): void {
  if (value === 'total') return
  positive(value, path)
}

function mirrorStatus(value: unknown, path: string): string {
  return oneOf(value, ['pending', 'synced', 'conflict', 'failed'], path)
}

function countRecord(fields: readonly string[]): IpcValueDecoder {
  return (value, path) => {
    const result = object(value, path)
    for (const field of fields) count(result[field], `${path}.${field}`)
    return value
  }
}

function listOf(decoder: IpcValueDecoder): IpcValueDecoder {
  return (value, path) => {
    array(value, path).forEach((item, index) => decoder(item, `${path}[${index}]`))
    return value
  }
}

function nullable(decoder: IpcValueDecoder): IpcValueDecoder {
  return (value, path) => value === null ? value : decoder(value, path)
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path)
  return value as Record<string, unknown>
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path)
  return value
}

function text(value: unknown, path: string, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum) invalid(path)
  return value
}

function identifier(value: unknown, path: string): string {
  const result = text(value, path, 512)
  if (!result.trim()) invalid(path)
  return result
}

function fingerprint(value: unknown, path: string, allowEmpty = false): string {
  const result = text(value, path, 512)
  if (!allowEmpty && !result.trim()) invalid(path)
  return result
}

function jsonText(value: unknown, path: string): string {
  const result = text(value, path, 2_000_000)
  try { JSON.parse(result) } catch { invalid(path) }
  return result
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path)
  return value
}

function positive(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) invalid(path)
  return Number(value)
}

function count(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(path)
  return Number(value)
}

function nullablePositive(value: unknown, path: string): number | null {
  if (value === null) return value
  return positive(value, path)
}

function finite(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) invalid(path)
  return value
}

function date(value: unknown, path: string): string {
  const result = text(value, path, 100)
  if (!Number.isFinite(Date.parse(result))) invalid(path)
  return result
}

function nullableDate(value: unknown, path: string): string | null {
  if (value === null) return value
  return date(value, path)
}

function nullableIdentifier(value: unknown, path: string): string | null {
  if (value === null) return value
  return identifier(value, path)
}

function nullableEnum(value: unknown, allowed: readonly string[], path: string): string | null {
  if (value === null) return value
  return oneOf(value, allowed, path)
}

function oneOf(value: unknown, allowed: readonly string[], path: string): string {
  if (typeof value !== 'string' || !allowed.includes(value)) invalid(path)
  return value
}

function literal(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) invalid(path)
}

function stringArray(value: unknown, path: string, maximum: number): void {
  array(value, path).forEach((item, index) => text(item, `${path}[${index}]`, maximum))
}

function invalid(path: string): never {
  throw new TypeError(`Invalid IPC result at ${path}`)
}
