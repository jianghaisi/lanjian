import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { officialCreativePackageFor, officialCreativePackages, officialCreativePackagesFor, type OfficialCreativeReference } from '@lanjian/writing-plugin-package/official'
import { creativePolicyRun } from '../../../src/main/modules/writing-plugins/domain/creative-policy'
import { assertReleasedCreativePolicy, restoreCreativePolicy } from '../../../src/main/modules/writing-plugins/domain/creative-policy-snapshot'
import { createCreativePolicyProvider } from '../../../src/main/modules/writing-plugins/runtime/creative-policy-provider'

const registry = JSON.parse(await readFile(new URL('../../../../packages/writing-plugin-package/official-history/releases.json', import.meta.url), 'utf8')) as {
  packages: (OfficialCreativeReference & { directory: string })[]; sets: OfficialCreativeReference[][]
}
const current = () => officialCreativePackages().map(pkg => ({ pluginId: pkg.manifest.id, version: pkg.manifest.version, digest: pkg.digest }))
const original = registry.sets.find(set => set.some(ref => ref.pluginId.endsWith('story-planning') && ref.version === '1.5.0') && set.some(ref => ref.pluginId.endsWith('creative-writing') && ref.version === '1.2.0'))!

test('every registered original set loads its actual immutable source bytes; returned maps and manifests are isolated', async () => {
  for (const [family, lastMinor] of [['creative-team', 0], ['creative-writing', 4], ['story-planning', 6]] as const) {
    for (let minor = 0; minor <= lastMinor; minor++) assert.ok(registry.packages.some(ref => ref.pluginId === `lanjian.official.${family}` && ref.version === `1.${minor}.0`), `original ${family} 1.${minor}.0 must remain available`)
  }
  for (const refs of registry.sets) {
    const packages = officialCreativePackagesFor(refs)
    assert.deepEqual(packages.map(pkg => ({ pluginId: pkg.manifest.id, version: pkg.manifest.version, digest: pkg.digest })), refs)
    for (const pkg of packages) {
      assert.equal(createHash('sha256').update(JSON.stringify(Object.fromEntries(pkg.files))).digest('hex'), pkg.digest)
      const pin = registry.packages.find(ref => ref.pluginId === pkg.manifest.id && ref.version === pkg.manifest.version)!
      const ref = { pluginId: pin.pluginId, version: pin.version, digest: pin.digest }
      for (const [path, text] of pkg.files) assert.equal(await readFile(new URL(`../../../../packages/writing-plugin-package/official-history/${pin.directory}/${path}`, import.meta.url), 'utf8'), text)
      pkg.manifest.name = 'MUTATED_DIAGNOSTIC'; (pkg.files as Map<string, string>).set('team.json', 'MUTATED_DIAGNOSTIC')
      assert.notEqual(officialCreativePackageFor(ref).manifest.name, 'MUTATED_DIAGNOSTIC')
      assert.notEqual(officialCreativePackageFor(ref).files.get('team.json'), 'MUTATED_DIAGNOSTIC')
    }
  }
})

test('known early two-package V3 releases stay complete without importing today’s writing or map method', () => {
  const refs = registry.sets.find(set => set.length === 2 && set.some(ref => ref.version === '1.0.0' && ref.pluginId.endsWith('story-planning')))! // actual shipped set
  const run = creativePolicyRun([], undefined, undefined, refs)
  assert.deepEqual(run.snapshot!().released, refs)
  assert.ok(run.resolve('foundation').length)
  assert.throws(() => run.resolve('prose'), { code: 'FEATURE_UNAVAILABLE' })
  assert.throws(() => run.resolve('world-map-style'), { code: 'FEATURE_UNAVAILABLE' })
  assert.ok(creativePolicyRun().resolve('prose').length)
})

test('unknown, incomplete, duplicated and never-shipped mixtures cannot replace an original complete release', () => {
  const now = current(), oldStory = registry.packages.find(ref => ref.pluginId.endsWith('story-planning') && ref.version === '1.0.0')!
  const mix = now.map(ref => ref.pluginId === oldStory.pluginId ? { pluginId: oldStory.pluginId, version: oldStory.version, digest: oldStory.digest } : ref)
  const bad = [[], now.slice(0, 2), [...now, now[0]!], now.map((ref, i) => i === 0 ? { ...ref, digest: '0'.repeat(64) } : ref), now.map((ref, i) => i === 0 ? { ...ref, version: '999.0.0' } : ref), mix]
  for (const refs of bad) {
    assert.throws(() => officialCreativePackagesFor(refs))
    assert.throws(() => assertReleasedCreativePolicy({ ...creativePolicyRun().snapshot!(), released: refs }), { code: 'CONFLICT' })
    assert.throws(() => creativePolicyRun([], undefined, undefined, refs), { code: 'CONFLICT' })
  }
  assert.throws(() => officialCreativePackageFor({ ...now[0]!, text: 'STORED_TEXT_CANNOT_AUTHORIZE' } as OfficialCreativeReference))
})

test('default-only JSON recovery and the production provider restore the original release without capturing today’s selection', async () => {
  const run = creativePolicyRun([], undefined, undefined, original)
  const before = run.resolve('genre-guidance', { genre: '悬疑', subgenre: '' }), snapshot = run.snapshot!()
  let calls = 0
  const forbidden = async (): Promise<never> => { calls++; throw Error('new capture or installed load is forbidden') }
  const provider = createCreativePolicyProvider(forbidden, forbidden)
  for (const restored of [await restoreCreativePolicy(forbidden, JSON.parse(JSON.stringify(snapshot))), await provider.restore!(JSON.parse(JSON.stringify(snapshot)))]) {
    assert.deepEqual(restored.snapshot!(), snapshot)
    assert.deepEqual(restored.resolve('genre-guidance', { genre: '仙侠', subgenre: '新类型' }), before)
    assert.throws(() => restored.resolve('world-map-style'), { code: 'FEATURE_UNAVAILABLE' })
    await restored.assertAuthorized?.()
  }
  assert.equal(calls, 0)
  assert.ok(creativePolicyRun().resolve('world-map-style').length)
})

test('known default history does not confer installed access or accept diagnostic method text', async () => {
  const snapshot = creativePolicyRun([], undefined, undefined, original).snapshot!()
  await assert.rejects(restoreCreativePolicy(async () => creativePolicyRun(), { ...snapshot, installed: [snapshot.released[0]!] }), { code: 'FEATURE_UNAVAILABLE' })
  await assert.rejects(restoreCreativePolicy(async () => creativePolicyRun(), { ...snapshot, text: 'UNTRUSTED_METHOD' }), { code: 'CONFLICT' })
  let loads = 0
  const provider = createCreativePolicyProvider(async () => { throw Error('never recapture') }, async () => { loads++; throw Error('never load installed bytes') })
  await assert.rejects(provider.restore!({ ...snapshot, released: snapshot.released.map((ref, i) => i === 0 ? { ...ref, digest: 'f'.repeat(64) } : ref) }), { code: 'CONFLICT' })
  assert.equal(loads, 0)
})
