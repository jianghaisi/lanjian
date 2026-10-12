import test from 'node:test'
import assert from 'node:assert/strict'
import { AiClient } from '../../../src/main/modules/models/application/ai-client'
import { decodeProviderToolContent, validatedProviderMessage } from '../../../src/contracts/models/provider-tool-content'
import type { AiToolMessage, AiFunctionTool } from '../../../src/contracts/assistant/assistant-conversation-contracts'
import type { RemoteModelProtocol } from '../../../src/contracts/models/model-connections'
import type { ParameterPolicy } from '../../../src/contracts/models/parameter-policy'

const tools: AiFunctionTool[] = [{ type: 'function', function: { name: 'read_outline', description: '读合成章纲', parameters: { type: 'object', properties: {} } } }]
const messages: AiToolMessage[] = [{ role: 'system', content: '只读合成资料' }, { role: 'user', content: '构思下一幕' }]
function harness(protocol: RemoteModelProtocol, responses: unknown[], options: { stream?: boolean; status?: number; guard?: { recheck(): Promise<void>; assertActive(): void } } = {}) {
  const sent: Array<{ url: string; init: RequestInit; body: any }> = []
  const rule = protocol === 'anthropic-native' ? 'claude-opus-5-5' : protocol === 'openai-responses' ? 'gpt-6.1-sol' : 'kimi-k3'
  const profile = { connectionId: 'synthetic', model: 'retained-alias', parameterPolicy: { version: 2, ruleId: rule, mode: 'custom', overrides: { reasoning: { effort: 'high' } } } as ParameterPolicy }
  const c = { kind: protocol, connectionId: 'synthetic', connectionName: 'Synthetic only', baseUrl: 'https://fixture.invalid/v1', apiKey: 'synthetic-key', profile, requestGuard: options.guard }
  const transport: typeof fetch = async (url, init) => {
    sent.push({ url: String(url), init: init!, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const payload = responses.shift()
    if (options.stream) {
      const bytes = new TextEncoder().encode(String(payload))
      return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close() } }), { headers: { 'content-type': 'text/event-stream' } })
    }
    return new Response(JSON.stringify(payload), { status: options.status ?? 200, headers: { 'content-type': 'application/json' } })
  }
  return { ai: new AiClient({ resolve: async () => c, resolveConnection: async () => c }, undefined, undefined, transport), sent, c }
}
const anthropic = (content: unknown[] = [{ type: 'text', text: '合成正文' }], stop_reason = 'end_turn') => ({ type: 'message', model: 'response-model', role: 'assistant', content, stop_reason, usage: { input_tokens: 10, output_tokens: 21 } })
const response = (output: unknown[] = [{ type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text: '合成正文', annotations: [] }] }], status = 'completed') => ({ status, model: 'response-model', output, usage: { input_tokens: 12, output_tokens: 30, output_tokens_details: { reasoning_tokens: 18 } } })
const sse = (events: unknown[]) => events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('')

test('v2 Chat cannot accept JSON without a terminal reason or execute mismatched tool endings', async () => {
  const missing = harness('openai-compatible', [{ choices: [{ message: { content: 'partial' } }] }])
  await assert.rejects(missing.ai.complete('合成'), /结束状态|中断/)
  const wrong = harness('openai-compatible', [{ choices: [{ finish_reason: 'stop', message: { content: '', tool_calls: [{ id: 'x', type: 'function', function: { name: 'read_outline', arguments: '{}' } }], reasoning_content: 'private' } }] }])
  await assert.rejects((await wrong.ai.prepareToolConversation('outline')).step(messages, tools, new AbortController().signal), /结束状态|中断/)
  assert.equal(missing.sent.length, 1); assert.equal(wrong.sent.length, 1)
})

for (const protocol of ['anthropic-native', 'openai-responses'] as const) {
  test(`${protocol}: prepared, frozen and streaming requests use exact parameters; no cross-protocol fields`, async () => {
    const payload = protocol === 'anthropic-native' ? anthropic() : response()
    const h = harness(protocol, [payload, payload])
    const frozen = await h.ai.captureRun(['prose']), result = await frozen.complete('合成测试')
    assert.equal(result.content, '合成正文'); assert.equal(result.diagnostics?.responseModel, 'response-model')
    assert.equal(result.diagnostics?.inputTokens, protocol === 'anthropic-native' ? 10 : 12)
    assert.equal(result.diagnostics?.reasoningTokens, protocol === 'anthropic-native' ? undefined : 18)
    const body = h.sent[0].body
    assert.equal(body.temperature, undefined); assert.equal(body.top_p, undefined); assert.equal(body.reasoning_effort, undefined)
    if (protocol === 'anthropic-native') { assert.deepEqual(body.output_config, { effort: 'high' }); assert.equal(body.max_tokens, 32768); assert.equal((h.sent[0].init.headers as any)['x-api-key'], 'synthetic-key'); assert.equal(body.max_output_tokens, undefined) }
    else { assert.deepEqual(body.reasoning, { effort: 'high' }); assert.equal(body.store, false); assert.equal(body.max_output_tokens, 32768); assert.equal(body.messages, undefined) }
    h.c.profile.parameterPolicy = { version: 2, mode: 'custom', overrides: { maxTokens: 512 } }
    await frozen.complete('仍使用冻结快照')
    assert.deepEqual(h.sent[1].body, { ...body, ...(protocol === 'anthropic-native' ? { messages: [{ role: 'user', content: '仍使用冻结快照' }] } : { input: [{ role: 'user', content: '仍使用冻结快照' }] }) })
  })
  test(`${protocol}: rejects truncation, refusal, missing final state and parameter rejection without retry`, async () => {
    for (const reason of ['max_tokens', 'refusal', 'model_context_window_exceeded']) {
      const payload = protocol === 'anthropic-native' ? anthropic(undefined, reason) : { ...response(undefined, 'incomplete'), incomplete_details: { reason } }
      const h = harness(protocol, [payload]); await assert.rejects(h.ai.complete('test'), /预算|拒绝|上下文/); assert.equal(h.sent.length, 1)
    }
    const incomplete = harness(protocol, [sse(protocol === 'anthropic-native' ? [{ type: 'message_start', message: anthropic([]) }] : [{ type: 'response.output_text.delta', delta: '片段' }])], { stream: true })
    const deltas: string[] = []
    await assert.rejects(incomplete.ai.streamComplete('test', '', '', 'prose', undefined, undefined, (_, text) => { deltas.push(text) }), /中断|完整/)
    if (protocol === 'openai-responses') assert.deepEqual(deltas, ['片段'])
    const rejected = harness(protocol, [{ error: { message: 'synthetic-key must not appear' } }], { status: 400 })
    await assert.rejects(rejected.ai.complete('test'), e => e instanceof Error && /拒绝/.test(e.message) && !e.message.includes('synthetic-key')); assert.equal(rejected.sent.length, 1)
  })
  test(`${protocol}: guards and pre-abort prevent dispatch, catalog uses the selected protocol`, async () => {
    const controller = new AbortController(); controller.abort()
    const h = harness(protocol, [])
    await assert.rejects(h.ai.complete('test', '', '', 'prose', controller.signal)); assert.equal(h.sent.length, 0)
    const blocked = harness(protocol, [], { guard: { async recheck() { throw Error('revision changed') }, assertActive() {} } })
    await assert.rejects(blocked.ai.complete('test'), /revision changed/); assert.equal(blocked.sent.length, 0)
    const catalog = harness(protocol, [{ data: [{ id: 'retained-alias', display_name: '测试' }], has_more: false }])
    assert.deepEqual((await catalog.ai.listModels({ connectionId: 'synthetic' })).models, ['retained-alias']); assert.match(catalog.sent[0].url, /\/v1\/models$/)
  })
}
test('Anthropic split SSE preserves signed/redacted thinking and complete tool blocks across durable replay', async () => {
  const events = [
    { type: 'message_start', message: anthropic([]) },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '不可混入正文' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'opaque-signature' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'redacted_thinking', data: 'opaque-redacted' } }, { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'call_1', name: 'read_outline', input: {} } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{}' } }, { type: 'content_block_stop', index: 2 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 26 } }, { type: 'message_stop' }
  ]
  const h = harness('anthropic-native', [sse(events), sse(events)], { stream: true })
  const stepper = await h.ai.prepareToolConversation('prose'), step = await stepper.step(messages, tools, new AbortController().signal, () => {})
  assert.equal(step.content, ''); assert.equal(step.toolCalls.length, 1)
  const replay: AiToolMessage = JSON.parse(JSON.stringify({ role: 'assistant', content: step.content, tool_calls: step.toolCalls, providerContent: step.providerContent }))
  assert.deepEqual(validatedProviderMessage(replay), step.providerContent)
  await stepper.step([...messages, replay, { role: 'tool', content: '{}', tool_call_id: 'call_1' }], tools, new AbortController().signal, () => {})
  assert.equal(h.sent[1].body.messages[1].content[0].signature, 'opaque-signature')
  assert.equal(h.sent[1].body.messages[2].content[0].type, 'tool_result')
  const changed = harness('anthropic-native', []); changed.c.profile.parameterPolicy = { version: 2, ruleId: 'claude-opus-5-5', mode: 'auto' }
  const different = await changed.ai.prepareToolConversation('prose')
  await assert.rejects(different.step([...messages, replay, { role: 'tool', content: '{}', tool_call_id: 'call_1' }], tools, new AbortController().signal), /变化/)
  assert.equal(changed.sent.length, 0)
})
test('Responses encrypted reasoning and function call outputs survive restart; partial tool arguments never execute', async () => {
  const output = [{ type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque' }, { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_outline', arguments: '{}' }]
  const h = harness('openai-responses', [response(output), response()]), stepper = await h.ai.prepareToolConversation('prose')
  const step = await stepper.step(messages, tools, new AbortController().signal)
  const replay: AiToolMessage = { role: 'assistant', content: '', tool_calls: step.toolCalls, providerContent: decodeProviderToolContent(JSON.parse(JSON.stringify(step.providerContent))) }
  await stepper.step([...messages, replay, { role: 'tool', content: '{}', tool_call_id: 'call_1' }], tools, new AbortController().signal)
  assert.equal(h.sent[1].body.input[1].encrypted_content, 'opaque'); assert.deepEqual(h.sent[1].body.input.at(-1), { type: 'function_call_output', call_id: 'call_1', output: '{}' })
  const bad = harness('openai-responses', [response([{ ...output[1], arguments: '{' }])]); await assert.rejects((await bad.ai.prepareToolConversation('prose')).step(messages, tools, new AbortController().signal))
  assert.throws(() => validatedProviderMessage({ ...replay, content: 'tampered' }))
})
test('Responses split SSE returns only visible text and truthful usage from final completed response', async () => {
  const h = harness('openai-responses', [sse([{ type: 'response.output_text.delta', delta: '合成' }, { type: 'response.output_text.delta', delta: '正文' }, { type: 'response.completed', response: response() }])], { stream: true })
  const seen: string[] = [], result = await h.ai.streamComplete('test', '', '', 'prose', undefined, undefined, (_, text) => { seen.push(text) })
  assert.deepEqual(seen, ['合成', '合成正文']); assert.equal(result.diagnostics?.reasoningTokens, 18)
})
test('Kimi Chat preserves reasoning_content separately and strips internal replay metadata from wire', async () => {
  const payload = { model: 'kimi-k3', choices: [{ finish_reason: 'tool_calls', message: { content: '', reasoning_content: 'opaque-reasoning', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_outline', arguments: '{}' } }] } }] }
  const h = harness('openai-compatible', [payload, payload]), stepper = await h.ai.prepareToolConversation('prose')
  const step = await stepper.step(messages, tools, new AbortController().signal)
  await stepper.step([...messages, { role: 'assistant', content: '', tool_calls: step.toolCalls, providerContent: step.providerContent }, { role: 'tool', tool_call_id: 'call_1', content: '{}' }], tools, new AbortController().signal)
  assert.equal(h.sent[1].body.messages[2].reasoning_content, 'opaque-reasoning'); assert.equal(h.sent[1].body.messages[2].providerContent, undefined); assert.equal(h.sent[1].body.messages[2].content, '')
})
