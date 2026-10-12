import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './helpers.ts'
import { BookRuntimes } from '../src/writing/book-runtime.ts'
import { buildManuscriptExport } from '../../../desktop/src/main/modules/manuscript/application/manuscript-export-service'

test('real V3 file-authoritative storage isolates two users and four simultaneous books', async t => {
  const f = fixture(t), a = await f.login('100'), b = await f.login('200'), runtimes = new BookRuntimes(f.db, f.books)
  const inputs = [a, a, b, b].map((user, i) => ({ owner: user.me.user.id, book: f.books.create(user.me.user.id, { title: `样书 ${i}`, operation: `book_${i}_0001` }), content: `独立正文 ${i}。` }))
  await Promise.all(inputs.map(({ owner, book, content }) => runtimes.run(owner, book.id, async r => {
    const chapter = await r.documents.createChapter()
    await r.documents.updateChapter(chapter.id, { title: '第一章', content, expectedRevision: chapter.revision })
    await r.workspace.saveFoundation({ creationPath: 'materials', sourceNotes: '', worldView: '每个故事独立', useRealms: true, useSystem: true })
    await r.workspace.saveRealms([{ id: 'level-1', name: '初境', description: '刚刚开始修行' }])
    await r.workspace.saveSystemTemplate('[属性]\n[技能]\n[任务]')
    const db = await r.databases.openExisting(r.root)
    assert.equal(db?.textAuthority(), 'files-v1'); db?.close()
  })))
  const reopened = new BookRuntimes(f.db, f.books)
  for (const input of inputs) await reopened.run(input.owner, input.book.id, async r => {
    const chapters = await r.documents.chapters(); assert.equal(chapters.length, 1); assert.equal(chapters[0]?.content, input.content)
    const snapshot = await r.exports.prepare()
    assert.match(buildManuscriptExport(snapshot.title, snapshot.chapters, 'markdown'), new RegExp(input.content))
    assert.equal((await r.workspace.realms()).levels[0]?.name, '初境')
    assert.equal((await r.workspace.systemTemplate()).template, '[属性]\n[技能]\n[任务]')
  })
  await assert.rejects(reopened.run(b.me.user.id, inputs[0]!.book.id, async r => r.documents.chapters()), /not-found/)
})
test('stale edit, history restore and missing authoritative text never overwrite newer prose', async t => {
  const f = fixture(t), user = await f.login(), id = user.me.user.id, book = f.books.create(id, { title: '版本样书', operation: 'book_0001' })
  const runtime = new BookRuntimes(f.db, f.books)
  await runtime.run(id, book.id, async r => {
    const original = await r.documents.createChapter()
    const saved = await r.documents.updateChapter(original.id, { content: '版本一', expectedRevision: original.revision })
    const newer = await r.documents.updateChapter(original.id, { content: '版本二', expectedRevision: saved.revision })
    await assert.rejects(r.documents.updateChapter(original.id, { content: '迟到内容', expectedRevision: saved.revision }))
    assert.equal((await r.documents.chapter(original.id)).content, newer.content)
    const history = await r.documents.revisions(original.id)
    const first = history.find(x => x.content === '版本一')
    assert.ok(first)
    await r.documents.restoreRevision(original.id, first.id)
    assert.equal((await r.documents.chapter(original.id)).content, '版本一')
    const sqlite = await r.databases.openExisting(r.root)
    assert.ok(sqlite); sqlite.close()
    // Formal Markdown is the authority, never restored implicitly from the DB.
    const { readdir } = await import('node:fs/promises')
    const files = await readdir(join(r.root, '正文'))
    const path = join(r.root, '正文', files.find(name => name.endsWith('.md'))!)
    assert.equal(await readFile(path, 'utf8'), '版本一')
    await unlink(path)
    await assert.rejects(r.documents.chapter(original.id))
  })
})
