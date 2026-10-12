import assert from 'node:assert/strict'
import test from 'node:test'
import { useModelTests } from '../../../src/renderer/features/models/composables/use-model-tests'
import { saveTestedModelDefault } from '../../../src/renderer/features/models/services/model-quick-setup'
import { modelConnectionArgs, type ModelConnectionsApi, type ModelProbe } from '../../../src/contracts/models/model-connections-contracts'

const connection = { id: 'global-fixture', revision: 3 }
const receipt = (model = '', thinkingLevel?: ModelProbe['thinkingLevel']) => ({ ...connection, model, testedAt: '2026-09-20T00:00:00.000Z', success: true, message: '完成', models: ['one', 'two', 'three'],
  parameterFingerprint: 'a'.repeat(64), ...(thinkingLevel ? { thinkingLevel } : { parameterPolicy: { version: 1 as const, mode: 'auto' as const } }) })
function fixture() {
  const calls: ModelProbe[] = [], catalogs: unknown[] = []
  const api = {
    catalog: async (input: unknown) => { catalogs.push(input); return receipt() },
    test: async (input: ModelProbe) => { calls.push(input); return receipt(input.model) },
    cancelTest: async () => true
  }
  return { api, calls, catalogs, session: useModelTests(api as ModelConnectionsApi) }
}
test('catalog query needs only connection identity; generation still requires an exact model', () => {
  assert.deepEqual(modelConnectionArgs.catalog([connection]), [connection])
  assert.throws(() => modelConnectionArgs.test([connection]))
  assert.throws(() => modelConnectionArgs.catalog([{ ...connection, apiKey: 'not-allowed' }]))
})
test('discovery sends no guessed model; single and multiple selections only test their listed identities', async () => {
  const f = fixture()
  await f.session.load(connection)
  assert.deepEqual(f.catalogs, [connection])
  assert.equal(f.calls.length, 0)
  await f.session.testModels(['two', 'not-in-catalog'])
  assert.deepEqual(f.calls.map(call => call.model), ['two'])
  assert.equal(f.session.rows.value[1].status, 'passed')
  await f.session.testModels(['one', 'three'])
  assert.deepEqual(f.calls.map(call => call.model), ['two', 'one', 'three'])
})
test('all tests run serially and a provider failure preserves other results', async () => {
  const f = fixture(); let active = 0, maximum = 0
  f.api.test = async input => {
    active++; maximum = Math.max(maximum, active); f.calls.push(input)
    await new Promise(resolve => setImmediate(resolve)); active--
    if (input.model === 'two') throw { code: 'AI_CONNECTION_ERROR', message: '此模型不可用' }
    return receipt(input.model)
  }
  await f.session.load(connection)
  await f.session.testModels(f.session.rows.value.map(row => row.model))
  assert.equal(maximum, 1)
  assert.deepEqual(f.session.rows.value.map(row => row.status), ['passed', 'failed', 'passed'])
  assert.equal(f.session.rows.value[1].message, '此模型不可用')
})
test('cancelling a batch ignores late success and never sends queued tests', async () => {
  const f = fixture(); let release!: () => void, cancelled = 0
  const gate = new Promise<void>(resolve => { release = resolve })
  f.api.test = async input => { f.calls.push(input); await gate; return receipt(input.model) }
  f.api.cancelTest = async () => { cancelled++; return true }
  await f.session.load(connection)
  const run = f.session.testModels(['one', 'two', 'three'])
  await f.session.cancel(); release(); await run
  assert.equal(cancelled, 1)
  assert.deepEqual(f.calls.map(call => call.model), ['one'])
  assert.deepEqual(f.session.rows.value.map(row => row.status), ['cancelled', 'cancelled', 'cancelled'])
  assert.equal(f.session.busy.value, false)
})
test('changed connection stops the remainder and failed reload clears the old catalog', async () => {
  const f = fixture()
  f.api.test = async input => { f.calls.push(input); throw { code: 'CONFLICT', message: '接口已变化' } }
  await f.session.load(connection)
  await f.session.testModels(['one', 'two', 'three'])
  assert.equal(f.calls.length, 1)
  assert.deepEqual(f.session.rows.value.map(row => row.status), ['failed', 'cancelled', 'cancelled'])
  f.api.catalog = async () => { throw Error('目录读取失败') }
  await f.session.load({ ...connection, revision: 4 })
  assert.deepEqual(f.session.rows.value, [])
  assert.match(f.session.error.value, /目录读取失败/)
})
test('empty catalogs and disposal cannot publish fabricated or stale choices', async () => {
  const f = fixture()
  f.api.catalog = async () => ({ ...receipt(), models: [] })
  await f.session.load(connection)
  assert.equal(f.session.rows.value.length, 0)
  assert.match(f.session.error.value, /没有返回模型/)
  let release!: () => void
  f.api.catalog = async () => { await new Promise<void>(resolve => { release = resolve }); return receipt() }
  const loading = f.session.load(connection)
  f.session.dispose(); release(); await loading
  assert.equal(f.session.rows.value.length, 0)
})
test('a tested model saves only on explicit selection, without a duplicate probe; stale or failed receipts cannot save', async () => {
  const saves: unknown[] = []; let revision = 3
  const api = {
    list: async () => ({ revision: 8, connections: [{ ...connection, revision, enabled: true }] }), defaults: async () => ({ revision: 2 }),
    saveDefaults: async (input: unknown) => { saves.push(input); return input },
    test: async () => assert.fail('already tested; do not spend another request')
  } as unknown as ModelConnectionsApi
  await saveTestedModelDefault(api, receipt('two'))
  const saved = saves[0] as { template: { shared: { model: string }; tasks: Record<string, unknown> } }
  assert.equal(saved.template.shared.model, 'two')
  for (const profile of Object.values(saved.template.tasks)) assert.deepEqual(profile, saved.template.shared)
  revision = 4
  await assert.rejects(saveTestedModelDefault(api, receipt('one')), /已变化/)
  await assert.rejects(saveTestedModelDefault(api, { ...receipt('one'), success: false }), /测试通过/)
  assert.equal(saves.length, 1)
})

test('gateway custom variants remain distinct choices and tests send the full exact model ID', async () => {
  const f = fixture(), models = ['gemini-3.8-flash', 'gemini-3.8-flash-high', 'gemini-3.8-flash-low']
  f.api.catalog = async () => ({ ...receipt(), models })
  await f.session.load(connection)
  assert.deepEqual(f.session.rows.value.map(row => row.model), models)
  await f.session.testModels(['gemini-3.8-flash-high'])
  assert.deepEqual(f.calls.map(call => call.model), ['gemini-3.8-flash-high'])
})

test('thinking change invalidates receipts; a batch captures its level and verifies the echoed setting', async () => {
  const f = fixture()
  await f.session.load(connection)
  await f.session.testModels(['one'])
  assert.ok(f.session.rows.value[0].result)
  f.session.setThinkingLevel('high')
  assert.equal(f.session.rows.value[0].result, undefined)
  assert.equal(f.session.rows.value[0].status, 'idle')
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  f.api.test = async input => { f.calls.push(input); await gate; return receipt(input.model, input.thinkingLevel) }
  const run = f.session.testModels(['one', 'two'])
  f.session.setThinkingLevel('low')
  assert.equal(f.session.thinkingLevel.value, 'high')
  release(); await run
  assert.ok(f.calls.slice(1).every(call => call.thinkingLevel === 'high'))
  assert.equal(f.session.rows.value[1].result?.thinkingLevel, 'high')
  f.session.setThinkingLevel('medium')
  f.api.test = async input => receipt(input.model)
  await f.session.testModels(['one'])
  assert.equal(f.session.rows.value[0].status, 'failed')
  assert.equal(f.session.rows.value[0].result, undefined)
})

test('explicitly chosen tested thinking is saved to every default slot without another probe', async () => {
  const saves: any[] = []
  const api = {
    list: async () => ({ revision: 4, connections: [{ ...connection, protocol: 'gemini-native', enabled: true }] }),
    defaults: async () => ({ revision: 0 }),
    saveDefaults: async (value: unknown) => { saves.push(value); return value },
    test: async () => assert.fail('must not repeat successful probe')
  } as unknown as ModelConnectionsApi
  await saveTestedModelDefault(api, receipt('gemini-3.8-flash', 'high'))
  for (const profile of [saves[0].template.shared, ...Object.values(saves[0].template.tasks)] as any[]) {
    assert.equal(profile.thinkingLevel, 'high')
    assert.equal(profile.model, 'gemini-3.8-flash')
  }
})
