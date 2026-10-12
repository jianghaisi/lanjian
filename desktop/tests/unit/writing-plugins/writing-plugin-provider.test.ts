import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { AiClient } from '../../../src/main/modules/models/application/ai-client'
import { WritingPluginRegistry } from '../../../src/main/modules/writing-plugins/application/registry'
import { WritingPluginDispatcher } from '../../../src/main/modules/writing-plugins/application/dispatcher'
import { objectSchema } from '@lanjian/writing-plugin-contracts'

test('local provider receives the same registered schema and retains the chosen model and budget', async () => {
  const registry = new WritingPluginRegistry()
  registry.register({ pluginId: 'builtin.test', id: 'inspect', version: '1.0.0', description: '查询', effect: 'read', capabilities: [], inputSchema: objectSchema({}), outputSchema: objectSchema({}), isAvailable: () => true, execute: async () => ({ kind: 'completed', value: {}, evidence: [] }) }, 'builtin')
  const dispatcher = new WritingPluginDispatcher(registry, { workItemId: 'a', allowedCapabilities: new Set(), signal: new AbortController().signal, assertScope: async () => {} })
  const definitions = dispatcher.definitions()
  const config = { kind: 'local' as const, connectionId: 'local:llama-cpp', connectionName: '隔离本地模型', profile: { connectionId: 'local:llama-cpp', model: 'local-a', temperature: .6, topP: 1, maxTokens: 1000 } }
  const client = new AiClient({ resolve: async () => config, resolveConnection: async () => config }, {
    async listModels() { return ['local-a'] }, async ready() { return true }, limits() { return { contextTokens: 8192, systemReserveTokens: 1000, maxOutputTokens: 4096, recommendedOutputTokens: 1000 } },
    async complete() { assert.fail('Must retain the function protocol') },
    async toolStep(model, profile, messages, tools) {
      assert.equal(model, 'local-a'); assert.equal(profile.maxTokens, 2000); assert.deepEqual(tools, definitions); assert.equal(messages[0].content, '查资料')
      return { content: '', toolCalls: [{ id: 'call-1', type: 'function', function: { name: definitions[0].function.name, arguments: '{}' } }] }
    }
  })
  const prepared = await client.prepareToolConversation('outline', undefined, undefined, 2000)
  config.profile.model = 'changed-after-prepare'
  const reply = await prepared.step([{ role: 'user', content: '查资料' }], definitions, new AbortController().signal)
  assert.equal((await dispatcher.execute(reply.toolCalls[0].function.name, reply.toolCalls[0].function.arguments)).kind, 'completed')
})

test('Gemini native retains registered plugin schemas and the frozen native route without fallback', async t => {
  const registry = new WritingPluginRegistry()
  registry.register({ pluginId: 'builtin.test', id: 'inspect', version: '1.0.0', description: '查询', effect: 'read', capabilities: [], inputSchema: objectSchema({}), outputSchema: objectSchema({}), isAvailable: () => true, execute: async () => ({ kind: 'completed', value: {}, evidence: [] }) }, 'builtin')
  const dispatcher = new WritingPluginDispatcher(registry, { workItemId: 'a', allowedCapabilities: new Set(), signal: new AbortController().signal, assertScope: async () => {} })
  const definitions = dispatcher.definitions()
  const requests: Array<{ url: string; body: { tools: Array<{ functionDeclarations: Array<{ name: string; parametersJsonSchema: unknown }> }>; contents: unknown[] }; key: string | string[] | undefined }> = []
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk
    requests.push({ url: request.url!, body: JSON.parse(raw), key: request.headers['x-goog-api-key'] })
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: 'native-call', name: definitions[0]!.function.name, args: {} }, thoughtSignature: 'fixture-signature' }] }, finishReason: 'STOP' }] }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())) })
  const config = { kind: 'gemini-native' as const, connectionId: 'gemini', connectionName: '原生接口', baseUrl: 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/v1', apiKey: 'synthetic', profile: { connectionId: 'gemini', model: 'native-model', temperature: .6, topP: 1, maxTokens: 1000 } }
  const client = new AiClient({ resolve: async () => config, resolveConnection: async () => config })
  const prepared = await client.prepareToolConversation('outline')
  config.baseUrl = 'https://must-not-request.invalid'; config.profile.model = 'changed-after-prepare'
  const reply = await prepared.step([{ role: 'user', content: '查资料' }], definitions, new AbortController().signal)
  assert.equal(requests.length, 1)
  assert.equal(requests[0]!.url, '/v1/models/native-model:generateContent')
  assert.equal(requests[0]!.key, 'synthetic')
  assert.deepEqual(requests[0]!.body.tools[0]!.functionDeclarations.map(d => [d.name, d.parametersJsonSchema]), definitions.map(d => [d.function.name, d.function.parameters]))
  assert.deepEqual(requests[0]!.body.contents, [{ role: 'user', parts: [{ text: '查资料' }] }])
  assert.equal(reply.geminiParts?.[0]?.thoughtSignature, 'fixture-signature')
  assert.equal((await dispatcher.execute(reply.toolCalls[0]!.function.name, reply.toolCalls[0]!.function.arguments)).kind, 'completed')
})
