import assert from 'node:assert/strict'
import test from 'node:test'
import { createSoundPreferenceStore, parseSoundPreferences, SOUND_PREFERENCES_KEY, soundDefaults } from '../../../src/renderer/app/composables/useSoundPreferences'

function storage(raw?: string) {
  const values = new Map(raw === undefined ? [] : [[SOUND_PREFERENCES_KEY, raw]])
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}
test('sound defaults are shared and mute persists before any startup playback', () => {
  const db = storage(), first = createSoundPreferenceStore(db)
  assert.deepEqual(first.preferences.value, soundDefaults)
  assert.equal(first.update({ enabled: false, volume: .35, waiting: true }), true)
  assert.deepEqual(createSoundPreferenceStore(db).preferences.value, { ...soundDefaults, enabled: false, volume: .35, waiting: true })
  assert.equal(db.values.size, 1)
})
test('malformed settings stay untouched and fail quiet until explicit backed-up reset', () => {
  for (const raw of ['broken', '{}', JSON.stringify({ ...soundDefaults, volume: 2 }), JSON.stringify({ ...soundDefaults, hover: 'yes' })]) {
    assert.throws(() => parseSoundPreferences(raw))
    const db = storage(raw), settings = createSoundPreferenceStore(db)
    assert.equal(settings.preferences.value.enabled, false)
    assert.equal(settings.update({ enabled: true }), false)
    assert.equal(db.getItem(SOUND_PREFERENCES_KEY), raw)
    assert.equal(settings.reset(), true)
    assert.ok([...db.values].some(([key, value]) => key.includes('-backup-') && value === raw))
    assert.deepEqual(settings.preferences.value, soundDefaults)
  }
})
test('write failures never prevent session mute or falsely persist another change', () => {
  const settings = createSoundPreferenceStore({ getItem: () => null, setItem: () => { throw new Error('quota') } })
  assert.equal(settings.update({ volume: .3 }), false)
  assert.equal(settings.preferences.value.volume, .6)
  assert.equal(settings.update({ enabled: false }), false)
  assert.equal(settings.preferences.value.enabled, false)
  assert.equal(settings.update({ enabled: true }), false)
  assert.equal(settings.preferences.value.enabled, false)
  assert.ok(settings.error.value)
  assert.equal(settings.reset(), false)
})
