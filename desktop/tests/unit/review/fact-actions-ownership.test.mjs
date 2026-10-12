import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { WorkspaceRequestGuard } from '../../../src/contracts/library/workspace-request-guard.ts'
import { createReviewFactsActions } from '../../../src/renderer/features/review/composables/create-facts-actions.js'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const a = { id: 'a', path: '/books/a' }, b = { id: 'b', path: '/books/b' }, notices = [], calls = []
  const ports = {
    current: ref(a), workspaceRequests: new WorkspaceRequestGuard(), selectedId: ref(1), chapterSelectionGeneration: 0,
    factReviewBusy: ref(false), factExtractionBusy: ref(false), factExtractionJobId: ref(''),
    factExtractionRetryId: ref(''), factExtractionRawResult: ref(''), factBatches: ref([]), contextFactPackKey: 'original',
    notice: text => notices.push(text), refreshWorkflow: async () => { calls.push(['refresh']) },
    desktop: { workspace: {
      startFactExtraction: async id => { calls.push(['start', id]); return { id: 'job', status: 'running' } },
      getFactExtractionJob: async id => { calls.push(['poll', id]); return { id, status: 'running' } },
      cancelFactExtraction: async id => { calls.push(['cancel', id]); return { id, status: 'cancelled' } },
      retryFactExtraction: async (id, operation) => { calls.push(['retry', id, operation]); return { id: 'retry', status: 'running' } },
      decideFactChanges: async input => { calls.push(['decide', input]); return { id: 'batch', status: 'APPROVED' } }
    } }
  }
  const actions = createReviewFactsActions(ports)
  t.after(() => actions.dispose())
  return { ports, actions, a, b, notices, calls, api: ports.desktop.workspace,
    navigate(book) { ports.workspaceRequests.begin(book); ports.current.value = book },
    chapter(id) { ports.chapterSelectionGeneration++; ports.selectedId.value = id } }
}

test('factory defers live-port reads until initialized; disposal detaches polling', async t => {
  const f = fixture(t)
  let initialized = false
  const lazy = createReviewFactsActions(new Proxy(f.ports, { get(target, key) { assert.ok(initialized); return target[key] } }))
  initialized = true
  await lazy.extractCurrentChapterFacts(); await flush()
  lazy.dispose(); lazy.dispose(); const before = f.calls.length
  t.mock.timers.tick(2000); await flush(); await lazy.extractCurrentChapterFacts()
  assert.equal(f.calls.length, before); assert.equal(f.ports.factExtractionBusy.value, false)
})

test('running across polling intervals retains original stop target and prevents duplicate starts', async t => {
  const f = fixture(t)
  await f.actions.extractCurrentChapterFacts(); await flush()
  t.mock.timers.tick(500); await flush(); t.mock.timers.tick(500); await flush()
  assert.equal(f.ports.factExtractionBusy.value, true); assert.equal(f.ports.factExtractionJobId.value, 'job')
  await f.actions.extractCurrentChapterFacts()
  assert.equal(f.calls.filter(c => c[0] === 'start').length, 1)
  assert.equal(f.calls.filter(c => c[0] === 'poll').length, 3)
  await f.actions.cancelFactExtraction(); const count = f.calls.length
  t.mock.timers.tick(2000); await flush()
  assert.deepEqual(f.calls.find(c => c[0] === 'cancel'), ['cancel', 'job'])
  assert.equal(f.ports.factExtractionBusy.value, false); assert.equal(f.ports.factExtractionJobId.value, '')
  assert.equal(f.calls.length, count)
})

test('start rejection releases loading and allows another attempt', async t => {
  const f = fixture(t)
  f.api.startFactExtraction = async () => { throw Error('START_FAILED') }
  await f.actions.extractCurrentChapterFacts()
  assert.equal(f.ports.factExtractionBusy.value, false); assert.equal(f.ports.factExtractionJobId.value, '')
  assert.deepEqual(f.notices, ['START_FAILED'])
  f.api.startFactExtraction = async () => ({ id: 'new', status: 'running' })
  await f.actions.extractCurrentChapterFacts(); await flush()
  assert.equal(f.ports.factExtractionJobId.value, 'new')
})

test('retry rejection preserves recoverable task and raw evidence while releasing loading', async t => {
  const f = fixture(t)
  f.ports.factExtractionRetryId.value = 'old'; f.ports.factExtractionRawResult.value = 'original raw'
  f.api.retryFactExtraction = async () => { throw Error('RETRY_FAILED') }
  await f.actions.retryFactExtraction()
  assert.equal(f.ports.factExtractionBusy.value, false); assert.equal(f.ports.factExtractionJobId.value, '')
  assert.equal(f.ports.factExtractionRetryId.value, 'old'); assert.equal(f.ports.factExtractionRawResult.value, 'original raw')
  assert.deepEqual(f.notices, ['RETRY_FAILED'])
})

for (const kind of ['start', 'retry', 'poll', 'decide', 'cancel']) for (const error of [false, true]) {
  test(`${kind} ignores old ${error ? 'failure' : 'success'} after book A-B-A without clearing the new owner`, async t => {
    const f = fixture(t), pending = deferred()
    const methods = { start: 'startFactExtraction', retry: 'retryFactExtraction', poll: 'getFactExtractionJob', decide: 'decideFactChanges', cancel: 'cancelFactExtraction' }
    if (kind === 'retry') { f.ports.factExtractionRetryId.value = 'old'; f.ports.factExtractionRawResult.value = 'old raw' }
    if (kind === 'cancel') { await f.actions.extractCurrentChapterFacts(); await flush() }
    f.api[methods[kind]] = () => pending.promise
    let operation
    if (kind === 'decide') operation = f.actions.decideFactChanges({ batchId: 'old-batch' })
    else if (kind === 'retry') operation = f.actions.retryFactExtraction()
    else if (kind === 'cancel') operation = f.actions.cancelFactExtraction()
    else operation = f.actions.extractCurrentChapterFacts()
    if (kind === 'poll') await operation
    f.navigate(f.b); f.navigate(f.a)
    f.ports.factBatches.value = [{ id: 'new-batch' }]; f.ports.contextFactPackKey = 'new-key'
    f.ports.factExtractionRetryId.value = 'new-retry'; f.ports.factExtractionRawResult.value = 'new-raw'
    const next = deferred()
    if (kind === 'decide') { f.api.decideFactChanges = () => next.promise; void f.actions.decideFactChanges({ batchId: 'new' }) }
    else { f.api.startFactExtraction = () => next.promise; void f.actions.extractCurrentChapterFacts() }
    const expected = {
      busy: f.ports.factExtractionBusy.value, review: f.ports.factReviewBusy.value,
      retry: f.ports.factExtractionRetryId.value, raw: f.ports.factExtractionRawResult.value
    }
    error ? pending.reject(Error('STALE_ERROR')) : pending.resolve({ id: kind === 'decide' ? 'old-batch' : 'job', status: 'completed', batch: {} })
    await operation; await flush(); t.mock.timers.tick(1000); await flush()
    assert.deepEqual(f.notices, []); assert.equal(f.calls.filter(c => c[0] === 'refresh').length, 0)
    assert.deepEqual(f.ports.factBatches.value, [{ id: 'new-batch' }]); assert.equal(f.ports.contextFactPackKey, 'new-key')
    assert.deepEqual({ busy: f.ports.factExtractionBusy.value, review: f.ports.factReviewBusy.value, retry: f.ports.factExtractionRetryId.value, raw: f.ports.factExtractionRawResult.value }, expected)
    f.actions.dispose(); next.resolve({ id: 'new', status: 'running' }); await flush()
  })
}

for (const back of [false, true]) for (const error of [false, true]) test(`chapter ${back ? 'A-B-A' : 'A-B'} discards late ${error ? 'error' : 'result'} and permits a new extraction`, async t => {
  const f = fixture(t), pending = deferred()
  f.api.getFactExtractionJob = () => pending.promise
  await f.actions.extractCurrentChapterFacts()
  f.chapter(2); if (back) f.chapter(1)
  assert.equal(f.ports.factExtractionBusy.value, false); assert.equal(f.ports.factExtractionJobId.value, '')
  f.api.getFactExtractionJob = async id => ({ id, status: 'running' })
  f.api.startFactExtraction = async () => ({ id: 'new', status: 'running' })
  await f.actions.extractCurrentChapterFacts(); await flush()
  error ? pending.reject(Error('OLD_CHAPTER')) : pending.resolve({ id: 'job', status: 'failed', rawResult: 'old raw' })
  await flush()
  assert.equal(f.ports.factExtractionBusy.value, true); assert.equal(f.ports.factExtractionJobId.value, 'new')
  assert.equal(f.ports.factExtractionRetryId.value, ''); assert.equal(f.ports.factExtractionRawResult.value, '')
  assert.deepEqual(f.notices, [])
})

test('same-ID request generation change cannot leave an old busy flag blocking a new run', async t => {
  const f = fixture(t), pending = deferred()
  f.api.startFactExtraction = () => pending.promise
  const first = f.actions.extractCurrentChapterFacts()
  f.ports.workspaceRequests.begin(f.a); f.ports.chapterSelectionGeneration++
  f.api.startFactExtraction = async () => ({ id: 'new', status: 'running' })
  await f.actions.extractCurrentChapterFacts(); await flush()
  pending.reject(Error('OLD_GENERATION')); await first
  assert.equal(f.ports.factExtractionJobId.value, 'new'); assert.equal(f.ports.factExtractionBusy.value, true); assert.deepEqual(f.notices, [])
})

test('completed poll rechecks ownership after workflow refresh before notices or final loading updates', async t => {
  const f = fixture(t), refreshed = deferred()
  f.api.getFactExtractionJob = async id => ({ id, status: 'completed', batch: {} })
  f.ports.refreshWorkflow = () => refreshed.promise
  await f.actions.extractCurrentChapterFacts(); await flush()
  f.navigate(f.b)
  f.api.getFactExtractionJob = async id => ({ id, status: 'running' })
  f.api.startFactExtraction = async () => ({ id: 'new', status: 'running' })
  await f.actions.extractCurrentChapterFacts(); await flush()
  refreshed.resolve(); await flush()
  assert.equal(f.ports.factExtractionBusy.value, true); assert.equal(f.ports.factExtractionJobId.value, 'new'); assert.deepEqual(f.notices, [])
})

test('cancelled original job discards an already pending running poll without resurrecting a timer', async t => {
  const f = fixture(t), pending = deferred()
  f.api.getFactExtractionJob = () => pending.promise
  await f.actions.extractCurrentChapterFacts()
  await f.actions.cancelFactExtraction(); pending.resolve({ id: 'job', status: 'running' }); await flush()
  const count = f.calls.length; t.mock.timers.tick(2000); await flush()
  assert.equal(f.calls.length, count); assert.equal(f.ports.factExtractionBusy.value, false)
  assert.deepEqual(f.notices, ['已请求停止变化提炼'])
})

test('failed cancellation preserves original running task for the next poll', async t => {
  const f = fixture(t)
  await f.actions.extractCurrentChapterFacts(); await flush()
  f.api.cancelFactExtraction = async () => { throw Error('CANCEL_FAILED') }
  await f.actions.cancelFactExtraction(); t.mock.timers.tick(500); await flush()
  assert.equal(f.ports.factExtractionJobId.value, 'job'); assert.equal(f.ports.factExtractionBusy.value, true)
  assert.equal(f.calls.filter(c => c[0] === 'poll').length, 2); assert.deepEqual(f.notices, ['CANCEL_FAILED'])
})

test('stop during asynchronous start waits for the real task ID and cancels that task once', async t => {
  const f = fixture(t), pending = deferred()
  f.api.startFactExtraction = () => pending.promise
  const starting = f.actions.extractCurrentChapterFacts()
  await f.actions.cancelFactExtraction(); await f.actions.cancelFactExtraction()
  assert.equal(f.calls.filter(c => c[0] === 'cancel').length, 0)
  pending.resolve({ id: 'prepared-task', status: 'running' }); await starting; await flush()
  assert.deepEqual(f.calls.filter(c => c[0] === 'cancel'), [['cancel', 'prepared-task']])
  assert.equal(f.ports.factExtractionBusy.value, false); assert.equal(f.ports.factExtractionJobId.value, '')
})

test('completed cancellation response with failed refresh releases loading and reports the actual failure', async t => {
  const f = fixture(t)
  await f.actions.extractCurrentChapterFacts(); await flush()
  f.api.cancelFactExtraction = async id => ({ id, status: 'completed', batch: {} })
  f.ports.refreshWorkflow = async () => { throw Error('REFRESH_FAILED') }
  await f.actions.cancelFactExtraction(); t.mock.timers.tick(1000); await flush()
  assert.equal(f.ports.factExtractionBusy.value, false); assert.equal(f.ports.factExtractionJobId.value, '')
  assert.equal(f.notices.at(-1), 'REFRESH_FAILED')
})

for (const status of ['completed', 'failed', 'interrupted']) test(`current ${status} publishes truthful terminal state and stops polling`, async t => {
  const f = fixture(t)
  f.api.getFactExtractionJob = async id => ({ id, status, rawResult: 'original raw', batch: {}, error: { message: 'CURRENT_FAILURE' } })
  await f.actions.extractCurrentChapterFacts(); await flush()
  assert.equal(f.ports.factExtractionBusy.value, false); assert.equal(f.ports.factExtractionJobId.value, '')
  assert.equal(f.ports.factExtractionRetryId.value, status === 'completed' ? '' : 'job')
  assert.equal(f.ports.factExtractionRawResult.value, status === 'completed' ? '' : 'original raw')
  const count = f.calls.length; t.mock.timers.tick(2000); await flush(); assert.equal(f.calls.length, count)
  assert.equal(f.notices.length, 1); assert.equal(f.calls.filter(c => c[0] === 'refresh').length, status === 'completed' ? 1 : 0)
})

test('current fact decision updates only confirmed returned batch and releases review loading', async t => {
  const f = fixture(t)
  await f.actions.decideFactChanges({ batchId: 'batch' })
  assert.deepEqual(f.ports.factBatches.value, [{ id: 'batch', status: 'APPROVED' }])
  assert.equal(f.ports.factReviewBusy.value, false); assert.equal(f.ports.contextFactPackKey, '')
  assert.equal(f.notices.length, 1); assert.equal(f.calls.filter(c => c[0] === 'refresh').length, 1)
})

test('disposal drops in-flight responses and does not cancel the durable background task', async t => {
  const f = fixture(t), pending = deferred()
  f.api.getFactExtractionJob = () => pending.promise
  await f.actions.extractCurrentChapterFacts(); f.actions.dispose()
  pending.resolve({ id: 'job', status: 'failed', rawResult: 'late raw' }); await flush()
  const count = f.calls.length; t.mock.timers.tick(2000); await flush()
  assert.equal(f.calls.length, count); assert.equal(f.calls.some(c => c[0] === 'cancel'), false)
  assert.equal(f.ports.factExtractionRawResult.value, ''); assert.deepEqual(f.notices, [])
})
