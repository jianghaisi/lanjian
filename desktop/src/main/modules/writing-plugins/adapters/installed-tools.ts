import { declarativeSource } from '../runtime/declarative-source'
import { supportedPluginCapabilities } from '../../../../contracts/writing-plugins/management-contracts'
import { createHash } from 'node:crypto'
import { assertJson, validateValue, codePluginLimits, pluginLimits, type JsonObject, type JsonValue, type SourceRef, type PluginComposition, type WritingStage } from '@lanjian/writing-plugin-contracts'
import { materializeContributionTools } from './contribution-adapters'
import { AppError } from '../../../core/errors/app-error'
import { decodeAuthorQuestionRequest } from '../../../../contracts/assistant/author-interaction-contracts'
import type { GuestBroker, GuestRunner } from '../domain/guest'
import type { PluginContinuation, PluginEffectJournal, PluginVersionPin } from '../domain/plugin-run'
import type { ToolExecutionContext, ToolOutcome } from '../domain/types'
import type { WritingPluginManager } from '../application/plugin-manager'
import { modelToolName, type WritingPluginRegistry } from '../application/registry'

export const installedPluginCapabilities = supportedPluginCapabilities
export type InstalledToolPorts = {
  manager: WritingPluginManager
  runner: GuestRunner
  /** Capture the current book's async context before utility-process callbacks. */
  scope<T>(operation: () => Promise<T>): Promise<T>
  generate(instruction: string, draft: string | undefined, signal: AbortSignal, stage?: WritingStage): Promise<string>
}
const invalid = (): never => { throw new AppError('VALIDATION_ERROR', '插件 SDK 请求不符合契约。', { recoverable: true }) }
const conflict = (): never => { throw new AppError('CONFLICT', '插件版本或授权已变化，本次执行不能继续。', { recoverable: true }) }
function object(value: JsonValue, keys: string[]): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) return invalid()
  return value
}
function text(value: JsonValue | undefined, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) return invalid()
  return value
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Only main constructs these adapters. Guest output never defines authority or evidence. */
export async function registerInstalledTools(registry: WritingPluginRegistry, bookId: string, pins: PluginVersionPin[], journal: PluginEffectJournal, ports: InstalledToolPorts, composition?: PluginComposition): Promise<void> {
  for (const pin of pins) {
    // Verify installed bytes now, but retain metadata only while a run waits for its author.
    const { version } = await ports.manager.loadAuthorized(bookId, pin.id, pin.digest)
    if (version.manifest.version !== pin.version || pin.grants.some(c => !version.grants.includes(c))) conflict()
    const manifest = version.manifest
    for (const { tool, params, guestToolId, recipe } of materializeContributionTools(manifest, pin.digest, composition)) {
      const contribution = manifest.contributions?.find(c => tool.id === `contribution__${c.id}`)
      const stage = contribution?.kind === 'checker' && contribution.stages.includes('review') ? 'review' : contribution?.stages[0] ?? 'assistant'
      if (tool.capabilities.some(cap => !pin.grants.includes(cap) || !installedPluginCapabilities.includes(cap as typeof installedPluginCapabilities[number]))) continue
      const run = async (input: JsonObject, host: ToolExecutionContext, continuation?: PluginContinuation): Promise<ToolOutcome> => {
        if (!host.invocationId || host.workItemId !== bookId) return conflict()
        const { files } = await ports.manager.loadAuthorized(bookId, pin.id, pin.digest)
        const entry = new TextDecoder('utf-8', { fatal: true }).decode(files.get(manifest.entry))
        const source = recipe ? declarativeSource(JSON.stringify(recipe), { ...manifest, runtime: 'declarative', tools: [{ ...tool, id: guestToolId }] }) : manifest.runtime === 'declarative' ? declarativeSource(entry, manifest) : entry
        const configuredInput = { ...input, ...params }
        if (!continuation) validateValue(tool.inputSchema, configuredInput, pluginLimits.inputBytes)
        const evidence: SourceRef[] = []
        let waiting: Extract<ToolOutcome, { kind: 'waiting-input' }> | undefined
        const check = async (signal: AbortSignal, caps: string[] = []) => {
          host.signal.throwIfAborted(); signal.throwIfAborted(); await host.assertScope()
          const current = await ports.manager.authorize(bookId, pin.id, pin.digest)
          if (current.manifest.version !== pin.version || pin.grants.some(c => !current.grants.includes(c)) || caps.some(cap => !tool.capabilities.includes(cap) || !pin.grants.includes(cap) || !host.allowedCapabilities.has(cap))) conflict()
          host.signal.throwIfAborted(); signal.throwIfAborted()
        }
        const invoke = async (id: string, args: JsonObject, operationId?: string): Promise<JsonValue> => {
          const result = await host.invoke(modelToolName('builtin.core', id), args, operationId)
          if (result.kind !== 'completed') throw new AppError('FEATURE_UNAVAILABLE', '领域工具没有返回可核对的执行回执。', { recoverable: true })
          for (const ref of result.evidence) if (!evidence.some(e => JSON.stringify(e) === JSON.stringify(ref))) evidence.push(ref)
          return result.value
        }
        const broker: GuestBroker = (method, raw, signal) => ports.scope(() => host.hostCall(async () => {
          await check(signal)
          if (waiting) return invalid()
          let result: JsonValue
          switch (method) {
            case 'book.read': {
              const args = object(raw, ['kind', 'key', 'chapterId', 'offset'])
              if (args.kind === 'context') { object(raw, ['kind']); await check(signal, ['book.read']); result = await invoke('read_book_context', {}) }
              else if (args.kind === 'materials') { object(raw, ['kind', 'offset']); await check(signal, ['book.read']); result = await invoke('read_materials', args.offset === undefined ? {} : { offset: args.offset }) }
              else if (args.kind === 'outline') { object(raw, ['kind', 'key']); await check(signal, ['planning.read']); result = await invoke('read_planning_outline', { key: args.key! }) }
              else if (args.kind === 'manuscript') { object(raw, ['kind', 'chapterId']); await check(signal, ['manuscript.read']); result = await invoke('read_manuscript', { chapterId: args.chapterId! }) }
              else return invalid()
              break
            }
            case 'model.generate': {
              const args = object(raw, ['instruction', 'draft'])
              const instruction = text(args.instruction, 12000), draft = args.draft === undefined ? undefined : text(args.draft, 100000)
              await check(signal, ['model.generate']); host.modelStep()
              result = { text: await ports.generate(instruction, draft, signal, stage), notice: '模型建议，未生成领域候选，也未写入正式内容。' }
              break
            }
            case 'candidate.prepare': {
              const args = object(raw, ['kind', 'key', 'input']), key = text(args.key, 100)
              if (!/^[a-zA-Z0-9_-]+$/.test(key)) return invalid()
              const input = object(args.input!, ['parentKey', 'expectedRevision', 'count', 'instruction', 'chapterId'])
              const mapping = args.kind === 'planning' ? { id: 'generate_planning', caps: ['planning.candidate'] } : args.kind === 'expand' ? { id: 'expand_outline', caps: ['planning.read', 'planning.candidate'] } : args.kind === 'manuscript' ? { id: 'generate_manuscript', caps: ['manuscript.read', 'manuscript.candidate'] } : invalid()
              if (tool.effect !== 'candidate') return invalid()
              await check(signal, mapping.caps)
              const effectKey = hash([pin.id, pin.digest, host.invocationId, key])
              const operationId = `${effectKey.slice(0,8)}-${effectKey.slice(8,12)}-4${effectKey.slice(13,16)}-a${effectKey.slice(17,20)}-${effectKey.slice(20,32)}`
              result = await journal.once(effectKey, raw, async () => {
                // Rebuild read caches after a fresh VM/session, still requiring the guest's original revision.
                if (args.kind === 'expand') await invoke('read_planning_outline', { key: input.parentKey! })
                if (args.kind === 'manuscript') await invoke('read_manuscript', { chapterId: input.chapterId! })
                await check(signal, mapping.caps)
                return invoke(mapping.id, input, operationId)
              })
              break
            }
            case 'interaction.request': {
              const args = object(raw, ['question', 'checkpoint'])
              await check(signal, ['author.ask'])
              const checkpoint = object(args.checkpoint!, Object.keys(args.checkpoint ?? {}))
              assertJson(checkpoint, codePluginLimits.checkpointBytes)
              const question = decodeAuthorQuestionRequest(args.question)
              waiting = { kind: 'waiting-input', question: question as unknown as JsonObject, checkpoint: structuredClone(checkpoint) }
              result = { waiting: true }; break
            }
            case 'assets.readText': {
              const args = object(raw, ['path']), path = text(args.path, 240)
              await check(signal, ['assets.read'])
              if (!manifest.assets?.includes(path) || !files.has(path)) return invalid()
              const bytes = files.get(path)!
              if (bytes.byteLength > pluginLimits.outputBytes) return invalid()
              result = { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }; break
            }
            default: return invalid()
          }
          await check(signal); assertJson(result, pluginLimits.outputBytes); return result
        }))
        await check(host.signal)
        const result = await ports.runner.run({ invocationId: host.invocationId, source, toolId: guestToolId, input: configuredInput, ...(continuation ? { continuation } : {}) }, broker, host.signal)
        await check(host.signal)
        if (!result.ok) throw new AppError('FEATURE_UNAVAILABLE', `插件执行未完成（${result.code}），已有记录保留。`, { recoverable: true })
        return waiting ?? { kind: 'completed', value: result.value, evidence }
      }
      const inputSchema = tool.inputSchema.type === 'object' ? { ...tool.inputSchema, properties: Object.fromEntries(Object.entries(tool.inputSchema.properties).filter(([key]) => !Object.hasOwn(params, key))), ...(tool.inputSchema.required ? { required: tool.inputSchema.required.filter(key => !Object.hasOwn(params, key)) } : {}) } : tool.inputSchema
      registry.register({ ...tool, inputSchema, pluginId: pin.id, version: pin.version, packageDigest: pin.digest,
        isAvailable: host => host.workItemId === bookId,
        execute: (input, host) => run(input, host), resume: (checkpoint, answer, host) => run({}, host, { checkpoint, answer }) })
    }
  }
}
