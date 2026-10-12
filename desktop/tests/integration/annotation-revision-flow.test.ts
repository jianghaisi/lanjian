import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
import type { AnnotationRevisionStart, AnnotationRevisionTask } from '../../src/contracts/document-review/generation'
import type { DocumentRef } from '../../src/contracts/document-review/types'

async function fixture(t: TestContext, respond?: (input: TextCompletionInput, count: number) => Promise<string>, reviewResponse = '{"issues":[]}') {
  const parent = await realpath(tmpdir()), root = await mkdtemp(join(parent, 'lanjian-annotation-flow-'))
  const projects = new ProjectService(new SettingsStore(join(root, 'profile'), { available: () => false, encrypt: () => assert.fail(), decrypt: () => assert.fail() }))
  const { project } = await projects.create({ parentPath: root, name: '批注改稿合成书', genre: '悬疑' })
  const documents = new DocumentService(projects)
  await documents.updateChapter(1, { title: '甲章', content: '开端。' + '穿过街道。'.repeat(30) + '结尾。' })
  await documents.updateChapter(2, { title: '乙章', content: '不可更改的另一章。' })
  await documents.updateOutline('total', '全书总纲。')
  await documents.updateChapterOutline(1, '第一章纲。')
  const source = await new CurrentProjectLegacyWorkspaceSource(projects, documents).snapshot(), factory = new SqliteWorkspaceDatabaseFactory()
  const db = await factory.open(project.path); db.importSnapshot(source); db.activateSqlite(source)
  const book = db.promptProfile().workItemId
  const snapshot = db.documentReviewSnapshot({ workItemId: book, kind: 'body', legacyId: 1 })
  const annotation = db.createDocumentAnnotation({ document: snapshot.ref, operationId: randomUUID(), expectedRevision: snapshot.revision, expectedDraftRevision: null, title: snapshot.title, draftText: snapshot.content, start: 0, end: 2, body: '把开端和结尾的动作写清楚。' })
  let calls = 0, fingerprint = 'constraints-v1', model = 'fake-model'
  const ai = new AiClient({ resolve: async () => ({ kind: 'local', connectionId: LOCAL_CONNECTION_ID, connectionName: 'fake', profile: { connectionId: LOCAL_CONNECTION_ID, model, temperature: 0, topP: 1, maxTokens: 4000 } }),
    resolveConnection: async () => ({ kind: 'local', connectionId: LOCAL_CONNECTION_ID, connectionName: 'fake' }) }, {
    listModels: async () => ['fake-model'], ready: async () => true, limits: () => ({ contextTokens: 150000, systemReserveTokens: 1000, maxOutputTokens: 5000, recommendedOutputTokens: 4000 }), toolStep: async () => assert.fail(),
    complete: async input => { if (input.messages.some(m => typeof m.content === 'string' && m.content.startsWith('复核下方'))) return { content: reviewResponse }; calls++; assert.ok(input.messages[0]!.content.includes('叙事硬约束')); return { content: respond ? await respond(input, calls) : response(input) } }
  })
  const workspace = { currentRevisionConstraintsFingerprint: async () => fingerprint, contextBudgetPreferences: async () => ({ version: 1 as const, ...contextBudgetStartingSuggestions, pinnedEvidenceKeys: [], excludedEvidenceKeys: [] }),
    bookProfile: async () => ({ genre: '悬疑', subgenre: '' }), foundationStatus: async () => ({ readyForProse: true, missing: [] }), chapterContractVersion: async () => ({ fingerprint: 'existing-confirmed-static-fixture' }),
    promptContextCandidates: async () => [{ id: 'constraints', sourceType: 'test', sourceId: 'constraints', label: '境界和系统模板', content: '境界由本书定义。固定模板：[属性]。秘密不得提前披露。', authority: 'required' as const, truncationPolicy: 'never' as const }] }
  const makeService = () => new AnnotationRevisionService(projects, factory, workspace, ai), service = makeService()
  const selected = { origin: snapshot.ref, annotations: [{ id: annotation.id, revision: annotation.revision }] }
  const input = async (target = snapshot.ref, targets = [target]): Promise<AnnotationRevisionStart> => ({ ...selected, mode: targets.length === 1 && target.documentId === snapshot.ref.documentId ? 'current' : 'related', receipt: (await service.analyzeRelated(selected)).receipt, targets, target, operationId: randomUUID() })
  t.after(async () => { service.abortForShutdown(); await new Promise(r => setTimeout(r, 50)); db.close(); assert.equal(dirname(await realpath(root)), parent); await rm(root, { recursive: true, force: true }) })
  return { db, project, projects, documents, root, service, snapshot, selected, input, annotation, factory, makeService, calls: () => calls, changeContext: () => { fingerprint = 'constraints-v2' }, changeModel: () => { model = 'changed-model' } }
}
function response(input: TextCompletionInput) {
  const documentId = input.messages[1]!.content.match(/唯一目标文档 (\S+)（/)![1]
  return JSON.stringify({ documentId, changes: input.messages[1]!.content.includes('（total）') ? [{ quote: '全书总纲。', replacement: '全书修改后的总纲。' }] : [{ quote: '开端。', replacement: '新开端。' }, { quote: '结尾。', replacement: '新结尾。' }] })
}
async function finished(service: AnnotationRevisionService, id: string, expected = 'succeeded'): Promise<AnnotationRevisionTask> {
  for (let i = 0; i < 100; i++) { const value = await service.status(id); if (!['queued', 'running'].includes(value.status)) { assert.equal(value.status, expected, value.error || ''); return value } await new Promise(r => setTimeout(r, 10)) }
  return assert.fail('task did not finish')
}
function retain(db: Awaited<ReturnType<typeof fixture>>['db'], document: DocumentRef, blockId: string) {
  const draft = db.reviewDraft(document)!, permit = db.prepareReviewDecision({ document, blockId, operationId: randomUUID(), expectedDraftRevision: draft.revision })
  return db.acknowledgeReviewStage({ document, permitId: permit.id, resultingDraftHash: permit.resultingDraftHash })
}

test('explicit selected body and total tasks create review artifacts; two separate saves preserve source; other chapter and annotations stay unchanged', async t => {
  const f = await fixture(t), total = f.db.documentReviewSnapshot({ workItemId: f.snapshot.ref.workItemId, kind: 'total' }), untouched = f.db.formalChapter(2)!
  const bytes = await readFile(join(f.project.path, '.webnovel/workspace.sqlite'))
  const analysis = await f.service.analyzeRelated(f.selected)
  assert.ok(analysis.targets.some(t => t.document.kind === 'total'))
  assert.deepEqual(await readFile(join(f.project.path, '.webnovel/workspace.sqlite')), bytes)
  assert.equal(f.calls(), 0)
  const input = await f.input(f.snapshot.ref, [f.snapshot.ref, total.ref]), bodyTask = await f.service.start(input)
  assert.equal((await f.service.start(input)).id, bodyTask.id)
  await finished(f.service, bodyTask.id)
  const totalTask = await f.service.start(await f.input(total.ref, [f.snapshot.ref, total.ref])); await finished(f.service, totalTask.id)
  assert.equal(f.db.formalChapter(1)!.content, f.snapshot.content)
  const review = f.db.documentReviews(f.snapshot.ref)[0]!
  assert.equal(review.blocks.length, 2)
  for (const block of review.blocks) {
    const draft = retain(f.db, f.snapshot.ref, block.id)
    const saved = f.db.saveReviewedDraft({ document: f.snapshot.ref, expectedDraftRevision: draft.revision, expectedRevision: draft.baseRevision, operationId: randomUUID() })
    assert.equal(saved.receipt?.sourceLinks[0]?.taskId, bodyTask.id)
  }
  assert.deepEqual(f.db.formalChapter(2), untouched)
  assert.equal(f.db.documentAnnotation(f.snapshot.ref, f.annotation.id).status, 'open')
  assert.equal((await f.service.status(bodyTask.id)).committed, 2)
  // Changing the origin invalidates its still-pending linked total proposal.
  const other = f.db.documentReviews(total.ref)[0]!
  assert.throws(() => retain(f.db, total.ref, other.blocks[0]!.id), { code: 'CONFLICT' })
})
test('edited annotation invalidates prepare and saving already staged changes', async t => {
  const f = await fixture(t), task = await f.service.start(await f.input()); await finished(f.service, task.id)
  const review = f.db.documentReviews(f.snapshot.ref)[0]!, draft = retain(f.db, f.snapshot.ref, review.blocks[0]!.id)
  f.db.changeDocumentAnnotation('update', { document: f.snapshot.ref, id: f.annotation.id, operationId: randomUUID(), expectedAnnotationRevision: 1, body: '改变意见。' })
  assert.throws(() => retain(f.db, f.snapshot.ref, review.blocks[1]!.id), { code: 'CONFLICT' })
  assert.throws(() => f.db.saveReviewedDraft({ document: f.snapshot.ref, expectedDraftRevision: draft.revision, expectedRevision: draft.baseRevision, operationId: randomUUID() }), { code: 'CONFLICT' })
  assert.equal(f.db.formalChapter(1)!.content, f.snapshot.content)
  assert.equal((await f.service.status(task.id)).stale, true)
})

test('outline annotations can explicitly target an existing body without modifying the origin', async t => {
  const f = await fixture(t), origin = f.db.documentReviewSnapshot({ workItemId: f.snapshot.ref.workItemId, kind: 'total' })
  const annotation = f.db.createDocumentAnnotation({ document: origin.ref, operationId: randomUUID(), expectedRevision: origin.revision,
    expectedDraftRevision: null, title: origin.title, draftText: origin.content, start: 0, end: 2, body: '把对应正文的开端、结尾写清楚。' })
  const selection = { origin: origin.ref, annotations: [{ id: annotation.id, revision: annotation.revision }] }
  const analysis = await f.service.analyzeRelated(selection)
  assert.ok(analysis.targets.some(t => t.document.documentId === f.snapshot.ref.documentId))
  const task = await f.service.start({ ...selection, receipt: analysis.receipt, operationId: randomUUID(), mode: 'related', target: f.snapshot.ref, targets: [f.snapshot.ref] })
  await finished(f.service, task.id)
  assert.equal(f.db.documentReviewSnapshot(origin.ref).content, origin.content)
  assert.equal(f.db.formalChapter(1)!.content, f.snapshot.content)
  assert.equal(f.db.documentReviews(f.snapshot.ref)[0]!.blocks.length, 2)
  assert.equal(f.calls(), 1)
})

test('switching books during generation retains the captured book task and never writes the foreground book', async t => {
  let release!: () => void
  const f = await fixture(t, async input => { await new Promise<void>(resolve => { release = resolve }); return response(input) })
  const task = await f.service.start(await f.input())
  while (!release) await new Promise(resolve => setTimeout(resolve, 5))
  const { project: other } = await f.projects.create({ parentPath: f.root, name: '前台乙书', genre: '悬疑' })
  await f.documents.updateChapter(1, { title: '乙书', content: '乙书原文保持不变。' })
  await assert.rejects(f.service.status(task.id))
  release()
  for (let i = 0; i < 100 && f.db.taskRun(task.id)?.status === 'running'; i++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(f.db.taskRun(task.id)?.status, 'succeeded')
  assert.equal((await f.projects.currentSummary()).path, other.path)
  assert.equal((await f.documents.chapter(1)).content, '乙书原文保持不变。')
  await f.projects.importProject(f.project.path)
  assert.equal((await f.service.status(task.id)).status, 'succeeded')
  assert.equal(f.db.formalChapter(1)!.content, f.snapshot.content)
})
test('cancellation preserves original and explicit retry uses same frozen model; changed model/context blocks recovery', async t => {
  let release!: () => void
  const f = await fixture(t, async (input, count) => { if (count === 1) await new Promise<void>(resolve => { release = resolve }); return response(input) })
  const task = await f.service.start(await f.input())
  while (!release) await new Promise(r => setTimeout(r, 5))
  await f.service.cancel(task.id); release(); await finished(f.service, task.id, 'cancelled')
  const resumed = await f.service.resume({ id: task.id, operationId: randomUUID() }); await finished(f.service, resumed.id)
  assert.equal(f.db.formalChapter(1)!.content, f.snapshot.content)
  f.changeModel(); await assert.rejects(f.service.resume({ id: task.id, operationId: randomUUID() }), { code: 'CONFLICT' })
  f.changeContext(); await assert.rejects(f.service.assertContextCurrent(f.snapshot.ref, f.db.documentReviews(f.snapshot.ref)[0]!.blocks[0]!.id), { code: 'CONFLICT' })
})
test('ask_author survives service restart with zero calls, and only explicit validated answer creates continuation', async t => {
  const f = await fixture(t, async (input, count) => count === 1 ? JSON.stringify({ ask_author: { questions: [{ id: 'motive', prompt: '角色为何返回？', mode: 'text', required: true, options: [] }] } }) : response(input))
  const task = await f.service.start(await f.input()), waiting = await finished(f.service, task.id, 'waiting-input')
  const restarted = f.makeService(), restored = await restarted.status(task.id)
  assert.deepEqual(restored.question, waiting.question); assert.equal(f.calls(), 1)
  const answer = { runId: task.id, questionId: waiting.question!.id, questionVersion: 1, answerSubmissionId: randomUUID(), answers: [{ id: 'motive', chosenOptionIds: [], customText: '为了履行约定。', skipped: false }] }
  const next = await restarted.answer(answer); await finished(restarted, next.id)
  assert.equal((await restarted.answer(answer)).id, next.id)
  await assert.rejects(restarted.answer({ ...answer, answers: [{ ...answer.answers[0]!, customText: '换个原因。' }] }), { code: 'CONFLICT' })
  assert.equal(f.calls(), 2)
  assert.equal(f.db.formalChapter(1)!.content, f.snapshot.content)
})
test('forged target and stale analysis do not dispatch a model', async t => {
  const f = await fixture(t), input = await f.input(), other = f.db.documentReviewSnapshot({ workItemId: f.snapshot.ref.workItemId, kind: 'body', legacyId: 2 })
  await assert.rejects(f.service.start({ ...input, mode: 'related', target: other.ref, targets: [other.ref] }), { code: 'CONFLICT' })
  f.db.changeDocumentAnnotation('remove', { document: f.snapshot.ref, id: f.annotation.id, operationId: randomUUID(), expectedAnnotationRevision: 1 })
  await assert.rejects(f.service.start(input), { code: 'CONFLICT' })
  assert.equal(f.calls(), 0)
})


test('outline upstream gap retains original candidate and concrete report across restart without changing target', async t => {
  const report = JSON.stringify({ issues: [{ category: 'upstream-gap', quote: '', parentQuote: '', reason: '作者未说明失踪后的去向，不能在总纲改稿中自行补定。', needsAuthor: true }] })
  const f = await fixture(t, undefined, report), total = f.db.documentReviewSnapshot({ workItemId: f.snapshot.ref.workItemId, kind: 'total' })
  const task = await f.service.start(await f.input(total.ref, [f.snapshot.ref, total.ref]))
  const failed = await finished(f.service, task.id, 'failed')
  assert.equal(f.calls(), 1)
  assert.match(failed.error!, /作者未说明失踪/)
  assert.match(failed.rawResult!, /全书修改后的总纲/)
  assert.match(failed.rawResult!, /upstream-gap/)
  assert.equal(f.db.documentReviewSnapshot(total.ref).content, total.content)
  assert.equal(f.db.documentReviews(total.ref).length, 0)
  assert.equal((await f.makeService().status(task.id)).rawResult, failed.rawResult)
})
