import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { LocalModelService } from '../../../src/main/modules/models/application/local-model-service'
import { localModelCatalog } from '../../../src/main/modules/models/adapters/local-models/catalog'
import { decodeLocalModel, type LocalModelView } from '../../../src/contracts/models/local-model-contracts'
import type { ModelAssetSource, ModelManifest } from '../../../src/main/modules/models/domain/local-models'

const [first, second] = localModelCatalog
const assets = { root: 'fixture', modelPath: 'fixture', python: 'unused', sitePackages: 'unused', fingerprint: 'fixture' }
const info = { canDownload: true, downloadBytes: 10, requiredDiskBytes: 20 }
function barrier() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
function readyRow(m: ModelManifest): LocalModelView {
  return { id: m.id, name: m.name, family: m.family, description: m.description, revision: m.revision,
    bytes: m.files[0].bytes, quantization: m.quantization, license: m.license, state: 'ready',
    capabilities: [...m.capabilities], contextTokens: m.contextTokens, maxOutputTokens: m.maxOutputTokens,
    recommendedOutputTokens: m.recommendedOutputTokens, progress: 100, message: 'fixture ready', canDownload: true }
}
function fixture(seedReady = true) {
  let stored = seedReady ? [readyRow(first), readyRow(second)] : []
  const counts = { saves: 0, probes: 0, prepares: 0, discoveries: 0 }
  const source: ModelAssetSource = {
    discover: async () => { counts.discoveries++; return true },
    installationInfo: async () => info,
    prepare: async () => { counts.prepares++; return assets }
  }
  const service = new LocalModelService([first, second], source, {
    run: async (_assets, input) => {
      counts.probes++
      return { content: input.schema ? input.schema.oneOf ? '{"kind":"tool","name":"model_probe","arguments":{"status":"ok"}}' : '{"status":"ok"}' : '检测成功', finishReason: 'stop', promptTokens: 1, completionTokens: 4, seconds: 0 }
    }, stop() {}
  }, { read: async () => structuredClone(stored), save: async rows => { counts.saves++; stored = structuredClone(rows) } })
  return { source, service, counts, stored: () => stored }
}

test('a slow resource read cannot restore ready while that model is being inspected', async t => {
  const f = fixture(), reading = barrier(), read = barrier(), preparing = barrier(), prepare = barrier()
  f.source.installationInfo = async m => { if (m.id === first.id) { reading.release(); await read.promise }; return info }
  f.source.prepare = async (_m, signal) => { preparing.release(); await prepare.promise; signal.throwIfAborted(); return assets }
  const listing = f.service.list(); await reading.promise
  const readiness = f.service.ready(first.id), inspection = f.service.inspect(first.id, 7)
  t.after(async () => { f.service.clear(); read.release(); prepare.release(); await inspection })
  await preparing.promise; read.release()
  const row = (await listing)[0]
  assert.equal(row.state, 'verifying'); assert.deepEqual(row.capabilities, [])
  assert.equal(row.operation, 'inspect'); assert.ok(row.operationId)
  assert.equal(await readiness, false)
  assert.equal(decodeLocalModel(row).operationId, row.operationId)
})

test('waiting for another catalog entry cannot freeze an already-observed ready row', async t => {
  const f = fixture(), reading = barrier(), read = barrier(), preparing = barrier(), prepare = barrier()
  f.source.installationInfo = async m => { if (m.id === second.id) { reading.release(); await read.promise }; return info }
  f.source.prepare = async (_m, signal) => { preparing.release(); await prepare.promise; signal.throwIfAborted(); return assets }
  const listing = f.service.list(); await reading.promise; await setImmediate()
  const inspection = f.service.inspect(first.id, 7)
  t.after(async () => { f.service.clear(); read.release(); prepare.release(); await inspection })
  await preparing.promise; read.release()
  const rows = await listing
  assert.equal(rows[0].state, 'verifying'); assert.ok(rows[0].operationId)
  assert.deepEqual(rows[0].capabilities, [])
  assert.equal(rows[1].state, 'ready'); assert.equal(rows[1].downloadBytes, info.downloadBytes)
})

test('old missing-resource observations cannot hide a newly completed inspection', async () => {
  const f = fixture(false), reading = barrier(), read = barrier()
  f.source.discover = async m => { if (m.id === first.id) { reading.release(); await read.promise; return false }; return true }
  const listing = f.service.list(); await reading.promise
  const inspected = await f.service.inspect(first.id)
  assert.equal(inspected.state, 'ready'); assert.equal(f.counts.probes, 3)
  const saved = structuredClone(f.stored()), writes = f.counts.saves
  read.release()
  const rows = await listing
  assert.equal(rows[0].state, 'ready'); assert.equal(rows[0].progress, 100)
  assert.deepEqual(rows[0].capabilities, first.capabilities); assert.equal(rows[0].operationId, undefined)
  assert.equal(rows[1].state, 'detected')
  assert.equal(f.counts.saves, writes); assert.deepEqual(f.stored(), saved)
})

for (const terminal of ['failed', 'cancelled'] as const) {
  test(`a delayed full catalog returns ${terminal} after a newer inspection ends`, async () => {
    const f = fixture(), reading = barrier(), read = barrier(), preparing = barrier(), prepare = barrier()
    f.source.installationInfo = async m => { if (m.id === second.id) { reading.release(); await read.promise }; return info }
    f.source.prepare = async (_m, signal) => {
      preparing.release(); await prepare.promise; signal.throwIfAborted(); throw Error('private fixture failure')
    }
    const listing = f.service.list(); await reading.promise; await setImmediate()
    const inspection = f.service.inspect(first.id, 7); await preparing.promise
    if (terminal === 'cancelled') f.service.clearOwner(7)
    prepare.release(); assert.equal((await inspection).state, terminal)
    const writes = f.counts.saves
    read.release(); const rows = await listing
    assert.equal(rows[0].state, terminal); assert.deepEqual(rows[0].capabilities, [])
    assert.equal(rows[0].operationId, undefined); assert.equal(rows[0].progress, 0)
    assert.ok(!rows[0].message.includes('private fixture'))
    assert.equal(rows[1].state, 'ready'); assert.equal(f.counts.saves, writes)
  })
}

test('a delayed listing returns the successor operation ID after cancellation and retry', async t => {
  const f = fixture(), firstEntered = barrier(), firstHeld = barrier(), nextEntered = barrier(), nextHeld = barrier(), reading = barrier(), read = barrier()
  let preparations = 0
  f.source.prepare = async (_m, signal) => {
    const initial = ++preparations === 1
    const entered = initial ? firstEntered : nextEntered, held = initial ? firstHeld : nextHeld
    entered.release(); await held.promise; signal.throwIfAborted(); return assets
  }
  const oldInspection = f.service.inspect(first.id, 7); await firstEntered.promise
  const oldId = f.stored()[0].operationId!
  f.source.installationInfo = async m => { if (m.id === second.id) { reading.release(); await read.promise }; return info }
  const listing = f.service.list(); await reading.promise
  assert.equal(f.service.cancel(first.id, 7, oldId), true); firstHeld.release(); await oldInspection
  const nextInspection = f.service.inspect(first.id, 7)
  t.after(async () => { f.service.clear(); read.release(); nextHeld.release(); await nextInspection })
  await nextEntered.promise
  const nextId = f.stored()[0].operationId!
  read.release(); const rows = await listing
  assert.notEqual(nextId, oldId); assert.equal(rows[0].operationId, nextId)
  assert.equal(rows[0].state, 'verifying'); assert.deepEqual(rows[0].capabilities, [])
  assert.equal(f.service.cancel(first.id, 7, oldId), false)
  assert.equal(f.service.cancel(first.id, 7, rows[0].operationId), true)
})

test('a stable list retains absence, presence, estimates and terminal failures without writes or probes', async () => {
  const f = fixture()
  f.source.discover = async m => m.id === second.id
  const before = structuredClone(f.stored()), rows = await f.service.list()
  assert.equal(rows[0].state, 'not-installed'); assert.deepEqual(rows[0].capabilities, [])
  assert.equal(rows[0].downloadBytes, info.downloadBytes); assert.equal(rows[0].canDownload, true)
  assert.equal(rows[1].state, 'ready'); assert.equal(rows[1].requiredDiskBytes, info.requiredDiskBytes)
  assert.deepEqual(f.stored(), before); assert.equal(f.counts.saves, 0); assert.equal(f.counts.probes, 0); assert.equal(f.counts.prepares, 0)
  f.source.prepare = async () => { throw Error('fixture failure') }
  assert.equal((await f.service.inspect(first.id)).state, 'failed')
  const writes = f.counts.saves, failed = (await f.service.list())[0]
  assert.equal(failed.state, 'failed'); assert.equal(failed.canDownload, true); assert.deepEqual(failed.capabilities, [])
  assert.equal(f.counts.saves, writes)
})

test('a catalog read error remains an error even when another model changes while reading', async () => {
  const f = fixture(), reading = barrier(), read = barrier()
  const failure = Error('unreadable fixture receipt')
  f.source.installationInfo = async m => { if (m.id === second.id) { reading.release(); await read.promise; throw failure }; return info }
  const rejected = assert.rejects(f.service.list(), error => error === failure)
  await reading.promise; await f.service.inspect(first.id)
  const stored = structuredClone(f.stored()), writes = f.counts.saves
  read.release(); await rejected
  assert.deepEqual(f.stored(), stored); assert.equal(f.counts.saves, writes)
})

for (const seedReady of [false, true]) {
  test(`missing resources explain unavailable installation without claiming a download (previously ready: ${seedReady})`, async () => {
    const f = fixture(seedReady), before = structuredClone(f.stored())
    f.source.discover = async () => false
    f.source.installationInfo = async () => ({ ...info, canDownload: false })
    const rows = await f.service.list()
    for (const row of rows) {
      assert.equal(row.state, 'not-installed'); assert.equal(row.canDownload, false)
      assert.deepEqual(row.capabilities, []); assert.match(row.message, /暂不支持自动安装/)
      assert.doesNotMatch(row.message, /可下载安装/); assert.equal(decodeLocalModel(row).message, row.message)
    }
    f.source.installationInfo = async () => info
    assert.match((await f.service.list())[0].message, /可下载安装/)
    assert.deepEqual(f.stored(), before); assert.equal(f.counts.saves, 0); assert.equal(f.counts.prepares, 0); assert.equal(f.counts.probes, 0)
  })
}
test('a source without installation metadata cannot advertise automatic installation', async () => {
  const f = fixture(false); f.source.installationInfo = undefined; f.source.discover = async () => false
  const row = (await f.service.list())[0]
  assert.equal(row.canDownload, false); assert.match(row.message, /暂不支持自动安装/)
  assert.equal(f.counts.saves, 0); assert.equal(f.counts.prepares, 0)
})
test('installation support does not gate discovery or readiness of existing resources', async () => {
  for (const seedReady of [false, true]) {
    const f = fixture(seedReady); f.source.installationInfo = async () => ({ ...info, canDownload: false })
    const before = structuredClone(f.stored()), row = (await f.service.list())[0]
    assert.equal(row.state, seedReady ? 'ready' : 'detected'); assert.equal(row.canDownload, false)
    assert.equal(await f.service.ready(first.id), seedReady)
    assert.doesNotMatch(row.message, /暂不支持自动安装/)
    assert.deepEqual(f.stored(), before); assert.equal(f.counts.saves, 0); assert.equal(f.counts.probes, 0)
  }
})
