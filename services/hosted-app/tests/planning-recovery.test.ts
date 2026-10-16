import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { fixture } from './helpers.ts'
import { unwrapValidatedIpcResponse } from '../../../desktop/src/contracts/core/ipc-response'
import type { PlanningJob } from '../../../desktop/src/contracts/planning/types'

test('planning resume is owner-bound, metered and idempotent; details and save-only cannot invoke a model', async t => {
  let calls = 0, valid = false
  const f = fixture(t, async (_url, init) => {
    calls++
    const body = JSON.parse(String(init?.body)), prompt = body.messages.at(-1).content
    let result
    if (prompt.startsWith('复核下方')) result = { issues: valid ? [] : [{ category: 'continuity', quote: '不存在的逐字证据', parentQuote: '', reason: '核对', needsAuthor: false }] }
    else if (prompt.includes('"premise":"一句核心命题"')) result = { premise: '核对旧信', worldView: '现实城市', characters: [{ name: '张三', role: '调查者', arcSeed: '找到旧信来源' }], powerSystem: '', cheatSystem: '', rationale: '核对' }
    else if (prompt.includes('"volumes"')) result = { volumes: [{ order: 1, title: '旧信', goal: '调查', summary: '核对', ending: '释怀', storyContent: '张三找到寄信人，确认旧信来源。' }] }
    else result = { title: '旧信', summary: '调查', content: '张三找到寄信人。' }
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 } }), { headers: { 'content-type': 'application/json' } })
  })
  const user = await f.login(), foreign = await f.login('456')
  f.models.update('admin', 'opus', { name: '模型', protocol: 'openai-compatible', baseUrl: 'https://provider.example/v1', model: 'fixture-opus', enabled: true, maxInputTokens: 100000, maxOutputTokens: 4096, expectedRevision: 0, apiKey: 'synthetic' })
  f.credits.updatePrice('admin', 'opus', { expectedVersion: 0, policy: { mode: 'tokens', inputPerMillion: 1000, outputPerMillion: 3000 } })
  const book = f.books.create(user.me.user.id, { title: '谋篇恢复', operation: 'planning_recovery' })
  const request = (channel: string, args: unknown[] = [], who = user) => f.app.inject({ method: 'POST', url: `/api/books/${book.id}/desktop/${channel.replace(':', '/')}`, cookies: who.cookies, headers: who.headers, payload: { args, operation: randomUUID() } })
  const call = async <T>(channel: string, args: unknown[] = []): Promise<T> => { const r = await request(channel, args); assert.equal(r.statusCode, 200, r.body); assert.ok(!r.body.includes(f.root)); return unwrapValidatedIpcResponse(channel, r.json()) }
  const profile = await call<Record<string, unknown>>('workspace:get-book-profile')
  await call('workspace:save-book-profile', [{ ...profile, genre: '悬疑', plannedVolumes: 1 }])
  await call('workspace:save-foundation', [{ creationPath: 'materials', sourceNotes: '张三寻找旧信的寄信人。', worldView: '', useRealms: false, useSystem: false }])
  const first = await call<PlanningJob>('planning:start')
  const settle = async (id: string) => { const row = f.db.get('SELECT id FROM jobs WHERE core_task_id=?', id)!; await f.jobs.settleForTest(String(row.id)) }
  await settle(first.id)
  const failed = await call<PlanningJob>('planning:job', [first.id]); assert.equal(failed.status, 'failed', JSON.stringify(failed)); assert.equal(failed.recovery?.action, 'review'); assert.equal(calls, 3)
  const balance = f.credits.wallet(user.me.user.id).balance
  assert.equal((await request('planning:details', [first.id], foreign)).statusCode, 404)
  assert.match((await call<PlanningJob>('planning:details', [first.id])).rawResult!, /核对旧信/)
  assert.equal(calls, 3); assert.equal(f.credits.wallet(user.me.user.id).balance, balance)
  const wrongMode = await request('planning:retry-save', [first.id, randomUUID()]); assert.equal(wrongMode.json().ok, false); assert.equal(calls, 3)
  valid = true; const operation = randomUUID()
  const child = await call<PlanningJob>('planning:retry', [first.id, operation]); await settle(child.id)
  assert.equal((await call<PlanningJob>('planning:job', [child.id])).status, 'completed'); assert.equal(calls, 8)
  const charged = f.credits.wallet(user.me.user.id).balance; assert.ok(charged < balance)
  assert.equal((await call<PlanningJob>('planning:retry', [first.id, operation])).id, child.id); assert.equal(calls, 8); assert.equal(f.credits.wallet(user.me.user.id).balance, charged)
})
