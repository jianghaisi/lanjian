import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { createAppState } from '../../../src/renderer/app/composables/create-workspace-state.js'

test('one-off API selection exposes active shared sources once and preserves saved legacy routing', () => {
  const attached = { id: 'book-gemini', scope: 'global', globalConnectionId: 'global-gemini', enabled: true, name: 'zzshu · Gemini' }
  const privateRoute = { id: 'primary', scope: 'legacy-private', name: '旧私有接口' }
  const local = { kind: 'local', id: 'local:llama-cpp', name: '本地推理' }
  const ai = ref({ connections: [attached, privateRoute, local, { id: 'old', scope: 'global', globalConnectionId: 'global-old', enabled: false }], shared: { connectionId: 'primary', model: 'original-model' } })
  const oneOffGlobalConnections = ref(['gemini', 'gpt', 'claude', 'old'].map(id => ({ id: `global-${id}`, name: `zzshu · ${id === 'gemini' ? 'Gemini' : id === 'gpt' ? 'GPT' : 'Claude'}`, enabled: id !== 'old', credentialState: 'stored' })))
  const before = JSON.stringify(ai.value)
  const state = createAppState({ ai, oneOffGlobalConnections })
  assert.deepEqual(state.oneOffConnections.value.map(c => c.id), ['book-gemini', 'local:llama-cpp', 'global:global-gpt', 'global:global-claude'])
  assert.equal(JSON.stringify(ai.value), before)
  oneOffGlobalConnections.value[1].enabled = false
  assert.equal(state.oneOffConnections.value.some(c => c.id === 'global:global-gpt'), false)
  ai.value.connections[0].enabled = false
  assert.equal(state.oneOffConnections.value.some(c => c.id === 'book-gemini'), false)
  assert.equal(ai.value.shared.connectionId, 'primary')
})
