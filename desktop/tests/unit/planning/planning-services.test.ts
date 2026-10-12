import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { BookProfile, FoundationData, OutlinePlanningStatus, PlanningPackageProposal } from '../../../src/contracts/index'
import { decodePlanningChapterDetailAdoptionArgs, decodePlanningChapterDetailAdoptionPreviewArgs, decodePlanningCharacterSeedAdoptionArgs, decodePlanningCheatSystemAdoptionArgs, decodePlanningPackageArgs, decodePlanningPowerSystemAdoptionArgs, decodePlanningProposalIdArgs, decodePlanningTotalAdoptionArgs, decodePlanningVolumeOutlineAdoptionArgs, decodePlanningVolumeOutlinePreviewArgs, decodePlanningVolumeStructureArgs, decodePlanningWorldSeedAdoptionArgs } from '../../../src/contracts/ipc'
import { PlanningDraftService, parsePlanningBlueprint, parsePlanningTotalOutline, parsePlanningVolumes, parseOutlineExpansion } from '../../../src/main/modules/planning/application/planning-draft-service'
import { PlanningJobService } from '../../../src/main/modules/planning/application/planning-job-service'
import { PlanningPackageService, renderPlanningChapterSkeletonVolume, renderPlanningTotalOutline, renderPlanningVolumeOutline, renderPlanningVolumeStructure } from '../../../src/main/modules/planning/application/planning-package-service'
import { ChapterSkeletonService, parseChapterSkeletonVolume } from '../../../src/main/modules/planning/application/chapter-skeleton-service'
import { ChapterSkeletonJobService } from '../../../src/main/modules/planning/application/chapter-skeleton-job-service'
import { ChapterDetailService, parseChapterDetailBatch, renderPlanningChapterDetail } from '../../../src/main/modules/planning/application/chapter-detail-service'
import { CharacterStateService } from '../../../src/main/modules/characters/application/character-state-service'
import { WorkspaceService } from '../../../src/main/modules/library/application/workspace-service'

const profile: BookProfile = {
  genre: '都市',
  subgenre: '娱乐圈',
  coreIdea: '真正的 KING 穿越到三流歌手身上。',
  plannedVolumes: 2,
  chaptersPerVolume: 36,
  targetWordsPerChapter: 3200,
  targetWords: 2_000_000,
  audienceScale: '成年读者；不渲染暴力',
  defaultPov: '第三人称限知，跟随主角',
  narrativeDistance: '近距离',
  writingStyle: '克制、清晰，以动作和对白推进',
  proseExpansionMode: 'web-serial',
  reviewStrictness: 'balanced',
  autosaveEnabled: true,
  autosaveDelayMs: 1_500,
  autosaveMergeWindowMs: 30_000
}

const foundation: FoundationData = {
  creationPath: 'materials',
  sourceNotes: '素材：救场演出让过气歌手重新被观众看见。',
  worldView: '',
  useRealms: false,
  useSystem: false
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

test('expands exactly one hierarchy layer with generation and content review and preserves the parent snapshot', async () => {
  for (const [kind, key, expected] of [['summary', 'total', 'volume'], ['volume', 'volume-1', 'stage'], ['stage', 'stage-1', 'chapter']] as const) {
    let revision = hash('parent')
    let calls = 0
    const source = () => ({ projectFingerprint: hash('book'), key, kind, title: '父级标题', content: '父稿保留原有冲突。', revision })
    const service = new PlanningDraftService({ complete: async (instruction, draft, context) => { if (instruction.startsWith('复核下方')) return { content: '{"issues":[]}' };
      calls++
      assert.match(instruction, /父稿保留原有冲突/)
      assert.match(instruction, /不重写父级/)
      assert.match(context!, /正式设定：只在雨夜听见回声/)
      assert.equal(draft, '')
      revision = hash('edited')
      return { content: JSON.stringify({ children: [{ title: '下一段', content: '追查回声，遭遇误会，得到线索。', events: [{ time: '翌日', characters: ['沈砚'], location: '钟楼', event: '找到线索，决定前往旧街。' }] }] }) }
    } }, { bookProfile: async () => profile, foundation: async () => foundation,
      planningOutline: async () => source(), planningMaterials: async () => '正式设定：只在雨夜听见回声。' })
    const proposal = await service.expandNextLayer({ parentKey: key, expectedRevision: revision, count: 1, instruction: '保留吐槽' })
    assert.equal(calls, 1)
    assert.equal(proposal.childType, expected)
    assert.equal(proposal.source.revision, hash('parent'))
    assert.equal(proposal.sourceStale, true)
    assert.equal(proposal.children[0].events[0].characters[0], '沈砚')
  }
})

test('rejects invalid expansion counts, stale parents, cross-project results and cancelled calls', async () => {
  let project = hash('first')
  let calls = 0
  const controller = new AbortController()
  const service = new PlanningDraftService({ complete: async (instruction) => {
    if (instruction.startsWith('复核下方')) return { content: '{"issues":[]}' };
    calls++
    project = hash('second')
    return { content: JSON.stringify({ children: [{ title: '卷', content: '内容', events: [{ time: '后来', characters: ['甲'], location: '城内', event: '发现线索。' }] }] }) }
  } }, { bookProfile: async () => profile, foundation: async () => foundation,
    planningOutline: async () => ({ projectFingerprint: project, key: 'total', kind: 'summary', title: '总纲', content: '已保存', revision: hash('parent') }) })
  const input = { parentKey: 'total', expectedRevision: hash('parent'), count: 1, instruction: '' }
  await assert.rejects(service.expandNextLayer({ ...input, count: 0 }))
  await assert.rejects(service.expandNextLayer({ ...input, expectedRevision: hash('old') }))
  await assert.rejects(service.expandNextLayer({ ...input, parentKey: 'chapter-1' }))
  controller.abort()
  await assert.rejects(service.expandNextLayer(input, controller.signal))
  assert.equal(calls, 0)
  await assert.rejects(service.expandNextLayer(input), /作品已经切换/)
  assert.equal(calls, 1)
  for (const bad of ['{}', '{"children":[]}', '{"children":[{"title":"x","content":"x","events":[]}]}']) {
    assert.throws(() => parseOutlineExpansion(bad, 1))
  }
})

test('does not return a late outline expansion after cancellation', async () => {
  const controller = new AbortController()
  const service = new PlanningDraftService({ complete: async () => {
    controller.abort()
    return { content: '{"children":[]}' }
  } }, { bookProfile: async () => profile, foundation: async () => foundation,
    planningOutline: async () => ({ projectFingerprint: hash('book'), key: 'total', kind: 'summary', title: '总纲', content: '已保存', revision: hash('parent') }) })
  await assert.rejects(service.expandNextLayer({ parentKey: 'total', expectedRevision: hash('parent'), count: 1, instruction: '' }, controller.signal), /已停止拆解/)
})

const blueprintJson = JSON.stringify({
  premise: '真实能力如何穿过流量噪音被看见',
  worldView: '当代娱乐工业，平台热度与真实口碑存在时间差。',
  characters: [{ name: '沈砚', role: '被低估的歌手', arcSeed: '从证明技巧转向建立自己的表达' }],
  powerSystem: '舞台表现、作品传播与行业话语权三条成长线',
  cheatSystem: '保留前世的完整音乐记忆，但每次改编都受当前嗓音限制',
  rationale: '让金手指提供起点，不替代人物选择。'
})

const totalOutlineJson = JSON.stringify({
  title: '从救场到新秩序',
  summary: '主角从一次救场翻身，最终建立尊重作品的行业秩序。',
  content: '第一阶段因救场进入公众视野；第二阶段与旧有利益结构冲突；最终以原创作品完成选择。'
})

const volumesJson = JSON.stringify({ volumes: [
  { order: 1, title: '无名之声', goal: '重新获得演出资格', summary: '救场、舆论发酵、签约博弈。', ending: '主角拒绝复制旧路线，决定做原创专辑。', storyContent: '主角替缺席歌手救场，观众的录音让他获得演出邀约。签约方要求复制走红曲目，他拒绝这份安排，决定制作自己的原创专辑。' },
  { order: 2, title: '自己的歌', goal: '完成原创专辑', summary: '创作、发行与行业规则正面冲突。', ending: '作品被听见，但主角选择建立新的合作方式。', storyContent: '主角辞去旧合约，邀请同样受限制的乐手录制专辑。平台拒绝推荐，他们用现场演出寻找听众；专辑收益使团队能够共同制作下一张作品。' }
] })

test('parses strict planning candidates and rejects incomplete output', () => {
  assert.equal(parsePlanningBlueprint(`\`\`\`json\n${blueprintJson}\n\`\`\``).characters[0].name, '沈砚')
  assert.equal(parsePlanningTotalOutline(totalOutlineJson).title, '从救场到新秩序')
  assert.equal(parsePlanningVolumes(volumesJson, 2)[1].order, 2)
  assert.throws(() => parsePlanningBlueprint('{"premise":"只有命题"}'), /缺少核心命题/)
  assert.throws(() => parsePlanningVolumes(volumesJson, 3), /应有 3 卷/)
  assert.throws(() => parsePlanningTotalOutline('not-json'), /不是有效 JSON/)
})

test('uses the per-book repair count for malformed planning JSON', async () => {
  const prompts: string[] = []
  const responses = ['not-json', blueprintJson, totalOutlineJson, volumesJson]
  const service = new PlanningDraftService({
    complete: async (instruction) => { if (instruction.startsWith('复核下方')) return { content: '{"issues":[]}' };
      prompts.push(instruction)
      return { content: responses[prompts.length - 1]! }
    }
  }, {
    bookProfile: async () => profile,
    foundation: async () => foundation,
    contextBudgetPreferences: async () => ({
      version: 1, inputBudgetTokens: 120_000, modelContextLimit: 150_000, outputReservePercent: 25,
      systemReserveTokens: 10_000, recentSummaryCount: 3, structuredRepairAttempts: 1,
      minimumFactImportance: 'medium', showFactConfirmations: false, pinnedEvidenceKeys: [], excludedEvidenceKeys: []
    })
  })
  const proposal = await service.generate('book-a')
  assert.equal(proposal.volumes.length, 2)
  assert.equal(prompts.length, 4)
  assert.match(prompts[1]!, /修复下面这份结构化结果/)
  assert.match(prompts[1]!, /not-json/)
})

test('generates a complete full-book chapter skeleton only after every volume is confirmed', async () => {
  const candidate = adoptedProposalFixture('book-a')
  const calls: string[] = []
  let storedChapterCount = 0
  const responses = [1, 2].map((volume) => JSON.stringify({ chapters: [1, 2].map((volumeChapter) => ({
    volumeChapter,
    title: `第${volume}卷第${volumeChapter}章`,
    coreEvent: `第${volume}卷事件${volumeChapter}`,
    characters: ['沈砚'],
    location: volumeChapter === 1 ? '后台' : '舞台',
    result: `形成第${volume}卷结果${volumeChapter}`
  })) }))
  const status = confirmedPlanningStatus(candidate)
  const service = new ChapterSkeletonService({
    complete: async (instruction, _draft, _context, task) => { if (instruction.startsWith('复核下方')) return { content: '{"issues":[]}' };
      assert.equal(task, 'chapterOutline')
      calls.push(instruction)
      return { content: responses[calls.length - 1]! }
    }
  }, {
    get: async () => structuredClone(candidate),
    storeChapterSkeleton: async (_proposalId, skeleton) => {
      storedChapterCount = skeleton.chapters.length
      return { ...structuredClone(candidate), chapterSkeleton: structuredClone(skeleton) }
    }
  }, { status: async () => structuredClone(status) }, {
    bookProfile: async () => ({ ...profile, chaptersPerVolume: 2 }),
    effectivePrompt: async () => '每章只推进一个可验证事件。'
  }, () => new Date('2026-08-27T10:00:00.000Z'))

  const progress: Array<[number, number]> = []
  const result = await service.generate(candidate.id, undefined, (completed, total) => progress.push([completed, total]))
  assert.equal(calls.length, 2)
  assert.match(calls[0]!, /全书章序从 1 开始/)
  assert.match(calls[1]!, /全书章序从 3 开始/)
  assert.deepEqual(result.chapterSkeleton?.chapters.map((item) => [item.chapter, item.volume, item.volumeChapter]), [[1, 1, 1], [2, 1, 2], [3, 2, 1], [4, 2, 2]])
  assert.equal(result.chapterSkeleton?.targetWordsPerChapter, 3200)
  assert.equal(storedChapterCount, 4)
  assert.deepEqual(progress, [[0, 2], [1, 2], [1, 2], [2, 2]])

  const blockedStatus = structuredClone(status)
  blockedStatus.volumes[1]!.approval.status = 'ready'
  let blockedCalls = 0
  const blocked = new ChapterSkeletonService({ complete: async () => { blockedCalls += 1; return { content: responses[0]! } } }, {
    get: async () => structuredClone(candidate), storeChapterSkeleton: async () => { throw new Error('must not store') }
  }, { status: async () => blockedStatus }, { bookProfile: async () => ({ ...profile, chaptersPerVolume: 2 }) })
  await assert.rejects(blocked.generate(candidate.id), (error: { code?: string; message?: string }) => error.code === 'CONFLICT' && /第 2 卷/.test(error.message || ''))
  assert.equal(blockedCalls, 0)
})

test('rejects incomplete skeleton JSON and cancellation never exposes a partial proposal', async () => {
  assert.equal(parseChapterSkeletonVolume(JSON.stringify({ chapters: [{ volumeChapter: 1, title: '开场', coreEvent: '救场', characters: ['沈砚'], location: '后台', result: '获得上台机会' }] }), 1, 1, 1)[0]?.chapter, 1)
  assert.throws(() => parseChapterSkeletonVolume('{"chapters":[]}', 1, 1, 1), /应有 1 章/)
  assert.throws(() => parseChapterSkeletonVolume('{"chapters":[{"volumeChapter":1,"title":"只有标题"}]}', 1, 1, 1), /缺少连续卷内章序/)

  let receivedSignal: AbortSignal | undefined
  const jobs = new ChapterSkeletonJobService({
    generate: async (_proposalId, signal) => {
      receivedSignal = signal
      return await new Promise<PlanningPackageProposal>(() => undefined)
    }
  }, async () => 'book-a', () => new Date('2026-08-27T10:00:00.000Z'), () => '11111111-2222-4333-8444-555555555555')
  const started = await jobs.start('proposal')
  await new Promise((resolve) => setImmediate(resolve))
  const cancelled = jobs.cancel(started.id)
  assert.equal(receivedSignal?.aborted, true)
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.proposal, undefined)
})

test('generates one volume of detailed chapter outlines atomically and keeps future events forbidden', async () => {
  const proposal = adoptedProposalFixture('book-a')
  proposal.chapterSkeleton = {
    generatedAt: '2026-08-27T10:00:00.000Z', targetWordsPerChapter: 3200,
    basedOn: { totalOutlineFingerprint: hash(renderPlanningTotalOutline(proposal)), volumePlanFingerprint: hash(JSON.stringify(proposal.volumes.map(({ order, title, goal, summary, ending }) => ({ order, title, goal, summary, ending })))) },
    chapters: [1, 2].map((chapter) => ({ chapter, volume: 1, volumeChapter: chapter, title: `第${chapter}章`, coreEvent: `事件${chapter}`, characters: ['沈砚'], location: '舞台', result: `结果${chapter}` }))
  }
  const response = JSON.stringify({ chapters: proposal.chapterSkeleton.chapters.map((chapter) => ({
    storyContent: `人物承接前章结果来到舞台，完成动作${chapter.chapter}-1，其他人的回应使他继续动作${chapter.chapter}-2，场面改变后留下退出${chapter.chapter}的结果。`, chapter: chapter.chapter, entryState: `进入${chapter.chapter}`, beats: [`动作${chapter.chapter}-1`, `动作${chapter.chapter}-2`], exitState: `退出${chapter.chapter}`,
    allowedFacts: ['可扩写舞台细节'], forbiddenEvents: [`不得提前发生事件${chapter.chapter + 1}`], foreshadowActions: []
  })) })
  let stored = 0
  const service = new ChapterDetailService({ complete: async (instruction) => { if (instruction.startsWith('复核下方')) return { content: '{"issues":[]}' }; assert.match(instruction, /本批章节编号：1,2/); return { content: response } } }, {
    get: async () => structuredClone(proposal),
    storeChapterDetail: async (_proposalId, detail) => { stored += 1; return { ...structuredClone(proposal), chapterDetails: [detail] } }
  }, { status: async () => confirmedPlanningStatus(proposal) }, { effectivePrompt: async () => '每个节拍都服从骨架。' }, () => new Date('2026-08-27T11:00:00.000Z'))
  const result = await service.generate(proposal.id, 1)
  assert.equal(stored, 1)
  assert.equal(result.chapterDetails?.[0]?.chapters.length, 2)
  assert.match(renderPlanningChapterDetail(result.chapterDetails![0]!.chapters[0]!), /完成动作1-1/)
  assert.doesNotMatch(renderPlanningChapterDetail(result.chapterDetails![0]!.chapters[0]!), /伏笔：无/)
  assert.throws(() => parseChapterDetailBatch('{"chapters":[]}', proposal.chapterSkeleton!.chapters), /应返回 2 章/)
})

test('previews and adopts exactly one detailed chapter outline with stale-preview protection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'planning-chapter-adoption-'))
  const proposal = adoptedProposalFixture('book-a')
  proposal.chapterSkeleton = {
    generatedAt: '2026-08-27T10:00:00.000Z', targetWordsPerChapter: 3200,
    basedOn: { totalOutlineFingerprint: hash(renderPlanningTotalOutline(proposal)), volumePlanFingerprint: hash(JSON.stringify(proposal.volumes.map(({ order, title, goal, summary, ending }) => ({ order, title, goal, summary, ending })))) },
    chapters: [
      { chapter: 1, volume: 1, volumeChapter: 1, title: '雨夜救场', coreEvent: '沈砚临时登台', characters: ['沈砚'], location: '后台', result: '观众第一次记住沈砚' },
      { chapter: 2, volume: 2, volumeChapter: 1, title: '原创起笔', coreEvent: '沈砚写下第一首原创', characters: ['沈砚'], location: '录音室', result: '原创专辑正式启动' }
    ]
  }
  proposal.chapterDetails = [{
    volume: 1, generatedAt: '2026-08-27T11:00:00.000Z',
    basedOn: { totalOutlineFingerprint: hash(renderPlanningTotalOutline(proposal)), volumeOutlineFingerprint: hash(renderPlanningVolumeOutline(proposal.volumes[0]!)), skeletonFingerprint: hash(renderPlanningChapterSkeletonVolume(proposal, 1)) },
    chapters: [{ chapter: 1, volume: 1, volumeChapter: 1, title: '雨夜救场', entryState: '沈砚仍在后台候场', beats: ['主唱失声', '沈砚登台完成救场'], exitState: '观众开始追问沈砚是谁', allowedFacts: ['后台细节'], forbiddenEvents: ['不得提前签约'], foreshadowActions: [] }]
  }]
  const path = join(root, '.webnovel', 'planning', 'automatic-planning-draft.json')
  await mkdir(join(root, '.webnovel', 'planning'), { recursive: true })
  const [validatedProposal] = decodePlanningPackageArgs([proposal])
  await writeFile(path, JSON.stringify({ version: 1, proposal: validatedProposal, updatedAt: '2026-08-27T11:00:00.000Z' }), 'utf8')
  let formal = '作者旧章纲'
  const writes: Array<{ chapterId: number; content: string; volume?: number }> = []
  const baseStatus = confirmedPlanningStatus(proposal)
  const planning = {
    status: async (chapterId?: number) => ({ ...structuredClone(baseStatus), ...(chapterId ? { chapter: { chapterId, hasContent: Boolean(formal), volume: 1, stale: false, reason: 'current' as const, review: { status: 'confirmed' as const, canConfirm: true, issues: [], metrics: { beatCount: 1, forbiddenCount: 1, formalEventCount: 1, boundaryCount: 2, foreshadowCount: 0 } } } } : {}) }),
    updateOutline: async (volume: 'total' | number, content: string) => ({ success: true as const, volume, content }),
    initializeVolumeStructure: async () => baseStatus,
    updateChapterOutline: async (chapterId: number, content: string, volume?: number) => { writes.push({ chapterId, content, volume }); formal = content; return { chapterId, content } }
  }
  const documents = {
    outline: async () => ({ content: '' }), chapterOutlines: async () => [{ chapterId: 1, content: formal }],
    chapterOutline: async (chapterId: number) => ({ chapterId, content: formal })
  }
  try {
    const service = new PlanningPackageService({ currentPath: async () => root, currentSummary: async () => ({ id: 'book-a', name: '测试作品', path: root, title: '测试作品', genre: '都市', updated_at: '2026-08-27T11:00:00.000Z', manuscript: { chapterCount: 0, fileCount: 0, wordCount: 0, status: 'ready' } }) }, planning, documents, () => new Date('2026-08-27T12:00:00.000Z'))
    const preview = await service.previewChapterDetailAdoption('proposal', 1)
    assert.equal(writes.length, 0)
    assert.equal(preview.current.confirmed, true)
    assert.equal(preview.candidate.beatCount, 2)
    formal = '作者预览后改写的章纲'
    await assert.rejects(service.adoptChapterDetail({ proposalId: 'proposal', chapterId: 1, upstreamFingerprint: preview.upstreamFingerprint, candidateFingerprint: preview.candidateFingerprint, currentFingerprint: preview.currentFingerprint }), (error: { code?: string }) => error.code === 'CONFLICT')
    assert.equal(writes.length, 0)
    const refreshed = await service.previewChapterDetailAdoption('proposal', 1)
    const adopted = await service.adoptChapterDetail({ proposalId: 'proposal', chapterId: 1, upstreamFingerprint: refreshed.upstreamFingerprint, candidateFingerprint: refreshed.candidateFingerprint, currentFingerprint: refreshed.currentFingerprint })
    assert.equal(writes.length, 1)
    assert.deepEqual([writes[0]!.chapterId, writes[0]!.volume], [1, 1])
    assert.match(writes[0]!.content, /禁止：不得提前签约/)
    assert.equal(adopted.proposal.adoption?.chapterOutlines?.[0]?.candidateFingerprint, refreshed.candidateFingerprint)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('generates blueprint, total outline and volume plan in stages without persistence methods', async () => {
  const prompts: string[] = []
  const stages: Array<[string, number]> = []
  const responses = [blueprintJson, totalOutlineJson, volumesJson]
  const service = new PlanningDraftService({
    complete: async (instruction, _draft, systemContext, task, signal) => { if (instruction.startsWith('复核下方')) return { content: '{"issues":[]}' };
      assert.equal(task, 'outline')
      assert.equal(signal?.aborted, false)
      assert.match(systemContext || '', /社会关系、职业细节和利益交换要可信/)
      prompts.push(instruction)
      return { content: responses[prompts.length - 1] }
    }
  }, {
    bookProfile: async () => profile,
    foundation: async () => foundation
  }, () => new Date('2026-08-27T08:00:00.000Z'), () => 'proposal-1')

  const proposal = await service.generate('book-a', new AbortController().signal, (stage, completed) => stages.push([stage, completed]))
  assert.equal(proposal.workItemId, 'book-a')
  assert.equal(proposal.id, 'proposal-1')
  assert.equal(proposal.volumes.length, 2)
  assert.equal(proposal.basedOn.inputFingerprint.length, 64)
  assert.deepEqual(stages, [['blueprint', 0], ['totalOutline', 1], ['volumePlan', 2], ['volumePlan', 3]])
  assert.match(prompts[0], /AUTHOR_MATERIAL_UNTRUSTED/)
  assert.match(prompts[0], /救场演出/)
  assert.match(prompts[1], /创作蓝图/)
  assert.match(prompts[2], /恰好 2 卷/)
})

test('sends the current book prompt override with non-editable consistency gates', async () => {
  const responses = [blueprintJson, totalOutlineJson, volumesJson]
  let call = 0
  const service = new PlanningDraftService({
    complete: async (_instruction, _draft, systemContext) => { if (_instruction.startsWith('复核下方')) return { content: '{"issues":[]}' };
      assert.match(systemContext || '', /本书谋篇策略：以舞台选择推动人物变化，不用偶然事件替代因果/)
      assert.match(systemContext || '', /ChapterContract/)
      assert.match(systemContext || '', /候选在作者采用前都不是正式事实/)
      assert.match(systemContext || '', /全书目标：2000000 字/)
      assert.match(systemContext || '', /成年读者；不渲染暴力/)
      assert.match(systemContext || '', /第三人称限知，跟随主角/)
      assert.match(systemContext || '', /默认叙述距离：近距离/)
      assert.match(systemContext || '', /文风提示：克制、清晰，以动作和对白推进/)
      return { content: responses[call++] }
    }
  }, {
    bookProfile: async () => profile,
    foundation: async () => foundation,
    effectivePrompt: async (task) => {
      assert.equal(task, 'outline')
      return '本书谋篇策略：以舞台选择推动人物变化，不用偶然事件替代因果。'
    }
  })
  await service.generate('book-a')
  assert.equal(call, 3)
})

test('requires saved per-book materials before planning', async () => {
  const service = new PlanningDraftService({ complete: async () => ({ content: '' }) }, {
    bookProfile: async () => profile,
    foundation: async () => ({ ...foundation, sourceNotes: '  ' })
  })
  await assert.rejects(service.generate('book-a'), (error: { code?: string; message?: string }) => error.code === 'VALIDATION_ERROR' && /至少一段资料/.test(error.message || ''))
})

test('uses the unified material library when the author note is empty', async () => {
  const prompts: string[] = []
  const responses = [blueprintJson, totalOutlineJson, volumesJson]
  const service = new PlanningDraftService({ complete: async (instruction) => { if (instruction.startsWith('复核下方')) return { content: '{"issues":[]}' };
    prompts.push(instruction)
    return { content: responses[prompts.length - 1] }
  } }, {
    bookProfile: async () => profile,
    foundation: async () => ({ ...foundation, sourceNotes: '  ' }),
    planningMaterials: async () => '[联网采风] 舞台救场资料\n摘录：公开资料中的临时排练细节\n来源：https://example.com/stage'
  })

  const proposal = await service.generate('book-a')
  assert.equal(proposal.volumes.length, 2)
  assert.match(prompts[0], /联网采风/)
  assert.match(prompts[0], /https:\/\/example.com\/stage/)
})

test('cancels planning without retaining a late proposal', async () => {
  let finish: ((proposal: PlanningPackageProposal) => void) | undefined
  let receivedSignal: AbortSignal | undefined
  const jobs = new PlanningJobService({
    generate: async (workItemId, signal, onProgress) => {
      receivedSignal = signal
      onProgress?.('blueprint', 0, '正在生成')
      return new Promise((resolve) => { finish = resolve })
    }
  }, () => new Date('2026-08-27T08:00:00.000Z'), () => '123e4567-e89b-42d3-a456-426614174000')

  const running = jobs.start('book-a')
  assert.equal(running.status, 'running')
  const cancelled = jobs.cancel(running.id)
  assert.equal(receivedSignal?.aborted, true)
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(cancelled.proposal, undefined)
  finish?.(proposalFixture('book-a'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(jobs.status(running.id).status, 'cancelled')
  assert.equal(jobs.status(running.id).proposal, undefined)
})

test('isolates concurrent planning jobs by work item and rejects a duplicate runner', async () => {
  const finishes = new Map<string, (proposal: PlanningPackageProposal) => void>()
  let id = 0
  const jobs = new PlanningJobService({
    generate: (workItemId) => new Promise((resolve) => finishes.set(workItemId, resolve))
  }, () => new Date('2026-08-27T08:00:00.000Z'), () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`)

  const first = jobs.start('book-a')
  const second = jobs.start('book-b')
  assert.throws(() => jobs.start('book-a'), /已有自动谋篇任务/)
  finishes.get('book-b')?.(proposalFixture('book-b'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(jobs.status(first.id).status, 'running')
  assert.equal(jobs.status(second.id).proposal?.workItemId, 'book-b')
  jobs.cancelAll()
})

test('reports the stage that failed without exposing provider errors', async () => {
  const jobs = new PlanningJobService({
    generate: async (_workItemId, _signal, onProgress) => {
      onProgress?.('volumePlan', 2, '正在拆分卷纲')
      throw new Error('secret provider payload')
    }
  }, () => new Date('2026-08-27T08:00:00.000Z'), () => '123e4567-e89b-42d3-a456-426614174000')
  const running = jobs.start('book-a')
  await new Promise((resolve) => setImmediate(resolve))
  const failed = jobs.status(running.id)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.error?.stage, 'volumePlan')
  assert.doesNotMatch(failed.error?.message || '', /secret provider/)
})

test('persists an editable planning candidate per book and restores it without rewriting on open', async () => {
  const root = await mkdtemp(join(tmpdir(), 'planning-package-'))
  const summary = { id: 'book-a', name: '测试作品', path: root, title: '测试作品', genre: '都市', updated_at: '2026-08-27T08:00:00.000Z', manuscript: { chapterCount: 0, fileCount: 0, wordCount: 0, status: 'ready' as const } }
  const projects = { currentPath: async () => root, currentSummary: async () => summary }
  const path = join(root, '.webnovel', 'planning', 'automatic-planning-draft.json')
  try {
    const first = new PlanningPackageService(projects, undefined, undefined, () => new Date('2026-08-27T09:00:00.000Z'))
    const edited = proposalFixture('book-a')
    edited.totalOutline.title = '我改过的总纲标题'
    assert.deepEqual(await first.save(edited), edited)
    const before = await stat(path)

    const restarted = new PlanningPackageService(projects, undefined, undefined, () => new Date('2026-08-27T10:00:00.000Z'))
    assert.deepEqual(await restarted.get(), edited)
    const after = await stat(path)
    assert.equal(after.mtimeMs, before.mtimeMs)
    assert.match(await readFile(path, 'utf8'), /我改过的总纲标题/)
    await assert.rejects(restarted.recoverDamagedDraft(), (error: { code?: string }) => error.code === 'CONFLICT')
    assert.deepEqual(await restarted.get(), edited)

    await restarted.discard()
    assert.equal(await restarted.get(), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('blocks cross-book and corrupted planning candidates without overwriting the stored bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'planning-package-'))
  const summary = { id: 'book-a', name: '测试作品', path: root, title: '测试作品', genre: '都市', updated_at: '2026-08-27T08:00:00.000Z', manuscript: { chapterCount: 0, fileCount: 0, wordCount: 0, status: 'ready' as const } }
  const projects = { currentPath: async () => root, currentSummary: async () => summary }
  const path = join(root, '.webnovel', 'planning', 'automatic-planning-draft.json')
  const service = new PlanningPackageService(projects)
  try {
    await assert.rejects(service.save(proposalFixture('book-b')), (error: { code?: string }) => error.code === 'CONFLICT')
    await service.save(proposalFixture('book-a'))
    await writeFile(path, '{ damaged candidate', 'utf8')
    const before = await readFile(path, 'utf8')
    await assert.rejects(service.get(), (error: { code?: string }) => error.code === 'INVALID_PROJECT_STATE')
    assert.equal(await readFile(path, 'utf8'), before)
    const recovered = await service.recoverDamagedDraft()
    assert.equal(await readFile(path, 'utf8').catch(() => null), null)
    assert.equal(await readFile(join(root, recovered.recoveryRelativePath), 'utf8'), before)
    assert.match(recovered.recoveryRelativePath, /^\.webnovel\/planning\/recovery\/[^/]+-automatic-planning-draft\.json$/)
    assert.equal(await service.get(), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('does not move a damaged planning candidate after the active book changes', async () => {
  const rootA = await mkdtemp(join(tmpdir(), 'planning-recovery-a-'))
  const rootB = await mkdtemp(join(tmpdir(), 'planning-recovery-b-'))
  const path = join(rootA, '.webnovel', 'planning', 'automatic-planning-draft.json')
  await mkdir(join(rootA, '.webnovel', 'planning'), { recursive: true })
  await writeFile(path, '{ damaged candidate during switch', 'utf8')
  let pathRead = 0
  const projects = {
    currentPath: async () => (++pathRead <= 2 ? rootA : rootB),
    currentSummary: async () => ({ id: 'book-a', name: '甲书', path: rootA, title: '甲书', genre: '都市', updated_at: '', manuscript: { chapterCount: 0, fileCount: 0, wordCount: 0, status: 'ready' as const } })
  }
  try {
    await assert.rejects(new PlanningPackageService(projects).recoverDamagedDraft(), (error: { code?: string }) => error.code === 'CONFLICT')
    assert.equal(await readFile(path, 'utf8'), '{ damaged candidate during switch')
    assert.equal(await readFile(join(rootA, '.webnovel', 'planning', 'recovery'), 'utf8').catch(() => null), null)
  } finally {
    await rm(rootA, { recursive: true, force: true })
    await rm(rootB, { recursive: true, force: true })
  }
})

test('validates the complete planning candidate at the shared IPC boundary', () => {
  const valid = proposalFixture('book-a')
  assert.deepEqual(decodePlanningPackageArgs([valid]), [valid])
  assert.throws(() => decodePlanningPackageArgs([{ ...valid, cloudProjectId: 'forbidden' }]), /proposal/)
  assert.throws(() => decodePlanningPackageArgs([{ ...valid, basedOn: { ...valid.basedOn, inputFingerprint: 'short' } }]), /指纹/)
  assert.throws(() => decodePlanningPackageArgs([{ ...valid, volumes: [{ ...valid.volumes[0], order: 2 }] }]), /卷序/)
  assert.deepEqual(decodePlanningProposalIdArgs(['proposal']), ['proposal'])
  assert.deepEqual(decodePlanningTotalAdoptionArgs([{ proposalId: 'proposal', candidateFingerprint: 'A'.repeat(64), currentFingerprint: 'b'.repeat(64) }]), [{ proposalId: 'proposal', candidateFingerprint: 'a'.repeat(64), currentFingerprint: 'b'.repeat(64) }])
  assert.throws(() => decodePlanningTotalAdoptionArgs([{ proposalId: 'proposal', candidateFingerprint: 'short', currentFingerprint: 'b'.repeat(64) }]), /指纹/)
  assert.deepEqual(decodePlanningVolumeStructureArgs([{ proposalId: 'proposal', candidateFingerprint: 'a'.repeat(64), currentFingerprint: 'b'.repeat(64), totalFingerprint: 'C'.repeat(64) }]), [{ proposalId: 'proposal', candidateFingerprint: 'a'.repeat(64), currentFingerprint: 'b'.repeat(64), totalFingerprint: 'c'.repeat(64) }])
  assert.throws(() => decodePlanningVolumeStructureArgs([{ proposalId: 'proposal', candidateFingerprint: 'a'.repeat(64), currentFingerprint: 'b'.repeat(64), totalFingerprint: 'short' }]), /指纹/)
  assert.deepEqual(decodePlanningVolumeOutlinePreviewArgs(['proposal', 2]), ['proposal', 2])
  assert.throws(() => decodePlanningVolumeOutlinePreviewArgs(['proposal', 0]), /order/)
  assert.deepEqual(decodePlanningVolumeOutlineAdoptionArgs([{ proposalId: 'proposal', order: 1, parentFingerprint: 'A'.repeat(64), candidateFingerprint: 'b'.repeat(64), currentFingerprint: 'c'.repeat(64) }]), [{ proposalId: 'proposal', order: 1, parentFingerprint: 'a'.repeat(64), candidateFingerprint: 'b'.repeat(64), currentFingerprint: 'c'.repeat(64) }])
  assert.throws(() => decodePlanningVolumeOutlineAdoptionArgs([{ proposalId: 'proposal', order: 1, parentFingerprint: 'a'.repeat(64), candidateFingerprint: 'b'.repeat(64), currentFingerprint: 'short' }]), /指纹/)
  assert.deepEqual(decodePlanningChapterDetailAdoptionPreviewArgs(['proposal', 7]), ['proposal', 7])
  assert.throws(() => decodePlanningChapterDetailAdoptionPreviewArgs(['proposal', 0]), /chapterId/)
  assert.deepEqual(decodePlanningChapterDetailAdoptionArgs([{ proposalId: 'proposal', chapterId: 7, upstreamFingerprint: 'A'.repeat(64), candidateFingerprint: 'b'.repeat(64), currentFingerprint: 'c'.repeat(64) }]), [{ proposalId: 'proposal', chapterId: 7, upstreamFingerprint: 'a'.repeat(64), candidateFingerprint: 'b'.repeat(64), currentFingerprint: 'c'.repeat(64) }])
  assert.throws(() => decodePlanningChapterDetailAdoptionArgs([{ proposalId: 'proposal', chapterId: 7, upstreamFingerprint: 'short', candidateFingerprint: 'b'.repeat(64), currentFingerprint: 'c'.repeat(64) }]), /指纹/)
  assert.deepEqual(decodePlanningCharacterSeedAdoptionArgs([{ proposalId: 'proposal', candidateFingerprint: 'A'.repeat(64), currentFingerprint: 'b'.repeat(64) }]), [{ proposalId: 'proposal', candidateFingerprint: 'a'.repeat(64), currentFingerprint: 'b'.repeat(64) }])
  assert.throws(() => decodePlanningCharacterSeedAdoptionArgs([{ proposalId: 'proposal', candidateFingerprint: 'a'.repeat(64), currentFingerprint: 'short' }]), /指纹/)
  assert.deepEqual(decodePlanningWorldSeedAdoptionArgs([{ proposalId: 'proposal', candidateFingerprint: 'A'.repeat(64), currentFingerprint: 'b'.repeat(64) }]), [{ proposalId: 'proposal', candidateFingerprint: 'a'.repeat(64), currentFingerprint: 'b'.repeat(64) }])
  assert.throws(() => decodePlanningWorldSeedAdoptionArgs([{ proposalId: 'proposal', candidateFingerprint: 'a'.repeat(64), currentFingerprint: 'short' }]), /指纹/)
  assert.deepEqual(decodePlanningPowerSystemAdoptionArgs([{ proposalId: 'proposal', candidateFingerprint: 'A'.repeat(64), currentFingerprint: 'b'.repeat(64) }]), [{ proposalId: 'proposal', candidateFingerprint: 'a'.repeat(64), currentFingerprint: 'b'.repeat(64) }])
  assert.throws(() => decodePlanningPowerSystemAdoptionArgs([{ proposalId: 'proposal', candidateFingerprint: 'a'.repeat(64), currentFingerprint: 'short' }]), /指纹/)
  assert.deepEqual(decodePlanningCheatSystemAdoptionArgs([{ proposalId: 'proposal', candidateFingerprint: 'A'.repeat(64), currentFingerprint: 'b'.repeat(64) }]), [{ proposalId: 'proposal', candidateFingerprint: 'a'.repeat(64), currentFingerprint: 'b'.repeat(64) }])
  assert.throws(() => decodePlanningCheatSystemAdoptionArgs([{ proposalId: 'proposal', candidateFingerprint: 'a'.repeat(64), currentFingerprint: 'short' }]), /指纹/)
})

test('previews and adopts only the stored total-outline candidate with stale-preview protection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'planning-adoption-'))
  const summary = { id: 'book-a', name: '测试作品', path: root, title: '测试作品', genre: '都市', updated_at: '2026-08-27T08:00:00.000Z', manuscript: { chapterCount: 0, fileCount: 0, wordCount: 0, status: 'ready' as const } }
  const projects = { currentPath: async () => root, currentSummary: async () => summary }
  let formal = '# 作者旧总纲\n\n旧内容'
  let revision = 4
  let writes = 0
  let totalConfirmed = true
  const totalApprovalFingerprint = 'd'.repeat(64)
  const volumeFormal = new Map<number, string>([[1, '# 作者旧卷纲\n\n旧卷内容']])
  let volumeState = [
    { volume: 1, title: '旧卷名', eventIds: [], origin: 'planned' as const, revision: 2, outlineExists: true, externalChangeDetected: false, review: {} as OutlinePlanningStatus['volumes'][number]['review'], approval: { status: 'confirmed' } as OutlinePlanningStatus['volumes'][number]['approval'] },
    { volume: 3, title: '作者额外卷', eventIds: [], origin: 'planned' as const, revision: 1, outlineExists: true, externalChangeDetected: false, review: {} as OutlinePlanningStatus['volumes'][number]['review'], approval: { status: 'ready' } as OutlinePlanningStatus['volumes'][number]['approval'] }
  ]
  const status = (): OutlinePlanningStatus => ({
    totalRevision: revision, totalOutlineExists: Boolean(formal), externalChangeDetected: false,
    totalReview: {} as OutlinePlanningStatus['totalReview'],
    totalApproval: { status: totalConfirmed ? 'confirmed' : 'needs-review', fingerprint: totalApprovalFingerprint } as OutlinePlanningStatus['totalApproval'],
    assignedEventIds: [], unplacedEventIds: [],
    volumes: volumeState,
    chapterPlacements: [{ chapterId: 1, volume: 1 }], eventChapterPlacements: []
  })
  const planning = {
    status: async () => status(),
    updateOutline: async (volume: 'total' | number, content: string) => {
      writes += 1
      if (volume === 'total') {
        if (content !== formal) revision += 1
        formal = content
        return { success: true as const, volume, content }
      }
      const target = volumeState.find((item) => item.volume === volume)!
      if (volumeFormal.get(volume) !== content) target.revision += 1
      target.outlineExists = Boolean(content.trim())
      target.approval = { status: 'needs-review' } as OutlinePlanningStatus['volumes'][number]['approval']
      volumeFormal.set(volume, content)
      return { success: true as const, volume, content }
    },
    initializeVolumeStructure: async (input: Array<{ order: number; title: string }>) => {
      volumeState = [
        ...input.map((item) => volumeState.find((volume) => volume.volume === item.order)
          ? { ...volumeState.find((volume) => volume.volume === item.order)!, title: item.title }
          : { volume: item.order, title: item.title, eventIds: [], origin: 'planned' as const, revision: 0, outlineExists: false, externalChangeDetected: false, review: {} as OutlinePlanningStatus['volumes'][number]['review'], approval: { status: 'missing' } as OutlinePlanningStatus['volumes'][number]['approval'] }),
        ...volumeState.filter((volume) => !input.some((item) => item.order === volume.volume))
      ].sort((left, right) => left.volume - right.volume)
      revision += 1
      totalConfirmed = false
      return status()
    }
  }
  const documents = {
    outline: async (volume: 'total' | number) => ({ content: volume === 'total' ? formal : volumeFormal.get(volume) || '' }),
    chapterOutlines: async () => [{ chapterId: 1, content: '第一章章纲' }, { chapterId: 2, content: '' }]
  }
  try {
    const characters = new CharacterStateService(projects)
    const workspace = new WorkspaceService(projects as never)
    await workspace.saveFoundation({ creationPath: 'materials', sourceNotes: '作者札记必须保留', worldView: '作者原有的开放世界描述。', useRealms: true, useSystem: false })
    await workspace.saveRealms([{ id: 'realm-1', name: '练习生', description: '只能完成基础声乐训练。' }])
    await workspace.saveSystemTemplate('[能力]\n名称：{{name}}\n限制：{{limit}}')
    const service = new PlanningPackageService(projects, planning, documents, () => new Date('2026-08-27T11:00:00.000Z'), characters, workspace)
    await service.save(proposalFixture('book-a'))
    await assert.rejects(service.previewTotalAdoption('proposal'), (error: { code?: string; message?: string }) => error.code === 'CONFLICT' && Boolean(error.message?.includes('人物种子')))
    const prerequisiteSeeds = await service.previewCharacterSeedAdoption('proposal')
    await service.adoptCharacterSeeds({ proposalId: 'proposal', candidateFingerprint: prerequisiteSeeds.candidateFingerprint, currentFingerprint: prerequisiteSeeds.currentFingerprint })
    const prerequisiteWorld = await service.previewWorldSeedAdoption('proposal')
    await service.adoptWorldSeed({ proposalId: 'proposal', candidateFingerprint: prerequisiteWorld.candidateFingerprint, currentFingerprint: prerequisiteWorld.currentFingerprint })
    const prerequisitePower = await service.previewPowerSystemAdoption('proposal')
    await service.adoptPowerSystem({ proposalId: 'proposal', candidateFingerprint: prerequisitePower.candidateFingerprint, currentFingerprint: prerequisitePower.currentFingerprint })
    const prerequisiteCheat = await service.previewCheatSystemAdoption('proposal')
    await service.adoptCheatSystem({ proposalId: 'proposal', candidateFingerprint: prerequisiteCheat.candidateFingerprint, currentFingerprint: prerequisiteCheat.currentFingerprint })
    const preview = await service.previewTotalAdoption('proposal')
    assert.equal(writes, 0)
    assert.equal(preview.current.revision, 4)
    assert.equal(preview.affected.chapterOutlines, 1)
    assert.equal(preview.affected.confirmedVolumes, 1)
    assert.equal(preview.affected.totalConfirmation, true)
    assert.match(preview.candidate.excerpt, /^# 从救场到新秩序/)

    formal = '# 作者刚刚改过的总纲'
    await assert.rejects(service.adoptTotal({ proposalId: 'proposal', candidateFingerprint: preview.candidateFingerprint, currentFingerprint: preview.currentFingerprint }), (error: { code?: string }) => error.code === 'CONFLICT')
    assert.equal(writes, 0)

    const refreshed = await service.previewTotalAdoption('proposal')
    const adopted = await service.adoptTotal({ proposalId: 'proposal', candidateFingerprint: refreshed.candidateFingerprint, currentFingerprint: refreshed.currentFingerprint })
    assert.equal(writes, 1)
    assert.match(formal, /^# 从救场到新秩序/)
    assert.equal(adopted.proposal.adoption?.totalOutline?.fingerprint, refreshed.candidateFingerprint)
    assert.equal(adopted.proposal.adoption?.totalOutline?.revision, 5)
    assert.equal(adopted.proposal.adoption?.totalOutline?.adoptedAt, '2026-08-27T11:00:00.000Z')
    assert.ok(adopted.proposal.adoption?.characterSeeds && adopted.proposal.adoption.worldSeed && adopted.proposal.adoption.powerSystem && adopted.proposal.adoption.cheatSystem)
    assert.deepEqual(await service.get(), adopted.proposal)
    const structurePreview = await service.previewVolumeStructure('proposal')
    assert.deepEqual(structurePreview.actions.map((item) => item.action), ['rename', 'create'])
    assert.deepEqual(structurePreview.preservedExtraVolumes, [{ order: 3, title: '作者额外卷' }])
    assert.equal(structurePreview.affected.confirmedVolumes, 1)
    const initialized = await service.initializeVolumeStructure({
      proposalId: 'proposal', candidateFingerprint: structurePreview.candidateFingerprint,
      currentFingerprint: structurePreview.currentFingerprint, totalFingerprint: structurePreview.totalFingerprint
    })
    assert.deepEqual(initialized.planning.volumes.map((item) => [item.volume, item.title]), [[1, '无名之声'], [2, '自己的歌'], [3, '作者额外卷']])
    assert.equal(initialized.planning.totalApproval.status, 'needs-review')
    assert.equal(initialized.proposal.adoption?.volumeStructure?.fingerprint, structurePreview.candidateFingerprint)
    assert.equal(initialized.proposal.adoption?.volumeStructure?.totalRevision, 6)
    assert.equal(initialized.proposal.adoption?.volumeStructure?.initializedAt, '2026-08-27T11:00:00.000Z')
    totalConfirmed = true
    volumeState = volumeState.map((item) => ({ ...item, approval: { status: 'ready' } as OutlinePlanningStatus['volumes'][number]['approval'] }))
    const volumePreview = await service.previewVolumeOutlineAdoption('proposal', 1)
    assert.equal(volumePreview.order, 1)
    assert.equal(volumePreview.parentFingerprint, totalApprovalFingerprint)
    assert.equal(volumePreview.affected.chapterOutlines, 1)
    assert.match(volumePreview.current.excerpt, /作者旧卷纲/)
    assert.match(volumePreview.candidate.excerpt, /^# 第 1 卷 · 无名之声/)
    totalConfirmed = false
    await assert.rejects(service.adoptVolumeOutline({ proposalId: 'proposal', order: 1, parentFingerprint: volumePreview.parentFingerprint, candidateFingerprint: volumePreview.candidateFingerprint, currentFingerprint: volumePreview.currentFingerprint }), (error: { code?: string }) => error.code === 'CONFLICT')
    totalConfirmed = true
    const volumeAdopted = await service.adoptVolumeOutline({ proposalId: 'proposal', order: 1, parentFingerprint: volumePreview.parentFingerprint, candidateFingerprint: volumePreview.candidateFingerprint, currentFingerprint: volumePreview.currentFingerprint })
    assert.match(volumeFormal.get(1) || '', /^# 第 1 卷 · 无名之声/)
    assert.equal(volumeAdopted.planning.volumes[0]?.approval.status, 'needs-review')
    assert.equal(volumeAdopted.proposal.adoption?.volumeOutlines?.[0]?.order, 1)
    assert.equal(volumeAdopted.proposal.adoption?.volumeOutlines?.[0]?.fingerprint, volumePreview.candidateFingerprint)
    assert.equal(volumeAdopted.proposal.adoption?.volumeOutlines?.[0]?.totalFingerprint, totalApprovalFingerprint)
    const staleVolumePreview = await service.previewVolumeOutlineAdoption('proposal', 2)
    volumeFormal.set(2, '# 作者在预览后写入第二卷')
    await assert.rejects(service.adoptVolumeOutline({ proposalId: 'proposal', order: 2, parentFingerprint: staleVolumePreview.parentFingerprint, candidateFingerprint: staleVolumePreview.candidateFingerprint, currentFingerprint: staleVolumePreview.currentFingerprint }), (error: { code?: string }) => error.code === 'CONFLICT')
    const forgedVolume = structuredClone(volumeAdopted.proposal)
    forgedVolume.adoption!.volumeOutlines!.push({ order: 2, fingerprint: 'e'.repeat(64), adoptedAt: '2026-08-27T12:00:00.000Z', revision: 99, totalFingerprint: totalApprovalFingerprint })
    await assert.rejects(service.save(forgedVolume), (error: { code?: string }) => error.code === 'CONFLICT')
    await rm(join(root, '.webnovel', 'story-state', 'characters.json'), { force: true })
    await workspace.saveFoundation({ creationPath: 'materials', sourceNotes: '作者札记必须保留', worldView: '作者原有的开放世界描述。', useRealms: true, useSystem: false })
    await workspace.savePowerSystem({ overview: '' })
    await workspace.saveCheatSystem({ overview: '' })
    const seedPreview = await service.previewCharacterSeedAdoption('proposal')
    assert.equal(seedPreview.actions.length, volumeAdopted.proposal.blueprint.characters.length)
    assert.ok(seedPreview.actions.every((item) => item.action === 'create'))
    const seedAdopted = await service.adoptCharacterSeeds({
      proposalId: 'proposal', candidateFingerprint: seedPreview.candidateFingerprint, currentFingerprint: seedPreview.currentFingerprint
    })
    assert.equal(seedAdopted.characters.anchors.length, volumeAdopted.proposal.blueprint.characters.length)
    assert.equal(seedAdopted.characters.events.length, 0)
    assert.equal(seedAdopted.proposal.adoption?.characterSeeds?.fingerprint, seedPreview.candidateFingerprint)
    assert.equal(seedAdopted.proposal.adoption?.characterSeeds?.adoptedAt, '2026-08-27T11:00:00.000Z')
    assert.equal(seedAdopted.proposal.adoption?.totalOutline, undefined)
    assert.equal(seedAdopted.proposal.adoption?.volumeStructure, undefined)
    assert.equal(seedAdopted.proposal.adoption?.volumeOutlines, undefined)
    const forgedSeeds = structuredClone(seedAdopted.proposal)
    forgedSeeds.adoption!.characterSeeds!.anchorFingerprint = 'e'.repeat(64)
    await assert.rejects(service.save(forgedSeeds), (error: { code?: string }) => error.code === 'CONFLICT')
    const worldPreview = await service.previewWorldSeedAdoption('proposal')
    assert.equal(worldPreview.current.excerpt, '作者原有的开放世界描述。')
    assert.equal(worldPreview.preserved.sourceNotes, true)
    assert.equal(worldPreview.preserved.useRealms, true)
    assert.equal((await workspace.foundation()).worldView, '作者原有的开放世界描述。')
    await workspace.saveFoundation({ ...(await workspace.foundation()), sourceNotes: '作者在预览后补充的札记' })
    await assert.rejects(service.adoptWorldSeed({ proposalId: 'proposal', candidateFingerprint: worldPreview.candidateFingerprint, currentFingerprint: worldPreview.currentFingerprint }), (error: { code?: string }) => error.code === 'CONFLICT')
    const refreshedWorld = await service.previewWorldSeedAdoption('proposal')
    const worldAdopted = await service.adoptWorldSeed({ proposalId: 'proposal', candidateFingerprint: refreshedWorld.candidateFingerprint, currentFingerprint: refreshedWorld.currentFingerprint })
    assert.equal(worldAdopted.foundation.worldView, seedAdopted.proposal.blueprint.worldView)
    assert.equal(worldAdopted.foundation.sourceNotes, '作者在预览后补充的札记')
    assert.equal(worldAdopted.foundation.useRealms, true)
    assert.equal(worldAdopted.foundation.useSystem, false)
    assert.equal(worldAdopted.proposal.adoption?.worldSeed?.fingerprint, refreshedWorld.candidateFingerprint)
    assert.equal(worldAdopted.proposal.adoption?.worldSeed?.adoptedAt, '2026-08-27T11:00:00.000Z')
    const forgedWorld = structuredClone(worldAdopted.proposal)
    forgedWorld.adoption!.worldSeed!.foundationFingerprint = 'e'.repeat(64)
    await assert.rejects(service.save(forgedWorld), (error: { code?: string }) => error.code === 'CONFLICT')
    const powerPreview = await service.previewPowerSystemAdoption('proposal')
    assert.equal(powerPreview.current.exists, false)
    assert.equal(powerPreview.preserved.realmLevels, 1)
    assert.equal(powerPreview.preserved.realmsEnabled, true)
    assert.deepEqual(await workspace.powerSystem(), { overview: '' })
    await workspace.savePowerSystem({ overview: '作者在预览后写下的职业成长体系。' })
    await assert.rejects(service.adoptPowerSystem({ proposalId: 'proposal', candidateFingerprint: powerPreview.candidateFingerprint, currentFingerprint: powerPreview.currentFingerprint }), (error: { code?: string }) => error.code === 'CONFLICT')
    const refreshedPower = await service.previewPowerSystemAdoption('proposal')
    const powerAdopted = await service.adoptPowerSystem({ proposalId: 'proposal', candidateFingerprint: refreshedPower.candidateFingerprint, currentFingerprint: refreshedPower.currentFingerprint })
    assert.equal(powerAdopted.powerSystem.overview, worldAdopted.proposal.blueprint.powerSystem)
    assert.deepEqual(await workspace.realms(), { levels: [{ id: 'realm-1', name: '练习生', description: '只能完成基础声乐训练。' }] })
    assert.equal((await workspace.foundation()).useRealms, true)
    assert.equal(powerAdopted.proposal.adoption?.powerSystem?.fingerprint, refreshedPower.candidateFingerprint)
    const forgedPower = structuredClone(powerAdopted.proposal)
    forgedPower.adoption!.powerSystem!.powerSystemFingerprint = 'e'.repeat(64)
    await assert.rejects(service.save(forgedPower), (error: { code?: string }) => error.code === 'CONFLICT')
    const cheatPreview = await service.previewCheatSystemAdoption('proposal')
    assert.equal(cheatPreview.current.exists, false)
    assert.equal(cheatPreview.preserved.systemEnabled, false)
    assert.equal(cheatPreview.preserved.templateCharacters, (await workspace.systemTemplate()).template.length)
    assert.deepEqual(await workspace.cheatSystem(), { overview: '' })
    await workspace.saveCheatSystem({ overview: '作者在预览后写下的特殊优势。' })
    await assert.rejects(service.adoptCheatSystem({ proposalId: 'proposal', candidateFingerprint: cheatPreview.candidateFingerprint, currentFingerprint: cheatPreview.currentFingerprint }), (error: { code?: string }) => error.code === 'CONFLICT')
    const refreshedCheat = await service.previewCheatSystemAdoption('proposal')
    const templateBeforeCheatAdoption = await workspace.systemTemplate()
    const foundationBeforeCheatAdoption = await workspace.foundation()
    const cheatAdopted = await service.adoptCheatSystem({ proposalId: 'proposal', candidateFingerprint: refreshedCheat.candidateFingerprint, currentFingerprint: refreshedCheat.currentFingerprint })
    assert.equal(cheatAdopted.cheatSystem.overview, powerAdopted.proposal.blueprint.cheatSystem)
    assert.deepEqual(await workspace.systemTemplate(), templateBeforeCheatAdoption)
    assert.deepEqual(await workspace.foundation(), foundationBeforeCheatAdoption)
    assert.equal(cheatAdopted.proposal.adoption?.cheatSystem?.fingerprint, refreshedCheat.candidateFingerprint)
    const forgedCheat = structuredClone(cheatAdopted.proposal)
    forgedCheat.adoption!.cheatSystem!.cheatSystemFingerprint = 'e'.repeat(64)
    await assert.rejects(service.save(forgedCheat), (error: { code?: string }) => error.code === 'CONFLICT')
    const postFoundationTotalPreview = await service.previewTotalAdoption('proposal')
    const postFoundationTotal = await service.adoptTotal({ proposalId: 'proposal', candidateFingerprint: postFoundationTotalPreview.candidateFingerprint, currentFingerprint: postFoundationTotalPreview.currentFingerprint })
    assert.ok(postFoundationTotal.proposal.adoption?.characterSeeds && postFoundationTotal.proposal.adoption.worldSeed && postFoundationTotal.proposal.adoption.powerSystem && postFoundationTotal.proposal.adoption.cheatSystem)
    const staleStructurePreview = await service.previewVolumeStructure('proposal')
    volumeState[0]!.title = '作者临时改名'
    await assert.rejects(service.initializeVolumeStructure({ proposalId: 'proposal', candidateFingerprint: staleStructurePreview.candidateFingerprint, currentFingerprint: staleStructurePreview.currentFingerprint, totalFingerprint: staleStructurePreview.totalFingerprint }), (error: { code?: string }) => error.code === 'CONFLICT')
    const forged = proposalFixture('book-a')
    forged.adoption = { totalOutline: { fingerprint: 'f'.repeat(64), adoptedAt: '2026-08-27T12:00:00.000Z', revision: 99 } }
    await assert.rejects(service.save(forged), (error: { code?: string }) => error.code === 'CONFLICT')
    assert.deepEqual(await service.get(), postFoundationTotal.proposal)
    const powerSystemPath = join(root, '.webnovel', 'config', 'power-system.json')
    await writeFile(powerSystemPath, '{"version":1,"overview":', 'utf8')
    await assert.rejects(workspace.powerSystem(), (error: { code?: string }) => error.code === 'INVALID_PROJECT_STATE')
    await assert.rejects(workspace.savePowerSystem({ overview: '不得覆盖损坏的原文件' }), (error: { code?: string }) => error.code === 'INVALID_PROJECT_STATE')
    assert.equal(await readFile(powerSystemPath, 'utf8'), '{"version":1,"overview":')
    const cheatSystemPath = join(root, '.webnovel', 'config', 'cheat-system.json')
    await writeFile(cheatSystemPath, '{"version":1,"overview":', 'utf8')
    await assert.rejects(workspace.cheatSystem(), (error: { code?: string }) => error.code === 'INVALID_PROJECT_STATE')
    await assert.rejects(workspace.saveCheatSystem({ overview: '不得覆盖损坏的原文件' }), (error: { code?: string }) => error.code === 'INVALID_PROJECT_STATE')
    assert.equal(await readFile(cheatSystemPath, 'utf8'), '{"version":1,"overview":')
    const systemTemplatePath = join(root, '.webnovel', 'config', 'system-ui.json')
    await writeFile(systemTemplatePath, '{"template":', 'utf8')
    await assert.rejects(workspace.systemTemplate(), (error: { code?: string }) => error.code === 'INVALID_PROJECT_STATE')
    await assert.rejects(workspace.saveSystemTemplate('不得覆盖损坏的原模板'), (error: { code?: string }) => error.code === 'INVALID_PROJECT_STATE')
    assert.equal(await readFile(systemTemplatePath, 'utf8'), '{"template":')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

function proposalFixture(workItemId: string): PlanningPackageProposal {
  return {
    id: 'proposal',
    workItemId,
    createdAt: '2026-08-27T08:00:00.000Z',
    basedOn: { inputFingerprint: 'a'.repeat(64), blueprintFingerprint: 'b'.repeat(64), totalOutlineFingerprint: 'c'.repeat(64) },
    blueprint: parsePlanningBlueprint(blueprintJson),
    totalOutline: parsePlanningTotalOutline(totalOutlineJson),
    volumes: parsePlanningVolumes(volumesJson, 2)
  }
}

function adoptedProposalFixture(workItemId: string): PlanningPackageProposal {
  const proposal = proposalFixture(workItemId)
  const digest = (content: string) => createHash('sha256').update(content).digest('hex')
  proposal.adoption = {
    totalOutline: { fingerprint: digest(renderPlanningTotalOutline(proposal)), adoptedAt: '2026-08-27T09:00:00.000Z', revision: 1 },
    volumeStructure: { fingerprint: digest(renderPlanningVolumeStructure(proposal)), initializedAt: '2026-08-27T09:05:00.000Z', totalRevision: 1 },
    volumeOutlines: proposal.volumes.map((volume) => ({
      order: volume.order,
      fingerprint: digest(renderPlanningVolumeOutline(volume)),
      adoptedAt: '2026-08-27T09:10:00.000Z',
      revision: 1,
      totalFingerprint: 'd'.repeat(64)
    }))
  }
  return proposal
}

function confirmedPlanningStatus(proposal: PlanningPackageProposal): OutlinePlanningStatus {
  const approval = (scope: 'total' | number): OutlinePlanningStatus['totalApproval'] => ({ scope, status: 'confirmed', canConfirm: true, reason: '', fingerprint: 'd'.repeat(64), confirmedAt: '2026-08-27T09:20:00.000Z' })
  const review = (scope: 'total' | number): OutlinePlanningStatus['totalReview'] => ({ scope, status: 'clear', issues: [], metrics: { characterCount: 100, sectionCount: 2, causalCueCount: 2, eventCount: 2, chapterCount: 0 }, fingerprint: 'e'.repeat(64) })
  return {
    totalRevision: 1, totalOutlineExists: true, externalChangeDetected: false,
    totalReview: review('total'), totalApproval: approval('total'), assignedEventIds: [], unplacedEventIds: [],
    volumes: proposal.volumes.map((volume) => ({
      volume: volume.order, title: volume.title, eventIds: [], origin: 'planned', revision: 1,
      outlineExists: true, externalChangeDetected: false, review: review(volume.order), approval: approval(volume.order)
    })),
    chapterPlacements: [], eventChapterPlacements: []
  }
}


test('total story review with upstream gap stops before volume generation and preserves evidence', async () => {
  const calls: string[] = []
  const service = new PlanningDraftService({ complete: async instruction => {
    calls.push(instruction)
    if (instruction.includes('生成创作蓝图')) return { content: blueprintJson }
    if (instruction.startsWith('复核下方')) return { content: calls.length === 2 ? '{"issues":[]}' : JSON.stringify({ issues: [{ category: 'upstream-gap', quote: '', parentQuote: '', reason: '结局依赖尚未确定的人物身份，需作者先确定总纲依据。', needsAuthor: true }] }) }
    assert.match(instruction, /覆盖全书的总纲/)
    return { content: totalOutlineJson }
  } }, { bookProfile: async () => profile, foundation: async () => foundation })
  await assert.rejects(service.generate('book-a'), error => {
    assert.match((error as Error).message, /需作者先确定/)
    assert.equal((error as { originalContent: string }).originalContent, totalOutlineJson)
    return true
  })
  assert.equal(calls.length, 4)
  assert.ok(!calls.some(prompt => prompt.includes('把总纲拆成')))
})
