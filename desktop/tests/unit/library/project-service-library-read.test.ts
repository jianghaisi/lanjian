import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { ProjectSummary } from '../../../src/contracts/index'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { WorkspaceService } from '../../../src/main/modules/library/application/workspace-service'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'

const codec = {
  available: () => true,
  encrypt: (value: string) => Buffer.from(value).toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString()
}

test('metadata-only current summary stays fresh without reading bodies; full shelf statistics remain real', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-metadata-only-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const settings = new SettingsStore(join(root, 'profile'), codec), projects = new ProjectService(settings)
  const { project } = await projects.create({ parentPath: root, name: '轻量身份', genre: '悬疑' })
  const body = join(project.path, '正文', '第1章-测试.md')
  await writeFile(body, '这里是不可跳过的真实正文。')
  const full = await projects.currentSummary(), light = await projects.currentSummary({ includeManuscript: false })
  assert.equal(light.id, full.id); assert.equal(light.title, full.title); assert.equal(light.genre, full.genre)
  assert.equal('manuscript' in light, false)
  assert.equal(full.manuscript!.chapterCount, 1); assert.ok(full.manuscript!.wordCount > 0)
  const statePath = join(project.path, '.webnovel', 'state.json'), state = JSON.parse(await readFile(statePath, 'utf8'))
  state.project_info.title = '刚更新的书名'
  await writeFile(statePath, JSON.stringify(state))
  assert.equal((await projects.currentSummary({ includeManuscript: false })).title, '刚更新的书名')
  // A directory with a chapter filename makes any attempted body read fail.
  await unlink(body); await mkdir(body)
  assert.equal('manuscript' in await projects.currentSummary({ includeManuscript: false }), false)
  await new WorkspaceService(projects).bookProfile()
  await assert.rejects(projects.currentSummary(), { code: 'EISDIR' })
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'novel-library-read-'))
  const settings = new SettingsStore(join(root, 'user-data'), codec)
  const projects = new ProjectService(settings)
  const project = (await projects.create({ parentPath: root, name: '测试长篇', genre: '玄幻' })).project
  return { projects, project }
}

test('retries a transient registered-project read instead of returning a false partial shelf', async () => {
  const { projects } = await fixture()
  const target = projects as unknown as { summary: (path: string) => Promise<ProjectSummary> }
  const summarize = target.summary.bind(projects)
  let attempts = 0
  target.summary = async (path) => {
    attempts += 1
    if (attempts < 3) throw Object.assign(new Error('synthetic transient read'), { code: 'EBUSY' })
    return summarize(path)
  }

  const listed = await projects.list()
  assert.equal(attempts, 3)
  assert.deepEqual(listed.projects.map((item) => item.title), ['测试长篇'])
})

test('fails the shelf read when a registered existing project stays unreadable', async () => {
  const { projects } = await fixture()
  const target = projects as unknown as { summary: () => Promise<never> }
  let attempts = 0
  target.summary = async () => {
    attempts += 1
    throw Object.assign(new Error('private path diagnostic'), { code: 'EPERM' })
  }

  await assert.rejects(projects.list(), (error: { code?: string; message?: string }) => {
    assert.equal(error.code, 'STORAGE_ERROR')
    assert.equal(error.message, '作品库读取未完成，请重试。原作品文件没有改动。')
    assert.doesNotMatch(error.message || '', /private path diagnostic/)
    return true
  })
  assert.equal(attempts, 4)
})

test('discovers recognized direct children from the configured library root and merges external registrations', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'novel-library-root-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const libraryRoot = join(root, '作品')
  const externalRoot = join(root, '外部作品')
  await Promise.all([mkdir(libraryRoot), mkdir(externalRoot)])
  const settings = new SettingsStore(join(root, 'user-data'), codec)
  const projects = new ProjectService(settings)
  const first = (await projects.create({ parentPath: libraryRoot, name: '甲书' })).project
  const second = (await projects.create({ parentPath: libraryRoot, name: '乙书' })).project
  const external = (await projects.create({ parentPath: externalRoot, name: '外部书' })).project
  await mkdir(join(libraryRoot, '只有资料的文件夹'), { recursive: true })
  const saved = await settings.load()
  await settings.save({ ...saved, libraryRoot, recentProjects: [first.path, external.path], currentProject: first.path, excludedProjects: [] })

  assert.deepEqual((await projects.list()).projects.map((project) => project.title), ['甲书', '外部书', '乙书'])
  await settings.removeRecent(second.path)
  assert.deepEqual((await projects.list()).projects.map((project) => project.title), ['甲书', '外部书'])
})

test('discovers sibling works when a profile registered only one work without a library root', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'novel-library-inferred-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const libraryRoot = join(root, '作品')
  await mkdir(libraryRoot)
  const userData = join(root, 'user-data')
  const settings = new SettingsStore(userData, codec)
  const projects = new ProjectService(settings)
  const names = ['甲书', '乙书', '丙书', '丁书', '三千盏星灯，他们都叫我主公']
  const created = []
  for (const name of names) created.push((await projects.create({ parentPath: libraryRoot, name })).project)
  const saved = await settings.load()
  await settings.save({ ...saved, libraryRoot: null, recentProjects: [created[0].path], currentProject: created[0].path, excludedProjects: [created[2].path] })
  const before = await readFile(join(userData, 'settings.json'))

  const listed = await projects.list()
  assert.equal(listed.projects[0].title, names[0])
  assert.deepEqual(new Set(listed.projects.map((project) => project.title)), new Set([names[0], names[1], names[3], names[4]]))
  assert.equal(listed.continueProjectId, created[0].id)
  assert.equal(listed.projects.filter((project) => project.title === names[4]).length, 1)
  assert.deepEqual(await readFile(join(userData, 'settings.json')), before)
  assert.deepEqual((await new ProjectService(settings).list()).projects.map((project) => project.title), listed.projects.map((project) => project.title))
})

test('does not infer a single root from registrations in unrelated directories', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'novel-library-mixed-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const firstParent = join(root, '甲库')
  const secondParent = join(root, '乙库')
  await Promise.all([mkdir(firstParent), mkdir(secondParent)])
  const settings = new SettingsStore(join(root, 'user-data'), codec)
  const projects = new ProjectService(settings)
  const first = (await projects.create({ parentPath: firstParent, name: '甲书' })).project
  const second = (await projects.create({ parentPath: secondParent, name: '乙书' })).project
  await projects.create({ parentPath: firstParent, name: '未登记的同级书' })
  const saved = await settings.load()
  await settings.save({ ...saved, libraryRoot: null, recentProjects: [first.path, second.path], currentProject: first.path })

  assert.deepEqual((await projects.list()).projects.map((project) => project.title), ['甲书', '乙书'])
})

test('fails explicitly when the configured library root is unavailable', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'novel-library-root-missing-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const settings = new SettingsStore(join(root, 'user-data'), codec)
  const saved = await settings.load()
  await settings.save({ ...saved, libraryRoot: join(root, '已经移动的作品库') })
  await assert.rejects(new ProjectService(settings).list(), (error: { code?: string; message?: string }) => {
    assert.equal(error.code, 'STORAGE_ERROR')
    assert.match(error.message || '', /作品库目录暂时不可用/)
    return true
  })
})
