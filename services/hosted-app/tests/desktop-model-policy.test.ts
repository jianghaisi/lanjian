import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fixture } from './helpers.ts'
import { unwrapValidatedIpcResponse } from '../../../desktop/src/contracts/core/ipc-response'

test('only an administrator can select the single hosted model; book settings cannot override it', async t => {
  const f = fixture(t), user = await f.login(), admin = await f.login('42')
  for (const id of ['opus', 'other']) {
    f.models.update('admin', id, { name: id, protocol: 'openai-compatible', baseUrl: 'https://provider.example/v1', model: `fixture-${id}`, enabled: true, maxInputTokens: 100000, maxOutputTokens: 4096, expectedRevision: 0, apiKey: 'synthetic' })
    f.credits.updatePrice('admin', id, { expectedVersion: 0, policy: { mode: 'tokens', inputPerMillion: 1000, outputPerMillion: 3000 } })
  }
  const set = (who: typeof user, modelId: string | null, expectedRevision: number) => f.app.inject({ method: 'PUT', url: '/api/admin/active-model', cookies: who.cookies, headers: who.headers, payload: { modelId, expectedRevision } })
  assert.equal((await set(user, 'other', 0)).statusCode, 403)
  assert.equal((await set(admin, 'opus', 0)).statusCode, 200)
  assert.equal((await set(admin, 'other', 0)).statusCode, 409)
  assert.equal(f.models.selected()?.id, 'opus')
  const available = (await f.app.inject({ url: '/api/models', cookies: user.cookies })).json()
  assert.deepEqual(available.models.map((m: any) => m.id), ['opus'])
  const book = f.books.create(user.me.user.id, { title: '固定模型', operation: 'single_model_book' })
  const command = (name: string, args: unknown[] = []) => f.app.inject({ method: 'POST', url: `/api/books/${book.id}/desktop/${name.replace(':', '/')}`, cookies: user.cookies, headers: user.headers, payload: { args, operation: randomUUID() } })
  const settings = unwrapValidatedIpcResponse<any>('ai:get-settings', (await command('ai:get-settings')).json())
  assert.equal(settings.shared.model, 'fixture-opus'); assert.equal(settings.modelConfigured, true)
  assert.equal((await command('ai:update-settings', [{ shared: { model: 'fixture-other' } }])).statusCode, 404)
  assert.equal((await command('model-connections:saveBook', [{}])).statusCode, 404)
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/desktop/library/model-connections/saveDefaults', cookies: user.cookies, headers: user.headers, payload: { args: [{}], operation: randomUUID() } })).statusCode, 404)
  assert.equal((await set(admin, null, 1)).statusCode, 200)
  assert.equal(f.models.selected(), null)
})

test('original writing job uses the operator model and actual token bill, with durable semantic deduplication', async t => {
  let calls = 0
  const f = fixture(t, async (_url, init) => {
    calls++; assert.equal(JSON.parse(String(init?.body)).model, 'fixture-opus')
    return new Response(JSON.stringify({ choices: [{ message: { content: '灯火照着来路。' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 } }), { headers: { 'content-type': 'application/json' } })
  })
  const user = await f.login(), foreign = await f.login('456')
  f.models.update('admin', 'opus', { name: '唯一模型', protocol: 'openai-compatible', baseUrl: 'https://provider.example/v1', model: 'fixture-opus', enabled: true, maxInputTokens: 100000, maxOutputTokens: 4096, expectedRevision: 0, apiKey: 'synthetic' })
  f.credits.updatePrice('admin', 'opus', { expectedVersion: 0, policy: { mode: 'tokens', inputPerMillion: 1000, outputPerMillion: 3000 } })
  const book = f.books.create(user.me.user.id, { title: '单模型写作', operation: 'original_ai_book' })
  const chapter = await f.runtimes.run(user.me.user.id, book.id, r => r.documents.createChapter())
  const args = [{ operationId: randomUUID(), request: { chapterId: chapter.id, currentDraft: '', message: '这章可以从哪里开始？', preferredSkill: 'query', expectedWorkItemId: book.id } }]
  const start = (value = args, who = user) => f.app.inject({ method: 'POST', url: `/api/books/${book.id}/desktop/ai/start-writing-agent`, cookies: who.cookies, headers: who.headers, payload: { args: value, operation: randomUUID() } })
  assert.equal((await start(args, foreign)).statusCode, 404)
  const first = await start(); assert.equal(first.statusCode, 200, first.body)
  const task = unwrapValidatedIpcResponse<any>('ai:start-writing-agent', first.json())
  const job = f.db.get('SELECT id FROM jobs WHERE core_task_id=?', task.id)!
  await f.jobs.settleForTest(String(job.id))
  assert.equal(f.db.get('SELECT status FROM jobs WHERE id=?', job.id)?.status, 'succeeded')
  assert.equal(calls, 1); assert.equal(f.credits.wallet(user.me.user.id).balance, 9998)
  assert.equal(unwrapValidatedIpcResponse<any>('ai:start-writing-agent', (await start()).json()).id, task.id)
  assert.equal(calls, 1)
  const altered = [{ operationId: randomUUID(), request: { ...args[0]!.request, model: 'unauthorized-model' } }]
  assert.equal((await start(altered)).statusCode, 400)
  assert.equal(calls, 1)
  assert.ok(!first.body.includes(f.root)); assert.ok(!first.body.includes('synthetic'))
})
