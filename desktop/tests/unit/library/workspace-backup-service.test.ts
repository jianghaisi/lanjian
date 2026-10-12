import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { type TestContext } from 'node:test'
import { ShadowImportService } from '../../../src/main/modules/library/application/shadow-import-service'
import { WORKSPACE_BACKUP_MANIFEST, type WorkspaceBackupManifest } from '../../../src/main/modules/library/domain/workspace-backup'
import { WORKSPACE_DATABASE_RELATIVE_PATH, WORKSPACE_DATABASE_SCHEMA_VERSION } from '../../../src/main/core/ports/workspace-database'
import type { WritingAgentRequest, WritingAgentTurn } from '../../../src/contracts/index'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'
import { DocumentService } from '../../../src/main/modules/manuscript/application/document-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../../src/main/modules/library/application/legacy-workspace-source'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { ProjectAiService } from '../../../src/main/modules/models/application/project-ai-service'
import { ManuscriptExportService } from '../../../src/main/modules/manuscript/application/manuscript-export-service'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'
import { SqliteManuscriptService } from '../../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { WorkspaceBackupService } from '../../../src/main/modules/library/application/workspace-backup-service'
import { WritingAgentService } from '../../../src/main/modules/assistant/application/writing-agent-service'
import { WritingAgentTaskService } from '../../../src/main/modules/assistant/application/writing-agent-task-service'
import { CharacterStateService } from '../../../src/main/modules/characters/application/character-state-service'

const codec = {
  available: () => true,
  encrypt: (value: string) => Buffer.from(value).toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString()
}

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-backup-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  const projectParent = join(root, 'projects')
  const backupParent = join(root, "author's backups")
  const restoreParent = join(root, 'restored')
  await Promise.all([mkdir(projectParent), mkdir(backupParent), mkdir(restoreParent)])
  const settings = new SettingsStore(join(root, 'user-data'), codec)
  const projects = new ProjectService(settings)
  const created = await projects.create({ parentPath: projectParent, name: '备份测试作品', genre: '悬疑' })
  const fileDocuments = new DocumentService(projects)
  await fileDocuments.updateChapter(1, { title: '雨夜来信', content: '初稿。' })
  const databases = new SqliteWorkspaceDatabaseFactory()
  const source = new CurrentProjectLegacyWorkspaceSource(projects, fileDocuments)
  const importer = new ShadowImportService(source, databases)
  await importer.import(await importer.preview())
  const authority = new SqliteManuscriptService(databases)
  await authority.activate(created.project.path, await source.snapshot())
  const documents = new DocumentService(projects, undefined, authority)
  const before = await documents.chapter(1)
  await documents.updateChapter(1, {
    content: '雨落在旧城门上，信封里只有一枚生锈的钥匙。',
    expectedRevision: before.revision,
    reason: 'manual'
  })
  let sequence = 0
  const backup = new WorkspaceBackupService(
    databases,
    () => projects.currentPath(),
    async () => (await projects.currentSummary()).title,
    () => '0.2.0-test',
    () => new Date(`2026-09-01T04:00:${String(sequence).padStart(2, '0')}.000Z`),
    () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`
  )
  return { root, projectParent, backupParent, restoreParent, project: created.project, projects, settings, databases, authority, documents, backup }
}

test('creates a verified SQLite-consistent backup beside the project and excludes live database sidecars', async (context) => {
  const { root, project, projects, settings, documents, backupParent, backup } = await fixture(context)
  const secretMarker = 'LANJIAN-SECRET-BACKUP-DO-NOT-COPY'
  await new ProjectAiService(projects, settings).update({ apiKey: secretMarker })
  const result = await backup.create(backupParent)
  const readingCopy = join(root, 'clean-reading-copy.md')
  await new ManuscriptExportService(projects, documents).export(readingCopy)
  assert.equal(result.verified, true)
  assert.equal(result.storageMode, 'sqlite')
  assert.equal(result.chapterCount, 1)

  const manifest = JSON.parse(await readFile(join(result.backupPath, WORKSPACE_BACKUP_MANIFEST), 'utf8')) as WorkspaceBackupManifest
  assert.equal(manifest.appVersion, '0.2.0-test')
  assert.equal(manifest.bodyVersionCount, 2)
  assert.equal(manifest.files.filter((file) => file.kind === 'sqlite').length, 1)
  assert.ok(manifest.files.some((file) => file.relativePath === WORKSPACE_DATABASE_RELATIVE_PATH))
  assert.ok(!manifest.files.some((file) => file.relativePath.endsWith('-wal') || file.relativePath.endsWith('-shm')))
  assert.ok(!JSON.stringify(manifest).includes('apiKey'))
  assert.equal(await treeContainsText(project.path, secretMarker), false)
  assert.equal(await treeContainsText(result.backupPath, secretMarker), false)
  assert.equal((await readFile(readingCopy)).includes(Buffer.from(secretMarker)), false)
  assert.equal(await readFile(join(result.backupPath, '正文', '第1章-雨夜来信.md'), 'utf8'), '雨落在旧城门上，信封里只有一枚生锈的钥匙。')
  assert.equal(await readFile(join(project.path, '正文', '第1章-雨夜来信.md'), 'utf8'), '雨落在旧城门上，信封里只有一枚生锈的钥匙。')
})

test('previews without writes and restores a verified new project copy without changing the source', async (context) => {
  const { project, projects, databases, authority, backupParent, restoreParent, backup } = await fixture(context)
  const characters = new CharacterStateService(projects, authority)
  const seed = [{ name: '沈砚', role: '旧城调查者', arcSeed: '查清雨夜来信的来源' }]
  const seedPreview = await characters.previewPlanningSeeds('backup-seed', seed)
  await characters.adoptPlanningSeeds({
    proposalId: 'backup-seed', seeds: seed,
    candidateFingerprint: seedPreview.candidateFingerprint, currentFingerprint: seedPreview.currentFingerprint
  })
  const created = await backup.create(backupParent)
  const beforePreview = await treeFingerprint(created.backupPath)
  const preview = await backup.previewRestore(created.backupPath)
  assert.equal(preview.canRestore, true)
  assert.ok(preview.token)
  assert.equal(await treeFingerprint(created.backupPath), beforePreview)

  await writeFile(join(project.path, '正文', '第1章-雨夜来信.md'), '备份之后的源作品变化。', 'utf8')
  const restored = await backup.restore(preview.token!, restoreParent)
  assert.equal(restored.verified, true)
  assert.notEqual(restored.projectPath, project.path)
  assert.equal(await readFile(join(project.path, '正文', '第1章-雨夜来信.md'), 'utf8'), '备份之后的源作品变化。')
  assert.equal(await readFile(join(restored.projectPath, '正文', '第1章-雨夜来信.md'), 'utf8'), '雨落在旧城门上，信封里只有一枚生锈的钥匙。')
  const state = JSON.parse(await readFile(join(restored.projectPath, '.webnovel', 'state.json'), 'utf8')) as { project_info?: { title?: string } }
  assert.equal(state.project_info?.title, restored.projectName)
  const restoredDatabase = await databases.openExisting(restored.projectPath)
  assert.ok(restoredDatabase)
  assert.equal(restoredDatabase.inspect().project.name, restored.projectName)
  assert.equal(restoredDatabase.inspect().project.storageMode, 'sqlite')
  restoredDatabase.close()
  await projects.importProject(restored.projectPath)
  assert.equal((await projects.currentSummary()).title, restored.projectName)
  const restoredCharacters = await new CharacterStateService(projects, authority).state()
  assert.equal(restoredCharacters.workItemId, restored.projectPath)
  assert.deepEqual(restoredCharacters.anchors.map((anchor) => anchor.name), ['沈砚'])
  await assert.rejects(backup.restore(preview.token!, restoreParent), (error: { code?: string }) => error.code === 'CONFLICT')
})

test('a schema 40 backup remains restorable; only the independent restored copy upgrades to current schema', async context => {
  const { databases, backupParent, restoreParent, backup } = await fixture(context)
  const created = await backup.create(backupParent)
  const path = join(created.backupPath, WORKSPACE_DATABASE_RELATIVE_PATH)
  // This synthetic legacy backup contains no files-v1 content. Remove only the
  // explicitly known additive structures to reproduce a genuine old snapshot.
  const db = new DatabaseSync(path)
  try {
    removeEmptyReviewSchema(db)
    const definitions = db.prepare("SELECT type, name FROM sqlite_schema WHERE name LIKE 'manuscript_%' ORDER BY CASE type WHEN 'trigger' THEN 0 WHEN 'index' THEN 1 ELSE 2 END").all()
    for (const { type, name } of definitions) db.exec(`DROP ${String(type).toUpperCase()} "${String(name)}"`)
    db.exec(`DROP TABLE event_operation_receipts;
      DROP TABLE event_display_order_versions;
      DROP TABLE event_lifecycle_versions;
      DROP TRIGGER projects_schema_version_v${WORKSPACE_DATABASE_SCHEMA_VERSION}_after_insert;
      ALTER TABLE projects DROP COLUMN text_authority;
      CREATE TRIGGER projects_schema_version_v40_after_insert AFTER INSERT ON projects
      BEGIN UPDATE projects SET current_schema_version = 40 WHERE id = NEW.id; END;
      UPDATE projects SET current_schema_version = 40;
      DELETE FROM schema_migrations WHERE version > 40;
      PRAGMA user_version = 40;`)
  } finally { db.close() }
  const manifestPath = join(created.backupPath, WORKSPACE_BACKUP_MANIFEST)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as WorkspaceBackupManifest
  manifest.databaseSchemaVersion = 40
  const entry = manifest.files.find(file => file.kind === 'sqlite')!
  entry.sha256 = await hashFile(path); entry.size = (await stat(path)).size
  await writeFile(manifestPath, JSON.stringify(manifest))
  const before = await treeFingerprint(created.backupPath)
  const preview = await backup.previewRestore(created.backupPath)
  assert.ok(preview.token)
  const restored = await backup.restore(preview.token, restoreParent)
  const reopened = await databases.openExisting(restored.projectPath)
  assert.ok(reopened)
  try { assert.equal(reopened.inspect().schemaVersion, WORKSPACE_DATABASE_SCHEMA_VERSION); assert.equal(reopened.textAuthority(), 'legacy-sqlite') }
  finally { reopened.close() }
  assert.equal(await treeFingerprint(created.backupPath), before)
})

test('backup and new-copy restore preserve an uncheckpointed formal version and both external recovery originals', async context => {
  const { project, databases, documents, backupParent, restoreParent, backup } = await fixture(context)
  await documents.updateOutline('total', '全书总纲。')
  await documents.updateOutline(1, '第一卷：正式大纲。')
  await documents.updateChapterOutline(1, '正式章纲。', 1)
  const raw = new DatabaseSync(join(project.path, WORKSPACE_DATABASE_RELATIVE_PATH))
  try {
    raw.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;')
    const db = await databases.openExisting(project.path)
    assert.ok(db)
    const current = db.formalChapters()[0]!
    db.writeFormalChapter({ legacyChapterId: 1, title: current.title, content: '尚在 WAL 中的正式稿。', reason: 'manual', expectedRevision: current.revision })
    db.close()
    assert.ok((await readFile(join(project.path, `${WORKSPACE_DATABASE_RELATIVE_PATH}-wal`))).length > 0)
    await writeFile(join(project.path, '正文', '第1章-雨夜来信.md'), '外部未采用正文。')
    await writeFile(join(project.path, '大纲', '章纲', '第1章.md'), '外部未采用章纲。')
    const created = await backup.create(backupParent)
    const preview = await backup.previewRestore(created.backupPath)
    assert.equal(preview.canRestore, true)
    const restored = await backup.restore(preview.token!, restoreParent)
    assert.notEqual(restored.projectPath, project.path)
    for (const root of [project.path, created.backupPath, restored.projectPath]) {
      assert.equal(await readFile(join(root, '正文', '第1章-雨夜来信.md'), 'utf8'), '外部未采用正文。')
      assert.equal(await readFile(join(root, '大纲', '章纲', '第1章.md'), 'utf8'), '外部未采用章纲。')
    }
    const restoredDb = await databases.openExisting(restored.projectPath)
    assert.ok(restoredDb)
    assert.equal(restoredDb.formalChapters()[0]!.content, '尚在 WAL 中的正式稿。')
    assert.equal(restoredDb.formalOutlines().find(node => node.legacyKey === 'chapter-1')!.content, '正式章纲。')
    restoredDb.close()
  } finally { raw.close() }
})

test('rejects a changed backup during preview and issues no restore token', async (context) => {
  const { backupParent, backup } = await fixture(context)
  const created = await backup.create(backupParent)
  await writeFile(join(created.backupPath, '正文', '第1章-雨夜来信.md'), '被篡改的备份。', 'utf8')
  const preview = await backup.previewRestore(created.backupPath)
  assert.equal(preview.canRestore, false)
  assert.equal(preview.token, null)
  assert.ok(preview.blockers.some((blocker) => blocker.message.includes('校验')))
})

test('rechecks the backup after preview and leaves the restore destination empty when it changed', async (context) => {
  const { backupParent, restoreParent, backup } = await fixture(context)
  const created = await backup.create(backupParent)
  const preview = await backup.previewRestore(created.backupPath)
  assert.ok(preview.token)
  await writeFile(join(created.backupPath, '正文', '第1章-雨夜来信.md'), '核对之后发生变化。', 'utf8')
  await assert.rejects(backup.restore(preview.token!, restoreParent), (error: { code?: string }) => error.code === 'CONFLICT')
  assert.deepEqual(await readdir(restoreParent), [])
  await assert.rejects(backup.restore(preview.token!, restoreParent), (error: { code?: string }) => error.code === 'CONFLICT')
})

test('allows sibling backup targets but refuses to place backup or restore staging inside live data', async (context) => {
  const { project, backupParent, backup } = await fixture(context)
  const created = await backup.create(backupParent)
  await assert.rejects(backup.create(project.path), (error: { code?: string }) => error.code === 'VALIDATION_ERROR')
  const preview = await backup.previewRestore(created.backupPath)
  assert.ok(preview.token)
  await assert.rejects(backup.restore(preview.token!, created.backupPath), (error: { code?: string }) => error.code === 'VALIDATION_ERROR')
})

test('retains only this books marked automatic backups and never prunes a manual backup', async (context) => {
  const { backupParent, backup } = await fixture(context)
  const manual = await backup.create(backupParent)
  const first = await backup.createAutomatic(backupParent, 2)
  const second = await backup.createAutomatic(backupParent, 2)
  const third = await backup.createAutomatic(backupParent, 2)
  assert.equal(first.prunedCount, 0)
  assert.equal(second.prunedCount, 0)
  assert.equal(third.prunedCount, 1)
  const names = await readdir(backupParent)
  assert.ok(names.includes(manual.backupName))
  assert.equal(names.filter((name) => name.includes('岚笺自动备份')).length, 2)
})

test('changes the automatic backup fingerprint when formal manuscript data changes', async (context) => {
  const { documents, backup } = await fixture(context)
  const before = await backup.changeFingerprint()
  const chapter = await documents.chapter(1)
  await documents.updateChapter(1, { content: `${chapter.content}\n\n新增一段。`, expectedRevision: chapter.revision, reason: 'manual' })
  assert.notEqual(await backup.changeFingerprint(), before)
})

test('keeps automatic backup paths in local settings and resets stale runtime state when the folder changes', async (context) => {
  const { project, backupParent, restoreParent, settings } = await fixture(context)
  await settings.updateAutoBackup(project.path, { enabled: true, targetParentPath: backupParent, backupOnFirstOpen: true, intervalMinutes: 30, retentionCount: 8 })
  await settings.recordAutoBackup(project.path, { lastCheckedAt: '2026-09-01T04:00:00.000Z', lastSuccessAt: '2026-09-01T04:00:00.000Z', lastFingerprint: 'old' })
  assert.equal((await settings.autoBackup(project.path)).lastFingerprint, 'old')
  const moved = await settings.updateAutoBackup(project.path, { enabled: true, targetParentPath: restoreParent, backupOnFirstOpen: false, intervalMinutes: 60, retentionCount: 5 })
  assert.equal(moved.lastFingerprint, undefined)
  assert.equal(moved.lastSuccessAt, undefined)
  assert.equal(moved.targetParentPath, restoreParent)
  assert.equal(moved.backupOnFirstOpen, false)
})

test('recovers autosave and interrupted AI work before restoring the complete current schema as an independent project', async (context) => {
  const { project, projects, databases, documents, backupParent, restoreParent, backup } = await fixture(context)
  const workItemId = (await projects.currentSummary()).id
  const beforeAutosave = await documents.chapter(1)
  assert.ok(beforeAutosave.bodyVersionId)
  const staged = await documents.stageAutosave(1, {
    title: beforeAutosave.title,
    content: `${beforeAutosave.content}\n\n这是异常退出前尚未归档的正文。`,
    clientOperationId: '70000000-0000-4000-8000-000000000001',
    baseBodyVersionId: beforeAutosave.bodyVersionId,
    expectedRevision: beforeAutosave.revision,
    mergeWindowMs: 30_000
  })
  assert.equal(staged.checkpoint?.status, 'staged')

  const request: WritingAgentRequest = {
    chapterId: 1,
    message: '恢复后重试这次局部改写',
    currentDraft: beforeAutosave.content,
    model: 'recovery-model',
    preferredSkill: 'rewrite',
    selection: { start: 0, end: 1, text: beforeAutosave.content.slice(0, 1) }
  }
  const interruptedTaskId = '70000000-0000-4000-8000-000000000010'
  const database = await databases.openExisting(project.path)
  assert.ok(database)
  database.createTaskRun({
    id: interruptedTaskId,
    legacyChapterId: 1,
    taskType: 'writing_agent',
    idempotencyKey: '70000000-0000-4000-8000-000000000011',
    checkpointJson: JSON.stringify({ version: 1, phase: 'model', workItemId, request })
  })
  database.transitionTaskRun({ id: interruptedTaskId, status: 'running' })
  database.close()

  // Reconstruct the owning services, as the desktop process does after a restart.
  const restartedAuthority = new SqliteManuscriptService(databases)
  const restartedDocuments = new DocumentService(projects, undefined, restartedAuthority)
  const recoveries = await restartedDocuments.autosaveRecoveries(1)
  assert.equal(recoveries.length, 1)
  assert.equal((await restartedDocuments.chapter(1)).content, beforeAutosave.content)
  const recoveredChapter = await restartedDocuments.finalizeAutosave(recoveries[0]!.id)
  assert.equal(recoveredChapter.chapter.content, staged.checkpoint?.content)
  assert.equal(recoveredChapter.insertedVersion, true)
  assert.equal((await restartedDocuments.autosaveRecoveries(1)).length, 0)

  const retryContent = '恢复后的候选没有直接覆盖正文。'
  const runner = {
    prepare: async (input: WritingAgentRequest) => ({
      version: 1,
      workItemId,
      workItemPath: project.path,
      skill: input.preferredSkill || 'continue',
      model: input.model || 'recovery-model',
      contexts: [{ task: 'prose', label: '恢复验收上下文', content: recoveredChapter.chapter.content }]
    }),
    run: async (input: WritingAgentRequest): Promise<WritingAgentTurn> => ({
      id: '70000000-0000-4000-8000-000000000099',
      workItemId,
      chapterId: input.chapterId,
      createdAt: '2026-09-05T12:00:00.000Z',
      model: input.model || 'recovery-model',
      skill: { id: 'rewrite', label: '改写选段' },
      answer: '恢复任务已生成候选。',
      tools: [],
      candidate: {
        mode: 'replaceSelection',
        content: retryContent,
        baseDraftFingerprint: createHash('sha256').update(input.currentDraft).digest('hex'),
        selection: input.selection,
        diff: [{ id: 'recovery-change-1', kind: 'change', before: input.selection?.text || '', after: retryContent }]
      }
    }),
    remember: () => undefined,
    proposal: () => undefined
  } as unknown as WritingAgentService
  const restartedTasks = new WritingAgentTaskService(runner, projects, databases)
  const interrupted = (await restartedTasks.recent(1)).find((item) => item.id === interruptedTaskId)
  assert.equal(interrupted?.status, 'interrupted')
  assert.equal(interrupted?.error?.code, 'APP_RESTARTED')
  const retry = await restartedTasks.retry(interruptedTaskId, '70000000-0000-4000-8000-000000000012')
  const retried = await waitForWritingTask(restartedTasks, retry.id, 'succeeded')
  assert.equal(retried.attempt, 2)
  assert.equal(retried.parentTaskRunId, interruptedTaskId)
  assert.equal(retried.turn?.candidate?.content, retryContent)
  assert.equal((await restartedDocuments.chapter(1)).content, recoveredChapter.chapter.content)

  const sourceBeforeBackup = await databaseSnapshot(project.path)
  const created = await backup.create(backupParent)
  const manifest = JSON.parse(await readFile(join(created.backupPath, WORKSPACE_BACKUP_MANIFEST), 'utf8')) as WorkspaceBackupManifest
  assert.equal(manifest.databaseSchemaVersion, WORKSPACE_DATABASE_SCHEMA_VERSION)
  const preview = await backup.previewRestore(created.backupPath)
  assert.equal(preview.canRestore, true)
  assert.ok(preview.token)
  const restored = await backup.restore(preview.token!, restoreParent)
  const restoredSnapshot = await databaseSnapshot(restored.projectPath)

  assert.equal(sourceBeforeBackup.quickCheck, 'ok')
  assert.deepEqual(sourceBeforeBackup.foreignKeyErrors, [])
  assert.equal(restoredSnapshot.quickCheck, 'ok')
  assert.deepEqual(restoredSnapshot.foreignKeyErrors, [])
  assert.deepEqual(restoredSnapshot.schema, sourceBeforeBackup.schema)
  assert.deepEqual(restoredSnapshot.rows, sourceBeforeBackup.rows)
  for (const table of requiredV2Tables) assert.ok(restoredSnapshot.schema.some((item) => item.name === table), `missing ${table}`)

  const sourceChapterAfter = await restartedDocuments.chapter(1)
  const recoveredContentHash = createHash('sha256').update(sourceChapterAfter.content).digest('hex')
  const restoredDatabase = await databases.openExisting(restored.projectPath)
  assert.ok(restoredDatabase)
  const restoredInspection = restoredDatabase.inspect()
  assert.equal(restoredInspection.schemaVersion, WORKSPACE_DATABASE_SCHEMA_VERSION)
  assert.equal(restoredInspection.chapters[0]?.currentContentHash, recoveredContentHash)
  assert.equal(restoredInspection.chapters[0]?.versionCount, 3)
  const restoredOriginalTask = restoredDatabase.taskRun(interruptedTaskId)
  const restoredRetryTask = restoredDatabase.taskRun(retry.id)
  assert.equal(restoredOriginalTask?.status, 'interrupted')
  assert.equal(restoredRetryTask?.status, 'succeeded')
  assert.ok(restoredOriginalTask?.taskContract.contractHash)
  assert.deepEqual(restoredRetryTask?.taskContract, restoredOriginalTask?.taskContract)
  restoredDatabase.close()

  for (const file of manifest.files.filter((item) => item.kind === 'project-file' && item.relativePath !== '.webnovel/state.json')) {
    assert.equal(await hashFile(join(restored.projectPath, ...file.relativePath.split('/'))), file.sha256, file.relativePath)
  }
  await restartedDocuments.updateChapter(1, {
    content: `${sourceChapterAfter.content}\n\n备份完成后的原作品变化。`,
    expectedRevision: sourceChapterAfter.revision,
    reason: 'manual'
  })
  const untouchedRestored = await databases.openExisting(restored.projectPath)
  assert.ok(untouchedRestored)
  assert.equal(untouchedRestored.inspect().chapters[0]?.currentContentHash, recoveredContentHash)
  untouchedRestored.close()
})

const requiredV2Tables = [
  'body_versions', 'chapters', 'context_packages', 'document_chunks', 'fact_batches', 'fact_sources', 'facts',
  'finding_decisions', 'findings', 'generation_artifacts', 'model_configs', 'prompt_templates', 'resource_ledger',
  'rule_runs', 'rules', 'summary_versions', 'task_runs'
] as const

async function waitForWritingTask(service: WritingAgentTaskService, id: string, status: string) {
  for (let index = 0; index < 100; index += 1) {
    const task = await service.status(id)
    if (task.status === status) return task
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`writing task did not reach ${status}`)
}

async function databaseSnapshot(root: string): Promise<{
  quickCheck: string
  foreignKeyErrors: unknown[]
  schema: Array<{ name: string; sql: string }>
  rows: Record<string, unknown[]>
}> {
  const database = new DatabaseSync(join(root, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/')), { readOnly: true, allowExtension: false })
  try {
    const quickCheck = String((database.prepare('PRAGMA quick_check').get() as Record<string, unknown>).quick_check)
    const foreignKeyErrors = database.prepare('PRAGMA foreign_key_check').all()
    const schemaRows = database.prepare(`SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as unknown as Array<{ name: string; sql: string }>
    const schema = schemaRows.map((item) => ({ name: String(item.name), sql: String(item.sql) }))
    const rows: Record<string, unknown[]> = {}
    for (const table of schema) {
      const values = database.prepare(`SELECT * FROM "${table.name.replaceAll('"', '""')}"`).all() as Array<Record<string, unknown>>
      rows[table.name] = values.map((value) => {
        if (table.name !== 'projects') return value
        return { ...value, name: '<restored-project-name>', legacy_manifest_hash: '<restored-manifest-hash>', updated_at: '<restored-at>' }
      }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    }
    return { quickCheck, foreignKeyErrors, schema, rows }
  } finally { database.close() }
}

async function treeFingerprint(root: string): Promise<string> {
  const entries: string[] = []
  async function walk(relativePath: string): Promise<void> {
    const directory = relativePath ? join(root, ...relativePath.split('/')) : root
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const next = relativePath ? `${relativePath}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(next)
      else entries.push(`${next}:${await hashFile(join(directory, entry.name))}`)
    }
  }
  await walk('')
  return createHash('sha256').update(entries.join('\n')).digest('hex')
}

async function hashFile(path: string): Promise<string> {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer)
  return digest.digest('hex')
}

async function treeContainsText(root: string, needle: string): Promise<boolean> {
  const bytes = Buffer.from(needle)
  async function walk(path: string): Promise<boolean> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const target = join(path, entry.name)
      if (entry.isDirectory()) {
        if (await walk(target)) return true
      } else if ((await readFile(target)).includes(bytes)) return true
    }
    return false
  }
  return walk(root)
}
import { removeEmptyReviewSchema } from '../../fixtures/remove-empty-review-schema'
