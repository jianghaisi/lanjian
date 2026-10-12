import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { CharacterStateService } from '../../../src/main/modules/characters/application/character-state-service'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { ResearchLibraryService } from '../../../src/main/modules/library/application/research-library-service'
import { WorkspaceService } from '../../../src/main/modules/library/application/workspace-service'
import { DocumentService } from '../../../src/main/modules/manuscript/application/document-service'
import { OutlinePlanningService } from '../../../src/main/modules/planning/application/outline-planning-service'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

async function observedBeforeRelease(signal: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      signal.then(() => true),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 5_000) })
    ])
  } finally { clearTimeout(timer) }
}

class ObservedWorkspace extends WorkspaceService {
  readonly workflowFinished = deferred()
  workflowCalls = 0
  realmReads = 0
  override async workflowStatus(...args: Parameters<WorkspaceService['workflowStatus']>) {
    this.workflowCalls++
    const value = await super.workflowStatus(...args)
    this.workflowFinished.resolve()
    return value
  }
  override async realms() { this.realmReads++; return super.realms() }
}

async function fixture(t: TestContext, options: { characterFailure?: boolean; planningFailure?: boolean; holdPlanning?: boolean } = {}) {
  const parent = await realpath(tmpdir())
  const root = await mkdtemp(join(parent, 'lanjian-projection-schedule-'))
  t.after(async () => {
    assert.equal(await realpath(root), root)
    assert.equal(dirname(root), parent)
    await rm(root, { recursive: true, force: true })
  })
  const settings = new SettingsStore(join(root, 'settings'), { available: () => true, encrypt: value => value, decrypt: value => value })
  const projects = new ProjectService(settings)
  const { project } = await projects.create({ parentPath: root, name: '读取顺序测试', genre: '悬疑' })
  const documents = new DocumentService(projects)
  await documents.updateChapter(1, { title: '雾中的来信', content: '沈砚拆开信封，看见一张旧钟楼的照片。' })
  await documents.updateOutline('total', '从旧钟楼的照片追查寄信人。')
  await documents.updateChapterOutline(1, '沈砚收到照片，决定去旧钟楼。')
  const research = new ResearchLibraryService(projects)
  const planning = new OutlinePlanningService(projects, documents, research)
  const characters = new CharacterStateService(projects)
  const releaseCharacters = deferred(), charactersRead = deferred()
  const releasePlanning = deferred(), planningRead = deferred()
  if (!options.holdPlanning) releasePlanning.resolve()
  let chapterReads = 0, planningReads = 0
  const workspace = new ObservedWorkspace(projects, {
    status: async id => {
      planningReads++
      if (options.planningFailure) throw new Error('planning read failed')
      const value = await planning.status(id)
      planningRead.resolve()
      await releasePlanning.promise
      return value
    }
  }, research, {
    chapter: async id => { chapterReads++; return documents.chapter(id) },
    outline: volume => documents.outline(volume), chapterOutline: id => documents.chapterOutline(id)
  }, {
    state: async () => {
      const state = await characters.state()
      charactersRead.resolve()
      await releaseCharacters.promise
      if (options.characterFailure) throw new Error('character read failed')
      return state
    }
  })
  return { root, project, projects, documents, workspace, releaseCharacters, charactersRead, releasePlanning, planningRead,
    counts: () => ({ chapterReads, planningReads, realmReads: workspace.realmReads, workflowCalls: workspace.workflowCalls }) }
}

test('real workflow completes while independent character state is pending; publication still waits', async t => {
  const f = await fixture(t)
  let settled = false
  const pending = f.workspace.chapterProjection(1)
  void pending.then(() => { settled = true }, () => { settled = true })
  try {
    assert.equal(await observedBeforeRelease(f.workspace.workflowFinished.promise), true, 'workflow must not wait for character state')
    assert.equal(settled, false, 'projection must still wait for character checks')
    assert.deepEqual(f.counts(), { chapterReads: 1, planningReads: 1, realmReads: 1, workflowCalls: 1 })
  } finally { f.releaseCharacters.resolve(); await pending.catch(() => undefined) }
  const value = await pending
  assert.equal(value.chapterId, 1)
  assert.equal(value.planning.totalOutlineExists, true)
  assert.equal(value.workflow.steps.find(step => step.id === 'outline')?.state, 'complete')
  assert.equal(value.workflow.readyForProse, false, 'unconfirmed chapter remains blocked')
  assert.deepEqual(value.workflow, await f.workspace.workflowStatus(1))
  assert.equal((await f.documents.chapter(1)).content, '沈砚拆开信封，看见一张旧钟楼的照片。')
})

test('late character read failure rejects the projection even after real workflow completion', async t => {
  const f = await fixture(t, { characterFailure: true })
  const pending = f.workspace.chapterProjection(1)
  const rejected = assert.rejects(pending, /character read failed/)
  try {
    assert.equal(await observedBeforeRelease(f.workspace.workflowFinished.promise), true)
  } finally { f.releaseCharacters.resolve(); await rejected }
})

test('failed planning never starts workflow or publishes a projection', async t => {
  const f = await fixture(t, { planningFailure: true })
  try {
    await assert.rejects(f.workspace.chapterProjection(1), /planning read failed/)
    assert.equal(await observedBeforeRelease(f.charactersRead.promise), true)
    assert.equal(f.workspace.workflowCalls, 0)
  } finally { f.releaseCharacters.resolve() }
})

test('early character failure prevents delayed workflow from starting after rejection', async t => {
  const f = await fixture(t, { characterFailure: true, holdPlanning: true })
  const pending = f.workspace.chapterProjection(1)
  const rejected = assert.rejects(pending, /character read failed/)
  try {
    assert.equal(await observedBeforeRelease(f.planningRead.promise), true)
    f.releaseCharacters.resolve()
    await rejected
    f.releasePlanning.resolve()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(f.workspace.workflowCalls, 0)
  } finally { f.releaseCharacters.resolve(); f.releasePlanning.resolve(); await rejected }
})

test('switching books while character state is pending still rejects the completed workflow', async t => {
  const f = await fixture(t)
  const { project: other } = await f.projects.create({ parentPath: f.root, name: '另一部作品' })
  await f.projects.switch(f.project.path)
  const pending = f.workspace.chapterProjection(1)
  const rejected = assert.rejects(pending, { code: 'CONFLICT' })
  try {
    assert.equal(await observedBeforeRelease(f.workspace.workflowFinished.promise), true)
    await f.projects.switch(other.path)
  } finally { f.releaseCharacters.resolve(); await rejected }
})
