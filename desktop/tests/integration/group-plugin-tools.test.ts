import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { AsyncResource } from 'node:async_hooks'
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
import { GroupChatService } from '../../src/main/modules/group-chat/application/group-chat-service'
import { FileGroupSessionStore } from '../../src/main/modules/group-chat/adapters/session-store'
import { decodeGroupSession } from '../../src/main/modules/group-chat/domain/session'
import { PlanningJobService } from '../../src/main/modules/planning/application/planning-job-service'
import type { WritingDomainPorts } from '../../src/main/modules/writing-plugins/adapters/builtin/domain-ports'
import type { GuestRunner } from '../../src/main/modules/writing-plugins/domain/guest'
import { executeGuest } from '../../src/main/modules/writing-plugins/runtime/guest-engine'

const wasm = readFile(createRequire(import.meta.url).resolve('@jitl/quickjs-wasmfile-release-sync/wasm')).then(b => new Uint8Array(b).buffer)
const detached = new AsyncResource('group-sdk-isolated-worker')
const question = { questions: [{ id: 'choice', prompt: '核对合成资料标签', mode: 'single', required: true, options: [{ id: 'a', label: '标签甲' }, { id: 'b', label: '标签乙' }] }] }
const caps = ['book.read', 'planning.candidate', 'model.generate', 'author.ask', 'assets.read']
const team: CreativeTeam = { format: 1, members: [{ id: 'coordinator', name: '资料核对', initials: '核', color: 'teal', responsibility: '只核对合成元数据，不创作正文。', task: 'outline', capabilities: caps, preparationKinds: [] }], starters: [{ id: 'check', label: '核对原标签', hint: '只核对元数据', message: '只核对合成资料标签。' }] }
const source = `export async function execute(id,input,ctx){
 const asset=await ctx.assets.readText({path:'notes.txt'});
 const book=await ctx.book.read({kind:'context'});
 const model=await ctx.model.generate({instruction:'C2_SDK_METADATA_ONLY',draft:asset.text});
 const receipt=await ctx.candidate.prepare({kind:'planning',key:'original',input:{}});
 await ctx.interaction.request({question:${JSON.stringify(question)},checkpoint:{round:1,taskId:receipt.taskId,text:asset.text+':'+model.text}});return {};
}
export async function resume(id,checkpoint,answer,ctx){
 const same=await ctx.candidate.prepare({kind:'planning',key:'original',input:{}});
 if(same.taskId!==checkpoint.taskId)throw Error('candidate receipt changed');
 if(checkpoint.round===1){await ctx.interaction.request({question:${JSON.stringify(question)},checkpoint:{...checkpoint,round:2}});return {}};
 return {text:checkpoint.text+':'+answer.answers[0].chosenOptionIds[0],taskId:'guest-invented-job'};
}`
const command = (v: GroupSessionView) => ({ sessionId: v.id, expectedRevision: v.revision })
const answer = (v: GroupSessionView, id = randomUUID()) => ({ ...command(v), questionId: v.question!.id, answerSubmissionId: id, answers: [{ id: 'choice', chosenOptionIds: ['a'], customText: '', skipped: false }] })
async function fixture(t: test.TestContext, disabled = false, fault?: 'intent' | 'completed' | 'answer-ack', memberCaps = caps, twoMembers = false) {
 const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-group-sdk-')))
 let service: GroupChatService | undefined, guestCalls = 0, completions = 0, modelCalls = 0, starts = 0
 const runner: GuestRunner = { async run(invocation, broker, signal) { guestCalls++; const bytes = await wasm; return detached.runInAsyncScope(() => executeGuest(invocation, bytes, broker, signal)) }, async dispose() {} }
 const projects = new ProjectService(new SettingsStore(join(root, 'profile'), { available: () => false, encrypt: () => assert.fail(), decrypt: () => assert.fail() }))
 const { project } = await projects.create({ parentPath: root, name: 'SDK 元数据隔离', genre: '悬疑' }), legacyFiles = new DocumentService(projects)
 await legacyFiles.createChapter()
 const databases = new SqliteWorkspaceDatabaseFactory(), writes = new WorkspaceWriteCoordinator(), authority = new SqliteManuscriptService(databases, undefined, writes)
 const legacy = new CurrentProjectLegacyWorkspaceSource(projects, legacyFiles), importer = new ShadowImportService(legacy, databases, writes)
 await importer.import(await importer.preview()); await authority.activate(project.path, await legacy.snapshot())
 const documents = new DocumentService(projects, undefined, authority), research = new ResearchLibraryService(projects, authority), workspace = new WorkspaceService(projects, undefined, research, documents, undefined, undefined, authority)
 const manager = new WritingPluginManager(new PluginPackageStore(root), (id, bookId) => service?.revokePlugin(id, bookId) ?? Promise.resolve()), drafts = new PluginDraftStore(root)
 const authoring = new PluginAuthoringService(drafts, { build: buildPluginDraft, persist: built => drafts.persist(built), chooseExport: async () => null, choosePackage: async () => null, chooseSource: async () => null,
 installed: async (id, digest) => { const p = await manager.loadAuthorized(project.id, id, digest); return { manifest: p.version.manifest, files: p.files } } }, manager)
 const bundled = new BundledPluginService(bundledPackagePorts(root), manager, authoring), original = (await bundled.list()).find(p => p.manifest.id === 'lanjian.official.creative-team')!
 let draft = await bundled.derive({ pluginId: original.manifest.id, digest: original.digest }), manifest = JSON.parse(draft.manifestText)
 manifest.capabilities = caps; manifest.assets.push('notes.txt')
 manifest.tools = [{ id: 'inspect', description: '核对 SDK 元数据与原领域候选启动回执', effect: 'candidate', capabilities: caps, inputSchema: { type: 'object', properties: {}, additionalProperties: false }, outputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 10000 }, taskId: { type: 'string', maxLength: 100 } }, required: ['text','taskId'], additionalProperties: false } }]
 const method = manifest.contributions.find((c: { kind: string }) => c.kind === 'creative-policy')
 method.configSchema.properties = { label: { type: 'string', maxLength: 100 } }
 if (disabled) { method.mode = 'disabled'; delete method.asset }
 const effectSource = `export async function execute(id,input,ctx){try{await ctx.candidate.prepare({kind:'planning',key:'first',input:{}})}catch(e){await ctx.candidate.prepare({kind:'planning',key:'second',input:{}})}return{text:'unpublished',taskId:'forged'}}`
 const actualTeam = { ...team, members: team.members.map(m=>({...m,capabilities:memberCaps})) }
 if(twoMembers)actualTeam.members.push({...actualTeam.members[0],id:'reviewer',name:'元数据审阅',task:'review'})
 draft = await authoring.save({ id: draft.id, revision: draft.revision, manifestText: JSON.stringify(manifest), files: [...draft.files.map(file => ({ ...file, content: file.path === 'team.json' ? JSON.stringify(actualTeam) : file.path === 'main.js' ? twoMembers || fault === 'intent' || fault === 'completed' ? effectSource : source : file.path === 'group-orchestration.md' ? 'C2_ORIGINAL_METHOD {{label}}' : file.content })), { path: 'notes.txt', content: 'ORIGINAL_ASSET_V1' }] })
 const built = await authoring.build({ id: draft.id, revision: draft.revision }), plan = await authoring.preview({ id: draft.id, revision: draft.revision })
 let index = await manager.install(plan.planId); index = await manager.setEnabled(draft.pluginId, true, caps, index.revision); await manager.setBookEnabled(project.id, draft.pluginId, true, index.revision)
 const entries: CompositionEntry[] = manifest.contributions.map((c: { id: string; kind: string }) => ({ pluginId: draft.pluginId, digest: built.digest, contributionId: c.id, params: c.kind === 'creative-policy' ? { label: 'original-param' } : {} }))
 async function select(next: CompositionEntry[]) { const composition = new PluginCompositionService(manager), preview = await composition.preview(project.id, next, (await manager.list()).revision, async () => {}); assert.deepEqual(preview.conflicts, []); await composition.apply(preview.planId) }
 await select(entries)
 const policy = createCreativePolicyProvider(() => manager.captureComposition(project.id), async v => (await manager.loadAuthorized(project.id, v.manifest.id, v.digest)).files, async ref => manager.loadAuthorized(project.id, ref.pluginId, ref.digest))
 const planning = new PlanningJobService({ generate: (_id, signal) => new Promise((_resolve, reject) => { signal?.addEventListener('abort', () => reject(Error('owned synthetic metadata job stopped')), { once: true }) }) })
 const prohibited = (): never => assert.fail('No prose, confirmation or outline expansion is allowed')
 const actualJobs: string[] = []
 const domains: WritingDomainPorts = { projects, workspace, research, documents, planning: { start: id => { starts++; const task=planning.start(id);actualJobs.push(task.id);return task }, status: id => planning.status(id), cancel: id => planning.cancel(id) }, expansion: { start: prohibited, status: prohibited, cancel: prohibited }, writing: { start: prohibited, status: prohibited, cancel: prohibited }, review: { prepare: prohibited, run: prohibited } }
 let complete = async (_signal?: AbortSignal) => 'STATIC_METADATA_SUGGESTION'
 const models = {
 defaults: async (value: CreativeTeam) => value.members.map(m => ({ memberId: m.id, profile: decodeGroupProfile({ connectionId: 'global-isolated', model: `${m.task}-fixture`, parameterPolicy: { version: 2, mode: 'auto' } }) })), modelCatalog: prohibited,
 capture: async (profile: ReturnType<typeof decodeGroupProfile>, task: 'outline'|'chapterOutline'|'prose'|'review' = 'outline') => ({ identity: createHash('sha256').update(JSON.stringify({ profile, task })).digest('hex'), run: async <T>(operation: () => Promise<T>) => operation(),
 completion: async () => ({ model: profile.model, connectionId: profile.connectionId, complete: async (instruction: string, _draft?: string, context?: string, signal?: AbortSignal) => { completions++; assert.equal(task,'outline'); assert.equal(instruction,'C2_SDK_METADATA_ONLY'); assert.match(context!, /system.*materials/s); return { content: await complete(signal) } } }),
 model: { model: profile.model, connectionId: profile.connectionId, step: async (messages: AiToolMessage[], tools: AiFunctionTool[]): Promise<AiToolStep> => {
 modelCalls++; assert.match(messages[0].content!, /C2_ORIGINAL_METHOD original-param/); assert.doesNotMatch(messages[0].content!, /一次目标不必每人发言/)
 const results = messages.filter(m => m.role === 'tool'), call = (name: string, args: unknown): AiToolStep => ({ content: '', toolCalls: [{ id: `sdk-call-${results.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
 if (!results.length) return call('discover_tools', { query: draft.pluginId })
 if (results.length === 1) { assert.equal(tools.some(t => t.function.name === modelToolName(draft.pluginId, 'inspect')),caps.every(cap=>memberCaps.includes(cap))); return call(modelToolName(draft.pluginId,'inspect'), {}) }
 return { content: '合成资料核对结束，原书稿未修改。', toolCalls: [] }
 } } }) }
 let handlers = new Map<string, (_event: unknown, ...args: unknown[]) => unknown>()
 const files = new FileGroupSessionStore(root, 'desktop-author'); let faultCount = 0
 const store = { list:()=>files.list(), read:(id:string)=>files.read(id), async write(s: Parameters<typeof files.write>[0], before?:()=>Promise<void>){await files.write(s,async()=>{if(fault && !faultCount && s.effects.some(e=>e.status===fault)){faultCount++;throw Error('synthetic beforeReplace write failure')}await before?.()});if(fault==='answer-ack'&&!faultCount&&s.current?.guestAnswer&&s.intent==='idle'){faultCount++;throw Error('synthetic committed answer acknowledgement lost')}} }
 const reopen = () => { handlers = new Map(); service = registerGroupChat({ handle: (channel, handler) => { handlers.set(channel, handler) } }, { appRoot: root, store, projects, domains, models, plugins: { manager: () => manager, runner }, creativePolicy: policy, workspace, research }); return service }
 reopen()
 const ipc = async <T>(name: string, ...args: unknown[]) => handlers.get(`group-chat:${name}`)!(undefined,...args) as Promise<{ ok: boolean; value: T; error?: { code: string; message: string } }>
 const successful = async <T>(name: string, ...args: unknown[]) => { const r = await ipc<T>(name,...args); assert.equal(r.ok,true,r.error?.message ?? name); return r.value }
 t.after(async () => { await service?.shutdown(); for (const id of actualJobs) planning.cancel(id); await runner.dispose(); assert.equal(dirname(await realpath(root)),parent); await rm(root,{recursive:true,force:true}) })
 return { root, project, manager, workspace, documents, files, built, draft, entries, select, ipc, successful, reopen, planning, actualJobs, faults:()=>faultCount, service: () => service!, counters: () => ({ guestCalls, completions, modelCalls, starts }), setComplete: (next: typeof complete) => { complete = next } }
}

test('actual ZIP/VM/production IPC freezes original method, grants and SDK waits; two answers settle one call and one real owned planning job', async t => {
 const f = await fixture(t), before = await f.documents.chapter(1)
 const view = await f.successful<GroupSessionView>('openBook',f.project.id)
 await f.successful('send',{...command(view),operationId:randomUUID(),message:'核对元数据，不创作正文。'})
 await f.service().drain(view.id)
 let waiting = await f.successful<GroupSessionView>('get',{sessionId:view.id,limit:100})
 assert.equal(waiting.status,'waiting-input',waiting.notice)
 const record = await f.files.read(view.id), originalCall = record.current!.waiting!.id
 assert.deepEqual(record.current!.checkpoint?.round,1); assert.equal(record.tools!.pins[0].digest,f.built.digest)
 assert.deepEqual(record.tools!.pins[0].grants,caps); assert.equal(record.effects.length,1); assert.equal(record.effects[0].status,'completed'); assert.equal(record.jobs.length,1)
 assert.deepEqual(f.counters(),{guestCalls:1,completions:1,modelCalls:2,starts:1})
 await f.select([]); const fresh = await f.successful<GroupSessionView>('createForBook',f.project.id); assert.equal(fresh.team.members.length,7)
 await f.service().shutdown(); f.reopen(); waiting = await f.successful<GroupSessionView>('get',{sessionId:view.id,limit:100})
 assert.equal(waiting.team.members.length,1); assert.deepEqual(f.counters(),{guestCalls:1,completions:1,modelCalls:2,starts:1})
 const firstAnswer = answer(waiting)
 await f.successful('answer',firstAnswer); await f.service().drain(view.id)
 const second = await f.successful<GroupSessionView>('get',{sessionId:view.id,limit:100})
 assert.equal(second.status,'waiting-input',second.notice); assert.notEqual(second.question!.id,waiting.question!.id)
 assert.equal((await f.files.read(view.id)).current!.waiting!.id,originalCall)
 await f.successful('answer',firstAnswer); assert.equal(f.counters().guestCalls,2)
 await f.successful('answer',answer(second)); await f.service().drain(view.id)
 const done = await f.files.read(view.id)
 assert.equal(done.view.status,'idle',done.view.notice); assert.equal(done.jobs.length,1); assert.equal(f.counters().starts,1)
 const results = Object.values(done.histories).flat().filter(m=>m.tool_call_id===originalCall)
 assert.equal(results.length,1); assert.match(results[0].content!,/ORIGINAL_ASSET_V1:STATIC_METADATA_SUGGESTION:a/)
 assert.ok(!done.jobs.some(j=>j.id==='guest-invented-job')); assert.deepEqual(await f.documents.chapter(1),before)
})

test('disabled original method fails before model capture and guest dispatch', async t => {
 const f = await fixture(t,true), view = await f.successful<GroupSessionView>('openBook',f.project.id)
 await f.successful('send',{...command(view),operationId:randomUUID(),message:'核对元数据。'}); await f.service().drain(view.id)
 const result = await f.successful<GroupSessionView>('get',{sessionId:view.id,limit:100})
 assert.equal(result.status,'failed'); assert.match(result.notice,/编排方法.*停用/)
 assert.deepEqual(f.counters(),{guestCalls:0,completions:0,modelCalls:0,starts:0})
})

test('grant withdrawal aborts actual guest model callback with zero late receipt or candidate; restart never replays the unknown call', async t => {
 const f = await fixture(t), view = await f.successful<GroupSessionView>('openBook',f.project.id)
 let entered!:()=>void; const called = new Promise<void>(resolve=>{entered=resolve})
 f.setComplete(signal=>new Promise((_resolve,reject)=>{entered();signal!.addEventListener('abort',()=>reject(Error('owned callback aborted')),{once:true})}))
 await f.successful('send',{...command(view),operationId:randomUUID(),message:'只核对元数据。'}); await Promise.race([called, f.service().drain(view.id).then(async()=>assert.fail((await f.files.read(view.id)).view.notice))])
 await f.manager.setBookEnabled(f.project.id,f.draft.pluginId,false,(await f.manager.list()).revision)
 const snapshot = await f.files.read(view.id); assert.equal(snapshot.intent,'tool'); assert.equal(snapshot.effects.length,0); assert.equal(snapshot.jobs.length,0)
 await f.service().shutdown(); f.reopen()
 const restored = await f.successful<GroupSessionView>('get',{sessionId:view.id,limit:100}); assert.equal(restored.status,'interrupted')
 const resume = await f.ipc('resume',command(restored)); assert.equal(resume.ok,false)
 assert.deepEqual(f.counters(),{guestCalls:1,completions:1,modelCalls:2,starts:0})
})

test('closed private group state denies foreign pins, forged checkpoint authority and mismatched dispatcher budgets', async t => {
 const f = await fixture(t), view = await f.successful<GroupSessionView>('openBook',f.project.id)
 await f.successful('send',{...command(view),operationId:randomUUID(),message:'只核对元数据。'}); await f.service().drain(view.id)
 const record = await f.files.read(view.id)
 for (const mutate of [
 (s: typeof record)=>{s.tools!.pins[0].digest='a'.repeat(64)},
 (s: typeof record)=>{s.tools!.composition!.entries=[]},
 (s: typeof record)=>{s.current!.checkpoint={huge:'x'.repeat(65537)}},
 (s: typeof record)=>{s.current!.guestAnswer={answers:[]} },
 (s: typeof record)=>{s.current!.dispatcher!.budget.calls++}
 ]) { const changed=structuredClone(record);mutate(changed);assert.throws(()=>decodeGroupSession(changed)) }
 assert.deepEqual(decodeGroupSession(record),record)
})

for (const fault of ['intent','completed'] as const) test(`real beforeReplace ${fault} failure aborts guest retries, cancels the actually started job and preserves unknown intent across restart`, async t => {
 const f=await fixture(t,false,fault), before=await f.documents.chapter(1), view=await f.successful<GroupSessionView>('openBook',f.project.id)
 await f.successful('send',{...command(view),operationId:randomUUID(),message:'只核对候选启动回执。'});await f.service().drain(view.id)
 assert.equal(f.faults(),1)
 const saved=await f.files.read(view.id)
 assert.equal(saved.intent,'tool');assert.equal(f.counters().starts,fault==='intent'?0:1)
 assert.equal(saved.effects.length,fault==='intent'?0:1)
 if(fault==='completed'){assert.equal(saved.effects[0].status,'intent');assert.equal(f.planning.status(f.actualJobs[0]).status,'cancelled')}
 f.reopen();const restored=await f.successful<GroupSessionView>('get',{sessionId:view.id,limit:100});assert.equal(restored.status,'interrupted')
 assert.equal((await f.ipc('resume',command(restored))).ok,false)
 assert.equal(f.counters().guestCalls,1);assert.equal(f.counters().starts,fault==='intent'?0:1);assert.deepEqual(await f.documents.chapter(1),before)
})

test('committed SDK answer with lost acknowledgement restarts without inference and resumes only on an explicit author command', async t => {
 const f=await fixture(t,false,'answer-ack'),view=await f.successful<GroupSessionView>('openBook',f.project.id)
 await f.successful('send',{...command(view),operationId:randomUUID(),message:'只核对元数据。'});await f.service().drain(view.id)
 const waiting=await f.successful<GroupSessionView>('get',{sessionId:view.id,limit:100}),submitted=answer(waiting)
 assert.equal((await f.ipc('answer',submitted)).ok,false);assert.equal(f.faults(),1)
 const saved=await f.files.read(view.id);assert.equal(saved.intent,'idle');assert.ok(saved.current!.guestAnswer);assert.equal(saved.view.question,null)
 f.reopen();const restored=await f.successful<GroupSessionView>('get',{sessionId:view.id,limit:100});assert.equal(restored.status,'interrupted');assert.equal(f.counters().guestCalls,1)
 await f.successful('answer',submitted);assert.equal(f.counters().guestCalls,1)
 await f.successful('resume',command(restored));await f.service().drain(view.id)
 const second=await f.successful<GroupSessionView>('get',{sessionId:view.id,limit:100});assert.equal(second.status,'waiting-input',second.notice);assert.equal(f.counters().guestCalls,2);assert.equal(f.counters().starts,1)
 await f.successful('answer',answer(second));await f.service().drain(view.id);assert.equal((await f.files.read(view.id)).view.status,'idle')
})

test('real app and book grants cannot expose an installed SDK tool outside the original member capability intersection', async t => {
 const f=await fixture(t,false,undefined,['book.read']),view=await f.successful<GroupSessionView>('openBook',f.project.id)
 await f.successful('send',{...command(view),operationId:randomUUID(),message:'只核对权限。'});await f.service().drain(view.id)
 const s=await f.files.read(view.id);assert.equal(s.view.status,'failed');assert.equal(s.effects.length,0)
 assert.deepEqual(f.counters(),{guestCalls:0,completions:0,modelCalls:2,starts:0})
})

test('canonical source change during an SDK model response blocks its late suggestion and all candidate calls', async t => {
 const f=await fixture(t),view=await f.successful<GroupSessionView>('openBook',f.project.id),before=await f.documents.chapter(1)
 let entered!:()=>void,release!:()=>void;const called=new Promise<void>(r=>{entered=r}),hold=new Promise<void>(r=>{release=r})
 t.after(()=>release?.());f.setComplete(async()=>{entered();await hold;return 'UNPUBLISHED_CHANGED_SOURCE'})
 await f.successful('send',{...command(view),operationId:randomUUID(),message:'只核对元数据。'});await Promise.race([called,f.service().drain(view.id).then(()=>assert.fail('SDK model callback was never reached'))])
 await f.workspace.saveFoundation({...await f.workspace.foundation(true),sourceNotes:'CHANGED_SYNTHETIC_SOURCE'})
 release();await f.service().drain(view.id)
 const saved=await f.files.read(view.id);assert.equal(saved.view.status,'failed');assert.equal(saved.effects.length,0);assert.equal(saved.jobs.length,0);assert.equal(f.counters().starts,0)
 assert.ok(!JSON.stringify(saved).includes('UNPUBLISHED_CHANGED_SOURCE'));assert.deepEqual(await f.documents.chapter(1),before)
})

test('equal provider call IDs from distinct members and author goals never reuse another goal candidate receipt', async t => {
 const f=await fixture(t,false,undefined,caps,true);let view=await f.successful<GroupSessionView>('openBook',f.project.id)
 for(const memberId of ['coordinator','reviewer']){
  await f.successful('send',{...command(view),operationId:randomUUID(),memberId,message:'只核对本目标的候选回执。'});await f.service().drain(view.id)
  view=await f.successful<GroupSessionView>('get',{sessionId:view.id,limit:100});assert.equal(view.status,'idle',view.notice)
  f.planning.cancel(f.actualJobs.at(-1)!)
 }
 const s=await f.files.read(view.id);assert.equal(f.counters().starts,2);assert.equal(s.jobs.length,2);assert.equal(s.effects.length,2)
 assert.notEqual(s.jobs[0].id,s.jobs[1].id);assert.notEqual(s.effects[0].key,s.effects[1].key)
 const calls=Object.values(s.histories).flat().flatMap(m=>m.tool_calls??[]).filter(c=>c.function.name===modelToolName(f.draft.pluginId,'inspect'))
 assert.deepEqual(calls.map(c=>c.id),['sdk-call-1','sdk-call-1'])
})
