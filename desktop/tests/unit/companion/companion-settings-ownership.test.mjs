import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { createAppNavigationActions } from '../../../src/renderer/app/composables/create-navigation-actions.js'
import { searchSettingsSections } from '../../../src/renderer/app/services/settings-navigation.ts'

test('pet and shared voice search terms resolve to writing companion settings', () => {
  for (const term of ['桌宠', '置顶', '穿透', '养成', '麦克风', '音色']) {
    assert.ok(searchSettingsSections(term).some(section => section.id === 'companion'), term)
  }
})

test('library companion shortcut focuses retained sound settings instead of removed pet controls', async () => {
  const calls = []
  const controls = {
    scrollIntoView() { calls.push('scroll') },
    querySelector(selector) { calls.push(selector); return { focus() { calls.push('focus') } } },
  }
  const dialog = {
    showModal() { calls.push('open') },
    querySelector(selector) {
      calls.push(selector)
      if (selector === '[data-testid="library-settings-sound"]') return { click() { calls.push('sound-tab') } }
      assert.equal(selector, '[data-testid="companion-voice-settings"]')
      assert.ok(calls.includes('sound-tab'), 'the sound page must be visible before focusing its controls')
      return controls
    },
  }
  const actions = createAppNavigationActions({ current: ref(null), localAppearanceDialog: ref(dialog) })
  await actions.openCompanionSettings()
  assert.deepEqual(calls, ['open', '[data-testid="library-settings-sound"]', 'sound-tab', '[data-testid="companion-voice-settings"]', 'scroll', 'input, select, button', 'focus'])
})
