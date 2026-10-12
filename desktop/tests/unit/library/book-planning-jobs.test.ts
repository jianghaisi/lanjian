import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PlanningPackageProposal } from '../../../src/contracts/index'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../../src/main/platform/settings/settings-store'
import { PlanningJobService } from '../../../src/main/modules/planning/application/planning-job-service'
import { ChapterSkeletonJobService } from '../../../src/main/modules/planning/application/chapter-skeleton-job-service'
import { ChapterDetailJobService } from '../../../src/main/modules/planning/application/chapter-detail-job-service'
import { FactExtractionJobService } from '../../../src/main/modules/review/application/fact-extraction-job-service'
import { ConsistencyEvaluationJobService, ConsistencyEvaluationService } from '../../../src/main/modules/review/application/consistency-evaluation-service'

for (const kind of ['planning', 'skeleton', 'detail', 'facts', 'evaluation']) test(`${kind}: two jobs retain their original main book scope after switching tabs`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-bound-jobs-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const projects = new ProjectService(new SettingsStore(join(root, 'app'), { available: () => true, encrypt: value => value, decrypt: value => value }))
  const a = (await projects.create({ parentPath: root, name: '甲' })).project
  const b = (await projects.create({ parentPath: root, name: '乙' })).project
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  t.after(() => release())
  const observed: string[] = []
  const generate = async () => {
    const owner = await projects.currentPath()
    await gate
    assert.equal(await projects.currentPath(), owner)
    await writeFile(join(owner, 'scope-fixture.txt'), owner)
    observed.push(owner)
    return { id: owner, workItemId: owner, volumes: [] } as unknown as PlanningPackageProposal
  }
  const planning = new PlanningJobService({ generate })
  const skeleton = new ChapterSkeletonJobService({ generate }, () => projects.currentPath())
  const detail = new ChapterDetailJobService({ generate }, () => projects.currentPath())
  const facts = new FactExtractionJobService({ extract: async () => { await generate(); return null } })
  const evaluation = new ConsistencyEvaluationJobService(new ConsistencyEvaluationService({ prepareCompletion: async () => {
    await generate()
    return { model: 'fixture', connectionId: 'synthetic', complete: async instruction => {
      const samples = JSON.parse(instruction.split('\n样本：\n')[1]) as Array<{ id: string }>
      return { content: JSON.stringify({ results: samples.map(({ id }) => ({ id, codes: [] })) }) }
    } }
  } }, projects), projects)
  const start = async () => kind === 'planning' ? planning.start(await projects.currentPath()) : kind === 'skeleton' ? skeleton.start('proposal') : kind === 'detail' ? detail.start('proposal', 1) : kind === 'evaluation' ? evaluation.start() : facts.start(await projects.currentPath(), 1)
  const status = async (id: string) => kind === 'planning' ? planning.status(id) : kind === 'skeleton' ? skeleton.status(id) : kind === 'detail' ? detail.status(id) : kind === 'evaluation' ? evaluation.status(id) : facts.status(id)
  await projects.switch(a.path)
  const first = await projects.runBookTask(kind, start, status)
  await projects.switch(b.path)
  const second = await projects.runBookTask(kind, start, status)
  assert.equal(first.workItemId, a.path)
  assert.equal(second.workItemId, b.path)
  release()
  for (let i = 0; i < 200; i++) {
    if ((await status(first.id)).status !== 'running' && (await status(second.id)).status !== 'running') break
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.equal((await status(first.id)).status, 'completed')
  assert.equal((await status(second.id)).status, 'completed')
  assert.deepEqual(observed.sort(), [a.path, b.path].sort())
  for (const book of [a, b]) assert.equal(await readFile(join(book.path, 'scope-fixture.txt'), 'utf8'), book.path)
  if (kind === 'evaluation') for (const book of [a, b]) {
    const report = JSON.parse(await readFile(join(book.path, '.webnovel/evaluations/consistency-fixed-v2.json'), 'utf8'))
    assert.equal(report.workItemId, book.path)
  }
  assert.equal((await projects.backgroundTasks.list()).length, 2)
})
