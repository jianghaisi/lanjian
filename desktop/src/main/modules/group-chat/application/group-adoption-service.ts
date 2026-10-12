import { inspirationCardRevision, type GroupInspirationPort } from '../adapters/group-inspiration-tools'
import { createHash, randomUUID } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import type { GroupAdoptionPreview, GroupAdoptionRequest } from '../../../../contracts/group-chat/adoption'
import type { GroupChatService } from './group-chat-service'
import type { GroupSession } from '../domain/session'
import type { WorkspaceService } from '../../library/application/workspace-service'
import type { ResearchLibraryService } from '../../library/application/research-library-service'
import type { PreparationCandidate } from '../../../../contracts/group-chat/group-chat'
import { DurablePluginEffects } from '../../writing-plugins/application/effect-journal'
import type { StoryEntityView } from '../../../../contracts/characters/types'
import type { WorkspaceEntityInput } from '../../../core/ports/workspace-database'
import type { EventOperationService } from '../../timeline/application/event-operation-service'
import type { EventProjectionService } from '../../timeline/application/event-projection-service'
import { emptyWorldbookEntry } from '../../../../contracts/characters/worldbook'
import { referenceRevision } from '../domain/source-reference'
export type GroupAdoptionDomains = {
  characters: { list(): Promise<StoryEntityView[]>; save(input: WorkspaceEntityInput): Promise<StoryEntityView> }
  events: { read: EventProjectionService['read']; preview: EventOperationService['previewMaterialCandidate']; prepareAdopt: EventOperationService['preview']; commit: EventOperationService['commit'] }
}
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const contentDigest = ({ status: _status, bookId: _bookId, ...candidate }: PreparationCandidate) => digest(candidate)
type Permit = { request: GroupAdoptionRequest; revision: string; contentHash: string; expires: number; used: boolean }
export class GroupAdoptionService {
  private readonly permits = new Map<string, Permit>()
  constructor(private readonly groups: GroupChatService, private readonly scope: <T>(sessionId: string, operation: (s: GroupSession) => Promise<T>) => Promise<T>, private readonly workspace: Pick<WorkspaceService, 'bookProfile' | 'saveBookProfile' | 'foundation' | 'foundationSnapshot' | 'adoptPlanningWorldView'>, private readonly research: Pick<ResearchLibraryService, 'listSources' | 'createSource'>, private readonly domains?: GroupAdoptionDomains, private readonly inspiration?: GroupInspirationPort) {}
  async prepare(input: GroupAdoptionRequest): Promise<GroupAdoptionPreview> {
    return this.scope(input.sessionId, async s => {
      // Read the current candidate for explicit author inspection. Composer
      // checkpoints may advance the session, but no formal effect occurs here.
      if (s.view.revision < input.expectedRevision || s.view.status === 'running') throw this.conflict()
      const candidate = this.candidate(s, input.candidateId), current = await this.current(candidate), token = randomUUID()
      await this.assertReferences(candidate)
      for (const [id, p] of this.permits) if (p.expires < Date.now()) this.permits.delete(id)
      if (this.permits.size >= 32) throw this.conflict()
      this.permits.set(token, { request: input, revision: digest(current), contentHash: contentDigest(candidate), expires: Date.now() + 5 * 60_000, used: false })
      return { token, candidateId: candidate.id, bookTitle: s.view.book!.title, title: candidate.title, currentContent: candidate.kind === 'definition' ? String(current.coreIdea ?? '') : candidate.kind === 'world' ? String(current.worldView ?? '') : '', content: candidate.content, destination: candidate.domainDraft?.type === 'character' ? '人物库' : candidate.domainDraft?.type === 'macro-event' ? '宏观事件时间线' : candidate.kind === 'definition' ? '作品定义 · 核心创意' : candidate.kind === 'world' ? '世界设定 · 世界观' : '筹备素材', notice: candidate.domainDraft ? '确认后通过原人物保存或四要素事件预览/提交接口采用；本次预览尚未写入正式内容。事件保留筹备来源，不分配到未经核对的章节。' : ['definition', 'world'].includes(candidate.kind) ? '确认后通过原领域保存接口更新这个字段。请核对现有内容和新候选。' : '收为可追溯的筹备素材；人物、大纲和事件仍须在原规划流程中生成、核对和采用。' }
    })
  }
  async adopt(token: string) {
    const p = this.permits.get(token)
    if (!p || p.expires < Date.now()) throw this.conflict()
    if (p.used) return this.scope(p.request.sessionId, async s => {
      const key = digest([s.view.id, p.request.candidateId])
      const receipt = s.effects.find(effect => effect.key === key && effect.status === 'completed')
      const candidate = this.candidate(s, p.request.candidateId)
      if (!receipt || contentDigest(candidate) !== p.contentHash || candidate.status !== 'adopted') throw this.conflict()
      // Lost success responses return the already completed author decision;
      // they do not write a newer formal version or reuse an in-flight intent.
      return this.groups.get({ sessionId: s.view.id, limit: 100 })
    })
    p.used = true
    try {
      return await this.groups.updateForAdoption(p.request.sessionId, async s => this.scope(s.view.id, async () => {
        if (s.view.status === 'running') throw this.conflict()
        const c = this.candidate(s, p.request.candidateId)
        if (contentDigest(c) !== p.contentHash) throw this.conflict()
        if (!s.effects.some(e => e.key === digest([s.view.id, c.id])) && digest(await this.current(c)) !== p.revision) throw this.conflict()
        const journal = new DurablePluginEffects(s.effects, () => this.groups.checkpoint(s))
        await journal.once(digest([s.view.id, c.id]), { bookId: s.view.book!.id, contentHash: p.contentHash }, async () => {
        const current = await this.current(c)
        if (digest(current) !== p.revision) throw this.conflict()
        await this.assertReferences(c)
        if (c.domainDraft?.type === 'character') {
          if (!this.domains) throw this.unavailable()
          const draft = c.domainDraft
          await this.domains.characters.save({ id: draft.id, entityType: 'character', canonicalName: draft.name, profileJson: JSON.stringify({ description: draft.description, worldbook: { ...emptyWorldbookEntry(), description: draft.description }, groupPreparation: { sessionId: s.view.id, candidateId: c.id } }), status: 'approved' })
        } else if (c.domainDraft?.type === 'macro-event') {
          if (!this.domains) throw this.unavailable()
          const sources = await this.research.listSources(), provenance = `group-chat:${s.view.id}:${c.id}`
          const source = sources.sources.find(source => source.provider === 'group-chat' && source.userNotes.includes(provenance)) ?? await this.research.createSource({ title: c.title, excerpt: c.content, sourceType: 'manual', provider: 'group-chat', userNotes: `作者核对的 AI 事件筹备。来源 ${provenance}` })
          const { type: _type, ...content } = c.domainDraft, projection = await this.domains.events.read()
          const preview = await this.domains.events.preview({ ...content, sourceId: source.id, expectedOrderId: projection.state.order.id })
          const created = await this.domains.events.commit(preview.token)
          const latest = await this.domains.events.read(), event = latest.candidates.find(e => e.eventId === created.receipt.eventId), lifecycle = latest.state.lifecycles.find(e => e.eventId === created.receipt.eventId)
          if (!event || !lifecycle) throw this.conflict()
          const adoption = await this.domains.events.prepareAdopt({ kind: 'adopt', eventId: event.eventId, expectedVersionId: event.versionId, expectedLifecycleId: lifecycle.id, expectedOrderId: latest.state.order.id })
          await this.domains.events.commit(adoption.token)
        } else if (c.kind === 'definition') { const profile = await this.workspace.bookProfile(); if (profile.coreIdea !== c.content) await this.workspace.saveBookProfile({ ...profile, coreIdea: c.content }) }
        else if (c.kind === 'world') {
          const snapshot = await this.workspace.foundationSnapshot()
          if (snapshot.data.worldView !== c.content) await this.workspace.adoptPlanningWorldView({ worldView: c.content, currentFingerprint: snapshot.fingerprint })
        } else {
          const sources = await this.research.listSources(), provenance = `group-chat:${s.view.id}:${c.id}`
          if (!sources.sources.some(source => source.provider === 'group-chat' && source.userNotes.includes(provenance))) await this.research.createSource({ title: c.title, excerpt: c.content, sourceType: c.kind === 'research' ? 'web' : 'manual', provider: 'group-chat', userNotes: `作者选入的 AI 筹备素材。来源 ${provenance}；不是正式人物、事件或大纲采用。\n参考依据：${JSON.stringify(c.references ?? [])}`, ...(c.references?.some(source => source.url) ? { references: c.references.filter(source => source.url).map(source => ({ title: source.title, url: source.url! })) } : {}) })
        }
        return { applied: true }
        })
        c.status = 'adopted'; c.bookId = s.view.book!.id; s.view.notice = c.domainDraft || c.kind === 'definition' || c.kind === 'world' ? '筹备候选已通过原领域接口采用，团队可以读取更新后的作品资料。' : '已收为筹备素材，请沿原规划流程核对正式人物、大纲与事件。'
      }))
    } catch (e) { p.used = false; throw e }
  }
  private async current(c: PreparationCandidate): Promise<Record<string, unknown>> {
    if (c.domainDraft) { if (!this.domains) throw this.unavailable(); return c.domainDraft.type === 'character' ? { characters: await this.domains.characters.list() } : { projection: await this.domains.events.read() } }
    return c.kind === 'definition' ? { ...await this.workspace.bookProfile() } : c.kind === 'world' ? { ...await this.workspace.foundation(true) } : { sources: (await this.research.listSources()).sources }
  }
  private async assertReferences(candidate: PreparationCandidate) {
    for (const ref of candidate.references?.filter(r => r.id.startsWith('inspiration:')) ?? []) {
      if (!this.inspiration) throw this.unavailable()
      const card = await this.inspiration.readCard(ref.id.slice('inspiration:'.length))
      if (card.stale || inspirationCardRevision(card) !== ref.revision) throw this.conflict()
    }
    const local = candidate.references?.filter(reference => !reference.id.startsWith('web:') && !reference.id.startsWith('inspiration:')) ?? []
    if (!local.length) return
    const sources = (await this.research.listSources()).sources
    for (const reference of local) { const source = sources.find(source => source.id === reference.id); if (!source || referenceRevision(source) !== reference.revision) throw this.conflict() }
  }
  private unavailable() { return new AppError('FEATURE_UNAVAILABLE', '本作品暂时不能采用这种筹备候选，请核对原人物或事件入口。', { recoverable: true }) }
  private candidate(s: GroupSession, id: string): PreparationCandidate { const c = s.view.candidates.find(c => c.id === id); if (!s.view.book || !s.bound || !c || c.status !== 'proposed' && !s.effects.some(e => e.key === digest([s.view.id, id]) && e.status === 'completed')) throw this.conflict(); return c }
  private conflict() { return new AppError('CONFLICT', '候选、作品或预览依据已变化，请重新核对后采用。', { recoverable: true }) }
}
