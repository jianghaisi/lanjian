import { validatedProviderMessage } from '../../../../../contracts/models/provider-tool-content'
import { validatedGeminiMessage } from '../../../../../contracts/models/gemini-tool-content'
import { AppError } from '../../../../core/errors/app-error'
import { decodeAssistantConversationRequest, type AiToolCall, type AiToolMessage, type AssistantConversationRequest } from '../../../../../contracts/assistant/assistant-conversation-contracts'
import { decodeAssistantRunView, type AssistantRunStatus, type AssistantRunView } from '../../../../../contracts/assistant/assistant-run-contracts'
import { decodeAuthorAnswerReceipt, decodeAuthorAnswerSubmission, interactionArray, interactionId, interactionInvalid, interactionRecord, interactionText, type AuthorAnswerReceipt, type AuthorAnswerSubmission } from '../../../../../contracts/assistant/author-interaction-contracts'
import type { DispatcherCheckpoint } from '../../../writing-plugins/application/dispatcher'
import { assertJson, jsonBytes } from '../../../writing-plugins/domain/schema'
import type { JsonObject } from '../../../writing-plugins/domain/types'
import { decodePluginRunState, type PluginRunState } from '../../../writing-plugins/domain/plugin-run'
import { decodeCreativePolicySnapshot, type CreativePolicySnapshot } from '../../../writing-plugins/domain/creative-policy-snapshot'

export const runLimits = { historyCount: 50, storeBytes: 20 * 1024 * 1024, recordBytes: 1024 * 1024, messageBytes: 250000, pendingCalls: 8, receipts: 96 } as const
export type AssistantRunRecord = {
  format: 1; requestDigest: string; ownerSession: string; physicalIdentity: string; fingerprint: string; modelIdentity: string
  view: AssistantRunView; input: AssistantConversationRequest; messages: AiToolMessage[]; pending: AiToolCall[]
  dispatcher: DispatcherCheckpoint; stepId: string; intent: 'idle' | 'model' | 'tool'; waitingCall?: AiToolCall
  checkpoint?: JsonObject; guestAnswer?: JsonObject; plugins?: PluginRunState; receipts: Array<{ submission: AuthorAnswerSubmission; receipt: AuthorAnswerReceipt }>
  creativePolicy?: CreativePolicySnapshot; conversationMethodHash?: string
}
export interface AssistantRunStorePort {
  read(workItemId: string): Promise<AssistantRunRecord[]>
  write(record: AssistantRunRecord, beforeCommit?: () => Promise<void>): Promise<void>
  all?(): AsyncIterable<AssistantRunRecord>
}
export const runTerminal = (status: AssistantRunStatus) => ['completed', 'failed', 'cancelled'].includes(status)
export function runConflict(message = '任务、问题或写作依据已变化，请重新核对。'): never { throw new AppError('CONFLICT', message, { recoverable: true }) }
export function transitionRun(record: AssistantRunRecord, status: AssistantRunStatus, message: string): void {
  if (runTerminal(record.view.status) && status !== record.view.status) runConflict('这项创作任务已经结束。')
  record.view.status = status; record.view.message = message
}
export function recoveredRunView(record: AssistantRunRecord, session: string): AssistantRunView {
  const view = structuredClone(record.view)
  if (record.ownerSession !== session && !runTerminal(view.status)) {
    view.needsResume = true
    if (view.status === 'running') { view.status = 'interrupted'; view.message = '上次执行已中断。请核对后继续；不会自动重做已发起的操作。' }
  }
  return view
}
export function decodeToolCall(value: unknown): AiToolCall {
  const v = interactionRecord(value, ['id', 'type', 'function']), f = interactionRecord(v.function, ['name', 'arguments'])
  if (v.type !== 'function') return interactionInvalid()
  return { id: interactionId(v.id), type: 'function', function: { name: interactionId(f.name), arguments: interactionText(f.arguments, 128 * 1024) } }
}
export function decodeNativeHistory(value: unknown): AiToolMessage[] {
  const messages = interactionArray(value, 400, item => {
    const m = interactionRecord(item, ['role', 'content', 'tool_calls', 'tool_call_id', 'geminiParts', 'providerContent'])
    if (!['system', 'user', 'assistant', 'tool'].includes(String(m.role))) return interactionInvalid()
    const message: AiToolMessage = { role: m.role as AiToolMessage['role'], content: m.content === null ? null : interactionText(m.content, runLimits.messageBytes), ...(m.tool_calls === undefined ? {} : { tool_calls: interactionArray(m.tool_calls, runLimits.pendingCalls, decodeToolCall) }), ...(m.tool_call_id === undefined ? {} : { tool_call_id: interactionId(m.tool_call_id) }) }
    if (m.geminiParts !== undefined) message.geminiParts = validatedGeminiMessage({ ...message, geminiParts: m.geminiParts as AiToolMessage['geminiParts'] })
    if (m.providerContent !== undefined) message.providerContent = validatedProviderMessage({ ...message, providerContent: m.providerContent as AiToolMessage['providerContent'] })
    return message
  })
  if (jsonBytes(messages) > runLimits.messageBytes) return interactionInvalid()
  return messages
}
export function decodeRunRecord(value: unknown): AssistantRunRecord {
  assertJson(value)
  if (jsonBytes(value) > runLimits.recordBytes) return interactionInvalid()
  const v = interactionRecord(value, ['format', 'requestDigest', 'ownerSession', 'physicalIdentity', 'fingerprint', 'modelIdentity', 'view', 'input', 'messages', 'pending', 'dispatcher', 'stepId', 'intent', 'waitingCall', 'checkpoint', 'guestAnswer', 'plugins', 'receipts', 'creativePolicy', 'conversationMethodHash'])
  if (v.format !== 1 || !['idle', 'model', 'tool'].includes(String(v.intent))) return interactionInvalid()
  if ((v.creativePolicy === undefined) !== (v.conversationMethodHash === undefined) || (v.conversationMethodHash !== undefined && (typeof v.conversationMethodHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.conversationMethodHash)))) return interactionInvalid()
  const view = decodeAssistantRunView(v.view), input = decodeAssistantConversationRequest(v.input)
  if (view.workItemId !== input.workItemId || view.operationId !== input.operationId) return interactionInvalid()
  const d = interactionRecord(v.dispatcher, ['signature', 'visible', 'evidence', 'budget']), b = interactionRecord(d.budget, ['steps', 'calls'])
  if (!Number.isSafeInteger(b.steps) || Number(b.steps) < 0 || Number(b.steps) > 24 || !Number.isSafeInteger(b.calls) || Number(b.calls) < 0 || Number(b.calls) > 96) return interactionInvalid()
  const messages = decodeNativeHistory(v.messages)
  const pending = interactionArray(v.pending, runLimits.pendingCalls, decodeToolCall)
  const waitingCall = v.waitingCall === undefined ? undefined : decodeToolCall(v.waitingCall)
  const declared = messages.flatMap(message => message.tool_calls ?? []), declaredIds = new Set(declared.map(call => call.id))
  const settled = messages.filter(message => message.role === 'tool').map(message => message.tool_call_id)
  const unresolved = [...pending, ...(waitingCall ? [waitingCall] : [])].map(call => call.id)
  if (declared.length !== declaredIds.size || new Set([...settled, ...unresolved]).size !== settled.length + unresolved.length || settled.some(id => !id || !declaredIds.has(id)) || unresolved.some(id => !declaredIds.has(id)) || declared.length !== settled.length + unresolved.length) return interactionInvalid()
  if (view.question && (!waitingCall || view.handoff || view.question.toolCallId !== waitingCall.id)) return interactionInvalid()
  if (view.handoff && !waitingCall) return interactionInvalid()
  if (v.checkpoint !== undefined && (!v.checkpoint || typeof v.checkpoint !== 'object' || Array.isArray(v.checkpoint) || jsonBytes(v.checkpoint) > 65536)) return interactionInvalid()
  if (v.checkpoint !== undefined && !waitingCall) return interactionInvalid()
  if (v.guestAnswer !== undefined && (!v.checkpoint || !waitingCall || view.question || !v.guestAnswer || typeof v.guestAnswer !== 'object' || Array.isArray(v.guestAnswer) || jsonBytes(v.guestAnswer) > 128 * 1024)) return interactionInvalid()
  return { format: 1, ...(v.creativePolicy === undefined ? {} : { creativePolicy: decodeCreativePolicySnapshot(v.creativePolicy), conversationMethodHash: v.conversationMethodHash as string }), requestDigest: interactionText(v.requestDigest, 64, true), ownerSession: interactionId(v.ownerSession), physicalIdentity: interactionText(v.physicalIdentity, 200), fingerprint: interactionText(v.fingerprint, 200), modelIdentity: interactionText(v.modelIdentity, 200), view, input, messages,
    pending, dispatcher: { signature: interactionText(d.signature, 64, true), visible: interactionArray(d.visible, 48, interactionId), evidence: interactionArray(d.evidence, 12288, item => interactionText(item, 1200)), budget: { steps: Number(b.steps), calls: Number(b.calls) } }, stepId: interactionId(v.stepId), intent: v.intent as AssistantRunRecord['intent'], ...(waitingCall ? { waitingCall } : {}), ...(v.checkpoint === undefined ? {} : { checkpoint: v.checkpoint as JsonObject }), ...(v.guestAnswer === undefined ? {} : { guestAnswer: v.guestAnswer as JsonObject }), ...(v.plugins === undefined ? {} : { plugins: decodePluginRunState(v.plugins) }), receipts: interactionArray(v.receipts, runLimits.receipts, item => { const r = interactionRecord(item, ['submission', 'receipt']); return { submission: decodeAuthorAnswerSubmission(r.submission), receipt: decodeAuthorAnswerReceipt(r.receipt) } }) }
}
