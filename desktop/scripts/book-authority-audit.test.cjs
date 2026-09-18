const assert = require('node:assert/strict')
const test = require('node:test')
const { mkdtemp, mkdir, readFile, writeFile, rename, rm, readdir, realpath } = require('node:fs/promises')
const { join, dirname, basename } = require('node:path')
const { tmpdir } = require('node:os')
const { DatabaseSync } = require('node:sqlite')
const { auditBook } = require('./book-authority-audit.cjs')
const { SettingsStore } = require('../src/main/platform/settings/settings-store.ts')
const { ProjectService } = require('../src/main/modules/library/application/project-service.ts')
const { DocumentService } = require('../src/main/modules/manuscript/application/document-service.ts')
const { CurrentProjectLegacyWorkspaceSource } = require('../src/main/modules/library/application/legacy-workspace-source.ts')
const { SqliteWorkspaceDatabaseFactory } = require('../src/main/platform/storage/workspace-database.ts')
const { ShadowImportService } = require('../src/main/modules/library/application/shadow-import-service.ts')
const { SqliteManuscriptService } = require('../src/main/modules/manuscript/application/sqlite-manuscript-service.ts')

async function fixture(t, formal = true) {
  const temp = await realpath(tmpdir()), root = await mkdtemp(join(temp, 'lanjian-authority-audit-'))
  t.after(async () => { assert.equal(dirname(root),temp); assert.ok(basename(root).startsWith('lanjian-authority-audit-')); await rm(root,{recursive:true,force:true}) })
  const settings = new SettingsStore(join(root,'settings'), {available:()=>true,encrypt:v=>Buffer.from(v).toString('base64'),decrypt:v=>Buffer.from(v,'base64').toString()})
  const projects = new ProjectService(settings)
  const project = (await projects.create({parentPath:root,name:'审计隔离作品',genre:'都市'})).project
  const docs = new DocumentService(projects)
  await docs.updateChapter(1,{title:'第一份',content:'已保存的正文。'})
  await docs.updateChapter(2,{title:'第二份',content:'\uFEFF\n  '})
  await docs.updateOutline('total','全书总纲。')
  await docs.updateOutline(1,'第一卷的故事。')
  await docs.updateChapterOutline(1,'第一章具体事件。')
  await docs.updateChapterOutline(2,'第二章具体事件。')
  const databases = new SqliteWorkspaceDatabaseFactory()
  if (formal) {
    const source = new CurrentProjectLegacyWorkspaceSource(projects,docs)
    const importer = new ShadowImportService(source,databases)
    await importer.import(await importer.preview())
    await new SqliteManuscriptService(databases).activate(project.path,await source.snapshot())
  }
  return {root,project,databases,body:join(project.path,'正文','第2章-第二份.md'),db:join(project.path,'.webnovel','workspace.sqlite')}
}

test('SQLite progress uses formal versions, not externally edited mirrors, and writes no source bytes',async t=>{
  const f=await fixture(t)
  await writeFile(f.body,'外部尚未采用的完整草稿。')
  const before=await readFile(f.db), names=await readdir(join(f.project.path,'.webnovel'))
  const r=await auditBook(f.project.path,{expectedChapters:2})
  assert.equal(r.authority,'sqlite'); assert.equal(r.bodyPopulated,1); assert.equal(r.bodyConfirmedCurrent,0)
  assert.deepEqual(r.emptyChapters,[2]); assert.equal(r.externalUnadopted.length,1)
  assert.equal(r.structureValid,true); assert.equal(r.ok,false); assert.equal(r.readyForFinalReview,false); assert.equal(r.completeNovel,null)
  assert.deepEqual(await readFile(f.db),before); assert.deepEqual(await readdir(join(f.project.path,'.webnovel')),names)
  assert.equal(await readFile(f.body,'utf8'),'外部尚未采用的完整草稿。')
})

test('file authority excludes BOM/whitespace, counts real chapters and reports missing/duplicate files',async t=>{
  const f=await fixture(t,false)
  let r=await auditBook(f.project.path,{expectedChapters:2})
  assert.equal(r.authority,'files'); assert.equal(r.bodyPopulated,1); assert.equal(r.bodyConfirmedCurrent,null)
  await rename(f.body,join(f.root,'retained-draft.md'))
  r=await auditBook(f.project.path,{expectedChapters:2})
  assert.equal(r.activeChapters,1); assert.equal(r.bodyPopulated,1); assert.deepEqual(r.missingBodies,[2]); assert.equal(r.structureValid,false)
  await writeFile(join(f.project.path,'正文','第1章-重复编号.md'),'另一份正文。')
  r=await auditBook(f.project.path)
  assert.ok(r.errors.some(e=>e.includes('重复章节编号')))
})

test('archived empty chapters and their removed mirrors never count as missing active prose',async t=>{
  const f=await fixture(t)
  const db=await f.databases.openExisting(f.project.path)
  db.archiveFormalChapter(2); db.close()
  await rename(f.body,join(f.root,'archived-body.md'))
  const r=await auditBook(f.project.path)
  assert.equal(r.activeChapters,1); assert.equal(r.archivedChapters,1)
  assert.ok(r.mirrorObservations.some(o=>o.archivedChapter && o.observed==='missing'))
})

test('unsupported or damaged databases fail without upgrading or falling back to mirrors',async t=>{
  const f=await fixture(t)
  let db=new DatabaseSync(f.db); db.exec('PRAGMA user_version=999'); db.close()
  const before=await readFile(f.db)
  await assert.rejects(auditBook(f.project.path),{code:'UNSUPPORTED_PROJECT_VERSION'})
  assert.deepEqual(await readFile(f.db),before)
  await writeFile(f.db,'not a sqlite file')
  await assert.rejects(auditBook(f.project.path))
  assert.equal(await readFile(f.db,'utf8'),'not a sqlite file')
})

test('mirror traversal is rejected instead of reading outside the book',async t=>{
  const f=await fixture(t)
  const db=new DatabaseSync(f.db)
  db.prepare("UPDATE mirror_entries SET relative_path='../outside.txt' WHERE source_type='chapter_markdown' AND relative_path LIKE '%第2章%'").run(); db.close()
  await writeFile(join(f.root,'outside.txt'),'不应读取的文件')
  await assert.rejects(auditBook(f.project.path))
})

test('invalid expected counts and ordinary folders cannot manufacture completion',async t=>{
  const f=await fixture(t,false)
  await assert.rejects(auditBook(f.project.path,{expectedChapters:NaN}),{code:'VALIDATION_ERROR'})
  const ordinary=join(f.root,'ordinary');await mkdir(ordinary)
  await assert.rejects(auditBook(ordinary),{code:'INVALID_PROJECT_STATE'})
})
