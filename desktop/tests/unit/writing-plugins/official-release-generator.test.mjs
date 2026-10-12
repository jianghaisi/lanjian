import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, realpath, cp, writeFile, readFile, readdir, rm, symlink, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildOfficialCatalog } from '../../../../packages/writing-plugin-package/scripts/build-official.mjs'
import { PluginContractError } from '@lanjian/writing-plugin-contracts'

async function fixture(t) {
  const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-official-release-')))
  assert.equal(dirname(root), parent)
  t.after(async () => { assert.equal(dirname(await realpath(root)), parent); await rm(root, { recursive: true, force: true }) })
  const officialRoot = join(root, 'official'), historyRoot = join(root, 'history'), output = join(root, 'catalogue.ts')
  await cp(fileURLToPath(new URL('../../../../packages/writing-plugin-package/official', import.meta.url)), officialRoot, { recursive: true })
  await cp(fileURLToPath(new URL('../../../../packages/writing-plugin-package/official-history', import.meta.url)), historyRoot, { recursive: true })
  await writeFile(output, 'PREVIOUS_RELEASE_OUTPUT\n')
  const metadata = JSON.parse(await readFile(join(historyRoot, 'releases.json'), 'utf8'))
  return { root, officialRoot, historyRoot, output, metadata,
    save: () => writeFile(join(historyRoot, 'releases.json'), JSON.stringify(metadata)),
    build: () => buildOfficialCatalog({ officialRoot, historyRoot, output }),
    preserved: async () => assert.equal(await readFile(output, 'utf8'), 'PREVIOUS_RELEASE_OUTPUT\n') }
}
const invalid = error => error instanceof Error && error.message === 'Invalid official release source'

test('the actual generator validates immutable source versions and original sets, and emits pure release data', async t => {
  const f = await fixture(t)
  await f.build()
  const output = await readFile(f.output, 'utf8')
  assert.ok(output.includes('export const officialCatalogData = '))
  assert.ok(output.includes('export const officialReleaseCatalogData = '))
  assert.ok(output.includes('export const officialReleaseSetsData = '))
  const data = name => JSON.parse(output.split(`export const ${name} = `)[1].split(' as const\n')[0])
  assert.deepEqual(data('officialReleaseSetsData'), f.metadata.sets)
  assert.deepEqual(data('officialReleaseCatalogData').map(pkg => ({ pluginId: pkg.manifest.id, version: pkg.manifest.version, digest: pkg.digest })), f.metadata.packages.map(({ pluginId, version, digest }) => ({ pluginId, version, digest })))
  assert.ok(!output.includes('node:') && !output.includes('PREVIOUS_RELEASE_OUTPUT'))
})

for (const [name, mutate] of [
  ['changed original method bytes', async f => { await writeFile(join(f.historyRoot, 'story-planning/1.0.0/foundation.md'), 'CHANGED_ORIGINAL_METHOD') }],
  ['same-version current method changes', async f => { await writeFile(join(f.officialRoot, 'story-planning/foundation.md'), 'CHANGED_CURRENT_WITHOUT_VERSION') }],
  ['an unregistered new current version', async f => { const path = join(f.officialRoot, 'creative-team/lanjian-plugin.json'), manifest = JSON.parse(await readFile(path, 'utf8')); manifest.version = '9.0.0'; await writeFile(path, JSON.stringify(manifest)) }],
  ['extra undeclared historical file', async f => { await writeFile(join(f.historyRoot, 'creative-team/1.0.0/undeclared.txt'), 'UNDECLARED') }],
  ['wrong registered digest', async f => { f.metadata.packages[0].digest = '0'.repeat(64); await f.save() }],
  ['duplicate version pins', async f => { f.metadata.packages.push(f.metadata.packages[0]); await f.save() }],
  ['duplicate full release sets', async f => { f.metadata.sets.push(f.metadata.sets[0]); await f.save() }],
  ['a non-string version disguised by string coercion', async f => { f.metadata.sets[0][0].version = [f.metadata.sets[0][0].version]; await f.save() }],
  ['a non-string digest disguised by string coercion', async f => { f.metadata.sets[0][0].digest = [f.metadata.sets[0][0].digest]; await f.save() }],
  ['unregistered current full set', async f => {
    const manifests = await Promise.all((await readdir(f.officialRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(async entry => JSON.parse(await readFile(join(f.officialRoot, entry.name, 'lanjian-plugin.json'), 'utf8'))))
    const current = new Set(manifests.map(manifest => `${manifest.id}@${manifest.version}`)), count = f.metadata.sets.length
    f.metadata.sets = f.metadata.sets.filter(refs => !(refs.length === current.size && refs.every(ref => current.has(`${ref.pluginId}@${ref.version}`))))
    assert.equal(f.metadata.sets.length, count - 1)
    await f.save()
  }],
  ['malformed source manifest', async f => { const path = join(f.historyRoot, 'creative-team/1.0.0/lanjian-plugin.json'), manifest = JSON.parse(await readFile(path, 'utf8')); manifest.unknownGrant = true; await writeFile(path, JSON.stringify(manifest)) }],
]) test(`generator refuses ${name} without overwriting the previous output`, async t => {
  const f = await fixture(t); await mutate(f)
  await assert.rejects(f.build(), error => invalid(error) || (name === 'malformed source manifest' && error instanceof PluginContractError))
  await f.preserved()
})

test('historical directory junctions are rejected before publishing a catalogue', async t => {
  const f = await fixture(t), target = join(f.root, 'linked-release'), original = join(f.historyRoot, 'creative-team/1.0.0')
  await rename(original, target)
  await symlink(target, original, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(f.build(), invalid); await f.preserved()
})

test('missing declared assets and malformed UTF-8 refuse generation without publishing partial data', async t => {
  for (const malformed of [false, true]) {
    const f = await fixture(t), path = join(f.historyRoot, 'story-planning/1.0.0/foundation.md')
    if (malformed) await writeFile(path, Buffer.from([0xff, 0xfe, 0xff]))
    else await rm(path)
    await assert.rejects(f.build(), error => error?.code === (malformed ? 'ERR_ENCODING_INVALID_ENCODED_DATA' : 'ENOENT'))
    await f.preserved()
  }
})
