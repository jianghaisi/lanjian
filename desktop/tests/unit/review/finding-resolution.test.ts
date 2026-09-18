import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { type TestContext } from 'node:test'
import { WORKSPACE_DATABASE_SCHEMA_VERSION, type LegacyWorkspaceSnapshot, type WorkspaceDatabasePort, type WorkspaceFindingDecisionInput } from '../../../src/main/core/ports/workspace-database'
import { SqliteWorkspaceDatabaseFactory, workspaceDatabaseMigrations } from '../../../src/main/platform/storage/workspace-database'

const timestamp = '2026-09-08T12:00:00.000Z'
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-finding-resolution-'))
  let database: WorkspaceDatabasePort | undefined
  context.after(async () => { database?.close(); await rm(root, { recursive: true, force: true }) })
  await mkdir(join(root, '.webnovel'))
  const chapters = [1, 2].map(id => ({ legacyChapterId: id, position: id, title: `第${id}章`, content: '雨来了。雨来了。', contentHash: hash('雨来了。雨来了。'), wordCount: 6, mirrorRelativePath: `正文/第${id}章.md` }))
  const order = '{"version":1,"chapters":[1,2]}'
  const snapshot: LegacyWorkspaceSnapshot = { workItemId: root, projectName: '修复关联测试', projectManifestHash: hash('manifest'), sourceFingerprint: hash('source'), chapters, totalWords: 12,
    chapterOrderMirror: { relativePath: '.webnovel/manuscript/chapter-order.json', content: order, contentHash: hash(order), observedHash: null } }
  const factory = new SqliteWorkspaceDatabaseFactory(() => new Date(timestamp))
  database = await factory.open(root)
  database.importSnapshot(snapshot); database.activateSqlite(snapshot)
  const chapter = database.formalChapters()[0]!
  const finding = database.recordFindingRun({ legacyChapterId: 1, bodyVersionId: chapter.currentVersionId, contentHash: chapter.contentHash,
    ruleLayer: 'literary', findings: [{ code: 'literary.DUPLICATE', severity: 'suggestion', title: '重复段落', rationale: '这句话出现了两次。', evidenceJson: '{"quotes":["雨来了。","雨来了。"]}' }] })[0]!
  return { root, file: join(root, '.webnovel', 'workspace.sqlite'), database, factory, finding, chapter }
}
function edit(database: WorkspaceDatabasePort, content: string, title?: string) {
  const chapter = database.formalChapters().find(chapter => chapter.legacyChapterId === 1)!
  return database.writeFormalChapter({ legacyChapterId: 1, title: title ?? chapter.title, content, reason: 'manual', expectedRevision: chapter.revision }).chapter
}

test('accepted means needs-fix; only explicit fixed attaches a newer saved body while retaining evidence and decision history', async context => {
  const { database, finding, chapter, file } = await fixture(context)
  const accepted = database.decideFinding({ findingId: finding.id, decision: 'accepted' })
  assert.equal(accepted.status, 'accepted'); assert.equal(accepted.resultingBodyVersionId, null)
  assert.ok(accepted.updatedAt > finding.updatedAt)
  const repaired = edit(database, '雨来了。沈砚推开窗。')
  const stale = database.listFindings(1)[0]!
  assert.equal(stale.status, 'stale'); assert.equal(stale.resultingBodyVersionId, null)
  assert.ok(stale.updatedAt > accepted.updatedAt, 'staleness must not reuse or regress a same-clock state token')
  const fixed = database.decideFinding({ findingId: finding.id, decision: 'fixed', expectedUpdatedAt: stale.updatedAt, resultingBodyVersionId: repaired.currentVersionId, reason: '删去了重复句。' })
  assert.equal(fixed.status, 'fixed'); assert.equal(fixed.resultingBodyVersionId, repaired.currentVersionId)
  assert.equal(fixed.bodyVersionId, chapter.currentVersionId); assert.equal(fixed.contentHash, chapter.contentHash)
  assert.equal(fixed.evidenceJson, finding.evidenceJson); assert.equal(fixed.rationale, finding.rationale)
  assert.equal(database.listFindings(1, ['fixed']).length, 1)
  assert.equal(database.formalChapters()[0]?.content, repaired.content)
  const raw = new DatabaseSync(file)
  try {
    const history = raw.prepare('SELECT decision, resulting_body_version_id, reason FROM finding_decisions WHERE finding_id = ? ORDER BY rowid').all(finding.id)
    assert.deepEqual(history.map(row => ({ ...row })), [{ decision: 'accepted', resulting_body_version_id: null, reason: '' }, { decision: 'fixed', resulting_body_version_id: repaired.currentVersionId, reason: '删去了重复句。' }])
    assert.throws(() => raw.prepare('UPDATE finding_decisions SET reason = ? WHERE finding_id = ?').run('改写历史', finding.id), /append-only/)
    assert.throws(() => raw.prepare('DELETE FROM finding_decisions WHERE finding_id = ?').run(finding.id), /append-only/)
    assert.throws(() => raw.prepare('UPDATE findings SET evidence_json = ? WHERE id = ?').run('{}', finding.id), /immutable/)
    assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { raw.close() }
})

test('fixed rejects original, other chapter, missing, competing body targets and competing author decisions with zero side effects', async context => {
  const { database, finding, chapter, file } = await fixture(context)
  const fixed = (target: string, updatedAt = database.listFindings(1)[0]!.updatedAt) => database.decideFinding({ findingId: finding.id, decision: 'fixed', resultingBodyVersionId: target, expectedUpdatedAt: updatedAt })
  assert.throws(() => fixed(chapter.currentVersionId), { code: 'CONFLICT' })
  assert.throws(() => fixed(database.formalChapters()[1]!.currentVersionId), { code: 'CONFLICT' })
  assert.throws(() => fixed('missing-body-version'), { code: 'CONFLICT' })
  const version2 = edit(database, '删去了重复。')
  const token2 = database.listFindings(1)[0]!.updatedAt
  const version3 = edit(database, '作者又继续写了下一句。')
  assert.throws(() => fixed(version2.currentVersionId, token2), { code: 'CONFLICT' })
  assert.throws(() => fixed(version3.currentVersionId, finding.updatedAt), { code: 'CONFLICT' })
  assert.throws(() => database.decideFinding({ findingId: 'another-book-finding', decision: 'fixed', resultingBodyVersionId: version3.currentVersionId, expectedUpdatedAt: token2 }), { code: 'NOT_FOUND' })
  const raw = new DatabaseSync(file)
  try { assert.equal(raw.prepare('SELECT count(*) AS n FROM finding_decisions').get()?.n, 0) } finally { raw.close() }
  const fresh = database.recordFindingRun({ legacyChapterId: 1, bodyVersionId: version3.currentVersionId, contentHash: version3.contentHash, ruleLayer: 'literary', findings: [{ code: 'new.issue', severity: 'suggestion', title: '新检查', rationale: '再核对一次。', evidenceJson: '{}' }] })[0]!
  const accepted = database.decideFinding({ findingId: fresh.id, decision: 'accepted' })
  const ignored = database.decideFinding({ findingId: fresh.id, decision: 'ignored' })
  assert.ok(ignored.updatedAt > accepted.updatedAt)
  const version4 = edit(database, '作者认为原提示只是误报。')
  assert.throws(() => database.decideFinding({ findingId: fresh.id, decision: 'fixed', resultingBodyVersionId: version4.currentVersionId, expectedUpdatedAt: accepted.updatedAt }), { code: 'CONFLICT' })
})

test('a subsequent body-version change invalidates fixed even on title-only save and preserves the historical repair target', async context => {
  const { database, finding, file } = await fixture(context)
  const repaired = edit(database, '只有一句雨声。')
  const stale = database.listFindings(1)[0]!
  const fixed = database.decideFinding({ findingId: finding.id, decision: 'fixed', expectedUpdatedAt: stale.updatedAt, resultingBodyVersionId: repaired.currentVersionId })
  const renamed = edit(database, repaired.content, '改了标题')
  assert.notEqual(renamed.currentVersionId, repaired.currentVersionId)
  assert.equal(renamed.contentHash, repaired.contentHash)
  const invalidated = database.listFindings(1)[0]!
  assert.equal(invalidated.status, 'stale'); assert.equal(invalidated.resultingBodyVersionId, repaired.currentVersionId)
  assert.ok(invalidated.updatedAt > fixed.updatedAt)
  assert.equal(database.listFindings(1, ['fixed']).length, 0)
  const raw = new DatabaseSync(file, { readOnly: true })
  try { assert.equal(raw.prepare("SELECT count(*) AS n FROM finding_decisions WHERE decision = 'fixed'").get()?.n, 1) } finally { raw.close() }
})

test('SQLite guards reject forged repair scopes and failures roll back both appended decision and status', async context => {
  const { database, finding, chapter, file } = await fixture(context)
  const repaired = edit(database, '修复后的正文。')
  const raw = new DatabaseSync(file)
  try {
    const insert = raw.prepare("INSERT INTO finding_decisions(id,finding_id,decision,reason,created_at,resulting_body_version_id) VALUES (?,?,'fixed','',?,?)")
    assert.throws(() => insert.run('bad-original', finding.id, timestamp, chapter.currentVersionId), /newer current/)
    assert.throws(() => insert.run('bad-other-chapter', finding.id, timestamp, database.formalChapters()[1]!.currentVersionId), /newer current/)
    assert.throws(() => raw.prepare("UPDATE findings SET status = 'fixed', resulting_body_version_id = ? WHERE id = ?").run(repaired.currentVersionId, finding.id), /explicit decision/)
    raw.exec("CREATE TRIGGER force_finding_resolution_failure BEFORE UPDATE ON findings WHEN NEW.status = 'fixed' BEGIN SELECT RAISE(ABORT, 'injected failure'); END")
    const stale = database.listFindings(1)[0]!
    assert.throws(() => database.decideFinding({ findingId: finding.id, decision: 'fixed', resultingBodyVersionId: repaired.currentVersionId, expectedUpdatedAt: stale.updatedAt }), { code: 'STORAGE_ERROR' })
    assert.equal(raw.prepare('SELECT count(*) AS n FROM finding_decisions').get()?.n, 0)
    assert.equal(database.listFindings(1)[0]?.status, 'stale')
    raw.exec('DROP TRIGGER force_finding_resolution_failure')
  } finally { raw.close() }
  assert.throws(() => database.decideFinding({ findingId: finding.id, decision: 'fixed', resultingBodyVersionId: repaired.currentVersionId } as WorkspaceFindingDecisionInput), { code: 'VALIDATION_ERROR' })
})

test('Finding operation metrics count real decisions and preserve a useful fixed outcome after automatic invalidation', async context => {
  const { database, finding } = await fixture(context)
  function metrics() {
    const body = database.formalChapters()[0]!
    return database.upsertRealTrialChapter({ legacyChapterId: 1, bodyVersionId: body.currentVersionId, planningMinutes: 0, writingMinutes: 0, aiEditingMinutes: 0, factReviewMinutes: 0,
      diffAcceptedBlocks: 0, diffRejectedBlocks: 0, misappliedChanges: 0, falsePositiveFindings: 99, usefulFindings: 99, modelCost: null, satisfaction: 4, continueNextChapter: true, bypassedFeatures: '', notes: '' }).automatic
  }
  assert.equal(metrics().findingDecisions, 0)
  database.decideFinding({ findingId: finding.id, decision: 'accepted' })
  assert.equal(metrics().findingDecisions, 1); assert.equal(metrics().usefulFindings, 1)
  const repaired = edit(database, '重复内容已删除。')
  assert.equal(metrics().findingDecisions, 1); assert.equal(metrics().usefulFindings, 1)
  database.decideFinding({ findingId: finding.id, decision: 'fixed', expectedUpdatedAt: database.listFindings(1)[0]!.updatedAt, resultingBodyVersionId: repaired.currentVersionId })
  assert.equal(metrics().findingDecisions, 2); assert.equal(metrics().usefulFindings, 1)
  const newer = edit(database, '作者继续书写，旧修复需重新核对。')
  assert.equal(database.listFindings(1)[0]?.status, 'stale')
  assert.equal(metrics().findingDecisions, 2); assert.equal(metrics().usefulFindings, 1)
  const another = database.recordFindingRun({ legacyChapterId: 1, bodyVersionId: newer.currentVersionId, contentHash: newer.contentHash, ruleLayer: 'literary', findings: [{ code: 'another.issue', severity: 'suggestion', title: '另一个提示', rationale: '供作者核对。', evidenceJson: '{}' }] })[0]!
  database.decideFinding({ findingId: another.id, decision: 'ignored' })
  assert.equal(metrics().falsePositiveFindings, 1)
  database.decideFinding({ findingId: another.id, decision: 'later' })
  assert.equal(metrics().falsePositiveFindings, 0)
  database.decideFinding({ findingId: another.id, decision: 'exception', reason: '有意保留。' })
  assert.equal(metrics().findingDecisions, 5); assert.equal(metrics().usefulFindings, 1); assert.equal(metrics().falsePositiveFindings, 0)
  const untouched = database.recordFindingRun({ legacyChapterId: 1, bodyVersionId: newer.currentVersionId, contentHash: newer.contentHash, ruleLayer: 'literary', findings: [{ code: 'untouched.issue', severity: 'suggestion', title: '未审提示', rationale: '还没有人工决定。', evidenceJson: '{}' }] })[0]!
  edit(database, '又保存一次。')
  assert.equal(database.listFindings(1).find(item => item.id === untouched.id)?.status, 'stale')
  assert.equal(metrics().findingDecisions, 5, 'automatic stale is never a human decision')
})

test('v34 migration preserves all historical evidence and decisions without inventing a repaired body', async context => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-finding-v34-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, '.webnovel')); await writeFile(join(root, '原稿.md'), '作者原稿保留。')
  const file = join(root, '.webnovel', 'workspace.sqlite')
  const raw = new DatabaseSync(file)
  raw.exec('PRAGMA foreign_keys = ON')
  for (const migration of workspaceDatabaseMigrations.filter(migration => migration.version <= 34)) {
    raw.exec(migration.sql)
    raw.prepare('INSERT INTO schema_migrations(version,name,applied_at,checksum) VALUES (?,?,?,?)').run(migration.version,migration.name,timestamp,migration.checksum)
    raw.exec(`PRAGMA user_version = ${migration.version}`)
  }
  raw.prepare("INSERT INTO projects(id,name,status,legacy_manifest_hash,storage_mode,created_at,updated_at) VALUES ('p','旧书','active',?,'sqlite',?,?)").run(hash('manifest'),timestamp,timestamp)
  raw.prepare("INSERT INTO chapters(id,project_id,legacy_chapter_id,seq,title,status,created_at,updated_at) VALUES ('c','p',1,1,'旧章','draft',?,?)").run(timestamp,timestamp)
  raw.prepare("INSERT INTO body_versions(id,chapter_id,version_no,content,content_hash,source_type,created_at) VALUES ('b','c',1,'旧正文',?,'manual',?)").run(hash('旧正文'),timestamp)
  raw.exec("UPDATE chapters SET current_body_version_id = 'b' WHERE id='c'")
  raw.prepare("INSERT INTO rule_runs(id,project_id,chapter_id,body_version_id,content_hash,rule_layer,status,input_json,result_json,created_at,updated_at) VALUES ('r','p','c','b',?,'literary','succeeded','{}','{}',?,?)").run(hash('旧正文'),timestamp,timestamp)
  for (const decision of ['accepted','ignored','exception','later']) {
    raw.prepare("INSERT INTO findings(id,project_id,rule_run_id,chapter_id,body_version_id,content_hash,rule_layer,severity,code,title,rationale,evidence_json,status,created_at,updated_at) VALUES (?,'p','r','c','b',?,'literary','suggestion',?,'旧提示','旧依据','{\"quote\":\"旧正文\"}',?,?,?)").run(`f-${decision}`,hash('旧正文'),decision,decision === 'later' ? 'open' : decision,timestamp,timestamp)
    raw.prepare('INSERT INTO finding_decisions(id,finding_id,decision,reason,created_at) VALUES (?,?,?,?,?)').run(`d-${decision}`,`f-${decision}`,decision,'作者旧决定',timestamp)
  }
  const beforeFindings = raw.prepare('SELECT * FROM findings ORDER BY id').all()
  const beforeDecisions = raw.prepare('SELECT * FROM finding_decisions ORDER BY rowid').all()
  const bodies = raw.prepare('SELECT * FROM body_versions').all()
  raw.close()
  const database = await new SqliteWorkspaceDatabaseFactory().openExisting(root)
  assert.ok(database); assert.equal(database.listFindings(1).length, 4); database.close()
  const upgraded = new DatabaseSync(file)
  try {
    assert.equal(upgraded.prepare('PRAGMA user_version').get()?.user_version, WORKSPACE_DATABASE_SCHEMA_VERSION)
    assert.deepEqual(upgraded.prepare('PRAGMA foreign_key_check').all(), [])
    assert.deepEqual(upgraded.prepare('SELECT * FROM body_versions').all(), bodies)
    assert.deepEqual(upgraded.prepare('SELECT * FROM findings ORDER BY id').all().map(({ resulting_body_version_id, ...row }) => { assert.equal(resulting_body_version_id, null); return { ...row } }), beforeFindings.map(row => ({ ...row })))
    assert.deepEqual(upgraded.prepare('SELECT * FROM finding_decisions ORDER BY rowid').all().map(({ resulting_body_version_id, ...row }) => { assert.equal(resulting_body_version_id, null); return { ...row } }), beforeDecisions.map(row => ({ ...row })))
    assert.throws(() => upgraded.exec("UPDATE finding_decisions SET reason = '篡改历史'"), /append-only/)
  } finally { upgraded.close() }
  assert.equal(await readFile(join(root, '原稿.md'), 'utf8'), '作者原稿保留。')
})
