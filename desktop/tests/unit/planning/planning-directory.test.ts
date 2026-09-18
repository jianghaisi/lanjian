import assert from 'node:assert/strict'
import test from 'node:test'
import { matchesPlanningSearch, planningChapterCatalog } from '../../../src/renderer/features/planning/services/planning-directory'

test('unassigned manuscript chapters remain visible without guessing groups of 55', () => {
  const written = Array.from({ length: 440 }, (_, i) => ({ id: 1000 + i, position: i + 1, title: `章节 ${i + 1}` }))
  const catalog = planningChapterCatalog(written, [], [{ chapterId: 1062, volume: 2 }], [{ volume: 2 }])
  assert.equal(catalog.length, 440)
  assert.equal(catalog.find(chapter => chapter.position === 63)?.volume, 2)
  assert.equal(catalog.filter(chapter => chapter.volume === null).length, 439)
  assert.equal(catalog.find(chapter => chapter.position === 440)?.volume, null)
})

test('deduplicates written chapters while preserving standalone outlines and explicit identity', () => {
  const catalog = planningChapterCatalog([{ id: 92, position: 2, title: '正文标题' }], [
    { chapterId: 92, title: '旧章纲标题', hasManuscript: false, volume: 1 },
    { chapterId: 3, title: '仅章纲', hasManuscript: false, volume: 2 }
  ], [{ chapterId: 92, volume: 1 }], [{ volume: 1 }, { volume: 2 }])
  assert.deepEqual(catalog, [
    { id: 92, position: 2, title: '正文标题', volume: 1, plannedOnly: false },
    { id: 3, position: 3, title: '仅章纲', volume: 2, plannedOnly: true }
  ])
})

test('missing volume relations remain accessible in unassigned and never mutate input', () => {
  const placements = Object.freeze([Object.freeze({ chapterId: 6, volume: 999 })])
  const catalog = planningChapterCatalog([{ id: 6, position: 1, title: '卷已不存在' }], [
    { chapterId: 8, title: '独立条目', hasManuscript: false, volume: 0 }
  ], placements, [{ volume: 1 }])
  assert.ok(catalog.every(chapter => chapter.volume === null))
  assert.equal(placements[0]?.volume, 999)
})

test('search matches title, displayed chapter and volume without using storage IDs', () => {
  assert.equal(matchesPlanningSearch('第63章 雾港', '第63章', '抵达雾港', '第2卷'), true)
  assert.equal(matchesPlanningSearch('1062', '第63章', '抵达雾港', '第2卷'), false)
  assert.equal(matchesPlanningSearch(' 待归卷 ', '章名', '待归卷'), true)
})
