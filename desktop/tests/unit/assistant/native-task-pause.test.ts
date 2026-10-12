import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { type TestContext } from 'node:test'
import { createTaskContractSnapshot } from '../../../src/main/modules/assistant/domain/task-template-contract'
import { taskRunCanTransition, taskRunHasLegacyPause, taskRunIsTerminal } from '../../../src/main/modules/assistant/domain/task-run-lifecycle'
import type { LegacyWorkspaceSnapshot, WorkspaceDatabasePort, WorkspaceTaskRunCreateInput } from '../../../src/main/core/ports/workspace-database'
import { WORKSPACE_DATABASE_SCHEMA_VERSION } from '../../../src/main/core/ports/workspace-database'
import { SqliteWorkspaceDatabaseFactory, workspaceDatabaseMigrations } from '../../../src/main/platform/storage/workspace-database'

const timestamp = '2026-09-08T12:00:00.000Z'
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const checkpoint = (projectId: string, phase = 'paused', chapterId = 1) => JSON.stringify({ version: 1, phase, workItemId: projectId, request: { chapterId, message: '继续写', currentDraft: '原稿。' } })
async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-native-pause-'))
  let database: WorkspaceDatabasePort | undefined
  context.after(async () => { database?.close(); await rm(root, { recursive: true, force: true }) })
  await mkdir(join(root, '.webnovel'))
  const order = '{"version":1,"chapters":[1,2]}'
  const snapshot: LegacyWorkspaceSnapshot = { workItemId: root, projectName: '暂停测试', projectManifestHash: hash('manifest'), sourceFingerprint: hash('source'), totalWords: 4,
    chapters: [1, 2].map(id => ({ legacyChapterId: id, position: id, title: `第${id}章`, content: '原稿。', contentHash: hash('原稿。'), wordCount: 2, mirrorRelativePath: `正文/第${id}章.md` })),
    chapterOrderMirror: { relativePath: '.webnovel/manuscript/chapter-order.json', content: order, contentHash: hash(order), observedHash: null } }
  const factory = new SqliteWorkspaceDatabaseFactory(() => new Date(timestamp))
  database = await factory.open(root); database.importSnapshot(snapshot); database.activateSqlite(snapshot)
  return { root, file: join(root, '.webnovel', 'workspace.sqlite'), database, reopen: async () => { database!.close(); database = (await factory.openExisting(root))!; return database } }
}
function create(database: WorkspaceDatabasePort, id: string, overrides: Partial<WorkspaceTaskRunCreateInput> = {}) {
  return database.createTaskRun({ id, taskType: 'writing_agent', legacyChapterId: 1, idempotencyKey: `op-${id}`, contentHash: hash('原稿。'), checkpointJson: checkpoint(database.promptProfile().workItemId), ...overrides })
}
function paused(database: WorkspaceDatabasePort, id: string) {
  create(database, id); database.transitionTaskRun({ id, status: 'running' }); database.transitionTaskRun({ id, status: 'streaming' })
  return database.transitionTaskRun({ id, status: 'paused' })
}

test('native pause survives restart without cancellation; resuming child is interrupted and parent stays paused', async context => {
  const fixtureValue = await fixture(context)
  const { database } = fixtureValue
  const parent = paused(database, 'parent')
  assert.equal(parent.status, 'paused'); assert.equal(parent.endedAt, null)
  assert.equal(taskRunIsTerminal('paused'), false); assert.equal(taskRunIsTerminal('resuming'), false)
  assert.equal(taskRunCanTransition('paused', 'succeeded'), false)
  const child = create(database, 'child', { initialStatus: 'resuming', parentTaskRunId: parent.id, attempt: 2 })
  assert.equal(child.status, 'resuming'); assert.equal(child.parentTaskRunId, parent.id)
  assert.equal(database.taskCenterTaskRuns(1)[0]?.id, child.id)
  const reopened = await fixtureValue.reopen()
  assert.equal(reopened.interruptActiveTaskRuns('writing_agent'), 1)
  assert.equal(reopened.taskRun(child.id)?.status, 'interrupted'); assert.equal(reopened.taskRun(parent.id)?.status, 'paused')
  const next = create(reopened, 'grandchild', { initialStatus: 'resuming', parentTaskRunId: child.id, attempt: 3 })
  reopened.transitionTaskRun({ id: next.id, status: 'preparing' }); reopened.transitionTaskRun({ id: next.id, status: 'running' })
  reopened.transitionTaskRun({ id: next.id, status: 'succeeded' })
  assert.equal(reopened.taskRun(parent.id)?.status, 'paused'); assert.equal(reopened.taskRun(child.id)?.status, 'interrupted')
  assert.throws(() => reopened.transitionTaskRun({ id: parent.id, status: 'succeeded' }), { code: 'CONFLICT' })
})

test('resume is idempotent before continuation checks; wrong chapter, unpaused parent and second continuation are rejected', async context => {
  const { database, file } = await fixture(context)
  const parent = paused(database, 'parent')
  assert.throws(() => create(database, 'wrong-chapter', { initialStatus: 'resuming', parentTaskRunId: parent.id, legacyChapterId: 2 }), { code: 'CONFLICT' })
  assert.throws(() => create(database, 'missing-parent', { initialStatus: 'resuming' }), { code: 'VALIDATION_ERROR' })
  create(database, 'running'); database.transitionTaskRun({ id: 'running', status: 'running' })
  assert.throws(() => create(database, 'wrong-state', { initialStatus: 'resuming', parentTaskRunId: 'running' }), { code: 'CONFLICT' })
  database.transitionTaskRun({ id: 'running', status: 'cancelled' })
  const child = create(database, 'child', { initialStatus: 'resuming', parentTaskRunId: parent.id, attempt: 2 })
  database.transitionTaskRun({ id: child.id, status: 'cancelled' })
  for (let index = 0; index < 55; index++) { create(database, `history-${index}`); database.transitionTaskRun({ id: `history-${index}`, status: 'cancelled' }) }
  const duplicate = create(database, 'duplicate-id', { idempotencyKey: 'op-child', initialStatus: 'resuming', parentTaskRunId: parent.id, attempt: 2 })
  assert.equal(duplicate.id, child.id)
  assert.throws(() => create(database, 'second-child', { initialStatus: 'resuming', parentTaskRunId: parent.id }), { code: 'CONFLICT' })
  assert.throws(() => create(database, 'parent-collision', { idempotencyKey: 'op-child', parentTaskRunId: 'running' }), { code: 'CONFLICT' })
  const raw = new DatabaseSync(file)
  try {
    assert.throws(() => raw.prepare("UPDATE task_runs SET status='succeeded' WHERE id=?").run(parent.id), /paused parent/)
    assert.throws(() => raw.prepare("UPDATE task_runs SET status='resuming' WHERE id=?").run('running'), /continuation/)
    // Bypassing the port cannot duplicate a continuation either.
    const columns = raw.prepare('PRAGMA table_info(task_runs)').all().map(row => String(row.name))
    const values = columns.map(column => column === 'id' ? "'sql-child'" : column === 'idempotency_key' ? "'sql-op'" : column === 'status' ? "'resuming'" : column)
    assert.throws(() => raw.exec(`INSERT INTO task_runs(${columns.join(',')}) SELECT ${values.join(',')} FROM task_runs WHERE id='child'`), /uncontinued/)
  } finally { raw.close() }
})

test('legacy pause requires complete same-project same-chapter evidence and migration never relabels it', async context => {
  const { database } = await fixture(context)
  create(database, 'legacy'); const legacy = database.transitionTaskRun({ id: 'legacy', status: 'cancelled' })
  assert.equal(taskRunHasLegacyPause(legacy, database.promptProfile().workItemId), true)
  assert.equal(create(database, 'legacy-child', { initialStatus: 'resuming', parentTaskRunId: legacy.id }).status, 'resuming')
  database.transitionTaskRun({ id: 'legacy-child', status: 'paused' })
  for (const [id, text] of [['bare', '{"phase":"paused"}'], ['wrong-book', checkpoint('another-book')], ['wrong-chapter', checkpoint(database.promptProfile().workItemId, 'paused', 2)]]) {
    create(database, id!, { checkpointJson: text! }); const task = database.transitionTaskRun({ id: id!, status: 'cancelled' })
    assert.equal(taskRunHasLegacyPause(task, database.promptProfile().workItemId), false)
    assert.throws(() => create(database, `${id}-child`, { initialStatus: 'resuming', parentTaskRunId: id }), { code: 'CONFLICT' })
  }
  assert.equal(database.taskRun('legacy')?.status, 'cancelled')
  paused(database, 'native-pause')
  create(database, 'real-cancel', { checkpointJson: checkpoint(database.promptProfile().workItemId, 'cancelled') }); database.transitionTaskRun({ id: 'real-cancel', status: 'cancelled' })
  const body = database.formalChapters()[0]!
  const metrics = database.upsertRealTrialChapter({ legacyChapterId: 1, bodyVersionId: body.currentVersionId, planningMinutes: 0, writingMinutes: 0, aiEditingMinutes: 0, factReviewMinutes: 0,
    diffAcceptedBlocks: 0, diffRejectedBlocks: 0, misappliedChanges: 0, falsePositiveFindings: 0, usefulFindings: 0, modelCost: null, satisfaction: 4, continueNextChapter: true, bypassedFeatures: '', notes: '' }).automatic
  assert.equal(metrics.aiCancelled, 4, 'only three malformed/unscoped legacy records and the real cancellation count; native and valid legacy pauses do not')
})

test('resuming owns the same-chapter active slot while paused releases it; SQL protects concurrent starts', async context => {
  const { database, file } = await fixture(context)
  paused(database, 'first-parent'); paused(database, 'second-parent')
  const child = create(database, 'active-child', { initialStatus: 'resuming', parentTaskRunId: 'first-parent' })
  assert.throws(() => create(database, 'racing-start'), { code: 'CONFLICT' })
  assert.throws(() => create(database, 'racing-resume', { initialStatus: 'resuming', parentTaskRunId: 'second-parent' }), { code: 'CONFLICT' })
  assert.equal(create(database, 'other-chapter', { legacyChapterId: 2 }).status, 'queued')
  const raw = new DatabaseSync(file)
  try {
    const columns = raw.prepare('PRAGMA table_info(task_runs)').all().map(row => String(row.name))
    const values = columns.map(column => column === 'id' ? "'racing-sql'" : column === 'idempotency_key' ? "'racing-sql-op'" : column === 'parent_task_run_id' ? 'NULL' : column === 'status' ? "'queued'" : column)
    assert.throws(() => raw.exec(`INSERT INTO task_runs(${columns.join(',')}) SELECT ${values.join(',')} FROM task_runs WHERE id='active-child'`), /active writing task/)
  } finally { raw.close() }
  database.transitionTaskRun({ id: child.id, status: 'paused' })
  assert.equal(create(database, 'after-pause').status, 'queued')
  assert.equal(create(database, 'idempotent-child', { initialStatus: 'resuming', idempotencyKey: 'op-active-child', parentTaskRunId: 'first-parent' }).id, child.id)
})

test('paused partial artifact can be explicitly adopted with exact provenance but resuming output cannot', async context => {
  const { database, file } = await fixture(context)
  const base = database.formalChapters()[0]!
  const parent = paused(database, 'partial-parent')
  database.createGenerationArtifact({ id: 'partial', taskRunId: parent.id, artifactType: 'writing_agent_stream', status: 'partial', content: '保存的片段', contentHash: hash('保存的片段'), schemaValid: true, metadataJson: '{}' })
  const child = create(database, 'partial-child', { initialStatus: 'resuming', parentTaskRunId: parent.id })
  database.createGenerationArtifact({ id: 'child-artifact', taskRunId: child.id, artifactType: 'writing_agent_stream', status: 'partial', content: '尚在生成', contentHash: hash('尚在生成'), schemaValid: true, metadataJson: '{}' })
  const input = { taskRunId: parent.id, artifactId: 'partial', artifactType: 'writing_agent_stream' as const, legacyChapterId: 1, title: base.title, content: '原稿。\n保存的片段', expectedRevision: base.revision, metadataJson: '{}' }
  assert.throws(() => database.applyWritingAgentArtifact({ ...input, taskRunId: child.id, artifactId: 'child-artifact' }), { code: 'CONFLICT' })
  for (const wrongIdentity of [parent.projectId, 'E:/other-book']) {
    database.transitionTaskRun({ id: parent.id, status: 'paused', checkpointJson: checkpoint(wrongIdentity) })
    assert.throws(() => database.applyWritingAgentArtifact(input), { code: 'CONFLICT' })
    assert.equal(database.generationArtifactForTask(parent.id, 'writing_agent_stream')?.status, 'partial')
  }
  database.transitionTaskRun({ id: parent.id, status: 'paused', checkpointJson: checkpoint(database.promptProfile().workItemId) })
  const result = database.applyWritingAgentArtifact(input)
  assert.equal(result.insertedVersion, true); assert.equal(result.artifact.status, 'applied')
  assert.equal(database.taskRun(parent.id)?.status, 'paused')
  const raw = new DatabaseSync(file, { readOnly: true })
  try { assert.equal(raw.prepare('SELECT generation_artifact_id FROM body_versions WHERE id=?').get(result.chapter.currentVersionId)?.generation_artifact_id, 'partial'); assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(), []) } finally { raw.close() }
})

async function oldFixture(context: TestContext, injectFailure = false) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-native-pause-v35-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, '.webnovel')); await writeFile(join(root, '原稿.md'), '作者原稿不变。')
  const file = join(root, '.webnovel', 'workspace.sqlite')
  const raw = new DatabaseSync(file)
  raw.exec('PRAGMA foreign_keys = ON')
  for (const migration of workspaceDatabaseMigrations.filter(item => item.version <= 35)) {
    raw.exec(migration.sql); raw.prepare('INSERT INTO schema_migrations VALUES (?,?,?,?)').run(migration.version, migration.name, timestamp, migration.checksum); raw.exec(`PRAGMA user_version=${migration.version}`)
  }
  raw.prepare("INSERT INTO projects(id,name,status,legacy_manifest_hash,storage_mode,created_at,updated_at) VALUES ('p','旧作品','active',?,'sqlite',?,?)").run(hash('manifest'), timestamp, timestamp)
  raw.exec("UPDATE projects SET prompt_work_item_id='p'")
  raw.prepare("INSERT INTO chapters(id,project_id,legacy_chapter_id,seq,title,status,created_at,updated_at) VALUES ('c','p',1,1,'旧章节','draft',?,?)").run(timestamp, timestamp)
  raw.prepare("INSERT INTO body_versions(id,chapter_id,version_no,content,content_hash,source_type,created_at) VALUES ('b','c',1,'原稿。',?,'manual',?)").run(hash('原稿。'), timestamp)
  raw.exec("UPDATE chapters SET current_body_version_id='b' WHERE id='c'")
  const contract = createTaskContractSnapshot('writing_agent')
  const insert = raw.prepare(`INSERT INTO task_runs(id,project_id,chapter_id,task_type,status,idempotency_key,parent_task_run_id,base_body_version_id,content_hash,attempt,checkpoint_json,created_at,updated_at,template_id,template_version,template_hash,input_schema_json,output_schema_json,allowed_operations_json,forbidden_operations_json,task_contract_hash)
    VALUES (?,'p','c','writing_agent','cancelled',?,?,'b',?,1,?,?,?, ?,?,?,?,?,?,?,?)`)
  for (const id of ['parent', 'old-child']) insert.run(id, `op-${id}`, id === 'parent' ? null : 'parent', hash('原稿。'), checkpoint('p'), timestamp, timestamp, contract.templateId, contract.templateVersion, contract.templateHash, contract.inputSchemaJson, contract.outputSchemaJson, contract.allowedOperationsJson, contract.forbiddenOperationsJson, contract.contractHash)
  raw.prepare("INSERT INTO generation_artifacts(id,task_run_id,artifact_type,status,content,content_hash,schema_valid,base_body_version_id,metadata_json,created_at,updated_at) VALUES ('a','parent','writing_agent_stream','partial','片段',?,1,'b','{}',?,?)").run(hash('片段'), timestamp, timestamp)
  raw.prepare("INSERT INTO context_packages VALUES ('ctx','p','parent','v1','{}',?,100,1,'{}',?)").run(hash('{}'), timestamp)
  raw.exec("UPDATE task_runs SET context_package_id='ctx' WHERE id='parent'")
  raw.exec(`CREATE TABLE custom_links(id TEXT PRIMARY KEY, task_id TEXT REFERENCES task_runs(id)); INSERT INTO custom_links VALUES ('link','parent');
    CREATE INDEX custom_task_index ON task_runs(task_type,id);
    CREATE VIEW custom_task_view AS SELECT id,status FROM task_runs;
    CREATE VIEW custom_indirect_view AS SELECT * FROM custom_task_view;
    CREATE TRIGGER custom_task_trigger AFTER UPDATE OF error_message ON task_runs BEGIN SELECT id FROM custom_indirect_view; END;`)
  if (injectFailure) raw.exec("CREATE TRIGGER fail_v36 BEFORE UPDATE OF current_schema_version ON projects WHEN NEW.current_schema_version=36 BEGIN SELECT RAISE(ABORT,'injected migration failure'); END;")
  const tables = ['task_runs', 'generation_artifacts', 'context_packages', 'body_versions', 'custom_links', 'schema_migrations']
  const rows = Object.fromEntries(tables.map(name => [name, raw.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]))
  const schema = raw.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()
  raw.close()
  return { root, file, tables, rows, schema }
}

test('v35 rebuild preserves all incoming foreign keys, task/contracts/artifacts and custom dependent schema', async context => {
  const { root, file, tables, rows, schema } = await oldFixture(context)
  const database = await new SqliteWorkspaceDatabaseFactory().openExisting(root)
  assert.ok(database); assert.equal(database.taskRun('parent')?.status, 'cancelled'); assert.equal(taskRunHasLegacyPause(database.taskRun('parent')!, 'p'), true); database.close()
  const raw = new DatabaseSync(file)
  try {
    assert.equal(raw.prepare('PRAGMA user_version').get()?.user_version, WORKSPACE_DATABASE_SCHEMA_VERSION)
    for (const table of tables.filter(name => name !== 'schema_migrations')) {
      const actual = raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
      if (table === 'body_versions') for (const row of actual) { assert.equal(row.review_application_id, null); delete row.review_application_id }
      assert.deepEqual(actual, rows[table])
    }
    assert.deepEqual(raw.prepare('SELECT * FROM schema_migrations WHERE version<=35 ORDER BY version').all(), rows.schema_migrations)
    for (const entry of schema.filter(row => String(row.name).startsWith('custom_'))) assert.deepEqual(raw.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name=?').get(entry.name), entry)
    for (const entry of schema.filter(row => row.type === 'table' && row.name !== 'task_runs')) {
      // v37 extends config kinds; v39 removes event content uniqueness;
      // v41 adds the explicit legacy-compatible text authority column.
      // Incoming foreign keys and every other table definition stay verbatim.
      const expected = entry.name === 'workspace_config_documents'
        ? { ...entry, sql: String(entry.sql).replace('CREATE TABLE workspace_config_documents', 'CREATE TABLE "workspace_config_documents"').replace("'system_ui'))", "'system_ui', 'world_map'))") }
        : entry.name === 'canonical_events'
          ? { ...entry, sql: String(entry.sql).replace('CREATE TABLE canonical_events', 'CREATE TABLE "canonical_events"').replace(',\n  UNIQUE(project_id, event_signature)', '') }
          : entry.name === 'projects'
            ? { ...entry, sql: String(entry.sql).replace(/\)$/, ", text_authority TEXT NOT NULL DEFAULT 'legacy-sqlite'\n  CHECK(text_authority IN ('legacy-sqlite', 'files-v1')))") }
            : ['body_versions', 'outline_versions'].includes(String(entry.name))
              ? { ...entry, sql: String(entry.sql).replace(',\n  UNIQUE', ', review_application_id TEXT REFERENCES document_review_applications(id),\n  UNIQUE') }
              : entry
      assert.deepEqual({ ...raw.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name=?').get(entry.name) }, { ...expected }, 'incoming foreign-key definitions must remain verbatim')
    }
    assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(), []); assert.equal(raw.prepare('PRAGMA quick_check').get()?.quick_check, 'ok')
    assert.throws(() => raw.exec("UPDATE task_runs SET template_id='tampered' WHERE id='parent'"), /immutable/)
    assert.throws(() => raw.exec("UPDATE context_packages SET content_json='[]' WHERE id='ctx'"), /immutable/)
    raw.exec('PRAGMA foreign_keys=ON'); assert.throws(() => raw.exec("DELETE FROM task_runs WHERE id='parent'"), /FOREIGN KEY/)
  } finally { raw.close() }
  assert.equal(await readFile(join(root, '原稿.md'), 'utf8'), '作者原稿不变。')
})

test('failed v36 migration rolls back schema, records and version ledger and restores connection foreign_keys', async context => {
  const { root, file, tables, rows, schema } = await oldFixture(context, true)
  const originalExec = DatabaseSync.prototype.exec
  let restored = false
  let disabled = false
  DatabaseSync.prototype.exec = function (sql: string) { const result = originalExec.call(this, sql); if (sql === 'PRAGMA foreign_keys = OFF') disabled = true; if (disabled && sql === 'PRAGMA foreign_keys = ON') restored = this.prepare('PRAGMA foreign_keys').get()?.foreign_keys === 1; return result }
  try { await assert.rejects(new SqliteWorkspaceDatabaseFactory().openExisting(root), { code: 'DATABASE_MIGRATION_FAILED' }) } finally { DatabaseSync.prototype.exec = originalExec }
  assert.equal(restored, true)
  const raw = new DatabaseSync(file)
  try {
    assert.equal(raw.prepare('PRAGMA user_version').get()?.user_version, 35)
    for (const table of tables) assert.deepEqual(raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), rows[table])
    assert.deepEqual(raw.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all(), schema)
    assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { raw.close() }
})

test('v36 preserves historical duplicate active tasks instead of failing upgrade or silently cancelling them', async context => {
  const { root, file } = await oldFixture(context)
  const raw = new DatabaseSync(file)
  try { raw.exec("UPDATE task_runs SET status='running'") } finally { raw.close() }
  const database = (await new SqliteWorkspaceDatabaseFactory().openExisting(root))!
  try {
    assert.deepEqual(database.recentProjectTaskRuns().map(task => task.status), ['running', 'running'])
    const request = { id: 'after-recovery', taskType: 'writing_agent', legacyChapterId: 1, idempotencyKey: 'recovery', checkpointJson: checkpoint('p') }
    assert.throws(() => database.createTaskRun(request), { code: 'CONFLICT' })
    assert.equal(database.interruptActiveTaskRuns(), 2)
    assert.equal(database.createTaskRun(request).status, 'queued')
  } finally { database.close() }
})
