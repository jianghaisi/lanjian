// Synthetic container acceptance harness. Built separately and mounted read-only;
// never copied into the production image or exposed as an HTTP login endpoint.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { configFromEnv } from '../src/config.ts'
import { buildApp } from '../src/http/app.ts'
const evidence = '/evidence/state.json', mode = process.argv[2]
const config = configFromEnv()
let calls = 0
const f = buildApp({ config, oauth: {
  authorizationUrl: state => `https://connect.linux.do/oauth2/authorize?state=${state}`,
  exchange: async code => ({ subject: code, username: `container${code}`, name: '容器验收作者' })
}, modelFetcher: async () => {
  calls++
  return new Response(JSON.stringify({ choices: [{ message: { content: '合成模型保留人物动机，建议先核对旧信来源。' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 } }), { headers: { 'content-type': 'application/json' } })
} })
type Saved = { owners: string[]; sessions: { id: string; cookies: Record<string, string> }[]; referenceId: string; books: { owner: string; id: string; chapter: number; content: string; hash: string; history: number }[]; wallets: unknown[]; pending: unknown[]; ledger: unknown[]; modelKey: string }
const hash = (v: string) => createHash('sha256').update(v).digest('hex')
async function login(subject: string) {
  const start = await f.app.inject('/api/auth/linuxdo/start'), state = new URL(start.headers.location!).searchParams.get('state')!, browser = Object.fromEntries(start.cookies.map(c => [c.name, c.value]))
  const callback = await f.app.inject({ url: `/api/auth/linuxdo/callback?state=${state}&code=${subject}`, cookies: browser })
  assert.equal(callback.statusCode, 302)
  const cookies = Object.fromEntries(callback.cookies.filter(c => c.value).map(c => [c.name, c.value]))
  const me = (await f.app.inject({ url: '/api/me', cookies })).json()
  return { id: me.user.id as string, cookies, headers: { origin: config.origin, 'x-csrf-token': me.csrfToken as string } }
}
try {
  f.credits.recoverAfterRestart(); f.jobs.recoverAfterRestart()
  if (mode === 'seed') {
    assert.equal(f.identity.list().length, 0, 'Use a fresh isolated deployment root')
    const a = await login('901'), b = await login('902')
    const saved: Saved = { owners: [a.id, b.id], sessions: [{ id: a.id, cookies: a.cookies }, { id: b.id, cookies: b.cookies }], referenceId: '', books: [], wallets: [], pending: [], ledger: [], modelKey: 'synthetic-container-model-key' }
    f.models.update('test', 'container', { name: '容器测试模型', protocol: 'openai-compatible', baseUrl: 'https://synthetic.invalid/v1', model: 'fixture', enabled: true, maxInputTokens: 64000, maxOutputTokens: 4096, expectedRevision: 0, apiKey: saved.modelKey })
    f.credits.updatePrice('test', 'container', { expectedVersion: 0, policy: { mode: 'request', points: 1000 } })
    for (const [index, author] of [a, b].entries()) {
      assert.equal(f.credits.wallet(author.id).balance, 10000)
      for (let n = 0; n < 2; n++) {
        const book = f.books.create(author.id, { title: `容器样书 ${index}-${n}`, operation: `container_book_${n}` })
        const base = `/api/books/${book.id}`
        const first = await f.app.inject({ method: 'POST', url: base + '/chapters', cookies: author.cookies, headers: author.headers, payload: { operation: 'container_chapter' } })
        assert.equal(first.statusCode, 200, first.body)
        let chapter = first.json()
        for (let revision = 1; revision <= 2; revision++) {
          const result = await f.app.inject({ method: 'PUT', url: `${base}/chapters/${chapter.id}`, cookies: author.cookies, headers: author.headers, payload: { title: '旧城', content: `第 ${revision} 稿。作者 ${index} 的第 ${n} 本作品，中文正文与人物线索。`, expectedRevision: chapter.revision } })
          assert.equal(result.statusCode, 200, result.body); chapter = result.json()
        }
        assert.equal((await f.app.inject({ url: base + '/chapters', cookies: (index ? a : b).cookies })).statusCode, 404)
        const history = (await f.app.inject({ url: `${base}/chapters/${chapter.id}/history`, cookies: author.cookies })).json()
        saved.books.push({ owner: author.id, id: book.id, chapter: chapter.id, content: chapter.content, hash: hash(chapter.content), history: history.length })
        const request = { operation: 'container_paid_job', modelId: 'container', kind: 'writing', request: { chapterId: chapter.id, currentDraft: chapter.content, preferredSkill: 'query', message: '给出一条线索建议。' } }
        const job = await f.jobs.start(author.id, book.id, request) as { id: string }
        await f.jobs.settleForTest(job.id)
        const view = await f.jobs.view(author.id, book.id, job.id) as { status: string; billing: { charged: number } }
        assert.equal(view.status, 'succeeded', JSON.stringify(view)); assert.equal(view.billing.charged, 1000)
        assert.equal((await f.jobs.start(author.id, book.id, request) as { id: string }).id, job.id)
      }
    }
    assert.equal(calls, 4)
    const sample = await f.referenceCopies.copy(a.id); saved.referenceId = sample.id
    await f.runtimes.run(a.id, sample.id, async r => {
      const chapters = await r.documents.chapters(); assert.equal(chapters.length, 5)
      for (const summary of chapters) {
        const chapter = await r.documents.chapter(summary.id)
        saved.books.push({ owner: a.id, id: sample.id, chapter: chapter.id, content: chapter.content, hash: hash(chapter.content), history: (await r.documents.revisions(chapter.id)).length })
      }
    })
    assert.equal(calls, 4, 'Reference copy must not call a model')
    const uncertain = f.credits.reserve(a.id, 'container_unknown_receipt', 'container', 1000, 1)
    f.credits.markSent(uncertain.id); f.credits.markUnknown(uncertain.id)
    saved.wallets = saved.owners.map(id => f.credits.wallet(id)); saved.pending = f.credits.pending(); saved.ledger = saved.owners.map(id => f.credits.entries(id))
    await writeFile(evidence, JSON.stringify(saved, null, 2))
    process.stdout.write('SEED PASS: 2 owners, 4 authored books plus complete reference copy, 4 paid tasks, library sessions, duplicate receipts, revisions and one unknown reservation.\n')
  } else if (mode === 'diagnose') {
    for (const row of f.db.all("SELECT owner_id,book_id,id FROM jobs WHERE status='failed'")) {
      const value = await f.jobs.view(String(row.owner_id), String(row.book_id), String(row.id)) as { error: unknown; task: { error: unknown } }
      process.stdout.write(JSON.stringify({ error: value.error, taskError: value.task?.error }) + '\n')
    }
  } else if (mode === 'verify') {
    const saved: Saved = JSON.parse(await readFile(evidence, 'utf8'))
    for (const session of saved.sessions) assert.equal((await f.app.inject({ url: '/api/me', cookies: session.cookies })).json().user.id, session.id, 'Better Auth session survives full backup/restore')
    assert.equal((await f.referenceCopies.copy(saved.owners[0]!)).id, saved.referenceId)
    assert.deepEqual(saved.owners.map(id => f.credits.wallet(id)), saved.wallets)
    assert.deepEqual(f.credits.pending(), saved.pending)
    assert.deepEqual(saved.owners.map(id => f.credits.entries(id)), saved.ledger)
    assert.equal(f.models.privateConfiguration('container').apiKey, saved.modelKey)
    for (const book of saved.books) {
      assert.equal(f.books.get(book.owner, book.id).id, book.id)
      assert.throws(() => f.books.get(saved.owners.find(id => id !== book.owner)!, book.id), /not-found/)
      await f.runtimes.run(book.owner, book.id, async r => {
        assert.equal(hash((await r.documents.chapter(book.chapter)).content), book.hash)
        assert.equal((await r.documents.revisions(book.chapter)).length, book.history)
      })
    }
    assert.equal(calls, 0, 'No provider replay during restart or restore')
    process.stdout.write('VERIFY PASS: identities, ownership, balances, immutable ledger, unknown reservation, manuscripts, history and encrypted key survived without replay.\n')
  } else throw new Error('Choose seed or verify')
} finally { await f.app.close() }
