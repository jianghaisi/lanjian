import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { emptyWorldbookEntry } from '../../src/contracts/characters/worldbook'
import type { AiClient } from '../../src/main/modules/models/application/ai-client'
import { ProjectService } from '../../src/main/modules/library/application/project-service'
import { SettingsStore } from '../../src/main/platform/settings/settings-store'
import { DocumentService } from '../../src/main/modules/manuscript/application/document-service'
import { ShadowImportService } from '../../src/main/modules/library/application/shadow-import-service'
import { CurrentProjectLegacyWorkspaceSource } from '../../src/main/modules/library/application/legacy-workspace-source'
import { SqliteWorkspaceDatabaseFactory } from '../../src/main/platform/storage/workspace-database'
import { SqliteManuscriptService } from '../../src/main/modules/manuscript/application/sqlite-manuscript-service'
import { WorkspaceService } from '../../src/main/modules/library/application/workspace-service'
import { ResearchLibraryService } from '../../src/main/modules/library/application/research-library-service'
import { OutlinePlanningService } from '../../src/main/modules/planning/application/outline-planning-service'
import { LocalRetrievalService } from '../../src/main/modules/assistant/application/local-retrieval-service'
import { ChapterDraftService } from '../../src/main/modules/manuscript/application/chapter-draft-service'
import { WritingAgentService } from '../../src/main/modules/assistant/application/writing-agent-service'
import { WritingAgentTaskService } from '../../src/main/modules/assistant/application/writing-agent-task-service'
import { WritingAgentApprovalService } from '../../src/main/modules/assistant/application/writing-agent-approval-service'

// These fixed paragraphs exercise orchestration and persistence, not model quality.
const walk = [
  '白衡把湿透的袖口卷起，沿着墙根慢慢往前走。青砖之间积着昨夜的雨水，每一次落脚都要避开松动的砖块。他没有催促身后的人，只在转弯时停下，等那串脚步重新靠近。',
  '路边的摊主正收拾竹筐，看见他们便把筐往里面挪了挪。白衡道了声谢，侧身让过挑担的老人，又低头检查刚才记下的路向。纸角已经发软，他用手掌护住纸面。',
  '风从窄巷另一头吹来，带着炊烟的气味。同行的人问还要走多久，白衡指了指前面的屋檐，说先到那里躲一会儿雨。两人走到檐下，把鞋底的泥在台阶边蹭掉。',
  '门内有人搬动桌椅，木脚擦过地面，发出短促的响声。白衡没有探头去看，只把纸折好收进口袋，等雨势稍微小些再走。街上的水顺着沟渠往下流，带走几片碎叶。',
  '他们再次出发时，远处的钟刚好响了一声。白衡数着经过的门口，确认没有错过来时标记的转角，又回头示意同伴跟上。最后一段路比先前宽些，他放慢步子，望向约定的地方。'
].join('\n\n')
const steps = [
  { id: 10, from: '城门', to: '石桥', summary: '承接标记甲：白衡抵达石桥，停在桥头。' },
  { id: 20, from: '石桥', to: '酒馆', summary: '承接标记乙：白衡抵达酒馆，停在门外。' },
  { id: 30, from: '酒馆', to: '书院', summary: '承接标记丙：白衡抵达书院，停在门外。' }
]
const secret = '隐秘印记：白衡掌心有青色印痕'

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-worldbook-continuation-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const codec = { available: () => true, encrypt: (value: string) => value, decrypt: (value: string) => value }
  const projects = new ProjectService(new SettingsStore(join(root, 'profile'), codec))
  const { project } = await projects.create({ parentPath: root, name: '三章离线验证书', genre: '悬疑' })
  const files = new DocumentService(projects)
  for (const step of steps) await files.updateChapter(step.id, { title: `走向${step.to}`, content: '' })
  const databases = new SqliteWorkspaceDatabaseFactory()
  const source = new CurrentProjectLegacyWorkspaceSource(projects, files)
  const importer = new ShadowImportService(source, databases)
  await importer.import(await importer.preview())
  const authority = new SqliteManuscriptService(databases)
  await authority.activate(project.path, await source.snapshot())
  const documents = new DocumentService(projects, undefined, authority)
  const library = new ResearchLibraryService(projects, authority)
  const planning = new OutlinePlanningService(projects, documents, library, authority)
  const retrieval = new LocalRetrievalService(projects, documents, undefined, authority)
  const workspace = new WorkspaceService(projects, planning, library, documents, undefined, retrieval, authority)
  await workspace.saveBookProfile({ ...await workspace.bookProfile(), targetWordsPerChapter: 300, chapterGenerationMode: 'reviewed' })
  await workspace.saveFoundation({ creationPath: 'materials', sourceNotes: '', worldView: '雨中的旧城。', useRealms: false, useSystem: false })
  const material = await library.createSource({ title: '离线测试行程', excerpt: '白衡从城门出发，经过石桥和酒馆，抵达书院。', userNotes: '' })
  const eventIds = new Map<number, string>()
  for (const [index, step] of steps.entries()) {
    const event = await library.createEventCandidate({ sourceId: material.id, time: `第${index + 1}日`, characters: ['白衡'], location: step.to, event: `白衡因为寻找线索，从${step.from}走到${step.to}，停下核对去向。` })
    await library.approveEvent(event.id)
    eventIds.set(step.id, event.id)
  }
  await planning.updateOutline('total', '白衡因为旧城出现异闻决定调查，于是从城门经过石桥和酒馆寻找线索，最终抵达书院，暂未查明异闻来源。')
  if ((await planning.status()).totalReview.status === 'attention') await planning.acknowledgeOutlineReview('total')
  await planning.confirmPlanningOutline('total')
  await planning.createVolume('旧城寻迹')
  for (const step of steps) {
    await planning.placeChapter(step.id, 1)
    await planning.placeEventInChapter(eventIds.get(step.id)!, step.id)
  }
  await planning.updateOutline(1, '白衡因为寻找异闻的线索，从城门出发，经过石桥和酒馆，最终抵达书院。')
  if ((await planning.status()).volumes.find(item => item.volume === 1)?.review.status === 'attention') await planning.acknowledgeOutlineReview(1)
  await planning.confirmPlanningOutline(1)
  for (const step of steps) {
    await planning.updateChapterOutline(step.id, `进入状态：白衡在${step.from}，尚未出发\n1. 白衡从${step.from}出发\n2. 白衡走到${step.to}\n退出状态：白衡抵达${step.to}，停下等待\n允许扩写：对白；动作；环境\n禁止：提前揭示异闻来源`, 1)
    await planning.confirmChapterOutline(step.id)
    assert.equal((await workspace.foundationStatus(step.id)).readyForProse, true)
    assert.deepEqual((await workspace.chapterEvents(step.id)).map(event => event.id), [eventIds.get(step.id)])
  }
  const entity = await authority.saveStoryEntity(project.path, { entityType: 'character', canonicalName: '白衡', status: 'approved', profileJson: JSON.stringify({ worldbook: {
    ...emptyWorldbookEntry(), description: '公开设定：白衡在旧城教书。', authorNotes: '作者私记：最后一章才解决异闻。',
    secrets: [{ id: 'mark', text: secret, revealChapterId: 30, knownBy: [] }]
  } }) })
  let activeStep = steps[0]
  let outcome: 'pass' | 'reject' | 'network' = 'pass'
  const calls: Array<{ chapterId: number; task: string; context: string }> = []
  const ai = {
    modelFor: async () => 'offline-fixture',
    complete: async (_instruction: string, _draft: string, context: string, task: string) => {
      calls.push({ chapterId: activeStep.id, task, context })
      if (outcome === 'network') throw new Error('SIMULATED_REVIEW_NETWORK_FAILURE')
      assert.equal(task, 'review')
      return { content: JSON.stringify({ summary: '离线审校样本', passed: outcome === 'pass',
        beats: [
          { id: 'B1', status: 'covered', evidence: `白衡从${activeStep.from}出发。` },
          { id: 'B2', status: 'covered', evidence: `白衡走到${activeStep.to}，停下等待。` },
          { id: 'B3', status: 'covered', evidence: '白衡停下核对去向。' }
        ],
        boundary: { entryRespected: true, exitReached: outcome === 'pass', evidence: `白衡走到${activeStep.to}，停下等待。` },
        violations: outcome === 'reject' ? ['离线拒绝样本：本章退出状态未完成'] : [], introducedFacts: [], characterConflicts: [],
        literaryFindings: [{ category: 'scene-function', severity: 'advice', candidateQuote: `白衡走到${activeStep.to}，停下等待。`,
          sourceQuote: '', reason: '候选到达后等待的反应可以更具体。', correction: '只补眼前的动作反应，不改变地点和章末结果。' }],
        characterChanges: [{ character: '白衡', field: 'location', value: activeStep.to, evidence: `白衡走到${activeStep.to}，停下等待。` }]
      }) }
    },
    streamComplete: async (_instruction: string, _draft: string, context: string, task: string, _signal: AbortSignal | undefined, _model: string, delta: (text: string, content: string) => Promise<void>) => {
      calls.push({ chapterId: activeStep.id, task, context })
      const content = `白衡从${activeStep.from}出发。\n\n${walk}\n\n白衡走到${activeStep.to}，停下等待。白衡停下核对去向。`
      await delta(content, content)
      return { content }
    }
  } as unknown as AiClient
  const runner = new WritingAgentService(ai, projects, documents, workspace, new ChapterDraftService(ai, documents, workspace))
  const tasks = new WritingAgentTaskService(runner, projects, databases)
  const approval = new WritingAgentApprovalService(projects, documents, tasks, databases, path => authority.retryMirrors(path))
  const generate = async (step: typeof steps[number], result: typeof outcome = 'pass') => {
    activeStep = step; outcome = result
    const current = await documents.chapter(step.id)
    const started = await tasks.start({ operationId: randomUUID(), request: { chapterId: step.id, currentDraft: current.content, message: '按照本章章纲完成正文', preferredSkill: 'continue' } })
    return settled(tasks, started.id)
  }
  const application = async (taskId: string, chapterId: number) => {
    const current = await documents.chapter(chapterId)
    return { taskId, title: current.title, expectedRevision: current.revision!, formatting: { firstLineIndent: false, paragraphSpacing: true } }
  }
  return { project, projects, documents, authority, databases, workspace, entity, runner, tasks, approval, generate, application, calls }
}

async function settled(tasks: WritingAgentTaskService, id: string) {
  for (let index = 0; index < 500; index++) {
    const task = await tasks.status(id)
    if (task.status === 'succeeded' || task.status === 'failed') return task
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail(`Task did not settle: ${id}`)
}

test('three chapters use real planning, frozen lore, approved continuity and explicit artifact adoption', async t => {
  const f = await fixture(t)
  const taskIds: string[] = []
  for (const [index, step] of steps.entries()) {
    const task = await f.generate(step)
    taskIds.push(task.id)
    assert.equal(task.status, 'succeeded', JSON.stringify(task.error))
    assert.equal(task.turn?.proposal?.report.passed, true, JSON.stringify(task.turn?.proposal?.report))
    assert.equal(task.turn?.proposal?.report.literaryFindings?.[0].severity, 'advice')
    assert.ok(task.turn?.proposal?.contract.beats.some(beat => beat.requirement.includes('停下核对去向')))
    const calls = f.calls.filter(call => call.chapterId === step.id)
    assert.deepEqual(calls.map(call => call.task), ['prose', 'review'])
    assert.equal(calls[0].context, calls[1].context)
    assert.match(calls[0].context, /公开设定：白衡在旧城教书/)
    assert.doesNotMatch(calls[0].context, /作者私记/)
    assert.equal(calls[0].context.includes(secret), index === 2)
    if (index > 0) {
      assert.ok(calls[0].context.includes(steps[index - 1].summary))
      const pack = await f.workspace.contextFactPack(step.id)
      assert.ok(pack.structured.approvedFacts?.some(fact => fact.predicate === 'location' && JSON.parse(fact.objectJson) === steps[index - 1].to && fact.sourceCurrent))
    }
    for (const future of steps.slice(index)) assert.ok(!calls[0].context.includes(future.summary))
    assert.equal((await f.documents.chapter(step.id)).content, '', 'generation must not adopt itself')
    const adopted = await f.approval.apply(await f.application(task.id, step.id))
    assert.equal(adopted.insertedVersion, true)
    assert.equal(adopted.task.artifact?.status, 'applied')
    await f.authority.updateChapterPlanning(f.project.path, { legacyChapterId: step.id, lifecycleStatus: 'REVIEWABLE' })
    await f.authority.updateChapterPlanning(f.project.path, { legacyChapterId: step.id, lifecycleStatus: 'CONFIRMED' })
    // Confirmation appends a formal version; evidence must bind to that version.
    const confirmed = await f.documents.chapter(step.id)
    assert.notEqual(confirmed.bodyVersionId, adopted.chapter.bodyVersionId)
    const batch = await f.authority.recordCharacterFactCandidates(f.project.path, confirmed, task.turn!.proposal!.report.characterChanges, randomUUID())
    assert.ok(batch)
    await f.authority.decideFacts(f.project.path, { batchId: batch.id, decisions: batch.changes.map(change => ({ changeId: change.id, decision: 'APPROVED' as const })) })
    await f.authority.saveApprovedChapterSummary(f.project.path, { chapterId: step.id, bodyVersionId: confirmed.bodyVersionId!, content: step.summary })
  }
  const restored = new WritingAgentTaskService(f.runner, f.projects, f.databases)
  for (const [index, step] of steps.entries()) {
    assert.deepEqual((await restored.status(taskIds[index])).turn?.proposal?.report.literaryFindings,
      (await f.tasks.status(taskIds[index])).turn?.proposal?.report.literaryFindings)
    assert.match((await f.documents.chapter(step.id)).content, new RegExp(`白衡走到${step.to}`))
    assert.equal((await restored.status(taskIds[index])).artifact?.status, 'applied')
  }
  assert.equal(f.calls.length, 6, 'restoring or adopting does not regenerate prose')
})

test('review rejection, stale lore and interrupted review preserve both manuscript and recoverable candidates', async t => {
  const f = await fixture(t)
  const step = steps[0]
  const rejected = await f.generate(step, 'reject')
  assert.equal(rejected.status, 'succeeded', JSON.stringify(rejected.error))
  assert.equal(rejected.turn?.proposal?.report.passed, false)
  await assert.rejects(f.approval.apply(await f.application(rejected.id, step.id)), { code: 'VALIDATION_ERROR' })
  assert.equal((await f.documents.chapter(step.id)).content, '')
  assert.equal((await f.tasks.status(rejected.id)).artifact?.status, 'complete')

  const fresh = await f.generate(step)
  assert.equal(fresh.turn?.proposal?.report.passed, true)
  await f.authority.saveStoryEntity(f.project.path, { ...f.entity, profileJson: f.entity.profileJson.replace('在旧城教书', '在书院教书') })
  await assert.rejects(f.approval.apply(await f.application(fresh.id, step.id)), { code: 'CONFLICT' })
  assert.equal((await f.documents.chapter(step.id)).content, '')
  assert.equal((await f.tasks.status(fresh.id)).artifact?.status, 'complete')

  const interrupted = await f.generate(step, 'network')
  assert.equal(interrupted.status, 'failed')
  assert.ok(interrupted.partial?.content.includes('白衡走到石桥'))
  const restored = new WritingAgentTaskService(f.runner, f.projects, f.databases)
  assert.equal((await restored.status(interrupted.id)).partial?.content, interrupted.partial?.content)
  assert.equal((await f.documents.chapter(step.id)).content, '')

  const recovered = await f.generate(step)
  assert.equal(recovered.turn?.proposal?.report.passed, true)
  const adopted = await f.approval.apply(await f.application(recovered.id, step.id))
  assert.match(adopted.chapter.content, /白衡走到石桥/)
  const failedContinuation = await f.generate(step, 'network')
  assert.equal(failedContinuation.status, 'failed')
  const afterFailure = await f.documents.chapter(step.id)
  assert.equal(afterFailure.bodyVersionId, adopted.chapter.bodyVersionId)
  assert.equal(afterFailure.content, adopted.chapter.content)
  assert.equal((await restored.status(rejected.id)).artifact?.status, 'complete')
  assert.equal((await restored.status(interrupted.id)).partial?.content, interrupted.partial?.content)
})
