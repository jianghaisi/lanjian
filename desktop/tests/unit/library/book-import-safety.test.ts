import assert from 'node:assert/strict'
import { mkdtemp, realpath, readFile, writeFile, mkdir, readdir, rm, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'
import { WorkspaceWriteCoordinator } from '../../../src/main/core/application/workspace-write-coordinator'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { NewFileProjectStorage } from '../../../src/main/modules/library/application/new-file-project-storage'
import { BookImportService } from '../../../src/main/modules/library/application/book-import-service'
import { DocumentService } from '../../../src/main/modules/manuscript/application/document-service'
import { SqliteManuscriptService } from '../../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../../src/main/modules/library/application/legacy-workspace-source'
import { ShadowImportService } from '../../../src/main/modules/library/application/shadow-import-service'

async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-import-safety-')))
  t.after(async () => { assert.equal(await realpath(root), root); await rm(root, { recursive: true, force: true }) })
  const databases = new SqliteWorkspaceDatabaseFactory()
  const initializer = new NewFileProjectStorage(databases)
  const settings = new SettingsStore(join(root, 'profile'), { available: () => false, encrypt: () => '', decrypt: () => '' })
  const projects = new ProjectService(settings, undefined, path => databases.readProjectIdentity(path), path => initializer.initialize(path))
  const { project: a } = await projects.create({ parentPath: root, name: '测试甲', genre: '玄幻' })
  const { project: b } = await projects.create({ parentPath: root, name: '测试乙', genre: '玄幻' })
  await projects.switch(a.path)
  const db = await databases.openExisting(a.path)
  assert.equal(db?.textAuthority(), 'files-v1'); db?.close()
  const documents = new DocumentService(projects, undefined, new SqliteManuscriptService(databases, undefined, new WorkspaceWriteCoordinator()))
  const imports = new BookImportService(projects, documents)
  const source = async (name: string) => {
    const path = join(root, `${name}.txt`)
    await writeFile(path, `第一章 ${name}\n临时正文：${name}。`)
    return path
  }
  const request = async (name: string) => ({ token: (await imports.previewFile(await source(name))).token,
    title: name, ownership: 'owned' as const, creationMethod: 'human' as const })
  const ledgerPath = join(a.path, '.webnovel/imports/index.json')
  return { root, projects, a, b, documents, imports, request, source, ledgerPath }
}

test('files-v1 imports append distinct chapters and preserve both ledger records under concurrency', async t => {
  const f = await fixture(t)
  const one = await f.request('来源甲'), two = await f.request('来源乙')
  const results = await Promise.all([f.imports.commit(one), f.imports.commit(two)])
  assert.equal(new Set(results.flatMap(x => x.importedChapterIds)).size, 2)
  assert.deepEqual((await f.documents.chapters()).map(c => c.content).sort(), ['临时正文：来源乙。', '临时正文：来源甲。'].sort())
  assert.equal(JSON.parse(await readFile(f.ledgerPath, 'utf8')).records.length, 2)
})

test('accepted manifest remains in its original files-v1 book after navigation', async t => {
  const f = await fixture(t)
  const imports = new BookImportService(f.projects, f.documents, undefined, async () => { await f.projects.switch(f.b.path) })
  const preview = await imports.previewFiles([await f.source('原书来源')])
  const result = await imports.commitManifest({ id: preview.id, files: preview.files.map(file => ({ token: file.token,
    title: file.suggestedTitle, ownership: 'owned', creationMethod: 'human' })) })
  assert.equal(result.status, 'completed')
  assert.equal((await f.documents.chapters()).length, 0, 'visible B must stay empty')
  await f.projects.switch(f.a.path)
  assert.equal((await f.documents.chapters()).length, 1)
  assert.equal(JSON.parse(await readFile(f.ledgerPath, 'utf8')).records.length, 1)
})

test('corrupt ledger is not reset and cannot allow the same source twice', async t => {
  const f = await fixture(t)
  await f.imports.commit(await f.request('唯一来源'))
  const raw = '{"version":1,"records":['
  await writeFile(f.ledgerPath, raw)
  const before = await f.documents.chapters()
  await assert.rejects(f.imports.commit(await f.request('唯一来源')))
  assert.equal(await readFile(f.ledgerPath, 'utf8'), raw)
  assert.deepEqual(await f.documents.chapters(), before)
})

test('same token cannot be used twice concurrently', async t => {
  const f = await fixture(t), input = await f.request('单次授权')
  const results = await Promise.allSettled([f.imports.commit(input), f.imports.commit(input)])
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1)
  assert.equal((await f.documents.chapters()).length, 1)
  assert.equal(JSON.parse(await readFile(f.ledgerPath, 'utf8')).records.length, 1)
})

for (const raw of ['null', '{"version":2,"records":[]}', '{"version":1,"records":[{}]}']) {
  test(`invalid ledger fails before creating any chapter: ${raw}`, async t => {
    const f = await fixture(t)
    await mkdir(join(f.a.path, '.webnovel/imports'), { recursive: true })
    await writeFile(f.ledgerPath, raw)
    await assert.rejects(f.imports.commit(await f.request('拒绝来源')))
    assert.equal(await readFile(f.ledgerPath, 'utf8'), raw)
    assert.deepEqual(await f.documents.chapters(), [])
  })
}

test('missing index with archived sources is not a fresh import', async t => {
  const f = await fixture(t)
  const archive = join(f.a.path, '.webnovel/imports/sources')
  await mkdir(archive, { recursive: true }); await writeFile(join(archive, 'retained.txt'), '原导入证据')
  await assert.rejects(f.imports.commit(await f.request('不能掩盖旧账本')))
  assert.deepEqual(await f.documents.chapters(), [])
  assert.deepEqual(await readdir(archive), ['retained.txt'])
})

test('wrong expected destination rejects without consuming a valid preview or writing', async t => {
  const f = await fixture(t), input = await f.request('归属确认')
  await assert.rejects(f.imports.commit({ ...input, expectedWorkItemId: f.b.path }), { code: 'CONFLICT' })
  assert.deepEqual(await f.documents.chapters(), [])
  await assert.rejects(readFile(f.ledgerPath), { code: 'ENOENT' })
  await f.imports.commit({ ...input, expectedWorkItemId: f.a.path })
  assert.equal((await f.documents.chapters()).length, 1)
})

test('ordinary new chapter and an import allocate different identities', async t => {
  const f = await fixture(t), input = await f.request('并行新建')
  const [imported, created] = await Promise.all([f.imports.commit(input), f.documents.createChapter()])
  assert.notEqual(imported.importedChapterIds[0], created.id)
  assert.equal((await f.documents.chapters()).length, 2)
})

test('concurrent edit of the allocated chapter is preserved and fresh-preview restart cannot replay partial import', async t => {
  const f = await fixture(t)
  const originalCreate = f.documents.createChapter.bind(f.documents)
  f.documents.createChapter = async () => {
    const created = await originalCreate()
    await f.documents.updateChapter(created.id, { title: '作者编辑', content: '必须保留的作者输入', expectedRevision: created.revision })
    return created
  }
  await assert.rejects(f.imports.commit(await f.request('写入冲突')), { code: 'CONFLICT' })
  const before = await f.documents.chapters()
  assert.equal(before[0].content, '必须保留的作者输入')
  const restarted = new BookImportService(f.projects, f.documents)
  const preview = await restarted.previewFile(await f.source('写入冲突'))
  await assert.rejects(restarted.commit({ token: preview.token, ownership: 'owned', title: '重新预览' }), { code: 'CONFLICT' })
  assert.deepEqual(await f.documents.chapters(), before)
  const receipts = await readdir(join(f.a.path, '.webnovel/imports/operations'))
  assert.equal(receipts.length, 1)
  assert.equal(JSON.parse(await readFile(join(f.a.path, '.webnovel/imports/operations', receipts[0]), 'utf8')).status, 'running')
})

test('external ledger replacement during a chapter write is preserved and prevents replay', async t => {
  const f = await fixture(t)
  await f.imports.commit(await f.request('原账本'))
  const replacement = JSON.stringify({ version: 1, records: [], marker: '外部修改不能覆盖' })
  const originalUpdate = f.documents.updateChapter.bind(f.documents)
  f.documents.updateChapter = async (...args) => {
    const result = await originalUpdate(...args)
    await writeFile(f.ledgerPath, replacement)
    return result
  }
  await assert.rejects(f.imports.commit(await f.request('发布前冲突')), { code: 'CONFLICT' })
  assert.equal(await readFile(f.ledgerPath, 'utf8'), replacement)
  const before = await f.documents.chapters()
  await assert.rejects(f.imports.commit(await f.request('发布前冲突')), { code: 'CONFLICT' })
  assert.deepEqual(await f.documents.chapters(), before)
})

test('same manifest is claimed once, while a completed identical replay does not create chapters', async t => {
  const f = await fixture(t), preview = await f.imports.previewFiles([await f.source('清单')])
  const input = { id: preview.id, files: preview.files.map(file => ({ token: file.token, ownership: 'owned' as const, title: file.suggestedTitle })) }
  const attempts = await Promise.allSettled([f.imports.commitManifest(input), f.imports.commitManifest(input)])
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1)
  const replay = await f.imports.commitManifest(input)
  assert.equal(replay.results[0].importedChapterIds.length, 1)
  assert.equal((await f.documents.chapters()).length, 1)
})

test('different books progress independently while an accepted manifest waits', async t => {
  const f = await fixture(t)
  let entered!: () => void, release!: () => void
  const arrived = new Promise<void>(r => { entered = r }), barrier = new Promise<void>(r => { release = r })
  const imports = new BookImportService(f.projects, f.documents, undefined, async () => { entered(); await barrier })
  const preview = await imports.previewFiles([await f.source('后台甲')])
  const pending = imports.commitManifest({ id: preview.id, files: preview.files.map(file => ({ token: file.token, ownership: 'owned', title: '甲' })) })
  try {
    await arrived
    await f.projects.switch(f.b.path)
    const previewB = await imports.previewFile(await f.source('前台乙'))
    await imports.commit({ token: previewB.token, ownership: 'owned', title: '乙' })
    assert.equal((await f.documents.chapters()).length, 1)
  } finally { release(); await pending }
  await f.projects.switch(f.a.path)
  assert.equal((await f.documents.chapters()).length, 1)
})

test('replacement of the captured root rejects publication and leaves the replacement untouched', async t => {
  const f = await fixture(t)
  const moved = join(f.root, 'moved-original')
  const imports = new BookImportService(f.projects, f.documents, undefined, async () => {
    await rename(f.a.path, moved); await mkdir(f.a.path)
    await writeFile(join(f.a.path, 'sentinel.txt'), '新目录不是原作品')
  })
  const preview = await imports.previewFiles([await f.source('身份检查')])
  await assert.rejects(imports.commitManifest({ id: preview.id, files: preview.files.map(file => ({ token: file.token, ownership: 'owned', title: '甲' })) }), { code: 'CONFLICT' })
  assert.deepEqual(await readdir(f.a.path), ['sentinel.txt'])
})

test('recovery-only ledger never authorizes silent initialization', async t => {
  const f = await fixture(t)
  await mkdir(join(f.a.path, '.webnovel/imports'), { recursive: true })
  const raw = '{"version":1,"records":[]}'
  await writeFile(`${f.ledgerPath}.recovery`, raw)
  await assert.rejects(f.imports.commit(await f.request('待核对')), { code: 'CONFLICT' })
  assert.equal(await readFile(`${f.ledgerPath}.recovery`, 'utf8'), raw)
  await assert.rejects(readFile(f.ledgerPath), { code: 'ENOENT' })
})

test('two fresh tokens for identical bytes can publish only one source', async t => {
  const f = await fixture(t), one = await f.request('同源'), two = await f.request('同源')
  const results = await Promise.allSettled([f.imports.commit(one), f.imports.commit(two)])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal((await f.documents.chapters()).length, 1)
  assert.equal(JSON.parse(await readFile(f.ledgerPath, 'utf8')).records.length, 1)
})

test('failed source archive preserves the existing bytes and blocks fresh-preview replay after restart', async t => {
  const f = await fixture(t), path = await f.source('原件故障')
  const digest = createHash('sha256').update(await readFile(path)).digest('hex')
  const archive = join(f.a.path, `.webnovel/imports/sources/${digest}.txt`)
  await mkdir(join(f.a.path, '.webnovel/imports/sources'), { recursive: true })
  await writeFile(f.ledgerPath, '{"version":1,"records":[]}')
  await writeFile(archive, '已有原件不可替换')
  await assert.rejects(f.imports.commit(await f.request('原件故障')), { code: 'CONFLICT' })
  assert.equal(await readFile(archive, 'utf8'), '已有原件不可替换')
  assert.equal((await f.documents.chapters()).length, 0)
  const restarted = new BookImportService(f.projects, f.documents)
  await assert.rejects(restarted.commit({ token: (await restarted.previewFile(path)).token, ownership: 'owned', title: '重试' }), { code: 'CONFLICT' })
  assert.equal(await readFile(archive, 'utf8'), '已有原件不可替换')
})

test('chapter allocation failure retains the source and running evidence without permitting restart replay', async t => {
  const f = await fixture(t), create = f.documents.createChapter.bind(f.documents), path = await f.source('创建故障')
  f.documents.createChapter = async () => { throw new Error('synthetic allocation failure') }
  await assert.rejects(f.imports.commit(await f.request('创建故障')))
  f.documents.createChapter = create
  const restarted = new BookImportService(f.projects, f.documents)
  await assert.rejects(restarted.commit({ token: (await restarted.previewFile(path)).token, ownership: 'owned', title: '重试' }), { code: 'CONFLICT' })
  assert.equal((await f.documents.chapters()).length, 0)
  const sourceNames = await readdir(join(f.a.path, '.webnovel/imports/sources'))
  assert.equal(sourceNames.length, 1)
  assert.ok((await readFile(join(f.a.path, '.webnovel/imports/sources', sourceNames[0]))).equals(await readFile(path)))
})

test('terminal manifest journal failure retains committed text and blocks a fresh token', async t => {
  const f = await fixture(t), path = await f.source('日志故障'), preview = await f.imports.previewFiles([path])
  const journal = join(f.a.path, `.webnovel/imports/manifests/${preview.id}/manifest.json`)
  const update = f.documents.updateChapter.bind(f.documents)
  f.documents.updateChapter = async (...args) => {
    const result = await update(...args)
    await rename(journal, `${journal}.preserved`)
    await mkdir(journal) // A real filesystem publication failure, not a fake return value.
    return result
  }
  await assert.rejects(f.imports.commitManifest({ id: preview.id, files: [{ token: preview.files[0].token, ownership: 'owned', title: '甲' }] }))
  const chapters = await f.documents.chapters()
  assert.equal(chapters.length, 1); assert.equal(chapters[0].content, '临时正文：日志故障。')
  const before = await readFile(`${journal}.preserved`), ledger = await readFile(f.ledgerPath)
  const restarted = new BookImportService(f.projects, f.documents)
  await assert.rejects(restarted.commit({ token: (await restarted.previewFile(path)).token, ownership: 'owned', title: '重试' }), { code: 'CONFLICT' })
  assert.deepEqual(await f.documents.chapters(), chapters)
  assert.ok((await readFile(`${journal}.preserved`)).equals(before))
  assert.ok((await readFile(f.ledgerPath)).equals(ledger))
})

test('directory in place of ledger is unreadable evidence, never an empty book', async t => {
  const f = await fixture(t)
  await mkdir(f.ledgerPath, { recursive: true }); await writeFile(join(f.ledgerPath, 'sentinel'), '保留')
  await assert.rejects(f.imports.commit(await f.request('不可读')), { code: 'CONFLICT' })
  assert.equal(await readFile(join(f.ledgerPath, 'sentinel'), 'utf8'), '保留')
  assert.equal((await f.documents.chapters()).length, 0)
})

test('active legacy-sqlite import safely appends without replacing the existing formal version', async t => {
  const f = await fixture(t)
  const settings = new SettingsStore(join(f.root, 'legacy-profile'), { available: () => false, encrypt: () => '', decrypt: () => '' })
  const projects = new ProjectService(settings)
  const { project } = await projects.create({ parentPath: f.root, name: '旧内容模式', genre: '玄幻' })
  const fileDocuments = new DocumentService(projects)
  await fileDocuments.updateChapter(7, { title: '已有正文', content: '旧正文保留。' })
  const databases = new SqliteWorkspaceDatabaseFactory()
  const source = new CurrentProjectLegacyWorkspaceSource(projects, fileDocuments)
  const migration = new ShadowImportService(source, databases)
  await migration.import(await migration.preview())
  const authority = new SqliteManuscriptService(databases)
  await authority.activate(project.path, await source.snapshot())
  const documents = new DocumentService(projects, undefined, authority), imports = new BookImportService(projects, documents)
  const before = await documents.chapter(7)
  const preview = await imports.previewFile(await f.source('旧模式追加'))
  const result = await imports.commit({ token: preview.token, title: '旧模式', ownership: 'owned', creationMethod: 'human' })
  assert.ok(result.importedChapterIds[0] > 7)
  assert.deepEqual(await documents.chapter(7), before)
  assert.equal((await documents.chapter(result.importedChapterIds[0])).content, '临时正文：旧模式追加。')
  const db = await databases.openExisting(project.path)
  assert.equal(db?.textAuthority(), 'legacy-sqlite'); db?.close()
})

test('resume cannot overlap the original active manifest commit', async t => {
  const f = await fixture(t)
  let entered!: () => void, release!: () => void
  const arrived = new Promise<void>(resolve => { entered = resolve }), barrier = new Promise<void>(resolve => { release = resolve })
  const imports = new BookImportService(f.projects, f.documents, undefined, async () => { entered(); await barrier })
  const preview = await imports.previewFiles([await f.source('恢复互斥')])
  const pending = imports.commitManifest({ id: preview.id, files: [{ token: preview.files[0].token, title: '正文', ownership: 'owned' }] })
  try { await arrived; await assert.rejects(imports.resumeManifest(preview.id), { code: 'CONFLICT' }) }
  finally { release(); await pending }
  assert.equal((await f.documents.chapters()).length, 1)
})

test('valid pre-receipt ledger stays compatible, while an invalid stored path remains byte-exact', async t => {
  const f = await fixture(t)
  await f.imports.commit(await f.request('历史导入'))
  await rename(join(f.a.path, '.webnovel/imports/operations'), join(f.root, 'saved-new-receipts'))
  await f.imports.commit(await f.request('兼容追加'))
  const ledger = JSON.parse(await readFile(f.ledgerPath, 'utf8'))
  assert.equal(ledger.records.length, 2)
  ledger.records[0].storagePath = '../not-owned'
  const raw = JSON.stringify(ledger)
  await writeFile(f.ledgerPath, raw)
  const before = await f.documents.chapters()
  await assert.rejects(f.imports.commit(await f.request('路径损坏')), { code: 'CONFLICT' })
  assert.equal(await readFile(f.ledgerPath, 'utf8'), raw)
  assert.deepEqual(await f.documents.chapters(), before)
})
