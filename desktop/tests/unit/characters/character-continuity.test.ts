import assert from 'node:assert/strict'
import test from 'node:test'
import { auditCharacterContinuity } from '../../../src/main/modules/characters/domain/character-continuity'
import type { CharacterStateEvent, CharacterStateView, RealmLevel } from '../../../src/contracts/index'

const realms: RealmLevel[] = [
  { id: 'realm-1', name: '炼气一层', description: '' },
  { id: 'realm-2', name: '炼气二层', description: '' },
  { id: 'realm-3', name: '炼气三层', description: '' },
  { id: 'realm-4', name: '筑基初期', description: '' }
]

function event(position: number, changes: Omit<CharacterStateEvent['changes'], 'present'>, changeEvidence: CharacterStateEvent['changeEvidence']): CharacterStateEvent {
  return {
    id: `state-${position}`,
    characterId: 'character-shenyan',
    chapterId: position,
    chapterPosition: position,
    manuscriptRevision: 'a'.repeat(64),
    proposalId: `proposal-${position}`,
    acceptedAt: `2026-08-27T00:0${position}:00.000Z`,
    evidence: Object.values(changeEvidence || {}).join('；'),
    active: true,
    changes: { present: true, ...changes },
    changeEvidence
  }
}

function state(events: CharacterStateEvent[]): CharacterStateView {
  const characterIds = [...new Set(events.map((item) => item.characterId))]
  return {
    version: 1,
    workItemId: 'book-a',
    anchors: characterIds.map((id) => ({ id, name: id === 'character-shenyan' ? '沈砚' : id === 'character-jiang' ? '陈景安' : '周轩', sourceRefs: ['event-1'] })),
    events,
    snapshots: [],
    pendingConflicts: []
  }
}

function possessionEvent(position: number, characterId: string, value: string, evidence: string): CharacterStateEvent {
  const result = event(position, { possession: value }, { possession: evidence })
  result.id = `state-${position}-${characterId}`
  result.characterId = characterId
  return result
}

test('flags an adjacent location jump but accepts explicit travel evidence', () => {
  const abrupt = auditCharacterContinuity(state([
    event(1, { location: '临江酒馆' }, { location: '沈砚留在临江酒馆。' }),
    event(2, { location: '北境雪原' }, { location: '沈砚站在北境雪原。' })
  ]), realms, 2)
  assert.equal(abrupt.length, 1)
  assert.equal(abrupt[0].code, 'LOCATION_JUMP')
  assert.equal(abrupt[0].severity, 'attention')
  assert.deepEqual(abrupt[0].evidence, ['沈砚留在临江酒馆。', '沈砚站在北境雪原。'])

  const explained = auditCharacterContinuity(state([
    event(1, { location: '临江酒馆' }, { location: '沈砚留在临江酒馆。' }),
    event(2, { location: '北境雪原' }, { location: '沈砚连夜赶赴北境雪原。' })
  ]), realms, 2)
  assert.equal(explained.some((finding) => finding.code === 'LOCATION_JUMP'), false)
})

test('blocks a skipped realm and only warns for an unexplained regression', () => {
  const findings = auditCharacterContinuity(state([
    event(1, { power: '炼气一层' }, { power: '沈砚稳在炼气一层。' }),
    event(2, { power: '筑基初期' }, { power: '沈砚已是筑基初期。' }),
    event(3, { power: '炼气二层' }, { power: '沈砚只余炼气二层修为。' })
  ]), realms, 3)
  assert.deepEqual(findings.map((finding) => finding.code), ['POWER_SKIP', 'POWER_REGRESSION'])
  assert.deepEqual(findings.map((finding) => finding.severity), ['blocked', 'attention'])

  const explained = auditCharacterContinuity(state([
    event(1, { power: '筑基初期' }, { power: '沈砚已是筑基初期。' }),
    event(2, { power: '炼气二层' }, { power: '沈砚遭反噬后跌境，只余炼气二层修为。' })
  ]), realms, 2)
  assert.equal(explained.some((finding) => finding.code === 'POWER_REGRESSION'), false)
})

test('blocks an unexplained revival while ignoring future and superseded events', () => {
  const future = event(4, { vitality: 'alive' }, { vitality: '沈砚借还魂丹复活。' })
  const superseded = event(3, { vitality: 'alive' }, { vitality: '沈砚借还魂丹复活。' })
  superseded.active = false
  const findings = auditCharacterContinuity(state([
    event(1, { vitality: 'dead' }, { vitality: '沈砚气绝身亡。' }),
    event(2, { vitality: 'alive' }, { vitality: '沈砚睁开眼睛。' }),
    superseded,
    future
  ]), realms, 3)
  assert.equal(findings.length, 1)
  assert.equal(findings[0].code, 'UNEXPLAINED_REVIVAL')
  assert.equal(findings[0].severity, 'blocked')

  const explained = auditCharacterContinuity(state([
    event(1, { vitality: 'dead' }, { vitality: '沈砚气绝身亡。' }),
    event(2, { vitality: 'alive' }, { vitality: '沈砚服下还魂丹后复活。' })
  ]), realms, 2)
  assert.equal(explained.some((finding) => finding.code === 'UNEXPLAINED_REVIVAL'), false)
})

test('keeps power and vitality continuity across an intervening unrelated character change', () => {
  const findings = auditCharacterContinuity(state([
    event(1, { power: '炼气一层', vitality: 'dead' }, { power: '沈砚稳在炼气一层。', vitality: '沈砚气绝身亡。' }),
    event(2, { goal: '找到遗失剑谱' }, { goal: '沈砚仍要找到遗失剑谱。' }),
    event(3, { power: '筑基初期', vitality: 'alive' }, { power: '沈砚已是筑基初期。', vitality: '沈砚睁开眼睛。' })
  ]), realms, 3)
  assert.deepEqual(findings.map((finding) => finding.code), ['POWER_SKIP', 'UNEXPLAINED_REVIVAL'])
  assert.deepEqual(findings.map((finding) => [finding.fromChapter, finding.toChapter]), [[1, 3], [1, 3]])
})

test('flags an unexplained cross-character possession handoff but accepts explicit transfer evidence', () => {
  const unexplained = auditCharacterContinuity(state([
    possessionEvent(1, 'character-jiang', '持有：黑色物理错题本', '陈景安把黑色物理错题本收进书包。'),
    possessionEvent(3, 'character-zhou', '持有黑色物理错题本', '周轩翻开黑色物理错题本。')
  ]), realms, 3)
  assert.equal(unexplained.length, 1)
  assert.equal(unexplained[0].code, 'POSSESSION_HANDOFF')
  assert.equal(unexplained[0].severity, 'attention')
  assert.deepEqual(unexplained[0].evidence, ['陈景安把黑色物理错题本收进书包。', '周轩翻开黑色物理错题本。'])

  const explained = auditCharacterContinuity(state([
    possessionEvent(1, 'character-jiang', '持有：黑色物理错题本', '陈景安保管着黑色物理错题本。'),
    possessionEvent(2, 'character-shenyan', '持有：黑色物理错题本', '陈景安把黑色物理错题本递给沈砚。')
  ]), realms, 2)
  assert.equal(explained.some((finding) => finding.code === 'POSSESSION_HANDOFF'), false)
})

test('releases a tracked possession without reporting a later acquisition as an unexplained handoff', () => {
  const findings = auditCharacterContinuity(state([
    possessionEvent(1, 'character-jiang', '持有：黑色物理错题本', '陈景安保管着黑色物理错题本。'),
    possessionEvent(2, 'character-jiang', '不再持有：黑色物理错题本', '陈景安已经交出黑色物理错题本。'),
    possessionEvent(3, 'character-zhou', '持有：黑色物理错题本', '周轩拿起黑色物理错题本。')
  ]), realms, 3)
  assert.equal(findings.some((finding) => finding.code === 'POSSESSION_HANDOFF'), false)
})
