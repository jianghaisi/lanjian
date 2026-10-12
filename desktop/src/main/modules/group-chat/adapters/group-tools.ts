import { groupInspirationTools, type GroupInspirationPort } from './group-inspiration-tools'
import { randomUUID } from 'node:crypto'
import { AppError } from '../../../core/errors/app-error'
import { memberId, decodePreparationDomainDraft, type PreparationKind } from '../../../../contracts/group-chat/group-chat'
import { WritingPluginRegistry } from '../../writing-plugins/application/registry'
import { ToolLimitError } from '../../writing-plugins/application/dispatcher'
import { builtinTool } from '../../writing-plugins/adapters/builtin/fields'
import { objectSchema, textSchema } from '../../writing-plugins/domain/schema'
import { authorInteractionTools } from '../../writing-plugins/adapters/builtin/author-interaction'
import { bookContextTools } from '../../writing-plugins/adapters/builtin/book-context'
import { planningTools } from '../../writing-plugins/adapters/builtin/planning'
import { manuscriptTools, type ManuscriptReads } from '../../writing-plugins/adapters/builtin/manuscript'
import { reviewTools } from '../../writing-plugins/adapters/builtin/review'
import type { WritingDomainPorts } from '../../writing-plugins/adapters/builtin/domain-ports'
import type { GroupSession, GroupWork } from '../domain/session'
import type { AssistantConversationRequest } from '../../../../contracts/assistant/assistant-conversation-contracts'
import { groupResearchTools, type GroupResearchPort } from './group-research-tools'

export function createGroupTools(s: GroupSession, work: GroupWork, domains?: WritingDomainPorts, onlineResearch?: GroupResearchPort, inspiration?: GroupInspirationPort, ownJob?: (job: GroupSession['jobs'][number]) => void): WritingPluginRegistry {
  const member = s.view.team.members.find(member => member.id === work.memberId)
  if (!member) throw new AppError('CONFLICT', '该成员不属于原讨论团队。', { recoverable: true })
  const kinds = member.preparationKinds, capabilities = new Set(member.capabilities)
  const registry = new WritingPluginRegistry()
  const register = (tool: ReturnType<typeof builtinTool>) => {
    if (tool.capabilities.some(capability => !capabilities.has(capability))) return
    const kind = ({ generate_planning: 'planning', expand_outline: 'expansion', generate_manuscript: 'writing' } as const)[tool.id]
    registry.register(!kind ? tool : { ...tool, async execute(args, host) {
      const result = await tool.execute(args, host)
      if (result.kind === 'completed' && result.value && typeof result.value === 'object' && !Array.isArray(result.value) && typeof result.value.taskId === 'string') { const id = result.value.taskId; ownJob?.({ kind, id }); if (!s.jobs.some(j => j.id === id)) s.jobs.push({ kind, id }) }
      return result
    } }, 'builtin')
  }
  register(builtinTool('read_preparation', '读取本群保存的筹备候选及关联作品。候选只是讨论资料，未经作者采用不构成正式事实。', 'read', ['group.prepare'], objectSchema({}), objectSchema({ bookTitle: textSchema(2000), candidates: { type: 'array', maxItems: 100, items: objectSchema({ id: textSchema(100), kind: textSchema(30), title: textSchema(200), content: textSchema(100000), status: textSchema(30) }) } }), async () => ({ kind: 'completed', evidence: [], value: { bookTitle: s.view.book?.title ?? '', candidates: s.view.candidates.map(({ id, kind, title, content, status }) => ({ id, kind, title, content, status })) } })))
  if (kinds.length) register(builtinTool('save_preparation_candidate', '保存本成员职责范围内的一份筹备候选，供作者核对与后续成员使用。不是正式设定采用；可以多次保存新版本。', 'candidate', ['group.prepare'], objectSchema({ kind: { type: 'string', enum: kinds, maxLength: 20 }, title: textSchema(200, 1), content: textSchema(100000, 1) }), objectSchema({ candidateId: textSchema(100), notice: textSchema(200) }), async args => {
    if (!kinds.includes(String(args.kind))) throw new AppError('CONFLICT', '该候选类型不在原成员职责范围内。', { recoverable: true })
    if (s.view.candidates.length >= 100) throw new AppError('FEATURE_UNAVAILABLE', '筹备候选数量已达上限，请先核对已有成果。', { recoverable: true })
    const id = randomUUID(); s.view.candidates.push({ id, kind: args.kind as PreparationKind, title: String(args.title), content: String(args.content), memberId: work.memberId, status: 'proposed', createdAt: new Date().toISOString() })
    return { kind: 'completed', evidence: [], trace: `保存${String(args.title)}筹备候选`, value: { candidateId: id, notice: '已保存筹备候选，正式内容尚未变化。' } }
  }))
  register(builtinTool('delegate_to_member', `把一个明确子目标交给其他小说成员，结构化加入同一受预算约束的队列。成员：${s.view.team.members.map(m => `${m.id}=${m.name}`).join('；')}。交接不是完成声明。`, 'interaction', ['group.delegate'], objectSchema({ memberId: { type: 'string', enum: s.view.team.members.map(m => m.id), maxLength: 64 }, instruction: textSchema(12000, 1) }), objectSchema({ queued: { type: 'boolean' }, member: textSchema(100) }), async args => {
    const target = memberId(args.memberId, s.view.team.members)
    if (target === work.memberId) throw new AppError('AI_RESPONSE_INVALID', '成员不能向自己循环交接。', { recoverable: true })
    if (work.depth >= 4 || s.handoffs >= 24 || s.queue.length >= 24) throw new ToolLimitError()
    s.handoffs++; s.queue.push({ id: randomUUID(), memberId: target, instruction: String(args.instruction), depth: work.depth + 1 })
    const member = s.view.team.members.find(m => m.id === target)!.name
    return { kind: 'completed', trace: `交给${member}`, evidence: [], value: { queued: true, member } }
  }))
  if (!s.view.book) register(builtinTool('request_book_creation', '请求作者在群聊核对书名和保存位置并创建真实作品。只能请求，作者尚未确认时不能宣称作品已创建。', 'interaction', ['group.create'], objectSchema({ title: textSchema(200, 1), summary: textSchema(2000, 1) }), objectSchema({ requested: { type: 'boolean' } }), async args => {
    s.view.creation ??= { id: randomUUID(), suggestedTitle: String(args.title), summary: String(args.summary) }
    return { kind: 'completed', trace: '等待作者核对建书信息', evidence: [], value: { requested: true } }
  }))
  const ask = authorInteractionTools()[0]; register({ ...ask, isAvailable: () => true })
  if (kinds.includes('characters')) register(builtinTool('save_character_candidate', '整理一位人物的动机、声音和关系，保存结构化筹备候选。作者建书后可核对采用到原人物库，当前不会创建正式人物。', 'candidate', ['group.prepare'], objectSchema({ name: textSchema(160, 1), description: textSchema(20000, 1) }), objectSchema({ candidateId: textSchema(100) }), async args => {
    if (s.view.candidates.length >= 100) throw new AppError('FEATURE_UNAVAILABLE', '筹备候选数量已达上限。', { recoverable: true })
    const id = randomUUID(), domainDraft = decodePreparationDomainDraft({ type: 'character', id: randomUUID(), name: args.name, description: args.description })
    s.view.candidates.push({ id, kind: 'characters', title: String(args.name), content: String(args.description), domainDraft, memberId: work.memberId, status: 'proposed', createdAt: new Date().toISOString() })
    return { kind: 'completed', evidence: [], trace: `保存${String(args.name)}人物候选`, value: { candidateId: id } }
  }))
  if (kinds.includes('timeline')) register(builtinTool('save_macro_event_candidate', '从故事总纲整理一个因果事件，四要素与结果必须完整。保存结构化筹备候选，作者核对后通过原事件预览/提交流程采用；不自动修改时间线。', 'candidate', ['group.prepare'], objectSchema({ title: textSchema(200, 1), time: textSchema(200, 1), characters: { type: 'array', minItems: 1, maxItems: 50, items: textSchema(120, 1) }, location: textSchema(500, 1), event: textSchema(20000, 1), result: textSchema(10000, 1) }), objectSchema({ candidateId: textSchema(100) }), async args => {
    if (s.view.candidates.length >= 100) throw new AppError('FEATURE_UNAVAILABLE', '筹备候选数量已达上限。', { recoverable: true })
    const { title, ...data } = args, domainDraft = decodePreparationDomainDraft({ type: 'macro-event', ...data })
    if (domainDraft.type !== 'macro-event') throw new AppError('AI_RESPONSE_INVALID', '事件候选格式无效。')
    const id = randomUUID(), content = `时间：${domainDraft.time}\n\n人物：${domainDraft.characters.join('、')}\n\n地点：${domainDraft.location}\n\n事件：${domainDraft.event}\n\n结果：${domainDraft.result}`
    s.view.candidates.push({ id, kind: 'timeline', title: String(title), content, domainDraft, memberId: work.memberId, status: 'proposed', createdAt: new Date().toISOString() })
    return { kind: 'completed', evidence: [], trace: `保存${String(title)}四要素事件候选`, value: { candidateId: id } }
  }))
  if (inspiration && s.view.book) for (const tool of groupInspirationTools(s, work, inspiration)) register(tool)
  if (domains && s.view.book) {
    register(builtinTool('read_task_status', '核对本群已启动的真实领域任务状态。completed/succeeded 仅表示候选生成，仍须作者在原界面采用。重启后不可读的任务不能宣称完成。', 'read', ['book.read'], objectSchema({ taskId: textSchema(100, 1) }), objectSchema({ taskId: textSchema(100), status: textSchema(100), workspaceId: textSchema(100) }), async (args, host) => {
      const job = s.jobs.find(j => j.id === args.taskId)
      if (!job) throw new AppError('CONFLICT', '该任务不属于本群。', { recoverable: true })
      const result = await host.hostCall(() => Promise.resolve(domains[job.kind].status(job.id)))
      return { kind: 'completed', evidence: [], trace: `核对候选任务：${result.status}`, value: { taskId: job.id, status: result.status, workspaceId: job.kind === 'planning' ? 'preparation' : job.kind === 'expansion' ? 'total-outline' : 'chapters' } }
    }))
    const request: AssistantConversationRequest = { operationId: work.id, workItemId: s.bound!.root, page: 'preparation', message: work.instruction, editorFingerprint: '', targets: [], history: [], chapterId: null, selectedCharacters: 0 }
    for (const tool of bookContextTools(domains)) register(tool)
    for (const tool of groupResearchTools(s, work, domains, onlineResearch)) register(tool)
    for (const tool of planningTools(domains, request)) register(tool)
    const reads: ManuscriptReads = new Map()
    for (const tool of manuscriptTools(domains, request, reads)) register(tool)
    for (const tool of reviewTools(domains, request, reads)) register(tool)
  }
  return registry
}
