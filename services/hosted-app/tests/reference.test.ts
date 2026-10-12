import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeReferenceBook } from '@lanjian/hosted-contracts'
import { fixture } from './helpers.ts'
import { referenceBook } from '../src/reference/book.ts'

test('reference is complete, readable anonymously and exports all settings and the ending', async t => {
  const f = fixture(t)
  const response = await f.app.inject('/api/reference-book'), book = decodeReferenceBook(response.json())
  assert.equal(book.chapters.length, 5)
  for (const c of book.chapters) { assert.ok(c.content.length > 700); for (const field of ['时间：', '人物：', '地点：', '事件：', '结果：']) assert.ok(c.notes.includes(field)) }
  assert.match(book.chapters.at(-1)!.content, /全书完/)
  for (const field of ['沈禾', '听纹', '系统固定模板', '全书总纲', '分卷']) assert.ok(book.guide.includes(field))
  const exported = await f.app.inject('/api/reference-book/export')
  assert.match(exported.body, /全书完/); assert.match(exported.headers['content-disposition']!, /attachment/)
  assert.equal((await f.app.inject({ method: 'POST', url: '/api/reference-book/copy' })).statusCode, 401)
})
test('copy uses real V3 hierarchy for two owners, costs nothing, and repeated copy preserves edits', async t => {
  let modelCalls = 0
  const f = fixture(t, async () => { modelCalls++; throw new Error('Reference must never call models') })
  const a = await f.login(), b = await f.login('456')
  const request = { method: 'POST' as const, url: '/api/reference-book/copy', cookies: a.cookies, headers: a.headers, payload: {} }
  assert.equal((await f.app.inject({ ...request, headers: {} })).statusCode, 403)
  const [first, duplicate] = await Promise.all([f.app.inject(request), f.app.inject(request)])
  assert.equal(first.statusCode, 200, first.body); assert.equal(duplicate.json().id, first.json().id)
  const book = first.json()
  const second = await f.app.inject({ ...request, cookies: b.cookies, headers: b.headers })
  assert.equal(second.statusCode, 200, second.body); assert.notEqual(second.json().id, book.id)
  const own = await f.app.inject({ url: `/api/books/${book.id}/workspace`, cookies: a.cookies })
  assert.equal(own.statusCode, 200, own.body)
  assert.equal(own.json().chapters.length, 5); assert.equal(own.json().characters.length, 5)
  assert.equal((await f.app.inject({ url: `/api/books/${book.id}/workspace`, cookies: b.cookies })).statusCode, 404)
  await f.runtimes.run(a.me.user.id, book.id, async r => {
    assert.equal((await r.workspace.realms()).levels[0]!.name, '听纹')
    assert.match((await r.workspace.systemTemplate()).template, /\[任务\]/)
    assert.equal((await r.documents.outline('total')).content, referenceBook.totalOutline)
    const chapters = await r.documents.chapters()
    for (const [i, chapter] of chapters.entries()) {
      assert.equal((await r.documents.chapter(chapter.id)).content, referenceBook.chapters[i]!.content)
      assert.equal((await r.documents.chapterOutline(chapter.id)).content, referenceBook.chapters[i]!.outline)
    }
    const chapter = await r.documents.chapter(chapters[0]!.id)
    await r.documents.updateChapter(chapter.id, { title: '我的改写', content: '作者自己的第一稿。', expectedRevision: chapter.revision! })
  })
  assert.equal((await f.app.inject(request)).json().id, book.id)
  const exportA = await f.app.inject({ url: `/api/books/${book.id}/export`, cookies: a.cookies })
  assert.match(exportA.body, /作者自己的第一稿/); assert.match(exportA.body, /全书完/)
  const exportB = await f.app.inject({ url: `/api/books/${second.json().id}/export`, cookies: b.cookies })
  assert.ok(!exportB.body.includes('作者自己的第一稿'))
  assert.equal(f.credits.wallet(a.me.user.id).balance, 10000); assert.equal(f.credits.wallet(b.me.user.id).balance, 10000)
  assert.equal(modelCalls, 0); assert.equal(f.db.all('SELECT * FROM jobs').length, 0)
})
test('an interrupted private sample is hidden and resumes without duplicating chapters', async t => {
  const f = fixture(t), user = await f.login(), run = f.runtimes.run.bind(f.runtimes)
  let saves = 0, interrupt = true
  f.runtimes.run = (owner, id, operation) => run(owner, id, async r => {
    const save = r.documents.updateChapter.bind(r.documents)
    r.documents.updateChapter = async (...args) => {
      const result = await save(...args)
      if (interrupt && ++saves === 2) { interrupt = false; throw new Error('Synthetic interruption after durable prose') }
      return result
    }
    try { return await operation(r) } finally { r.documents.updateChapter = save }
  })
  const request = { method: 'POST' as const, url: '/api/reference-book/copy', cookies: user.cookies, headers: user.headers, payload: {} }
  assert.equal((await f.app.inject(request)).statusCode, 500)
  assert.equal((await f.app.inject({ url: '/api/books', cookies: user.cookies })).json().books.length, 0)
  const id = String(f.db.get('SELECT id FROM books')!.id)
  assert.equal((await f.app.inject({ url: `/api/books/${id}/chapters`, cookies: user.cookies })).statusCode, 404)
  const encoded = `%${id.charCodeAt(0).toString(16)}${id.slice(1)}`
  assert.equal((await f.app.inject({ url: `/api/books/${encoded}/chapters`, cookies: user.cookies })).statusCode, 404)
  const completed = await f.app.inject(request)
  assert.equal(completed.statusCode, 200, completed.body); assert.equal(completed.json().id, id)
  assert.equal((await f.app.inject({ url: `/api/books/${id}/chapters`, cookies: user.cookies })).json().length, 5)
})
