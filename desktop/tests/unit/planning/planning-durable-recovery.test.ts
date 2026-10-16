import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { PlanningJobService } from '../../../src/main/modules/planning/application/planning-job-service'
import { PlanningDraftService } from '../../../src/main/modules/planning/application/planning-draft-service'
import { PlanningRecoveryStore, type PlanningRecoveryRecord } from '../../../src/main/modules/planning/application/planning-recovery-store'
import { PlanningPackageService } from '../../../src/main/modules/planning/application/planning-package-service'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'
import { WorkspaceService } from '../../../src/main/modules/library/application/workspace-service'
import { DocumentService } from '../../../src/main/modules/manuscript/application/document-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../../src/main/modules/library/application/legacy-workspace-source'
import { ShadowImportService } from '../../../src/main/modules/library/application/shadow-import-service'
import type { PlanningJob } from '../../../src/contracts/index'

async function fixture(t: TestContext, sqlite = false) {
  const root = await mkdtemp(join(tmpdir(), 'planning-recovery-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const projects = new ProjectService(new SettingsStore(join(root, 'settings'), { available: () => true, encrypt: x => x, decrypt: x => x }))
  const { project } = await projects.create({ parentPath: root, name: '恢复测试', genre: '悬疑' })
  const databases = new SqliteWorkspaceDatabaseFactory()
  if (sqlite) { const importer = new ShadowImportService(new CurrentProjectLegacyWorkspaceSource(projects, new DocumentService(projects)), databases); await importer.import(await importer.preview()) }
  const workspace = new WorkspaceService(projects)
  await workspace.saveBookProfile({ ...await workspace.bookProfile(), plannedVolumes: 1 })
  await workspace.saveFoundation({ creationPath: 'materials', sourceNotes: '张三核对旧信并找到寄信人。', worldView: '', useRealms: false, useSystem: false })
  const calls: string[] = []; let valid = false, model = 'model-a'
  const draft = new PlanningDraftService({ completionIdentity: async () => model, complete: async prompt => {
    calls.push(prompt)
    if (prompt.startsWith('复核下方')) return { content: JSON.stringify({ issues: valid ? [] : [{ category: 'continuity', quote: '错误的引用', parentQuote: '', reason: '核对人物', needsAuthor: false }] }) }
    if (prompt.includes('"premise":"一句核心命题"')) return { content: JSON.stringify({ premise: '核对旧信', worldView: '现实城市', characters: [{ name: '张三', role: '调查者', arcSeed: '寻找寄信人' }], powerSystem: '', cheatSystem: '', rationale: '追查' }) }
    if (prompt.includes('"volumes"')) return { content: JSON.stringify({ volumes: [{ order: 1, title: '旧信', goal: '调查', summary: '找到寄信人', ending: '释怀', storyContent: '张三找到寄信人，确认旧信来源。' }] }) }
    return { content: JSON.stringify({ title: '旧信', summary: '追查', content: '张三核对旧信后找到寄信人。' }) }
  } }, workspace)
  const store = new PlanningRecoveryStore(projects, databases), proposals = new PlanningPackageService(projects)
  const service = () => new PlanningJobService(draft, undefined, undefined, store, proposals)
  return { root: project.path, owner: project.id, projects, workspace, databases, calls, store, proposals, draft, service,
    valid: () => { valid = true }, changeModel: () => { model = 'model-b' } }
}
async function settled(service: PlanningJobService, id: string): Promise<PlanningJob> {
  for (let n = 0; n < 400; n++) { const s = service.status(id); if (s.status !== 'running') { await new Promise(r => setTimeout(r, 80)); return service.status(id) }; await new Promise(r => setTimeout(r, 10)) }
  throw new Error('job did not settle')
}
for (const sqlite of [false, true]) test(`durable ${sqlite ? 'sqlite' : 'legacy'} recovery retains candidate, parent and idempotent child`, async t => {
  const f = await fixture(t, sqlite), jobs = f.service()
  assert.deepEqual(await f.store.list(), [])
  const start = jobs.start(f.owner), failed = await settled(jobs, start.id)
  assert.equal(failed.status, 'failed', JSON.stringify(failed)); assert.deepEqual(failed.recovery, { saved: true, action: 'review' })
  assert.equal(f.calls.length, 3)
  const before = JSON.stringify((await f.store.list()).find(r => r.job.id === start.id))
  const details = await jobs.read(start.id, f.owner, true); assert.match(details.rawResult!, /核对旧信/); assert.equal(jobs.status(start.id).rawResult, undefined)
  const reopened = f.service(); assert.equal((await reopened.recent(f.owner))[0].id, start.id); assert.equal(f.calls.length, 3)
  f.valid(); const operation = randomUUID()
  const [a, b] = await Promise.all([reopened.retry(start.id, operation, f.owner), reopened.retry(start.id, operation, f.owner)])
  assert.equal(a.id, b.id); const result = await settled(reopened, a.id); assert.equal(result.status, 'completed', JSON.stringify(result))
  assert.equal(f.calls.length, 8, 'only review then two remaining generation/review pairs')
  assert.equal((await reopened.retry(start.id, operation, f.owner)).id, a.id)
  assert.equal(JSON.stringify((await f.store.list()).find(r => r.job.id === start.id)), before)
  assert.equal((await f.proposals.get())?.id, result.proposal?.id)
  await assert.rejects(reopened.read(start.id, 'another-book'), /不属于/)
  if (!sqlite) assert.equal((await readdir(join(f.root, '.webnovel'))).includes('workspace.sqlite'), false)
})
test('changed source or model blocks continuation without a fresh model request', async t => {
  const f = await fixture(t), jobs = f.service(), first = jobs.start(f.owner); await settled(jobs, first.id)
  f.changeModel()
  const child = await jobs.retry(first.id, randomUUID(), f.owner)
  assert.equal((await settled(jobs, child.id)).status, 'failed'); assert.equal(f.calls.length, 3)
  await f.workspace.saveFoundation({ ...await f.workspace.foundation(), sourceNotes: '修改后的素材' })
  await assert.rejects(jobs.retry(first.id, randomUUID(), f.owner), /素材或设置已经变化/)
  assert.equal(f.calls.length, 3)
})
test('final local-save retry has zero model calls and never overwrites edited candidates', async t => {
  const f = await fixture(t); f.valid(); let fail = true
  const jobs = new PlanningJobService(f.draft, undefined, undefined, f.store, { get: () => f.proposals.get(), save: async (p, guard) => { if (fail) throw Error('disk'); return f.proposals.save(p, guard) } })
  const first = jobs.start(f.owner), failed = await settled(jobs, first.id)
  assert.equal(failed.recovery?.action, 'save'); assert.equal(f.calls.length, 6)
  fail = false; const child = await jobs.retry(first.id, randomUUID(), f.owner, true)
  const result = await settled(jobs, child.id); assert.equal(result.status, 'completed'); assert.equal(f.calls.length, 6)
  const old = (await f.proposals.get())!; await f.proposals.save({ ...old, totalOutline: { ...old.totalOutline, content: '作者编辑' } })
  const second = await jobs.retry(first.id, randomUUID(), f.owner, true)
  assert.equal((await settled(jobs, second.id)).status, 'failed'); assert.equal((await f.proposals.get())!.totalOutline.content, '作者编辑'); assert.equal(f.calls.length, 6)
})
test('corrupt file is preserved and read never repairs or starts a model call', async t => {
  const f = await fixture(t), jobs = f.service(), first = jobs.start(f.owner); await settled(jobs, first.id)
  const path = join(f.root, '.webnovel/planning-recovery', `${first.id}.json`); await writeFile(path, '{broken')
  await assert.rejects(f.service().recent(f.owner), /记录损坏/); assert.equal(await readFile(path, 'utf8'), '{broken'); assert.equal(f.calls.length, 3)
})
test('failed checkpoint write does not claim saved or make a model request', async t => {
  const f = await fixture(t)
  class RejectingStore extends PlanningRecoveryStore { override async save(): Promise<void> { throw Error('disk rejected') } }
  const jobs = new PlanningJobService(f.draft, undefined, undefined, new RejectingStore(f.projects, f.databases), f.proposals)
  const first = jobs.start(f.owner), failed = await settled(jobs, first.id)
  assert.deepEqual(failed.recovery, { saved: false, action: 'none' }); assert.match(failed.error!.message, /保存失败/); assert.equal(f.calls.length, 0)
})
test('cancelled late response does not save a proposal or trigger a review', async t => {
  const f = await fixture(t); let release!: () => void, requested!: () => void
  const gate = new Promise<void>(r => { release = r }), sent = new Promise<void>(r => { requested = r })
  const draft = new PlanningDraftService({ complete: async () => { requested(); await gate; return { content: '{}' } } }, f.workspace)
  const jobs = new PlanningJobService(draft, undefined, undefined, f.store, f.proposals)
  const first = jobs.start(f.owner); await sent; await jobs.cancelSaved(first.id, f.owner)
  release(); await settled(jobs, first.id)
  assert.equal(jobs.status(first.id).status, 'cancelled'); assert.equal(await f.proposals.get(), null)
  assert.equal((await f.service().recent(f.owner))[0].status, 'cancelled')
})
test('source mutation during model response prevents candidate promotion', async t => {
  const f = await fixture(t); let calls = 0
  const draft = new PlanningDraftService({ complete: async () => {
    calls++; await f.workspace.saveFoundation({ ...await f.workspace.foundation(), sourceNotes: '在返回前修改资料' }); return { content: '{}' }
  } }, f.workspace)
  const jobs = new PlanningJobService(draft, undefined, undefined, f.store, f.proposals), first = jobs.start(f.owner)
  const result = await settled(jobs, first.id); assert.equal(result.status, 'failed'); assert.match(result.error!.message, /素材、设置或模型已经变化/); assert.equal(calls, 1); assert.equal(await f.proposals.get(), null)
})
test('poll remains running until failed result has durable acknowledgement', async t => {
  const f = await fixture(t); let release!: () => void, ready!: () => void
  const gate = new Promise<void>(r => { release = r }), waiting = new Promise<void>(r => { ready = r })
  t.after(() => release())
  class SlowStore extends PlanningRecoveryStore {
    override async save(record: PlanningRecoveryRecord): Promise<void> {
      if (record.job.status === 'failed') { ready(); await gate }
      return super.save(record)
    }
  }
  const jobs = new PlanningJobService(f.draft, undefined, undefined, new SlowStore(f.projects, f.databases), f.proposals)
  const first = jobs.start(f.owner); await waiting
  assert.equal(jobs.status(first.id).status, 'running')
  release(); const result = await settled(jobs, first.id)
  assert.equal(result.status, 'failed'); assert.deepEqual(result.recovery, { saved: true, action: 'review' })
})
