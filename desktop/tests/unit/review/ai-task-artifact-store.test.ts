import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { ShadowImportService } from '../../../src/main/modules/library/application/shadow-import-service'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'
import { DocumentService } from '../../../src/main/modules/manuscript/application/document-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../../src/main/modules/library/application/legacy-workspace-source'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'
import { createTaskContractSnapshot, taskContractHash } from '../../../src/main/modules/assistant/domain/task-template-contract'

const codec = {
  available: () => true,
  encrypt: (value: string) => Buffer.from(value).toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString()
}

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-ai-store-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  const settings = new SettingsStore(join(root, 'user-data'), codec)
  const projects = new ProjectService(settings)
  const created = await projects.create({ parentPath: root, name: '任务存储测试', genre: '玄幻' })
  const documents = new DocumentService(projects)
  await documents.updateChapter(1, { title: '第一章', content: '旧句。' })
  let tick = 0
  const databases = new SqliteWorkspaceDatabaseFactory(
    () => new Date(Date.parse('2026-09-01T08:00:00.000Z') + tick++ * 1000),
    () => `00000000-0000-4000-8000-${String(tick).padStart(12, '0')}`
  )
  const source = new CurrentProjectLegacyWorkspaceSource(projects, documents)
  const importer = new ShadowImportService(source, databases)
  await importer.import(await importer.preview())
  return { project: created.project, databases }
}

test('persists idempotent task runs and immutable generation artifacts independently from manuscript state', async (context) => {
  const { project, databases } = await fixture(context)
  const database = await databases.openExisting(project.path)
  assert.ok(database)
  const contentHash = createHash('sha256').update('旧句。').digest('hex')
  const queued = database.createTaskRun({
    id: 'task-1',
    legacyChapterId: 1,
    taskType: 'writing_agent',
    idempotencyKey: 'operation-1',
    contentHash,
    modelConfigId: 'gemini-test',
    checkpointJson: JSON.stringify({ phase: 'queued', request: { message: '改写' } })
  })
  assert.equal(queued.status, 'queued')
  assert.equal(queued.legacyChapterId, 1)
  assert.ok(queued.baseBodyVersionId)
  assert.equal(database.createTaskRun({
    id: 'duplicate-id', legacyChapterId: 1, taskType: 'writing_agent', idempotencyKey: 'operation-1',
    contentHash, checkpointJson: JSON.stringify({ phase: 'duplicate' })
  }).id, queued.id)
  assert.throws(() => database.createTaskRun({
    id: 'collision-id', legacyChapterId: 1, taskType: 'writing_agent', idempotencyKey: 'operation-1',
    contentHash: createHash('sha256').update('另一份正文').digest('hex'), checkpointJson: JSON.stringify({ phase: 'collision' })
  }), (error: { code?: string }) => error.code === 'CONFLICT')

  assert.equal(database.transitionTaskRun({ id: queued.id, status: 'preparing', checkpointJson: JSON.stringify({ phase: 'context' }) }).status, 'preparing')
  const contextContent = JSON.stringify({ version: 1, contexts: [{ label: '正文上下文', content: '正式设定' }] })
  const contextPackage = database.createContextPackage({
    id: 'context-1', taskRunId: queued.id, compilerVersion: 'writing-context-v1', contentJson: contextContent,
    contentHash: createHash('sha256').update(contextContent).digest('hex'), tokenBudget: 120_000, estimatedTokens: 12,
    truncationJson: JSON.stringify({ truncated: false, characterCount: 4, contextCount: 1 })
  })
  assert.equal(contextPackage.contentJson, contextContent)
  assert.equal(database.taskRun(queued.id)?.contextPackageId, contextPackage.id)
  assert.throws(() => database.createContextPackage({
    id: 'context-other', taskRunId: queued.id, compilerVersion: 'writing-context-v1', contentJson: JSON.stringify({ changed: true }),
    contentHash: createHash('sha256').update(JSON.stringify({ changed: true })).digest('hex'), tokenBudget: 120_000, estimatedTokens: 2,
    truncationJson: JSON.stringify({ truncated: false })
  }), (error: { code?: string }) => error.code === 'CONFLICT')
  assert.equal(database.transitionTaskRun({ id: queued.id, status: 'running', checkpointJson: JSON.stringify({ phase: 'model' }) }).status, 'running')
  const partialInput = {
    id: 'stream-1', taskRunId: queued.id, artifactType: 'writing_agent_stream', status: 'partial' as const,
    content: '新', contentHash: createHash('sha256').update('新').digest('hex'), schemaValid: true,
    metadataJson: JSON.stringify({ characters: 1 })
  }
  assert.equal(database.savePartialGenerationArtifact(partialInput).content, '新')
  assert.equal(database.savePartialGenerationArtifact({
    ...partialInput, content: '新句。', contentHash: createHash('sha256').update('新句。').digest('hex'),
    metadataJson: JSON.stringify({ characters: 3 })
  }).content, '新句。')
  assert.throws(() => database.savePartialGenerationArtifact({
    ...partialInput, content: '覆盖', contentHash: createHash('sha256').update('覆盖').digest('hex')
  }), (error: { code?: string }) => error.code === 'CONFLICT')
  const artifactContent = JSON.stringify({ id: 'turn-1', answer: '候选', candidate: { content: '新句。' } })
  const artifact = database.createGenerationArtifact({
    id: 'artifact-1',
    taskRunId: queued.id,
    artifactType: 'writing_agent_turn',
    status: 'complete',
    content: artifactContent,
    contentHash: createHash('sha256').update(artifactContent).digest('hex'),
    schemaValid: true,
    selectionAnchorJson: JSON.stringify({ start: 0, end: 3, text: '旧句。' }),
    metadataJson: JSON.stringify({ model: 'gemini-test' })
  })
  assert.equal(artifact.content, artifactContent)
  assert.equal(database.transitionTaskRun({ id: queued.id, status: 'succeeded', checkpointJson: JSON.stringify({ phase: 'approval' }) }).status, 'succeeded')
  assert.equal(database.updateGenerationArtifactStatus(artifact.id, 'applied', JSON.stringify({ acceptedChangeIds: ['change-1'] })).status, 'applied')
  assert.throws(() => database.transitionTaskRun({ id: queued.id, status: 'running' }), (error: { code?: string }) => error.code === 'CONFLICT')
  database.createTaskRun({
    id: 'task-atomic', legacyChapterId: 1, taskType: 'writing_agent', idempotencyKey: 'operation-atomic',
    checkpointJson: JSON.stringify({ phase: 'queued' })
  })
  database.transitionTaskRun({ id: 'task-atomic', status: 'running', checkpointJson: JSON.stringify({ phase: 'model' }) })
  assert.throws(() => database.completeTaskRunWithArtifact('task-atomic', JSON.stringify({ phase: 'approval' }), {
    id: 'artifact-atomic', taskRunId: 'task-atomic', artifactType: 'writing_agent_turn', status: 'complete',
    content: artifactContent, contentHash: '0'.repeat(64), schemaValid: true, metadataJson: JSON.stringify({ model: 'gemini-test' })
  }), (error: { code?: string }) => error.code === 'VALIDATION_ERROR')
  assert.equal(database.taskRun('task-atomic')?.status, 'running')
  assert.equal(database.generationArtifactForTask('task-atomic'), null)
  const atomic = database.completeTaskRunWithArtifact('task-atomic', JSON.stringify({ phase: 'approval' }), {
    id: 'artifact-atomic', taskRunId: 'task-atomic', artifactType: 'writing_agent_turn', status: 'complete',
    content: artifactContent, contentHash: createHash('sha256').update(artifactContent).digest('hex'), schemaValid: true,
    metadataJson: JSON.stringify({ model: 'gemini-test' })
  })
  assert.equal(atomic.task.status, 'succeeded')
  assert.equal(atomic.artifact.status, 'complete')
  database.createTaskRun({ id: 'task-idea', taskType: 'idea_generation', idempotencyKey: 'operation-idea', checkpointJson: '{}' })
  const projectTasks = database.recentProjectTaskRuns(10)
  assert.ok(projectTasks.some((task) => task.id === queued.id && task.taskType === 'writing_agent'))
  assert.ok(projectTasks.some((task) => task.id === 'task-idea' && task.taskType === 'idea_generation'))
  assert.equal(projectTasks.find((task) => task.id === queued.id)?.legacyChapterId, 1)
  assert.equal(database.inspect().chapters[0].currentContent, '旧句。')
  database.close()

  const reopened = await databases.openExisting(project.path)
  assert.ok(reopened)
  assert.equal(reopened.taskRun(queued.id)?.status, 'succeeded')
  assert.equal(reopened.generationArtifactForTask(queued.id)?.status, 'applied')
  reopened.close()
})

test('marks unfinished runs interrupted after restart without changing completed artifacts', async (context) => {
  const { project, databases } = await fixture(context)
  let database = await databases.openExisting(project.path)
  assert.ok(database)
  database.createTaskRun({
    id: 'task-running', legacyChapterId: 1, taskType: 'writing_agent', idempotencyKey: 'operation-running',
    checkpointJson: JSON.stringify({ phase: 'queued', request: { message: '继续写' } })
  })
  database.transitionTaskRun({ id: 'task-running', status: 'running', checkpointJson: JSON.stringify({ phase: 'model' }) })
  database.close()

  database = await databases.openExisting(project.path)
  assert.ok(database)
  assert.equal(database.interruptActiveTaskRuns(), 1)
  const interrupted = database.taskRun('task-running')
  assert.equal(interrupted?.status, 'interrupted')
  assert.equal(interrupted?.errorCode, 'APP_RESTARTED')
  assert.equal(database.interruptActiveTaskRuns(), 0)
  database.close()
})

test('freezes an exact task template contract and prevents retries from expanding it', async (context) => {
  const { project, databases } = await fixture(context)
  const database = await databases.openExisting(project.path)
  assert.ok(database)
  const contract = createTaskContractSnapshot('writing_agent', 'rewrite')
  const parent = database.createTaskRun({
    id: 'task-contract-parent', legacyChapterId: 1, taskType: 'writing_agent', idempotencyKey: 'operation-contract-parent',
    taskContract: contract, checkpointJson: JSON.stringify({ phase: 'queued' })
  })
  assert.deepEqual(parent.taskContract, contract)
  assert.equal(JSON.parse(parent.taskContract.inputSchemaJson).required.includes('currentDraft'), true)
  assert.equal(JSON.parse(parent.taskContract.forbiddenOperationsJson).includes('write:body-version'), true)

  // A retry inherits a stopped run, not a second concurrent same-chapter run.
  database.transitionTaskRun({ id: parent.id, status: 'cancelled' })

  const child = database.createTaskRun({
    id: 'task-contract-child', legacyChapterId: 1, taskType: 'writing_agent', idempotencyKey: 'operation-contract-child',
    parentTaskRunId: parent.id, attempt: 2, taskContract: parent.taskContract, checkpointJson: JSON.stringify({ phase: 'queued' })
  })
  assert.equal(child.taskContract.contractHash, parent.taskContract.contractHash)
  database.transitionTaskRun({ id: child.id, status: 'cancelled' })

  const operations = [...JSON.parse(contract.allowedOperationsJson), 'call:external-tool'].sort()
  const expandedWithoutHash = { ...contract, allowedOperationsJson: JSON.stringify(operations) }
  const { contractHash: _oldHash, ...hashable } = expandedWithoutHash
  const expanded = { ...expandedWithoutHash, contractHash: taskContractHash(hashable) }
  assert.throws(() => database.createTaskRun({
    id: 'task-contract-expanded', legacyChapterId: 1, taskType: 'writing_agent', idempotencyKey: 'operation-contract-expanded',
    parentTaskRunId: parent.id, attempt: 2, taskContract: expanded, checkpointJson: JSON.stringify({ phase: 'queued' })
  }), (error: { code?: string }) => error.code === 'CONFLICT')
  database.close()

  const path = join(project.path, '.webnovel', 'workspace.sqlite')
  const raw = new DatabaseSync(path, { allowExtension: false })
  assert.throws(() => raw.prepare("UPDATE task_runs SET allowed_operations_json = '[\"*\"]' WHERE id = ?").run(parent.id), /immutable/)
  assert.throws(() => raw.prepare(`
    INSERT INTO task_runs (
      id, project_id, chapter_id, task_type, status, idempotency_key, parent_task_run_id,
      base_body_version_id, content_hash, context_package_id, model_config_id, attempt, checkpoint_json,
      error_code, error_message, started_at, ended_at, created_at, updated_at,
      template_id, template_version, template_hash, input_schema_json, output_schema_json,
      allowed_operations_json, forbidden_operations_json, task_contract_hash
    ) SELECT
      'task-contract-raw-expanded', project_id, chapter_id, task_type, 'queued', 'operation-contract-raw-expanded', id,
      base_body_version_id, content_hash, NULL, model_config_id, attempt + 1, checkpoint_json,
      NULL, NULL, NULL, NULL, created_at, updated_at,
      template_id, template_version, template_hash, input_schema_json, output_schema_json,
      json_insert(allowed_operations_json, '$[#]', 'call:external-tool'), forbidden_operations_json, ?
    FROM task_runs WHERE id = ?
  `).run('a'.repeat(64), parent.id), /inherit the exact parent task contract/)
  raw.close()

  const reopened = await databases.openExisting(project.path)
  assert.ok(reopened)
  assert.deepEqual(reopened.taskRun(parent.id)?.taskContract, contract)
  reopened.close()
})
