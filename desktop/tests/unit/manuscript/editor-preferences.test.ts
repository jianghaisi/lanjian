import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultEditorPreferences, normalizeEditorPreferences, readEditorPreferences, writeEditorPreferences } from '../../../src/renderer/features/manuscript/composables/editor-preferences'

class MemoryStorage {
  values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

test('editor preferences use one complete default paper profile', () => {
  assert.deepEqual(readEditorPreferences(new MemoryStorage()), defaultEditorPreferences)
})

test('editor preferences reject invalid values and clamp safe visual ranges', () => {
  assert.deepEqual(normalizeEditorPreferences({
    fontScale: 9,
    leading: 0,
    pageWidth: 120,
    fontFamily: 'unknown' as never,
    guideStyle: 'dashed'
  }), {
    fontScale: 1.25,
    leading: 1.6,
    pageWidth: 620,
    fontFamily: 'serif',
    guideStyle: 'dashed'
  })
})

test('the same persisted profile round-trips for settings, manuscript and outline consumers', () => {
  const storage = new MemoryStorage()
  const saved = writeEditorPreferences({ fontScale: 1.1, leading: 2.3, pageWidth: 940, fontFamily: 'kai', guideStyle: 'off' }, storage)
  assert.deepEqual(readEditorPreferences(storage), saved)
})

test('legacy guide visibility migrates to the solid or off style', () => {
  const visible = new MemoryStorage()
  visible.setItem('lanjian-editor-guide-lines', 'true')
  assert.equal(readEditorPreferences(visible).guideStyle, 'solid')
  const hidden = new MemoryStorage()
  hidden.setItem('lanjian-editor-guide-lines', 'false')
  assert.equal(readEditorPreferences(hidden).guideStyle, 'off')
})
