import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeTheme, resolveTheme } from '../../../src/renderer/app/composables/theme-preferences'
import { groupForLocation } from '../../../src/renderer/features/library/services/workspace-navigation'
import { categoryForSettingsSection, firstSettingsSection, searchSettingsSections, settingsCategories } from '../../../src/renderer/app/services/settings-navigation'

test('system appearance follows system changes while explicit choices remain fixed', () => {
  assert.equal(resolveTheme('system', false), 'qingzhou')
  assert.equal(resolveTheme('system', true), 'moye')
  for (const theme of ['qingzhou', 'xuanzhi', 'moye'] as const) {
    assert.equal(resolveTheme(theme, true), theme)
    assert.equal(resolveTheme(theme, false), theme)
  }
  assert.equal(normalizeTheme('broken'), 'qingzhou')
  assert.equal(normalizeTheme(null), 'qingzhou')
})

test('existing feature destinations resolve through the canonical V3 hierarchy', () => {
  assert.equal(groupForLocation({ active: 'profile' }).id, 'definition')
  assert.equal(groupForLocation({ active: 'research', materialSection: 'notes' }).id, 'materials')
  for (const page of ['world', 'realms', 'system']) assert.equal(groupForLocation({ active: page }).id, 'foundation')
  assert.equal(groupForLocation({ active: 'preparation', preparationMode: 'automatic' }).id, 'planning')
  assert.equal(groupForLocation({ active: 'timeline', timelineMode: 'events' }).id, 'chronicle')
  assert.equal(groupForLocation({ active: 'outline', outlineMode: 'chapter' }).id, 'planning')
  assert.equal(groupForLocation({ active: 'settings', settingsSection: 'story' }).id, 'foundation')
  assert.equal(groupForLocation({ active: 'settings', settingsSection: 'connection' }).id, 'settings')
  assert.equal(groupForLocation({ active: 'review' }).id, 'manuscript')
})

test('settings navigation groups author tasks without losing deep destinations', () => {
  assert.deepEqual(settingsCategories.map((item) => item.label), ['常用', 'AI 与模型', '写作', '数据与备份', '高级'])
  assert.equal(categoryForSettingsSection('routing').id, 'ai')
  assert.equal(categoryForSettingsSection('project').id, 'data')
  assert.equal(categoryForSettingsSection('about').id, 'advanced')
  assert.equal(firstSettingsSection('writing'), 'writing')
  assert.equal(firstSettingsSection('unknown'), 'appearance')
})

test('settings search finds human terms across categories without exposing story content as an app setting', () => {
  assert.deepEqual(searchSettingsSections('', 'ai').map((item) => item.id), ['connection', 'routing', 'local-models', 'context'])
  assert.deepEqual(searchSettingsSections('主题').map((item) => item.id), ['appearance'])
  assert.deepEqual(searchSettingsSections('字体').map((item) => item.id), [])
  assert.deepEqual(searchSettingsSections('加载动画').map((item) => item.id), [])
  assert.deepEqual(searchSettingsSections('备份').map((item) => item.id), ['project'])
  assert.deepEqual(searchSettingsSections('GPT').map((item) => item.id), ['routing'])
  assert.equal(searchSettingsSections('人物').some((item) => item.id === 'story'), false)
})
