import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm, rename, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CreativeTeam, CompositionEntry } from '@lanjian/writing-plugin-contracts'
import type { GroupSessionView } from '../../src/contracts/group-chat/group-chat'
import { decodeGroupProfile } from '../../src/contracts/group-chat/group-chat'
import type { AiToolStep, AiToolMessage, AiFunctionTool } from '../../src/contracts/assistant/assistant-conversation-contracts'
import { ProjectService } from '../../src/main/modules/library/application/project-service'
import { WorkspaceService } from '../../src/main/modules/library/application/workspace-service'
import { ResearchLibraryService } from '../../src/main/modules/library/application/research-library-service'
import { SettingsStore } from '../../src/main/platform/settings/settings-store'
import { DocumentService } from '../../src/main/modules/manuscript/application/document-service'
import { SqliteManuscriptService } from '../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../src/main/modules/library/application/legacy-workspace-source'
import { ShadowImportService } from '../../src/main/modules/library/application/shadow-import-service'
import { SqliteWorkspaceDatabaseFactory } from '../../src/main/platform/storage/workspace-database'
import { WorkspaceWriteCoordinator } from '../../src/main/core/application/workspace-write-coordinator'
import { PluginPackageStore } from '../../src/main/modules/writing-plugins/adapters/package-store'
import { PluginDraftStore } from '../../src/main/modules/writing-plugins/adapters/draft-store'
import { buildPluginDraft } from '../../src/main/modules/writing-plugins/adapters/draft-builder'
import { bundledPackagePorts } from '../../src/main/modules/writing-plugins/adapters/bundled-packages'
import { PluginAuthoringService } from '../../src/main/modules/writing-plugins/application/authoring-service'
import { BundledPluginService } from '../../src/main/modules/writing-plugins/application/bundled-service'
import { PluginCompositionService } from '../../src/main/modules/writing-plugins/application/composition-service'
import { WritingPluginManager } from '../../src/main/modules/writing-plugins/application/plugin-manager'
import { createCreativePolicyProvider } from '../../src/main/modules/writing-plugins/runtime/creative-policy-provider'
import { modelToolName } from '../../src/main/modules/writing-plugins/application/registry'
import { registerGroupChat } from '../../src/main/modules/group-chat/runtime/group-chat-runtime'
import type { WritingDomainPorts } from '../../src/main/modules/writing-plugins/adapters/builtin/domain-ports'

const team: CreativeTeam = { format: 1, members: [
  { id: 'constructor', name: '资料协调', initials: '协', color: 'unknown-safe', responsibility: '仅协调权限核对，不创作正文。', task: 'outline', capabilities: ['book.read', 'group.prepare', 'group.delegate', 'author.ask'], preparationKinds: ['definition'] },
  { id: 'prototype', name: '规则核对', initials: '核', color: 'teal', responsibility: '仅保存合成核对资料。', task: 'chapterOutline', capabilities: ['book.read', 'group.prepare', 'author.ask'], preparationKinds: ['world'] },
  { id: 'researcher', name: '权限审阅', initials: '审', color: 'slate', responsibility: '只读核对可用工具。', task: 'review', capabilities: ['book.read', 'manuscript.read', 'review.read'], preparationKinds: [] }
] }
const reply = (): AiToolStep => ({ content: '权限核对结束，原书稿未改动。', toolCalls: [] })
const call = (id: string, name: string, args: unknown): AiToolStep => ({ content: '', toolCalls: [{ id, type: 'function', function: { name: modelToolName('builtin.core', name), arguments: JSON.stringify(args) } }] })
const command = (v: GroupSessionView) => ({ sessionId: v.id, expectedRevision: v.revision })
type Request = { task: string; messages: AiToolMessage[]; tools: AiFunctionTool[] }
async function fixture(t: test.TestContext) {
  const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-team-policy-'))), releases: Array<() => void> = []
  t.after(async () => { releases.forEach(release => release()); assert.equal(dirname(await realpath(root)), parent); await rm(root, { recursive: true, force: true }) })
  const projects = new ProjectService(new SettingsStore(join(root, 'profile'), { available: () => false, encrypt: () => assert.fail(), decrypt: () => assert.fail() }))
  const { project } = await projects.create({ parentPath: root, name: '团队插件隔离核对', genre: '悬疑' }), legacyFiles = new DocumentService(projects)
  await legacyFiles.createChapter()
  const databases = new SqliteWorkspaceDatabaseFactory(), writes = new WorkspaceWriteCoordinator(), authority = new SqliteManuscriptService(databases, undefined, writes)
  const legacy = new CurrentProjectLegacyWorkspaceSource(projects, legacyFiles), importer = new ShadowImportService(legacy, databases, writes)
  await importer.import(await importer.preview()); await authority.activate(project.path, await legacy.snapshot())
  const documents = new DocumentService(projects, undefined, authority), research = new ResearchLibraryService(projects, authority), workspace = new WorkspaceService(projects, undefined, research, documents, undefined, undefined, authority)
  const manager = new WritingPluginManager(new PluginPackageStore(root), async () => {}), drafts = new PluginDraftStore(root)
  const authoring = new PluginAuthoringService(drafts, { build: buildPluginDraft, persist: built => drafts.persist(built), chooseExport: async () => null, choosePackage: async () => null, chooseSource: async () => null,
    installed: async (id, digest) => { const p = await manager.loadAuthorized(project.id, id, digest); return { manifest: p.version.manifest, files: p.files } } }, manager)
  const bundled = new BundledPluginService(bundledPackagePorts(root), manager, authoring), original = (await bundled.list()).find(p => p.manifest.id === 'lanjian.official.creative-team')!
  let draft = await bundled.derive({ pluginId: original.manifest.id, digest: original.digest }), manifest = JSON.parse(draft.manifestText)
  draft = await authoring.save({ id: draft.id, revision: draft.revision, manifestText: JSON.stringify(manifest), files: draft.files.map(file => file.path === 'team.json' ? { ...file, content: JSON.stringify(team) } : file) })
  const built = await authoring.build({ id: draft.id, revision: draft.revision }), plan = await authoring.preview({ id: draft.id, revision: draft.revision })
  let index = await manager.install(plan.planId); index = await manager.setEnabled(draft.pluginId, true, [], index.revision); await manager.setBookEnabled(project.id, draft.pluginId, true, index.revision)
  const entries: CompositionEntry[] = [{ pluginId: draft.pluginId, digest: built.digest, contributionId: manifest.contributions.find((c: { kind: string }) => c.kind === 'team-preset').id, params: {} }]
  async function select(next: CompositionEntry[]) { const composition = new PluginCompositionService(manager), preview = await composition.preview(project.id, next, (await manager.list()).revision, async () => {}); assert.deepEqual(preview.conflicts, []); await composition.apply(preview.planId) }
  await select(entries)
  const policy = createCreativePolicyProvider(() => manager.captureComposition(project.id), async v => (await manager.loadAuthorized(project.id, v.manifest.id, v.digest)).files, async ref => manager.loadAuthorized(project.id, ref.pluginId, ref.digest))
  const requests: Request[] = []
  let respond = async (_request: Request): Promise<AiToolStep> => reply()
  const prohibited = (): never => assert.fail('No prose, confirmation or domain generation is permitted by this fixture')
  const domains: WritingDomainPorts = { projects, workspace, research, documents,
    planning: { start: prohibited, status: prohibited, cancel: prohibited }, expansion: { start: prohibited, status: prohibited, cancel: prohibited }, writing: { start: prohibited, status: prohibited, cancel: prohibited }, review: { prepare: prohibited, run: prohibited } }
  const models = {
    defaults: async (value: CreativeTeam) => value.members.map(member => ({ memberId: member.id, profile: decodeGroupProfile({ connectionId: 'global-isolated', model: `${member.task}-fixture`, parameterPolicy: { version: 2, mode: 'auto' } }) })),
    modelCatalog: prohibited,
    capture: async (profile: ReturnType<typeof decodeGroupProfile>, task: 'outline' | 'chapterOutline' | 'prose' | 'review' = 'outline') => ({ identity: createHash('sha256').update(JSON.stringify({ profile, task })).digest('hex'), run: async <T>(operation: () => Promise<T>) => operation(), model: { model: profile.model, connectionId: profile.connectionId,
      step: async (messages: AiToolMessage[], tools: AiFunctionTool[]) => { const request = { task, messages: structuredClone(messages), tools: structuredClone(tools) }; requests.push(request); return respond(request) } } })
  }
  let handlers = new Map<string, (_event: unknown, ...args: unknown[]) => unknown>()
  const reopen = () => { handlers = new Map(); return registerGroupChat({ handle: (channel, handler) => { handlers.set(channel, handler) } }, { appRoot: root, projects, domains, models, plugins: { manager: () => manager, runner: { run: prohibited, dispose: async () => {} } }, creativePolicy: policy, workspace, research }) }
  let service = reopen()
  const ipc = async <T>(channel: string, ...args: unknown[]) => handlers.get(`group-chat:${channel}`)!(undefined, ...args) as Promise<{ ok: boolean; value: T; error?: { code: string; message: string } }>
  const successful = async <T>(channel: string, ...args: unknown[]) => { const result = await ipc<T>(channel, ...args); assert.equal(result.ok, true, result.error?.message ?? 'Production IPC failed'); return result.value }
  return { root, project, projects, documents, workspace, requests, entries, select, built, draft, ipc, successful, service: () => service,
    reopen: () => { service = reopen() }, respond: (fn: typeof respond) => { respond = fn }, track: (release: () => void) => releases.push(release),
    revoke: async () => manager.setBookEnabled(project.id, draft.pluginId, false, (await manager.list()).revision) }
}

test('real ZIP and production IPC freeze three custom IDs, actual task models and finite tools across new discussions and restart', async t => {
  const f = await fixture(t), before = await f.documents.chapter(1), foundation = await f.workspace.foundation()
  const original = await f.successful<GroupSessionView>('openBook', f.project.id)
  assert.deepEqual(original.team, team); assert.deepEqual(original.members.map(m => m.memberId), ['constructor', 'prototype', 'researcher']); assert.equal(f.requests.length, 0)
  f.respond(async request => {
    const toolResults = request.messages.filter(m => m.role === 'tool').length
    if (request.task === 'outline' && !toolResults) return call('handoff', 'delegate_to_member', { memberId: 'prototype', instruction: '核对合成权限资料。' })
    if (request.task === 'chapterOutline' && !toolResults) return call('candidate', 'save_preparation_candidate', { kind: 'world', title: '合成权限核对', content: '这是一项权限核对的测试记录，尚未采用。' })
    return reply()
  })
  await f.successful('send', { ...command(original), operationId: randomUUID(), message: '只核对成员职责与权限，不生成正文。' }); await f.service().drain(original.id)
  let current = await f.successful<GroupSessionView>('get', { sessionId: original.id, limit: 100 })
  assert.equal(current.status, 'idle'); assert.equal(current.candidates.length, 1); assert.equal(current.candidates[0].memberId, 'prototype')
  assert.deepEqual(f.requests.map(r => r.task), ['outline', 'outline', 'chapterOutline', 'chapterOutline'])
  const first = f.requests[0].tools.map(tool => tool.function.name), second = f.requests[2].tools.map(tool => tool.function.name)
  assert.ok(first.includes(modelToolName('builtin.core', 'delegate_to_member'))); assert.ok(!second.includes(modelToolName('builtin.core', 'delegate_to_member')))
  assert.ok(second.includes(modelToolName('builtin.core', 'read_book_context'))); assert.ok(!second.includes(modelToolName('builtin.core', 'generate_manuscript')))
  await f.select([])
  const fresh = await f.successful<GroupSessionView>('createForBook', f.project.id); assert.notEqual(fresh.id, original.id); assert.equal(fresh.team.members.length, 7)
  f.reopen(); current = await f.successful<GroupSessionView>('get', { sessionId: original.id, limit: 100 }); assert.deepEqual(current.team, team); assert.equal(f.requests.length, 4)
  f.respond(async request => request.messages.some(m => m.role === 'tool') ? reply() : call('read-original-book', 'read_book_context', {}))
  await f.successful('send', { ...command(current), operationId: randomUUID(), memberId: 'researcher', message: '只读取当前书已保存依据。' }); await f.service().drain(original.id)
  assert.deepEqual(f.requests.slice(4).map(r => r.task), ['review', 'review']); assert.ok(!f.requests[4].tools.some(tool => tool.function.name === modelToolName('builtin.core', 'save_preparation_candidate')))
  assert.deepEqual(await f.documents.chapter(1), before); assert.deepEqual(await f.workspace.foundation(), foundation)
  // openBook reuses the most recently saved discussion, including an explicitly revisited one.
  assert.equal((await f.successful<GroupSessionView>('openBook', f.project.id)).id, current.id)
})

test('unauthorized candidate kinds and tools cannot execute even when the model names them directly', async t => {
  const f = await fixture(t), original = await f.successful<GroupSessionView>('openBook', f.project.id)
  f.respond(async request => request.messages.some(m => m.role === 'tool') ? reply() : call('wrong-kind', 'save_preparation_candidate', { kind: 'characters', title: '非法种类', content: '仅权限核对' }))
  await f.successful('send', { ...command(original), operationId: randomUUID(), memberId: 'prototype', message: '核对候选范围。' }); await f.service().drain(original.id)
  let current = await f.successful<GroupSessionView>('get', { sessionId: original.id, limit: 100 }); assert.equal(current.candidates.length, 0)
  f.respond(async request => request.messages.some(m => m.role === 'tool') ? reply() : call('unlisted-tool', 'save_preparation_candidate', { kind: 'world', title: '非法工具', content: '仅权限核对' }))
  await f.successful('send', { ...command(current), operationId: randomUUID(), memberId: 'researcher', message: '核对只读权限。' }); await f.service().drain(original.id)
  current = await f.successful<GroupSessionView>('get', { sessionId: original.id, limit: 100 }); assert.equal(current.candidates.length, 0)
  const unknown = await f.ipc('send', { ...command(current), operationId: randomUUID(), memberId: 'editor', message: '未知成员' }); assert.equal(unknown.ok, false)
  assert.equal((await f.documents.chapter(1)).content, '')
})

test('real book grant withdrawal stops late publication and original receipts remain idempotent after restart', async t => {
  const f = await fixture(t), original = await f.successful<GroupSessionView>('openBook', f.project.id)
  let release!: () => void, entered!: () => void
  const pending = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { entered = resolve }); f.track(release)
  f.respond(async () => { entered(); await pending; return reply() })
  const input = { ...command(original), operationId: randomUUID(), memberId: 'prototype', message: '只核对撤权窗口。' }
  await f.successful('send', input); await started; await f.revoke(); release(); await f.service().drain(original.id)
  const current = await f.successful<GroupSessionView>('get', { sessionId: original.id, limit: 100 })
  assert.equal(current.messages.filter(m => m.role === 'agent').length, 0); assert.equal(current.candidates.length, 0); assert.equal(f.requests.length, 1)
  f.reopen(); assert.deepEqual((await f.successful<GroupSessionView>('send', input)).team, team); assert.equal(f.requests.length, 1)
  const denied = await f.ipc('send', { ...command(current), operationId: randomUUID(), memberId: 'prototype', message: '新的目标' }); assert.equal(denied.ok, false); assert.equal(f.requests.length, 1)
  assert.equal((await f.documents.chapter(1)).content, '')
})

test('physical book ABA is rejected at the production discussion boundary without model inference', async t => {
  const f = await fixture(t), original = await f.successful<GroupSessionView>('openBook', f.project.id)
  const moved = f.project.path + '-original'; await rename(f.project.path, moved)
  const replacement = await f.projects.create({ parentPath: f.root, name: '团队插件隔离核对', genre: '悬疑' })
  // Desktop public IDs are paths; the physical identity must distinguish this ABA replacement.
  assert.equal(replacement.project.id, f.project.id)
  const result = await f.ipc('send', { ...command(original), operationId: randomUUID(), memberId: 'constructor', message: '不能进入替换书。' })
  assert.equal(result.ok, false); assert.equal(f.requests.length, 0)
  const stored = await readFile(join(f.root, 'group-chat', createHash('sha256').update('desktop-author').digest('hex'), original.id + '.json'), 'utf8')
  assert.equal(JSON.parse(stored).bound.root, f.project.path)
})
