import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkspaceDatabaseFactory, WorkspaceDatabasePort, WorkspaceTaskRunRecord } from '../../../src/main/core/ports/workspace-database'
import { projectTaskCenterItem, TaskCenterService } from '../../../src/main/modules/assistant/application/task-center-service'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'
import { ShadowImportService } from '../../../src/main/modules/library/application/shadow-import-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../../src/main/modules/library/application/legacy-workspace-source'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { DocumentService } from '../../../src/main/modules/manuscript/application/document-service'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'
import { createTaskContractSnapshot, taskContractHash } from '../../../src/main/modules/assistant/domain/task-template-contract'

const now = '2026-09-05T08:00:00.000Z'
const legacyPauseCheckpoint = (workItemId = 'book-1', chapterId = 17) => JSON.stringify({
  version: 1, phase: 'paused', workItemId, request: { chapterId, message: '暂停样本', currentDraft: '暂停前的正文' }
})
function task(overrides: Partial<WorkspaceTaskRunRecord> = {}): WorkspaceTaskRunRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111', projectId: 'book-1', legacyChapterId: 17,
    taskType: 'writing_agent', status: 'running', idempotencyKey: 'once', parentTaskRunId: null,
    baseBodyVersionId: null, contentHash: null, contextPackageId: null, modelConfigId: null, attempt: 1,
    taskContract: createTaskContractSnapshot('writing_agent'),
    checkpointJson: JSON.stringify({ phase: 'streaming', request: { message: '续写这一段，保留轻松的吐槽。' } }),
    errorCode: null, errorMessage: null, startedAt: now, endedAt: null, createdAt: now, updatedAt: now,
    ...overrides
  }
}

test('projects writing tasks into concise records with only legal actions', () => {
  const active = projectTaskCenterItem(task())
  assert.deepEqual(active.actions, ['pause', 'view', 'cancel'])
  assert.equal(active.detail, '续写这一段，保留轻松的吐槽。')

  const paused = projectTaskCenterItem(task({ status: 'cancelled', checkpointJson: legacyPauseCheckpoint() }))
  assert.equal(paused.status, 'paused')
  assert.deepEqual(paused.actions, ['resume', 'view', 'cancel'])

  const failed = projectTaskCenterItem(task({ status: 'failed', errorMessage: '连接暂时不可用' }))
  assert.deepEqual(failed.actions, ['retry', 'view'])

  for (const taskType of ['idea_generation', 'outline_expansion', 'fact_extraction']) {
    const recoverable = projectTaskCenterItem(task({ taskType, status: 'interrupted', legacyChapterId: null }))
    assert.deepEqual(recoverable.actions, ['retry', 'view'])
  }
})

test('bare, cross-book and cross-chapter checkpoint markers cannot impersonate a recoverable pause', () => {
  for (const checkpointJson of ['{"phase":"paused"}', legacyPauseCheckpoint('another-book'), legacyPauseCheckpoint('book-1', 18)]) {
    const item = projectTaskCenterItem(task({ status: 'cancelled', checkpointJson }))
    assert.equal(item.status, 'cancelled')
    assert.equal(item.actions.includes('resume'), false)
  }
})

test('keeps unsupported task kinds view-only and does not expose raw checkpoint context', () => {
  const item = projectTaskCenterItem(task({
    taskType: 'future_task', status: 'failed', legacyChapterId: null,
    checkpointJson: JSON.stringify({ secretContext: '不应展示的完整上下文', prompt: '不应展示的提示词' })
  }))
  assert.equal(item.taskType, 'other')
  assert.equal(item.detail, '保留的项目任务记录')
  assert.deepEqual(item.actions, ['view'])
  assert.doesNotMatch(JSON.stringify(item), /完整上下文|不应展示的提示词/)
  assert.deepEqual(projectTaskCenterItem(task({ taskType: 'future_task', status: 'running' })).actions, ['view'])
})

test('native pauses and live resuming children retain distinct legal controls without rewriting history', async () => {
  const parent = task({ status: 'paused', checkpointJson: '{"phase":"streaming"}' })
  const before = structuredClone(parent)
  assert.equal(projectTaskCenterItem(parent).status, 'paused', 'native pause must not depend on an old checkpoint marker')
  assert.deepEqual(projectTaskCenterItem(parent).actions, ['resume', 'view', 'cancel'])
  const child = task({ id: 'resuming-child', status: 'resuming', parentTaskRunId: parent.id, attempt: 2 })
  const database = {
    taskCenterTaskRuns: () => [{ ...child, hasContinuation: false }, { ...parent, hasContinuation: true }],
    close: () => undefined
  } as unknown as WorkspaceDatabasePort
  const items = await new TaskCenterService({ currentPath: async () => 'temporary-book' }, {
    openExisting: async () => database
  } as unknown as WorkspaceDatabaseFactory).list()
  assert.deepEqual(items[0].actions, ['pause', 'view', 'cancel'])
  assert.equal(items[0].status, 'resuming')
  assert.equal(items[0].parentTaskRunId, parent.id)
  assert.equal(items[1].status, 'paused')
  assert.equal(items[1].hasContinuation, true)
  assert.deepEqual(items[1].actions, ['view'])
  assert.deepEqual(parent, before)
  // Restarted continuations follow the same single-child rule as paused runs.
  assert.deepEqual(projectTaskCenterItem(task({ status: 'interrupted' }), true).actions, ['view'])
  assert.deepEqual(projectTaskCenterItem(task({ status: 'interrupted' }), false).actions, ['retry', 'view'])
  for (const status of ['paused', 'resuming'] as const) {
    assert.deepEqual(projectTaskCenterItem(task({ taskType: 'future_task', status })).actions, ['view'])
  }
  for (const taskType of ['idea_generation', 'outline_expansion', 'fact_extraction']) {
    assert.deepEqual(projectTaskCenterItem(task({ taskType, status: 'paused' })).actions, ['view'], 'only writing has a resume handler')
    assert.deepEqual(projectTaskCenterItem(task({ taskType, status: 'resuming' })).actions, ['view'], 'other task handlers cannot stop a resuming run')
  }
})

test('legacy contracts never offer an impossible retry or resume and explain the restart source', () => {
  for (const [taskType, source] of Object.entries({ writing_agent: '当前正文', idea_generation: '当前灵感', outline_expansion: '当前父级大纲', fact_extraction: '当前已确认正文' })) {
    const snapshot = { templateId: `legacy:${taskType}`, templateVersion: 0, templateHash: '0'.repeat(64), inputSchemaJson: '{}', outputSchemaJson: '{}', allowedOperationsJson: '[]', forbiddenOperationsJson: '["*"]' }
    const taskContract = { ...snapshot, contractHash: taskContractHash(snapshot) }
    for (const status of ['failed', 'interrupted', 'cancelled'] as const) {
      const original = task({ taskType, status, taskContract })
      const before = structuredClone(original)
      const item = projectTaskCenterItem(original)
      assert.deepEqual(item.actions, ['view'])
      assert.ok(item.detail.includes(source))
      assert.match(item.detail, /历史结果仍可查看/)
      assert.equal(item.hasContinuation, false)
      assert.deepEqual(original, before)
    }
    assert.deepEqual(projectTaskCenterItem(task({ taskType, taskContract })).actions, ['view', 'cancel'])
    assert.deepEqual(projectTaskCenterItem(task({ taskType, taskContract, status: 'succeeded' })).actions, ['view'])
    if (taskType === 'writing_agent') {
      const paused = task({ taskContract, status: 'cancelled', checkpointJson: legacyPauseCheckpoint() })
      assert.deepEqual(projectTaskCenterItem(paused).actions, ['view', 'cancel'])
      assert.equal(projectTaskCenterItem(paused).status, 'paused')
      const continued = projectTaskCenterItem(paused, true)
      assert.deepEqual(continued.actions, ['view'])
      assert.equal(continued.hasContinuation, true)
      assert.doesNotMatch(continued.detail, /重新发起/)
      const nativePause = projectTaskCenterItem(task({ taskContract, status: 'paused' }))
      assert.deepEqual(nativePause.actions, ['view', 'cancel'])
      assert.match(nativePause.detail, /当前正文重新发起/)
      assert.deepEqual(projectTaskCenterItem(task({ taskContract, status: 'resuming' })).actions, ['view', 'cancel'])
    }
  }
})

test('all task details fit the IPC budget including a long outline parent name', () => {
  const item = projectTaskCenterItem(task({ taskType: 'outline_expansion', checkpointJson: JSON.stringify({ request: { parentKey: '长'.repeat(400), count: 5 } }) }))
  assert.ok(item.detail.length <= 240)
})

test('retains old actionable tasks beyond recent history and finds hidden continuations without changing runs', async context => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-task-center-history-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const settings = new SettingsStore(join(root, 'settings'), { available: () => true, encrypt: value => value, decrypt: value => value })
  const projects = new ProjectService(settings)
  const created = await projects.create({ parentPath: root, name: '任务中心临时书', genre: '玄幻' })
  const documents = new DocumentService(projects)
  await documents.updateChapter(1, { title: '保留正文', content: '测试任务不改动这段正文。' })
  await documents.updateChapter(2, { title: '独立运行章', content: '运行任务只占用这一章的活动名额。' })
  await documents.updateChapter(3, { title: '独立续接章', content: '续接任务占用另一章，不与运行任务冲突。' })
  let tick = 0
  const databases = new SqliteWorkspaceDatabaseFactory(() => new Date(Date.UTC(2026, 8, 7) + tick++ * 1000))
  const source = new CurrentProjectLegacyWorkspaceSource(projects, documents)
  const importer = new ShadowImportService(source, databases)
  await importer.import(await importer.preview())
  const database = await databases.open(created.project.path)
  try {
    database.activateSqlite(await source.snapshot())
    const create = (id: string, parentTaskRunId?: string, chapterId = 1) => database.createTaskRun({ id, legacyChapterId: chapterId, taskType: 'writing_agent', idempotencyKey: id, checkpointJson: '{}', ...(parentTaskRunId ? { parentTaskRunId } : {}) })
    create('old-paused')
    database.transitionTaskRun({ id: 'old-paused', status: 'cancelled', checkpointJson: legacyPauseCheckpoint(created.project.id, 1) })
    create('continued-parent')
    database.transitionTaskRun({ id: 'continued-parent', status: 'cancelled', checkpointJson: legacyPauseCheckpoint(created.project.id, 1) })
    create('hidden-child', 'continued-parent')
    database.transitionTaskRun({ id: 'hidden-child', status: 'cancelled', checkpointJson: '{"dismissedAt":"2026-09-07T01:00:00Z"}' })
    // Keep one live writer per chapter; this read projection test must respect
    // the same active-slot guard as production, not bypass it with raw rows.
    create('old-running', undefined, 2)
    database.transitionTaskRun({ id: 'old-running', status: 'running' })
    create('native-paused')
    database.transitionTaskRun({ id: 'native-paused', status: 'paused' })
    create('native-continued-parent', undefined, 3)
    database.transitionTaskRun({ id: 'native-continued-parent', status: 'paused' })
    database.createTaskRun({ id: 'live-resuming-child', legacyChapterId: 3, taskType: 'writing_agent', idempotencyKey: 'live-resuming-child',
      parentTaskRunId: 'native-continued-parent', initialStatus: 'resuming', checkpointJson: '{}', attempt: 2 })
    for (let index = 0; index < 125; index++) {
      const id = `newer-history-${index}`
      create(id)
      database.transitionTaskRun({ id, status: 'cancelled' })
    }
    database.transitionTaskRun({ id: 'continued-parent', status: 'cancelled' })
    database.transitionTaskRun({ id: 'native-continued-parent', status: 'paused' })
    for (let index = 0; index < 20; index++) {
      const id = `dismissed-${index}`
      create(id)
      database.transitionTaskRun({ id, status: 'cancelled', checkpointJson: '{"dismissedAt":"2026-09-07T02:00:00Z"}' })
    }
    const before = database.recentProjectTaskRuns(200)
    const bodies = database.inspect().chapters
    const items = await new TaskCenterService(projects, databases).list()
    assert.deepEqual(items.slice(0, 4).map(item => item.id), ['live-resuming-child', 'old-running', 'native-paused', 'old-paused'], 'native and legacy actionable tasks must both survive long terminal history')
    assert.deepEqual(items[0]?.actions, ['pause', 'view', 'cancel'])
    assert.deepEqual(items[2]?.actions, ['resume', 'view', 'cancel'])
    assert.deepEqual(items[3]?.actions, ['resume', 'view', 'cancel'])
    assert.deepEqual(items.find(item => item.id === 'continued-parent')?.actions, ['view'])
    assert.equal(items.find(item => item.id === 'continued-parent')?.hasContinuation, true)
    assert.equal(items[3]?.hasContinuation, false)
    assert.deepEqual(items.find(item => item.id === 'native-continued-parent')?.actions, ['view'])
    assert.equal(items.find(item => item.id === 'native-continued-parent')?.status, 'paused')
    assert.equal(items.length, 100, 'dismissed entries must not consume the visible page budget')
    assert.equal(items.some(item => item.id === 'hidden-child' || item.id.startsWith('dismissed-')), false)
    assert.deepEqual(database.recentProjectTaskRuns(200), before)
    assert.deepEqual(database.inspect().chapters, bodies)
  } finally { database.close() }
})

test('hides duplicate resume after a paused task already has a continuation', async () => {
  const parent = task({ status: 'cancelled', checkpointJson: legacyPauseCheckpoint() })
  const child = task({
    id: '22222222-2222-4222-8222-222222222222', status: 'succeeded', attempt: 2,
    parentTaskRunId: parent.id, checkpointJson: JSON.stringify({ phase: 'completed' })
  })
  let closed = false
  const database = { taskCenterTaskRuns: () => [{ ...child, hasContinuation: false }, { ...parent, hasContinuation: true }], close: () => { closed = true } } as unknown as WorkspaceDatabasePort
  const databases = { openExisting: async () => database } as unknown as WorkspaceDatabaseFactory
  const service = new TaskCenterService({ currentPath: async () => 'book-1' }, databases)
  const items = await service.list()
  assert.deepEqual(items[1].actions, ['view'])
  assert.equal(items[1].hasContinuation, true)
  assert.equal(items[0].hasContinuation, false)
  assert.equal(closed, true)
})

test('hides writing-agent records dismissed from the assistant while retaining other history', async () => {
  const dismissed = task({
    status: 'failed',
    checkpointJson: JSON.stringify({ phase: 'failed', dismissedAt: '2026-09-05T08:30:00.000Z', request: { message: '不再显示的失败记录' } })
  })
  const visible = task({ id: '22222222-2222-4222-8222-222222222222', status: 'failed' })
  const database = { taskCenterTaskRuns: () => [dismissed, visible].map(record => ({ ...record, hasContinuation: false })), close: () => undefined } as unknown as WorkspaceDatabasePort
  const databases = { openExisting: async () => database } as unknown as WorkspaceDatabaseFactory
  const service = new TaskCenterService({ currentPath: async () => 'C:\\books\\book-1' }, databases)
  const items = await service.list()
  assert.deepEqual(items.map((item) => item.id), [visible.id])
})
