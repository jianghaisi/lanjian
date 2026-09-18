import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { readLibraryLastEditedChapter } from '../../../src/main/modules/library/application/library-last-edited-chapter'

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-library-recent-'))
  try { await mkdir(join(root, '.webnovel')); await mkdir(join(root, '正文')); await run(root) }
  finally { await rm(root, { recursive: true, force: true }) }
}

test('empty shelf metadata stays empty without creating a database', () => fixture(async root => {
  assert.equal(await readLibraryLastEditedChapter(root), null)
  await assert.rejects(readFile(join(root, '.webnovel', 'workspace.sqlite')), { code: 'ENOENT' })
}))

test('legacy metadata uses actual modified chapter, not the highest chapter number', () => fixture(async root => {
  const first = join(root, '正文', '第10章-改过的标题.md')
  const second = join(root, '正文', '第30章-旧章节.md')
  await writeFile(first, '原文甲'); await writeFile(second, '原文乙')
  await utimes(first, new Date('2026-09-08T12:00:00Z'), new Date('2026-09-08T12:00:00Z'))
  await utimes(second, new Date('2026-09-07T12:00:00Z'), new Date('2026-09-07T12:00:00Z'))
  assert.deepEqual(await readLibraryLastEditedChapter(root), { id: 10, position: 1, title: '改过的标题', updatedAt: '2026-09-08T12:00:00.000Z' })
  assert.equal(await readFile(first, 'utf8'), '原文甲')
}))

test('formal metadata takes the current title and modification time from SQLite, never mirror timestamps', () => fixture(async root => {
  const path = join(root, '.webnovel', 'workspace.sqlite')
  const db = new DatabaseSync(path)
  db.exec(`CREATE TABLE projects(id TEXT, storage_mode TEXT);
    INSERT INTO projects VALUES('book', 'sqlite');
    CREATE TABLE chapters(project_id TEXT, legacy_chapter_id INTEGER, title TEXT, updated_at TEXT, seq INTEGER, status TEXT);
    INSERT INTO chapters VALUES('book', 91, '新标题', '2026-09-08T12:00:00.000Z', 10, 'draft');
    INSERT INTO chapters VALUES('book', 4, '下一章', '2026-09-07T12:00:00.000Z', 20, 'draft');
    INSERT INTO chapters VALUES('book', 99, '已归档', '2026-09-09T12:00:00.000Z', 30, 'archived');`)
  db.close()
  await writeFile(join(root, '正文', '第91章-过期镜像标题.md'), '镜像不可替代正式数据')
  const before = await readFile(path)
  assert.deepEqual(await readLibraryLastEditedChapter(root), { id: 91, position: 1, title: '新标题', updatedAt: '2026-09-08T12:00:00.000Z' })
  assert.deepEqual(await readFile(path), before)
}))

test('corrupt formal database does not fall back to a misleading mirror chapter', () => fixture(async root => {
  await writeFile(join(root, '.webnovel', 'workspace.sqlite'), 'not a database')
  await writeFile(join(root, '正文', '第1章-镜像.md'), '镜像')
  await assert.rejects(readLibraryLastEditedChapter(root))
}))
