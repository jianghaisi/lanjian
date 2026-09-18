import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { ProjectSummary } from '../../../src/contracts/index'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'

const codec = {
  available: () => true,
  encrypt: (value: string) => Buffer.from(value).toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString()
}

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
