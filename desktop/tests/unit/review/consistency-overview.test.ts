import assert from 'node:assert/strict'
import test from 'node:test'
import { buildConsistencyOverview } from '../../../src/main/modules/review/domain/consistency-overview'
import { auditLiterarySuggestions } from '../../../src/main/modules/review/domain/literary-suggestions'
import { consistencyGuidance } from '../../../src/renderer/features/review/services/consistency-guidance'
import type { CharacterStateView, OutlinePlanningStatus, WorkflowStatus } from '../../../src/contracts/index'

const fingerprint = 'a'.repeat(64)

function workflow(readyForProse: boolean, missingForProse: string[] = []): WorkflowStatus {
  return {
    creationPath: 'materials', completed: readyForProse ? 6 : 4, total: 6,
    currentStep: readyForProse ? null : 'chapterPlan',
    steps: [{ id: 'foundation', label: '设定', state: 'complete', detail: '世界边界与启用的体系已具备', missing: [], target: 'world' }],
    readyForChapterOutline: true,
    readyForProse, missingForChapterOutline: [], missingForProse
  }
}

function planning(): OutlinePlanningStatus {
  return {
    totalRevision: 3, totalOutlineExists: true, externalChangeDetected: false,
    totalReview: { scope: 'total', status: 'clear', issues: [], metrics: { characterCount: 500, sectionCount: 5, causalCueCount: 4, eventCount: 1, chapterCount: 1 }, fingerprint },
    totalApproval: { scope: 'total', status: 'confirmed', canConfirm: false, reason: '本版正式确认', fingerprint, confirmedAt: '2026-08-27T00:00:00.000Z' },
    assignedEventIds: ['event-1'], unplacedEventIds: [], volumes: [], chapterPlacements: [],
    eventChapterPlacements: [{ eventId: 'event-1', chapterId: 7 }],
    chapter: {
      chapterId: 7, hasContent: true, basedOnTotalRevision: 3, stale: false, reason: 'current',
      review: { status: 'confirmed', canConfirm: false, issues: [], metrics: { beatCount: 3, forbiddenCount: 1, formalEventCount: 1, boundaryCount: 3, foreshadowCount: 1 }, confirmedAt: '2026-08-27T00:00:00.000Z' },
      contractVersion: { fingerprint, totalFingerprint: fingerprint, outlineHash: fingerprint, eventIds: ['event-1'], confirmedAt: '2026-08-27T00:00:00.000Z' }
    }
  }
}

test('unlinked events are optional and lead to outline associations, not a timeline confirmation loop', () => {
  const state = planning()
  state.assignedEventIds = []
  state.eventChapterPlacements = []
  const overview = buildConsistencyOverview({ workflow: workflow(true), planning: state, chapterId: 7 })
  const events = overview.items.find(item => item.id === 'events')!
  assert.equal(events.status, 'attention')
  assert.equal(events.target, 'outline')
  assert.match(events.summary, /无需在纪事中重复确认/)
  assert.equal(overview.readyForProse, true)
  const guidance = consistencyGuidance(overview)
  assert.equal(guidance.requiredItem, undefined)
  assert.match(guidance.heading, /无需额外确认/)
  assert.match(guidance.optionalNote, /可选建议/)
  assert.match(guidance.optionalNote, /尚未检查/)
})

test('deferred checks are not called passed and do not replace the writing action', () => {
  const overview = buildConsistencyOverview({ workflow: workflow(true), planning: planning(), chapterId: 7 })
  const guidance = consistencyGuidance(overview)
  assert.equal(guidance.requiredItem, undefined)
  assert.match(guidance.optionalNote, /尚未检查/)
  assert.doesNotMatch(guidance.heading, /检查已通过/)
})

test('actual missing chapter confirmation still takes priority over optional event advice', () => {
  const state = planning()
  state.assignedEventIds = []
  state.chapter!.review.status = 'stale'
  const overview = buildConsistencyOverview({ workflow: workflow(false, ['当前章节大纲已过期']), planning: state, chapterId: 7 })
  const guidance = consistencyGuidance(overview)
  assert.equal(overview.readyForProse, false)
  assert.equal(guidance.requiredItem?.id, 'chapterOutline')
  assert.equal(guidance.requiredItem?.target, 'outline')
  assert.match(guidance.heading, /先处理/)
})

test('workflow-only prerequisites never claim AI readiness even without a blocked consistency row', () => {
  const overview = buildConsistencyOverview({ workflow: workflow(false, ['作品定义']), planning: planning(), chapterId: 7 })
  const guidance = consistencyGuidance(overview)
  assert.equal(guidance.requiredItem, undefined)
  assert.match(guidance.heading, /AI 生成还需准备/)
  assert.equal(guidance.description, '作品定义')
})

test('projects confirmed planning layers into a prose-ready overview without treating deferred character state as checked', () => {
  const overview = buildConsistencyOverview({ workflow: workflow(true), planning: planning(), chapterId: 7, chapterPosition: 2 })
  assert.equal(overview.status, 'ready')
  assert.equal(overview.readyForProse, true)
  assert.equal(overview.chapterPosition, 2)
  assert.equal(overview.items.find((item) => item.id === 'chapterContract')?.fingerprint, fingerprint)
  assert.equal(overview.items.find((item) => item.id === 'characterState')?.status, 'deferred')
  assert.deepEqual(overview.blockers, [])
})

test('locates stale upstream and contract failures instead of returning one generic blocked flag', () => {
  const state = planning()
  state.totalRevision = 4
  state.totalApproval = { ...state.totalApproval, status: 'stale', reason: '总纲变化' }
  state.chapter = { ...state.chapter!, stale: true, reason: 'upstream-changed', review: { ...state.chapter!.review, status: 'stale' }, contractVersion: undefined }
  const overview = buildConsistencyOverview({
    workflow: workflow(false, ['当前章节大纲已过期']), planning: state, chapterId: 7, chapterPosition: 2
  })
  assert.equal(overview.status, 'blocked')
  assert.equal(overview.readyForProse, false)
  assert.match(overview.items.find((item) => item.id === 'totalOutline')?.summary || '', /第 4 版/)
  assert.equal(overview.items.find((item) => item.id === 'chapterOutline')?.status, 'blocked')
  assert.equal(overview.items.find((item) => item.id === 'chapterContract')?.status, 'blocked')
  assert.deepEqual(new Set(overview.blockers), new Set(['当前章节大纲已过期', '全局总纲确认已失效', '章节契约尚未锁定']))
})

test('keeps an unassigned volume as an explicit non-blocking short-work state', () => {
  const overview = buildConsistencyOverview({ workflow: workflow(true), planning: planning(), chapterId: 7 })
  const volume = overview.items.find((item) => item.id === 'volumeOutline')
  assert.equal(volume?.status, 'deferred')
  assert.match(volume?.summary || '', /短篇可只受总纲约束/)
  assert.equal(overview.readyForProse, true)
})

test('projects accepted-prose character evidence without turning it into a prose gate', () => {
  const characterState: CharacterStateView = {
    version: 1,
    workItemId: 'book-a',
    anchors: [{ id: 'character-shenyan', name: '沈砚', sourceRefs: ['event-1'] }],
    events: [{
      id: 'state-1', characterId: 'character-shenyan', chapterId: 7, chapterPosition: 2,
      manuscriptRevision: fingerprint, proposalId: 'proposal-1', acceptedAt: '2026-08-27T00:00:00.000Z',
      evidence: '沈砚停在临江酒馆门外。', active: true, changes: { present: true, location: '临江酒馆' }
    }],
    snapshots: [{ characterId: 'character-shenyan', name: '沈砚', throughChapter: 2, present: true, location: '临江酒馆', lastEventId: 'state-1' }],
    pendingConflicts: []
  }
  const overview = buildConsistencyOverview({ workflow: workflow(true), planning: planning(), chapterId: 7, chapterPosition: 2, characterState })
  const item = overview.items.find((entry) => entry.id === 'characterState')
  assert.equal(item?.status, 'ready')
  assert.match(item?.summary || '', /本章已结算 1 名人物/)
  assert.equal(overview.readyForProse, true)
})

test('surfaces stable character conflicts as attention without blocking prose generation', () => {
  const characterState: CharacterStateView = {
    version: 1,
    workItemId: 'book-a',
    anchors: [{ id: 'character-shenyan', name: '沈砚', sourceRefs: ['event-1'] }],
    events: [{
      id: 'state-1', characterId: 'character-shenyan', chapterId: 7, chapterPosition: 2,
      manuscriptRevision: fingerprint, proposalId: 'proposal-1', acceptedAt: '2026-08-27T00:00:00.000Z',
      evidence: '沈砚停在临江酒馆门外。', active: true, changes: { present: true, location: '临江酒馆门外', knowledge: ['确认脚印通往酒馆'] }
    }],
    snapshots: [{ characterId: 'character-shenyan', name: '沈砚', throughChapter: 2, present: true, location: '临江酒馆门外', knowledge: ['确认脚印通往酒馆'], lastEventId: 'state-1' }],
    pendingConflicts: [{
      id: 'conflict-1', characterId: 'character-shenyan', name: '沈砚', field: 'identity', claimedValue: '并非沈家后人',
      chapterId: 7, chapterPosition: 2, manuscriptRevision: fingerprint, proposalId: 'proposal-1',
      evidence: '沈砚说自己并非沈家后人。', status: 'pending'
    }]
  }
  const overview = buildConsistencyOverview({ workflow: workflow(true), planning: planning(), chapterId: 7, chapterPosition: 2, characterState })
  const item = overview.items.find((entry) => entry.id === 'characterState')
  assert.equal(item?.status, 'attention')
  assert.match(item?.summary || '', /1 项身份、动机或人物弧冲突/)
  assert.equal(overview.status, 'attention')
  assert.equal(overview.readyForProse, true)
  assert.deepEqual(overview.blockers, [])
})

test('blocks prose when accepted character history skips configured realms', () => {
  const characterState: CharacterStateView = {
    version: 1,
    workItemId: 'book-a',
    anchors: [{ id: 'character-shenyan', name: '沈砚', sourceRefs: ['event-1'] }],
    events: [
      {
        id: 'state-1', characterId: 'character-shenyan', chapterId: 6, chapterPosition: 1,
        manuscriptRevision: fingerprint, proposalId: 'proposal-1', acceptedAt: '2026-08-27T00:00:00.000Z',
        evidence: '沈砚稳在炼气一层。', active: true, changes: { present: true, power: '炼气一层' }, changeEvidence: { power: '沈砚稳在炼气一层。' }
      },
      {
        id: 'state-2', characterId: 'character-shenyan', chapterId: 7, chapterPosition: 2,
        manuscriptRevision: fingerprint, proposalId: 'proposal-2', acceptedAt: '2026-08-27T01:00:00.000Z',
        evidence: '沈砚已是筑基初期。', active: true, changes: { present: true, power: '筑基初期' }, changeEvidence: { power: '沈砚已是筑基初期。' }
      }
    ],
    snapshots: [{ characterId: 'character-shenyan', name: '沈砚', throughChapter: 2, present: true, power: '筑基初期', lastEventId: 'state-2' }],
    pendingConflicts: []
  }
  const realms = [
    { id: 'realm-1', name: '炼气一层', description: '' },
    { id: 'realm-2', name: '炼气二层', description: '' },
    { id: 'realm-3', name: '筑基初期', description: '' }
  ]
  const overview = buildConsistencyOverview({ workflow: workflow(true), planning: planning(), chapterId: 7, chapterPosition: 2, characterState, realms })
  const item = overview.items.find((entry) => entry.id === 'characterState')
  assert.equal(item?.status, 'blocked')
  assert.equal(item?.findings?.[0].code, 'POWER_SKIP')
  assert.equal(overview.status, 'blocked')
  assert.equal(overview.readyForProse, false)
  assert.match(overview.blockers.join('；'), /越过了 1 个已定义境界/)
})

test('keeps a suspicious location jump visible without turning a weak cue into a prose blocker', () => {
  const characterState: CharacterStateView = {
    version: 1,
    workItemId: 'book-a',
    anchors: [{ id: 'character-shenyan', name: '沈砚', sourceRefs: ['event-1'] }],
    events: [
      {
        id: 'state-1', characterId: 'character-shenyan', chapterId: 6, chapterPosition: 1,
        manuscriptRevision: fingerprint, proposalId: 'proposal-1', acceptedAt: '2026-08-27T00:00:00.000Z',
        evidence: '沈砚留在临江酒馆。', active: true, changes: { present: true, location: '临江酒馆' }, changeEvidence: { location: '沈砚留在临江酒馆。' }
      },
      {
        id: 'state-2', characterId: 'character-shenyan', chapterId: 7, chapterPosition: 2,
        manuscriptRevision: fingerprint, proposalId: 'proposal-2', acceptedAt: '2026-08-27T01:00:00.000Z',
        evidence: '沈砚站在北境雪原。', active: true, changes: { present: true, location: '北境雪原' }, changeEvidence: { location: '沈砚站在北境雪原。' }
      }
    ],
    snapshots: [{ characterId: 'character-shenyan', name: '沈砚', throughChapter: 2, present: true, location: '北境雪原', lastEventId: 'state-2' }],
    pendingConflicts: []
  }
  const overview = buildConsistencyOverview({ workflow: workflow(true), planning: planning(), chapterId: 7, chapterPosition: 2, characterState })
  const item = overview.items.find((entry) => entry.id === 'characterState')
  assert.equal(item?.status, 'attention')
  assert.equal(item?.findings?.[0].code, 'LOCATION_JUMP')
  assert.equal(overview.readyForProse, true)
  assert.deepEqual(overview.blockers, [])
})

test('stops surfacing a character conflict after the author dismisses the cited false positive', () => {
  const characterState: CharacterStateView = {
    version: 1,
    workItemId: 'book-a',
    anchors: [{ id: 'character-shenyan', name: '沈砚', sourceRefs: ['event-1'] }],
    events: [{
      id: 'state-1', characterId: 'character-shenyan', chapterId: 7, chapterPosition: 2,
      manuscriptRevision: fingerprint, proposalId: 'proposal-1', acceptedAt: '2026-08-27T00:00:00.000Z',
      evidence: '沈砚停在临江酒馆门外。', active: true, changes: { present: true, location: '临江酒馆门外' }
    }],
    snapshots: [{ characterId: 'character-shenyan', name: '沈砚', throughChapter: 2, present: true, location: '临江酒馆门外', lastEventId: 'state-1' }],
    pendingConflicts: [{
      id: 'conflict-0123456789abcdef01234567', characterId: 'character-shenyan', name: '沈砚', field: 'identity', claimedValue: '并非沈家后人',
      chapterId: 7, chapterPosition: 2, manuscriptRevision: fingerprint, proposalId: 'proposal-1',
      evidence: '沈砚说自己并非沈家后人。', status: 'dismissed'
    }]
  }
  const overview = buildConsistencyOverview({ workflow: workflow(true), planning: planning(), chapterId: 7, chapterPosition: 2, characterState })
  const item = overview.items.find((entry) => entry.id === 'characterState')
  assert.equal(item?.status, 'ready')
  assert.match(item?.summary || '', /本章已结算 1 名人物/)
  assert.doesNotMatch(item?.summary || '', /冲突/)
})

test('does not present superseded character history as a current snapshot', () => {
  const characterState: CharacterStateView = {
    version: 1,
    workItemId: 'book-a',
    anchors: [{ id: 'character-shenyan', name: '沈砚', sourceRefs: ['event-1'] }],
    events: [{
      id: 'state-1', characterId: 'character-shenyan', chapterId: 7, chapterPosition: 2,
      manuscriptRevision: fingerprint, proposalId: 'proposal-1', acceptedAt: '2026-08-27T00:00:00.000Z',
      evidence: '沈砚停在临江酒馆门外。', active: false, changes: { present: true, location: '临江酒馆门外' }
    }],
    snapshots: [{ characterId: 'character-shenyan', name: '沈砚', throughChapter: 0, present: false, lastEventId: '' }],
    pendingConflicts: [{
      id: 'conflict-1', characterId: 'character-shenyan', name: '沈砚', field: 'identity', claimedValue: '并非沈家后人',
      chapterId: 7, chapterPosition: 2, manuscriptRevision: fingerprint, proposalId: 'proposal-1',
      evidence: '沈砚说自己并非沈家后人。', status: 'superseded'
    }]
  }
  const overview = buildConsistencyOverview({ workflow: workflow(true), planning: planning(), chapterId: 7, chapterPosition: 2, characterState })
  const item = overview.items.find((entry) => entry.id === 'characterState')
  assert.equal(item?.status, 'attention')
  assert.match(item?.summary || '', /当前正文没有可重放的人物动态状态/)
  assert.doesNotMatch(item?.summary || '', /本章已结算/)
  assert.equal(overview.readyForProse, true)
})

test('shows literary suggestions as optional attention without blocking prose', () => {
  const literaryFindings = auditLiterarySuggestions('同一段较长的正文被意外保留了两次。\n\n同一段较长的正文被意外保留了两次。', 2)
  const overview = buildConsistencyOverview({
    workflow: workflow(true), planning: planning(), chapterId: 7, chapterPosition: 2, literaryFindings
  })
  const item = overview.items.find((entry) => entry.id === 'literaryStyle')
  assert.equal(item?.status, 'attention')
  assert.equal(item?.findings?.[0].layer, 'literary')
  assert.equal(overview.status, 'attention')
  assert.equal(overview.readyForProse, true)
  assert.deepEqual(overview.blockers, [])
})
