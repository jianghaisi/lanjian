import assert from 'node:assert/strict'
import test from 'node:test'
import { initialChapterLifecycle, transitionChapterLifecycle } from '../../../src/main/modules/manuscript/domain/chapter-lifecycle'

test('keeps chapter lifecycle independent from outline review and fact approval state', () => {
  let lifecycle = initialChapterLifecycle(false)
  assert.deepEqual(lifecycle, { status: 'PLANNED', archivedFrom: null })
  lifecycle = transitionChapterLifecycle(lifecycle, 'DRAFTING')
  lifecycle = transitionChapterLifecycle(lifecycle, 'REVIEWABLE')
  lifecycle = transitionChapterLifecycle(lifecycle, 'CONFIRMED')
  lifecycle = transitionChapterLifecycle(lifecycle, 'REVISING')
  lifecycle = transitionChapterLifecycle(lifecycle, 'REVIEWABLE')
  assert.deepEqual(lifecycle, { status: 'REVIEWABLE', archivedFrom: null })
})

test('archives from every active state and restores only the exact previous state', () => {
  for (const status of ['PLANNED', 'DRAFTING', 'REVIEWABLE', 'CONFIRMED', 'REVISING'] as const) {
    const archived = transitionChapterLifecycle({ status, archivedFrom: null }, 'ARCHIVED')
    assert.deepEqual(archived, { status: 'ARCHIVED', archivedFrom: status })
    assert.deepEqual(transitionChapterLifecycle(archived, status), { status, archivedFrom: null })
    assert.throws(() => transitionChapterLifecycle(archived, status === 'PLANNED' ? 'DRAFTING' : 'PLANNED'))
  }
})

test('rejects illegal shortcuts while allowing idempotent state writes', () => {
  const planned = initialChapterLifecycle(false)
  assert.equal(transitionChapterLifecycle(planned, 'PLANNED'), planned)
  assert.throws(() => transitionChapterLifecycle(planned, 'CONFIRMED'))
  assert.throws(() => transitionChapterLifecycle({ status: 'CONFIRMED', archivedFrom: null }, 'DRAFTING'))
})
