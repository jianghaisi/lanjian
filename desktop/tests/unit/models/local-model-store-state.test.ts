import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { createRenderer } from 'vue'
import { useLocalModels } from '../../../src/renderer/features/models/composables/use-local-models'
import type { LocalModelsApi, LocalModelView } from '../../../src/contracts/models/local-model-contracts'

const operationId = '00000000-0000-0000-0000-000000000001'
const anotherOperation = '00000000-0000-0000-0000-000000000002'
function row(patch: Partial<LocalModelView> = {}): LocalModelView {
  return { id: 'fixture', name: 'Fixture', family: 'Qwen', description: '', revision: 'fixture', bytes: 1,
    quantization: 'Q8_0', license: 'MIT', state: 'detected', capabilities: [], contextTokens: 8192,
    maxOutputTokens: 4096, recommendedOutputTokens: 2048, progress: 0, message: '待检测', canDownload: true, ...patch }
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

for (const outcome of ['ready', 'failed'] as const) {
  test(`settled ${outcome} inspection releases retry after fresh status while its old read is pending`, async t => {
    const inspected = deferred<LocalModelView>(), slow = deferred<LocalModelView[]>(), nextStart = deferred<LocalModelView>()
    const f = await mount({ inspect: () => inspected.promise, install: () => nextStart.promise })
    t.after(() => { f.unmount(); inspected.resolve(row()); slow.resolve([]); nextStart.resolve(row()) })
    f.api.list = async () => [row({ state: 'checking', operation: 'inspect', operationId })]
    const pending = f.state.inspect('fixture'); await setImmediate()
    f.api.list = () => slow.promise
    if (outcome === 'ready') inspected.resolve(row({ state: 'ready' }))
    else inspected.reject({ code: 'FEATURE_UNAVAILABLE', message: '检测失败，可重试。' })
    await setImmediate()
    assert.equal(f.state.checking.value, 'fixture', 'an observed operation remains protected until fresh status')
    f.api.list = async () => [row({ state: outcome, operation: 'inspect' })]; await f.state.refresh()
    assert.equal(f.state.checking.value, '', 'terminal status must release retry without waiting for the old read')
    if (outcome === 'failed') assert.match(f.state.actionError.value, /检测失败/)
    const next = f.state.install('other'); assert.equal(f.state.checking.value, 'other')
    slow.resolve([row({ state: 'checking', operation: 'inspect', operationId })]); await pending
    assert.equal(f.state.models.value[0].state, outcome)
    assert.equal(f.state.checking.value, 'other', 'old inspection cleanup must not clear the next command')
    nextStart.resolve(row({ id: 'other' })); await next
  })
}

for (const successorId of ['fixture', 'other']) {
  test(`an in-flight stop does not lock or report errors against successor model ${successorId}`, async t => {
    const oldStop = deferred<boolean>(), nextStop = deferred<boolean>(), calls: string[][] = []
    const f = await mount({ list: async () => [row({ state: 'downloading', operation: 'install', operationId })],
      cancel: async (id, operation) => { calls.push([id, operation]); return operation === operationId ? oldStop.promise : nextStop.promise } })
    t.after(() => { f.unmount(); oldStop.resolve(false); nextStop.resolve(false) })
    const previous = f.state.cancel(); await f.state.cancel(); assert.equal(calls.length, 1)
    f.api.list = async () => [row({ id: successorId, state: 'checking', operation: 'inspect', operationId: anotherOperation })]
    await f.state.refresh(); assert.equal(f.state.stopping.value, false, 'a different operation needs its own enabled stop')
    const next = f.state.cancel(); await f.state.cancel()
    assert.deepEqual(calls, [['fixture', operationId], [successorId, anotherOperation]])
    oldStop.reject({ code: 'CONFLICT', message: '旧操作已结束。' }); await previous
    assert.equal(f.state.stopping.value, true, 'old finally must not clear a pending successor stop')
    assert.equal(f.state.actionError.value, '', 'obsolete cancellation errors do not belong to the successor')
    f.api.list = async () => [row({ id: successorId, state: 'cancelled', operation: 'inspect' })]
    nextStop.resolve(true); await next
    assert.equal(f.state.stopping.value, false); assert.equal(f.state.checking.value, '')
  })
}

test('a stop awaiting a slow follow-up read cannot disable or clear a successor stop', async t => {
  const slow = deferred<LocalModelView[]>(), nextStop = deferred<boolean>(), calls: string[][] = []
  const f = await mount({ list: async () => [row({ state: 'downloading', operation: 'install', operationId })],
    cancel: async (id, operation) => { calls.push([id, operation]); return operation === operationId ? true : nextStop.promise } })
  t.after(() => { f.unmount(); slow.resolve([]); nextStop.resolve(false) })
  f.api.list = () => slow.promise; const previous = f.state.cancel(); await setImmediate()
  f.api.list = async () => [row({ state: 'downloading', operation: 'install', operationId })]; await f.state.refresh()
  assert.equal(f.state.stopping.value, true); await f.state.cancel(); assert.equal(calls.length, 1)
  f.api.list = async () => [row({ state: 'cancelled', operation: 'install' })]; await f.state.refresh()
  assert.equal(f.state.stopping.value, false)
  f.api.list = async () => [row({ id: 'other', state: 'checking', operation: 'inspect', operationId: anotherOperation })]; await f.state.refresh()
  const next = f.state.cancel(); assert.equal(f.state.stopping.value, true)
  slow.reject(Error('obsolete read error')); await previous
  assert.equal(f.state.stopping.value, true); assert.equal(f.state.error.value, '')
  assert.equal(f.state.checking.value, 'other')
  f.api.list = async () => [row({ id: 'other', state: 'cancelled', operation: 'inspect' })]
  nextStop.resolve(true); await next
  assert.deepEqual(calls, [['fixture', operationId], ['other', anotherOperation]])
})
async function mount(overrides: Partial<LocalModelsApi> = {}) {
  const api: LocalModelsApi = { list: async () => [row()], inspect: async () => row(), install: async () => row(), cancel: async () => true, ...overrides }
  let state!: ReturnType<typeof useLocalModels>
  const renderer = createRenderer<object, object>({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {}, patchProp() {}, insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null })
  const app = renderer.createApp({ setup() { state = useLocalModels(api); return () => null } })
  app.mount({}); await setImmediate()
  return { api, state, unmount: () => app.unmount() }
}

test('slow catalog polling never overlaps itself or starves progress updates', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const pending = deferred<LocalModelView[]>(); let calls = 0
  const f = await mount({ list: async () => ++calls === 1 ? [row()] : pending.promise })
  t.after(() => f.unmount())
  t.mock.timers.tick(1000); await setImmediate(); assert.equal(calls, 2)
  t.mock.timers.tick(6000); await setImmediate(); assert.equal(calls, 2, 'wait for the outstanding read before the next poll')
  pending.resolve([row({ state: 'checking', progress: 96, operation: 'inspect', operationId })]); await setImmediate()
  assert.equal(f.state.models.value[0].progress, 96)
})

test('action failure survives successful polling and dismissal does not hide a list failure', async t => {
  const f = await mount({ install: async () => { throw { code: 'CONFLICT', message: '另一窗口正在检测，请等待完成。', recoverable: true } } })
  t.after(() => f.unmount())
  await f.state.install('fixture'); await f.state.refresh()
  assert.equal(f.state.error.value, ''); assert.match(f.state.actionError.value, /另一窗口/)
  assert.equal(f.state.models.value.length, 1)
  f.api.list = async () => { throw Error('read failed') }; await f.state.refresh()
  f.state.dismissActionError()
  assert.equal(f.state.actionError.value, ''); assert.match(f.state.error.value, /暂时无法读取/)
  assert.equal(f.state.models.value.length, 0)
  f.api.list = async () => [row()]; await f.state.refresh(); assert.equal(f.state.error.value, '')
})

test('a rejected inspection is handled immediately even while its status list is delayed', async t => {
  const delayed = deferred<LocalModelView[]>()
  const f = await mount({ inspect: async () => { throw { code: 'CONFLICT', message: '检测被另一操作占用。', recoverable: true } } })
  t.after(() => f.unmount()); f.api.list = () => delayed.promise
  const inspection = f.state.inspect('fixture'); await setImmediate()
  assert.match(f.state.actionError.value, /另一操作/)
  delayed.resolve([row()]); await inspection
  assert.match(f.state.actionError.value, /另一操作/)
  assert.equal(f.state.checking.value, '')
})

test('unmount before the operation ID arrives cancels only that inspection once', async () => {
  const started = deferred<LocalModelView>(), status = deferred<LocalModelView[]>(), cancels: string[][] = []
  const f = await mount({ inspect: () => started.promise, cancel: async (id, operation) => { cancels.push([id, operation]); started.resolve(row({ state: 'cancelled' })); return true } })
  f.api.list = () => status.promise
  const inspection = f.state.inspect('fixture'); f.unmount()
  status.resolve([row({ state: 'checking', operation: 'inspect', operationId })]); await inspection; await setImmediate()
  assert.deepEqual(cancels, [['fixture', operationId]])
  assert.equal(f.state.models.value[0].state, 'detected', 'late results cannot repaint an unmounted view')
})

test('a later poll acquires inspection ownership after the first status read fails', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const pending = deferred<LocalModelView>(), cancels: string[][] = []
  const f = await mount({ inspect: () => pending.promise, cancel: async (id, operation) => { cancels.push([id, operation]); pending.resolve(row({ state: 'cancelled' })); return true } })
  f.api.list = async () => { throw Error('temporary read failure') }
  const inspection = f.state.inspect('fixture'); await setImmediate()
  f.api.list = async () => [row({ state: 'checking', operation: 'inspect', operationId })]
  t.mock.timers.tick(1000); await setImmediate(); f.unmount(); await inspection
  assert.deepEqual(cancels, [['fixture', operationId]])
})

test('late cleanup cannot cancel a successor after the original inspection settles', async () => {
  const status = deferred<LocalModelView[]>(), finished = deferred<LocalModelView>(); let cancels = 0
  const f = await mount({ inspect: () => finished.promise, cancel: async () => { cancels++; return true } })
  f.api.list = () => status.promise
  const inspection = f.state.inspect('fixture'); f.unmount(); finished.resolve(row({ state: 'ready' })); await inspection
  status.resolve([row({ state: 'checking', operation: 'inspect', operationId: anotherOperation })]); await setImmediate()
  assert.equal(cancels, 0)
})

test('view exit does not cancel a background installation or an inspection merely observed in the catalog', async () => {
  let cancels = 0
  const f = await mount({ cancel: async () => { cancels++; return true } })
  await f.state.install('fixture')
  f.api.list = async () => [row({ state: 'downloading', operation: 'install', operationId })]; await f.state.refresh()
  f.api.list = async () => { throw Error('unreadable') }; await f.state.refresh(); f.unmount()
  const other = await mount({ list: async () => [row({ state: 'checking', operation: 'inspect', operationId })], cancel: async () => { cancels++; return true } })
  other.unmount(); assert.equal(cancels, 0)
})

test('stop suppresses duplicate clicks and cannot retarget a newer operation', async t => {
  const stopped = deferred<boolean>(), calls: string[][] = []
  const f = await mount({ list: async () => [row({ state: 'downloading', operation: 'install', operationId })], cancel: async (id, operation) => { calls.push([id, operation]); return stopped.promise } })
  t.after(() => f.unmount())
  const first = f.state.cancel(); assert.equal(f.state.stopping.value, true)
  await f.state.cancel(); assert.deepEqual(calls, [['fixture', operationId]])
  f.api.list = async () => [row({ state: 'checking', operation: 'inspect', operationId: anotherOperation })]
  stopped.resolve(false); await first
  assert.equal(f.state.stopping.value, false); assert.equal(f.state.models.value[0].operationId, anotherOperation)
  assert.equal(calls.length, 1)
})

test('newer list success cannot be replaced by a stale failure and unmount stops polling', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const delayed = deferred<LocalModelView[]>(); let calls = 0
  const f = await mount(); f.api.list = () => { calls++; return delayed.promise }
  const old = f.state.refresh()
  f.api.list = async () => { calls++; return [row({ state: 'ready' })] }; await f.state.refresh()
  delayed.reject(Error('stale')); await old
  assert.equal(f.state.error.value, ''); assert.equal(f.state.models.value[0].state, 'ready')
  f.unmount(); t.mock.timers.tick(10000); await setImmediate(); assert.equal(calls, 2)
})

for (const kind of ['install', 'inspect'] as const) {
  test(`failed listing retains only the observed ${kind} stop identity until a terminal read`, async t => {
    const stopped = deferred<boolean>(), calls: string[][] = []
    const f = await mount({ list: async () => [row({ state: 'checking', operation: kind, operationId })],
      cancel: async (id, operation) => { calls.push([id, operation]); return stopped.promise } })
    t.after(() => f.unmount())
    f.api.list = async () => { throw Error('unreadable') }; await f.state.refresh()
    assert.deepEqual(f.state.models.value, []); assert.equal(f.state.checking.value, 'fixture')
    const stopping = f.state.cancel(); await f.state.cancel()
    assert.deepEqual(calls, [['fixture', operationId]]); assert.equal(f.state.stopping.value, true)
    stopped.resolve(true); await stopping
    assert.match(f.state.error.value, /暂时无法读取/)
    assert.equal(f.state.checking.value, 'fixture', 'accepted cancellation is not a terminal status')
    f.api.list = async () => [row({ state: 'cancelled', operation: kind })]; await f.state.refresh()
    assert.equal(f.state.checking.value, ''); await f.state.cancel(); assert.equal(calls.length, 1)
  })
}

test('stale cancellation forgets its handle even when the follow-up list still fails', async t => {
  let cancels = 0
  const f = await mount({ list: async () => [row({ state: 'downloading', operation: 'install', operationId })], cancel: async () => { cancels++; return false } })
  t.after(() => f.unmount())
  f.api.list = async () => { throw Error('unreadable') }; await f.state.refresh()
  await f.state.cancel(); assert.equal(cancels, 1); assert.equal(f.state.checking.value, '')
  await f.state.cancel(); assert.equal(cancels, 1)
  assert.match(f.state.error.value, /暂时无法读取/)
})

test('a stale stop cannot forget or automatically stop a successor observed while it was pending', async t => {
  const stopped = deferred<boolean>(), calls: string[][] = []
  const f = await mount({ list: async () => [row({ state: 'downloading', operation: 'install', operationId })],
    cancel: async (id, operation) => { calls.push([id, operation]); return stopped.promise } })
  t.after(() => f.unmount())
  const pending = f.state.cancel()
  f.api.list = async () => [row({ state: 'checking', operation: 'inspect', operationId: anotherOperation })]; await f.state.refresh()
  f.api.list = async () => { throw Error('unreadable') }; await f.state.refresh()
  stopped.resolve(false); await pending
  assert.equal(f.state.checking.value, 'fixture'); assert.deepEqual(calls, [['fixture', operationId]])
  await f.state.cancel(); assert.deepEqual(calls, [['fixture', operationId], ['fixture', anotherOperation]])
})

test('old successful reads cannot restore a stopped handle after newer terminal state and read failure', async t => {
  const oldRows = deferred<LocalModelView[]>(); let cancels = 0
  const f = await mount({ list: async () => [row({ operation: 'install', operationId })], cancel: async () => { cancels++; return true } })
  t.after(() => f.unmount()); f.api.list = () => oldRows.promise; const old = f.state.refresh()
  f.api.list = async () => [row({ state: 'ready' })]; await f.state.refresh()
  f.api.list = async () => { throw Error('unreadable') }; await f.state.refresh()
  oldRows.resolve([row({ operation: 'install', operationId })]); await old
  assert.deepEqual(f.state.models.value, []); assert.equal(f.state.checking.value, '')
  await f.state.cancel(); assert.equal(cancels, 0)
})

test('without an observed operation ID a read failure never invents a stop target', async () => {
  let cancels = 0
  const f = await mount({ cancel: async () => { cancels++; return true } })
  f.api.list = async () => { throw Error('unreadable') }; await f.state.install('fixture')
  await f.state.cancel(); f.unmount(); assert.equal(cancels, 0)
})

test('a pending preparation for one model cannot stop an observed different model', async t => {
  const starting = deferred<LocalModelView>(); let cancels = 0
  const f = await mount({ install: () => starting.promise, cancel: async () => { cancels++; return true } })
  t.after(() => f.unmount()); const pending = f.state.install('fixture')
  f.api.list = async () => [row({ id: 'other', operation: 'install', operationId })]; await f.state.refresh()
  f.api.list = async () => { throw Error('unreadable') }; await f.state.refresh()
  assert.equal(f.state.checking.value, 'fixture'); await f.state.cancel(); assert.equal(cancels, 0)
  starting.reject(Error('start failed')); await pending
  assert.equal(f.state.checking.value, 'other')
})

test('installation acknowledgement supplies an exact stop when no active row could be read', async t => {
  const acknowledged = deferred<LocalModelView>(), calls: string[][] = []; let installs = 0
  const f = await mount({ install: () => { installs++; return acknowledged.promise },
    cancel: async (id, operation) => { calls.push([id, operation]); return true } }); t.after(() => f.unmount())
  const pending = f.state.install('fixture')
  await f.state.refresh(); await f.state.refresh() // Reads during preflight still have no operation ID.
  f.api.list = async () => { throw Error('first active read failed') }
  acknowledged.resolve(row({ state: 'verifying', operation: 'install', operationId })); await pending
  assert.deepEqual(f.state.models.value, []); assert.equal(f.state.checking.value, 'fixture')
  assert.match(f.state.error.value, /暂时无法读取/); assert.equal(f.state.actionError.value, '')
  await f.state.install('fixture'); assert.equal(installs, 1)
  await f.state.cancel(); assert.deepEqual(calls, [['fixture', operationId]])
})

for (const state of ['ready', 'cancelled'] as const) {
  test(`late install acknowledgement cannot restore an observed operation after ${state}`, async t => {
    const acknowledged = deferred<LocalModelView>(); let cancels = 0
    const f = await mount({ install: () => acknowledged.promise, cancel: async () => { cancels++; return true } }); t.after(() => f.unmount())
    const pending = f.state.install('fixture')
    f.api.list = async () => [row({ state: 'downloading', operation: 'install', operationId })]; await f.state.refresh()
    f.api.list = async () => [row({ state, operation: 'install' })]; await f.state.refresh()
    f.api.list = async () => { throw Error('unreadable') }
    acknowledged.resolve(row({ state: 'verifying', operation: 'install', operationId })); await pending
    assert.equal(f.state.checking.value, ''); await f.state.cancel(); assert.equal(cancels, 0)
  })
}

test('late install acknowledgement cannot replace a successor stop identity', async t => {
  const acknowledged = deferred<LocalModelView>(), calls: string[][] = []
  const f = await mount({ install: () => acknowledged.promise, cancel: async (id, operation) => { calls.push([id, operation]); return true } }); t.after(() => f.unmount())
  const pending = f.state.install('fixture')
  f.api.list = async () => [row({ id: 'successor', state: 'checking', operation: 'inspect', operationId: anotherOperation })]; await f.state.refresh()
  f.api.list = async () => { throw Error('unreadable') }
  acknowledged.resolve(row({ state: 'verifying', operation: 'install', operationId })); await pending
  assert.equal(f.state.checking.value, 'successor')
  await f.state.cancel(); assert.deepEqual(calls, [['successor', anotherOperation]])
})

test('late install acknowledgement cannot revive a handle rejected by exact cancellation', async t => {
  const acknowledged = deferred<LocalModelView>(); let cancels = 0
  const f = await mount({ install: () => acknowledged.promise, cancel: async () => { cancels++; return false } }); t.after(() => f.unmount())
  const pending = f.state.install('fixture')
  f.api.list = async () => [row({ state: 'downloading', operation: 'install', operationId })]; await f.state.refresh()
  f.api.list = async () => { throw Error('unreadable') }; await f.state.cancel()
  acknowledged.resolve(row({ state: 'verifying', operation: 'install', operationId })); await pending
  assert.equal(f.state.checking.value, ''); await f.state.cancel(); assert.equal(cancels, 1)
})

test('a fresh terminal listing clears an acknowledgement before subsequent read failure', async t => {
  let cancels = 0
  const f = await mount({ install: async () => row({ state: 'verifying', operation: 'install', operationId }),
    cancel: async () => { cancels++; return true } }); t.after(() => f.unmount())
  f.api.list = async () => [row({ state: 'ready' })]; await f.state.install('fixture')
  assert.equal(f.state.models.value[0].state, 'ready'); assert.equal(f.state.checking.value, '')
  f.api.list = async () => { throw Error('unreadable') }; await f.state.refresh(); await f.state.cancel()
  assert.equal(cancels, 0); assert.equal(f.state.checking.value, '')
})

test('unmount ignores a late installation acknowledgement without cancelling background work', async () => {
  const acknowledged = deferred<LocalModelView>(); let reads = 0, cancels = 0
  const f = await mount({ list: async () => { reads++; return [row()] }, install: () => acknowledged.promise,
    cancel: async () => { cancels++; return true } })
  const pending = f.state.install('fixture'); f.unmount()
  acknowledged.resolve(row({ state: 'verifying', operation: 'install', operationId })); await pending
  assert.equal(reads, 1); assert.equal(cancels, 0); assert.equal(f.state.activeOperation.value, undefined)
})

for (const patch of [{ id: 'other' }, { operation: 'inspect' as const }]) {
  test(`installation acknowledgement with mismatched ${Object.keys(patch)[0]} cannot supply a stop target`, async t => {
    let cancels = 0
    const f = await mount({ install: async () => row({ state: 'verifying', operation: 'install', operationId, ...patch }),
      cancel: async () => { cancels++; return true } }); t.after(() => f.unmount())
    f.api.list = async () => { throw Error('unreadable') }; await f.state.install('fixture'); await f.state.cancel()
    assert.equal(cancels, 0); assert.equal(f.state.checking.value, '')
  })
}

test('confirmed cancellation releases retry before an old install read returns, without clearing the next start', async t => {
  const oldList = deferred<LocalModelView[]>(), nextStart = deferred<LocalModelView>(); let installs = 0
  const f = await mount({ install: async () => ++installs === 1 ? row({ state: 'verifying', operation: 'install', operationId }) : nextStart.promise })
  t.after(() => { f.unmount(); oldList.resolve([]); nextStart.resolve(row()) })
  f.api.list = () => oldList.promise; const first = f.state.install('fixture'); await setImmediate()
  assert.equal(f.state.checking.value, 'fixture')
  f.api.list = async () => [row({ state: 'cancelled', operation: 'install' })]
  await f.state.cancel(); assert.equal(f.state.checking.value, '', 'fresh terminal status must release retry even while an earlier read hangs')
  const next = f.state.install('other'); await setImmediate(); assert.equal(installs, 2)
  oldList.resolve([row({ state: 'downloading', operation: 'install', operationId })]); await first
  assert.equal(f.state.models.value[0].state, 'cancelled')
  assert.equal(f.state.checking.value, 'other', 'the old install must not clear a later pending command')
  nextStart.reject(Error('next start failed')); await next
  assert.equal(f.state.checking.value, '')
})
