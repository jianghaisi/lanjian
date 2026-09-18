import { AppError } from '../../../core/errors/app-error'
import { storyEventSignature } from '../../timeline/domain/story-event'
import type { WorkspaceCanonicalEventRecord, WorkspaceMaterialSourceRecord } from '../../../core/ports/workspace-database'

/** Legacy storage constraints only; successful validation grants no import/approval authority.
 * Collection dedup remains for compatibility writes. Review validates each occurrence separately.
 */
export function assertMaterialSources(sources: unknown): asserts sources is WorkspaceMaterialSourceRecord[] {
  if (!Array.isArray(sources) || sources.length > 100_000) throw new AppError('VALIDATION_ERROR', '素材资料数量无效。', { recoverable: true })
  const ids = new Set<string>()
  const hashes = new Set<string>()
  const urls = new Set<string>()
  for (const value of sources) {
    const source = record(value) as WorkspaceMaterialSourceRecord
    assertBoundedIdentifier(source.id, '素材资料 ID')
    assertBoundedText(source.provider, '素材来源', 200)
    assertBoundedText(source.title, '素材标题', 200)
    assertBoundedText(source.excerpt, '素材摘录', 20_000)
    assertBoundedText(source.userNotes, '素材整理', 20_000)
    assertBoundedText(source.capturedAt, '素材采集时间', 100)
    if (!source.provider.trim() || !source.title.trim() || (!source.excerpt.trim() && !source.userNotes.trim())) {
      throw new AppError('VALIDATION_ERROR', '素材资料需要来源、标题，并至少保留摘录或作者整理。', { recoverable: true })
    }
    if (!['manual', 'web', 'toutiao', 'douyin-baike', 'douyin-video', 'other'].includes(source.sourceType)) {
      throw new AppError('VALIDATION_ERROR', '素材资料来源类型无效。', { recoverable: true })
    }
    for (const [value, label, limit] of [[source.externalId, '素材外部 ID', 500], [source.url, '素材网址', 2_000],
      [source.author, '素材作者', 500], [source.publishedAt, '素材发布时间', 100], [source.updatedAt, '素材更新时间', 100]] as const) {
      if (value !== undefined) assertBoundedText(value, label, limit)
    }
    if (!isSha256(source.contentHash)) throw new AppError('VALIDATION_ERROR', '素材资料指纹无效。', { recoverable: true })
    if (source.references !== undefined) {
      if (!Array.isArray(source.references) || source.references.length > 100) throw new AppError('VALIDATION_ERROR', '素材来源列表无效。', { recoverable: true })
      for (const reference of source.references) {
        record(reference)
        assertBoundedText(reference.title, '素材来源标题', 500)
        assertBoundedText(reference.url, '素材来源网址', 2_000)
        if (!reference.title.trim() || !reference.url.trim()) throw new AppError('VALIDATION_ERROR', '素材来源标题和网址不能为空。', { recoverable: true })
      }
    }
    const url = normalizedMaterialUrl(source.url)
    if (ids.has(source.id) || hashes.has(source.contentHash) || (url !== null && urls.has(url))) {
      throw new AppError('CONFLICT', '素材资料中存在重复项目。', { recoverable: true })
    }
    ids.add(source.id); hashes.add(source.contentHash); if (url !== null) urls.add(url)
  }
}

export function normalizedMaterialUrl(value?: string): string | null {
  const normalized = value?.trim().replace(/\/$/, '').toLocaleLowerCase('en-US') || ''
  return normalized || null
}

export function assertCanonicalEvents(events: unknown): asserts events is WorkspaceCanonicalEventRecord[] {
  if (!Array.isArray(events) || events.length > 100_000) throw new AppError('VALIDATION_ERROR', '正式事件数量无效。', { recoverable: true })
  const ids = new Set<string>()
  const signatures = new Set<string>()
  for (const value of events) {
    const event = record(value) as WorkspaceCanonicalEventRecord
    assertBoundedIdentifier(event.id, '事件 ID')
    assertBoundedText(event.time, '事件时间', 500)
    assertBoundedText(event.location, '事件地点', 500)
    assertBoundedText(event.event, '事件内容', 20_000)
    assertBoundedText(event.createdAt, '事件创建时间', 100)
    if (!event.time.trim() || !event.location.trim() || !event.event.trim() || !Array.isArray(event.characters)
      || !event.characters.length || event.characters.length > 100 || event.characters.some((name) => typeof name !== 'string' || !name.trim() || name.length > 200)) {
      throw new AppError('VALIDATION_ERROR', '事件必须包含有效的时间、人物、地点和内容。', { recoverable: true })
    }
    if (event.result !== undefined) assertBoundedText(event.result, '事件结果', 20_000)
    if (!Number.isFinite(event.confidence) || event.confidence < 0 || event.confidence > 1 || !['candidate', 'approved'].includes(event.status)) {
      throw new AppError('VALIDATION_ERROR', '事件置信度或状态无效。', { recoverable: true })
    }
    if (event.conflictGroupId !== undefined) assertBoundedIdentifier(event.conflictGroupId, '事件冲突组')
    if (event.approvedAt !== undefined) assertBoundedText(event.approvedAt, '事件批准时间', 100)
    if (!Array.isArray(event.evidenceRefs) || !event.evidenceRefs.length || event.evidenceRefs.length > 100) {
      throw new AppError('VALIDATION_ERROR', '事件必须保留至少一条来源证据。', { recoverable: true })
    }
    event.evidenceRefs.forEach((reference) => {
      record(reference)
      assertBoundedIdentifier(reference.sourceId, '事件来源 ID')
      assertBoundedText(reference.excerpt, '事件证据摘录', 2_000)
      if (!reference.excerpt.trim()) throw new AppError('VALIDATION_ERROR', '事件证据摘录不能为空。', { recoverable: true })
    })
    const signature = storyEventSignature(event)
    if (ids.has(event.id) || signatures.has(signature)) throw new AppError('CONFLICT', '正式事件中存在重复项目。', { recoverable: true })
    ids.add(event.id); signatures.add(signature)
  }
}

function record(value: unknown): object {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('VALIDATION_ERROR', '素材或事件记录结构无效。', { recoverable: true })
  }
  return value
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function assertBoundedText(value: unknown, label: string, maxLength: number): asserts value is string {
  if (typeof value !== 'string' || value.length > maxLength || /\u0000/.test(value)) {
    throw new AppError('VALIDATION_ERROR', `${label}无效或超过 ${maxLength} 字符。`, { recoverable: true })
  }
}

function assertBoundedIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\u0000-\u001f]/.test(value)) {
    throw new AppError('VALIDATION_ERROR', `${label}无效。`, { recoverable: true })
  }
}
