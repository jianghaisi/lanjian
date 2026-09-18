import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rename, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppError } from '../../../src/main/core/errors/app-error'
import { BOOK_MODEL_TASKS } from '../../../src/main/modules/models/domain/book-model-settings'
import { NewBookModelDefaults } from '../../../src/main/modules/models/application/new-book-model-defaults'
import { ModelConnectionsStore } from '../../../src/main/modules/models/adapters/model-connections-store'
import { bookModelConfigInputs } from '../../../src/main/modules/models/adapters/book-model-configs'
import { ProjectCreation, type ProjectModelInitialization } from '../../../src/main/modules/library/application/project-creation'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'

const profile = (model = 'gpt-plan') => ({ connectionId: 'shared-api', model, temperature: 0.6, topP: 0.9, maxTokens: 4096 })
const template = (model = 'gemini-prose') => ({ version: 4, references: [{ kind: 'global', id: 'shared-api', globalConnectionId: 'global-fixture' }],
  routingMode: 'perTask', shared: profile(), tasks: Object.fromEntries(BOOK_MODEL_TASKS.map(task => [task, profile(task === 'prose' ? model : 'gpt-plan')])) })
async function fixture(t: TestContext) {
  const parent = await realpath(tmpdir()), root = await realpath(await mkdtemp(join(parent, 'lanjian-create-models-')))
  t.after(async () => { assert.ok(root.startsWith(join(parent, 'lanjian-create-models-'))); assert.equal(await realpath(root), root); await rm(root, { recursive: true, force: true }) })
  const app = join(root, 'app'); await mkdir(app)
  const settings = new SettingsStore(app, { available: () => false, encrypt: () => assert.fail('no encryption'), decrypt: () => assert.fail('no decryption') })
  const store = new ModelConnectionsStore(app)
  const snapshot = await store.read()
  await store.commit(snapshot, { version: 1, revision: 1, connections: [{ id: 'global-fixture', name: '合成接口', baseUrl: 'https://example.test/v1', enabled: true, revision: 1 }] })
  const defaults = new NewBookModelDefaults(store, bookModelConfigInputs), projects = new ProjectService(settings)
  const save = async (value: unknown = template()) => { const view = await defaults.get(); return defaults.save({ expectedRevision: view.revision, expectedCatalogRevision: view.catalogRevision, template: value }) }
  return { root, app, settings, defaults, projects, store, save }
}
const readModels = async (root: string) => JSON.parse(await readFile(join(root, '.webnovel/ai-settings.json'), 'utf8'))
const fail = () => { throw new AppError('CONFLICT', 'scope changed') }

test('actual project A/B inherit independent routes and C inherits later default; source and credentials stay outside books', async t => {
  const f = await fixture(t); await f.save()
  for (const title of ['A', 'B']) {
    const result = await f.projects.createWithModels({ parentPath: f.root, title }, await f.defaults.capture(1, () => {}))
    assert.equal(result.status, 'created')
    assert.equal((await readModels(join(f.root, title))).tasks.prose.model, 'gemini-prose')
    assert.equal((await f.settings.load()).currentProject, join(f.root, title))
  }
  const bBytes = await readFile(join(f.root, 'B/.webnovel/ai-settings.json'))
  await f.save(template('gemini-next'))
  await f.projects.createWithModels({ parentPath: f.root, title: 'C' }, await f.defaults.capture(2, () => {}))
  assert.deepEqual(await readFile(join(f.root, 'B/.webnovel/ai-settings.json')), bBytes)
  assert.equal((await readModels(join(f.root, 'A'))).defaultRevision, 1)
  assert.equal((await readModels(join(f.root, 'C'))).defaultRevision, 2)
  assert.equal((await readModels(join(f.root, 'C'))).tasks.prose.model, 'gemini-next')
  assert.doesNotMatch(bBytes.toString(), /apiKey|encrypted|baseUrl/)
  await f.projects.importProject(join(f.root, 'A'))
  assert.equal((await readModels(join(f.root, 'A'))).defaultRevision, 1)
})

test('no defaults creates a normal manual book with no model document or calls', async t => {
  const f = await fixture(t)
  const result = await f.projects.createWithModels({ parentPath: f.root, title: 'Manual' }, await f.defaults.capture(0, () => {}))
  assert.equal(result.status, 'created')
  await assert.rejects(readModels(join(f.root, 'Manual')), { code: 'ENOENT' })
  assert.equal((await f.projects.list()).projects[0].title, 'Manual')
})

test('changed defaults before creation allocate no target', async t => {
  const f = await fixture(t); await f.save()
  const prepared = await f.defaults.capture(1, () => {})
  await f.save(template('changed'))
  await assert.rejects(f.projects.createWithModels({ parentPath: f.root, title: 'Stale' }, prepared), { code: 'CONFLICT' })
  assert.ok(!(await readdir(f.root)).includes('Stale'))
})

test('existing target and simultaneous creation preserve unknown contents', async t => {
  const f = await fixture(t), target = join(f.root, 'Existing')
  await mkdir(target); await writeFile(join(target, 'source.txt'), '原稿')
  await assert.rejects(f.projects.create({ parentPath: f.root, title: 'Existing' }), { code: 'CONFLICT' })
  assert.deepEqual(await readdir(target), ['source.txt'])
  const outcomes = await Promise.allSettled([f.projects.create({ parentPath: f.root, title: 'Race' }), f.projects.create({ parentPath: f.root, title: 'Race' })])
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal((await f.projects.list()).projects.length, 1)
})

test('initialization failure preserves partial files and supports explicit no-default retry without registration first', async t => {
  const f = await fixture(t); await f.save()
  const prepared = await f.defaults.capture(1, () => {})
  const failing: ProjectModelInitialization = { copy: prepared.copy, guard: { recheck: async () => fail(), assertActive: () => {} } }
  const result = await f.projects.createWithModels({ parentPath: f.root, title: 'Partial' }, failing)
  assert.equal(result.status, 'partial'); if (result.status !== 'partial') return
  assert.equal(result.modelsWritten, false)
  assert.equal((await f.settings.load()).currentProject, null)
  const file = join(f.root, 'Partial/.webnovel/state.json'), before = await readFile(file)
  const recovered = await f.projects.retryCreation(result.operationId)
  assert.equal(recovered.status, 'created'); assert.deepEqual(await readFile(file), before)
  await assert.rejects(readModels(join(f.root, 'Partial')), { code: 'ENOENT' })
  await assert.rejects(f.projects.retryCreation(result.operationId), { code: 'CONFLICT' })
})

test('registration failure retry preserves copied models; cannot relabel an already written default as empty', async t => {
  const f = await fixture(t); await f.save()
  let failing = true, calls = 0
  const creator = new ProjectCreation(async () => { calls++; if (failing) throw Error('raw-secret-sentinel') }, 2)
  const prepared = await f.defaults.capture(1, () => {})
  const result = await creator.create({ parentPath: f.root, title: 'Register' }, prepared)
  assert.equal(result.status, 'partial'); if (result.status !== 'partial') return
  assert.equal(result.modelsWritten, true); assert.doesNotMatch(JSON.stringify(result), /raw-secret-sentinel/)
  await assert.rejects(creator.retry(result.operationId), { code: 'CONFLICT' })
  failing = false
  assert.equal((await creator.retry(result.operationId, prepared)).status, 'created'); assert.equal(calls, 2)
})

for (const change of ['file', 'root'] as const) test(`partial retry rejects changed ${change} identity and preserves changes`, async t => {
  const f = await fixture(t), creator = new ProjectCreation(async () => { throw Error('register failed') }, 2)
  const result = await creator.create({ parentPath: f.root, title: 'Changed' })
  assert.equal(result.status, 'partial'); if (result.status !== 'partial') return
  const target = join(f.root, 'Changed')
  if (change === 'root') { await rename(target, join(f.root, 'Original')); await mkdir(target) }
  else await writeFile(join(target, '.webnovel/state.json'), '{"author":"changed"}')
  const retry = await creator.retry(result.operationId)
  assert.equal(retry.status, 'partial')
  if (change === 'file') assert.equal(await readFile(join(target, '.webnovel/state.json'), 'utf8'), '{"author":"changed"}')
  else assert.deepEqual(await readdir(target), [])
})

test('restart cannot turn a caller-supplied operation ID or arbitrary directory into retry authority', async t => {
  const f = await fixture(t), creator = new ProjectCreation(async () => { throw Error('failed') }, 2)
  const result = await creator.create({ parentPath: f.root, title: 'Interrupted' })
  assert.equal(result.status, 'partial'); if (result.status !== 'partial') return
  await assert.rejects(new ProjectCreation(async () => assert.fail('not authorized'), 2).retry(result.operationId), { code: 'CONFLICT' })
  assert.ok((await readdir(join(f.root, 'Interrupted'))).includes('.webnovel'))
})
