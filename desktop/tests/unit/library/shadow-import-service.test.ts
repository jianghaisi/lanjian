import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { type TestContext } from 'node:test'
import { ShadowImportService } from '../../../src/main/modules/library/application/shadow-import-service'
import { WORKSPACE_DATABASE_RELATIVE_PATH, WORKSPACE_DATABASE_SCHEMA_VERSION, type WorkspaceFactBatchCreateInput } from '../../../src/main/core/ports/workspace-database'
import { SqliteWorkspaceDatabaseFactory, workspaceDatabaseMigrations } from '../../../src/main/platform/storage/workspace-database'
import { DocumentService } from '../../../src/main/modules/manuscript/application/document-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../../src/main/modules/library/application/legacy-workspace-source'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'

const codec = {
  available: () => true,
  encrypt: (value: string) => Buffer.from(value).toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString()
}

async function fixture(context: TestContext, withChapters = true) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-shadow-db-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  const settings = new SettingsStore(join(root, 'user-data'), codec)
  const projects = new ProjectService(settings)
  const created = await projects.create({ parentPath: root, name: '测试长篇', genre: '玄幻' })
  const documents = new DocumentService(projects)
  if (withChapters) {
    await documents.updateChapter(10, { title: '雨夜来客', content: '沈砚在雨夜收到一封信。' })
    await documents.updateChapter(20, { title: '旧城回声', content: '第二天，他沿着旧城墙寻找回声。' })
    await documents.reorderChapter(20, 1)
  }
  let sequence = 0
  const clock = { value: new Date('2026-09-01T03:00:00.000Z') }
  const databases = new SqliteWorkspaceDatabaseFactory(
    () => new Date(clock.value),
    () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`
  )
  const source = new CurrentProjectLegacyWorkspaceSource(projects, documents)
  const service = new ShadowImportService(source, databases)
  const databasePath = join(created.project.path, ...WORKSPACE_DATABASE_RELATIVE_PATH.split('/'))
  return { root, project: created.project, projects, documents, databases, source, service, databasePath, clock }
}

test('previews without writes, imports exact chapters and keeps repeat/change imports append-only', async (context) => {
  const { project, documents, databases, service, databasePath } = await fixture(context)
  const beforePreview = await projectFileHashes(project.path)
  const preview = await service.preview()
  assert.deepEqual(preview.blockers, [])
  assert.equal(preview.chapterCount, 2)
  assert.equal(preview.totalWords, 23)
  assert.equal(await exists(databasePath), false)
  assert.deepEqual(await projectFileHashes(project.path), beforePreview)

  const beforeImport = await projectFileHashes(project.path)
  const first = await service.import(preview)
  assert.deepEqual(first, {
    sourceFingerprint: preview.sourceFingerprint,
    chapterCount: 2,
    insertedVersions: 2,
    unchangedVersions: 0,
    verified: true
  })
  assert.deepEqual(await projectFileHashes(project.path), beforeImport)

  let database = await databases.open(project.path)
  let inspection = database.inspect()
  database.close()
  assert.equal(inspection.schemaVersion, WORKSPACE_DATABASE_SCHEMA_VERSION)
  assert.equal(inspection.foreignKeys, true)
  assert.equal(inspection.journalMode.toLocaleLowerCase(), 'wal')
  assert.equal(inspection.project.name, '测试长篇')
  assert.equal(inspection.project.storageMode, 'shadow')
  assert.deepEqual(inspection.chapters.map((chapter) => ({
    id: chapter.legacyChapterId,
    position: chapter.position,
    title: chapter.title,
    content: chapter.currentContent,
    versions: chapter.versionCount,
    mirror: chapter.mirrorStatus
  })), [
    { id: 20, position: 1, title: '旧城回声', content: '第二天，他沿着旧城墙寻找回声。', versions: 1, mirror: 'pending' },
    { id: 10, position: 2, title: '雨夜来客', content: '沈砚在雨夜收到一封信。', versions: 1, mirror: 'pending' }
  ])

  const unchangedPreview = await service.preview()
  const unchanged = await service.import(unchangedPreview)
  assert.equal(unchanged.insertedVersions, 0)
  assert.equal(unchanged.unchangedVersions, 2)

  await documents.updateChapter(10, { title: '雨夜来客', content: '沈砚在雨夜收到一封信，信上只有旧城地址。' })
  const changedPreview = await service.preview()
  const sourceBeforeChangedImport = await projectFileHashes(project.path)
  const changed = await service.import(changedPreview)
  assert.equal(changed.insertedVersions, 1)
  assert.equal(changed.unchangedVersions, 1)
  assert.deepEqual(await projectFileHashes(project.path), sourceBeforeChangedImport)

  database = await databases.open(project.path)
  inspection = database.inspect()
  database.close()
  const changedChapter = inspection.chapters.find((chapter) => chapter.legacyChapterId === 10)
  assert.equal(changedChapter?.versionCount, 2)
  assert.equal(changedChapter?.currentContent, '沈砚在雨夜收到一封信，信上只有旧城地址。')

  const rawDatabase = new DatabaseSync(databasePath, { allowExtension: false })
  assert.throws(() => rawDatabase.exec(`UPDATE body_versions SET content = '篡改'`), /append-only/)
  assert.throws(() => rawDatabase.exec('DELETE FROM body_versions'), /append-only/)
  rawDatabase.close()

  await removeDatabaseFiles(databasePath)
  assert.equal(await exists(databasePath), false)
  assert.deepEqual((await documents.chapters()).map((chapter) => chapter.id), [20, 10])
  assert.equal((await documents.chapter(10)).content, '沈砚在雨夜收到一封信，信上只有旧城地址。')
})

test('rejects a stale preview before creating SQLite and leaves the changed source untouched', async (context) => {
  const { project, documents, service, databasePath } = await fixture(context)
  const preview = await service.preview()
  await documents.updateChapter(10, { title: '雨夜来客', content: '预检后作者又补写了一句。' })
  const beforeRejectedImport = await projectFileHashes(project.path)
  await assert.rejects(service.import(preview), (error: { code?: string }) => error.code === 'CONFLICT')
  assert.equal(await exists(databasePath), false)
  assert.deepEqual(await projectFileHashes(project.path), beforeRejectedImport)
})

test('reports damaged chapter order and duplicate chapter identities as zero-write blockers', async (context) => {
  const damaged = await fixture(context)
  const orderPath = join(damaged.project.path, '.webnovel', 'manuscript', 'chapter-order.json')
  await writeFile(orderPath, '{ broken order', 'utf8')
  const damagedBytes = await readFile(orderPath)
  const damagedPreview = await damaged.service.preview()
  assert.equal(damagedPreview.blockers[0]?.code, 'INVALID_PROJECT_STATE')
  assert.deepEqual(await readFile(orderPath), damagedBytes)
  assert.equal(await exists(damaged.databasePath), false)

  const duplicate = await fixture(context, false)
  await writeFile(join(duplicate.project.path, '正文', '第1章-A.md'), '第一份。', 'utf8')
  await writeFile(join(duplicate.project.path, '正文', '第1章-B.md'), '第二份。', 'utf8')
  const duplicateBefore = await projectFileHashes(duplicate.project.path)
  const duplicatePreview = await duplicate.service.preview()
  assert.equal(duplicatePreview.blockers[0]?.code, 'INVALID_PROJECT_STATE')
  assert.deepEqual(await projectFileHashes(duplicate.project.path), duplicateBefore)
  assert.equal(await exists(duplicate.databasePath), false)
})

test('blocks ambiguous legacy identity without upgrading files or creating SQLite', async (context) => {
  const { project, service, databasePath } = await fixture(context)
  const statePath = join(project.path, '.webnovel', 'state.json')
  const state = JSON.parse(await readFile(statePath, 'utf8'))
  state.schemaVersion = 1
  state.version = 1
  state.project_info.title = '另一部作品'
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  const before = await projectFileHashes(project.path)
  const preview = await service.preview()
  assert.equal(preview.blockers[0]?.code, 'CONFLICT')
  assert.match(preview.blockers[0]?.message || '', /作品身份冲突/)
  assert.deepEqual(await projectFileHashes(project.path), before)
  assert.equal(await exists(databasePath), false)
})

test('preserves an existing damaged database and every Markdown or JSON source byte', async (context) => {
  const { project, service, databasePath } = await fixture(context)
  const preview = await service.preview()
  const damagedDatabase = Buffer.from('not-a-sqlite-database')
  await writeFile(databasePath, damagedDatabase)
  const before = await projectFileHashes(project.path)
  await assert.rejects(service.import(preview), (error: { code?: string }) => error.code === 'DATABASE_MIGRATION_FAILED')
  assert.deepEqual(await readFile(databasePath), damagedDatabase)
  assert.deepEqual(await projectFileHashes(project.path), before)
})

test('rejects a metadata junction that escapes the selected work item', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-shadow-guard-root-'))
  const outside = await mkdtemp(join(tmpdir(), 'lanjian-shadow-guard-outside-'))
  context.after(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })
  await mkdir(root, { recursive: true })
  await symlink(outside, join(root, '.webnovel'), process.platform === 'win32' ? 'junction' : 'dir')

  const databases = new SqliteWorkspaceDatabaseFactory()
  await assert.rejects(databases.open(root), (error: { code?: string }) => error.code === 'PATH_ESCAPE')
  assert.equal(await exists(join(outside, 'workspace.sqlite')), false)
})

test('migrates v6 writing data losslessly and persists normalized config, stage planning and chapter workflow mirrors', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-v6-to-v7-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  const metadataDirectory = join(root, '.webnovel')
  await mkdir(metadataDirectory, { recursive: true })
  const databasePath = join(metadataDirectory, 'workspace.sqlite')
  seedVersion6Database(databasePath)

  let sequence = 100
  const databases = new SqliteWorkspaceDatabaseFactory(
    () => new Date('2026-09-01T04:00:00.000Z'),
    () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`
  )
  const database = await databases.open(root)
  assert.equal(database.inspect().schemaVersion, WORKSPACE_DATABASE_SCHEMA_VERSION)
  assert.deepEqual(database.projectWritingConfig(), {
    targetWords: null,
    genreText: '',
    audienceScale: '',
    defaultPov: '',
    writingStyle: '',
    chapterTargetWords: null,
    autosaveEnabled: true,
    autosaveDelayMs: 1500,
    autosaveMergeWindowMs: 30_000,
    configJson: '{}'
  })
  assert.equal(database.chapterPlanning(1).lifecycleStatus, 'CONFIRMED')
  assert.equal(database.chapterPlanning(1).outlineLegacyKey, 'chapter-1')
  assert.deepEqual(database.chapterPlanning(2), {
    legacyChapterId: 2,
    outlineLegacyKey: null,
    lifecycleStatus: 'ARCHIVED',
    archivedFromStatus: 'PLANNED',
    currentBodyVersionId: 'body-2',
    confirmedBodyVersionId: null,
    confirmedAt: null,
    hasUnconfirmedChanges: false,
    card: {
      status: 'empty', goal: '', entryState: '', beats: [], conflict: '', characters: [], pointOfView: '',
      narrativeDistance: '', exitChange: '', hook: ''
    }
  })

  const configWrite = database.updateProjectWritingConfig({
    targetWords: 2_000_000,
    genreText: '玄幻',
    audienceScale: '非少儿',
    defaultPov: '第三人称',
    writingStyle: '克制、清晰',
    chapterTargetWords: 3_000,
    autosaveDelayMs: 2_000,
    configJson: '{"narrativeDistance":"近"}'
  })
  assert.equal(configWrite.mirror.sourceType, 'project_config_json')
  assert.equal(configWrite.mirror.relativePath, '.webnovel/config/project-writing.json')
  assert.match(configWrite.mirror.content, /"targetWords": 2000000/)

  await assert.rejects(
    async () => database.updateChapterPlanning({ legacyChapterId: 1, lifecycleStatus: 'DRAFTING' }),
    (error: { code?: string }) => error.code === 'CONFLICT'
  )
  const planned = database.updateChapterPlanning({
    legacyChapterId: 1,
    lifecycleStatus: 'REVISING',
    outlineLegacyKey: 'chapter-1',
    card: {
      status: 'confirmed',
      goal: '找到失踪的信使',
      entryState: '主角尚不知道追兵已到城外',
      beats: ['查验密信', '城门遭遇阻拦'],
      conflict: '必须在封城前出城',
      characters: ['沈砚', '守门校尉'],
      pointOfView: '第三人称限知',
      narrativeDistance: '近',
      exitChange: '确认信使被劫走',
      hook: '劫匪留下主角家族徽记'
    }
  })
  assert.equal(planned.planning.lifecycleStatus, 'REVISING')
  assert.equal(planned.planning.card.beats.length, 2)
  assert.equal(planned.mirror.sourceType, 'chapter_card_json')
  assert.equal(planned.mirror.relativePath, '.webnovel/planning/chapter-cards/chapter-1.json')

  const stage = database.writeFormalOutline({
    legacyKey: 'stage-1',
    parentLegacyKey: 'volume-1',
    nodeType: 'stage',
    seq: 1,
    title: '旧城追索',
    content: '主角沿旧城线索追查信使。',
    planning: { goalText: '确认幕后势力', turningPointText: '家族徽记出现' }
  })
  assert.equal(stage.outline.nodeType, 'stage')
  assert.equal(stage.outline.planning.goalText, '确认幕后势力')
  assert.equal(stage.mirror.relativePath, '大纲/阶段纲/第1阶段-大纲.md')

  const pending = database.pendingMirrorPlans()
  assert.deepEqual(new Set(pending.map((plan) => plan.sourceType)), new Set(['project_config_json', 'chapter_card_json', 'outline_markdown']))
  database.close()

  const raw = new DatabaseSync(databasePath, { allowExtension: false })
  const project = raw.prepare('SELECT status, target_words, current_schema_version FROM projects').get() as Record<string, unknown>
  assert.deepEqual({ ...project }, { status: 'active', target_words: 2_000_000, current_schema_version: WORKSPACE_DATABASE_SCHEMA_VERSION })
  const chapterStatuses = raw.prepare(`
    SELECT chapters.legacy_chapter_id, chapters.status AS storage_status, workflows.lifecycle_status
    FROM chapters JOIN chapter_workflows workflows ON workflows.chapter_id = chapters.id ORDER BY chapters.legacy_chapter_id
  `).all()
  assert.deepEqual(chapterStatuses.map((row) => ({ ...(row as Record<string, unknown>) })), [
    { legacy_chapter_id: 1, storage_status: 'draft', lifecycle_status: 'REVISING' },
    { legacy_chapter_id: 2, storage_status: 'archived', lifecycle_status: 'ARCHIVED' }
  ])
  assert.throws(() => raw.exec(`UPDATE outline_versions SET content = '篡改'`), /append-only/)
  assert.throws(() => raw.exec(`UPDATE chapter_workflows SET lifecycle_status = 'DRAFTING', archived_from_status = NULL WHERE chapter_id = 'chapter-2'`), /invalid chapter lifecycle transition/)
  raw.close()
})

test('migrates an existing v8 project additively to fact approval schema v9', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-v8-to-v9-'))
  context.after(async () => rm(root, { recursive: true, force: true }))
  const metadataDirectory = join(root, '.webnovel')
  await mkdir(metadataDirectory, { recursive: true })
  const databasePath = join(metadataDirectory, 'workspace.sqlite')
  const rawV8 = new DatabaseSync(databasePath, { allowExtension: false })
  rawV8.exec('PRAGMA foreign_keys = ON')
  for (const migration of workspaceDatabaseMigrations.filter((entry) => entry.version <= 8)) {
    rawV8.exec(migration.sql)
    rawV8.prepare('INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)')
      .run(migration.version, migration.name, '2026-09-01T03:00:00.000Z', migration.checksum)
    rawV8.exec(`PRAGMA user_version = ${migration.version}`)
  }
  rawV8.prepare(`
    INSERT INTO projects (id, name, status, legacy_manifest_hash, storage_mode, created_at, updated_at)
    VALUES ('project-v8', 'v8 旧项目', 'active', ?, 'sqlite', ?, ?)
  `).run('d'.repeat(64), '2026-09-01T03:00:00.000Z', '2026-09-01T03:00:00.000Z')
  rawV8.close()

  const database = await new SqliteWorkspaceDatabaseFactory().open(root)
  assert.equal(database.inspect().schemaVersion, WORKSPACE_DATABASE_SCHEMA_VERSION)
  assert.equal(database.inspect().project.name, 'v8 旧项目')
  database.close()
  const migrated = new DatabaseSync(databasePath, { allowExtension: false })
  const tables = migrated.prepare(`SELECT name FROM sqlite_schema WHERE type = 'table'`).all().map((row) => String(row.name))
  assert.ok(['fact_batches', 'fact_changes', 'facts', 'fact_sources', 'fact_decisions', 'fact_source_impacts'].every((name) => tables.includes(name)))
  assert.equal(migrated.prepare('SELECT current_schema_version AS value FROM projects').get()?.value, WORKSPACE_DATABASE_SCHEMA_VERSION)
  assert.equal(migrated.prepare('SELECT COUNT(*) AS value FROM schema_migrations WHERE version = 9').get()?.value, 1)
  migrated.close()
})

test('coalesces autosave checkpoints idempotently, preserves conflicts and finalizes only append-only body versions', async (context) => {
  const { project, databases, source, service, databasePath, clock } = await fixture(context)
  const preview = await service.preview()
  await service.import(preview)
  const snapshot = await source.snapshot()
  const database = await databases.open(project.path)
  database.activateSqlite(snapshot)
  const baseline = database.formalChapters().find((chapter) => chapter.legacyChapterId === 20)!
  const first = database.stageAutosaveCheckpoint({
    legacyChapterId: 20,
    clientOperationId: 'autosave-op-1',
    baseBodyVersionId: baseline.currentVersionId,
    title: baseline.title,
    content: `${baseline.content}第一段补写。`
  })
  assert.equal(first.merged, false)
  assert.equal(first.idempotent, false)
  assert.equal(first.checkpoint.mergeWindowMs, 30_000)
  assert.equal(Date.parse(first.checkpoint.windowEndsAt) - Date.parse(first.checkpoint.windowStartedAt), 30_000)
  const firstDeadline = Date.parse(first.checkpoint.windowEndsAt)

  const replay = database.stageAutosaveCheckpoint({
    legacyChapterId: 20,
    clientOperationId: 'autosave-op-1',
    baseBodyVersionId: baseline.currentVersionId,
    title: baseline.title,
    content: `${baseline.content}第一段补写。`
  })
  assert.equal(replay.checkpoint.id, first.checkpoint.id)
  assert.equal(replay.idempotent, true)
  assert.equal(replay.checkpoint.operationCount, 1)
  await assert.rejects(async () => database.stageAutosaveCheckpoint({
    legacyChapterId: 20,
    clientOperationId: 'autosave-op-1',
    baseBodyVersionId: baseline.currentVersionId,
    title: baseline.title,
    content: '复用同一个操作 ID 的另一份正文。'
  }), (error: { code?: string }) => error.code === 'CONFLICT')

  clock.value = new Date(Date.parse(first.checkpoint.windowStartedAt) + 10_000)
  const merged = database.stageAutosaveCheckpoint({
    legacyChapterId: 20,
    clientOperationId: 'autosave-op-2',
    baseBodyVersionId: baseline.currentVersionId,
    title: '旧城回声·补写',
    content: `${baseline.content}第一段补写。第二段继续。`
  })
  assert.equal(merged.checkpoint.id, first.checkpoint.id)
  assert.equal(merged.merged, true)
  assert.equal(merged.checkpoint.operationCount, 2)
  assert.equal(merged.checkpoint.clientOperationId, 'autosave-op-2')
  assert.equal(Date.parse(merged.checkpoint.windowEndsAt) - Date.parse(merged.checkpoint.windowStartedAt), 30_000)
  assert.ok(Date.parse(merged.checkpoint.windowEndsAt) > firstDeadline)

  const finalized = database.finalizeAutosaveCheckpoint(first.checkpoint.id)
  assert.equal(finalized.checkpoint.status, 'finalized')
  assert.equal(finalized.insertedVersion, true)
  assert.equal(finalized.chapter?.title, '旧城回声·补写')
  assert.equal(finalized.mirror?.sourceType, 'chapter_markdown')
  assert.notEqual(finalized.checkpoint.finalizedBodyVersionId, baseline.currentVersionId)
  const finalizedReplay = database.finalizeAutosaveCheckpoint(first.checkpoint.id)
  assert.equal(finalizedReplay.checkpoint.finalizedBodyVersionId, finalized.checkpoint.finalizedBodyVersionId)

  const stale = database.stageAutosaveCheckpoint({
    legacyChapterId: 20,
    clientOperationId: 'autosave-op-stale',
    baseBodyVersionId: baseline.currentVersionId,
    title: baseline.title,
    content: '这份恢复草稿基于旧正文，但必须保留。'
  })
  assert.equal(stale.checkpoint.status, 'conflict')
  assert.equal(stale.checkpoint.content, '这份恢复草稿基于旧正文，但必须保留。')
  assert.equal(stale.checkpoint.conflictCurrentBodyVersionId, finalized.checkpoint.finalizedBodyVersionId)
  assert.equal(database.discardAutosaveCheckpoint(stale.checkpoint.id).status, 'discarded')

  database.updateProjectWritingConfig({ autosaveMergeWindowMs: 45_000 })
  const beforeManual = database.formalChapters().find((chapter) => chapter.legacyChapterId === 20)!
  const stagedBeforeManual = database.stageAutosaveCheckpoint({
    legacyChapterId: 20,
    clientOperationId: 'autosave-op-before-manual',
    baseBodyVersionId: beforeManual.currentVersionId,
    title: beforeManual.title,
    content: `${beforeManual.content}尚未落版的自动保存。`
  })
  assert.equal(stagedBeforeManual.checkpoint.mergeWindowMs, 45_000)
  database.writeFormalChapter({
    legacyChapterId: 20,
    title: beforeManual.title,
    content: `${beforeManual.content}作者手动保存。`,
    reason: 'manual',
    expectedRevision: beforeManual.revision
  })
  assert.equal(database.listAutosaveCheckpoints(20).find((checkpoint) => checkpoint.id === stagedBeforeManual.checkpoint.id)?.status, 'discarded')

  const beforeRestore = database.formalChapters().find((chapter) => chapter.legacyChapterId === 20)!
  const stagedBeforeRestore = database.stageAutosaveCheckpoint({
    legacyChapterId: 20,
    clientOperationId: 'autosave-op-before-restore',
    baseBodyVersionId: beforeRestore.currentVersionId,
    title: beforeRestore.title,
    content: `${beforeRestore.content}恢复前草稿。`
  })
  const revision = database.formalRevisions(20)[0]
  assert.ok(revision)
  database.restoreFormalRevision(20, revision.id, beforeRestore.revision)
  assert.equal(database.listAutosaveCheckpoints(20).find((checkpoint) => checkpoint.id === stagedBeforeRestore.checkpoint.id)?.status, 'discarded')
  assert.equal(database.listAutosaveCheckpoints(10).length, 0)
  database.close()

  const raw = new DatabaseSync(databasePath, { allowExtension: false })
  assert.throws(() => raw.exec(`UPDATE body_versions SET content = '篡改'`), /append-only/)
  assert.throws(() => raw.exec(`UPDATE autosave_checkpoint_operations SET payload_hash = '${'b'.repeat(64)}'`), /append-only/)
  assert.equal(raw.prepare('SELECT COUNT(*) AS value FROM autosave_checkpoint_operations WHERE client_operation_id = ?').get('autosave-op-1')?.value, 1)
  raw.close()
})

test('rebases a rollover autosave window instead of reporting a false recovery conflict', async (context) => {
  const { project, databases, source, service, clock } = await fixture(context)
  const preview = await service.preview()
  await service.import(preview)
  const snapshot = await source.snapshot()
  const database = await databases.open(project.path)
  database.activateSqlite(snapshot)
  const baseline = database.formalChapters().find((chapter) => chapter.legacyChapterId === 20)!

  const first = database.stageAutosaveCheckpoint({
    legacyChapterId: 20,
    clientOperationId: 'rollover-autosave-1',
    baseBodyVersionId: baseline.currentVersionId,
    title: baseline.title,
    content: `${baseline.content}第一窗口。`,
    mergeWindowMs: 1_000
  })
  clock.value = new Date(Date.parse(first.checkpoint.windowEndsAt) + 80)
  const rollover = database.stageAutosaveCheckpoint({
    legacyChapterId: 20,
    clientOperationId: 'rollover-autosave-2',
    baseBodyVersionId: baseline.currentVersionId,
    title: baseline.title,
    content: `${baseline.content}第一窗口。第二窗口。`,
    mergeWindowMs: 1_000
  })
  assert.notEqual(rollover.checkpoint.id, first.checkpoint.id)
  assert.equal(rollover.checkpoint.status, 'staged')

  const firstFinalized = database.finalizeAutosaveCheckpoint(first.checkpoint.id)
  assert.equal(firstFinalized.checkpoint.status, 'finalized')
  const rebased = database.listAutosaveCheckpoints(20).find((item) => item.id === rollover.checkpoint.id)!
  assert.equal(rebased.status, 'staged')
  assert.equal(rebased.baseBodyVersionId, firstFinalized.checkpoint.finalizedBodyVersionId)
  assert.equal(rebased.conflictCurrentBodyVersionId, null)

  clock.value = new Date(Date.parse(rebased.windowEndsAt) + 80)
  const rolloverFinalized = database.finalizeAutosaveCheckpoint(rebased.id)
  assert.equal(rolloverFinalized.checkpoint.status, 'finalized')
  assert.equal(rolloverFinalized.chapter?.content, `${baseline.content}第一窗口。第二窗口。`)
  assert.equal(database.listAutosaveCheckpoints(20).filter((item) => item.status === 'conflict').length, 0)
  database.close()
})

test('keeps historical facts and snapshots through later replacements, v31 upgrade, reorder and archive', async (context) => {
  const { project, documents, databases, source, service, databasePath } = await fixture(context)
  await documents.updateChapter(30, { title: '到达城门', content: '沈砚到了城门，确认信使没有背叛。' })
  await documents.updateChapter(40, { title: '离开城门', content: '他准备继续出发。' })
  await service.import(await service.preview())
  let database = await databases.open(project.path)
  try {
    database.activateSqlite(await source.snapshot())
    const bodies = () => database.formalChapters().map((chapter) => [chapter.legacyChapterId, chapter.currentVersionId, chapter.contentHash])
    const beforeBodies = bodies()
    let sequence = 0
    const approve = (chapterId: number, predicate: string, value: string, previous?: string) => {
      const chapter = database.formalChapters().find((item) => item.legacyChapterId === chapterId)!
      const id = `temporal-${++sequence}`
      database.createFactBatch({
        id, legacyChapterId: chapterId, bodyVersionId: chapter.currentVersionId, contentHash: chapter.contentHash,
        idempotencyKey: id, countsJson: '{"total":1}',
        changes: [{
          id: `${id}-change`, candidateType: 'character_state', subjectType: 'character', subjectId: 'hero',
          subjectJson: '{"id":"hero","name":"沈砚"}', predicate, objectJson: JSON.stringify(value),
          normalizedKey: `character:hero:${predicate}`, evidenceJson: JSON.stringify({ quote: chapter.content }),
          confidence: 0.9, importance: 'high', changeType: previous ? 'CHANGED' : 'NEW', reviewClass: 'reviewable',
          ...(previous ? { matchedFactId: previous } : {})
        }]
      })
      return database.decideFactChanges({
        batchId: id, decisions: [{ id: `${id}-decision`, changeId: `${id}-change`, decision: 'APPROVED',
          sourceQuote: chapter.content, sourceSpanJson: JSON.stringify({ start: 0, end: chapter.content.length }) }]
      }).createdFactIds[0]!
    }
    const oldLocation = approve(20, 'location', '旧城墙')
    const oldKnowledge = approve(20, 'knowledge', '怀疑信使背叛')
    const earlySnapshot = database.characterSnapshotsBefore(10)[0]!
    const gateLocation = approve(30, 'location', '城门', oldLocation)
    approve(30, 'knowledge', '确认信使没有背叛', oldKnowledge)
    const values = (chapterId: number) => database.approvedFactsBefore(chapterId).map((fact) => JSON.parse(fact.objectJson)).sort()
    assert.deepEqual(values(10), ['怀疑信使背叛', '旧城墙'].sort())
    assert.deepEqual(values(30), values(10), 'the target chapter itself cannot replace prior facts')
    assert.deepEqual(database.characterSnapshotsBefore(10)[0], earlySnapshot)
    assert.equal(database.characterSnapshotsBefore(30)[0]?.location, '旧城墙')
    assert.equal(database.characterSnapshotsBefore(40)[0]?.location, '城门')
    assert.deepEqual(database.characterSnapshotsBefore(40)[0]?.knowledge, ['确认信使没有背叛'])
    approve(30, 'location', '城门外', gateLocation)
    assert.deepEqual(values(40), ['城门外', '确认信使没有背叛'].sort())
    assert.equal(database.characterSnapshotsBefore(40)[0]?.location, '城门外')
    assert.equal(database.characterSnapshotsBefore(10)[0]?.location, '旧城墙')
    assert.deepEqual(bodies(), beforeBodies)
    database.close()
    // Reopening the current schema must not mutate immutable canon or正文 history.
    // Dedicated migration tests below exercise historical schema upgrades.
    const legacy = new DatabaseSync(databasePath, { allowExtension: false })
    const immutableTables = ['facts', 'fact_sources', 'fact_decisions', 'body_versions', 'outline_versions']
    const immutableBefore = immutableTables.map((table) => legacy.prepare(`SELECT * FROM ${table} ORDER BY id`).all())
    assert.ok(Number(legacy.prepare('SELECT COUNT(*) AS value FROM character_snapshots').get()?.value) > 0)
    legacy.close()
    const filesBeforeUpgrade = await projectFileHashes(project.path)
    database = await databases.open(project.path)
    assert.equal(database.inspect().schemaVersion, WORKSPACE_DATABASE_SCHEMA_VERSION)
    assert.equal(database.characterSnapshotsBefore(10)[0]?.location, '旧城墙')
    assert.deepEqual(database.characterSnapshotsBefore(40)[0]?.knowledge, ['确认信使没有背叛'])
    assert.deepEqual(bodies(), beforeBodies)
    const upgraded = new DatabaseSync(databasePath, { readOnly: true, allowExtension: false })
    try {
      assert.deepEqual(immutableTables.map((table) => upgraded.prepare(`SELECT * FROM ${table} ORDER BY id`).all()), immutableBefore)
      assert.equal(upgraded.prepare('SELECT COUNT(*) AS value FROM schema_migrations WHERE version = 32').get()?.value, 1)
      assert.equal(upgraded.prepare('SELECT COUNT(*) AS value FROM schema_migrations WHERE version = 33').get()?.value, 1)
    } finally { upgraded.close() }
    assert.deepEqual(await projectFileHashes(project.path), filesBeforeUpgrade)
    database.close()
    database = await databases.open(project.path)
    assert.equal(database.characterSnapshotsBefore(10)[0]?.location, '旧城墙')
    database.reorderFormalChapter(30, 2)
    assert.deepEqual(values(10), ['城门外', '确认信使没有背叛'].sort())
    assert.equal(database.characterSnapshotsBefore(10)[0]?.location, '城门外')
    database.reorderFormalChapter(30, 1)
    assert.deepEqual(values(10), ['城门外', '确认信使没有背叛'].sort(), 'a moved ancestor cannot resurrect beneath its replacement chain')
    assert.equal(database.characterSnapshotsBefore(10)[0]?.location, '城门外')
    database.archiveFormalChapter(30)
    assert.deepEqual(values(40), ['怀疑信使背叛', '旧城墙'].sort())
    assert.equal(database.characterSnapshotsBefore(40)[0]?.location, '旧城墙')
    assert.deepEqual(database.characterSnapshotsBefore(40)[0]?.knowledge, ['怀疑信使背叛'])
  } finally {
    database.close()
  }
})

test('approves fact changes atomically, queries only effective prior facts and stales every body write path', async (context) => {
  const { project, databases, source, service, databasePath } = await fixture(context)
  const preview = await service.preview()
  await service.import(preview)
  const snapshot = await source.snapshot()
  const database = await databases.open(project.path)
  database.activateSqlite(snapshot)

  const batchInput = (id: string, chapter: ReturnType<typeof database.formalChapters>[number], changes = 1): WorkspaceFactBatchCreateInput => ({
    id: `batch-${id}`,
    legacyChapterId: chapter.legacyChapterId,
    bodyVersionId: chapter.currentVersionId,
    contentHash: chapter.contentHash,
    idempotencyKey: `extract-${id}`,
    countsJson: JSON.stringify({ total: changes }),
    changes: Array.from({ length: changes }, (_, index) => ({
      id: `change-${id}-${index + 1}`,
      candidateType: index === 0 ? 'character_state' : 'open_state',
      subjectType: 'character',
      subjectId: 'character-shenyan',
      subjectJson: JSON.stringify({ id: 'character-shenyan', name: '沈砚' }),
      predicate: index === 0 ? 'location' : 'goal',
      objectJson: JSON.stringify(index === 0 ? '旧城墙' : '寻找回声'),
      normalizedKey: index === 0 ? 'character:shenyan:location' : 'character:shenyan:goal',
      evidenceJson: JSON.stringify({ quote: chapter.content }),
      confidence: 0.9,
      importance: 'high' as const,
      changeType: 'NEW' as const,
      reviewClass: 'reviewable' as const
    }))
  })

  const initial = database.formalChapters().find((chapter) => chapter.legacyChapterId === 20)!
  const atomicInput = batchInput('atomic-rollback', initial, 2)
  database.createFactBatch(atomicInput)
  await assert.rejects(async () => database.decideFactChanges({
    batchId: atomicInput.id,
    decisions: [
      {
        id: 'decision-atomic-valid', changeId: atomicInput.changes[0].id, decision: 'APPROVED',
        sourceQuote: '旧城墙', sourceSpanJson: JSON.stringify({ start: initial.content.indexOf('旧城墙'), end: initial.content.indexOf('旧城墙') + 3 })
      },
      {
        id: 'decision-atomic-invalid', changeId: atomicInput.changes[1].id, decision: 'APPROVED',
        sourceQuote: '正文里不存在的依据', sourceSpanJson: JSON.stringify({ start: 0, end: 1 })
      }
    ]
  }), (error: { code?: string }) => error.code === 'CONFLICT')
  assert.equal(database.listFactBatches(20).find((batch) => batch.id === atomicInput.id)?.status, 'PENDING')
  assert.deepEqual(database.approvedFactsBefore(10), [])

  const initialInput = batchInput('initial', initial, 2)
  assert.equal(database.createFactBatch(initialInput).status, 'PENDING')
  assert.equal(database.createFactBatch(initialInput).id, 'batch-initial')
  const partial = database.decideFactChanges({
    batchId: 'batch-initial',
    decisions: [
      {
        id: 'decision-initial-approve',
        changeId: 'change-initial-1',
        decision: 'APPROVED',
        decidedObjectJson: JSON.stringify('旧城墙'),
        sourceQuote: '旧城墙',
        sourceSpanJson: JSON.stringify({ start: initial.content.indexOf('旧城墙'), end: initial.content.indexOf('旧城墙') + 3 })
      },
      { id: 'decision-initial-defer', changeId: 'change-initial-2', decision: 'DEFERRED' }
    ]
  })
  assert.equal(partial.batch.status, 'PARTIALLY_APPROVED')
  assert.equal(partial.createdFactIds.length, 1)
  assert.equal(database.listFactBatches(20, ['PARTIALLY_APPROVED']).length, 1)
  assert.deepEqual(database.approvedFactsBefore(10).map((fact) => ({ key: fact.normalizedKey, current: fact.sourceCurrent })), [
    { key: 'character:shenyan:location', current: true }
  ])
  assert.deepEqual(database.approvedFactsBefore(20), [])

  const manual = database.writeFormalChapter({
    legacyChapterId: 20,
    title: initial.title,
    content: `${initial.content}作者修订位置为城门。`,
    reason: 'manual',
    expectedRevision: initial.revision
  }).chapter
  assert.equal(database.listFactBatches(20).find((batch) => batch.id === 'batch-initial')?.status, 'STALE')
  assert.equal(database.approvedFactsBefore(10)[0]?.sourceCurrent, false)
  await assert.rejects(async () => database.createFactBatch({ ...batchInput('wrong-version', manual), bodyVersionId: initial.currentVersionId }), (error: { code?: string }) => error.code === 'CONFLICT')
  await assert.rejects(async () => database.createFactBatch({ ...batchInput('wrong-hash', manual), contentHash: 'f'.repeat(64) }), (error: { code?: string }) => error.code === 'CONFLICT')
  await assert.rejects(async () => database.createFactBatch({ ...batchInput('wrong-chapter', manual), legacyChapterId: 10 }), (error: { code?: string }) => error.code === 'CONFLICT')

  const replacementInput = batchInput('replacement', manual)
  replacementInput.changes[0] = {
    ...replacementInput.changes[0],
    objectJson: JSON.stringify('城门'),
    evidenceJson: JSON.stringify({ quote: '作者修订位置为城门' }),
    changeType: 'CHANGED',
    matchedFactId: partial.createdFactIds[0]
  }
  database.createFactBatch(replacementInput)
  const replacement = database.decideFactChanges({
    batchId: replacementInput.id,
    decisions: [{
      id: 'decision-replacement', changeId: replacementInput.changes[0].id, decision: 'APPROVED',
      sourceQuote: '作者修订位置为城门', sourceSpanJson: JSON.stringify({ start: manual.content.indexOf('作者修订'), end: manual.content.length })
    }]
  })
  assert.equal(replacement.batch.status, 'APPROVED')
  const currentFacts = database.approvedFactsBefore(10)
  assert.deepEqual(currentFacts.map((fact) => JSON.parse(fact.objectJson)), ['城门'])
  assert.equal(currentFacts[0].supersedesFactId, partial.createdFactIds[0], '事实修正必须显式连接被替代事实，不能覆盖旧行')

  database.createFactBatch(batchInput('before-ai', manual))
  const workItemId = database.promptProfile().workItemId
  const aiCheckpoint = (phase: string) => JSON.stringify({ version: 1, phase, workItemId,
    request: { chapterId: 20, message: '继续', currentDraft: manual.content } })
  database.createTaskRun({ id: 'fact-stale-ai-task', legacyChapterId: 20, taskType: 'writing_agent', idempotencyKey: 'fact-stale-ai-operation',
    contentHash: manual.contentHash, checkpointJson: aiCheckpoint('queued') })
  database.transitionTaskRun({ id: 'fact-stale-ai-task', status: 'running', checkpointJson: aiCheckpoint('model') })
  const aiArtifactContent = JSON.stringify({ candidate: 'AI 候选被作者采用。' })
  database.completeTaskRunWithArtifact('fact-stale-ai-task', aiCheckpoint('approval'), {
    id: 'fact-stale-ai-artifact', taskRunId: 'fact-stale-ai-task', artifactType: 'writing_agent_turn', status: 'complete',
    content: aiArtifactContent, contentHash: createHash('sha256').update(aiArtifactContent).digest('hex'), schemaValid: true,
    metadataJson: JSON.stringify({ model: 'fixture' })
  })
  const ai = database.applyWritingAgentArtifact({
    taskRunId: 'fact-stale-ai-task', artifactId: 'fact-stale-ai-artifact', artifactType: 'writing_agent_turn',
    legacyChapterId: 20, title: manual.title, content: `${manual.content}AI 候选被作者采用。`, expectedRevision: manual.revision,
    metadataJson: JSON.stringify({ decision: 'applied' })
  }).chapter
  assert.equal(database.listFactBatches(20).find((batch) => batch.id === 'batch-before-ai')?.status, 'STALE')

  database.createFactBatch(batchInput('before-autosave', ai))
  const checkpoint = database.stageAutosaveCheckpoint({
    legacyChapterId: 20, clientOperationId: 'fact-autosave-op', baseBodyVersionId: ai.currentVersionId,
    title: ai.title, content: `${ai.content}自动保存的新句。`
  })
  const autosaved = database.finalizeAutosaveCheckpoint(checkpoint.checkpoint.id).chapter!
  assert.equal(database.listFactBatches(20).find((batch) => batch.id === 'batch-before-autosave')?.status, 'STALE')

  database.createFactBatch(batchInput('before-restore', autosaved))
  const restoreTarget = database.formalRevisions(20).find((revision) => revision.content !== autosaved.content)!
  database.restoreFormalRevision(20, restoreTarget.id, autosaved.revision)
  assert.equal(database.listFactBatches(20).find((batch) => batch.id === 'batch-before-restore')?.status, 'STALE')
  database.close()

  const raw = new DatabaseSync(databasePath, { allowExtension: false })
  raw.exec('PRAGMA foreign_keys = ON')
  assert.ok(Number(raw.prepare('SELECT COUNT(*) AS value FROM fact_source_impacts').get()?.value) >= 2)
  assert.throws(() => raw.exec(`UPDATE facts SET object_json = '{"value":"篡改"}'`), /append-only/)
  assert.throws(() => raw.exec(`DELETE FROM fact_sources`), /append-only/)
  assert.throws(() => raw.exec(`UPDATE fact_decisions SET decision = 'REJECTED'`), /append-only/)
  raw.exec(`
    INSERT INTO projects (
      id, name, status, legacy_manifest_hash, storage_mode, created_at, updated_at, outline_storage_ready,
      target_words, genre_text, audience_scale, default_pov, writing_style, chapter_target_words,
      autosave_enabled, autosave_delay_ms, config_json, current_schema_version, autosave_merge_window_ms
    )
    SELECT 'project-other', name, status, legacy_manifest_hash, storage_mode, created_at, updated_at, outline_storage_ready,
      target_words, genre_text, audience_scale, default_pov, writing_style, chapter_target_words,
      autosave_enabled, autosave_delay_ms, config_json, current_schema_version, autosave_merge_window_ms
    FROM projects LIMIT 1
  `)
  const scope = raw.prepare(`
    SELECT chapters.id AS chapter_id, chapters.current_body_version_id AS body_version_id, versions.content_hash
    FROM chapters JOIN body_versions versions ON versions.id = chapters.current_body_version_id LIMIT 1
  `).get() as Record<string, unknown>
  assert.throws(() => raw.prepare(`
    INSERT INTO fact_batches (
      id, project_id, chapter_id, body_version_id, content_hash, status, extractor_task_run_id,
      idempotency_key, counts_json, created_at, updated_at
    ) VALUES ('cross-project-batch', 'project-other', ?, ?, ?, 'PENDING', NULL, 'cross-project', '{}', ?, ?)
  `).run(String(scope.chapter_id), String(scope.body_version_id), String(scope.content_hash), '2026-09-01T05:00:00.000Z', '2026-09-01T05:00:00.000Z'), /scope mismatch/)
  raw.close()
})

function seedVersion6Database(path: string): void {
  const database = new DatabaseSync(path, { allowExtension: false })
  database.exec('PRAGMA foreign_keys = ON')
  for (const migration of workspaceDatabaseMigrations.filter((entry) => entry.version <= 6)) {
    database.exec(migration.sql)
    database.prepare('INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)')
      .run(migration.version, migration.name, '2026-09-01T03:00:00.000Z', migration.checksum)
    database.exec(`PRAGMA user_version = ${migration.version}`)
  }
  const manuscript = '旧城的雨落了一夜。'
  const empty = ''
  const outlineContent = ['故事梗概。', '第一卷大纲。', '第一章章纲。']
  database.prepare(`INSERT INTO projects (id, name, status, legacy_manifest_hash, storage_mode, created_at, updated_at, outline_storage_ready) VALUES ('project-1', '迁移样本', 'active', ?, 'sqlite', ?, ?, 1)`)
    .run('a'.repeat(64), '2026-09-01T03:00:00.000Z', '2026-09-01T03:00:00.000Z')
  const insertChapter = database.prepare(`INSERT INTO chapters (id, project_id, legacy_chapter_id, seq, title, status, current_body_version_id, confirmed_body_version_id, created_at, updated_at) VALUES (?, 'project-1', ?, ?, ?, ?, NULL, NULL, ?, ?)`)
  const insertBody = database.prepare(`INSERT INTO body_versions (id, chapter_id, version_no, content, content_hash, parent_id, restored_from_version_id, source_type, source_task_run_id, created_at) VALUES (?, ?, 1, ?, ?, NULL, NULL, 'legacy_import', NULL, ?)`)
  for (const [id, legacyId, seq, title, status, content] of [
    ['chapter-1', 1, 1, '雨夜来客', 'confirmed', manuscript],
    ['chapter-2', 2, 2, '空白旧章', 'archived', empty]
  ] as const) {
    const bodyId = `body-${legacyId}`
    const contentHash = createHash('sha256').update(content).digest('hex')
    insertChapter.run(id, legacyId, seq, title, status, '2026-09-01T03:00:00.000Z', '2026-09-01T03:00:00.000Z')
    insertBody.run(bodyId, id, content, contentHash, '2026-09-01T03:00:00.000Z')
    database.prepare(`INSERT INTO body_version_metadata (version_id, title, reason) VALUES (?, ?, 'legacy_import')`).run(bodyId, title)
    database.prepare(`UPDATE chapters SET current_body_version_id = ?, confirmed_body_version_id = ? WHERE id = ?`).run(bodyId, status === 'confirmed' ? bodyId : null, id)
    database.prepare(`INSERT INTO mirror_entries (id, project_id, source_type, source_id, source_version_id, relative_path, content_hash, observed_hash, status, last_error_code, updated_at, previous_relative_path, previous_observed_hash) VALUES (?, 'project-1', 'chapter_markdown', ?, ?, ?, ?, ?, 'synced', NULL, ?, NULL, NULL)`)
      .run(`mirror-chapter-${legacyId}`, id, bodyId, `正文/第${legacyId}章-${title}.md`, contentHash, contentHash, '2026-09-01T03:00:00.000Z')
  }
  const nodes = [
    ['outline-total', null, 'total', 'summary', 1, '故事梗概', outlineContent[0], '大纲/总纲.md'],
    ['outline-volume', 'outline-total', 'volume-1', 'volume', 1, '第一卷', outlineContent[1], '大纲/第1卷-大纲.md'],
    ['outline-chapter', 'outline-volume', 'chapter-1', 'chapter', 1, '第一章', outlineContent[2], '大纲/章纲/第1章.md']
  ] as const
  for (const [id, parentId, legacyKey, nodeType, seq, title, content, mirrorPath] of nodes) {
    const versionId = `${id}-v1`
    const contentHash = createHash('sha256').update(content).digest('hex')
    database.prepare(`INSERT INTO outline_nodes (id, project_id, parent_id, legacy_key, node_type, seq, title, content, content_hash, status, current_version_id, created_at, updated_at) VALUES (?, 'project-1', ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?)`)
      .run(id, parentId, legacyKey, nodeType, seq, title, content, contentHash, '2026-09-01T03:00:00.000Z', '2026-09-01T03:00:00.000Z')
    database.prepare(`INSERT INTO outline_versions (id, outline_node_id, version_no, content, content_hash, parent_id, source_type, created_at) VALUES (?, ?, 1, ?, ?, NULL, 'legacy_import', ?)`)
      .run(versionId, id, content, contentHash, '2026-09-01T03:00:00.000Z')
    database.prepare('UPDATE outline_nodes SET current_version_id = ? WHERE id = ?').run(versionId, id)
    database.prepare(`INSERT INTO mirror_entries (id, project_id, source_type, source_id, source_version_id, relative_path, content_hash, observed_hash, status, last_error_code, updated_at, previous_relative_path, previous_observed_hash) VALUES (?, 'project-1', 'outline_markdown', ?, ?, ?, ?, ?, 'synced', NULL, ?, NULL, NULL)`)
      .run(`mirror-outline-${legacyKey}`, id, versionId, mirrorPath, contentHash, contentHash, '2026-09-01T03:00:00.000Z')
  }
  database.close()
}

async function projectFileHashes(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  await walk(root, async (path) => {
    const relativePath = relative(root, path).replace(/\\/g, '/')
    if (relativePath === WORKSPACE_DATABASE_RELATIVE_PATH
      || relativePath === `${WORKSPACE_DATABASE_RELATIVE_PATH}-wal`
      || relativePath === `${WORKSPACE_DATABASE_RELATIVE_PATH}-shm`) return
    result[relativePath] = createHash('sha256').update(await readFile(path)).digest('hex')
  })
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)))
}

async function walk(root: string, visit: (path: string) => Promise<void>): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) await walk(path, visit)
    else if (entry.isFile()) await visit(path)
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function removeDatabaseFiles(path: string): Promise<void> {
  for (const target of [path, `${path}-wal`, `${path}-shm`]) await rm(target, { force: true })
}
