import test from 'node:test'
import assert from 'node:assert/strict'
import { createOutlineStorageFeedback } from '../../../src/renderer/features/planning/composables/outline-storage-feedback'
import { WorkspaceRequestGuard } from '../../../src/contracts/library/workspace-request-guard'
import type { SqliteStorageStatus } from '../../../src/contracts/index'

const status = (mode: 'files' | 'sqlite' = 'sqlite'): SqliteStorageStatus => ({ storageMode: mode, databaseExists: mode === 'sqlite', chapterCount: 1, outlineCount: 2, outlineStorageMode: mode, promptStorageMode: mode, promptMirrorStatus: null, outlinePendingMirrors: 0, outlineConflictMirrors: 0, outlineFailedMirrors: 0, pendingMirrors: 0, conflictMirrors: 0, failedMirrors: 0 })
test('book storage capability alone does not claim an individual outline is saved or synced', async () => {
  const identity = { id: 'book', path: 'book-path' }, requests = new WorkspaceRequestGuard(); requests.begin(identity)
  for (const textAuthority of ['files-v1', undefined] as const) {
    const feedback = createOutlineStorageFeedback(async () => ({ ...status(), textAuthority }), () => identity, requests)
    await feedback.refresh()
    assert.doesNotMatch(feedback.describe('never-created').text, /已保存|已存入|已同步/)
  }
})
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
  assert.match(feedback.describe('total').text, /存储方式：Markdown/)
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
  assert.match(feedback.describe('total').text, /存储方式：Markdown/)
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
  assert.match(feedback.describe('total').text, /存储方式：数据库/)
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
  assert.equal(feedback.describe('total').warning, false); assert.match(feedback.describe('total').text, /文件状态需逐篇核对/)
})

test('same-entry file authority avoids a duplicate read and retains a newer save warning', async () => {
  const identity = { id: 'book', path: 'book-path' }, requests = new WorkspaceRequestGuard(), request = requests.begin(identity)
  let reads = 0
  const loaded = { ...status(), textAuthority: 'files-v1' as const }
  const feedback = createOutlineStorageFeedback(async () => { reads++; return loaded }, () => identity, requests)
  feedback.record('total', { storageMode: 'sqlite', mirrorStatus: 'conflict' })
  assert.equal(feedback.initializeFileAuthority(loaded, request), true)
  assert.equal(reads, 0)
  assert.equal(feedback.describe('total').warning, true)
  assert.match(feedback.describe('volume:1').text, /存储方式：Markdown/)
  await feedback.refresh()
  assert.equal(reads, 1); assert.equal(feedback.describe('total').warning, false)
})

test('entry initialization rejects missing, legacy, stale and switched-book results', async () => {
  let identity = { id: 'book', path: 'book-path' }
  const requests = new WorkspaceRequestGuard(), request = requests.begin(identity)
  const loaded = { ...status(), textAuthority: 'files-v1' as const }
  const feedback = createOutlineStorageFeedback(async () => loaded, () => identity, requests)
  assert.equal(feedback.initializeFileAuthority(null, request), false)
  assert.equal(feedback.initializeFileAuthority(status(), request), false)
  requests.begin(identity)
  assert.equal(feedback.initializeFileAuthority(loaded, request), false)
  const newer = requests.capture(identity); identity = { ...identity, path: 'other-book' }
  assert.equal(feedback.initializeFileAuthority(loaded, newer), false)
  assert.equal(feedback.describe('total').text, '存储状态待确认')
})

test('entry initialization invalidates an older in-flight feedback response', async () => {
  const identity = { id: 'book', path: 'book-path' }, requests = new WorkspaceRequestGuard(), request = requests.begin(identity)
  const pending = deferred<SqliteStorageStatus>()
  const feedback = createOutlineStorageFeedback(() => pending.promise, () => identity, requests)
  const old = feedback.refresh()
  assert.equal(feedback.initializeFileAuthority({ ...status(), textAuthority: 'files-v1' }, request), true)
  pending.reject(new Error('obsolete')); await old
  assert.equal(feedback.error.value, false)
  assert.match(feedback.describe('total').text, /存储方式：Markdown/)
})
