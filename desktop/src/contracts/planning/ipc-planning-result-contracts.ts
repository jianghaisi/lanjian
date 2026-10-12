import { characterStateResult, planningStatusResult, type IpcValueDecoder } from '../core/ipc-result-contracts'
import { decodeChapterStoryConstraints } from './chapter-story-contract'
import { decodeCreativePolicyRecords } from '../writing-plugins/creative-policy'
import { uuid as validUuid } from '../core/validation'
import { decodeChapterEventAdoptionArgs, MAX_CHAPTER_ADOPTION_EVENTS } from './chapter-event-contracts'

const jobChannels = ['planning:start', 'planning:job', 'planning:cancel']
const skeletonJobChannels = ['planning:start-chapter-skeleton', 'planning:chapter-skeleton-job', 'planning:cancel-chapter-skeleton']
const detailJobChannels = ['planning:start-chapter-detail', 'planning:chapter-detail-job', 'planning:cancel-chapter-detail']

export const planningIpcValueDecoders: Readonly<Record<string, IpcValueDecoder>> = {
  ...Object.fromEntries(jobChannels.map((channel) => [channel, planningJob])),
  ...Object.fromEntries(skeletonJobChannels.map((channel) => [channel, skeletonJob])),
  ...Object.fromEntries(detailJobChannels.map((channel) => [channel, detailJob])),
  'planning:generate-chapter-story': (value, path) => { const v = object(value, path); if (!text(v.content, `${path}.content`, 100_000).trim()) invalid(path); return value },
  'planning:prepare-chapter-story-contract': (value, path) => { const v = object(value, path); validUuid(v.token, `${path}.token`); integer(v.chapterId, `${path}.chapterId`, 1, 1_000_000); formalDigest(v.outlineHash, `${path}.outlineHash`); try { decodeChapterStoryConstraints(v.constraints) } catch { invalid(`${path}.constraints`) }; return value },
  'planning:adopt-chapter-story-contract': planningStatusResult,
  'planning:draft': nullable(planningPackage),
  'planning:save-draft': planningPackage,
  'planning:discard-draft': successResult,
  'planning:recover-damaged-draft': recoveryResult,
  'planning:preview-total-adoption': totalPreview,
  'planning:adopt-total': proposalAndPlanning('totalOutline'),
  'planning:preview-volume-structure': volumeStructurePreview,
  'planning:initialize-volume-structure': proposalAndPlanning('volumeStructure'),
  'planning:preview-volume-outline-adoption': volumeOutlinePreview,
  'planning:adopt-volume-outline': proposalAndPlanning('volumeOutlines', true),
  'planning:preview-chapter-detail-adoption': chapterDetailPreview,
  'planning:preview-chapter-events': chapterEventPreview,
  'planning:preview-chapter-event-adoption': chapterEventAdoptionPreview,
  'planning:adopt-chapter-event': chapterEventAdoptionResult,
  'planning:recover-chapter-event': chapterEventAdoptionResult,
  'planning:adopt-chapter-detail': proposalAndPlanning('chapterOutlines', true),
  'planning:preview-character-seed-adoption': characterSeedPreview,
  'planning:adopt-character-seeds': characterSeedResult,
  'planning:preview-world-seed-adoption': worldSeedPreview,
  'planning:adopt-world-seed': worldSeedResult,
  'planning:preview-power-system-adoption': powerSystemPreview,
  'planning:adopt-power-system': overviewResult('powerSystem'),
  'planning:preview-cheat-system-adoption': cheatSystemPreview,
  'planning:adopt-cheat-system': overviewResult('cheatSystem'),
  'planning:chapter-skeleton-status': skeletonStatus,
  'planning:preview-formal-skeleton': formalSkeletonPreview,
  'planning:adopt-formal-skeleton': formalSkeletonView,
  'planning:chapter-detail-statuses': listOf(detailStatus)
}

function chapterEventAdoptionPreview(value: unknown, path: string): unknown {
  const v = object(value, path)
  validUuid(v.token, `${path}.token`); validUuid(v.operationId, `${path}.operationId`)
  identifier(v.proposalId, `${path}.proposalId`)
  integer(v.chapterId, `${path}.chapterId`, 1, 1000000)
  if (!text(v.chapterContent, `${path}.chapterContent`, 500000).trim()) invalid(`${path}.chapterContent`)
  if (typeof v.replacesChapter !== 'boolean') invalid(`${path}.replacesChapter`)
  integer(v.existingEventCount, `${path}.existingEventCount`, 0, 50000)
  if (v.replacementImpact !== undefined) {
    const impact = object(v.replacementImpact, `${path}.replacementImpact`)
    for (const key of ['chapterIds', 'skeletonChapterIds']) {
      const ids = array(impact[key], `${path}.replacementImpact.${key}`)
      if (ids.length > 50000 || new Set(ids).size !== ids.length) invalid(`${path}.replacementImpact.${key}`)
      ids.forEach(id => integer(id, `${path}.replacementImpact.${key}`, 1, 1000000))
    }
  }
  if (Array.isArray(v.event)) invalid(`${path}.event`)
  decodeChapterEventAdoptionArgs([v.proposalId, v.chapterId, v.event])
  if (v.events !== undefined) {
    if (!Array.isArray(v.events) || v.events.length < 2) invalid(`${path}.events`)
    const [, , events] = decodeChapterEventAdoptionArgs([v.proposalId, v.chapterId, v.events])
    const [, , event] = decodeChapterEventAdoptionArgs([v.proposalId, v.chapterId, v.event])
    if (!Array.isArray(events) || JSON.stringify(events[0]) !== JSON.stringify(event)) invalid(`${path}.event`)
  }
  return value
}
function chapterEventAdoptionResult(value: unknown, path: string): unknown {
  const v = object(value, path)
  integer(v.chapterId, `${path}.chapterId`, 1, 1000000)
  validUuid(v.eventId, `${path}.eventId`); validUuid(v.eventVersionId, `${path}.eventVersionId`)
  if (typeof v.mirrorsPending !== 'boolean' || typeof v.candidateReceiptPending !== 'boolean') invalid(path)
  if (v.events !== undefined) {
    if (!Array.isArray(v.events) || v.events.length < 2 || v.events.length > MAX_CHAPTER_ADOPTION_EVENTS) invalid(`${path}.events`)
    const ids = new Set<string>()
    for (const item of v.events as unknown[]) {
      const event = object(item, `${path}.events`)
      validUuid(event.eventId, `${path}.eventId`); validUuid(event.eventVersionId, `${path}.eventVersionId`)
      for (const id of [event.eventId, event.eventVersionId] as string[]) {
        if (ids.has(id)) invalid(`${path}.events`)
        ids.add(id)
      }
    }
    const first = (v.events as Array<Record<string, unknown>>)[0]
    if (first.eventId !== v.eventId || first.eventVersionId !== v.eventVersionId) invalid(`${path}.events`)
  }
  return value
}

function planningPackage(value: unknown, path: string): unknown {
  const result = object(value, path)
  if (result.creativePolicy !== undefined) decodeCreativePolicyRecords(result.creativePolicy)
  identifier(result.id, `${path}.id`)
  identifier(result.workItemId, `${path}.workItemId`)
  date(result.createdAt, `${path}.createdAt`)
  fingerprints(result.basedOn, `${path}.basedOn`, ['inputFingerprint', 'blueprintFingerprint', 'totalOutlineFingerprint'])
  const blueprint = object(result.blueprint, `${path}.blueprint`)
  for (const field of ['premise', 'worldView', 'powerSystem', 'cheatSystem', 'rationale'] as const) text(blueprint[field], `${path}.blueprint.${field}`, 2_000_000)
  array(blueprint.characters, `${path}.blueprint.characters`).forEach((item, index) => characterSeed(item, `${path}.blueprint.characters[${index}]`))
  const total = object(result.totalOutline, `${path}.totalOutline`)
  text(total.title, `${path}.totalOutline.title`, 500)
  text(total.summary, `${path}.totalOutline.summary`, 2_000_000)
  text(total.content, `${path}.totalOutline.content`, 2_000_000)
  array(result.volumes, `${path}.volumes`).forEach((item, index) => volume(item, `${path}.volumes[${index}]`))
  if (result.chapterSkeleton !== undefined) chapterSkeleton(result.chapterSkeleton, `${path}.chapterSkeleton`)
  if (result.chapterDetails !== undefined) array(result.chapterDetails, `${path}.chapterDetails`).forEach((item, index) => chapterDetailVolume(item, `${path}.chapterDetails[${index}]`))
  if (result.adoption !== undefined) adoption(result.adoption, `${path}.adoption`)
  return value
}

function characterSeed(value: unknown, path: string): void {
  const result = object(value, path)
  for (const field of ['name', 'role', 'arcSeed'] as const) text(result[field], `${path}.${field}`, 100_000)
}

function volume(value: unknown, path: string): void {
  const result = object(value, path)
  positive(result.order, `${path}.order`)
  if (result.storyContent !== undefined && !text(result.storyContent, `${path}.storyContent`, 100_000).trim()) invalid(`${path}.storyContent`)
  for (const field of ['title', 'goal', 'summary', 'ending'] as const) text(result[field], `${path}.${field}`, 2_000_000)
}

function chapterSkeleton(value: unknown, path: string): void {
  const result = object(value, path)
  if (result.creativePolicy !== undefined) decodeCreativePolicyRecords(result.creativePolicy)
  date(result.generatedAt, `${path}.generatedAt`)
  fingerprints(result.basedOn, `${path}.basedOn`, ['totalOutlineFingerprint', 'volumePlanFingerprint'])
  positive(result.targetWordsPerChapter, `${path}.targetWordsPerChapter`)
  array(result.chapters, `${path}.chapters`).forEach((item, index) => {
    const chapter = object(item, `${path}.chapters[${index}]`)
    if (chapter.storyContent !== undefined && !text(chapter.storyContent, `${path}.chapters[${index}].storyContent`, 100_000).trim()) invalid(`${path}.storyContent`)
    for (const field of ['chapter', 'volume', 'volumeChapter'] as const) positive(chapter[field], `${path}.chapters[${index}].${field}`)
    for (const field of ['title', 'coreEvent', 'location', 'result'] as const) text(chapter[field], `${path}.chapters[${index}].${field}`, 100_000)
    stringArray(chapter.characters, `${path}.chapters[${index}].characters`)
  })
}

function chapterDetailVolume(value: unknown, path: string): void {
  const result = object(value, path)
  if (result.creativePolicy !== undefined) decodeCreativePolicyRecords(result.creativePolicy)
  positive(result.volume, `${path}.volume`)
  date(result.generatedAt, `${path}.generatedAt`)
  fingerprints(result.basedOn, `${path}.basedOn`, ['totalOutlineFingerprint', 'volumeOutlineFingerprint', 'skeletonFingerprint'])
  const sources = object(result.basedOn, `${path}.basedOn`)
  if (sources.formalSkeletonFingerprint !== undefined) formalDigest(sources.formalSkeletonFingerprint, `${path}.basedOn.formalSkeletonFingerprint`)
  array(result.chapters, `${path}.chapters`).forEach((item, index) => {
    const chapter = object(item, `${path}.chapters[${index}]`)
    if (chapter.storyContent !== undefined && !text(chapter.storyContent, `${path}.chapters[${index}].storyContent`, 100_000).trim()) invalid(`${path}.storyContent`)
    for (const field of ['chapter', 'volume', 'volumeChapter'] as const) positive(chapter[field], `${path}.chapters[${index}].${field}`)
    for (const field of ['title', 'entryState', 'exitState'] as const) text(chapter[field], `${path}.chapters[${index}].${field}`, 100_000)
    for (const field of ['beats', 'allowedFacts', 'forbiddenEvents'] as const) stringArray(chapter[field], `${path}.chapters[${index}].${field}`)
    array(chapter.foreshadowActions, `${path}.chapters[${index}].foreshadowActions`).forEach((action, actionIndex) => {
      const entry = object(action, `${path}.chapters[${index}].foreshadowActions[${actionIndex}]`)
      oneOf(entry.action, ['plant', 'advance', 'misdirect', 'resolve', 'hold', 'discard'], `${path}.chapters[${index}].foreshadowActions[${actionIndex}].action`)
      text(entry.description, `${path}.chapters[${index}].foreshadowActions[${actionIndex}].description`, 100_000)
    })
  })
}

function adoption(value: unknown, path: string): void {
  const result = object(value, path)
  if (result.totalOutline !== undefined) receipt(result.totalOutline, `${path}.totalOutline`, ['fingerprint'], ['revision'])
  if (result.volumeStructure !== undefined) receipt(result.volumeStructure, `${path}.volumeStructure`, ['fingerprint'], ['totalRevision'], 'initializedAt')
  if (result.volumeOutlines !== undefined) array(result.volumeOutlines, `${path}.volumeOutlines`).forEach((item, index) => receipt(item, `${path}.volumeOutlines[${index}]`, ['fingerprint', 'totalFingerprint'], ['order', 'revision']))
  if (result.chapterOutlines !== undefined) array(result.chapterOutlines, `${path}.chapterOutlines`).forEach((item, index) => receipt(item, `${path}.chapterOutlines[${index}]`, ['candidateFingerprint', 'totalFingerprint', 'volumeFingerprint'], ['chapter']))
  if (result.characterSeeds !== undefined) receipt(result.characterSeeds, `${path}.characterSeeds`, ['fingerprint', 'anchorFingerprint'])
  if (result.worldSeed !== undefined) receipt(result.worldSeed, `${path}.worldSeed`, ['fingerprint', 'foundationFingerprint'])
  if (result.powerSystem !== undefined) receipt(result.powerSystem, `${path}.powerSystem`, ['fingerprint', 'powerSystemFingerprint'])
  if (result.cheatSystem !== undefined) receipt(result.cheatSystem, `${path}.cheatSystem`, ['fingerprint', 'cheatSystemFingerprint'])
}

function receipt(value: unknown, path: string, fingerprintFields: readonly string[], countFields: readonly string[] = [], timestamp = 'adoptedAt'): void {
  const result = object(value, path)
  for (const field of fingerprintFields) fingerprint(result[field], `${path}.${field}`)
  for (const field of countFields) positive(result[field], `${path}.${field}`)
  date(result[timestamp], `${path}.${timestamp}`)
}

function planningJob(value: unknown, path: string): unknown {
  const result = baseJob(value, path)
  if (result.rawResult !== undefined) text(result.rawResult, `${path}.rawResult`, 3_000_000)
  oneOf(result.stage, ['blueprint', 'totalOutline', 'volumePlan'], `${path}.stage`)
  const progress = object(result.progress, `${path}.progress`)
  count(progress.completed, `${path}.progress.completed`)
  literal(progress.total, 3, `${path}.progress.total`)
  if (Number(progress.completed) > 3) invalid(`${path}.progress.completed`)
  text(progress.message, `${path}.progress.message`, 100_000)
  if (result.proposal !== undefined) planningPackage(result.proposal, `${path}.proposal`)
  if (result.error !== undefined) jobError(result.error, `${path}.error`, ['blueprint', 'totalOutline', 'volumePlan'])
  return value
}

function skeletonJob(value: unknown, path: string): unknown {
  const result = baseJob(value, path)
  if (result.rawResult !== undefined) text(result.rawResult, `${path}.rawResult`, 3_000_000)
  identifier(result.proposalId, `${path}.proposalId`)
  literal(result.stage, 'chapterSkeleton', `${path}.stage`)
  progress(result.progress, `${path}.progress`)
  if (result.proposal !== undefined) planningPackage(result.proposal, `${path}.proposal`)
  if (result.error !== undefined) jobError(result.error, `${path}.error`, ['chapterSkeleton'])
  return value
}

function detailJob(value: unknown, path: string): unknown {
  const result = baseJob(value, path)
  if (result.rawResult !== undefined) text(result.rawResult, `${path}.rawResult`, 3_000_000)
  identifier(result.proposalId, `${path}.proposalId`)
  positive(result.volume, `${path}.volume`)
  literal(result.stage, 'chapterDetail', `${path}.stage`)
  progress(result.progress, `${path}.progress`)
  if (result.proposal !== undefined) planningPackage(result.proposal, `${path}.proposal`)
  if (result.error !== undefined) jobError(result.error, `${path}.error`, ['chapterDetail'])
  return value
}

function baseJob(value: unknown, path: string): Record<string, unknown> {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  identifier(result.workItemId, `${path}.workItemId`)
  oneOf(result.status, ['running', 'completed', 'cancelled', 'failed'], `${path}.status`)
  date(result.startedAt, `${path}.startedAt`)
  if (result.completedAt !== undefined) date(result.completedAt, `${path}.completedAt`)
  return result
}

function progress(value: unknown, path: string): void {
  const result = object(value, path)
  count(result.completed, `${path}.completed`)
  positive(result.total, `${path}.total`)
  if (Number(result.completed) > Number(result.total)) invalid(`${path}.completed`)
  text(result.message, `${path}.message`, 100_000)
}

function jobError(value: unknown, path: string, stages: readonly string[]): void {
  const result = object(value, path)
  literal(result.code, 'GENERATION_FAILED', `${path}.code`)
  text(result.message, `${path}.message`, 100_000)
  oneOf(result.stage, stages, `${path}.stage`)
}

function totalPreview(value: unknown, path: string): unknown {
  const result = previewBase(value, path)
  previewDocument(result.current, `${path}.current`, true)
  candidateDocument(result.candidate, `${path}.candidate`)
  countsAndBooleans(result.affected, `${path}.affected`, ['chapterOutlines', 'confirmedVolumes'], ['totalConfirmation'])
  return value
}

function volumeStructurePreview(value: unknown, path: string): unknown {
  const result = previewBase(value, path)
  fingerprint(result.totalFingerprint, `${path}.totalFingerprint`)
  array(result.actions, `${path}.actions`).forEach((item, index) => {
    const action = object(item, `${path}.actions[${index}]`)
    positive(action.order, `${path}.actions[${index}].order`)
    oneOf(action.action, ['create', 'rename', 'keep'], `${path}.actions[${index}].action`)
    if (action.fromTitle !== undefined) text(action.fromTitle, `${path}.actions[${index}].fromTitle`, 500)
    text(action.toTitle, `${path}.actions[${index}].toTitle`, 500)
    bool(action.outlineExists, `${path}.actions[${index}].outlineExists`)
  })
  array(result.preservedExtraVolumes, `${path}.preservedExtraVolumes`).forEach((item, index) => {
    const volume = object(item, `${path}.preservedExtraVolumes[${index}]`)
    positive(volume.order, `${path}.preservedExtraVolumes[${index}].order`)
    text(volume.title, `${path}.preservedExtraVolumes[${index}].title`, 500)
  })
  stringArray(result.conflicts, `${path}.conflicts`)
  countsAndBooleans(result.affected, `${path}.affected`, ['placedChapters', 'confirmedVolumes'], ['totalConfirmation'])
  return value
}

function volumeOutlinePreview(value: unknown, path: string): unknown {
  const result = previewBase(value, path)
  positive(result.order, `${path}.order`)
  if (result.storyContent !== undefined && !text(result.storyContent, `${path}.storyContent`, 100_000).trim()) invalid(`${path}.storyContent`)
  fingerprint(result.parentFingerprint, `${path}.parentFingerprint`)
  previewDocument(result.current, `${path}.current`, true)
  candidateDocument(result.candidate, `${path}.candidate`)
  countsAndBooleans(result.affected, `${path}.affected`, ['chapterOutlines'], ['volumeConfirmation'])
  return value
}

function chapterDetailPreview(value: unknown, path: string): unknown {
  const result = previewBase(value, path)
  positive(result.chapterId, `${path}.chapterId`)
  positive(result.volume, `${path}.volume`)
  fingerprint(result.upstreamFingerprint, `${path}.upstreamFingerprint`)
  previewDocument(result.current, `${path}.current`, false)
  candidateDocument(result.candidate, `${path}.candidate`, true)
  countsAndBooleans(result.affected, `${path}.affected`, ['formalEvents'], ['confirmation'])
  return value
}

function characterSeedPreview(value: unknown, path: string): unknown {
  const result = previewBase(value, path)
  stringArray(result.conflicts, `${path}.conflicts`)
  array(result.actions, `${path}.actions`).forEach((item, index) => {
    const action = object(item, `${path}.actions[${index}]`)
    text(action.name, `${path}.actions[${index}].name`, 500)
    oneOf(action.action, ['create', 'enrich', 'update', 'keep'], `${path}.actions[${index}].action`)
    characterSeedCandidate(action.candidate, `${path}.actions[${index}].candidate`)
    if (action.current !== undefined) characterSeedCandidate(action.current, `${path}.actions[${index}].current`, true)
  })
  countsAndBooleans(result.affected, `${path}.affected`, ['existingAnchors', 'dynamicSnapshots', 'pendingConflicts'], [])
  return value
}

function worldSeedPreview(value: unknown, path: string): unknown {
  const result = previewBase(value, path)
  previewDocument(result.current, `${path}.current`, false)
  previewDocument(result.candidate, `${path}.candidate`, false, false)
  countsAndBooleans(result.preserved, `${path}.preserved`, [], ['sourceNotes', 'useRealms', 'useSystem'])
  return value
}

function powerSystemPreview(value: unknown, path: string): unknown {
  const result = previewBase(value, path)
  previewDocument(result.current, `${path}.current`, false)
  previewDocument(result.candidate, `${path}.candidate`, false)
  countsAndBooleans(result.preserved, `${path}.preserved`, ['realmLevels'], ['realmsEnabled'])
  return value
}

function cheatSystemPreview(value: unknown, path: string): unknown {
  const result = previewBase(value, path)
  previewDocument(result.current, `${path}.current`, false)
  previewDocument(result.candidate, `${path}.candidate`, false)
  countsAndBooleans(result.preserved, `${path}.preserved`, ['templateCharacters'], ['systemEnabled'])
  return value
}

function previewBase(value: unknown, path: string): Record<string, unknown> {
  const result = object(value, path)
  identifier(result.proposalId, `${path}.proposalId`)
  fingerprint(result.candidateFingerprint, `${path}.candidateFingerprint`)
  fingerprint(result.currentFingerprint, `${path}.currentFingerprint`, true)
  bool(result.changes, `${path}.changes`)
  return result
}

function previewDocument(value: unknown, path: string, revision: boolean, requireExists = true): void {
  const result = object(value, path)
  if (requireExists || result.exists !== undefined) bool(result.exists, `${path}.exists`)
  text(result.excerpt, `${path}.excerpt`, 2_000_000)
  count(result.characterCount, `${path}.characterCount`)
  if (revision) count(result.revision, `${path}.revision`)
  if (result.confirmed !== undefined) bool(result.confirmed, `${path}.confirmed`)
}

function candidateDocument(value: unknown, path: string, beats = false): void {
  const result = object(value, path)
  text(result.title, `${path}.title`, 500)
  text(result.excerpt, `${path}.excerpt`, 2_000_000)
  count(result.characterCount, `${path}.characterCount`)
  if (beats) count(result.beatCount, `${path}.beatCount`)
}

function proposalAndPlanning(field: string, list = false): IpcValueDecoder {
  return (value, path) => {
    const result = object(value, path)
    planningPackage(result.proposal, `${path}.proposal`)
    requireAdoption(result.proposal, `${path}.proposal`, field, list)
    planningStatusResult(result.planning, `${path}.planning`)
    return value
  }
}

function characterSeedResult(value: unknown, path: string): unknown {
  const result = object(value, path)
  planningPackage(result.proposal, `${path}.proposal`)
  requireAdoption(result.proposal, `${path}.proposal`, 'characterSeeds')
  characterStateResult(result.characters, `${path}.characters`)
  return value
}

function worldSeedResult(value: unknown, path: string): unknown {
  const result = object(value, path)
  planningPackage(result.proposal, `${path}.proposal`)
  requireAdoption(result.proposal, `${path}.proposal`, 'worldSeed')
  const foundation = object(result.foundation, `${path}.foundation`)
  oneOf(foundation.creationPath, ['research', 'materials'], `${path}.foundation.creationPath`)
  for (const field of ['sourceNotes', 'worldView'] as const) text(foundation[field], `${path}.foundation.${field}`, 2_000_000)
  bool(foundation.useRealms, `${path}.foundation.useRealms`)
  bool(foundation.useSystem, `${path}.foundation.useSystem`)
  return value
}

function overviewResult(field: 'powerSystem' | 'cheatSystem'): IpcValueDecoder {
  return (value, path) => {
    const result = object(value, path)
    planningPackage(result.proposal, `${path}.proposal`)
    requireAdoption(result.proposal, `${path}.proposal`, field)
    text(object(result[field], `${path}.${field}`).overview, `${path}.${field}.overview`, 2_000_000)
    return value
  }
}

function requireAdoption(value: unknown, path: string, field: string, list = false): void {
  const proposal = object(value, path)
  const adoption = object(proposal.adoption, `${path}.adoption`)
  if (!Object.prototype.hasOwnProperty.call(adoption, field)) invalid(`${path}.adoption.${field}`)
  if (list && array(adoption[field], `${path}.adoption.${field}`).length === 0) invalid(`${path}.adoption.${field}`)
}

function skeletonStatus(value: unknown, path: string): unknown {
  const result = object(value, path)
  bool(result.exists, `${path}.exists`)
  bool(result.stale, `${path}.stale`)
  count(result.chapterCount, `${path}.chapterCount`)
  count(result.volumeCount, `${path}.volumeCount`)
  if (result.reason !== undefined) text(result.reason, `${path}.reason`, 100_000)
  return value
}

function detailStatus(value: unknown, path: string): unknown {
  const result = object(value, path)
  positive(result.volume, `${path}.volume`)
  bool(result.exists, `${path}.exists`)
  bool(result.stale, `${path}.stale`)
  count(result.chapterCount, `${path}.chapterCount`)
  if (result.reason !== undefined) text(result.reason, `${path}.reason`, 100_000)
  return value
}

function successResult(value: unknown, path: string): unknown {
  literal(object(value, path).success, true, `${path}.success`)
  return value
}

function recoveryResult(value: unknown, path: string): unknown {
  const result = object(value, path)
  literal(result.success, true, `${path}.success`)
  text(result.recoveryRelativePath, `${path}.recoveryRelativePath`, 32_767)
  return value
}

function characterSeedCandidate(value: unknown, path: string, optional = false): void {
  const result = object(value, path)
  for (const field of ['role', 'arcSeed'] as const) {
    if (!optional || result[field] !== undefined) text(result[field], `${path}.${field}`, 100_000)
  }
}

function fingerprints(value: unknown, path: string, fields: readonly string[]): void {
  const result = object(value, path)
  for (const field of fields) fingerprint(result[field], `${path}.${field}`)
}

function countsAndBooleans(value: unknown, path: string, counts: readonly string[], booleans: readonly string[]): void {
  const result = object(value, path)
  for (const field of counts) count(result[field], `${path}.${field}`)
  for (const field of booleans) bool(result[field], `${path}.${field}`)
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

function date(value: unknown, path: string): string {
  const result = text(value, path, 100)
  if (!Number.isFinite(Date.parse(result))) invalid(path)
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

function integer(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) invalid(path)
  return Number(value)
}

function count(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(path)
  return Number(value)
}

function oneOf(value: unknown, allowed: readonly string[], path: string): string {
  if (typeof value !== 'string' || !allowed.includes(value)) invalid(path)
  return value
}

function literal(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) invalid(path)
}

function stringArray(value: unknown, path: string): void {
  array(value, path).forEach((item, index) => text(item, `${path}[${index}]`, 100_000))
}

function invalid(path: string): never {
  throw new TypeError(`Invalid IPC result at ${path}`)
}

function formalSkeletonView(value: unknown, path: string): unknown {
  const v = object(value, path)
  integer(v.volume, `${path}.volume`, 1, 1000)
  formalDigest(v.fingerprint, `${path}.fingerprint`)
  bool(v.canAdopt, `${path}.canAdopt`)
  text(v.reason, `${path}.reason`, 2000)
  const entries = array(v.entries, `${path}.entries`)
  if (entries.length > 50000) throw new Error('Formal skeleton result exceeds bounds')
  const ids = new Set<number>()
  entries.forEach((raw, index) => {
    const row = object(raw, `${path}.entries[${index}]`)
    integer(row.chapter, `${path}.chapter`, 1, 1000000)
    if (ids.has(row.chapter as number)) throw new Error('Duplicate skeleton chapter')
    ids.add(row.chapter as number)
    text(row.title, `${path}.title`, 200)
    if (row.revision !== null) formalDigest(row.revision, `${path}.revision`)
    oneOf(row.status, ['untracked', 'current', 'stale', 'changed'], `${path}.status`)
    array(row.reasons, `${path}.reasons`).forEach(reason => text(reason, `${path}.reason`, 2000))
  })
  array(v.affectedChapterIds, `${path}.affectedChapterIds`).forEach(id => {
    integer(id, `${path}.affectedChapterId`, 1, 1000000)
    if (!ids.has(id as number)) throw new Error('Unknown affected skeleton chapter')
  })
  return value
}
function formalSkeletonPreview(value: unknown, path: string): unknown {
  formalSkeletonView(value, path)
  const v = object(value, path)
  identifier(v.token, `${path}.token`)
  identifier(v.proposalId, `${path}.proposalId`)
  return value
}

function formalDigest(value: unknown, path: string): void {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid(path)
}

function chapterEventPreview(value: unknown, path: string): unknown {
  const v = object(value, path)
  identifier(v.workItemId, `${path}.workItemId`); identifier(v.proposalId, `${path}.proposalId`)
  integer(v.chapterId, `${path}.chapterId`, 1, 1000000)
  formalDigest(v.fingerprint, `${path}.fingerprint`)
  oneOf(v.freshness, ['current', 'stale', 'untracked'], `${path}.freshness`)
  const c = object(v.candidate, `${path}.candidate`)
  if (c.time !== null) invalid(`${path}.candidate.time`)
  text(c.title, `${path}.candidate.title`, 200)
  for (const key of ['location', 'coreEvent', 'plannedResult', 'entryState', 'exitState']) text(c[key], `${path}.candidate.${key}`, 5000)
  const texts = (input: unknown, name: string, max: number, length: number) => {
    const values = array(input, name)
    if (!values.length || values.length > max) invalid(name)
    values.forEach((item, index) => { text(item, `${name}[${index}]`, length); if (!(item as string).trim()) invalid(name) })
  }
  texts(c.characters, `${path}.candidate.characters`, 500, 120)
  texts(c.beats, `${path}.candidate.beats`, 8, 5000)
  const events = array(v.formalEvents, `${path}.formalEvents`)
  if (events.length > 200) invalid(`${path}.formalEvents`)
  const ids = new Set<unknown>()
  events.forEach((item, index) => {
    const e = object(item, `${path}.formalEvents[${index}]`)
    identifier(e.id, `${path}.event.id`)
    if (ids.has(e.id)) invalid(`${path}.formalEvents`)
    ids.add(e.id)
    if (e.version !== null) identifier(e.version, `${path}.event.version`)
    if (e.replaceable !== undefined) bool(e.replaceable, `${path}.event.replaceable`)
    oneOf(e.phase, ['planned', 'realized', 'deviated', 'legacy-unknown'], `${path}.event.phase`)
    for (const key of ['time', 'location', 'event']) text(e[key], `${path}.event.${key}`, 100000)
    if (e.result !== null) text(e.result, `${path}.event.result`, 100000)
    const people = array(e.characters, `${path}.event.characters`)
    if (people.length > 1000) invalid(`${path}.event.characters`)
    people.forEach(person => text(person, `${path}.event.character`, 2000))
  })
  const findings = array(v.findings, `${path}.findings`)
  if (findings.length < 2 || findings.length > 3) invalid(`${path}.findings`)
  const codes = new Set<unknown>()
  findings.forEach(item => {
    const f = object(item, `${path}.finding`)
    oneOf(f.code, ['TIME_UNSPECIFIED', 'SOURCE_CHANGED', 'UNTRACKED_CANDIDATE', 'SEMANTIC_REVIEW_REQUIRED'], `${path}.finding.code`)
    if (codes.has(f.code)) invalid(`${path}.findings`)
    codes.add(f.code); text(f.message, `${path}.finding.message`, 2000)
  })
  if (!codes.has('TIME_UNSPECIFIED') || !codes.has('SEMANTIC_REVIEW_REQUIRED')
    || (v.freshness === 'current' && findings.length !== 2)
    || (v.freshness === 'stale' && !codes.has('SOURCE_CHANGED'))
    || (v.freshness === 'untracked' && !codes.has('UNTRACKED_CANDIDATE'))) invalid(`${path}.findings`)
  return value
}
