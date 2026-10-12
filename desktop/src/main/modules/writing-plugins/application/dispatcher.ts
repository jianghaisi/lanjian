import { AppError } from '../../../core/errors/app-error'
import { decodeAssistantConversationResult } from '../../../../contracts/assistant/assistant-conversation-contracts'
import { assertJson, jsonBytes, objectSchema, textSchema, validateValue, PluginContractError } from '../domain/schema'
import { pluginLimits } from '../domain/limits'
import type { JsonObject, JsonValue, SourceRef, ToolExecutionContext, ToolHostContext, ToolOutcome } from '../domain/types'
import type { PluginContinuation } from '../domain/plugin-run'
import { functionDefinitions, type RegisteredTool, type WritingPluginRegistry } from './registry'
import { createHash } from 'node:crypto'

const invalid = (): never => { throw new AppError('AI_RESPONSE_INVALID', '工具参数或返回内容不符合契约，已停止本轮处理。', { recoverable: true }) }
export class ToolLimitError extends AppError {
  constructor() { super('FEATURE_UNAVAILABLE', '本轮助笔尚未完成目标，已达到工具步骤或调用上限。当前输入已保留，请缩小任务范围后重试。', { recoverable: true }) }
}
const limit = (): never => { throw new ToolLimitError() }
const cancelled = (): never => { throw new AppError('CONFLICT', '已停止本次对话，输入内容未改动。', { recoverable: true }) }
const evidenceSchema = { type: 'array' as const, maxItems: 128, items: objectSchema({ kind: textSchema(100, 1), id: textSchema(200, 1), revision: textSchema(200, 1) }) }

export class ToolBudget {
  private steps = 0
  private calls = 0
  modelStep(): void { if (this.steps >= pluginLimits.modelSteps) limit(); this.steps++ }
  call(depth: number): void { if (depth > pluginLimits.callDepth || this.calls >= pluginLimits.calls) limit(); this.calls++ }
  snapshot() { return { steps: this.steps, calls: this.calls } }
  restore(value: { steps: number; calls: number }) {
    if (!Number.isSafeInteger(value.steps) || value.steps < 0 || value.steps > pluginLimits.modelSteps || !Number.isSafeInteger(value.calls) || value.calls < 0 || value.calls > pluginLimits.calls) invalid()
    this.steps = value.steps; this.calls = value.calls
  }
}
export type DispatcherCheckpoint = { signature: string; visible: string[]; evidence: string[]; budget: { steps: number; calls: number } }

export class WritingPluginDispatcher {
  readonly budget: ToolBudget
  private readonly catalogue: RegisteredTool[]
  private readonly visible = new Map<string, RegisteredTool>()
  private readonly issuedEvidence = new Set<string>()
  private readonly host: ToolHostContext

  constructor(registry: WritingPluginRegistry, host: ToolHostContext, private readonly report: (message: string) => void = () => {}, sharedBudget?: ToolBudget) {
    this.budget = sharedBudget ?? new ToolBudget()
    this.host = { ...host, allowedCapabilities: new Set(host.allowedCapabilities) }
    this.catalogue = registry.snapshot(this.host)
    for (const entry of this.catalogue.filter(item => item.builtin)) this.visible.set(entry.name, entry)
    const discover: RegisteredTool = { name: 'discover_tools', builtin: true, tool: {
      pluginId: 'builtin.discovery', id: 'discover_tools', version: '1.0.0', effect: 'read', capabilities: [],
      description: '按用途、插件标识、工具标识或“插件标识/工具标识”查找本作品可用工具。根据返回的 pluginId 和 toolId 区分工具，使用 name 调用；nextOffset 为 -1 表示没有后续。不因当前页面隐藏写作能力。',
      inputSchema: objectSchema({ query: textSchema(200), offset: { type: 'integer', minimum: 0, maximum: 10000 } }, []),
      outputSchema: objectSchema({ tools: { type: 'array', maxItems: pluginLimits.discoveryPage, items: objectSchema({ name: textSchema(64, 1), pluginId: textSchema(128, 1), toolId: textSchema(128, 1), description: textSchema(2000), effect: textSchema(20) }) }, nextOffset: { type: 'integer', minimum: -1 }, total: { type: 'integer', minimum: 0 } }),
      isAvailable: () => true,
      execute: async input => {
        const query = String(input.query ?? '').trim().toLocaleLowerCase(), offset = Number(input.offset ?? 0)
        const matches = this.catalogue.filter(entry => `${entry.name} ${entry.tool.pluginId}/${entry.tool.id} ${entry.tool.description}`.toLocaleLowerCase().includes(query))
        const page = matches.slice(offset, offset + pluginLimits.discoveryPage)
        const next = new Map(this.visible)
        for (const entry of page) next.set(entry.name, entry)
        functionDefinitions([...next.values()]) // Atomic: overflow never publishes a partial page.
        for (const entry of page) this.visible.set(entry.name, entry)
        return { kind: 'completed', evidence: [], value: { tools: page.map(entry => ({ name: entry.name, pluginId: entry.tool.pluginId, toolId: entry.tool.id, description: entry.tool.description, effect: entry.tool.effect })), total: matches.length, nextOffset: offset + page.length < matches.length ? offset + page.length : -1 } }
      }
    } }
    this.visible.set(discover.name, discover)
    this.definitions()
  }

  definitions() { return functionDefinitions([...this.visible.values()]) }
  descriptor(name: string) { const tool = this.visible.get(name)?.tool; return tool ? { pluginId: tool.pluginId, toolId: tool.id } : undefined }
  checkpoint(): DispatcherCheckpoint {
    const metadata = this.catalogue.map(({ name, builtin, tool: { execute: _execute, resume: _resume, isAvailable: _available, ...tool } }) => ({ name, builtin, tool }))
    return { signature: createHash('sha256').update(JSON.stringify(metadata)).digest('hex'), visible: [...this.visible.keys()], evidence: [...this.issuedEvidence], budget: this.budget.snapshot() }
  }
  restore(saved: DispatcherCheckpoint): void {
    if (saved.signature !== this.checkpoint().signature) throw new AppError('CONFLICT', '本次任务的工具版本或授权已变化，请重新发起。', { recoverable: true })
    for (const name of saved.visible) {
      if (this.visible.has(name)) continue
      const entry = this.catalogue.find(item => item.name === name)
      if (!entry) invalid()
      this.visible.set(name, entry!)
    }
    this.definitions(); this.budget.restore(saved.budget)
    for (const evidence of saved.evidence) this.issuedEvidence.add(evidence)
  }

  async execute(name: string, argumentsJson: string, invocationId?: string): Promise<ToolOutcome> {
    if (new TextEncoder().encode(argumentsJson).byteLength > pluginLimits.inputBytes) invalid()
    let input: unknown
    try { input = JSON.parse(argumentsJson) } catch { return invalid() }
    return this.dispatch(name, input, 1, this.host.allowedCapabilities, [], invocationId)
  }

  async resume(name: string, argumentsJson: string, checkpoint: JsonObject, answer: JsonValue, invocationId: string): Promise<ToolOutcome> {
    assertJson(checkpoint, 64 * 1024); assertJson(answer, pluginLimits.inputBytes)
    if (new TextEncoder().encode(argumentsJson).byteLength > pluginLimits.inputBytes) invalid()
    let input: unknown
    try { input = JSON.parse(argumentsJson) } catch { return invalid() }
    return this.dispatch(name, input, 1, this.host.allowedCapabilities, [], invocationId, { checkpoint, answer })
  }

  private async check(): Promise<void> {
    if (this.host.signal.aborted) cancelled()
    await this.host.assertScope()
    if (this.host.signal.aborted) cancelled()
  }

  private async dispatch(name: string, input: unknown, depth: number, grant: ReadonlySet<string> = this.host.allowedCapabilities, ancestors: readonly string[] = [], invocationId?: string, continuation?: PluginContinuation): Promise<ToolOutcome> {
    await this.check()
    if (ancestors.includes(name)) throw new AppError('FEATURE_UNAVAILABLE', '循环工具调用已停止，本轮助笔尚未完成目标。', { recoverable: true })
    const entry = this.visible.get(name)
    if (!entry || !entry.tool.capabilities.every(cap => this.host.allowedCapabilities.has(cap) && grant.has(cap)) || !entry.tool.isAvailable(this.host)) invalid()
    const { tool, builtin } = entry!
    this.budget.call(depth)
    try { validateValue(tool.inputSchema, input, pluginLimits.inputBytes) } catch { return invalid() }
    try {
      const context: ToolExecutionContext = {
        ...this.host, ...(invocationId ? { invocationId } : {}), allowedCapabilities: new Set(tool.capabilities), report: message => { if (message.length <= 240) this.report(message) },
        modelStep: () => this.budget.modelStep(),
        invoke: (toolName, args, childInvocationId) => this.dispatch(toolName, args, depth + 1, new Set(tool.capabilities), [...ancestors, name], childInvocationId),
        hostCall: async operation => {
          this.budget.call(depth + 1); await this.check()
          const result = await operation(); await this.check(); return result
        }
      }
      if (continuation && !tool.resume) throw new AppError('FEATURE_UNAVAILABLE', '这个工具版本不支持接续回答，原记录保留。', { recoverable: true })
      const output = continuation ? await tool.resume!(continuation.checkpoint, continuation.answer, context) : await tool.execute(input as JsonObject, context)
      await this.check()
      assertJson(output)
      const allowedKeys: Record<ToolOutcome['kind'], string[]> = { completed: ['value', 'evidence'], handoff: ['result'], 'waiting-adoption': ['candidateRef', 'evidence'], 'waiting-input': ['question', 'checkpoint'], failed: ['code', 'message'] }
      if (!Object.hasOwn(allowedKeys, output.kind) || Object.keys(output).some(key => !['kind', 'trace', ...allowedKeys[output.kind]].includes(key)) || output.trace !== undefined && (typeof output.trace !== 'string' || output.trace.length > 240)) invalid()
      switch (output.kind) {
        case 'completed': validateValue(tool.outputSchema, output.value); this.evidence(output.evidence, builtin); break
        case 'handoff':
          // Only trusted adapters may bridge to legacy UI tasks/navigation. Guest code
          // must request typed host capabilities, never forge a field task or permit.
          if (!builtin) invalid()
          output.result = decodeAssistantConversationResult(output.result)
          if (output.result.task && output.result.task.target.workItemId !== this.host.workItemId) invalid()
          break
        case 'waiting-adoption':
          if (tool.effect !== 'candidate' || !builtin) invalid()
          validateValue(objectSchema({ kind: textSchema(100, 1), id: textSchema(200, 1) }), output.candidateRef)
          this.evidence(output.evidence, builtin); break
        case 'waiting-input':
          if (tool.effect !== 'interaction' && !tool.capabilities.includes('author.ask') || !output.question || Array.isArray(output.question) || typeof output.question !== 'object' || output.checkpoint && jsonBytes(output.checkpoint) > 64 * 1024) invalid()
          if (output.question.review !== undefined && (!builtin || tool.pluginId !== 'builtin.plugins')) invalid()
          break
        case 'failed':
          if (!['unavailable', 'conflict', 'invalid'].includes(output.code) || typeof output.message !== 'string' || !output.message || output.message.length > 500) invalid()
          break
      }
      return structuredClone(output)
    } catch (error) {
      if (error instanceof AppError) throw error
      if (error instanceof PluginContractError) return invalid()
      throw new AppError('INTERNAL_ERROR', '插件工具执行失败，请重试。', { recoverable: true, cause: error })
    }
  }

  private evidence(refs: SourceRef[], builtin: boolean): void {
    validateValue(evidenceSchema, refs)
    for (const ref of refs) {
      const key = JSON.stringify([ref.kind, ref.id, ref.revision])
      if (builtin) this.issuedEvidence.add(key)
      else if (!this.issuedEvidence.has(key)) invalid()
    }
  }
}
