import assert from 'node:assert/strict'
import test from 'node:test'
import type { FactChangeView } from '../../../src/contracts/index'
import { isFactChangeVisible, visibleFactChanges } from '../../../src/contracts/review/fact-review-filter'

function change(id: string, importance: FactChangeView['importance'], changeType: FactChangeView['changeType']): FactChangeView {
  return {
    id,
    batchId: 'batch-1',
    candidateType: 'character_dynamic',
    subjectType: 'character',
    subjectId: null,
    subjectJson: JSON.stringify({ name: '沈砚' }),
    predicate: 'location',
    objectJson: JSON.stringify('旧城墙下'),
    normalizedKey: `character:${id}:location`,
    evidenceJson: JSON.stringify({ quote: '他在旧城墙下停步。' }),
    confidence: null,
    importance,
    changeType,
    matchedFactId: null,
    decisionStatus: 'PENDING',
    editedObjectJson: null,
    createdAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z'
  }
}

test('keeps conflicts visible even below the selected fact-review threshold', () => {
  assert.equal(isFactChangeVisible(change('conflict', 'low', 'CONTRADICTS'), {
    minimumImportance: 'high', showConfirmations: false
  }), true)
})

test('uses the medium starting suggestion to hide low-priority and duplicate confirmations', () => {
  const changes = [
    change('high', 'high', 'CHANGED'),
    change('medium', 'medium', 'NEW'),
    change('low', 'low', 'NEW'),
    change('model-low-value', 'medium', 'LOW_VALUE'),
    change('confirmation', 'high', 'CONFIRMS')
  ]
  assert.deepEqual(visibleFactChanges(changes, {
    minimumImportance: 'medium', showConfirmations: false
  }).map((item) => item.id), ['high', 'medium'])
})

test('can reveal every candidate when the author explicitly chooses the full review view', () => {
  const changes = [change('low', 'low', 'NEW'), change('model-low-value', 'medium', 'LOW_VALUE'), change('confirmation', 'low', 'CONFIRMS')]
  assert.deepEqual(visibleFactChanges(changes, {
    minimumImportance: 'low', showConfirmations: true
  }).map((item) => item.id), ['low', 'model-low-value', 'confirmation'])
})
