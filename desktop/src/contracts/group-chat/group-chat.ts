import { LOCAL_CONNECTION_ID } from '../models/local-model-contracts'
import { AppError } from '../core/app-error'
import { connectionRecord } from '../models/model-connection-values'
import { BOOK_MODEL_TASKS, decodeBookModelSettings } from '../models/book-model-settings'
import type { ModelProfile } from '../models/types'
import { decodeGlobalConnectionsView } from '../models/model-connections-contracts'
import type { GlobalConnectionsView } from '../models/model-connections'
import { decodeAuthorAnswers, decodeAuthorQuestionCard, type AuthorAnswer, type AuthorQuestionCard } from '../assistant/author-interaction-contracts'
import { resolveCreativeTeam, validateCreativeTeam, type CreativeTeam } from '@lanjian/writing-plugin-contracts'
import { officialCreativePackages } from '@lanjian/writing-plugin-package/official'

/** Released metadata for callers without a session; execution uses that session's captured team. */
export const groupMembers = resolveCreativeTeam(officialCreativePackages(), [], { revision: 0, entries: [] }).team.members
export type MemberId = string
export type MemberAssignment = { memberId: MemberId; profile: ModelProfile | null }
export type GroupStatus = 'idle' | 'running' | 'waiting-input' | 'waiting-creation' | 'paused-limit' | 'interrupted' | 'failed' | 'cancelled'
export type PreparationKind = 'definition' | 'world' | 'characters' | 'outline' | 'timeline' | 'research' | 'adaptation'
export type PreparationReference = { id: string; title: string; revision: string; url?: string }
export type PreparationDomainDraft = { type: 'character'; id: string; name: string; description: string } | { type: 'macro-event'; time: string; characters: string[]; location: string; event: string; result: string }
export type PreparationCandidate = { id: string; kind: PreparationKind; title: string; content: string; memberId: MemberId; createdAt: string; status: 'proposed' | 'adopted'; bookId?: string; domainDraft?: PreparationDomainDraft; references?: PreparationReference[] }
export type GroupMessage = { id: string; role: 'user' | 'agent' | 'activity'; content: string; createdAt: string; memberId?: MemberId; model?: string; connectionId?: string }
export type GroupSessionView = {
  id: string; title: string; draft: string; position: { top: number; atBottom: boolean }; revision: number; status: GroupStatus; notice: string; createdAt: string; updatedAt: string
  members: MemberAssignment[]; messages: GroupMessage[]; messageCount: number; candidates: PreparationCandidate[]
  team: CreativeTeam; readOnly: boolean
  book: { id: string; title: string } | null; question: AuthorQuestionCard | null
  creation: { id: string; suggestedTitle: string; summary: string } | null
  activeMember: MemberId | null; budget: { steps: number; calls: number }; queued: number
}
export type GroupCommand = { sessionId: string; expectedRevision: number }
export type GroupSend = GroupCommand & { operationId: string; message: string; memberId?: MemberId }
export type GroupAnswer = GroupCommand & { questionId: string; answerSubmissionId: string; answers: AuthorAnswer[] }
export type GroupModelSave = GroupCommand & MemberAssignment
export type GroupPage = { sessionId: string; before?: string; limit: number }
export type GroupChatApi = {
  openBook(bookId: string): Promise<GroupSessionView>
  createForBook(bookId: string): Promise<GroupSessionView>
  modelCatalog(): Promise<{ connections: GlobalConnectionsView; models: Record<string, string[]> }>
  saveDraft(input: GroupCommand & { draft: string; position: { top: number; atBottom: boolean } }): Promise<boolean>
  createBook(input: import('./creation').GroupBookCreation): Promise<import('./creation').GroupBookCreated>
  prepareAdoption(input: import('./adoption').GroupAdoptionRequest): Promise<import('./adoption').GroupAdoptionPreview>
  adopt(token: string): Promise<GroupSessionView>
  list(): Promise<GroupSessionView[]>; create(title: string): Promise<GroupSessionView>; get(input: GroupPage): Promise<GroupSessionView>
  send(input: GroupSend): Promise<GroupSessionView>; stop(input: GroupCommand): Promise<GroupSessionView>; resume(input: GroupCommand): Promise<GroupSessionView>
  saveMember(input: GroupModelSave): Promise<GroupSessionView>; answer(input: GroupAnswer): Promise<GroupSessionView>
}
export const groupInvalid = (): never => { throw new AppError('VALIDATION_ERROR', '群聊数据格式无效，已有内容保留。', { recoverable: true }) }
export const groupRecord = connectionRecord
export function groupText(v: unknown, max = 12000, required = true): string { if (typeof v !== 'string' || v.length > max || required && !v.trim() || /\u0000/.test(v)) return groupInvalid(); return v }
export function groupId(v: unknown): string { const id = groupText(v, 80); if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id)) return groupInvalid(); return id }
export function groupRevision(v: unknown): number { if (!Number.isSafeInteger(v) || Number(v) < 1) return groupInvalid(); return Number(v) }
export function memberId(v: unknown, members?: readonly { id: string }[]): MemberId { const id = groupText(v, 64); if (!/^[a-z][a-z0-9_-]*$/.test(id) || members && !members.some(member => member.id === id)) return groupInvalid(); return id }
export function decodeGroupProfile(v: unknown): ModelProfile {
  const p = connectionRecord(v, ['connectionId', 'model', 'parameterPolicy', 'temperature', 'topP', 'maxTokens', 'thinkingLevel'])
  const connectionId = groupText(p.connectionId, 80)
  const settings = decodeBookModelSettings({ version: 5, references: connectionId === LOCAL_CONNECTION_ID ? [] : [{ kind: 'global', id: connectionId, globalConnectionId: connectionId }], routingMode: 'shared', shared: p, tasks: Object.fromEntries(BOOK_MODEL_TASKS.map(t => [t, p])) })
  return settings.shared
}
export function decodeGroupCommand(v: unknown): GroupCommand { const r = groupRecord(v, ['sessionId', 'expectedRevision']); return { sessionId: groupId(r.sessionId), expectedRevision: groupRevision(r.expectedRevision) } }
const commandFrom = (r: Record<string, unknown>) => decodeGroupCommand({ sessionId: r.sessionId, expectedRevision: r.expectedRevision })
export function decodeGroupSend(v: unknown): GroupSend { const r = groupRecord(v, ['sessionId', 'expectedRevision', 'operationId', 'message', 'memberId']); return { ...commandFrom(r), operationId: groupId(r.operationId), message: groupText(r.message), ...(r.memberId === undefined ? {} : { memberId: memberId(r.memberId) }) } }
export function decodeGroupModelSave(v: unknown): GroupModelSave { const r = groupRecord(v, ['sessionId', 'expectedRevision', 'memberId', 'profile']); return { ...commandFrom(r), memberId: memberId(r.memberId), profile: r.profile === null ? null : decodeGroupProfile(r.profile) } }
export function decodeGroupAnswer(v: unknown): GroupAnswer { const r = groupRecord(v, ['sessionId', 'expectedRevision', 'questionId', 'answerSubmissionId', 'answers']); return { ...commandFrom(r), questionId: groupId(r.questionId), answerSubmissionId: groupId(r.answerSubmissionId), answers: decodeAuthorAnswers(r.answers) } }
export function decodeGroupPage(v: unknown): GroupPage { const r = groupRecord(v, ['sessionId', 'before', 'limit']); if (!Number.isSafeInteger(r.limit) || Number(r.limit) < 1 || Number(r.limit) > 100) return groupInvalid(); return { sessionId: groupId(r.sessionId), limit: Number(r.limit), ...(r.before === undefined ? {} : { before: groupId(r.before) }) } }
export function decodeGroupCandidate(v: unknown): PreparationCandidate {
  const r = groupRecord(v, ['id', 'kind', 'title', 'content', 'memberId', 'createdAt', 'status', 'bookId', 'domainDraft', 'references'])
  if (!['definition', 'world', 'characters', 'outline', 'timeline', 'research', 'adaptation'].includes(String(r.kind)) || !['proposed', 'adopted'].includes(String(r.status))) return groupInvalid()
  const domainDraft = r.domainDraft === undefined ? undefined : decodePreparationDomainDraft(r.domainDraft)
  if (domainDraft && r.kind !== (domainDraft.type === 'character' ? 'characters' : 'timeline')) return groupInvalid()
  const references = r.references === undefined ? undefined : decodePreparationReferences(r.references)
  return { id: groupId(r.id), kind: r.kind as PreparationKind, title: groupText(r.title, 200), content: groupText(r.content, 100000), memberId: memberId(r.memberId), createdAt: groupText(r.createdAt, 50), status: r.status as PreparationCandidate['status'], ...(r.bookId === undefined ? {} : { bookId: groupText(r.bookId, 32767) }), ...(domainDraft ? { domainDraft } : {}), ...(references ? { references } : {}) }
}
export function decodePreparationReferences(value: unknown): PreparationReference[] {
  if (!Array.isArray(value) || !value.length || value.length > 20) return groupInvalid()
  const references = value.map(value => {
    const r = groupRecord(value, ['id', 'title', 'revision', 'url'])
    if (!/^[a-f\d]{64}$/i.test(String(r.revision))) return groupInvalid()
    let url: string | undefined
    if (r.url !== undefined) { url = groupText(r.url, 4096); let parsed: URL; try { parsed = new URL(url) } catch { return groupInvalid() }; if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return groupInvalid() }
    return { id: groupText(r.id, 200), title: groupText(r.title, 2000), revision: String(r.revision), ...(url ? { url } : {}) }
  })
  if (new Set(references.map(reference => reference.id)).size !== references.length) return groupInvalid()
  return references
}
export function decodePreparationDomainDraft(v: unknown): PreparationDomainDraft {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return groupInvalid()
  if ('type' in v && v.type === 'character') { const r = groupRecord(v, ['type', 'id', 'name', 'description']); return { type: 'character', id: groupId(r.id), name: groupText(r.name, 160), description: groupText(r.description, 20000) } }
  const r = groupRecord(v, ['type', 'time', 'characters', 'location', 'event', 'result'])
  if (r.type !== 'macro-event' || !Array.isArray(r.characters) || !r.characters.length || r.characters.length > 50) return groupInvalid()
  return { type: 'macro-event', time: groupText(r.time, 200), characters: r.characters.map(c => groupText(c, 120)), location: groupText(r.location, 500), event: groupText(r.event, 20000), result: groupText(r.result, 10000) }
}
export function decodeGroupView(v: unknown): GroupSessionView {
  const r = groupRecord(v, ['id', 'title', 'draft', 'position', 'revision', 'status', 'notice', 'createdAt', 'updatedAt', 'members', 'messages', 'messageCount', 'candidates', 'book', 'question', 'creation', 'activeMember', 'budget', 'queued', 'team', 'readOnly'])
  let team: CreativeTeam
  try { team = validateCreativeTeam(r.team) } catch { return groupInvalid() }
  if (typeof r.readOnly !== 'boolean') return groupInvalid()
  const checkedMember = (v: unknown) => memberId(v, team.members)
  if (!['idle', 'running', 'waiting-input', 'waiting-creation', 'paused-limit', 'interrupted', 'failed', 'cancelled'].includes(String(r.status))) return groupInvalid()
  const arr = <T>(v: unknown, max: number, decode: (v: unknown) => T): T[] => Array.isArray(v) && v.length <= max ? v.map(decode) : groupInvalid()
  const members = arr(r.members, 16, v => { const m = groupRecord(v, ['memberId', 'profile']); return { memberId: checkedMember(m.memberId), profile: m.profile === null ? null : decodeGroupProfile(m.profile) } })
  if (members.length !== team.members.length || new Set(members.map(m => m.memberId)).size !== members.length) return groupInvalid()
  const messages = arr(r.messages, 100, v => { const m = groupRecord(v, ['id', 'role', 'content', 'createdAt', 'memberId', 'model', 'connectionId']); if (!['user', 'agent', 'activity'].includes(String(m.role))) return groupInvalid(); return { id: groupId(m.id), role: m.role as GroupMessage['role'], content: groupText(m.content, 200000, false), createdAt: groupText(m.createdAt, 50), ...(m.memberId === undefined ? {} : { memberId: checkedMember(m.memberId) }), ...(m.model === undefined ? {} : { model: groupText(m.model, 500) }), ...(m.connectionId === undefined ? {} : { connectionId: groupText(m.connectionId, 80) }) } })
  const book = r.book === null ? null : (() => { const b = groupRecord(r.book, ['id', 'title']); return { id: groupText(b.id, 32767), title: groupText(b.title, 2000) } })()
  const creation = r.creation === null ? null : (() => { const c = groupRecord(r.creation, ['id', 'suggestedTitle', 'summary']); return { id: groupId(c.id), suggestedTitle: groupText(c.suggestedTitle, 200), summary: groupText(c.summary, 2000) } })()
  const budget = groupRecord(r.budget, ['steps', 'calls'])
  for (const n of [budget.steps, budget.calls, r.messageCount, r.queued]) if (!Number.isSafeInteger(n) || Number(n) < 0) return groupInvalid()
  const position = groupRecord(r.position, ['top', 'atBottom']); if (typeof position.top !== 'number' || !Number.isFinite(position.top) || position.top < 0 || position.top > 100000000 || typeof position.atBottom !== 'boolean') return groupInvalid()
  const candidates = arr(r.candidates, 100, decodeGroupCandidate)
  candidates.forEach(candidate => checkedMember(candidate.memberId))
  return { team, readOnly: r.readOnly, id: groupId(r.id), title: groupText(r.title, 200), draft: groupText(r.draft, 12000, false), position: { top: position.top, atBottom: position.atBottom }, revision: groupRevision(r.revision), status: r.status as GroupStatus, notice: groupText(r.notice, 500, false), createdAt: groupText(r.createdAt, 50), updatedAt: groupText(r.updatedAt, 50), members, messages, messageCount: Number(r.messageCount), candidates, book, question: r.question === null ? null : decodeAuthorQuestionCard(r.question), creation, activeMember: r.activeMember === null ? null : checkedMember(r.activeMember), budget: { steps: Number(budget.steps), calls: Number(budget.calls) }, queued: Number(r.queued) }
}
const one = <T>(decode: (v: unknown) => T) => (args: unknown[]): [T] => args.length === 1 ? [decode(args[0])] : groupInvalid()
export const groupChatArgs = { openBook: one(v => groupText(v, 32767)), createForBook: one(v => groupText(v, 32767)), create: one(v => groupText(v, 200)), get: one(decodeGroupPage), send: one(decodeGroupSend), stop: one(decodeGroupCommand), resume: one(decodeGroupCommand), saveMember: one(decodeGroupModelSave), answer: one(decodeGroupAnswer) }
export const groupChatResults: Record<string, (v: unknown) => unknown> = Object.fromEntries(['openBook', 'createForBook', 'create', 'get', 'send', 'stop', 'resume', 'saveMember', 'answer'].map(n => [`group-chat:${n}`, decodeGroupView]))
groupChatResults['group-chat:list'] = (v: unknown) => { if (!Array.isArray(v) || v.length > 100) return groupInvalid(); return v.map(decodeGroupView) }
groupChatResults['group-chat:modelCatalog'] = (v: unknown) => {
  const r = groupRecord(v, ['connections', 'models']), connections = decodeGlobalConnectionsView(r.connections)
  const models = groupRecord(r.models, connections.connections.map(c => c.id))
  return { connections, models: Object.fromEntries(Object.entries(models).map(([id, values]) => { if (!Array.isArray(values) || values.length > 1000) return groupInvalid(); return [id, values.map(value => groupText(value, 500))] })) }
}

export function decodeGroupDraft(v: unknown) {
  const r = groupRecord(v, ['sessionId', 'expectedRevision', 'draft', 'position']), position = groupRecord(r.position, ['top', 'atBottom'])
  if (typeof position.top !== 'number' || !Number.isFinite(position.top) || position.top < 0 || position.top > 100000000 || typeof position.atBottom !== 'boolean') return groupInvalid()
  return { ...commandFrom(r), draft: groupText(r.draft, 12000, false), position: { top: position.top, atBottom: position.atBottom } }
}
