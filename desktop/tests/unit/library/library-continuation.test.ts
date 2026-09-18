import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { unwrapValidatedIpcResponse } from '../../../src/contracts/core/ipc-response'

test('continuation follows persisted switch, never shelf order, and falls back only to listed works', async t => {
  const parent = await realpath(tmpdir()), root = await mkdtemp(join(parent, 'lanjian-continuation-'))
  t.after(async () => { assert.equal(await realpath(root), root); assert.equal(dirname(root), parent); await rm(root, { recursive: true, force: true }) })
  const codec = { available: () => false, encrypt: () => '', decrypt: () => '' }
  const profile = join(root, 'profile'), settings = new SettingsStore(profile, codec), service = new ProjectService(settings)
  assert.deepEqual(await service.list(), { projects: [], continueProjectId: null })
  const a = (await service.create({ parentPath: root, title: '我家美少女测试副本' })).project
  const b = (await service.create({ parentPath: root, title: '测试文稿副本' })).project
  await service.switch(a.path)
  const before = await readFile(join(profile, 'settings.json'))
  const list = await service.list()
  assert.deepEqual(list.projects.map(item => item.id), [b.id, a.id])
  assert.equal(list.continueProjectId, a.id)
  assert.deepEqual(await readFile(join(profile, 'settings.json')), before, 'list is read-only')
  assert.equal((await new ProjectService(new SettingsStore(profile, codec)).list()).continueProjectId, a.id)
  await assert.rejects(service.switch(join(root, 'missing')))
  assert.equal((await service.list()).continueProjectId, a.id)
  const saved = await settings.load()
  await settings.save({ ...saved, currentProject: join(root, 'unavailable-last-work') })
  assert.equal((await service.list()).continueProjectId, b.id, 'missing saved target falls back without adding it to the shelf')
  if (process.platform === 'win32') {
    await settings.save({ ...saved, currentProject: a.path.toUpperCase() })
    assert.equal((await service.list()).continueProjectId, a.id, 'Windows identity is case-insensitive')
  }
  await settings.save(saved)
  await settings.removeRecent(a.path)
  assert.equal((await service.list()).continueProjectId, b.id)
  await settings.removeRecent(b.path)
  assert.equal((await service.list()).continueProjectId, null)
  assert.ok(await readFile(join(a.path, '.webnovel', 'state.json')), 'removal never deletes author data')
})

test('list decoder rejects a foreign continuation target and invalid types while accepting old payloads', () => {
  const decode = (value: unknown) => unwrapValidatedIpcResponse('projects:list', { ok: true, value })
  assert.deepEqual(decode({ projects: [], continueProjectId: null }), { projects: [], continueProjectId: null })
  assert.deepEqual(decode({ projects: [] }), { projects: [] })
  for (const continueProjectId of [42, {}, '../foreign', 'not-in-shelf']) assert.throws(() => decode({ projects: [], continueProjectId }))
})
