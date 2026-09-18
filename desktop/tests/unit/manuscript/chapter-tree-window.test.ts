import test from 'node:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import type { Chapter } from '../../../src/contracts/index'
import { preferredChapterForOpen, projectChapterTree, projectChapterVolumeGroups } from '../../../src/contracts/manuscript/chapter-tree-window'

const chapters: Chapter[] = Array.from({ length: 1500 }, (_, index) => ({
  id: index + 1,
  position: index + 1,
  title: index === 1499 ? '终卷回灯' : `长篇章节 ${index + 1}`,
  content: '',
  word_count: 3000,
  summary: ''
}))

test('projects a continuous 1,500 chapter catalog without paging and preserves full-list search', () => {
  const startedAt = performance.now()
  const catalog = projectChapterTree(chapters, '')
  const projectionMs = performance.now() - startedAt
  assert.equal(catalog.items.length, 1500)
  assert.deepEqual(catalog.items.map((item) => item.position), Array.from({ length: 1500 }, (_, index) => index + 1))
  assert.ok(catalog.items.some((item) => item.id === 1499))
  assert.ok(projectionMs < 250, `1,500 章连续目录投影耗时 ${projectionMs.toFixed(2)}ms`)

  const byPosition = projectChapterTree(chapters, '第 1500 章')
  assert.deepEqual(byPosition.items.map((item) => item.id), [1500])
  const byTitle = projectChapterTree(chapters, '回灯')
  assert.deepEqual(byTitle.items.map((item) => item.id), [1500])
  assert.deepEqual(chapters.slice(0, 3).map((item) => item.id), [1, 2, 3])
})

test('opens the authoritative last edited chapter and safely falls back to the first valid chapter', () => {
  assert.equal(preferredChapterForOpen(chapters.slice(0, 3), 3)?.id, 3)
  assert.equal(preferredChapterForOpen(chapters.slice(0, 3), 999)?.id, 1)
  assert.equal(preferredChapterForOpen([], 3), null)
})

test('groups chapters only by formal volume placements and keeps unknown placement unassigned', () => {
  const sample = chapters.slice(0, 5)
  const groups = projectChapterVolumeGroups(sample, [
    { volume: 2, title: '雨夜' },
    { volume: 1, title: '相识' }
  ], [
    { chapterId: 1, volume: 1 },
    { chapterId: 2, volume: 1 },
    { chapterId: 3, volume: 2 },
    { chapterId: 4, volume: 9 }
  ])
  assert.deepEqual(groups.map((group) => [group.key, group.title, group.chapters.map((chapter) => chapter.id)]), [
    ['volume-1', '相识', [1, 2]],
    ['volume-2', '雨夜', [3]],
    ['unassigned', '未分卷', [4, 5]]
  ])
  assert.deepEqual(projectChapterVolumeGroups(sample, [], []).map((group) => group.chapters.map((chapter) => chapter.id)), [[1, 2, 3, 4, 5]])
})
