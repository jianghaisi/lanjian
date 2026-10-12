import { resolve } from 'node:path'
import { AppError } from '../../../core/errors/app-error'
import type { WritingAgentSkillId, WritingAgentToolId } from '../../../../contracts/index'

export type AgentToolId = WritingAgentToolId | 'compileContextSources' | 'candidateDiff'
export type AgentToolScope = 'current-project' | 'current-chapter' | 'frozen-draft'
export type AgentToolResultRoot = 'object' | 'array'

export type AgentToolDescriptor = {
  id: AgentToolId
  label: string
  access: 'read' | 'derive'
  scope: AgentToolScope
  timeoutMs: number
  sideEffect: 'none'
  modelCallable: false
  inputSchema: {
    type: 'object'
    additionalProperties: false
    required: readonly ['workItemId', 'workItemPath', 'chapterId']
    properties: {
      workItemId: { type: 'string'; minLength: number }
      workItemPath: { type: 'string'; minLength: number }
      chapterId: { type: 'integer'; minimum: number }
    }
  }
  outputSchema: { type: AgentToolResultRoot }
}

export type AgentToolScopeInput = {
  workItemId: string
  workItemPath: string
  chapterId: number
}

export type WritingAgentToolGrant = AgentToolScopeInput & {
  version: 1
  taskTemplate: `writing-agent:${WritingAgentSkillId}`
  skill: WritingAgentSkillId
  allowedToolIds: AgentToolId[]
}

const inputSchema = {
  type: 'object' as const,
  additionalProperties: false as const,
  required: ['workItemId', 'workItemPath', 'chapterId'] as const,
  properties: {
    workItemId: { type: 'string' as const, minLength: 1 },
    workItemPath: { type: 'string' as const, minLength: 1 },
    chapterId: { type: 'integer' as const, minimum: 1 }
  }
}

const longFormContextCompileTimeoutMs = 60_000

const definitions: Record<AgentToolId, AgentToolDescriptor> = {
  compileContextSources: descriptor('compileContextSources', '编译上下文来源', 'read', 'current-chapter', 'array', longFormContextCompileTimeoutMs),
  currentChapter: descriptor('currentChapter', '当前正文', 'read', 'current-chapter', 'object', 5_000),
  chapterContract: descriptor('chapterContract', '章纲契约', 'read', 'current-chapter', 'object', 10_000),
  contextFacts: descriptor('contextFacts', '关联前文', 'read', 'current-chapter', 'object', 15_000),
  consistencyGate: descriptor('consistencyGate', '一致性门禁', 'read', 'current-chapter', 'object', 15_000),
  candidateDiff: descriptor('candidateDiff', '生成候选差异', 'derive', 'frozen-draft', 'array', 5_000)
}

const writingSkills = new Set<WritingAgentSkillId>(['continue', 'rewrite', 'expand', 'compress', 'custom', 'polish'])
const readTools: AgentToolId[] = ['compileContextSources', 'currentChapter', 'chapterContract', 'contextFacts', 'consistencyGate']

/**
 * Fixed MVP registry. The model never receives a function-calling surface: the
 * harness selects one immutable task template, and only application code may
 * execute the tools granted here. Every registered tool is side-effect free;
 * applying an Artifact remains a separate author Approval Gate operation.
 */
export class AgentToolRegistry {
  constructor(private readonly timeoutOverrides: Partial<Record<AgentToolId, number>> = {}) {}

  list(): AgentToolDescriptor[] {
    return Object.values(definitions).map((item) => ({
      ...item,
      timeoutMs: this.timeoutOverrides[item.id] ?? item.timeoutMs,
      inputSchema: structuredClone(item.inputSchema),
      outputSchema: structuredClone(item.outputSchema)
    }))
  }

  grant(input: AgentToolScopeInput & { skill: WritingAgentSkillId }): WritingAgentToolGrant {
    assertScopeInput(input)
    return {
      version: 1,
      taskTemplate: `writing-agent:${input.skill}`,
      skill: input.skill,
      workItemId: input.workItemId,
      workItemPath: resolve(input.workItemPath),
      chapterId: input.chapterId,
      allowedToolIds: [...readTools, ...(writingSkills.has(input.skill) ? ['candidateDiff' as const] : [])]
    }
  }

  assertGrant(grant: WritingAgentToolGrant, scope: AgentToolScopeInput): void {
    assertScopeInput(scope)
    if (grant.version !== 1 || grant.taskTemplate !== `writing-agent:${grant.skill}`) {
      throw new AppError('DATABASE_INTEGRITY_FAILED', 'AI 工具授权记录损坏，已停止任务。', { recoverable: false })
    }
    if (grant.workItemId !== scope.workItemId || resolve(grant.workItemPath) !== resolve(scope.workItemPath) || grant.chapterId !== scope.chapterId) {
      throw new AppError('CONFLICT', 'AI 工具只能读取发起任务时的当前作品和章节。', { recoverable: true })
    }
    const expected = this.grant({ ...scope, skill: grant.skill }).allowedToolIds
    if (grant.allowedToolIds.length !== expected.length || grant.allowedToolIds.some((id, index) => id !== expected[index])) {
      throw new AppError('DATABASE_INTEGRITY_FAILED', 'AI 工具授权超出固定任务目录，已停止任务。', { recoverable: false })
    }
  }

  async execute<T>(grant: WritingAgentToolGrant, toolId: AgentToolId, scope: AgentToolScopeInput, operation: (signal: AbortSignal) => Promise<T> | T, taskSignal?: AbortSignal): Promise<T> {
    this.assertGrant(grant, scope)
    if (!grant.allowedToolIds.includes(toolId)) {
      throw new AppError('VALIDATION_ERROR', `当前任务不允许使用工具：${toolId}。`, { recoverable: true })
    }
    const definition = definitions[toolId]
    const timeoutMs = this.timeoutOverrides[toolId] ?? definition.timeoutMs
    taskSignal?.throwIfAborted()
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let stop: (() => void) | undefined
    try {
      const output = await Promise.race([
        Promise.resolve().then(() => {
          controller.signal.throwIfAborted()
          return operation(controller.signal)
        }),
        new Promise<never>((_resolve, reject) => {
          stop = () => {
            reject(taskSignal?.reason)
            controller.abort(taskSignal?.reason)
          }
          taskSignal?.addEventListener('abort', stop, { once: true })
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new AppError('FEATURE_UNAVAILABLE', `${definition.label}读取超时，请重试。`, { recoverable: true }))
            controller.abort()
          }, timeoutMs)
        })
      ])
      assertOutputRoot(output, definition.outputSchema.type, definition.label)
      return output
    } finally {
      if (timer) clearTimeout(timer)
      if (stop) taskSignal?.removeEventListener('abort', stop)
    }
  }
}

function descriptor(
  id: AgentToolId,
  label: string,
  access: AgentToolDescriptor['access'],
  scope: AgentToolScope,
  outputRoot: AgentToolResultRoot,
  timeoutMs: number
): AgentToolDescriptor {
  return {
    id,
    label,
    access,
    scope,
    timeoutMs,
    sideEffect: 'none',
    modelCallable: false,
    inputSchema,
    outputSchema: { type: outputRoot }
  }
}

function assertScopeInput(input: AgentToolScopeInput): void {
  if (!input.workItemId.trim() || !input.workItemPath.trim() || !Number.isSafeInteger(input.chapterId) || input.chapterId < 1) {
    throw new AppError('VALIDATION_ERROR', 'AI 工具作用域必须绑定有效作品和章节。', { recoverable: true })
  }
}

function assertOutputRoot(value: unknown, expected: AgentToolResultRoot, label: string): void {
  const valid = expected === 'array'
    ? Array.isArray(value)
    : Boolean(value && typeof value === 'object' && !Array.isArray(value))
  if (!valid) throw new AppError('DATABASE_INTEGRITY_FAILED', `${label}返回了不符合登记结构的数据。`, { recoverable: false })
}
