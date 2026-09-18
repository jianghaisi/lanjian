import assert from 'node:assert/strict'
import test from 'node:test'
import { buildModelCatalog, classifyModelFamily, modelRouteKey } from '../../../src/renderer/features/models/services/model-catalog'

test('classifies common writing models into author-facing families', () => {
  assert.equal(classifyModelFamily('gpt-4.1').id, 'gpt')
  assert.equal(classifyModelFamily('o3-mini').id, 'gpt')
  assert.equal(classifyModelFamily('gemini-3.1-pro-preview').id, 'gemini')
  assert.equal(classifyModelFamily('doubao-seed-2-0-pro').id, 'doubao')
  assert.equal(classifyModelFamily('deepseek-v3.2').id, 'deepseek')
  assert.equal(classifyModelFamily('claude-sonnet-4-5').id, 'claude')
  assert.equal(classifyModelFamily('qwen3-max').id, 'qwen')
  assert.equal(classifyModelFamily('moonshot-v1-128k').id, 'kimi')
  assert.equal(classifyModelFamily('glm-4.5').id, 'glm')
  assert.equal(classifyModelFamily('local-writing-model').id, 'other')
})

test('keeps same-name models from different APIs as explicit independent routes', () => {
  const catalog = buildModelCatalog([
    { id: 'official', name: 'GPT 官方接口', baseUrl: 'https://api.openai.com/v1' },
    { id: 'relay', name: '写作中转接口', baseUrl: 'https://relay.example/v1' }
  ], {
    official: ['gpt-4.1-mini'],
    relay: ['gpt-4.1-mini']
  })
  assert.equal(catalog.length, 2)
  assert.deepEqual(catalog.map((choice) => choice.key).sort(), [
    modelRouteKey('official', 'gpt-4.1-mini'),
    modelRouteKey('relay', 'gpt-4.1-mini')
  ].sort())
  assert.ok(catalog.every((choice) => choice.duplicateModel))
  assert.deepEqual(catalog.map((choice) => choice.connectionName).sort(), ['GPT 官方接口', '写作中转接口'].sort())
})

test('retains manually assigned models when an API cannot list its catalog', () => {
  const catalog = buildModelCatalog(
    [{ id: 'gateway', name: '自建接口', baseUrl: 'https://gateway.example/v1' }],
    {},
    [{ connectionId: 'gateway', model: 'private-prose-model' }]
  )
  assert.equal(catalog.length, 1)
  assert.equal(catalog[0]?.model, 'private-prose-model')
  assert.equal(catalog[0]?.discovered, false)
  assert.equal(catalog[0]?.connectionHost, 'gateway.example')
})

test('unknown provider models remain selectable with distinct API identities', () => {
  const catalog = buildModelCatalog([
    { id: 'a', name: '接口甲' }, { id: 'b', name: '接口乙' }
  ], { a: ['private-writing-model', 'vendor/custom-2026'], b: ['private-writing-model'] })
  assert.equal(catalog.length, 3)
  assert.ok(catalog.every(choice => choice.family.id === 'other' && choice.discovered))
  assert.deepEqual(catalog.filter(choice => choice.model === 'private-writing-model').map(choice => choice.key).sort(),
    [modelRouteKey('a', 'private-writing-model'), modelRouteKey('b', 'private-writing-model')])
  assert.ok(catalog.filter(choice => choice.model === 'private-writing-model').every(choice => choice.duplicateModel))
})
