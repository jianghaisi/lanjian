import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChapterDraftProposal } from '../../../src/contracts/index'
import { AiClient } from '../../../src/main/modules/models/application/ai-client'
import { ChapterDraftService } from '../../../src/main/modules/manuscript/application/chapter-draft-service'
import { DocumentService } from '../../../src/main/modules/manuscript/application/document-service'
import { ProjectService } from '../../../src/main/modules/library/application/project-service'
import { WorkspaceService } from '../../../src/main/modules/library/application/workspace-service'
import { parseChapterCardDiscussion, resolveWritingAgentSkill, WritingAgentService } from '../../../src/main/modules/assistant/application/writing-agent-service'
import { AgentToolRegistry } from '../../../src/main/modules/assistant/application/agent-tool-registry'
import { WritingAgentPreviewService } from '../../../src/main/modules/assistant/application/writing-agent-preview-service'
import { compileGeneration } from '../../../src/contracts/models/generation-parameters'

const proposal: ChapterDraftProposal = {
  id: 'proposal-1',
  chapterId: 3,
  createdAt: '2026-08-31T00:00:00.000Z',
  content: '雨声渐近。',
  contract: {
    chapterId: 3,
    chapterPosition: 2,
    outlineSnapshot: '章纲',
    beats: [{ id: 'B1', order: 1, requirement: '听见雨声' }],
    forbiddenEvents: [],
    entryState: '尚未下雨',
    exitState: '雨声渐近',
    allowedFacts: ['天气'],
    foreshadowActions: [],
    version: { fingerprint: 'f', totalFingerprint: 't', outlineHash: 'o', eventIds: [], confirmedAt: '2026-08-31T00:00:00.000Z' }
  },
  report: {
    passed: true,
    summary: '通过',
    beats: [{ id: 'B1', status: 'covered', evidence: '雨声渐近' }],
    boundary: { entryRespected: true, exitReached: true, evidence: '雨声渐近' },
    foreshadowing: [],
    violations: [],
    introducedFacts: [],
    characterChanges: [],
    characterConflicts: []
  }
}

function service(
  aiContent = '替换后的文字',
  contextCandidates?: Array<Record<string, unknown>>,
  contextBudgetPreferences = { version: 1 as const, inputBudgetTokens: 120_000, modelContextLimit: 150_000, outputReservePercent: 25, systemReserveTokens: 10_000, recentSummaryCount: 3, structuredRepairAttempts: 1, pinnedEvidenceKeys: [] as string[], excludedEvidenceKeys: [] as string[] }
) {
  let aiCalls = 0
  const modelOverrides: Array<string | undefined> = []
  const connectionOverrides: Array<string | undefined> = []
  const contextInputs: string[] = []
  const instructions: string[] = []
  const contextQuestions: Array<string | undefined> = []
  const factQuestions: Array<string | undefined> = []
  const draftModelOverrides: Array<string | undefined> = []
  const draftConnectionOverrides: Array<string | undefined> = []
  const draftInstructions: string[] = []
  const ai = {
    modelFor: async (task: string, override?: string) => override || `${task}-default`,
    complete: async (...args: unknown[]) => {
      aiCalls += 1
      instructions.push(String(args[0] || ''))
      contextInputs.push(String(args[2] || ''))
      modelOverrides.push(args[5] as string | undefined)
      connectionOverrides.push(args[6] as string | undefined)
      return { content: aiContent }
    }
  } as unknown as AiClient
  const projects = {
    currentSummary: async () => ({ id: 'book-1', path: 'C:\\books\\book-1' }),
    currentPath: async () => 'C:\\books\\book-1'
  } as unknown as ProjectService
  const documents = { chapter: async () => ({ id: 3 }) } as unknown as DocumentService
  const workspace = {
    foundationStatus: async () => ({ readyForProse: true, missing: [] }),
    chapterContractVersion: async () => ({ fingerprint: 'confirmed-fixture' }),
    promptContext: async (_chapter: number, _task: string, options?: { question?: string; mode?: string }) => {
      assert.notEqual(options?.mode, 'fast', 'legacy preferences must not select compressed writing context')
      contextQuestions.push(options?.question)
      return '正式上下文'
    },
    ...(contextCandidates ? { promptContextCandidates: async () => contextCandidates } : {}),
    contextFactPack: async (_chapter: number, question?: string) => {
      factQuestions.push(question)
      return { evidence: [{ excerpt: '前文' }] }
    },
    consistencyOverview: async () => ({ items: [{ status: 'ready' }] }),
    contextBudgetPreferences: async () => contextBudgetPreferences,
    currentChapterCardFingerprint: async () => 'chapter-card:test',
    bookProfile: async () => ({ chapterGenerationMode: 'fast' })
  } as unknown as WorkspaceService
  const chapterDrafts = { draft: async (...args: unknown[]) => {
    draftInstructions.push(String(args[1] || ''))
    draftModelOverrides.push(args[4] as string | undefined)
    draftConnectionOverrides.push(args[6] as string | undefined)
    return proposal
  } } as unknown as ChapterDraftService
  return {
    ai,
    workspace,
    chapterDrafts,
    agent: new WritingAgentService(ai, projects, documents, workspace, chapterDrafts),
    aiCalls: () => aiCalls,
    modelOverrides: () => modelOverrides,
    connectionOverrides: () => connectionOverrides,
    contextInputs: () => contextInputs,
    instructions: () => instructions,
    contextQuestions: () => contextQuestions,
    factQuestions: () => factQuestions,
    draftInstructions: () => draftInstructions,
    draftModelOverrides: () => draftModelOverrides,
    draftConnectionOverrides: () => draftConnectionOverrides
  }
}

for (const entry of ['prepare', 'run', 'preview'] as const) {
  test(`${entry} propagates author cancellation into source compilation before model dispatch`, async () => {
    const target = service('不应生成', [{
      id: 'required', sourceType: 'workspace-prompt-context', label: '正式依据',
      content: '保留原有依据', authority: 'required', truncationPolicy: 'never'
    }])
    const read = target.workspace.promptContextCandidates.bind(target.workspace)
    const controller = new AbortController()
    let sourceSignal: AbortSignal | undefined
    let entered!: () => void
    let release!: () => void
    const reading = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    target.workspace.promptContextCandidates = async (...args) => {
      sourceSignal = args[3]
      entered()
      await gate
      sourceSignal?.throwIfAborted()
      return read(...args)
    }
    const outcome = target.agent[entry]({ chapterId: 3, message: '改写', currentDraft: '旧句。', preferredSkill: 'rewrite' }, controller.signal)
      .then(() => undefined, (error: Error) => error)
    try {
      await reading
      controller.abort()
      assert.equal(sourceSignal?.aborted, true)
      // The caller settles even if an in-flight reader has not cooperated yet.
      assert.equal((await outcome)?.name, 'AbortError')
      assert.equal(target.aiCalls(), 0)
    } finally {
      release()
      await outcome
    }
  })
}

for (const entry of ['preview', 'prepare', 'run'] as const) {
  test(`${entry} rejects worldbook changes during source compilation`, async () => {
    const target = service()
    let version = 'a'.repeat(64)
    target.workspace.currentWorldbookFingerprint = async () => version
    let changeDuringRead = true
    target.workspace.promptContextCandidates = async () => {
      const content = `世界书依据指纹：${version}\n已按本章选择设定。`
      if (changeDuringRead) version = 'b'.repeat(64)
      return [{ id: 'worldbook-state', sourceType: 'worldbook-state', sourceId: 'worldbook-state', label: '世界书边界', content, authority: 'required', truncationPolicy: 'never' }]
    }
    const input = { chapterId: 3, currentDraft: '', message: '核对设定', preferredSkill: 'query' as const }
    await assert.rejects(target.agent[entry](input), { code: 'CONFLICT', recoverable: true })
    assert.equal(target.aiCalls(), 0)
    changeDuringRead = false
    const prepared = await target.agent.prepare(input)
    await target.agent.run(input, undefined, prepared)
    assert.equal(target.aiCalls(), 1)
  })
}

for (const preferredSkill of ['query', 'continue'] as const) {
  test(`${preferredSkill} rejects worldbook changes after the initial dispatch check`, async () => {
    const target = service()
    let version = 'a'.repeat(64)
    target.workspace.currentWorldbookFingerprint = async () => version
    target.workspace.promptContextCandidates = async () => [{
      id: 'worldbook-state', sourceType: 'worldbook-state', sourceId: 'worldbook-state', label: '世界书边界',
      content: `世界书依据指纹：${version}\n已按本章选择设定。`, authority: 'required', truncationPolicy: 'never'
    }]
    const input = { chapterId: 3, currentDraft: '', message: '生成', preferredSkill }
    const prepared = await target.agent.prepare(input)
    const readCard = target.workspace.currentChapterCardFingerprint.bind(target.workspace)
    const readFacts = target.workspace.contextFactPack.bind(target.workspace)
    if (preferredSkill === 'continue') target.workspace.currentChapterCardFingerprint = async (...args) => {
      version = 'b'.repeat(64)
      return readCard(...args)
    }
    else target.workspace.contextFactPack = async (...args) => {
      version = 'b'.repeat(64)
      return readFacts(...args)
    }
    await assert.rejects(target.agent.run(input, undefined, prepared), { code: 'CONFLICT', recoverable: true })
    assert.equal(target.aiCalls(), 0)
    assert.deepEqual(target.draftInstructions(), [])
  })
}

for (const entry of ['preview', 'prepare', 'run'] as const) {
  test(`${entry} rejects a chapter card changed during source compilation`, async () => {
    const target = service()
    let card = 'card-before'
    target.workspace.currentChapterCardFingerprint = async () => card
    let entered!: () => void
    let release!: () => void
    const reading = new Promise<void>(resolve => { entered = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    target.workspace.promptContextCandidates = async () => {
      const content = card
      entered()
      await gate
      return [{ id: 'chapter-card', sourceType: 'workspace', sourceId: 'chapter-card', label: '当前章卡', content, authority: 'required', truncationPolicy: 'never' }]
    }
    const request = { chapterId: 3, message: '核对本章', currentDraft: '', preferredSkill: 'query' as const }
    const result = target.agent[entry](request)
    const rejected = assert.rejects(result, { code: 'CONFLICT', recoverable: true })
    await reading
    card = 'card-after'
    release()
    await rejected
    assert.equal(target.aiCalls(), 0)
    const prepared = await target.agent.prepare(request)
    assert.equal(prepared.chapterCardFingerprint, card)
    assert.ok(prepared.contexts.some(item => item.content === card))
    await target.agent.run(request, undefined, prepared)
    assert.equal(target.aiCalls(), 1)
  })
}

for (const preferredSkill of ['query', 'continue'] as const) {
  test(`${preferredSkill} rejects a chapter card changed after preparation before model dispatch`, async () => {
    const target = service()
    let card = 'card-before'
    target.workspace.currentChapterCardFingerprint = async () => card
    const request = { chapterId: 3, message: '核对本章', currentDraft: '', preferredSkill }
    const prepared = await target.agent.prepare(request)
    card = 'card-after'
    await assert.rejects(target.agent.run(request, undefined, prepared), { code: 'CONFLICT', recoverable: true })
    assert.equal(target.aiCalls(), 0)
    assert.deepEqual(target.draftInstructions(), [])
  })
}

test('a chapter card changed during final fact reads blocks model dispatch', async () => {
  const target = service()
  let card = 'card-before'
  target.workspace.currentChapterCardFingerprint = async () => card
  const request = { chapterId: 3, message: '核对本章', currentDraft: '', preferredSkill: 'query' as const }
  const prepared = await target.agent.prepare(request)
  const readFacts = target.workspace.contextFactPack.bind(target.workspace)
  target.workspace.contextFactPack = async (...args) => {
    card = 'card-after'
    return readFacts(...args)
  }
  await assert.rejects(target.agent.run(request, undefined, prepared), { code: 'CONFLICT', recoverable: true })
  assert.equal(target.aiCalls(), 0)
})

test('invalidating an interactive preview leaves the independent formal preparation running', async () => {
  const target = service()
  const reads: Array<{ signal?: AbortSignal; release: () => void }> = []
  target.workspace.promptContextCandidates = async (_chapter, _task, _options, signal) => {
    await new Promise<void>(resolve => { reads.push({ signal, release: resolve }) })
    signal?.throwIfAborted()
    return [{ id: 'required', sourceType: 'workspace', sourceId: 'required', label: '正式依据', content: '全部依据', authority: 'required', truncationPolicy: 'never' }]
  }
  const previews = new WritingAgentPreviewService({ runInCurrentBook: async operation => operation() }, target.agent)
  const input = { chapterId: 3, message: '核对本章', currentDraft: '', preferredSkill: 'query' as const }
  const background = target.agent.prepare(input, new AbortController().signal)
  while (reads.length < 1) await new Promise(resolve => setImmediate(resolve))
  const preview = assert.rejects(previews.preview(input), { code: 'CONFLICT' })
  while (reads.length < 2) await new Promise(resolve => setImmediate(resolve))
  try {
    previews.beginNavigation()
    await preview
    assert.equal(reads[0].signal?.aborted, false)
    assert.equal(reads[1].signal?.aborted, true)
  } finally {
    for (const read of reads) read.release()
  }
  assert.equal((await background).contextCompilation.status, 'ready')
  assert.equal(target.aiCalls(), 0)
})

test('uses the work-item model window and reserves instead of fixed context constants', async () => {
  const target = service('只读回答', [{
    id: 'workspace:chapter-outline', sourceType: 'workspace-prompt-section', sourceId: 'review:chapter-outline',
    label: '当前章节大纲', content: '必须保留的章纲。', authority: 'required', priority: 900, truncationPolicy: 'never'
  }], {
    version: 1, inputBudgetTokens: 60_000, modelContextLimit: 64_000, outputReservePercent: 30, recentSummaryCount: 4,
    systemReserveTokens: 6_000, structuredRepairAttempts: 1, pinnedEvidenceKeys: [], excludedEvidenceKeys: []
  })
  const preview = await target.agent.preview({ chapterId: 3, message: '核对本章', currentDraft: '', preferredSkill: 'query' })
  assert.equal(preview.status, 'ready')
  assert.equal(preview.tokenBudget, 38_800)
  assert.equal(preview.remainingTokens, 38_800 - preview.estimatedTokens)
})

test('rejects a preview bound to another selected book before compiling sources', async () => {
  const target = service('只读回答')
  await assert.rejects(
    target.agent.preview({ chapterId: 3, message: '核对本章', currentDraft: '', expectedWorkItemId: 'book-2' }),
    (error: { code?: string }) => error.code === 'CONFLICT'
  )
  assert.deepEqual(target.contextQuestions(), [])
  assert.equal(target.aiCalls(), 0)
})

test('writing preview propagates the source timeout stop signal without invoking a model', async () => {
  let aborted = false
  const ai = { modelFor: async () => 'synthetic-model' } as unknown as AiClient
  const projects = {
    currentSummary: async () => ({ id: 'book-1', path: 'C:\\books\\book-1' }),
    currentPath: async () => 'C:\\books\\book-1'
  } as unknown as ProjectService
  const workspace = {
    contextBudgetPreferences: async () => ({ version: 1, inputBudgetTokens: 32_000, modelContextLimit: 64_000, outputReservePercent: 25, systemReserveTokens: 8_000 }),
    currentChapterCardFingerprint: async () => 'chapter-card:test',
    promptContextCandidates: async (_chapter: number, _task: string, _options: unknown, signal: AbortSignal) =>
      new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(signal.reason) }, { once: true }))
  } as unknown as WorkspaceService
  const agent = new WritingAgentService(ai, projects, { chapter: async () => ({ id: 3 }) } as unknown as DocumentService,
    workspace, { draft: async () => { throw new Error('must not draft') } } as unknown as ChapterDraftService,
    new AgentToolRegistry({ compileContextSources: 15 }))
  await assert.rejects(agent.preview({ chapterId: 3, message: '预览', currentDraft: '', expectedWorkItemId: 'book-1' }),
    (error: { code?: string }) => error.code === 'FEATURE_UNAVAILABLE')
  assert.equal(aborted, true)
})

test('previews source groups and applies removal plus temporary context to the actual model input', async () => {
  const candidates = [{
    id: 'workspace:chapter-outline', sourceType: 'workspace-prompt-section', sourceId: 'review:chapter-outline',
    label: '当前章节大纲', content: '必须保留的章纲。', authority: 'required', priority: 900, truncationPolicy: 'never', relevanceReasons: ['任务必需']
  }, {
    id: 'workspace:timeline', sourceType: 'workspace-prompt-section', sourceId: 'review:timeline',
    label: '事件时间线', content: '本次作者决定移除的时间线。', authority: 'related', priority: 800, truncationPolicy: 'truncate', relevanceReasons: ['全局因果']
  }, {
    id: 'workspace:character-state', sourceType: 'workspace-prompt-section', sourceId: 'review:character-state',
    label: '章前人物状态', content: '沈砚仍在临江酒馆。', authority: 'related', priority: 820, truncationPolicy: 'truncate', relevanceReasons: ['人物连续性']
  }]
  const target = service('只读回答', candidates)
  const request = {
    chapterId: 3,
    message: '这一章的人物在哪里？',
    currentDraft: '当前正文。',
    preferredSkill: 'query' as const,
    contextSelection: {
      pinnedIds: ['workspace:character-state'],
      excludedIds: ['workspace:timeline'],
      temporaryAdditions: [{ id: 'temporary:note-1', label: '作者临时说明', content: '本次只考虑雨夜场景。' }]
    }
  }
  const preview = await target.agent.preview(request)
  assert.equal(preview.status, 'ready')
  assert.equal(preview.items.find((item) => item.id === 'workspace:timeline')?.included, false)
  assert.equal(preview.items.find((item) => item.id === 'workspace:timeline')?.exclusionReason, 'user_excluded')
  assert.equal(preview.items.find((item) => item.id === 'workspace:character-state')?.authority, 'pinned')
  assert.equal(preview.items.find((item) => item.id === 'temporary:note-1')?.included, true)

  await target.agent.run({ ...request, expectedContextHash: preview.contentHash })
  const actual = target.contextInputs()[0]
  assert.match(actual, /必须保留的章纲/)
  assert.match(actual, /沈砚仍在临江酒馆/)
  assert.match(actual, /本次只考虑雨夜场景/)
  assert.doesNotMatch(actual, /本次作者决定移除的时间线/)

  candidates[2].content = '沈砚已经离开临江酒馆。'
  await assert.rejects(
    target.agent.run({ ...request, expectedContextHash: preview.contentHash }),
    (error: { code?: string; message?: string }) => error.code === 'CONFLICT' && Boolean(error.message?.includes('重新核对'))
  )
  assert.equal(target.aiCalls(), 1)
})

test('writing agent resolves bounded writing skills from author language', () => {
  assert.equal(resolveWritingAgentSkill('把这段对白改写得更克制'), 'rewrite')
  assert.equal(resolveWritingAgentSkill('扩写这段，多加一点动作和吐槽'), 'expand')
  assert.equal(resolveWritingAgentSkill('压缩这一段，删掉重复解释'), 'compress')
  assert.equal(resolveWritingAgentSkill('帮我检查人物动机有没有冲突'), 'review')
  assert.equal(resolveWritingAgentSkill('李明为什么会在这里？'), 'query')
  assert.equal(resolveWritingAgentSkill('给三种冲突升级和结尾钩子'), 'plan')
  assert.equal(resolveWritingAgentSkill('接着写下一场'), 'continue')
  assert.equal(resolveWritingAgentSkill('把语气变得更像故作镇定，但不要改变两人的关系', undefined, true), 'custom')
  assert.equal(resolveWritingAgentSkill('把语气变得更像故作镇定，但不要改变两人的关系'), 'continue')
  assert.equal(resolveWritingAgentSkill('任意文字', 'polish'), 'polish')
})

test('freezes the fixed tool grant with the task and rejects a widened grant before model execution', async () => {
  const target = service('只读回答。')
  const request = { chapterId: 3, message: '这一章发生了什么？', currentDraft: '', preferredSkill: 'query' as const }
  const prepared = await target.agent.prepare(request)
  assert.equal(prepared.toolGrant.taskTemplate, 'writing-agent:query')
  assert.equal(prepared.toolGrant.workItemId, 'book-1')
  assert.equal(prepared.toolGrant.chapterId, 3)
  assert.ok(!prepared.toolGrant.allowedToolIds.includes('candidateDiff'))
  await assert.rejects(
    target.agent.run(request, undefined, {
      ...prepared,
      toolGrant: { ...prepared.toolGrant, allowedToolIds: [...prepared.toolGrant.allowedToolIds, 'candidateDiff'] }
    }),
    (error: { code?: string }) => error.code === 'DATABASE_INTEGRITY_FAILED'
  )
  assert.equal(target.aiCalls(), 0)
})

test('ordinary discussion stays read-only even in an empty chapter or with selected text', async () => {
  const message = '请讨论本章可以依据的已确认人物变化，不要生成正文。'
  for (const text of [message, '分析人物现在的处境', '聊聊人物关系', '商量一下人物的动机']) {
    assert.equal(resolveWritingAgentSkill(text), 'query')
    assert.equal(resolveWritingAgentSkill(text, undefined, true), 'query')
  }
  assert.equal(resolveWritingAgentSkill('讨论后续走向和冲突升级'), 'plan')
  assert.equal(resolveWritingAgentSkill('讨论一下', 'continue'), 'continue')
  const target = service('只读的人物变化讨论。')
  const turn = await target.agent.run({ chapterId: 3, message, currentDraft: '' })
  assert.equal(turn.skill.id, 'query')
  assert.equal(turn.candidate, undefined)
  assert.equal(turn.answer, '只读的人物变化讨论。')
  assert.equal(target.aiCalls(), 1)
  assert.deepEqual(target.draftInstructions(), [])
})

test('retrospective questions distinguish missing evidence from contradictions without creating prose', async () => {
  const target = service('在当前提供的前文中未找到借数学笔记的依据。')
  const turn = await target.agent.run({
    chapterId: 3, message: '前文是否写过借我参考数学笔记的恩情？',
    currentDraft: '你借我数学笔记的恩情，我还没报答。'
  })
  assert.equal(turn.candidate, undefined)
  assert.equal(target.aiCalls(), 1)
  assert.deepEqual(target.draftInstructions(), [])
  assert.match(target.instructions()[0], /前后直接矛盾/)
  assert.match(target.instructions()[0], /未找到依据不等于断言从未发生/)
  assert.match(target.instructions()[0], /不用候选自己的声称作佐证/)
  assert.deepEqual(target.contextQuestions(), ['前文是否写过借我参考数学笔记的恩情？'])
  assert.deepEqual(target.factQuestions(), target.contextQuestions())
  assert.match(target.instructions()[0], /本次检索未找到足够依据/)
})

test('unselected and selected Chinese questions route to one read-only answer', async () => {
  for (const message of ['之前真的借过数学笔记吗', '前文有没有借笔记的情节', '这句是不是有依据', '这是谁在第几章说的？', '这句话的依据？']) {
    for (const selected of [false, true]) {
      const target = service('未找到足够依据。')
      const currentDraft = '借我参考数学笔记的恩情。'
      const turn = await target.agent.run({ chapterId: 3, message, currentDraft,
        ...(selected ? { selection: { start: 0, end: currentDraft.length, text: currentDraft } } : {}) })
      assert.equal(turn.skill.id, 'query')
      assert.equal(turn.candidate, undefined)
      assert.equal(target.aiCalls(), 1)
      assert.deepEqual(target.draftInstructions(), [])
      assert.equal(target.contextQuestions()[0], selected ? message + '\n' + currentDraft : message)
      if (selected) assert.ok(target.instructions()[0].includes(currentDraft))
    }
  }
  assert.equal(resolveWritingAgentSkill('有没有借笔记？', 'continue'), 'continue')
  assert.equal(resolveWritingAgentSkill('为什么要改写这段？', undefined, true), 'query')
  assert.equal(resolveWritingAgentSkill('前文有没有说过“改写命运”这句话？', undefined, true), 'query')
  assert.equal(resolveWritingAgentSkill('请改写这句，能更自然吗？', undefined, true), 'rewrite')
})

test('selection edits preserve past events and ownership without adding a review request', async () => {
  for (const preferredSkill of ['rewrite', 'polish', 'expand', 'compress', 'custom'] as const) {
    const target = service('同桌一场，这点忙我还是能帮的。')
    const currentDraft = '同桌一场，我帮你。'
    const turn = await target.agent.run({
      chapterId: 3, message: '保留吐槽和眼前情节', currentDraft, preferredSkill,
      selection: { start: 0, end: currentDraft.length, text: currentDraft }
    })
    assert.equal(turn.candidate?.mode, 'replaceSelection')
    assert.equal(target.aiCalls(), 1)
    assert.match(target.instructions()[0], /谁借给谁、物品最后在谁手里/)
    assert.match(target.instructions()[0], /不为凑对白或解释亲近、恩情而凭空补旧事/)
    assert.match(target.instructions()[0], /保留自然对白、梗、笑话和吐槽/)
  }
})

test('expand and compress keep distinct selection-writing contracts', async () => {
  const expanded = service('扩写后的正文。')
  const expandTurn = await expanded.agent.run({
    chapterId: 3,
    message: '补充动作、对白和人物吐槽',
    currentDraft: '他推门。',
    preferredSkill: 'expand',
    selection: { start: 0, end: 4, text: '他推门。' }
  })
  assert.equal(expandTurn.skill.id, 'expand')
  assert.equal(expandTurn.candidate?.mode, 'replaceSelection')
  assert.match(expanded.instructions()[0], /明显扩充篇幅/)
  assert.match(expanded.instructions()[0], /不得擅自新增关键设定/)

  const compressed = service('他推门。')
  const compressTurn = await compressed.agent.run({
    chapterId: 3,
    message: '删掉重复说明，但保留笑点',
    currentDraft: '他反复解释了很久，最后终于推门。',
    preferredSkill: 'compress',
    selection: { start: 0, end: 17, text: '他反复解释了很久，最后终于推门。' }
  })
  assert.equal(compressTurn.skill.id, 'compress')
  assert.equal(compressTurn.candidate?.mode, 'replaceSelection')
  assert.match(compressed.instructions()[0], /明显缩短篇幅/)
  assert.match(compressed.instructions()[0], /必须保留.*笑点/)
})

test('custom selection instruction stays bounded to the author goal and returns a reviewable diff', async () => {
  const target = service('他耸了耸肩，仿佛迟到的不是自己。')
  const turn = await target.agent.run({
    chapterId: 3,
    message: '改成故作镇定的语气，但禁止改变迟到这个事实和人物关系',
    currentDraft: '他迟到了，却没有解释。',
    selection: { start: 0, end: 11, text: '他迟到了，却没有解释。' }
  })
  assert.equal(turn.skill.id, 'custom')
  assert.equal(turn.skill.label, '自定义选段')
  assert.equal(turn.candidate?.mode, 'replaceSelection')
  assert.equal(turn.candidate?.selection?.text, '他迟到了，却没有解释。')
  assert.match(target.instructions()[0], /故作镇定的语气/)
  assert.match(target.instructions()[0], /禁止改变迟到这个事实和人物关系/)
  assert.match(target.instructions()[0], /除作者明确要求改变的内容外/)
  assert.ok(turn.candidate?.diff?.length)
})

test('parses bounded chapter-card alternatives as candidates instead of formal changes', () => {
  const parsed = parseChapterCardDiscussion(JSON.stringify({
    answer: '三个方案分别偏向误会、外部阻力和关系转折。',
    options: [
      { title: '窗口误会', rationale: '让对白承担笑点和推进。', conflict: '表格栏目无法容纳真实关系', beats: ['先误填', '互相甩锅', '找到折中项'], hook: '工作人员拿出另一张更离谱的表。' },
      { title: '熟人闯入', rationale: '用人物反应改变场面。', characters: ['周文衡', '陈景安'], exitChange: '两人被迫统一口径。' }
    ]
  }))
  assert.equal(parsed.options.length, 2)
  assert.equal(parsed.options[0].id, 'card-option-1')
  assert.deepEqual(parsed.options[0].beats, ['先误填', '互相甩锅', '找到折中项'])
  assert.equal(parsed.options[1].goal, undefined)
  assert.throws(() => parseChapterCardDiscussion('{"answer":"空方案","options":[{"title":"A","rationale":"B"}]}'), (error: { code?: string }) => error.code === 'AI_RESPONSE_INVALID')
})

test('chapter planning discussion uses the chapter-outline model and returns adoptable card options only', async () => {
  const target = service(JSON.stringify({
    answer: '保留两个不同方向。',
    options: [{ title: '对白误会', rationale: '适合轻喜剧节奏。', conflict: '双方对同一个栏目理解相反', beats: ['误填', '吐槽', '改正'] }]
  }))
  const turn = await target.agent.run({ chapterId: 3, message: '讨论三种冲突升级', currentDraft: '当前正文。', preferredSkill: 'plan', model: 'planning-model' })
  assert.equal(turn.skill.id, 'plan')
  assert.equal(turn.candidate, undefined)
  assert.equal(turn.chapterCardOptions?.[0].title, '对白误会')
  assert.equal(turn.chapterCardOptions?.[0].conflict, '双方对同一个栏目理解相反')
  assert.deepEqual(target.modelOverrides(), ['planning-model'])
})

test('rewrite without a selection asks for a selection and performs no model call', async () => {
  const target = service()
  const turn = await target.agent.run({ chapterId: 3, message: '改写得更克制', currentDraft: '原文', preferredSkill: 'rewrite' })
  assert.equal(turn.skill.id, 'rewrite')
  assert.equal(turn.candidate, undefined)
  assert.match(turn.answer, /先在正文编辑器中选中/)
  assert.equal(target.aiCalls(), 0)
})

test('explicit custom selection task without a selection does not touch the whole chapter', async () => {
  const target = service()
  const turn = await target.agent.run({ chapterId: 3, message: '变得更荒诞，但不要改事实', currentDraft: '整章正文', preferredSkill: 'custom' })
  assert.equal(turn.skill.id, 'custom')
  assert.equal(turn.candidate, undefined)
  assert.match(turn.answer, /先在正文编辑器中选中/)
  assert.equal(target.aiCalls(), 0)
})

test('selected rewrite returns a replace-only candidate bound to the exact draft', async () => {
  const target = service('```text\n更克制的对白。\n```')
  const turn = await target.agent.run({
    chapterId: 3,
    message: '把对白写得更克制',
    currentDraft: '他说：“我一定会回来。”',
    model: 'author-choice-model',
    modelConnectionId: 'author-gpt',
    preferredSkill: 'rewrite',
    selection: { start: 3, end: 12, text: '“我一定会回来。”' }
  })
  assert.equal(turn.candidate?.mode, 'replaceSelection')
  assert.equal(turn.model, 'author-choice-model')
  assert.deepEqual(target.modelOverrides(), ['author-choice-model'])
  assert.deepEqual(target.connectionOverrides(), ['author-gpt'])
  assert.equal(turn.candidate?.content, '更克制的对白。')
  assert.deepEqual(turn.candidate?.diff, [{ id: 'diff-1', kind: 'change', before: '“我一定会回来。”', after: '更克制的对白。' }])
  assert.equal(turn.candidate?.baseDraftFingerprint.length, 64)
  assert.equal(turn.tools.map((item) => item.id).join(','), 'currentChapter,chapterContract,contextFacts,consistencyGate')
})

test('continue keeps the selected model and provider together through chapter drafting', async () => {
  const target = service()
  const turn = await target.agent.run({ chapterId: 3, message: '按章纲继续写', currentDraft: '开头。', model: 'chapter-agent-model', modelConnectionId: 'gemini-prose' })
  assert.equal(turn.skill.id, 'continue')
  assert.equal(turn.proposal, proposal)
  assert.equal(turn.candidate?.mode, 'append')
  assert.equal(turn.model, 'chapter-agent-model')
  assert.deepEqual(target.draftModelOverrides(), ['chapter-agent-model'])
  assert.deepEqual(target.draftConnectionOverrides(), ['gemini-prose'])
  assert.equal(target.agent.proposal(turn.id)?.proposal, proposal)
  target.agent.forget(turn.id)
  assert.equal(target.agent.proposal(turn.id), undefined)
})

test('continue at a frozen cursor returns an insertion diff instead of appending to the chapter end', async () => {
  const target = service()
  const turn = await target.agent.run({
    chapterId: 3,
    message: '从这里接着写一小段',
    currentDraft: '第一段结束。\n\n原有后文。',
    preferredSkill: 'continue',
    insertionAnchor: { offset: 6, before: '第一段结束。', after: '\n\n原有后文。' }
  })
  assert.equal(turn.candidate?.mode, 'insertAtAnchor')
  assert.equal(turn.candidate?.insertionAnchor?.offset, 6)
  assert.deepEqual(turn.candidate?.diff, [{ id: 'diff-1', kind: 'change', before: '', after: '雨声渐近。' }])
  assert.match(turn.answer, /第 6 字后的锚点/)
  assert.match(target.draftInstructions()[0], /作者光标所在位置/)
  assert.match(target.draftInstructions()[0], /不改写锚点之后的现有正文/)
})


test('local context uses measured capacity and binds one-off output changes to preview', async()=>{
  const target=service('回答',[{id:'required',sourceType:'workspace-prompt-section',sourceId:'outline',label:'必需章纲',content:'档案员雨夜清点信件。',authority:'required',truncationPolicy:'never'}])
  target.ai.contextLimits=async(_task,_model,_connection,maxTokensOverride)=>({contextTokens:8192,systemReserveTokens:512,maxOutputTokens:4096,recommendedOutputTokens:2048,outputTokens:maxTokensOverride??2048,profile:{connectionId:'local:llama-cpp',model:'qwen3-1.7b-q8_0',temperature:.7,topP:.9,maxTokens:maxTokensOverride??2048}})
  const input={chapterId:3,message:'分析事件',currentDraft:'',model:'qwen3-1.7b-q8_0',modelConnectionId:'local:llama-cpp',maxTokensOverride:2048,preferredSkill:'query' as const}
  const prepared=await target.agent.prepare(input)
  assert.equal(prepared.contextCompilation.budget.availableInputTokens,5632)
  assert.equal(prepared.contextCompilation.status,'ready')
  await assert.rejects(target.agent.prepare({...input,maxTokensOverride:1024,expectedContextHash:prepared.contextCompilation.contentHash}),/重新核对/)
})

test('remote context uses captured model capacity and effective output without becoming a local route', async () => {
  const target = service('unused', [{ id: 'required', sourceType: 'workspace-prompt-section', sourceId: 'outline', label: '必需章纲', content: '档案员雨夜清点信件。', authority: 'required', truncationPolicy: 'never' }])
  let output = 4096
  target.ai.generationFor = async task => compileGeneration({ connectionId: 'remote', model: 'alias', parameterPolicy: { version: 1, mode: 'custom', overrides: { maxTokens: output } } }, task,
    { protocol: 'gemini-native', model: 'alias', metadata: { id: 'alias', inputTokenLimit: 32768, outputTokenLimit: 8192 } })
  const input = { chapterId: 3, message: '分析事件', currentDraft: '', preferredSkill: 'query' as const }
  const prepared = await target.agent.prepare(input)
  assert.equal(prepared.contextCompilation.budget.availableInputTokens, 32768 - 4096 - 10000)
  assert.equal(prepared.localProfile, undefined)
  output = 8192
  await assert.rejects(target.agent.prepare({ ...input, expectedContextHash: prepared.contextCompilation.contentHash }), { code: 'CONFLICT' })
  assert.equal(target.aiCalls(), 0)
})

test('local continuation budgets the review candidate before dispatch and binds the reserve to preview', async () => {
  const target = service('unused', [{ id: 'required', sourceType: 'workspace-prompt-section', sourceId: 'outline', label: '必需章纲', content: '必须保留的设定', authority: 'required', truncationPolicy: 'never' }])
  target.ai.contextLimits = async () => ({ contextTokens: 10240, systemReserveTokens: 512, maxOutputTokens: 4096, recommendedOutputTokens: 2048, outputTokens: 2048, profile: { connectionId: 'local:llama-cpp', model: 'qwen3-1.7b-q8_0', temperature: .7, topP: .9, maxTokens: 2048 } })
  const calls: unknown[] = []
  target.chapterDrafts.reviewInputReserve = async (...args) => { calls.push(args); return 3000 + args[1].length }
  const input = { chapterId: 3, message: '完成本章', currentDraft: '已有正文', preferredSkill: 'continue' as const }
  const prepared = await target.agent.prepare(input)
  assert.deepEqual((calls[0] as unknown[]).slice(0, 3), [3, '已有正文', 2048])
  assert.equal(prepared.contextCompilation.budget.availableInputTokens, 4676)
  assert.ok(prepared.contexts.some(item => item.sourceType === 'creative-policy'), 'the method input also consumes the selected model budget')
  await assert.rejects(target.agent.prepare({ ...input, currentDraft: '已有正文更多内容', expectedContextHash: prepared.contextCompilation.contentHash }), /重新核对/)
  target.chapterDrafts.reviewInputReserve = async () => 5700
  const preview = await target.agent.preview(input)
  assert.equal(preview.status, 'blocked')
  assert.match(preview.blockedMessage!, /完整审校/)
  await assert.rejects(target.agent.run(input), { code: 'VALIDATION_ERROR' })
  assert.equal(target.aiCalls(), 0)
  assert.equal(target.draftInstructions().length, 0, 'reject before starting expensive prose generation')
})

test('local prose with a separately routed remote reviewer keeps its prose capacity', async () => {
  const target = service('unused')
  target.ai.contextLimits = async (task, model) => {
    if (task === 'review') { assert.equal(model, undefined); return undefined }
    return { contextTokens: 8192, systemReserveTokens: 512, maxOutputTokens: 4096, recommendedOutputTokens: 2048, outputTokens: 2048, profile: { connectionId: 'local:llama-cpp', model: 'qwen3-1.7b-q8_0', temperature: .7, topP: .9, maxTokens: 2048 } }
  }
  target.chapterDrafts.reviewInputReserve = async () => { assert.fail('remote review must not consume the local window') }
  const prepared = await target.agent.prepare({ chapterId: 3, message: '完成本章', currentDraft: '', preferredSkill: 'continue' })
  assert.equal(prepared.contextCompilation.budget.availableInputTokens, 5632)
})

test('remote prose reserves its captured output for local review and rejects before dispatch', async () => {
  const target = service('unused', [{ id: 'required', sourceType: 'workspace-prompt-section', sourceId: 'outline', label: '章纲', content: '档案员在钟楼寻找证据。', authority: 'required', truncationPolicy: 'never' }])
  target.ai.contextLimits = async (task, model) => {
    if (task !== 'review') return undefined
    assert.equal(model, undefined, 'do not route the remote prose model into local review')
    return { contextTokens: 10240, systemReserveTokens: 512, maxOutputTokens: 4096, recommendedOutputTokens: 2048, outputTokens: 1024, profile: { connectionId: 'local:llama-cpp', model: 'qwen3-1.7b-q8_0', temperature: .7, topP: .9, maxTokens: 1024 } }
  }
  let proseOutput = 2048
  target.ai.outputTokensFor = async (task) => { assert.equal(task, 'prose'); return proseOutput }
  const reservations: unknown[] = []
  target.chapterDrafts.reviewInputReserve = async (...args) => { reservations.push(args); return 800 + args[1].length + args[2] }
  const input = { chapterId: 3, message: '完成本章', currentDraft: '已有正文', preferredSkill: 'continue' as const }
  const prepared = await target.agent.prepare(input)
  assert.deepEqual((reservations[0] as unknown[]).slice(0, 3), [3, '已有正文', 2048])
  assert.equal(prepared.localProfile, undefined, 'keep the remote prose route')
  assert.equal(prepared.contextCompilation.budget.availableInputTokens, 5852)
  proseOutput = 3072
  await assert.rejects(target.agent.prepare({ ...input, expectedContextHash: prepared.contextCompilation.contentHash }), { code: 'CONFLICT' })
  proseOutput = 8192
  const preview = await target.agent.preview(input)
  assert.equal(preview.status, 'blocked')
  assert.match(preview.blockedMessage!, /本机审校模型/)
  await assert.rejects(target.agent.run(input), { code: 'VALIDATION_ERROR' })
  assert.equal(target.aiCalls(), 0)
  assert.equal(target.draftInstructions().length, 0)
})
