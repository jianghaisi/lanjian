import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { getEventListeners } from 'node:events'
import test, { type TestContext } from 'node:test'
import { emptyWorldbookEntry } from '../../src/contracts/characters/worldbook'
import { ProjectService } from '../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../src/main/platform/settings/settings-store'
import { DocumentService } from '../../src/main/modules/manuscript/application/document-service'
import { ShadowImportService } from '../../src/main/modules/library/application/shadow-import-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../src/main/modules/library/application/legacy-workspace-source'
import { SqliteWorkspaceDatabaseFactory } from '../../src/main/platform/storage/workspace-database'
import { SqliteManuscriptService } from '../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { WorkspaceService } from '../../src/main/modules/library/application/workspace-service'
import { ChapterDraftService } from '../../src/main/modules/manuscript/application/chapter-draft-service'
import { WritingAgentService } from '../../src/main/modules/assistant/application/writing-agent-service'
import { WritingAgentTaskService } from '../../src/main/modules/assistant/application/writing-agent-task-service'
import { AgentToolRegistry } from '../../src/main/modules/assistant/application/agent-tool-registry'
import { WORKSPACE_DATABASE_RELATIVE_PATH } from '../../src/main/core/ports/workspace-database'
import { worldbookContextVersion } from '../../src/main/modules/characters/domain/worldbook-context'
import { ResearchLibraryService } from '../../src/main/modules/library/application/research-library-service'
import { OutlinePlanningService } from '../../src/main/modules/planning/application/outline-planning-service'
import { LocalRetrievalService } from '../../src/main/modules/assistant/application/local-retrieval-service'
import type { AiClient } from '../../src/main/modules/models/application/ai-client'

const codec = { available: () => true, encrypt: (v: string) => v, decrypt: (v: string) => v }
const hash = (v: string) => createHash('sha256').update(v).digest('hex')
const outline = '进入状态：白衡在旧城门外\n1. 白衡在城门外发现脚印\n2. 沿着脚印追到酒馆\n退出状态：白衡走到酒馆门前，尚未进门\n允许扩写：对白；动作；环境'
const prose = '白衡在城门外发现脚印，沿着雨水留下的痕迹走到酒馆门前。'.repeat(25)
const review = JSON.stringify({ summary: '按序完成本章节点', passed: true,
  beats: [{ id: 'B1', status: 'covered', evidence: '城门外发现脚印' }, { id: 'B2', status: 'covered', evidence: '走到酒馆门前' }],
  boundary: { entryRespected: true, exitReached: true, evidence: '白衡在城门外发现脚印，沿着雨水留下的痕迹走到酒馆门前。' },
  violations: [], introducedFacts: [], characterChanges: [], characterConflicts: [], literaryFindings: [] })

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-worldbook-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const projects = new ProjectService(new SettingsStore(join(root, 'profile'), codec))
  const { project } = await projects.create({ parentPath: root, name: '世界书验证书', genre: '悬疑' })
  const fileDocuments = new DocumentService(projects)
  await fileDocuments.updateChapter(10, { title: '开篇', content: '' })
  await fileDocuments.updateChapter(20, { title: '揭示', content: '' })
  await fileDocuments.updateChapterOutline(10, outline)
  await fileDocuments.updateChapterOutline(20, outline)
  const databases = new SqliteWorkspaceDatabaseFactory()
  const source = new CurrentProjectLegacyWorkspaceSource(projects, fileDocuments)
  const importer = new ShadowImportService(source, databases)
  await importer.import(await importer.preview())
  const authority = new SqliteManuscriptService(databases)
  await authority.activate(project.path, await source.snapshot())
  const documents = new DocumentService(projects, undefined, authority)
  const workspace = new WorkspaceService(projects, undefined, undefined, documents, undefined, undefined, authority)
  const entity = await authority.saveStoryEntity(project.path, { entityType: 'character', canonicalName: '白衡', profileJson: JSON.stringify({ legacy: { preserved: true }, worldbook: {
    ...emptyWorldbookEntry(), aliases: ['白先生'], description: '公开设定：在旧城教书。', authorNotes: '作者专用笔记',
    secrets: [{ id: 'identity', text: '秘密标记：白衡是城主', revealChapterId: 20, knownBy: [] }]
  } }), status: 'approved' })
  for (const status of ['candidate', 'archived'] as const) await authority.saveStoryEntity(project.path, { entityType: 'world_rule', canonicalName: `${status}不能入提示词`, profileJson: '{}', status })
  return { project, projects, documents, databases, authority, workspace, entity }
}

test('chapter reorder during worldbook compilation rejects stale disclosure before generation', async t => {
  const f = await eventSourceFixture(t)
  await f.documents.reorderChapter(20, 1)
  const before = await f.documents.chapter(10)
  let calls = 0
  const ai = { modelFor: async () => 'offline-stub', complete: async () => { calls++; return { content: '只读回答' } } } as unknown as AiClient
  const runner = new WritingAgentService(ai, f.projects, f.documents, f.workspace, new ChapterDraftService(ai, f.documents, f.workspace))
  const read = f.workspace.promptContextCandidates.bind(f.workspace)
  let reorderDuringRead = true
  f.workspace.promptContextCandidates = async (...args) => {
    const candidates = await read(...args)
    if (reorderDuringRead) {
      assert.match(JSON.stringify(candidates), /秘密标记：白衡是城主/)
      await f.documents.reorderChapter(20, 2)
      reorderDuringRead = false
    }
    return candidates
  }
  const input = { chapterId: 10, currentDraft: before.content, message: '核对设定', preferredSkill: 'query' as const }
  await assert.rejects(runner.prepare(input), (error: { code?: string; recoverable?: boolean; message?: string }) => {
    assert.equal(error.code, 'CONFLICT')
    assert.equal(error.recoverable, true)
    assert.doesNotMatch(error.message ?? '', /白衡|秘密标记|lanjian-worldbook-test/)
    return true
  })
  assert.equal(calls, 0)
  const preview = await runner.preview(input)
  const prepared = await runner.prepare({ ...input, expectedContextHash: preview.contentHash })
  assert.doesNotMatch(JSON.stringify(prepared.contexts), /秘密标记：白衡是城主/)
  assert.equal(worldbookContextVersion(prepared.contexts.map(item => item.content).join('\n')), await f.workspace.currentWorldbookFingerprint())
  await runner.run(input, undefined, prepared)
  assert.equal(calls, 1)
  assert.equal(hash((await f.documents.chapter(10)).content), hash(before.content))
})

async function eventSourceFixture(t: TestContext) {
  const f = await fixture(t)
  const library = new ResearchLibraryService(f.projects, f.authority)
  const planning = new OutlinePlanningService(f.projects, f.documents, library, f.authority)
  const retrieval = new LocalRetrievalService(f.projects, f.documents, undefined, f.authority)
  const workspace = new WorkspaceService(f.projects, planning, library, f.documents, undefined,
    retrieval, f.authority)
  const source = await library.createSource({ title: '脚印参考', excerpt: '白衡 SOURCE_ONLY_SECRET 原始资料包含后文秘密。', userNotes: '' })
  const current = await library.createEventCandidate({ sourceId: source.id, time: '清晨', characters: ['白衡'], location: '城门外', event: '白衡在城门外发现脚印', result: '走到酒馆门前' })
  await library.approveEvent(current.id)
  // The copied event evidence remains even after correcting the source card.
  await library.updateSource(source.id, { ...source, excerpt: '白衡在城门外辨认普通脚印。' })
  const future = await library.createEventCandidate({ sourceId: source.id, time: '次日', characters: ['白衡'], location: '王城', event: 'FUTURE_EVENT_ONLY 白衡揭示身份', result: '后文章件完成' })
  await library.approveEvent(future.id)
  const created = await planning.createVolume('脚印')
  const volume = created.volumes.find(v => v.title === '脚印')!.volume
  for (const id of [10, 20]) await planning.placeChapter(id, volume)
  await planning.placeEventInChapter(current.id, 10)
  await planning.placeEventInChapter(future.id, 20)
  await workspace.saveTimeline([{ id: 'unassigned', time: '远期', characters: '白衡', location: '远方', event: 'UNASSIGNED_EVENT_ONLY 后续未分配计划' }])
  return { ...f, library, planning, retrieval, workspace, source, current, future }
}

function deferredSource() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

for (const stage of ['project-path', 'project-identity', 'chapter-position', 'fact-pack-aliases', 'context-preferences', 'fact-pack-identity', 'worldbook-order']) {
  test(`cancelled context stops subsequent reads after ${stage}`, async t => {
    const f = await eventSourceFixture(t)
    const before = hash(JSON.stringify(await f.documents.chapters()))
    t.mock.method(console, 'warn', () => {})
    const entered = deferredSource()
    const release = deferredSource()
    const controller = new AbortController()
    let downstreamCalls = () => 0
    const gate = <A extends unknown[], T>(read: (...args: A) => Promise<T>) => {
      let held = false
      return async (...args: A) => {
        const value = await read(...args)
        if (!held) { held = true; entered.resolve(); await release.promise }
        return value
      }
    }
    if (stage === 'project-path') {
      t.mock.method(f.projects, 'currentPath', gate(f.projects.currentPath.bind(f.projects)))
      const next = t.mock.method(f.projects, 'currentSummary')
      downstreamCalls = () => next.mock.callCount()
    } else if (stage === 'project-identity') {
      t.mock.method(f.projects, 'currentSummary', gate(f.projects.currentSummary.bind(f.projects)))
      const next = t.mock.method(f.documents, 'chapter')
      downstreamCalls = () => next.mock.callCount()
    } else if (stage === 'chapter-position') {
      t.mock.method(f.documents, 'chapter', gate(f.documents.chapter.bind(f.documents)))
      const next = t.mock.method(f.workspace, 'bookProfile')
      downstreamCalls = () => next.mock.callCount()
    } else if (stage === 'fact-pack-aliases') {
      t.mock.method(f.authority, 'characterAliases', gate(f.authority.characterAliases.bind(f.authority)))
      const next = t.mock.method(f.workspace, 'contextBudgetPreferences')
      downstreamCalls = () => next.mock.callCount()
    } else if (stage === 'context-preferences') {
      t.mock.method(f.workspace, 'contextBudgetPreferences', gate(f.workspace.contextBudgetPreferences.bind(f.workspace)))
      const next = t.mock.method(f.authority, 'approvedFactsBefore')
      downstreamCalls = () => next.mock.callCount()
    } else if (stage === 'fact-pack-identity') {
      let retrieved = false
      const read = f.retrieval.build.bind(f.retrieval)
      t.mock.method(f.retrieval, 'build', async (input: Parameters<typeof read>[0]) => { const result = await read(input); retrieved = true; return result })
      const path = f.projects.currentPath.bind(f.projects)
      const heldPath = gate(path)
      t.mock.method(f.projects, 'currentPath', () => retrieved ? heldPath() : path())
      const next = t.mock.method(f.library, 'searchSources')
      downstreamCalls = () => next.mock.callCount()
    } else {
      t.mock.method(f.authority, 'worldbookChapterOrder', gate(f.authority.worldbookChapterOrder.bind(f.authority)))
      const next = t.mock.method(f.workspace, 'promptProfile')
      downstreamCalls = () => next.mock.callCount()
    }
    const pending = f.workspace.promptContextCandidates(10, 'prose', undefined, controller.signal)
    const rejected = assert.rejects(pending, (error: Error) => error.name === 'AbortError')
    try {
      await entered.promise
      assert.equal(downstreamCalls(), 0)
      controller.abort()
      release.resolve()
      await rejected
      // Promise.all may reject before independently started readers drain.
      // Count invocation, not completion, to catch that unwanted extra work.
      assert.equal(downstreamCalls(), 0, 'stopped read must not start the next source')
      assert.ok((await f.workspace.promptContextCandidates(10, 'prose')).length > 0, 'a fresh request still reads full sources')
      assert.ok(downstreamCalls() > 0)
      assert.equal(hash(JSON.stringify(await f.documents.chapters())), before)
    } finally {
      controller.abort()
      release.resolve()
      await rejected
    }
  })
}

for (const [method, stage] of [
  ['powerSystem', 'power-system'],
  ['promptProfile', 'prompt-profile'],
  ['contextBudgetPreferences', 'context-preferences']
] as const) test(`context diagnostics report stalled ${stage} before the source settles`, async t => {
  const f = await eventSourceFixture(t)
  const before = hash(JSON.stringify(await f.documents.chapters()))
  const logs = t.mock.method(console, 'warn', () => {})
  const entered = deferredSource()
  const release = deferredSource()
  const read = f.workspace[method].bind(f.workspace)
  t.mock.method(f.workspace, method, async () => {
    entered.resolve()
    await release.promise
    return read()
  })
  const controller = new AbortController()
  const pending = f.workspace.promptContextCandidates(10, 'prose', undefined, controller.signal)
  const rejected = assert.rejects(pending, (error: Error) => error.name === 'AbortError')
  try {
    await entered.promise
    controller.abort(new DOMException(`PRIVATE_STOP ${f.project.path}`, 'AbortError'))
    const diagnostics = logs.mock.calls.filter(call => call.arguments[0] === 'long-form context source read')
    assert.equal(diagnostics.length, 1, 'must report while the source is still pending')
    const record = diagnostics[0].arguments[1] as { aborted: boolean; elapsedMs: number; pendingStages: Array<{ stage: string; elapsedMs: number }> }
    assert.equal(record.aborted, true)
    assert.ok(Number.isInteger(record.elapsedMs) && record.elapsedMs >= 0)
    assert.ok(record.pendingStages.some(item => item.stage === stage && Number.isInteger(item.elapsedMs)))
    assert.doesNotMatch(JSON.stringify(logs.mock.calls.map(call => call.arguments)), /PRIVATE_STOP|白衡|世界书验证书|lanjian-worldbook-test|作者专用笔记/)
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
    release.resolve()
    await rejected
    assert.equal(logs.mock.calls.filter(call => call.arguments[0] === 'long-form context source read').length, 1)
    assert.equal(hash(JSON.stringify(await f.documents.chapters())), before)
  } finally {
    controller.abort()
    release.resolve()
    await rejected
  }
})

test('context diagnostics identify the pending source when the tool budget expires', async t => {
  const f = await eventSourceFixture(t)
  const logs = t.mock.method(console, 'warn', () => {})
  const entered = deferredSource()
  const release = deferredSource()
  const power = f.workspace.powerSystem.bind(f.workspace)
  t.mock.method(f.workspace, 'powerSystem', async () => { entered.resolve(); await release.promise; return power() })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const tools = new AgentToolRegistry()
  const scope = { workItemId: f.project.id, workItemPath: f.project.path, chapterId: 10 }
  const grant = tools.grant({ ...scope, skill: 'continue' })
  let sourceRead: Promise<unknown> | undefined
  const pending = tools.execute(grant, 'compileContextSources', scope, signal => {
    const read = f.workspace.promptContextCandidates(10, 'prose', undefined, signal)
    sourceRead = read.catch(() => undefined)
    return read
  })
  const rejected = assert.rejects(pending, { code: 'FEATURE_UNAVAILABLE', recoverable: true })
  try {
    await entered.promise
    t.mock.timers.tick(60_000)
    await rejected
    const diagnostics = logs.mock.calls.filter(call => call.arguments[0] === 'long-form context source read')
    assert.equal(diagnostics.length, 1)
    const record = diagnostics[0].arguments[1] as { aborted: boolean; pendingStages: Array<{ stage: string }> }
    assert.equal(record.aborted, true)
    assert.ok(record.pendingStages.some(item => item.stage === 'power-system'))
    release.resolve()
    await sourceRead
    assert.equal(logs.mock.calls.filter(call => call.arguments[0] === 'long-form context source read').length, 1)
  } finally {
    release.resolve()
    t.mock.timers.tick(60_000)
    await Promise.allSettled([rejected, sourceRead])
  }
})

test('context diagnostics keep concurrent requests separate and release a successful reader', async t => {
  const f = await eventSourceFixture(t)
  const logs = t.mock.method(console, 'warn', () => {})
  const firstEntered = deferredSource()
  const firstRelease = deferredSource()
  const secondEntered = deferredSource()
  const secondRelease = deferredSource()
  const power = f.workspace.powerSystem.bind(f.workspace)
  const profile = f.workspace.promptProfile.bind(f.workspace)
  let powerReads = 0
  t.mock.method(f.workspace, 'powerSystem', async () => {
    if (++powerReads === 1) { firstEntered.resolve(); await firstRelease.promise }
    return power()
  })
  t.mock.method(f.workspace, 'promptProfile', async () => {
    secondEntered.resolve()
    await secondRelease.promise
    return profile()
  })
  const firstController = new AbortController()
  const secondController = new AbortController()
  const first = f.workspace.promptContextCandidates(10, 'prose', undefined, firstController.signal)
  const firstRejected = assert.rejects(first, (error: Error) => error.name === 'AbortError')
  await firstEntered.promise
  const second = f.workspace.promptContextCandidates(10, 'prose', undefined, secondController.signal)
  try {
    await secondEntered.promise
    firstController.abort()
    const diagnostics = logs.mock.calls.filter(call => call.arguments[0] === 'long-form context source read')
    assert.equal(diagnostics.length, 1)
    const record = diagnostics[0].arguments[1] as { pendingStages: Array<{ stage: string }> }
    assert.ok(record.pendingStages.some(item => item.stage === 'power-system'))
    assert.ok(record.pendingStages.every(item => item.stage !== 'prompt-profile'))
    assert.equal(getEventListeners(secondController.signal, 'abort').length, 1)
    secondRelease.resolve()
    assert.ok((await second).length > 0)
    assert.equal(getEventListeners(secondController.signal, 'abort').length, 0)
    const count = logs.mock.calls.length
    secondController.abort()
    firstRelease.resolve()
    await firstRejected
    assert.equal(logs.mock.calls.length, count, 'late abort and source completion must not report again')
  } finally {
    firstController.abort()
    firstRelease.resolve()
    secondRelease.resolve()
    await Promise.allSettled([firstRejected, second])
  }
})

test('context diagnostics preserve source failures and remove the abort listener without logging their content', async t => {
  const f = await eventSourceFixture(t)
  const logs = t.mock.method(console, 'warn', () => {})
  let now = 0
  t.mock.method(performance, 'now', () => now)
  const failure = new Error(`PRIVATE_SOURCE ${f.project.path} 白衡正文`)
  t.mock.method(f.workspace, 'promptProfile', async () => { now = 16_000; throw failure })
  const controller = new AbortController()
  await assert.rejects(f.workspace.promptContextCandidates(10, 'prose', undefined, controller.signal), error => error === failure)
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  assert.ok(logs.mock.calls.some(call => call.arguments[0] === 'long-form context source read'))
  assert.doesNotMatch(JSON.stringify(logs.mock.calls.map(call => call.arguments)), /PRIVATE_SOURCE|白衡|lanjian-worldbook-test/)
  const count = logs.mock.calls.length
  controller.abort()
  assert.equal(logs.mock.calls.length, count)
})

test('long-book preview to persisted full writing task stays exact across three attempts', {
  skip: process.env.LANJIAN_LONG_CONTEXT_BENCH !== '1'
}, async t => {
  let cancelTasks = async () => {}
  t.after(() => cancelTasks())
  const f = await eventSourceFixture(t)
  const terms = Array.from({ length: 96 }, (_, i) => `clue${String(i).padStart(3, '0')}`)
  const body = `白衡在城门外核对线索：${terms.join('、')}。`.repeat(14)
  for (let id = 1; id <= 112; id++) {
    await f.documents.updateChapter(id, { title: `前章 ${id}`, content: body })
    await f.authority.updateChapterPlanning(f.project.path, { legacyChapterId: id, lifecycleStatus: 'REVIEWABLE' })
    await f.authority.updateChapterPlanning(f.project.path, { legacyChapterId: id, lifecycleStatus: 'CONFIRMED' })
  }
  await f.documents.updateChapter(113, { title: '脚印去向', content: '' })
  await f.workspace.saveBookProfile({ ...await f.workspace.bookProfile(), coreIdea: '追查旧城脚印', targetWordsPerChapter: 300 })
  await f.workspace.saveFoundation({ ...await f.workspace.foundation(), worldView: '旧城留下的脚印可以追踪。', useRealms: true, useSystem: true })
  await f.workspace.saveRealms([{ id: 'footprint', name: '辨迹境', description: '只能辨认近处的脚印。' }])
  await f.workspace.saveSystemTemplate('[线索系统]\n线索：{clue}\n任务：{task}')
  // Populate formal config before the read-only baseline; missing documents otherwise import lazily.
  await f.workspace.savePowerSystem({ overview: '力量边界标记：辨迹只能观察，不能预知后续。' })
  await f.workspace.saveCheatSystem({ overview: '特殊优势标记：系统只能记录已发现的线索。' })
  await f.planning.updateOutline('total', '全局线索：白衡因为发现旧城脚印而追查，核对后发现矛盾，于是决定去酒馆查明来源。')
  const volume = (await f.planning.status()).volumes.find(item => item.title === '脚印')!.volume
  await f.planning.updateOutline(volume, '本卷线索：白衡因为发现脚印而沿路追查，抵达酒馆门外，由此开始查问。')
  await f.planning.placeChapter(113, volume)
  await f.planning.placeEventInChapter(f.current.id, 113)
  for (const scope of ['total', volume] as const) {
    const status = await f.planning.status()
    const assessment = scope === 'total' ? status.totalReview : status.volumes.find(item => item.volume === scope)!.review
    if (assessment.status === 'attention') await f.planning.acknowledgeOutlineReview(scope)
    await f.planning.confirmPlanningOutline(scope)
  }
  await f.planning.updateChapterOutline(113, `${outline}\n禁止：提前进入酒馆。\n检索线索：${terms.join('、')}`, volume)
  await f.planning.confirmChapterOutline(113)
  assert.equal((await f.workspace.foundationStatus(113)).readyForProse, true)
  const contract = await f.workspace.chapterContractVersion(113)
  assert.ok(contract.eventIds.includes(f.current.id))
  const previous = await f.documents.chapter(112)
  const facts = await f.authority.recordCharacterFactCandidates(f.project.path, previous, [
    { character: '白衡', field: 'location', value: '城门外', evidence: '白衡在城门外核对线索' }
  ], randomUUID())
  assert.ok(facts)
  await f.authority.decideFacts(f.project.path, { batchId: facts.id, decisions: facts.changes.map(change => ({ changeId: change.id, decision: 'APPROVED' })) })
  const database = await f.databases.openExisting(f.project.path)
  assert.ok(database)
  try { database.writeSummaryVersion({ legacyChapterId: 112, bodyVersionId: previous.bodyVersionId!, content: '前章摘要标记：白衡停在城门外，尚未进入酒馆。', status: 'approved' }) }
  finally { database.close() }
  const factPack = await f.workspace.contextFactPack(113)
  assert.equal(factPack.queryTerms.length, 96)
  assert.ok(factPack.structured.approvedFacts.length > 0)
  assert.match(factPack.structured.latestApprovedSummary!.content, /前章摘要标记/)
  assert.ok(factPack.evidence.some(item => item.sourceType === 'document_chunk'))
  assert.ok(factPack.materials?.some(item => item.sourceId === f.source.id))

  const modelCalls: Array<{ task: string; contextHash: string }> = []
  const checkContext = (context: string) => {
    for (const marker of ['全局线索', '本卷线索', '前章摘要标记', '辨迹境', '[线索系统]', '力量边界标记', '特殊优势标记', '公开设定：在旧城教书', 'clue000', 'clue095']) assert.ok(context.includes(marker), `missing source: ${marker}`)
    assert.ok(context.includes(f.current.id))
    assert.ok(context.includes(factPack.structured.approvedFacts[0].normalizedKey))
    assert.match(context, /作者已批准事实/)
    assert.match(context, /白衡在城门外辨认普通脚印/)
    assert.doesNotMatch(context, /SOURCE_ONLY_SECRET|FUTURE_EVENT_ONLY|UNASSIGNED_EVENT_ONLY|作者专用笔记/)
  }
  const ai = {
    modelFor: async () => 'offline-long-book-model',
    complete: async (_instruction: string, _draft: string, context: string, task: string) => {
      assert.equal(task, 'review')
      checkContext(context)
      modelCalls.push({ task, contextHash: hash(context) })
      return { content: review }
    },
    streamComplete: async (instruction: string, _draft: string, context: string, task: string, _signal?: AbortSignal, _model?: string, onDelta?: (delta: string, content: string) => void | Promise<void>) => {
      assert.equal(task, 'prose')
      assert.match(instruction, /白衡在城门外发现脚印/)
      checkContext(context)
      modelCalls.push({ task, contextHash: hash(context) })
      await onDelta?.(prose, prose)
      return { content: prose }
    }
  } as unknown as AiClient
  const createRunner = () => new WritingAgentService(ai, f.projects, f.documents, f.workspace, new ChapterDraftService(ai, f.documents, f.workspace))
  const runner = createRunner()
  const tasks = new WritingAgentTaskService(runner, f.projects, f.databases)
  cancelTasks = () => tasks.cancelAll()
  const sourcesMs: number[] = []
  const readSources = f.workspace.promptContextCandidates.bind(f.workspace)
  f.workspace.promptContextCandidates = async (...args) => {
    const start = performance.now()
    const sources = await readSources(...args)
    sourcesMs.push(Math.round(performance.now() - start))
    return sources
  }
  const before = hash(JSON.stringify(await f.documents.chapters()))
  const nonTaskHash = () => {
    const db = new DatabaseSync(join(f.project.path, WORKSPACE_DATABASE_RELATIVE_PATH), { readOnly: true, allowExtension: false })
    try {
      const excluded = new Set(['task_runs', 'context_packages', 'generation_artifacts'])
      const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>
      return Object.fromEntries(tables.filter(table => !excluded.has(table.name)).map(table => [table.name, hash(JSON.stringify(db.prepare(`SELECT * FROM "${table.name}" ORDER BY rowid`).all()))]))
    } finally { db.close() }
  }
  const beforeData = nonTaskHash()
  const samples: Array<{ previewMs: number; taskMs: number }> = []
  const completed: Array<Awaited<ReturnType<typeof tasks.status>>> = []
  const request = { chapterId: 113, message: '继续本章', currentDraft: '', preferredSkill: 'continue' as const, expectedWorkItemId: f.project.id }
  let expectedHash = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const previewStart = performance.now()
    const preview = await runner.preview(request)
    const previewMs = Math.round(performance.now() - previewStart)
    assert.equal(preview.status, 'ready')
    assert.ok(preview.items.filter(item => item.required).every(item => item.included && item.mode === 'full'))
    if (expectedHash) assert.equal(preview.contentHash, expectedHash)
    expectedHash = preview.contentHash
    const taskStart = performance.now()
    const started = await tasks.start({ operationId: randomUUID(), request: { ...request, expectedContextHash: expectedHash } })
    let result = await tasks.status(started.id)
    while (!['succeeded', 'failed', 'cancelled', 'interrupted'].includes(result.status) && performance.now() - taskStart < 120_000) {
      await new Promise(resolve => setTimeout(resolve, 25))
      result = await tasks.status(started.id)
    }
    assert.equal(result.status, 'succeeded', JSON.stringify(result.error))
    assert.equal(result.workItemId, f.project.id)
    assert.equal(result.chapterId, 113)
    assert.equal(result.turn?.proposal?.report.reviewMode, 'full')
    assert.equal(result.turn?.proposal?.content, prose)
    assert.equal(result.artifact?.status, 'complete')
    const persisted = await f.databases.openExisting(f.project.path)
    assert.ok(persisted)
    try {
      const frozen = JSON.parse(persisted.contextPackageForTask(result.id)!.contentJson)
      assert.equal(frozen.contextCompilation.contentHash, expectedHash)
      assert.equal(result.turn!.proposal!.contract.version.fingerprint, contract.fingerprint)
    } finally { persisted.close() }
    samples.push({ previewMs, taskMs: Math.round(performance.now() - taskStart) })
    completed.push(result)
  }
  assert.deepEqual(modelCalls.map(call => call.task), ['prose', 'review', 'prose', 'review', 'prose', 'review'])
  assert.equal(new Set(modelCalls.map(call => call.contextHash)).size, 1)
  const restarted = new WritingAgentTaskService(createRunner(), f.projects, f.databases)
  for (const saved of completed) assert.deepEqual(await restarted.status(saved.id), saved)
  console.info('isolated long-book full-task benchmark', JSON.stringify({ priorChapters: 112, manuscriptCharacters: body.length * 112, queryTerms: factPack.queryTerms.length, sourcesMs, samples, modelCalls: modelCalls.length }))
  assert.equal(hash(JSON.stringify(await f.documents.chapters())), before)
  assert.deepEqual(nonTaskHash(), beforeData)
  assert.equal(sourcesMs.length, 6)
  assert.ok(sourcesMs.every(duration => duration < 60_000))
  assert.ok(samples.every(sample => sample.taskMs < 120_000))
})

test('chapter prose and review retain event fields and source IDs without copied excerpts or other chapter plans', async t => {
  const f = await eventSourceFixture(t)
  const storedBefore = await f.library.listEvents()
  const rawPackBefore = await f.workspace.contextFactPack(10)
  assert.match(JSON.stringify(rawPackBefore), /SOURCE_ONLY_SECRET/)
  for (const task of ['prose', 'review'] as const) {
    const early = await f.workspace.promptContext(10, task)
    assert.doesNotMatch(early, /SOURCE_ONLY_SECRET|FUTURE_EVENT_ONLY|UNASSIGNED_EVENT_ONLY|秘密标记/)
    assert.match(early, /白衡在城门外发现脚印/)
    assert.match(early, /走到酒馆门前/)
    assert.ok(early.includes(f.source.id))
    assert.match(await f.workspace.promptContext(20, task), /FUTURE_EVENT_ONLY/)
    assert.match(await f.workspace.promptContext(20, task), /秘密标记：白衡是城主/)
  }
  // Planning and author-facing evidence still explain where the event came from.
  assert.match(await f.workspace.promptContext(10, 'chapterOutline'), /SOURCE_ONLY_SECRET|FUTURE_EVENT_ONLY/)
  assert.match(await f.workspace.promptContext(undefined, 'review'), /SOURCE_ONLY_SECRET/)
  assert.deepEqual(await f.library.listEvents(), storedBefore)
  assert.deepEqual(await f.workspace.contextFactPack(10), rawPackBefore)
  await f.documents.reorderChapter(20, 1)
  assert.doesNotMatch(await f.workspace.promptContext(10, 'prose'), /FUTURE_EVENT_ONLY|SOURCE_ONLY_SECRET/)
  assert.match(await f.workspace.promptContext(20, 'prose'), /FUTURE_EVENT_ONLY/)
})

test('actual writer and full reviewer receive the same excerpt-free event context and reassignment invalidates preview', async t => {
  const f = await eventSourceFixture(t)
  // Readiness is unrelated to the projection; all context and model orchestration are real.
  f.workspace.foundationStatus = async () => ({ readyForProse: true, missing: [] }) as never
  f.workspace.chapterContractVersion = async () => ({ fingerprint: 'contract', totalFingerprint: 'total', outlineHash: 'outline', eventIds: [f.current.id], confirmedAt: '2026-09-29T00:00:00.000Z' })
  const profile = f.workspace.bookProfile.bind(f.workspace)
  f.workspace.bookProfile = async () => ({ ...await profile(), targetWordsPerChapter: 300 })
  const calls: Array<{ task: string; context: string; instruction: string }> = []
  const ai = { modelFor: async () => 'offline-stub', complete: async (instruction: string, _draft: string, context: string, task: string) => {
    calls.push({ task, context, instruction })
    return { content: task === 'review' ? review : prose }
  } }
  const runner = new WritingAgentService(ai as never, f.projects, f.documents, f.workspace, new ChapterDraftService(ai as never, f.documents, f.workspace))
  const input = { chapterId: 10, currentDraft: '', message: '继续本章', preferredSkill: 'continue' as const }
  const preview = await runner.preview(input)
  const prepared = await runner.prepare({ ...input, expectedContextHash: preview.contentHash })
  const result = await runner.run(input, undefined, prepared)
  assert.equal(result.proposal!.report.reviewMode, 'full')
  assert.deepEqual(calls.map(call => call.task), ['prose', 'review'])
  assert.equal(calls[0].context, calls[1].context)
  for (const call of calls) {
    assert.doesNotMatch(call.context + call.instruction, /SOURCE_ONLY_SECRET|FUTURE_EVENT_ONLY|UNASSIGNED_EVENT_ONLY/)
    assert.match(call.instruction, /白衡在城门外发现脚印/)
  }
  await f.planning.placeEventInChapter(f.future.id, 10)
  await assert.rejects(runner.prepare({ ...input, expectedContextHash: preview.contentHash }), { code: 'CONFLICT' })
  assert.match(await f.workspace.promptContext(10, 'prose'), /FUTURE_EVENT_ONLY/)
  assert.equal(calls.length, 2)
})

test('actual storage and workspace use approved projected lore, preserve legacy data, and follow reordered/deleted chapters', async t => {
  const f = await fixture(t)
  const read = (id: number) => f.workspace.promptContext(id, 'prose')
  assert.doesNotMatch(await read(10), /秘密标记|作者专用笔记|candidate不能入提示词|archived不能入提示词/)
  assert.match(await read(20), /秘密标记：白衡是城主/)
  assert.doesNotMatch(await f.workspace.planningMaterials(), /作者专用笔记|秘密标记/)
  const before = await f.workspace.currentWorldbookFingerprint()
  await f.documents.reorderChapter(20, 1)
  assert.notEqual(await f.workspace.currentWorldbookFingerprint(), before)
  assert.match(await read(10), /秘密标记/)
  await f.documents.deleteChapter(20)
  assert.doesNotMatch(await read(10), /秘密标记/)
  const renamed = await f.authority.saveStoryEntity(f.project.path, { ...f.entity, canonicalName: '白衡改名' })
  assert.equal(renamed.id, f.entity.id)
  assert.deepEqual(JSON.parse(renamed.profileJson).legacy, { preserved: true })
  await assert.rejects(f.authority.saveStoryEntity(f.project.path, { ...renamed, profileJson: '{"worldbook":{"version":2}}' }), { code: 'VALIDATION_ERROR' })
  assert.equal((await f.authority.storyEntities(f.project.path)).find(item => item.id === renamed.id)!.profileJson, renamed.profileJson)
})

test('real context compiler, writer and full review use the same safe lore and invalidate stale preview or running generation', async t => {
  const f = await fixture(t)
  // Only the already-tested planning readiness gate is stubbed; context, storage,
  // compiler, writing orchestration, prose and review services are real.
  f.workspace.foundationStatus = async () => ({ readyForProse: true, missing: [] }) as never
  f.workspace.chapterEvents = async () => []
  f.workspace.chapterContractVersion = async () => ({ fingerprint: 'contract', totalFingerprint: 'total', outlineHash: 'outline', eventIds: [], confirmedAt: '2026-09-28T00:00:00.000Z' })
  const originalProfile = f.workspace.bookProfile.bind(f.workspace)
  f.workspace.bookProfile = async () => ({ ...await originalProfile(), targetWordsPerChapter: 300 })
  const calls: Array<{ task: string; context: string }> = []
  let during: (() => Promise<void>) | undefined
  const ai = { modelFor: async () => 'offline-stub', complete: async (_instruction: string, _draft: string, context: string, task: string) => {
    calls.push({ task, context }); await during?.(); during = undefined
    return { content: task === 'review' ? review : prose }
  } }
  const drafts = new ChapterDraftService(ai as never, f.documents, f.workspace)
  const runner = new WritingAgentService(ai as never, f.projects, f.documents, f.workspace, drafts)
  const input = { chapterId: 10, currentDraft: '', message: '继续本章', preferredSkill: 'continue' as const }
  const preview = await runner.preview(input)
  const prepared = await runner.prepare({ ...input, expectedContextHash: preview.contentHash })
  const result = await runner.run(input, undefined, prepared)
  assert.equal(result.proposal!.report.reviewMode, 'full')
  assert.deepEqual(calls.map(item => item.task), ['prose', 'review'])
  assert.equal(calls[0].context, calls[1].context)
  assert.match(calls[0].context, /公开设定：在旧城教书/)
  assert.doesNotMatch(calls[0].context, /秘密标记|作者专用笔记/)
  assert.equal(worldbookContextVersion(calls[0].context), await f.workspace.currentWorldbookFingerprint())
  assert.ok(preview.items.some(item => item.sourceType === 'worldbook-entry' && item.required && item.included))
  await f.authority.saveStoryEntity(f.project.path, { ...f.entity, canonicalName: '白衡新名' })
  await assert.rejects(runner.prepare({ ...input, expectedContextHash: preview.contentHash }), { code: 'CONFLICT' })
  await assert.rejects(runner.run(input, undefined, prepared), { code: 'CONFLICT' })
  assert.equal(calls.length, 2)
  during = async () => { await f.authority.saveStoryEntity(f.project.path, { ...f.entity, canonicalName: '白衡再改' }) }
  await assert.rejects(runner.run(input), { code: 'CONFLICT' })
  assert.equal(calls.length, 3, 'a changed worldbook must stop before review dispatch')
})

test('storage rejects stale adoption atomically and retains candidates; an applied receipt can be retried after later edits', async t => {
  const f = await fixture(t)
  const context = await f.workspace.promptContext(10, 'prose')
  const db = (await f.databases.openExisting(f.project.path))!
  try {
  const base = db.formalChapters().find(item => item.legacyChapterId === 10)!
  const checkpoint = JSON.stringify({ workItemId: f.project.id, request: { chapterId: 10, currentDraft: base.content } })
  db.createTaskRun({ id: 'worldbook-task', legacyChapterId: 10, taskType: 'writing_agent', idempotencyKey: 'worldbook-op', contentHash: base.contentHash, checkpointJson: checkpoint })
  db.transitionTaskRun({ id: 'worldbook-task', status: 'running' })
  const frozen = JSON.stringify({ contexts: [{ task: 'prose', content: context }] })
  db.createContextPackage({ id: 'worldbook-context', taskRunId: 'worldbook-task', compilerVersion: 'context-compiler-v1', contentJson: frozen, contentHash: hash(frozen), tokenBudget: 64000, estimatedTokens: 1000, truncationJson: '{}' })
  db.completeTaskRunWithArtifact('worldbook-task', checkpoint, { id: 'worldbook-artifact', taskRunId: 'worldbook-task', artifactType: 'writing_agent_turn', status: 'complete', content: prose, contentHash: hash(prose), schemaValid: true, metadataJson: '{}' })
  const input = { taskRunId: 'worldbook-task', artifactId: 'worldbook-artifact', artifactType: 'writing_agent_turn' as const, legacyChapterId: 10, title: base.title, content: prose, expectedRevision: base.revision, metadataJson: '{}' }
  db.upsertEntity({ ...f.entity, canonicalName: '变更后' })
  assert.throws(() => db.applyWritingAgentArtifact(input), { code: 'CONFLICT' })
  assert.equal(db.formalChapters().find(item => item.legacyChapterId === 10)!.content, base.content)
  assert.equal(db.generationArtifactForTask('worldbook-task', 'writing_agent_turn')!.status, 'complete')
  db.upsertEntity(f.entity)
  const applied = db.applyWritingAgentArtifact(input)
  assert.equal(applied.insertedVersion, true)
  db.upsertEntity({ ...f.entity, canonicalName: '采用后修改' })
  assert.equal(db.applyWritingAgentArtifact(input).insertedVersion, false)
  } finally { db.close() }
})
