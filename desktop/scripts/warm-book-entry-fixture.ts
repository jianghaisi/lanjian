import assert from 'node:assert/strict'
import { realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { SqliteWorkspaceDatabaseFactory } from '../src/main/platform/storage/workspace-database'

// Test-only: the smoke creates this book, then closes Electron before seeding.
const [rootArg, bookArg] = process.argv.slice(2)
assert.ok(rootArg && bookArg, 'expected isolated smoke root and book')
const root = await realpath(rootArg), book = await realpath(bookArg)
assert.equal(dirname(root), await realpath(tmpdir()))
assert.ok(basename(root).startsWith('lanjian-warm-entry-'))
assert.equal(dirname(book), root)
assert.equal(basename(book), '再次进入甲书')
const database = await new SqliteWorkspaceDatabaseFactory().openExisting(book)
assert.ok(database, 'smoke-created formal database required')
const chapterCount = Number(process.env.WARM_ENTRY_FIXTURE_CHAPTERS || 440), charactersPerChapter = 2500
assert.ok(Number.isInteger(chapterCount) && chapterCount >= 1 && chapterCount <= 440)
const content = (id: number) => (`第${id}章：甲书的档案员沿着旧城钟楼寻找失踪信件，逐一核对日期、地点与人物。\n`).repeat(100).slice(0, charactersPerChapter)
try {
  assert.equal(database.formalChapterIds().length, 1, 'only seed a new one-chapter fixture')
  database.writeFormalOutline({ legacyKey: 'total', nodeType: 'summary', seq: 1, title: '总纲', content: '追查旧信来源。' })
  database.writeFormalOutline({ legacyKey: 'volume-1', parentLegacyKey: 'total', nodeType: 'volume', seq: 1, title: '第一卷', content: '走访钟楼。' })
  for (let id = 2; id <= chapterCount; id++) {
    database.writeFormalChapter({ legacyChapterId: id, title: `第${id}章`, content: content(id), reason: 'manual' })
  }
  for (let id = 1; id <= chapterCount; id++) {
    database.writeFormalOutline({ legacyKey: `chapter-${id}`, parentLegacyKey: 'volume-1', nodeType: 'chapter', seq: id, title: `第${id}章`, content: `第${id}章的独立章纲：走访旧城钟楼，核对旧信日期。`.repeat(8) })
  }
  database.writeFormalChapter({ legacyChapterId: 1, title: '第一章', content: content(1), reason: 'manual' })
  assert.equal(database.formalChapterIds().length, chapterCount)
} finally { database.close() }
await writeFile(join(root, 'long-book-fixture.json'), JSON.stringify({ chapterCount, charactersPerChapter, bodyCharacters: chapterCount * charactersPerChapter, outlineCount: chapterCount + 2, content: content(1) }, null, 2))
