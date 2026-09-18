import assert from 'node:assert/strict'
import test from 'node:test'
import { OpenAiCompatibleImageClient, inspectImage } from '../../../src/main/modules/models/adapters/openai-compatible-image-client'

function png(width = 1536, height = 1024): Buffer {
  const value = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(value)
  value.writeUInt32BE(width, 16); value.writeUInt32BE(height, 20)
  return value
}

test('image adapter sends one bounded base64 generation request and validates the returned bitmap', async () => {
  let requestedUrl = '', requested: RequestInit | undefined
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    requestedUrl = String(url); requested = init
    return new Response(JSON.stringify({ data: [{ b64_json: png().toString('base64') }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  const client = new OpenAiCompatibleImageClient({ resolveConnection: async () => ({ connectionName: '本地测试', baseUrl: 'https://images.example/v1', apiKey: 'secret' }) }, request)
  const result = await client.generate('connection-one', 'gpt-image-1', '一张地图')
  assert.equal(requestedUrl, 'https://images.example/v1/images/generations')
  assert.equal((requested?.headers as Record<string, string>).Authorization, 'Bearer secret')
  assert.deepEqual(JSON.parse(String(requested?.body)), { model: 'gpt-image-1', prompt: '一张地图', n: 1, size: '1536x1024', quality: 'medium', output_format: 'png' })
  assert.equal(result.connectionName, '本地测试')
  assert.equal(result.format, 'png'); assert.equal(result.width, 1536); assert.equal(result.height, 1024)
})

test('image adapter refuses URL-only output and malformed image bytes', async () => {
  const urlOnly = new OpenAiCompatibleImageClient({ resolveConnection: async () => ({ connectionName: '测试', baseUrl: 'https://images.example/v1', apiKey: 'secret' }) }, (async () => new Response(JSON.stringify({ data: [{ url: 'https://cdn.example/map.png' }] }), { status: 200 })) as typeof fetch)
  await assert.rejects(urlOnly.generate('connection-one', 'model', 'prompt'), /只返回远程链接/)
  assert.throws(() => inspectImage(Buffer.from('not-an-image')), /不是可用的 PNG、JPEG 或 WebP/)
  assert.throws(() => inspectImage(png(64, 64)), /不是可用的 PNG、JPEG 或 WebP/)
})
