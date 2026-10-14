import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test, { type TestContext } from 'node:test'
import type { AiFunctionTool, AiToolMessage } from '../../../src/contracts/assistant/assistant-conversation-contracts'
import type { ModelProfile } from '../../../src/contracts/models/types'
import { AiClient } from '../../../src/main/modules/models/application/ai-client'

const tool: AiFunctionTool = { type: 'function', function: {
  name: 'diagnostic_echo', description: 'Synthetic echo with no side effects.',
  parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false }
} }
const frame = (delta: unknown, finish_reason?: string) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`
const callStart = frame({ tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'diagnostic_echo', arguments: '{"value":' } }] })
const callEnd = frame({ tool_calls: [{ index: 0, function: { arguments: '"雨夜"}' } }] }, 'tool_calls')
const done = 'data: [DONE]\n\n'
type RequestBody = {
  model: string; messages: AiToolMessage[]; tools: AiFunctionTool[]; stream: boolean
  reasoning_effort?: string; max_completion_tokens?: number; tool_choice?: string; parallel_tool_calls?: boolean
}

async function fixture(t: TestContext, responses: Array<{ body: string; status?: number }>, model = 'gpt-6.1-sol') {
  const bodies: RequestBody[] = [], paths: string[] = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    bodies.push(JSON.parse(body) as RequestBody); paths.push(req.url ?? '')
    const reply = responses[bodies.length - 1] ?? { status: 500, body: 'Unexpected retry' }
    res.statusCode = reply.status ?? 200
    res.setHeader('Content-Type', reply.status ? 'application/json' : 'text/event-stream')
    res.end(reply.body)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const profile: ModelProfile = { connectionId: 'gateway', model, parameterPolicy: {
    version: 2, ruleId: 'gpt-6.1-sol', mode: 'custom', overrides: { maxTokens: 2048, reasoning: { effort: 'high' } }
  } }
  const config = { kind: 'openai-compatible' as const, connectionId: 'gateway', connectionName: 'synthetic gateway',
    baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, apiKey: 'synthetic-key', profile }
  const client = new AiClient({ resolve: async () => config, resolveConnection: async () => config })
  return { client, config, bodies, paths }
}

for (const model of ['gpt-6.1-sol', 'retained-gateway-alias']) {
  test(`bound gateway ${model} completes a streamed tool roundtrip with its exact model and high effort`, async t => {
    const { client, config, bodies, paths } = await fixture(t, [
      { body: frame({ content: '正在检查。' }) + callStart + callEnd + done },
      { body: frame({ content: 'OK' }, 'stop') + done }
    ], model)
    const before = JSON.stringify(config.profile), prepared = await client.prepareToolConversation('prose')
    const messages: AiToolMessage[] = [{ role: 'user', content: 'Echo 雨夜, then reply OK.' }]
    const seen: string[] = [], signal = AbortSignal.timeout(5000)
    const first = await prepared.step(messages, [tool], signal, text => seen.push(text))
    assert.deepEqual(seen, ['正在检查。'])
    assert.deepEqual(first.toolCalls, [{ id: 'call-1', type: 'function', function: { name: 'diagnostic_echo', arguments: '{"value":"雨夜"}' } }])
    messages.push({ role: 'assistant', content: first.content, tool_calls: first.toolCalls },
      { role: 'tool', tool_call_id: 'call-1', content: '{"value":"雨夜"}' })
    const last = await prepared.step(messages, [tool], signal, () => {})
    assert.equal(last.content, 'OK'); assert.deepEqual(last.toolCalls, [])
    assert.equal(JSON.stringify(config.profile), before)
    assert.deepEqual(paths, ['/v1/chat/completions', '/v1/chat/completions'])
    for (const body of bodies) {
      assert.equal(body.model, model); assert.equal(body.reasoning_effort, 'high')
      assert.equal(body.max_completion_tokens, 2048); assert.equal(body.stream, true)
      assert.equal(body.parallel_tool_calls, false); assert.equal(body.tool_choice, 'auto'); assert.deepEqual(body.tools, [tool])
    }
    assert.deepEqual(bodies[1].messages[1].tool_calls, first.toolCalls)
    assert.equal(bodies[1].messages[2].tool_call_id, 'call-1')
    assert.equal(bodies[1].messages[2].content, '{"value":"雨夜"}')
  })
}

for (const [name, tail] of [
  ['missing terminal', callStart + done],
  ['invalid tool arguments', callStart + frame({}, 'tool_calls') + done],
  ['provider stream error', 'data: {"error":{"message":"private-provider-detail synthetic-key"}}\n\n'],
  ['output limit', callStart + frame({}, 'length') + done]
]) {
  test(`bound gateway rejects ${name}, keeps text, and never returns a partial tool or retries`, async t => {
    const { client, bodies } = await fixture(t, [{ body: frame({ content: '已显示片段' }) + tail }])
    const prepared = await client.prepareToolConversation('prose'), seen: string[] = []
    let returned = false
    await assert.rejects(async () => {
      await prepared.step([{ role: 'user', content: 'diagnose' }], [tool], AbortSignal.timeout(5000), text => seen.push(text))
      returned = true
    }, (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /未完整|不完整/)
      assert.doesNotMatch(error.message, /private-provider-detail|synthetic-key|请修改要求后重试/)
      return true
    })
    assert.equal(returned, false); assert.equal(bodies.length, 1); assert.deepEqual(seen, ['已显示片段'])
  })
}

test('a gateway rejection does not strip reasoning, change protocol or retry', async t => {
  const { client, bodies, paths } = await fixture(t, [{ status: 400, body: '{"error":{"message":"private-provider-detail"}}' }])
  const prepared = await client.prepareToolConversation('prose')
  await assert.rejects(prepared.step([{ role: 'user', content: 'diagnose' }], [tool], AbortSignal.timeout(5000), () => {}), /请求被服务拒绝/)
  assert.equal(bodies.length, 1); assert.equal(bodies[0].reasoning_effort, 'high')
  assert.deepEqual(paths, ['/v1/chat/completions'])
})

test('known official Chat restrictions still reject before any provider request', async () => {
  let requests = 0
  const config = { kind: 'openai-compatible' as const, connectionId: 'official', connectionName: 'official',
    baseUrl: 'https://api.openai.com/v1', apiKey: 'synthetic-key',
    profile: { connectionId: 'official', model: 'gpt-6.1-sol', parameterPolicy: { version: 2 as const, mode: 'auto' as const, ruleId: 'gpt-5.6-sol' } } }
  const client = new AiClient({ resolve: async () => config, resolveConnection: async () => config }, undefined, undefined,
    async () => { requests++; throw Error('Must not dispatch') })
  await assert.rejects(client.prepareToolConversation('prose'), /官方接口.*OpenAI Responses/)
  assert.equal(requests, 0)
})
