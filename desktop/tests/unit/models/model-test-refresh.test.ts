import assert from 'node:assert/strict'
import test from 'node:test'
import { useModelTests } from '../../../src/renderer/features/models/composables/use-model-tests'
import type { ModelCatalogEntry } from '../../../src/contracts/models/model-catalog-metadata'
import type { ModelCatalogQuery, ModelProbe, ModelProbeResult } from '../../../src/contracts/models/model-connections-contracts'
import type { ProfileDraft } from '../../../src/renderer/features/models/services/model-connections-state'

const connection = { id: 'global-fixture', revision: 1 }
const policy = { version: 1, mode: 'custom', overrides: { temperature: 0, maxTokens: 2048 } } as const
const profile: ProfileDraft = { selection: 'global:global-fixture', model: 'writer', parameterPolicy: policy }
function fixture() {
  let entries: ModelCatalogEntry[] = [{ id: 'writer', supportedGenerationMethods: ['generateContent'], outputTokenLimit: 8192, maxTemperature: 2 }]
  const calls: ModelProbe[] = []
  const result = (input: ModelCatalogQuery): ModelProbeResult => ({ ...input, model: '', success: true, message: '完成', testedAt: '2026-10-01T00:00:00.000Z', models: entries.map(e => e.id),
    catalog: { connectionId: input.id, revision: input.revision, protocol: 'gemini-native', fetchedAt: '2026-10-01T00:00:00.000Z', complete: true, entries } })
  const api = {
    catalog: async (input: ModelCatalogQuery) => result(input),
    test: async (input: ModelProbe) => { calls.push(structuredClone(input)); return { ...input, success: true, message: '完成', testedAt: '2026-10-01T00:00:00.000Z', models: [], parameterFingerprint: 'a'.repeat(64) } },
    cancelTest: async () => true
  }
  return { api, calls, result, setEntries: (value: ModelCatalogEntry[]) => { entries = value }, session: useModelTests(api) }
}
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value))

test('refresh keeps explicit per-model intent and zero, clears receipts/selection, and uses the new catalog', async () => {
  const f = fixture(); await f.session.load(connection)
  f.session.setParameters('writer', profile); f.session.selected.value = ['writer']
  await f.session.testModels(['writer']); assert.ok(f.session.rows.value[0].result)
  f.setEntries([{ id: 'new-model' }, { id: 'writer', outputTokenLimit: 1024 }])
  await f.session.load(connection)
  assert.deepEqual(plain(f.session.rows.value[1].profile), profile)
  assert.deepEqual(f.session.rows.value[0].profile?.parameterPolicy, { version: 1, mode: 'auto' })
  assert.ok(f.session.rows.value.every(row => row.status === 'idle' && !row.result && !row.message))
  assert.deepEqual(f.session.selected.value, [])
  assert.equal(f.session.catalog.value?.entries[1].outputTokenLimit, 1024)
  assert.equal(f.calls.length, 1, 'refresh must not generate')
})

test('a failed refresh hides obsolete choices but retries retain custom drafts', async () => {
  const f = fixture(); await f.session.load(connection); f.session.setParameters('writer', profile)
  const original = f.api.catalog
  f.api.catalog = async () => { throw Error('目录暂不可用') }
  await f.session.load(connection); await f.session.load(connection)
  assert.equal(f.session.rows.value.length, 0); assert.equal(f.session.catalog.value, undefined)
  assert.match(f.session.error.value, /目录暂不可用/)
  f.api.catalog = original; await f.session.load(connection)
  assert.deepEqual(plain(f.session.rows.value[0].profile), profile)
  await f.session.testModels(['writer'])
  assert.deepEqual(f.calls[0].parameterPolicy, policy)
})

test('cancelled refresh cannot publish late results; retry keeps the original parameters', async () => {
  const f = fixture(); await f.session.load(connection); f.session.setParameters('writer', profile)
  const original = f.api.catalog
  let release!: () => void
  f.api.catalog = async input => { await new Promise<void>(resolve => { release = resolve }); return f.result(input) }
  const loading = f.session.load(connection)
  await f.session.cancel(); release(); await loading
  assert.equal(f.session.rows.value.length, 0); assert.equal(f.session.catalog.value, undefined)
  f.api.catalog = original; await f.session.load(connection)
  assert.deepEqual(plain(f.session.rows.value[0].profile), profile)
})

test('refresh retains unfinished-number errors so retry cannot send an earlier valid value', async () => {
  const f = fixture(); await f.session.load(connection)
  f.session.setParameters('writer', { ...profile, parameterInputErrors: { maxTokens: true } })
  await f.session.load(connection); await f.session.testModels(['writer'])
  assert.equal(f.calls.length, 0)
  assert.equal(f.session.rows.value[0].status, 'failed')
  assert.match(f.session.rows.value[0].message, /最大输出.*完整数字/)
  assert.deepEqual(f.session.rows.value[0].profile?.parameterPolicy, policy)
})

for (const next of [{ ...connection, revision: 2 }, { id: 'global-other', revision: 1 }]) {
  test(`different source identity ${next.id}/${next.revision} cannot inherit or resurrect old drafts`, async () => {
    const f = fixture(); await f.session.load(connection); f.session.setParameters('writer', profile)
    await f.session.load(next)
    assert.deepEqual(f.session.rows.value[0].profile?.parameterPolicy, { version: 1, mode: 'auto' })
    assert.equal(f.session.rows.value[0].profile?.selection, `global:${next.id}`)
    await f.session.load(connection)
    assert.deepEqual(f.session.rows.value[0].profile?.parameterPolicy, { version: 1, mode: 'auto' })
    assert.equal(f.calls.length, 0)
  })
}

for (const entries of [[], [{ id: 'writer', supportedGenerationMethods: ['embedContent'] }]]) {
  test(`confirmed ${entries.length ? 'non-text' : 'absent'} models discard their old test drafts`, async () => {
    const f = fixture(); await f.session.load(connection); f.session.setParameters('writer', profile)
    f.setEntries(entries); await f.session.load(connection)
    assert.equal(f.session.rows.value.length, 0)
    f.setEntries([{ id: 'writer' }]); await f.session.load(connection)
    assert.deepEqual(f.session.rows.value[0].profile?.parameterPolicy, { version: 1, mode: 'auto' })
  })
}
