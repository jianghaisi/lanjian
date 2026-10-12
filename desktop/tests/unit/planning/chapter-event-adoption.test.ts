import { decodeUpstreamReviewArgs, decodeChapterUpstreamReview, decodeUpstreamReviewRecord } from '../../../src/contracts/planning/upstream-review-contracts'
import { reviewRefinements } from '../../../src/main/modules/planning/domain/upstream-review'
import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { DocumentService } from '../../../src/main/modules/manuscript/application/document-service'
import { ResearchLibraryService } from '../../../src/main/modules/library/application/research-library-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../../src/main/modules/library/application/legacy-workspace-source'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'
import { SqliteManuscriptService } from '../../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { ManuscriptCommitJournal } from '../../../src/main/modules/manuscript/adapters/manuscript-commit-journal'
import { OutlinePlanningService } from '../../../src/main/modules/planning/application/outline-planning-service'
import { PlanningPackageService, renderPlanningTotalOutline, renderPlanningVolumeOutline, renderPlanningVolumePlan, renderPlanningVolumeStructure, renderPlanningChapterSkeletonVolume } from '../../../src/main/modules/planning/application/planning-package-service'
import { CanonicalEventVersions } from '../../../src/main/modules/timeline/adapters/canonical-event-versions'
import { EventOperationService } from '../../../src/main/modules/timeline/application/event-operation-service'
import { decodeChapterEventAdoptionArgs } from '../../../src/contracts/planning/ipc'
import { planningIpcValueDecoders } from '../../../src/contracts/planning/ipc-planning-result-contracts'
import { EventProjectionService } from '../../../src/main/modules/timeline/application/event-projection-service'
import { EventMigrationReviewSession } from '../../../src/main/modules/timeline/application/event-migration-review-session'
import { EventMigrationCommitService } from '../../../src/main/modules/timeline/application/event-migration-commit-service'
import { LocalEventSourceSnapshotReader } from '../../../src/main/modules/timeline/adapters/event-source-snapshot'
import { eventReceiptHash } from '../../../src/main/modules/timeline/adapters/event-migration-receipt-evidence'
import { WorkspaceWriteCoordinator } from '../../../src/main/core/application/workspace-write-coordinator'
import type { PlanningChapterSkeletonEntry } from '../../../src/contracts/planning/types'
import { assertChapterEventAdoption, assertChapterEventOutputs, chapterEventItems, chapterEventOutputItems } from '../../../src/main/modules/planning/domain/chapter-event-adoption'
import { assertPlanningSources, changedPlanningSources } from '../../../src/main/modules/planning/domain/planning-dependencies'

const event = { time: '第一日午后', characters: ['林舟'], location: '旧城', event: '核对旧信的落款', result: '发现名字不符', evidenceRefs: [], confidence: 1 }
const draft = { time: event.time, characters: event.characters, location: event.location, event: event.event, result: event.result }
const body = '## 本章目标\n林舟核对旧信。\n## 剧情节拍\n发现落款矛盾，于是前往旧城。\n## 章末状态\n决定继续调查。'
const batch = [event, { ...event, time: '第一日傍晚', event: '向证人询问旧信', result: '得知寄信人行踪' }]
async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir()), root = await mkdtemp(join(parent, 'lanjian-joint-adoption-'))
  t.after(async () => { assert.equal(dirname(await realpath(root)), parent); await rm(root, { recursive: true, force: true }) })
  const settings = new SettingsStore(join(root, 'profile'), { available: () => true, encrypt: s => Buffer.from(s).toString('base64'), decrypt: s => Buffer.from(s, 'base64').toString() })
  const projects = new ProjectService(settings)
  const { project } = await projects.create({ parentPath: root, name: '联合采用隔离作品', genre: '悬疑' })
  const source = new CurrentProjectLegacyWorkspaceSource(projects, new DocumentService(projects))
  const snapshot = await source.snapshot(), factory = new SqliteWorkspaceDatabaseFactory()
  const initial = await factory.open(project.path)
  initial.importSnapshot(snapshot); initial.activateSqlite(snapshot); initial.activateEmptyFileTextAuthority(); initial.close()
  const scope = { root: project.path, workItemId: project.path, generation: 1 }, currentScope = async () => scope
  const writes = new WorkspaceWriteCoordinator(), reader = new LocalEventSourceSnapshotReader(factory)
  const reviews = new EventMigrationReviewSession({ capture: () => reader.capture(scope) }, currentScope, { nonce: randomUUID, now: Date.now, sha256: eventReceiptHash })
  const preview = await reviews.preview()
  const grant = await reviews.review(preview.previewId, { fingerprint: preview.fingerprint, rows: [], acknowledgedGroups: [], acknowledgedPlanningFindings: [], acknowledgedMirrors: [] })
  await new EventMigrationCommitService(reviews, factory, reader, currentScope, writes).commit(grant.token)
  const authority = new SqliteManuscriptService(factory), documents = new DocumentService(projects, undefined, authority)
  const projection = new EventProjectionService(factory, currentScope, writes)
  const planning = new OutlinePlanningService(projects, documents, new ResearchLibraryService(projects, authority), authority, { read: () => projection.readForConsumer() })
  await planning.updateOutline('total', '林舟因为收到旧信而调查，于是发现名字矛盾，最终找出真相。')
  await planning.createVolume('旧城')
  await planning.updateOutline(1, '林舟进入旧城，因为发现落款不符而查找证人，最终找到发信人。')
  const chapter = (await documents.createChapter()).id
  await planning.placeChapter(chapter, 1)
  for (const scope of ['total', 1] as const) {
    const status = await planning.status(), review = scope === 'total' ? status.totalReview : status.volumes[0].review
    if (review.status === 'attention') await planning.acknowledgeOutlineReview(scope)
    await planning.confirmPlanningOutline(scope)
  }
  const entry: PlanningChapterSkeletonEntry = { chapter, volume: 1, volumeChapter: 1, title: '核对', coreEvent: event.event, characters: event.characters, location: event.location, result: event.result }
  const skeleton = await planning.inspectFormalSkeleton([entry], 1)
  await planning.adoptFormalSkeleton([entry], 1, skeleton.fingerprint)
  const prepare = () => planning.prepareChapterEvent(chapter, 1, entry.title, body, event)
  const operations = new EventOperationService(factory, reader, currentScope, writes, { nonce: randomUUID, now: Date.now, sha256: eventReceiptHash })
  return { root, project, projects, documents, factory, authority, planning, chapter, entry, prepare, operations, projection, path: join(project.path, '.webnovel/workspace.sqlite') }
}

async function stageFixture(t: TestContext) {
  const f = await fixture(t)
  await f.planning.updateChapterOutline(f.chapter, '原阶段章纲')
  const { stage } = await f.documents.createStage(1, '核对旧信')
  await f.documents.updateStage(stage.stage, stage.title, '先核对信件，再寻找证人。')
  await f.documents.placeChapterInStage(f.chapter, stage.stage, 1)
  return { ...f, stage: stage.stage }
}

test('stage adoption preserves hierarchy and binds stage freshness only to its chapter', async t => {
  const f = await stageFixture(t)
  const other = (await f.documents.createChapter()).id
  await f.planning.placeChapter(other, 1)
  const otherEntry = { ...f.entry, chapter: other, volumeChapter: 2 }
  const skeleton = await f.planning.inspectFormalSkeleton([f.entry, otherEntry], 1)
  await f.planning.adoptFormalSkeleton([f.entry, otherEntry], 1, skeleton.fingerprint)
  await f.planning.updateChapterOutline(other, '另一章独立的安排')
  const plan = await f.prepare()
  assert.equal(plan.command.parents[2].key, `stage-${f.stage}`)
  assertChapterEventAdoption(plan.command)
  const result = await f.planning.commitChapterEvent(plan.root, plan.command)
  assert.equal((await f.documents.getPlannedChapter(f.chapter)).stage, f.stage)
  assert.equal((await f.planning.status(f.chapter)).chapter?.stale, false)
  assert.equal((await f.planning.status(other)).chapter?.stale, false)
  const db = (await f.factory.openExisting(f.project.path))!
  try {
    const sources = JSON.parse(db.outlinePlanningState().content).chapters.find((c: {chapterId: number}) => c.chapterId === f.chapter).sources
    assert.deepEqual(sources.stage, { id: f.stage, volume: 1, revision: plan.command.parents[2].revision })
    assert.equal(db.listCanonicalEventVersions(result.output.eventId)[0].sources[0].source.revision,
      db.formalOutlines().find(o => o.legacyKey === `chapter-${f.chapter}`)!.currentVersionId)
    assert.throws(() => assertChapterEventAdoption({ ...plan.command, parents: [...plan.command.parents, plan.command.parents[2]] }))
    assert.throws(() => assertChapterEventAdoption({ ...plan.command, expectedOutlineRevision: null }))
    assert.throws(() => assertPlanningSources({ ...sources, stage: { ...sources.stage, volume: 2 } }))
    const { stage: ignored, ...legacy } = sources
    assertPlanningSources(legacy)
    assert.ok(changedPlanningSources(legacy, sources).includes('所属阶段或阶段纲已变化'))
  } finally { db.close() }
  await f.documents.updateStage(f.stage, '核对新落款', '阶段结果发生变化。')
  assert.equal((await f.planning.status(f.chapter)).chapter?.stale, true)
  assert.equal((await f.planning.status(other)).chapter?.stale, false)
  const after = await f.planning.inspectFormalSkeleton([f.entry, otherEntry], 1)
  assert.ok(after.entries.every(e => e.status === 'current'))
})

test('stage text, same-volume placement and cross-volume parent changes reject stale adoption', async t => {
  const f = await stageFixture(t)
  const plan = await f.prepare()
  await f.documents.updateStage(f.stage, '阶段改名', '另一份阶段安排')
  await assert.rejects(f.planning.commitChapterEvent(plan.root, plan.command), { code: 'CONFLICT' })
  const second = await f.prepare()
  const other = await f.documents.createStage(1, '同卷另一阶段')
  await f.documents.placeChapterInStage(f.chapter, other.stage.stage, 1)
  await assert.rejects(f.planning.commitChapterEvent(second.root, second.command), { code: 'CONFLICT' })
  await f.planning.createVolume('下一卷')
  await f.planning.updateOutline(2, '另一卷正式纲要')
  const third = await f.prepare()
  const db = (await f.factory.openExisting(f.project.path))!
  try {
    const stage = db.formalOutlines().find(o => o.legacyKey === `stage-${other.stage.stage}`)!
    db.writeFormalOutline({ legacyKey: stage.legacyKey, nodeType: 'stage', parentLegacyKey: 'volume-2', seq: stage.seq,
      title: stage.title, content: stage.content, expectedRevision: stage.revision })
    assert.throws(() => db.adoptChapterEvent(third.command), { code: 'CONFLICT' })
    assert.equal(db.listCanonicalEvents().length, 0)
    assert.equal(db.formalOutlines().find(o => o.legacyKey === `chapter-${f.chapter}`)!.content, '原阶段章纲')
  } finally { db.close() }
})

test('stage adoption recovers the original parent and exact event after file replacement', async t => {
  const f = await stageFixture(t), plan = await f.prepare()
  const raw = new DatabaseSync(f.path)
  raw.exec("CREATE TRIGGER stage_failure BEFORE INSERT ON manuscript_file_commits BEGIN SELECT RAISE(ABORT,'injected'); END"); raw.close()
  await assert.rejects(f.planning.commitChapterEvent(plan.root, plan.command), { code: 'STORAGE_ERROR' })
  const clear = new DatabaseSync(f.path); clear.exec('DROP TRIGGER stage_failure'); clear.close()
  const result = await f.planning.recoverChapterEvent(plan.command.operationId)
  assert.equal(result.output.eventId, plan.command.eventId)
  assert.equal((await f.documents.getPlannedChapter(f.chapter)).stage, f.stage)
  assert.equal((await f.planning.status(f.chapter)).chapter?.stale, false)
  assert.equal((await f.planning.recoverChapterEvent(plan.command.operationId)).output.eventId, plan.command.eventId)
  assert.equal((await f.projection.read()).approved.length, 1)
})

test('stage identity stays independent from historical display sequence', async t => {
  const f = await fixture(t)
  await f.planning.updateChapterOutline(f.chapter, '历史阶段章纲')
  const db = (await f.factory.openExisting(f.project.path))!
  try {
    db.writeFormalOutline({ legacyKey: 'stage-160', parentLegacyKey: 'volume-1', nodeType: 'stage', seq: 1,
      title: '历史阶段', content: '核对旧信后寻找证人。' })
  } finally { db.close() }
  await f.documents.placeChapterInStage(f.chapter, 160, 1)
  const plan = await f.prepare()
  assert.equal(plan.command.parents[2].key, 'stage-160')
  assert.equal(JSON.parse(plan.command.planningContent).chapters[0].sources.stage.id, 160)
  await f.planning.commitChapterEvent(plan.root, plan.command)
  assert.equal((await f.documents.getPlannedChapter(f.chapter)).stage, 160)
  assert.equal((await f.planning.status(f.chapter)).chapter?.stale, false)
  await f.documents.updateStage(160, '历史阶段', '修改历史阶段的约束。')
  assert.equal((await f.planning.status(f.chapter)).chapter?.stale, true)
})

test('ordinary save retains stage dependencies when a legacy chapter has no planning volume', async t => {
  const f = await stageFixture(t)
  await f.planning.placeChapter(f.chapter, null)
  await f.planning.updateChapterOutline(f.chapter, '保留历史阶段的手写修改')
  assert.equal((await f.documents.getPlannedChapter(f.chapter)).stage, f.stage)
  const db = (await f.factory.openExisting(f.project.path))!
  try {
    const sources = JSON.parse(db.outlinePlanningState().content).chapters[0].sources
    assert.equal(sources.volume, null)
    assert.equal(sources.stage.volume, 1)
    assert.equal(sources.stage.id, f.stage)
    assertPlanningSources(sources)
  } finally { db.close() }
  await f.planning.status(f.chapter)
})

for (const source of ['stage', 'total', 'volume-1']) for (const interrupted of [false, true]) test(`current ${source} file changes block ${interrupted ? 'recovery' : 'commit'} without replacing external text`, async t => {
  const f = await stageFixture(t), plan = await f.prepare()
  const db = (await f.factory.openExisting(f.project.path))!
  const stage = db.formalOutlines().find(o => o.legacyKey === (source === 'stage' ? `stage-${f.stage}` : source))!
  db.close()
  if (interrupted) {
    const raw = new DatabaseSync(f.path)
    raw.exec("CREATE TRIGGER stage_failure BEFORE INSERT ON manuscript_file_commits BEGIN SELECT RAISE(ABORT,'injected'); END"); raw.close()
    await assert.rejects(f.planning.commitChapterEvent(plan.root, plan.command), { code: 'STORAGE_ERROR' })
    const clear = new DatabaseSync(f.path); clear.exec('DROP TRIGGER stage_failure'); clear.close()
  }
  const path = join(f.project.path, stage.mirrorRelativePath)
  await writeFile(path, '外部修改的阶段约束')
  const check = (await f.factory.openExisting(f.project.path))!
  try {
    assert.throws(() => interrupted ? check.recoverChapterEvent(plan.command.operationId) : check.adoptChapterEvent(plan.command), { code: 'CONFLICT' })
    assert.equal(check.listCanonicalEvents().length, 0)
  } finally { check.close() }
  assert.equal(await readFile(path, 'utf8'), '外部修改的阶段约束')
  assert.equal(new ManuscriptCommitJournal(f.project.path).pending().length, interrupted ? 1 : 0)
})

test('multiple selected events share one chapter origin and order update without self-staleness', async t => {
  const f = await stageFixture(t)
  const orderBefore = (await f.projection.read()).state.order.revision
  const plan = await f.planning.prepareChapterEvent(f.chapter, 1, f.entry.title, body, batch)
  const identities = chapterEventItems(plan.command).map(e => ({ eventId: e.eventId, eventVersionId: e.eventVersionId }))
  const result = await f.planning.commitChapterEvent(plan.root, plan.command)
  assert.deepEqual(chapterEventOutputItems(result.output), identities)
  const db = (await f.factory.openExisting(f.project.path))!
  try {
    const outline = db.formalOutlines().find(o => o.legacyKey === `chapter-${f.chapter}`)!
    assert.equal(outline.parentLegacyKey, `stage-${f.stage}`)
    assert.equal(db.listCanonicalEvents().length, 2)
    for (const id of identities) {
      const versions = db.listCanonicalEventVersions(id.eventId)
      assert.equal(versions.length, 1)
      assert.equal(versions[0].sources[0].source.revision, outline.currentVersionId)
    }
    const stored = JSON.parse(db.outlinePlanningState().content)
    assert.deepEqual(stored.chapters[0].sources.events, identities.map(e => ({ id: e.eventId, revision: e.eventVersionId })).sort((a, b) => a.id.localeCompare(b.id)))
    assert.equal(stored.chapterEventOutputs.length, 1)
    assert.deepEqual(db.adoptChapterEvent(plan.command), result.output)
    assert.throws(() => assertChapterEventOutputs([{ ...result.output, additionalEvents: [identities[0]] }]))
    const rewritten = structuredClone(stored)
    rewritten.chapterEventOutputs[0].additionalEvents = []
    const serialized = JSON.stringify(rewritten)
    assert.throws(() => db.replaceOutlinePlanningState(eventReceiptHash(JSON.stringify(stored)), serialized, eventReceiptHash(serialized)))
  } finally { db.close() }
  const projection = await f.projection.read()
  assert.equal(projection.state.order.revision, orderBefore + 1)
  assert.deepEqual(projection.state.order.eventIds, identities.map(e => e.eventId))
  assert.equal((await f.planning.status(f.chapter)).chapter?.stale, false)
  assert.equal((await f.planning.inspectFormalSkeleton([f.entry], 1)).entries[0].status, 'current')
  const edit = await f.operations.preview({ kind: 'edit', eventId: identities[1].eventId, expectedVersionId: identities[1].eventVersionId,
    expectedLifecycleId: projection.state.lifecycles.find(l => l.eventId === identities[1].eventId)!.id,
    expectedOrderId: projection.state.order.id, granularity: 'chapter-detail', content: { ...batch[1], result: '证人改变说法' } })
  await f.operations.commit(edit.token)
  assert.equal((await f.planning.status(f.chapter)).chapter?.stale, true)
  assert.equal((await f.planning.inspectFormalSkeleton([f.entry], 1)).entries[0].status, 'current')
})

test('failure on the second event rolls back the whole batch before touching the chapter file', async t => {
  const f = await stageFixture(t), plan = await f.planning.prepareChapterEvent(f.chapter, 1, f.entry.title, body, batch)
  const before = (await f.documents.chapterOutline(f.chapter)).content
  const raw = new DatabaseSync(f.path)
  raw.exec(`CREATE TRIGGER batch_failure BEFORE INSERT ON canonical_event_versions WHEN NEW.event_id='${plan.command.additionalEvents![0].eventId}' BEGIN SELECT RAISE(ABORT,'second event failure'); END`)
  raw.close()
  await assert.rejects(f.planning.commitChapterEvent(plan.root, plan.command))
  assert.equal((await f.documents.chapterOutline(f.chapter)).content, before)
  assert.equal((await f.projection.read()).approved.length, 0)
  assert.equal(new ManuscriptCommitJournal(f.project.path).pending().length, 0)
})

test('interrupted batch recovers all event identities exactly once and validates every receipt origin', async t => {
  const f = await stageFixture(t), plan = await f.planning.prepareChapterEvent(f.chapter, 1, f.entry.title, body, batch)
  const raw = new DatabaseSync(f.path)
  raw.exec("CREATE TRIGGER batch_failure BEFORE INSERT ON manuscript_file_commits BEGIN SELECT RAISE(ABORT,'injected'); END"); raw.close()
  await assert.rejects(f.planning.commitChapterEvent(plan.root, plan.command))
  assert.equal((await f.projection.read()).approved.length, 0)
  assert.equal(new ManuscriptCommitJournal(f.project.path).pending().length, 1)
  const clear = new DatabaseSync(f.path); clear.exec('DROP TRIGGER batch_failure'); clear.close()
  const result = await f.planning.recoverChapterEvent(plan.command.operationId)
  assert.equal(chapterEventOutputItems(result.output).length, 2)
  assert.deepEqual((await f.planning.recoverChapterEvent(plan.command.operationId)).output, result.output)
  assert.equal((await f.projection.read()).approved.length, 2)
  assert.equal((await f.planning.status(f.chapter)).chapter?.stale, false)
  const corrupt = new DatabaseSync(f.path)
  const row = corrupt.prepare('SELECT content_json FROM outline_planning_state_documents').get()!
  const value = JSON.parse(String(row.content_json))
  value.chapterEventOutputs[0].additionalEvents[0].eventVersionId = randomUUID()
  const content = JSON.stringify(value)
  corrupt.prepare('UPDATE outline_planning_state_documents SET content_json=?,content_hash=?').run(content, eventReceiptHash(content)); corrupt.close()
  const db = (await f.factory.openExisting(f.project.path))!
  try { assert.throws(() => db.outlinePlanningState(), { code: 'DATABASE_INTEGRITY_FAILED' }) } finally { db.close() }
})

test('natural chapter joint commit and interrupted recovery preserve the exact writing constraints', async t => {
  const f = await fixture(t)
  const story = '林舟拿着旧信来到档案室。管理员让他对照登记簿，他发现落款不同，决定寻找当年的管理员。'
  const constraints = { entryState: '林舟持信来到档案室', beats: ['管理员递出登记簿。', '林舟核对落款，发现不同。'], exitState: '林舟决定寻找当年的管理员。', allowedFacts: ['核对登记簿的动作'], forbiddenEvents: ['提前揭示真凶'], foreshadowActions: [] }
  const plan = await f.planning.prepareChapterEvent(f.chapter, 1, f.entry.title, story, event, constraints)
  const raw = new DatabaseSync(f.path)
  raw.exec("CREATE TRIGGER story_binding_failure BEFORE INSERT ON manuscript_file_commits BEGIN SELECT RAISE(ABORT,'injected'); END"); raw.close()
  await assert.rejects(f.planning.commitChapterEvent(plan.root, plan.command), { code: 'STORAGE_ERROR' })
  assert.equal((await f.planning.status(f.chapter)).chapter?.review.canConfirm, false)
  const clear = new DatabaseSync(f.path); clear.exec('DROP TRIGGER story_binding_failure'); clear.close()
  await f.planning.recoverChapterEvent(plan.command.operationId)
  assert.equal((await f.documents.chapterOutline(f.chapter)).content, story)
  assert.equal((await f.planning.status(f.chapter)).chapter?.review.canConfirm, true)
  await f.planning.confirmChapterOutline(f.chapter)
  assert.deepEqual((await f.planning.status(f.chapter)).chapter?.contractVersion?.storyConstraints, constraints)
  await f.planning.recoverChapterEvent(plan.command.operationId)
  const db = (await f.factory.openExisting(f.project.path))!
  assert.equal(db.listCanonicalEventVersions(plan.command.eventId).length, 1)
  assert.equal(JSON.parse(db.outlinePlanningState().content).chapterStoryContracts.length, 1)
  db.close()
})

test('joint adoption persists file, exact event origin and dependencies without self-staleness; retry is idempotent', async t => {
  const f = await fixture(t), plan = await f.prepare()
  const result = await f.planning.commitChapterEvent(plan.root, plan.command)
  assert.equal(result.output.eventId, plan.command.eventId)
  assert.equal((await f.documents.chapterOutline(f.chapter)).content, body)
  const db = (await f.factory.openExisting(f.project.path))!
  try {
    const version = db.listCanonicalEventVersions(result.output.eventId)[0]
    assert.equal(version.phase, 'planned'); assert.equal(version.granularity, 'chapter-detail')
    assert.equal(version.sources[0].source.revision, db.formalOutlines().find(o => o.legacyKey === `chapter-${f.chapter}`)!.currentVersionId)
    assert.deepEqual(db.adoptChapterEvent(plan.command), result.output)
    assert.equal(db.listCanonicalEventVersions(result.output.eventId).length, 1)
    const state = JSON.parse(db.outlinePlanningState().content)
    assert.equal(state.chapters[0].sources.events[0].revision, version.id)
    assert.throws(() => db.replaceOutlinePlanningState(db.outlinePlanningState().contentHash, JSON.stringify({ ...state, chapterEventOutputs: [] }), eventReceiptHash(JSON.stringify({ ...state, chapterEventOutputs: [] }))), { code: 'INVALID_PROJECT_STATE' })
  } finally { db.close() }
  assert.equal((await f.planning.inspectFormalSkeleton([f.entry], 1)).entries[0].status, 'current')
  assert.equal((await f.planning.status(f.chapter)).chapter?.stale, false)
})

test('stale source rejects the whole operation before creating an event', async t => {
  const f = await fixture(t), plan = await f.prepare()
  await f.planning.updateOutline('total', '上游已经修改，不应采用过期章纲。')
  await assert.rejects(f.planning.commitChapterEvent(plan.root, plan.command), { code: 'CONFLICT' })
  const db = (await f.factory.openExisting(f.project.path))!
  try { assert.equal(db.listCanonicalEvents().some(e => e.id === plan.command.eventId), false) } finally { db.close() }
})

test('existing chapter revision, external edits and queued book guards reject without partial event writes', async t => {
  const f = await fixture(t)
  await f.planning.updateChapterOutline(f.chapter, '原有章纲')
  const plan = await f.prepare()
  const db = (await f.factory.openExisting(f.project.path))!
  const target = join(f.project.path, db.formalOutlines().find(o => o.legacyKey === `chapter-${f.chapter}`)!.mirrorRelativePath)
  db.close()
  await writeFile(target, '外部作者修改的章纲')
  await assert.rejects(f.planning.commitChapterEvent(plan.root, plan.command), { code: 'CONFLICT' })
  assert.equal(await readFile(target, 'utf8'), '外部作者修改的章纲')
  await assert.rejects(f.planning.commitChapterEvent(plan.root, plan.command, async () => { throw new Error('book generation changed') }), /book generation changed/)
  const check = (await f.factory.openExisting(f.project.path))!
  try { assert.equal(check.listCanonicalEvents().length, 0) } finally { check.close() }
})

test('interrupted replacement of an existing outline recovers its original expected revision', async t => {
  const f = await fixture(t)
  await f.planning.updateChapterOutline(f.chapter, '原有章纲')
  const plan = await f.prepare()
  const raw = new DatabaseSync(f.path)
  raw.exec("CREATE TRIGGER joint_test_failure BEFORE INSERT ON manuscript_file_commits BEGIN SELECT RAISE(ABORT,'injected'); END"); raw.close()
  await assert.rejects(f.planning.commitChapterEvent(plan.root, plan.command), { code: 'STORAGE_ERROR' })
  const clear = new DatabaseSync(f.path); clear.exec('DROP TRIGGER joint_test_failure'); clear.close()
  const result = await f.planning.recoverChapterEvent(plan.command.operationId)
  assert.equal(result.output.eventVersionId, plan.command.eventVersionId)
  assert.equal((await f.documents.chapterOutline(f.chapter)).content, body)
  assert.equal((await f.planning.status(f.chapter)).chapter?.stale, false)
})

test('file replacement before SQL failure replays the same joint command exactly once', async t => {
  const f = await fixture(t), plan = await f.prepare()
  const raw = new DatabaseSync(f.path)
  raw.exec("CREATE TRIGGER joint_test_failure BEFORE INSERT ON manuscript_file_commits BEGIN SELECT RAISE(ABORT,'injected'); END")
  raw.close()
  await assert.rejects(f.planning.commitChapterEvent(plan.root, plan.command), { code: 'STORAGE_ERROR' })
  const journal = new ManuscriptCommitJournal(f.project.path)
  assert.equal(journal.pending().length, 1)
  assert.equal(await readFile(join(f.project.path, journal.pending()[0].files[0].relativePath), 'utf8'), body)
  const clear = new DatabaseSync(f.path); clear.exec('DROP TRIGGER joint_test_failure'); clear.close()
  const db = (await f.factory.openExisting(f.project.path))!
  try {
    assert.equal(db.listCanonicalEvents().some(e => e.id === plan.command.eventId), false)
    assert.equal(db.recoverChapterEvent(plan.command.operationId).eventId, plan.command.eventId)
    db.recoverManuscriptCommits()
    assert.equal(journal.pending().length, 0)
    assert.equal(db.listCanonicalEventVersions(plan.command.eventId).length, 1)
    assert.equal(db.adoptChapterEvent(plan.command).eventVersionId, plan.command.eventVersionId)
  } finally { db.close() }
})

test('later event edit stales the consuming chapter while its upstream skeleton stays current', async t => {
  const f = await fixture(t), plan = await f.prepare()
  await f.planning.commitChapterEvent(plan.root, plan.command)
  const state = (await f.projection.read()).state
  const preview = await f.operations.preview({ kind: 'edit', eventId: plan.command.eventId, expectedVersionId: plan.command.eventVersionId,
    expectedLifecycleId: state.lifecycles[0].id, expectedOrderId: state.order.id, granularity: 'chapter-detail', content: { ...event, result: '发现另一处落款' } })
  await f.operations.commit(preview.token)
  assert.equal((await f.planning.status(f.chapter)).chapter?.stale, true)
  assert.equal((await f.planning.inspectFormalSkeleton([f.entry], 1)).entries[0].status, 'current')
})

async function packageFixture(t: TestContext) {
  const f = await fixture(t)
  let now = Date.now()
  const packages = new PlanningPackageService(f.projects, f.planning, f.documents, () => new Date(now))
  const proposal = {
    id: 'joint-candidate', workItemId: (await f.projects.currentSummary()).id, createdAt: new Date().toISOString(),
    basedOn: { inputFingerprint: eventReceiptHash('input'), blueprintFingerprint: eventReceiptHash('blueprint'), totalOutlineFingerprint: eventReceiptHash('total') },
    blueprint: { premise: '核对旧信', worldView: '旧城', characters: [{ name: '林舟', role: '调查者', arcSeed: '找出真相' }], powerSystem: '', cheatSystem: '', rationale: '因果调查' },
    totalOutline: { title: '旧信', summary: '核对落款', content: '林舟因为收到旧信而展开调查，因此发现矛盾，最终找出真相。' },
    volumes: [{ order: 1, title: '旧城', goal: '寻找证人', summary: '林舟发现落款矛盾，因此寻找证人，最后找到线索。', ending: '找到新落款' }]
  }
  await packages.save(proposal)
  await f.planning.updateOutline('total', renderPlanningTotalOutline(proposal))
  const confirm = async (scope: 'total' | number) => {
    const s = await f.planning.status(), review = scope === 'total' ? s.totalReview : s.volumes[0].review
    if (review.status === 'attention') await f.planning.acknowledgeOutlineReview(scope)
    await f.planning.confirmPlanningOutline(scope)
  }
  await confirm('total')
  await f.planning.updateOutline(1, renderPlanningVolumeOutline(proposal.volumes[0]))
  await confirm(1)
  const status = await f.planning.status(), stamp = new Date().toISOString()
  // Seed already-reviewed upstream receipts; foundation adoption is covered separately.
  const seed = { ...proposal, adoption: {
    totalOutline: { fingerprint: eventReceiptHash(renderPlanningTotalOutline(proposal)), adoptedAt: stamp, revision: status.totalRevision },
    volumeStructure: { fingerprint: eventReceiptHash(renderPlanningVolumeStructure(proposal)), initializedAt: stamp, totalRevision: status.totalRevision },
    volumeOutlines: [{ order: 1, fingerprint: eventReceiptHash(renderPlanningVolumeOutline(proposal.volumes[0])), adoptedAt: stamp,
      revision: status.volumes[0].revision, totalFingerprint: status.totalApproval.fingerprint }]
  } }
  await writeFile(join(f.project.path, '.webnovel/planning/automatic-planning-draft.json'), JSON.stringify({ version: 1, proposal: seed, updatedAt: stamp }))
  const saved = (await packages.get())!
  saved.chapterSkeleton = { generatedAt: new Date().toISOString(), targetWordsPerChapter: 2000,
    basedOn: { totalOutlineFingerprint: eventReceiptHash(renderPlanningTotalOutline(saved)), volumePlanFingerprint: eventReceiptHash(renderPlanningVolumePlan(saved)) }, chapters: [f.entry] }
  await packages.save(saved)
  await packages.adoptFormalSkeleton((await packages.previewFormalSkeleton(saved.id, 1)).token)
  const formalSkeletonFingerprint = await packages.assertFormalSkeletonForDetails(saved.id, 1)
  await packages.storeChapterDetail(saved.id, { volume: 1, generatedAt: new Date().toISOString(), basedOn: {
    totalOutlineFingerprint: eventReceiptHash(renderPlanningTotalOutline(saved)), volumeOutlineFingerprint: eventReceiptHash(renderPlanningVolumeOutline(saved.volumes[0])),
    skeletonFingerprint: eventReceiptHash(renderPlanningChapterSkeletonVolume(saved, 1)), formalSkeletonFingerprint },
    chapters: [{ chapter: f.chapter, volume: 1, volumeChapter: 1, title: '核对', entryState: '收到来信', beats: ['核对落款', '寻找证人'], exitState: '发现矛盾', allowedFacts: ['旧城'], forbiddenEvents: ['禁止提前离城'], foreshadowActions: [] }] })
  return { ...f, packages, expire: () => { now += 300_001 } }
}

test('public preview is zero-write; one-use token commits the saved candidate and retains durable recovery', async t => {
  const f = await packageFixture(t)
  const before = (await f.authority.readOutlinePlanningState(f.project.path))!.content
  const preview = await f.packages.previewChapterEventAdoption('joint-candidate', f.chapter, draft)
  assert.equal((await f.authority.readOutlinePlanningState(f.project.path))!.content, before)
  planningIpcValueDecoders['planning:preview-chapter-event-adoption'](preview, 'result')
  const result = await f.packages.adoptChapterEvent(preview.token)
  planningIpcValueDecoders['planning:adopt-chapter-event'](result, 'result')
  await assert.rejects(f.packages.adoptChapterEvent(preview.token), { code: 'CONFLICT' })
  assert.equal((await f.packages.recoverChapterEvent(preview.operationId)).eventId, result.eventId)
  assert.equal((await f.packages.get())?.adoption?.chapterOutlines?.[0].chapter, f.chapter)
  assert.equal((await f.planning.status(f.chapter)).chapter?.stale, false)
})

test('expired and candidate-edited grants cannot adopt', async t => {
  const f = await packageFixture(t)
  const preview = await f.packages.previewChapterEventAdoption('joint-candidate', f.chapter, draft)
  f.expire()
  await assert.rejects(f.packages.adoptChapterEvent(preview.token), { code: 'CONFLICT' })
  const next = await f.packages.previewChapterEventAdoption('joint-candidate', f.chapter, draft)
  const candidate = (await f.packages.get())!
  candidate.chapterDetails![0].chapters[0].beats[0] = '作者修改后的节拍'
  await f.packages.save(candidate)
  await assert.rejects(f.packages.adoptChapterEvent(next.token), { code: 'CONFLICT' })
  assert.equal((await f.projection.read()).approved.length, 0)
})

test('public batch preview and recovery return every event while stale grants reject the whole batch', async t => {
  const f = await packageFixture(t)
  const drafts = batch.map(({ evidenceRefs: ignored, confidence: unused, ...value }) => value)
  const before = (await f.authority.readOutlinePlanningState(f.project.path))!.content
  const stale = await f.packages.previewChapterEventAdoption('joint-candidate', f.chapter, drafts)
  assert.equal(stale.events?.length, 2)
  assert.equal((await f.authority.readOutlinePlanningState(f.project.path))!.content, before)
  f.expire()
  await assert.rejects(f.packages.adoptChapterEvent(stale.token), { code: 'CONFLICT' })
  assert.equal((await f.projection.read()).approved.length, 0)
  const preview = await f.packages.previewChapterEventAdoption('joint-candidate', f.chapter, drafts)
  planningIpcValueDecoders['planning:preview-chapter-event-adoption'](preview, 'result')
  assert.throws(() => planningIpcValueDecoders['planning:preview-chapter-event-adoption']({ ...preview, events: [...drafts].reverse() }, 'result'))
  const result = await f.packages.adoptChapterEvent(preview.token)
  assert.equal(result.events?.length, 2)
  planningIpcValueDecoders['planning:adopt-chapter-event'](result, 'result')
  assert.deepEqual((await f.packages.recoverChapterEvent(preview.operationId)).events, result.events)
  assert.throws(() => planningIpcValueDecoders['planning:adopt-chapter-event']({ ...result, events: [result.events![0], result.events![0]] }, 'result'))
  assert.throws(() => planningIpcValueDecoders['planning:adopt-chapter-event']({ ...result, events: [result.events![0], {}] }, 'result'))
  assert.throws(() => planningIpcValueDecoders['planning:adopt-chapter-event']({ ...result, events: [...result.events!].reverse() }, 'result'))
})

test('joint IPC rejects unknown authority, absent time, duplicate characters and malformed success', () => {
  const valid = { time: '午后', characters: ['林舟'], location: '旧城', event: '核对', result: '找到落款' }
  for (const bad of [{ ...valid, creator: 'author' }, { ...valid, time: '' }, { ...valid, characters: ['林舟', '林舟'] }]) {
    assert.throws(() => decodeChapterEventAdoptionArgs(['candidate', 1, bad]), { code: 'VALIDATION_ERROR' })
  }
  assert.throws(() => planningIpcValueDecoders['planning:adopt-chapter-event']({ chapterId: 1, eventId: 'event', eventVersionId: 'v', mirrorsPending: 'false' }, 'result'))
  for (const bad of [[], Array.from({ length: 21 }, (_, i) => ({ ...valid, event: `事件${i}` })), [valid, valid], [valid, { ...valid, time: '' }], [valid, { ...valid, creator: 'author' }]]) {
    assert.throws(() => decodeChapterEventAdoptionArgs(['candidate', 1, bad]), { code: 'VALIDATION_ERROR' })
  }
  assert.equal((decodeChapterEventAdoptionArgs(['candidate', 1, Array.from({ length: 20 }, (_, i) => ({ ...valid, event: `事件${i}` }))])[2] as unknown[]).length, 20)
})

test('recovery preserves a later external manuscript edit', async t => {
  const f = await fixture(t), plan = await f.prepare()
  const raw = new DatabaseSync(f.path); raw.exec("CREATE TRIGGER joint_test_failure BEFORE INSERT ON manuscript_file_commits BEGIN SELECT RAISE(ABORT,'injected'); END"); raw.close()
  await assert.rejects(f.planning.commitChapterEvent(plan.root, plan.command))
  const journal = new ManuscriptCommitJournal(f.project.path), target = join(f.project.path, journal.pending()[0].files[0].relativePath)
  await writeFile(target, '外部作者保留稿')
  const clear = new DatabaseSync(f.path); clear.exec('DROP TRIGGER joint_test_failure'); clear.close()
  const db = (await f.factory.openExisting(f.project.path))!
  try { assert.throws(() => db.recoverManuscriptCommits(), { code: 'CONFLICT' }); assert.equal(db.listCanonicalEvents().some(e => e.id === plan.command.eventId), false) } finally { db.close() }
  assert.equal(await readFile(target, 'utf8'), '外部作者保留稿')
})


test('refinement preserves its exact parent and writes every child source with the chapter atomically', async t => {
  const f = await packageFixture(t)
  const parent = await f.packages.adoptChapterEvent((await f.packages.previewChapterEventAdoption('joint-candidate', f.chapter, draft)).token)
  const refines = { eventId: parent.eventId, eventVersionId: parent.eventVersionId }
  const before = await f.projection.read()
  const preview = await f.packages.previewChapterEventAdoption('joint-candidate', f.chapter, [
    { ...draft, event: '核对邮戳字形', refines }, { ...draft, event: '核对墨迹颜色', refines }
  ])
  assert.deepEqual(preview.events!.map(e => e.refines), [refines, refines])
  planningIpcValueDecoders['planning:preview-chapter-event-adoption'](preview, 'result')
  const result = await f.packages.adoptChapterEvent(preview.token)
  assert.deepEqual((await f.packages.recoverChapterEvent(preview.operationId)).events, result.events)
  const db = (await f.factory.openExisting(f.project.path))!
  try {
    assert.equal(db.listCanonicalEventVersions(parent.eventId).length, 1)
    assert.equal(db.canonicalEventVersionHeads(parent.eventId)!.approvedVersionId, parent.eventVersionId)
    for (const child of result.events!) {
      const version = db.listCanonicalEventVersions(child.eventId)[0]
      assert.equal(version.sources.length, 2)
      assert.deepEqual(version.sources[1], { relation: 'refines', source: { kind: 'event', id: parent.eventId, revision: parent.eventVersionId } })
      assert.equal(version.sources[0].source.revision, db.formalOutlines().find(o => o.legacyKey === `chapter-${f.chapter}`)!.currentVersionId)
    }
  } finally { db.close() }
  const current = await f.projection.read()
  assert.equal(current.approved.length, 3); assert.equal(current.state.order.revision, before.state.order.revision + 1)
  assert.equal((await f.planning.status(f.chapter)).chapter?.stale, false)
  assert.equal((await f.planning.inspectFormalSkeleton([f.entry], 1)).entries[0].status, 'current')
  const change = await f.operations.preview({ kind: 'edit', eventId: parent.eventId, expectedVersionId: parent.eventVersionId,
    expectedLifecycleId: current.state.lifecycles.find(l => l.eventId === parent.eventId)!.id,
    expectedOrderId: current.state.order.id, granularity: 'chapter-detail', content: { ...event, result: '来源内容已修订' } })
  await f.operations.commit(change.token)
  assert.equal((await f.planning.status(f.chapter)).chapter?.stale, true)
  const after = await f.projection.read()
  assert.ok(after.approved.filter(e => e.eventId !== parent.eventId).every(e => e.sources[1].source.revision === parent.eventVersionId))
})

for (const interrupted of [false, true]) test(`refinement rejects changed parent during ${interrupted ? 'recovery' : 'commit'} without child writes`, async t => {
  const f = await fixture(t), initial = await f.prepare()
  const parent = (await f.planning.commitChapterEvent(initial.root, initial.command)).output
  const refines = { eventId: parent.eventId, eventVersionId: parent.eventVersionId }
  const plan = await f.planning.prepareChapterEvent(f.chapter, 1, f.entry.title, body + '\n细化核对过程', { ...event, refines })
  if (interrupted) {
    const raw = new DatabaseSync(f.path)
    raw.exec("CREATE TRIGGER refinement_failure BEFORE INSERT ON manuscript_file_commits BEGIN SELECT RAISE(ABORT,'injected'); END"); raw.close()
    await assert.rejects(f.planning.commitChapterEvent(plan.root, plan.command))
  }
  const raw = new DatabaseSync(f.path)
  if (interrupted) raw.exec('DROP TRIGGER refinement_failure')
  const projectId = String(raw.prepare('SELECT id FROM projects').get()!.id)
  new CanonicalEventVersions(raw, projectId, randomUUID).append(parent.eventId, parent.eventVersionId,
    { content: event, status: 'approved', phase: 'planned', granularity: 'chapter-detail', creator: 'author', sources: [] }, new Date().toISOString())
  raw.close()
  if (interrupted) {
    const db = (await f.factory.openExisting(f.project.path))!
    try { assert.throws(() => db.recoverManuscriptCommits(), { code: 'CONFLICT' }) } finally { db.close() }
  } else await assert.rejects(f.planning.commitChapterEvent(plan.root, plan.command), { code: 'CONFLICT' })
  assert.equal((await f.projection.read()).approved.length, 1)
  assert.equal(new ManuscriptCommitJournal(f.project.path).pending().length, interrupted ? 1 : 0)
})

test('refinement rejects unrelated, stale and non-planned parent and recovers unchanged source exactly once', async t => {
  const f = await fixture(t), initial = await f.prepare()
  const parent = (await f.planning.commitChapterEvent(initial.root, initial.command)).output
  const refines = { eventId: parent.eventId, eventVersionId: parent.eventVersionId }
  for (const source of [{ ...refines, eventId: randomUUID() }, { ...refines, eventVersionId: randomUUID() }]) {
    await assert.rejects(f.planning.prepareChapterEvent(f.chapter, 1, f.entry.title, body, { ...event, refines: source }), { code: 'CONFLICT' })
  }
  const plan = await f.planning.prepareChapterEvent(f.chapter, 1, f.entry.title, body + '\n细化', batch.map(e => ({ ...e, refines })))
  const raw = new DatabaseSync(f.path)
  raw.exec("CREATE TRIGGER refinement_failure BEFORE INSERT ON manuscript_file_commits BEGIN SELECT RAISE(ABORT,'injected'); END"); raw.close()
  await assert.rejects(f.planning.commitChapterEvent(plan.root, plan.command))
  assert.equal((await f.projection.read()).approved.length, 1)
  const clear = new DatabaseSync(f.path); clear.exec('DROP TRIGGER refinement_failure'); clear.close()
  const result = await f.planning.recoverChapterEvent(plan.command.operationId)
  assert.deepEqual((await f.planning.recoverChapterEvent(plan.command.operationId)).output, result.output)
  const recovered = await f.projection.read()
  assert.equal(recovered.approved.length, 3)
  assert.ok(recovered.approved.filter(e => e.eventId !== parent.eventId).every(e => e.sources.some(s => s.relation === 'refines' && s.source.revision === parent.eventVersionId)))
  const phase = new DatabaseSync(f.path), projectId = String(phase.prepare('SELECT id FROM projects').get()!.id)
  const actual = new CanonicalEventVersions(phase, projectId, randomUUID).append(parent.eventId, parent.eventVersionId,
    { content: event, status: 'approved', phase: 'legacy-unknown', granularity: 'chapter-detail', creator: 'author', sources: [] }, new Date().toISOString())
  phase.close()
  const actualSource = { eventId: parent.eventId, eventVersionId: actual.id }
  await assert.rejects(f.planning.prepareChapterEvent(f.chapter, 1, f.entry.title, body, { ...event, refines: actualSource }), { code: 'CONFLICT' })
  const independent = await f.prepare()
  independent.command.refines = actualSource
  await assert.rejects(f.planning.commitChapterEvent(independent.root, independent.command), { code: 'CONFLICT' })
  assert.equal((await f.projection.read()).approved.length, 3)
})

test('refinement source decoder accepts only bounded exact source selection and validates preview sources', () => {
  const refines = { eventId: 'migrated:parent', eventVersionId: randomUUID() }
  assert.deepEqual((decodeChapterEventAdoptionArgs(['candidate', 1, { ...draft, refines }])[2] as typeof draft & { refines: unknown }).refines, refines)
  for (const source of [null, {}, [], { ...refines, eventId: '' }, { ...refines, eventId: 'x'.repeat(201) }, { ...refines, eventVersionId: 'latest' }, { ...refines, relation: 'supersedes' }]) {
    assert.throws(() => decodeChapterEventAdoptionArgs(['candidate', 1, { ...draft, refines: source }]), { code: 'VALIDATION_ERROR' })
  }
  const preview = { token: randomUUID(), operationId: randomUUID(), proposalId: 'candidate', chapterId: 1, chapterContent: body, replacesChapter: true, existingEventCount: 1,
    event: { ...draft, refines }, events: [{ ...draft, refines }, { ...draft, event: '第二项', refines }] }
  planningIpcValueDecoders['planning:preview-chapter-event-adoption'](preview, 'result')
  assert.throws(() => planningIpcValueDecoders['planning:preview-chapter-event-adoption']({ ...preview, events: [preview.event, { ...draft, refines: { ...refines, eventVersionId: 'latest' } }] }, 'result'))
})

test('replacement mixes with new and refined events, preserves identity/history and remains current', async t => {
  const f = await packageFixture(t)
  const parent = await f.packages.adoptChapterEvent((await f.packages.previewChapterEventAdoption('joint-candidate', f.chapter, draft)).token)
  const refines = { eventId: parent.eventId, eventVersionId: parent.eventVersionId }
  const child = await f.packages.adoptChapterEvent((await f.packages.previewChapterEventAdoption('joint-candidate', f.chapter, { ...draft, event: '逐笔核对落款', refines })).token)
  const before = await f.projection.read(), replaces = { eventId: child.eventId, eventVersionId: child.eventVersionId }
  const comparison = await f.packages.previewChapterEvents('joint-candidate', f.chapter)
  assert.equal(comparison.formalEvents.find(e => e.id === child.eventId)!.replaceable, true)
  planningIpcValueDecoders['planning:preview-chapter-events'](comparison, 'result')
  const ledger = (await f.authority.readOutlinePlanningState(f.project.path))!.content
  const preview = await f.packages.previewChapterEventAdoption('joint-candidate', f.chapter, [
    { ...draft, event: '核对修改后的落款', replaces }, { ...draft, event: '查看信封' }, { ...draft, event: '检查邮戳', refines }
  ])
  assert.equal((await f.authority.readOutlinePlanningState(f.project.path))!.content, ledger)
  assert.deepEqual(preview.replacementImpact, { chapterIds: [], skeletonChapterIds: [] })
  planningIpcValueDecoders['planning:preview-chapter-event-adoption'](preview, 'result')
  const result = await f.packages.adoptChapterEvent(preview.token)
  assert.equal(result.eventId, child.eventId); assert.notEqual(result.eventVersionId, child.eventVersionId)
  planningIpcValueDecoders['planning:adopt-chapter-event'](result, 'result')
  assert.deepEqual((await f.packages.recoverChapterEvent(preview.operationId)).events, result.events)
  const after = await f.projection.read(), db = (await f.factory.openExisting(f.project.path))!
  try {
    const versions = db.listCanonicalEventVersions(child.eventId)
    assert.equal(versions.length, 2); assert.equal(versions[0].id, child.eventVersionId)
    assert.equal(versions[1].content.event, '核对修改后的落款')
    assert.deepEqual(versions[1].sources.slice(1), [
      { relation: 'supersedes', source: { kind: 'event', id: child.eventId, revision: child.eventVersionId } },
      { relation: 'refines', source: { kind: 'event', id: parent.eventId, revision: parent.eventVersionId } }
    ])
    assert.equal(db.listCanonicalEventVersions(parent.eventId).length, 1)
    const state = JSON.parse(db.outlinePlanningState().content)
    assert.equal(state.chapterEventOutputs.at(-1).replacesVersionId, child.eventVersionId)
    assert.equal(state.eventChapterPlacements.filter((p: {eventId: string}) => p.eventId === child.eventId).length, 1)
    assert.equal(state.chapters[0].sources.events.find((e: {id: string}) => e.id === child.eventId).revision, result.eventVersionId)
  } finally { db.close() }
  assert.equal(after.approved.length, 4)
  assert.deepEqual(after.state.order.eventIds.slice(0, 2), before.state.order.eventIds)
  assert.deepEqual(after.state.lifecycles.find(l => l.eventId === child.eventId), before.state.lifecycles.find(l => l.eventId === child.eventId))
  assert.equal((await f.planning.status(f.chapter)).chapter?.stale, false)
  assert.equal((await f.planning.inspectFormalSkeleton([f.entry], 1)).entries[0].status, 'current')
  const again = await f.packages.previewChapterEventAdoption('joint-candidate', f.chapter,
    { ...draft, event: '再次核实改写', replaces: { eventId: child.eventId, eventVersionId: result.eventVersionId } })
  await f.packages.adoptChapterEvent(again.token)
  const final = await f.projection.read()
  assert.deepEqual(final.state, after.state, 'replacement-only leaves lifecycle and display-order history untouched')
  assert.equal(final.approved.length, 4)
})

for (const interrupted of [false, true]) test(`replacement rejects a pending candidate during ${interrupted ? 'recovery' : 'commit'} without replacing the approved head`, async t => {
  const f = await fixture(t), initial = await f.prepare()
  const old = (await f.planning.commitChapterEvent(initial.root, initial.command)).output
  const replaces = { eventId: old.eventId, eventVersionId: old.eventVersionId }
  const plan = await f.planning.prepareChapterEvent(f.chapter, 1, f.entry.title, body + '\n核对新版', { ...event, result: '新版结果', replaces })
  if (interrupted) {
    const raw = new DatabaseSync(f.path)
    raw.exec("CREATE TRIGGER replacement_failure BEFORE INSERT ON manuscript_file_commits BEGIN SELECT RAISE(ABORT,'injected'); END"); raw.close()
    await assert.rejects(f.planning.commitChapterEvent(plan.root, plan.command))
  }
  const raw = new DatabaseSync(f.path)
  if (interrupted) raw.exec('DROP TRIGGER replacement_failure')
  const projectId = String(raw.prepare('SELECT id FROM projects').get()!.id)
  new CanonicalEventVersions(raw, projectId, randomUUID).append(old.eventId, old.eventVersionId,
    { content: { ...event, result: '尚未审阅的候选' }, status: 'candidate', phase: 'planned', granularity: 'chapter-detail', creator: 'author', sources: [] }, new Date().toISOString())
  raw.close()
  if (interrupted) {
    const db = (await f.factory.openExisting(f.project.path))!
    try { assert.throws(() => db.recoverManuscriptCommits(), { code: 'CONFLICT' }) } finally { db.close() }
  } else {
    await assert.rejects(f.planning.commitChapterEvent(plan.root, plan.command), { code: 'CONFLICT' })
    await assert.rejects(f.planning.prepareChapterEvent(f.chapter, 1, f.entry.title, body, { ...event, replaces }), { code: 'CONFLICT' })
  }
  const projected = await f.projection.read()
  assert.equal(projected.approved.length, 1); assert.equal(projected.approved[0].versionId, old.eventVersionId)
  assert.equal(new ManuscriptCommitJournal(f.project.path).pending().length, interrupted ? 1 : 0)
})

test('replacement mixed batch rolls back on later insert and recovers one original operation after file interruption', async t => {
  const f = await stageFixture(t), initial = await f.prepare()
  const old = (await f.planning.commitChapterEvent(initial.root, initial.command)).output
  const replaces = { eventId: old.eventId, eventVersionId: old.eventVersionId }
  const plan = await f.planning.prepareChapterEvent(f.chapter, 1, f.entry.title, body + '\n新版调查', [{ ...event, result: '新版结果', replaces }, batch[1]])
  const before = await f.projection.read(), chapterBefore = (await f.documents.chapterOutline(f.chapter)).content
  const raw = new DatabaseSync(f.path)
  raw.exec(`CREATE TRIGGER replacement_failure BEFORE INSERT ON canonical_event_versions WHEN NEW.event_id='${plan.command.additionalEvents![0].eventId}' BEGIN SELECT RAISE(ABORT,'later item'); END`); raw.close()
  await assert.rejects(f.planning.commitChapterEvent(plan.root, plan.command))
  assert.equal((await f.documents.chapterOutline(f.chapter)).content, chapterBefore)
  assert.deepEqual(await f.projection.read(), before)
  const trigger = new DatabaseSync(f.path)
  trigger.exec("DROP TRIGGER replacement_failure; CREATE TRIGGER replacement_failure BEFORE INSERT ON manuscript_file_commits BEGIN SELECT RAISE(ABORT,'metadata'); END"); trigger.close()
  await assert.rejects(f.planning.commitChapterEvent(plan.root, plan.command))
  assert.equal(new ManuscriptCommitJournal(f.project.path).pending().length, 1)
  assert.deepEqual(await f.projection.read(), before)
  const clear = new DatabaseSync(f.path); clear.exec('DROP TRIGGER replacement_failure'); clear.close()
  const recovered = await f.planning.recoverChapterEvent(plan.command.operationId)
  assert.equal(recovered.output.eventId, old.eventId)
  assert.deepEqual((await f.planning.recoverChapterEvent(plan.command.operationId)).output, recovered.output)
  const after = await f.projection.read()
  assert.equal(after.approved.length, 2)
  assert.equal(after.approved.find(e => e.eventId === old.eventId)!.content.result, '新版结果')
  assert.equal((await f.planning.status(f.chapter)).chapter?.stale, false)
  assert.equal((await f.documents.getPlannedChapter(f.chapter)).stage, f.stage)
  const db = (await f.factory.openExisting(f.project.path))!
  try { assert.equal(db.listCanonicalEventVersions(old.eventId).length, 2) } finally { db.close() }
})

test('replacement refuses foreign ownership and captures direct stale dependencies without rewriting them', async t => {
  const f = await fixture(t), initial = await f.prepare()
  const old = (await f.planning.commitChapterEvent(initial.root, initial.command)).output
  const other = (await f.documents.createChapter()).id, otherEntry = { ...f.entry, chapter: other, volumeChapter: 2 }
  await f.planning.placeChapter(other, 1)
  await f.planning.placeEventInChapter(old.eventId, other)
  const skeleton = await f.planning.inspectFormalSkeleton([f.entry, otherEntry], 1)
  await f.planning.adoptFormalSkeleton([f.entry, otherEntry], 1, skeleton.fingerprint)
  await f.planning.updateChapterOutline(other, '引用旧信事件的另一个章纲')
  const replaces = { eventId: old.eventId, eventVersionId: old.eventVersionId }
  assert.equal((await f.planning.inspectChapterEvents(other))[0].replaceable, false)
  await assert.rejects(f.planning.prepareChapterEvent(other, 1, '另一章', body, { ...event, replaces }), { code: 'CONFLICT' })
  await f.planning.placeEventInChapter(old.eventId, f.chapter)
  const before = (await f.documents.chapterOutline(other)).content
  const plan = await f.planning.prepareChapterEvent(f.chapter, 1, f.entry.title, body, { ...event, result: '本章修订结果', replaces })
  assert.deepEqual(plan.replacementImpact, { chapterIds: [other], skeletonChapterIds: [other] })
  await f.planning.commitChapterEvent(plan.root, plan.command)
  assert.equal((await f.documents.chapterOutline(other)).content, before)
  assert.equal((await f.planning.status(other)).chapter?.stale, true)
  assert.equal((await f.planning.status(f.chapter)).chapter?.stale, false)
})

test('replacement rejects archived/restored lifecycle drift even when content head is unchanged', async t => {
  const f = await fixture(t), initial = await f.prepare()
  const old = (await f.planning.commitChapterEvent(initial.root, initial.command)).output
  const replaces = { eventId: old.eventId, eventVersionId: old.eventVersionId }
  const plan = await f.planning.prepareChapterEvent(f.chapter, 1, f.entry.title, body, { ...event, replaces })
  const raw = new DatabaseSync(f.path), projectId = String(raw.prepare('SELECT id FROM projects').get()!.id)
  let previous = plan.command.expectedLifecycleId!
  for (const [revision, state] of [[2, 'archived'], [3, 'active']] as const) {
    const id = randomUUID()
    raw.prepare('INSERT INTO event_lifecycle_versions (id,project_id,event_id,revision,previous_id,expected_event_version_id,state,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, projectId, old.eventId, revision, previous, old.eventVersionId, state, new Date().toISOString())
    previous = id
  }
  raw.close()
  await assert.rejects(f.planning.commitChapterEvent(plan.root, plan.command), { code: 'CONFLICT' })
  assert.equal((await f.projection.read()).approved[0].versionId, old.eventVersionId)
})

test('replacement contracts reject conflicting selections and forged repeated receipt identities', () => {
  const replaces = { eventId: randomUUID(), eventVersionId: randomUUID() }
  for (const bad of [
    { ...draft, replaces: null }, { ...draft, replaces: { ...replaces, eventVersionId: 'latest' } },
    { ...draft, replaces, refines: replaces }, [{ ...draft, replaces }, { ...draft, event: '第二条', replaces }],
    [{ ...draft, replaces }, { ...draft, event: '细化旧版', refines: replaces }]
  ]) assert.throws(() => decodeChapterEventAdoptionArgs(['candidate', 1, bad]), { code: 'VALIDATION_ERROR' })
  const first = { operationId: randomUUID(), chapterId: 1, eventId: replaces.eventId, eventVersionId: replaces.eventVersionId, requestHash: eventReceiptHash('first') }
  const next = { ...first, operationId: randomUUID(), eventVersionId: randomUUID(), replacesVersionId: first.eventVersionId }
  assertChapterEventOutputs([first, next])
  assert.throws(() => assertChapterEventOutputs([next]))
  assert.throws(() => assertChapterEventOutputs([first, { ...next, chapterId: 2 }]))
  assert.throws(() => assertChapterEventOutputs([first, { ...next, replacesVersionId: undefined }]))
  assert.throws(() => assertChapterEventOutputs([first, { ...next, eventVersionId: first.eventVersionId }]))
  const preview = { token: randomUUID(), operationId: randomUUID(), proposalId: 'candidate', chapterId: 1, chapterContent: body,
    replacesChapter: true, existingEventCount: 1, event: { ...draft, replaces }, replacementImpact: { chapterIds: [2], skeletonChapterIds: [] } }
  planningIpcValueDecoders['planning:preview-chapter-event-adoption'](preview, 'result')
  assert.throws(() => planningIpcValueDecoders['planning:preview-chapter-event-adoption']({ ...preview, replacementImpact: { chapterIds: [2, 2], skeletonChapterIds: [] } }, 'result'))
})

test('replacement after a standalone edit retains all history and validates the exact receipt supersedes edge', async t => {
  const f = await fixture(t), initial = await f.prepare()
  const old = (await f.planning.commitChapterEvent(initial.root, initial.command)).output
  const state = (await f.projection.read()).state
  const edit = await f.operations.preview({ kind: 'edit', eventId: old.eventId, expectedVersionId: old.eventVersionId,
    expectedLifecycleId: state.lifecycles[0].id, expectedOrderId: state.order.id, granularity: 'chapter-detail', content: { ...event, result: '作者独立修改' } })
  await f.operations.commit(edit.token)
  const standalone = (await f.projection.read()).approved[0]
  const replaces = { eventId: old.eventId, eventVersionId: standalone.versionId }
  const plan = await f.planning.prepareChapterEvent(f.chapter, 1, f.entry.title, body, { ...event, result: '联合修订', replaces })
  await f.planning.commitChapterEvent(plan.root, plan.command)
  await assert.rejects(f.planning.prepareChapterEvent(f.chapter, 1, f.entry.title, body, { ...event, replaces }), { code: 'CONFLICT' })
  const db = (await f.factory.openExisting(f.project.path))!
  try { assert.equal(db.listCanonicalEventVersions(old.eventId).length, 3) } finally { db.close() }
  const raw = new DatabaseSync(f.path), row = raw.prepare('SELECT content_json FROM outline_planning_state_documents').get()!
  const ledger = JSON.parse(String(row.content_json))
  ledger.chapterEventOutputs.at(-1).replacesVersionId = old.eventVersionId
  const content = JSON.stringify(ledger)
  raw.prepare('UPDATE outline_planning_state_documents SET content_json=?,content_hash=?').run(content, eventReceiptHash(content)); raw.close()
  const corrupted = (await f.factory.openExisting(f.project.path))!
  try { assert.throws(() => corrupted.outlinePlanningState(), { code: 'DATABASE_INTEGRITY_FAILED' }) } finally { corrupted.close() }
})

test('replacement rejects a detail output whose approved granularity changed to macro', async t => {
  const f = await fixture(t), initial = await f.prepare()
  const old = (await f.planning.commitChapterEvent(initial.root, initial.command)).output
  const raw = new DatabaseSync(f.path), projectId = String(raw.prepare('SELECT id FROM projects').get()!.id)
  const macro = new CanonicalEventVersions(raw, projectId, randomUUID).append(old.eventId, old.eventVersionId,
    { content: event, status: 'approved', phase: 'planned', granularity: 'macro', creator: 'author', sources: [] }, new Date().toISOString())
  raw.close()
  assert.equal((await f.planning.inspectChapterEvents(f.chapter))[0].replaceable, false)
  await assert.rejects(f.planning.prepareChapterEvent(f.chapter, 1, f.entry.title, body,
    { ...event, replaces: { eventId: old.eventId, eventVersionId: macro.id } }), { code: 'CONFLICT' })
  const forged = await f.prepare()
  forged.command.eventId = old.eventId
  forged.command.replaces = { eventId: old.eventId, eventVersionId: macro.id }
  forged.command.expectedLifecycleId = (await f.projection.read()).state.lifecycles[0].id
  await assert.rejects(f.planning.commitChapterEvent(forged.root, forged.command), { code: 'CONFLICT' })
  assert.equal((await f.projection.read()).approved[0].versionId, macro.id)
})

async function upstreamFixture(t: TestContext) {
  const f = await packageFixture(t)
  const parent = await f.packages.adoptChapterEvent((await f.packages.previewChapterEventAdoption('joint-candidate', f.chapter, draft)).token)
  const child = await f.packages.adoptChapterEvent((await f.packages.previewChapterEventAdoption('joint-candidate', f.chapter,
    { ...draft, event: '逐笔核对落款', refines: { eventId: parent.eventId, eventVersionId: parent.eventVersionId } })).token)
  return { ...f, parent, child }
}

test('upstream review gates confirmation, persists exact author decisions and preserves history across restart', async t => {
  const f = await upstreamFixture(t)
  const before = (await f.authority.readOutlinePlanningState(f.project.path))!
  const s = await f.planning.status(f.chapter), finding = s.chapter!.review.upstream!.findings[0]
  assert.equal(finding.status, 'pending'); assert.equal(s.chapter!.review.canConfirm, false)
  assert.ok(s.chapter!.review.issues.some(i => i.code === 'UPSTREAM_REVIEW_REQUIRED'))
  assert.equal(s.chapter!.contractVersion, undefined)
  assert.equal((await f.authority.readOutlinePlanningState(f.project.path))!.content, before.content)
  await assert.rejects(f.planning.confirmChapterOutline(f.chapter), { code: 'CONFLICT' })
  const input = { workItemId: f.project.id, chapterId: f.chapter, fingerprint: finding.fingerprint, decision: 'no-conflict' as const, reason: '核对字形是核对旧信的具体步骤' }
  const resolved = await f.planning.decideUpstreamReview(input)
  assert.equal(resolved.chapter!.review.upstream!.findings[0].status, 'no-conflict')
  assert.equal(resolved.chapter!.review.canConfirm, true)
  const confirmed = await f.planning.confirmChapterOutline(f.chapter)
  assert.ok(confirmed.chapter!.contractVersion)
  const persisted = (await f.authority.readOutlinePlanningState(f.project.path))!
  await f.planning.decideUpstreamReview(input)
  assert.equal((await f.authority.readOutlinePlanningState(f.project.path))!.content, persisted.content)
  const restarted = new OutlinePlanningService(f.projects, f.documents, new ResearchLibraryService(f.projects, f.authority), f.authority, { read: () => f.projection.readForConsumer() })
  assert.equal((await restarted.status(f.chapter)).chapter!.review.upstream!.findings[0].decision!.reason, input.reason)
  const flagged = await restarted.decideUpstreamReview({ ...input, decision: 'needs-upstream-change', reason: '重新考虑，卷纲需要交代核对的动机' })
  assert.equal(flagged.chapter!.contractVersion, undefined)
  assert.equal(flagged.chapter!.review.canConfirm, false)
  assert.equal(flagged.chapter!.review.upstream!.history.length, 2)
  const current = (await f.authority.readOutlinePlanningState(f.project.path))!, doc = JSON.parse(current.content)
  doc.upstreamReviewDecisions.shift()
  await assert.rejects(f.authority.replaceOutlinePlanningState(f.project.path, current.contentHash, JSON.stringify(doc)), { code: 'CONFLICT' })
  assert.equal((await f.authority.readOutlinePlanningState(f.project.path))!.content, current.content)
  assert.equal((await f.projection.read()).approved.length, 2)
})

test('upstream review rejects stale chapter, event or book evidence without appending a decision', async t => {
  const f = await upstreamFixture(t), initial = (await f.planning.status(f.chapter)).chapter!.review.upstream!
  const input = { workItemId: f.project.id, chapterId: f.chapter, fingerprint: initial.findings[0].fingerprint, decision: 'no-conflict' as const, reason: '合理细化' }
  const before = (await f.authority.readOutlinePlanningState(f.project.path))!
  await assert.rejects(f.planning.decideUpstreamReview({ ...input, workItemId: 'another-book' }), { code: 'CONFLICT' })
  assert.equal((await f.authority.readOutlinePlanningState(f.project.path))!.content, before.content)
  await f.planning.decideUpstreamReview(input)
  const original = await f.documents.chapterOutline(f.chapter)
  await f.planning.updateChapterOutline(f.chapter, original.content + '\n补充核对的动机。')
  await assert.rejects(f.planning.decideUpstreamReview(input), { code: 'CONFLICT' })
  const changed = (await f.planning.status(f.chapter)).chapter!.review.upstream!
  assert.equal(changed.findings[0].status, 'pending'); assert.equal(changed.history.length, 1)
  const raw = new DatabaseSync(f.path), projectId = String(raw.prepare('SELECT id FROM projects').get()!.id)
  new CanonicalEventVersions(raw, projectId, randomUUID).append(f.parent.eventId, f.parent.eventVersionId,
    { content: event, status: 'approved', phase: 'planned', granularity: 'chapter-detail', creator: 'author', sources: [] }, new Date().toISOString())
  raw.close()
  await assert.rejects(f.planning.decideUpstreamReview({ ...input, fingerprint: changed.findings[0].fingerprint }), { code: 'CONFLICT' })
  const refreshed = (await f.planning.status(f.chapter)).chapter!.review.upstream!
  assert.notEqual(refreshed.findings[0].sourceVersion, refreshed.findings[0].provenanceRevision)
  assert.equal(refreshed.findings[0].status, 'pending'); assert.equal(refreshed.history.length, 1)
})

test('upstream review fingerprint ignores unrelated events and blocks unavailable sources', async t => {
  const f = await upstreamFixture(t), projection = await f.projection.read()
  const state = JSON.parse((await f.authority.readOutlinePlanningState(f.project.path))!.content)
  const input = { chapterId: f.chapter, outlineHash: state.chapters[0].outlineHash, sources: state.chapters[0].sources,
    eventIds: [f.child.eventId], approved: projection.approved, history: [] }
  const first = reviewRefinements(input)
  const unrelated = { ...projection.approved[0], eventId: randomUUID(), versionId: randomUUID(), sources: [] }
  assert.deepEqual(reviewRefinements({ ...input, approved: [...projection.approved, unrelated] }), first)
  assert.equal(reviewRefinements({ ...input, approved: projection.approved.filter(e => e.eventId !== f.parent.eventId) }).findings[0].status, 'blocked')
  assert.equal(reviewRefinements({ ...input, approved: projection.approved.map(e => e.eventId === f.parent.eventId ? { ...e, phase: 'realized' as const } : e) }).findings[0].status, 'blocked')
  assert.notEqual(reviewRefinements({ ...input, sources: { ...input.sources, total: 'a'.repeat(64) } }).findings[0].fingerprint, first.findings[0].fingerprint)
  assert.notEqual(reviewRefinements({ ...input, sources: { ...input.sources, stage: { id: 1, volume: 1, revision: 'b'.repeat(64) } } }).findings[0].fingerprint, first.findings[0].fingerprint)
  assert.throws(() => reviewRefinements({ ...input, history: [{ chapterId: f.chapter, eventId: 'wrong-event', sourceId: f.parent.eventId,
    fingerprint: first.findings[0].fingerprint, decision: 'no-conflict', reason: '损坏记录', decidedAt: new Date().toISOString() }] }), { code: 'INVALID_PROJECT_STATE' })
  const finding = first.findings[0]
  const record = { chapterId: f.chapter, eventId: finding.eventId, sourceId: finding.sourceId, fingerprint: finding.fingerprint,
    decision: 'no-conflict' as const, reason: '核对记录', decidedAt: new Date().toISOString(),
    evidence: { eventVersion: finding.eventVersion, sourceVersion: finding.sourceVersion!, provenanceRevision: finding.provenanceRevision, fields: finding.fields } }
  assert.equal(reviewRefinements({ ...input, history: [record] }).findings[0].status, 'no-conflict')
  assert.throws(() => reviewRefinements({ ...input, history: [{ ...record, evidence: { ...record.evidence, eventVersion: randomUUID() } }] }), { code: 'INVALID_PROJECT_STATE' })
  decodeChapterUpstreamReview(first)
  for (const value of [{ ...first, findings: [first.findings[0], first.findings[0]] }, { ...first, findings: [{ ...first.findings[0], status: 'no-conflict' }] }, { ...first, findings: [{ ...first.findings[0], fields: [] }] }]) assert.throws(() => decodeChapterUpstreamReview(value))
  const valid = { workItemId: f.project.id, chapterId: f.chapter, fingerprint: first.findings[0].fingerprint, decision: 'no-conflict', reason: '合理细化' }
  decodeUpstreamReviewArgs([valid])
  for (const bad of [{ ...valid, reason: '' }, { ...valid, chapterId: 0 }, { ...valid, fingerprint: 'latest' }, { ...valid, decision: 'accept' }, { ...valid, content: 'forge' }]) assert.throws(() => decodeUpstreamReviewArgs([bad]), { code: 'VALIDATION_ERROR' })
})


test('upstream history keeps exact comparison after event replacement and restart without fabricating legacy evidence', async t => {
  const f = await upstreamFixture(t), initial = (await f.planning.status(f.chapter)).chapter!.review.upstream!
  const finding = initial.findings[0]
  const input = { workItemId: f.project.id, chapterId: f.chapter, fingerprint: finding.fingerprint, decision: 'no-conflict' as const, reason: '旧记录只存理由' }
  const legacy = { chapterId: f.chapter, eventId: finding.eventId, sourceId: finding.sourceId, fingerprint: finding.fingerprint,
    decision: input.decision, reason: input.reason, decidedAt: new Date().toISOString() }
  const current = (await f.authority.readOutlinePlanningState(f.project.path))!, doc = JSON.parse(current.content)
  doc.upstreamReviewDecisions = [legacy]
  await f.authority.replaceOutlinePlanningState(f.project.path, current.contentHash, JSON.stringify(doc))
  const legacyBytes = (await f.authority.readOutlinePlanningState(f.project.path))!.content
  assert.equal((await f.planning.decideUpstreamReview(input)).chapter!.review.upstream!.history[0].evidence, undefined)
  assert.equal((await f.authority.readOutlinePlanningState(f.project.path))!.content, legacyBytes, 'same-decision retry must not fabricate or backfill evidence')
  const saved = (await f.planning.decideUpstreamReview({ ...input, reason: '此次核对并保留原始对照' })).chapter!.review.upstream!
  const evidence = saved.history[0].evidence!
  assert.deepEqual(evidence, { eventVersion: finding.eventVersion, sourceVersion: finding.sourceVersion, provenanceRevision: finding.provenanceRevision, fields: finding.fields })
  assert.equal(saved.history[1].evidence, undefined)
  const replacement = await f.packages.previewChapterEventAdoption('joint-candidate', f.chapter, { ...draft,
    event: '改为核对新的印章', result: '发现印章不属于寄信人', replaces: { eventId: f.child.eventId, eventVersionId: f.child.eventVersionId } })
  await f.packages.adoptChapterEvent(replacement.token)
  const restarted = new OutlinePlanningService(f.projects, f.documents, new ResearchLibraryService(f.projects, f.authority), f.authority, { read: () => f.projection.readForConsumer() })
  const after = (await restarted.status(f.chapter)).chapter!.review.upstream!
  assert.equal(after.findings[0].status, 'pending')
  assert.notEqual(after.findings[0].eventVersion, evidence.eventVersion)
  assert.equal(after.findings[0].fields.find(f => f.field === 'event')!.detail, '改为核对新的印章')
  assert.equal(after.history[0].evidence!.fields.find(f => f.field === 'event')!.detail, '逐笔核对落款')
  assert.deepEqual(after.history[0].evidence, evidence); assert.equal(after.history[1].evidence, undefined)
  decodeChapterUpstreamReview(after)
  const final = (await f.authority.readOutlinePlanningState(f.project.path))!, forged = JSON.parse(final.content)
  forged.upstreamReviewDecisions[1].evidence.fields[0].source += '改写旧对照'
  forged.upstreamReviewDecisions[1].evidence.fields[0].changed = true
  await assert.rejects(f.authority.replaceOutlinePlanningState(f.project.path, final.contentHash, JSON.stringify(forged)), { code: 'CONFLICT' })
  assert.equal((await f.authority.readOutlinePlanningState(f.project.path))!.content, final.content)
})

test('upstream history rejects malformed snapshots and renderer-supplied evidence', () => {
  const fields = (['time', 'characters', 'location', 'event', 'result'] as const).map(field => ({ field, source: '原安排', detail: '细化安排', changed: true }))
  const evidence = { eventVersion: randomUUID(), sourceVersion: randomUUID(), provenanceRevision: randomUUID(), fields }
  const row = { chapterId: 1, eventId: 'child', sourceId: 'parent', fingerprint: 'a'.repeat(64), decision: 'no-conflict', reason: '合理细化', decidedAt: new Date().toISOString() }
  assert.deepEqual(decodeUpstreamReviewRecord(row), row)
  assert.deepEqual(decodeUpstreamReviewRecord({ ...row, evidence }).evidence, evidence)
  for (const bad of [null, {}, { ...evidence, sourceVersion: null }, { ...evidence, path: 'private' },
    { ...evidence, fields: fields.slice(1) }, { ...evidence, fields: [fields[0], ...fields.slice(0, 4)] },
    { ...evidence, fields: fields.map(f => ({ ...f, changed: false })) }]) assert.throws(() => decodeUpstreamReviewRecord({ ...row, evidence: bad }), { code: 'VALIDATION_ERROR' })
  assert.throws(() => decodeUpstreamReviewArgs([{ workItemId: 'book', chapterId: 1, fingerprint: row.fingerprint, decision: row.decision, reason: row.reason, evidence }]))
  const finding = { ...evidence, eventId: row.eventId, sourceId: row.sourceId, fingerprint: row.fingerprint, status: row.decision, decision: { ...row, evidence } }
  decodeChapterUpstreamReview({ findings: [finding], history: [row] })
  assert.throws(() => decodeChapterUpstreamReview({ findings: [{ ...finding, decision: { ...row, evidence: { ...evidence, eventVersion: randomUUID() } } }], history: [] }))
})
