import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { WORKSPACE_DATABASE_SCHEMA_VERSION } from '../../../src/main/core/ports/workspace-database'
import { createRequire } from 'node:module'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'
import { previewLegacyTextMigration, exportLegacyTextMigration } from '../../../src/main/modules/manuscript/adapters/manuscript-text-export'
import { ManuscriptFileStore, textHash } from '../../../src/main/modules/manuscript/adapters/manuscript-file-store'
import { installMigratedTextReferences } from '../../../src/main/modules/manuscript/adapters/manuscript-text-migration'
import { ManuscriptCommitJournal } from '../../../src/main/modules/manuscript/adapters/manuscript-commit-journal'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'
import { DocumentService } from '../../../src/main/modules/manuscript/application/document-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../../src/main/modules/library/application/legacy-workspace-source'
import { LibraryOutlinePreviewService } from '../../../src/main/modules/library/application/library-outline-preview-service'
import { WorkspaceBackupService } from '../../../src/main/modules/library/application/workspace-backup-service'
import { ManuscriptTextMigrationService } from '../../../src/main/modules/manuscript/application/manuscript-text-migration-service'
import { NewFileProjectStorage } from '../../../src/main/modules/library/application/new-file-project-storage'
import { intermediateManuscriptSchema41Checksum } from '../../../src/main/modules/manuscript/adapters/manuscript-text-objects'
import { readLibraryLastEditedChapter } from '../../../src/main/modules/library/application/library-last-edited-chapter'

async function fixture(t: TestContext, now?: () => Date) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'lanjian-text-export-'))
  t.after(async () => {
    assert.equal(await realpath(root), root)
    assert.equal(dirname(root), await realpath(tmpdir()))
    await rm(root, { recursive: true, force: true })
  })
  const settings = new SettingsStore(join(root, 'user-data'), {
    available: () => true, encrypt: value => Buffer.from(value).toString('base64'), decrypt: value => Buffer.from(value, 'base64').toString()
  })
  const projects = new ProjectService(settings)
  const { project } = await projects.create({ parentPath: root, name: '迁移测试小说', genre: '玄幻' })
  const documents = new DocumentService(projects)
  await documents.updateChapter(1, { title: '第一章', content: '初稿：雨夜来信。' })
  await documents.updateChapter(2, { title: '第二章', content: '之后归档，但历史不能丢。' })
  await documents.updateOutline('total', '# 总纲\n\n找出写信的人。')
  const source = new CurrentProjectLegacyWorkspaceSource(projects, documents)
  const snapshot = await source.snapshot()
  const factory = new SqliteWorkspaceDatabaseFactory(now)
  const db = await factory.open(project.path)
  db.importSnapshot(snapshot)
  db.activateSqlite(snapshot)
  const old = db.formalChapter(1)!
  db.writeFormalChapter({ legacyChapterId: 1, title: old.title, content: '数据库中新稿：雨夜来信，信封没有署名。', reason: 'manual', expectedRevision: old.revision })
  const head = db.formalChapter(1)!
  db.stageAutosaveCheckpoint({ legacyChapterId: 1, clientOperationId: randomUUID(), baseBodyVersionId: head.currentVersionId,
    title: head.title, content: '还没完成的自动保存草稿。' })
  db.archiveFormalChapter(2)
  db.close()
  const output = join(root, 'export')
  await mkdir(output)
  return { root, project, factory, output }
}

async function fileHashes(root: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {}
  const walk = async (directory: string, prefix: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const key = prefix + entry.name
      if (entry.isDirectory()) await walk(join(directory, entry.name), key + '/')
      else hashes[key] = createHash('sha256').update(await readFile(join(directory, entry.name))).digest('hex')
    }
  }
  await walk(root, '')
  return hashes
}

async function migratedFixture(t: TestContext, now?: () => Date) {
  const value = await fixture(t, now)
  const preview = await previewLegacyTextMigration(value.project.path)
  await exportLegacyTextMigration(value.project.path, value.output, preview.fingerprint)
  const files = await ManuscriptFileStore.open(value.project.path)
  const exported = await ManuscriptFileStore.open(value.output)
  for (const head of preview.current) {
    await files.save({ operationId: randomUUID(), documentId: head.documentId, kind: head.kind,
      relativePath: head.relativePath, title: '迁移稿件', expectedHash: head.observedHash,
      content: (await exported.readSnapshot(head.hash)).content }, async () => {})
  }
  const raw = new DatabaseSync(join(value.project.path, '.webnovel/workspace.sqlite'))
  try {
    raw.exec('PRAGMA foreign_keys = ON')
    await installMigratedTextReferences(raw, value.project.path, value.output, preview)
  } finally { raw.close() }
  return { ...value, preview }
}

test('zero-write preview/export retains all current, archived and checkpoint identities with byte-verified file snapshots', async t => {
  const { project, output } = await fixture(t)
  const before = await fileHashes(project.path)
  const preview = await previewLegacyTextMigration(project.path)
  assert.equal(preview.counts.body_versions, 3)
  assert.equal(preview.counts.autosave_checkpoints, 1)
  assert.ok(preview.counts.outline_nodes > 0)
  assert.equal(preview.current.filter(item => item.kind === 'body').length, 1)
  assert.equal(preview.current.find(item => item.kind === 'body')!.state, 'stale-mirror')
  const exported = await exportLegacyTextMigration(project.path, output, preview.fingerprint)
  assert.equal(exported.fingerprint, preview.fingerprint)
  const files = await ManuscriptFileStore.open(output)
  for (const reference of exported.references) {
    assert.equal((await files.readSnapshot(reference.hash)).hash, reference.hash)
    assert.equal('content' in reference.metadata, false)
    assert.equal(typeof reference.metadata.id, 'string')
  }
  const checkpoint = exported.references.find(item => item.table === 'autosave_checkpoints')!
  assert.equal((await files.readSnapshot(checkpoint.hash)).content, '还没完成的自动保存草稿。')
  assert.ok(exported.references.some(item => item.table === 'body_versions' && item.hash === textHash('之后归档，但历史不能丢。')))
  assert.deepEqual(await fileHashes(project.path), before)
  const manifest = JSON.parse(await readFile(join(output, 'text-export.json'), 'utf8'))
  assert.equal(manifest.exportOnly, true)
  assert.equal(manifest.backups.length >= 1, true)
  const backup = new DatabaseSync(join(output, 'source-database/workspace.sqlite'), { readOnly: true })
  try {
    assert.equal(backup.prepare('SELECT count(*) AS n FROM body_versions').get()?.n, 3)
    assert.equal(backup.prepare('SELECT content FROM autosave_checkpoints').get()?.content, '还没完成的自动保存草稿。')
  } finally { backup.close() }
})

test('preview detects external manuscript conflict and stale preview aborts before any export writes', async t => {
  const { project, output } = await fixture(t)
  const first = await previewLegacyTextMigration(project.path)
  const file = first.current.find(item => item.kind === 'body')!
  await writeFile(join(project.path, file.relativePath), '作者在外部改的新稿。', 'utf8')
  const before = await fileHashes(project.path)
  await assert.rejects(exportLegacyTextMigration(project.path, output, first.fingerprint), { code: 'CONFLICT' })
  assert.deepEqual(await readdir(output), [])
  const next = await previewLegacyTextMigration(project.path)
  assert.equal(next.current.find(item => item.kind === 'body')!.state, 'external-conflict')
  assert.deepEqual(await fileHashes(project.path), before)
})

test('export refuses nonempty destination and source-book destinations without changing either', async t => {
  const { project, output } = await fixture(t)
  const preview = await previewLegacyTextMigration(project.path)
  await writeFile(join(output, 'keep.txt'), 'retain me')
  await assert.rejects(exportLegacyTextMigration(project.path, output, preview.fingerprint), { code: 'CONFLICT' })
  await assert.rejects(exportLegacyTextMigration(project.path, project.path, preview.fingerprint), { code: 'PATH_ESCAPE' })
  assert.equal(await readFile(join(output, 'keep.txt'), 'utf8'), 'retain me')
})

test('a damaged historical row blocks export instead of silently skipping old text', async t => {
  const { project, output } = await fixture(t)
  const raw = new DatabaseSync(join(project.path, '.webnovel/workspace.sqlite'))
  raw.exec('DROP TRIGGER body_versions_no_update')
  raw.exec("UPDATE body_versions SET content_hash = '" + '0'.repeat(64) + "' WHERE version_no = 1")
  raw.close()
  const before = await fileHashes(project.path)
  await assert.rejects(previewLegacyTextMigration(project.path), { code: 'DATABASE_INTEGRITY_FAILED' })
  assert.deepEqual(await fileHashes(project.path), before)
  assert.deepEqual(await readdir(output), [])
})

test('manual and checkpoint saves do not load the whole formal chapter list', async t => {
  const { project, factory } = await fixture(t)
  const { SqliteManuscriptService } = await import('../../../src/main/modules/manuscript/application/sqlite-manuscript-service')
  const originalOpen = factory.openExisting.bind(factory)
  factory.openExisting = async root => {
    const db = await originalOpen(root)
    if (db) db.formalChapters = () => { throw new Error('whole-book read in single-chapter save') }
    return db
  }
  const authority = new SqliteManuscriptService(factory, { trashItem: async () => {} })
  const changed = await authority.updateChapter(project.path, 1, { content: '单章手动保存。' })
  assert.equal(changed.content, '单章手动保存。')
  const stage = await authority.stageAutosave(project.path, 1, { title: changed.title, content: '单章自动保存。', clientOperationId: randomUUID() })
  assert.ok(stage.checkpoint)
  const finalized = await authority.finalizeAutosave(project.path, stage.checkpoint.id)
  assert.equal(finalized.chapter.content, '单章自动保存。')
})

test('migrated SQLite retains identities while materializing every historical text through explicit file references', async t => {
  const { project, factory, preview } = await migratedFixture(t)
  const raw = new DatabaseSync(join(project.path, '.webnovel/workspace.sqlite'))
  try {
    raw.exec('PRAGMA foreign_keys = ON')
    for (const table of Object.keys(preview.counts)) {
      assert.equal(raw.prepare(`SELECT count(*) AS n FROM ${table} WHERE content <> ''`).get()?.n, 0)
      assert.equal(raw.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, preview.counts[table as keyof typeof preview.counts])
      for (const item of preview.references.filter(item => item.table === table)) {
        const { content, content_hash, ...metadata } = raw.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(item.id)!
        assert.equal(content, '')
        assert.equal(content_hash, item.hash)
        assert.deepEqual({ ...metadata }, item.metadata)
      }
    }
    assert.throws(() => raw.exec("UPDATE body_versions SET content = 'forbidden'"), /append.only/)
    assert.throws(() => raw.exec("DELETE FROM body_versions"), /append.only/)
  } finally { raw.close() }
  const db = await factory.openExisting(project.path)
  assert.ok(db)
  try {
    assert.equal(db.textAuthority(), 'files-v1')
    assert.equal(db.storageMode(), 'sqlite', 'structured modules keep their existing capability')
    assert.equal(db.formalChapter(1)?.content, '数据库中新稿：雨夜来信，信封没有署名。')
    assert.equal(db.formalArchivedChapters()[0].content, '之后归档，但历史不能丢。')
    assert.equal(db.formalRevisions(1).length, 2)
    assert.equal(db.listAutosaveCheckpoints(1)[0].content, '还没完成的自动保存草稿。')
    assert.equal(db.formalOutlines().find(item => item.legacyKey === 'total')?.content, '# 总纲\n\n找出写信的人。')
    const oldId = db.formalChapter(1)!.currentVersionId
    const write = db.writeFormalChapter({ legacyChapterId: 1, title: '第一章', content: '新版里有青铜钥匙。'.repeat(500), reason: 'manual' })
    assert.notEqual(write.chapter.currentVersionId, oldId)
    assert.equal(db.formalBodyVersion(1, oldId).content, '数据库中新稿：雨夜来信，信封没有署名。')
    db.createFormalChapter(3)
    const chunks = db.searchCurrentDocumentChunksBefore(3, ['青铜钥匙'])
    assert.ok(chunks.length > 2)
    assert.ok(chunks.every(item => item.content.includes('青铜钥匙')))
    const checkpoint = db.stageAutosaveCheckpoint({ legacyChapterId: 1, clientOperationId: randomUUID(),
      baseBodyVersionId: write.chapter.currentVersionId, title: '第一章', content: '后续草稿。' })
    assert.equal(checkpoint.checkpoint.content, '后续草稿。')
    const finalized = db.finalizeAutosaveCheckpoint(checkpoint.checkpoint.id)
    assert.equal(finalized.chapter?.content, '后续草稿。')
    assert.ok(db.readableMirrorPlans().some(plan => plan.content === '后续草稿。'))
  } finally { db.close() }
  const readonly = await factory.openRecoveryReadOnly(project.path)
  assert.ok(readonly)
  try { assert.equal(readonly.formalChapters()[0].content, '后续草稿。') } finally { readonly.close() }
  const check = new DatabaseSync(join(project.path, '.webnovel/workspace.sqlite'), { readOnly: true })
  try {
    for (const table of Object.keys(preview.counts)) assert.equal(check.prepare(`SELECT count(*) AS n FROM ${table} WHERE content <> ''`).get()?.n, 0)
    assert.ok(Number(check.prepare('SELECT count(*) AS n FROM manuscript_text_objects WHERE range_start IS NOT NULL').get()?.n) > 0)
    assert.equal(check.prepare('PRAGMA foreign_key_check').all().length, 0)
  } finally { check.close() }
})

test('mirror-plan filters avoid materializing unrelated file-authoritative manuscript history', async t => {
  const { project, factory } = await migratedFixture(t)
  const database = await factory.openExisting(project.path)
  assert.ok(database)
  try {
    const currentVersionId = database.formalChapter(1)!.currentVersionId
    const raw = new DatabaseSync(join(project.path, '.webnovel/workspace.sqlite'), { readOnly: true })
    let historyRelativePath: string
    try {
      const row = raw.prepare(`
        SELECT objects.relative_path
        FROM body_versions versions
        JOIN manuscript_text_objects objects ON objects.content_hash = versions.content_hash
        WHERE versions.id = ?
      `).get(currentVersionId)
      assert.equal(typeof row?.relative_path, 'string')
      historyRelativePath = String(row!.relative_path)
    } finally { raw.close() }
    await rm(join(project.path, historyRelativePath))

    const orderOnly = database.readableMirrorPlans({ sourceTypes: ['chapter_order_json'] })
    assert.equal(orderOnly.length, 1)
    assert.equal(orderOnly[0]!.sourceType, 'chapter_order_json')
    assert.throws(() => database.readableMirrorPlans({ sourceTypes: ['chapter_markdown'] }), { code: 'DATABASE_INTEGRITY_FAILED' })

    database.close()
    const recovery = await factory.openRecoveryReadOnly(project.path)
    assert.ok(recovery)
    try {
      assert.equal(recovery.readableMirrorPlans({ sourceTypes: ['chapter_order_json'] }).length, 1)
      assert.throws(() => recovery.readableMirrorPlans({ sourceTypes: ['chapter_markdown'], legacyChapterId: 1 }), { code: 'DATABASE_INTEGRITY_FAILED' })
    } finally { recovery.close() }
  } finally { database.close() }
})

test('file-first service commits one current document, renames safely, stages immediately and restores through a new version', async t => {
  const { project, factory } = await migratedFixture(t)
  const { SqliteManuscriptService } = await import('../../../src/main/modules/manuscript/application/sqlite-manuscript-service')
  const service = new SqliteManuscriptService(factory)
  const initial = (await service.chapters(project.path))[0]
  const edited = await service.updateChapter(project.path, 1, { title: '换名', content: '当前文件正文。', expectedRevision: initial.revision })
  assert.equal(edited.content, '当前文件正文。')
  const db = await factory.openExisting(project.path)
  assert.ok(db)
  const chapter = db.formalChapter(1)!
  db.close()
  assert.equal(await readFile(join(project.path, chapter.mirrorRelativePath), 'utf8'), edited.content)
  const stage = await service.stageAutosave(project.path, 1, { title: '换名', content: '马上可读的自动保存。', clientOperationId: randomUUID() })
  assert.equal(await readFile(join(project.path, chapter.mirrorRelativePath), 'utf8'), '马上可读的自动保存。')
  assert.equal((await service.chapters(project.path))[0].content, '马上可读的自动保存。')
  await service.finalizeAutosave(project.path, stage.checkpoint!.id)
  const revisions = await service.revisions(project.path, 1)
  const previous = revisions.find(item => item.content === '当前文件正文。')!
  assert.ok(previous)
  const restored = await service.restoreRevision(project.path, 1, previous.id)
  assert.equal(restored.content, '当前文件正文。')
  assert.notEqual(restored.bodyVersionId, edited.bodyVersionId)
  assert.equal(await readFile(join(project.path, chapter.mirrorRelativePath), 'utf8'), '当前文件正文。')
})

test('failure after Markdown replacement preserves new text and replays its exact authorized metadata operation on reopen', async t => {
  const { project, factory } = await migratedFixture(t)
  const path = join(project.path, '.webnovel/workspace.sqlite')
  let db = await factory.openExisting(project.path)
  assert.ok(db)
  const old = db.formalChapter(1)!
  const raw = new DatabaseSync(path)
  raw.exec("CREATE TRIGGER test_commit_failure BEFORE INSERT ON manuscript_file_commits BEGIN SELECT RAISE(ABORT, 'injected metadata failure'); END")
  raw.close()
  assert.throws(() => db!.writeFormalChapter({ legacyChapterId: 1, title: old.title, content: '已落盘，等待索引。',
    reason: 'manual', expectedRevision: old.revision }), { code: 'STORAGE_ERROR' })
  assert.equal(await readFile(join(project.path, old.mirrorRelativePath), 'utf8'), '已落盘，等待索引。')
  assert.equal(db.formalBodyVersion(1, old.currentVersionId).content, old.content)
  assert.equal(db.formalChapter(1)?.content, '已落盘，等待索引。', 'current file never falls back to old SQL/history')
  db.close()
  const journal = new ManuscriptCommitJournal(project.path)
  assert.equal(journal.pending().length, 1)
  assert.equal(JSON.stringify(journal.pending()).includes('已落盘，等待索引。'), false)
  const removeFailure = new DatabaseSync(path)
  removeFailure.exec('DROP TRIGGER test_commit_failure')
  removeFailure.close()
  db = await factory.openExisting(project.path)
  assert.ok(db)
  try {
    db.recoverManuscriptCommits()
    const recovered = db.formalChapter(1)!
    assert.equal(recovered.content, '已落盘，等待索引。')
    assert.notEqual(recovered.currentVersionId, old.currentVersionId)
    assert.equal(journal.pending().length, 0)
    const count = db.formalRevisions(1).length
    db.recoverManuscriptCommits()
    assert.equal(db.formalRevisions(1).length, count, 'recovery is not a new author edit')
  } finally { db.close() }
})

test('reopened autosave uses current file revision for manual save and cannot be mislabeled as an old history version', async t => {
  const { project, factory } = await migratedFixture(t)
  const { SqliteManuscriptService } = await import('../../../src/main/modules/manuscript/application/sqlite-manuscript-service')
  const service = new SqliteManuscriptService(factory)
  const initial = (await service.chapters(project.path))[0]
  await service.stageAutosave(project.path, 1, { title: '新标题', content: '退出前已保存的最新输入。', clientOperationId: randomUUID() })
  const reopened = (await service.chapters(project.path))[0]
  assert.notEqual(reopened.revision, initial.revision)
  const db = await factory.openExisting(project.path)
  assert.ok(db)
  try {
    assert.throws(() => db.nameCurrentFormalRevision(1, '不能命名旧稿'), { code: 'CONFLICT' })
    assert.throws(() => db.archiveFormalChapter(1), { code: 'CONFLICT' })
    assert.throws(() => db.createTaskRun({ id: randomUUID(), idempotencyKey: randomUUID(), taskType: 'writing_agent',
      legacyChapterId: 1, checkpointJson: '{}', baseBodyVersionId: initial.bodyVersionId }), { code: 'CONFLICT' })
  } finally { db.close() }
  const saved = await service.updateChapter(project.path, 1, { title: reopened.title, content: '重启后继续写。', expectedRevision: reopened.revision })
  assert.equal(saved.content, '重启后继续写。')
  assert.notEqual(saved.bodyVersionId, initial.bodyVersionId)
  const check = await factory.openExisting(project.path)
  assert.ok(check)
  try { assert.equal(check.formalBodyVersion(1, saved.bodyVersionId!).content, saved.content) } finally { check.close() }
})

test('finalizing an older idle window never replaces the newer current autosave file', async t => {
  let time = Date.parse('2026-09-18T00:00:00.000Z')
  const { project, factory } = await migratedFixture(t, () => new Date(time))
  const { SqliteManuscriptService } = await import('../../../src/main/modules/manuscript/application/sqlite-manuscript-service')
  const service = new SqliteManuscriptService(factory)
  const base = (await service.chapters(project.path))[0]
  const first = await service.stageAutosave(project.path, 1, { title: base.title, content: '第一窗口。', clientOperationId: randomUUID(), mergeWindowMs: 1000 })
  time += 2000
  const second = await service.stageAutosave(project.path, 1, { title: base.title, content: '第二窗口，最新正文。', clientOperationId: randomUUID(), mergeWindowMs: 1000 })
  assert.notEqual(first.checkpoint!.id, second.checkpoint!.id)
  const finalized = await service.finalizeAutosave(project.path, first.checkpoint!.id)
  assert.equal(finalized.chapter.content, '第二窗口，最新正文。')
  assert.equal((await service.chapters(project.path))[0].content, '第二窗口，最新正文。')
  const final = await service.finalizeAutosave(project.path, second.checkpoint!.id)
  assert.equal(final.chapter.content, '第二窗口，最新正文。')
  assert.ok((await service.revisions(project.path, 1)).some(revision => revision.content === '第一窗口。'))
})

test('external current files are read as current; missing files are not reconstructed from historical objects', async t => {
  const { project, factory } = await migratedFixture(t)
  const db = await factory.openExisting(project.path)
  assert.ok(db)
  const old = db.formalChapter(1)!
  const path = join(project.path, old.mirrorRelativePath)
  try {
    await writeFile(path, '作者在外部编辑的正文。', 'utf8')
    const before = await fileHashes(project.path)
    assert.equal(db.formalChapter(1)?.content, '作者在外部编辑的正文。')
    assert.equal(db.formalChapter(1)?.mirrorStatus, 'conflict')
    assert.deepEqual(await fileHashes(project.path), before, 'ordinary reads have no repair side effects')
    assert.throws(() => db.writeFormalChapter({ legacyChapterId: 1, title: old.title, content: '旧草稿覆盖', reason: 'manual', expectedRevision: old.revision }), { code: 'CONFLICT' })
    assert.equal(await readFile(path, 'utf8'), '作者在外部编辑的正文。')
    const refreshed = db.formalChapter(1)!
    const saved = db.writeFormalChapter({ legacyChapterId: 1, title: refreshed.title, content: '读到外部稿后继续修改。', reason: 'manual', expectedRevision: refreshed.revision })
    assert.equal(saved.chapter.content, '读到外部稿后继续修改。')
    assert.ok(db.formalRevisions(1).some(version => version.content === '作者在外部编辑的正文。' && version.label === '外部文件修订'))
    await rm(path)
    assert.throws(() => db.formalChapter(1), { code: 'NOT_FOUND' })
  } finally { db.close() }
  const { SqliteManuscriptService } = await import('../../../src/main/modules/manuscript/application/sqlite-manuscript-service')
  const service = new SqliteManuscriptService(factory)
  await assert.rejects(service.chapters(project.path), { code: 'NOT_FOUND' })
  await assert.rejects(readFile(path), { code: 'ENOENT' })
  const chosen = (await service.revisions(project.path, 1)).find(version => version.content === '作者在外部编辑的正文。')!
  const restored = await service.restoreRevision(project.path, 1, chosen.id)
  assert.equal(restored.content, chosen.content)
  assert.equal(await readFile(path, 'utf8'), chosen.content)
})

test('shelf preview and audit read actual file text without repairing or changing the book', async t => {
  const { project, factory } = await migratedFixture(t)
  const db = await factory.openExisting(project.path)
  assert.ok(db)
  const chapter = db.formalChapter(1)!
  db.close()
  await writeFile(join(project.path, chapter.mirrorRelativePath), '外部最新稿。')
  const before = await fileHashes(project.path)
  const preview = await new LibraryOutlinePreviewService({ load: async () => ({ recentProjects: [project.path] }) })
    .preview({ path: project.path, offset: 0 })
  assert.equal(preview.chapters[0].wordCount, 5)
  assert.equal(preview.chapters[0].status, 'draft')
  const { auditBook } = createRequire(import.meta.url)('../../../scripts/book-authority-audit.cjs')
  const audit = await auditBook(project.path, { expectedChapters: 1 })
  assert.equal(audit.authority, 'files-v1')
  assert.equal(audit.bodyPopulated, 1)
  assert.equal(audit.bodyConfirmedCurrent, 0)
  assert.deepEqual(await fileHashes(project.path), before)
})

test('file-authoritative backup restores relative current and all immutable history into an independent book', async t => {
  const { root, project, factory } = await migratedFixture(t)
  const backups = join(root, 'backups'), restores = join(root, 'restores')
  await mkdir(backups); await mkdir(restores)
  const service = new WorkspaceBackupService(factory, async () => project.path, async () => '文件作品', () => 'test')
  const backup = await service.create(backups)
  const snapshot = await fileHashes(backup.backupPath)
  const preview = await service.previewRestore(backup.backupPath)
  assert.ok(preview.token)
  const result = await service.restore(preview.token, restores)
  const restored = await factory.openExisting(result.projectPath)
  assert.ok(restored)
  try {
    assert.equal(restored.textAuthority(), 'files-v1')
    assert.equal(restored.formalChapter(1)?.content, '数据库中新稿：雨夜来信，信封没有署名。')
    assert.equal(restored.formalRevisions(1).length, 2)
    assert.equal(restored.listAutosaveCheckpoints(1)[0].content, '还没完成的自动保存草稿。')
    restored.writeFormalChapter({ legacyChapterId: 1, title: '独立副本', content: '只改变恢复副本。', reason: 'manual' })
  } finally { restored.close() }
  const original = await factory.openExisting(project.path)
  assert.ok(original)
  try { assert.equal(original.formalChapter(1)?.content, '数据库中新稿：雨夜来信，信封没有署名。') } finally { original.close() }
  assert.deepEqual(await fileHashes(backup.backupPath), snapshot)
})

test('schema guards reject SQL text copies and in-place authority downgrade; missing guards fail closed', async t => {
  const { project, factory } = await migratedFixture(t)
  const raw = new DatabaseSync(join(project.path, '.webnovel/workspace.sqlite'))
  try {
    assert.throws(() => raw.exec("UPDATE projects SET text_authority = 'legacy-sqlite'"), /cannot be downgraded/)
    assert.throws(() => raw.exec("UPDATE document_chunks SET content = 'duplicate manuscript'"), /must not be stored/)
    assert.throws(() => raw.exec("DELETE FROM manuscript_text_objects"), /immutable/)
    raw.exec('DROP TRIGGER manuscript_document_chunks_insert_guard')
  } finally { raw.close() }
  await assert.rejects(factory.openExisting(project.path), { code: 'DATABASE_INTEGRITY_FAILED' })
})

test('outline saves preserve external revisions and reject stale input before touching its file', async t => {
  const { project, factory } = await migratedFixture(t)
  const db = await factory.openExisting(project.path)
  assert.ok(db)
  try {
    const before = db.formalOutlines().find(outline => outline.legacyKey === 'total')!
    const path = join(project.path, before.mirrorRelativePath)
    await writeFile(path, '# 外部最新总纲\n改了核心事件。')
    assert.throws(() => db.writeFormalOutline({ ...before, expectedRevision: before.revision, content: '旧稿覆盖' }), { code: 'CONFLICT' })
    const actual = db.formalOutlines().find(outline => outline.legacyKey === 'total')!
    const result = db.writeFormalOutline({ ...actual, expectedRevision: actual.revision, content: '# 再次修订总纲\n保留外部历史。' })
    assert.equal(await readFile(path, 'utf8'), result.outline.content)
    const raw = new DatabaseSync(join(project.path, '.webnovel/workspace.sqlite'), { readOnly: true })
    try {
      assert.ok(raw.prepare('SELECT id FROM outline_versions WHERE content_hash = ?').get(textHash(actual.content)))
      assert.equal(raw.prepare("SELECT count(*) AS n FROM outline_versions WHERE content <> ''").get()?.n, 0)
    } finally { raw.close() }
  } finally { db.close() }
})

test('merged autosaves retain bounded temporary text without pruning imported or referenced history', async t => {
  const { project, factory } = await migratedFixture(t)
  const db = await factory.openExisting(project.path)
  assert.ok(db)
  const before = await readdir(join(project.path, '.webnovel/history/text'))
  try {
    const chapter = db.formalChapter(1)!
    let checkpoint = ''
    for (let i = 0; i < 20; i++) {
      const staged = db.stageAutosaveCheckpoint({ legacyChapterId: 1, clientOperationId: randomUUID(),
        baseBodyVersionId: chapter.currentVersionId, title: chapter.title, content: `快速输入 ${i}，保留最后一份。` })
      checkpoint = staged.checkpoint.id
    }
    const after = await readdir(join(project.path, '.webnovel/history/text'))
    assert.ok(before.every(name => after.includes(name)), 'all imported/history objects remain')
    assert.equal(after.length, before.length + 1, 'one live autosave object, not one full copy per stage')
    db.finalizeAutosaveCheckpoint(checkpoint)
    const current = db.formalChapter(1)!
    assert.equal(db.formalBodyVersion(1, current.currentVersionId).content, '快速输入 19，保留最后一份。')
  } finally { db.close() }
})

test('complete migration keeps verified old database/files and resumes after publishing or mode-commit interruption', async t => {
  for (const failure of ['published', 'committed'] as const) {
    const { project, output, factory } = await fixture(t)
    const before = await fileHashes(project.path)
    const preview = await previewLegacyTextMigration(project.path)
    let injected = false
    const migration = new ManuscriptTextMigrationService(factory, undefined, async phase => {
      if (phase === failure && !injected) { injected = true; throw new Error('simulated power loss') }
    })
    await migration.prepare(project.path, output, preview.fingerprint)
    await assert.rejects(migration.resume(project.path, output), /simulated power loss/)
    assert.equal(injected, true)
    await assert.rejects(factory.openExisting(project.path), { code: 'CONFLICT' })
    const recovered = await new ManuscriptTextMigrationService(factory).resume(project.path, output)
    assert.equal(recovered.authority, 'files-v1')
    assert.equal(recovered.vacuumed, true)
    for (const [name, hash] of Object.entries(before).filter(([name]) => !name.includes('workspace.sqlite'))) {
      assert.equal(textHash(await readFile(join(recovered.backupPath, name), 'utf8')), hash, name)
    }
    const db = await factory.openExisting(project.path)
    assert.ok(db)
    try {
      assert.equal(db.textAuthority(), 'files-v1')
      assert.equal(db.formalRevisions(1).length, 2)
      assert.equal(db.listAutosaveCheckpoints(1)[0].content, '还没完成的自动保存草稿。')
      assert.equal(db.formalChapter(1)?.content, '数据库中新稿：雨夜来信，信封没有署名。')
    } finally { db.close() }
    assert.deepEqual(await new ManuscriptTextMigrationService(factory).resume(project.path, output), recovered)
  }
})

test('migration refuses changed metadata and external text before publishing, retaining its complete backup', async t => {
  const { project, output, factory } = await fixture(t)
  const migration = new ManuscriptTextMigrationService(factory)
  const preview = await previewLegacyTextMigration(project.path)
  await migration.prepare(project.path, output, preview.fingerprint)
  const raw = new DatabaseSync(join(project.path, '.webnovel/workspace.sqlite'))
  raw.exec("UPDATE chapters SET title = '作者刚改的新标题' WHERE legacy_chapter_id = 1")
  raw.close()
  const before = await fileHashes(project.path)
  await assert.rejects(migration.resume(project.path, output), { code: 'CONFLICT' })
  assert.deepEqual(await fileHashes(project.path), before)
})

test('version-bound retrieval fixes latest unconfirmed files before returning provenance instead of searching old text', async t => {
  const { project, factory } = await migratedFixture(t)
  const db = await factory.openExisting(project.path)
  assert.ok(db)
  try {
    const first = db.formalChapter(1)!
    db.stageAutosaveCheckpoint({ legacyChapterId: 1, clientOperationId: randomUUID(), baseBodyVersionId: first.currentVersionId,
      title: first.title, content: '最新稿里出现紫铜罗盘。' })
    db.createFormalChapter(3)
    const chunks = db.searchCurrentDocumentChunksBefore(3, ['紫铜罗盘'])
    assert.equal(chunks.length, 1)
    assert.equal(chunks[0].content, '最新稿里出现紫铜罗盘。')
    assert.notEqual(chunks[0].bodyVersionId, first.currentVersionId)
    assert.equal(db.formalBodyVersion(1, chunks[0].bodyVersionId).contentHash, chunks[0].contentHash)
  } finally { db.close() }
})

test('new-book creation initializes file text authority before registration; opening existing books never invokes it', async t => {
  const { root, factory } = await fixture(t)
  const settings = new SettingsStore(join(root, 'new-book-settings'), {
    available: () => true, encrypt: value => Buffer.from(value).toString('base64'), decrypt: value => Buffer.from(value, 'base64').toString()
  })
  const storage = new NewFileProjectStorage(factory)
  let initialized = 0
  const projects = new ProjectService(settings, undefined, undefined, async root => { await storage.initialize(root); initialized++ })
  const created = await projects.create({ parentPath: root, title: '全新文件作品', genre: '悬疑' })
  const db = await factory.openExisting(created.project.path)
  assert.ok(db)
  try {
    assert.equal(db.textAuthority(), 'files-v1')
    assert.equal(db.projectWritingConfig().genreText, '悬疑')
    assert.equal(db.formalChapters().length, 0)
    const chapter = db.createFormalChapter(1).chapter
    db.writeFormalChapter({ legacyChapterId: 1, title: chapter.title, content: '新书第一段，不进入数据库。', reason: 'manual', expectedRevision: chapter.revision })
    assert.equal(await readFile(join(created.project.path, chapter.mirrorRelativePath), 'utf8'), '新书第一段，不进入数据库。')
  } finally { db.close() }
  await projects.importProject(created.project.path)
  assert.equal(initialized, 1)
  const raw = new DatabaseSync(join(created.project.path, '.webnovel/workspace.sqlite'), { readOnly: true })
  try { assert.equal(raw.prepare("SELECT count(*) AS n FROM body_versions WHERE content <> ''").get()?.n, 0) } finally { raw.close() }
})

test('known intermediate schema 41 stays byte-identical on shelf reads and upgrades without rewriting its historical receipt', async t => {
  const { project, factory } = await fixture(t)
  const raw = new DatabaseSync(join(project.path, '.webnovel/workspace.sqlite'))
  removeEmptyReviewSchema(raw)
  raw.exec(`DROP TABLE event_operation_receipts;
    DROP TABLE event_display_order_versions;
    DROP TABLE event_lifecycle_versions;
    DROP TRIGGER projects_schema_version_v${WORKSPACE_DATABASE_SCHEMA_VERSION}_after_insert;
    CREATE TRIGGER projects_schema_version_v41_after_insert AFTER INSERT ON projects
    BEGIN UPDATE projects SET current_schema_version = 41 WHERE id = NEW.id; END;
    UPDATE projects SET current_schema_version = 41;
    DELETE FROM schema_migrations WHERE version > 41;
    PRAGMA user_version = 41;`)
  raw.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 41').run(intermediateManuscriptSchema41Checksum)
  raw.close()
  const before = await fileHashes(project.path)
  assert.equal((await factory.readProjectIdentity(project.path))?.title, project.name)
  assert.equal((await readLibraryLastEditedChapter(project.path))?.id, 1)
  const preview = await previewLegacyTextMigration(project.path)
  assert.equal(preview.schemaVersion, 41)
  assert.deepEqual(await fileHashes(project.path), before)
  const upgraded = await factory.openExisting(project.path)
  assert.ok(upgraded)
  try { assert.equal(upgraded.formalChapter(1)?.content, '数据库中新稿：雨夜来信，信封没有署名。') } finally { upgraded.close() }
  const check = new DatabaseSync(join(project.path, '.webnovel/workspace.sqlite'), { readOnly: true })
  try { assert.equal(check.prepare('SELECT checksum FROM schema_migrations WHERE version=41').get()?.checksum, intermediateManuscriptSchema41Checksum) }
  finally { check.close() }
})

test('intermediate schema checksum cannot bless a missing guard or unknown schema variant', async t => {
  const { project, factory } = await fixture(t)
  const raw = new DatabaseSync(join(project.path, '.webnovel/workspace.sqlite'))
  raw.prepare('UPDATE schema_migrations SET checksum = ? WHERE version=41').run(intermediateManuscriptSchema41Checksum)
  raw.exec('DROP TRIGGER manuscript_document_chunks_insert_guard')
  raw.close()
  const before = await fileHashes(project.path)
  await assert.rejects(factory.readProjectIdentity(project.path), { code: 'DATABASE_INTEGRITY_FAILED' })
  await assert.rejects(previewLegacyTextMigration(project.path), { code: 'DATABASE_INTEGRITY_FAILED' })
  assert.deepEqual(await fileHashes(project.path), before)
})
import { removeEmptyReviewSchema } from '../../fixtures/remove-empty-review-schema'
