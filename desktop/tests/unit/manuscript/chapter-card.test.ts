import assert from 'node:assert/strict'
import test from 'node:test'
import { chapterCardCompleteness, normalizeChapterCard } from '../../../src/main/modules/manuscript/domain/chapter-card'
import { chapterCardFingerprint } from '../../../src/contracts/manuscript/chapter-card-fingerprint'

test('normalizes the V2 execution card without hard-coded POV or style values', () => {
  const card = normalizeChapterCard({
    goal: '  找到失踪录音的来源  ',
    entryState: '沈砚在旧城门外。',
    beats: [' 询问守门人 ', '进入废弃录音棚'],
    conflict: '守门人拒绝放行。',
    characters: [' 沈砚 ', '守门人'],
    pointOfView: '自由间接引语 / 沈砚限知',
    narrativeDistance: '贴近感官但不进入梦境',
    exitChange: '沈砚拿到钥匙。',
    hook: '录音机自行开始倒放。'
  })
  assert.equal(card.goal, '找到失踪录音的来源')
  assert.deepEqual(card.beats, ['询问守门人', '进入废弃录音棚'])
  assert.equal(chapterCardCompleteness(card).complete, true)
})

test('reports incomplete cards without blocking authors from saving a partial plan', () => {
  const partial = normalizeChapterCard({
    goal: '推进调查', entryState: '', beats: [], conflict: '', characters: [],
    pointOfView: '第三人称', narrativeDistance: '', exitChange: '', hook: ''
  })
  assert.deepEqual(chapterCardCompleteness(partial), {
    complete: false,
    missing: ['entryState', 'conflict', 'narrativeDistance', 'exitChange', 'hook', 'beats', 'characters']
  })
})

test('bounds chapter-card collections and long free-form values', () => {
  assert.throws(() => normalizeChapterCard({
    goal: 'a'.repeat(2_001), entryState: '', beats: [], conflict: '', characters: [],
    pointOfView: '', narrativeDistance: '', exitChange: '', hook: ''
  }))
  assert.throws(() => normalizeChapterCard({
    goal: '', entryState: '', beats: Array.from({ length: 101 }, () => '节拍'), conflict: '', characters: [],
    pointOfView: '', narrativeDistance: '', exitChange: '', hook: ''
  }))
})

test('changes the shared chapter-card fingerprint only when an AI-relevant field changes', () => {
  const card = normalizeChapterCard({
    goal: '找到线索', entryState: '刚进门', beats: ['询问'], conflict: '对方隐瞒', characters: ['沈砚'],
    pointOfView: '第三人称限知', narrativeDistance: '近距离', exitChange: '确认去向', hook: '门外有人敲门'
  })
  const first = chapterCardFingerprint({ ...card, status: 'draft' })
  assert.equal(first, chapterCardFingerprint({ ...card, status: 'draft' }))
  assert.notEqual(first, chapterCardFingerprint({ ...card, conflict: '对方撒谎', status: 'draft' }))
  assert.notEqual(first, chapterCardFingerprint({ ...card, status: 'confirmed' }))
})
