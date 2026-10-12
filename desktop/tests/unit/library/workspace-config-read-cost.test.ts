import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test, { type TestContext } from 'node:test'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { NewFileProjectStorage } from '../../../src/main/modules/library/application/new-file-project-storage'
import { WorkspaceService } from '../../../src/main/modules/library/application/workspace-service'
import { SqliteManuscriptService } from '../../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'

class CountingFactory extends SqliteWorkspaceDatabaseFactory {
  opens = 0
  closes = 0
  reset() { this.opens = 0; this.closes = 0 }
  override async openExisting(root: string) {
    this.opens++
    const database = await super.openExisting(root)
    if (database) {
      const close = database.close.bind(database)
      database.close = () => { this.closes++; close() }
    }
    return database
  }
}

async function fixture(t: TestContext, formal = true) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-config-read-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const databases = new CountingFactory(), storage = new NewFileProjectStorage(databases)
  const settings = new SettingsStore(join(root, 'profile'), { available: () => true, encrypt: text => text, decrypt: text => text })
  const projects = new ProjectService(settings, undefined, undefined, formal ? path => storage.initialize(path) : undefined)
  const { project } = await projects.create({ parentPath: root, name: '配置读取测试' })
  const authority = new SqliteManuscriptService(databases)
  const workspace = new WorkspaceService(projects, undefined, undefined, undefined, undefined, undefined, authority)
  return { root, projects, project, databases, authority, workspace }
}

test('existing managed configurations use one fresh connection each, retaining values and legacy adapter compatibility', async t => {
  const f = await fixture(t)
  const read = () => Promise.all([f.workspace.realms(), f.workspace.powerSystem(), f.workspace.cheatSystem(), f.workspace.systemTemplate()])
  const initial = await read()
  f.databases.reset()
  assert.deepEqual(await read(), initial)
  assert.equal(f.databases.opens, 4)
  assert.equal(f.databases.closes, 4)
  const a = f.authority
  const legacy = new WorkspaceService(f.projects, undefined, undefined, undefined, undefined, undefined, {
    active: a.active.bind(a), projectWritingConfig: a.projectWritingConfig.bind(a), updateProjectWritingConfig: a.updateProjectWritingConfig.bind(a),
    workspaceConfigReady: a.workspaceConfigReady.bind(a), workspaceConfig: a.workspaceConfig.bind(a), importWorkspaceConfig: a.importWorkspaceConfig.bind(a)
  })
  f.databases.reset()
  assert.deepEqual(await legacy.realms(), initial[0])
  assert.equal(f.databases.opens, 3)
  assert.equal(f.databases.closes, 3)
  await f.workspace.saveRealms([{ id: 'one', name: '更新后的境界', description: '当次读取必须看到新值' }])
  f.databases.reset()
  assert.equal((await f.workspace.realms()).levels[0].name, '更新后的境界')
  assert.equal(f.databases.opens, 1)
  assert.equal(f.databases.closes, 1)
  const { project: other } = await f.projects.create({ parentPath: f.root, name: '另一本书' })
  await f.projects.switch(other.path)
  assert.notDeepEqual(await f.workspace.realms(), { levels: [{ id: 'one', name: '更新后的境界', description: '当次读取必须看到新值' }] })
  await f.projects.switch(f.project.path)
  assert.equal((await f.workspace.realms()).levels[0].name, '更新后的境界')
})

test('external mirror edits still fail and close the single connection without overwriting either side', async t => {
  const f = await fixture(t)
  await f.workspace.realms()
  const path = join(f.project.path, '.webnovel/config/levels.json')
  const before = await f.authority.readWorkspaceConfig(f.project.path, 'realms')
  const external = JSON.stringify({ levels: [{ id: 'external', name: '外部修改', description: '保持原文件' }] })
  await writeFile(path, external)
  f.databases.reset()
  await assert.rejects(f.workspace.realms(), { code: 'CONFLICT' })
  assert.equal(f.databases.opens, 1)
  assert.equal(f.databases.closes, 1)
  assert.equal(await readFile(path, 'utf8'), external)
  const database = await f.databases.openExisting(f.project.path)
  assert.ok(database)
  try {
    assert.equal(database.workspaceConfig('realms').content, before.document!.content)
    assert.equal(database.workspaceConfigMirror('realms')?.status, 'conflict')
  } finally { database.close() }
})

test('missing formal config stays absent on read-only lookup and imports once on normal read', async t => {
  const f = await fixture(t)
  assert.deepEqual(await f.authority.readWorkspaceConfig(f.project.path, 'realms'), { formal: true, document: null })
  const path = join(f.project.path, '.webnovel/config/levels.json')
  await writeFile(path, JSON.stringify({ levels: [] }))
  const bytes = await readFile(path)
  await f.workspace.realms(true)
  assert.deepEqual(await f.authority.readWorkspaceConfig(f.project.path, 'realms'), { formal: true, document: null })
  assert.deepEqual(await readFile(path), bytes)
  await f.workspace.realms()
  const database = await f.databases.openExisting(f.project.path)
  assert.ok(database)
  try { assert.equal(database.workspaceConfig('realms').revision, 1) } finally { database.close() }
})

test('file mode remains file-backed; invalid SQLite never falls back to compatibility data', async t => {
  const files = await fixture(t, false)
  assert.deepEqual(await files.authority.readWorkspaceConfig(files.project.path, 'realms'), { formal: false, document: null })
  assert.ok(Array.isArray((await files.workspace.realms()).levels))
  const shadow = await files.databases.open(files.project.path)
  shadow.close()
  files.databases.reset()
  assert.deepEqual(await files.authority.readWorkspaceConfig(files.project.path, 'realms'), { formal: false, document: null })
  assert.equal(files.databases.opens, 1)
  assert.equal(files.databases.closes, 1)
  const raw = new DatabaseSync(join(files.project.path, '.webnovel/workspace.sqlite'))
  try { raw.exec('DROP TRIGGER workspace_config_documents_scope_guard') } finally { raw.close() }
  await assert.rejects(files.workspace.realms(), { code: 'DATABASE_MIGRATION_FAILED' })
})
