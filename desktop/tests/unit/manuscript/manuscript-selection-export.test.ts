import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import type { Chapter, ProjectSummary } from '../../../src/contracts/index'
import { decodeManuscriptExportArgs } from '../../../src/contracts/manuscript/ipc'
import { unwrapValidatedIpcResponse } from '../../../src/contracts/core/ipc-response'
import { ManuscriptExportService } from '../../../src/main/modules/manuscript/application/manuscript-export-service'

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-selected-export-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const book = { id: 'book-a', path: join(root, 'a'), title: '合成甲书' }
  let currentPath = book.path
  const chapters: Chapter[] = [30, 10, 20].map((id, i) => ({ id, position: [3, 1, 2][i]!, title: `章名${id}`, content: `仅属于章节${id}的正文。`, word_count: 12, summary: '' }))
  const service = new ManuscriptExportService({ currentPath: async () => currentPath, currentSummary: async () => book as ProjectSummary }, { chapters: async () => chapters })
  return { root, book, chapters, service, switchBook: () => { currentPath = join(root, 'b') }, selection: { workItemId: book.id, workItemPath: book.path, chapterIds: [30, 10] } }
}

test('selection exports exact formal chapters in original order and retains original numbers', async t => {
  const f = await fixture(t)
  const target = join(f.root, 'selection.txt')
  const result = await f.service.export(target, f.selection)
  const text = await readFile(target, 'utf8')
  assert.equal(text, '合成甲书\n\n第1章　章名10\n\n仅属于章节10的正文。\n\n第3章　章名30\n\n仅属于章节30的正文。\n')
  assert.equal(result.chapterCount, 2)
  assert.equal(result.characterCount, Array.from(text).length)
  const all = await f.service.export(join(f.root, 'all.md'), { ...f.selection, chapterIds: [30, 20, 10] })
  assert.equal(all.chapterCount, 3)
  assert.match(await readFile(all.filePath, 'utf8'), /## 第2章　章名20/)
})

test('empty, duplicate, deleted and foreign-book selections cannot produce a file', async t => {
  const f = await fixture(t), target = join(f.root, 'invalid.txt')
  for (const selection of [
    { ...f.selection, chapterIds: [] }, { ...f.selection, chapterIds: [10, 10] },
    { ...f.selection, chapterIds: [10, 99] }, { ...f.selection, workItemId: 'book-b' },
    { ...f.selection, workItemPath: join(f.root, 'b') }
  ]) {
    await assert.rejects(f.service.export(target, selection), (error: { code?: string }) => ['CONFLICT', 'VALIDATION_ERROR'].includes(error.code || ''))
    await assert.rejects(access(target))
  }
  f.chapters.splice(0)
  await assert.rejects(f.service.export(target), { code: 'VALIDATION_ERROR' })
})

test('save-dialog snapshot retains chosen body and rejects a book switch after preparation', async t => {
  const f = await fixture(t)
  const snapshot = await f.service.prepare(f.selection)
  f.chapters[0]!.content = '保存框等待期间的另一份内容，不应混入快照。'
  await f.service.exportPrepared(snapshot, join(f.root, 'frozen.txt'))
  assert.doesNotMatch(await readFile(join(f.root, 'frozen.txt'), 'utf8'), /另一份内容/)
  f.switchBook()
  const target = join(f.root, 'switched.txt')
  await assert.rejects(f.service.exportPrepared(snapshot, target), { code: 'CONFLICT' })
  await assert.rejects(access(target))
})

test('cancellation has no reads and a failed write can retry with the same selected snapshot', async t => {
  const f = await fixture(t)
  assert.equal(await f.service.exportSelected(undefined, f.selection), null)
  const snapshot = await f.service.prepare(f.selection)
  await assert.rejects(f.service.exportPrepared(snapshot, join(f.root, 'missing-parent', 'reading.txt')), { code: 'ENOENT' })
  const retried = await f.service.exportPrepared(snapshot, join(f.root, 'retried.txt'))
  assert.equal(retried.chapterCount, 2)
})

test('IPC accepts legacy whole-book calls and rejects malformed or unrestricted selection payloads', () => {
  const selection = { workItemId: 'a', workItemPath: join(tmpdir(), 'a'), chapterIds: [10, 30] }
  assert.deepEqual(decodeManuscriptExportArgs([]), [undefined])
  assert.deepEqual(decodeManuscriptExportArgs([selection]), [selection])
  for (const input of [undefined, null, {}, { ...selection, extra: true }, { ...selection, chapterIds: [] },
    { ...selection, chapterIds: [10, 10] }, { ...selection, chapterIds: [0] }, { ...selection, chapterIds: ['10'] },
    { ...selection, chapterIds: [1.5] }, { ...selection, chapterIds: Array(100_001).fill(1) },
    { ...selection, workItemPath: 'relative' }, { ...selection, workItemId: '' }]) {
    assert.throws(() => decodeManuscriptExportArgs([input]), { code: 'VALIDATION_ERROR' })
  }
  assert.throws(() => decodeManuscriptExportArgs([selection, selection]), { code: 'VALIDATION_ERROR' })
  const result = { format: 'txt', filePath: join(tmpdir(), 'reading.txt'), chapterCount: 2, characterCount: 10 }
  assert.deepEqual(unwrapValidatedIpcResponse('projects:manuscript-export', { ok: true, value: result }), result)
  assert.equal(unwrapValidatedIpcResponse('projects:manuscript-export', { ok: true, value: null }), null)
  assert.throws(() => unwrapValidatedIpcResponse('projects:manuscript-export', { ok: true, value: { ...result, chapterCount: -1 } }), { code: 'INTERNAL_ERROR' })
})

test('a switch during atomic write preserves the existing output and removes the temporary file', async t => {
  const f = await fixture(t), target = join(f.root, 'existing.txt')
  await writeFile(target, '已有阅读稿，失败时应保留。')
  let reads = 0
  const service = new ManuscriptExportService({
    currentPath: async () => ++reads >= 4 ? join(f.root, 'b') : f.book.path,
    currentSummary: async () => f.book as ProjectSummary
  }, { chapters: async () => f.chapters })
  await assert.rejects(service.export(target, f.selection), { code: 'CONFLICT' })
  assert.equal(await readFile(target, 'utf8'), '已有阅读稿，失败时应保留。')
  assert.deepEqual(await readdir(f.root), ['existing.txt'])
})
