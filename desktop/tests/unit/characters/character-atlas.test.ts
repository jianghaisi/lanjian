import assert from 'node:assert/strict'
import test from 'node:test'
import type { CharacterLinePoint, CharacterLinesView } from '../../../src/contracts/index'
import { characterStateDetails, projectCharacterAtlas } from '../../../src/renderer/features/characters/services/character-atlas'

function point(overrides: Partial<CharacterLinePoint> = {}): CharacterLinePoint {
  return {
    characterId: 'a', name: '沈砚', chapterId: 90, chapterPosition: 1,
    throughChapter: 1, present: true, lastEventId: 'event:1',
    source: 'approved_fact', sourceId: 'fact:1', ...overrides
  }
}
function view(points: CharacterLinePoint[]): CharacterLinesView {
  return { version: 1, workItemId: 'isolated-atlas', source: 'sqlite-approved-facts', lines: [
    { characterId: 'a', name: '沈砚的未来别名', points },
    { characterId: 'future', name: '未来才出现的人物', points: [point({ characterId: 'future', name: '未来才出现的人物', chapterId: 2, chapterPosition: 8 })] },
    { characterId: 'empty', name: '尚未记录的人物', points: [] }
  ] }
}

test('atlas filters by display chapter position before projecting names, locations, latest and appearance count', () => {
  const first = point({ location: '旧车站' })
  const second = point({ chapterId: 7, chapterPosition: 2, location: '灯塔', sourceId: 'fact:2' })
  const future = point({ chapterId: 3, chapterPosition: 6, name: '未来别名', location: '未来城', vitality: 'dead', sourceId: 'fact:6' })
  const cards = projectCharacterAtlas(view([future, first, second]), 2)
  assert.equal(cards.length, 1)
  assert.deepEqual(cards[0], { characterId: 'a', name: '沈砚', points: [first, second], latest: second, appearanceCount: 2, locations: ['旧车站', '灯塔'] })
  assert.equal(cards[0]?.latest, second)
  assert.equal(JSON.stringify(cards).includes('未来'), false)
})

test('atlas keeps line order, stably orders points and counts only distinct present chapters', () => {
  const first = point({ location: '旧车站' })
  const second = point({ chapterId: 7, chapterPosition: 2, location: '旧车站', sourceId: 'same-chapter-first' })
  const tied = point({ chapterId: 7, chapterPosition: 2, location: '灯塔', sourceId: 'same-chapter-last' })
  const carried = point({ chapterId: 3, chapterPosition: 6, throughChapter: 2, present: false, location: '灯塔', sourceId: 'carried' })
  const cards = projectCharacterAtlas(view([second, first, tied, carried]), null)
  assert.deepEqual(cards.map(card => card.characterId), ['a', 'future'])
  assert.deepEqual(cards[0]?.points, [first, second, tied, carried])
  assert.equal(cards[0]?.latest, carried)
  assert.equal(cards[0]?.appearanceCount, 2)
  assert.deepEqual(cards[0]?.locations, ['旧车站', '灯塔'])
  assert.equal(projectCharacterAtlas(view([second, first, tied, carried]), 2)[0]?.latest, tied)
})

test('atlas optionally rejects removed chapter IDs before deriving any card state', () => {
  const first = point({ location: '旧车站' })
  const removed = point({ chapterId: 7, chapterPosition: 2, name: '已删章别名', location: '已删地点' })
  assert.equal(projectCharacterAtlas(view([first, removed]), 2)[0]?.latest, removed)
  const valid = new Set([90])
  const cards = projectCharacterAtlas(view([first, removed]), 2, valid)
  assert.equal(cards[0]?.latest, first)
  assert.deepEqual(cards[0]?.locations, ['旧车站'])
  assert.equal(cards[0]?.appearanceCount, 1)
  assert.deepEqual([...valid], [90])
  assert.deepEqual(projectCharacterAtlas(view([first]), null, new Set()), [])
  assert.deepEqual(projectCharacterAtlas(view([removed]), 2, valid), [])
})

test('empty and invalid temporal selections do not fall back to all-book information', () => {
  const lines = view([point()])
  for (const cutoff of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) assert.deepEqual(projectCharacterAtlas(lines, cutoff), [])
  assert.equal(projectCharacterAtlas(lines, 1).length, 1)
  assert.equal(projectCharacterAtlas(lines, null).length, 2)
  assert.deepEqual(projectCharacterAtlas({ ...lines, lines: [] }, null), [])
})

test('projection preserves exact source and snapshot time semantics without mutation or invented timestamps', () => {
  const recorded = point({ chapterId: 17, chapterPosition: 3, throughChapter: 1, present: false,
    source: 'accepted_prose', sourceId: 'accepted:chapter-17:revision-9', lastEventId: 'event:original',
    relationships: ['只记录了共同出现'], knowledge: ['未辨认身份'], location: ' 旧车站 ' })
  const lines = view([recorded])
  lines.source = 'legacy-accepted-prose'
  const before = JSON.stringify(lines)
  Object.freeze(recorded.relationships)
  Object.freeze(recorded.knowledge)
  Object.freeze(recorded)
  lines.lines.forEach(line => { Object.freeze(line.points); Object.freeze(line) })
  Object.freeze(lines.lines)
  Object.freeze(lines)
  const [card] = projectCharacterAtlas(lines, 3)
  assert.equal(card?.latest, recorded)
  assert.equal(card?.latest?.chapterPosition, 3)
  assert.equal(card?.latest?.throughChapter, 1)
  assert.equal(card?.latest?.source, 'accepted_prose')
  assert.equal(card?.latest?.sourceId, 'accepted:chapter-17:revision-9')
  assert.equal(card?.latest?.lastEventId, 'event:original')
  assert.equal(card?.appearanceCount, 0)
  assert.deepEqual(card?.locations, [' 旧车站 '])
  assert.equal('updatedAt' in card!, false)
  assert.equal('timestamp' in card!.latest!, false)
  characterStateDetails(recorded)
  assert.equal(JSON.stringify(lines), before)
})

test('state details include only actual nonempty fields in legacy display order', () => {
  const recorded = point({ location: ' 旧车站 ', goal: '寻找同伴', relationships: ['', '只记录了共同出现', '   '],
    knowledge: ['知道暗号', '\n', '不知道真名'], possession: '钥匙', injury: '手臂受伤', power: '尚未觉醒', vitality: 'alive' })
  assert.deepEqual(characterStateDetails(recorded), [
    { label: '地点', value: ' 旧车站 ' }, { label: '目标', value: '寻找同伴' },
    { label: '关系', value: '只记录了共同出现' }, { label: '已知', value: '知道暗号；不知道真名' },
    { label: '持有', value: '钥匙' }, { label: '状态', value: '手臂受伤' },
    { label: '实力', value: '尚未觉醒' }, { label: '生死', value: '存活' }
  ])
  assert.deepEqual(characterStateDetails(point({ location: ' ', goal: '\n', relationships: ['', '\t'], knowledge: [], possession: '', injury: ' ', power: '' })), [])
  assert.deepEqual(characterStateDetails(null), [])
  assert.deepEqual(characterStateDetails(point({ vitality: 'dead' })), [{ label: '生死', value: '死亡' }])
  const unknown = point()
  Reflect.set(unknown, 'vitality', 'unknown')
  assert.deepEqual(characterStateDetails(unknown), [])
})
