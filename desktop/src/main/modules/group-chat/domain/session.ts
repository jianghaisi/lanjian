import type { AiToolCall, AiToolMessage } from '../../../../contracts/assistant/assistant-conversation-contracts'
import { decodeGroupView, decodeGroupProfile, groupId, groupRecord, groupText, memberId, groupInvalid, type GroupMessage, type GroupSessionView, type MemberId, type MemberAssignment } from '../../../../contracts/group-chat/group-chat'
import { decodeNativeHistory, decodeToolCall } from '../../assistant/application/runs/state'
import { assertJson } from '../../writing-plugins/domain/schema'
import { decodePluginRunState, type PluginEffectReceipt } from '../../writing-plugins/domain/plugin-run'
import { decodeCreativePolicySnapshot } from '../../writing-plugins/domain/creative-policy-snapshot'
import { legacyGroupTeam, type GroupTeamOrigin } from './creative-team'
import type { DispatcherCheckpoint } from '../../writing-plugins/application/dispatcher'
import type { JsonObject } from '../../writing-plugins/domain/types'
import type { PluginRunState } from '../../writing-plugins/domain/plugin-run'
import { decodeAuthorAnswers, interactionId } from '../../../../contracts/assistant/author-interaction-contracts'
import { ToolBudget } from '../../writing-plugins/application/dispatcher'
export type GroupToolState = Omit<PluginRunState, 'effects'>
export type GroupWork = { id: string; memberId: MemberId; instruction: string; depth: number }
export type GroupSession = {
  format: 1 | 2; origin: GroupTeamOrigin | null; owner: string; view: GroupSessionView; transcript: GroupMessage[]
  bound: { root: string; physicalIdentity: string } | null
  queue: GroupWork[]; assignments: MemberAssignment[]; histories: Record<string, AiToolMessage[]>
  current: { work: GroupWork; historyKey: string; pending: AiToolCall[]; waiting: AiToolCall | null; dispatcher?: DispatcherCheckpoint; checkpoint?: JsonObject; guestAnswer?: JsonObject; sourceHash?: string } | null
  tools?: GroupToolState
  jobs: Array<{ kind: 'planning' | 'expansion' | 'writing'; id: string }>
  effects: PluginEffectReceipt[]
  intent: 'idle' | 'model' | 'tool'; handoffs: number
  operations: Array<{ id: string; message: string; memberId: MemberId }>
  answers: Array<{ id: string; digest: string }>
}
export function decodeGroupSession(value: unknown): GroupSession {
  assertJson(value, 8 * 1024 * 1024)
  const r = groupRecord(value, ['format', 'owner', 'view', 'transcript', 'bound', 'queue', 'assignments', 'histories', 'current', 'intent', 'handoffs', 'operations', 'answers', 'jobs', 'effects', 'origin', 'tools'])
  if (![1, 2].includes(Number(r.format)) || !['idle', 'model', 'tool'].includes(String(r.intent))) return groupInvalid()
  if (r.format !== 1 && r.format !== 2) return groupInvalid()
  const array = <T>(v: unknown, max: number, decode: (v: unknown) => T): T[] => Array.isArray(v) && v.length <= max ? v.map(decode) : groupInvalid()
  const view = r.format === 1 ? decodeGroupView({ ...groupRecord(r.view, ['id', 'title', 'draft', 'position', 'revision', 'status', 'notice', 'createdAt', 'updatedAt', 'members', 'messages', 'messageCount', 'candidates', 'book', 'question', 'creation', 'activeMember', 'budget', 'queued']), team: legacyGroupTeam(), readOnly: true }) : decodeGroupView(r.view)
  const checkedMember = (value: unknown) => memberId(value, view.team.members)
  const origin = r.format === 1 ? null : (() => {
    const original = groupRecord(r.origin, ['policy', 'teamHash'])
    if (typeof original.teamHash !== 'string' || !/^[a-f\d]{64}$/.test(original.teamHash) || view.readOnly) return groupInvalid()
    return { policy: decodeCreativePolicySnapshot(original.policy), teamHash: original.teamHash }
  })()
  if (r.format === 1 && r.origin !== undefined) return groupInvalid()
  const transcript = array(r.transcript, 10000, v => decodeGroupView({ ...view, messages: [v] }).messages[0])
  if (new Set(transcript.map(m => m.id)).size !== transcript.length || view.messageCount !== transcript.length) return groupInvalid()
  const work = (v: unknown): GroupWork => { const w = groupRecord(v, ['id', 'memberId', 'instruction', 'depth']); if (!Number.isSafeInteger(w.depth) || Number(w.depth) < 0 || Number(w.depth) > 4) return groupInvalid(); return { id: groupId(w.id), memberId: checkedMember(w.memberId), instruction: groupText(w.instruction), depth: Number(w.depth) } }
  const histories = groupRecord(r.histories, r.histories && typeof r.histories === 'object' ? Object.keys(r.histories) : [])
  if (Object.keys(histories).length > view.team.members.length) return groupInvalid()
  const decoded = Object.fromEntries(Object.entries(histories).map(([key, messages]) => { if (!/^[a-z][a-z0-9_-]{0,63}:[a-f\d]{64}$/.test(key)) return groupInvalid(); checkedMember(key.split(':')[0]); return [key, decodeNativeHistory(messages)] }))
  const current = r.current === null ? null : (() => {
    const c = groupRecord(r.current, ['work', 'historyKey', 'pending', 'waiting', 'dispatcher', 'checkpoint', 'guestAnswer', 'sourceHash'])
    const historyKey = groupText(c.historyKey, 129)
    if (!Object.hasOwn(decoded, historyKey)) return groupInvalid()
    const waiting = c.waiting === null ? null : decodeToolCall(c.waiting)
    const dispatcher = c.dispatcher === undefined ? undefined : (() => {
      const d = groupRecord(c.dispatcher, ['signature', 'visible', 'evidence', 'budget']), b = groupRecord(d.budget, ['steps', 'calls'])
      if (typeof d.signature !== 'string' || !/^[a-f\d]{64}$/.test(d.signature)) return groupInvalid()
      const budget = { steps: Number(b.steps), calls: Number(b.calls) }; new ToolBudget().restore(budget)
      if (budget.steps !== view.budget.steps || budget.calls !== view.budget.calls) return groupInvalid()
      const visible = array(d.visible, 48, interactionId), evidence = array(d.evidence, 12288, v => groupText(v, 1200))
      if (new Set(visible).size !== visible.length || new Set(evidence).size !== evidence.length) return groupInvalid()
      return { signature: d.signature, visible, evidence, budget }
    })()
    const checkpoint = c.checkpoint === undefined ? undefined : (() => { assertJson(c.checkpoint, 65536); if (!waiting || !dispatcher || !c.checkpoint || typeof c.checkpoint !== 'object' || Array.isArray(c.checkpoint)) return groupInvalid(); return c.checkpoint as JsonObject })()
    const guestAnswer = c.guestAnswer === undefined ? undefined : (() => {
      const a = groupRecord(c.guestAnswer, ['answers'])
      if (!checkpoint || !waiting || view.question) return groupInvalid()
      return { answers: decodeAuthorAnswers(a.answers) } as unknown as JsonObject
    })()
    if (checkpoint && !guestAnswer && !['cancelled', 'failed'].includes(view.status) && (!view.question || view.question.toolCallId !== waiting?.id)) return groupInvalid()
    if (view.question && view.question.toolCallId !== waiting?.id) return groupInvalid()
    if (c.sourceHash !== undefined && (typeof c.sourceHash !== 'string' || !/^[a-f\d]{64}$/.test(c.sourceHash))) return groupInvalid()
    return { work: work(c.work), historyKey, pending: array(c.pending, 8, decodeToolCall), waiting, ...(dispatcher ? { dispatcher } : {}), ...(checkpoint ? { checkpoint } : {}), ...(guestAnswer ? { guestAnswer } : {}), ...(c.sourceHash === undefined ? {} : { sourceHash: c.sourceHash as string }) }
  })()
  const tools = r.tools === undefined ? undefined : (() => {
    if (r.format !== 2 || !origin || !view.book) return groupInvalid()
    const t = groupRecord(r.tools, ['pins', 'composition']), state = decodePluginRunState({ ...t, effects: [] })
    if (state.pins.length !== origin.policy.installed.length || state.pins.some(p => !origin.policy.installed.some(ref => ref.pluginId === p.id && ref.version === p.version && ref.digest === p.digest)) || JSON.stringify(state.composition) !== JSON.stringify(origin.policy.composition)) return groupInvalid()
    return { pins: state.pins, composition: state.composition }
  })()
  if (r.format === 1 && current && (current.dispatcher || current.checkpoint || current.guestAnswer || current.sourceHash)) return groupInvalid()
  if (current) {
    const history = decoded[current.historyKey], declared = history.flatMap(m => m.tool_calls ?? []), settled = history.filter(m => m.role === 'tool').map(m => m.tool_call_id), unresolved = [...current.pending, ...(current.waiting ? [current.waiting] : [])].map(c => c.id)
    if (new Set(declared.map(c => c.id)).size !== declared.length || new Set([...settled, ...unresolved]).size !== declared.length || declared.length !== settled.length + unresolved.length || [...settled, ...unresolved].some(id => !declared.some(c => c.id === id))) return groupInvalid()
  }
  for (const [key, history] of Object.entries(decoded)) {
    if (key === current?.historyKey) continue
    const declarations = history.flatMap(m => m.tool_calls ?? []).map(c => c.id), results = history.filter(m => m.role === 'tool').map(m => m.tool_call_id)
    if (new Set(declarations).size !== declarations.length || new Set(results).size !== results.length || declarations.length !== results.length || results.some(id => !declarations.includes(id!))) return groupInvalid()
  }
  if (current && !current.historyKey.startsWith(`${current.work.memberId}:`)) return groupInvalid()
  if (Array.isArray(r.assignments) && r.assignments.length && (r.assignments.length !== view.team.members.length || new Set(r.assignments.map(v => groupRecord(v, ['memberId', 'profile']).memberId)).size !== view.team.members.length)) return groupInvalid()
  const bound = r.bound === null ? null : (() => { const b = groupRecord(r.bound, ['root', 'physicalIdentity']); return { root: groupText(b.root, 32767), physicalIdentity: groupText(b.physicalIdentity, 200) } })()
  if (Boolean(bound) !== Boolean(view.book)) return groupInvalid()
  if (!Number.isSafeInteger(r.handoffs) || Number(r.handoffs) < 0 || Number(r.handoffs) > 24) return groupInvalid()
  const jobs = array(r.jobs, 96, v => { const j = groupRecord(v, ['kind', 'id']); if (!['planning', 'expansion', 'writing'].includes(String(j.kind))) return groupInvalid(); return { kind: j.kind as 'planning' | 'expansion' | 'writing', id: groupId(j.id) } })
  return { ...(tools ? { tools } : {}), effects: decodePluginRunState({ pins: [], effects: r.effects ?? [] }).effects, jobs, format: r.format, origin, owner: groupText(r.owner, 200), view, transcript, bound, queue: array(r.queue, 24, work), assignments: array(r.assignments, 16, v => { const m = groupRecord(v, ['memberId', 'profile']); return { memberId: checkedMember(m.memberId), profile: m.profile === null ? null : decodeGroupProfile(m.profile) } }), histories: decoded, current, intent: r.intent as GroupSession['intent'], handoffs: Number(r.handoffs), operations: array(r.operations, 10000, v => { const o = groupRecord(v, ['id', 'message', 'memberId']); return { id: groupId(o.id), message: groupText(o.message), memberId: checkedMember(o.memberId) } }), answers: array(r.answers, 96, v => { const a = groupRecord(v, ['id', 'digest']); return { id: groupId(a.id), digest: groupText(a.digest, 64) } }) }
}
export interface GroupSessionStore { list(): Promise<GroupSession[]>; read(id: string): Promise<GroupSession>; write(session: GroupSession, beforeCommit?: () => Promise<void>): Promise<void> }
