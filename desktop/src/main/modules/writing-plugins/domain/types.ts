import type { JsonObject, JsonValue, SourceRef, ToolDescriptor } from '@lanjian/writing-plugin-contracts'
import type { AssistantConversationResult } from '../../../../contracts/assistant/assistant-conversation-contracts'
export type { JsonObject, JsonValue, SourceRef, ToolDescriptor, ToolEffect, ToolSchema } from '@lanjian/writing-plugin-contracts'

export type ToolOutcome = (
  | { kind: 'completed'; value: JsonValue; evidence: SourceRef[] }
  | { kind: 'handoff'; result: AssistantConversationResult }
  | { kind: 'waiting-adoption'; candidateRef: { kind: string; id: string }; evidence: SourceRef[] }
  | { kind: 'waiting-input'; question: JsonObject; checkpoint?: JsonObject }
  | { kind: 'failed'; code: 'unavailable' | 'conflict' | 'invalid'; message: string }
) & { trace?: string }

/** Main-only grant, captured before model execution. Never constructed from tool arguments. */
export type ToolHostContext = {
  workItemId: string | null
  allowedCapabilities: ReadonlySet<string>
  signal: AbortSignal
  assertScope(): Promise<void>
}
export type ToolExecutionContext = ToolHostContext & {
  invocationId?: string
  report(message: string): void
  hostCall<T>(operation: () => Promise<T>): Promise<T>
  modelStep(): void
  invoke(modelName: string, input: JsonObject, invocationId?: string): Promise<ToolOutcome>
}
export type CapabilityTool = ToolDescriptor & {
  packageDigest?: string
  isAvailable(context: Readonly<ToolHostContext>): boolean
  execute(input: JsonObject, context: ToolExecutionContext): Promise<ToolOutcome>
  resume?(checkpoint: JsonObject, answer: JsonValue, context: ToolExecutionContext): Promise<ToolOutcome>
}
