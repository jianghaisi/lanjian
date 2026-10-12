import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
  const parent = await realpath(tmpdir())
  const root = await mkdtemp(join(parent, 'lanjian-outline-read-'))
  t.after(async () => {
    assert.equal(await realpath(root), root)
    assert.equal(dirname(root), parent)
    await rm(root, { recursive: true, force: true })
  })
  const databases = new SqliteWorkspaceDatabaseFactory(), storage = new NewFileProjectStorage(databases)
  const settings = new SettingsStore(join(root, 'profile'), { available: () => true, encrypt: value => value, decrypt: value => value })
  const projects = new ProjectService(settings, undefined, undefined, mode === 'files-v1' ? path => storage.initialize(path) : undefined)
  const { project } = await projects.create({ parentPath: root, name: '单份大纲读取', genre: '悬疑' })
  const authority = new SqliteManuscriptService(databases)
  const documents = new DocumentService(projects, undefined, authority)
  const paths = new Map<number, string>()
  if (mode === 'files-v1') {
    const database = (await databases.openExisting(project.path))!
    try {
      database.writeFormalOutline({ legacyKey: 'total', nodeType: 'summary', seq: 1, title: '总纲', content: '追查旧信来源。' })
      database.writeFormalOutline({ legacyKey: 'volume-1', parentLegacyKey: 'total', nodeType: 'volume', seq: 1, title: '第一卷', content: '走访钟楼。' })
      for (let id = 1; id <= count; id++) {
        const result = database.writeFormalOutline({ legacyKey: `chapter-${id}`, parentLegacyKey: 'volume-1', nodeType: 'chapter', seq: id, title: `第${id}章`, content: `第${id}章的独立章纲。` })
        paths.set(id, join(project.path, result.outline.mirrorRelativePath))
      }
    } finally { database.close() }
  } else {
    await documents.updateOutline('total', '追查旧信来源。')
    await documents.updateOutline(1, '走访钟楼。')
    for (let id = 1; id <= count; id++) await documents.updateChapterOutline(id, `第${id}章的独立章纲。`)
    if (mode === 'legacy-sqlite') {
      const source = new CurrentProjectLegacyWorkspaceSource(projects, documents)
      const shadow = new ShadowImportService(source, databases)
      await shadow.import(await shadow.preview())
      await authority.activate(project.path, await source.snapshot())
    }
  }
  return { root, project, projects, documents, authority, databases, paths }
}

async function countCurrentReads<T>(read: () => Promise<T>) {
  const original = ManuscriptCommitJournal.prototype.readCurrent
  let count = 0
  ManuscriptCommitJournal.prototype.readCurrent = function(path) { count++; return original.call(this, path) }
  try { return { value: await read(), count } }
  finally { ManuscriptCommitJournal.prototype.readCurrent = original }
}

test('a 440-chapter outline book reads only the requested current text', async t => {
  const f = await fixture(t, 440)
  const full = await f.documents.outlines()
  for (const [label, read, expected] of [
    ['chapter', () => f.documents.chapterOutline(220), { chapterId: 220, content: '第220章的独立章纲。' }],
    ['total', () => f.documents.outline('total'), full.total],
    ['volume', () => f.documents.outline(1), full.volumes[0]]
  ] as const) {
    const observed = await countCurrentReads<{ content: string }>(read)
    assert.deepEqual(observed.value, expected)
    assert.equal(observed.count, 1, `${label} must read one current file`)
  }
  const missing = await countCurrentReads(() => f.documents.chapterOutline(999))
  assert.deepEqual(missing, { value: { chapterId: 999, content: '' }, count: 0 })
  const recovery = (await f.databases.openRecoveryReadOnly(f.project.path))!
  try {
    const observed = await countCurrentReads(async () => recovery.formalOutlines({ nodeType: 'chapter', seq: 220 }))
    assert.equal(observed.count, 1)
    assert.equal(observed.value[0]?.content, '第220章的独立章纲。')
  } finally { recovery.close() }
})

test('unrelated damaged text does not block a selected outline; full lists and selected damage still fail', async t => {
  const f = await fixture(t)
  const path = f.paths.get(2)!
  const invalid = Buffer.from([0xff, 0xfe])
  await writeFile(path, invalid)
  assert.equal((await f.documents.chapterOutline(1)).content, '第1章的独立章纲。')
  assert.equal((await f.documents.outline('total')).content, '追查旧信来源。')
  await assert.rejects(f.documents.chapterOutline(2))
  await assert.rejects(f.documents.outlines())
  assert.deepEqual(await readFile(path), invalid)
})

test('targeted reads see subsequent file edits and use the current book with unchanged missing defaults', async t => {
  const f = await fixture(t)
  await writeFile(f.paths.get(1)!, '作者刚刚修改了章纲。')
  assert.equal((await f.documents.chapterOutline(1)).content, '作者刚刚修改了章纲。')
  const { project: other } = await f.projects.create({ parentPath: f.root, name: '另一本空书' })
  await f.projects.switch(other.path)
  assert.deepEqual(await f.documents.chapterOutline(1), { chapterId: 1, content: '' })
  assert.deepEqual(await f.documents.outline('total'), { content: '' })
  assert.deepEqual(await f.documents.outline(9), { volume: 9, content: '' })
  await f.projects.switch(f.project.path)
  assert.equal((await f.documents.chapterOutline(1)).content, '作者刚刚修改了章纲。')
})

for (const mode of ['legacy-sqlite', 'files-only'] as const) {
  test(`${mode} and older injected authority adapters retain list/selection parity`, async t => {
    const f = await fixture(t, 2, mode)
    const full = await f.documents.outlines(), chapters = await f.documents.chapterOutlines()
    assert.deepEqual(await f.documents.outline('total'), full.total)
    assert.deepEqual(await f.documents.outline(1), full.volumes[0])
    assert.deepEqual(await f.documents.chapterOutline(2), chapters.find(chapter => chapter.chapterId === 2))
    const oldAdapter = new Proxy(f.authority, { get(target, key) {
      if (key === 'outline' || key === 'chapterOutline') return undefined
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    } })
    const fallback = new DocumentService(f.projects, undefined, oldAdapter)
    assert.deepEqual(await fallback.outline(1), full.volumes[0])
    assert.deepEqual(await fallback.chapterOutline(2), chapters.find(chapter => chapter.chapterId === 2))
  })
}
