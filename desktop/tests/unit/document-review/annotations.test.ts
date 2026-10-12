import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { decodeAnnotationCreate, decodeAnnotationChange, decodeAnnotationList, decodeAnnotationUpdate } from '../../../src/contracts/document-review/annotation-validation'
const document = { workItemId: 'book', kind: 'total', documentId: randomUUID() }
const input = { document, operationId: randomUUID(), expectedRevision: 'a'.repeat(64), expectedDraftRevision: null, title: '总纲', draftText: '正文😀', start: 0, end: 2, body: '意见' }
test('annotation creation validates selection, bounded text, real document reference and revision', () => {
  assert.deepEqual(decodeAnnotationCreate(input), input)
  assert.throws(() => decodeAnnotationCreate({ ...input, end: 0 }))
  assert.throws(() => decodeAnnotationCreate({ ...input, end: 100 }))
  assert.throws(() => decodeAnnotationCreate({ ...input, body: ' ' }))
  assert.throws(() => decodeAnnotationCreate({ ...input, body: '字'.repeat(10_001) }))
  assert.throws(() => decodeAnnotationCreate({ ...input, filePath: '正文.md' }))
  assert.throws(() => decodeAnnotationCreate({ ...input, expectedRevision: 'fake' }))
})
test('annotation lists are bounded and every change names an expected version', () => {
  assert.deepEqual(decodeAnnotationList({ document }), { document })
  assert.throws(() => decodeAnnotationList({ document, cursor: -1 }))
  const edit = { document, id: randomUUID(), operationId: randomUUID(), expectedAnnotationRevision: 1 }
  assert.deepEqual(decodeAnnotationChange(edit), edit)
  assert.throws(() => decodeAnnotationUpdate({ ...edit, expectedAnnotationRevision: 0, body: '意见' }))
})
