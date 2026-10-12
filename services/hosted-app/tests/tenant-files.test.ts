import test from 'node:test'
import assert from 'node:assert/strict'
import { open, mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './helpers.ts'
import { assertTenantSpace } from '../src/files/quota.ts'

test('full storage rejects generation before calling provider and releases the unsent reservation', async t => {
  let calls = 0
  const f = fixture(t, async () => { calls++; throw new Error('must not send') }), user = await f.login(), owner = user.me.user.id
  const book = f.books.create(owner, { title: '容量测试', operation: 'quota_book_1' })
  let chapterId = 0
  await f.runtimes.run(owner, book.id, async r => {
    chapterId = (await r.documents.createChapter()).id
    const handle = await open(join(r.root, 'synthetic-capacity.bin'), 'wx')
    try { await handle.truncate(64 * 1024 * 1024) } finally { await handle.close() }
  })
  f.models.update('admin', 'fixture', { name: '测试', protocol: 'openai-compatible', baseUrl: 'https://provider.example/v1', model: 'fixture', enabled: true, maxInputTokens: 100000, maxOutputTokens: 4096, expectedRevision: 0, apiKey: 'synthetic' })
  f.credits.updatePrice('admin', 'fixture', { expectedVersion: 0, policy: { mode: 'request', points: 1000 } })
  const job = await f.jobs.start(owner, book.id, { operation: 'quota_job_1', modelId: 'fixture', kind: 'writing', request: { chapterId, currentDraft: '', message: '查询', preferredSkill: 'query' } }) as { id: string }
  await f.jobs.settleForTest(job.id)
  assert.equal(f.db.get('SELECT error_code FROM jobs WHERE id=?', job.id)?.error_code, 'quota-exceeded')
  assert.equal(calls, 0); assert.equal(f.credits.wallet(owner).available, 10000)
})

test('quota scan refuses a directory junction inside an owned book', async t => {
  const f = fixture(t), user = await f.login(), owner = user.me.user.id
  const book = f.books.create(owner, { title: '链接测试', operation: 'links_book_1' })
  await f.runtimes.run(owner, book.id, async r => {
    const target = join(f.root, 'outside-book'); await mkdir(target)
    await symlink(target, join(r.root, 'unexpected-link'), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(assertTenantSpace(f.root, owner, book.id, 1), /conflict/)
  })
})
