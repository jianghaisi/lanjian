import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CharacterStateService } from '../../../src/main/modules/characters/application/character-state-service'
import type { Chapter, ChapterDraftProposal } from '../../../src/contracts/index'

async function fixture(): Promise<{ root: string; service: CharacterStateService; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-character-state-'))
  const service = new CharacterStateService({ currentPath: async () => root })
  return { root, service, cleanup: () => rm(root, { recursive: true, force: true }) }
}

const chapter: Chapter = {
  id: 7,
  position: 3,
  title: '城门旧雨',
  summary: '沈砚循迹到酒馆门外。',
  content: '雨后的城门泛着冷光。沈砚压低灯笼，循着脚印停在临江酒馆门外。',
  word_count: 31
}

const proposal: ChapterDraftProposal = {
  id: 'proposal-1',
  chapterId: 7,
  createdAt: '2026-08-27T00:00:00.000Z',
  content: chapter.content,
  contract: {
    chapterId: 7,
    chapterPosition: 3,
    outlineSnapshot: '进入状态：沈砚在长安城门\n1. 循迹到临江酒馆\n退出状态：停在酒馆门外',
    beats: [{ id: 'B1', order: 1, requirement: '循迹到临江酒馆' }],
    forbiddenEvents: [],
    entryState: '沈砚在长安城门',
    exitState: '停在酒馆门外',
    allowedFacts: ['雨夜追踪'],
    foreshadowActions: [],
    version: { fingerprint: 'a'.repeat(64), totalFingerprint: 'b'.repeat(64), outlineHash: 'c'.repeat(64), eventIds: ['event-1'], confirmedAt: '2026-08-27T00:00:00.000Z' }
  },
  report: {
    passed: true,
    summary: '通过',
    beats: [{ id: 'B1', status: 'covered', evidence: '循着脚印' }],
    boundary: { entryRespected: true, exitReached: true, evidence: '停在酒馆门外' },
    foreshadowing: [], violations: [], introducedFacts: [],
    characterChanges: [
      { character: '沈砚', field: 'location', value: '临江酒馆门外', evidence: '沈砚压低灯笼，循着脚印停在临江酒馆门外' },
      { character: '沈砚', field: 'injury', value: '左手擦伤', evidence: '正文没有写伤势' },
      { character: '沈砚', field: 'knowledge', value: '确认脚印通往临江酒馆', evidence: '沈砚压低灯笼，循着脚印停在临江酒馆门外' }
    ],
    characterConflicts: []
  }
}

test('settles only accepted proposal characters into idempotent evidence-backed snapshots', async () => {
  const { root, service, cleanup } = await fixture()
  try {
    const empty = await service.state()
    assert.equal(empty.anchors.length, 0)
    const input = {
      workItemId: root,
      chapter,
      proposal,
      sources: [
        { id: 'event-1', names: ['沈砚', '未出场者'], location: '长安城门' },
        { id: 'event-2', names: ['沈砚'], location: '临江酒馆' }
      ]
    }
    const settled = await service.settleAcceptedProposal(input)
    assert.deepEqual(settled.anchors.map((item) => item.name), ['沈砚'])
    assert.equal(settled.events.length, 1)
    assert.equal(settled.events[0].chapterPosition, 3)
    assert.match(settled.events[0].evidence, /沈砚/)
    assert.equal(settled.snapshots[0].location, '临江酒馆门外')
    assert.deepEqual(settled.snapshots[0].knowledge, ['确认脚印通往临江酒馆'])
    assert.equal(settled.snapshots[0].injury, undefined)
    assert.deepEqual(settled.anchors[0].sourceRefs, ['event-1', 'event-2'])

    const repeated = await service.settleAcceptedProposal(input)
    assert.equal(repeated.events.length, 1)
    assert.equal(repeated.snapshots[0].lastEventId, settled.events[0].id)
  } finally { await cleanup() }
})

test('settles evidence-backed possession, current goal, power and vitality as latest scalar states', async () => {
  const { root, service, cleanup } = await fixture()
  try {
    const content = `${chapter.content}沈砚将半枚铜符收入袖中。沈砚决定查清掌柜来历。沈砚的修为稳在炼气二层。沈砚仍然存活。`
    const expandedChapter = { ...chapter, content }
    const expandedProposal: ChapterDraftProposal = {
      ...proposal,
      content,
      report: {
        ...proposal.report,
        characterChanges: [
          ...proposal.report.characterChanges,
          { character: '沈砚', field: 'possession', value: '持有半枚铜符', evidence: '沈砚将半枚铜符收入袖中' },
          { character: '沈砚', field: 'goal', value: '查清掌柜来历', evidence: '沈砚决定查清掌柜来历' },
          { character: '沈砚', field: 'power', value: '炼气二层', evidence: '沈砚的修为稳在炼气二层' },
          { character: '沈砚', field: 'vitality', value: '存活', evidence: '沈砚仍然存活' }
        ]
      }
    }
    const settled = await service.settleAcceptedProposal({
      workItemId: root,
      chapter: expandedChapter,
      proposal: expandedProposal,
      sources: [{ id: 'event-1', names: ['沈砚'], location: '临江酒馆' }]
    })
    assert.equal(settled.events[0].changes.possession, '持有半枚铜符')
    assert.equal(settled.events[0].changes.goal, '查清掌柜来历')
    assert.equal(settled.events[0].changes.power, '炼气二层')
    assert.equal(settled.events[0].changes.vitality, 'alive')
    assert.equal(settled.events[0].changeEvidence?.power, '沈砚的修为稳在炼气二层')
    assert.equal(settled.events[0].changeEvidence?.vitality, '沈砚仍然存活')
    assert.equal(settled.snapshots[0].possession, '持有半枚铜符')
    assert.equal(settled.snapshots[0].goal, '查清掌柜来历')
    assert.equal(settled.snapshots[0].power, '炼气二层')
    assert.equal(settled.snapshots[0].vitality, 'alive')
  } finally { await cleanup() }
})

test('projects only accepted character state from chapters before the requested position', async () => {
  const { root, service, cleanup } = await fixture()
  try {
    await service.settleAcceptedProposal({
      workItemId: root,
      chapter,
      proposal,
      sources: [{ id: 'event-1', names: ['沈砚'], location: '临江酒馆' }]
    })
    const laterContent = '沈砚离开酒馆，最终停在渡口。沈砚的修为稳在炼气三层。'
    const laterChapter = { ...chapter, id: 8, position: 4, title: '渡口', content: laterContent }
    const laterProposal: ChapterDraftProposal = {
      ...proposal,
      id: 'proposal-2',
      chapterId: 8,
      content: laterContent,
      contract: { ...proposal.contract, chapterId: 8, chapterPosition: 4 },
      report: {
        ...proposal.report,
        characterChanges: [
          { character: '沈砚', field: 'location', value: '渡口', evidence: '沈砚离开酒馆，最终停在渡口' },
          { character: '沈砚', field: 'power', value: '炼气三层', evidence: '沈砚的修为稳在炼气三层' }
        ]
      }
    }
    await service.settleAcceptedProposal({
      workItemId: root,
      chapter: laterChapter,
      proposal: laterProposal,
      sources: [{ id: 'event-2', names: ['沈砚'], location: '渡口' }]
    })

    const beforeFourth = await service.snapshotsBefore(4)
    assert.equal(beforeFourth[0].throughChapter, 3)
    assert.equal(beforeFourth[0].location, '临江酒馆门外')
    assert.equal(beforeFourth[0].power, undefined)
    const beforeFifth = await service.snapshotsBefore(5)
    assert.equal(beforeFifth[0].throughChapter, 4)
    assert.equal(beforeFifth[0].location, '渡口')
    assert.equal(beforeFifth[0].power, '炼气三层')
    await assert.rejects(service.snapshotsBefore(0), /已损坏/)
  } finally { await cleanup() }
})

test('keeps a scalar dynamic field unknown when one chapter reports conflicting end states', async () => {
  const { root, service, cleanup } = await fixture()
  try {
    const content = `${chapter.content}沈砚的修为稳在炼气二层。片刻后，沈砚又声称自己已经踏入炼气三层。`
    const conflictedChapter = { ...chapter, content }
    const conflictedProposal: ChapterDraftProposal = {
      ...proposal,
      content,
      report: {
        ...proposal.report,
        characterChanges: [
          { character: '沈砚', field: 'power', value: '炼气二层', evidence: '沈砚的修为稳在炼气二层' },
          { character: '沈砚', field: 'power', value: '炼气三层', evidence: '沈砚又声称自己已经踏入炼气三层' }
        ]
      }
    }
    const settled = await service.settleAcceptedProposal({
      workItemId: root,
      chapter: conflictedChapter,
      proposal: conflictedProposal,
      sources: [{ id: 'event-1', names: ['沈砚'], location: '临江酒馆' }]
    })
    assert.equal(settled.events[0].changes.power, undefined)
    assert.equal(settled.snapshots[0].power, undefined)
  } finally { await cleanup() }
})

test('records evidence-backed stable conflicts without mutating character anchors', async () => {
  const { root, service, cleanup } = await fixture()
  try {
    const conflicted = {
      ...proposal,
      report: {
        ...proposal.report,
        characterConflicts: [
          { character: '沈砚', field: 'identity' as const, claimedValue: '并非沈家后人', evidence: '沈砚压低灯笼，循着脚印停在临江酒馆门外' },
          { character: '沈砚', field: 'arc' as const, claimedValue: '放弃调查', evidence: '正文没有这句话' }
        ]
      }
    }
    const settled = await service.settleAcceptedProposal({ workItemId: root, chapter, proposal: conflicted, sources: [{ id: 'event-1', names: ['沈砚'], location: '临江酒馆' }] })
    assert.equal(settled.pendingConflicts.length, 1)
    assert.equal(settled.pendingConflicts[0].field, 'identity')
    assert.equal(settled.pendingConflicts[0].status, 'pending')
    assert.deepEqual(settled.anchors[0], { id: settled.anchors[0].id, name: '沈砚', sourceRefs: ['event-1'] })

    const repeated = await service.settleAcceptedProposal({ workItemId: root, chapter, proposal: conflicted, sources: [{ id: 'event-1', names: ['沈砚'], location: '临江酒馆' }] })
    assert.equal(repeated.pendingConflicts.length, 1)
  } finally { await cleanup() }
})

test('lets the author dismiss a false positive without changing anchors or reopening it during replay', async () => {
  const { root, service, cleanup } = await fixture()
  try {
    const conflicted = {
      ...proposal,
      report: {
        ...proposal.report,
        characterConflicts: [{ character: '沈砚', field: 'identity' as const, claimedValue: '并非沈家后人', evidence: '沈砚压低灯笼，循着脚印停在临江酒馆门外' }]
      }
    }
    const settled = await service.settleAcceptedProposal({ workItemId: root, chapter, proposal: conflicted, sources: [{ id: 'event-1', names: ['沈砚'], location: '临江酒馆' }] })
    const anchorBefore = structuredClone(settled.anchors)
    const conflictId = settled.pendingConflicts[0].id

    const dismissed = await service.dismissConflict(conflictId)
    assert.equal(dismissed.pendingConflicts[0].status, 'dismissed')
    assert.deepEqual(dismissed.anchors, anchorBefore)
    assert.equal((await service.dismissConflict(conflictId)).pendingConflicts[0].status, 'dismissed')

    const replayed = await service.reconcileManuscript([{ ...chapter, position: 1 }])
    assert.equal(replayed.pendingConflicts[0].status, 'dismissed')
    assert.equal(replayed.pendingConflicts[0].chapterPosition, 1)
    const repeated = await service.settleAcceptedProposal({ workItemId: root, chapter: { ...chapter, position: 1 }, proposal: conflicted, sources: [{ id: 'event-1', names: ['沈砚'], location: '临江酒馆' }] })
    assert.equal(repeated.pendingConflicts[0].status, 'dismissed')
    await assert.rejects(service.dismissConflict('conflict-000000000000000000000000'), /不存在/)
  } finally { await cleanup() }
})

test('refuses to dismiss a conflict whose manuscript evidence has been superseded', async () => {
  const { root, service, cleanup } = await fixture()
  try {
    const conflicted = {
      ...proposal,
      report: {
        ...proposal.report,
        characterConflicts: [{ character: '沈砚', field: 'identity' as const, claimedValue: '并非沈家后人', evidence: '沈砚压低灯笼，循着脚印停在临江酒馆门外' }]
      }
    }
    const settled = await service.settleAcceptedProposal({ workItemId: root, chapter, proposal: conflicted, sources: [{ id: 'event-1', names: ['沈砚'], location: '临江酒馆' }] })
    await service.reconcileManuscript([{ ...chapter, content: '沈砚已经重写了这一章。' }])
    await assert.rejects(service.dismissConflict(settled.pendingConflicts[0].id), /正文已经变化/)
  } finally { await cleanup() }
})

test('replays active character state when manuscript revisions change, restore or disappear', async () => {
  const { root, service, cleanup } = await fixture()
  try {
    const conflicted = {
      ...proposal,
      report: {
        ...proposal.report,
        characterConflicts: [{ character: '沈砚', field: 'identity' as const, claimedValue: '并非沈家后人', evidence: '沈砚压低灯笼，循着脚印停在临江酒馆门外' }]
      }
    }
    await service.settleAcceptedProposal({ workItemId: root, chapter, proposal: conflicted, sources: [{ id: 'event-1', names: ['沈砚'], location: '临江酒馆' }] })

    const edited = await service.reconcileManuscript([{ ...chapter, position: 1, content: '沈砚已经改写了这一章。' }])
    assert.equal(edited.events.length, 1)
    assert.equal(edited.events[0].active, false)
    assert.equal(edited.snapshots[0].throughChapter, 0)
    assert.equal(edited.snapshots[0].present, false)
    assert.equal(edited.pendingConflicts[0].status, 'superseded')

    const restored = await service.reconcileManuscript([{ ...chapter, position: 1 }])
    assert.equal(restored.events[0].active, true)
    assert.equal(restored.events[0].chapterPosition, 1)
    assert.equal(restored.snapshots[0].throughChapter, 1)
    assert.equal(restored.snapshots[0].location, '临江酒馆门外')
    assert.equal(restored.pendingConflicts[0].status, 'pending')
    assert.equal(restored.pendingConflicts[0].chapterPosition, 1)

    const deleted = await service.reconcileManuscript([])
    assert.equal(deleted.events[0].active, false)
    assert.equal(deleted.snapshots[0].throughChapter, 0)
    assert.equal(deleted.pendingConflicts[0].status, 'superseded')
    assert.deepEqual(deleted.anchors[0].sourceRefs, ['event-1'])
  } finally { await cleanup() }
})

test('reconciles an autosaved or deleted chapter without scanning away other chapter state', async () => {
  const { root, service, cleanup } = await fixture()
  try {
    await service.settleAcceptedProposal({ workItemId: root, chapter, proposal, sources: [{ id: 'event-1', names: ['沈砚'], location: '临江酒馆' }] })
    const laterChapter = { ...chapter, id: 8, position: 4, title: '酒馆问讯' }
    const laterProposal = { ...proposal, id: 'proposal-2', chapterId: 8, contract: { ...proposal.contract, chapterId: 8, chapterPosition: 4 } }
    await service.settleAcceptedProposal({ workItemId: root, chapter: laterChapter, proposal: laterProposal, sources: [{ id: 'event-2', names: ['沈砚'], location: '临江酒馆' }] })

    const reconciled = await service.reconcileManuscript([], [7])
    assert.equal(reconciled.events.find((event) => event.chapterId === 7)?.active, false)
    assert.equal(reconciled.events.find((event) => event.chapterId === 8)?.active, true)
    assert.equal(reconciled.snapshots[0].throughChapter, 4)
    assert.equal(reconciled.snapshots[0].lastEventId, reconciled.events.find((event) => event.chapterId === 8)?.id)
  } finally { await cleanup() }
})

test('refuses cross-book, failed-review and mismatched-manuscript settlement', async () => {
  const { root, service, cleanup } = await fixture()
  try {
    const sources = [{ id: 'event-1', names: ['沈砚'], location: '长安城门' }]
    await assert.rejects(service.settleAcceptedProposal({ workItemId: `${root}-other`, chapter, proposal, sources }), /不属于当前书稿/)
    await assert.rejects(service.settleAcceptedProposal({ workItemId: root, chapter, proposal: { ...proposal, report: { ...proposal.report, passed: false } }, sources }), /通过章契审校/)
    await assert.rejects(service.settleAcceptedProposal({ workItemId: root, chapter: { ...chapter, content: '作者已经改写了正文。' }, proposal, sources }), /正文与候选稿不一致/)
    assert.equal((await service.state()).events.length, 0)
  } finally { await cleanup() }
})

test('blocks a damaged character state file without overwriting its bytes', async () => {
  const { root, service, cleanup } = await fixture()
  try {
    const folder = join(root, '.webnovel', 'story-state')
    const path = join(folder, 'characters.json')
    await mkdir(folder, { recursive: true })
    await writeFile(path, '{damaged', 'utf8')
    await assert.rejects(service.state(), /已损坏/)
    await assert.rejects(service.settleAcceptedProposal({ workItemId: root, chapter, proposal, sources: [{ id: 'event-1', names: ['沈砚'], location: '长安城门' }] }), /已损坏/)
    assert.equal(await readFile(path, 'utf8'), '{damaged')
  } finally { await cleanup() }
})

test('adopts planning seeds as stable anchors while preserving prose-driven dynamic state', async () => {
  const { root, service, cleanup } = await fixture()
  try {
    const initialSeeds = [{ name: '沈砚', role: '失意书生', arcSeed: '从求证身世到选择自己的道路' }]
    const preview = await service.previewPlanningSeeds('planning-1', initialSeeds)
    assert.equal(preview.actions[0]?.action, 'create')
    assert.equal(preview.affected.dynamicSnapshots, 0)
    const adopted = await service.adoptPlanningSeeds({
      proposalId: 'planning-1', seeds: initialSeeds,
      candidateFingerprint: preview.candidateFingerprint, currentFingerprint: preview.currentFingerprint
    })
    assert.equal(adopted.state.anchors[0]?.role, '失意书生')
    assert.match(adopted.state.anchors[0]?.sourceRefs[0] || '', /^planning:planning-1:/)

    const settled = await service.settleAcceptedProposal({
      workItemId: root, chapter, proposal,
      sources: [{ id: 'event-1', names: ['沈砚'], location: '临江酒馆' }]
    })
    assert.equal(settled.snapshots[0]?.throughChapter, 3)
    const conflicted = await service.settleAcceptedProposal({
      workItemId: root,
      chapter,
      proposal: {
        ...proposal,
        report: {
          ...proposal.report,
          characterConflicts: [
            { character: '沈砚', field: 'identity', claimedValue: '游方术士', evidence: '沈砚压低灯笼' },
            { character: '沈砚', field: 'arc', claimedValue: '放弃追索身世', evidence: '沈砚压低灯笼' }
          ]
        }
      },
      sources: [{ id: 'event-1', names: ['沈砚'], location: '临江酒馆' }]
    })
    assert.deepEqual(conflicted.pendingConflicts.map((item) => item.anchorValue), [
      '失意书生',
      '从求证身世到选择自己的道路'
    ])
    const revisedSeeds = [{ name: '沈砚', role: '追索真相的书生', arcSeed: '从执着身世到守护同行者' }]
    const revisedPreview = await service.previewPlanningSeeds('planning-1', revisedSeeds)
    assert.equal(revisedPreview.actions[0]?.action, 'update')
    await assert.rejects(service.adoptPlanningSeeds({
      proposalId: 'planning-1', seeds: revisedSeeds,
      candidateFingerprint: revisedPreview.candidateFingerprint, currentFingerprint: preview.currentFingerprint
    }), /预览后变化/)
    const revised = await service.adoptPlanningSeeds({
      proposalId: 'planning-1', seeds: revisedSeeds,
      candidateFingerprint: revisedPreview.candidateFingerprint, currentFingerprint: revisedPreview.currentFingerprint
    })
    assert.equal(revised.state.anchors[0]?.role, '追索真相的书生')
    assert.equal(revised.state.snapshots[0]?.throughChapter, 3)
    assert.equal(revised.state.events.length, 1)

    const duplicate = await service.previewPlanningSeeds('planning-1', [
      ...revisedSeeds, { name: ' 沈砚 ', role: '同名', arcSeed: '冲突' }
    ])
    assert.equal(duplicate.conflicts.length, 1)
  } finally { await cleanup() }
})
