import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { WorkspaceDatabaseFactory, WorkspaceDatabasePort, WorkspaceFindingRecord } from '../../../src/main/core/ports/workspace-database'
import type { Chapter, ConsistencyFinding, ConsistencyFindingHistory, OutlinePlanningStatus, WorkflowStatus } from '../../../src/contracts/index'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'
import { ShadowImportService } from '../../../src/main/modules/library/application/shadow-import-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../../src/main/modules/library/application/legacy-workspace-source'
import { DocumentService } from '../../../src/main/modules/manuscript/application/document-service'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'
import { SqliteManuscriptService } from '../../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { attachFindingRecord, WorkspaceService } from '../../../src/main/modules/library/application/workspace-service'

const record = (patch: Partial<WorkspaceFindingRecord> = {}): WorkspaceFindingRecord => ({
  id: 'finding-1', runId: 'run-1', legacyChapterId: 1, bodyVersionId: 'old-body',
  contentHash: 'a'.repeat(64), ruleLayer: 'literary', severity: 'suggestion', code: 'literary.DUPLICATE_PARAGRAPH',
  title: '重复段落', rationale: '两段正文重复。', evidenceJson: '{"private":"not a public history field"}', suggestedAction: '核对重复。',
  status: 'fixed', resultingBodyVersionId: 'current-body', createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T01:00:00.000Z', ...patch
})

function mockAuthority(records: WorkspaceFindingRecord[], options: { race?: boolean; mode?: string; fail?: boolean } = {}) {
  let opens = 0, closes = 0, pointerReads = 0
  const database = {
    storageMode: () => options.mode ?? 'sqlite',
    chapterDerivativeStatus: (id: number) => { assert.equal(id, 1); return { bodyVersionId: options.race && ++pointerReads > 1 ? 'changed-body' : 'current-body' } },
    listFindings: (id: number) => { assert.equal(id, 1); if (options.fail) throw new Error('fixture read failure'); return records },
    close: () => { closes++ }
  } as unknown as WorkspaceDatabasePort
  const factory = { openExisting: async (root: string) => { assert.equal(root, 'scoped-book'); opens++; return database } } as WorkspaceDatabaseFactory
  return { service: new SqliteManuscriptService(factory), counts: () => ({ opens, closes }) }
}

test('finding history uses one scoped connection, caps output and exposes only exact provenance fields', async () => {
  const input = Array.from({ length: 503 }, (_, i) => record({ id: `finding-${i}` }))
  input[1] = record({ id: 'legacy-without-repair', resultingBodyVersionId: undefined })
  const before = structuredClone(input)
  const { service, counts } = mockAuthority(input)
  const history = await service.consistencyFindingHistory('scoped-book', 1)
  assert.equal(history.bodyVersionId, 'current-body')
  assert.equal(history.entries.length, 500)
  assert.deepEqual(Object.keys(history.entries[0]!).sort(), ['id', 'title', 'rationale', 'status', 'sourceBodyVersionId', 'resultingBodyVersionId', 'updatedAt'].sort())
  assert.equal(history.entries[0]?.sourceBodyVersionId, 'old-body')
  assert.equal(history.entries[0]?.resultingBodyVersionId, 'current-body')
  assert.equal(history.entries[1]?.resultingBodyVersionId, null)
  assert.doesNotMatch(JSON.stringify(history), /private|contentHash|runId|evidenceJson/)
  assert.deepEqual(input, before)
  assert.deepEqual(counts(), { opens: 1, closes: 1 })
})

test('finding history fails closed on concurrent body replacement and closes its connection on failures', async () => {
  const raced = mockAuthority([record()], { race: true })
  await assert.rejects(raced.service.consistencyFindingHistory('scoped-book', 1), { code: 'CONFLICT' })
  assert.deepEqual(raced.counts(), { opens: 1, closes: 1 })
  const failed = mockAuthority([], { fail: true })
  await assert.rejects(failed.service.consistencyFindingHistory('scoped-book', 1), /fixture read failure/)
  assert.deepEqual(failed.counts(), { opens: 1, closes: 1 })
  const fileMode = mockAuthority([], { mode: 'shadow' })
  await assert.rejects(fileMode.service.consistencyFindingHistory('scoped-book', 1), { code: 'CONFLICT' })
  assert.deepEqual(fileMode.counts(), { opens: 1, closes: 1 })
})

test('historical resolution has a nullable repair link; attaching fixed never turns a new finding severity green', () => {
  const finding: ConsistencyFinding = { code: 'DUPLICATE_PARAGRAPH', layer: 'literary', severity: 'advice', message: '重复', characterId: 'style', characterName: '表达', fromChapter: 1, toChapter: 1, evidence: ['两段'] }
  const fixed = attachFindingRecord(finding, record())
  assert.equal(fixed.findingStatus, 'fixed')
  assert.equal(fixed.updatedAt, record().updatedAt)
  assert.equal(fixed.resultingBodyVersionId, 'current-body')
  assert.equal(fixed.severity, finding.severity)
  assert.equal(attachFindingRecord(finding, record({ resultingBodyVersionId: undefined })).resultingBodyVersionId, null)
  assert.equal(attachFindingRecord(finding).findingStatus, undefined)
})

const planning = { totalOutlineExists: false, totalApproval: { status: 'missing' }, chapterPlacements: [], volumes: [], eventChapterPlacements: [], assignedEventIds: [], unplacedEventIds: [] } as unknown as OutlinePlanningStatus
const workflow = { steps: [], missingForProse: [], readyForProse: false } as unknown as WorkflowStatus
class ProjectionWorkspace extends WorkspaceService {
  override async workflowStatus() { return workflow }
  override async realms() { return { levels: [] } }
}
function projectionFixture(options: { formal?: boolean; history?: () => Promise<ConsistencyFindingHistory>; afterPlanning?: () => void } = {}) {
  let root = 'book-a', historyCalls = 0, chapterReads = 0
  const persistedVersions: string[] = []
  const chapter = { id: 1, position: 1, title: '第一章', content: '安静的正文。', bodyVersionId: 'current-body' } as Chapter
  const formal = {
    active: async () => options.formal !== false,
    recordConsistencyFindings: async (_root: string, input: { bodyVersionId: string }) => { persistedVersions.push(input.bodyVersionId); return [] },
    consistencyFindingHistory: async (scope: string, id: number) => { assert.equal(scope, 'book-a'); assert.equal(id, 1); historyCalls++; return options.history ? options.history() : { bodyVersionId: 'current-body', entries: [] } }
  } as unknown as NonNullable<ConstructorParameters<typeof WorkspaceService>[6]>
  const service = new ProjectionWorkspace(
    { currentPath: async () => root } as ProjectService,
    { status: async () => { options.afterPlanning?.(); return planning } }, undefined,
    { chapter: async () => { chapterReads++; return chapter } }, undefined, undefined, formal
  )
  return { service, switchBook: () => { root = 'book-b' }, counts: () => ({ historyCalls, chapterReads, persistedVersions }) }
}

test('chapter projection returns same-version history and records findings against its frozen initial body', async () => {
  const fixture = projectionFixture()
  const value = await fixture.service.chapterProjection(1)
  assert.deepEqual(value.findingHistory, { bodyVersionId: 'current-body', entries: [] })
  assert.deepEqual(fixture.counts(), { historyCalls: 1, chapterReads: 1, persistedVersions: ['current-body', 'current-body', 'current-body'] })
})

test('file-mode projection does not open or expose finding history', async () => {
  const fixture = projectionFixture({ formal: false })
  const value = await fixture.service.chapterProjection(1)
  assert.equal(value.findingHistory, undefined)
  assert.equal(fixture.counts().historyCalls, 0)
})

test('chapter projection rejects a body version change during asynchronous composition', async () => {
  const fixture = projectionFixture({ history: async () => ({ bodyVersionId: 'changed-body', entries: [] }) })
  await assert.rejects(fixture.service.chapterProjection(1), { code: 'CONFLICT' })
})

test('chapter projection does not publish history from a book switched during the read', async () => {
  const fixture = projectionFixture({ history: async () => { fixture.switchBook(); return { bodyVersionId: 'current-body', entries: [] } } })
  await assert.rejects(fixture.service.chapterProjection(1), { code: 'CONFLICT' })
})

test('a book switch during initial checks prevents even the existing finding recording step', async () => {
  const fixture = projectionFixture({ afterPlanning: () => fixture.switchBook() })
  await assert.rejects(fixture.service.chapterProjection(1), { code: 'CONFLICT' })
  assert.deepEqual(fixture.counts().persistedVersions, [])
  assert.equal(fixture.counts().historyCalls, 0)
})

async function realFixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-finding-history-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const settings = new SettingsStore(join(root, 'settings'), { available: () => true, encrypt: value => value, decrypt: value => value })
  const projects = new ProjectService(settings)
  const { project } = await projects.create({ parentPath: root, name: '检查历史测试', genre: '轻小说' })
  const files = new DocumentService(projects)
  await files.updateChapter(1, { title: '第一章', content: '原正文出现重复情节。' })
  await files.updateChapter(2, { title: '第二章', content: '另章正文不能混入。' })
  const databases = new SqliteWorkspaceDatabaseFactory()
  const source = new CurrentProjectLegacyWorkspaceSource(projects, files)
  const shadow = new ShadowImportService(source, databases)
  await shadow.import(await shadow.preview())
  const authority = new SqliteManuscriptService(databases)
  await authority.activate(project.path, await source.snapshot())
  return { authority, databases, project }
}

test('real SQLite history retains old repair provenance, excludes another chapter and changes no stored records or prose', async context => {
  const { authority, databases, project } = await realFixture(context)
  const chapters = await authority.chapters(project.path)
  const original = chapters.find(chapter => chapter.id === 1)!, other = chapters.find(chapter => chapter.id === 2)!
  const hash = (content: string) => createHash('sha256').update(content).digest('hex')
  const issue = { code: 'literary.DUPLICATE_PARAGRAPH', severity: 'suggestion' as const, title: '重复情节', rationale: '需要核对重复。', evidenceJson: '{}', suggestedAction: '删除意外重复。' }
  const [first] = await authority.recordConsistencyFindings(project.path, { legacyChapterId: 1, bodyVersionId: original.bodyVersionId!, contentHash: hash(original.content), ruleLayer: 'literary', findings: [issue] })
  await authority.recordConsistencyFindings(project.path, { legacyChapterId: 2, bodyVersionId: other.bodyVersionId!, contentHash: hash(other.content), ruleLayer: 'literary', findings: [{ ...issue, title: '另章不能出现' }] })
  const repaired = await authority.updateChapter(project.path, 1, { title: original.title, content: '作者已经修改这一章。' })
  let db = await databases.openExisting(project.path)
  const old = db!.listFindings(1).find(item => item.id === first!.id)!
  db!.close()
  await authority.decideConsistencyFinding(project.path, { findingId: old.id, decision: 'fixed', resultingBodyVersionId: repaired.bodyVersionId!, expectedUpdatedAt: old.updatedAt })
  // A later finding with the same code remains an independent open record.
  await authority.recordConsistencyFindings(project.path, { legacyChapterId: 1, bodyVersionId: repaired.bodyVersionId!, contentHash: hash(repaired.content), ruleLayer: 'literary', findings: [issue] })
  db = await databases.openExisting(project.path)
  const before = { findings: db!.listFindings(), chapters: db!.formalChapters(), derivatives: db!.chapterDerivativeStatus(1) }
  db!.close()
  const persistedRows = () => {
    const raw = new DatabaseSync(join(project.path, '.webnovel', 'workspace.sqlite'), { readOnly: true })
    try {
      return Object.fromEntries(['findings', 'finding_decisions', 'rule_runs', 'body_versions', 'mirror_entries', 'write_operations'].map(table => [table, raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
    } finally { raw.close() }
  }
  const rowsBefore = persistedRows()
  const mirror = join(project.path, '正文', '第1章-第一章.md')
  const mirrorBefore = await readFile(mirror, 'utf8')
  const history = await authority.consistencyFindingHistory(project.path, 1)
  assert.equal(history.bodyVersionId, repaired.bodyVersionId)
  assert.equal(history.entries.length, 2)
  assert.equal(history.entries.find(item => item.id === old.id)?.status, 'fixed')
  assert.equal(history.entries.find(item => item.id === old.id)?.sourceBodyVersionId, original.bodyVersionId)
  assert.equal(history.entries.find(item => item.id === old.id)?.resultingBodyVersionId, repaired.bodyVersionId)
  assert.equal(history.entries.find(item => item.id !== old.id)?.status, 'open')
  assert.doesNotMatch(JSON.stringify(history), /另章不能出现/)
  db = await databases.openExisting(project.path)
  assert.deepEqual({ findings: db!.listFindings(), chapters: db!.formalChapters(), derivatives: db!.chapterDerivativeStatus(1) }, before)
  db!.close()
  assert.deepEqual(persistedRows(), rowsBefore)
  assert.equal(await readFile(mirror, 'utf8'), mirrorBefore)
})
