import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'

test('HTTP writing uses real V3 saves, revision conflicts, definitions, import confirmation and export', async t => {
  const f = fixture(t), author = await f.login(), other = await f.login('456')
  const book = f.books.create(author.me.user.id, { title: '网页样书', operation: 'book_0001' }), base = `/api/books/${book.id}`
  const get = (path: string) => f.app.inject({ url: base + path, cookies: author.cookies })
  const post = (path: string, payload: unknown, method: 'POST' | 'PUT' = 'POST') => f.app.inject({ method, url: base + path, cookies: author.cookies, headers: author.headers, payload })
  const created = await post('/chapters', { operation: 'chapter_0001' })
  assert.equal(created.statusCode, 200, created.body)
  const chapter = created.json()
  const saved = await post(`/chapters/${chapter.id}`, { title: '雨夜', content: '雨水敲响窗台。', expectedRevision: chapter.revision }, 'PUT')
  assert.equal(saved.statusCode, 200, saved.body)
  assert.equal((await post(`/chapters/${chapter.id}`, { title: '旧稿', content: '不能覆盖', expectedRevision: chapter.revision }, 'PUT')).statusCode, 409)
  assert.equal((await post('/chapters', { operation: 'chapter_0001' })).json().id, chapter.id)
  const before = (await get('/foundation')).json()
  const changed = await post('/foundation', { data: { ...before.data, worldView: '城市里藏着秘密', useRealms: true, useSystem: true }, expectedRevision: before.revision }, 'PUT')
  assert.equal(changed.statusCode, 200, changed.body)
  assert.equal((await post('/foundation', { data: before.data, expectedRevision: before.revision }, 'PUT')).statusCode, 409)
  const preview = await post('/imports/preview', { filename: '补充.txt', content: '第一章 夜访\n灯光亮起。\n\n第二章 来客\n门被推开。' })
  assert.equal(preview.statusCode, 200, preview.body)
  assert.equal((await get('/chapters')).json().length, 1)
  const imported = await post('/imports/commit', { token: preview.json().token, ownership: 'owned', creationMethod: 'human', title: '补充', expectedWorkItemId: book.id, selectedChapterIndexes: [0, 1] })
  assert.equal(imported.statusCode, 200, imported.body)
  assert.equal((await get('/chapters')).json().length, 3)
  const download = await get('/export?format=txt')
  assert.equal(download.statusCode, 200); assert.match(download.body, /雨水敲响窗台/); assert.match(download.body, /灯光亮起/)
  const workspace = await get('/workspace')
  assert.equal(workspace.statusCode, 200, workspace.body)
  assert.ok(!workspace.body.includes(f.root)); assert.ok(!workspace.body.includes('workspace.sqlite'))
  for (const suffix of ['/workspace', '/export', `/chapters/${chapter.id}`, '/jobs']) {
    assert.equal((await f.app.inject({ url: base + suffix, cookies: other.cookies })).statusCode, 404)
  }
  assert.equal((await post('/imports/preview', { filename: '../../escape.txt', content: '拒绝' })).statusCode, 400)
})
