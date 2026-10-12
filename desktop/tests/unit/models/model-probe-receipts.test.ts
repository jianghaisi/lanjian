import assert from 'node:assert/strict'
import test from 'node:test'
import { finishQuickSetup, saveTestedModelDefault } from '../../../src/renderer/features/models/services/model-quick-setup'
import { useModelTests } from '../../../src/renderer/features/models/composables/use-model-tests'
import type { ModelConnectionsApi, ModelProbeResult, ModelProbe } from '../../../src/contracts/models/model-connections-contracts'

const auto = { version: 1, mode: 'auto' } as const
const connection = { id: 'global-fixture', revision: 3, name: 'Fixture', enabled: true, protocol: 'gemini-native', baseUrl: 'https://example.test', credentialState: 'missing' } as const
const receipt = (patch: Partial<ModelProbeResult> = {}): ModelProbeResult => ({ id: connection.id, revision: connection.revision, model: 'writer', parameterPolicy: auto,
  parameterFingerprint: 'a'.repeat(64), success: true, message: '完成', testedAt: '2026-10-01T00:00:00.000Z', models: [], ...patch })
function fixture(result = receipt()) {
  const saves: Parameters<ModelConnectionsApi['saveDefaults']>[0][] = [], probes: ModelProbe[] = []
  const api = {
    list: async () => ({ revision: 8, connections: [connection] }),
    defaults: async () => ({ revision: 2, catalogRevision: 8, template: null, references: [] }),
    saveDefaults: async (input: Parameters<ModelConnectionsApi['saveDefaults']>[0]) => { saves.push(input); return { revision: 3, catalogRevision: 9, template: input.template, references: [] } },
    test: async (input: ModelProbe) => { probes.push(input); return result },
    catalog: async () => ({ ...receipt({ model: '' }), models: ['writer'] }), cancelTest: async () => true
  } satisfies Pick<ModelConnectionsApi, 'list' | 'defaults' | 'saveDefaults' | 'test' | 'catalog' | 'cancelTest'>
  return { api: api as unknown as ModelConnectionsApi, saves, probes }
}
const incomplete = () => {
  const result = receipt(); delete result.parameterPolicy; delete result.parameterFingerprint
  return result
}
const cases: Array<[string, () => ModelProbeResult]> = [
  ['wrong interface', () => receipt({ id: 'global-other' })],
  ['old revision', () => receipt({ revision: 2 })],
  ['different model', () => receipt({ model: 'another-writer' })],
  ['missing adaptive confirmation', incomplete],
  ['missing fingerprint', () => { const r = receipt(); delete r.parameterFingerprint; return r }],
  ['different parameter policy', () => receipt({ parameterPolicy: { version: 1, mode: 'custom', overrides: { temperature: 1 } } })]
]
for (const [name, result] of cases) {
  test(`quick setup rejects ${name} without saving or repeating the request`, async () => {
    const f = fixture(result())
    await assert.rejects(finishQuickSetup(f.api, connection.id, 'writer'), /测试|参数|回执/)
    assert.equal(f.saves.length, 0); assert.equal(f.probes.length, 1)
  })
  test(`model test list cannot mark ${name} as passed`, async () => {
    const f = fixture(result()), session = useModelTests(f.api)
    await session.load(connection); await session.testModels(['writer'])
    assert.equal(session.rows.value[0].status, 'failed')
    assert.equal(session.rows.value[0].result, undefined)
    assert.equal(f.probes.length, 1)
  })
}
test('quick setup sends explicit auto intent and preserves it in all saved slots', async () => {
  const f = fixture()
  await finishQuickSetup(f.api, connection.id, ' writer ')
  assert.deepEqual(f.probes[0], { id: connection.id, revision: connection.revision, model: 'writer', parameterPolicy: auto })
  const template = f.saves[0].template!
  assert.deepEqual(template.shared.parameterPolicy, auto)
  for (const profile of Object.values(template.tasks)) assert.deepEqual(profile, template.shared)
})
test('choosing a tested default captures its model and nested parameters before awaiting reads', async () => {
  const result = receipt({ parameterPolicy: { version: 1, mode: 'custom', overrides: { temperature: 0, maxTokens: 2048 } } })
  const f = fixture(result), list = f.api.list
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  f.api.list = async () => { await gate; return list() }
  const saving = saveTestedModelDefault(f.api, result)
  result.model = 'unselected-model'
  assert.ok(result.parameterPolicy?.mode === 'custom'); result.parameterPolicy.overrides.temperature = 2
  release(); await saving
  assert.equal(f.probes.length, 0)
  assert.equal(f.saves[0].template!.shared.model, 'writer')
  assert.deepEqual(f.saves[0].template!.shared.parameterPolicy, { version: 1, mode: 'custom', overrides: { temperature: 0, maxTokens: 2048 } })
})
test('an unconfirmed default cannot silently become automatic', async () => {
  const f = fixture()
  await assert.rejects(saveTestedModelDefault(f.api, incomplete()), /测试|参数/)
  assert.equal(f.saves.length, 0); assert.equal(f.probes.length, 0)
})
