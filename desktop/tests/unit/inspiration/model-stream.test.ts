import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { inspirationModels } from '../../../src/main/modules/inspiration/adapters/original-ports'
import { InspirationStore } from '../../../src/main/modules/inspiration/adapters/inspiration-store'
import { InspirationService } from '../../../src/main/modules/inspiration/application/inspiration-service'
import { inspirationDigest } from '../../../src/main/modules/inspiration/domain/source'
import { OpenAiCompatibleTextClient } from '../../../src/main/modules/models/adapters/openai-compatible-text-client'

const profile = { connectionId: 'global-fixture', model: 'fixture', parameterPolicy: { version: 2 as const, mode: 'auto' as const } }
const config = { kind: 'openai-compatible' as const, connectionId: profile.connectionId, connectionName: 'Fixture', baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture-only', profile }
const signal = () => new AbortController().signal
const event = (content: string, finish: string | null = null) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\n\n`
const encoder = new TextEncoder()

async function models(transport: typeof fetch) {
  const client = new OpenAiCompatibleTextClient({ resolve: async () => config, resolveConnection: async () => config }, transport)
  const model = await client.prepareToolConversation('outline')
  return inspirationModels(async () => ({ identity: inspirationDigest(profile), model, run: async work => work() }))
}

function response(chunks: string[]) {
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
    controller.close()
  } }), { headers: { 'content-type': 'text/event-stream' } })
}

test('inspiration requests the original streamed tool transport and accepts fragmented JSON only after its terminal event', async () => {
  let calls = 0
  const port = await models(async (_url, init) => {
    calls++
    const body = JSON.parse(String(init?.body))
    assert.equal(body.stream, true)
    assert.equal(body.model, profile.model)
    assert.deepEqual(body.tools, [])
    const data = event('{"cards":') + event('[]}', 'stop') + 'data: [DONE]\n\n'
    return response([data.slice(0, 13), data.slice(13, 39), data.slice(39)])
  })
  assert.equal(await (await port.capture(profile, 'source')).complete('提取', signal()), '{"cards":[]}')
  assert.equal(calls, 1)
})

test('a provider returning one complete JSON response to the stream request needs no fallback call', async () => {
  let calls = 0
  const port = await models(async () => {
    calls++
    return Response.json({ choices: [{ message: { content: '{"cards":[]}' }, finish_reason: 'stop' }] })
  })
  assert.equal(await (await port.capture(profile, 'source')).complete('提取', signal()), '{"cards":[]}')
  assert.equal(calls, 1)
})

for (const failure of ['missing-stop', 'truncated', 'socket', 'http-500'] as const) {
  test(`inspiration ${failure} never returns partial JSON or automatically resends`, async () => {
    let calls = 0
    const port = await models(async () => {
      calls++
      if (failure === 'http-500') return new Response('unavailable', { status: 500 })
      if (failure === 'socket') return new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('socket closed')) } }), { headers: { 'content-type': 'text/event-stream' } })
      return response([event('{"cards":[]}', failure === 'truncated' ? 'length' : null)])
    })
    await assert.rejects((await port.capture(profile, 'source')).complete('提取', signal()))
    assert.equal(calls, 1)
  })
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'inspiration-stream-'))
  let controller!: ReadableStreamDefaultController<Uint8Array>, calls = 0
  let sent!: () => void
  const started = new Promise<void>(resolve => { sent = resolve })
  const port = await models(async () => {
    calls++; sent()
    return new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value } }), { headers: { 'content-type': 'text/event-stream' } })
  })
  const store = new InspirationStore(root, 'test-author'), library = new InspirationService(store, port)
  t.after(async () => { await library.shutdown(); await rm(root, { recursive: true, force: true }) })
  const source = (await library.importCommit((await library.importPreview([{ name: '隔离测试.txt', dataBase64: Buffer.from('主角为救人交出旧信。').toString('base64') }])).token))[0]
  const segment = (await store.document(source.id, source.version)).segments[0]
  const content = JSON.stringify({ cards: [{ title: '救人的代价', narrative: '主角为救人交出了旧信。', tags: ['代价'], characters: ['主角'], conflict: '', choice: '交出旧信', outcome: '', turn: '', foreshadowing: '', evidence: [{ segmentId: segment.id, quote: segment.text }] }] })
  const job = await library.extract({ sourceId: source.id, sourceVersion: source.version, operationId: randomUUID(), maxCalls: 1, profile })
  await started
  return { root, library, port, job, content, calls: () => calls, send: (data: string) => controller.enqueue(encoder.encode(data)), close: () => controller.close() }
}

async function settle(library: InspirationService, id: string) {
  for (let i = 0; i < 200; i++) {
    const job = await library.getJob(id)
    if (job.status !== 'running') return job
    await delay(5)
  }
  throw new Error('Extraction did not settle')
}

test('streamed scene cards publish atomically after completion; restart preserves progress without inference', async t => {
  const f = await fixture(t)
  f.send(event(f.content))
  await delay(10)
  assert.equal((await f.library.search({ query: '' })).cards.length, 0)
  assert.equal((await f.library.getJob(f.job.id)).processed, 0)
  f.send(event('', 'stop') + 'data: [DONE]\n\n'); f.close()
  const ended = await settle(f.library, f.job.id)
  assert.equal(ended.status, 'paused-limit'); assert.equal(ended.processed, 1)
  assert.equal((await f.library.search({ query: '' })).cards.length, 1)
  await f.library.shutdown()
  const reopened = new InspirationService(new InspirationStore(f.root, 'test-author'), f.port)
  try { assert.equal((await reopened.getJob(f.job.id)).processed, 1); assert.equal(f.calls(), 1) } finally { await reopened.shutdown() }
})

for (const stop of ['disconnect', 'cancel'] as const) {
  test(`stream ${stop} freezes the sent attempt across restart without publishing or replaying it`, async t => {
    const f = await fixture(t)
    f.send(event(f.content)); await delay(10)
    if (stop === 'disconnect') f.close()
    else await f.library.stop(f.job.id)
    const ended = await settle(f.library, f.job.id)
    assert.equal(ended.status, 'usage-unconfirmed'); assert.equal(ended.processed, 0)
    assert.equal((await f.library.search({ query: '' })).cards.length, 0)
    await assert.rejects(f.library.resume({ jobId: ended.id, expectedRevision: ended.revision }))
    await f.library.shutdown()
    const reopened = new InspirationService(new InspirationStore(f.root, 'test-author'), f.port)
    try {
      const job = await reopened.getJob(ended.id)
      assert.equal(job.status, 'usage-unconfirmed')
      await assert.rejects(reopened.resume({ jobId: job.id, expectedRevision: job.revision }))
      assert.equal(f.calls(), 1)
    } finally { await reopened.shutdown() }
  })
}
