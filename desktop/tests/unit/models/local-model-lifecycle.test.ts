import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { LocalModelService } from '../../../src/main/modules/models/application/local-model-service'
import { localModelCatalog } from '../../../src/main/modules/models/adapters/local-models/catalog'
import type { LocalModelView } from '../../../src/contracts/models/local-model-contracts'

const manifest = localModelCatalog[0]
const assets = { root: 'fixture', modelPath: 'model', python: 'python', sitePackages: 'packages', fingerprint: 'fixture' }
function fixture(stage: 'load' | 'info' | 'save') {
  let enter!: () => void, release!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve }), released = new Promise<void>(resolve => { release = resolve })
  const counts = { installs: 0, prepares: 0, probes: 0, saves: 0, infos: 0 }
  let rows: LocalModelView[] = [], gated = false, failInfo = false
  const wait = async (step: typeof stage) => {
    if (stage !== step || gated) return
    gated = true; enter(); await released
  }
  const service = new LocalModelService([manifest], {
    discover: async () => false,
    prepare: async () => { counts.prepares++; return assets },
    installationInfo: async () => { counts.infos++; await wait('info'); if (failInfo) throw Error('fixture info unavailable'); return { canDownload: true, downloadBytes: 1, requiredDiskBytes: 2 } },
    install: async () => { counts.installs++; return assets }
  }, {
    run: async (_assets, input) => {
      counts.probes++
      return { content: input.schema ? input.schema.oneOf ? '{"kind":"tool","name":"model_probe","arguments":{"status":"ok"}}' : '{"status":"ok"}' : '检测成功', finishReason: 'stop', promptTokens: 1, completionTokens: 1, seconds: 0 }
    },
    stop() {}
  }, {
    read: async () => { await wait('load'); return rows },
    save: async value => { counts.saves++; await wait('save'); rows = structuredClone(value) }
  })
  return { service, counts, entered, release, rows: () => rows, setInfoFailure: (value: boolean) => { failInfo = value } }
}

for (const stage of ['load', 'info'] as const) {
  test(`same-window install calls share pending ${stage} and cannot start again after a faster duplicate completes`, async t => {
    const f = fixture(stage); t.after(() => { f.release(); f.service.clear() })
    const first = f.service.install(manifest.id, 7); await f.entered
    const duplicate = f.service.install(manifest.id, 7)
    await setImmediate(); const prematureInstalls = f.counts.installs
    f.release(); const [a, b] = await Promise.all([first, duplicate]); await setImmediate()
    assert.equal(prematureInstalls, 0, 'a duplicate must not bypass the first preflight')
    assert.equal(a.operationId, b.operationId); assert.ok(a.operationId)
    assert.equal(f.counts.infos, 1); assert.equal(f.counts.installs, 1); assert.equal(f.counts.probes, 3)
    assert.equal(f.rows()[0].state, 'ready')
  })
}

test('active installation replay returns its exact ID without rechecking changed installation conditions', async t => {
  const f = fixture('save'); t.after(() => { f.release(); f.service.clear() })
  const first = await f.service.install(manifest.id, 7); await f.entered
  f.setInfoFailure(true)
  const repeated = await f.service.install(manifest.id, 7)
  assert.equal(repeated.operationId, first.operationId); assert.equal(f.counts.infos, 1)
  assert.equal(f.counts.installs, 0, 'replay cannot bypass a pending status save')
  await assert.rejects(f.service.install(manifest.id, 8), { code: 'CONFLICT' })
  assert.equal(f.counts.infos, 1, 'foreign-owner rejection must not rerun preflight')
  assert.equal(f.service.cancel(manifest.id, 8, '00000000-0000-0000-0000-000000000001'), false)
  assert.equal(f.service.cancel(manifest.id, 7, repeated.operationId), true)
  f.release(); await setImmediate()
  assert.equal(f.rows()[0].state, 'cancelled'); assert.equal(f.counts.installs, 0)
})

test('an installation conflicting with an active inspection is rejected before resource queries', async t => {
  const f = fixture('save'); t.after(() => { f.release(); f.service.clear() })
  const inspected = f.service.inspect(manifest.id, 7); await f.entered; f.setInfoFailure(true)
  await assert.rejects(f.service.install(manifest.id, 7), { code: 'CONFLICT' })
  assert.equal(f.counts.infos, 0)
  f.release(); assert.equal((await inspected).state, 'ready')
  assert.equal(f.counts.prepares, 1); assert.equal(f.counts.installs, 0)
})

test('joined preflight failures share one query and release admission for an explicit retry', async t => {
  const f = fixture('info'); t.after(() => { f.release(); f.service.clear() })
  const first = f.service.install(manifest.id, 7); await f.entered; f.setInfoFailure(true)
  const duplicate = f.service.install(manifest.id, 7)
  const outcomes = Promise.allSettled([first, duplicate]); f.release()
  for (const result of await outcomes) {
    assert.equal(result.status, 'rejected')
    if (result.status === 'rejected') assert.match(result.reason.message, /fixture info unavailable/)
  }
  assert.equal(f.counts.infos, 1); assert.equal(f.counts.installs, 0); assert.equal(f.counts.saves, 0)
  f.setInfoFailure(false); assert.ok((await f.service.install(manifest.id, 7)).operationId); await setImmediate()
  assert.equal(f.counts.infos, 2); assert.equal(f.counts.installs, 1); assert.equal(f.rows()[0].state, 'ready')
})

test('closing a joined preflight cancels every caller and an old completion cannot discard the retry', async t => {
  const f = fixture('info'); t.after(() => { f.release(); f.service.clear() })
  const first = f.service.install(manifest.id, 7); await f.entered
  const duplicate = f.service.install(manifest.id, 7)
  const outcomes = Promise.allSettled([first, duplicate]); f.service.clearOwner(7)
  const retry = await f.service.install(manifest.id, 7)
  assert.ok(retry.operationId)
  f.release()
  for (const result of await outcomes) {
    assert.equal(result.status, 'rejected')
    if (result.status === 'rejected') assert.equal(result.reason.name, 'AbortError')
  }
  await setImmediate()
  assert.equal(f.counts.infos, 2); assert.equal(f.counts.installs, 1); assert.equal(f.rows()[0].state, 'ready')
})

for (const stage of ['load', 'info'] as const) {
  for (const scope of ['owner', 'all', 'other-owner'] as const) {
    test(`${scope} cleanup while installation awaits ${stage} cannot start cancelled work`, async () => {
      const f = fixture(stage), pending = f.service.install(manifest.id, 7)
      await f.entered
      if (scope === 'all') f.service.clear()
      else f.service.clearOwner(scope === 'owner' ? 7 : 8)
      if (scope === 'other-owner') {
        f.release(); assert.ok((await pending).operationId)
        await setImmediate()
        assert.equal(f.counts.installs, 1); assert.equal(f.counts.probes, 3)
        assert.equal(f.rows()[0].state, 'ready')
      } else {
        const cancelled = assert.rejects(pending, { name: 'AbortError' })
        f.release(); await cancelled; await setImmediate()
        assert.equal(f.counts.installs, 0); assert.equal(f.counts.probes, 0); assert.equal(f.counts.saves, 0)
        if (stage === 'load') assert.equal(f.counts.infos, 0)
        assert.equal(f.service.cancel(manifest.id, 7), false)
        // A fresh window may explicitly retry; cleanup must not poison future requests.
        assert.ok((await f.service.install(manifest.id, 9)).operationId)
        await setImmediate()
        assert.equal(f.counts.installs, 1); assert.equal(f.rows()[0].state, 'ready')
      }
    })
  }
  test(`closing one of two windows waiting for ${stage} preserves the other installation`, async () => {
    const f = fixture(stage), abandoned = f.service.install(manifest.id, 7)
    await f.entered
    const retained = f.service.install(manifest.id, 8)
    const cancelled = assert.rejects(abandoned, { name: 'AbortError' })
    f.service.clearOwner(7); f.release()
    await cancelled; assert.ok((await retained).operationId); await setImmediate()
    assert.equal(f.counts.installs, 1); assert.equal(f.counts.probes, 3)
    assert.equal(f.rows()[0].state, 'ready')
  })
}

for (const kind of ['inspect', 'install'] as const) {
  test(`stopping ${kind} during preparation-state persistence cannot call the asset driver`, async () => {
    const f = fixture('save'), pending = f.service[kind](manifest.id, 7)
    await f.entered
    const [view] = await f.service.list()
    assert.ok(view.operationId)
    assert.equal(f.service.cancel(manifest.id, 7, view.operationId), true)
    f.release(); await pending; await setImmediate()
    assert.equal(f.counts.installs, 0); assert.equal(f.counts.prepares, 0); assert.equal(f.counts.probes, 0)
    assert.equal(f.rows()[0].state, 'cancelled'); assert.equal((await f.service.list())[0].state, 'cancelled')
  })
}

for (const kind of ['inspect', 'install'] as const) for (const outcome of ['failed', 'cancelled'] as const) for (const failSave of [false, true]) {
  test(`${kind} retains its operation until ${outcome} persistence ${failSave ? 'fails and releases admission' : 'completes'}`, async t => {
    const second = localModelCatalog[1]
    let enterDriver!: () => void, releaseDriver!: () => void, enterSave!: () => void, releaseSave!: () => void
    const driverEntered = new Promise<void>(resolve => { enterDriver = resolve })
    const driverHeld = new Promise<void>(resolve => { releaseDriver = resolve })
    const saveEntered = new Promise<void>(resolve => { enterSave = resolve })
    const saveHeld = new Promise<void>(resolve => { releaseSave = resolve })
    let stored: LocalModelView[] = [], heldTerminal = false, driverCalls = 0, probes = 0
    const prepare = async (model: { id: string }, signal: AbortSignal) => {
      driverCalls++
      if (model.id === manifest.id) {
        enterDriver(); await driverHeld; signal.throwIfAborted(); throw Error('fixture preparation failure')
      }
      return assets
    }
    const service = new LocalModelService([manifest, second], {
      discover: async () => true,
      installationInfo: async () => ({ canDownload: true, downloadBytes: 1, requiredDiskBytes: 2 }),
      prepare, install: prepare
    }, {
      run: async (_assets, input) => {
        probes++
        return { content: input.schema ? input.schema.oneOf ? '{"kind":"tool","name":"model_probe","arguments":{"status":"ok"}}' : '{"status":"ok"}' : '检测成功', finishReason: 'stop', promptTokens: 1, completionTokens: 1, seconds: 0 }
      }, stop() {}
    }, {
      read: async () => stored,
      save: async rows => {
        if (!heldTerminal && rows.some(row => row.id === manifest.id && row.state === outcome)) {
          heldTerminal = true; enterSave(); await saveHeld
          if (failSave) throw Error('fixture terminal save failed')
        }
        stored = structuredClone(rows)
      }
    })
    t.after(() => { releaseDriver(); releaseSave(); service.clear() })
    const result = service[kind](manifest.id, 7).then(value => ({ value }), error => ({ error }))
    await driverEntered
    const active = (await service.list()).find(row => row.id === manifest.id)!
    assert.ok(active.operationId)
    if (outcome === 'cancelled') assert.equal(service.cancel(manifest.id, 7, active.operationId), true)
    releaseDriver(); await saveEntered
    const saving = (await service.list()).find(row => row.id === manifest.id)!
    assert.equal(saving.operationId, active.operationId, 'a pending terminal write must retain the preparation handle')
    assert.equal(saving.state, 'verifying'); assert.deepEqual(saving.capabilities, [])
    assert.throws(() => service.inspect(second.id, 8), { code: 'CONFLICT' })
    await assert.rejects(service.install(second.id, 8), { code: 'CONFLICT' })
    assert.equal(driverCalls, 1); assert.equal(probes, 0)
    assert.equal(stored.find(row => row.id === manifest.id)?.state, 'verifying')
    releaseSave(); const settled = await result; await setImmediate()
    if (kind === 'inspect' && failSave) {
      assert.ok('error' in settled); assert.match(settled.error.message, /terminal save failed/)
    } else assert.ok('value' in settled)
    const terminal = (await service.list()).find(row => row.id === manifest.id)!
    assert.equal(terminal.state, outcome); assert.equal(terminal.operationId, undefined); assert.deepEqual(terminal.capabilities, [])
    assert.equal(stored.find(row => row.id === manifest.id)?.state, failSave ? 'verifying' : outcome)
    assert.equal(service.cancel(manifest.id, 7, active.operationId), false)
    assert.equal((await service.inspect(second.id, 8)).state, 'ready', 'success and storage failure both release admission')
    assert.equal((await service.list()).find(row => row.id === manifest.id)?.state, outcome)
    assert.equal(stored.find(row => row.id === second.id)?.state, 'ready'); assert.equal(driverCalls, 2); assert.equal(probes, 3)
  })
}

for (const kind of ['inspect', 'install'] as const) for (const stop of ['cancel', 'owner', 'all', 'other-owner', 'cancel-save-fails'] as const) {
  test(`${kind} stopped by ${stop} while ready is saving cannot publish cancelled readiness`, async t => {
    const second = localModelCatalog[1]
    let enterReady!: () => void, releaseReady!: () => void, enterCancelled!: () => void, releaseCancelled!: () => void
    const readyEntered = new Promise<void>(resolve => { enterReady = resolve })
    const readyHeld = new Promise<void>(resolve => { releaseReady = resolve })
    const cancelledEntered = new Promise<void>(resolve => { enterCancelled = resolve })
    const cancelledHeld = new Promise<void>(resolve => { releaseCancelled = resolve })
    let stored: LocalModelView[] = [], heldReady = false, heldCancelled = false, driverCalls = 0, probes = 0
    const prepare = async () => { driverCalls++; return assets }
    const service = new LocalModelService([manifest, second], {
      discover: async () => true,
      installationInfo: async () => ({ canDownload: true, downloadBytes: 1, requiredDiskBytes: 2 }),
      prepare, install: prepare
    }, {
      run: async (_assets, input) => {
        probes++
        return { content: input.schema ? input.schema.oneOf ? '{"kind":"tool","name":"model_probe","arguments":{"status":"ok"}}' : '{"status":"ok"}' : '检测成功', finishReason: 'stop', promptTokens: 1, completionTokens: 1, seconds: 0 }
      }, stop() {}
    }, {
      read: async () => stored,
      save: async rows => {
        const state = rows.find(row => row.id === manifest.id)?.state
        if (!heldReady && state === 'ready') { heldReady = true; enterReady(); await readyHeld }
        if (!heldCancelled && state === 'cancelled') {
          heldCancelled = true; enterCancelled(); await cancelledHeld
          if (stop === 'cancel-save-fails') throw Error('fixture cancellation save failed')
        }
        stored = structuredClone(rows)
      }
    })
    t.after(() => { releaseReady(); releaseCancelled(); service.clear() })
    const result = service[kind](manifest.id, 7).then(value => ({ value }), error => ({ error }))
    await readyEntered
    const active = (await service.list()).find(row => row.id === manifest.id)!
    assert.equal(active.state, 'checking'); assert.ok(active.operationId); assert.deepEqual(active.capabilities, [])
    assert.equal(driverCalls, 1); assert.equal(probes, 3)
    if (stop === 'all') service.clear()
    else if (stop === 'owner' || stop === 'other-owner') service.clearOwner(stop === 'owner' ? 7 : 8)
    else assert.equal(service.cancel(manifest.id, 7, active.operationId), true)
    releaseReady()
    if (stop === 'other-owner') {
      await result; await setImmediate()
      assert.equal((await service.list()).find(row => row.id === manifest.id)?.state, 'ready')
      assert.equal(stored.find(row => row.id === manifest.id)?.state, 'ready'); assert.equal(heldCancelled, false)
      return
    }
    await cancelledEntered
    const cancelling = (await service.list()).find(row => row.id === manifest.id)!
    assert.equal(cancelling.state, 'checking', 'cancelled readiness must not publish while its cancellation is saving')
    assert.equal(cancelling.operationId, active.operationId); assert.deepEqual(cancelling.capabilities, [])
    assert.equal(await service.ready(manifest.id), false)
    assert.throws(() => service.inspect(second.id, 8), { code: 'CONFLICT' })
    await assert.rejects(service.install(second.id, 8), { code: 'CONFLICT' })
    assert.equal(stored.find(row => row.id === manifest.id)?.state, 'ready', 'an already-running disk write cannot be rolled back by cancellation')
    releaseCancelled(); const settled = await result; await setImmediate()
    if (kind === 'inspect' && stop === 'cancel-save-fails') {
      assert.ok('error' in settled); assert.match(settled.error.message, /cancellation save failed/)
    } else assert.ok('value' in settled)
    const terminal = (await service.list()).find(row => row.id === manifest.id)!
    assert.equal(terminal.state, 'cancelled'); assert.equal(terminal.operationId, undefined); assert.deepEqual(terminal.capabilities, [])
    assert.equal(stored.find(row => row.id === manifest.id)?.state, stop === 'cancel-save-fails' ? 'ready' : 'cancelled')
    assert.equal(service.cancel(manifest.id, 7, active.operationId), false)
    assert.equal((await service.inspect(second.id, 8)).state, 'ready')
    assert.equal((await service.list()).find(row => row.id === manifest.id)?.state, 'cancelled')
    assert.equal(stored.find(row => row.id === manifest.id)?.state, 'cancelled')
    assert.equal(driverCalls, 2); assert.equal(probes, 6)
  })
}

for (const kind of ['inspect', 'install'] as const) {
  test(`cancelled ${kind} cannot write queued readiness behind another model's invalidation`, async t => {
    const second = localModelCatalog[1]
    let enterProbe!: () => void, releaseProbe!: () => void, enterSave!: () => void, releaseSave!: () => void
    const probeEntered = new Promise<void>(resolve => { enterProbe = resolve })
    const probeHeld = new Promise<void>(resolve => { releaseProbe = resolve })
    const saveEntered = new Promise<void>(resolve => { enterSave = resolve })
    const saveHeld = new Promise<void>(resolve => { releaseSave = resolve })
    let stored: LocalModelView[] = [], failSecond = false, heldInvalidation = false, readyWrites = 0
    const prepare = async (model: { id: string }) => {
      if (model.id === second.id && failSecond) throw Error('fixture resource damaged')
      return { ...assets, modelPath: model.id }
    }
    const service = new LocalModelService([manifest, second], {
      discover: async () => true,
      installationInfo: async () => ({ canDownload: true, downloadBytes: 1, requiredDiskBytes: 2 }),
      prepare, install: prepare
    }, {
      run: async (prepared, input) => {
        if (prepared.modelPath === manifest.id && input.schema?.oneOf) { enterProbe(); await probeHeld }
        return { content: input.schema ? input.schema.oneOf ? '{"kind":"tool","name":"model_probe","arguments":{"status":"ok"}}' : '{"status":"ok"}' : '检测成功', finishReason: 'stop', promptTokens: 1, completionTokens: 1, seconds: 0 }
      }, stop() {}
    }, {
      read: async () => stored,
      save: async rows => {
        if (rows.some(row => row.id === manifest.id && row.state === 'ready')) readyWrites++
        if (!heldInvalidation && rows.some(row => row.id === second.id && row.state === 'failed')) {
          heldInvalidation = true; enterSave(); await saveHeld
        }
        stored = structuredClone(rows)
      }
    })
    t.after(() => { releaseProbe(); releaseSave(); service.clear() })
    assert.equal((await service.inspect(second.id, 8)).state, 'ready')
    const result = service[kind](manifest.id, 7)
    await probeEntered; failSecond = true
    const failedGeneration = assert.rejects(service.complete({ model: second.id, profile: { connectionId: 'local:llama-cpp', model: second.id, maxTokens: 128, temperature: .1, topP: .9 }, messages: [{ role: 'user', content: 'fixture' }] }), { code: 'FEATURE_UNAVAILABLE' })
    await saveEntered; releaseProbe(); await setImmediate()
    const active = (await service.list()).find(row => row.id === manifest.id)!
    assert.equal(active.state, 'checking'); assert.ok(active.operationId)
    assert.equal(service.cancel(manifest.id, 7, active.operationId), true)
    releaseSave(); await failedGeneration; await result; await setImmediate()
    assert.equal(readyWrites, 0, 'a cancelled queued replacement must never reach the file adapter')
    assert.equal(stored.find(row => row.id === manifest.id)?.state, 'cancelled')
    assert.equal(stored.find(row => row.id === second.id)?.state, 'failed')
    assert.equal(await service.ready(manifest.id), false)
    failSecond = false; assert.equal((await service.inspect(second.id, 8)).state, 'ready')
    assert.equal(stored.find(row => row.id === manifest.id)?.state, 'cancelled')
  })
}
