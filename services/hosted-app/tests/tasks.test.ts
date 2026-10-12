import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'

test('hosted identity uses the tenant registry and context snapshots wait for ordinary sources', async t => {
  const f = fixture(t), user = await f.login(), owner = user.me.user.id
  const book = f.books.create(owner, { title: '注册书名', operation: 'snapshot_sequence' })
  await f.runtimes.run(owner, book.id, async r => {
    const chapter = await r.documents.createChapter()
    r.databases.readProjectIdentity = async () => { throw new Error('Desktop shelf snapshot must not supply hosted identity') }
    assert.equal((await r.projects.currentSummary({ includeManuscript: false })).title, '注册书名')
    let release!: () => void, entered!: () => void, snapshots = 0
    const hold = new Promise<void>(resolve => { release = resolve })
    const ready = new Promise<void>(resolve => { entered = resolve })
    const realms = r.workspace.realms.bind(r.workspace), open = r.databases.openEventReadOnly.bind(r.databases)
    r.workspace.realms = async () => { const value = await realms(); entered(); await hold; return value }
    r.databases.openEventReadOnly = async root => { snapshots++; return open(root) }
    const reading = r.workspace.promptContext(chapter.id, 'review')
    try {
      await ready
      await new Promise(resolve => setTimeout(resolve, 150))
      assert.equal(snapshots, 0, 'Do not acquire private snapshots while sibling source connections are unsettled')
    } finally { release() }
    assert.ok((await reading).includes('注册书名'))
    assert.ok(snapshots > 0)
  })
})

test('two owners generate concurrently in four real books without cross-book results', async t => {
  let calls = 0
  const f = fixture(t, async (_url, init) => {
    calls++
    const marker = String(init?.body).match(/TENANT_BOOK_[0-3]/)?.[0]
    assert.ok(marker)
    await new Promise(resolve => setTimeout(resolve, 80))
    return new Response(JSON.stringify({ choices: [{ message: { content: marker }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } }), { headers: { 'content-type': 'application/json' } })
  })
  const users = [await f.login('100'), await f.login('200')]
  f.models.update('admin', 'fixture', { name: '测试模型', protocol: 'openai-compatible', baseUrl: 'https://provider.example/v1', model: 'fixture-model', enabled: true, maxInputTokens: 100000, maxOutputTokens: 4096, expectedRevision: 0, apiKey: 'synthetic' })
  f.credits.updatePrice('admin', 'fixture', { expectedVersion: 0, policy: { mode: 'request', points: 1000 } })
  const inputs = await Promise.all([0, 1, 2, 3].map(async i => {
    const owner = users[i % 2]!.me.user.id
    const book = f.books.create(owner, { title: `并发样书${i}`, operation: `concurrent_book_${i}` })
    const chapterId = await f.runtimes.run(owner, book.id, async r => (await r.documents.createChapter()).id)
    return { owner, book, chapterId, marker: `TENANT_BOOK_${i}` }
  }))
  for (const wave of [inputs.slice(0, 2), inputs.slice(2)]) {
    await Promise.all(wave.map(async input => {
      const job = await f.jobs.start(input.owner, input.book.id, { operation: 'same_operation', modelId: 'fixture', kind: 'writing', request: { chapterId: input.chapterId, currentDraft: '', message: `分析 ${input.marker}`, preferredSkill: 'query' } }) as { id: string }
      await f.jobs.settleForTest(job.id)
      const value = await f.jobs.view(input.owner, input.book.id, job.id) as { status: string; task: { turn: { answer: string; workItemId: string } } }
      assert.equal(value.status, 'succeeded', JSON.stringify(value)); assert.equal(value.task.turn.answer, input.marker); assert.equal(value.task.turn.workItemId, input.book.id)
      const other = wave.find(x => x.book.id !== input.book.id)!
      await assert.rejects(f.jobs.view(input.owner, other.book.id, job.id), /not-found/)
    }))
  }
  assert.equal(calls, 4)
  for (const user of users) assert.equal(f.credits.wallet(user.me.user.id).balance, 8000)
})

test('durable writing job uses core query, metered operator API and one operation receipt', async t => {
  let calls = 0
  const f = fixture(t, async (_url, init) => {
    calls++
    assert.ok(new Headers(init?.headers).get('authorization')?.includes('synthetic-provider-key'))
    return new Response(JSON.stringify({ choices: [{ message: { content: '这一章写了雨夜来客。' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 } }), { headers: { 'content-type': 'application/json' } })
  })
  const user = await f.login(), other = await f.login('456'), owner = user.me.user.id
  const book = f.books.create(owner, { title: '任务样书', operation: 'book_0001' })
  let chapterId = 0
  await f.runtimes.run(owner, book.id, async r => {
    const chapter = await r.documents.createChapter(); chapterId = chapter.id
    await r.documents.updateChapter(chapter.id, { title: '雨夜', content: '来客敲了三下门。', expectedRevision: chapter.revision })
  })
  f.models.update('admin', 'fixture', { name: '测试模型', protocol: 'openai-compatible', baseUrl: 'https://provider.example/v1', model: 'fixture-model', enabled: true, maxInputTokens: 100000, maxOutputTokens: 4096, expectedRevision: 0, apiKey: 'synthetic-provider-key' })
  f.credits.updatePrice('admin', 'fixture', { expectedVersion: 0, policy: { mode: 'request', points: 1000 } })
  const payload = { operation: 'query_0001', modelId: 'fixture', kind: 'writing', request: { chapterId, currentDraft: '来客敲了三下门。', message: '这一章讲了什么？', preferredSkill: 'query' } }
  const start = () => f.app.inject({ method: 'POST', url: `/api/books/${book.id}/jobs`, cookies: user.cookies, headers: user.headers, payload })
  const started = await start(); assert.equal(started.statusCode, 200, started.body)
  const id = started.json().id
  await f.jobs.settleForTest(id)
  const result = await f.app.inject({ url: `/api/books/${book.id}/jobs/${id}`, cookies: user.cookies })
  assert.equal(result.statusCode, 200, result.body)
  assert.equal(result.json().status, 'succeeded', result.body)
  assert.equal(result.json().task.turn.answer, '这一章写了雨夜来客。')
  assert.equal(calls, 1); assert.equal(f.credits.wallet(owner).balance, 9000)
  assert.equal((await start()).json().id, id); assert.equal(calls, 1)
  assert.ok(!result.body.includes(f.root)); assert.ok(!result.body.includes('synthetic-provider-key'))
  assert.equal((await f.app.inject({ url: `/api/books/${book.id}/jobs/${id}`, cookies: other.cookies })).statusCode, 404)
  const malicious = await f.app.inject({ method: 'POST', url: `/api/books/${book.id}/jobs`, cookies: user.cookies, headers: user.headers, payload: { ...payload, request: { ...payload.request, modelConnectionId: 'evil' } } })
  assert.equal(malicious.statusCode, 400)
  await f.runtimes.run(owner, book.id, async r => assert.equal((await r.documents.chapter(chapterId)).content, '来客敲了三下门。'))
  await f.runtimes.run(owner, book.id, async r => {
    let release!: () => void, acquired!: () => void, opened = 0
    const acquiredPromise = new Promise<void>(resolve => { acquired = resolve })
    const hold = r.writes.run(r.root, async () => { acquired(); await new Promise<void>(resolve => { release = resolve }) })
    await acquiredPromise
    const original = r.databases.openExisting.bind(r.databases)
    r.databases.openExisting = async path => { opened++; return original(path) }
    const read = f.jobs.services(r).tasks.status(String(f.db.get('SELECT core_task_id FROM jobs WHERE id=?', id)?.core_task_id))
    try {
      await new Promise(resolve => setTimeout(resolve, 100))
      assert.equal(opened, 0, 'Task status must not open/close a checkpointing connection during a protected snapshot')
    } finally {
      release(); await hold; await read; r.databases.openExisting = original
    }
    assert.ok(opened > 0)
  })
})
