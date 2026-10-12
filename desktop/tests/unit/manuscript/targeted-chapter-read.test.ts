import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { type TestContext } from 'node:test'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { NewFileProjectStorage } from '../../../src/main/modules/library/application/new-file-project-storage'
import { CurrentProjectLegacyWorkspaceSource } from '../../../src/main/modules/library/application/legacy-workspace-source'
import { ShadowImportService } from '../../../src/main/modules/library/application/shadow-import-service'
import { DocumentService } from '../../../src/main/modules/manuscript/application/document-service'
import { SqliteManuscriptService } from '../../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { ManuscriptCommitJournal } from '../../../src/main/modules/manuscript/adapters/manuscript-commit-journal'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'

async function fixture(t: TestContext, count = 2, mode: 'files-v1' | 'legacy-sqlite' | 'files-only' = 'files-v1') {
  const parent = await realpath(tmpdir()), root = await mkdtemp(join(parent, 'lanjian-chapter-read-'))
  t.after(async () => {
    assert.equal(await realpath(root), root); assert.equal(dirname(root), parent)
    await rm(root, { recursive: true, force: true })
  })
  const databases = new SqliteWorkspaceDatabaseFactory(), storage = new NewFileProjectStorage(databases)
  const settings = new SettingsStore(join(root, 'profile'), { available: () => true, encrypt: value => value, decrypt: value => value })
  const projects = new ProjectService(settings, undefined, undefined, mode === 'files-v1' ? path => storage.initialize(path) : undefined)
  const { project } = await projects.create({ parentPath: root, name: '单章读取' })
  const authority = new SqliteManuscriptService(databases), documents = new DocumentService(projects, undefined, authority)
  const paths = new Map<number, string>()
  if (mode === 'files-v1') {
    const db = (await databases.openExisting(project.path))!
    try {
      for (let id = 1; id <= count; id++) {
        const result = db.writeFormalChapter({ legacyChapterId: id, title: `第${id}章`, content: `第${id}章的独立正文。`, reason: 'manual' })
        paths.set(id, join(project.path, result.chapter.mirrorRelativePath))
      }
    } finally { db.close() }
  } else {
    for (let id = 1; id <= count; id++) {
      const chapter = await documents.createChapter()
      await documents.updateChapter(chapter.id, { title: `第${id}章`, content: `第${id}章的独立正文。`, expectedRevision: chapter.revision })
    }
    if (mode === 'legacy-sqlite') {
      const source = new CurrentProjectLegacyWorkspaceSource(projects, documents), shadow = new ShadowImportService(source, databases)
      await shadow.import(await shadow.preview()); await authority.activate(project.path, await source.snapshot())
    }
  }
  return { root, project, projects, authority, documents, databases, paths }
}

test('one body read in a 440-chapter book reads only the selected current file', async t => {
  const f = await fixture(t, 440), full = await f.documents.chapters()
  const original = ManuscriptCommitJournal.prototype.readCurrent
  let reads = 0
  ManuscriptCommitJournal.prototype.readCurrent = function(path) { reads++; return original.call(this, path) }
  try {
    assert.deepEqual(await f.documents.chapter(220), full.find(chapter => chapter.id === 220))
    assert.equal(reads, 1)
    reads = 0
    await assert.rejects(f.documents.chapter(999), { code: 'NOT_FOUND' })
    assert.equal(reads, 0)
  } finally { ManuscriptCommitJournal.prototype.readCurrent = original }
})

test('selected file errors remain strict and unrelated corruption still rejects full lists', async t => {
  const f = await fixture(t), invalid = Buffer.from([0xff, 0xfe])
  await writeFile(f.paths.get(2)!, invalid)
  assert.equal((await f.documents.chapter(1)).content, '第1章的独立正文。')
  await assert.rejects(f.documents.chapter(2))
  await assert.rejects(f.documents.chapters())
  assert.deepEqual(await readFile(f.paths.get(2)!), invalid)
  await rm(f.paths.get(1)!)
  await assert.rejects(f.documents.chapter(1), { code: 'NOT_FOUND' })
})

test('point reads observe external edits, updated order and current book without caching', async t => {
  const f = await fixture(t)
  await f.documents.reorderChapter(2, 1)
  await writeFile(f.paths.get(1)!, '外部修改后的第一章。')
  const updated = await f.documents.chapter(1)
  assert.equal(updated.content, '外部修改后的第一章。'); assert.equal(updated.position, 2)
  const { project } = await f.projects.create({ parentPath: f.root, name: '另一部书' })
  await f.projects.switch(project.path)
  await assert.rejects(f.documents.chapter(1), { code: 'NOT_FOUND' })
  await f.projects.switch(f.project.path)
  assert.deepEqual(await f.documents.chapter(1), updated)
})

for (const mode of ['files-v1', 'legacy-sqlite', 'files-only'] as const) {
  test(`${mode} full-list DTO and older injected adapter parity`, async t => {
    const f = await fixture(t, 2, mode), expected = (await f.documents.chapters())[1]
    assert.deepEqual(await f.documents.chapter(2), expected)
    const old = new Proxy(f.authority, { get(target, key) {
      if (key === 'chapter') return undefined
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    } })
    assert.deepEqual(await new DocumentService(f.projects, undefined, old).chapter(2), expected)
  })
}

test('full lists resolve file authority once but keep fresh file contents and errors', async t => {
  const f = await fixture(t, 8), db = (await f.databases.openExisting(f.project.path))!
  try {
    db.writeFormalOutline({ legacyKey: 'total', nodeType: 'summary', seq: 1, title: '总纲', content: '旧信。' })
    db.writeFormalOutline({ legacyKey: 'volume-1', parentLegacyKey: 'total', nodeType: 'volume', seq: 1, title: '第一卷', content: '钟楼。' })
    for (let id = 1; id <= 8; id++) db.writeFormalOutline({ legacyKey: `chapter-${id}`, parentLegacyKey: 'volume-1', nodeType: 'chapter', seq: id, title: `第${id}章`, content: `章纲${id}` })
    const prepare = DatabaseSync.prototype.prepare
    let projectQueries = 0
    DatabaseSync.prototype.prepare = function(sql) {
      if (/SELECT \* FROM projects/i.test(sql)) projectQueries++
      return prepare.call(this, sql)
    }
    try {
      assert.equal(db.formalChapters().length, 8)
      assert.ok(projectQueries <= 4, `chapter identity queries: ${projectQueries}`)
      projectQueries = 0
      assert.equal(db.formalOutlines().length, 10)
      assert.ok(projectQueries <= 5, `outline identity queries: ${projectQueries}`)
      await writeFile(f.paths.get(1)!, '随后修改的正文。')
      assert.equal(db.formalChapters()[0].content, '随后修改的正文。')
      await writeFile(f.paths.get(1)!, Buffer.from([0xff]))
      assert.throws(() => db.formalChapters())
    } finally { DatabaseSync.prototype.prepare = prepare }
  } finally { db.close() }
})

test('async full-body reads preserve order and DTOs with at most eight concurrent reads', async t => {
  const f = await fixture(t, 12), db = (await f.databases.openExisting(f.project.path))!
  const original = ManuscriptCommitJournal.prototype.readCurrentAsync
  let active = 0, maximum = 0, reads = 0
  ManuscriptCommitJournal.prototype.readCurrentAsync = async function(path) {
    active++; reads++; maximum = Math.max(maximum, active)
    try { return await original.call(this, path) } finally { active-- }
  }
  try {
    assert.deepEqual(await db.formalChaptersAsync!(), db.formalChapters())
    assert.equal(reads, 12); assert.equal(maximum, 8); assert.equal(active, 0)
    await writeFile(f.paths.get(2)!, '外部新稿。')
    assert.deepEqual(await db.formalChaptersAsync!(), db.formalChapters())
    await writeFile(f.paths.get(2)!, Buffer.from([0xff]))
    await assert.rejects(db.formalChaptersAsync!())
    assert.equal(active, 0, 'failure must settle all started reads')
    assert.deepEqual(await readFile(f.paths.get(2)!), Buffer.from([0xff]))
  } finally { ManuscriptCommitJournal.prototype.readCurrentAsync = original; db.close() }
})

test('async list rejects metadata changes during acquisition and leaves the later write intact', async t => {
  const f = await fixture(t, 3), db = (await f.databases.openExisting(f.project.path))!
  const original = ManuscriptCommitJournal.prototype.readCurrentAsync
  let started!: () => void, release!: () => void, first = true
  const began = new Promise<void>(resolve => { started = resolve }), gate = new Promise<void>(resolve => { release = resolve })
  ManuscriptCommitJournal.prototype.readCurrentAsync = async function(path) {
    const result = await original.call(this, path)
    if (first) { first = false; started(); await gate }
    return result
  }
  const reading = db.formalChaptersAsync!()
  const rejected = assert.rejects(reading, { code: 'CONFLICT' })
  try {
    await began
    const writer = (await f.databases.openExisting(f.project.path))!
    try { writer.writeFormalChapter({ legacyChapterId: 1, title: '第1章', content: '并发写入的新稿。', reason: 'manual' }) }
    finally { writer.close() }
    release(); await rejected
    assert.equal(await readFile(f.paths.get(1)!, 'utf8'), '并发写入的新稿。')
    assert.equal((await db.formalChaptersAsync!())[0].content, '并发写入的新稿。')
  } finally { release(); await reading.catch(() => {}); ManuscriptCommitJournal.prototype.readCurrentAsync = original; db.close() }
})

test('async outline list matches synchronous current text and rejects missing outlines', async t => {
  const f = await fixture(t), db = (await f.databases.openExisting(f.project.path))!
  try {
    const result = db.writeFormalOutline({ legacyKey: 'total', nodeType: 'summary', seq: 1, title: '总纲', content: '总纲原文。' })
    const path = join(f.project.path, result.outline.mirrorRelativePath)
    assert.deepEqual(await db.formalOutlinesAsync!(), db.formalOutlines())
    await writeFile(path, '最新总纲。')
    assert.deepEqual(await db.formalOutlinesAsync!(), db.formalOutlines())
    await rm(path)
    await assert.rejects(db.formalOutlinesAsync!(), { code: 'NOT_FOUND' })
  } finally { db.close() }
})

test('async current-file reader rejects escaped junctions and invalid text like the sync reader', async t => {
  const f = await fixture(t), outside = join(f.root, 'outside'), link = join(f.project.path, '大纲', '外链')
  await mkdir(outside); await writeFile(join(outside, '稿.md'), '不能通过外链读取。')
  await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
  const journal = new ManuscriptCommitJournal(f.project.path)
  await assert.rejects(journal.readCurrentAsync('大纲/外链/稿.md'), { code: 'PATH_ESCAPE' })
  await assert.rejects(journal.readCurrentAsync('../稿.md'), { code: 'PATH_ESCAPE' })
  const path = f.paths.get(1)!, relative = path.slice(f.project.path.length + 1).replaceAll('\\', '/')
  await writeFile(path, '正文\0损坏')
  await assert.rejects(journal.readCurrentAsync(relative), { code: 'DATABASE_INTEGRITY_FAILED' })
  assert.throws(() => journal.readCurrent(relative), { code: 'DATABASE_INTEGRITY_FAILED' })
})
