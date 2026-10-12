import { createHash } from 'node:crypto'
import { AppError } from '../../../../core/errors/app-error'
import type { AssistantConversationPorts } from '../../../assistant/application/assistant-conversation-service'
import type { AssistantConversationRequest, AssistantConversationResult } from '../../../../../contracts/assistant/assistant-conversation-contracts'
import { fieldSpec } from '../../../../../contracts/assistant/field-target'
import { assistantFieldCatalog } from '../../../../../contracts/assistant/assistant-field-catalog'
import { assistantWorkspaces, isAssistantWorkspaceId, assistantFieldWorkspace } from '../../../../../contracts/assistant/assistant-workspace-contracts'
import { objectSchema, textSchema } from '../../domain/schema'
import type { CapabilityTool, ToolOutcome, ToolSchema } from '../../domain/types'

export const fieldCapabilities = ['fields.read', 'fields.candidate', 'workspace.navigate', 'sample.generate', 'manuscript.handoff'] as const
export const handoff = (result: AssistantConversationResult): ToolOutcome => ({ kind: 'handoff', result })
export const builtinTool = (id: string, description: string, effect: CapabilityTool['effect'], capabilities: string[], inputSchema: ToolSchema, outputSchema: ToolSchema, execute: CapabilityTool['execute'], isAvailable: CapabilityTool['isAvailable'] = () => true): CapabilityTool => ({ pluginId: 'builtin.core', version: '1.0.0', id, description, effect, capabilities, inputSchema, outputSchema, execute, isAvailable })
const emptyOutput = objectSchema({})
const instruction = textSchema(12000, 1)
const targetProperty = { ...textSchema(200, 1), description: 'list_editable_fields 返回的 targetId，不得编造' }
const conflict = (): never => { throw new AppError('CONFLICT', '当前作品或对话已变化，请重新发送。', { recoverable: true }) }

export function fieldTools(ports: AssistantConversationPorts, input: AssistantConversationRequest): CapabilityTool[] {
  const reads = new Map<string, string>()
  const targets = new Map(input.targets.map(target => [target.instanceId, target]))
  function locate(targetId: string) {
    const target = targets.get(targetId)
    if (!target || target.workItemId !== input.workItemId) throw new AppError('AI_RESPONSE_INVALID', '模型选中的输入已不可用，请重新说明要修改的内容。', { recoverable: true })
    return target
  }
  function navigate(target: ReturnType<typeof locate>) {
    const workspace = assistantFieldWorkspace(target.fieldId) || (isAssistantWorkspaceId(target.pageId) ? target.pageId : undefined)
    return workspace && workspace !== input.page ? handoff({ kind: 'navigate', workspaceId: workspace, message: '正在定位' + target.label + '，随后继续处理。', tools: ['定位' + target.label] }) : undefined
  }
  return [
    builtinTool('list_editable_fields', '按作者要求查找可修改输入；唯一匹配项在其他页面时自动定位工作区，然后继续查找和读取。不保存内容。', 'read', ['fields.read'], objectSchema({ query: textSchema(200) }, []),
      objectSchema({ fields: { type: 'array', maxItems: 120, items: objectSchema({ targetId: textSchema(200), label: textSchema(240), group: textSchema(200), type: textSchema(30), focused: { type: 'boolean' } }) }, matches: { type: 'array', maxItems: 1000, items: objectSchema({ fieldId: textSchema(200), label: textSchema(240), loaded: { type: 'boolean' }, workspaceId: textSchema(200) }, ['fieldId', 'label', 'loaded']) }, workspaces: { type: 'array', maxItems: 100, items: objectSchema({ id: textSchema(200), label: textSchema(240) }) } }),
      async args => {
        const query = String(args.query || input.message)
        const matches = Object.entries(assistantFieldCatalog).filter(([id, spec]) => query.includes(spec.label) && (input.targets.some(target => target.fieldId === id) || Boolean(input.workItemId && assistantFieldWorkspace(id))))
        const ids = new Set(matches.map(([id]) => id))
        const listed = matches.length ? input.targets.filter(target => ids.has(target.fieldId)) : input.targets
        const destination = matches.length === 1 && !listed.length ? assistantFieldWorkspace(matches[0][0]) : undefined
        if (destination && destination !== input.page) return handoff({ kind: 'navigate', workspaceId: destination, message: '正在定位' + matches[0][1].label + '，随后继续处理。', tools: ['查找' + matches[0][1].label] })
        return { kind: 'completed', trace: '查看可编辑内容', evidence: [], value: {
          fields: listed.map(t => ({ targetId: t.instanceId, label: t.label, group: fieldSpec(t.fieldId).group, type: fieldSpec(t.fieldId).kind, focused: t.instanceId === input.focusedTargetId })),
          matches: matches.map(([id, spec]) => ({ fieldId: id, label: spec.label, loaded: input.targets.some(target => target.fieldId === id), ...(assistantFieldWorkspace(id) ? { workspaceId: assistantFieldWorkspace(id)! } : {}) })),
          workspaces: input.workItemId ? assistantWorkspaces.map(({ id, label }) => ({ id, label })) : []
        } }
      }),
    builtinTool('open_workspace', '在当前作品内打开目标工作区并继续原任务；不保存、不采用、不运行该页按钮。', 'interaction', ['workspace.navigate'], objectSchema({ workspaceId: { type: 'string', maxLength: 200, enum: assistantWorkspaces.map(item => item.id) } }), emptyOutput,
      async (args, context) => {
        context.report('正在定位目标工作区……')
        const destination = assistantWorkspaces.find(item => item.id === args.workspaceId)!
        return handoff({ kind: 'navigate', workspaceId: destination.id, message: '正在定位' + destination.label + '，随后继续处理。', tools: ['定位' + destination.label] })
      }, host => Boolean(host.workItemId)),
    builtinTool('read_field', '读取指定输入的当前草稿、约束与已保存的相关背景。value、constraints、options 为 JSON 编码的数据。', 'read', ['fields.read'], objectSchema({ targetId: targetProperty }),
      objectSchema({ label: textSchema(240), value: textSchema(110000), constraints: textSchema(20000), options: textSchema(110000), context: textSchema(100000) }),
      async (args, context) => {
        const target = locate(String(args.targetId)), destination = navigate(target)
        if (destination) return destination
        const background = await context.hostCall(() => ports.context(target))
        reads.set(target.instanceId, background)
        return { kind: 'completed', trace: '读取' + target.label, evidence: [{ kind: 'field-draft', id: target.instanceId, revision: createHash('sha256').update(JSON.stringify({ target, background })).digest('hex') }], value: { label: target.label, value: JSON.stringify(target.value), constraints: JSON.stringify(fieldSpec(target.fieldId)), options: JSON.stringify(target.options ?? []), context: background } }
      }),
    builtinTool('edit_field', '为明确的一项输入生成修改候选。必须先 read_field；只改此项，不保存正式内容。作者可比较、应用和撤销。', 'candidate', ['fields.read', 'fields.candidate'], objectSchema({ targetId: targetProperty, instruction }), objectSchema({ error: textSchema(500) }),
      async (args, context) => {
        const target = locate(String(args.targetId)), destination = navigate(target)
        if (destination) return destination
        if (!String(args.instruction).trim()) throw new AppError('AI_RESPONSE_INVALID', '修改要求不能为空。', { recoverable: true })
        if (!reads.has(target.instanceId)) return { kind: 'completed', evidence: [], value: { error: '请先调用 read_field 读取当前输入，然后再 edit_field。' } }
        if (await context.hostCall(() => ports.context(target)) !== reads.get(target.instanceId)) conflict()
        // Creation needs its own cancellation cleanup: hostCall's late-result guard
        // must not hide the task ID before the adapter can stop it.
        const task = await context.hostCall(async () => {
          const task = await ports.startField({ operationId: context.invocationId ?? input.operationId, target, instruction: String(args.instruction), ...(input.model ? { model: input.model } : {}), ...(input.connectionId ? { connectionId: input.connectionId } : {}), ...(input.maxTokensOverride === undefined ? {} : { maxTokensOverride: input.maxTokensOverride }) })
          if (context.signal.aborted) { await ports.cancelField(task); conflict() }
          return task
        })
        return handoff({ kind: 'field', message: '正在为“' + target.label + '”准备修改建议。', task, tools: ['准备修改' + target.label] })
      }),
    builtinTool('write_sample', '为当前已确认章节生成或续写对话样稿；须作者确认当前总纲、对应卷纲和章纲，不修改字段、不写入作品。', 'derive', ['sample.generate'], objectSchema({ instruction }), emptyOutput,
      async (args, context) => {
        if (!String(args.instruction).trim()) throw new AppError('AI_RESPONSE_INVALID', '试写要求不能为空。', { recoverable: true })
        context.report('正在生成试写正文……')
        const content = await context.hostCall(() => ports.draftSample!(input, String(args.instruction), context.signal, context.report))
        return handoff({ kind: 'message', message: '试写样稿 · 未写入正文\n\n' + content, tools: ['生成对话样稿'] })
      }, host => Boolean(host.workItemId && ports.draftSample)),
    builtinTool('manuscript_assistant', '把正文续写、选段修改、审校、章卡讨论或依据全书事实回答的问题交给现有正文助笔。不要用于表单字段。', 'interaction', ['manuscript.handoff'], objectSchema({ instruction }), emptyOutput,
      async args => {
        if (!String(args.instruction).trim()) throw new AppError('AI_RESPONSE_INVALID', '正文要求不能为空。', { recoverable: true })
        if (!input.chapterId || input.page !== 'chapters') return handoff({ kind: 'navigate', workspaceId: 'chapters', message: '正在定位书稿章节，随后继续处理。', tools: ['定位章节目录与正文'] })
        return handoff({ kind: 'prose', message: '我会结合当前正文和写作依据处理。', instruction: String(args.instruction), tools: ['交给正文助笔'] })
      }, host => Boolean(host.workItemId))
  ]
}
