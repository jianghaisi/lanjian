import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { AppError } from '../../../src/main/core/errors/app-error'
import { extractFinalText, geminiEndpoint } from '../../../src/main/modules/models/adapters/gemini-native-text-client'
import { AiClient } from '../../../src/main/modules/models/application/ai-client'
import { completeStructured } from '../../../src/main/modules/assistant/application/structured-response-repair'

test('Gemini native dispatch uses owned paths and x-goog-api-key while filtering thoughts', async t => {
  const requests: Array<{ method: string; url: string; authorization: string | null; key: string | null; body?: any }> = []
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    requests.push({
      method: request.method ?? '', url: request.url ?? '', authorization: request.headers.authorization ?? null,
      key: typeof request.headers['x-goog-api-key'] === 'string' ? request.headers['x-goog-api-key'] : null,
      ...(raw ? { body: JSON.parse(raw) } : {})
    })
    if (request.method === 'GET') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ models: [{ name: 'models/gemini-3.8-flash-high' }] }))
      return
    }
    if (request.url?.includes(':streamGenerateContent')) {
      response.setHeader('Content-Type', 'text/event-stream')
      response.end([
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '不可见思考', thought: true }, { text: '第一段' }] } }] })}`,
        '',
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ thoughtSignature: 'private' }, { text: '第二段', thought: false }] }, finishReason: 'STOP' }] })}`,
        '', ''
      ].join('\n'))
      return
    }
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ candidates: [{ content: { parts: [
      { text: '内部推理', thought: true }, { thoughtSignature: 'private' }, { text: '最终正文', thought: false }
    ] }, finishReason: 'STOP' }] }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const connection = {
    kind: 'gemini-native' as const, connectionId: 'native', connectionName: 'Gemini 原生',
    baseUrl: `http://127.0.0.1:${address.port}`, apiKey: 'synthetic-native-key',
    profile: { connectionId: 'native', model: 'gemini-3.8-flash-high', temperature: 0.7, topP: 0.9, maxTokens: 4096 }
  }
  const ai = new AiClient({ resolve: async () => connection, resolveConnection: async () => connection })

  assert.deepEqual(await ai.listModels(), { models: ['gemini-3.8-flash-high'] })
  const prepared = await ai.prepareCompletion('prose')
  assert.equal((await prepared.completeMessages!([
    { role: 'system', content: '只输出正文' }, { role: 'assistant', content: '前文' }, { role: 'user', content: '继续' }
  ])).content, '最终正文')
  const deltas: string[] = []
  assert.equal((await ai.streamComplete('继续', '', '系统约束', 'prose', undefined, undefined, delta => { deltas.push(delta) })).content, '第一段第二段')
  assert.deepEqual(deltas, ['第一段', '第二段'])

  assert.deepEqual(requests.map(value => [value.method, value.url]), [
    ['GET', '/v1beta/models'],
    ['POST', '/v1beta/models/gemini-3.8-flash-high:generateContent'],
    ['POST', '/v1beta/models/gemini-3.8-flash-high:streamGenerateContent?alt=sse']
  ])
  assert.ok(requests.every(value => value.key === 'synthetic-native-key' && value.authorization === 'Bearer synthetic-native-key' && !value.url.includes('synthetic-native-key')))
  assert.deepEqual(requests[1].body.systemInstruction, { parts: [{ text: '只输出正文' }] })
  assert.deepEqual(requests[1].body.contents.map((value: any) => value.role), ['model', 'user'])
  assert.deepEqual(requests[1].body.generationConfig, { temperature: 0.7, topP: 0.9, maxOutputTokens: 4096 })

  const beforeTool = requests.length
  await assert.rejects(ai.prepareToolConversation('outline'), (error: unknown) => {
    assert.ok(error instanceof AppError)
    assert.equal(error.code, 'FEATURE_UNAVAILABLE')
    assert.match(error.message, /不支持工具调用/)
    return true
  })
  assert.equal(requests.length, beforeTool)
})

test('Gemini native endpoint preserves an explicit gateway API version', () => {
  assert.equal(geminiEndpoint('https://native.example.test', '/v1beta/models'), 'https://native.example.test/v1beta/models')
  assert.equal(geminiEndpoint('https://gateway.example.test/v1', '/v1beta/models'), 'https://gateway.example.test/v1/models')
  assert.equal(geminiEndpoint('https://gateway.example.test/v1beta/', '/v1beta/models/model:generateContent'), 'https://gateway.example.test/v1beta/models/model:generateContent')
})

test('Gemini native response extraction rejects empty, malformed, oversized and truncated results', () => {
  assert.equal(extractFinalText({ candidates: [{ content: { parts: [{ text: '想法', thought: true }, { text: '答案' }] }, finishReason: 'STOP' }] }), '答案')
  for (const payload of [
    {},
    { candidates: [] },
    { candidates: [{ content: { parts: 'bad' } }] },
    { candidates: [{ content: { parts: [{ text: '只有思考', thought: true }] }, finishReason: 'STOP' }] },
    { candidates: [{ content: { parts: [{ text: '被截断' }] }, finishReason: 'MAX_TOKENS' }] },
    { candidates: [{ content: { parts: [{ text: 'x'.repeat(5_000_001) }] }, finishReason: 'STOP' }] }
  ]) assert.throws(() => extractFinalText(payload), (error: unknown) => error instanceof AppError && error.code === 'AI_RESPONSE_INVALID')
})

test('Gemini native structured repair stays on one captured connection', async t => {
  let resolves = 0, sends = 0
  const connection = {
    kind: 'gemini-native' as const, connectionId: 'native', connectionName: 'Gemini 原生',
    baseUrl: 'https://native.example.test', apiKey: 'synthetic-native-key',
    profile: { connectionId: 'native', model: 'gemini-review', temperature: 0, topP: 1, maxTokens: 1024 }
  }
  const ai = new AiClient({
    resolve: async () => { resolves++; return connection },
    resolveConnection: async () => assert.fail('captured structured flow must not reselect a connection')
  })
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    sends++
    assert.equal(new Headers(init.headers).get('x-goog-api-key'), 'synthetic-native-key')
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [
      { text: '隐藏推理', thought: true }, { text: sends === 1 ? 'not-json' : '{"value":"已修复"}' }
    ] }, finishReason: 'STOP' }] }), { headers: { 'Content-Type': 'application/json' } })
  })
  const value = await completeStructured({
    ai, instruction: '只输出 {"value":"内容"}', systemContext: '结构化审校', task: 'review', repairAttempts: 1,
    parse: content => {
      try {
        const parsed = JSON.parse(content) as { value?: unknown }
        if (typeof parsed.value !== 'string') throw Error('missing value')
        return parsed
      } catch (error) {
        throw new AppError('AI_RESPONSE_INVALID', '结果格式无效。', { recoverable: true, cause: error })
      }
    }
  })
  assert.deepEqual(value, { value: '已修复' })
  assert.equal(resolves, 1)
  assert.equal(sends, 2)
})
