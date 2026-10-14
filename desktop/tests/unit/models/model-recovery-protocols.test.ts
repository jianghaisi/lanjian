import assert from 'node:assert/strict'
import test from 'node:test'
import { AiClient } from '../../../src/main/modules/models/application/ai-client'
import type { RemoteModelProtocol } from '../../../src/contracts/models/model-connections'
import type { RemoteModelConnection } from '../../../src/main/modules/models/domain/model-provider'
import type { ModelProfile } from '../../../src/contracts/models/types'
import type { AiFunctionTool } from '../../../src/contracts/assistant/assistant-conversation-contracts'
import { AppError } from '../../../src/contracts/core/app-error'

const protocols: RemoteModelProtocol[] = ['openai-compatible', 'gemini-native', 'anthropic-native', 'openai-responses']
const tools: AiFunctionTool[] = [{ type: 'function', function: { name: 'diagnostic_echo', description: 'No side effects', parameters: { type: 'object', properties: {} } } }]
function client(protocol: RemoteModelProtocol, transport: typeof fetch) {
  const c: RemoteModelConnection & { profile: ModelProfile } = { kind: protocol, connectionId: 'fixture', connectionName: 'Fixture', baseUrl: 'https://fixture.invalid/v1', apiKey: 'synthetic-key',
    profile: { connectionId: 'fixture', model: 'exact-alias', parameterPolicy: { version: 2, mode: 'custom', overrides: { maxTokens: 2048 } } } }
  return new AiClient({ resolve: async () => c, resolveConnection: async () => c }, undefined, undefined, transport)
}

for (const protocol of protocols) {
  test(`${protocol}: HTTP failures give recovery guidance without retrying or exposing errors`, async () => {
    for (const [status, detail, expected] of [
      [400, 'invalid_request', /模型设置.*工具兼容性/], [401, 'unauthorized', /密钥.*更新/],
      [403, '<title>网站防火墙</title>', /防火墙.*服务商/], [403, 'forbidden', /可能.*访问限制/],
      [404, 'not_found', /不要盲目增删/], [429, 'insufficient_quota', /额度.*立即重试不会解决/],
      [429, 'rate_limit_exceeded', /稍后重试/], [503, 'upstream unavailable', /服务暂时不可用/]
    ] as const) {
      let calls = 0
      const ai = client(protocol, async () => { calls++; return new Response(`${detail} synthetic-key private-manuscript`, { status }) })
      const prepared = await ai.prepareToolConversation('prose')
      await assert.rejects(prepared.step([{ role: 'user', content: 'synthetic ping' }], tools, AbortSignal.timeout(2000), () => {}), e => {
        assert.ok(e instanceof AppError); assert.match(e.message, expected); assert.doesNotMatch(e.message, /synthetic-key|private-manuscript/); return true
      })
      assert.equal(calls, 1)
    }
  })

  for (const name of ['TimeoutError', 'AbortError'] as const) {
    test(`${protocol}: ${name} during request preserves the appropriate recovery semantics`, async () => {
      const controller = new AbortController(); let calls = 0
      const ai = client(protocol, async () => { calls++; controller.abort(new DOMException('private cause', name)); throw controller.signal.reason })
      const prepared = await ai.prepareToolConversation('prose')
      await assert.rejects(prepared.step([{ role: 'user', content: 'ping' }], tools, controller.signal, () => {}), e => {
        if (name === 'AbortError') { assert.equal((e as Error).name, 'AbortError'); return true }
        assert.ok(e instanceof AppError); assert.match(e.message, /超时.*重试/); assert.doesNotMatch(e.message, /private|\d+ 秒/); return true
      })
      assert.equal(calls, 1)
    })
  }

  test(`${protocol}: network interruption while reading never returns an executable partial tool`, async () => {
    let calls = 0
    const ai = client(protocol, async () => { calls++; return new Response(new ReadableStream({ start(c) { c.error(new TypeError('private-network-details')) } }), { headers: { 'content-type': 'text/event-stream' } }) })
    const prepared = await ai.prepareToolConversation('prose')
    await assert.rejects(prepared.step([{ role: 'user', content: 'ping' }], tools, AbortSignal.timeout(2000), () => {}), e => {
      assert.ok(e instanceof AppError); assert.match(e.message, /网络.*重试/); assert.doesNotMatch(e.message, /private-network/); return true
    })
    assert.equal(calls, 1)
  })
}
