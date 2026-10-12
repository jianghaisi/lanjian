import { createHash } from 'node:crypto'
import { AppError } from '../../../../core/errors/app-error'
import { decodeAuthorQuestionRequest, decodeAuthorAnswers, validateAuthorAnswers, type AuthorActionReview } from '../../../../../contracts/assistant/author-interaction-contracts'
import { objectSchema, textSchema, validateValue, assertJson } from '../../domain/schema'
import type { CapabilityTool, JsonObject, JsonValue, ToolExecutionContext, ToolOutcome, ToolSchema } from '../../domain/types'
import type { PluginEffectJournal } from '../../domain/plugin-run'
import type { PluginAuthoringService } from '../../application/authoring-service'
import type { PluginMarketplaceService } from '../../application/marketplace-service'
import type { PluginCompositionService } from '../../application/composition-service'
import type { WritingPluginManager } from '../../application/plugin-manager'
import type { BundledPluginService } from '../../application/bundled-service'

export const pluginWorkbenchCapabilities = ['plugins.read', 'plugins.drafts', 'plugins.manage'] as const
export type PluginWorkbenchServices = {
  authoring: PluginAuthoringService
  market: PluginMarketplaceService
  manager: WritingPluginManager
  composition: PluginCompositionService
  bundled: BundledPluginService
  choosePackage(): Promise<string | null>
}
export type PluginToolFactory = (journal: PluginEffectJournal) => CapabilityTool[]
export const revisionSchema = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } satisfies ToolSchema
export const idSchema = textSchema(128, 1)
export const digestSchema = textSchema(64, 64)
export const refSchema = objectSchema({ id: textSchema(36, 36), revision: { ...revisionSchema, minimum: 1 } })
export const outputSchema = objectSchema({ data: textSchema(180000) })
export const invalid = (): never => { throw new AppError('VALIDATION_ERROR', '插件工具参数无效，请核对真实插件标识、版本和草稿。', { recoverable: true }) }
export const conflict = (): never => { throw new AppError('CONFLICT', '插件状态或操作预览已经变化，请重新读取并确认。', { recoverable: true }) }
export function jsonObject(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  assertJson(value)
  return value as JsonObject
}
export function parseObject(value: string): JsonObject {
  try { return jsonObject(JSON.parse(value)) } catch { return invalid() }
}
export function result(value: unknown): ToolOutcome {
  const data = JSON.stringify(value)
  if (!data || data.length > 180000) throw new AppError('FEATURE_UNAVAILABLE', '插件资料超过单次读取上限，请缩小查询或分段读取文件。', { recoverable: true })
  return { kind: 'completed', evidence: [], value: { data } }
}
export const pretty = (value: unknown) => JSON.stringify(value, null, 2)
export function pluginTool(id: string, description: string, effect: CapabilityTool['effect'], capability: typeof pluginWorkbenchCapabilities[number], inputSchema: ToolSchema, execute: CapabilityTool['execute']): CapabilityTool {
  return { pluginId: 'builtin.plugins', version: '1.0.0', id, description, effect, capabilities: [capability], inputSchema, outputSchema, isAvailable: host => Boolean(host.workItemId), execute }
}
export async function once(journal: PluginEffectJournal, id: string, args: JsonObject, host: ToolExecutionContext, operation: () => Promise<JsonValue>): Promise<JsonValue> {
  if (!host.invocationId) return conflict()
  const key = createHash('sha256').update(JSON.stringify(['plugin-workbench', id, host.workItemId, host.invocationId])).digest('hex')
  return host.hostCall(() => journal.once(key, args, operation))
}
const checkpointSchema = objectSchema({ toolId: idSchema, bookId: textSchema(32767, 1), argumentsJson: textSchema(60000, 1), preparedJson: textSchema(30000, 1), expires: { type: 'integer', minimum: 0 } })
const confirmation = {
  questions: [{ id: 'decision', prompt: '是否执行上面核对的插件操作？', mode: 'single' as const, required: true,
    options: [{ id: 'confirm', label: '确认执行' }, { id: 'cancel', label: '取消这项操作' }] }]
}

/** Model arguments cannot contain approval or a host plan token. Only this
 * invocation's persisted author answer resumes the exact prepared operation. */
export function confirmedTool(id: string, description: string, inputSchema: ToolSchema, journal: PluginEffectJournal,
  prepare: (args: JsonObject, host: ToolExecutionContext) => Promise<{ prepared: JsonObject; review: AuthorActionReview } | ToolOutcome>,
  apply: (args: JsonObject, prepared: JsonObject, host: ToolExecutionContext) => Promise<JsonValue>): CapabilityTool {
  const tool = pluginTool(id, description, 'interaction', 'plugins.manage', inputSchema, async (args, host) => {
    const proposal = await host.hostCall(() => prepare(args, host))
    if ('kind' in proposal) return proposal
    const checkpoint = { toolId: id, bookId: host.workItemId!, argumentsJson: JSON.stringify(args), preparedJson: JSON.stringify(proposal.prepared), expires: Date.now() + 10 * 60_000 }
    validateValue(checkpointSchema, checkpoint, 64 * 1024)
    const question = decodeAuthorQuestionRequest({ ...confirmation, review: proposal.review })
    return { kind: 'waiting-input', question: question as unknown as JsonObject, checkpoint }
  })
  tool.capabilities.push('author.ask')
  tool.resume = async (checkpoint, answer, host) => {
    validateValue(checkpointSchema, checkpoint, 64 * 1024)
    if (checkpoint.toolId !== id || checkpoint.bookId !== host.workItemId || Number(checkpoint.expires) <= Date.now()) return conflict()
    const answers = decodeAuthorAnswers(jsonObject(answer).answers)
    // The run service already validates and persists the answer. Revalidate the
    // affirmative form here; free text, a recommendation or another question is never consent.
    validateAuthorAnswers(confirmation, answers)
    const chosen = answers[0]!
    if (chosen.skipped || chosen.customText || chosen.chosenOptionIds.length !== 1 || chosen.chosenOptionIds[0] !== 'confirm') return result({ status: 'cancelled', notice: '没有执行这项插件操作。' })
    const args = parseObject(String(checkpoint.argumentsJson)), prepared = parseObject(String(checkpoint.preparedJson))
    validateValue(inputSchema, args)
    return result(await once(journal, id, { args, prepared }, host, () => apply(args, prepared, host)))
  }
  return tool
}
