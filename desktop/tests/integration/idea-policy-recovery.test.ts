import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { CompositionEntry } from '@lanjian/writing-plugin-contracts'
import { SqliteWorkspaceDatabaseFactory } from '../../src/main/platform/storage/workspace-database'
import { ProjectService } from '../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../src/main/platform/settings/settings-store'
import { DocumentService } from '../../src/main/modules/manuscript/application/document-service'
import { SqliteManuscriptService } from '../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../src/main/modules/library/application/legacy-workspace-source'
import { ShadowImportService } from '../../src/main/modules/library/application/shadow-import-service'
import { WorkspaceWriteCoordinator } from '../../src/main/core/application/workspace-write-coordinator'
import { IdeaGenerationService } from '../../src/main/modules/planning/application/idea-generation-service'
import { AiClient } from '../../src/main/modules/models/application/ai-client'
import { LOCAL_CONNECTION_ID } from '../../src/contracts/models/local-model-contracts'
import type { TextCompletionInput } from '../../src/main/modules/models/domain/model-provider'
import type { IdeaGenerationInput } from '../../src/contracts'
import { PluginPackageStore } from '../../src/main/modules/writing-plugins/adapters/package-store'
import { PluginDraftStore } from '../../src/main/modules/writing-plugins/adapters/draft-store'
import { buildPluginDraft } from '../../src/main/modules/writing-plugins/adapters/draft-builder'
import { bundledPackagePorts } from '../../src/main/modules/writing-plugins/adapters/bundled-packages'
import { PluginAuthoringService } from '../../src/main/modules/writing-plugins/application/authoring-service'
import { BundledPluginService } from '../../src/main/modules/writing-plugins/application/bundled-service'
import { PluginCompositionService } from '../../src/main/modules/writing-plugins/application/composition-service'
import { WritingPluginManager } from '../../src/main/modules/writing-plugins/application/plugin-manager'
import { createCreativePolicyProvider } from '../../src/main/modules/writing-plugins/runtime/creative-policy-provider'
import { createContributionContextProvider } from '../../src/main/modules/writing-plugins/runtime/contribution-context'
import { creativePolicyRun } from '../../src/main/modules/writing-plugins/domain/creative-policy'

const proposal = JSON.stringify({ options: [{ title: '资料讨论候选', content: '只比较原灵感的两种发展方向，尚未成为正式设定。', rationale: '保留原灵感核心，供作者审阅。' }] })
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
class ObservedWrites extends WorkspaceWriteCoordinator {
  calls = 0
  override run<T>(root: string, operation: () => Promise<T> | T): Promise<T> { this.calls++; return super.run(root, operation) }
}
async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-idea-policy-')))
  const services: IdeaGenerationService[] = [], releases: Array<() => void> = []
  let closeDatabase = () => {}
  t.after(async () => { releases.forEach(r => r()); services.forEach(s => s.abortForShutdown()); await new Promise(r => setTimeout(r, 20)); closeDatabase(); assert.equal(dirname(await realpath(root)), parent); await rm(root, { recursive: true, force: true }) })
  const projects = new ProjectService(new SettingsStore(join(root, 'profile'), { available: () => false, encrypt: () => assert.fail(), decrypt: () => assert.fail() }))
  const { project } = await projects.create({ parentPath: root, name: '灵感原方法隔离验证', genre: '悬疑' })
  const documents = new DocumentService(projects), databases = new SqliteWorkspaceDatabaseFactory()
  const legacy = new CurrentProjectLegacyWorkspaceSource(projects, documents), importer = new ShadowImportService(legacy, databases)
  await importer.import(await importer.preview())
  const writes = new ObservedWrites(), authority = new SqliteManuscriptService(databases, undefined, writes)
  await authority.activate(project.path, await legacy.snapshot())
  const idea = await authority.saveIdea(project.path, { title: '隔离灵感', content: '作者保存的想法，仅供比较。' })
  const db = (await databases.openExisting(project.path))!
  closeDatabase = () => db.close()
  let manager = new WritingPluginManager(new PluginPackageStore(root), async () => {})
  const drafts = new PluginDraftStore(root), authoring = new PluginAuthoringService(drafts, { build: buildPluginDraft, persist: b => drafts.persist(b), chooseExport: async () => null, choosePackage: async () => null, chooseSource: async () => null,
    installed: async (id, packageDigest) => { const loaded = await manager.loadAuthorized((await projects.currentSummary()).id, id, packageDigest); return { manifest: loaded.version.manifest, files: loaded.files } } }, manager)
  const bundled = new BundledPluginService(bundledPackagePorts(root), manager, authoring)
  const original = (await bundled.list()).find(p => p.manifest.id === 'lanjian.official.story-planning')!
  let draft = await bundled.derive({ pluginId: original.manifest.id, digest: original.digest })
  const manifest = JSON.parse(draft.manifestText)
  manifest.contributions = manifest.contributions.filter((c: { slot: string }) => ['idea-divergence', 'idea-synopsis', 'genre-guidance'].includes(c.slot))
  for (const c of manifest.contributions) c.configSchema = { type: 'object', properties: { focus: { type: 'string', maxLength: 100 }, ...(c.slot === 'genre-guidance' ? { genre: { type: 'string', maxLength: 100 }, subgenre: { type: 'string', maxLength: 100 } } : {}) }, required: ['focus'], additionalProperties: false }
  manifest.contributions.push({ id: 'original-fragment', kind: 'context-fragment', name: '原灵感片段', stages: ['planning'], text: 'ORIGINAL_FRAGMENT', configSchema: { type: 'object', properties: {}, additionalProperties: false } })
  draft = await authoring.save({ id: draft.id, revision: draft.revision, manifestText: JSON.stringify(manifest), files: draft.files.map(f => ['idea-divergence.md', 'idea-synopsis.md', 'genre-guidance.txt'].includes(f.path) ? { ...f, content: `ORIGINAL_${f.path} {{focus}}${f.path === 'genre-guidance.txt' ? ' {{genre}}' : ''}` } : f) })
  async function install() {
    const built = await authoring.build({ id: draft.id, revision: draft.revision }), preview = await authoring.preview({ id: draft.id, revision: draft.revision })
    let index = await manager.install(preview.planId); index = await manager.setEnabled(draft.pluginId, true, [], index.revision)
    await manager.setBookEnabled(project.id, draft.pluginId, true, index.revision)
    return manifest.contributions.map((c: { id: string }) => ({ pluginId: draft.pluginId, digest: built.digest, contributionId: c.id, params: c.id === 'original-fragment' ? {} : { focus: 'ORIGINAL_PARAMS' } })) as CompositionEntry[]
  }
  async function select(entries: CompositionEntry[]) {
    const composition = new PluginCompositionService(manager), preview = await composition.preview(project.id, entries, (await manager.list()).revision, async () => {})
    assert.deepEqual(preview.conflicts, []); await composition.apply(preview.planId)
  }
  const entries = await install(); await select(entries)
  let formal = 'AUTHOR_REQUIREMENT\n正式境界：自定义。\n固定系统：[属性]。', genre = '悬疑', model = 'model-original', captures = 0, restores = 0, repairs = 1
  const calls: TextCompletionInput[] = []
  let respond: (input: TextCompletionInput, count: number) => Promise<string> = async () => proposal
  let contextHook: (() => Promise<void>) | undefined
  const ai = new AiClient({ resolve: async () => ({ kind: 'local', connectionId: LOCAL_CONNECTION_ID, connectionName: 'fixture', profile: { connectionId: LOCAL_CONNECTION_ID, model, temperature: 0, topP: 1, maxTokens: 2000 } }), resolveConnection: async () => ({ kind: 'local', connectionId: LOCAL_CONNECTION_ID, connectionName: 'fixture' }) }, {
    listModels: async () => ['model-original', 'model-new'], ready: async () => true, limits: () => ({ contextTokens: 150000, systemReserveTokens: 1000, maxOutputTokens: 5000, recommendedOutputTokens: 2000 }), toolStep: async () => assert.fail('no tool/prose generation'),
    complete: async input => { calls.push(input); assert.doesNotMatch(JSON.stringify(input.messages), /生成候选正文|唯一允许处理的原文/); return { content: await respond(input, calls.length) } }
  })
  function make() {
    const capture = async () => { captures++; return manager.captureComposition((await projects.currentSummary()).id) }
    const policy = createCreativePolicyProvider(capture, async v => (await manager.loadAuthorized((await projects.currentSummary()).id, v.manifest.id, v.digest)).files, async ref => { restores++; return manager.loadAuthorized((await projects.currentSummary()).id, ref.pluginId, ref.digest) })
    const fragments = createContributionContextProvider(capture)
    const service = new IdeaGenerationService(projects, databases, ai, async (readOnly, selected) => {
      assert.equal(typeof readOnly, 'boolean'); selected?.resolve('genre-guidance', { genre, subgenre: '' })
      const context = await writes.read(project.path, async () => `${formal}\n${genre}\n非正式原片段：${JSON.stringify(await fragments('planning'))}`)
      await contextHook?.(); return context
    }, undefined, root => authority.retryMirrors(root), writes, async () => repairs, policy)
    services.push(service); return { service, policy }
  }
  let current = make()
  const request: IdeaGenerationInput = { operationId: randomUUID(), ideaId: idea.id, expectedUpdatedAt: idea.updatedAt, mode: 'synopsis', instruction: '仅讨论候选，不写正文。' }
  return { projects, project, authority, db, writes, root, entries, select, calls, request, idea, policy: () => current.policy, service: () => current.service, captures: () => captures, restores: () => restores,
    start: (mode: IdeaGenerationInput['mode'] = 'synopsis') => projects.runInCurrentBook(() => current.service.start({ ...request, operationId: randomUUID(), mode })),
    retry: (id: string, operationId = randomUUID()) => projects.runInCurrentBook(() => current.service.retry(id, operationId)),
    respond: (fn: typeof respond) => { respond = fn }, contextHook: (fn?: () => Promise<void>) => { contextHook = fn }, trackRelease: (release: () => void) => releases.push(release),
    revoke: async () => manager.setBookEnabled(project.id, draft.pluginId, false, (await manager.list()).revision), grantBook: async (id: string) => manager.setBookEnabled(id, draft.pluginId, true, (await manager.list()).revision), changeModel: () => { model = 'model-new' }, changeFormal: () => { formal += '\n改变的正式依据。' }, setFormal: (value: string) => { formal = value }, noRepair: () => { repairs = 0 },
    sourceChange: () => authority.saveIdea(project.path, { ...idea, content: '作者改了原灵感。' }),
    reopen: () => { manager = new WritingPluginManager(new PluginPackageStore(root), async () => {}); current = make(); return current.service },
    update: async () => { manifest.version = '1.3.1'; manifest.contributions.at(-1).text = 'NEW_FRAGMENT'; draft = await authoring.save({ id: draft.id, revision: draft.revision, manifestText: JSON.stringify(manifest), files: draft.files.map(f => ['idea-divergence.md', 'idea-synopsis.md', 'genre-guidance.txt'].includes(f.path) ? { ...f, content: `NEW_${f.path} {{focus}}${f.path === 'genre-guidance.txt' ? ' {{genre}}' : ''}` } : f) }); await select(await install()) },
    disable: async (slot: string) => { manifest.version = '1.3.1'; const contribution = manifest.contributions.find((c: { slot: string }) => c.slot === slot); contribution.mode = 'disabled'; delete contribution.asset; draft = await authoring.save({ id: draft.id, revision: draft.revision, manifestText: JSON.stringify(manifest), files: draft.files }); await select(await install()) }
  }
}
async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 10_000
  while (!predicate()) { if (Date.now() >= deadline) assert.fail(message); await new Promise(r => setTimeout(r, 5)) }
}
async function done(f: Awaited<ReturnType<typeof fixture>>, id: string, status = 'succeeded') {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) { const task = await f.service().status(id); if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(task.status)) { assert.equal(task.status, status, task.error ?? 'unexpected state'); return task } await new Promise(r => setTimeout(r, 5)) }
  return assert.fail('idea task did not settle')
}
async function failed(t: TestContext) {
  const f = await fixture(t); f.respond(async () => { throw Error('controlled provider failure') })
  const task = await f.start(); await done(f, task.id, 'failed'); return { f, task }
}

test('both real selected method assets and genre/fragment parameters reach actual outline requests without modifying formal sources', async t => {
  const f = await fixture(t), before = { ideas: f.db.listIdeas(), canon: f.db.listEntities(), outlines: f.db.formalOutlines(), chapters: f.db.formalChapters() }
  for (const mode of ['diverge', 'synopsis'] as const) {
    const task = await f.start(mode); await done(f, task.id)
    const messages = JSON.stringify(f.calls.at(-1)!.messages)
    assert.match(messages, new RegExp(`ORIGINAL_idea-${mode === 'diverge' ? 'divergence' : 'synopsis'}.md ORIGINAL_PARAMS`)); assert.match(messages, /ORIGINAL_genre-guidance.txt ORIGINAL_PARAMS 悬疑/)
    for (const required of ['ORIGINAL_FRAGMENT', 'AUTHOR_REQUIREMENT', '正式境界', '固定系统']) assert.ok(messages.includes(required), required)
    const checkpoint = JSON.parse(f.db.taskRun(task.id)!.checkpointJson)
    assert.ok(checkpoint.creativePolicy.installed.length); assert.doesNotMatch(JSON.stringify(checkpoint.creativePolicy), /apiKey|grant|path/)
  }
  assert.equal(f.calls.length, 2); assert.deepEqual({ ideas: f.db.listIdeas(), canon: f.db.listEntities(), outlines: f.db.formalOutlines(), chapters: f.db.formalChapters() }, before)
})

test('real SQLite and installed old package reopen and explicit child retry retain original methods and fragment after update and composition clearing', async t => {
  const { f, task } = await failed(t), before = f.db.taskRun(task.id)!
  f.service().abortForShutdown(); await f.update(); await f.select([]); f.reopen(); assert.equal(f.calls.length, 1)
  f.respond(async () => proposal); const operation = randomUUID(), child = await f.retry(task.id, operation); await done(f, child.id)
  assert.equal(f.db.taskRun(child.id)!.parentTaskRunId, task.id); assert.ok(f.restores() > 0); assert.equal(f.captures(), 1)
  assert.match(JSON.stringify(f.calls[1].messages), /ORIGINAL_idea-synopsis.md ORIGINAL_PARAMS/); assert.match(JSON.stringify(f.calls[1].messages), /ORIGINAL_FRAGMENT/); assert.doesNotMatch(JSON.stringify(f.calls[1].messages), /NEW_FRAGMENT|NEW_idea/)
  assert.deepEqual(f.db.taskRun(task.id), before); await f.revoke(); f.changeModel(); assert.equal((await f.retry(task.id, operation)).id, child.id); assert.equal(f.calls.length, 2)
})

test('revoke, changed model, formal material and original idea independently block retry before any new request', async t => {
  for (const reason of ['revoke', 'model', 'formal', 'source'] as const) {
    const { f, task } = await failed(t)
    if (reason === 'revoke') await f.revoke(); else if (reason === 'model') f.changeModel(); else if (reason === 'formal') f.changeFormal(); else await f.sourceChange()
    f.reopen(); await assert.rejects(f.retry(task.id)); assert.equal(f.calls.length, 1); assert.equal(f.db.generationArtifactForTask(task.id, 'idea_generation'), null)
  }
})

test('late withdrawn valid or malformed results publish no artifact and trigger no schema repair request', async t => {
  for (const response of [proposal, 'invalid JSON']) {
    const f = await fixture(t); f.respond(async () => { await f.revoke(); return response })
    const task = await f.start(); const result = await done(f, task.id, 'failed')
    assert.equal(result.proposal, null); assert.equal(result.rawResult, undefined); assert.equal(f.calls.length, 1); assert.equal(f.db.generationArtifactForTask(task.id, 'idea_generation'), null)
  }
})

test('model and source changes during asynchronous context reads reject the first actual send', async t => {
  for (const reason of ['model', 'source']) {
    const f = await fixture(t); let changed = false
    f.contextHook(async () => {
      if (!changed && !f.calls.length && f.db.recentTaskRuns('idea_generation').some(task => task.status === 'running')) {
        changed = true
        if (reason === 'model') f.changeModel(); else await f.sourceChange()
      }
    })
    const task = await f.start(); await done(f, task.id, 'failed')
    assert.equal(changed, true); assert.equal(f.calls.length, 0)
    assert.equal(f.db.generationArtifactForTask(task.id, 'idea_generation'), null)
  }
})

test('schema-only repair keeps the original selected asset and rejects withdrawal before a second repair', async t => {
  const f = await fixture(t); f.respond(async (_input, count) => count === 1 ? 'invalid JSON' : proposal)
  const task = await f.start(); await done(f, task.id); assert.equal(f.calls.length, 2)
  assert.match(JSON.stringify(f.calls[1].messages), /ORIGINAL_idea-synopsis.md ORIGINAL_PARAMS/); assert.equal(f.captures(), 1)
  const withdrawn = await fixture(t); let checks = 0
  withdrawn.respond(async () => 'invalid JSON')
  withdrawn.contextHook(async () => { if (withdrawn.calls.length && ++checks === 2) await withdrawn.revoke() })
  const late = await withdrawn.start(); await done(withdrawn, late.id, 'failed')
  assert.equal(withdrawn.calls.length, 1); assert.equal(withdrawn.db.generationArtifactForTask(late.id, 'idea_generation'), null)
})

test('actual serialized valid and invalid artifact commits reauthorize after another write held the lane', async t => {
  for (const response of [proposal, 'invalid JSON']) {
    const f = await fixture(t); f.noRepair(); f.respond(async () => response)
    let reached!: () => void, releasePost!: () => void, releaseLane!: () => void, laneEntered!: () => void
    const atPost = new Promise<void>(r => { reached = r }), postGate = new Promise<void>(r => { releasePost = r })
    const inLane = new Promise<void>(r => { laneEntered = r }), laneGate = new Promise<void>(r => { releaseLane = r })
    f.trackRelease(releasePost); f.trackRelease(releaseLane)
    let checks = 0
    f.contextHook(async () => { if (f.calls.length && ++checks === (response === proposal ? 1 : 2)) { reached(); await postGate } })
    const task = await f.start(); await atPost
    const blocker = f.writes.run(f.project.path, async () => { laneEntered(); await laneGate })
    await inLane; const queuedBefore = f.writes.calls; releasePost()
    await until(() => f.writes.calls > queuedBefore, 'artifact write never joined the occupied lane')
    await f.revoke(); releaseLane(); await blocker
    const result = await done(f, task.id, 'failed')
    assert.equal(result.proposal, null); assert.equal(result.rawResult, undefined); assert.equal(f.calls.length, 1)
    assert.equal(f.db.generationArtifactForTask(task.id, 'idea_generation'), null)
  }
})

test('disabled selected divergence, synopsis or genre slot fails before the first model request', async t => {
  for (const slot of ['idea-divergence', 'idea-synopsis', 'genre-guidance']) {
    const f = await fixture(t); await f.disable(slot)
    await assert.rejects(f.start(slot === 'idea-divergence' ? 'diverge' : 'synopsis'))
    assert.equal(f.calls.length, 0); assert.deepEqual(f.db.recentTaskRuns('idea_generation'), [])
  }
})

test('closed checkpoint fields, paired recovery and checksums reject corrupted real SQLite records without rewriting history', async t => {
  const { f, task } = await failed(t), original = f.db.taskRun(task.id)!
  for (const change of ['unknown', 'snapshot-unknown', 'missing', 'checksum', 'context', 'method']) {
    const checkpoint = JSON.parse(original.checkpointJson)
    if (change === 'unknown') checkpoint.authority = true
    if (change === 'snapshot-unknown') checkpoint.creativePolicy.grants = []
    if (change === 'missing') delete checkpoint.modelIdentity
    if (change === 'context') checkpoint.context += ' altered without new hash'
    if (change === 'method') checkpoint.methodContext += ' altered method'
    const json = JSON.stringify(checkpoint), damaged = f.db.createTaskRun({ id: randomUUID(), taskType: 'idea_generation', idempotencyKey: randomUUID(), taskContract: original.taskContract, contentHash: change === 'checksum' ? digest('unrelated') : digest(json), checkpointJson: json })
    f.db.transitionTaskRun({ id: damaged.id, status: 'cancelled' }); const before = f.db.taskRun(damaged.id)
    if (change === 'method') await assert.rejects(f.retry(damaged.id), /原灵感方法/)
    else await assert.rejects(f.service().status(damaged.id), /记录损坏/)
    assert.deepEqual(f.db.taskRun(damaged.id), before); assert.equal(f.calls.length, 1)
  }
})

test('actual serialized checkpoint byte budget rejects oversized escaped context before saving a task or sending', async t => {
  const f = await fixture(t); f.setFormal('\u0000'.repeat(190_000))
  await assert.rejects(f.start(), /保存预算/)
  assert.deepEqual(f.db.recentTaskRuns('idea_generation'), []); assert.equal(f.calls.length, 0)
})

test('original package recovery requires book-specific authorization and withdrawing A preserves B authorization', async t => {
  const { f, task } = await failed(t), checkpoint = JSON.parse(f.db.taskRun(task.id)!.checkpointJson)
  const { project: other } = await f.projects.create({ parentPath: f.root, name: '第二本隔离作品', genre: '悬疑' })
  await assert.rejects(f.projects.runInCurrentBook(() => f.policy().restore!(checkpoint.creativePolicy)))
  await f.grantBook(other.id)
  await f.projects.runInCurrentBook(async () => { const policy = await f.policy().restore!(checkpoint.creativePolicy); await policy.assertAuthorized?.() })
  await f.revoke()
  await f.projects.runInCurrentBook(async () => { const policy = await f.policy().restore!(checkpoint.creativePolicy); await policy.assertAuthorized?.() })
  await f.projects.switch(f.project.path)
  await assert.rejects(f.retry(task.id)); assert.equal(f.calls.length, 1)
})

test('genuine old five-field checkpoint stays readable but production retry requires a new task', async t => {
  const { f, task } = await failed(t), modern = f.db.taskRun(task.id)!, checkpoint = JSON.parse(modern.checkpointJson)
  for (const key of ['creativePolicy', 'methodContext', 'modelIdentity', 'bookIdentity', 'contextHash']) delete checkpoint[key]
  const json = JSON.stringify(checkpoint), old = f.db.createTaskRun({ id: randomUUID(), taskType: 'idea_generation', idempotencyKey: randomUUID(), taskContract: modern.taskContract, contentHash: digest(json), checkpointJson: json })
  f.db.transitionTaskRun({ id: old.id, status: 'cancelled' }); f.reopen()
  assert.equal((await f.service().status(old.id)).status, 'cancelled'); await assert.rejects(f.retry(old.id), /没有保存原方法/); assert.equal(f.calls.length, 1)
})
