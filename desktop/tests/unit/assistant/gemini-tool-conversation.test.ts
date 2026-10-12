import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { AiClient } from '../../../src/main/modules/models/application/ai-client'
import { consumeGeminiToolResponse, geminiToolBody } from '../../../src/main/modules/models/adapters/gemini-tool-conversation'
import { decodeGeminiParts, validatedGeminiMessage } from '../../../src/contracts/models/gemini-tool-content'
import type { AiFunctionTool, AiToolMessage } from '../../../src/contracts/assistant/assistant-conversation-contracts'

const tool: AiFunctionTool = { type: 'function', function: { name: 'read_field', description: '读字段', parameters: { type: 'object', properties: { targetId: { type: 'string' } }, required: ['targetId'], additionalProperties: false } } }
const signal = () => new AbortController().signal
const packet = (parts: unknown[], finishReason?: string) => ({ candidates: [{ index: 0, content: { role: 'model', parts }, ...(finishReason ? { finishReason } : {}) }] })
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
const sse = (...values: unknown[]) => new Response(values.map(value => `data: ${typeof value === 'string' ? value : JSON.stringify(value)}\r\n\r\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } })
const parts = [{ text: '先核对字段。', thoughtSignature: 'signed-text' }, { functionCall: { name: 'read_field', args: { targetId: 'idea' }, id: 'provider/id:1' }, thoughtSignature: 'signed-call' }, { text: '', thoughtSignature: 'signed-tail' }]

test('native HTTP keeps frozen route, JSON schemas, original signatures/IDs and grouped tool results', async t => {
  const requests: Array<{ url: string; body: any; key?: string }> = []
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    requests.push({ url: req.url!, body: JSON.parse(raw), key: req.headers['x-goog-api-key'] as string })
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(packet(requests.length === 1 ? [...parts, { functionCall: { name: 'read_field', args: { targetId: 'name' } } }] : [{ text: '已核对完整。' }], 'STOP')))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())) })
  const c = { kind: 'gemini-native' as const, connectionId: 'native', connectionName: 'fixture', baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, apiKey: 'synthetic-key', profile: { connectionId: 'native', model: 'original', temperature: .7, topP: .8, maxTokens: 4096 } }
  let guard = 0; Object.assign(c, { requestGuard: { async recheck() { guard++ }, assertActive() {} } })
  const ai = new AiClient({ resolve: async () => c, resolveConnection: async () => c })
  const prepared = await ai.prepareToolConversation('outline', 'chosen', 'native')
  c.profile.model = 'changed'; c.baseUrl = 'https://must-not-request.example'; c.apiKey = 'changed'
  const messages: AiToolMessage[] = [{ role: 'system', content: '写作约束' }, { role: 'user', content: '核对' }]
  const first = await prepared.step(messages, [tool], signal())
  assert.equal(first.toolCalls.length, 2); assert.notEqual(first.toolCalls[0].id, 'provider/id:1')
  messages.push({ role: 'assistant', content: first.content, tool_calls: first.toolCalls, geminiParts: first.geminiParts })
  for (const call of first.toolCalls) messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ value: '作者草稿' }) })
  // Recreate the adapter: all replay state must come from persisted messages.
  const restoredConfig = { ...c, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, apiKey: 'synthetic-key' }
  const resumed = await new AiClient({ resolve: async () => restoredConfig, resolveConnection: async () => restoredConfig }).prepareToolConversation('outline', 'chosen')
  assert.equal((await resumed.step(JSON.parse(JSON.stringify(messages)), [tool], signal(), () => assert.fail('JSON fallback must not fake deltas'))).content, '已核对完整。')
  assert.deepEqual(requests.map(r => r.url), ['/v1/models/chosen:generateContent', '/v1/models/chosen:streamGenerateContent?alt=sse'])
  assert.ok(requests.every(r => r.key === 'synthetic-key'))
  assert.deepEqual(requests[0].body.tools[0].functionDeclarations[0], { name: 'read_field', description: '读字段', parametersJsonSchema: tool.function.parameters })
  assert.deepEqual(requests[0].body.systemInstruction, { parts: [{ text: '写作约束' }] })
  assert.equal(requests[0].body.toolConfig.functionCallingConfig.mode, 'AUTO')
  assert.deepEqual(requests[1].body.contents[1].parts, first.geminiParts)
  assert.deepEqual(requests[1].body.contents[2].parts.map((p: any) => p.functionResponse), [
    { name: 'read_field', id: 'provider/id:1', response: { value: '作者草稿' } }, { name: 'read_field', response: { value: '作者草稿' } }
  ])
  assert.equal(guard, 2)
})

test('native stream handles split UTF-8/CRLF, thoughts, signed empty parts and completion', async () => {
  const source = [packet([{ text: '不可见摘要', thought: true }]), packet([{ text: '雨夜' }]), packet(parts, 'STOP')].map(p => `data: ${JSON.stringify(p)}\r\n\r\n`).join('')
  const bytes = new TextEncoder().encode(source), deltas: string[] = []
  const stream = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3)); c.close() } })
  const reply = await consumeGeminiToolResponse(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }), signal(), s => deltas.push(s))
  assert.deepEqual(deltas, ['雨夜', '雨夜先核对字段。']); assert.equal(reply.toolCalls.length, 1)
  assert.deepEqual(reply.geminiParts!.slice(-3), parts)
  assert.ok(!reply.content.includes('摘要'))
})

test('text arrives before STOP; no call is returned until completion and cancellation closes reader', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>, cancelled = false, complete = false
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c }, cancel() { cancelled = true } })
  const abort = new AbortController(), deltas: string[] = []
  const pending = consumeGeminiToolResponse(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }), abort.signal, s => deltas.push(s))
  void pending.then(() => { complete = true }, () => {})
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(packet(parts))}\n\n`))
  for (let i = 0; i < 50 && !deltas.length; i++) await new Promise(resolve => setTimeout(resolve, 1))
  assert.deepEqual(deltas, ['先核对字段。']); assert.equal(complete, false)
  abort.abort(); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(cancelled, true)
})

for (const [name, response] of [
  ['EOF without STOP', () => sse(packet(parts))],
  ['DONE without STOP', () => sse(packet(parts), '[DONE]')],
  ['MAX_TOKENS', () => sse(packet(parts, 'MAX_TOKENS'))],
  ['blocked', () => json({ promptFeedback: { blockReason: 'SAFETY' } })],
  ['bad arguments', () => json(packet([{ functionCall: { name: 'read_field', args: '{}' } }], 'STOP'))],
  ['duplicate provider IDs', () => json(packet([parts[1], parts[1]], 'STOP'))],
  ['too many calls', () => json(packet(Array.from({ length: 9 }, () => ({ functionCall: { name: 'read_field', args: {} } })), 'STOP'))],
  ['long text', () => json(packet([{ text: '字'.repeat(50001) }], 'STOP'))],
  ['long signature', () => json(packet([{ text: 'ok', thoughtSignature: 's'.repeat(65537) }], 'STOP'))],
  ['long args', () => json(packet([{ functionCall: { name: 'read_field', args: { text: 's'.repeat(20000) } } }], 'STOP'))],
  ['late tool', () => sse(packet([{ text: 'ok' }], 'STOP'), packet(parts))],
  ['malformed stream', () => sse('{invalid')],
  ['malformed UTF-8', () => new Response(new Uint8Array([255]), { headers: { 'content-type': 'text/event-stream' } })],
  ['oversized frame', () => sse('x'.repeat(200001))],
  ['ambiguous candidates', () => json({ candidates: [packet(parts, 'STOP').candidates[0], packet(parts, 'STOP').candidates[0]] })]
] as const) test(`native tool rejects ${name}`, async () => { await assert.rejects(consumeGeminiToolResponse(response(), signal()), { code: 'AI_RESPONSE_INVALID' }) })

test('decoder rejects contradictory replay data and orphaned results, preserves legacy text history', () => {
  const message: AiToolMessage = { role: 'assistant', content: '先核对字段。', geminiParts: decodeGeminiParts(parts), tool_calls: [{ id: 'host-id', type: 'function', function: { name: 'read_field', arguments: '{"targetId":"idea"}' } }] }
  assert.deepEqual(validatedGeminiMessage(message), parts)
  assert.throws(() => validatedGeminiMessage({ ...message, role: 'user' }))
  assert.throws(() => validatedGeminiMessage({ ...message, content: 'different' }))
  assert.throws(() => validatedGeminiMessage({ ...message, tool_calls: [] }))
  assert.throws(() => geminiToolBody([message], [tool], {}), /Gemini/)
  assert.throws(() => geminiToolBody([{ role: 'tool', tool_call_id: 'orphan', content: '{}' }], [tool], {}))
  assert.deepEqual(geminiToolBody([{ role: 'assistant', content: '旧对话' }, { role: 'user', content: '继续' }], [], {}).contents, [{ role: 'model', parts: [{ text: '旧对话' }] }, { role: 'user', parts: [{ text: '继续' }] }])
})

test('native tools never retry errors or silently change transport; request guards still block', async t => {
  let requests = 0, blocked = false
  const c = { kind: 'gemini-native' as const, connectionId: 'native', connectionName: 'fixture', baseUrl: 'https://native.example.test', apiKey: 'synthetic-key', profile: { connectionId: 'native', model: 'gemini-fixture', parameterPolicy: { version: 1 as const, mode: 'auto' as const } }, requestGuard: { async recheck() { if (blocked) throw new Error('route changed') }, assertActive() {} } }
  t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response('private-token-provider-error', { status: 400 }) })
  const prepared = await new AiClient({ resolve: async () => c, resolveConnection: async () => c }).prepareToolConversation('outline')
  await assert.rejects(prepared.step([{ role: 'user', content: '读取' }], [tool], signal()), error => { assert.ok(error instanceof Error); assert.ok(!error.message.includes('private-token')); return true })
  assert.equal(requests, 1)
  blocked = true
  await assert.rejects(prepared.step([{ role: 'user', content: '读取' }], [tool], signal()), /route changed/)
  assert.equal(requests, 1)
})
