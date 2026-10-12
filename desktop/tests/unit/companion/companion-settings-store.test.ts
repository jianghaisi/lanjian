import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CompanionSettingsStore } from '../../../src/main/modules/companion/adapters/companion-settings-store'
import { defaultCompanionVoicePreferences } from '../../../src/contracts/companion/companion-settings'

test('shared preferences serialize patches, detach arguments, and import legacy only once', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pet-settings-')); t.after(() => rm(root, { recursive: true, force: true }))
  const store = new CompanionSettingsStore(root)
  const input = { ...defaultCompanionVoicePreferences, volume: .3 }
  const imported = store.importVoice(input); input.volume = .9
  assert.equal((await imported).voice.volume, .3)
  await Promise.all([store.update({ voice: { mute: true } }), store.update({ reducedMotion: true })])
  const state = await store.importVoice(defaultCompanionVoicePreferences)
  assert.equal(state.voice.mute, true); assert.equal(state.voice.volume, .3); assert.equal(state.reducedMotion, true)
  assert.deepEqual(await new CompanionSettingsStore(root).read(), state)
})
test('corrupt and future settings are preserved; explicit recovery backs up exact bytes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pet-settings-')); t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'companion-settings.json'), store = new CompanionSettingsStore(root)
  const corrupt = '{"version":99,"private":"do not overwrite"}'
  await writeFile(file, corrupt)
  await assert.rejects(store.update({ reducedMotion: true }), /原文件已保留/)
  assert.equal(await readFile(file, 'utf8'), corrupt)
  const restored = await store.recover(); assert.ok(restored.revision > 1000)
  const backup = (await readdir(root)).find(name => name.endsWith('.bak'))!
  assert.equal(await readFile(join(root, backup), 'utf8'), corrupt)
})
test('failed persistence never claims a successful new preference', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pet-settings-')); t.after(() => rm(root, { recursive: true, force: true }))
  await new CompanionSettingsStore(root).update({ voice: { volume: .2 } })
  const failed = new CompanionSettingsStore(root, async () => { throw new Error('private path') })
  await assert.rejects(failed.update({ voice: { volume: .8 } }), /尚未保存/)
  assert.equal((await failed.read()).voice.volume, .2)
})
