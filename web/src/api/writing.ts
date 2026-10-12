import { decodeBook, record, uuid, text, integer, pricePolicy, type BookView, type PricePolicy } from '@lanjian/hosted-contracts'
import { unwrapValidatedIpcResponse } from '../../../desktop/src/contracts/core/ipc-response'
import type { Chapter, ChapterRevision, BookProfile, FoundationData, RealmLevel, OutlinePlanningStatus, FoundationStatus, WritingAgentTask, WritingAgentRequest, WritingAgentArtifactApplicationInput, WritingAgentArtifactApplicationResult, OutlineDocument, ChapterOutlineDocument } from '../../../desktop/src/contracts/index'
import type { EventProjectionDto, EventOperationPreviewDto } from '../../../desktop/src/contracts/timeline/event-contracts'
import type { TxtImportPreview, TxtImportRequest, TxtImportResult } from '../../../desktop/src/contracts/library/import-types'
import type { StoryEntityView } from '../../../desktop/src/contracts/characters/types'
import type { SourceCard, SourceCardCreateInput } from '../../../desktop/src/contracts/worldbuilding/types'
import type { PlanningPackageProposal, PlanningTotalAdoptionPreview, PlanningCharacterSeedPreview, PlanningWorldSeedPreview, PlanningPowerSystemPreview, PlanningCheatSystemPreview, PlanningVolumeStructurePreview, PlanningVolumeOutlinePreview, FormalSkeletonPreview, ChapterEventPreview, ChapterEventAdoptionPreview, ChapterEventDraft } from '../../../desktop/src/contracts/planning/types'
import type { DocumentLocator, DocumentSnapshot } from '../../../desktop/src/contracts/document-review/types'
import type { AnnotationPage, AnnotationCreateInput, AnnotationChangeInput, DocumentAnnotation } from '../../../desktop/src/contracts/document-review/annotations'
import { http, type Http } from './http'
export const decode = <T>(channel: string, value: unknown): T => unwrapValidatedIpcResponse<T>(channel, { ok: true, value })
export function array(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error('服务器返回的列表格式无效。'); return value }
export interface Model { id: string; name: string; model: string; maxOutputTokens: number; price: { version: number; policy: PricePolicy } }
export interface JobSummary { id: string; kind: string; status: string; modelId: string; error: string | null; createdAt: number }
export interface Job extends JobSummary { bookId: string; task: WritingAgentTask | null; result: unknown; billing: { policy: PricePolicy; charged: number; reserved: number; needsReconciliation: boolean } }
function jobSummary(value: unknown): JobSummary { const p = record(value); return { id: uuid(p.id), kind: text(p.kind, 50), status: text(p.status, 50), modelId: text(p.modelId, 150), error: p.error === null ? null : text(p.error, 100), createdAt: integer(p.createdAt, 0, Number.MAX_SAFE_INTEGER) } }
export const definitions = { profile: 'workspace:get-book-profile', foundation: 'workspace:get-foundation', realms: 'workspace:get-realms', 'system-template': 'workspace:get-system-template', 'power-system': 'workspace:get-power-system', 'cheat-system': 'workspace:get-cheat-system' } as const
export interface DefinitionTypes { profile: BookProfile; foundation: FoundationData; realms: { levels: RealmLevel[] }; 'system-template': { template: string }; 'power-system': { overview: string }; 'cheat-system': { overview: string } }
export class WritingApi {
  constructor(private readonly client: Http = http) {}
  async books(): Promise<BookView[]> { return array(record(await this.client.request('/api/books')).books).map(decodeBook) }
  async createBook(title: string, operation: string) { return decodeBook(await this.client.request('/api/books', 'POST', { title, operation })) }
  async models(): Promise<Model[]> { return array(record(await this.client.request('/api/models')).models).map(value => { const p = record(value), price = record(p.price); return { id: text(p.id, 150), name: text(p.name, 120), model: text(p.model, 200), maxOutputTokens: integer(p.maxOutputTokens, 1, 100000), price: { version: integer(price.version), policy: pricePolicy(price.policy) } } }) }
  book(id: string) { return new BookApi(uuid(id), this.client) }
}
export class BookApi {
  private readonly base: string
  constructor(readonly id: string, private readonly client: Http) { this.base = `/api/books/${uuid(id)}` }
  private call(path: string, method = 'GET', body?: unknown) { return this.client.request(this.base + path, method, body) }
  async chapters() { return decode<Chapter[]>('chapters:list', await this.call('/chapters')) }
  async chapter(id: number) { return decode<Chapter>('chapters:get', await this.call(`/chapters/${integer(id, 1)}`)) }
  async createChapter(operation: string) { return decode<Chapter>('chapters:get', await this.call('/chapters', 'POST', { operation })) }
  async saveChapter(id: number, data: { title: string; content: string; expectedRevision: string }) { return decode<Chapter>('chapters:update', await this.call(`/chapters/${integer(id, 1)}`, 'PUT', data)) }
  async history(id: number) { return decode<ChapterRevision[]>('chapters:revisions', await this.call(`/chapters/${integer(id, 1)}/history`)) }
  async restore(id: number, revisionId: string, expectedRevision: string) { return decode<Chapter>('chapters:get', await this.call(`/chapters/${integer(id, 1)}/restore`, 'POST', { revisionId, expectedRevision })) }
  async definition<K extends keyof DefinitionTypes>(kind: K) { const p = record(await this.call(`/${kind}`)); return { data: decode<DefinitionTypes[K]>(definitions[kind], p.data), revision: text(p.revision, 100) } }
  async saveDefinition<K extends keyof DefinitionTypes>(kind: K, data: DefinitionTypes[K], expectedRevision: string) { const p = record(await this.call(`/${kind}`, 'PUT', { data, expectedRevision })); return { data: decode<DefinitionTypes[K]>(definitions[kind], p.data), revision: text(p.revision, 100) } }
  async planning(chapterId?: number) { const p = record(await this.call(`/planning/status${chapterId ? `?chapterId=${integer(chapterId, 1)}` : ''}`)); return { planning: decode<OutlinePlanningStatus>('outlines:planning-status', p.planning), foundation: decode<FoundationStatus>('workspace:get-foundation-status', p.foundation) } }
  async outline(scope: 'total' | number) { return decode<OutlineDocument>('outlines:get', await this.call(`/outlines/${scope}`)) }
  async saveOutline(scope: 'total' | number, content: string, expectedRevision: string) { await this.call(`/outlines/${scope}`, 'PUT', { content, expectedRevision }); return this.outline(scope) }
  async confirmOutline(scope: 'total' | number, acknowledge = false) { return decode<OutlinePlanningStatus>('outlines:planning-status', await this.call(`/outlines/${scope}/${acknowledge ? 'acknowledge' : 'confirm'}`, 'POST')) }
  async createVolume(title: string) { return decode<OutlinePlanningStatus>('outlines:planning-status', await this.call('/volumes', 'POST', { title })) }
  async chapterOutline(id: number) { return decode<ChapterOutlineDocument>('chapter-outlines:get', await this.call(`/chapter-outlines/${integer(id, 1)}`)) }
  async saveChapterOutline(id: number, content: string, expectedRevision: string, volume?: number) { return decode<ChapterOutlineDocument>('chapter-outlines:get', await this.call(`/chapter-outlines/${integer(id, 1)}`, 'PUT', { content, expectedRevision, volume })) }
  async confirmChapterOutline(id: number) { return decode<OutlinePlanningStatus>('outlines:planning-status', await this.call(`/chapter-outlines/${integer(id, 1)}/confirm`, 'POST')) }
  async events() { return decode<EventProjectionDto>('events:projection', await this.call('/events')) }
  async previewEvent(command: unknown) { return decode<EventOperationPreviewDto>('events:operation-preview', await this.call('/events/preview', 'POST', command)) }
  async commitEvent(token: string) { await this.call('/events/commit', 'POST', { token }); return this.events() }
  async placeEvent(eventId: string, chapterId: number) { await this.call(`/events/${uuid(eventId)}/chapter`, 'POST', { chapterId }) }
  async placeChapter(chapterId: number, volume: number) { await this.call(`/chapters/${integer(chapterId, 1)}/place`, 'POST', { volume }) }
  async jobs() { return array(await this.call('/jobs')).map(jobSummary) }
  async job(id: string): Promise<Job> { const p = record(await this.call(`/jobs/${uuid(id)}`)), b = record(p.billing); if (p.bookId !== this.id || typeof b.needsReconciliation !== 'boolean') throw new Error('任务身份或计费状态无效。'); return { ...jobSummary(p), bookId: this.id, task: p.task === null ? null : decode<WritingAgentTask>('ai:writing-agent-task', p.task), result: p.result, billing: { policy: pricePolicy(b.policy), charged: integer(b.charged), reserved: integer(b.reserved), needsReconciliation: b.needsReconciliation } } }
  async generate(operation: string, modelId: string, request: WritingAgentRequest) { const p = record(await this.call('/jobs', 'POST', { operation, modelId, kind: 'writing', request })); return uuid(p.id) }
  async cancel(id: string) { await this.call(`/jobs/${uuid(id)}/cancel`, 'POST') }
  async adopt(input: WritingAgentArtifactApplicationInput) { return decode<WritingAgentArtifactApplicationResult>('ai:apply-writing-agent-artifact', await this.call('/writing/apply', 'POST', input)) }
  async previewImport(filename: string, content: string) { return decode<TxtImportPreview>('imports:choose-text', await this.call('/imports/preview', 'POST', { filename, content })) }
  async commitImport(request: TxtImportRequest) { return decode<TxtImportResult>('imports:commit-text', await this.call('/imports/commit', 'POST', { ...request, expectedWorkItemId: this.id })) }
  async entities() { return decode<StoryEntityView[]>('workspace:list-story-entities', await this.call('/characters')) }
  async saveEntity(input: { id?: string; expectedUpdatedAt?: string; entityType: StoryEntityView['entityType']; canonicalName: string; profileJson: string; status: StoryEntityView['status'] }) { return decode<StoryEntityView>('workspace:save-story-entity', await this.call('/characters', 'POST', input)) }
  async sources() { return decode<{ sources: SourceCard[] }>('research:list-sources', await this.call('/sources')) }
  async createSource(input: SourceCardCreateInput) { return decode<SourceCard>('research:create-source', await this.call('/sources', 'POST', input)) }
  async planningDraft() { return decode<PlanningPackageProposal | null>('planning:draft', await this.call('/planning/draft')) }
  async generatePlanning(operation: string, modelId: string, kind: 'planning' | 'skeleton' | 'chapter-detail', request: { proposalId?: string; volume?: number }) { return uuid(record(await this.call('/jobs', 'POST', { operation, modelId, kind, request })).id) }
  async previewSeed(kind: 'characters', proposalId: string): Promise<PlanningCharacterSeedPreview>
  async previewSeed(kind: 'world' | 'power' | 'cheat', proposalId: string): Promise<PlanningWorldSeedPreview | PlanningPowerSystemPreview | PlanningCheatSystemPreview>
  async previewSeed(kind: 'characters' | 'world' | 'power' | 'cheat', proposalId: string) { const channels = { characters: 'planning:preview-character-seed-adoption', world: 'planning:preview-world-seed-adoption', power: 'planning:preview-power-system-adoption', cheat: 'planning:preview-cheat-system-adoption' }; return decode<PlanningCharacterSeedPreview | PlanningWorldSeedPreview | PlanningPowerSystemPreview | PlanningCheatSystemPreview>(channels[kind], await this.call(`/planning/${kind}/preview`, 'POST', { proposalId })) }
  async adoptSeed(kind: 'characters' | 'world' | 'power' | 'cheat', p: { proposalId: string; candidateFingerprint: string; currentFingerprint: string }) { await this.call(`/planning/${kind}/adopt`, 'POST', { proposalId: p.proposalId, candidateFingerprint: p.candidateFingerprint, currentFingerprint: p.currentFingerprint }) }
  async previewTotal(proposalId: string) { return decode<PlanningTotalAdoptionPreview>('planning:preview-total-adoption', await this.call('/planning/total/preview', 'POST', { proposalId })) }
  async adoptTotal(p: PlanningTotalAdoptionPreview) { await this.call('/planning/total/adopt', 'POST', { proposalId: p.proposalId, candidateFingerprint: p.candidateFingerprint, currentFingerprint: p.currentFingerprint }) }
  async previewVolumes(proposalId: string) { return decode<PlanningVolumeStructurePreview>('planning:preview-volume-structure', await this.call('/planning/volumes/preview', 'POST', { proposalId })) }
  async adoptVolumes(p: PlanningVolumeStructurePreview) { await this.call('/planning/volumes/adopt', 'POST', { proposalId: p.proposalId, candidateFingerprint: p.candidateFingerprint, currentFingerprint: p.currentFingerprint, totalFingerprint: p.totalFingerprint }) }
  async previewVolume(proposalId: string, volume: number) { return decode<PlanningVolumeOutlinePreview>('planning:preview-volume-outline-adoption', await this.call('/planning/volume-outline/preview', 'POST', { proposalId, volume })) }
  async adoptVolume(p: PlanningVolumeOutlinePreview) { await this.call('/planning/volume-outline/adopt', 'POST', { proposalId: p.proposalId, order: p.order, parentFingerprint: p.parentFingerprint, candidateFingerprint: p.candidateFingerprint, currentFingerprint: p.currentFingerprint }) }
  async previewSkeleton(proposalId: string, volume: number) { return decode<FormalSkeletonPreview>('planning:preview-formal-skeleton', await this.call('/planning/skeleton/preview', 'POST', { proposalId, volume })) }
  async adoptSkeleton(token: string) { await this.call('/planning/skeleton/adopt', 'POST', { token }) }
  async previewChapterEvents(proposalId: string, chapterId: number) { return decode<ChapterEventPreview>('planning:preview-chapter-events', await this.call('/planning/chapter/preview', 'POST', { proposalId, chapterId })) }
  async previewChapterAdoption(proposalId: string, chapterId: number, events: ChapterEventDraft[]) { return decode<ChapterEventAdoptionPreview>('planning:preview-chapter-event-adoption', await this.call('/planning/chapter-event/preview', 'POST', { proposalId, chapterId, events })) }
  async adoptChapterEvents(token: string) { await this.call('/planning/chapter-event/adopt', 'POST', { token }) }
  async snapshot(target: DocumentLocator) { return decode<DocumentSnapshot>('document-review:snapshot', await this.call('/documents/snapshot', 'POST', target)) }
  async annotations(document: DocumentSnapshot['ref'], cursor?: number) { return decode<AnnotationPage>('document-annotations:list', await this.call('/annotations/list', 'POST', { document, cursor })) }
  async annotate(input: AnnotationCreateInput) { return decode<DocumentAnnotation>('document-annotations:create', await this.call('/annotations', 'POST', input)) }
  async changeAnnotation(action: 'resolve' | 'reopen' | 'remove', input: AnnotationChangeInput) { return decode<DocumentAnnotation>(`document-annotations:${action}`, await this.call(`/annotations/${action}`, 'POST', input)) }
  exportUrl(format: 'markdown' | 'txt') { return `${this.base}/export?format=${format}` }
}
export const writing = new WritingApi()
export const points = (value: number) => (value / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 3 })
export async function fingerprint(content: string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content)))].map(b => b.toString(16).padStart(2, '0')).join('') }
