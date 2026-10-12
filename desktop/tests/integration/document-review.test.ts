import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SqliteWorkspaceDatabaseFactory, workspaceDatabaseMigrations } from '../../src/main/platform/storage/workspace-database'
import { ProjectService } from '../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../src/main/platform/settings/settings-store'
import { DocumentService } from '../../src/main/modules/manuscript/application/document-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../src/main/modules/library/application/legacy-workspace-source'
import { previewLegacyTextMigration, exportLegacyTextMigration } from '../../src/main/modules/manuscript/adapters/manuscript-text-export'
import { ManuscriptFileStore } from '../../src/main/modules/manuscript/adapters/manuscript-file-store'
import { installMigratedTextReferences } from '../../src/main/modules/manuscript/adapters/manuscript-text-migration'
import { ManuscriptCommitJournal } from '../../src/main/modules/manuscript/adapters/manuscript-commit-journal'
import { rebuildSqliteTable } from '../../src/main/platform/storage/sqlite-table-rebuild'
import { canonicalEventIdentityCopySql, canonicalEventIdentityGuardsSql } from '../../src/main/modules/timeline/adapters/canonical-event-identity-schema'
import type { WorkspaceDatabasePort } from '../../src/main/core/ports/workspace-database'
import type { DocumentSnapshot } from '../../src/contracts/document-review/types'
import { WorkspaceBackupService } from '../../src/main/modules/library/application/workspace-backup-service'
import { ManuscriptExportService } from '../../src/main/modules/manuscript/application/manuscript-export-service'
import { SqliteManuscriptService } from '../../src/main/modules/manuscript/application/sqlite-manuscript-service'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const original = '开端。' + '走过长街。'.repeat(25) + '结尾。'
async function fixture(t: TestContext, fileMode = false) {
  const parent = await realpath(tmpdir()), root = await mkdtemp(join(parent, 'lanjian-inline-review-'))
  let db: WorkspaceDatabasePort
  t.after(async () => { db?.close(); assert.equal(dirname(await realpath(root)), parent); await rm(root, { recursive: true, force: true }) })
  const projects = new ProjectService(new SettingsStore(join(root, 'settings'), { available: () => false, encrypt: () => assert.fail(), decrypt: () => assert.fail() }))
  const { project } = await projects.create({ parentPath: root, name: '隔离修订验证', genre: '悬疑' })
  const documents = new DocumentService(projects)
  await documents.updateChapter(1, { title: '雨夜', content: original })
  await documents.updateChapter(2, { title: '另章', content: '绝不能更改的另一章。' })
  await documents.updateOutline('total', '全书总纲。')
  const source = await new CurrentProjectLegacyWorkspaceSource(projects, documents).snapshot()
  const factory = new SqliteWorkspaceDatabaseFactory()
  db = await factory.open(project.path)
  db.importSnapshot(source); db.activateSqlite(source); db.close()
  if (fileMode) {
    const output = join(root, 'export'); await mkdir(output)
    const preview = await previewLegacyTextMigration(project.path)
    await exportLegacyTextMigration(project.path, output, preview.fingerprint)
    const files = await ManuscriptFileStore.open(project.path), exported = await ManuscriptFileStore.open(output)
    for (const head of preview.current) await files.save({ operationId: randomUUID(), documentId: head.documentId, kind: head.kind,
      relativePath: head.relativePath, title: '迁移稿件', expectedHash: head.observedHash, content: (await exported.readSnapshot(head.hash)).content }, async () => {})
    const raw = new DatabaseSync(join(project.path, '.webnovel/workspace.sqlite'))
    try { raw.exec('PRAGMA foreign_keys = ON'); await installMigratedTextReferences(raw, project.path, output, preview) } finally { raw.close() }
  }
  db = (await factory.openExisting(project.path))!
  const workItemId = db.promptProfile().workItemId
  const snapshot = db.documentReviewSnapshot({ workItemId, kind: 'body', legacyId: 1 })
  return { root, project, db, snapshot, factory, projects }
}

function generated(db: WorkspaceDatabasePort, snapshot: DocumentSnapshot, candidate: string) {
  const taskId = randomUUID(), artifactId = randomUUID()
  const checkpoint = (phase: string) => JSON.stringify({ version: 1, phase, workItemId: snapshot.ref.workItemId,
    request: { chapterId: snapshot.legacyId, message: '润色正文', currentDraft: snapshot.content } })
  db.createTaskRun({ id: taskId, legacyChapterId: snapshot.legacyId, taskType: 'writing_agent', idempotencyKey: randomUUID(), contentHash: snapshot.hash, checkpointJson: checkpoint('queued') })
  db.transitionTaskRun({ id: taskId, status: 'running', checkpointJson: checkpoint('model') })
  const content = JSON.stringify({ candidate })
  db.completeTaskRunWithArtifact(taskId, checkpoint('approval'), { id: artifactId, taskRunId: taskId, artifactType: 'writing_agent_turn', status: 'complete',
    content, contentHash: digest(content), schemaValid: true, metadataJson: '{"model":"isolated-test-provider"}' })
  return db.openDocumentReview({ snapshot, baseDraft: snapshot.content, candidate,
    source: { taskId, artifactId, artifactType: 'writing_agent_turn', artifactHash: digest(content) } })
}

test('read-only review distinguishes first outline save, archived document and missing identity without creating records', async t => {
  const { project, factory, snapshot } = await fixture(t)
  let reader = (await factory.openDocumentReviewReadOnly(project.path))!
  const raw = new DatabaseSync(join(project.path, '.webnovel/workspace.sqlite'))
  try {
    const before = raw.prepare('SELECT count(*) AS n FROM outline_nodes').get()!.n
    const workItemId = snapshot.ref.workItemId
    const reason = (expected: string) => (error: unknown) => {
      const value = error as { code?: string; details?: { reason?: string } }
      assert.equal(value.code, 'NOT_FOUND'); assert.equal(value.details?.reason, expected); return true
    }
    assert.throws(() => reader.documentReviewSnapshot({ workItemId, kind: 'volume', legacyId: 999 }), reason('not-created'))
    assert.throws(() => reader.documentReviewSnapshot({ workItemId, kind: 'total', documentId: randomUUID() }), reason('missing'))
    const total = reader.documentReviewSnapshot({ workItemId, kind: 'total' })
    reader.close()
    raw.prepare("UPDATE outline_nodes SET status='archived' WHERE id=?").run(total.ref.documentId)
    reader = (await factory.openDocumentReviewReadOnly(project.path))!
    assert.throws(() => reader.documentReviewSnapshot(total.ref), reason('removed'))
    assert.throws(() => reader.documentReviewSnapshot({ workItemId, kind: 'total' }), reason('removed'))
    assert.equal(raw.prepare('SELECT count(*) AS n FROM outline_nodes').get()!.n, before)
  } finally { reader.close(); raw.close() }
})

for (const fileMode of [false, true]) test(`outline history is scoped, immutable and reads authoritative text (${fileMode ? 'files' : 'sqlite'})`, async t => {
  const { db, snapshot, factory, project } = await fixture(t, fileMode)
  const total = db.documentReviewSnapshot({ workItemId: snapshot.ref.workItemId, kind: 'total' })
  const before = db.outlineHistory(total.ref)
  assert.ok(before.length)
  assert.equal(db.outlineVersion({ document: total.ref, versionId: total.versionId }).content, total.content)
  db.writeFormalOutline({ legacyKey: 'total', nodeType: 'summary', seq: 1, title: total.title, content: '修改后的总纲。', sourceType: 'manual', expectedRevision: total.revision })
  const reader = (await factory.openDocumentReviewReadOnly(project.path))!
  try {
    const versions = reader.outlineHistory(total.ref)
    assert.equal(versions.length, before.length + 1)
    assert.ok(versions[0]!.versionNo > versions[1]!.versionNo)
    assert.equal(reader.outlineVersion({ document: total.ref, versionId: total.versionId }).content, total.content)
    assert.equal(reader.documentReviewSnapshot(total.ref).content, '修改后的总纲。')
    assert.throws(() => reader.outlineVersion({ document: total.ref, versionId: snapshot.versionId }))
    assert.throws(() => reader.outlineHistory({ ...total.ref, workItemId: 'another-book' }))
    assert.throws(() => reader.outlineHistory({ ...total.ref, kind: 'volume' }))
    assert.throws(() => reader.outlineHistory(snapshot.ref))
    assert.deepEqual(reader.outlineHistory(total.ref), versions)
  } finally { reader.close() }
})

test('three changes can be decided out of order and one save records two independent real sources', async t => {
  const { db, snapshot: initial } = await fixture(t)
  const content = '开端。' + '甲段铺垫。'.repeat(25) + '中段。' + '乙段铺垫。'.repeat(25) + '结尾。'
  db.writeFormalChapter({ legacyChapterId: 1, title: initial.title, content, expectedRevision: initial.revision, reason: 'manual' })
  const snapshot = db.documentReviewSnapshot(initial.ref)
  const first = generated(db, snapshot, content.replace('开端', '新开端').replace('中段', '新中段').replace('结尾', '新结尾'))
  const second = generated(db, snapshot, content.replace('开端', '另一个开端'))
  assert.equal(first.blocks.length, 3)
  const keep = (blockId: string) => {
    const permit = db.prepareReviewDecision({ document: snapshot.ref, blockId, operationId: randomUUID(), expectedDraftRevision: db.reviewDraft(snapshot.ref)!.revision })
    db.acknowledgeReviewStage({ document: snapshot.ref, permitId: permit.id, resultingDraftHash: permit.resultingDraftHash })
  }
  keep(first.blocks[1]!.id)
  db.discardReviewDecision({ document: snapshot.ref, blockId: first.blocks[0]!.id, operationId: randomUUID() })
  keep(first.blocks[2]!.id)
  assert.equal(db.reviewDraft(snapshot.ref)!.content, content.replace('中段', '新中段').replace('结尾', '新结尾'))
  keep(second.blocks[0]!.id)
  const draft = db.reviewDraft(snapshot.ref)!
  const result = db.saveReviewedDraft({ document: snapshot.ref, operationId: randomUUID(), expectedDraftRevision: draft.revision, expectedRevision: draft.baseRevision })
  assert.equal(result.snapshot.content, content.replace('开端', '另一个开端').replace('中段', '新中段').replace('结尾', '新结尾'))
  assert.equal(result.receipt!.sourceLinks.length, 2)
  assert.deepEqual(new Set(result.receipt!.sourceLinks.map(source => source.taskId)), new Set([first.source.taskId, second.source.taskId]))
  assert.deepEqual(new Set(result.receipt!.sourceLinks.flatMap(source => source.blockIds)), new Set([first.blocks[1]!.id, first.blocks[2]!.id, second.blocks[0]!.id]))
})

for (const mode of [false, true]) test(`separate retains from one real artifact keep versioned provenance (${mode ? 'files-v1' : 'legacy-sqlite'})`, async t => {
  const { db, snapshot, project, factory } = await fixture(t, mode)
  const review = generated(db, snapshot, original.replace('开端', '新开端').replace('结尾', '新结尾'))
  assert.equal(review.blocks.length, 2)
  const unchanged = db.formalChapter(2)!
  for (const block of review.blocks) {
    const draft = db.reviewDraft(snapshot.ref)!
    const permit = db.prepareReviewDecision({ document: snapshot.ref, blockId: block.id, operationId: randomUUID(), expectedDraftRevision: draft.revision })
    assert.equal(db.formalChapter(1)!.content, db.documentReviewSnapshot(snapshot.ref).content)
    const staged = db.acknowledgeReviewStage({ document: snapshot.ref, permitId: permit.id, resultingDraftHash: permit.resultingDraftHash })
    assert.notEqual(db.formalChapter(1)!.content, staged.content)
    assert.equal(db.acknowledgeReviewStage({ document: snapshot.ref, permitId: permit.id, resultingDraftHash: permit.resultingDraftHash }).revision, staged.revision)
    const input = { document: snapshot.ref, operationId: randomUUID(), expectedDraftRevision: staged.revision, expectedRevision: staged.baseRevision }
    const saved = db.saveReviewedDraft(input)
    assert.equal(saved.snapshot.content, staged.content)
    assert.deepEqual(saved.receipt!.sourceLinks[0]!.blockIds, [block.id])
    assert.equal(db.saveReviewedDraft(input).receipt!.id, saved.receipt!.id)
    assert.throws(() => db.saveReviewedDraft({ ...input, expectedDraftRevision: input.expectedDraftRevision + 1 }), { code: 'CONFLICT' })
  }
  assert.equal(db.formalChapter(1)!.content, original.replace('开端', '新开端').replace('结尾', '新结尾'))
  assert.equal(db.generationArtifactForTask(review.source.taskId, review.source.artifactType)!.status, 'applied')
  assert.deepEqual(db.formalChapter(2), unchanged)
  const history = db.formalRevisions(1).filter(version => version.reason === 'ai')
  assert.equal(history.length, 2)
  assert.ok(history.every(version => version.reviewedSource?.application.sourceLinks[0]?.taskId === review.source.taskId))
  assert.throws(() => db.applyWritingAgentArtifact({ taskRunId: review.source.taskId, artifactId: review.source.artifactId, artifactType: 'writing_agent_turn', legacyChapterId: 1,
    title: snapshot.title, content: '不允许整份二次消费', expectedRevision: db.formalChapter(1)!.revision, metadataJson: '{}' }), { code: 'CONFLICT' })
  const raw = new DatabaseSync(join(project.path, '.webnovel/workspace.sqlite'), { readOnly: true })
  try {
    const versions = raw.prepare("SELECT * FROM body_versions WHERE source_type = 'ai'").all()
    assert.equal(versions.length, 2)
    assert.ok(versions.every(version => version.review_application_id && !version.source_task_run_id && !version.generation_artifact_id))
    for (const index of ['body_versions_unique_ai_task_application', 'body_versions_unique_ai_artifact_application']) assert.ok(raw.prepare('SELECT name FROM sqlite_schema WHERE name = ?').get(index))
  } finally { raw.close() }
  const read = await factory.openDocumentReviewReadOnly(project.path)
  try { assert.equal(read!.documentReviews(snapshot.ref)[0]!.blocks.every(block => block.status === 'committed'), true) } finally { read!.close() }
})

test('author edits map remaining anchors; explicit undo withdraws staging, and stale scopes preserve text', async t => {
  const { db, snapshot } = await fixture(t)
  const review = generated(db, snapshot, original.replace('开端', '新开端').replace('结尾', '新结尾'))
  let draft = db.reviewDraft(snapshot.ref)!
  draft = db.syncReviewDraft({ document: snapshot.ref, expectedDraftRevision: draft.revision, title: draft.title, changes: [{ from: 0, to: 0, insert: '前言。' }] })
  const permit = db.prepareReviewDecision({ document: snapshot.ref, blockId: review.blocks[0]!.id, operationId: randomUUID(), expectedDraftRevision: draft.revision })
  assert.equal(permit.start, 3)
  const staged = db.acknowledgeReviewStage({ document: snapshot.ref, permitId: permit.id, resultingDraftHash: permit.resultingDraftHash })
  const withdrawn = db.syncReviewDraft({ document: snapshot.ref, expectedDraftRevision: staged.revision, title: staged.title,
    changes: [{ from: 3, to: 7, insert: '开端。' }], withdrawDecisionIds: staged.stagedDecisionIds })
  assert.deepEqual(withdrawn.stagedDecisionIds, [])
  assert.equal(db.documentReviews(snapshot.ref)[0]!.blocks[0]!.status, 'pending')
  assert.equal(db.formalChapter(1)!.content, original)
  assert.throws(() => db.documentReviews({ ...snapshot.ref, workItemId: 'wrong-book' }), { code: 'CONFLICT' })
  db.writeFormalChapter({ legacyChapterId: 1, title: snapshot.title, content: '另一处保存的作者原文。', reason: 'manual', expectedRevision: snapshot.revision })
  assert.throws(() => db.saveReviewedDraft({ document: snapshot.ref, operationId: randomUUID(), expectedDraftRevision: withdrawn.revision, expectedRevision: snapshot.revision }), { code: 'CONFLICT' })
  assert.equal(db.reviewDraft(snapshot.ref)!.content, withdrawn.content)
})

test('explicit undo and redo synchronize unsaved provenance; ordinary writes cannot bypass staging', async t => {
  const { db, snapshot } = await fixture(t)
  const candidate = original.replace('开端', '新开端')
  const review = generated(db, snapshot, candidate)
  const permit = db.prepareReviewDecision({ document: snapshot.ref, blockId: review.blocks[0]!.id, operationId: randomUUID(), expectedDraftRevision: db.reviewDraft(snapshot.ref)!.revision })
  const staged = db.acknowledgeReviewStage({ document: snapshot.ref, permitId: permit.id, resultingDraftHash: permit.resultingDraftHash })
  assert.throws(() => db.writeFormalChapter({ legacyChapterId: 1, title: snapshot.title, content: candidate, reason: 'manual', expectedRevision: snapshot.revision }), { code: 'CONFLICT' })
  const undo = db.syncReviewDraft({ document: snapshot.ref, expectedDraftRevision: staged.revision, title: staged.title,
    changes: [{ from: 0, to: candidate.length, insert: original }], historyDirection: 'undo' })
  assert.equal(undo.stagedDecisionIds.length, 0)
  assert.equal(db.documentReviews(snapshot.ref)[0]!.blocks[0]!.status, 'pending')
  assert.equal(undo.positions[review.blocks[0]!.id]!.status, 'located')
  const redo = db.syncReviewDraft({ document: snapshot.ref, expectedDraftRevision: undo.revision, title: undo.title,
    changes: [{ from: 0, to: original.length, insert: candidate }], historyDirection: 'redo' })
  assert.equal(redo.stagedDecisionIds.length, 1)
  const saved = db.saveReviewedDraft({ document: snapshot.ref, operationId: randomUUID(), expectedDraftRevision: redo.revision, expectedRevision: redo.baseRevision })
  assert.equal(saved.receipt!.sourceLinks[0]!.artifactId, review.source.artifactId)
})

test('file replacement interruption replays the exact review application and decisions', async t => {
  const { db, snapshot, project, factory } = await fixture(t, true)
  const review = generated(db, snapshot, original.replace('开端', '新开端'))
  const permit = db.prepareReviewDecision({ document: snapshot.ref, blockId: review.blocks[0]!.id, operationId: randomUUID(), expectedDraftRevision: db.reviewDraft(snapshot.ref)!.revision })
  const staged = db.acknowledgeReviewStage({ document: snapshot.ref, permitId: permit.id, resultingDraftHash: permit.resultingDraftHash })
  const input = { document: snapshot.ref, operationId: randomUUID(), expectedDraftRevision: staged.revision, expectedRevision: snapshot.revision }
  const apply = ManuscriptCommitJournal.prototype.apply
  ManuscriptCommitJournal.prototype.apply = function(receipt) { apply.call(this, receipt); throw new Error('isolated crash after file replacement') }
  try { assert.throws(() => db.saveReviewedDraft(input), { code: 'STORAGE_ERROR' }) } finally { ManuscriptCommitJournal.prototype.apply = apply }
  assert.ok(new ManuscriptCommitJournal(project.path).pending().length)
  db.close()
  const reopened = await factory.openExisting(project.path)
  try {
    reopened!.recoverManuscriptCommits()
    assert.equal(reopened!.formalChapter(1)!.content, staged.content)
    assert.equal(reopened!.saveReviewedDraft(input).receipt!.id, input.operationId)
    assert.equal(reopened!.documentReviews(snapshot.ref)[0]!.blocks[0]!.status, 'committed')
    assert.equal(new ManuscriptCommitJournal(project.path).pending().length, 0)
  } finally { reopened!.close() }
})

test('annotations persist unsaved text separately, map edits, retain history and reject stale/replayed mutations', async t => {
  const { db, snapshot, factory, project } = await fixture(t, true)
  const draftText = '序言😀。' + original
  const input = { document: snapshot.ref, operationId: randomUUID(), expectedRevision: snapshot.revision, expectedDraftRevision: null,
    title: snapshot.title, draftText, start: 5, end: 8, body: '开端需要交代动机。' }
  const first = db.createDocumentAnnotation(input)
  assert.equal(db.createDocumentAnnotation(input).id, first.id)
  assert.throws(() => db.createDocumentAnnotation({ ...input, body: 'changed' }), { code: 'CONFLICT' })
  assert.equal(db.formalChapter(1)!.content, original)
  let draft = db.reviewDraft(snapshot.ref)!
  assert.equal(draft.content, draftText)
  const key = `annotation:${first.id}`
  draft = db.syncReviewDraft({ document: snapshot.ref, expectedDraftRevision: draft.revision, title: draft.title, changes: [{ from: 0, to: 0, insert: '前。' }] })
  assert.equal(draft.positions[key]!.start, 7)
  draft = db.syncReviewDraft({ document: snapshot.ref, expectedDraftRevision: draft.revision, title: draft.title, changes: [{ from: 7, to: 10, insert: '' }] })
  assert.equal(draft.positions[key]!.status, 'needs-relocation')
  assert.equal(db.documentAnnotation(snapshot.ref, first.id).anchor.quote, draftText.slice(5, 8))
  const change = { document: snapshot.ref, id: first.id, operationId: randomUUID(), expectedAnnotationRevision: first.revision }
  const resolved = db.changeDocumentAnnotation('resolve', change)
  assert.equal(db.changeDocumentAnnotation('resolve', change).revision, resolved.revision)
  assert.throws(() => db.changeDocumentAnnotation('update', { ...change, operationId: randomUUID(), body: 'stale' }), { code: 'CONFLICT' })
  const deleted = db.changeDocumentAnnotation('remove', { ...change, operationId: randomUUID(), expectedAnnotationRevision: resolved.revision })
  assert.equal(db.documentAnnotations({ document: snapshot.ref }).items.length, 0)
  assert.equal(db.documentAnnotations({ document: snapshot.ref, includeDeleted: true }).items[0]!.status, 'deleted')
  assert.equal(db.documentAnnotation(snapshot.ref, first.id, 1).body, input.body)
  const restored = db.changeDocumentAnnotation('reopen', { ...change, operationId: randomUUID(), expectedAnnotationRevision: deleted.revision })
  const reanchored = db.changeDocumentAnnotation('reanchor', { ...input, ...change, operationId: randomUUID(), expectedAnnotationRevision: restored.revision,
    expectedDraftRevision: draft.revision, draftText: draft.content, start: 0, end: 2 })
  assert.equal(reanchored.anchor.quote, '前。')
  assert.throws(() => db.documentAnnotation({ ...snapshot.ref, workItemId: 'other' }, first.id), { code: 'CONFLICT' })
  const reader = await factory.openDocumentReviewReadOnly(project.path)
  try { assert.equal(reader!.documentAnnotations({ document: snapshot.ref }).items[0]!.revision, reanchored.revision) } finally { reader!.close() }
  assert.equal(db.formalChapter(1)!.content, original)
})

test('all outline kinds share stable annotation identity and do not force a formal save', async t => {
  const { db, snapshot } = await fixture(t)
  db.writeFormalOutline({ legacyKey: 'volume-1', parentLegacyKey: 'total', nodeType: 'volume', seq: 1, title: '一卷', content: '卷纲。', sourceType: 'manual' })
  db.writeFormalOutline({ legacyKey: 'stage-1', parentLegacyKey: 'volume-1', nodeType: 'stage', seq: 1, title: '阶段', content: '阶段纲。', sourceType: 'manual' })
  db.writeFormalOutline({ legacyKey: 'chapter-900', parentLegacyKey: 'stage-1', nodeType: 'chapter', seq: 900, title: '独立章', content: '章纲。', sourceType: 'manual' })
  for (const kind of ['total', 'volume', 'stage', 'chapter-outline'] as const) {
    const doc = db.documentReviewSnapshot({ workItemId: snapshot.ref.workItemId, kind, ...(kind === 'total' ? {} : { legacyId: kind === 'chapter-outline' ? 900 : 1 }) })
    const item = db.createDocumentAnnotation({ document: doc.ref, operationId: randomUUID(), expectedRevision: doc.revision, expectedDraftRevision: null,
      title: doc.title, draftText: doc.content + '待保存稿。', start: 0, end: 2, body: `${kind} 修改意见` })
    assert.equal(db.documentReviewSnapshot(doc.ref).content, doc.content)
    const draft = db.reviewDraft(doc.ref)!
    const saved = db.saveReviewedDraft({ document: doc.ref, operationId: randomUUID(), expectedDraftRevision: draft.revision, expectedRevision: doc.revision })
    assert.equal(saved.receipt, null)
    assert.equal(db.documentAnnotation(doc.ref, item.id).document.documentId, doc.ref.documentId)
    assert.ok(saved.snapshot.content.endsWith('待保存稿。'))
  }
  const outline = db.documentReviewSnapshot({ workItemId: snapshot.ref.workItemId, kind: 'chapter-outline', legacyId: 900 })
  const annotations = db.documentAnnotations({ document: outline.ref })
  db.writeFormalChapter({ legacyChapterId: 900, title: '独立章开始正文', content: '新建正文。', reason: 'manual' })
  assert.equal(db.documentReviewSnapshot({ workItemId: snapshot.ref.workItemId, kind: 'chapter-outline', legacyId: 900 }).ref.documentId, outline.ref.documentId)
  assert.deepEqual(db.documentAnnotations({ document: outline.ref }), annotations)
})

test('schema 45 appends a migration; readonly review inspection never upgrades schema 44', async t => {
  const { db, project, factory } = await fixture(t)
  db.close()
  const other = join(project.path, 'legacy44'); await mkdir(other); await mkdir(join(other, '.webnovel'))
  const path = join(other, '.webnovel/workspace.sqlite'), raw = new DatabaseSync(path)
  try {
    raw.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE')
    for (const migration of workspaceDatabaseMigrations.filter(item => item.version <= 44)) {
      if (migration.version === 36 || migration.version === 37) {
        const split = migration.sql.indexOf(migration.version === 36 ? 'CREATE TRIGGER task_runs_writing_active_insert_guard' : 'DROP TRIGGER projects_schema_version_v36_after_insert')
        rebuildSqliteTable(raw, { table: migration.version === 36 ? 'task_runs' : 'workspace_config_documents', copySql: migration.sql.slice(0, split), guardsSql: migration.sql.slice(split), integrityMessage: 'isolated fixture migration' })
      } else if (migration.version === 39) rebuildSqliteTable(raw, { table: 'canonical_events', copySql: canonicalEventIdentityCopySql, guardsSql: canonicalEventIdentityGuardsSql, integrityMessage: 'isolated fixture migration' })
      else raw.exec(migration.sql)
      raw.prepare('INSERT INTO schema_migrations(version,name,applied_at,checksum) VALUES(?,?,?,?)').run(migration.version, migration.name, new Date().toISOString(), migration.checksum)
      raw.exec(`PRAGMA user_version = ${migration.version}`)
    }
    raw.exec('COMMIT; PRAGMA foreign_keys=ON')
  } finally { raw.close() }
  const before = await readFile(path)
  await assert.rejects(factory.openDocumentReviewReadOnly(other), { code: 'FEATURE_UNAVAILABLE' })
  assert.deepEqual(await readFile(path), before)
})

test('explicit conflict recovery archives both acknowledged draft and latest local input without writing formal text', async t => {
  const { db, snapshot, project, factory } = await fixture(t)
  generated(db, snapshot, original.replace('开端', '新开端'))
  const draft = db.reviewDraft(snapshot.ref)!
  const external = db.writeFormalChapter({ legacyChapterId: 1, title: snapshot.title, content: '外部已保存稿。', reason: 'manual', expectedRevision: snapshot.revision }).chapter
  const input = { document: snapshot.ref, operationId: randomUUID(), expectedDraftRevision: draft.revision, expectedRevision: external.revision,
    localTitle: snapshot.title, localContent: original + '尚未同步的作者新输入。' }
  const recovered = db.useLatestReviewDraft(input)
  assert.equal(recovered.content, external.content)
  assert.equal(db.useLatestReviewDraft(input).revision, recovered.revision)
  assert.equal(db.reviewRecoveryHistory(snapshot.ref).length, 2)
  assert.equal(db.reviewRecoveryHistory(snapshot.ref)[0]!.content, input.localContent)
  assert.equal(db.formalChapter(1)!.content, external.content)
  const reader = await factory.openDocumentReviewReadOnly(project.path)
  try { assert.equal(reader!.reviewRecoveryHistory(snapshot.ref).length, 2) } finally { reader!.close() }
})

test('full backup restores annotations, pending reviews and recovery drafts; reading export includes only formal text', async t => {
  const f = await fixture(t), { db, snapshot } = f
  const review = generated(db, snapshot, original.replace('开端', '候选红字'))
  const item = db.createDocumentAnnotation({ document: snapshot.ref, operationId: randomUUID(), expectedRevision: snapshot.revision,
    expectedDraftRevision: db.reviewDraft(snapshot.ref)!.revision, title: snapshot.title, draftText: snapshot.content, start: 0, end: 2, body: '批注秘密标记' })
  const changed = db.writeFormalChapter({ legacyChapterId: 1, title: snapshot.title, content: original + '正式结语。', reason: 'manual', expectedRevision: snapshot.revision }).chapter
  db.useLatestReviewDraft({ document: snapshot.ref, operationId: randomUUID(), expectedRevision: changed.revision,
    expectedDraftRevision: db.reviewDraft(snapshot.ref)!.revision, localTitle: snapshot.title, localContent: original + '留存草稿标记' })
  const backupParent = join(f.root, 'backups'), restoredParent = join(f.root, 'restored')
  await mkdir(backupParent); await mkdir(restoredParent)
  const service = new WorkspaceBackupService(f.factory, async () => f.project.path, async () => f.project.title, () => 'review-test')
  const backup = await service.create(backupParent), preview = await service.previewRestore(backup.backupPath)
  const result = await service.restore(preview.token!, restoredParent)
  const restored = (await f.factory.openDocumentReviewReadOnly(result.projectPath))!
  try {
    assert.equal(restored.documentAnnotation(snapshot.ref, item.id).body, item.body)
    assert.equal(restored.documentReviews(snapshot.ref)[0]!.id, review.id)
    assert.equal(restored.reviewRecoveryHistory(snapshot.ref).length, 2)
    assert.equal(restored.documentReviewSnapshot(snapshot.ref).content, changed.content)
  } finally { restored.close() }
  const output = join(f.root, 'reading-copy.md')
  const documents = new DocumentService(f.projects, undefined, new SqliteManuscriptService(f.factory))
  await new ManuscriptExportService(f.projects, documents).export(output)
  const text = await readFile(output, 'utf8')
  assert.ok(text.includes('正式结语。'))
  for (const marker of ['批注秘密标记', '候选红字', '留存草稿标记']) assert.ok(!text.includes(marker))
})
