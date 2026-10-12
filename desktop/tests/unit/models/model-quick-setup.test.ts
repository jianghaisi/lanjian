import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelConnectionsApi, ModelProbe } from '../../../src/contracts/models/model-connections-contracts'
import { finishQuickSetup } from '../../../src/renderer/features/models/services/model-quick-setup'

test('one shared selection populates every route; retrying a failed probe reuses the exact saved connection', async () => {
  const saved: unknown[] = [], probes: unknown[] = []
  let success = false
  const catalog = { revision: 9, connections: [{ id: 'global-selected', revision: 3, enabled: true }, { id: 'global-same-name-other', revision: 6, enabled: true }] }
  const api = {
    list: async () => catalog, defaults: async () => ({ revision: 4 }),
    test: async (input: ModelProbe) => { probes.push(input); return { ...input, success, message: '型号不可用', testedAt: '2026-10-01T00:00:00.000Z', models: [], parameterFingerprint: 'a'.repeat(64) } },
    create: async () => { throw Error('must not create on retry') },
    saveDefaults: async (input: unknown) => { saved.push(input); return input }
  } as unknown as ModelConnectionsApi
  await assert.rejects(finishQuickSetup(api, 'global-selected', 'author-model'), /型号不可用/)
  assert.equal(saved.length, 0)
  success = true
  await finishQuickSetup(api, 'global-selected', 'author-model')
  assert.deepEqual(probes, Array.from({ length: 2 }, () => ({ id: 'global-selected', revision: 3, model: 'author-model', parameterPolicy: { version: 1, mode: 'auto' } })))
  const result = saved[0] as { expectedRevision: number; expectedCatalogRevision: number; template: { references: unknown[]; routingMode: string; shared: unknown; tasks: Record<string, unknown> } }
  assert.equal(result.expectedRevision, 4)
  assert.equal(result.expectedCatalogRevision, 9)
  assert.equal(result.template.routingMode, 'shared')
  assert.deepEqual(result.template.references, [{ kind: 'global', id: 'assigned-1', globalConnectionId: 'global-selected' }])
  for (const profile of Object.values(result.template.tasks)) assert.deepEqual(profile, result.template.shared)
})

test('disabled selection never falls back to another available connection', async () => {
  const api = { list: async () => ({ connections: [{ id: 'original', enabled: false }, { id: 'other', enabled: true }] }) } as unknown as ModelConnectionsApi
  await assert.rejects(finishQuickSetup(api, 'original', 'model'), /已停用/)
})
