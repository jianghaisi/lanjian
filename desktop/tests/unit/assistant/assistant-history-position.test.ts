import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAssistantHistoryPositions } from '../../../src/renderer/features/assistant/services/assistant-history-position'

test('records and record kinds retain independent positions', () => {
  const positions = createAssistantHistoryPositions()
  positions.save('run:one', 'reply', 900)
  positions.save('field:one', 'candidate', 450)
  assert.equal(positions.restore('run:one', 'reply'), 900)
  assert.equal(positions.restore('field:one', 'candidate'), 450)
  assert.equal(positions.restore('run:new', 'reply'), 0)
})

test('saved positions remain exact, including the start and near-start of the document', () => {
  const positions = createAssistantHistoryPositions()
  positions.save('run:one', 'reply', 900)
  assert.equal(positions.restore('run:one', 'reply'), 900)
  positions.save('run:start', 'reply', 0)
  assert.equal(positions.restore('run:start', 'reply'), 0)
  positions.save('run:near', 'reply', 30)
  assert.equal(positions.restore('run:near', 'reply'), 30)
})

test('changed full content invalidates an old position even when only the end changed', () => {
  const positions = createAssistantHistoryPositions(), content = '长文'.repeat(10000)
  positions.save('run:one', content + '旧尾', 800)
  assert.equal(positions.restore('run:one', content + '新尾'), 0)
  assert.equal(positions.restore('run:one', content + '旧尾'), 0)
})

test('book or component cleanup drops all positions', () => {
  const positions = createAssistantHistoryPositions()
  positions.save('run:one', 'reply', 900)
  positions.clear()
  assert.equal(positions.restore('run:one', 'reply'), 0)
})

test('at most 32 recently saved records are kept, revisits update recency', () => {
  const positions = createAssistantHistoryPositions()
  for (let i = 0; i < 32; i++) positions.save('run:' + i, 'reply', 300)
  positions.save('run:0', 'reply', 600)
  positions.save('run:32', 'reply', 300)
  assert.equal(positions.restore('run:0', 'reply'), 600)
  assert.equal(positions.restore('run:1', 'reply'), 0)
  assert.equal(positions.restore('run:32', 'reply'), 300)
})

test('invalid layout samples do not destroy a valid position', () => {
  const positions = createAssistantHistoryPositions()
  positions.save('run:one', 'reply', 900)
  for (const top of [NaN, Infinity, -1]) positions.save('run:one', 'reply', top)
  assert.equal(positions.restore('run:one', 'reply'), 900)
})
