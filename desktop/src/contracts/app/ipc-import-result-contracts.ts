import { characterStateResult, planningStatusResult, type IpcValueDecoder } from '../core/ipc-result-contracts'
import { decodeCreativePolicyRecords } from '../writing-plugins/creative-policy'

const previewChannels: Array<[string, ContinuationArea]> = [
  ['imports:preview-continuation-project-definition', 'projectDefinition'],
  ['imports:preview-continuation-existing-plot', 'existingPlot'],
  ['imports:preview-continuation-character', 'characters'],
  ['imports:preview-continuation-world-view', 'worldView'],
  ['imports:preview-continuation-power-system', 'powerSystem'],
  ['imports:preview-continuation-cheat-system', 'cheatSystem'],
  ['imports:preview-continuation-total-outline', 'totalOutline'],
  ['imports:preview-continuation-volume-outline', 'volumeOutline'],
  ['imports:preview-continuation-chapter-outline', 'chapterOutline']
]

const adoptionChannels: Array<[string, ContinuationArea]> = [
  ['imports:adopt-continuation-project-definition', 'projectDefinition'],
  ['imports:adopt-continuation-existing-plot', 'existingPlot'],
  ['imports:adopt-continuation-character', 'characters'],
  ['imports:adopt-continuation-world-view', 'worldView'],
  ['imports:adopt-continuation-power-system', 'powerSystem'],
  ['imports:adopt-continuation-cheat-system', 'cheatSystem'],
  ['imports:adopt-continuation-total-outline', 'totalOutline'],
  ['imports:adopt-continuation-volume-outline', 'volumeOutline'],
  ['imports:adopt-continuation-chapter-outline', 'chapterOutline']
]

type ContinuationArea = 'projectDefinition' | 'existingPlot' | 'characters' | 'worldView' | 'powerSystem' | 'cheatSystem' | 'totalOutline' | 'volumeOutline' | 'chapterOutline'

export const importIpcValueDecoders: Readonly<Record<string, IpcValueDecoder>> = {
  'imports:choose-text': nullable(txtPreview),
  'imports:choose-documents': nullable(importManifest),
  'imports:append-documents': nullable(importManifest),
  'imports:commit-text': txtImportResult,
  'imports:commit-manifest': importManifestResult,
  'imports:recoverable-manifests': listOf(importRecovery),
  'imports:resume-manifest': importManifestResult,
  'imports:continuation-analysis': continuationState,
  'imports:generate-continuation-analysis': continuationCandidate,
  'imports:save-continuation-analysis': continuationCandidate,
  ...Object.fromEntries(previewChannels.map(([channel, area]) => [channel, continuationPreview(area)])),
  ...Object.fromEntries(adoptionChannels.map(([channel, area]) => [channel, continuationAdoption(area)]))
}

function txtPreview(value: unknown, path: string): unknown {
  const result = object(value, path)
  identifier(result.token, `${path}.token`)
  for (const field of ['fileName', 'suggestedTitle', 'encoding'] as const) text(result[field], `${path}.${field}`, 32_767)
  oneOf(result.sourceFormat, ['TXT', 'Markdown', 'Word'], `${path}.sourceFormat`)
  for (const field of ['bytes', 'characterCount', 'wordCount', 'chapterCount', 'recommendedChapterCount'] as const) count(result[field], `${path}.${field}`)
  bool(result.detectedHeadings, `${path}.detectedHeadings`)
  bool(result.reviewRequired, `${path}.reviewRequired`)
  array(result.chapters, `${path}.chapters`).forEach((item, index) => txtChapter(item, `${path}.chapters[${index}]`))
  stringArray(result.warnings, `${path}.warnings`, 10_000)
  return value
}

function txtChapter(value: unknown, path: string): void {
  const result = object(value, path)
  count(result.sourceIndex, `${path}.sourceIndex`)
  positive(result.order, `${path}.order`)
  if (result.chapterNumber !== undefined) positive(result.chapterNumber, `${path}.chapterNumber`)
  text(result.title, `${path}.title`, 500)
  count(result.wordCount, `${path}.wordCount`)
  text(result.preview, `${path}.preview`, 100_000)
  oneOf(result.status, ['ready', 'review'], `${path}.status`)
  stringArray(result.issues, `${path}.issues`, 10_000)
  bool(result.selectedByDefault, `${path}.selectedByDefault`)
}

function importManifest(value: unknown, path: string): unknown {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  array(result.files, `${path}.files`).forEach((item, index) => {
    txtPreview(item, `${path}.files[${index}]`)
    const file = object(item, `${path}.files[${index}]`)
    oneOf(file.recommendedRole, ['manuscript', 'material'], `${path}.files[${index}].recommendedRole`)
    text(file.recommendationReason, `${path}.files[${index}].recommendationReason`, 10_000)
  })
  count(result.totalBytes, `${path}.totalBytes`)
  count(result.totalWordCount, `${path}.totalWordCount`)
  stringArray(result.warnings, `${path}.warnings`, 10_000)
  return value
}

function txtImportResult(value: unknown, path: string): unknown {
  const result = object(value, path)
  oneOf(result.ownership, ['owned', 'material', 'external'], `${path}.ownership`)
  text(result.title, `${path}.title`, 500)
  array(result.importedChapterIds, `${path}.importedChapterIds`).forEach((item, index) => positive(item, `${path}.importedChapterIds[${index}]`))
  if (result.importedSourceIds !== undefined) stringArray(result.importedSourceIds, `${path}.importedSourceIds`, 512)
  return value
}

function importManifestResult(value: unknown, path: string): unknown {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  literal(result.status, 'completed', `${path}.status`)
  array(result.results, `${path}.results`).forEach((item, index) => txtImportResult(item, `${path}.results[${index}]`))
  return value
}

function importRecovery(value: unknown, path: string): unknown {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  oneOf(result.status, ['ready', 'committing', 'interrupted', 'needs-review'], `${path}.status`)
  date(result.createdAt, `${path}.createdAt`)
  count(result.completedCount, `${path}.completedCount`)
  count(result.totalCount, `${path}.totalCount`)
  bool(result.canResume, `${path}.canResume`)
  text(result.message, `${path}.message`, 10_000)
  array(result.files, `${path}.files`).forEach((item, index) => {
    const file = object(item, `${path}.files[${index}]`)
    text(file.fileName, `${path}.files[${index}].fileName`, 32_767)
    oneOf(file.ownership, ['owned', 'material', 'external', 'skip'], `${path}.files[${index}].ownership`)
    oneOf(file.status, ['pending', 'running', 'completed', 'skipped', 'review'], `${path}.files[${index}].status`)
  })
  return value
}

function continuationState(value: unknown, path: string): unknown {
  const result = object(value, path)
  if (result.candidate !== null) continuationCandidate(result.candidate, `${path}.candidate`)
  if (result.availableManifestId !== undefined) identifier(result.availableManifestId, `${path}.availableManifestId`)
  if (result.blockedReason !== undefined) text(result.blockedReason, `${path}.blockedReason`, 10_000)
  return value
}

function continuationCandidate(value: unknown, path: string): unknown {
  const result = object(value, path)
  literal(result.version, 1, `${path}.version`)
  for (const field of ['id', 'workItemId', 'manifestId', 'sourceFingerprint'] as const) identifier(result[field], `${path}.${field}`)
  date(result.createdAt, `${path}.createdAt`)
  date(result.updatedAt, `${path}.updatedAt`)
  literal(result.status, 'candidate', `${path}.status`)
  array(result.sections, `${path}.sections`).forEach((item, index) => {
    const section = object(item, `${path}.sections[${index}]`)
    area(section.area, `${path}.sections[${index}].area`)
    oneOf(section.status, ['found', 'missing', 'conflict'], `${path}.sections[${index}].status`)
    text(section.content, `${path}.sections[${index}].content`, 2_000_000)
    evidence(section.evidence, `${path}.sections[${index}].evidence`)
  })
  array(result.gaps, `${path}.gaps`).forEach((item, index) => {
    const gap = object(item, `${path}.gaps[${index}]`)
    identifier(gap.id, `${path}.gaps[${index}].id`)
    oneOf(gap.level, ['required', 'recommended', 'conflict'], `${path}.gaps[${index}].level`)
    area(gap.area, `${path}.gaps[${index}].area`)
    text(gap.title, `${path}.gaps[${index}].title`, 10_000)
    text(gap.suggestion, `${path}.gaps[${index}].suggestion`, 10_000)
  })
  text(result.rationale, `${path}.rationale`, 100_000)
  if (result.adoption !== undefined) adoptionLedger(result.adoption, `${path}.adoption`)
  if (result.creativePolicy !== undefined) decodeCreativePolicyRecords(result.creativePolicy)
  return value
}

function adoptionLedger(value: unknown, path: string): void {
  const result = object(value, path)
  if (result.projectDefinition !== undefined) adoptionReceipt(result.projectDefinition, `${path}.projectDefinition`, ['candidateFingerprint', 'profileFingerprint'])
  if (result.worldView !== undefined) adoptionReceipt(result.worldView, `${path}.worldView`, ['candidateFingerprint', 'foundationFingerprint'])
  if (result.powerSystem !== undefined) adoptionReceipt(result.powerSystem, `${path}.powerSystem`, ['candidateFingerprint', 'powerSystemFingerprint'])
  if (result.cheatSystem !== undefined) adoptionReceipt(result.cheatSystem, `${path}.cheatSystem`, ['candidateFingerprint', 'cheatSystemFingerprint'])
  if (result.totalOutline !== undefined) {
    const receipt = adoptionReceipt(result.totalOutline, `${path}.totalOutline`, ['candidateFingerprint', 'outlineFingerprint', 'prerequisiteFingerprint'])
    count(receipt.revision, `${path}.totalOutline.revision`)
  }
  adoptionReceiptList(result.existingPlot, `${path}.existingPlot`, ['candidateFingerprint', 'eventFingerprint', 'timelineEventId'], (receipt, itemPath) => {
    for (const field of ['eventVersionId', 'operationId', 'sourceManifestId'] as const) {
      if (receipt[field] !== undefined) identifier(receipt[field], `${itemPath}.${field}`)
    }
    if (receipt.sourceFingerprint !== undefined) identifier(receipt.sourceFingerprint, `${itemPath}.sourceFingerprint`)
  })
  adoptionReceiptList(result.characters, `${path}.characters`, ['candidateFingerprint', 'anchorFingerprint', 'name'])
  adoptionReceiptList(result.volumeOutlines, `${path}.volumeOutlines`, ['candidateFingerprint', 'outlineFingerprint', 'parentTotalFingerprint'], (receipt, itemPath) => {
    positive(receipt.volume, `${itemPath}.volume`)
    count(receipt.revision, `${itemPath}.revision`)
  })
  adoptionReceiptList(result.chapterOutlines, `${path}.chapterOutlines`, ['candidateFingerprint', 'outlineFingerprint', 'parentTotalFingerprint', 'parentVolumeFingerprint'], (receipt, itemPath) => {
    positive(receipt.chapterId, `${itemPath}.chapterId`)
  })
}

function continuationPreview(expectedArea: ContinuationArea): IpcValueDecoder {
  return (value, path) => {
    const result = object(value, path)
    identifier(result.candidateId, `${path}.candidateId`)
    literal(result.area, expectedArea, `${path}.area`)
    bool(result.canAdopt, `${path}.canAdopt`)
    if (result.reason !== undefined) text(result.reason, `${path}.reason`, 10_000)
    if (result.evidence !== undefined) evidence(result.evidence, `${path}.evidence`)
    if (result.changes !== undefined) bool(result.changes, `${path}.changes`)
    for (const field of Object.keys(result).filter((field) => /Fingerprint$/.test(field))) identifier(result[field], `${path}.${field}`)
    switch (expectedArea) {
      case 'projectDefinition':
        text(result.currentCoreIdea, `${path}.currentCoreIdea`, 2_000_000)
        text(result.candidateCoreIdea, `${path}.candidateCoreIdea`, 2_000_000)
        stringArray(result.preserved, `${path}.preserved`, 100_000)
        break
      case 'existingPlot':
        text(result.candidateEvent, `${path}.candidateEvent`, 2_000_000)
        break
      case 'characters':
        text(result.candidateSummary, `${path}.candidateSummary`, 2_000_000)
        characterDraft(result.character, `${path}.character`)
        oneOf(result.action, ['create', 'enrich', 'update', 'keep'], `${path}.action`)
        if (result.current !== undefined) object(result.current, `${path}.current`)
        requiredCounts(result.affected, `${path}.affected`, ['existingAnchors', 'dynamicSnapshots', 'pendingConflicts'])
        break
      case 'worldView':
        text(result.currentWorldView, `${path}.currentWorldView`, 2_000_000)
        text(result.candidateWorldView, `${path}.candidateWorldView`, 2_000_000)
        stringArray(result.preserved, `${path}.preserved`, 100_000)
        break
      case 'powerSystem':
        text(result.currentOverview, `${path}.currentOverview`, 2_000_000)
        text(result.candidateOverview, `${path}.candidateOverview`, 2_000_000)
        requiredCounts(result.preserved, `${path}.preserved`, ['realmLevels'])
        bool(object(result.preserved, `${path}.preserved`).realmsEnabled, `${path}.preserved.realmsEnabled`)
        break
      case 'cheatSystem':
        text(result.currentOverview, `${path}.currentOverview`, 2_000_000)
        text(result.candidateOverview, `${path}.candidateOverview`, 2_000_000)
        requiredBooleans(result.preserved, `${path}.preserved`, ['systemEnabled', 'templateConfigured'])
        break
      case 'totalOutline':
        text(result.currentOutline, `${path}.currentOutline`, 2_000_000)
        text(result.candidateOutline, `${path}.candidateOutline`, 2_000_000)
        requiredCounts(result.affected, `${path}.affected`, ['currentRevision', 'volumeOutlines', 'chapterOutlines'])
        bool(object(result.affected, `${path}.affected`).totalConfirmed, `${path}.affected.totalConfirmed`)
        break
      case 'volumeOutline':
        text(result.currentOutline, `${path}.currentOutline`, 2_000_000)
        text(result.candidateOutline, `${path}.candidateOutline`, 2_000_000)
        requiredCounts(result.affected, `${path}.affected`, ['currentRevision', 'siblingVolumeOutlines', 'chapterOutlines'])
        bool(object(result.affected, `${path}.affected`).volumeConfirmed, `${path}.affected.volumeConfirmed`)
        positive(result.volume, `${path}.volume`)
        text(result.volumeTitle, `${path}.volumeTitle`, 500)
        break
      case 'chapterOutline':
        text(result.currentOutline, `${path}.currentOutline`, 2_000_000)
        text(result.candidateOutline, `${path}.candidateOutline`, 2_000_000)
        requiredCounts(result.affected, `${path}.affected`, ['siblingChapterOutlines', 'manuscriptWordCount'])
        bool(object(result.affected, `${path}.affected`).chapterConfirmed, `${path}.affected.chapterConfirmed`)
        positive(result.volume, `${path}.volume`)
        text(result.volumeTitle, `${path}.volumeTitle`, 500)
        positive(result.chapterId, `${path}.chapterId`)
        positive(result.chapterPosition, `${path}.chapterPosition`)
        text(result.chapterTitle, `${path}.chapterTitle`, 500)
        break
    }
    return value
  }
}

function continuationAdoption(expectedArea: ContinuationArea): IpcValueDecoder {
  return (value, path) => {
    const result = object(value, path)
    continuationCandidate(result.candidate, `${path}.candidate`)
    switch (expectedArea) {
      case 'projectDefinition': bookProfile(result.profile, `${path}.profile`); break
      case 'existingPlot':
        timelineEvent(result.event, `${path}.event`)
        array(object(result.timeline, `${path}.timeline`).events, `${path}.timeline.events`).forEach((item, index) => timelineEvent(item, `${path}.timeline.events[${index}]`))
        break
      case 'characters': characterStateResult(result.characters, `${path}.characters`); break
      case 'worldView': foundation(result.foundation, `${path}.foundation`); break
      case 'powerSystem': overview(result.powerSystem, `${path}.powerSystem`); break
      case 'cheatSystem': overview(result.cheatSystem, `${path}.cheatSystem`); break
      case 'totalOutline':
      case 'volumeOutline':
      case 'chapterOutline':
        planningStatusResult(result.planning, `${path}.planning`)
        text(result.content, `${path}.content`, 2_000_000)
        break
    }
    return value
  }
}

function bookProfile(value: unknown, path: string): void {
  const result = object(value, path)
  for (const field of ['genre', 'subgenre', 'coreIdea', 'audienceScale', 'defaultPov', 'narrativeDistance', 'writingStyle'] as const) text(result[field], `${path}.${field}`, 100_000)
  for (const field of ['plannedVolumes', 'chaptersPerVolume', 'targetWordsPerChapter', 'targetWords', 'autosaveDelayMs', 'autosaveMergeWindowMs'] as const) count(result[field], `${path}.${field}`)
  oneOf(result.proseExpansionMode, ['web-serial', 'balanced', 'compact'], `${path}.proseExpansionMode`)
  oneOf(result.reviewStrictness, ['balanced', 'strict'], `${path}.reviewStrictness`)
  if (result.chapterGenerationMode !== undefined) oneOf(result.chapterGenerationMode, ['reviewed'], `${path}.chapterGenerationMode`)
  bool(result.autosaveEnabled, `${path}.autosaveEnabled`)
}

function foundation(value: unknown, path: string): void {
  const result = object(value, path)
  oneOf(result.creationPath, ['research', 'materials'], `${path}.creationPath`)
  text(result.sourceNotes, `${path}.sourceNotes`, 2_000_000)
  text(result.worldView, `${path}.worldView`, 2_000_000)
  bool(result.useRealms, `${path}.useRealms`)
  bool(result.useSystem, `${path}.useSystem`)
}

function overview(value: unknown, path: string): void {
  text(object(value, path).overview, `${path}.overview`, 2_000_000)
}

function timelineEvent(value: unknown, path: string): void {
  const result = object(value, path)
  identifier(result.id, `${path}.id`)
  if (result.title !== undefined) text(result.title, `${path}.title`, 500)
  for (const field of ['time', 'characters', 'location', 'event'] as const) text(result[field], `${path}.${field}`, 100_000)
  if (result.result !== undefined) text(result.result, `${path}.result`, 100_000)
}

function characterDraft(value: unknown, path: string): void {
  const result = object(value, path)
  for (const field of ['name', 'role', 'arcSeed'] as const) text(result[field], `${path}.${field}`, 100_000)
}

function evidence(value: unknown, path: string): void {
  array(value, path).forEach((item, index) => {
    const ref = object(item, `${path}[${index}]`)
    text(ref.fileName, `${path}[${index}].fileName`, 32_767)
    text(ref.excerpt, `${path}[${index}].excerpt`, 100_000)
  })
}

function adoptionReceipt(value: unknown, path: string, identifiers: readonly string[]): Record<string, unknown> {
  const result = object(value, path)
  for (const field of identifiers) identifier(result[field], `${path}.${field}`)
  date(result.adoptedAt, `${path}.adoptedAt`)
  return result
}

function adoptionReceiptList(value: unknown, path: string, identifiers: readonly string[], extra?: (receipt: Record<string, unknown>, path: string) => void): void {
  if (value === undefined) return
  array(value, path).forEach((item, index) => {
    const itemPath = `${path}[${index}]`
    const receipt = adoptionReceipt(item, itemPath, identifiers)
    extra?.(receipt, itemPath)
  })
}

function requiredCounts(value: unknown, path: string, fields: readonly string[]): void {
  const result = object(value, path)
  for (const field of fields) count(result[field], `${path}.${field}`)
}

function requiredBooleans(value: unknown, path: string, fields: readonly string[]): void {
  const result = object(value, path)
  for (const field of fields) bool(result[field], `${path}.${field}`)
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

function count(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(path)
  return Number(value)
}

function positive(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) invalid(path)
  return Number(value)
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path)
  return value
}

function date(value: unknown, path: string): string {
  const result = text(value, path, 100)
  if (!Number.isFinite(Date.parse(result))) invalid(path)
  return result
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

function area(value: unknown, path: string): string {
  return oneOf(value, ['projectDefinition', 'existingPlot', 'characters', 'worldView', 'powerSystem', 'cheatSystem', 'totalOutline', 'volumeOutline', 'chapterOutline'], path)
}

function invalid(path: string): never {
  throw new TypeError(`Invalid import IPC result at ${path}`)
}
