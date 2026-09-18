import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { calculateBookLength } from '../../../src/contracts/worldbuilding/book-length'
import { decodeBookProfileArgs } from '../../../src/contracts/ipc'
import { workspaceConfigIpcValueDecoders } from '../../../src/contracts/library/ipc-workspace-config-result-contracts'
import { fieldSpec } from '../../../src/main/modules/assistant/domain/assistant-field-target'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'
import { WorkspaceService } from '../../../src/main/modules/library/application/workspace-service'
import { DocumentService } from '../../../src/main/modules/manuscript/application/document-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../../src/main/modules/library/application/legacy-workspace-source'
import { ShadowImportService } from '../../../src/main/modules/library/application/shadow-import-service'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'
import { SqliteManuscriptService } from '../../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { FieldAssistantStore } from '../../../src/main/modules/assistant/adapters/field-assistant-store'
import { decodeFieldRequest, decodeFieldPermit, type FieldTask } from '../../../src/contracts/assistant/field-assistant-contracts'

const factors = { plannedVolumes: 8, chaptersPerVolume: 55, targetWordsPerChapter: 3500 }
test('retired total-word candidates stay readable without granting generation or application permission', async t => {
  const root = await mkdtemp(join(tmpdir(), 'retired-length-candidate-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = new FieldAssistantStore(root)
  const target = { fieldId: 'definition.bookProfile.targetWords', instanceId: 'old-total', editorSessionId: 'old-session', workItemId: 'book', pageId: 'profile', label: '全书目标字数', revision: 0, value: 2000000 }
  const candidate = { id: 'old-candidate', operationId: 'old-operation', target, before: 2000000, after: 1800000, dependencyFingerprint: 'old-fingerprint', model: 'fixture', connectionId: 'fixture', createdAt: '2026-09-10', status: 'candidate' as const }
  const task: FieldTask = { id: 'old-task', target, status: 'completed', createdAt: '2026-09-10', updatedAt: '2026-09-10', candidate }
  await store.write(task)
  assert.deepEqual(await store.read('book'), [task])
  assert.throws(() => decodeFieldRequest({ operationId: 'new-operation', target, instruction: '修改总字数' }), { code: 'VALIDATION_ERROR' })
  assert.throws(() => decodeFieldPermit({ token: 'token', candidateId: candidate.id, target, value: 1800000 }), { code: 'VALIDATION_ERROR' })
})
test('length preview uses the plan; empty, fractional and out-of-range inputs have no misleading total', () => {
  assert.deepEqual(calculateBookLength(factors), { chapters: 440, targetWords: 1_540_000 })
  for (const plannedVolumes of ['', '8', 0, -1, 1.5, 101, NaN, Infinity]) {
    assert.equal(calculateBookLength({ ...factors, plannedVolumes }), null)
  }
  for (const chaptersPerVolume of ['', 0, 501, 3.5]) assert.equal(calculateBookLength({ ...factors, chaptersPerVolume }), null)
  for (const targetWordsPerChapter of ['', 299, 50001]) assert.equal(calculateBookLength({ ...factors, targetWordsPerChapter }), null)
  assert.throws(() => fieldSpec('definition.bookProfile.targetWords'), { code: 'VALIDATION_ERROR' })
  assert.equal(fieldSpec('definition.bookProfile.plannedVolumes').kind, 'number')
})

for (const mode of ['files', 'sqlite'] as const) test(`${mode}: opening preserves stored bytes; explicit save derives total, keeps neighbours and rejects stale/invalid changes`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'book-length-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const settings = new SettingsStore(join(root, 'settings'), { available: () => true, encrypt: value => value, decrypt: value => value })
  const projects = new ProjectService(settings)
  const { project } = await projects.create({ parentPath: root, name: '篇幅隔离测试', genre: '玄幻' })
  const profileFile = join(project.path, '.webnovel', 'config', 'book-profile.json')
  const original = { ...JSON.parse(await readFile(profileFile, 'utf8')), ...factors, targetWords: 2_000_000, audienceScale: '保留作者的受众约束', futureOption: '保留未知扩展' }
  await writeFile(profileFile, JSON.stringify(original), 'utf8')
  let workspace = new WorkspaceService(projects)
  let authority: SqliteManuscriptService | undefined
  if (mode === 'sqlite') {
    const databases = new SqliteWorkspaceDatabaseFactory()
    const source = new CurrentProjectLegacyWorkspaceSource(projects, new DocumentService(projects))
    const importer = new ShadowImportService(source, databases)
    await importer.import(await importer.preview())
    authority = new SqliteManuscriptService(databases)
    await authority.activate(project.path, await source.snapshot())
    workspace = new WorkspaceService(projects, undefined, undefined, undefined, undefined, undefined, authority)
  }
  const fileBefore = await readFile(profileFile, 'utf8')
  const configBefore = authority && await authority.projectWritingConfig(project.path)
  const profile = await workspace.bookProfile()
  assert.equal(profile.targetWords, 1_540_000)
  assert.equal(await readFile(profileFile, 'utf8'), fileBefore)
  if (authority) assert.deepEqual(await authority.projectWritingConfig(project.path), configBefore)

  // A cached legacy total never overrides the three submitted factors.
  const saved = await workspace.saveBookProfile({ ...profile, plannedVolumes: 9, targetWords: 2_000_000 })
  assert.equal(saved.targetWords, 1_732_500)
  assert.equal(saved.audienceScale, original.audienceScale)
  const mirror = JSON.parse(await readFile(join(project.path, '.webnovel', 'config', mode === 'files' ? 'book-profile.json' : 'project-writing.json'), 'utf8'))
  assert.equal(mirror.targetWords, saved.targetWords)
  assert.equal((mode === 'files' ? mirror : mirror.extensions).futureOption, original.futureOption)
  if (authority) assert.equal((await authority.projectWritingConfig(project.path)).targetWords, saved.targetWords)
  assert.equal((await workspace.bookProfile()).targetWords, saved.targetWords)
  await assert.rejects(() => workspace.saveBookProfile({ ...profile, plannedVolumes: 4 }), { code: 'CONFLICT' })
  await assert.rejects(() => workspace.saveBookProfile({ ...saved, plannedVolumes: 0 }), { code: 'VALIDATION_ERROR' })
  assert.equal((await workspace.bookProfile()).targetWords, saved.targetWords)

  // Both legal extremes must cross IPC, persist and reopen without the old total limits.
  for (const plan of [
    { plannedVolumes: 1, chaptersPerVolume: 1, targetWordsPerChapter: 300 },
    { plannedVolumes: 100, chaptersPerVolume: 500, targetWordsPerChapter: 50_000 }
  ]) {
    const input = { ...await workspace.bookProfile(), ...plan, targetWords: calculateBookLength(plan)!.targetWords }
    const [decoded] = decodeBookProfileArgs([input])
    const result = await workspace.saveBookProfile(decoded)
    assert.equal(result.targetWords, input.targetWords)
    assert.deepEqual(workspaceConfigIpcValueDecoders['workspace:get-book-profile'](result, 'profile'), result)
    assert.equal((await workspace.bookProfile()).targetWords, input.targetWords)
  }
})
