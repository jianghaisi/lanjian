import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { type TestContext } from 'node:test'
import { ShadowImportService } from '../../../src/main/modules/library/application/shadow-import-service'
import { WORKSPACE_DATABASE_RELATIVE_PATH } from '../../../src/main/core/ports/workspace-database'
import type { WritingAgentRequest, WritingAgentTurn } from '../../../src/contracts/index'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'
import { DocumentService } from '../../../src/main/modules/manuscript/application/document-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../../src/main/modules/library/application/legacy-workspace-source'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'
import { WritingAgentService, type WritingAgentPreparedRun } from '../../../src/main/modules/assistant/application/writing-agent-service'
import { WritingAgentTaskService } from '../../../src/main/modules/assistant/application/writing-agent-task-service'
import { AgentToolRegistry } from '../../../src/main/modules/assistant/application/agent-tool-registry'

const codec = {
  available: () => true,
  encrypt: (value: string) => Buffer.from(value).toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString()
}

async function fixture(context: TestContext, run: (
  input: WritingAgentRequest,
  signal?: AbortSignal,
  prepared?: WritingAgentPreparedRun,
  onDelta?: (delta: string, content: string) => void | Promise<void>
) => Promise<WritingAgentTurn>) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-writing-task-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  const projects = new ProjectService(new SettingsStore(join(root, 'user-data'), codec))
  const created = await projects.create({ parentPath: root, name: '写作任务测试', genre: '玄幻' })
  const documents = new DocumentService(projects)
  await documents.updateChapter(1, { title: '第一章', content: '旧句。' })
  const databases = new SqliteWorkspaceDatabaseFactory()
  const source = new CurrentProjectLegacyWorkspaceSource(projects, documents)
  const importer = new ShadowImportService(source, databases)
  await importer.import(await importer.preview())
  const remembered: WritingAgentTurn[] = []
  const runner = {
    prepare: async (input: WritingAgentRequest) => ({
      version: 1 as const,
      workItemId: (await projects.currentSummary()).id,
      workItemPath: await projects.currentPath(),
      skill: input.preferredSkill || 'continue',
      model: input.model || 'model-a',
      toolGrant: new AgentToolRegistry().grant({
        workItemId: (await projects.currentSummary()).id,
        workItemPath: await projects.currentPath(),
        chapterId: input.chapterId,
        skill: input.preferredSkill || 'continue'
      }),
      contexts: [{ task: 'prose' as const, label: '正文处理上下文', content: '冻结的正式作品上下文' }]
    }),
    run,
    remember: (turn: WritingAgentTurn) => { remembered.push(turn) },
    proposal: () => undefined
  } as unknown as WritingAgentService
  const service = new WritingAgentTaskService(runner, projects, databases)
  return { service, projects, databases, project: created.project, remembered, runner }
}

const request: WritingAgentRequest = {
  chapterId: 1,
  message: '改写这句话',
  currentDraft: '旧句。',
  model: 'model-a',
  preferredSkill: 'rewrite',
  selection: { start: 0, end: 3, text: '旧句。' }
}

for (const action of ['pause', 'cancel'] as const) {
  test(`${action} during context preparation stops the read and permits an explicit child run`, async context => {
    let modelCalls = 0
    const data = await fixture(context, async () => { modelCalls += 1; return turn(data.project.id) })
    const prepare = data.runner.prepare.bind(data.runner)
    let sourceSignal: AbortSignal | undefined
    let release!: () => void
    let entered!: () => void
    const reading = new Promise<void>(resolve => { entered = resolve })
    data.runner.prepare = async (input, signal) => {
      sourceSignal = signal
      await new Promise<void>(resolve => {
        release = resolve
        signal?.addEventListener('abort', () => resolve(), { once: true })
        entered()
      })
      signal?.throwIfAborted()
      return prepare(input, signal)
    }
    context.after(() => release?.())
    const started = await data.service.start({ operationId: randomUUID(), request })
    await reading
    const stopped = await data.service[action](started.id)
    assert.equal(sourceSignal?.aborted, true)
    assert.equal(stopped.status, action === 'pause' ? 'paused' : 'cancelled')
    assert.equal(stopped.artifact, undefined)
    assert.equal(stopped.partial, undefined)
    assert.equal(modelCalls, 0)
    data.runner.prepare = prepare
    const child = await data.service[action === 'pause' ? 'resume' : 'retry'](started.id, randomUUID())
    const completed = await waitFor(data.service, child.id, 'succeeded')
    assert.equal(completed.parentTaskRunId, started.id)
    assert.equal(modelCalls, 1)
    assert.equal((await data.service.status(started.id)).status, stopped.status)
    const documents = new DocumentService(data.projects)
    assert.equal((await documents.chapter(1)).content, '旧句。')
  })
}

test('a stale selected-book assertion rejects task creation before any checkpoint write', async context => {
  const data = await fixture(context, async () => turn(data.project.id))
  const staleOperationId = randomUUID()
  await assert.rejects(
    data.service.start({ operationId: staleOperationId, request: { ...request, expectedWorkItemId: 'another-book' } }),
    (error: { code?: string }) => error.code === 'CONFLICT'
  )
  assert.equal(await data.service.byOperation(staleOperationId), null)
  const started = await data.service.start({
    operationId: randomUUID(),
    request: { ...request, expectedWorkItemId: data.project.id }
  })
  assert.equal(started.workItemId, data.project.id)
  await waitFor(data.service, started.id, 'succeeded')
})

test('concurrent A/B streaming survives focus changes; same task IDs cannot cancel or persist into the other book', async context => {
  const gates = new Map<string, () => void>()
  const entered = new Map<string, AbortSignal | undefined>()
  const data = await fixture(context, async (_input, signal, prepared, delta) => {
    const root = await data.projects.currentPath()
    assert.equal(prepared?.workItemPath, root)
    await delta?.('片段', `只属于${root}的片段`)
    entered.set(root, signal)
    await new Promise<void>(resolve => { gates.set(root, resolve); signal?.addEventListener('abort', () => resolve(), { once: true }) })
    assert.equal(await data.projects.currentPath(), root)
    return turn((await data.projects.currentSummary()).id)
  })
  const id = '00000000-0000-4000-8000-000000000077'
  const service = new WritingAgentTaskService(data.runner, data.projects, data.databases, () => new Date(), () => id)
  context.after(() => { for (const release of gates.values()) release() })
  const first = await service.start({ operationId: randomUUID(), request })
  await waitFor(service, first.id, 'streaming')
  const second = (await data.projects.create({ parentPath: dirname(data.project.path), name: '并发乙书' })).project
  const documents = new DocumentService(data.projects)
  await documents.updateChapter(1, { title: '乙书一章', content: '旧句。' })
  const importer = new ShadowImportService(new CurrentProjectLegacyWorkspaceSource(data.projects, documents), data.databases)
  await importer.import(await importer.preview())
  await assert.rejects(service.cancel(first.id), { code: 'NOT_FOUND' })
  assert.equal(entered.get(data.project.path)?.aborted, false)
  const secondTask = await service.start({ operationId: randomUUID(), request })
  assert.equal(secondTask.id, first.id)
  await waitFor(service, secondTask.id, 'streaming')
  await service.pause(secondTask.id)
  assert.equal(entered.get(second.path)?.aborted, true)
  assert.equal(entered.get(data.project.path)?.aborted, false)
  gates.get(data.project.path)!()
  await data.projects.switch(data.project.path)
  const completed = await waitFor(service, first.id, 'succeeded')
  assert.equal(completed.turn?.workItemId, data.project.id)
  assert.ok(completed.partial?.content.includes(data.project.path))
  await data.projects.switch(second.path)
  const paused = await service.status(secondTask.id)
  assert.equal(paused.status, 'paused')
  assert.ok(paused.partial?.content.includes(second.path))
  assert.ok(!paused.partial?.content.includes(data.project.path))
  assert.equal((await documents.chapter(1)).content, '旧句。')
})

function turn(workItemId: string): WritingAgentTurn {
  return {
    id: '00000000-0000-4000-8000-000000000099',
    workItemId,
    chapterId: 1,
    createdAt: '2026-09-01T09:00:00.000Z',
    model: 'model-a',
    skill: { id: 'rewrite', label: '改写选段' },
    answer: '候选已完成。',
    tools: [],
    candidate: {
      mode: 'replaceSelection',
      content: '新句。',
      baseDraftFingerprint: 'a'.repeat(64),
      selection: request.selection,
      diff: [{ id: 'change-1', kind: 'change', before: '旧句。', after: '新句。' }]
    }
  }
}

test('persists a writing task and restores its artifact without rerunning the model', async (context) => {
  let calls = 0
  let workItemId = ''
  const data = await fixture(context, async () => { calls += 1; return turn(workItemId) })
  workItemId = (await data.projects.currentSummary()).id
  const operationId = '00000000-0000-4000-8000-000000000001'
  const started = await data.service.start({ operationId, request })
  const completed = await waitFor(data.service, started.id, 'succeeded')
  assert.equal(completed.turn?.candidate?.content, '新句。')
  assert.equal(completed.artifact?.status, 'complete')
  assert.equal(completed.contextPackage?.contextCount, 1)
  assert.equal(completed.contextPackage?.compilerVersion, 'context-compiler-v1')
  const database = await data.databases.openExisting(data.project.path)
  assert.ok(database)
  try {
    const frozen = JSON.parse(database.contextPackageForTask(started.id)!.contentJson)
    assert.equal(frozen.toolGrant.taskTemplate, 'writing-agent:rewrite')
    assert.equal(frozen.toolGrant.workItemId, workItemId)
    assert.equal(frozen.toolGrant.chapterId, 1)
    assert.ok(frozen.toolGrant.allowedToolIds.includes('candidateDiff'))
    const taskRecord = database.taskRun(started.id)!
    const checkpoint = JSON.parse(taskRecord.checkpointJson)
    assert.deepEqual(checkpoint.plan.steps, ['permission-check', 'compile-context', 'model', 'validate', 'artifact', 'approval'])
    assert.deepEqual(checkpoint.toolGrant, frozen.toolGrant)
  } finally { database.close() }
  assert.equal(calls, 1)
  assert.equal((await data.service.start({ operationId, request })).id, started.id)
  assert.equal(calls, 1)
  await assert.rejects(data.service.start({ operationId, request: { ...request, message: '另一条请求' } }), (error: { code?: string }) => error.code === 'CONFLICT')

  await assert.rejects(
    data.service.decide({ taskId: started.id, decision: 'applied', acceptedChangeIds: ['change-1'] }),
    (error: { code?: string }) => error.code === 'CONFLICT'
  )
  await assert.rejects(
    data.service.decide({ taskId: started.id, decision: 'discarded', reviewedChangeIds: ['unknown-change'] }),
    (error: { code?: string }) => error.code === 'VALIDATION_ERROR'
  )
  const decided = await data.service.decide({ taskId: started.id, decision: 'discarded', acceptedChangeIds: [], reviewedChangeIds: ['change-1'] })
  assert.equal(decided.artifact?.status, 'discarded')
  const decisionDatabase = await data.databases.openExisting(data.project.path)
  assert.ok(decisionDatabase)
  assert.deepEqual(JSON.parse(decisionDatabase.generationArtifactForTask(started.id)!.metadataJson).reviewedChangeIds, ['change-1'])
  decisionDatabase.close()

  const restarted = new WritingAgentTaskService(data.runner, data.projects, data.databases)
  const recovered = await restarted.recent(1)
  assert.equal(recovered[0].turn?.id, completed.turn?.id)
  assert.equal(recovered[0].artifact?.status, 'discarded')
  assert.ok(data.remembered.length >= 1)
  assert.equal(calls, 1)
})

test('persists a cursor insertion anchor with the task and completed artifact', async (context) => {
  let workItemId = ''
  const anchor = { offset: 3, before: '旧句。', after: '' }
  const data = await fixture(context, async () => ({
    id: '00000000-0000-4000-8000-000000000096',
    workItemId,
    chapterId: 1,
    createdAt: '2026-09-03T11:00:00.000Z',
    model: 'model-a',
    skill: { id: 'continue', label: '续写本章' },
    answer: '已从锚点生成续写候选。',
    tools: [],
    candidate: {
      mode: 'insertAtAnchor',
      content: '新段。',
      baseDraftFingerprint: 'b'.repeat(64),
      insertionAnchor: anchor,
      diff: [{ id: 'diff-1', kind: 'change', before: '', after: '新段。' }]
    }
  }))
  workItemId = (await data.projects.currentSummary()).id
  const anchoredRequest: WritingAgentRequest = {
    chapterId: 1,
    message: '从光标处继续',
    currentDraft: '旧句。',
    model: 'model-a',
    preferredSkill: 'continue',
    insertionAnchor: anchor
  }
  const started = await data.service.start({ operationId: '00000000-0000-4000-8000-000000000095', request: anchoredRequest })
  const completed = await waitFor(data.service, started.id, 'succeeded')
  assert.deepEqual(completed.insertionAnchor, anchor)
  assert.equal(completed.turn?.candidate?.mode, 'insertAtAnchor')
  const database = await data.databases.openExisting(data.project.path)
  assert.ok(database)
  const artifact = database.generationArtifactForTask(started.id, 'writing_agent_turn')
  assert.deepEqual(JSON.parse(artifact?.selectionAnchorJson || '{}'), { version: 1, insertionAnchor: anchor })
  database.close()
  const restarted = new WritingAgentTaskService(data.runner, data.projects, data.databases)
  assert.deepEqual((await restarted.recent(1))[0].insertionAnchor, anchor)
})

test('persists chapter-card discussion options as an artifact until the author adopts one', async (context) => {
  let workItemId = ''
  const data = await fixture(context, async () => ({
    id: '00000000-0000-4000-8000-000000000098',
    workItemId,
    chapterId: 1,
    createdAt: '2026-09-02T10:00:00.000Z',
    model: 'planning-model',
    skill: { id: 'plan', label: '讨论章卡' },
    answer: '两个方向都只作为候选。',
    tools: [],
    chapterCardOptions: [{ id: 'card-option-1', title: '误会升级', rationale: '用对白推进。', conflict: '双方误解同一条规则', beats: ['误填', '互相吐槽', '改正'] }]
  }))
  workItemId = (await data.projects.currentSummary()).id
  const planRequest: WritingAgentRequest = { chapterId: 1, message: '讨论冲突升级', currentDraft: '旧句。', model: 'planning-model', preferredSkill: 'plan' }
  const started = await data.service.start({ operationId: '00000000-0000-4000-8000-000000000097', request: planRequest })
  const completed = await waitFor(data.service, started.id, 'succeeded')
  assert.equal(completed.turn?.candidate, undefined)
  assert.equal(completed.turn?.chapterCardOptions?.[0].title, '误会升级')
  assert.equal(completed.artifact?.status, 'complete')
  const adopted = await data.service.decide({ taskId: started.id, decision: 'applied' })
  assert.equal(adopted.artifact?.status, 'applied')
  assert.equal(adopted.turn?.chapterCardOptions?.[0].conflict, '双方误解同一条规则')
})

test('keeps every discussion entrance out of formal SQLite data until a separate author adoption', async (context) => {
  let workItemId = ''
  const data = await fixture(context, async (input) => input.preferredSkill === 'plan'
    ? {
        id: '00000000-0000-4000-8000-000000000088',
        workItemId,
        chapterId: 1,
        createdAt: '2026-09-06T12:00:00.000Z',
        model: 'planning-model',
        skill: { id: 'plan', label: '讨论章卡' },
        answer: '这里只给出候选走法。',
        tools: [],
        chapterCardOptions: [{ id: 'card-option-1', title: '误会升级', rationale: '让对白承担推进。', beats: ['误填', '吐槽', '发现真相'] }]
      }
    : {
        id: '00000000-0000-4000-8000-000000000089',
        workItemId,
        chapterId: 1,
        createdAt: '2026-09-06T12:01:00.000Z',
        model: 'review-model',
        skill: { id: 'query', label: '作品问答' },
        answer: '人物目前仍在旧地点。',
        tools: []
      })
  workItemId = (await data.projects.currentSummary()).id
  const before = nonTaskDatabaseSnapshot(data.project.path)

  const query = await data.service.start({
    operationId: '00000000-0000-4000-8000-000000000081',
    request: { chapterId: 1, message: '卡住了，先分析人物现在的处境，不要续写。', currentDraft: '', preferredSkill: 'query' }
  })
  const answered = await waitFor(data.service, query.id, 'succeeded')
  assert.equal(answered.turn?.candidate, undefined)
  assert.equal(answered.turn?.chapterCardOptions, undefined)

  const planning = await data.service.start({
    operationId: '00000000-0000-4000-8000-000000000082',
    request: { chapterId: 1, message: '讨论三种后续走法，先不要改章卡。', currentDraft: '', preferredSkill: 'plan' }
  })
  const discussed = await waitFor(data.service, planning.id, 'succeeded')
  assert.equal(discussed.turn?.candidate, undefined)
  assert.equal(discussed.turn?.chapterCardOptions?.length, 1)

  // “已采用”这里只归档候选；正式章卡仍必须走独立、可预览的作者采用入口。
  await data.service.decide({ taskId: planning.id, decision: 'applied' })
  assert.deepEqual(nonTaskDatabaseSnapshot(data.project.path), before)

  const database = await data.databases.openExisting(data.project.path)
  assert.ok(database)
  try {
    assert.equal(database.recentTaskRuns('writing_agent', 1, 10).length, 2)
    assert.equal(database.generationArtifactForTask(query.id, 'writing_agent_turn')?.status, 'complete')
    assert.equal(database.generationArtifactForTask(planning.id, 'writing_agent_turn')?.status, 'applied')
  } finally { database.close() }
})

test('records the resolved SQLite model configuration identifier on a writing task', async (context) => {
  let workItemId = ''
  const data = await fixture(context, async () => turn(workItemId))
  workItemId = (await data.projects.currentSummary()).id
  let resolverCalls = 0
  const service = new WritingAgentTaskService(
    data.runner,
    data.projects,
    data.databases,
    undefined,
    () => '00000000-0000-4000-8000-000000000041',
    async () => { resolverCalls += 1; return '00000000-0000-4000-8000-000000000042' }
  )
  const started = await service.start({ operationId: '00000000-0000-4000-8000-000000000043', request })
  const database = await data.databases.openExisting(data.project.path)
  assert.ok(database)
  assert.equal(database.taskRun(started.id)?.modelConfigId, '00000000-0000-4000-8000-000000000042')
  database.close()
  await waitFor(service, started.id, 'succeeded')
  assert.equal(resolverCalls, 1)
})

test('persists cancellation and retries as a child run with a new attempt', async (context) => {
  let calls = 0
  let workItemId = ''
  const data = await fixture(context, async (_input, signal, _prepared, onDelta) => {
    calls += 1
    if (calls === 2) return turn(workItemId)
    const partial = '未完成草稿。'.repeat(100)
    await onDelta?.(partial, partial)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 10_000)
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')) }, { once: true })
    })
    return turn(workItemId)
  })
  workItemId = (await data.projects.currentSummary()).id
  const started = await data.service.start({ operationId: '00000000-0000-4000-8000-000000000002', request })
  const streaming = await waitFor(data.service, started.id, 'streaming')
  assert.ok((streaming.partial?.content.length || 0) > 500)
  assert.equal(streaming.contextPackage?.contextCount, 1)
  await assert.rejects(data.service.start({ operationId: '00000000-0000-4000-8000-000000000020', request }), (error: { code?: string }) => error.code === 'CONFLICT')
  const cancelled = await data.service.cancel(started.id)
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.partial?.content, streaming.partial?.content)
  await assert.rejects(data.service.decide({ taskId: started.id, decision: 'applied' }), (error: { code?: string }) => error.code === 'CONFLICT')
  const discardedPartial = await data.service.decide({ taskId: started.id, decision: 'discarded' })
  assert.equal(discardedPartial.partial?.status, 'discarded')
  const retried = await data.service.retry(started.id, '00000000-0000-4000-8000-000000000003')
  const completed = await waitFor(data.service, retried.id, 'succeeded')
  assert.equal(completed.attempt, 2)
  assert.equal(completed.parentTaskRunId, started.id)
  assert.equal(calls, 2)

  const deletable = await data.service.start({ operationId: '00000000-0000-4000-8000-000000000004', request })
  await waitFor(data.service, deletable.id, 'streaming')
  const cancelledForDeletion = await data.service.cancel(deletable.id)
  assert.equal(cancelledForDeletion.partial?.status, 'partial')
  const dismissed = await data.service.dismiss(deletable.id)
  assert.equal(dismissed.partial?.status, 'discarded')
  assert.ok(!(await data.service.recent(1)).some((task) => task.id === deletable.id))
})

for (const change of ['manuscript', 'model connection'] as const) {
  test(`returns the persisted retry receipt after changing the ${change}`, async context => {
    let calls = 0
    let resolverCalls = 0
    let connectionAvailable = true
    const data = await fixture(context, async () => {
      calls += 1
      if (calls === 1) throw new Error('provider unavailable')
      return turn(data.project.id)
    })
    const source = new CurrentProjectLegacyWorkspaceSource(data.projects, new DocumentService(data.projects))
    const snapshot = await source.snapshot()
    const initial = await data.databases.openExisting(data.project.path)
    assert.ok(initial)
    try { initial.activateSqlite(snapshot) } finally { initial.close() }
    const createService = () => new WritingAgentTaskService(
      data.runner, data.projects, data.databases, undefined, undefined,
      async () => {
        resolverCalls += 1
        if (!connectionAvailable) throw new Error('connection disabled')
        return 'model-a'
      }
    )
    const service = createService()
    const parent = await service.start({ operationId: randomUUID(), request })
    await waitFor(service, parent.id, 'failed')
    const operationId = randomUUID()
    const child = await service.retry(parent.id, operationId)
    const completed = await waitFor(service, child.id, 'succeeded')
    const database = await data.databases.openExisting(data.project.path)
    assert.ok(database)
    let manuscript
    try {
      if (change === 'manuscript') {
        database.writeFormalChapter({ legacyChapterId: 1, title: '第一章', content: '作者后来修改的正文。', reason: 'manual' })
      } else {
        connectionAvailable = false
      }
      manuscript = database.formalChapter(1)
    } finally { database.close() }
    const resolutionsBeforeReplay = resolverCalls
    const restarted = createService()
    const replayed = await restarted.retry(parent.id, operationId)
    assert.equal(replayed.id, completed.id)
    assert.equal(replayed.status, 'succeeded')
    assert.deepEqual(replayed.turn, completed.turn)
    assert.equal(resolverCalls, resolutionsBeforeReplay)
    assert.equal(calls, 2)
    connectionAvailable = false
    await assert.rejects(restarted.retry(parent.id, randomUUID()), /connection disabled/)
    const after = await data.databases.openExisting(data.project.path)
    assert.ok(after)
    try {
      assert.equal(after.recentTaskRuns('writing_agent', 1, 10).length, 2)
      assert.deepEqual(after.formalChapter(1), manuscript)
      assert.equal(after.taskRun(parent.id)?.status, 'failed')
    } finally { after.close() }
  })
}

test('rejects retry operation keys belonging to a different parent or request', async context => {
  const data = await fixture(context, async () => { throw new Error('provider unavailable') })
  const first = await data.service.start({ operationId: randomUUID(), request })
  await waitFor(data.service, first.id, 'failed')
  const operationId = randomUUID()
  const child = await data.service.retry(first.id, operationId)
  await waitFor(data.service, child.id, 'failed')
  const second = await data.service.start({ operationId: randomUUID(), request })
  await waitFor(data.service, second.id, 'failed')
  await assert.rejects(data.service.retry(second.id, operationId), (error: { code?: string }) => error.code === 'CONFLICT')

  const mismatchedOperation = randomUUID()
  const database = await data.databases.openExisting(data.project.path)
  assert.ok(database)
  try {
    const parent = database.taskRun(second.id)!
    const checkpoint = JSON.parse(parent.checkpointJson)
    const mismatched = database.createTaskRun({
      id: randomUUID(), legacyChapterId: 1, taskType: 'writing_agent',
      parentTaskRunId: second.id, taskContract: parent.taskContract,
      idempotencyKey: mismatchedOperation, contentHash: parent.contentHash!,
      checkpointJson: JSON.stringify({ ...checkpoint, request: { ...request, message: '另一份请求' } })
    })
    database.transitionTaskRun({ id: mismatched.id, status: 'cancelled' })
  } finally { database.close() }
  await assert.rejects(data.service.retry(second.id, mismatchedOperation), (error: { code?: string }) => error.code === 'CONFLICT')
})

test('persists a native pause and resumes as a traceable resuming child run', async (context) => {
  let calls = 0
  let workItemId = ''
  const data = await fixture(context, async (_input, signal, _prepared, onDelta) => {
    calls += 1
    if (calls > 1) return turn(workItemId)
    const partial = '暂停前已经收到的片段。'.repeat(60)
    await onDelta?.(partial, partial)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 10_000)
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')) }, { once: true })
    })
    return turn(workItemId)
  })
  workItemId = (await data.projects.currentSummary()).id
  const started = await data.service.start({ operationId: '00000000-0000-4000-8000-000000000060', request })
  const streaming = await waitFor(data.service, started.id, 'streaming')
  const paused = await data.service.pause(started.id)
  assert.equal(paused.status, 'paused')
  assert.equal(paused.partial?.content, streaming.partial?.content)

  const database = await data.databases.openExisting(data.project.path)
  assert.ok(database)
  try {
    const stored = database.taskRun(started.id)
    assert.equal(stored?.status, 'paused')
    assert.equal(JSON.parse(stored?.checkpointJson || '{}').phase, 'paused')
  } finally { database.close() }

  const restarted = new WritingAgentTaskService(data.runner, data.projects, data.databases)
  assert.equal((await restarted.recent(1))[0].status, 'paused')
  const operationId = '00000000-0000-4000-8000-000000000061'
  const resumed = await restarted.resume(started.id, operationId)
  assert.equal(resumed.status, 'resuming')
  const completed = await waitFor(restarted, resumed.id, 'succeeded')
  assert.equal(completed.parentTaskRunId, started.id)
  assert.equal(completed.attempt, 2)
  assert.equal((await restarted.resume(started.id, operationId)).id, resumed.id)
  await assert.rejects(restarted.resume(started.id, '00000000-0000-4000-8000-000000000062'), (error: { code?: string }) => error.code === 'CONFLICT')
  assert.equal((await restarted.status(started.id)).status, 'paused')
  assert.equal(calls, 2)

  // UI history is capped, but idempotency and continuation ownership are not.
  const history = await data.databases.openExisting(data.project.path)
  assert.ok(history)
  try {
    for (let index = 0; index < 55; index++) {
      const old = history.createTaskRun({ id: randomUUID(), legacyChapterId: 1, taskType: 'writing_agent', idempotencyKey: randomUUID(), checkpointJson: JSON.stringify({ version: 1, phase: 'queued', workItemId, request }) })
      history.transitionTaskRun({ id: old.id, status: 'cancelled' })
    }
    assert.ok(!history.recentTaskRuns('writing_agent', 1, 50).some(task => task.id === resumed.id))
  } finally { history.close() }
  assert.equal((await restarted.resume(started.id, operationId)).id, resumed.id)
  assert.equal((await restarted.start({ operationId: '00000000-0000-4000-8000-000000000060', request })).id, started.id)
  await assert.rejects(restarted.resume(started.id, randomUUID()), (error: { code?: string }) => error.code === 'CONFLICT')
  assert.equal(calls, 2)
})

test('flushes the final buffered stream fragment before marking a task cancelled', async (context) => {
  let workItemId = ''
  let markBuffered!: () => void
  const buffered = new Promise<void>((resolve) => { markBuffered = resolve })
  const data = await fixture(context, async (_input, signal, _prepared, onDelta) => {
    await onDelta?.('开头。', '开头。')
    await onDelta?.('最后一小段。', '开头。最后一小段。')
    markBuffered()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 10_000)
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')) }, { once: true })
    })
    return turn(workItemId)
  })
  workItemId = (await data.projects.currentSummary()).id
  const started = await data.service.start({ operationId: '00000000-0000-4000-8000-000000000052', request })
  await buffered
  const beforeCancel = await data.service.status(started.id)
  assert.equal(beforeCancel.partial?.content, '开头。')
  const cancelled = await data.service.cancel(started.id)
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.partial?.content, '开头。最后一小段。')
})

for (const stage of ['context', 'partial', 'candidate', 'completion'] as const) {
  test(`a ${stage} storage failure preserves recovery evidence and allows explicit retry`, async context => {
    const marker = 'synthetic-private-sql-detail'
    const partial = '已收到且应保留的片段。'.repeat(70)
    const tail = '最后一小段。'
    let calls = 0
    const data = await fixture(context, async (_input, _signal, _prepared, onDelta) => {
      calls += 1
      await onDelta?.(partial, partial)
      await onDelta?.(tail, partial + tail)
      return turn(data.project.id)
    })
    const before = nonTaskDatabaseSnapshot(data.project.path)
    const databasePath = join(data.project.path, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/'))
    const trigger = {
      context: 'BEFORE INSERT ON context_packages',
      partial: "BEFORE UPDATE OF content ON generation_artifacts WHEN NEW.artifact_type = 'writing_agent_stream'",
      candidate: "BEFORE INSERT ON generation_artifacts WHEN NEW.artifact_type = 'writing_agent_turn'",
      completion: "BEFORE UPDATE OF status ON task_runs WHEN NEW.status = 'succeeded'"
    }[stage]
    const fault = new DatabaseSync(databasePath, { allowExtension: false })
    try { fault.exec(`CREATE TRIGGER writing_task_test_fault ${trigger} BEGIN SELECT RAISE(ABORT, '${marker}'); END`) }
    finally { fault.close() }
    const parent = await data.service.start({ operationId: randomUUID(), request })
    const failed = await waitFor(data.service, parent.id, 'failed')
    assert.equal(failed.error?.code, 'STORAGE_ERROR')
    assert.doesNotMatch(JSON.stringify(failed), new RegExp(marker))
    assert.equal(failed.artifact, undefined)
    assert.equal(failed.turn, undefined)
    assert.equal(failed.partial?.content, stage === 'context' ? undefined : stage === 'partial' ? partial : partial + tail)
    if (stage !== 'context') assert.equal(failed.partial?.status, 'partial')
    assert.equal(calls, stage === 'context' ? 0 : 1)
    const stored = await data.databases.openExisting(data.project.path)
    assert.ok(stored)
    try {
      assert.doesNotMatch(JSON.stringify(stored.taskRun(parent.id)), new RegExp(marker))
      assert.equal(stored.generationArtifactForTask(parent.id, 'writing_agent_turn'), null)
      assert.equal(stored.contextPackageForTask(parent.id) !== null, stage !== 'context')
      assert.equal(stored.recentTaskRuns('writing_agent', 1, 10).length, 1)
    } finally { stored.close() }
    assert.deepEqual(nonTaskDatabaseSnapshot(data.project.path), before)
    const repair = new DatabaseSync(databasePath, { allowExtension: false })
    try { repair.exec('DROP TRIGGER writing_task_test_fault') } finally { repair.close() }
    const child = await data.service.retry(parent.id, randomUUID())
    const completed = await waitFor(data.service, child.id, 'succeeded')
    assert.equal(completed.parentTaskRunId, parent.id)
    assert.equal(completed.attempt, 2)
    assert.ok(completed.artifact)
    assert.equal(calls, stage === 'context' ? 1 : 2)
    assert.deepEqual(await data.service.status(parent.id), failed)
    assert.deepEqual(nonTaskDatabaseSnapshot(data.project.path), before)
  })
}

for (const phase of ['preparing', 'streaming'] as const) {
  test(`an independent AbortError during ${phase} becomes a recoverable failure`, async context => {
    const marker = 'synthetic-private-provider-detail'
    const partial = '中断前已收到的片段。'.repeat(70)
    const tail = '最后一小段。'
    let prepareCalls = 0
    let modelCalls = 0
    const data = await fixture(context, async (_input, signal, _prepared, onDelta) => {
      modelCalls += 1
      if (phase === 'streaming' && modelCalls === 1) {
        await onDelta?.(partial, partial)
        await onDelta?.(tail, partial + tail)
        assert.equal(signal?.aborted, false)
        throw new DOMException(marker, 'AbortError')
      }
      return turn(data.project.id)
    })
    const prepare = data.runner.prepare.bind(data.runner)
    data.runner.prepare = async (input, signal) => {
      prepareCalls += 1
      if (phase === 'preparing' && prepareCalls === 1) {
        assert.equal(signal?.aborted, false)
        throw new DOMException(marker, 'AbortError')
      }
      return prepare(input, signal)
    }
    const before = nonTaskDatabaseSnapshot(data.project.path)
    const parent = await data.service.start({ operationId: randomUUID(), request })
    const failed = await waitFor(data.service, parent.id, 'failed')
    assert.equal(failed.error?.code, 'GENERATION_FAILED')
    assert.equal(failed.error?.message, 'AI 任务未完成，请检查模型连接后重试。')
    assert.doesNotMatch(JSON.stringify(failed), new RegExp(marker))
    assert.equal(failed.artifact, undefined)
    assert.equal(failed.partial?.content, phase === 'streaming' ? partial + tail : undefined)
    assert.equal(prepareCalls, 1)
    assert.equal(modelCalls, phase === 'streaming' ? 1 : 0)
    const database = await data.databases.openExisting(data.project.path)
    assert.ok(database)
    try {
      assert.doesNotMatch(JSON.stringify(database.taskRun(parent.id)), new RegExp(marker))
      assert.equal(database.generationArtifactForTask(parent.id, 'writing_agent_turn'), null)
      assert.equal(database.recentTaskRuns('writing_agent', 1, 10).length, 1)
    } finally { database.close() }
    const child = await data.service.retry(parent.id, randomUUID())
    const completed = await waitFor(data.service, child.id, 'succeeded')
    assert.equal(completed.parentTaskRunId, parent.id)
    assert.equal(completed.attempt, 2)
    assert.equal(prepareCalls, 2)
    assert.equal(modelCalls, phase === 'streaming' ? 2 : 1)
    assert.deepEqual(await data.service.status(parent.id), failed)
    assert.deepEqual(nonTaskDatabaseSnapshot(data.project.path), before)
  })
}

test('never persists provider exception text that could echo a credential', async (context) => {
  const marker = 'LANJIAN-SECRET-WRITING-DO-NOT-PERSIST'
  const data = await fixture(context, async () => {
    throw new Error(`provider echoed Authorization: Bearer ${marker}`)
  })
  const started = await data.service.start({ operationId: '00000000-0000-4000-8000-000000000053', request })
  const failed = await waitFor(data.service, started.id, 'failed')
  assert.doesNotMatch(JSON.stringify(failed), new RegExp(marker))
  assert.equal(failed.error?.message, 'AI 任务未完成，请检查模型连接后重试。')

  const database = await data.databases.openExisting(data.project.path)
  assert.ok(database)
  try {
    const stored = database.taskRun(started.id)
    assert.ok(stored)
    assert.doesNotMatch(JSON.stringify(stored), new RegExp(marker))
    assert.equal(stored.errorMessage, 'AI 任务未完成，请检查模型连接后重试。')
  } finally { database.close() }
})

test('dismisses a failed recovery card without deleting its audit record or changing the manuscript', async (context) => {
  const data = await fixture(context, async () => { throw new Error('provider unavailable') })
  const started = await data.service.start({ operationId: '00000000-0000-4000-8000-000000000054', request })
  const failed = await waitFor(data.service, started.id, 'failed')
  assert.equal(failed.partial, undefined)
  const beforeDismiss = await data.databases.openExisting(data.project.path)
  assert.ok(beforeDismiss)
  const originalEndedAt = beforeDismiss.taskRun(started.id)?.endedAt
  beforeDismiss.close()

  const dismissed = await data.service.dismiss(started.id)
  assert.equal(dismissed.status, 'failed')
  assert.deepEqual(await data.service.recent(1), [])
  await assert.rejects(data.service.retry(started.id, '00000000-0000-4000-8000-000000000055'), (error: { code?: string }) => error.code === 'CONFLICT')

  const database = await data.databases.openExisting(data.project.path)
  assert.ok(database)
  try {
    const stored = database.taskRun(started.id)
    assert.equal(stored?.status, 'failed')
    assert.equal(stored?.endedAt, originalEndedAt)
    assert.match(JSON.parse(stored?.checkpointJson || '{}').dismissedAt, /^\d{4}-\d{2}-\d{2}T/)
    assert.equal(database.inspect().chapters[0].currentContent, '旧句。')
  } finally { database.close() }

  const restarted = new WritingAgentTaskService(data.runner, data.projects, data.databases)
  assert.deepEqual(await restarted.recent(1), [])
  assert.equal((await restarted.status(started.id)).status, 'failed')
})

test('turns orphaned active rows into interrupted tasks and keeps their request retryable', async (context) => {
  let workItemId = ''
  const data = await fixture(context, async () => turn(workItemId))
  workItemId = (await data.projects.currentSummary()).id
  const database = await data.databases.openExisting(data.project.path)
  assert.ok(database)
  database.createTaskRun({
    id: '00000000-0000-4000-8000-000000000010',
    legacyChapterId: 1,
    taskType: 'writing_agent',
    idempotencyKey: '00000000-0000-4000-8000-000000000011',
    checkpointJson: JSON.stringify({ version: 1, phase: 'model', workItemId, request })
  })
  database.transitionTaskRun({ id: '00000000-0000-4000-8000-000000000010', status: 'running' })
  database.close()

  const restarted = new WritingAgentTaskService(data.runner, data.projects, data.databases)
  const tasks = await restarted.recent(1)
  assert.equal(tasks[0].status, 'interrupted')
  assert.equal(tasks[0].error?.code, 'APP_RESTARTED')
  const retry = await restarted.retry(tasks[0].id, '00000000-0000-4000-8000-000000000012')
  assert.equal(retry.status, 'resuming')
  assert.equal((await waitFor(restarted, retry.id, 'succeeded')).attempt, 2)
})

test('native pause flushes buffered text and rejects late completion without changing the manuscript', async (context) => {
  let release!: () => void
  let ready!: () => void
  let ended!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const buffered = new Promise<void>(resolve => { ready = resolve })
  const providerEnded = new Promise<void>(resolve => { ended = resolve })
  let workItemId = ''
  const data = await fixture(context, async (_input, _signal, _prepared, onDelta) => {
    await onDelta?.('开头。', '开头。')
    await onDelta?.('末尾。', '开头。末尾。')
    ready()
    await gate
    // Deliberately misbehaving transport ignores abort and sends a late chunk.
    await onDelta?.('迟到。', '开头。末尾。迟到。')
    ended()
    return turn(workItemId)
  })
  context.after(() => { release(); data.service.abortForShutdown() })
  workItemId = (await data.projects.currentSummary()).id
  const before = nonTaskDatabaseSnapshot(data.project.path)
  const started = await data.service.start({ operationId: randomUUID(), request })
  await buffered
  const paused = await data.service.pause(started.id)
  assert.equal(paused.status, 'paused')
  assert.equal(paused.partial?.content, '开头。末尾。')
  assert.equal((await data.service.pause(started.id)).status, 'paused')
  await assert.rejects(data.service.retry(started.id, randomUUID()), (error: { code?: string }) => error.code === 'CONFLICT')
  release()
  await providerEnded
  const stillPaused = await data.service.status(started.id)
  assert.equal(stillPaused.status, 'paused')
  assert.equal(stillPaused.partial?.content, '开头。末尾。')
  assert.equal(stillPaused.artifact, undefined)
  assert.equal((await data.service.decide({ taskId: started.id, decision: 'discarded' })).partial?.status, 'discarded')
  assert.equal((await data.service.cancel(started.id)).status, 'cancelled')
  await assert.rejects(data.service.resume(started.id, randomUUID()), (error: { code?: string }) => error.code === 'CONFLICT')
  assert.deepEqual(nonTaskDatabaseSnapshot(data.project.path), before)
})

for (const action of ['pause', 'cancel'] as const) {
  test(`${action} ignores stream chunks arriving after abort but before the stop is persisted`, async context => {
    let ready!: () => void
    let release!: () => void
    let ended!: () => void
    const buffered = new Promise<void>(resolve => { ready = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const providerEnded = new Promise<void>(resolve => { ended = resolve })
    let abortChunk: void | Promise<void> = undefined
    let sourceSignal: AbortSignal | undefined
    let calls = 0
    const content = '开头。停止前的最后一段。'
    const data = await fixture(context, async (_input, signal, _prepared, onDelta) => {
      calls += 1
      if (calls > 1) return turn(data.project.id)
      sourceSignal = signal
      await onDelta?.('开头。', '开头。')
      await onDelta?.('停止前的最后一段。', content)
      // Deliver before pause/cancel can persist its terminal state, while the
      // old transport remains pending. A DB status check alone is too late.
      signal?.addEventListener('abort', () => {
        abortChunk = onDelta?.('停止后的迟到片段。', content + '停止后的迟到片段。')
      }, { once: true })
      ready()
      await gate
      await onDelta?.('旧请求又有输出。', content + '旧请求又有输出。')
      ended()
      return turn(data.project.id)
    })
    context.after(() => { data.service.abortForShutdown(); release() })
    const before = nonTaskDatabaseSnapshot(data.project.path)
    const parent = await data.service.start({ operationId: randomUUID(), request })
    await buffered
    const stopped = await data.service[action](parent.id)
    await abortChunk
    assert.equal(sourceSignal?.aborted, true)
    assert.equal(stopped.status, action === 'pause' ? 'paused' : 'cancelled')
    assert.equal(stopped.partial?.content, content)
    assert.equal(stopped.partial?.status, 'partial')
    assert.equal(stopped.artifact, undefined)
    assert.equal(stopped.turn, undefined)
    assert.equal(calls, 1)
    const child = await data.service[action === 'pause' ? 'resume' : 'retry'](parent.id, randomUUID())
    const completed = await waitFor(data.service, child.id, 'succeeded')
    assert.equal(completed.parentTaskRunId, parent.id)
    assert.equal(completed.attempt, 2)
    assert.equal(calls, 2)
    release()
    await providerEnded
    assert.deepEqual(await data.service.status(parent.id), stopped)
    assert.deepEqual(await data.service.status(child.id), completed)
    const restored = new WritingAgentTaskService(data.runner, data.projects, data.databases)
    assert.deepEqual(await restored.status(parent.id), stopped)
    assert.deepEqual(await restored.status(child.id), completed)
    assert.equal(calls, 2)
    assert.deepEqual(nonTaskDatabaseSnapshot(data.project.path), before)
    assert.equal((await new DocumentService(data.projects).chapter(1)).content, request.currentDraft)
  })
}

test('legacy pause validates the public book path and chapter instead of the internal project UUID', async (context) => {
  let workItemId = ''
  const data = await fixture(context, async () => turn(workItemId))
  workItemId = (await data.projects.currentSummary()).id
  const database = await data.databases.openExisting(data.project.path)
  assert.ok(database)
  const ids: string[] = []
  try {
    for (const checkpoint of [
      { version: 1, phase: 'paused', workItemId, request },
      { version: 1, phase: 'paused', workItemId: 'another-book', request },
      { version: 1, phase: 'paused', workItemId, request: { ...request, chapterId: 2 } },
      { version: 1, phase: 'paused', workItemId: database.inspect().project?.id, request }
    ]) {
      const task = database.createTaskRun({ id: randomUUID(), legacyChapterId: 1, taskType: 'writing_agent', idempotencyKey: randomUUID(), checkpointJson: JSON.stringify(checkpoint) })
      database.transitionTaskRun({ id: task.id, status: 'cancelled' })
      ids.push(task.id)
    }
  } finally { database.close() }
  const restored = new WritingAgentTaskService(data.runner, data.projects, data.databases)
  assert.equal((await restored.status(ids[0]!)).status, 'paused')
  for (const id of ids.slice(1)) {
    assert.equal((await restored.status(id)).status, 'cancelled')
    await assert.rejects(restored.resume(id, randomUUID()), (error: { code?: string }) => error.code === 'CONFLICT')
  }
  const child = await restored.resume(ids[0]!, randomUUID())
  assert.equal(child.status, 'resuming')
  assert.equal((await waitFor(restored, child.id, 'succeeded')).parentTaskRunId, ids[0])
})

test('restart interrupts an abandoned resuming child but preserves its paused parent and permits a new child', async (context) => {
  let workItemId = ''
  const data = await fixture(context, async () => turn(workItemId))
  workItemId = (await data.projects.currentSummary()).id
  const before = nonTaskDatabaseSnapshot(data.project.path)
  const database = await data.databases.openExisting(data.project.path)
  assert.ok(database)
  let parentId = ''
  let childId = ''
  try {
    const parent = database.createTaskRun({ id: randomUUID(), legacyChapterId: 1, taskType: 'writing_agent', idempotencyKey: randomUUID(), checkpointJson: JSON.stringify({ version: 1, phase: 'queued', workItemId, request }) })
    parentId = parent.id
    database.transitionTaskRun({ id: parent.id, status: 'paused', checkpointJson: JSON.stringify({ version: 1, phase: 'paused', workItemId, request }) })
    const child = database.createTaskRun({ id: randomUUID(), initialStatus: 'resuming', legacyChapterId: 1, taskType: 'writing_agent', parentTaskRunId: parent.id, attempt: 2, idempotencyKey: randomUUID(), checkpointJson: JSON.stringify({ version: 1, phase: 'resuming', workItemId, request }) })
    childId = child.id
  } finally { database.close() }
  const restored = new WritingAgentTaskService(data.runner, data.projects, data.databases)
  assert.equal((await restored.status(parentId)).status, 'paused')
  assert.equal((await restored.status(childId)).status, 'interrupted')
  const next = await restored.retry(childId, randomUUID())
  assert.equal(next.status, 'resuming')
  assert.equal(next.parentTaskRunId, childId)
  assert.equal((await waitFor(restored, next.id, 'succeeded')).attempt, 3)
  assert.equal((await restored.status(parentId)).status, 'paused')
  assert.deepEqual(nonTaskDatabaseSnapshot(data.project.path), before)
})

for (const boundary of ['artifact', 'stream'] as const) {
  test(`policy withdrawal before the serialized ${boundary} write leaves no late artifact`, async context => {
    let withdrawn = false, checked = 0
    const data = await fixture(context, async (_input, _signal, _prepared, onDelta) => {
      withdrawn = true
      if (boundary === 'stream') await onDelta?.('只读核查结果', '只读核查结果')
      return { id: 'readonly-run', workItemId: data.project.id, chapterId: 1, createdAt: new Date().toISOString(), model: 'model-a', skill: { id: 'query', label: '作品问答' }, answer: '本次检索未找到足够依据。', tools: [] }
    })
    data.runner.assertRunAuthorized = async () => { checked++; if (withdrawn) throw Error('withdrawn') }
    const before = nonTaskDatabaseSnapshot(data.project.path)
    const started = await data.service.start({ operationId: randomUUID(), request: { chapterId: 1, message: '只读核查资料', currentDraft: '', preferredSkill: 'query' } })
    const failed = await waitFor(data.service, started.id, 'failed')
    assert.equal(failed.artifact, undefined); assert.equal(failed.partial, undefined); assert.ok(checked > 0)
    assert.deepEqual(nonTaskDatabaseSnapshot(data.project.path), before)
  })
}

async function waitFor(service: WritingAgentTaskService, id: string, status: string): Promise<Awaited<ReturnType<WritingAgentTaskService['status']>>> {
  for (let index = 0; index < 100; index += 1) {
    const task = await service.status(id)
    if (task.status === status) return task
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`task did not reach ${status}`)
}

function nonTaskDatabaseSnapshot(projectPath: string): Record<string, unknown[]> {
  const database = new DatabaseSync(join(projectPath, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/')), { readOnly: true, allowExtension: false })
  try {
    const taskTables = new Set(['task_runs', 'context_packages', 'generation_artifacts'])
    const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>
    return Object.fromEntries(tables
      .filter(({ name }) => !taskTables.has(name))
      .map(({ name }) => [name, database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]))
  } finally { database.close() }
}
