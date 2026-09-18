import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultDialogueAppearance, normalizeDialogueAppearance } from '../../../src/renderer/features/companion/services/companion-dialogue-appearance'
test('dialogue settings are bounded, independently persistent presentation data', () => {
  assert.deepEqual(normalizeDialogueAppearance(null), defaultDialogueAppearance)
  assert.deepEqual(normalizeDialogueAppearance({ opacity: NaN, fontSize: 100, width: -1, maxHeight: Infinity, placement: 'cover-face' }), { ...defaultDialogueAppearance, fontSize: 24, width: 220 })
  assert.deepEqual(normalizeDialogueAppearance({ opacity: .45, fontSize: 18, width: 410, maxHeight: 300, placement: 'right' }), { opacity: .45, fontSize: 18, width: 410, maxHeight: 300, placement: 'right' })
})
