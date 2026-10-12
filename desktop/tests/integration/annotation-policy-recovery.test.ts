import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { officialCreativePackages } from '@lanjian/writing-plugin-package/official'
import type { CreativeSlot, PluginComposition } from '@lanjian/writing-plugin-contracts'
import { SqliteWorkspaceDatabaseFactory } from '../../src/main/platform/storage/workspace-database'
import { ProjectService } from '../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../src/main/platform/settings/settings-store'
import { DocumentService } from '../../src/main/modules/manuscript/application/document-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../src/main/modules/library/application/legacy-workspace-source'
import { AnnotationRevisionService } from '../../src/main/modules/document-review/application/annotation-revision-service'
import { AiClient } from '../../src/main/modules/models/application/ai-client'
import { LOCAL_CONNECTION_ID } from '../../src/contracts/models/local-model-contracts'
import type { TextCompletionInput } from '../../src/main/modules/models/domain/model-provider'
import { contextBudgetStartingSuggestions } from '../../src/contracts'
import type { AnnotationRevisionTask } from '../../src/contracts/document-review/generation'
import type { InstalledVersion } from '../../src/main/modules/writing-plugins/domain/installed'
import { createCreativePolicyProvider } from '../../src/main/modules/writing-plugins/runtime/creative-policy-provider'
import { AppError } from '../../src/main/core/errors/app-error'
import { WorkspaceWriteCoordinator } from '../../src/main/core/application/workspace-write-coordinator'
import { SqliteManuscriptService } from '../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { WorkspaceService } from '../../src/main/modules/library/application/workspace-service'

const question = JSON.stringify({ ask_author: { questions: [{ id: 'motive', prompt: '请核对修纲依据？', mode: 'text', required: true, options: [] }] } })
const sentinel = Error('capture request then stop: never return generated prose')
async function fixture(t: TestContext, options: { body?: boolean; disabled?: CreativeSlot; respond?: (input: TextCompletionInput, count: number) => Promise<string> } = {}) {
  const parent = await realpath(tmpdir()), root = await mkdtemp(join(parent, 'lanjian-annotation-policy-'))
  const projects = new ProjectService(new SettingsStore(join(root, 'profile'), { available: () => false, encrypt: () => assert.fail(), decrypt: () => assert.fail() }))
  const { project } = await projects.create({ parentPath: root, name: '批注方法隔离验证', genre: '悬疑' })
  const documents = new DocumentService(projects)
  await documents.updateOutline('total', '全书总纲。')
  // Retained static fixture only; every new body completion below throws the sentinel.
  await documents.updateChapter(1, { title: '已有静态章', content: '已有原文。' })
  await documents.updateChapterOutline(1, '第一章纲。')
  const source = await new CurrentProjectLegacyWorkspaceSource(projects, documents).snapshot(), factory = new SqliteWorkspaceDatabaseFactory()
  const db = await factory.open(project.path); db.importSnapshot(source); db.activateSqlite(source)
  const snapshot = db.documentReviewSnapshot({ workItemId: db.promptProfile().workItemId, kind: options.body ? 'body' : 'total', ...(options.body ? { legacyId: 1 } : {}) })
  const annotation = db.createDocumentAnnotation({ document: snapshot.ref, operationId: randomUUID(), expectedRevision: snapshot.revision,
    expectedDraftRevision: null, title: snapshot.title, draftText: snapshot.content, start: 0, end: 2, body: '核对当前依据，供作者逐处审阅。' })
  const pkg = structuredClone(officialCreativePackages().find(p => p.manifest.id.endsWith('creative-writing'))!)
  pkg.manifest.id = 'personal.annotation-method'; pkg.manifest.version = '1.0.0'
  pkg.manifest.contributions = pkg.manifest.contributions!.filter(c => c.kind === 'creative-policy' && c.slot === 'annotation-revision')
  const contribution = pkg.manifest.contributions[0]
  contribution.configSchema = { type: 'object', properties: { focus: { type: 'string', maxLength: 64 } }, required: ['focus'], additionalProperties: false }
  if (options.disabled === 'annotation-revision' && contribution.kind === 'creative-policy') { contribution.mode = 'disabled'; delete contribution.asset }
  const version: InstalledVersion = { manifest: pkg.manifest, digest: 'a'.repeat(64), files: [], installedAt: '2026-10-12T00:00:00.000Z', origin: 'local', grants: [] }
  const originalFiles = new Map([...pkg.files].map(([path, text]) => [path, new TextEncoder().encode(path === 'annotation-revision.md' ? 'ORIGINAL_ANNOTATION {{focus}}' : text)]))
  const newer = { ...structuredClone(version), digest: 'b'.repeat(64), manifest: { ...structuredClone(version.manifest), version: '1.1.0' } }
  const newerFiles = new Map(originalFiles); newerFiles.set('annotation-revision.md', new TextEncoder().encode('NEW_ANNOTATION {{focus}}'))
  let current = version, authorized = true, captures = 0, restores = 0, ready = false, contract = 'confirmed-static-fixture', fingerprint = 'constraints-v1', inputBudget = 120000
  const composition = (): PluginComposition => ({ revision: current === version ? 1 : 2, entries: [{ pluginId: pkg.manifest.id, digest: current.digest, contributionId: contribution.id, params: { focus: current === version ? 'ORIGINAL_PARAMS' : 'NEW_PARAMS' } }] })
  const load = async (v: InstalledVersion) => { if (!authorized) throw new AppError('CONFLICT', '原批注方法已经撤权。', { recoverable: true }); return v.digest === version.digest ? originalFiles : newerFiles }
  const provider = createCreativePolicyProvider(async () => { captures++; return { versions: [current], composition: composition() } }, load, async ref => {
    restores++; const v = ref.digest === version.digest ? version : newer; return { version: v, files: await load(v) }
  })
  const calls: TextCompletionInput[] = []
  const ai = new AiClient({ resolve: async () => ({ kind: 'local', connectionId: LOCAL_CONNECTION_ID, connectionName: 'fake', profile: { connectionId: LOCAL_CONNECTION_ID, model: 'fixed-model', temperature: 0, topP: 1, maxTokens: 4000 } }),
    resolveConnection: async () => ({ kind: 'local', connectionId: LOCAL_CONNECTION_ID, connectionName: 'fake' }) }, {
    listModels: async () => ['fixed-model'], ready: async () => true, limits: () => ({ contextTokens: 150000, systemReserveTokens: 1000, maxOutputTokens: 5000, recommendedOutputTokens: 4000 }), toolStep: async () => assert.fail(),
    complete: async input => {
      calls.push(input)
      if (options.body) { await options.respond?.(input, calls.length); throw sentinel }
      if (input.messages.some(m => m.content.startsWith('复核下方'))) return { content: '{"issues":[]}' }
      return { content: options.respond ? await options.respond(input, calls.length) : JSON.stringify({ documentId: snapshot.ref.documentId, changes: [{ quote: '全书总纲。', replacement: '全书修改后的总纲。' }] }) }
    }
  })
  const workspace = {
    currentRevisionConstraintsFingerprint: async () => fingerprint, bookProfile: async () => ({ genre: '悬疑', subgenre: '' }),
    foundationStatus: async () => ({ readyForProse: ready, missing: ready ? [] : ['当前大纲尚未确认'] }), chapterContractVersion: async () => ({ fingerprint: contract }),
    contextBudgetPreferences: async () => ({ version: 1 as const, ...contextBudgetStartingSuggestions, inputBudgetTokens: inputBudget, pinnedEvidenceKeys: [], excludedEvidenceKeys: [] }),
    promptContextCandidates: async (_chapter?: number, _task?: string, input?: { policyManaged?: boolean }) => { assert.equal(input?.policyManaged, true); return [{ id: 'formal-fixture', sourceType: 'formal', sourceId: 'formal', label: '正式事实及作者要求', content: 'AUTHOR_OVERRIDE\n境界：本书自定义。\n系统模板：[属性]。\n已存事实。', authority: 'required' as const, truncationPolicy: 'never' as const }] }
  }
  const services: AnnotationRevisionService[] = []
  const makeService = () => { const service = new AnnotationRevisionService(projects, factory, workspace, ai, undefined, provider); services.push(service); return service }
  const service = makeService(), selection = { origin: snapshot.ref, annotations: [{ id: annotation.id, revision: annotation.revision }] }
  const input = async () => ({ ...selection, mode: 'current' as const, receipt: (await service.analyzeRelated(selection)).receipt, targets: [snapshot.ref], target: snapshot.ref, operationId: randomUUID() })
  t.after(async () => { services.forEach(s => s.abortForShutdown()); await new Promise(r => setTimeout(r, 50)); db.close(); assert.equal(dirname(await realpath(root)), parent); await rm(root, { recursive: true, force: true }) })
  return { db, snapshot, annotation, service, makeService, input, calls, provider, projects, factory, project, captures: () => captures, restores: () => restores,
    update: () => { current = newer }, revoke: () => { authorized = false }, setReady: () => { ready = true }, changeContract: () => { contract = 'changed' }, changeContext: () => { fingerprint = 'constraints-v2' }, blockBudget: () => { inputBudget = 1 } }
}
async function finished(service: AnnotationRevisionService, id: string, expected = 'succeeded'): Promise<AnnotationRevisionTask> {
  for (let i = 0; i < 200; i++) { const value = await service.status(id); if (!['queued', 'running'].includes(value.status)) { assert.equal(value.status, expected, value.error || ''); return value } await new Promise(r => setTimeout(r, 10)) }
  return assert.fail('task did not finish')
}
function answer(task: AnnotationRevisionTask) {
  return { runId: task.id, questionId: task.question!.id, questionVersion: 1, answerSubmissionId: randomUUID(), answers: [{ id: 'motive', chosenOptionIds: [], customText: '只核对当前资料。', skipped: false }] }
}

test('annotation replacement is a required budgeted method; actual generation and review share provenance without old methods or formal writes', async t => {
  const f = await fixture(t), task = await f.service.start(await f.input()); await finished(f.service, task.id)
  assert.equal(f.captures(), 1); assert.equal(f.calls.length, 2)
  for (const call of f.calls) { const text = JSON.stringify(call.messages); assert.match(text, /ORIGINAL_ANNOTATION ORIGINAL_PARAMS/); assert.match(text, /AUTHOR_OVERRIDE/); assert.match(text, /系统模板/); assert.doesNotMatch(text, /先识别修改的是全书、单卷还是单章|不同人物不能共用一套/) }
  const checkpoint = JSON.parse(f.db.taskRun(task.id)!.checkpointJson), method = checkpoint.context.included.find((i: { sourceType: string }) => i.sourceType === 'creative-policy')
  assert.equal(method.authority, 'required'); assert.equal(method.mode, 'full'); assert.ok(method.estimatedTokens > 0); assert.equal(checkpoint.creativePolicy.installed[0].digest, 'a'.repeat(64))
  assert.equal(f.db.documentReviewSnapshot(f.snapshot.ref).content, f.snapshot.content); assert.equal(f.db.documentAnnotation(f.snapshot.ref, f.annotation.id).status, 'open')
})

test('disabled annotation or insufficient method budget blocks before dispatch', async t => {
  const disabled = await fixture(t, { disabled: 'annotation-revision' }); await assert.rejects(disabled.service.start(await disabled.input()), { code: 'FEATURE_UNAVAILABLE' }); assert.equal(disabled.calls.length, 0)
  const budget = await fixture(t); budget.blockBudget(); await assert.rejects(budget.service.start(await budget.input()), /预算不足/); assert.equal(budget.calls.length, 0)
})

test('waiting author task restores original package and parameters after service restart and current composition update', async t => {
  const f = await fixture(t, { respond: async () => question }), task = await f.service.start(await f.input()), waiting = await finished(f.service, task.id, 'waiting-input')
  const checkpoint = f.db.taskRun(task.id)!.checkpointJson; f.update()
  const restarted = f.makeService(); assert.deepEqual(await restarted.status(task.id), waiting); assert.equal(f.calls.length, 1)
  const submission = answer(waiting), next = await restarted.answer(submission); await finished(restarted, next.id, 'failed') // a second ambiguity is not silently answered
  assert.equal(f.captures(), 1); assert.equal(f.restores(), 1); assert.equal(f.calls.length, 2)
  assert.match(JSON.stringify(f.calls[1].messages), /ORIGINAL_ANNOTATION ORIGINAL_PARAMS/); assert.doesNotMatch(JSON.stringify(f.calls[1].messages), /NEW_ANNOTATION|NEW_PARAMS/)
  assert.equal((await restarted.answer(submission)).id, next.id); assert.equal(f.calls.length, 2)
  assert.equal(f.db.taskRun(task.id)!.checkpointJson, checkpoint); assert.equal(f.db.documentReviewSnapshot(f.snapshot.ref).content, f.snapshot.content)
})

test('late withdrawal discards received outline output and blocks all subsequent review or restore requests', async t => {
  let release!: () => void
  const f = await fixture(t, { respond: async () => { await new Promise<void>(r => { release = r }); return question } }), task = await f.service.start(await f.input())
  while (!release) await new Promise(r => setTimeout(r, 5))
  f.revoke(); release(); await finished(f.service, task.id, 'failed')
  assert.equal(f.calls.length, 1); assert.equal(f.db.generationArtifactForTask(task.id, 'annotation_revision'), null); assert.equal(f.db.documentReviews(f.snapshot.ref).length, 0)
  await assert.rejects(f.makeService().resume({ id: task.id, operationId: randomUUID() }), { code: 'CONFLICT' }); assert.equal(f.calls.length, 1)
})

test('old records remain readable but missing or altered method snapshot cannot dispatch on answer', async t => {
  const f = await fixture(t, { respond: async () => question }), task = await f.service.start(await f.input()), waiting = await finished(f.service, task.id, 'waiting-input')
  const original = JSON.parse(f.db.taskRun(task.id)!.checkpointJson), legacy = structuredClone(original); delete legacy.creativePolicy
  f.db.transitionTaskRun({ id: task.id, status: 'paused', checkpointJson: JSON.stringify(legacy) })
  assert.deepEqual((await f.makeService().status(task.id)).question, waiting.question)
  await assert.rejects(f.makeService().answer(answer(waiting)), /没有原方法快照/); assert.equal(f.calls.length, 1)
  const altered = structuredClone(original); altered.context.included.find((i: { sourceType: string }) => i.sourceType === 'creative-policy').content = 'forged method'
  f.db.transitionTaskRun({ id: task.id, status: 'paused', checkpointJson: JSON.stringify(altered) })
  await assert.rejects(f.makeService().answer(answer(waiting)), /原包不一致/); assert.equal(f.calls.length, 1)
})

test('body annotations require current author confirmation; positive request captures selected method and stops without returned prose', async t => {
  const f = await fixture(t, { body: true }); await assert.rejects(f.service.start(await f.input()), /尚未确认/); assert.equal(f.calls.length, 0)
  f.setReady(); const task = await f.service.start(await f.input()); await finished(f.service, task.id, 'failed')
  assert.equal(f.calls.length, 1); assert.match(JSON.stringify(f.calls[0].messages), /ORIGINAL_ANNOTATION ORIGINAL_PARAMS/)
  assert.equal(f.db.generationArtifactForTask(task.id, 'annotation_revision'), null); assert.equal(f.db.formalChapter(1)!.content, '已有原文。')
})

test('changed confirmed body contract blocks continuation before another request; no generated prose is returned', async t => {
  const f = await fixture(t, { body: true }); f.setReady(); const task = await f.service.start(await f.input()); await finished(f.service, task.id, 'failed')
  f.changeContract(); await assert.rejects(f.makeService().resume({ id: task.id, operationId: randomUUID() }), /章纲已经变化/); assert.equal(f.calls.length, 1)
})

test('formal constraints changing during an outline request rejects late output before review or candidate publication', async t => {
  const f = await fixture(t, { respond: async () => { f.changeContext(); return question } }), task = await f.service.start(await f.input()); await finished(f.service, task.id, 'failed')
  assert.equal(f.calls.length, 1); assert.equal(f.db.documentReviews(f.snapshot.ref).length, 0); assert.equal(f.db.documentReviewSnapshot(f.snapshot.ref).content, f.snapshot.content)
})

test('real Workspace and SQLite guard reads complete inside a held lane without initialization, mirror sync or formal changes', async t => {
  const f = await fixture(t), writes = new WorkspaceWriteCoordinator(), formal = new SqliteManuscriptService(f.factory, undefined, writes)
  const workspace = new WorkspaceService(f.projects, undefined, undefined, undefined, undefined, undefined, formal)
  const kinds = ['realms', 'power_system', 'cheat_system', 'system_ui'] as const
  const uninitialized = kinds.map(kind => f.db.formalWorkspaceConfigReady(kind))
  await writes.run(f.project.path, () => workspace.currentRevisionConstraintsFingerprint())
  assert.deepEqual(kinds.map(kind => f.db.formalWorkspaceConfigReady(kind)), uninitialized)
  await Promise.all([workspace.realms(), workspace.powerSystem(), workspace.cheatSystem(), workspace.systemTemplate(), workspace.promptProfile()])
  const before = { foundation: f.db.foundationConfig(), prompt: f.db.promptProfile(), configs: kinds.map(kind => f.db.workspaceConfig(kind)) }
  formal.readWorkspaceConfig = async () => assert.fail('Guard must not enter mirror/recovery reads')
  formal.promptProfile = async () => assert.fail('Guard must not initialize prompt profile')
  const initial = await workspace.currentRevisionConstraintsFingerprint()
  const fingerprint = await writes.run(f.project.path, () => workspace.currentRevisionConstraintsFingerprint())
  assert.equal(fingerprint, initial); assert.equal(writes.pending(f.project.path), false)
  assert.deepEqual({ foundation: f.db.foundationConfig(), prompt: f.db.promptProfile(), configs: kinds.map(kind => f.db.workspaceConfig(kind)) }, before)
})
