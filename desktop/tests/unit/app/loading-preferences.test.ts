import assert from 'node:assert/strict'
import test from 'node:test'
import { createLoadingPreferenceStore, LOADING_PREFERENCES_KEY, parseLoadingPreferences } from '../../../src/renderer/app/composables/useLoadingPreferences'

function memoryStorage(initial?: string) {
  const entries = new Map<string, string>()
  if (initial !== undefined) entries.set(LOADING_PREFERENCES_KEY, initial)
  return { entries, getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value) } }
}
test('impact is the default while both approved themes persist and legacy motion data is discarded', () => {
  const storage = memoryStorage()
  const first = createLoadingPreferenceStore(storage)
  assert.deepEqual(first.preferences.value, { theme: 'impact', bootStyle:'cinematic', bootPalette:'system' })
  assert.equal(first.update({ theme: 'impact', bootStyle:'cinematic', bootPalette:'system' }), true)
  const reopened = createLoadingPreferenceStore(storage)
  assert.deepEqual(reopened.preferences.value, { theme: 'impact', bootStyle:'cinematic', bootPalette:'system' })
  assert.equal(reopened.update({ theme: 'standard' }), true)
  assert.deepEqual(createLoadingPreferenceStore(memoryStorage('{"theme":"impact","reducedMotion":true}')).preferences.value, { theme: 'impact', bootStyle:'cinematic', bootPalette:'system' })
})
test('malformed or unknown preferences are not silently overwritten, reset backs up original bytes', () => {
  for (const raw of ['invalid-json', '{}', '{"theme":"third","reducedMotion":false}']) {
    assert.throws(() => parseLoadingPreferences(raw))
    const storage = memoryStorage(raw)
    const store = createLoadingPreferenceStore(storage)
    assert.equal(store.update({ theme: 'impact', bootStyle:'cinematic', bootPalette:'system' }), false)
    assert.equal(storage.getItem(LOADING_PREFERENCES_KEY), raw)
    assert.match(store.error.value, /原设置已保留/)
    assert.equal(store.reset(), true)
    assert.ok([...storage.entries.entries()].some(([key, value]) => key.startsWith(`${LOADING_PREFERENCES_KEY}-backup-`) && value === raw))
    assert.deepEqual(store.preferences.value, { theme: 'impact', bootStyle:'cinematic', bootPalette:'system' })
  }
})
test('write or backup failure never reports saved or changes the visible selection', () => {
  const store = createLoadingPreferenceStore({ getItem: () => null, setItem: () => { throw new Error('quota') } })
  assert.equal(store.update({ theme: 'impact', bootStyle:'cinematic', bootPalette:'system' }), false)
  assert.equal(store.preferences.value.theme, 'impact')
  assert.match(store.error.value, /未能保存/)
  assert.equal(store.reset(), false)
  assert.match(store.error.value, /无法备份/)
})


test('boot choices persist independently and old work styles gain defaults without a read-time write',()=>{
  const storage=memoryStorage('{"theme":"standard"}'),store=createLoadingPreferenceStore(storage)
  assert.equal(storage.getItem(LOADING_PREFERENCES_KEY),'{"theme":"standard"}')
  assert.equal(store.update({bootStyle:'brief',bootPalette:'dark'}),true)
  assert.deepEqual(createLoadingPreferenceStore(storage).preferences.value,{theme:'standard',bootStyle:'brief',bootPalette:'dark'})
  assert.equal(store.update({bootStyle:'impact'}),true)
  assert.deepEqual(createLoadingPreferenceStore(storage).preferences.value,{theme:'standard',bootStyle:'impact',bootPalette:'dark'})
  assert.throws(()=>parseLoadingPreferences('{"theme":"impact","bootPalette":"bogus"}'))
  assert.throws(()=>parseLoadingPreferences('{"theme":"impact","bootStyle":"bogus"}'))
})
