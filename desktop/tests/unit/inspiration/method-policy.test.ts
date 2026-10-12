import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { validatePluginManifest, type PluginComposition } from '@lanjian/writing-plugin-contracts'
import { officialCreativePackages } from '@lanjian/writing-plugin-package/official'
import { InspirationService, type InspirationModels } from '../../../src/main/modules/inspiration/application/inspiration-service'
import { InspirationStore } from '../../../src/main/modules/inspiration/adapters/inspiration-store'
import { inspirationModels } from '../../../src/main/modules/inspiration/adapters/original-ports'
import { inspirationDigest } from '../../../src/main/modules/inspiration/domain/source'
import { PluginPackageStore } from '../../../src/main/modules/writing-plugins/adapters/package-store'
import { buildPluginContent } from '../../../src/main/modules/writing-plugins/adapters/draft-builder'
import { createCreativePolicyProvider } from '../../../src/main/modules/writing-plugins/runtime/creative-policy-provider'
import { currentContributionSnapshot, withContributionSnapshot } from '../../../src/main/modules/writing-plugins/runtime/contribution-context'
import { creativePolicyRun, type CaptureCreativePolicy } from '../../../src/main/modules/writing-plugins/domain/creative-policy'
import { currentCreativePolicyRun, withCreativePolicyRun } from '../../../src/main/modules/writing-plugins/application/creative-policy-execution'
import { decodeInspirationJob, decodeInspirationCard } from '../../../src/contracts/inspiration/validation'
import type { InstalledVersion } from '../../../src/main/modules/writing-plugins/domain/installed'
import { AppError } from '../../../src/main/core/errors/app-error'
import { OpenAiCompatibleTextClient } from '../../../src/main/modules/models/adapters/openai-compatible-text-client'

const profile = { connectionId: 'global-metadata-fixture', model: 'metadata-fixture', parameterPolicy: { version: 2 as const, mode: 'auto' as const } }
const sourceText = '资料员选择标签甲，审核员记录标签甲并保留核对依据。'
function metadataResponse(instruction: string) {
  const input = JSON.parse(instruction.split('\n').at(-1)!)
  const evidence = Array.isArray(input) ? input.flatMap(c => c.evidence).slice(0, 1) : [{ segmentId: input.segmentId, quote: input.text.slice(0, 30) }]
  return JSON.stringify({ cards: [{ title: '标签核对记录', narrative: '本记录只保留来源中已有的标签核对信息。', tags: ['元数据'], characters: [], conflict: '', choice: '', outcome: '', turn: '', foreshadowing: '', evidence }] })
}
async function settle(library: InspirationService, id: string) {
  for (let n = 0; n < 1000; n++) { const job = await library.getJob(id); if (job.status !== 'running') return job; await delay(5) }
  throw Error('Metadata extraction did not settle')
}
async function source(library: InspirationService) {
  const preview = await library.importPreview([{ name: '合成元数据核对.txt', dataBase64: Buffer.from(sourceText).toString('base64') }])
  return (await library.importCommit(preview.token))[0]
}
const request = (s: { id: string; version: string }, maxCalls = 2) => ({ sourceId: s.id, sourceVersion: s.version, operationId: randomUUID(), profile, maxCalls })

/** Production ZIP build/read/publish/load and policy provider. Authorization is
 * an injected application port here; real global selection/grants belong to D2. */
async function fixture(t: TestContext, storeGuard: (extra?: number) => Promise<void> = async () => {}) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-inspiration-methods-'))
  const packages = new PluginPackageStore(root)
  const versions: InstalledVersion[] = []
  for (const version of ['1.0.0', '1.1.0']) {
    const manifest = validatePluginManifest({ apiVersion: 1, id: 'personal.inspiration-methods', version, name: '合成资料方法核对', description: '仅核对合成资料的方法版本，不执行工具。', runtime: 'quickjs-js', entry: 'main.js', capabilities: [], tools: [], assets: ['extract.md', 'summary.md'], contributions:
      ['inspiration-extract', 'inspiration-summary'].map((slot, i) => ({ id: i ? 'summary' : 'extract', name: i ? '汇总核对' : '提取核对', kind: 'creative-policy', slot, mode: 'replace', asset: i ? 'summary.md' : 'extract.md', stages: ['assistant'], configSchema: { type: 'object', properties: { tag: { type: 'string', maxLength: 80 } }, required: ['tag'], additionalProperties: false } })) })
    const built = await buildPluginContent({ manifestText: JSON.stringify(manifest), files: [
      { path: 'main.js', content: 'export function execute(){throw Error("No tool declared")}' },
      { path: 'extract.md', content: `D1_EXTRACT_${version} {{tag}}` }, { path: 'summary.md', content: `D1_SUMMARY_${version} {{tag}}` }
    ] })
    versions.push(await packages.publish(built.pkg))
  }
  let selected = 0, revision = 1, tag = 'ORIGINAL_PARAM', authorized = true, captures = 0
  const calls: string[] = [], restores: string[] = []
  const composition = (): PluginComposition => ({ revision, entries: ['extract', 'summary'].map(contributionId => ({ pluginId: versions[selected].manifest.id, digest: versions[selected].digest, contributionId, params: { tag } })) })
  const load = async (version: typeof versions[number]) => { if (!authorized) throw new AppError('CONFLICT', '资料方法授权已撤回。', { recoverable: true }); return packages.load(version) }
  const policies = createCreativePolicyProvider(async () => ({ versions: [versions[selected]], composition: composition() }), load, async ref => {
    restores.push(ref.version); const version = versions.find(v => v.digest === ref.digest && v.manifest.id === ref.pluginId && v.manifest.version === ref.version)
    assert.ok(version); return { version, files: await load(version) }
  })
  const models: InspirationModels = { capture: async () => { captures++; return { fingerprint: inspirationDigest(profile), complete: async instruction => { calls.push(instruction); return metadataResponse(instruction) } } } }
  let store = new InspirationStore(root, 'author', storeGuard), library = new InspirationService(store, models, policies)
  t.after(async () => { await library.shutdown(); await rm(root, { recursive: true, force: true }) })
  return { root, versions, packages, policies, models, calls, restores, get captures() { return captures }, get store() { return store }, get library() { return library },
    select(index: number, nextTag = 'EDITED_PARAM') { selected = index; tag = nextTag; revision++ }, revoke() { authorized = false },
    async reopen() { await library.shutdown(); store = new InspirationStore(root, 'author', storeGuard); library = new InspirationService(store, models, policies); return library }
  }
}

test('real original stream transport receives the actual default extract and summary assets, and persists private snapshot/public provenance', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-inspiration-default-')), requests: Array<{ messages: Array<{ role: string; content: string }>; tools: unknown[]; stream: boolean }> = []
  const connection = { kind: 'openai-compatible' as const, connectionId: profile.connectionId, connectionName: 'Metadata', baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture-only', profile }
  const client = new OpenAiCompatibleTextClient({ resolve: async () => connection, resolveConnection: async () => connection }, async (_url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body)
    const content = metadataResponse(body.messages.at(-1).content)
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  })
  const model = await client.prepareToolConversation('outline')
  const store = new InspirationStore(root, 'author'), library = new InspirationService(store, inspirationModels(async () => ({ identity: inspirationDigest(profile), model, run: async work => work() })))
  t.after(async () => { await library.shutdown(); await rm(root, { recursive: true, force: true }) })
  const s = await source(library), job = await settle(library, (await library.extract(request(s))).id)
  assert.equal(job.status, 'succeeded', job.notice); assert.equal(requests.length, 2)
  for (const r of requests) { assert.equal(r.stream, true); assert.deepEqual(r.tools, []); assert.ok(!r.messages[0].content.includes('提取可追溯的小说灵感')) }
  assert.ok(requests[0].messages.at(-1)!.content.includes('这是实际原文的一个片段'))
  assert.ok(requests[1].messages.at(-1)!.content.includes('根据以下已提取的卡和逐字证据整理一个故事弧'))
  assert.deepEqual(job.creativePolicy?.map(p => p.slot), ['inspiration-extract', 'inspiration-summary'])
  assert.ok(job.creativePolicy?.every(p => p.version === '1.7.0'))
  const policy = await store.policy(job.id); assert.ok(policy); assert.equal(policy.installed.length, 0)
  const cards = (await library.search({ query: '' })).cards
  assert.equal(cards.length, 2); assert.ok(cards.every(c => c.creativePolicy?.length === 1))
  assert.equal(cards.find(c => c.kind === 'scene')?.creativePolicy?.[0].slot, 'inspiration-extract')
  assert.equal(cards.find(c => c.kind === 'arc')?.creativePolicy?.[0].slot, 'inspiration-summary')
  assert.equal((await store.document(s.id, s.version)).text, sourceText)
})

test('real package versions and original parameters survive composition changes and normal restart; cache binds private methods', async t => {
  const f = await fixture(t), s = await source(f.library), initial = request(s, 1)
  const paused = await settle(f.library, (await f.library.extract(initial)).id)
  assert.equal(paused.status, 'paused-limit'); assert.equal(f.calls.length, 1)
  const originalPolicy = await f.store.policy(paused.id); f.select(1)
  await f.reopen(); const opened = await f.library.getJob(paused.id)
  assert.equal(f.calls.length, 1); assert.equal(opened.status, 'paused-limit')
  const done = await settle(f.library, (await f.library.resume({ jobId: paused.id, expectedRevision: opened.revision })).id)
  assert.equal(done.status, 'succeeded', done.notice); assert.equal(f.calls.length, 2)
  assert.ok(f.calls[1].includes('D1_SUMMARY_1.0.0 ORIGINAL_PARAM')); assert.ok(!f.calls[1].includes('D1_SUMMARY_1.1.0'))
  assert.ok(f.restores.every(version => version === '1.0.0')); assert.deepEqual(await f.store.policy(done.id), originalPolicy)
  const duplicate = await f.library.extract(initial); assert.equal(duplicate.id, done.id); assert.equal(f.calls.length, 2)
  const newer = await settle(f.library, (await f.library.extract(request(s))).id)
  assert.notEqual(newer.id, done.id); assert.equal(newer.status, 'succeeded', newer.notice); assert.equal(f.calls.length, 4)
  assert.ok(f.calls[2].includes('D1_EXTRACT_1.1.0 EDITED_PARAM')); assert.ok(!f.calls[2].includes('这是实际原文的一个片段'))
  assert.equal((await f.library.extract(request(s))).id, newer.id); assert.equal(f.calls.length, 4)
})

test('a library request clears the calling book policy and contribution scope without changing the caller', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-inspiration-scope-')), observed: string[] = []
  const book = creativePolicyRun([], { revision: 87, entries: [] })
  const models: InspirationModels = { capture: async () => ({ fingerprint: inspirationDigest(profile), complete: async instruction => {
    assert.notEqual(currentCreativePolicyRun(), book); assert.deepEqual(currentContributionSnapshot()?.versions, []); assert.equal(currentContributionSnapshot()?.composition.revision, 0)
    observed.push(instruction); return metadataResponse(instruction)
  } }) }
  const library = new InspirationService(new InspirationStore(root, 'author'), models)
  t.after(async () => { await library.shutdown(); await rm(root, { recursive: true, force: true }) })
  const s = await source(library)
  await withContributionSnapshot({ versions: [], composition: { revision: 87, entries: [] } }, () => withCreativePolicyRun(book, async () => {
    const done = await settle(library, (await library.extract(request(s))).id); assert.equal(done.status, 'succeeded', done.notice)
    assert.equal(currentCreativePolicyRun(), book); assert.equal(currentContributionSnapshot()?.composition.revision, 87)
  }))
  assert.equal(observed.length, 2)
})

test('disabled methods reject before model capture, and malformed/foreign-slot public provenance cannot cross the decoder', async t => {
  const f = await fixture(t), s = await source(f.library), original = await f.policies()
  const defaults = officialCreativePackages(), pkg = defaults.find(p => p.manifest.id.endsWith('story-planning'))!
  const changed = { ...pkg, manifest: validatePluginManifest({ ...pkg.manifest, id: 'personal.disabled-inspiration', contributions: pkg.manifest.contributions?.filter(c => c.kind === 'creative-policy' && c.slot === 'inspiration-extract').map(c => { if (c.kind !== 'creative-policy') throw Error('Expected method'); const { asset: _asset, ...method } = c; return { ...method, mode: 'disabled' } }) }) }
  const disabled: CaptureCreativePolicy = async () => creativePolicyRun([changed], { revision: 1, entries: [{ pluginId: changed.manifest.id, digest: changed.digest, contributionId: 'inspiration-extract', params: {} }] })
  const library = new InspirationService(f.store, f.models, disabled)
  await assert.rejects(library.extract(request(s)), { code: 'FEATURE_UNAVAILABLE' }); assert.equal(f.captures, 0); assert.equal(f.calls.length, 0)
  const job = await settle(f.library, (await f.library.extract(request(s))).id), card = (await f.library.search({ query: '' })).cards[0]
  assert.throws(() => decodeInspirationJob({ ...job, creativePolicy: [{ ...job.creativePolicy![0], slot: 'prose' }] }), { code: 'VALIDATION_ERROR' })
  assert.throws(() => decodeInspirationCard({ ...card, creativePolicy: [{ ...card.creativePolicy![0], root: 'foreign-author' }] }), { code: 'VALIDATION_ERROR' })
  const { creativePolicy: _records, ...legacy } = job
  assert.ok(!Object.hasOwn(decodeInspirationJob(legacy), 'creativePolicy')); assert.ok(original.snapshot)
})

test('revocation in the actual SQLite quota/commit window preserves a known received attempt and publishes no card', async t => {
  let armed = false, revoke = () => {}
  const f = await fixture(t, async extra => { if (armed && extra) { armed = false; revoke() } }); revoke = () => f.revoke()
  f.models.capture = async () => ({ fingerprint: inspirationDigest(profile), complete: async instruction => { f.calls.push(instruction); armed = true; return metadataResponse(instruction) } })
  const s = await source(f.library), done = await settle(f.library, (await f.library.extract(request(s))).id)
  assert.equal(done.status, 'failed', done.notice); assert.equal(done.calls, 1); assert.equal(done.units[0].status, 'failed')
  assert.equal(done.processed, 0); assert.deepEqual(done.cardIds, []); assert.equal((await f.library.search({ query: '' })).total, 0)
  assert.equal(f.calls.length, 1); await f.reopen(); assert.equal((await f.library.getJob(done.id)).status, 'failed'); assert.equal(f.calls.length, 1)
  assert.equal((await f.store.document(s.id, s.version)).text, sourceText)
})

test('real SQLite private-policy insertion failure rolls back job and operation atomically before any provider call', async t => {
  const f = await fixture(t), s = await source(f.library), db = new DatabaseSync(join(f.store.root, 'library.sqlite'))
  db.exec("CREATE TRIGGER reject_policy BEFORE INSERT ON job_policies BEGIN SELECT RAISE(ABORT,'fixture policy write failed'); END;")
  await assert.rejects(f.library.extract(request(s)))
  assert.equal(f.calls.length, 0); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM jobs').get()?.n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM operations').get()?.n, 0); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM job_policies').get()?.n, 0); db.close()
  assert.equal((await f.store.document(s.id, s.version)).text, sourceText)
})

test('real SQLite sent-intent failure records zero provider attempts and publishes no card', async t => {
  const f = await fixture(t), s = await source(f.library), db = new DatabaseSync(join(f.store.root, 'library.sqlite'))
  db.exec("CREATE TRIGGER reject_sent BEFORE UPDATE ON jobs WHEN json_extract(NEW.payload,'$.units[0].status')='sent' BEGIN SELECT RAISE(ABORT,'fixture sent write failed'); END;")
  const done = await settle(f.library, (await f.library.extract(request(s))).id)
  assert.equal(done.status, 'failed'); assert.equal(done.calls, 0); assert.equal(done.units[0].status, 'failed')
  assert.equal(f.calls.length, 0); assert.equal(done.processed, 0); assert.deepEqual(done.cardIds, [])
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cards').get()?.n, 0); db.close()
  await f.reopen(); assert.equal((await f.library.getJob(done.id)).calls, 0); assert.equal(f.calls.length, 0)
})

test('lost acknowledgement after real atomic job creation stays idle on restart and restores original methods only on explicit resume', async t => {
  const f = await fixture(t), s = await source(f.library), input = request(s), create = f.store.createJob.bind(f.store)
  f.store.createJob = async (...args) => { await create(...args); throw Error('fixture lost acknowledgement after commit') }
  await assert.rejects(f.library.extract(input), /lost acknowledgement/); assert.equal(f.calls.length, 0)
  const committed = (await f.store.jobs())[0], snapshot = await f.store.policy(committed.id)
  assert.ok(snapshot); assert.equal(committed.creativePolicy?.[0].version, '1.0.0'); f.select(1)
  await f.reopen(); const interrupted = await f.library.getJob(committed.id)
  assert.equal(interrupted.status, 'interrupted'); assert.equal(f.calls.length, 0)
  assert.equal((await f.library.extract(input)).id, committed.id); assert.equal(f.calls.length, 0)
  const done = await settle(f.library, (await f.library.resume({ jobId: committed.id, expectedRevision: interrupted.revision })).id)
  assert.equal(done.status, 'succeeded', done.notice); assert.equal(f.calls.length, 2)
  assert.ok(f.calls.every(call => call.includes('1.0.0 ORIGINAL_PARAM') && !call.includes('1.1.0')))
  assert.deepEqual(await f.store.policy(done.id), snapshot); assert.equal((await f.store.document(s.id, s.version)).text, sourceText)
})

test('private/public method mismatch and absent legacy snapshot reject explicit resume before model capture, without rewriting history', async t => {
  const f = await fixture(t), s = await source(f.library), paused = await settle(f.library, (await f.library.extract(request(s, 1))).id)
  await f.library.shutdown(); const file = join(f.store.root, 'library.sqlite'), db = new DatabaseSync(file)
  const payload = JSON.parse(String(db.prepare('SELECT payload FROM jobs WHERE id=?').get(paused.id)?.payload))
  payload.creativePolicy[0].version = '1.9.9'; db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(payload), paused.id); db.close()
  await f.reopen(); const captures = f.captures, calls = f.calls.length
  await assert.rejects(f.library.resume({ jobId: paused.id, expectedRevision: paused.revision }), { code: 'CONFLICT' })
  assert.equal(f.captures, captures); assert.equal(f.calls.length, calls)
  await f.library.shutdown(); const legacyDb = new DatabaseSync(file)
  delete payload.creativePolicy; legacyDb.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(payload), paused.id)
  legacyDb.prepare('DELETE FROM job_policies WHERE job_id=?').run(paused.id); legacyDb.close()
  const before = await readFile(file); await f.reopen(); assert.ok(!Object.hasOwn(await f.library.getJob(paused.id), 'creativePolicy'))
  await assert.rejects(f.library.resume({ jobId: paused.id, expectedRevision: paused.revision }), { code: 'FEATURE_UNAVAILABLE' })
  assert.equal(f.captures, captures); assert.equal(f.calls.length, calls); assert.deepEqual(await readFile(file), before)
})

test('known schema two upgrades preserve private source bytes; a separate owner cannot read another author job', async t => {
  const f = await fixture(t), s = await source(f.library), document = await f.store.document(s.id, s.version)
  await f.library.shutdown(); const file = join(f.store.root, 'library.sqlite'), db = new DatabaseSync(file)
  db.exec('DROP TABLE source_classifications; DROP TABLE job_policies; PRAGMA user_version=2'); const original = String(db.prepare('SELECT payload FROM sources').get()?.payload); db.close()
  await f.reopen(); assert.deepEqual(await f.store.document(s.id, s.version), document)
  const upgraded = new DatabaseSync(file); assert.equal(upgraded.prepare('PRAGMA user_version').get()?.user_version, 4)
  assert.equal(upgraded.prepare('SELECT payload FROM sources').get()?.payload, original); upgraded.close()
  const job = await settle(f.library, (await f.library.extract(request(s))).id), other = new InspirationStore(f.root, 'another-author')
  await assert.rejects(other.job(job.id), { code: 'NOT_FOUND' }); assert.equal(await other.policy(job.id), undefined); other.close()
  assert.equal((await f.store.document(s.id, s.version)).text, sourceText)
})
