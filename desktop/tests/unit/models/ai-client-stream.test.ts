import assert from 'node:assert/strict'
import test from 'node:test'
import { AiClient, consumeOpenAiStream, generationTimeoutMs } from '../../../src/main/modules/models/application/ai-client'

function streamedResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  }), { headers: { 'content-type': 'text/event-stream' } })
}

test('parses OpenAI-compatible SSE across arbitrary network chunk boundaries', async () => {
  const observed: string[] = []
  const content = await consumeOpenAiStream(streamedResponse([
    'data: {"choices":[{"delta":{"content":"第',
    '一段"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"。"}}]}\r\n\r\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
  ]), async (_delta, full) => { observed.push(full) })
  assert.equal(content, '第一段。')
  assert.deepEqual(observed, ['第一段', '第一段。'])
})

test('rejects malformed stream events instead of silently accepting an incomplete artifact', async () => {
  await assert.rejects(
    consumeOpenAiStream(streamedResponse(['data: not-json\n\n'])),
    /无法解析/
  )
})

test('scales generation timeout for long contexts while keeping a finite ceiling', () => {
  assert.equal(generationTimeoutMs(0, 0), 120_000)
  assert.equal(generationTimeoutMs(108_000, 12_000), 264_000)
  assert.equal(generationTimeoutMs(500_000, 128_000), 300_000)
})

test('retries an explicit HTTP 500 stream rejection once without streaming on the same frozen route', async t => {
  const requests: Array<Record<string, unknown>> = []
  const config = {
    kind: 'openai-compatible' as const,
    connectionId: 'shared',
    connectionName: 'Shared',
    baseUrl: 'https://gateway.example/v1',
    apiKey: 'fixture-key',
    profile: { connectionId: 'shared', model: 'gemini-compatible', temperature: 1, topP: 0.95, maxTokens: 8192 }
  }
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer fixture-key')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    requests.push(body)
    return body.stream === true
      ? new Response(JSON.stringify({ error: { message: 'stream failed' } }), { status: 500 })
      : new Response(JSON.stringify({ choices: [{ message: { content: '完整正文' } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  const ai = new AiClient({ resolve: async () => config, resolveConnection: async () => config })
  const deltas: string[] = []
  assert.equal((await ai.streamComplete('继续', '', '上下文', 'prose', undefined, undefined, delta => { deltas.push(delta) })).content, '完整正文')
  assert.equal(requests.length, 2)
  assert.equal(requests[0].stream, true)
  assert.equal(Object.hasOwn(requests[1], 'stream'), false)
  assert.equal(requests[1].model, 'gemini-compatible')
  assert.deepEqual(deltas, ['完整正文'])
})

test('does not replay authentication failures as a non-stream request', async t => {
  let requests = 0
  const config = {
    kind: 'openai-compatible' as const,
    connectionId: 'shared',
    connectionName: 'Shared',
    baseUrl: 'https://gateway.example/v1',
    apiKey: 'fixture-key',
    profile: { connectionId: 'shared', model: 'gemini-compatible', temperature: 1, topP: 0.95, maxTokens: 8192 }
  }
  t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response('{}', { status: 401 }) })
  const ai = new AiClient({ resolve: async () => config, resolveConnection: async () => config })
  await assert.rejects(ai.streamComplete('继续'), /密钥无效/)
  assert.equal(requests, 1)
})
