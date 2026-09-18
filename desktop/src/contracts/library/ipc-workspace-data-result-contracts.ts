import type { IpcValueDecoder } from '../core/ipc-result-contracts'
import { workflowIpcValueDecoders } from '../core/ipc-result-contracts'

const summary = nullable(chapterSummary)
const aliases = listOf(characterAlias, 10_000)
const entities = listOf(storyEntity, 10_000)
const ideas = listOf(idea, 10_000)
const ideaTasks = listOf(ideaGenerationTask, 50)
const expansionTasks = listOf(outlineExpansionTask, 50)
const relations = listOf(storyEntityRelation, 50_000)
const characterStateChannels = ['workspace:get-character-state', 'workspace:dismiss-character-conflict']

export const workspaceDataIpcValueDecoders: Readonly<Record<string, IpcValueDecoder>> = {
  'workspace:list-task-center': listOf(taskCenterItem, 100),
  'workspace:get-chapter-projection': chapterProjection,
  'workspace:get-workflow-status': workflowStatus,
  'workspace:get-consistency-overview': consistencyOverview,
  'workspace:decide-consistency-finding': undefinedOnly,
  'workspace:save-chapter-summary': chapterSummary,
  'workspace:get-chapter-summary': summary,
  'workspace:list-character-aliases': aliases,
  'workspace:replace-character-aliases': aliases,
  'workspace:list-story-entities': entities,
  'workspace:save-story-entity': storyEntity,
  'workspace:list-ideas': ideas,
  'workspace:save-idea': idea,
  'workspace:start-idea-generation': ideaGenerationTask,
  'workspace:retry-idea-generation': ideaGenerationTask,
  'workspace:list-idea-generations': ideaTasks,
  'workspace:idea-generation': ideaGenerationTask,
  'workspace:cancel-idea-generation': ideaGenerationTask,
  'workspace:get-planning-outline': nullable(planningOutline),
  'workspace:start-outline-expansion': outlineExpansionTask,
  'workspace:retry-outline-expansion': outlineExpansionTask,
  'workspace:list-outline-expansions': expansionTasks,
  'workspace:cancel-outline-expansion': outlineExpansionTask,
  'workspace:preview-outline-expansion-adoption': outlineExpansionPreview,
  'workspace:adopt-outline-expansion': outlineExpansionAdoption,
  'workspace:promote-idea-world-rule': promotedWorldRule,
  'workspace:promote-idea-summary': promotedSummary,
  'workspace:list-story-entity-relations': relations,
  'workspace:save-story-entity-relation': storyEntityRelation,
  'workspace:get-resource-ledger': resourceLedger,
  'workspace:append-resource-ledger': resourceLedgerWrite,
  'workspace:get-foreshadow-ledger': foreshadowLedger,
  'workspace:record-foreshadow-action': foreshadowWrite,
  'workspace:get-character-lines': characterLines,
  ...Object.fromEntries(characterStateChannels.map((channel) => [channel, characterState]))
}

function taskCenterItem(value: unknown, path: string): unknown {
  const result = object(value, path)
  uuid(result.id, `${path}.id`)
  identifier(result.workItemId, `${path}.workItemId`)
  oneOf(result.taskType, ['writing_agent', 'idea_generation', 'outline_expansion', 'fact_extraction', 'other'], `${path}.taskType`)
  oneOf(result.status, ['queued', 'resuming', 'preparing', 'running', 'streaming', 'paused', 'succeeded', 'cancelled', 'failed', 'interrupted'], `${path}.status`)
  requiredText(result.label, `${path}.label`, 100)
  text(result.detail, `${path}.detail`, 240)
  if (result.chapterId !== undefined) positive(result.chapterId, `${path}.chapterId`)
  positive(result.attempt, `${path}.attempt`)
  if (result.parentTaskRunId !== undefined) uuid(result.parentTaskRunId, `${path}.parentTaskRunId`)
  if (result.hasContinuation !== undefined) bool(result.hasContinuation, `${path}.hasContinuation`)
  date(result.createdAt, `${path}.createdAt`)
  date(result.updatedAt, `${path}.updatedAt`)
  if (result.errorMessage !== undefined) text(result.errorMessage, `${path}.errorMessage`, 500)
  const actions = boundedArray(result.actions, `${path}.actions`, 5).map((action, index) => oneOf(action, ['view', 'pause', 'resume', 'cancel', 'retry'], `${path}.actions[${index}]`))
  if (new Set(actions).size !== actions.length || !actions.includes('view')) fail(`${path}.actions`)
  return value
}

function chapterProjection(value: unknown, path: string): unknown {
  const result = object(value, path)
  if (result.chapterId !== undefined) positive(result.chapterId, `${path}.chapterId`)
  workflowStatus(result.workflow, `${path}.workflow`)
  workflowIpcValueDecoders['outlines:planning-status'](result.planning, `${path}.planning`)
  consistencyOverview(result.consistency, `${path}.consistency`)
  if (result.derivatives !== undefined) chapterDerivatives(result.derivatives, `${path}.derivatives`)
  if (result.findingHistory !== undefined) {
    const history = findingHistory(result.findingHistory, `${path}.findingHistory`)
    if (result.chapterId === undefined) fail(`${path}.chapterId`)
    if (result.derivatives !== undefined && object(result.derivatives, `${path}.derivatives`).bodyVersionId !== history.bodyVersionId) fail(`${path}.findingHistory.bodyVersionId`)
  }
  if (result.chapterId !== undefined && object(result.consistency, `${path}.consistency`).chapterId !== undefined
    && result.chapterId !== object(result.consistency, `${path}.consistency`).chapterId) fail(`${path}.chapterId`)
  return value
}

function findingHistory(value: unknown, path: string): Record<string, unknown> {
  const result = object(value, path)
  requiredText(result.bodyVersionId, `${path}.bodyVersionId`, 512)
  const entries = boundedArray(result.entries, `${path}.entries`, 500)
  const ids = entries.map((value, index) => {
    const entryPath = `${path}.entries[${index}]`
    const entry = object(value, entryPath)
    const id = requiredText(entry.id, `${entryPath}.id`, 512)
    requiredText(entry.title, `${entryPath}.title`, 500)
    requiredText(entry.rationale, `${entryPath}.rationale`, 20_000)
    const status = oneOf(entry.status, ['open', 'accepted', 'ignored', 'exception', 'stale', 'fixed'], `${entryPath}.status`)
    requiredText(entry.sourceBodyVersionId, `${entryPath}.sourceBodyVersionId`, 512)
    if (entry.resultingBodyVersionId !== null) requiredText(entry.resultingBodyVersionId, `${entryPath}.resultingBodyVersionId`, 512)
    if (status === 'fixed' && (!entry.resultingBodyVersionId || entry.resultingBodyVersionId !== result.bodyVersionId || entry.resultingBodyVersionId === entry.sourceBodyVersionId)) fail(entryPath)
    date(entry.updatedAt, `${entryPath}.updatedAt`)
    return id
  })
  if (new Set(ids).size !== ids.length) fail(`${path}.entries`)
  return result
}

function chapterDerivatives(value: unknown, path: string): unknown {
  const result = object(value, path)
  if (result.bodyVersionId !== null) requiredText(result.bodyVersionId, `${path}.bodyVersionId`, 512)
  for (const key of ['factBatches', 'summaries', 'ruleRuns'] as const) {
    const counts = object(result[key], `${path}.${key}`)
    integer(counts.current, `${path}.${key}.current`, 0, Number.MAX_SAFE_INTEGER)
    integer(counts.stale, `${path}.${key}.stale`, 0, Number.MAX_SAFE_INTEGER)
  }
  return value
}

function workflowStatus(value: unknown, path: string): unknown {
  const result = object(value, path)
  oneOf(result.creationPath, ['research', 'materials'], `${path}.creationPath`)
  const completed = integer(result.completed, `${path}.completed`, 0, 100)
  const total = integer(result.total, `${path}.total`, 0, 100)
  if (completed > total) fail(`${path}.completed`)
  const current = result.currentStep === null ? null : workflowStepId(result.currentStep, `${path}.currentStep`)
  const steps = boundedArray(result.steps, `${path}.steps`, 100)
  const ids = steps.map((step, index) => workflowStep(step, `${path}.steps[${index}]`))
  if (new Set(ids).size !== ids.length || (current !== null && !ids.includes(current))) fail(`${path}.steps`)
  const readyForChapterOutline = bool(result.readyForChapterOutline, `${path}.readyForChapterOutline`)
  const readyForProse = bool(result.readyForProse, `${path}.readyForProse`)
  const missingForChapterOutline = stringArray(result.missingForChapterOutline, `${path}.missingForChapterOutline`, 100, 2_000)
  const missingForProse = stringArray(result.missingForProse, `${path}.missingForProse`, 100, 2_000)
  if ((readyForChapterOutline && missingForChapterOutline.length) || (readyForProse && (!readyForChapterOutline || missingForProse.length))) fail(path)
  return value
}

function workflowStep(value: unknown, path: string): string {
  const result = object(value, path)
  const id = workflowStepId(result.id, `${path}.id`)
  requiredText(result.label, `${path}.label`, 500)
  oneOf(result.state, ['complete', 'current', 'blocked'], `${path}.state`)
  text(result.detail, `${path}.detail`, 10_000)
  stringArray(result.missing, `${path}.missing`, 100, 2_000)
  oneOf(result.target, ['profile', 'research', 'world', 'timeline', 'outline'], `${path}.target`)
  return id
}

function workflowStepId(value: unknown, path: string): string {
  return oneOf(value, ['definition', 'materials', 'foundation', 'events', 'outline', 'chapterPlan'], path)
}

function consistencyOverview(value: unknown, path: string): unknown {
  const result = object(value, path)
  const status = oneOf(result.status, ['ready', 'attention', 'blocked'], `${path}.status`)
  const ready = bool(result.readyForProse, `${path}.readyForProse`)
  if (result.chapterId !== undefined) positive(result.chapterId, `${path}.chapterId`)
  if (result.chapterPosition !== undefined) positive(result.chapterPosition, `${path}.chapterPosition`)
  text(result.summary, `${path}.summary`, 20_000)
  const blockers = stringArray(result.blockers, `${path}.blockers`, 100, 10_000)
  const items = boundedArray(result.items, `${path}.items`, 8)
  const ids = items.map((item, index) => consistencyItem(item, `${path}.items[${index}]`))
  if (new Set(ids).size !== ids.length || (status === 'ready' && blockers.length) || (ready && blockers.length) || (status === 'blocked' && ready)) fail(path)
  return value
}

function consistencyItem(value: unknown, path: string): string {
  const result = object(value, path)
  const id = oneOf(result.id, ['foundation', 'totalOutline', 'volumeOutline', 'events', 'chapterOutline', 'chapterContract', 'characterState', 'literaryStyle'], `${path}.id`)
  requiredText(result.label, `${path}.label`, 500)
  oneOf(result.status, ['ready', 'attention', 'blocked', 'deferred'], `${path}.status`)
  text(result.summary, `${path}.summary`, 20_000)
  oneOf(result.target, ['profile', 'research', 'world', 'timeline', 'outline'], `${path}.target`)
  if (result.revision !== undefined) integer(result.revision, `${path}.revision`, 0, Number.MAX_SAFE_INTEGER)
  if (result.fingerprint !== undefined) requiredText(result.fingerprint, `${path}.fingerprint`, 512)
  stringArray(result.issues, `${path}.issues`, 100, 10_000)
  if (result.findings !== undefined) boundedArray(result.findings, `${path}.findings`, 10_000).forEach((finding, index) => consistencyFinding(finding, `${path}.findings[${index}]`))
  return id
}

function consistencyFinding(value: unknown, path: string): unknown {
  const result = object(value, path)
  oneOf(result.code, ['LOCATION_JUMP', 'POWER_SKIP', 'POWER_REGRESSION', 'UNEXPLAINED_REVIVAL', 'POSSESSION_HANDOFF', 'DUPLICATE_PARAGRAPH', 'REPEATED_PARAGRAPH_OPENING', 'SUMMARY_TONE_DENSITY', 'IDENTITY_CONFLICT', 'MOTIVATION_CONFLICT', 'ARC_CONFLICT'], `${path}.code`)
  if (result.layer !== undefined) oneOf(result.layer, ['deterministic', 'semantic', 'literary'], `${path}.layer`)
  oneOf(result.severity, ['blocked', 'attention', 'advice'], `${path}.severity`)
  requiredText(result.message, `${path}.message`, 20_000)
  requiredText(result.characterId, `${path}.characterId`, 512)
  requiredText(result.characterName, `${path}.characterName`, 500)
  positive(result.fromChapter, `${path}.fromChapter`)
  positive(result.toChapter, `${path}.toChapter`)
  stringArray(result.evidence, `${path}.evidence`, 100, 20_000)
  for (const field of ['findingId', 'sourceBodyVersionId', 'semanticConflictId'] as const) if (result[field] !== undefined) requiredText(result[field], `${path}.${field}`, 512)
  if (result.findingStatus !== undefined) oneOf(result.findingStatus, ['open', 'accepted', 'ignored', 'exception', 'stale', 'fixed'], `${path}.findingStatus`)
  if (result.resultingBodyVersionId !== undefined && result.resultingBodyVersionId !== null) requiredText(result.resultingBodyVersionId, `${path}.resultingBodyVersionId`, 512)
  if (result.updatedAt !== undefined) date(result.updatedAt, `${path}.updatedAt`)
  if (result.sourceContentHash !== undefined) fingerprint(result.sourceContentHash, `${path}.sourceContentHash`)
  if (result.suggestedAction !== undefined) text(result.suggestedAction, `${path}.suggestedAction`, 10_000)
  if (result.confidence !== undefined) finite(result.confidence, `${path}.confidence`, 0, 1)
  return value
}

function undefinedOnly(value: unknown, path: string): unknown {
  if (value !== undefined) fail(path)
  return value
}

function chapterSummary(value: unknown, path: string): unknown {
  const result = object(value, path)
  positive(result.chapterId, `${path}.chapterId`)
  requiredText(result.bodyVersionId, `${path}.bodyVersionId`, 512)
  requiredText(result.content, `${path}.content`, 50_000)
  date(result.createdAt, `${path}.createdAt`)
  if (result.status !== undefined) oneOf(result.status, ['draft', 'approved', 'stale', 'rejected'], `${path}.status`)
  return value
}

function characterAlias(value: unknown, path: string): unknown {
  const result = object(value, path)
  requiredText(result.characterId, `${path}.characterId`, 512)
  requiredText(result.canonicalName, `${path}.canonicalName`, 160)
  requiredText(result.alias, `${path}.alias`, 160)
  return value
}

function storyEntity(value: unknown, path: string): unknown {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  oneOf(result.entityType, ['character', 'location', 'item', 'organization', 'world_rule'], `${path}.entityType`)
  requiredText(result.canonicalName, `${path}.canonicalName`, 160)
  jsonText(result.profileJson, `${path}.profileJson`, 500_000)
  oneOf(result.status, ['candidate', 'approved', 'archived'], `${path}.status`)
  date(result.createdAt, `${path}.createdAt`)
  date(result.updatedAt, `${path}.updatedAt`)
  return value
}

function storyEntityRelation(value: unknown, path: string): unknown {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  identifier(result.subjectEntityId, `${path}.subjectEntityId`)
  requiredText(result.predicate, `${path}.predicate`, 160)
  identifier(result.objectEntityId, `${path}.objectEntityId`)
  text(result.notes, `${path}.notes`, 5_000)
  date(result.createdAt, `${path}.createdAt`)
  date(result.updatedAt, `${path}.updatedAt`)
  return value
}

function idea(value: unknown, path: string): unknown {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  requiredText(result.title, `${path}.title`, 200)
  requiredText(result.content, `${path}.content`, 50_000)
  oneOf(result.status, ['candidate', 'approved', 'archived'], `${path}.status`)
  if (result.promotedToType !== null) oneOf(result.promotedToType, ['world_rule', 'summary'], `${path}.promotedToType`)
  if (result.promotedToId !== null) identifier(result.promotedToId, `${path}.promotedToId`)
  if ((result.promotedToType === null) !== (result.promotedToId === null)) fail(path)
  if (result.generationSource !== undefined) {
    const source = object(result.generationSource, `${path}.generationSource`)
    uuid(source.taskId, `${path}.generationSource.taskId`)
    integer(source.optionIndex, `${path}.generationSource.optionIndex`, 0, 2)
  }
  date(result.createdAt, `${path}.createdAt`)
  date(result.updatedAt, `${path}.updatedAt`)
  return value
}

function ideaGenerationTask(value: unknown, path: string): unknown {
  const result = object(value, path)
  uuid(result.id, `${path}.id`)
  uuid(result.ideaId, `${path}.ideaId`)
  oneOf(result.mode, ['diverge', 'synopsis'], `${path}.mode`)
  const status = taskStatus(result.status, `${path}.status`)
  requiredText(result.model, `${path}.model`, 500)
  date(result.createdAt, `${path}.createdAt`)
  bool(result.sourceStale, `${path}.sourceStale`)
  if (result.proposal !== null) ideaProposal(result.proposal, `${path}.proposal`)
  if (result.error !== null) text(result.error, `${path}.error`, 10_000)
  if (result.rawResult !== undefined) text(result.rawResult, `${path}.rawResult`, 180_000)
  if ((status === 'succeeded') !== (result.proposal !== null) || (status === 'failed' && (typeof result.error !== 'string' || !result.error.trim()))) fail(path)
  return value
}

function ideaProposal(value: unknown, path: string): unknown {
  const options = boundedArray(object(value, path).options, `${path}.options`, 3)
  if (!options.length) fail(`${path}.options`)
  options.forEach((item, index) => {
    const option = object(item, `${path}.options[${index}]`)
    requiredText(option.title, `${path}.options[${index}].title`, 200)
    requiredText(option.content, `${path}.options[${index}].content`, 50_000)
    requiredText(option.rationale, `${path}.options[${index}].rationale`, 2_000)
  })
  return value
}

function planningOutline(value: unknown, path: string): unknown {
  const result = object(value, path)
  fingerprint(result.projectFingerprint, `${path}.projectFingerprint`)
  outlineKey(result.key, `${path}.key`)
  oneOf(result.kind, ['summary', 'volume', 'stage', 'chapter'], `${path}.kind`)
  requiredText(result.title, `${path}.title`, 200)
  text(result.content, `${path}.content`, 2_000_000)
  fingerprint(result.revision, `${path}.revision`)
  return value
}

function outlineExpansionTask(value: unknown, path: string): unknown {
  const result = object(value, path)
  uuid(result.id, `${path}.id`)
  const status = taskStatus(result.status, `${path}.status`)
  date(result.createdAt, `${path}.createdAt`)
  requiredText(result.model, `${path}.model`, 500)
  const request = object(result.request, `${path}.request`)
  uuid(request.operationId, `${path}.request.operationId`)
  const parentKey = outlineKey(request.parentKey, `${path}.request.parentKey`)
  const expectedRevision = fingerprint(request.expectedRevision, `${path}.request.expectedRevision`)
  integer(request.count, `${path}.request.count`, 1, 12)
  text(request.instruction, `${path}.request.instruction`, 2_000)
  bool(result.sourceStale, `${path}.sourceStale`)
  if (result.proposal !== null) {
    const proposal = outlineExpansionProposal(result.proposal, `${path}.proposal`)
    if (proposal.key !== parentKey || proposal.revision !== expectedRevision || proposal.sourceStale !== result.sourceStale) fail(`${path}.proposal.source`)
  }
  if (result.error !== null) text(result.error, `${path}.error`, 10_000)
  if ((status === 'succeeded') !== (result.proposal !== null) || (status === 'failed' && (typeof result.error !== 'string' || !result.error.trim()))) fail(path)
  if (result.adoptedKeys !== undefined) uniqueKeys(result.adoptedKeys, `${path}.adoptedKeys`, 12)
  return value
}

function outlineExpansionProposal(value: unknown, path: string): { key: string; revision: string; sourceStale: boolean } {
  const result = object(value, path)
  uuid(result.id, `${path}.id`)
  date(result.createdAt, `${path}.createdAt`)
  const source = object(result.source, `${path}.source`)
  planningOutline(source, `${path}.source`)
  const sourceStale = bool(result.sourceStale, `${path}.sourceStale`)
  oneOf(result.childType, ['volume', 'stage', 'chapter'], `${path}.childType`)
  const children = boundedArray(result.children, `${path}.children`, 12)
  if (!children.length) fail(`${path}.children`)
  children.forEach((child, index) => outlineExpansionChild(child, `${path}.children[${index}]`))
  return { key: String(source.key), revision: String(source.revision), sourceStale }
}

function outlineExpansionChild(value: unknown, path: string): unknown {
  const result = object(value, path)
  requiredText(result.title, `${path}.title`, 200)
  requiredText(result.content, `${path}.content`, 12_000)
  const events = boundedArray(result.events, `${path}.events`, 12)
  if (!events.length) fail(`${path}.events`)
  events.forEach((event, index) => {
    const item = object(event, `${path}.events[${index}]`)
    requiredText(item.time, `${path}.events[${index}].time`, 200)
    const characters = stringArray(item.characters, `${path}.events[${index}].characters`, 30, 120)
    if (!characters.length || characters.some((name) => !name.trim())) fail(`${path}.events[${index}].characters`)
    requiredText(item.location, `${path}.events[${index}].location`, 200)
    requiredText(item.event, `${path}.events[${index}].event`, 2_000)
  })
  return value
}

function outlineExpansionPreview(value: unknown, path: string): unknown {
  const result = object(value, path)
  uuid(result.token, `${path}.token`)
  uuid(result.taskId, `${path}.taskId`)
  requiredText(result.parentTitle, `${path}.parentTitle`, 200)
  const children = boundedArray(result.children, `${path}.children`, 12)
  if (!children.length) fail(`${path}.children`)
  const keys = children.map((child, index) => {
    const item = object(child, `${path}.children[${index}]`)
    const key = outlineKey(item.key, `${path}.children[${index}].key`)
    requiredText(item.title, `${path}.children[${index}].title`, 200)
    requiredText(item.content, `${path}.children[${index}].content`, 2_000_000)
    return key
  })
  if (new Set(keys).size !== keys.length) fail(`${path}.children`)
  return value
}

function outlineExpansionAdoption(value: unknown, path: string): unknown {
  const result = object(value, path)
  const keys = uniqueKeys(result.keys, `${path}.keys`, 12)
  if (!keys.length) fail(`${path}.keys`)
  bool(result.mirrorPending, `${path}.mirrorPending`)
  return value
}

function promotedWorldRule(value: unknown, path: string): unknown {
  const result = object(value, path)
  idea(result.idea, `${path}.idea`)
  const entity = object(result.entity, `${path}.entity`)
  storyEntity(entity, `${path}.entity`)
  if (entity.entityType !== 'world_rule' || object(result.idea, `${path}.idea`).promotedToType !== 'world_rule'
    || object(result.idea, `${path}.idea`).promotedToId !== entity.id) fail(path)
  return value
}

function promotedSummary(value: unknown, path: string): unknown {
  const item = object(object(value, path).idea, `${path}.idea`)
  idea(item, `${path}.idea`)
  if (item.promotedToType !== 'summary' || item.promotedToId === null) fail(`${path}.idea`)
  return value
}

function resourceLedger(value: unknown, path: string): unknown {
  const result = object(value, path)
  boundedArray(result.balances, `${path}.balances`, 10_000).forEach((item, index) => resourceBalance(item, `${path}.balances[${index}]`))
  boundedArray(result.entries, `${path}.entries`, 100_000).forEach((item, index) => resourceEntry(item, `${path}.entries[${index}]`))
  return value
}

function resourceLedgerWrite(value: unknown, path: string): unknown {
  const result = object(value, path)
  resourceEntry(result.entry, `${path}.entry`)
  resourceBalance(result.balance, `${path}.balance`)
  bool(result.idempotent, `${path}.idempotent`)
  if (object(result.entry, `${path}.entry`).resourceEntityId !== object(result.balance, `${path}.balance`).resourceEntityId) fail(path)
  return value
}

function resourceEntry(value: unknown, path: string): unknown {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  identifier(result.operationKey, `${path}.operationKey`)
  identifier(result.resourceEntityId, `${path}.resourceEntityId`)
  requiredText(result.resourceName, `${path}.resourceName`, 160)
  if (result.eventId !== null) requiredText(result.eventId, `${path}.eventId`, 200)
  if (result.factId !== null) identifier(result.factId, `${path}.factId`)
  const delta = safeInteger(result.delta, `${path}.delta`)
  if (delta === 0) fail(`${path}.delta`)
  safeInteger(result.resultingQuantity, `${path}.resultingQuantity`)
  text(result.note, `${path}.note`, 2_000)
  date(result.createdAt, `${path}.createdAt`)
  return value
}

function resourceBalance(value: unknown, path: string): unknown {
  const result = object(value, path)
  identifier(result.resourceEntityId, `${path}.resourceEntityId`)
  requiredText(result.resourceName, `${path}.resourceName`, 160)
  const quantity = safeInteger(result.quantity, `${path}.quantity`)
  const isNegative = bool(result.isNegative, `${path}.isNegative`)
  if (isNegative !== (quantity < 0)) fail(`${path}.isNegative`)
  if (result.lastChangedAt !== null) date(result.lastChangedAt, `${path}.lastChangedAt`)
  return value
}

function foreshadowLedger(value: unknown, path: string): unknown {
  const result = object(value, path)
  boundedArray(result.foreshadows, `${path}.foreshadows`, 10_000).forEach((item, index) => foreshadow(item, `${path}.foreshadows[${index}]`))
  boundedArray(result.actions, `${path}.actions`, 100_000).forEach((item, index) => foreshadowAction(item, `${path}.actions[${index}]`))
  return value
}

function foreshadowWrite(value: unknown, path: string): unknown {
  const result = object(value, path)
  foreshadow(result.foreshadow, `${path}.foreshadow`)
  foreshadowAction(result.action, `${path}.action`)
  bool(result.idempotent, `${path}.idempotent`)
  if (object(result.foreshadow, `${path}.foreshadow`).id !== object(result.action, `${path}.action`).foreshadowId) fail(path)
  return value
}

function foreshadow(value: unknown, path: string): unknown {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  requiredText(result.title, `${path}.title`, 500)
  requiredText(result.normalizedTitle, `${path}.normalizedTitle`, 500)
  oneOf(result.status, ['open', 'resolved', 'discarded'], `${path}.status`)
  if (result.plantedChapterId !== null) positive(result.plantedChapterId, `${path}.plantedChapterId`)
  if (result.payoffChapterId !== null) positive(result.payoffChapterId, `${path}.payoffChapterId`)
  jsonText(result.dataJson, `${path}.dataJson`, 100_000)
  date(result.createdAt, `${path}.createdAt`)
  date(result.updatedAt, `${path}.updatedAt`)
  return value
}

function foreshadowAction(value: unknown, path: string): unknown {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  identifier(result.operationKey, `${path}.operationKey`)
  identifier(result.foreshadowId, `${path}.foreshadowId`)
  requiredText(result.foreshadowTitle, `${path}.foreshadowTitle`, 500)
  if (result.chapterId !== null) positive(result.chapterId, `${path}.chapterId`)
  oneOf(result.action, ['plant', 'advance', 'misdirect', 'resolve', 'hold', 'discard'], `${path}.action`)
  text(result.description, `${path}.description`, 5_000)
  text(result.evidence, `${path}.evidence`, 20_000)
  oneOf(result.sourceType, ['manual', 'chapter_draft', 'writing_agent'], `${path}.sourceType`)
  date(result.createdAt, `${path}.createdAt`)
  return value
}

function characterState(value: unknown, path: string): unknown {
  const result = object(value, path)
  literal(result.version, 1, `${path}.version`)
  requiredText(result.workItemId, `${path}.workItemId`, 32_767)
  boundedArray(result.anchors, `${path}.anchors`, 10_000).forEach((item, index) => characterAnchor(item, `${path}.anchors[${index}]`))
  boundedArray(result.events, `${path}.events`, 100_000).forEach((item, index) => characterEvent(item, `${path}.events[${index}]`))
  boundedArray(result.snapshots, `${path}.snapshots`, 10_000).forEach((item, index) => characterSnapshot(item, `${path}.snapshots[${index}]`))
  boundedArray(result.pendingConflicts, `${path}.pendingConflicts`, 10_000).forEach((item, index) => characterConflict(item, `${path}.pendingConflicts[${index}]`))
  return value
}

function characterAnchor(value: unknown, path: string): unknown {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  requiredText(result.name, `${path}.name`, 160)
  if (result.role !== undefined) text(result.role, `${path}.role`, 2_000)
  if (result.arcSeed !== undefined) text(result.arcSeed, `${path}.arcSeed`, 5_000)
  stringArray(result.sourceRefs, `${path}.sourceRefs`, 1_000, 512)
  return value
}

function characterEvent(value: unknown, path: string): unknown {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  identifier(result.characterId, `${path}.characterId`)
  positive(result.chapterId, `${path}.chapterId`)
  positive(result.chapterPosition, `${path}.chapterPosition`)
  fingerprint(result.manuscriptRevision, `${path}.manuscriptRevision`)
  identifier(result.proposalId, `${path}.proposalId`)
  date(result.acceptedAt, `${path}.acceptedAt`)
  requiredText(result.evidence, `${path}.evidence`, 20_000)
  bool(result.active, `${path}.active`)
  const changes = object(result.changes, `${path}.changes`)
  literal(changes.present, true, `${path}.changes.present`)
  characterDynamicFields(changes, `${path}.changes`)
  if (result.changeEvidence !== undefined) {
    const evidence = object(result.changeEvidence, `${path}.changeEvidence`)
    for (const [field, item] of Object.entries(evidence)) {
      if (!['location', 'injury', 'relationship', 'knowledge', 'possession', 'goal', 'power', 'vitality'].includes(field)) fail(`${path}.changeEvidence.${field}`)
      requiredText(item, `${path}.changeEvidence.${field}`, 20_000)
    }
  }
  return value
}

function characterSnapshot(value: unknown, path: string): unknown {
  const result = object(value, path)
  identifier(result.characterId, `${path}.characterId`)
  requiredText(result.name, `${path}.name`, 160)
  integer(result.throughChapter, `${path}.throughChapter`, 0, 1_000_000)
  bool(result.present, `${path}.present`)
  characterDynamicFields(result, path)
  if (result.lastEventId === '') literal(result.lastEventId, '', `${path}.lastEventId`)
  else identifier(result.lastEventId, `${path}.lastEventId`)
  return value
}

function characterDynamicFields(result: Record<string, unknown>, path: string): void {
  for (const field of ['location', 'injury', 'possession', 'goal', 'power'] as const) if (result[field] !== undefined) text(result[field], `${path}.${field}`, 20_000)
  for (const field of ['relationships', 'knowledge'] as const) if (result[field] !== undefined) stringArray(result[field], `${path}.${field}`, 1_000, 5_000)
  if (result.vitality !== undefined) oneOf(result.vitality, ['alive', 'dead'], `${path}.vitality`)
}

function characterConflict(value: unknown, path: string): unknown {
  const result = object(value, path)
  const id = text(result.id, `${path}.id`, 33)
  if (!/^conflict-[0-9a-f]{24}$/.test(id)) fail(`${path}.id`)
  identifier(result.characterId, `${path}.characterId`)
  requiredText(result.name, `${path}.name`, 160)
  oneOf(result.field, ['identity', 'motivation', 'arc'], `${path}.field`)
  requiredText(result.claimedValue, `${path}.claimedValue`, 20_000)
  if (result.anchorValue !== undefined) text(result.anchorValue, `${path}.anchorValue`, 20_000)
  positive(result.chapterId, `${path}.chapterId`)
  positive(result.chapterPosition, `${path}.chapterPosition`)
  fingerprint(result.manuscriptRevision, `${path}.manuscriptRevision`)
  identifier(result.proposalId, `${path}.proposalId`)
  requiredText(result.evidence, `${path}.evidence`, 20_000)
  oneOf(result.status, ['pending', 'superseded', 'dismissed'], `${path}.status`)
  return value
}

function characterLines(value: unknown, path: string): unknown {
  const result = object(value, path)
  literal(result.version, 1, `${path}.version`)
  requiredText(result.workItemId, `${path}.workItemId`, 32_767)
  oneOf(result.source, ['sqlite-approved-facts', 'legacy-accepted-prose'], `${path}.source`)
  boundedArray(result.lines, `${path}.lines`, 10_000).forEach((line, index) => {
    const item = object(line, `${path}.lines[${index}]`)
    identifier(item.characterId, `${path}.lines[${index}].characterId`)
    requiredText(item.name, `${path}.lines[${index}].name`, 160)
    boundedArray(item.points, `${path}.lines[${index}].points`, 100_000).forEach((point, pointIndex) => {
      const current = object(point, `${path}.lines[${index}].points[${pointIndex}]`)
      characterSnapshot(current, `${path}.lines[${index}].points[${pointIndex}]`)
      positive(current.chapterId, `${path}.lines[${index}].points[${pointIndex}].chapterId`)
      positive(current.chapterPosition, `${path}.lines[${index}].points[${pointIndex}].chapterPosition`)
      oneOf(current.source, ['approved_fact', 'accepted_prose'], `${path}.lines[${index}].points[${pointIndex}].source`)
      identifier(current.sourceId, `${path}.lines[${index}].points[${pointIndex}].sourceId`)
    })
  })
  return value
}

function taskStatus(value: unknown, path: string): string {
  return oneOf(value, ['queued', 'preparing', 'running', 'streaming', 'succeeded', 'cancelled', 'failed', 'interrupted'], path)
}

function outlineKey(value: unknown, path: string): string {
  const result = requiredText(value, path, 80)
  if (!/^(total|volume-[1-9]\d*|stage-[1-9]\d*|chapter-[1-9]\d*)$/.test(result)) fail(path)
  return result
}

function uniqueKeys(value: unknown, path: string, maximum: number): string[] {
  const result = boundedArray(value, path, maximum).map((item, index) => outlineKey(item, `${path}[${index}]`))
  if (new Set(result).size !== result.length) fail(path)
  return result
}

function nullable(decoder: IpcValueDecoder): IpcValueDecoder {
  return (value, path) => value === null ? value : decoder(value, path)
}

function listOf(decoder: IpcValueDecoder, maximum: number): IpcValueDecoder {
  return (value, path) => {
    boundedArray(value, path, maximum).forEach((item, index) => decoder(item, `${path}[${index}]`))
    return value
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

function text(value: unknown, path: string, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum) fail(path)
  return value
}

function requiredText(value: unknown, path: string, maximum: number): string {
  const result = text(value, path, maximum)
  if (!result.trim()) fail(path)
  return result
}

function jsonText(value: unknown, path: string, maximum: number): string {
  const result = text(value, path, maximum)
  try { JSON.parse(result) } catch { fail(path) }
  return result
}

function identifier(value: unknown, path: string): string {
  return requiredText(value, path, 512)
}

function uuid(value: unknown, path: string): string {
  const result = text(value, path, 64)
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

function positive(value: unknown, path: string): number {
  return integer(value, path, 1, Number.MAX_SAFE_INTEGER)
}

function safeInteger(value: unknown, path: string): number {
  return integer(value, path, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
}

function integer(value: unknown, path: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(path)
  return Number(value)
}

function finite(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) fail(path)
  return value
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
