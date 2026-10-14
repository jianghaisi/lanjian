import assert from 'node:assert/strict'
import test from 'node:test'
import { modelHttpError, readModelError, rethrowModelTransport } from '../../../src/main/modules/models/adapters/model-service-errors'
import { AppError } from '../../../src/contracts/core/app-error'

test('HTTP guidance separates repair, temporary retry, quota and firewall without exposing provider text', () => {
  for (const status of [400, 401, 402, 403, 404, 408, 422, 429, 500, 502, 503, 504]) {
    const text = modelHttpError(status, 'private-prompt sk-secret-synthetic Bearer private-secret')
    assert.doesNotMatch(text, /private|sk-secret|Bearer/)
    assert.match(text, /请/)
  }
  assert.match(modelHttpError(403, '<title>网站防火墙</title>'), /防火墙.*服务商/)
  assert.match(modelHttpError(403), /可能.*权限.*访问限制/)
  assert.match(modelHttpError(429, '{"error":{"code":"insufficient_quota"}}'), /额度.*立即重试不会解决/)
  assert.match(modelHttpError(429, 'rate_limit_exceeded'), /稍后重试/)
  assert.match(modelHttpError(404), /不要盲目增删 \/v1/)
  assert.match(modelHttpError(400), /工具.*兼容性/)
  assert.match(modelHttpError(503), /服务暂时不可用.*稍后重试/)
  assert.ok(modelHttpError(500).startsWith('模型服务返回 500'), 'retain existing explicit 500 fallback classification')
})

test('error reader bounds bytes and cancels excess data', async () => {
  let cancelled = false
  const response = new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('x'.repeat(20000))) }, cancel() { cancelled = true }
  }))
  assert.equal((await readModelError(response)).length, 8192)
  assert.equal(cancelled, true)
})

test('error reader obeys cancellation even when a body never finishes', async () => {
  const controller = new AbortController()
  const response = new Response(new ReadableStream({ start() {} }))
  const pending = readModelError(response, controller.signal)
  controller.abort()
  assert.equal(await pending, '')
})

test('transport failures preserve cancellation and application errors, normalize timeouts without invented seconds', () => {
  const controller = new AbortController(), aborted = new DOMException('private cancellation', 'AbortError')
  controller.abort(aborted)
  assert.throws(() => rethrowModelTransport(new TypeError('private-network'), controller.signal), e => e === aborted)
  const appError = new AppError('CONFLICT', 'safe conflict')
  assert.throws(() => rethrowModelTransport(appError), e => e === appError)
  for (const error of [new DOMException('private timeout', 'TimeoutError'), new TypeError('private url'), new DOMException('private stream', 'AbortError')]) {
    assert.throws(() => rethrowModelTransport(error), e => {
      assert.ok(e instanceof AppError); assert.match(e.message, /重试/)
      assert.doesNotMatch(e.message, /private|\d+ 秒/); return true
    })
  }
})
