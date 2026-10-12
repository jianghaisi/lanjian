import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { localModelCatalog } from '../../../src/main/modules/models/adapters/local-models/catalog'
import { ManagedModelAssets } from '../../../src/main/modules/models/adapters/local-models/managed-model-assets'
import { ModelDownloader } from '../../../src/main/modules/models/adapters/local-models/model-download'
import { runtimeProfile } from '../../../src/main/modules/models/adapters/local-models/runtime-profile'
import { ProjectAiService } from '../../../src/main/modules/models/application/project-ai-service'
import { localModelAssignment } from '../../../src/renderer/features/models/composables/use-model-settings'
import type { ProjectService } from '../../../src/main/modules/library/application/project-service'
import type { SettingsStore } from '../../../src/main/platform/settings/settings-store'
import type { LocalModelView } from '../../../src/contracts/models/local-model-contracts'

test('two tiny model fixtures share a verified environment without downloads or cross-model file replacement', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lanjian-catalog-assets-'))), directory = randomUUID()
  const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
  const models = [localModelCatalog[0], localModelCatalog.find(m => m.family === 'GLM')!].map((m, index) => {
    const bytes = Buffer.from('fixture weight ' + index)
    return { manifest: { ...m, files: [{ ...m.files[0], bytes: bytes.length, sha256: digest(bytes) }] }, bytes }
  })
  await mkdir(join(root, 'downloads'))
  for (const { manifest, bytes } of models) await writeFile(join(root, 'downloads', manifest.files[0].sha256 + '.asset'), bytes)
  const files = []
  for (const path of [runtimeProfile.python, runtimeProfile.sitePackages + '/llama_cpp/llama.py']) {
    const bytes = Buffer.from('inert environment fixture ' + path), target = join(root, 'runtimes', directory, path)
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes)
    files.push({ path, bytes: bytes.length, sha256: digest(bytes) })
  }
  const receipt = JSON.stringify({ version: 1, profile: runtimeProfile.id, directory, files })
  await writeFile(join(root, 'runtime-current.json'), receipt)
  let network = 0
  const source = new ManagedModelAssets(root, join(root, 'legacy'), new ModelDownloader(join(root, 'downloads'), async () => { network++; throw Error('no download expected') }))
  const a = await source.install(models[0].manifest, new AbortController().signal, () => {})
  const b = await source.install(models[1].manifest, new AbortController().signal, () => {})
  assert.equal(a.python, b.python); assert.equal(a.sitePackages, b.sitePackages)
  assert.notEqual(a.modelPath, b.modelPath); assert.notEqual(a.fingerprint, b.fingerprint)
  assert.equal(network, 0); assert.equal(await readFile(join(root, 'runtime-current.json'), 'utf8'), receipt)
  assert.deepEqual(await readFile(a.modelPath), models[0].bytes); assert.deepEqual(await readFile(b.modelPath), models[1].bytes)
  assert.equal((await source.installationInfo(models[1].manifest)).downloadBytes, 0)
})

test('production routing persists two distinct models across service reopen and preserves other tasks', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-catalog-routes-'))
  await mkdir(join(root, '.webnovel'))
  const first = localModelCatalog[0], second = localModelCatalog.find(m => m.family === 'GLM')!
  const profile = { connectionId: 'local:llama-cpp', model: first.id, temperature: .6, topP: .9, maxTokens: 2048 }
  await writeFile(join(root, '.webnovel/ai-settings.json'), JSON.stringify({ version: 3, connections: [], routingMode: 'shared', shared: profile, tasks: Object.fromEntries(['outline', 'chapterOutline', 'prose', 'review'].map(task => [task, profile])) }))
  const settings = { projectApiKeyConfigured: async () => { throw Error('no credentials') }, projectApiKey: async () => { throw Error('no credentials') }, removeProjectApiKeys: async () => {} } as unknown as SettingsStore
  const projects = { currentPath: async () => root } as ProjectService
  let present = true
  const local = { listModels: async () => [first.id, second.id], ready: async () => present, limits: () => ({ contextTokens: 8192, systemReserveTokens: 512, maxOutputTokens: 4096, recommendedOutputTokens: 2048 }) }
  const service = new ProjectAiService(projects, settings, undefined, local)
  t.mock.method(globalThis, 'fetch', () => { throw Error('no HTTP for local settings') })
  const ready = (id: string): LocalModelView => ({ id, state: 'ready', recommendedOutputTokens: 2048 } as LocalModelView)
  const initial = await service.get()
  await service.update(localModelAssignment(initial, ready(first.id), 'prose'))
  const assigned = await service.update(localModelAssignment(await service.get(), ready(second.id), 'review'))
  assert.deepEqual(assigned.tasks.outline, initial.shared); assert.deepEqual(assigned.tasks.chapterOutline, initial.shared)
  assert.equal(assigned.tasks.prose.model, first.id); assert.equal(assigned.tasks.review.model, second.id)
  const reopened = new ProjectAiService(projects, settings, undefined, local)
  assert.equal((await reopened.resolve('prose')).profile.model, first.id)
  assert.equal((await reopened.resolve('review')).profile.model, second.id)
  const before = await readFile(join(root, '.webnovel/ai-settings.json'), 'utf8')
  present = false
  assert.equal((await reopened.get()).modelConfigured, false)
  assert.equal((await reopened.resolve('review')).kind, 'local')
  assert.equal(await readFile(join(root, '.webnovel/ai-settings.json'), 'utf8'), before)
})
