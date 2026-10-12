import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppError } from '../../../src/main/core/errors/app-error'
import type { CanonicalEvent, OutlinePlanningStatus, TimelineEvent } from '../../../src/contracts/index'
import type { WorldMapEvent, WorldMapLayoutView } from '../../../src/contracts/world-map/world-map'
import type { UnifiedEventProjection } from '../../../src/main/modules/timeline/domain/event-projection'
import type { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { WorkspaceService } from '../../../src/main/modules/library/application/workspace-service'
import { WorldMapWorkspaceService } from '../../../src/main/modules/world-map/application/world-map-workspace-service'

async function fixture(run: (first: string, second: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-world-map-view-'))
  const first = join(root, 'first'), second = join(root, 'second')
  try { await mkdir(first); await mkdir(second); await run(first, second) }
  finally { await rm(root, { recursive: true, force: true }) }
}
function projectPort(path: string) {
  const state = { path, id: 'book-a' }
  return { state, currentPath: async () => state.path, currentSummary: async () => ({ path: state.path, id: state.id }) }
}
const canonical = (patch: Partial<CanonicalEvent> = {}): CanonicalEvent => ({
  id: 'same', time: '三日后，黄昏', characters: ['沈砚', '林照'], location: '旧塔', event: '找到一封信。信还未拆开。',
  evidenceRefs: [], confidence: 1, status: 'approved', createdAt: '2026-09-08T00:00:00Z', ...patch
})
const direct = (patch: Partial<TimelineEvent> = {}): TimelineEvent => ({
  id: 'same', title: '手写纪事', time: '更早以前', characters: '沈砚、林照', location: '河口', event: '告别渡船', ...patch
})
const planning = (placements: OutlinePlanningStatus['eventChapterPlacements']): OutlinePlanningStatus => ({
  totalRevision: 1, totalOutlineExists: true, externalChangeDetected: false,
  totalReview: { scope: 'total', status: 'clear', issues: [], metrics: { characterCount: 0, sectionCount: 0, causalCueCount: 0, eventCount: 0, chapterCount: 0 }, fingerprint: '' },
  totalApproval: { scope: 'total', status: 'confirmed', canConfirm: false, reason: '', fingerprint: '' },
  assignedEventIds: [], unplacedEventIds: [], volumes: [], chapterPlacements: [], eventChapterPlacements: placements
})
function workspace(port: ReturnType<typeof projectPort>, events: () => Promise<CanonicalEvent[]>, timeline: TimelineEvent[], placements: OutlinePlanningStatus['eventChapterPlacements'] = [], projection?: () => Promise<UnifiedEventProjection | null>) {
  const service = new WorkspaceService(port as unknown as ProjectService, { status: async () => planning(placements) }, { listEvents: async () => ({ events: await events() }) }, undefined, undefined, undefined, undefined, projection ? { read: projection } : undefined)
  service.timeline = async () => ({ events: timeline })
  return service
}
const unified = (event = '统一正式事件', candidate = '统一待审事件'): UnifiedEventProjection => ({
  version: 1, workItemId: 'book-a', revision: 'a'.repeat(64), approvedRevision: 'b'.repeat(64), candidateRevision: 'c'.repeat(64),
  operationId: '00000000-0000-4000-8000-000000000001:1', committedAt: '2026-09-20T00:00:00Z', ordering: 'author-display',
  state: {
    order: { id: 'order-1', revision: 1, eventIds: ['unified', 'candidate'], contentHash: 'd'.repeat(64), createdAt: '2026-09-20T00:00:00Z' },
    lifecycles: [
      { id: 'life-1', eventId: 'unified', revision: 1, expectedEventVersionId: 'version-1', state: 'active', createdAt: '2026-09-20T00:00:00Z' },
      { id: 'life-2', eventId: 'candidate', revision: 1, expectedEventVersionId: 'version-2', state: 'active', createdAt: '2026-09-20T00:00:00Z' }
    ]
  },
  approved: [{ eventId: 'unified', versionId: 'version-1', version: 1, content: { time: '第二幕', characters: ['沈砚'], location: '新塔', event, evidenceRefs: [], confidence: 1, title: '统一标题' }, granularity: 'macro', phase: 'planned', creator: 'author', sources: [], createdAt: '2026-09-20T00:00:00Z' }],
  candidates: [{ eventId: 'candidate', versionId: 'version-2', version: 1, content: { time: '第三幕', characters: ['林照'], location: '河口', event: candidate, evidenceRefs: [], confidence: 0.7 }, granularity: 'macro', phase: 'planned', creator: 'model-candidate', sources: [], createdAt: '2026-09-20T00:00:00Z' }],
  archived: [], mirror: null
})
const layout = (): WorldMapLayoutView => ({ workItemId: 'book-a', document: { version: 1, markers: [{ location: '旧塔', x: 25, y: 75 }] }, revision: 'a'.repeat(64), mirrorStatus: 'synced' })
const mapEvent = (patch: Partial<WorldMapEvent> = {}): WorldMapEvent => ({
  id: 'canonical:same', source: 'canonical', sourceId: 'same', title: '找到一封信', time: '三日后，黄昏', characters: ['沈砚'],
  location: '旧塔', event: '找到一封信', result: '', chapterId: 91, ...patch
})
const chapters = () => [{ id: 91, position: 1, title: '不是第九十一章' }, { id: 7, position: 2, title: '后章' }]
const isConflict = (error: unknown) => error instanceof AppError && error.code === 'CONFLICT'

test('map uses approved effective timeline, suppresses direct duplicates, and prefixes otherwise identical raw IDs', () => fixture(async root => {
  const confirmed = canonical()
  const service = workspace(projectPort(root), async () => [confirmed, canonical({ id: 'candidate', status: 'candidate', event: '没有批准' })], [
    direct(), direct({ id: 'copy', time: confirmed.time, characters: '林照，沈砚', location: confirmed.location, event: confirmed.event }),
    direct({ id: 'direct-copy' })
  ], [{ eventId: 'same', chapterId: 91 }])
  const result = await service.worldMapEvents()
  assert.deepEqual(result.map(item => item.id), ['canonical:same', 'direct:same'])
  assert.equal(result[0]!.chapterId, 91)
  assert.equal(result[1]!.chapterId, null)
  assert.equal(result[0]!.time, '三日后，黄昏')
  assert.deepEqual(result[1]!.characters, ['沈砚', '林照'])
  assert.equal(result[0]!.title, '找到一封信')
  assert.equal(result[1]!.title, '手写纪事')
}))

test('map does not infer unplaced canonical chapter from numbers in text', () => fixture(async root => {
  const result = await workspace(projectPort(root), async () => [canonical({ time: '第91章，三天后' })], []).worldMapEvents()
  assert.equal(result[0]!.chapterId, null)
}))

test('map reads one unified approved projection and never falls back to legacy or candidate rows', () => fixture(async root => {
  let legacyReads = 0
  const result = await workspace(projectPort(root), async () => { legacyReads++; return [canonical()] }, [direct()],
    [{ eventId: 'unified', chapterId: 91 }], async () => unified()).worldMapEvents()
  assert.equal(legacyReads, 0)
  assert.deepEqual(result.map(item => item.id), ['canonical:unified'])
  assert.equal(result[0]!.title, '统一正式事件')
  assert.equal(result[0]!.versionId, 'version-1')
  assert.equal(result[0]!.phase, 'planned')
  assert.equal(result[0]!.chapterId, 91)
}))

test('unified projection failure blocks the map instead of reading a second formal timeline', () => fixture(async root => {
  let legacyReads = 0
  const service = workspace(projectPort(root), async () => { legacyReads++; return [canonical()] }, [direct()], [], async () => {
    throw new AppError('DATABASE_INTEGRITY_FAILED', '统一事件损坏', { recoverable: false })
  })
  await assert.rejects(service.worldMapEvents(), { code: 'DATABASE_INTEGRITY_FAILED' })
  assert.equal(legacyReads, 0)
}))

test('chapter event consumers use the same unified approved version and reject dangling placements', () => fixture(async root => {
  const service = workspace(projectPort(root), async () => [canonical({ event: '旧事件不得读取' })], [direct()],
    [{ eventId: 'unified', chapterId: 91 }], async () => unified('本章统一事件', '候选不得读取'))
  const events = await service.chapterEvents(91)
  assert.equal(events.length, 1)
  assert.equal(events[0]!.id, 'unified')
  assert.equal(events[0]!.versionId, 'version-1')
  assert.equal(events[0]!.phase, 'planned')
  assert.equal(events[0]!.event, '本章统一事件')

  const dangling = workspace(projectPort(root), async () => [canonical()], [],
    [{ eventId: 'missing-approved-event', chapterId: 91 }], async () => unified())
  await assert.rejects(dangling.chapterEvents(91), { code: 'INVALID_PROJECT_STATE' })
}))

test('planning materials label unified phase and version while excluding candidates and compatibility copies', () => fixture(async root => {
  const service = workspace(projectPort(root), async () => [canonical({ event: '旧资料事件不得回退' })],
    [direct({ event: '旧作者纪事不得回退' })], [], async () => unified('规划正式事件', '规划候选不得进入'))
  const methods = service as unknown as Record<string, unknown>
  methods.foundation = async () => ({ sourceNotes: '' })
  methods.materialSources = async () => []
  methods.approvedIdeas = async () => []
  methods.formalStoryEntities = async () => ({ entities: [], relations: [] })
  methods.totalOutlineText = async () => ''
  const materials = await service.planningMaterials()
  assert.match(materials, /规划正式事件/)
  assert.match(materials, /"phase": "planned"/)
  assert.match(materials, /"versionId": "version-1"/)
  assert.match(materials, /"approvedRevision": "b{64}"/)
  assert.doesNotMatch(materials, /规划候选不得进入|旧资料事件不得回退|旧作者纪事不得回退/)
}))

test('writing context labels planned unified events and excludes candidates and compatibility copies', () => fixture(async root => {
  const service = workspace(projectPort(root), async () => [canonical({ event: '旧正式上下文不得回退' })],
    [direct({ event: '旧直接上下文不得回退' })], [], async () => unified('后续规划约束', '候选上下文不得进入'))
  const context = await service.promptContext(undefined, 'prose')
  assert.match(context, /phase=planned 是后续约束，不能作为前文已知事实/)
  assert.match(context, /后续规划约束/)
  assert.match(context, /"phase": "planned"/)
  assert.match(context, /"versionId": "version-1"/)
  assert.match(context, /"approvedRevision": "b{64}"/)
  assert.doesNotMatch(context, /候选上下文不得进入|旧正式上下文不得回退|旧直接上下文不得回退/)
}))

test('conflicting explicit event placements fail rather than arbitrarily selecting a chapter', () => fixture(async root => {
  const service = workspace(projectPort(root), async () => [canonical()], [], [{ eventId: 'same', chapterId: 91 }, { eventId: 'same', chapterId: 7 }])
  await assert.rejects(service.worldMapEvents(), (error: unknown) => error instanceof AppError && error.code === 'INVALID_PROJECT_STATE')
}))

test('event projection rejects a book switch and masks its old late error with a context conflict', () => fixture(async (root, other) => {
  const port = projectPort(root)
  const service = workspace(port, async () => { port.state.path = other; throw new AppError('STORAGE_ERROR', 'old source failure') }, [])
  await assert.rejects(service.worldMapEvents(), isConflict)
}))

test('event projection rejects same-path work-item replacement', () => fixture(async root => {
  const port = projectPort(root)
  const service = workspace(port, async () => { port.state.id = 'book-b'; return [canonical()] }, [])
  await assert.rejects(service.worldMapEvents(), isConflict)
}))

test('stable double snapshot joins explicit stable IDs, preserves display positions, and returns detached DTO data', () => fixture(async root => {
  const source = layout(), event = mapEvent(), chapterSource = chapters()
  let reads = 0
  const service = new WorldMapWorkspaceService(projectPort(root), { worldMapEvents: async () => { reads++; return [event] } }, { chapters: async () => chapterSource }, { read: async () => source })
  const result = await service.read()
  assert.equal(reads, 2)
  assert.equal(result.events[0]!.chapterId, 91)
  assert.deepEqual(result.chapters, chapterSource)
  result.events[0]!.characters.push('不应回写')
  result.document.markers[0]!.x = 50
  assert.deepEqual(event.characters, ['沈砚'])
  assert.equal(source.document.markers[0]!.x, 25)
}))

test('missing or archived chapter link is unavailable, never replaced with a matching display position', () => fixture(async root => {
  const service = new WorldMapWorkspaceService(projectPort(root), { worldMapEvents: async () => [mapEvent({ chapterId: 1 })] }, { chapters: async () => chapters() }, { read: async () => layout() })
  assert.equal((await service.read()).events[0]!.chapterId, null)
}))

for (const source of ['event', 'chapter', 'map'] as const) {
  test(`changed ${source} source between snapshots rejects mixed map state`, () => fixture(async root => {
    let eventReads = 0, chapterReads = 0, mapReads = 0
    const service = new WorldMapWorkspaceService(projectPort(root),
      { worldMapEvents: async () => [mapEvent({ title: source === 'event' ? String(++eventReads) : '不变' })] },
      { chapters: async () => chapters().map(chapter => ({ ...chapter, title: source === 'chapter' ? String(++chapterReads) : chapter.title })) },
      { read: async () => ({ ...layout(), revision: source === 'map' && ++mapReads > 1 ? 'b'.repeat(64) : 'a'.repeat(64) }) })
    await assert.rejects(service.read(), isConflict)
  }))
}

test('map layout belonging to another work item is rejected even when paths remain unchanged', () => fixture(async root => {
  const service = new WorldMapWorkspaceService(projectPort(root), { worldMapEvents: async () => [] }, { chapters: async () => [] }, { read: async () => ({ ...layout(), workItemId: 'book-b' }) })
  await assert.rejects(service.read(), isConflict)
}))

test('changed dangling explicit chapter links reject even if both would be unavailable in the view', () => fixture(async root => {
  let reads = 0
  const service = new WorldMapWorkspaceService(projectPort(root), { worldMapEvents: async () => [mapEvent({ chapterId: 1000 + ++reads })] }, { chapters: async () => chapters() }, { read: async () => layout() })
  await assert.rejects(service.read(), isConflict)
}))

test('aggregate rejects switched canonical root even if work-item id was reused', () => fixture(async (root, other) => {
  const port = projectPort(root)
  const service = new WorldMapWorkspaceService(port, { worldMapEvents: async () => { port.state.path = other; return [] } }, { chapters: async () => [] }, { read: async () => layout() })
  await assert.rejects(service.read(), isConflict)
}))

test('aggregate late source failure after work-item replacement is reported as context conflict', () => fixture(async root => {
  const port = projectPort(root)
  const service = new WorldMapWorkspaceService(port, { worldMapEvents: async () => { port.state.id = 'book-b'; throw new AppError('STORAGE_ERROR', 'old source failure') } }, { chapters: async () => [] }, { read: async () => layout() })
  await assert.rejects(service.read(), isConflict)
}))

test('unchanged book read error is preserved, never converted to an empty successful map', () => fixture(async root => {
  const failure = new AppError('STORAGE_ERROR', 'formal event read failed')
  const service = new WorldMapWorkspaceService(projectPort(root), { worldMapEvents: async () => { throw failure } }, { chapters: async () => [] }, { read: async () => layout() })
  await assert.rejects(service.read(), error => error === failure)
}))

test('aggregate validates source DTO rather than trusting malformed chapter metadata', () => fixture(async root => {
  const service = new WorldMapWorkspaceService(projectPort(root), { worldMapEvents: async () => [] }, { chapters: async () => [{ id: 91, position: 0, title: '无效顺序' }] }, { read: async () => layout() })
  await assert.rejects(service.read(), (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR')
}))
