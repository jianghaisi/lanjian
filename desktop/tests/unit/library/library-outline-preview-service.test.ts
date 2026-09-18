import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { LibraryOutlinePreviewService } from '../../../src/main/modules/library/application/library-outline-preview-service'
import { decodeLibraryOutlineArgs, decodeLibraryOutlineResult } from '../../../src/contracts/library/library-outline-preview'

async function fixture(context: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-library-preview-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, '正文'))
  await mkdir(join(root, '.webnovel', 'planning'), { recursive: true })
  const registry = { load: async () => ({ recentProjects: [root] }) }
  return { root, service: new LibraryOutlinePreviewService(registry) }
}

test('library preview reads real file hierarchy without reading prose or switching a project', async context => {
  const { root, service } = await fixture(context)
  const prose = '这是本地正文，预览不应读取它。'
  await writeFile(join(root, '正文', '第1章-开篇.md'), prose)
  await writeFile(join(root, '正文', '第2章-重号A.md'), prose)
  await writeFile(join(root, '正文', '第2章-重号B.md'), prose)
  await writeFile(join(root, '.webnovel', 'planning', 'outline-state.json'), JSON.stringify({ volumes: [{ volume: 1, title: '雨城篇' }], chapterPlacements: [{ chapterId: 1, volume: 1 }] }))
  const before = await readdir(join(root, '.webnovel'))
  const preview = await service.preview({ path: root, offset: 0 })
  assert.equal(preview.source, 'files')
  assert.equal(preview.totalChapters, 2)
  assert.deepEqual(preview.volumes, [{ id: 1, title: '雨城篇' }])
  assert.equal(preview.chapters[0]?.volume, 1)
  assert.equal(preview.chapters[0]?.wordCount, null)
  assert.equal(preview.chapters[0]?.status, 'unknown')
  assert.equal(preview.chapters[1]?.canOpen, false)
  assert.equal(preview.chapters[1]?.volume, null)
  assert.deepEqual(await readdir(join(root, '.webnovel')), before)
  assert.equal(await readFile(join(root, '正文', '第1章-开篇.md'), 'utf8'), prose)
  assert.deepEqual(decodeLibraryOutlineResult(preview), preview)
})

test('SQLite library preview reads formal data and its exact volume authority without upgrading or mirroring', async context => {
  const { root, service } = await fixture(context)
  await writeFile(join(root, '正文', '第1章-错误镜像标题.md'), '镜像不应成为正式来源')
  await writeFile(join(root, '.webnovel', 'planning', 'outline-state.json'), JSON.stringify({ volumes: [{ volume: 1, title: '错误镜像卷' }], chapterPlacements: [{ chapterId: 1, volume: 1 }] }))
  const file = join(root, '.webnovel', 'workspace.sqlite')
  const db = new DatabaseSync(file)
  db.exec(`PRAGMA user_version = 28;
    CREATE TABLE projects(id TEXT, storage_mode TEXT, outline_planning_state_ready INTEGER);
    CREATE TABLE chapters(id TEXT, project_id TEXT, legacy_chapter_id INTEGER, seq INTEGER, title TEXT, status TEXT, current_body_version_id TEXT, updated_at TEXT);
    CREATE TABLE body_versions(id TEXT, chapter_id TEXT, content TEXT);
    CREATE TABLE outline_planning_state_documents(project_id TEXT, content_json TEXT);
    INSERT INTO projects VALUES('p', 'sqlite', 1);`)
  db.prepare('INSERT INTO outline_planning_state_documents VALUES (?, ?)').run('p', JSON.stringify({ volumes: [{ volume: 2, title: '正式第二卷' }], chapterPlacements: [{ chapterId: 1, volume: 2 }] }))
  for (let index = 1; index <= 65; index++) {
    db.prepare('INSERT INTO chapters VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(`c${index}`, 'p', index, index, `正式标题${index}`, index === 1 ? 'confirmed' : 'draft', `b${index}`, '2026-09-08T08:00:00Z')
    db.prepare('INSERT INTO body_versions VALUES (?, ?, ?)').run(`b${index}`, `c${index}`, '雨落在城市。hello world')
  }
  db.close()
  const bytes = await readFile(file)
  const preview = await service.preview({ path: root, offset: 0 })
  assert.equal(preview.source, 'sqlite')
  assert.equal(preview.chapters.length, 60)
  assert.equal(preview.nextOffset, 60)
  assert.equal(preview.totalChapters, 65)
  assert.equal(preview.chapters[0]?.title, '正式标题1')
  assert.equal(preview.chapters[0]?.status, 'confirmed')
  assert.equal(preview.chapters[0]?.wordCount, 7)
  assert.equal(preview.chapters[0]?.volume, 2)
  assert.deepEqual(preview.volumes, [{ id: 2, title: '正式第二卷' }])
  const next = await service.preview({ path: root, offset: 60 })
  assert.equal(next.chapters.length, 5)
  assert.equal(next.nextOffset, null)
  assert.deepEqual(await readFile(file), bytes)
  const verify = new DatabaseSync(file, { readOnly: true })
  assert.equal(verify.prepare('PRAGMA user_version').get()?.user_version, 28)
  verify.close()
  assert.equal(await readFile(join(root, '正文', '第1章-错误镜像标题.md'), 'utf8'), '镜像不应成为正式来源')
})

test('preview rejects unregistered directories and corrupt databases instead of falling back to mirrors', async context => {
  const { root, service } = await fixture(context)
  await assert.rejects(new LibraryOutlinePreviewService({ load: async () => ({ recentProjects: [] }) }).preview({ path: root, offset: 0 }), { code: 'VALIDATION_ERROR' })
  await writeFile(join(root, '正文', '第1章-不能回退.md'), '旧正文')
  await writeFile(join(root, '.webnovel', 'workspace.sqlite'), 'broken SQLite')
  await assert.rejects(service.preview({ path: root, offset: 0 }), { code: 'INVALID_PROJECT_STATE' })
  assert.equal(await readFile(join(root, '.webnovel', 'workspace.sqlite'), 'utf8'), 'broken SQLite')
})

test('preview rejects symlink/junction escapes before directory or database reads', async context => {
  const { root, service } = await fixture(context)
  const outside = await mkdtemp(join(tmpdir(), 'lanjian-library-outside-'))
  context.after(() => rm(outside, { recursive: true, force: true }))
  await rm(join(root, '正文'), { recursive: true })
  await symlink(outside, join(root, '正文'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(service.preview({ path: root, offset: 0 }), { code: 'PATH_ESCAPE' })
})

test('preview does not guess ambiguous volume placements and validates IPC boundaries', async context => {
  const { root, service } = await fixture(context)
  await writeFile(join(root, '.webnovel', 'planning', 'outline-state.json'), JSON.stringify({ volumes: [{ volume: 1, title: '第一卷' }], chapterPlacements: [{ chapterId: 1, volume: 9 }] }))
  await assert.rejects(service.preview({ path: root, offset: 0 }), { code: 'INVALID_PROJECT_STATE' })
  assert.deepEqual(decodeLibraryOutlineArgs([{ path: root, offset: 0 }]), [{ path: root, offset: 0 }])
  for (const input of [{ path: root, offset: -1 }, { path: root, offset: 0, sql: 'DROP TABLE chapters' }, { path: 'relative', offset: 0 }, { path: root, offset: 1.5 }]) assert.throws(() => decodeLibraryOutlineArgs([input]), { code: 'VALIDATION_ERROR' })
  assert.throws(() => decodeLibraryOutlineResult({ source: 'sqlite', chapters: [{ id: 1 }], volumes: [], totalChapters: 1, offset: 0, nextOffset: null, notice: '' }))
})
