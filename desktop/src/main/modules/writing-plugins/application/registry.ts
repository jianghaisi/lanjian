import { createHash } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import { jsonBytes, validateSchema } from '../domain/schema'
import { pluginLimits } from '../domain/limits'
import type { CapabilityTool, ToolHostContext } from '../domain/types'
import type { AiFunctionTool } from '../../../../contracts/assistant/assistant-conversation-contracts'

export const builtinToolAliases = new Set(['list_editable_fields', 'read_field', 'edit_field', 'open_workspace', 'manuscript_assistant', 'write_sample'])
export type RegisteredTool = { readonly name: string; readonly builtin: boolean; readonly tool: CapabilityTool }
const invalid = (): never => { throw new AppError('VALIDATION_ERROR', '插件工具登记无效或名称冲突。', { recoverable: true }) }

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value) }
  return value
}
export function modelToolName(pluginId: string, id: string): string {
  const identity = `${pluginId}/${id}`
  return `p_${identity.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 42)}_${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`
}

export class WritingPluginRegistry {
  private readonly entries = new Map<string, RegisteredTool>()
  private readonly identities = new Set<string>()

  register(tool: CapabilityTool, origin: 'builtin' | 'plugin' = 'plugin'): void {
    if (typeof tool.pluginId !== 'string' || typeof tool.id !== 'string' || typeof tool.version !== 'string' || !/^[a-z][a-z0-9.-]{0,127}$/.test(tool.pluginId) || !/^[a-z][a-z0-9_-]{0,127}$/.test(tool.id) || !/^\d+\.\d+\.\d+$/.test(tool.version)) invalid()
    if (origin !== 'builtin' && tool.pluginId.startsWith('builtin.')) invalid()
    if (typeof tool.description !== 'string' || !tool.description.trim() || tool.description.length > 2000 || !['read', 'derive', 'candidate', 'interaction'].includes(tool.effect)) invalid()
    if (!Array.isArray(tool.capabilities) || tool.capabilities.length > 16 || new Set(tool.capabilities).size !== tool.capabilities.length || tool.capabilities.some(cap => !/^[a-z][a-z0-9.-]{0,127}$/.test(cap))) invalid()
    if (typeof tool.execute !== 'function' || typeof tool.isAvailable !== 'function') invalid()
    if (tool.resume !== undefined && typeof tool.resume !== 'function' || tool.packageDigest !== undefined && !/^[a-f0-9]{64}$/.test(tool.packageDigest)) invalid()
    const identity = `${tool.pluginId}/${tool.id}`
    const name = origin === 'builtin' && tool.pluginId === 'builtin.core' && builtinToolAliases.has(tool.id) ? tool.id : modelToolName(tool.pluginId, tool.id)
    if (this.entries.has(name) || this.identities.has(identity) || name === 'discover_tools') invalid()
    const frozen = freeze({ ...tool, capabilities: [...tool.capabilities], inputSchema: validateSchema(tool.inputSchema), outputSchema: validateSchema(tool.outputSchema) })
    this.identities.add(identity)
    this.entries.set(name, Object.freeze({ name, builtin: origin === 'builtin', tool: frozen }))
  }

  /** A run receives a snapshot. Subsequent registry changes cannot change its tools. */
  snapshot(host: ToolHostContext): RegisteredTool[] {
    return [...this.entries.values()].filter(({ tool }) => tool.capabilities.every(cap => host.allowedCapabilities.has(cap)) && tool.isAvailable(host))
  }
}

export function functionDefinitions(entries: readonly RegisteredTool[]): AiFunctionTool[] {
  const result: AiFunctionTool[] = entries.map(({ name, tool }) => ({ type: 'function', function: { name, description: tool.description, parameters: structuredClone(tool.inputSchema) as Record<string, unknown> } }))
  if (result.length > pluginLimits.modelTools || jsonBytes(result) > pluginLimits.modelSchemaBytes) throw new AppError('VALIDATION_ERROR', '本次可用工具超过模型容量，请缩小工具选择范围。', { recoverable: true })
  return result
}
