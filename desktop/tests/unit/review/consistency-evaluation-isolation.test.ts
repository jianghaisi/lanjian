import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { AiClient, type PreparedAiCompletion } from '../../../src/main/modules/models/application/ai-client'
import { ConsistencyEvaluationJobService, ConsistencyEvaluationService } from '../../../src/main/modules/review/application/consistency-evaluation-service'
import { writeJson } from '../../../src/main/platform/storage/json-store'

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-eval-isolation-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, '.webnovel', 'evaluations', 'consistency-fixed-v2.json')
  await mkdir(dirname(path), { recursive: true })
  const previous = '{"previous":"keep this completed report"}\n'
  await writeFile(path, previous)
  return { root, path, previous }
}

function emptyPrediction(instruction: string) {
  const samples = JSON.parse(instruction.split('\n样本：\n')[1]) as Array<{ id: string }>
  return { content: JSON.stringify({ results: samples.map(({ id }) => ({ id, codes: [] })) }) }
}

function prepared(complete: PreparedAiCompletion['complete'] = async instruction => emptyPrediction(instruction)): PreparedAiCompletion {
  return { model: 'fixture-review', connectionId: 'fixture-api', complete }
}

test('freezes API, credentials, model and sampling for all batches and repairs; the next run uses new settings', async context => {
  const { root, path } = await fixture(context)
  const requests: Array<{ url?: string; authorization?: string; body: Record<string, unknown> }> = []
  let reply = { content: '' }
  const server = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw)
    requests.push({ url: request.url, authorization: request.headers.authorization, body })
    if (requests.length === 1) {
      reply = emptyPrediction(body.messages[1].content)
      // Mutate the same resolved object, including its nested profile, while the run is active.
      Object.assign(config, { baseUrl: `${baseUrl}/b`, apiKey: 'fixture-secret-b', connectionId: 'api-b' })
      Object.assign(config.profile, { connectionId: 'api-b', temperature: 1.2, topP: 0.8, maxTokens: 4096 })
    } else if (requests.length !== 2 && request.url?.startsWith('/a/')) {
      reply = emptyPrediction(body.messages[1].content)
    }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ choices: [{ message: { content: requests.length === 1 ? 'invalid JSON' : reply.content } }] }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const baseUrl = `http://127.0.0.1:${address.port}`
  const config = {
    kind: 'openai-compatible' as const, connectionId: 'api-a', connectionName: 'A', baseUrl: `${baseUrl}/a`, apiKey: 'fixture-secret-a',
    profile: { connectionId: 'api-a', model: 'same-model', temperature: 0.6, topP: 1, maxTokens: 8192 }
  }
  let resolves = 0
  let repairReads = 0
  const ai = new AiClient({
    resolve: async () => { resolves++; return config },
    resolveConnection: async () => { throw new Error('unexpected secondary resolution') }
  })
  const runner = new ConsistencyEvaluationService(ai, { currentPath: async () => root }, undefined, async () => ++repairReads === 1 ? 1 : 0)
  const result = await runner.run(new AbortController().signal)
  assert.equal(result.semanticEvaluatedCount, 60)
  assert.equal(result.warningCount, 0)
  assert.equal(resolves, 1)
  assert.equal(repairReads, 1)
  assert.equal(requests.length, 6)
  for (const request of requests) {
    assert.equal(request.url, '/a/chat/completions')
    assert.equal(request.authorization, 'Bearer fixture-secret-a')
    assert.equal(request.body.model, 'same-model')
    assert.equal(request.body.temperature, 0.6)
    assert.equal(request.body.top_p, 1)
    assert.equal(request.body.max_tokens, 8192)
    assert.doesNotMatch(JSON.stringify(request.body), /fixture-secret/)
  }
  const report = await readFile(path, 'utf8')
  assert.equal(JSON.parse(report).connectionId, 'api-a')
  assert.doesNotMatch(report, /fixture-secret|Authorization|baseUrl/)
  config.profile.model = 'new-model'
  await ai.complete('a separate generation')
  assert.equal(resolves, 2)
  assert.equal(requests.at(-1)?.url, '/b/chat/completions')
  assert.equal(requests.at(-1)?.authorization, 'Bearer fixture-secret-b')
  assert.equal(requests.at(-1)?.body.model, 'new-model')
  assert.equal(requests.at(-1)?.body.temperature, 1.2)
})

for (const stage of ['before-start', 'before-request', 'late-provider', 'last-batch', 'staged-report'] as const) {
  test(`cancellation at ${stage} preserves the previous report and never publishes late results`, async context => {
    const { root, path, previous } = await fixture(context)
    const controller = new AbortController()
    let calls = 0
    let preparations = 0
    if (stage === 'before-start') controller.abort()
    const runner = new ConsistencyEvaluationService({ prepareCompletion: async () => {
      preparations++
      return prepared(async instruction => {
        calls++
        if (stage === 'late-provider') controller.abort()
        return emptyPrediction(instruction)
      })
    } }, { currentPath: async () => {
      if (stage === 'staged-report' && (await readdir(dirname(path))).some(name => name.endsWith('.tmp'))) controller.abort()
      return root
    } })
    await assert.rejects(runner.run(controller.signal, completed => {
      if ((stage === 'before-request' && completed === 0) || (stage === 'last-batch' && completed === 5)) controller.abort()
    }), { name: 'AbortError' })
    assert.equal(await readFile(path, 'utf8'), previous)
    assert.deepEqual(await readdir(dirname(path)), ['consistency-fixed-v2.json'])
    assert.equal(calls, stage === 'before-start' || stage === 'before-request' ? 0 : stage === 'late-provider' ? 1 : 5)
    if (stage === 'before-start') assert.equal(preparations, 0)
  })
}

for (const stage of ['preparation', 'between-batches', 'staged-report'] as const) {
  test(`switching books during ${stage} rejects the run without changing either report`, async context => {
    const first = await fixture(context)
    const second = await fixture(context)
    let active = first.root
    let calls = 0
    const runner = new ConsistencyEvaluationService({ prepareCompletion: async () => {
      if (stage === 'preparation') active = second.root
      return prepared(async instruction => {
        calls++
        if (stage === 'between-batches') active = second.root
        return emptyPrediction(instruction)
      })
    } }, { currentPath: async () => {
      if (stage === 'staged-report' && (await readdir(dirname(first.path))).some(name => name.endsWith('.tmp'))) active = second.root
      return active
    } })
    await assert.rejects(runner.run(new AbortController().signal), { code: 'CONFLICT' })
    assert.equal(calls, stage === 'preparation' ? 0 : stage === 'between-batches' ? 1 : 5)
    for (const item of [first, second]) {
      assert.equal(await readFile(item.path, 'utf8'), item.previous)
      assert.deepEqual(await readdir(dirname(item.path)), ['consistency-fixed-v2.json'])
    }
  })
}

test('a queued evaluation remains bound to the book that started it', async context => {
  const first = await fixture(context)
  const second = await fixture(context)
  let reads = 0
  const projects = { currentPath: async () => ++reads === 1 ? first.root : second.root }
  const runner = new ConsistencyEvaluationService({ prepareCompletion: async () => { throw new Error('must not prepare the second book') } }, projects)
  const jobs = new ConsistencyEvaluationJobService(runner, projects)
  const started = await jobs.start()
  for (let attempt = 0; attempt < 20 && jobs.status(started.id).status === 'running'; attempt++) {
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  const final = jobs.status(started.id)
  assert.equal(final.workItemId, first.root)
  assert.equal(final.status, 'failed')
  assert.equal(final.error?.code, 'CONFLICT')
  assert.equal(final.result, undefined)
  assert.equal(await readFile(first.path, 'utf8'), first.previous)
  assert.equal(await readFile(second.path, 'utf8'), second.previous)
})

test('guarded JSON writes commit when allowed and ordinary writes retain their existing behavior', async context => {
  const { path } = await fixture(context)
  let guards = 0
  await writeJson(path, { guarded: true }, async () => { guards++ })
  assert.equal(guards, 1)
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { guarded: true })
  await writeJson(path, { ordinary: true })
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { ordinary: true })
})
