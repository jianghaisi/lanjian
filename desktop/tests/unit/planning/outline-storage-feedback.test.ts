import test from 'node:test'
import assert from 'node:assert/strict'
import { createOutlineStorageFeedback } from '../../../src/renderer/features/planning/composables/outline-storage-feedback'
import { WorkspaceRequestGuard } from '../../../src/contracts/library/workspace-request-guard'
import type { SqliteStorageStatus } from '../../../src/contracts/index'

const status = (mode: 'files' | 'sqlite' = 'sqlite'): SqliteStorageStatus => ({ storageMode: mode, databaseExists: mode === 'sqlite', chapterCount: 1, outlineCount: 2, outlineStorageMode: mode, promptStorageMode: mode, promptMirrorStatus: null, outlinePendingMirrors: 0, outlineConflictMirrors: 0, outlineFailedMirrors: 0, pendingMirrors: 0, conflictMirrors: 0, failedMirrors: 0 })
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((a,b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

test('unknown, failed and loading outline status never imply Markdown file authority', async () => {
  const identity = { id: 'book', path: 'book-path' }, requests = new WorkspaceRequestGuard(); requests.begin(identity)
  const pending = deferred<SqliteStorageStatus>()
  const feedback = createOutlineStorageFeedback(() => pending.promise, () => identity, requests)
  assert.equal(feedback.describe('total').text, '存储状态待确认')
  const reading = feedback.refresh(); assert.match(feedback.describe('total').text, /正在核对/)
  pending.reject(new Error('failed')); await reading
  assert.equal(feedback.error.value, true); assert.equal(feedback.describe('total').text, '存储状态待确认')
})

test('save receipt replaces stale file authority and scopes mirror outcomes to its document', async () => {
  const identity = { id: 'book', path: 'book-path' }, requests = new WorkspaceRequestGuard(); requests.begin(identity)
  const feedback = createOutlineStorageFeedback(async () => status('files'), () => identity, requests)
  await feedback.refresh()
  assert.equal(feedback.describe('total').text, '已保存为 Markdown')
  feedback.record('total', { storageMode: 'sqlite', mirrorStatus: 'conflict' })
  assert.equal(feedback.describe('total').warning, true); assert.match(feedback.describe('total').text, /当前 Markdown 镜像待处理/)
  assert.equal(feedback.describe('volume:1').text, '存储状态待确认')
  feedback.record('total', { storageMode: 'sqlite', mirrorStatus: 'synced' })
  assert.match(feedback.describe('total').text, /Markdown 已同步/)
  feedback.record('stage:1', { storageMode: 'sqlite' })
  assert.match(feedback.describe('stage:1').text, /同步状态待确认/)
  assert.match(feedback.describe('total').text, /Markdown 已同步/)
})

test('missing mirror receipt cannot borrow even a prior clean SQLite summary', async () => {
  const identity = { id: 'book', path: 'book-path' }, requests = new WorkspaceRequestGuard(); requests.begin(identity)
  const feedback = createOutlineStorageFeedback(async () => status(), () => identity, requests)
  await feedback.refresh(); feedback.record('total', { storageMode: 'sqlite' })
  assert.match(feedback.describe('total').text, /同步状态待确认/)
})

test('file-authoritative outlines never claim their body is in SQLite', async () => {
  const identity = { id: 'book', path: 'book-path' }, requests = new WorkspaceRequestGuard(); requests.begin(identity)
  const feedback = createOutlineStorageFeedback(async () => ({ ...status(), textAuthority: 'files-v1' }), () => identity, requests)
  await feedback.refresh()
  assert.match(feedback.describe('total').text, /保存为 Markdown/)
  feedback.record('total', { storageMode: 'sqlite', mirrorStatus: 'synced' })
  assert.match(feedback.describe('total').text, /数据库仅记录/)
  feedback.record('total', { storageMode: 'sqlite', mirrorStatus: 'conflict' })
  assert.equal(feedback.describe('total').warning, true)
})

test('latest status read wins, and a save receipt invalidates an older pending read', async () => {
  const identity = { id: 'book', path: 'book-path' }, requests = new WorkspaceRequestGuard(); requests.begin(identity)
  const responses = [deferred<SqliteStorageStatus>(), deferred<SqliteStorageStatus>(), deferred<SqliteStorageStatus>()]; let index = 0
  const feedback = createOutlineStorageFeedback(() => responses[index++]!.promise, () => identity, requests)
  const old = feedback.refresh(), newer = feedback.refresh()
  responses[1]!.resolve(status()); await newer; responses[0]!.resolve(status('files')); await old
  assert.match(feedback.describe('total').text, /SQLite/)
  const pending = feedback.refresh(); feedback.record('total', { storageMode: 'sqlite', mirrorStatus: 'failed' })
  responses[2]!.resolve(status()); await pending
  assert.match(feedback.describe('total').text, /待处理/); assert.equal(feedback.loading.value, false)
})

test('reset and same-ID different-path switching discard late success and error', async () => {
  let identity = { id: 'book', path: 'book-path' }; const requests = new WorkspaceRequestGuard(); requests.begin(identity)
  const responses = [deferred<SqliteStorageStatus>(), deferred<SqliteStorageStatus>()]; let index = 0
  const feedback = createOutlineStorageFeedback(() => responses[index++]!.promise, () => identity, requests)
  const reading = feedback.refresh()
  identity = { id: 'book', path: 'copy-path' }; requests.begin(identity); feedback.reset()
  responses[0]!.resolve(status()); await reading
  assert.equal(feedback.describe('total').text, '存储状态待确认')
  const error = feedback.refresh(); requests.invalidate(); feedback.reset(); responses[1]!.reject(new Error('late')); await error
  assert.equal(feedback.error.value, false); assert.equal(feedback.loading.value, false)
})

test('fresh reread can confirm repaired mirrors and clear previous receipt warnings', async () => {
  const identity = { id: 'book', path: 'book-path' }, requests = new WorkspaceRequestGuard(); requests.begin(identity)
  let response = { ...status(), outlineConflictMirrors: 1 }
  const feedback = createOutlineStorageFeedback(async () => response, () => identity, requests)
  await feedback.refresh(); assert.equal(feedback.describe('total').warning, true)
  feedback.record('total', { storageMode: 'sqlite', mirrorStatus: 'failed' })
  response = { ...status(), outlineConflictMirrors: 0 }; await feedback.refresh()
  assert.equal(feedback.describe('total').warning, false); assert.match(feedback.describe('total').text, /Markdown 已同步/)
})
