import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fixture } from './helpers.ts'
import { HostedJobs } from '../src/tasks/jobs.ts'

for (const mode of ['request', 'tokens'] as const) test(`cancel preserves partials and honest ${mode} billing without automatic replay`, async t => {
  let calls = 0
  const f = fixture(t, async (_url, init) => {
    calls++
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"这是一份已收到的部分答复。"}}]}\n\n'))
      init?.signal?.addEventListener('abort', () => controller.error(new Error('synthetic cancellation')), { once: true })
    } }), { headers: { 'content-type': 'text/event-stream' } })
  })
  const user = await f.login(), other = await f.login('456'), owner = user.me.user.id
  const book = f.books.create(owner, { title: '中断样书', operation: 'recovery_book_1' })
  let chapterId = 0
  await f.runtimes.run(owner, book.id, async r => { chapterId = (await r.documents.createChapter()).id })
  f.models.update('admin', 'fixture', { name: '测试', protocol: 'openai-compatible', baseUrl: 'https://provider.example/v1', model: 'fixture-model', enabled: true, maxInputTokens: 100000, maxOutputTokens: 4096, expectedRevision: 0, apiKey: 'synthetic' })
  f.credits.updatePrice('admin', 'fixture', { expectedVersion: 0, policy: mode === 'request' ? { mode, points: 1000 } : { mode, inputPerMillion: 10000, outputPerMillion: 20000 } })
  const started = await f.jobs.start(owner, book.id, { operation: 'recovery_job_1', modelId: 'fixture', kind: 'writing', request: { chapterId, currentDraft: '', message: '分析本章', preferredSkill: 'query' } }) as { id: string }
  // Poll the persisted core partial, so cancellation does not depend on CPU timing.
  let partial = false
  for (let i = 0; i < 120; i++) {
    const job = await f.jobs.view(owner, book.id, started.id) as { task?: { partial?: { content: string } } }
    if (job.task?.partial?.content) { partial = true; break }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.equal(partial, true, JSON.stringify(await f.jobs.view(owner, book.id, started.id)))
  await assert.rejects(f.jobs.cancel(other.me.user.id, book.id, started.id), /not-found/)
  await f.jobs.cancel(owner, book.id, started.id)
  await f.jobs.settleForTest(started.id)
  const response = await f.app.inject({ url: `/api/books/${book.id}/jobs/${started.id}`, cookies: user.cookies }), value = response.json()
  assert.equal(value.status, 'cancelled', JSON.stringify({ status: value.status, task: value.task?.status, billing: value.billing }))
  assert.equal(value.task.partial.content, '这是一份已收到的部分答复。')
  assert.equal(value.task.artifact, undefined)
  assert.equal(calls, 1)
  if (mode === 'request') { assert.equal(value.billing.charged, 1000); assert.equal(value.billing.reserved, 0) }
  else { assert.equal(value.billing.charged, 0); assert.ok(value.billing.reserved > 0); assert.equal(value.billing.needsReconciliation, true) }
  const restarted = new HostedJobs(f.db, f.runtimes, f.meter)
  restarted.recoverAfterRestart(); f.credits.recoverAfterRestart()
  assert.equal(calls, 1)
  assert.deepEqual(await restarted.view(owner, book.id, started.id), await f.jobs.view(owner, book.id, started.id))
  await f.runtimes.run(owner, book.id, async r => assert.equal((await r.documents.chapter(chapterId)).content, ''))
})

test('restart marks incomplete jobs interrupted and never dispatches their saved requests', async t => {
  const f = fixture(t, async () => assert.fail('no replay')), user = await f.login(), owner = user.me.user.id
  const book = f.books.create(owner, { title: '崩溃恢复', operation: 'restart_book' })
  const id = randomUUID()
  f.db.run("INSERT INTO jobs(id,owner_id,book_id,model_id,model_revision,price_version,kind,status,request_json,created_at,updated_at) VALUES(?,?,?,'fixture',1,1,'writing','running','{}',0,0)", id, owner, book.id)
  f.jobs.recoverAfterRestart()
  assert.equal(f.db.get('SELECT status FROM jobs WHERE id=?', id)?.status, 'interrupted')
})
