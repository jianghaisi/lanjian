import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fixture } from './helpers.ts'
import { ModelStore } from '../src/models/model-store.ts'
import { MeteredModels } from '../src/models/metered-client.ts'
import { decodeUsage } from '../src/models/usage.ts'
import { readSite, updateSite } from '../src/admin/site-store.ts'
import type { ProviderTokenPolicy } from '@lanjian/hosted-contracts'

async function modelFixture(t: Parameters<typeof fixture>[0], protocol: 'openai-compatible' | 'gemini-native' = 'openai-compatible') {
  const f = fixture(t), user = await f.login(), owner = user.me.user.id
  const book = f.books.create(owner, { title: '计量样书', operation: 'book_0001' }), models = new ModelStore(f.db, f.config)
  const input = { name: '测试模型', protocol, baseUrl: 'https://provider.example/v1', model: 'fixture-model', enabled: true,
    maxInputTokens: 20000, maxOutputTokens: 1024, expectedRevision: 0, apiKey: 'private-model-sentinel' }
  models.update('admin', 'fixture', input)
  await f.runtimes.run(owner, book.id, async () => undefined)
  function job() {
    const id = randomUUID(), now = Date.now()
    f.db.run('INSERT INTO jobs(id,owner_id,book_id,model_id,model_revision,price_version,kind,status,request_json,created_at,updated_at) VALUES(?,?,?,?,1,1,?,?,?, ?,?)', id, owner, book.id, 'fixture', 'writing', 'running', '{}', now, now)
    return id
  }
  return { ...f, owner, book, models, input, job }
}
test('model keys encrypted at rest, never returned, rotated and guarded against endpoint changes', async t => {
  const f = await modelFixture(t)
  assert.ok(!JSON.stringify(f.models.list()).includes('private-model-sentinel'))
  assert.ok(!String(f.db.get("SELECT value FROM settings WHERE key='model:fixture'")?.value).includes('private-model-sentinel'))
  assert.equal(f.models.privateConfiguration('fixture').apiKey, 'private-model-sentinel')
  const { apiKey: _secret, ...withoutKey } = f.input
  assert.throws(() => f.models.update('admin', 'fixture', { ...withoutKey, expectedRevision: 1, baseUrl: 'https://different.example/v1' }), /conflict/)
  assert.throws(() => f.models.update('admin', 'fixture', { ...f.input, baseUrl: 'https://user:secret@example.com' }), /invalid-request/)
})
test('unconfigured fee and insufficient funds cause no upstream request', async t => {
  const f = await modelFixture(t); let calls = 0
  const meter = new MeteredModels(f.db, f.models, f.credits, async () => { calls++; return new Response('{}') })
  assert.throws(() => meter.createScope(f.job(), f.owner, f.book.id, 'fixture', 1, 0, new AbortController()), /pricing-required/)
  f.credits.updatePrice('admin', 'fixture', { expectedVersion: 0, policy: { mode: 'request', points: 11000 } })
  assert.throws(() => meter.createScope(f.job(), f.owner, f.book.id, 'fixture', 1, 1, new AbortController()), /insufficient-credits/)
  assert.equal(calls, 0)
})
test('frozen AiClient and tool loops retain metering, clamp output and settle each provider usage', async t => {
  const f = await modelFixture(t); let calls = 0
  f.credits.updatePrice('admin', 'fixture', { expectedVersion: 0, policy: { mode: 'tokens', inputPerMillion: 10000, outputPerMillion: 20000 } })
  const meter = new MeteredModels(f.db, f.models, f.credits, async (_url, init) => {
    calls++; const payload = JSON.parse(String(init?.body))
    assert.equal(payload.max_tokens ?? payload.max_completion_tokens, 1024); assert.equal(init?.redirect, 'error')
    return new Response(JSON.stringify({ choices: [{ message: { content: '合成回复' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }), { headers: { 'content-type': 'application/json' } })
  })
  const scope = meter.createScope(f.job(), f.owner, f.book.id, 'fixture', 1, 1, new AbortController())
  await meter.run(scope, async () => {
    const frozen = await meter.ai.captureRun(['prose', 'review'])
    assert.equal((await frozen.complete('示例', '', '', 'prose')).content, '合成回复')
    const tools = await frozen.prepareToolConversation('review')
    assert.equal((await tools.step([{ role: 'user', content: '示例' }], [], new AbortController().signal)).content, '合成回复')
  })
  await meter.finish(scope, true)
  assert.equal(calls, 2); assert.deepEqual(f.credits.wallet(f.owner), { balance: 9996, reserved: 0, available: 9996 })
  assert.equal(f.db.all("SELECT * FROM attempts WHERE status='known'").length, 2)
})
test('missing usage or HTTP 500 freezes tokens and never silently retries', async t => {
  const f = await modelFixture(t); let calls = 0
  f.credits.updatePrice('admin', 'fixture', { expectedVersion: 0, policy: { mode: 'tokens', inputPerMillion: 10000, outputPerMillion: 20000 } })
  const meter = new MeteredModels(f.db, f.models, f.credits, async () => {
    calls++; return new Response('secret-sentinel', { status: 500 })
  })
  const scope = meter.createScope(f.job(), f.owner, f.book.id, 'fixture', 1, 1, new AbortController())
  await assert.rejects(meter.run(scope, () => meter.ai.streamComplete('示例')), /usage-unconfirmed/)
  assert.equal(calls, 1); assert.equal(f.credits.pending(f.owner)[0]?.status, 'unknown')
  const missing = new MeteredModels(f.db, f.models, f.credits, async () => new Response(JSON.stringify({ choices: [{ message: { content: '正文' } }] })))
  const other = missing.createScope(f.job(), f.owner, f.book.id, 'fixture', 1, 1, new AbortController())
  await missing.run(other, async () => {
    await missing.ai.complete('示例')
    await assert.rejects(missing.ai.complete('再来'), /usage-unconfirmed/)
  })
  assert.equal(other.unknown, true)
})
test('SSE usage is metered across chunk boundaries before publishing completed candidate', async t => {
  const f = await modelFixture(t)
  f.credits.updatePrice('admin', 'fixture', { expectedVersion: 0, policy: { mode: 'tokens', inputPerMillion: 10000, outputPerMillion: 20000 } })
  const raw = 'data: {"choices":[{"delta":{"content":"正文"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\ndata: [DONE]\n\n'
  const bytes = new TextEncoder().encode(raw)
  const meter = new MeteredModels(f.db, f.models, f.credits, async (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)).stream_options, { include_usage: true })
    return new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7)); c.close() } }), { headers: { 'content-type': 'text/event-stream' } })
  })
  const scope = meter.createScope(f.job(), f.owner, f.book.id, 'fixture', 1, 1, new AbortController())
  const result = await meter.run(scope, () => meter.ai.streamComplete('示例'))
  await meter.finish(scope, true)
  assert.equal(result.content, '正文'); assert.equal(f.credits.wallet(f.owner).balance, 9998); assert.equal(f.credits.wallet(f.owner).reserved, 0)
})
test('request policy charges once for multiple successful calls and only after persisted candidate', async t => {
  const f = await modelFixture(t)
  f.credits.updatePrice('admin', 'fixture', { expectedVersion: 0, policy: { mode: 'request', points: 1000 } })
  const meter = new MeteredModels(f.db, f.models, f.credits, async () => new Response('{"choices":[{"message":{"content":"正文"}}]}'))
  const scope = meter.createScope(f.job(), f.owner, f.book.id, 'fixture', 1, 1, new AbortController())
  await meter.run(scope, async () => { await meter.ai.complete('示例'); await meter.ai.complete('审校') })
  assert.equal(f.credits.wallet(f.owner).balance, 10000); assert.equal(f.credits.wallet(f.owner).reserved, 1000)
  await meter.finish(scope, true); await meter.finish(scope, true)
  assert.deepEqual(f.credits.wallet(f.owner), { balance: 9000, reserved: 0, available: 9000 })
})
test('Gemini usage includes reasoning and ambiguous timeout does not use fallback endpoint', async t => {
  const f = await modelFixture(t, 'gemini-native'); let calls = 0
  assert.deepEqual(decodeUsage({ usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, thoughtsTokenCount: 20, totalTokenCount: 170 } }, 'gemini-native'), { input: 100, output: 70 })
  f.credits.updatePrice('admin', 'fixture', { expectedVersion: 0, policy: { mode: 'tokens', inputPerMillion: 10000, outputPerMillion: 20000 } })
  const meter = new MeteredModels(f.db, f.models, f.credits, async () => { calls++; throw new TypeError('private-network-secret') })
  const scope = meter.createScope(f.job(), f.owner, f.book.id, 'fixture', 1, 1, new AbortController())
  await assert.rejects(meter.run(scope, () => meter.ai.complete('示例')), /usage-unconfirmed/)
  assert.equal(calls, 1)
})

// Both scans yield; only one request may claim the final shared attempt.
test('configured daily cap is enforced after concurrent disk checks', async t => {
  const f = await modelFixture(t), settings = readSite(f.db)
  settings.limits.dailyAttempts = 1; updateSite(f.db, 'admin', settings)
  f.credits.updatePrice('admin', 'fixture', { expectedVersion: 0, policy: { mode: 'tokens', inputPerMillion: 1000, outputPerMillion: 1000 } })
  let calls = 0
  const meter = new MeteredModels(f.db, f.models, f.credits, async () => {
    calls++; return new Response(JSON.stringify({ choices: [{ message: { content: 'bounded' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }), { headers: { 'content-type': 'application/json' } })
  })
  const scopes = [1, 2].map(() => meter.createScope(f.job(), f.owner, f.book.id, 'fixture', 1, 1, new AbortController()))
  const results = await Promise.allSettled(scopes.map(scope => meter.run(scope, () => meter.ai.complete('bounded'))))
  assert.equal(calls, 1); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(f.db.all('SELECT id FROM attempts').length, 1)
})

test('actual provider cost settles cache-aware usage at the frozen 6.64 price with an audit', async t => {
  const f = await modelFixture(t)
  const policy: ProviderTokenPolicy = { mode: 'provider-tokens', currency: 'USD', usdToCny: '6.64', pointsPerCny: '20', groupName: '测试', groupMultiplier: '0.3', sourceVersion: 'synthetic', tiers: [{ name: 'base', through: null, rates: { input: '2', output: '10', cacheRead: '0.1' } }] }
  f.credits.updatePrice('admin', 'fixture', { expectedVersion: 0, policy })
  const meter = new MeteredModels(f.db, f.models, f.credits, async () => {
    // A price change during the request cannot change this reservation.
    f.credits.updatePrice('admin', 'fixture', { expectedVersion: 1, policy: { ...policy, usdToCny: '8' } })
    return new Response(JSON.stringify({ choices: [{ message: { content: '缓存候选' } }], usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100, prompt_tokens_details: { cached_tokens: 600 } } }))
  })
  const scope = meter.createScope(f.job(), f.owner, f.book.id, 'fixture', 1, 1, new AbortController())
  await meter.run(scope, () => meter.ai.complete('示例'))
  await meter.finish(scope, true)
  assert.equal(f.credits.wallet(f.owner).balance, 9925)
  assert.equal(f.credits.wallet(f.owner).reserved, 0)
  const audit = JSON.parse(String(f.db.get("SELECT details FROM audit WHERE action='model-usage'")?.details))
  assert.equal(audit.priceVersion, 1); assert.equal(audit.usage.cacheRead, 600); assert.equal(audit.known, true)
  assert.ok(!JSON.stringify(audit).includes('private-model-sentinel'))
})
