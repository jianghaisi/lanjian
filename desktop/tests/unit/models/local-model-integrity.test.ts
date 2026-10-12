import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { ManagedModelAssets } from '../../../src/main/modules/models/adapters/local-models/managed-model-assets'
import { ModelDownloader } from '../../../src/main/modules/models/adapters/local-models/model-download'
import { LocalInstallationStore } from '../../../src/main/modules/models/adapters/local-models/installation-store'
import { localModelCatalog } from '../../../src/main/modules/models/adapters/local-models/catalog'
import { runtimeProfile } from '../../../src/main/modules/models/adapters/local-models/runtime-profile'
import { LocalModelService } from '../../../src/main/modules/models/application/local-model-service'
import { AppError } from '../../../src/main/core/errors/app-error'
import type { LocalTextRequest } from '../../../src/main/modules/models/domain/model-provider'

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex')

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-model-integrity-'))
  const weight = Buffer.from('isolated model fixture, never executed')
  const manifest = { ...localModelCatalog[0], files: [{ ...localModelCatalog[0].files[0], bytes: weight.length, sha256: digest(weight) }] }
  const model = join(root, 'downloads', manifest.files[0].sha256 + '.asset')
  await mkdir(dirname(model), { recursive: true }); await writeFile(model, weight)
  const directory = randomUUID(), files = []
  for (const path of [runtimeProfile.python, runtimeProfile.sitePackages + '/llama_cpp/llama.py']) {
    const bytes = Buffer.from('fixture ' + path), target = join(root, 'runtimes', directory, path)
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes)
    files.push({ path, bytes: bytes.length, sha256: digest(bytes) })
  }
  const receipt = join(root, 'runtime-current.json')
  await writeFile(receipt, JSON.stringify({ version: 1, profile: runtimeProfile.id, directory, files }))
  let runs = 0, downloads = 0
  const source = new ManagedModelAssets(root, join(root, 'missing-legacy'), new ModelDownloader(join(root, 'downloads'), async () => { downloads++; throw Error('unexpected network') }))
  const store = new LocalInstallationStore(join(root, 'installations.json'))
  const runtime = { run: async (_assets: unknown, input: LocalTextRequest) => {
    runs++
    return { content: input.schema ? JSON.stringify(input.schema.oneOf ? { kind: 'tool', name: 'model_probe', arguments: { status: 'ok' } } : { status: 'ok' }) : '检测成功', finishReason: 'stop' as const, promptTokens: 1, completionTokens: 1, seconds: 0 }
  }, stop() {} }
  const service = new LocalModelService([manifest], source, runtime, store)
  assert.equal((await service.inspect(manifest.id)).state, 'ready')
  const profile = { connectionId: 'local:llama-cpp', model: manifest.id, maxTokens: 128, temperature: .1, topP: .9 }
  const generate = (s = service, tool = false, signal?: AbortSignal) => tool
    ? s.toolStep(manifest.id, profile, [], [{ type: 'function', function: { name: 'model_probe', description: 'fixture', parameters: {} } }], signal ?? new AbortController().signal)
    : s.complete({ model: manifest.id, profile, messages: [], signal })
  return { root, manifest, model, python: join(root, 'runtimes', directory, runtimeProfile.python), receipt, source, store, runtime, service, generate, activity: () => ({ runs, downloads }) }
}

for (const target of ['model', 'python'] as const) for (const tool of [false, true]) test(`same-size ${target} corruption invalidates persisted readiness before ${tool ? 'tool' : 'text'} inference`, async () => {
  const f = await fixture(), original = await readFile(f[target]), receipt = await readFile(f.receipt)
  const damaged = Buffer.alloc(original.length, 65); await writeFile(f[target], damaged)
  await assert.rejects(f.generate(f.service, tool), /校验/)
  assert.deepEqual(f.activity(), { runs: 3, downloads: 0 })
  const [view] = await f.service.list()
  assert.equal(view.state, 'failed'); assert.deepEqual(view.capabilities, []); assert.equal(await f.service.ready(f.manifest.id), false)
  assert.equal((await f.store.read())[0].state, 'failed')
  const restarted = new LocalModelService([f.manifest], f.source, f.runtime, f.store)
  assert.equal(await restarted.ready(f.manifest.id), false)
  assert.deepEqual(await readFile(f[target]), damaged); assert.deepEqual(await readFile(f.receipt), receipt)
  await writeFile(f[target], original)
  assert.equal(await restarted.ready(f.manifest.id), false, 'restoring bytes must still require explicit detection')
  assert.equal((await restarted.inspect(f.manifest.id)).state, 'ready')
})

test('cancellation during asset verification keeps the previous readiness', async () => {
  const f = await fixture(), entered = deferred(), release = deferred(), controller = new AbortController()
  const before = await readFile(join(f.root, 'installations.json'))
  const service = new LocalModelService([f.manifest], { discover: m => f.source.discover(m), prepare: async () => { entered.resolve(); await release.promise; throw Error('cancelled verification') } }, f.runtime, f.store)
  const pending = f.generate(service, false, controller.signal); await entered.promise; controller.abort(); release.resolve()
  await assert.rejects(pending, /cancelled/)
  assert.equal(await service.ready(f.manifest.id), true); assert.deepEqual(await readFile(join(f.root, 'installations.json')), before)
})

test('runtime output failures do not mislabel verified files as damaged', async () => {
  const f = await fixture(), before = await readFile(join(f.root, 'installations.json'))
  const service = new LocalModelService([f.manifest], f.source, { run: async () => { throw new AppError('AI_RESPONSE_INVALID', 'fixture incomplete output') }, stop() {} }, f.store)
  await assert.rejects(f.generate(service), /incomplete output/)
  assert.equal(await service.ready(f.manifest.id), true); assert.deepEqual(await readFile(join(f.root, 'installations.json')), before)
})

for (const completed of [false, true]) test(`late verification failure preserves a newer ${completed ? 'ready' : 'active'} detection`, async () => {
  const f = await fixture(), entered = deferred(), release = deferred(), detection = deferred(), finish = deferred()
  let prepares = 0
  const service = new LocalModelService([f.manifest], { discover: m => f.source.discover(m), prepare: async (m, s, p) => {
    if (++prepares === 1) { entered.resolve(); await release.promise; throw Error('old resource failure') }
    detection.resolve(); await finish.promise; return f.source.prepare(m, s, p)
  } }, f.runtime, f.store)
  const old = f.generate(service); await entered.promise
  const checking = service.inspect(f.manifest.id); await detection.promise
  if (completed) { finish.resolve(); assert.equal((await checking).state, 'ready') }
  const before = await f.store.read(); release.resolve(); await assert.rejects(old)
  assert.deepEqual(await f.store.read(), before)
  assert.equal((await service.list())[0].state, completed ? 'ready' : 'verifying')
  if (!completed) { finish.resolve(); assert.equal((await checking).state, 'ready') }
})

test('failure to persist invalidation stays unavailable in memory and explicitly reports storage failure', async () => {
  const f = await fixture(), before = await f.store.read()
  await writeFile(f.model, Buffer.alloc((await readFile(f.model)).length, 65))
  const service = new LocalModelService([f.manifest], f.source, f.runtime, { read: () => f.store.read(), save: async () => { throw Object.assign(Error('private/path/write'), { code: 'EPERM' }) } })
  await assert.rejects(f.generate(service), (error: unknown) => error instanceof AppError && error.code === 'STORAGE_ERROR' && /无法保存/.test(error.message) && !error.message.includes('private'))
  assert.equal(await service.ready(f.manifest.id), false); assert.deepEqual(await f.store.read(), before)
  assert.deepEqual(f.activity(), { runs: 3, downloads: 0 })
})

for (const [code, expected] of [['EPERM', /访问权限/], ['EACCES', /访问权限/], ['EBUSY', /占用/], ['ENOSPC', /空间不足/], ['UNKNOWN', /未完成/]] as const) test(`installation ${code} gives a safe actionable failure without raw paths`, async () => {
  const f = await fixture(), saved = deferred()
  const service = new LocalModelService([f.manifest], {
    discover: m => f.source.discover(m), prepare: (m, s, p) => f.source.prepare(m, s, p),
    installationInfo: async () => ({ canDownload: true, downloadBytes: 0, requiredDiskBytes: 0 }),
    install: async () => { throw Object.assign(Error('private/path token=secret'), { code }) }
  }, f.runtime, { read: () => f.store.read(), save: async rows => { await f.store.save(rows); if (rows[0].state === 'failed') saved.resolve() } })
  await service.install(f.manifest.id)
  await saved.promise
  const [view] = await service.list()
  assert.equal(view.state, 'failed'); assert.match(view.message, expected)
  assert.doesNotMatch(JSON.stringify(view), /private|secret|stack/)
  assert.equal((await f.store.read())[0].message, view.message); assert.deepEqual(f.activity(), { runs: 3, downloads: 0 })
})
