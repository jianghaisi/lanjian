import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { decodeDocumentTarget, decodeOpenReview, decodePrepare, decodeSyncDraft, decodeDraft, decodeReceipt, decodeOutlineVersionInput, reviewResultDecoders } from '../../../src/contracts/document-review/validation'
import { snapshotChange } from '../../../src/contracts/document-review/text-change'
const document = { workItemId: 'isolated-book', kind: 'body', documentId: randomUUID() }
test('optional IPC fields are optional while required fields stay validated', () => {
  assert.deepEqual(decodeDocumentTarget({ workItemId: 'book', kind: 'total' }), { workItemId: 'book', kind: 'total' })
  assert.equal(decodeOpenReview({ document, taskId: 'task' }).allowFailedReview, undefined)
  assert.equal(decodeSyncDraft({ document, expectedDraftRevision: 1, title: '章', changes: [] }).changes.length, 0)
  assert.throws(() => decodeOpenReview({ document }))
})
test('review IPC rejects paths, extra write authority, unbounded or malformed ranges', () => {
  assert.throws(() => decodeDocumentTarget({ ...document, documentId: '../正文.md' }))
  assert.throws(() => decodePrepare({ document, blockId: 'b', operationId: randomUUID(), expectedDraftRevision: 1, content: 'injected' }))
  assert.throws(() => decodeSyncDraft({ document, expectedDraftRevision: 1, title: '章', changes: [{ from: 2, to: 1, insert: '' }] }))
  assert.throws(() => decodeSyncDraft({ document, expectedDraftRevision: 1, title: '章', changes: [], historyDirection: 'manual' }))
  assert.throws(() => decodeReceipt({ id: 'fake', document, sourceLinks: [] }))
  assert.throws(() => decodeDraft({ document, content: 'missing formal baseline' }))
})
test('snapshot transactions round trip emoji, CRLF, empty documents and repeated text', () => {
  for (const [before, after] of [['甲😀乙', '甲😁乙'], ['\r\n甲', '甲\r\n'], ['', '新增'], ['重复重复', '重复'], ['abc', 'abc'], ['😀', '']]) {
    let cursor = 0, result = ''
    for (const edit of snapshotChange(before!, after!)) { result += before!.slice(cursor, edit.from) + edit.insert; cursor = edit.to }
    assert.equal(result + before!.slice(cursor), after)
  }
})

test('outline history is bounded and cannot carry another write operation', () => {
  const outline = { ...document, kind: 'total' }
  assert.throws(() => decodeOutlineVersionInput({ document, versionId: 'body-version' }))
  assert.throws(() => decodeOutlineVersionInput({ document: outline, versionId: 'v', content: 'write-through' }))
  assert.deepEqual(decodeOutlineVersionInput({ document: outline, versionId: 'v' }), { document: outline, versionId: 'v' })
  const entry = { versionId: 'v', versionNo: 1, sourceType: 'manual', createdAt: new Date().toISOString() }
  assert.equal(reviewResultDecoders['document-review:outline-history']([entry]).length, 1)
  assert.throws(() => reviewResultDecoders['document-review:outline-history'](Array(51).fill(entry)))
  assert.throws(() => reviewResultDecoders['document-review:outline-version']({ version: entry, content: 3 }))
})
