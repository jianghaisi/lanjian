import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { decodeConfirmedImportCommitArgs, decodeConfirmedImportManifestArgs, decodeImportResumeArgs } from '../../../src/contracts/library/import-ipc'

const file = { token: randomUUID(), ownership: 'owned', creationMethod: 'human', title: '临时正文' }
const book = 'C:\\temporary-books\\book-a'
test('public import mutations require the confirmed destination and reject extra fields', () => {
  assert.throws(() => decodeConfirmedImportCommitArgs([file]))
  assert.throws(() => decodeConfirmedImportManifestArgs([{ id: randomUUID(), files: [file] }]))
  assert.throws(() => decodeImportResumeArgs([randomUUID()]))
  for (const expectedWorkItemId of ['', null, 1, 'x'.repeat(4097)]) {
    assert.throws(() => decodeConfirmedImportCommitArgs([{ ...file, expectedWorkItemId }]))
  }
  assert.throws(() => decodeConfirmedImportCommitArgs([{ ...file, expectedWorkItemId: book, arbitraryPath: book }]))
})
test('public import decoders preserve destination, selection and resume identity', () => {
  const input = { ...file, selectedChapterIndexes: [0, 2], expectedWorkItemId: book }
  assert.deepEqual(decodeConfirmedImportCommitArgs([input]), [input])
  const manifest = { id: randomUUID(), files: [file], expectedWorkItemId: book }
  assert.deepEqual(decodeConfirmedImportManifestArgs([manifest]), [manifest])
  assert.deepEqual(decodeImportResumeArgs([manifest.id, book]), [manifest.id, book])
  assert.throws(() => decodeConfirmedImportManifestArgs([{ ...manifest, files: [input] }]), 'nested destination must not be silently ignored')
})
