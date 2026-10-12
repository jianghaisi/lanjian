import type { GroupInspirationPort } from '../adapters/group-inspiration-tools'
import { decodeGroupBookCreation } from '../../../../contracts/group-chat/creation'
import { decodeGroupAdoptionRequest } from '../../../../contracts/group-chat/adoption'
import { decodeGroupDraft, groupId } from '../../../../contracts/group-chat/group-chat'
import { GroupCreationReceipts } from '../adapters/creation-receipts'
import { GroupCreationService, type GroupCreationPorts } from '../application/group-creation-service'
import { GroupAdoptionService, type GroupAdoptionDomains } from '../application/group-adoption-service'
import type { WorkspaceService } from '../../library/application/workspace-service'
import type { ResearchLibraryService } from '../../library/application/research-library-service'
import { AppError } from '../../../core/errors/app-error'
import { decodeNoArgs } from '../../../../contracts/ipc'
import { registerValidatedIpc, type IpcRegistrar } from '../../../platform/ipc/validated-ipc'
import { groupChatArgs } from '../../../../contracts/group-chat/group-chat'
import type { groupModelPorts } from '../../models/application/creation-team-models'
import type { ProjectService } from '../../library/application/project-service'
import type { WritingDomainPorts } from '../../writing-plugins/adapters/builtin/domain-ports'
import { FileGroupSessionStore } from '../adapters/session-store'
import { createGroupTools } from '../adapters/group-tools'
import { GroupChatService } from '../application/group-chat-service'
import type { GroupSession, GroupSessionStore } from '../domain/session'
import type { GroupResearchPort } from '../adapters/group-research-tools'
import { captureGroupTeam, restoreGroupTeam } from '../domain/creative-team'
import { creativePolicyRun, type CaptureCreativePolicy } from '../../writing-plugins/domain/creative-policy'
import { withCreativePolicyRun } from '../../writing-plugins/application/creative-policy-execution'
import { captureGroupToolState, assertGroupToolState, installGroupTools, groupBookSource, groupSourceHash, type GroupPluginPorts } from '../adapters/group-plugin-tools'
export function registerGroupChat(ipc: IpcRegistrar, ports: { appRoot: string; owner?: string; store?: GroupSessionStore; projects: ProjectService; domains: WritingDomainPorts; models: ReturnType<typeof groupModelPorts>; plugins?: GroupPluginPorts; creativePolicy?: CaptureCreativePolicy; creation?: Pick<GroupCreationPorts, 'create' | 'retry' | 'validateBeforeCreate'>; workspace?: WorkspaceService; research?: ResearchLibraryService; onlineResearch?: GroupResearchPort; adoptionDomains?: GroupAdoptionDomains; inspiration?: GroupInspirationPort }) {
  const owner = ports.owner ?? 'desktop-author'
  const scoped = <T>(s: GroupSession, operation: () => Promise<T>) => s.bound ? ports.projects.runInCapturedBook(s.bound, operation) : operation()
  const capture = ports.creativePolicy ?? (async () => creativePolicyRun())
  const assertReadScope = async (s: GroupSession) => {
    if (s.owner !== owner) throw new AppError('CONFLICT', '会话归属已变化。', { recoverable: true })
    await scoped(s, async () => { if (s.bound && (await ports.projects.currentSummary()).id !== s.view.book?.id) throw new AppError('CONFLICT', '关联作品身份已变化。', { recoverable: true }) })
  }
  const service = new GroupChatService(owner, ports.store ?? new FileGroupSessionStore(ports.appRoot, owner), {
    ...ports.models,
    async team(binding) {
      if (!binding) return captureGroupTeam()
      return ports.projects.runInCapturedBook(binding.bound, async () => {
        if ((await ports.projects.currentSummary()).id !== binding.book.id) throw new AppError('CONFLICT', '作品身份已变化，原讨论保留。', { recoverable: true })
        const policy = await capture()
        await policy.assertAuthorized?.()
        const result = captureGroupTeam(policy)
        await policy.assertAuthorized?.()
        return result
      })
    },
    assertReadScope,
    async assertScope(s) {
      await assertReadScope(s)
      await scoped(s, async () => {
        if (s.bound && (await ports.projects.currentSummary()).id !== s.view.book?.id) throw new AppError('CONFLICT', '关联作品身份已变化。', { recoverable: true })
        if (s.format === 2 && s.origin) await restoreGroupTeam(capture, s.origin, s.view.team)
        await assertGroupToolState(s, ports.plugins)
      })
    }, inScope: (s, operation) => scoped(s, async () => {
      if (s.format !== 2 || !s.origin) throw new AppError('CONFLICT', '旧讨论为只读历史，请新建讨论。', { recoverable: true })
      const policy = await restoreGroupTeam(capture, s.origin, s.view.team)
      const run = () => withCreativePolicyRun(policy, operation)
      return policy.withContext ? policy.withContext(run) : run()
    }),
    captureTools: s => scoped(s, () => captureGroupToolState(s, ports.plugins)),
    fingerprint: s => scoped(s, async () => s.bound ? groupSourceHash(await groupBookSource(ports.domains)) : groupSourceHash(null)),
    cancelOwned: s => scoped(s, async () => { for (const job of s.jobs) {
      try { await ports.domains[job.kind].cancel(job.id) } catch (e) { if (!(e instanceof AppError && e.code === 'NOT_FOUND')) throw e }
    } }), tools: async (s, work, capability, checkpoint, ownJob) => {
      const registry = createGroupTools(s, work, ports.domains, ports.onlineResearch, ports.inspiration, ownJob)
      await installGroupTools(registry, s, ports.domains, capability, checkpoint, ports.plugins)
      return registry
    }
  })
  registerValidatedIpc(ipc, 'group-chat:saveDraft', args => { if (args.length !== 1) throw new AppError('VALIDATION_ERROR', '群聊草稿请求无效。'); return [decodeGroupDraft(args[0])] as [ReturnType<typeof decodeGroupDraft>] }, input => service.saveDraft(input))
  registerValidatedIpc(ipc, 'group-chat:list', decodeNoArgs, () => service.list())
  registerValidatedIpc(ipc, 'group-chat:openBook', groupChatArgs.openBook, async bookId => {
    const book = (await ports.projects.list()).projects.find(book => book.id === bookId)
    if (!book) throw new AppError('NOT_FOUND', '请先在作品库选择或建立作品。', { recoverable: true })
    const captured = await ports.projects.captureCreatedBook(book.path)
    if (captured.summary.id !== bookId) throw new AppError('CONFLICT', '作品身份已变化，原群聊保留。', { recoverable: true })
    return service.openBook({ id: bookId, title: captured.summary.title }, captured.identity)
  })
  registerValidatedIpc(ipc, 'group-chat:createForBook', groupChatArgs.createForBook, async bookId => {
    const book = (await ports.projects.list()).projects.find(book => book.id === bookId)
    if (!book) throw new AppError('NOT_FOUND', '请先在作品库选择作品。', { recoverable: true })
    const captured = await ports.projects.captureCreatedBook(book.path)
    if (captured.summary.id !== bookId) throw new AppError('CONFLICT', '作品身份已变化，原讨论保留。', { recoverable: true })
    return service.create(`${captured.summary.title.slice(0, 180)}创作群`, { book: { id: bookId, title: captured.summary.title }, bound: captured.identity })
  })
  registerValidatedIpc(ipc, 'group-chat:modelCatalog', decodeNoArgs, () => ports.models.modelCatalog())
  registerValidatedIpc(ipc, 'group-chat:create', groupChatArgs.create, title => service.create(title))
  registerValidatedIpc(ipc, 'group-chat:get', groupChatArgs.get, input => service.get(input))
  registerValidatedIpc(ipc, 'group-chat:send', groupChatArgs.send, input => service.send(input))
  registerValidatedIpc(ipc, 'group-chat:stop', groupChatArgs.stop, input => service.stop(input))
  registerValidatedIpc(ipc, 'group-chat:resume', groupChatArgs.resume, input => service.resume(input))
  registerValidatedIpc(ipc, 'group-chat:saveMember', groupChatArgs.saveMember, input => service.saveMember(input))
  registerValidatedIpc(ipc, 'group-chat:answer', groupChatArgs.answer, input => service.answer(input))
  if (ports.creation) {
    const receipts = new GroupCreationReceipts(ports.appRoot, owner)
    const creation = new GroupCreationService(service, {
      read: id => receipts.read(id), write: (id, receipt) => receipts.write(id, receipt), ...ports.creation,
      async captureBook(result) {
        const book = await ports.projects.captureCreatedBook(result.project.path)
        if (book.summary.id !== result.project.id) throw new AppError('CONFLICT', '原建书身份已变化，已有作品保留。', { recoverable: true })
        return book.identity
      }
    })
    registerValidatedIpc(ipc, 'group-chat:createBook', args => args.length === 1 ? [decodeGroupBookCreation(args[0])] as [ReturnType<typeof decodeGroupBookCreation>] : (() => { throw new AppError('VALIDATION_ERROR', '建书请求无效。') })(), input => creation.create(input))
  }
  if (ports.workspace && ports.research) {
    const adoption = new GroupAdoptionService(service, (id, operation) => service.scope(id, operation), ports.workspace, ports.research, ports.adoptionDomains, ports.inspiration)
    registerValidatedIpc(ipc, 'group-chat:prepareAdoption', args => { if (args.length !== 1) throw new AppError('VALIDATION_ERROR', '群聊请求无效。'); return [decodeGroupAdoptionRequest(args[0])] as [ReturnType<typeof decodeGroupAdoptionRequest>] }, input => adoption.prepare(input))
    registerValidatedIpc(ipc, 'group-chat:adopt', args => { if (args.length !== 1) throw new AppError('VALIDATION_ERROR', '群聊请求无效。'); return [groupId(args[0])] as [string] }, token => adoption.adopt(token))
  }
  return service
}
