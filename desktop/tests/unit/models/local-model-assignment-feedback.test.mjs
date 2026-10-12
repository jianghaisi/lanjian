import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { shallowRef } from 'vue'
import { createModelsConnectionsActions } from '../../../src/renderer/features/models/composables/create-connections-actions.js'

const ready = { id: 'fixture-qwen', state: 'ready', recommendedOutputTokens: 2048 }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function settings(model = 'remote-original') {
  const profile = { connectionId: 'remote', model, temperature: .6, topP: .9, maxTokens: 4096 }
  return { version: 3, modelConfigured: false, apiKeyConfigured: true, routingMode: 'shared',
    connections: [{ id: 'remote', name: 'Fixture', baseUrl: 'https://fixture.invalid', apiKeyConfigured: true }],
    shared: profile, tasks: Object.fromEntries(['outline', 'chapterOutline', 'prose', 'review'].map(key => [key, { ...profile }])) }
}
function fixture() {
  const notices = [], updates = []
  const counts = { lists: 0 }
  const ports = {
    ai: shallowRef(settings()), current: shallowRef({ id: 'book-a' }), localModelViews: shallowRef([ready]),
    removedAiConnectionIds: shallowRef(['draft-removal']), plainDto: value => structuredClone(value),
    notice: message => notices.push(message),
    guard: async (action, success) => { const result = await action(); if (success) notices.push(success); return result },
    desktop: {
      ai: { getSettings: async () => ({ ...settings(), modelConfigured: true }), updateSettings: async patch => { updates.push(patch); return { ...settings(), ...patch, modelConfigured: true } } },
      localModels: { list: async () => { counts.lists++; return [ready] } }
    }
  }
  return { ports, actions: createModelsConnectionsActions(ports), notices, updates, counts }
}

test('pending or failed selection never advertises an unsaved assignment; an explicit retry works', async () => {
  const f = fixture(), pending = deferred(), original = f.ports.ai.value, before = structuredClone(original)
  f.ports.desktop.ai.updateSettings = async patch => { f.updates.push(patch); return pending.promise }
  const saving = f.actions.useLocalModel(ready, 'prose')
  const rejected = assert.rejects(saving, /fixture save failed/)
  await setImmediate()
  const during = structuredClone(f.ports.ai.value)
  pending.reject(Error('fixture save failed')); await rejected
  assert.deepEqual(during, before); assert.equal(f.ports.ai.value, original); assert.deepEqual(original, before)
  assert.deepEqual(f.ports.removedAiConnectionIds.value, ['draft-removal']); assert.equal(f.counts.lists, 0); assert.deepEqual(f.notices, [])
  f.ports.desktop.ai.updateSettings = async patch => ({ ...settings(), ...patch, modelConfigured: true })
  await f.actions.useLocalModel(ready, 'prose')
  assert.equal(f.ports.ai.value.tasks.prose.model, ready.id)
  assert.equal(f.ports.ai.value.tasks.review.model, before.shared.model)
})

test('successful selection publishes only the confirmed settings and suppresses duplicate saves', async () => {
  const f = fixture(), pending = deferred(), original = f.ports.ai.value
  f.ports.desktop.ai.updateSettings = async patch => { f.updates.push(patch); return pending.promise }
  const first = f.actions.useLocalModel(ready, 'prose')
  const duplicate = f.actions.useLocalModel({ ...ready, id: 'fixture-glm' }, 'review')
  await setImmediate(); const requests = f.updates.length
  const confirmed = { ...settings(), ...f.updates[0], modelConfigured: true }
  confirmed.tasks.prose = { ...confirmed.tasks.prose, maxTokens: 1024 }
  pending.resolve(confirmed); await Promise.all([first, duplicate])
  assert.equal(requests, 1); assert.notEqual(f.ports.ai.value, original)
  assert.equal(f.ports.ai.value.tasks.prose.maxTokens, 1024)
  assert.equal(f.ports.ai.value.tasks.review.model, 'remote-original')
  assert.deepEqual(Object.keys(f.updates[0]).sort(), ['routingMode', 'shared', 'tasks'])
  assert.deepEqual(f.ports.removedAiConnectionIds.value, [])
  assert.equal(f.notices.filter(message => message === '当前书稿的模型方案已保存').length, 1)
  assert.equal(f.ports.ai.value.connections[0].apiKey, '')
})

for (const change of ['book', 'same-book-settings']) {
  test(`late save after ${change} changes cannot replace the current projection or claim current-book success`, async () => {
    const f = fixture(), pending = deferred()
    f.ports.desktop.ai.updateSettings = async patch => { f.updates.push(patch); return pending.promise }
    const saving = f.actions.useLocalModel(ready, 'prose')
    const replacement = settings('new-book-or-reloaded-model')
    if (change === 'book') f.ports.current.value = { id: 'book-b' }
    f.ports.ai.value = replacement; f.ports.localModelViews.value = []
    pending.resolve({ ...settings(), ...f.updates[0], modelConfigured: true }); await saving
    assert.equal(f.ports.ai.value, replacement); assert.deepEqual(f.ports.localModelViews.value, [])
    assert.deepEqual(f.notices, []); assert.deepEqual(f.ports.removedAiConnectionIds.value, ['draft-removal'])
    assert.equal(f.counts.lists, 0)
  })
}

test('a failed follow-up catalog read preserves the committed assignment and reports refresh separately', async () => {
  const f = fixture()
  f.ports.desktop.localModels.list = async () => { throw Error('private raw read error') }
  await f.actions.useLocalModel(ready, 'review')
  assert.equal(f.ports.ai.value.tasks.review.model, ready.id)
  assert.deepEqual(f.ports.localModelViews.value, [])
  assert.match(f.notices.at(-1), /已保存.*无法刷新/)
  assert.ok(!f.notices.at(-1).includes('private raw'))
})

test('a catalog response after selection cannot overwrite another book or a newer refresh', async () => {
  const f = fixture(), oldRead = deferred()
  f.ports.desktop.localModels.list = () => oldRead.promise
  const saving = f.actions.useLocalModel(ready, 'prose'); await setImmediate()
  f.ports.current.value = { id: 'book-b' }; f.ports.ai.value = settings('book-b')
  f.ports.desktop.localModels.list = async () => [{ ...ready, id: 'newer-catalog' }]
  await f.actions.refreshLocalModels()
  oldRead.resolve([{ ...ready, id: 'old-catalog' }]); await saving
  assert.equal(f.ports.ai.value.shared.model, 'book-b')
  assert.equal(f.ports.localModelViews.value[0].id, 'newer-catalog')
})

test('a newer refresh wins and configuration changes only after both reads succeed', async () => {
  const f = fixture(), oldSettings = deferred(), oldModels = deferred()
  f.ports.desktop.ai.getSettings = () => oldSettings.promise; f.ports.desktop.localModels.list = () => oldModels.promise
  const older = f.actions.refreshLocalModels()
  oldSettings.resolve({ ...settings(), modelConfigured: true }); await setImmediate()
  const interimConfigured = f.ports.ai.value.modelConfigured
  f.ports.desktop.ai.getSettings = async () => ({ ...settings(), modelConfigured: false })
  f.ports.desktop.localModels.list = async () => [{ ...ready, id: 'current-catalog' }]
  await f.actions.refreshLocalModels()
  oldModels.resolve([{ ...ready, id: 'stale-catalog' }]); await older
  assert.equal(interimConfigured, false)
  assert.equal(f.ports.ai.value.modelConfigured, false)
  assert.equal(f.ports.localModelViews.value[0].id, 'current-catalog')
})

test('refresh failure clears stale model choices without publishing partial settings or raw errors', async () => {
  const f = fixture()
  f.ports.desktop.localModels.list = async () => { throw Error('private raw path') }
  await f.actions.refreshLocalModels()
  assert.equal(f.ports.ai.value.modelConfigured, false)
  assert.deepEqual(f.ports.localModelViews.value, [])
  assert.match(f.notices.at(-1), /模型状态.*无法刷新/)
  assert.ok(!f.notices.at(-1).includes('private raw'))
})

test('starting a save invalidates a pending refresh even when that save fails', async () => {
  const f = fixture(), oldRead = deferred()
  f.ports.desktop.localModels.list = () => oldRead.promise
  const refresh = f.actions.refreshLocalModels(); await setImmediate()
  f.ports.desktop.ai.updateSettings = async () => { throw Error('save failed') }
  await assert.rejects(f.actions.useLocalModel(ready, 'prose'), /save failed/)
  oldRead.resolve([{ ...ready, id: 'old-catalog' }]); await refresh
  assert.equal(f.ports.ai.value.modelConfigured, false)
  assert.equal(f.ports.ai.value.shared.model, 'remote-original')
  assert.equal(f.ports.localModelViews.value[0].id, ready.id)
})

test('ordinary save keeps its no-argument behavior and publishes confirmed settings', async () => {
  const f = fixture()
  f.ports.ai.value.shared.model = 'draft-model'
  await f.actions.saveAi({ type: 'click', mustNotBecomePayload: true })
  assert.equal(f.updates.length, 1); assert.equal(f.updates[0].shared.model, 'draft-model')
  assert.equal(f.updates[0].mustNotBecomePayload, undefined)
  assert.equal(f.ports.ai.value.shared.model, 'draft-model')
  assert.deepEqual(f.ports.removedAiConnectionIds.value, [])
  assert.deepEqual(f.notices, ['当前书稿的模型方案已保存'])
})
