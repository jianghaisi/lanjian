import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { AppError } from '../../../src/main/core/errors/app-error'
import { extractFinalText, geminiEndpoint } from '../../../src/main/modules/models/adapters/gemini-native-text-client'
import { AiClient } from '../../../src/main/modules/models/application/ai-client'
import { completeStructured } from '../../../src/main/modules/assistant/application/structured-response-repair'
import { catalogTextSupport, decodeCatalogEntry } from '../../../src/contracts/models/model-catalog-metadata'
import { modelCapabilities } from '../../../src/contracts/models/generation-parameters'

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
  assert.equal((await ai.prepareToolConversation('outline')).model, 'gemini-3.8-flash-high')
  assert.equal(requests.length, beforeTool)
})

test('Gemini native completion retries transport failures through the existing SSE endpoint', async t => {
  const urls: string[] = []
  const connection = {
    kind: 'gemini-native' as const, connectionId: 'native', connectionName: 'Gemini 原生',
    baseUrl: 'https://native.example.test/v1', apiKey: 'synthetic-native-key',
    profile: { connectionId: 'native', model: 'gemini-3.8-flash-high', temperature: 1, topP: .95, maxTokens: 16384 }
  }
  const ai = new AiClient({ resolve: async () => connection, resolveConnection: async () => connection })
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url))
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'synthetic-native-key')
    if (!String(url).includes(':streamGenerateContent')) throw new TypeError('synthetic transport failure')
    return new Response([
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '恢复后的' }] } }] })}`,
      '',
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '完整正文' }] }, finishReason: 'STOP' }] })}`,
      '', ''
    ].join('\n'), { headers: { 'Content-Type': 'text/event-stream' } })
  })
  const prepared = await ai.prepareCompletion('prose')
  assert.equal((await prepared.complete('继续正文')).content, '恢复后的完整正文')
  assert.deepEqual(urls, [
    'https://native.example.test/v1/models/gemini-3.8-flash-high:generateContent',
    'https://native.example.test/v1/models/gemini-3.8-flash-high:streamGenerateContent?alt=sse'
  ])
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

function catalogClient() {
  const config = { kind: 'gemini-native' as const, connectionId: 'native', connectionName: 'test',
    baseUrl: 'https://fixture.invalid/v1beta', apiKey: 'synthetic-native-key',
    profile: { connectionId: 'native', model: '', temperature: 0, topP: 1, maxTokens: 128 } }
  return new AiClient({ resolve: async () => config, resolveConnection: async () => config })
}

test('native gateway null metadata remains unknown; explicit false, zero and empty methods stay authoritative', async t => {
  const fields = ['displayName', 'supportedGenerationMethods', 'inputTokenLimit', 'outputTokenLimit', 'temperature', 'maxTemperature', 'topP', 'thinking']
  const nulls = Object.fromEntries(fields.map(key => [key, null]))
  t.mock.method(globalThis, 'fetch', async () => Response.json({ models: [
    { name: 'gemini-3.8-flash', ...nulls },
    { name: 'explicit', ...nulls, thinking: false, temperature: 0, topP: 0, supportedGenerationMethods: [] }
  ], nextPageToken: null }))
  const result = await catalogClient().listCatalog()
  assert.ok('entries' in result)
  assert.deepEqual(result.entries, [{ id: 'gemini-3.8-flash' }, { id: 'explicit', supportedGenerationMethods: [], temperature: 0, topP: 0, thinking: false }])
  assert.equal(catalogTextSupport(result.entries[0]), 'unknown')
  assert.equal(catalogTextSupport(result.entries[1]), 'unsupported')
  const caps = modelCapabilities({ protocol: 'gemini-native', baseUrl: 'https://fixture.invalid/v1', model: 'gemini-3.8-flash', metadata: result.entries[0] })
  assert.equal(caps.temperature, 'unknown'); assert.equal(caps.thinking.status, 'unknown')
  assert.equal(caps.maxOutputTokens, undefined)
  assert.throws(() => decodeCatalogEntry({ id: 'ipc-cannot-bypass', thinking: null }), 'only the remote adapter normalizes missing values; IPC stays strict')
})

test('native null compatibility does not discard malformed non-null model constraints', async t => {
  let metadata: Record<string, unknown> = {}
  t.mock.method(globalThis, 'fetch', async () => Response.json({ models: [{ name: 'writer', ...metadata }] }))
  for (const invalid of [{ name: null }, { displayName: '' }, { inputTokenLimit: 0 }, { outputTokenLimit: '2048' }, { temperature: -1 }, { thinking: 'false' }, { supportedGenerationMethods: {} }]) {
    metadata = invalid
    await assert.rejects(catalogClient().listModels(), (error: unknown) => error instanceof AppError)
  }
})

test('native catalog follows every page with exact gateway aliases, deduplicates and encodes cursor', async t => {
  const paths: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    paths.push(String(url))
    return Response.json(paths.length === 1
      ? { models: [{ name: 'models/gemini-base' }], nextPageToken: 'next/+?=' }
      : { models: [{ name: 'models/gemini-base' }, { name: 'models/gemini-3.8-flash-high' }, { name: 'models/gemini-3.8-flash-low' }] })
  })
  assert.deepEqual(await catalogClient().listModels(), { models: ['gemini-base', 'gemini-3.8-flash-high', 'gemini-3.8-flash-low'] })
  assert.deepEqual(paths, ['https://fixture.invalid/v1beta/models', 'https://fixture.invalid/v1beta/models?pageToken=next%2F%2B%3F%3D'])
})

for (const reason of ['loop', 'bad-token', 'second-page-failure', 'oversized', 'malformed-model'] as const) {
  test(`native catalog rejects ${reason} instead of returning a partial list`, async t => {
    let calls = 0
    t.mock.method(globalThis, 'fetch', async () => {
      calls++
      if (calls === 1) return Response.json({ models: [{ name: 'models/first' }], nextPageToken: 'next' })
      if (reason === 'second-page-failure') return new Response('', { status: 503 })
      return Response.json({ models: reason === 'oversized' ? Array.from({ length: 2000 }, (_, i) => ({ name: `models/m${i}` }))
        : reason === 'malformed-model' ? [{ id: 'ignored-would-hide-model' }] : [{ name: 'models/second' }],
        ...(reason === 'loop' ? { nextPageToken: 'next' } : reason === 'bad-token' ? { nextPageToken: 1 } : {}) })
    })
    await assert.rejects(catalogClient().listModels(), (error: unknown) => error instanceof AppError)
    assert.equal(calls, 2)
  })
}

test('native catalog cancellation between pages stops before sending the next request', async t => {
  const controller = new AbortController(); let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++; controller.abort()
    return Response.json({ models: [{ name: 'models/first' }], nextPageToken: 'next' })
  })
  await assert.rejects(catalogClient().listModels(undefined, controller.signal), { name: 'AbortError' })
  assert.equal(calls, 1)
})


test('New API gateway null nextPageToken terminates with custom model names unchanged', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return Response.json({ models: [{ name: 'gemini-3.8-flash-high' }], nextPageToken: null })
  })
  assert.deepEqual(await catalogClient().listModels(), { models: ['gemini-3.8-flash-high'] })
  assert.equal(calls, 1)
})
