import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { officialCreativePackages } from '@lanjian/writing-plugin-package/official'
import { policyRecords, validatePolicyRecords, type CreativeSlot } from '@lanjian/writing-plugin-contracts'
import { creativePolicyRun } from '../../../src/main/modules/writing-plugins/domain/creative-policy'
import { PlanningDraftService } from '../../../src/main/modules/planning/application/planning-draft-service'
import { completeStoryOutline } from '../../../src/main/modules/planning/application/story-outline-review'
import { decodePlanningPackageArgs } from '../../../src/contracts/planning/ipc'
import { WorkspaceService } from '../../../src/main/modules/library/application/workspace-service'
import type { BookProfile, FoundationData } from '../../../src/contracts'
import type { OutlinePlanningStatus, PlanningPackageProposal } from '../../../src/contracts'
import { ChapterSkeletonService } from '../../../src/main/modules/planning/application/chapter-skeleton-service'
import { ChapterDetailService } from '../../../src/main/modules/planning/application/chapter-detail-service'
import { ChapterStoryContractService } from '../../../src/main/modules/planning/application/chapter-story-contract-service'
import type { OutlinePlanningService } from '../../../src/main/modules/planning/application/outline-planning-service'
import { renderPlanningTotalOutline, renderPlanningVolumeOutline, renderPlanningVolumeStructure, renderPlanningVolumePlan } from '../../../src/main/modules/planning/application/planning-package-service'
import { contextBudgetStartingSuggestions } from '../../../src/contracts/assistant/types'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const profile = { genre: '都市', subgenre: '', coreIdea: '人物选择', plannedVolumes: 1, chaptersPerVolume: 2, targetWordsPerChapter: 3000, targetWords: 6000 } as BookProfile
const foundation = { creationPath: 'materials', sourceNotes: '人物选择带来城市变化。', worldView: '', useRealms: false, useSystem: false } as FoundationData
const blueprint = { premise: '选择', worldView: '城市规则', characters: [{ name: '周子昂', role: '主角', arcSeed: '承担代价' }], powerSystem: '', cheatSystem: '', rationale: '回应素材' }
const total = { title: '城中故事', summary: '选择后改变', content: '周子昂选择留下，城市关系发生变化。' }
const volumes = { volumes: [{ order: 1, title: '留下', goal: '选择', summary: '留下', ending: '关系改变', storyContent: '周子昂面对阻力选择留下，回应使城市关系发生变化。' }] }

function selection(slots: CreativeSlot[], disabled?: CreativeSlot) {
  const original = officialCreativePackages().find(p => p.manifest.id === 'lanjian.official.story-planning')!
  const manifest = structuredClone(original.manifest), files = new Map(original.files), digest = 'a'.repeat(64)
  manifest.id = 'personal.planning'
  manifest.contributions = manifest.contributions!.filter(c => c.kind === 'creative-policy' && slots.includes(c.slot))
  for (const c of manifest.contributions) if (c.kind === 'creative-policy') {
    if (c.slot === disabled) { c.mode = 'disabled'; delete c.asset }
    else files.set(c.asset!, `个人方法标记 ${c.slot}：从人物选择分析。`)
  }
  const composition = { revision: 7, entries: manifest.contributions.map(c => ({ pluginId: manifest.id, digest, contributionId: c.id, params: {} })) }
  return { packages: [{ manifest, files, digest }], files, composition }
}

test('multi-stage planning captures all methods once, preserves author input, replaces defaults and returns durable validated sources', async () => {
  const f = selection(['blueprint', 'total-outline', 'volume-outline', 'outline-review', 'genre-guidance']), calls: { instruction: string; context: string }[] = []
  let captures = 0, stage = 0
  const ai = { complete: async (instruction: string, _draft?: string, context?: string) => {
    calls.push({ instruction, context: context ?? '' })
    f.composition.revision = 99
    for (const path of f.files.keys()) if (path.endsWith('.md')) f.files.set(path, '后续修改的方法')
    if (instruction.startsWith('复核下方')) return { content: '{"issues":[]}' }
    return { content: JSON.stringify([blueprint, total, volumes][stage++]) }
  } }
  const service = new PlanningDraftService(ai, { bookProfile: async () => profile, foundation: async () => foundation,
    authorPrompt: async () => '作者明确要求标记', effectivePrompt: async () => '旧默认方法标记' }, undefined, undefined, async () => [], async () => { captures++; return creativePolicyRun(f.packages, f.composition) })
  const result = await service.generate('book-a')
  assert.equal(captures, 1); assert.equal(calls.length, 6)
  for (const [index, slot] of [[0, 'blueprint'], [2, 'total-outline'], [4, 'volume-outline']] as const) assert.match(calls[index].instruction, new RegExp('个人方法标记 ' + slot))
  for (const index of [1, 3, 5]) assert.match(calls[index].instruction, /个人方法标记 outline-review/)
  for (const call of calls) {
    assert.match(call.context, /作者明确要求标记/)
    assert.doesNotMatch(call.context + call.instruction, /旧默认方法标记|后续修改的方法|先规划故事，再组织文档/)
  }
  assert.ok(result.creativePolicy?.every(p => p.pluginId === 'personal.planning' && p.digest === 'a'.repeat(64) && p.compositionRevision === 7))
  assert.equal(result.creativePolicy?.length, 5)
  const persisted = decodePlanningPackageArgs([JSON.parse(JSON.stringify(result))])[0]
  assert.deepEqual(persisted.creativePolicy, result.creativePolicy)
  assert.match(result.basedOn.inputFingerprint, /^[a-f0-9]{64}$/)
  assert.throws(() => decodePlanningPackageArgs([{ ...result, creativePolicy: [{ ...result.creativePolicy![0], approved: true }] }]))
  assert.throws(() => decodePlanningPackageArgs([{ ...result, creativePolicy: [{ ...result.creativePolicy![0], digest: 'wrong' }] }]))
})

test('all next-layer kinds use their actual plugin method; a disabled later phase prevents the first model send', async () => {
  for (const [kind, key, slot, method] of [
    ['summary', 'total', 'volume-outline', undefined],
    ['volume', 'volume-1', 'chapter-outline', undefined],
    ['volume', 'volume-1', 'stage-outline', 'story-v1'],
    ['stage', 'stage-1', 'chapter-outline', undefined]
  ] as const) {
    const f = selection([slot, 'outline-review']), calls: string[] = []
    const source = { key, kind, revision: hash('parent'), projectFingerprint: hash('book'), title: '父级', content: '周子昂留下。' }
    const service = new PlanningDraftService({ complete: async instruction => { calls.push(instruction); return { content: instruction.startsWith('复核下方') ? '{"issues":[]}' : JSON.stringify({ children: [{ title: '下一段', content: '周子昂留下后面对城市变化。', events: [{ time: '翌日', characters: ['周子昂'], location: '城市', event: '承担代价，关系改变。' }] }] }) } } },
      { bookProfile: async () => profile, foundation: async () => foundation, planningOutline: async () => source }, undefined, undefined, async () => [], async () => creativePolicyRun(f.packages, f.composition))
    const result = await service.expandNextLayer({ parentKey: key, expectedRevision: source.revision, count: 1, instruction: '' }, undefined, undefined, method)
    assert.match(calls[0], new RegExp('个人方法标记 ' + slot)); assert.match(calls[1], /个人方法标记 outline-review/)
    assert.deepEqual(result.creativePolicy?.map(p => p.slot), [slot, 'genre-guidance', 'outline-review'])
  }
  const f = selection(['volume-outline'], 'volume-outline'); let sends = 0
  const service = new PlanningDraftService({ complete: async () => { sends++; throw Error('must not send') } }, { bookProfile: async () => profile, foundation: async () => foundation }, undefined, undefined, async () => [], async () => creativePolicyRun(f.packages, f.composition))
  await assert.rejects(service.generate('book-a'), { code: 'FEATURE_UNAVAILABLE' }); assert.equal(sends, 0)
})

test('selected review method cannot bypass quote evidence or one-correction bounds', async () => {
  const f = selection(['outline-review']), calls: string[] = []
  const candidate = { content: '推进关系' }, issue = { issues: [{ category: 'concrete-events', quote: '推进关系', parentQuote: '周子昂留下。', reason: '需要具体动作', needsAuthor: false }] }
  const responses = [candidate, issue, candidate, issue]
  await assert.rejects(completeStoryOutline({ ai: { complete: async instruction => { calls.push(instruction); return { content: JSON.stringify(responses.shift()) } } }, policy: creativePolicyRun(f.packages, f.composition), instruction: '个人生成方法', systemContext: '', task: 'outline', repairAttempts: 0, parent: '周子昂留下。', parse: JSON.parse }), /故事内容复核未通过/)
  assert.equal(calls.length, 4); assert.match(calls[2], /个人方法标记 outline-review/)
  assert.doesNotMatch(calls[2], /先规划故事，再组织文档/)
})

test('authorPrompt reads only explicitly saved overrides; record decoding never grants authority', async () => {
  const workspace = Object.create(WorkspaceService.prototype) as WorkspaceService
  workspace.promptProfile = async () => ({ entries: [{ task: 'outline', override: '', effective: '旧内置方法' }, { task: 'prose', override: '作者覆写', effective: '作者覆写' }] } as Awaited<ReturnType<WorkspaceService['promptProfile']>>)
  assert.equal(await workspace.authorPrompt('outline'), '')
  assert.equal(await workspace.authorPrompt('prose'), '作者覆写')
  const records = policyRecords(creativePolicyRun().resolve('blueprint'))
  assert.ok(!('text' in records[0]))
  for (const patch of [{ confirmed: true }, { mode: 'disabled' }, { slot: 'shell' }, { params: { secret: 'x'.repeat(9000) } }]) assert.throws(() => validatePolicyRecords([{ ...records[0], ...patch }]))
})

// In-memory status represents an existing author-confirmed fixture; no confirmation command is called.
async function readyFixture() {
  let stage = 0
  const proposal = await new PlanningDraftService({ complete: async instruction => ({ content: instruction.startsWith('复核下方') ? '{"issues":[]}' : JSON.stringify([blueprint, total, volumes][stage++]) }) }, { bookProfile: async () => profile, foundation: async () => foundation }).generate('isolated-fixture')
  proposal.adoption = { totalOutline: { fingerprint: hash(renderPlanningTotalOutline(proposal)), adoptedAt: proposal.createdAt, revision: 1 },
    volumeStructure: { fingerprint: hash(renderPlanningVolumeStructure(proposal)), initializedAt: proposal.createdAt, totalRevision: 1 },
    volumeOutlines: [{ order: 1, fingerprint: hash(renderPlanningVolumeOutline(proposal.volumes[0])), adoptedAt: proposal.createdAt, revision: 1, totalFingerprint: hash(renderPlanningTotalOutline(proposal)) }] }
  const status = { totalApproval: { status: 'confirmed' }, volumes: [{ volume: 1, title: proposal.volumes[0].title, approval: { status: 'confirmed' } }] } as OutlinePlanningStatus
  return { proposal, status }
}

test('skeleton and multi-batch detailed chapter candidates replace methods, freeze the selected review and keep strict durable sources', async () => {
  const { proposal, status } = await readyFixture(), f = selection(['chapter-skeleton', 'chapter-outline', 'outline-review'])
  const calls: { instruction: string; context: string }[] = []; let captures = 0
  const capture = async () => { captures++; return creativePolicyRun(f.packages, f.composition) }
  const ai = { complete: async (instruction: string, _draft?: string, context?: string) => {
    calls.push({ instruction, context: context ?? '' }); f.composition.revision++
    if (instruction.startsWith('复核下方')) return { content: '{"issues":[]}' }
    if (instruction.includes('轻量章节骨架')) return { content: JSON.stringify({ chapters: Array.from({ length: 6 }, (_, i) => ({ volumeChapter: i + 1, title: '变化' + i, coreEvent: '周子昂承担代价' + i, characters: ['周子昂'], location: '城市', result: '关系变化' + i })) }) }
    const ids = instruction.match(/本批章节编号：([\d,]+)/)![1].split(',').map(Number)
    return { content: JSON.stringify({ chapters: ids.map(chapter => ({ chapter, storyContent: '周子昂选择留下，面对城市变化。', entryState: '留下', beats: ['周子昂承担代价。', '周子昂面对城市变化。'], exitState: '关系变化', allowedFacts: ['城市'], forbiddenEvents: ['离开'], foreshadowActions: [] })) }) }
  } }
  const workspace = { bookProfile: async () => profile, authorPrompt: async () => '作者独立要求', effectivePrompt: async () => '旧默认方法标记' }
  const store = { get: async () => proposal, storeChapterSkeleton: async (_id: string, value: NonNullable<PlanningPackageProposal['chapterSkeleton']>) => { proposal.chapterSkeleton = value; return proposal }, storeChapterDetail: async (_id: string, value: NonNullable<PlanningPackageProposal['chapterDetails']>[number]) => { proposal.chapterDetails = [value]; return proposal } }
  await new ChapterSkeletonService(ai, store, { status: async () => status }, workspace, undefined, capture).generate(proposal.id)
  assert.equal(captures, 1); assert.equal(proposal.chapterSkeleton?.creativePolicy?.[0].compositionRevision, 7)
  assert.match(calls[0].context, /个人方法标记 chapter-skeleton/)
  await new ChapterDetailService(ai, store, { status: async () => status }, workspace, undefined, capture).generate(proposal.id, 1)
  assert.equal(captures, 2); assert.equal(calls.length, 6)
  for (const index of [2, 4]) assert.match(calls[index].context, /个人方法标记 chapter-outline/)
  for (const index of [1, 3, 5]) assert.match(calls[index].instruction, /个人方法标记 outline-review/)
  for (const call of calls) { assert.match(call.context, /作者独立要求/); assert.doesNotMatch(call.context + call.instruction, /旧默认方法标记|先规划故事，再组织文档/) }
  assert.deepEqual(decodePlanningPackageArgs([structuredClone(proposal)])[0].chapterDetails?.[0].creativePolicy, proposal.chapterDetails?.[0].creativePolicy)
  const off = selection(['outline-review'], 'outline-review'); let sends = 0
  await assert.rejects(new ChapterSkeletonService({ complete: async () => { sends++; throw Error('must not send') } }, store, { status: async () => status }, workspace, undefined, async () => creativePolicyRun(off.packages, off.composition)).generate(proposal.id), { code: 'FEATURE_UNAVAILABLE' })
  assert.equal(sends, 0)
  assert.equal(proposal.chapterSkeleton?.basedOn.volumePlanFingerprint, hash(renderPlanningVolumePlan(proposal)))
})

test('independent chapter generation and constraint preparation use frozen selected policy and author-only formal context', async () => {
  const f = selection(['chapter-outline', 'outline-review']), calls: { instruction: string; context: string }[] = [], options: unknown[] = []
  const constraints = { entryState: '留下', beats: ['周子昂留下。', '周子昂面对代价。'], exitState: '关系变化', allowedFacts: ['城市'], forbiddenEvents: ['离开'], foreshadowActions: [] }
  const service = new ChapterStoryContractService({ complete: async (instruction, _draft, context) => { calls.push({ instruction, context: context ?? '' }); return { content: instruction.startsWith('复核下方') ? '{"issues":[]}' : JSON.stringify(instruction.includes('忠实提取') ? constraints : { content: '周子昂选择留下，关系发生变化。' }) } } },
    { storyContractSnapshot: async () => ({ fingerprint: 'fixture', outlineHash: hash('story'), content: '周子昂留下。' }) } as unknown as OutlinePlanningService,
    { promptContext: async (_id, _task, value) => { options.push(value); return '作者明确要求与正式上级' }, contextBudgetPreferences: async () => ({ version: 1, ...contextBudgetStartingSuggestions, pinnedEvidenceKeys: [], excludedEvidenceKeys: [] }) }, async () => creativePolicyRun(f.packages, f.composition))
  await service.generate(1); const preview = await service.prepare(1)
  assert.deepEqual(options, [{ policyManaged: true }, { policyManaged: true }]); assert.deepEqual(preview.constraints, constraints)
  assert.match(calls[0].context, /个人方法标记 chapter-outline/); assert.match(calls[1].instruction, /个人方法标记 outline-review/)
  assert.doesNotMatch(calls[2].context, /个人方法标记 chapter-outline|先规划故事，再组织文档/)
  assert.match(calls[3].instruction, /个人方法标记 outline-review/)
})
