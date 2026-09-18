import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import { normalizeStoryText, storyEventSignature } from '../../timeline/domain/story-event'
import { projectDirectory, projectExistingPath } from '../../../platform/storage/project-path'
import type { CanonicalEvent, EventCandidateCreateInput, SourceCard, SourceCardCreateInput, SourceCardUpdateInput } from '../../../../contracts/index'
import { writeJson } from '../../../platform/storage/json-store'
import { ProjectService } from './project-service'

type SourceStore = { version: 1; sources: SourceCard[] }
type EventStore = { version: 1; events: CanonicalEvent[] }
type FormalMaterialSourcePort = {
  readMaterialSources?(workItemId: string): Promise<SourceCard[] | null>
  readCanonicalEvents?(workItemId: string): Promise<CanonicalEvent[] | null>
  active(workItemId: string): Promise<boolean>
  materialSourcesReady(workItemId: string): Promise<boolean>
  materialSources(workItemId: string): Promise<SourceCard[]>
  searchMaterialSources(workItemId: string, queryTerms: string[], pinnedSourceIds?: string[], limit?: number): Promise<SourceCard[]>
  importMaterialSources(workItemId: string, sources: SourceCard[], observedMirrorHash?: string): Promise<SourceCard[]>
  addMaterialSources(workItemId: string, sources: SourceCard[]): Promise<SourceCard[]>
  updateMaterialSource(workItemId: string, source: SourceCard): Promise<SourceCard>
  canonicalEventsReady(workItemId: string): Promise<boolean>
  canonicalEvents(workItemId: string): Promise<CanonicalEvent[]>
  importCanonicalEvents(workItemId: string, events: CanonicalEvent[], observedMirrorHash?: string): Promise<CanonicalEvent[]>
  createCanonicalEvent(workItemId: string, event: CanonicalEvent): Promise<CanonicalEvent>
  approveCanonicalEvent(workItemId: string, id: string): Promise<CanonicalEvent>
}
type SourceBackend = { root: string; formal: boolean; sources: SourceCard[] }
type EventBackend = { root: string; formal: boolean; events: CanonicalEvent[] }

const emptySources = (): SourceStore => ({ version: 1, sources: [] })
const emptyEvents = (): EventStore => ({ version: 1, events: [] })

export class ResearchLibraryService {
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly projects: ProjectService, private readonly formalSources?: FormalMaterialSourcePort) {}

  async listSources(): Promise<{ sources: SourceCard[] }> {
    return { sources: structuredClone((await this.sourceBackend(false)).sources) }
  }

  async searchSources(queryTerms: string[], pinnedSourceIds: string[] = [], limit = 200): Promise<{ sources: SourceCard[]; formal: boolean }> {
    if (!Array.isArray(queryTerms) || queryTerms.length > 96 || queryTerms.some((term) => typeof term !== 'string' || term.length < 2 || term.length > 32)) {
      throw new AppError('VALIDATION_ERROR', '素材检索词无效。', { recoverable: true })
    }
    if (!Array.isArray(pinnedSourceIds) || pinnedSourceIds.length > 200 || pinnedSourceIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 512)) {
      throw new AppError('VALIDATION_ERROR', '固定素材范围无效。', { recoverable: true })
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2_000) throw new AppError('VALIDATION_ERROR', '素材检索上限无效。', { recoverable: true })
    const terms = [...new Set(queryTerms.map((term) => term.normalize('NFKC').trim().toLocaleLowerCase()).filter(Boolean))]
    const pinned = [...new Set(pinnedSourceIds.map((id) => id.trim()).filter(Boolean))]
    const backend = await this.sourceBackend(false)
    if (!backend.formal) {
      return { sources: structuredClone(backend.sources.filter((source) => pinned.includes(source.id) || sourceMatches(source, terms)).slice(0, limit)), formal: false }
    }
    const sources = await this.formalSources!.searchMaterialSources(backend.root, terms, pinned, limit)
    await this.assertCurrentRoot(backend.root)
    return { sources: structuredClone(sources), formal: true }
  }

  async createSource(input: SourceCardCreateInput): Promise<SourceCard> {
    return this.serialize(() => this.createSourceNow(input))
  }

  async updateSource(id: string, input: SourceCardUpdateInput): Promise<SourceCard> {
    return this.serialize(() => this.updateSourceNow(id, input))
  }

  async importManualDocument(title: string, content: string): Promise<SourceCard[]> {
    return this.serialize(async () => {
      const cleanTitle = title.trim()
      const chunks = splitManualDocument(content)
      if (!cleanTitle || !chunks.length) throw new AppError('VALIDATION_ERROR', '作者资料需要标题和可读取的文本内容。', { recoverable: true })
      const backend = await this.sourceBackend()
      const now = new Date().toISOString()
      const sources = chunks.map((excerpt, index): SourceCard => {
        const chunkTitle = chunks.length === 1 ? cleanTitle : `${cleanTitle}（${index + 1}/${chunks.length}）`
        return {
          id: crypto.randomUUID(),
          provider: 'txt-import',
          sourceType: 'manual',
          title: chunkTitle.slice(0, 200),
          capturedAt: now,
          excerpt,
          userNotes: '由作者作品相关文件导入；只作创作资料，需人工确认后才能成为正式事件或设定。',
          contentHash: sourceContentHash(chunkTitle, excerpt)
        }
      })
      const existing = new Set(backend.sources.map((item) => item.contentHash))
      if (sources.some((item) => existing.has(item.contentHash))) {
        throw new AppError('CONFLICT', '这份作者资料已经导入过，请直接使用已有资料卡。', { recoverable: true })
      }
      if (backend.sources.length + sources.length > 100_000) throw invalidSourceStore()
      await this.assertCurrentRoot(backend.root)
      if (backend.formal) await this.formalSources!.addMaterialSources(backend.root, sources)
      else {
        const store: SourceStore = { version: 1, sources: [...sources, ...backend.sources] }
        await writeJson(await this.file('sources.json', backend.root), store)
      }
      return structuredClone(sources)
    })
  }

  private async createSourceNow(input: SourceCardCreateInput): Promise<SourceCard> {
    const title = input.title.trim()
    const excerpt = input.excerpt.trim()
    const userNotes = input.userNotes.trim()
    const url = input.url?.trim() || undefined
    const sourceType = input.sourceType === 'web' ? 'web' : 'manual'
    const provider = input.provider?.trim() || (sourceType === 'web' ? 'web-research' : 'manual')
    const references = uniqueReferences(input.references || [])
    if (!title || (!excerpt && !userNotes)) throw new AppError('VALIDATION_ERROR', '资料卡需要标题，并至少填写摘录或个人笔记。', { recoverable: true })
    if (sourceType === 'web' && !url && !references.length) throw new AppError('VALIDATION_ERROR', '联网采风资料必须保留至少一个来源网址。', { recoverable: true })
    const contentHash = url
      ? createHash('sha256').update(normalizeSource(url)).digest('hex')
      : sourceContentHash(title, excerpt)
    const backend = await this.sourceBackend()
    if (backend.sources.some((item) => item.contentHash === contentHash || Boolean(url && item.url && normalizeSource(item.url) === normalizeSource(url)))) {
      throw new AppError('CONFLICT', '这条资料已经保存过，请直接使用已有资料卡。', { recoverable: true })
    }
    const source: SourceCard = {
      id: crypto.randomUUID(),
      provider,
      sourceType,
      title,
      ...(url ? { url } : {}),
      ...(input.author?.trim() ? { author: input.author.trim() } : {}),
      ...(input.publishedAt?.trim() ? { publishedAt: input.publishedAt.trim() } : {}),
      capturedAt: new Date().toISOString(),
      excerpt,
      userNotes,
      ...(references.length ? { references } : {}),
      contentHash
    }
    await this.assertCurrentRoot(backend.root)
    if (backend.formal) await this.formalSources!.addMaterialSources(backend.root, [source])
    else await writeJson(await this.file('sources.json', backend.root), { version: 1, sources: [source, ...backend.sources] } satisfies SourceStore)
    return source
  }

  private async updateSourceNow(id: string, input: SourceCardUpdateInput): Promise<SourceCard> {
    const backend = await this.sourceBackend()
    const source = backend.sources.find((item) => item.id === id)
    if (!source) throw new AppError('NOT_FOUND', '这条资料不存在或已经移除，请重新选择。', { recoverable: true })

    const title = input.title.trim()
    const userNotes = input.userNotes.trim()
    if (!title) throw new AppError('VALIDATION_ERROR', '资料标题不能为空。', { recoverable: true })
    if (source.sourceType !== 'manual') {
      if (input.excerpt !== undefined && input.excerpt.trim() !== source.excerpt) {
        throw new AppError('CONFLICT', '联网采风的原始摘录是来源证据，不能直接改写；请把整理意见写在“作者整理”中。', { recoverable: true })
      }
      if ((Object.prototype.hasOwnProperty.call(input, 'url') && input.url !== source.url)
        || (input.author !== undefined && input.author !== source.author) || (input.publishedAt !== undefined && input.publishedAt !== source.publishedAt)) {
        throw new AppError('CONFLICT', '联网采风的来源信息不能直接改写。', { recoverable: true })
      }
      if (!source.excerpt && !userNotes) throw new AppError('VALIDATION_ERROR', '资料摘录和作者整理不能同时为空。', { recoverable: true })
      source.title = title
      source.userNotes = userNotes
      source.updatedAt = new Date().toISOString()
      await this.assertCurrentRoot(backend.root)
      if (backend.formal) return structuredClone(await this.formalSources!.updateMaterialSource(backend.root, source))
      await writeJson(await this.file('sources.json', backend.root), { version: 1, sources: backend.sources } satisfies SourceStore)
      return structuredClone(source)
    }

    const excerpt = (input.excerpt ?? source.excerpt).trim()
    if (!excerpt && !userNotes) throw new AppError('VALIDATION_ERROR', '资料摘录和作者整理不能同时为空。', { recoverable: true })
    const url = Object.prototype.hasOwnProperty.call(input, 'url') ? input.url?.trim() || undefined : source.url
    const contentHash = url
      ? createHash('sha256').update(normalizeSource(url)).digest('hex')
      : sourceContentHash(title, excerpt)
    if (backend.sources.some((item) => item.id !== id && (item.contentHash === contentHash || Boolean(url && item.url && normalizeSource(item.url) === normalizeSource(url))))) {
      throw new AppError('CONFLICT', '修改后的资料与已有资料重复，请核对后保留一份。', { recoverable: true })
    }
    source.title = title
    source.url = url
    source.excerpt = excerpt
    source.userNotes = userNotes
    source.author = input.author?.trim() || undefined
    source.publishedAt = input.publishedAt?.trim() || undefined
    source.contentHash = contentHash
    source.updatedAt = new Date().toISOString()
    await this.assertCurrentRoot(backend.root)
    if (backend.formal) return structuredClone(await this.formalSources!.updateMaterialSource(backend.root, source))
    await writeJson(await this.file('sources.json', backend.root), { version: 1, sources: backend.sources } satisfies SourceStore)
    return structuredClone(source)
  }

  async listEvents(): Promise<{ events: CanonicalEvent[] }> {
    const sources = await this.sourceBackend(false)
    return { events: structuredClone((await this.eventBackend(sources, false)).events) }
  }

  async createEventCandidate(input: EventCandidateCreateInput): Promise<CanonicalEvent> {
    return this.serialize(() => this.createEventCandidateNow(input))
  }

  private async createEventCandidateNow(input: EventCandidateCreateInput): Promise<CanonicalEvent> {
    const sources = await this.sourceBackend()
    const source = sources.sources.find((item) => item.id === input.sourceId)
    if (!source) throw new AppError('NOT_FOUND', '引用的资料卡不存在，请重新选择。', { recoverable: true })
    if (!input.time.trim() || !input.characters.some((item) => item.trim()) || !input.location.trim() || !input.event.trim()) {
      throw new AppError('VALIDATION_ERROR', '事件候选必须完整填写时间、人物、地点和事件。', { recoverable: true })
    }
    const event: CanonicalEvent = {
      id: crypto.randomUUID(),
      time: input.time.trim(),
      characters: input.characters.map((item) => item.trim()).filter(Boolean),
      location: input.location.trim(),
      event: input.event.trim(),
      ...(input.result?.trim() ? { result: input.result.trim() } : {}),
      evidenceRefs: [{ sourceId: source.id, excerpt: (source.excerpt || source.userNotes).slice(0, 2_000) }],
      confidence: 1,
      status: 'candidate',
      createdAt: new Date().toISOString()
    }
    const backend = await this.eventBackend(sources)
    const signature = storyEventSignature(event)
    if (backend.events.some((item) => storyEventSignature(item) === signature)) {
      throw new AppError('CONFLICT', '相同事件候选已经存在，请核对后使用已有记录。', { recoverable: true })
    }
    if (backend.formal) {
      await this.assertCurrentRoot(backend.root)
      return structuredClone(await this.formalSources!.createCanonicalEvent(backend.root, event))
    }
    const conflict = backend.events.find((item) => sameEventSlot(item, event) && normalizeStoryText(item.event) !== normalizeStoryText(event.event))
    if (conflict) {
      const group = conflict.conflictGroupId || crypto.randomUUID()
      conflict.conflictGroupId = group
      event.conflictGroupId = group
    }
    backend.events.unshift(event)
    await this.assertCurrentRoot(backend.root)
    await writeJson(await this.file('events.json', backend.root), { version: 1, events: backend.events } satisfies EventStore)
    return event
  }

  async approveEvent(id: string): Promise<CanonicalEvent> {
    return this.serialize(() => this.approveEventNow(id))
  }

  private async approveEventNow(id: string): Promise<CanonicalEvent> {
    const sources = await this.sourceBackend()
    const backend = await this.eventBackend(sources)
    const event = backend.events.find((item) => item.id === id)
    if (!event) throw new AppError('NOT_FOUND', '事件候选不存在或已经移除。', { recoverable: true })
    if (event.status === 'approved') return event
    if (backend.formal) {
      await this.assertCurrentRoot(backend.root)
      return structuredClone(await this.formalSources!.approveCanonicalEvent(backend.root, id))
    }
    event.status = 'approved'
    event.approvedAt = new Date().toISOString()
    await this.assertCurrentRoot(backend.root)
    await writeJson(await this.file('events.json', backend.root), { version: 1, events: backend.events } satisfies EventStore)
    return event
  }

  private async file(name: string, selectedRoot?: string): Promise<string> {
    const root = selectedRoot ?? await this.projects.currentPath()
    return projectDirectory(root, join(root, '.webnovel', 'research', name))
  }

  private async sourceBackend(forWrite = true): Promise<SourceBackend> {
    const root = await this.projects.currentPath()
    if (!forWrite) {
      if (this.formalSources && !this.formalSources.readMaterialSources) throw readInspectionUnavailable()
      const formal = await this.formalSources?.readMaterialSources?.(root)
      const sources = formal ?? (await this.readSources(root)).store.sources
      await this.assertCurrentRoot(root)
      return { root, formal: formal !== null && formal !== undefined, sources }
    }
    if (!this.formalSources || !await this.formalSources.active(root)) {
      const legacy = await this.readSources(root)
      await this.assertCurrentRoot(root)
      return { root, formal: false, sources: legacy.store.sources }
    }
    if (!await this.formalSources.materialSourcesReady(root)) {
      const legacy = await this.readSources(root)
      await this.assertCurrentRoot(root)
      await this.formalSources.importMaterialSources(root, legacy.store.sources, legacy.observedHash)
    }
    const sources = await this.formalSources.materialSources(root)
    await this.assertCurrentRoot(root)
    return { root, formal: true, sources }
  }

  private async eventBackend(sources: SourceBackend, forWrite = true): Promise<EventBackend> {
    const { root } = sources
    if (!forWrite) {
      if (this.formalSources && !this.formalSources.readCanonicalEvents) throw readInspectionUnavailable()
      const formal = await this.formalSources?.readCanonicalEvents?.(root)
      const events = formal ?? (await this.readEvents(root)).store.events
      const sourceIds = new Set(sources.sources.map((source) => source.id))
      if (events.some((event) => event.evidenceRefs.some((reference) => !sourceIds.has(reference.sourceId)))) throw invalidEventStore()
      await this.assertCurrentRoot(root)
      return { root, formal: formal !== null && formal !== undefined, events }
    }
    if (!sources.formal) {
      const legacy = await this.readEvents(root)
      await this.assertCurrentRoot(root)
      return { root, formal: false, events: legacy.store.events }
    }
    if (!await this.formalSources!.canonicalEventsReady(root)) {
      const legacy = await this.readEvents(root)
      const sourceIds = new Set(sources.sources.map((source) => source.id))
      if (legacy.store.events.some((event) => event.evidenceRefs.some((reference) => !sourceIds.has(reference.sourceId)))) throw invalidEventStore()
      await this.assertCurrentRoot(root)
      await this.formalSources!.importCanonicalEvents(root, legacy.store.events, legacy.observedHash)
    }
    const events = await this.formalSources!.canonicalEvents(root)
    await this.assertCurrentRoot(root)
    return { root, formal: true, events }
  }

  private async assertCurrentRoot(root: string): Promise<void> {
    const current = await this.projects.currentPath()
    if (resolve(current).toLocaleLowerCase('en-US') !== resolve(root).toLocaleLowerCase('en-US')) {
      throw new AppError('CONFLICT', '作品已切换，本次素材操作没有写入另一部作品。', { recoverable: true })
    }
  }

  private async readSources(root?: string): Promise<{ store: SourceStore; observedHash?: string }> {
    const selectedRoot = root ?? await this.projects.currentPath()
    const path = await this.file('sources.json', selectedRoot)
    let raw: string
    try { raw = await readFile(await projectExistingPath(selectedRoot, path), 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { store: emptySources() }
      throw error
    }
    let value: unknown
    try { value = JSON.parse(raw) }
    catch { throw invalidSourceStore() }
    if (!validSourceStore(value)) throw invalidSourceStore()
    return { store: value, observedHash: createHash('sha256').update(raw).digest('hex') }
  }

  private async readEvents(root?: string): Promise<{ store: EventStore; observedHash?: string }> {
    const selectedRoot = root ?? await this.projects.currentPath()
    const path = await this.file('events.json', selectedRoot)
    let raw: string
    try { raw = await readFile(await projectExistingPath(selectedRoot, path), 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { store: emptyEvents() }
      throw error
    }
    let value: unknown
    try { value = JSON.parse(raw) }
    catch { throw invalidEventStore() }
    if (!validEventStore(value)) throw invalidEventStore()
    return { store: value, observedHash: createHash('sha256').update(raw).digest('hex') }
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue
    let release = (): void => undefined
    this.mutationQueue = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await operation() } finally { release() }
  }
}

function normalizeSource(value: string): string {
  return value.trim().replace(/\/$/, '').toLocaleLowerCase('en-US')
}

function sourceContentHash(title: string, excerpt: string): string {
  return createHash('sha256').update(normalizeSource(`${title}\n${excerpt}`)).digest('hex')
}

function sourceMatches(source: SourceCard, terms: string[]): boolean {
  const content = [source.title, source.excerpt, source.userNotes, source.author || '', source.provider].join('\n').normalize('NFKC').toLocaleLowerCase()
  return terms.some((term) => content.includes(term))
}

function splitManualDocument(content: string): string[] {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
  if (!normalized) return []
  if (normalized.length > 2_000_000) throw new AppError('VALIDATION_ERROR', '作品相关文件超过 200 万字符，请先按卷或主题拆分。', { recoverable: true })
  const limit = 18_000
  const paragraphs = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean)
  const chunks: string[] = []
  let current = ''
  const flush = (): void => {
    if (current.trim()) chunks.push(current.trim())
    current = ''
  }
  for (const paragraph of paragraphs) {
    if (paragraph.length > limit) {
      flush()
      for (let start = 0; start < paragraph.length; start += limit) chunks.push(paragraph.slice(start, start + limit).trim())
      continue
    }
    const next = current ? `${current}\n\n${paragraph}` : paragraph
    if (next.length > limit) flush()
    current = current ? `${current}\n\n${paragraph}` : paragraph
  }
  flush()
  return chunks
}

function uniqueReferences(references: SourceCardCreateInput['references']): NonNullable<SourceCard['references']> {
  const seen = new Set<string>()
  return (references || []).map((item) => ({ title: item.title.trim(), url: item.url.trim() })).filter((item) => {
    const key = normalizeSource(item.url)
    if (!item.title || !item.url || seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 100)
}

function validSourceStore(value: unknown): value is SourceStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const store = value as Partial<SourceStore>
  if (store.version !== 1 || !Array.isArray(store.sources) || store.sources.length > 100_000) return false
  return store.sources.every((source) => Boolean(source && typeof source.id === 'string' && source.id.length <= 200
    && typeof source.provider === 'string' && source.provider.length <= 200
    && ['manual', 'web', 'toutiao', 'douyin-baike', 'douyin-video', 'other'].includes(source.sourceType)
    && typeof source.title === 'string' && source.title.length <= 200
    && (source.externalId === undefined || typeof source.externalId === 'string')
    && (source.url === undefined || typeof source.url === 'string')
    && (source.author === undefined || typeof source.author === 'string')
    && (source.publishedAt === undefined || typeof source.publishedAt === 'string')
    && typeof source.capturedAt === 'string'
    && (source.updatedAt === undefined || typeof source.updatedAt === 'string')
    && typeof source.excerpt === 'string' && source.excerpt.length <= 20_000
    && typeof source.userNotes === 'string' && source.userNotes.length <= 20_000
    && typeof source.contentHash === 'string' && /^[a-f0-9]{64}$/.test(source.contentHash)
    && (source.references === undefined || (Array.isArray(source.references) && source.references.length <= 100
      && source.references.every((item) => Boolean(item && typeof item.title === 'string' && item.title.length <= 500 && typeof item.url === 'string' && item.url.length <= 2_000))))))
}

function invalidSourceStore(): AppError {
  return new AppError('INVALID_PROJECT_STATE', '本书素材库已损坏；为保护资料，应用不会覆盖它。', { recoverable: false })
}

function readInspectionUnavailable(): AppError {
  return new AppError('FEATURE_UNAVAILABLE', '只读素材与事件核对暂不可用，未尝试导入或修改数据。', { recoverable: true })
}

function validEventStore(value: unknown): value is EventStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const store = value as Partial<EventStore>
  if (store.version !== 1 || !Array.isArray(store.events) || store.events.length > 100_000) return false
  return store.events.every((event) => Boolean(event && typeof event.id === 'string' && event.id.length <= 200
    && typeof event.time === 'string' && event.time.length <= 500
    && Array.isArray(event.characters) && event.characters.length > 0 && event.characters.length <= 100
    && event.characters.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 200)
    && typeof event.location === 'string' && event.location.length <= 500
    && typeof event.event === 'string' && event.event.length > 0 && event.event.length <= 20_000
    && (event.result === undefined || (typeof event.result === 'string' && event.result.length <= 20_000))
    && Array.isArray(event.evidenceRefs) && event.evidenceRefs.length > 0 && event.evidenceRefs.length <= 100
    && event.evidenceRefs.every((item) => Boolean(item && typeof item.sourceId === 'string' && item.sourceId.length <= 200
      && typeof item.excerpt === 'string' && item.excerpt.length > 0 && item.excerpt.length <= 2_000))
    && typeof event.confidence === 'number' && Number.isFinite(event.confidence) && event.confidence >= 0 && event.confidence <= 1
    && (event.status === 'candidate' || event.status === 'approved')
    && (event.conflictGroupId === undefined || (typeof event.conflictGroupId === 'string' && event.conflictGroupId.length <= 200))
    && typeof event.createdAt === 'string' && event.createdAt.length <= 100
    && (event.approvedAt === undefined || (typeof event.approvedAt === 'string' && event.approvedAt.length <= 100))))
}

function invalidEventStore(): AppError {
  return new AppError('INVALID_PROJECT_STATE', '本书正式事件账本已损坏；为保护候选与正式事实，应用不会覆盖它。', { recoverable: false })
}

function sameEventSlot(left: CanonicalEvent, right: CanonicalEvent): boolean {
  if (normalizeStoryText(left.time) !== normalizeStoryText(right.time) || normalizeStoryText(left.location) !== normalizeStoryText(right.location)) return false
  const characters = new Set(left.characters.map(normalizeStoryText))
  return right.characters.some((item) => characters.has(normalizeStoryText(item)))
}
