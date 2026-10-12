import { decodeAssistantConversationRequest, decodeAssistantConversationResult, type AssistantConversationRequest, type AssistantConversationResult } from './assistant-conversation-contracts'
import { decodeAuthorQuestionCard, interactionArray, interactionId, interactionInvalid, interactionRecord, interactionText, interactionVersion, type AuthorAnswerReceipt, type AuthorAnswerSubmission, type AuthorQuestionCard } from './author-interaction-contracts'

export const assistantRunStates = ['running', 'waiting-input', 'waiting-adoption', 'paused-limit', 'interrupted', 'completed', 'failed', 'cancelled'] as const
export type AssistantRunStatus = typeof assistantRunStates[number]
export type AssistantRunHandoff = { id: string; result: AssistantConversationResult; taskId?: string }
export type AssistantRunView = {
  id: string; operationId: string; workItemId: string; bookTitle: string; page: string; goal: string; status: AssistantRunStatus
  revision: number; step: number; message: string; tools: string[]; createdAt: string; updatedAt: string; needsResume: boolean; editorFingerprint?: string; model?: string; connectionId?: string; maxTokensOverride?: number
  partial?: string; question?: AuthorQuestionCard; handoff?: AssistantRunHandoff; result?: AssistantConversationResult
}
export type AssistantRunCommand = { runId: string; expectedRevision: number }
export type AssistantRunRefresh = Pick<AssistantConversationRequest, 'page' | 'targets' | 'chapterId' | 'selectedCharacters' | 'focusedTargetId' | 'editorFingerprint'>
export type AssistantRunResume = AssistantRunCommand & { context: AssistantRunRefresh }
export type AssistantHandoffAcknowledgement = AssistantRunResume & { handoffId: string; taskId?: string }
export interface AssistantRunsApi {
  start(input: AssistantConversationRequest): Promise<AssistantRunView>
  status(id: string): Promise<AssistantRunView>
  recent(): Promise<AssistantRunView[]>
  resume(input: AssistantRunResume): Promise<AssistantRunView>
  cancel(input: AssistantRunCommand): Promise<AssistantRunView>
  acknowledgeHandoff(input: AssistantHandoffAcknowledgement): Promise<AssistantRunView>
  answer(input: AuthorAnswerSubmission): Promise<AuthorAnswerReceipt>
}
export function decodeAssistantRunView(value: unknown): AssistantRunView {
  const v = interactionRecord(value, ['id', 'operationId', 'workItemId', 'bookTitle', 'page', 'goal', 'status', 'revision', 'step', 'message', 'tools', 'createdAt', 'updatedAt', 'needsResume', 'editorFingerprint', 'model', 'connectionId', 'maxTokensOverride', 'question', 'handoff', 'result', 'partial'])
  if (!assistantRunStates.includes(v.status as AssistantRunStatus) || !Number.isSafeInteger(v.step) || Number(v.step) < 0 || typeof v.needsResume !== 'boolean') return interactionInvalid()
  if (v.editorFingerprint !== undefined && (typeof v.editorFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(v.editorFingerprint))) return interactionInvalid()
  let handoff: AssistantRunHandoff | undefined
  if (v.handoff !== undefined) {
    const h = interactionRecord(v.handoff, ['id', 'result', 'taskId'])
    handoff = { id: interactionId(h.id), result: decodeAssistantConversationResult(h.result), ...(h.taskId === undefined ? {} : { taskId: interactionId(h.taskId) }) }
  }
  return { ...(v.partial === undefined ? {} : { partial: interactionText(v.partial, 50000) }), ...(v.editorFingerprint === undefined ? {} : { editorFingerprint: v.editorFingerprint as string }), ...(v.model === undefined ? {} : { model: interactionText(v.model, 200) }), ...(v.connectionId === undefined ? {} : { connectionId: interactionId(v.connectionId) }), ...(v.maxTokensOverride === undefined ? {} : { maxTokensOverride: interactionVersion(v.maxTokensOverride) }), id: interactionId(v.id), operationId: interactionId(v.operationId), workItemId: interactionText(v.workItemId, 32767, true), bookTitle: interactionText(v.bookTitle, 1000), page: interactionText(v.page, 200, true), goal: interactionText(v.goal, 12000, true), status: v.status as AssistantRunStatus, revision: interactionVersion(v.revision), step: Number(v.step), message: interactionText(v.message, 1000), tools: interactionArray(v.tools, 24, item => interactionText(item, 240)), createdAt: interactionText(v.createdAt, 50), updatedAt: interactionText(v.updatedAt, 50), needsResume: v.needsResume, ...(v.question === undefined ? {} : { question: decodeAuthorQuestionCard(v.question) }), ...(handoff ? { handoff } : {}), ...(v.result === undefined ? {} : { result: decodeAssistantConversationResult(v.result) }) }
}
export function decodeAssistantRunCommand(value: unknown): AssistantRunCommand {
  const v = interactionRecord(value, ['runId', 'expectedRevision'])
  return { runId: interactionId(v.runId), expectedRevision: interactionVersion(v.expectedRevision) }
}
export function decodeAssistantRunRefresh(value: unknown): AssistantRunRefresh {
  const v = interactionRecord(value, ['page', 'targets', 'chapterId', 'selectedCharacters', 'focusedTargetId', 'editorFingerprint'])
  if (!Array.isArray(v.targets)) return interactionInvalid()
  // Reuse the exact field catalog and bounded draft decoder; scope is checked by main.
  const first = v.targets[0] as { workItemId?: unknown } | undefined
  const decoded = decodeAssistantConversationRequest({ ...v, workItemId: first?.workItemId ?? null, operationId: 'refresh', message: 'refresh', history: [] })
  return { ...(decoded.editorFingerprint ? { editorFingerprint: decoded.editorFingerprint } : {}), page: decoded.page, targets: decoded.targets, chapterId: decoded.chapterId, selectedCharacters: decoded.selectedCharacters, ...(decoded.focusedTargetId ? { focusedTargetId: decoded.focusedTargetId } : {}) }
}
export function decodeAssistantRunResume(value: unknown): AssistantRunResume {
  const v = interactionRecord(value, ['runId', 'expectedRevision', 'context'])
  return { ...decodeAssistantRunCommand({ runId: v.runId, expectedRevision: v.expectedRevision }), context: decodeAssistantRunRefresh(v.context) }
}
export function decodeAssistantHandoffAcknowledgement(value: unknown): AssistantHandoffAcknowledgement {
  const v = interactionRecord(value, ['runId', 'expectedRevision', 'context', 'handoffId', 'taskId'])
  return { ...decodeAssistantRunResume({ runId: v.runId, expectedRevision: v.expectedRevision, context: v.context }), handoffId: interactionId(v.handoffId), ...(v.taskId === undefined ? {} : { taskId: interactionId(v.taskId) }) }
}
const one = <T>(decode: (value: unknown) => T) => (args: unknown[]): [T] => args.length === 1 ? [decode(args[0])] : interactionInvalid()
export const decodeAssistantRunCommandArgs = one(decodeAssistantRunCommand)
export const decodeAssistantRunResumeArgs = one(decodeAssistantRunResume)
export const decodeAssistantHandoffArgs = one(decodeAssistantHandoffAcknowledgement)
export const assistantRunResultDecoders = Object.fromEntries(['start', 'status', 'resume', 'cancel', 'handoff'].map(key => [`assistant-runs:${key}`, decodeAssistantRunView]))
