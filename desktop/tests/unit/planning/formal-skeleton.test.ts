import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { DocumentService } from '../../../src/main/modules/manuscript/application/document-service'
import { ResearchLibraryService } from '../../../src/main/modules/library/application/research-library-service'
import { OutlinePlanningService } from '../../../src/main/modules/planning/application/outline-planning-service'
import { PlanningPackageService, renderPlanningTotalOutline, renderPlanningVolumePlan, renderPlanningVolumeOutline, renderPlanningChapterSkeletonVolume } from '../../../src/main/modules/planning/application/planning-package-service'
import { ChapterDetailService } from '../../../src/main/modules/planning/application/chapter-detail-service'
import { ChapterStoryContractService } from '../../../src/main/modules/planning/application/chapter-story-contract-service'
import { buildChapterContract } from '../../../src/main/modules/manuscript/application/chapter-draft-service'
import { contextBudgetStartingSuggestions } from '../../../src/contracts/assistant/types'
import { assertSkeletonHistory, assertSkeletonHistoryAppend } from '../../../src/main/modules/planning/domain/planning-dependencies'
import type { PlanningChapterSkeletonEntry, PlanningPackageProposal, PlanningChapterDetailVolumeProposal } from '../../../src/contracts/planning/types'
import { decodeFormalSkeletonPreviewArgs, decodeFormalSkeletonTokenArgs } from '../../../src/contracts/planning/ipc'
import { planningIpcValueDecoders } from '../../../src/contracts/planning/ipc-planning-result-contracts'
import type { UnifiedEventProjection } from '../../../src/main/modules/timeline/domain/event-projection'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'
import { SqliteManuscriptService } from '../../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../../src/main/modules/library/application/legacy-workspace-source'
import { ShadowImportService } from '../../../src/main/modules/library/application/shadow-import-service'

const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const body = '进入状态：主角来到旧城\n1. 找到旧信\n2. 核对落款\n退出状态：确认落款但尚未出发\n允许扩写：动作、对白\n禁止：提前揭示真凶'
const story = '主角来到旧城，拿着旧信寻找收信人。门卫认出信封上的印章，将他带到档案室。主角核对落款，发现名字不符，决定留下继续寻找见证人。'
const storyConstraints = { entryState: '主角持信来到旧城', beats: ['主角寻找收信人，门卫认出印章。', '门卫带他到档案室，主角核对落款。'], exitState: '主角发现名字不符，决定留下找见证人。', allowedFacts: ['档案室核对动作'], forbiddenEvents: ['提前揭示真凶'], foreshadowActions: [] }

test('natural chapter story binds exact constraints, survives restart and invalidates after edits or upstream changes', async t => {
  const f = await fixture(t, true), id = f.chapters[0]
  await f.adopt(1)
  await f.planning.updateChapterOutline(id, story, 1)
  assert.equal((await f.planning.status(id)).chapter?.review.canConfirm, false)
  await f.planning.updateChapterOutline(id, story, 1, storyConstraints)
  assert.equal((await f.planning.status(id)).chapter?.review.canConfirm, true)
  await f.planning.confirmChapterOutline(id)
  const version = (await f.planning.status(id)).chapter!.contractVersion!
  assert.deepEqual(version.storyConstraints, storyConstraints)
  assert.equal(buildChapterContract(id, story, version).beats.length, 2)
  const reopened = new OutlinePlanningService(f.projects, f.documents, f.research, f.authority, { read: async () => f.projection as unknown as UnifiedEventProjection })
  assert.equal((await reopened.status(id)).chapter!.contractVersion!.fingerprint, version.fingerprint)
  await f.planning.updateChapterOutline(id, body, 1)
  // Existing new-format binding cannot fall back to old visible tags after an edit.
  assert.equal((await f.planning.status(id)).chapter?.review.canConfirm, false)
  await f.planning.updateChapterOutline(id, story, 1, storyConstraints)
  await f.planning.updateOutline(1, '作者修改上级事件')
  assert.equal((await f.planning.status(id)).chapter?.review.canConfirm, false)
})

test('explicit constraint preview is read-only; stale text and other books reject one-use tokens', async t => {
  const f = await fixture(t), id = f.chapters[0]
  await f.adopt(1); await f.planning.updateChapterOutline(id, story, 1)
  let calls = 0
  const service = new ChapterStoryContractService({ complete: async instruction => { calls++; return { content: instruction.startsWith('复核下方') ? '{"issues":[]}' : JSON.stringify(storyConstraints) } } }, f.planning, {
    promptContext: async () => story, contextBudgetPreferences: async () => ({ version: 1, ...contextBudgetStartingSuggestions, pinnedEvidenceKeys: [], excludedEvidenceKeys: [] })
  })
  const bytes = await readFile(f.ledger), preview = await service.prepare(id)
  assert.equal(calls, 2); assert.deepEqual(await readFile(f.ledger), bytes)
  await service.adopt(preview.token)
  await assert.rejects(service.adopt(preview.token), /已过期或已使用/)
  assert.equal((await f.planning.status(id)).chapter?.review.canConfirm, true)
  const stale = await service.prepare(id)
  await f.planning.updateChapterOutline(id, `${story}他离开了旧城。`, 1)
  await assert.rejects(service.adopt(stale.token), /已变化/)
  await f.planning.updateChapterOutline(id, story, 1)
  const foreign = await service.prepare(id)
  await f.projects.create({ parentPath: f.root, name: '其他作品', genre: '悬疑' })
  await assert.rejects(service.adopt(foreign.token))
})

test('interrupted ledger binding preserves narrative and retry avoids a second identical outline version', async t => {
  const f = await fixture(t, true), id = f.chapters[0]
  await f.adopt(1)
  const original = f.authority.replaceOutlinePlanningState.bind(f.authority)
  const mock = t.mock.method(f.authority, 'replaceOutlinePlanningState', async () => { throw new Error('binding interrupted') })
  await assert.rejects(f.planning.updateChapterOutline(id, story, 1, storyConstraints), /interrupted/)
  assert.equal((await f.documents.chapterOutline(id)).content, story)
  mock.mock.restore()
  assert.equal((await f.planning.status(id)).chapter?.review.canConfirm, false)
  const db = (await f.databases.openExisting(f.project.path))!
  const before = db.formalOutlines().find(o => o.legacyKey === `chapter-${id}`)!.currentVersionId
  db.close()
  await f.planning.updateChapterOutline(id, story, 1, storyConstraints)
  const next = (await f.databases.openExisting(f.project.path))!
  assert.equal(next.formalOutlines().find(o => o.legacyKey === `chapter-${id}`)!.currentVersionId, before)
  next.close()
  assert.equal((await f.planning.status(id)).chapter?.review.canConfirm, true)
  void original
})

async function fixture(t: TestContext, sqlite = false) {
  const root = await mkdtemp(join(tmpdir(), 'formal-skeleton-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const settings = new SettingsStore(join(root, 'profile'), { available: () => true, encrypt: s => Buffer.from(s).toString('base64'), decrypt: s => Buffer.from(s, 'base64').toString() })
  const projects = new ProjectService(settings)
  const { project } = await projects.create({ parentPath: root, name: '双卷合成作品', genre: '悬疑' })
  let documents = new DocumentService(projects)
  const databases = new SqliteWorkspaceDatabaseFactory()
  const authority = new SqliteManuscriptService(databases)
  if (sqlite) {
    const source = new CurrentProjectLegacyWorkspaceSource(projects, documents)
    const importer = new ShadowImportService(source, databases)
    await importer.import(await importer.preview())
    await authority.activate(project.path, await source.snapshot())
    documents = new DocumentService(projects, undefined, authority)
  }
  const research = new ResearchLibraryService(projects, sqlite ? authority : undefined)
  const event = { eventId: 'event-a', versionId: 'version-a', content: { time: '第一天', characters: ['主角'], location: '旧城', event: '找到旧信', confidence: 1, evidenceRefs: [] }, phase: 'planned', createdAt: '2026-09-20T00:00:00Z' }
  const projection = { approved: [event], approvedRevision: hash('a'), candidates: [] as typeof event[] }
  const planning = new OutlinePlanningService(projects, documents, research, sqlite ? authority : undefined, { read: async () => projection as unknown as UnifiedEventProjection })
  const chapters: number[] = []
  for (let i = 0; i < 4; i++) chapters.push((await documents.createChapter()).id)
  await planning.updateOutline('total', '主角因为收到旧信而调查，发现矛盾，于是追查真相。')
  await planning.createVolume('旧城'); await planning.createVolume('新城')
  for (const volume of [1, 2]) await planning.updateOutline(volume, `第${volume}卷因为发现线索而展开调查，导致新的选择。`)
  for (const [index, id] of chapters.entries()) await planning.placeChapter(id, index < 2 ? 1 : 2)
  await planning.placeEventInChapter('event-a', chapters[0])
  const confirm = async (scope: 'total' | number) => {
    const s = await planning.status()
    const review = scope === 'total' ? s.totalReview : s.volumes.find(v => v.volume === scope)!.review
    const approval = scope === 'total' ? s.totalApproval : s.volumes.find(v => v.volume === scope)!.approval
    if (approval.status === 'confirmed') return
    if (review.status === 'attention') await planning.acknowledgeOutlineReview(scope)
    await planning.confirmPlanningOutline(scope)
  }
  await confirm('total'); await confirm(1); await confirm(2)
  const entries: PlanningChapterSkeletonEntry[] = chapters.map((chapter, i) => ({ chapter, volume: i < 2 ? 1 : 2, volumeChapter: i % 2 + 1, title: `线索${i + 1}`, coreEvent: '主角核对信件', characters: ['主角'], location: '旧城', result: '发现新的落款' }))
  const ledger = join(project.path, '.webnovel', 'planning', 'outline-state.json')
  const adopt = async (volume: number) => {
    const items = entries.filter(e => e.volume === volume)
    const preview = await planning.inspectFormalSkeleton(items, volume)
    return planning.adoptFormalSkeleton(items, volume, preview.fingerprint)
  }
  const saveChapters = async () => { for (const id of chapters) await planning.updateChapterOutline(id, body) }
  return { root, project, projects, documents, research, planning, projection, entries, chapters, ledger, adopt, confirm, saveChapters, databases, authority }
}

test('chapter status reads full outlines once and refreshes dependencies on the next call', async t => {
  const f = await fixture(t)
  await f.adopt(1); await f.saveChapters()
  const outlines = f.documents.outlines.bind(f.documents)
  let reads = 0
  t.mock.method(f.documents, 'outlines', async () => { reads++; return outlines() })
  assert.equal((await f.planning.status(f.chapters[0])).chapter!.stale, false)
  assert.equal(reads, 1)
  await f.documents.updateOutline(1, '作者刚刚改变本卷方向，新状态必须重新读取。')
  reads = 0
  assert.equal((await f.planning.status(f.chapters[0])).chapter!.stale, true)
  assert.equal(reads, 1)
  t.mock.method(f.documents, 'outlines', async () => { throw new Error('outline read failed') })
  await assert.rejects(f.planning.status(f.chapters[0]), /outline read failed/)
})

test('chapter status still rejects switching books after its shared outline read', async t => {
  const f = await fixture(t)
  const { project: other } = await f.projects.create({ parentPath: f.root, name: '切换目标' })
  await f.projects.switch(f.project.path)
  const outlines = f.documents.outlines.bind(f.documents)
  t.mock.method(f.documents, 'outlines', async () => {
    const result = await outlines()
    await f.projects.switch(other.path)
    return result
  })
  await assert.rejects(f.planning.status(f.chapters[0]), { code: 'CONFLICT' })
})

test('adopts immutable per-chapter skeletons, survives reopen and only invalidates the changed entry', async t => {
  const f = await fixture(t)
  const before = await readFile(f.ledger, 'utf8')
  const first = await f.planning.inspectFormalSkeleton(f.entries.slice(0, 2), 1)
  assert.equal(await readFile(f.ledger, 'utf8'), before)
  assert.equal(first.entries[0].status, 'untracked')
  await f.adopt(1); await f.adopt(2); await f.saveChapters()
  for (const id of f.chapters) assert.equal((await f.planning.status(id)).chapter!.stale, false)
  const old = JSON.parse(await readFile(f.ledger, 'utf8')).formalSkeleton
  await f.adopt(1)
  assert.deepEqual(JSON.parse(await readFile(f.ledger, 'utf8')).formalSkeleton, old)
  f.entries[0].result = '发现落款来自十年前'
  const changed = await f.adopt(1)
  assert.equal(changed.entries[1].revision, old[1].revision)
  const next = JSON.parse(await readFile(f.ledger, 'utf8')).formalSkeleton
  assert.equal(next.length, 5); assert.deepEqual(next.slice(0, 4), old)
  assertSkeletonHistory(next)
  assert.equal((await f.planning.status(f.chapters[0])).chapter!.stale, true)
  for (const id of f.chapters.slice(1)) assert.equal((await f.planning.status(id)).chapter!.stale, false)
  const reopened = new OutlinePlanningService(f.projects, f.documents, f.research, undefined, { read: async () => f.projection as unknown as UnifiedEventProjection })
  assert.equal((await reopened.inspectFormalSkeleton(f.entries.slice(0, 2), 1)).entries[0].status, 'current')
  assert.throws(() => assertSkeletonHistoryAppend(next, old))
  const tampered = structuredClone(next); tampered[0].entry.result = '篡改旧记录'
  assert.throws(() => assertSkeletonHistory(tampered))
})

test('one event and one volume propagate only to their consumers; candidate events do not', async t => {
  const f = await fixture(t)
  await f.adopt(1); await f.adopt(2); await f.saveChapters()
  const revision = (await f.planning.status()).totalRevision
  f.projection.candidates.push({ ...f.projection.approved[0], versionId: 'candidate' } as never)
  assert.equal((await f.planning.status(f.chapters[0])).chapter!.stale, false)
  f.projection.approved[0].versionId = 'version-b'
  assert.equal((await f.planning.status(f.chapters[0])).chapter!.stale, true)
  for (const id of f.chapters.slice(1)) assert.equal((await f.planning.status(id)).chapter!.stale, false)
  await f.planning.updateOutline(1, '本卷因落款改变调查方向。')
  assert.equal((await f.planning.status(f.chapters[1])).chapter!.stale, true)
  for (const id of f.chapters.slice(2)) assert.equal((await f.planning.status(id)).chapter!.stale, false)
  assert.equal((await f.planning.status()).totalRevision, revision)
  await f.planning.updateOutline('total', '全书真相变化，追查另一条因果链。')
  for (const id of f.chapters) assert.equal((await f.planning.status(id)).chapter!.stale, true)
})

test('chapter placement changes do not revoke total approval or an unrelated chapter contract', async t => {
  const f = await fixture(t)
  await f.saveChapters()
  await f.planning.confirmChapterOutline(f.chapters[3])
  const before = await f.planning.status(f.chapters[3])
  await f.planning.placeEventInChapter('event-a', f.chapters[1])
  const after = await f.planning.status(f.chapters[3])
  assert.equal(after.totalRevision, before.totalRevision)
  assert.equal(after.totalApproval.status, 'confirmed')
  assert.deepEqual(after.chapter?.contractVersion, before.chapter?.contractVersion)
})

test('stale skeleton preview is zero-write and missing chapters cannot delete formal history', async t => {
  const f = await fixture(t)
  const view = await f.planning.inspectFormalSkeleton(f.entries.slice(0, 2), 1)
  await f.planning.updateOutline(1, '作者改写卷纲。')
  const bytes = await readFile(f.ledger, 'utf8')
  await assert.rejects(f.planning.adoptFormalSkeleton(f.entries.slice(0, 2), 1, view.fingerprint), /变化/)
  assert.equal(await readFile(f.ledger, 'utf8'), bytes)
  await f.confirm(1); await f.adopt(1)
  assert.equal((await f.planning.inspectFormalSkeleton(f.entries.slice(0, 1), 1)).canAdopt, false)
})

test('named preview/adopt validates tokens, stored candidates and cross-book identity', async t => {
  const f = await fixture(t)
  const proposal: PlanningPackageProposal = {
    id: 'proposal-test', workItemId: f.project.id, createdAt: new Date().toISOString(),
    basedOn: { inputFingerprint: hash('input'), blueprintFingerprint: hash('blueprint'), totalOutlineFingerprint: hash('total') },
    blueprint: { premise: '旧信', worldView: '旧城', characters: [{ name: '主角', role: '调查者', arcSeed: '追查落款' }], powerSystem: '', cheatSystem: '', rationale: '追查' },
    totalOutline: { title: '旧信', summary: '追查落款', content: '追查旧信的真相。' },
    volumes: [{ order: 1, title: '旧城', goal: '找信', summary: '主角找到旧信', ending: '离开' }, { order: 2, title: '新城', goal: '核实', summary: '核对落款', ending: '真相' }]
  }
  proposal.chapterSkeleton = { generatedAt: new Date().toISOString(), targetWordsPerChapter: 2000,
    basedOn: { totalOutlineFingerprint: hash(renderPlanningTotalOutline(proposal)), volumePlanFingerprint: hash(renderPlanningVolumePlan(proposal)) }, chapters: f.entries }
  const packages = new PlanningPackageService(f.projects, f.planning, f.documents)
  await packages.save(proposal)
  const preview = await packages.previewFormalSkeleton(proposal.id, 1)
  planningIpcValueDecoders['planning:preview-formal-skeleton'](preview, 'preview')
  const result = await packages.adoptFormalSkeleton(preview.token)
  planningIpcValueDecoders['planning:adopt-formal-skeleton'](result, 'result')
  await assert.rejects(packages.adoptFormalSkeleton(preview.token), /失效/)
  const detail: PlanningChapterDetailVolumeProposal = {
    volume: 1, generatedAt: new Date().toISOString(),
    basedOn: { totalOutlineFingerprint: hash(renderPlanningTotalOutline(proposal)), volumeOutlineFingerprint: hash(renderPlanningVolumeOutline(proposal.volumes[0])),
      skeletonFingerprint: hash(renderPlanningChapterSkeletonVolume(proposal, 1)), formalSkeletonFingerprint: await packages.assertFormalSkeletonForDetails(proposal.id, 1) },
    chapters: f.entries.slice(0, 2).map(entry => ({ chapter: entry.chapter, volume: 1, volumeChapter: entry.volumeChapter, title: entry.title,
      entryState: '收到旧信', beats: ['打开信件', '核对落款'], exitState: '找到线索', allowedFacts: ['信纸泛黄'], forbiddenEvents: ['禁止提前出发'], foreshadowActions: [] }))
  }
  const stored = await packages.storeChapterDetail(proposal.id, detail)
  assert.equal(stored.chapterDetails![0].basedOn.formalSkeletonFingerprint, detail.basedOn.formalSkeletonFingerprint)
  assert.equal((await packages.chapterDetailStatuses(proposal.id))[0].stale, false)
  const beforePreview = await readFile(f.ledger, 'utf8')
  const candidateBeforePreview = JSON.stringify(await packages.get())
  const eventPreview = await packages.previewChapterEvents(proposal.id, 1)
  assert.equal(eventPreview.freshness, 'current')
  assert.equal(eventPreview.candidate.time, null)
  assert.deepEqual(eventPreview.candidate.beats, detail.chapters[0].beats)
  assert.equal(eventPreview.formalEvents[0].version, 'version-a')
  assert.equal(eventPreview.formalEvents[0].phase, 'planned')
  assert.ok(eventPreview.findings.some(finding => finding.code === 'SEMANTIC_REVIEW_REQUIRED'))
  planningIpcValueDecoders['planning:preview-chapter-events'](eventPreview, 'preview')
  assert.throws(() => planningIpcValueDecoders['planning:preview-chapter-events']({ ...eventPreview, candidate: { ...eventPreview.candidate, time: 'invented' } }, 'preview'))
  assert.throws(() => planningIpcValueDecoders['planning:preview-chapter-events']({ ...eventPreview, formalEvents: [eventPreview.formalEvents[0], eventPreview.formalEvents[0]] }, 'preview'))
  assert.throws(() => planningIpcValueDecoders['planning:preview-chapter-events']({ ...eventPreview, findings: [] }, 'preview'))
  f.projection.candidates.push({ ...f.projection.approved[0], eventId: 'candidate-only', versionId: 'candidate-version' })
  assert.equal((await packages.previewChapterEvents(proposal.id, 1)).fingerprint, eventPreview.fingerprint)
  assert.deepEqual((await packages.previewChapterEvents(proposal.id, 2)).formalEvents, [])
  assert.equal(await readFile(f.ledger, 'utf8'), beforePreview)
  assert.equal(JSON.stringify(await packages.get()), candidateBeforePreview)
  const approved = f.projection.approved.pop()!
  await assert.rejects(packages.previewChapterEvents(proposal.id, 1), /缺失|归档/)
  f.projection.approved.push(approved)
  f.projection.approved[0].versionId = 'event-version-after-generation'
  const changedPreview = await packages.previewChapterEvents(proposal.id, 1)
  assert.equal(changedPreview.freshness, 'stale')
  assert.notEqual(changedPreview.fingerprint, eventPreview.fingerprint)
  assert.equal((await packages.chapterDetailStatuses(proposal.id))[0].stale, true)
  await f.adopt(1)
  await assert.rejects(packages.previewChapterDetailAdoption(proposal.id, 1), /正式骨架版本/)
  const retained = JSON.stringify(await packages.get())
  await assert.rejects(packages.storeChapterDetail(proposal.id, detail), /正式骨架版本/)
  assert.equal(JSON.stringify(await packages.get()), retained)
  const inspectEvents = f.planning.inspectChapterEvents.bind(f.planning)
  let reads = 0
  f.planning.inspectChapterEvents = async id => {
    const events = await inspectEvents(id)
    if (++reads === 1) f.projection.approved[0].versionId = 'changed-during-preview'
    return events
  }
  await assert.rejects(packages.previewChapterEvents(proposal.id, 1), /读取中发生变化/)
  f.planning.inspectChapterEvents = inspectEvents
  const draftFile = join(f.project.path, '.webnovel', 'planning', 'automatic-planning-draft.json')
  const draftBytes = await readFile(draftFile, 'utf8')
  reads = 0
  f.planning.inspectChapterEvents = async id => {
    const events = await inspectEvents(id)
    if (++reads === 1) {
      const external = JSON.parse(draftBytes)
      external.proposal.chapterDetails[0].chapters[0].entryState = '外部修改的进入状态'
      await writeFile(draftFile, JSON.stringify(external), 'utf8')
    }
    return events
  }
  await assert.rejects(packages.previewChapterEvents(proposal.id, 1), /读取中发生变化/)
  assert.match(await readFile(draftFile, 'utf8'), /外部修改的进入状态/)
  await writeFile(draftFile, draftBytes, 'utf8')
  f.planning.inspectChapterEvents = inspectEvents
  const legacy = (await packages.get())!
  delete legacy.chapterDetails![0].basedOn.formalSkeletonFingerprint
  await packages.save(legacy)
  assert.equal((await packages.previewChapterEvents(proposal.id, 1)).freshness, 'untracked')
  const stale = await packages.previewFormalSkeleton(proposal.id, 1)
  const edited = (await packages.get())!; edited.chapterSkeleton!.chapters[0].result = '作者编辑'
  await packages.save(edited)
  await assert.rejects(packages.adoptFormalSkeleton(stale.token), /修改/)
  await assert.rejects(packages.assertFormalSkeletonForDetails(proposal.id, 1), /核对并采用/)
  const other = await packages.previewFormalSkeleton(proposal.id, 1)
  f.planning.inspectChapterEvents = async id => {
    const events = await inspectEvents(id)
    await f.projects.create({ parentPath: f.root, name: '另一部作品', genre: '都市' })
    return events
  }
  await assert.rejects(packages.previewChapterEvents(proposal.id, 1), /作品.*变化|切换/)
  await assert.rejects(packages.adoptFormalSkeleton(other.token), /失效/)
  assert.deepEqual(decodeFormalSkeletonPreviewArgs(['proposal-test', 1]), ['proposal-test', 1])
  assert.throws(() => decodeFormalSkeletonPreviewArgs(['proposal-test', 0]))
  assert.throws(() => decodeFormalSkeletonTokenArgs(['bad-token']))
  assert.throws(() => planningIpcValueDecoders['planning:adopt-formal-skeleton']({ ...result, entries: [{ ...result.entries[0], revision: 'bad' }] }, 'result'))
})

test('event inspection does not initialize an absent ledger and fails closed on corrupt data', async t => {
  const f = await fixture(t)
  await unlink(f.ledger)
  assert.deepEqual(await f.planning.inspectChapterEvents(1), [])
  await assert.rejects(readFile(f.ledger), { code: 'ENOENT' })
  await writeFile(f.ledger, '{broken-ledger', 'utf8')
  await assert.rejects(f.planning.inspectChapterEvents(1), /损坏/)
  assert.equal(await readFile(f.ledger, 'utf8'), '{broken-ledger')
})

test('unadopted skeleton blocks detailed generation before model capture or writes', async () => {
  let modelCalls = 0
  let writes = 0
  const service = new ChapterDetailService({ captureRun: async () => { modelCalls++; throw new Error('unexpected capture') }, complete: async () => { modelCalls++; return { content: '' } } }, {
    assertFormalSkeletonForDetails: async () => { throw new Error('请先采用正式骨架') },
    get: async () => null,
    storeChapterDetail: async () => { writes++; throw new Error('unexpected write') }
  }, { status: async () => { throw new Error('unexpected status') } }, {})
  await assert.rejects(service.generate('proposal-test', 1), /正式骨架/)
  assert.equal(modelCalls, 0)
  assert.equal(writes, 0)
})

test('SQLite CAS preserves skeleton history and inspection never repairs an edited mirror', async t => {
  const f = await fixture(t, true)
  await f.adopt(1)
  const mirror = await readFile(f.ledger, 'utf8')
  const formal = (await f.authority.readOutlinePlanningState(f.project.path))!
  const state = JSON.parse(formal.content)
  assert.equal(state.formalSkeleton.length, 2)
  await writeFile(f.ledger, mirror + '\n', 'utf8')
  const view = await f.planning.inspectFormalSkeleton(f.entries.slice(0, 2), 1)
  assert.equal((await f.planning.inspectChapterEvents(1))[0].id, 'event-a')
  assert.equal(view.entries[0].status, 'current')
  assert.equal(await readFile(f.ledger, 'utf8'), mirror + '\n')
  const database = await f.databases.openExisting(f.project.path)
  assert.ok(database)
  try {
    const removed = JSON.stringify({ ...state, formalSkeleton: [] })
    assert.throws(() => database.replaceOutlinePlanningState(formal.contentHash, removed, hash(removed)), /骨架历史损坏/)
    const modified = JSON.stringify({ ...state, total: { ...state.total, revision: state.total.revision + 1 } })
    assert.throws(() => database.replaceOutlinePlanningState(hash('stale'), modified, hash(modified)), /其他操作更新/)
    assert.equal(database.outlinePlanningState().content, formal.content)
  } finally { database.close() }
})
