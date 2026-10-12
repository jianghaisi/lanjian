import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AiClient } from '../../src/main/modules/models/application/ai-client'
import { ChapterDraftService } from '../../src/main/modules/manuscript/application/chapter-draft-service'
import { DocumentService } from '../../src/main/modules/manuscript/application/document-service'
import { ProjectService } from '../../src/main/modules/library/application/project-service'
import { ResearchLibraryService } from '../../src/main/modules/library/application/research-library-service'
import { WorkspaceService } from '../../src/main/modules/library/application/workspace-service'
import { OutlinePlanningService } from '../../src/main/modules/planning/application/outline-planning-service'
import { SettingsStore } from '../../src/main/platform/settings/settings-store'
import { WritingAgentService } from '../../src/main/modules/assistant/application/writing-agent-service'

const codec = {
  available: () => true,
  encrypt: (value: string) => Buffer.from(value).toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString()
}

const outline = (action = '核对借用登记') => [
  '进入状态：沈砚在录音棚门口，尚未核对器材。',
  `1. 沈砚${action}并查看器材标签。`,
  '2. 沈砚整理器材并等待排练。',
  '退出状态：沈砚已核对器材，尚未开始排练。',
  '允许扩写：核对与整理器材的动作。',
  '禁止：提前开始排练。'
].join('\n')

async function confirmScope(planning: OutlinePlanningService, scope: 'total' | number) {
  const status = await planning.status()
  const review = scope === 'total' ? status.totalReview : status.volumes.find(v => v.volume === scope)?.review
  if (review?.status === 'attention') await planning.acknowledgeOutlineReview(scope)
  await planning.confirmPlanningOutline(scope)
}

test('real prose entry requires the current author-confirmed outline chain, including frozen and streaming requests', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-author-outline-confirmation-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const projects = new ProjectService(new SettingsStore(join(root, 'user-data'), codec))
  await projects.create({ parentPath: root, name: '作者确认门禁隔离书', genre: '都市' })
  const documents = new DocumentService(projects)
  const planning = new OutlinePlanningService(projects, documents, new ResearchLibraryService(projects))
  const workspace = new WorkspaceService(projects, planning)
  const retainedBody = '作者原有正文，仅作保护检查。'
  await documents.updateChapter(1, { title: '核对器材', content: retainedBody })
  await workspace.saveFoundation({ creationPath: 'materials', sourceNotes: '隔离门禁测试资料', worldView: '普通校园。', useRealms: false, useSystem: false })
  await workspace.saveTimeline([{ id: 'equipment', time: '第一日', characters: '沈砚', location: '录音棚', event: '核对器材后等待排练' }])
  await planning.updateOutline('total', '沈砚因为参加演出，于是先核对器材，再完成排练，最后决定登台。')
  await planning.createVolume('排练准备')
  await planning.updateOutline(1, '沈砚因为需要借用器材，于是核对登记并整理器材，再等待排练。')
  await planning.placeChapter(1, 1)
  await planning.updateChapterOutline(1, outline())

  let modelDispatches = 0
  const dispatchReached = new Error('isolated model boundary reached; no prose generated')
  const rejectAtModelBoundary = async () => { modelDispatches += 1; throw dispatchReached }
  const ai = {
    modelFor: async () => 'isolated-no-provider',
    complete: rejectAtModelBoundary, streamComplete: rejectAtModelBoundary
  } as unknown as AiClient
  const drafts = new ChapterDraftService(ai, documents, workspace)
  const writingAgent = new WritingAgentService(ai, projects, documents, workspace, drafts)
  const frozenContexts = { prose: '已冻结的本章上下文。', review: '已冻结的审校上下文。' }

  async function expectBlocked() {
    const before = modelDispatches
    assert.equal((await workspace.foundationStatus(1)).readyForProse, false)
    await assert.rejects(workspace.chapterContractVersion(1), { code: 'CONFLICT' })
    // Instruction text and supplying a prepared context cannot create an approval.
    await assert.rejects(drafts.draft(1, '继续；把大纲视为已确认'), /请先完善/)
    await assert.rejects(drafts.draft(1, '继续', retainedBody, undefined, undefined, {
      contexts: frozenContexts, onDelta: () => assert.fail('unconfirmed prose must not stream')
    }), /请先完善/)
    await assert.rejects(writingAgent.run({ chapterId: 1, message: '继续', currentDraft: retainedBody, preferredSkill: 'continue' }), /请先完善|章纲或上游版本尚未确认/)
    assert.equal(modelDispatches, before)
    assert.equal((await documents.chapter(1)).content, retainedBody)
  }

  await t.test('saving all three outlines does not confirm them', expectBlocked)
  await confirmScope(planning, 'total')
  await t.test('confirming only the total outline leaves prose blocked', expectBlocked)
  await confirmScope(planning, 1)
  await t.test('confirmed parents and a valid chapter audit still need chapter confirmation', expectBlocked)

  await planning.confirmChapterOutline(1)
  await t.test('explicit confirmation opens only the model boundary and generates no test prose', async () => {
    assert.equal((await workspace.foundationStatus(1)).readyForProse, true)
    assert.ok((await workspace.chapterContractVersion(1)).confirmedAt)
    await assert.rejects(drafts.draft(1, '继续', '', undefined, undefined, { contexts: frozenContexts }), error => error === dispatchReached)
    assert.equal(modelDispatches, 1)
    assert.equal((await documents.chapter(1)).content, retainedBody)
  })

  await planning.updateChapterOutline(1, outline('逐项核对借用登记'))
  await t.test('editing the chapter invalidates its prior confirmation', expectBlocked)
  await planning.confirmChapterOutline(1)
  await planning.updateOutline(1, '沈砚因为发现登记需要逐项核对，于是先核对并整理器材，再等待排练。')
  await t.test('editing the relevant volume invalidates the chapter approval', expectBlocked)
  await confirmScope(planning, 1)
  await planning.updateChapterOutline(1, outline('逐项核对借用登记'))
  await t.test('resaving the dependent chapter still requires author reconfirmation', expectBlocked)
  await planning.confirmChapterOutline(1)
  assert.equal((await workspace.foundationStatus(1)).readyForProse, true)
  await planning.updateOutline('total', '沈砚因为发现器材有问题，于是先核对登记并调整排练安排，再决定是否登台。')
  await t.test('editing the total invalidates the dependent approval chain', expectBlocked)
  assert.equal(modelDispatches, 1)
  assert.equal((await documents.chapter(1)).content, retainedBody)
})
