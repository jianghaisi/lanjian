import assert from 'node:assert/strict'
import test from 'node:test'
import { consumeOpenAiStream, generationTimeoutMs } from '../../../src/main/modules/models/application/ai-client'

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
    'data: [DONE]\n\n'
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
