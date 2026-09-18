import { AppError } from '../core/app-error'

export const worldMapStylePresets = ['paper-atlas', 'future-industrial', 'urban-intelligence', 'dark-fantasy', 'eastern-fantasy'] as const
export type WorldMapStylePreset = typeof worldMapStylePresets[number]
export type WorldMapMarker = { location: string; x: number; y: number; sourceLocations?: string[] }
export type WorldMapBackground = {
  assetId: string
  format: 'png' | 'jpeg' | 'webp'
  width: number
  height: number
  stylePreset: WorldMapStylePreset
  model: string
  generatedAt: string
  sourceFingerprint: string
}
/** Planar percentages on the author's fictional map, never latitude/longitude. */
export type WorldMapDocument =
  | { version: 1; markers: WorldMapMarker[] }
  | { version: 2; markers: WorldMapMarker[]; background: WorldMapBackground | null }
export type WorldMapLayoutView = { workItemId: string; document: WorldMapDocument; revision: string; mirrorStatus: 'synced' | 'pending' | 'conflict' | 'failed' | null }
export type WorldMapWriteInput = { workItemId: string; expectedRevision: string; document: WorldMapDocument }
export type WorldMapEvent = { id: string; source: 'direct' | 'canonical'; sourceId: string; title: string; time: string; characters: string[]; location: string; event: string; result: string; chapterId: number | null }
export type WorldMapView = WorldMapLayoutView & { events: WorldMapEvent[]; chapters: Array<{ id: number; position: number; title: string }> }
export type WorldMapImageGenerateInput = { operationId: string; workItemId: string; expectedRevision: string; connectionId: string; model: string; stylePreset: WorldMapStylePreset }
export type WorldMapImageAdoptInput = { workItemId: string; expectedRevision: string; candidateId: string }
export type WorldMapPromptSummary = { locations: number; events: number; characters: number; sentCharacters: number }
export type WorldMapImageCandidate = {
  candidateId: string; workItemId: string; expectedRevision: string; sourceFingerprint: string
  stylePreset: WorldMapStylePreset; model: string; connectionName: string; promptSummary: WorldMapPromptSummary
  image: { dataUrl: string; format: WorldMapBackground['format']; width: number; height: number }
}
export type WorldMapBackgroundView = { workItemId: string; assetId: string; dataUrl: string; width: number; height: number } | null
export type WorldMapCancelResult = { cancelled: boolean }

function invalid(): never { throw new AppError('VALIDATION_ERROR', '小说地图数据格式无效，请重新读取后再试。', { recoverable: true }) }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) invalid()
  return record
}
function text(value: unknown, max: number, nonempty = false): string {
  if (typeof value !== 'string' || value.length > max || (nonempty && !value.trim())) invalid()
  return value
}
function revision(value: unknown): string { const hash = text(value, 64); if (!/^[a-f0-9]{64}$/.test(hash)) invalid(); return hash }
function number(value: unknown, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) invalid()
  return value
}
function array(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) invalid(); return value }
function hex(value: unknown): string { const result = text(value, 64); if (!/^[a-f0-9]{64}$/.test(result)) invalid(); return result }
function style(value: unknown): WorldMapStylePreset {
  if (typeof value !== 'string' || !worldMapStylePresets.includes(value as WorldMapStylePreset)) invalid()
  return value as WorldMapStylePreset
}
function format(value: unknown): WorldMapBackground['format'] {
  if (value !== 'png' && value !== 'jpeg' && value !== 'webp') invalid()
  return value
}
function isoDate(value: unknown): string {
  const result = text(value, 40, true)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(result) || !Number.isFinite(Date.parse(result))) invalid()
  return result
}

function markers(value: unknown): WorldMapMarker[] {
  const names = new Set<string>()
  let sourceCharacters = 0
  return array(value, 2000).map(value => {
    const hasSources = !!value && typeof value === 'object' && Object.hasOwn(value, 'sourceLocations')
    const marker = object(value, ['location', 'x', 'y', ...(hasSources ? ['sourceLocations'] : [])])
    const location = text(marker.location, 500, true)
    if (location !== location.trim() || names.has(location)) invalid()
    names.add(location)
    const sourceLocations = hasSources ? array(marker.sourceLocations, 256).map(value => {
      const source = text(value, 2000, true)
      if (source !== source.trim()) invalid()
      sourceCharacters += source.length
      if (sourceCharacters > 200_000) invalid()
      return source
    }) : undefined
    if (sourceLocations && (!sourceLocations.length || new Set(sourceLocations).size !== sourceLocations.length)) invalid()
    return { location, x: number(marker.x, 0, 100), y: number(marker.y, 0, 100), ...(sourceLocations ? { sourceLocations } : {}) }
  })
}

function background(value: unknown): WorldMapBackground | null {
  if (value === null) return null
  const item = object(value, ['assetId', 'format', 'width', 'height', 'stylePreset', 'model', 'generatedAt', 'sourceFingerprint'])
  return { assetId: hex(item.assetId), format: format(item.format), width: number(item.width, 1, 8192, true), height: number(item.height, 1, 8192, true),
    stylePreset: style(item.stylePreset), model: text(item.model, 200, true), generatedAt: isoDate(item.generatedAt), sourceFingerprint: hex(item.sourceFingerprint) }
}

export function decodeWorldMapDocument(value: unknown): WorldMapDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  const version = (value as Record<string, unknown>).version
  if (version === 1) { const record = object(value, ['version', 'markers']); return { version: 1, markers: markers(record.markers) } }
  if (version === 2) { const record = object(value, ['version', 'markers', 'background']); return { version: 2, markers: markers(record.markers), background: background(record.background) } }
  return invalid()
}
export function decodeWorldMapWriteInput(value: unknown): WorldMapWriteInput {
  const record = object(value, ['workItemId', 'expectedRevision', 'document'])
  return { workItemId: text(record.workItemId, 32_767, true), expectedRevision: revision(record.expectedRevision), document: decodeWorldMapDocument(record.document) }
}
function layout(record: Record<string, unknown>): WorldMapLayoutView {
  const status = record.mirrorStatus
  if (status !== null && status !== 'synced' && status !== 'pending' && status !== 'conflict' && status !== 'failed') invalid()
  return { workItemId: text(record.workItemId, 32_767, true), document: decodeWorldMapDocument(record.document), revision: revision(record.revision), mirrorStatus: status }
}
export function decodeWorldMapLayoutView(value: unknown): WorldMapLayoutView {
  return layout(object(value, ['workItemId', 'document', 'revision', 'mirrorStatus']))
}
export function decodeWorldMapView(value: unknown): WorldMapView {
  const record = object(value, ['workItemId', 'document', 'revision', 'mirrorStatus', 'events', 'chapters'])
  const ids = new Set<string>(), chapterIds = new Set<number>(), positions = new Set<number>()
  const events = array(record.events, 100_000).map((value): WorldMapEvent => {
    const event = object(value, ['id', 'source', 'sourceId', 'title', 'time', 'characters', 'location', 'event', 'result', 'chapterId'])
    const id = text(event.id, 600, true)
    if (ids.has(id) || (event.source !== 'direct' && event.source !== 'canonical')) invalid()
    const sourceId = text(event.sourceId, 500, true)
    if (id !== `${event.source}:${sourceId}` || (event.source === 'direct' && event.chapterId !== null)) invalid()
    ids.add(id)
    return { id, source: event.source, sourceId, title: text(event.title, 1000), time: text(event.time, 2000),
      characters: array(event.characters, 2000).map(name => text(name, 500, true)), location: text(event.location, 2000),
      event: text(event.event, 100_000), result: text(event.result, 100_000), chapterId: event.chapterId === null ? null : number(event.chapterId, 1, Number.MAX_SAFE_INTEGER, true) }
  })
  const chapters = array(record.chapters, 100_000).map(value => {
    const chapter = object(value, ['id', 'position', 'title'])
    const id = number(chapter.id, 1, Number.MAX_SAFE_INTEGER, true), position = number(chapter.position, 1, Number.MAX_SAFE_INTEGER, true)
    if (chapterIds.has(id) || positions.has(position)) invalid()
    chapterIds.add(id); positions.add(position)
    return { id, position, title: text(chapter.title, 2000) }
  })
  if (events.some(event => event.chapterId !== null && !chapterIds.has(event.chapterId))) invalid()
  return { ...layout(record), events, chapters }
}

export function decodeWorldMapImageGenerateInput(value: unknown): WorldMapImageGenerateInput {
  const record = object(value, ['operationId', 'workItemId', 'expectedRevision', 'connectionId', 'model', 'stylePreset'])
  const operationId = text(record.operationId, 64, true)
  if (!/^[a-f0-9-]{16,64}$/i.test(operationId)) invalid()
  // Legacy styles remain readable in saved documents, not selectable for new images.
  if (record.stylePreset !== 'paper-atlas') invalid()
  return { operationId, workItemId: text(record.workItemId, 32_767, true), expectedRevision: revision(record.expectedRevision),
    connectionId: text(record.connectionId, 128, true), model: text(record.model, 200, true).trim(), stylePreset: style(record.stylePreset) }
}
export function decodeWorldMapImageAdoptInput(value: unknown): WorldMapImageAdoptInput {
  const record = object(value, ['workItemId', 'expectedRevision', 'candidateId'])
  return { workItemId: text(record.workItemId, 32_767, true), expectedRevision: revision(record.expectedRevision), candidateId: hex(record.candidateId) }
}
export function decodeWorldMapOperationId(value: unknown): string {
  const operationId = text(value, 64, true)
  if (!/^[a-f0-9-]{16,64}$/i.test(operationId)) invalid()
  return operationId
}
export function decodeWorldMapImageCandidate(value: unknown): WorldMapImageCandidate {
  const record = object(value, ['candidateId', 'workItemId', 'expectedRevision', 'sourceFingerprint', 'stylePreset', 'model', 'connectionName', 'promptSummary', 'image'])
  const summary = object(record.promptSummary, ['locations', 'events', 'characters', 'sentCharacters'])
  const image = object(record.image, ['dataUrl', 'format', 'width', 'height'])
  const imageFormat = format(image.format)
  const dataUrl = text(image.dataUrl, 18_000_000, true)
  if (!dataUrl.startsWith(`data:image/${imageFormat};base64,`)) invalid()
  return { candidateId: hex(record.candidateId), workItemId: text(record.workItemId, 32_767, true), expectedRevision: revision(record.expectedRevision),
    sourceFingerprint: hex(record.sourceFingerprint), stylePreset: style(record.stylePreset), model: text(record.model, 200, true), connectionName: text(record.connectionName, 80, true),
    promptSummary: { locations: number(summary.locations, 0, 2000, true), events: number(summary.events, 0, 100_000, true), characters: number(summary.characters, 0, 100_000, true), sentCharacters: number(summary.sentCharacters, 0, 20_000, true) },
    image: { dataUrl, format: imageFormat, width: number(image.width, 1, 8192, true), height: number(image.height, 1, 8192, true) } }
}
export function decodeWorldMapBackgroundView(value: unknown): WorldMapBackgroundView {
  if (value === null) return null
  const record = object(value, ['workItemId', 'assetId', 'dataUrl', 'width', 'height'])
  const dataUrl = text(record.dataUrl, 18_000_000, true)
  if (!/^data:image\/(?:png|jpeg|webp);base64,/.test(dataUrl)) invalid()
  return { workItemId: text(record.workItemId, 32_767, true), assetId: hex(record.assetId), dataUrl,
    width: number(record.width, 1, 8192, true), height: number(record.height, 1, 8192, true) }
}
export function decodeWorldMapCancelResult(value: unknown): WorldMapCancelResult {
  const record = object(value, ['cancelled'])
  if (typeof record.cancelled !== 'boolean') invalid()
  return { cancelled: record.cancelled }
}
