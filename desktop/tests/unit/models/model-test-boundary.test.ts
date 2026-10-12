import assert from 'node:assert/strict'
import test from 'node:test'
import { useModelTests } from '../../../src/renderer/features/models/composables/use-model-tests'
import type { ModelConnectionsApi, ModelProbe } from '../../../src/contracts/models/model-connections-contracts'
import { reactive } from 'vue'
import { compileRouting, routingDraft } from '../../../src/renderer/features/models/services/model-connections-state'
import { decodeBookModelSettings } from '../../../src/contracts/models/book-model-settings'

test('reactive custom test parameters cross the Electron clone boundary and freeze explicit zero', async () => {
  let input: ModelProbe | undefined
  const receipt = { id: 'global-fixture', revision: 1, model: 'writer', testedAt: '2026-09-30T00:00:00.000Z', success: true, message: '已完成', models: ['writer'], parameterFingerprint: 'a'.repeat(64) }
  const api = {
    catalog: async () => receipt,
    test: async (value: ModelProbe) => { input = structuredClone(value); return { ...receipt, parameterPolicy: input.parameterPolicy } },
    cancelTest: async () => true
  } satisfies Pick<ModelConnectionsApi, 'catalog' | 'test' | 'cancelTest'>
  const session = useModelTests(api)
  await session.load({ id: receipt.id, revision: receipt.revision })
  session.setParameters('writer', { selection: 'global:global-fixture', model: 'writer', parameterPolicy: { version: 1, mode: 'custom', overrides: { temperature: 0, thinking: { kind: 'effort', value: 'none' } } } })
  await session.testModels(['writer'])
  assert.equal(session.rows.value[0].status, 'passed')
  assert.deepEqual(input?.parameterPolicy, { version: 1, mode: 'custom', overrides: { temperature: 0, thinking: { kind: 'effort', value: 'none' } } })
  session.setParameters('writer', { selection: 'global:global-fixture', model: 'writer', parameterPolicy: { version: 1, mode: 'auto' } })
  assert.equal(session.rows.value[0].result, undefined)
  assert.equal(input?.parameterPolicy?.mode, 'custom')
})

test('a reactive retained inactive profile stays cloneable and preserves alias identity and explicit zero', () => {
  const p = { connectionId: 'assigned-1', model: 'writer', parameterPolicy: { version: 1, mode: 'custom', overrides: { temperature: 0 } } }
  const baseline = reactive(decodeBookModelSettings({ version: 5, routingMode: 'perTask', references: [
    { kind: 'global', id: 'assigned-1', globalConnectionId: 'global-missing-api', lastKnownName: '原接口' },
    { kind: 'global', id: 'second-alias', globalConnectionId: 'global-missing-api' }
  ], shared: p, tasks: { outline: p, chapterOutline: p, prose: p, review: { ...p, connectionId: 'second-alias' } } }))
  const draft = reactive(routingDraft(baseline)); draft.routingMode = 'shared'
  draft.profiles.shared = { selection: 'global:global-new-api', model: 'new-writer', parameterPolicy: { version: 1, mode: 'auto' } }
  const result = compileRouting(draft, { revision: 3, connections: [{ id: 'global-new-api', name: '新接口', baseUrl: 'https://new.example.test/v1', protocol: 'openai-compatible', revision: 1, enabled: true, credentialState: 'missing' }] }, baseline)
  assert.deepEqual(structuredClone(result.patch), result.patch)
  assert.deepEqual(result.template.tasks, baseline.tasks)
  assert.notEqual(result.template.shared.connectionId, 'assigned-1')
  assert.equal(result.template.tasks.review.connectionId, 'second-alias')
})

test('a non-text-only catalog explains why writing tests are unavailable and makes no generation call', async () => {
  const session = useModelTests({
    catalog: async () => ({ id: 'global-fixture', revision: 1, model: '', testedAt: '2026-10-01T00:00:00.000Z', success: true, message: '已获取', models: ['vector-model'],
      catalog: { connectionId: 'global-fixture', revision: 1, protocol: 'gemini-native', fetchedAt: '2026-10-01T00:00:00.000Z', complete: true, entries: [{ id: 'vector-model', supportedGenerationMethods: ['embedContent'] }] } }),
    test: async () => assert.fail('non-text models must never enter the test queue'), cancelTest: async () => true
  })
  await session.load({ id: 'global-fixture', revision: 1 })
  assert.equal(session.catalog.value?.entries.length, 1)
  assert.equal(session.rows.value.length, 0)
  assert.match(session.error.value, /均不支持文本生成/)
  await session.testModels(['vector-model'])
})

test('unfinished numeric input invalidates a receipt and blocks generation until explicitly repaired', async () => {
  const inputs: ModelProbe[] = []
  const receipt = { id: 'global-fixture', revision: 1, model: 'writer', testedAt: '2026-10-01T00:00:00.000Z', success: true, message: '已完成', models: ['writer'], parameterFingerprint: 'a'.repeat(64) }
  const session = useModelTests({ catalog: async () => receipt,
    test: async value => { inputs.push(structuredClone(value)); return { ...receipt, parameterPolicy: value.parameterPolicy } }, cancelTest: async () => true })
  await session.load({ id: receipt.id, revision: receipt.revision })
  const profile = { selection: 'global:global-fixture', model: 'writer', parameterPolicy: { version: 1, mode: 'custom', overrides: { temperature: 0 } } } as const
  session.setParameters('writer', profile); await session.testModels(['writer'])
  assert.equal(inputs.length, 1); assert.equal(session.rows.value[0].status, 'passed')
  session.setParameters('writer', { ...profile, parameterInputErrors: { temperature: true } })
  assert.equal(session.rows.value[0].result, undefined)
  await session.testModels(['writer'])
  assert.equal(inputs.length, 1, 'invalid text must never send the previous valid policy')
  assert.equal(session.rows.value[0].status, 'failed')
  assert.match(session.rows.value[0].message, /创造性.*完整数字/)
  session.setParameters('writer', profile); await session.testModels(['writer'])
  assert.equal(inputs.length, 2)
  assert.deepEqual(inputs[1].parameterPolicy, profile.parameterPolicy)
  assert.equal('parameterInputErrors' in inputs[1], false)
})
