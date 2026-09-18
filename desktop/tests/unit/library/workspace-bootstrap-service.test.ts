import assert from 'node:assert/strict'
import test from 'node:test'
import { AppError } from '../../../src/main/core/errors/app-error'
import type { ProjectSummary } from '../../../src/contracts/index'
import { WorkspaceBootstrapService, type WorkspaceBootstrapDependencies } from '../../../src/main/modules/library/application/workspace-bootstrap-service'

const summaryA: ProjectSummary = {
  id: 'book-a', name: 'book-a', path: 'E:\\books\\a', title: '甲书', genre: '轻小说', updated_at: '2026-08-29T00:00:00.000Z',
  manuscript: { chapterCount: 0, fileCount: 0, wordCount: 0, status: 'ready' }
}

test('unavailable model authority is visible without hiding readable manuscripts', async () => {
  const dependencies = {
    projects: { currentPath: async () => summaryA.path, currentSummary: async () => summaryA, migrationPreview: async () => ({}) },
    documents: { chapters: async () => [{ id: 1, content: '正文仍可读写' }], outlines: async () => ({ total: null, volumes: [] }) },
    workspace: { timeline: async () => ({ events: [] }), realms: async () => ({ levels: [] }), powerSystem: async () => ({}), cheatSystem: async () => ({}), systemTemplate: async () => ({ template: '' }), foundation: async () => ({}), bookProfile: async () => ({}), promptProfile: async () => ({}) },
    aiSettings: async () => { throw new AppError('STORAGE_ERROR', 'synthetic private diagnostic must not leak') },
    researchSettings: async () => ({}), researchLibrary: { listSources: async () => ({ sources: [] }), listEvents: async () => ({ events: [] }) },
    planningDraft: async () => null, importRecoveries: async () => [], continuation: async () => ({ candidate: null })
  } as unknown as WorkspaceBootstrapDependencies
  const result = await new WorkspaceBootstrapService(dependencies).load()
  assert.equal(result.aiSettings, null); assert.equal(result.chapters[0].content, '正文仍可读写')
  assert.equal(result.issues[0].id, 'modelSettingsUnreadable')
  assert.doesNotMatch(JSON.stringify(result), /synthetic private diagnostic/)
})

test('loads the opening workspace through one call to every provider and reuses the book profile', async () => {
  const calls = new Map<string, number>()
  const profile = { genre: '轻小说', subgenre: '校园喜剧', coreIdea: '测试', plannedVolumes: 1, chaptersPerVolume: 10, targetWordsPerChapter: 3000 }
  let promptInput: unknown
  const tracked = <T>(name: string, value: T): (() => Promise<T>) => async () => {
    calls.set(name, (calls.get(name) || 0) + 1)
    return value
  }
  const dependencies = {
    projects: {
      currentPath: tracked('currentPath', summaryA.path),
      currentSummary: tracked('currentSummary', summaryA),
      migrationPreview: tracked('migration', {})
    },
    documents: {
      chapters: tracked('chapters', []),
      outlines: tracked('outlines', { total: null, volumes: [] })
    },
    workspace: {
      timeline: tracked('timeline', { events: [] }),
      realms: tracked('realms', { levels: [] }),
      powerSystem: tracked('powerSystem', {}),
      cheatSystem: tracked('cheatSystem', {}),
      systemTemplate: tracked('systemTemplate', { template: '' }),
      foundation: tracked('foundation', {}),
      bookProfile: async (summary?: ProjectSummary) => {
        calls.set('bookProfile', (calls.get('bookProfile') || 0) + 1)
        assert.equal(summary, summaryA)
        return profile
      },
      promptProfile: async (provided: unknown) => {
        calls.set('promptProfile', (calls.get('promptProfile') || 0) + 1)
        promptInput = provided
        return { version: 1, workItemId: summaryA.id, entries: [] }
      }
    },
    aiSettings: tracked('aiSettings', {}),
    researchSettings: tracked('researchSettings', {}),
    researchLibrary: {
      listSources: tracked('sources', { sources: [] }),
      listEvents: tracked('events', { events: [] })
    },
    planningDraft: tracked('planningDraft', null),
    importRecoveries: tracked('importRecoveries', []),
    continuation: tracked('continuation', { candidate: null })
  } as unknown as WorkspaceBootstrapDependencies

  const result = await new WorkspaceBootstrapService(dependencies).load()

  assert.deepEqual(result.workItem, { id: summaryA.id, path: summaryA.path })
  assert.deepEqual(result.issues, [])
  assert.equal(calls.get('bookProfile'), 1)
  assert.equal(calls.get('promptProfile'), 1)
  assert.deepEqual(promptInput, { profile, summary: summaryA })
  for (const name of [
    'chapters', 'outlines', 'timeline', 'realms', 'powerSystem', 'cheatSystem', 'systemTemplate', 'foundation',
    'aiSettings', 'researchSettings', 'migration', 'sources', 'events', 'planningDraft', 'importRecoveries', 'continuation'
  ]) assert.equal(calls.get(name), 1, `${name} should be read once`)
  assert.equal(calls.get('currentPath'), 4)
  assert.equal(calls.get('currentSummary'), 2)
})

test('keeps the formal workspace readable when only the automatic planning candidate is damaged', async () => {
  const dependencies = {
    projects: {
      currentPath: async () => summaryA.path,
      currentSummary: async () => summaryA,
      migrationPreview: async () => ({})
    },
    documents: {
      chapters: async () => [{ id: 1, title: '第一章', content: '正文仍可读取', word_count: 6 }],
      outlines: async () => ({ total: { title: '总纲', content: '正式总纲仍可读取' }, volumes: [] })
    },
    workspace: {
      timeline: async () => ({ events: [] }), realms: async () => ({ levels: [] }), powerSystem: async () => ({}),
      cheatSystem: async () => ({}), systemTemplate: async () => ({ template: '' }), foundation: async () => ({}),
      bookProfile: async () => ({}), promptProfile: async () => ({})
    },
    aiSettings: async () => ({}), researchSettings: async () => ({}),
    researchLibrary: { listSources: async () => ({ sources: [] }), listEvents: async () => ({ events: [] }) },
    planningDraft: async () => { throw new AppError('INVALID_PROJECT_STATE', '自动谋篇候选文件无法解析。') },
    importRecoveries: async () => [], continuation: async () => ({ candidate: null })
  } as unknown as WorkspaceBootstrapDependencies

  const result = await new WorkspaceBootstrapService(dependencies).load()

  assert.equal(result.planningDraft, null)
  assert.equal(result.chapters[0]?.content, '正文仍可读取')
  assert.equal(result.outlines.total?.content, '正式总纲仍可读取')
  assert.deepEqual(result.issues, [{
    id: 'planningDraftUnreadable',
    area: 'planningDraft',
    title: '自动谋篇候选需要修复',
    message: '自动谋篇候选文件无法解析。',
    recovery: 'quarantinePlanningDraft'
  }])
})

test('falls back to a visible built-in prompt projection when the stored per-book prompt is damaged', async () => {
  const builtIn = { version: 1, workItemId: summaryA.id, genreLabel: '轻小说 / 校园喜剧', genreFingerprint: 'a', storedGenreFingerprint: 'a', baselineChanged: false, entries: [] }
  let builtInInput: unknown
  const dependencies = {
    projects: { currentPath: async () => summaryA.path, currentSummary: async () => summaryA, migrationPreview: async () => ({}) },
    documents: {
      chapters: async () => [{ id: 1, title: '第一章', content: '正文仍可读取', word_count: 6 }],
      outlines: async () => ({ total: { title: '总纲', content: '正式总纲仍可读取' }, volumes: [] })
    },
    workspace: {
      timeline: async () => ({ events: [] }), realms: async () => ({ levels: [] }), powerSystem: async () => ({}),
      cheatSystem: async () => ({}), systemTemplate: async () => ({ template: '' }), foundation: async () => ({}),
      bookProfile: async () => ({ genre: '轻小说', subgenre: '校园喜剧' }),
      promptProfile: async () => { throw new AppError('INVALID_PROJECT_STATE', '本书提示词文件已损坏；为保护设置，应用不会覆盖它。') },
      builtInPromptProfile: async (provided: unknown) => { builtInInput = provided; return builtIn }
    },
    aiSettings: async () => ({}), researchSettings: async () => ({}),
    researchLibrary: { listSources: async () => ({ sources: [] }), listEvents: async () => ({ events: [] }) },
    planningDraft: async () => null, importRecoveries: async () => [], continuation: async () => ({ candidate: null })
  } as unknown as WorkspaceBootstrapDependencies

  const result = await new WorkspaceBootstrapService(dependencies).load()

  assert.equal(result.promptProfile, builtIn)
  assert.equal(result.chapters[0]?.content, '正文仍可读取')
  assert.equal(result.outlines.total?.content, '正式总纲仍可读取')
  assert.equal((builtInInput as { summary?: ProjectSummary }).summary, summaryA)
  assert.deepEqual(result.issues, [{
    id: 'promptProfileUnreadable', area: 'promptProfile', title: '本书自定义提示词需要修复',
    message: '本书提示词文件已损坏；为保护设置，应用不会覆盖它。', recovery: 'quarantinePromptProfile'
  }])
})

test('keeps formal writing readable but marks the material library locked when the source ledger is damaged', async () => {
  let eventReads = 0
  const dependencies = {
    projects: { currentPath: async () => summaryA.path, currentSummary: async () => summaryA, migrationPreview: async () => ({}) },
    documents: {
      chapters: async () => [{ id: 1, position: 1, title: '第一章', content: '正文仍可读取', word_count: 6, summary: '' }],
      outlines: async () => ({ total: { content: '正式总纲仍可读取' }, volumes: [] })
    },
    workspace: {
      timeline: async () => ({ events: [] }), realms: async () => ({ levels: [] }), powerSystem: async () => ({}),
      cheatSystem: async () => ({}), systemTemplate: async () => ({ template: '' }), foundation: async () => ({}),
      bookProfile: async () => ({}), promptProfile: async () => ({}), builtInPromptProfile: async () => ({})
    },
    aiSettings: async () => ({}), researchSettings: async () => ({}),
    researchLibrary: {
      listSources: async () => { throw new AppError('INVALID_PROJECT_STATE', '素材来源账本已损坏；为保护资料，应用不会覆盖它。') },
      listEvents: async () => { eventReads += 1; return { events: [{ id: 'event-1', event: '正式事件仍可读取' }] } }
    },
    planningDraft: async () => null, importRecoveries: async () => [], continuation: async () => ({ candidate: null })
  } as unknown as WorkspaceBootstrapDependencies

  const result = await new WorkspaceBootstrapService(dependencies).load()

  assert.equal(result.chapters[0]?.content, '正文仍可读取')
  assert.equal(result.outlines.total?.content, '正式总纲仍可读取')
  assert.deepEqual(result.sources, { sources: [] })
  assert.equal(result.events.events[0]?.event, '正式事件仍可读取')
  assert.equal(eventReads, 1)
  assert.deepEqual(result.issues, [{
    id: 'researchSourcesUnreadable', area: 'researchSources', title: '素材来源账本需要人工核对',
    message: '素材来源账本已损坏；为保护资料，应用不会覆盖它。', recovery: 'manualReview'
  }])
})

test('keeps chapters and direct chronicles readable but marks the formal event ledger locked when it is damaged', async () => {
  const directEvent = { id: 'direct-1', time: '第一日', characters: '作者', location: '书房', event: '直接纪事仍可读取' }
  const dependencies = {
    projects: { currentPath: async () => summaryA.path, currentSummary: async () => summaryA, migrationPreview: async () => ({}) },
    documents: {
      chapters: async () => [{ id: 1, position: 1, title: '第一章', content: '正文仍可读取', word_count: 6, summary: '' }],
      outlines: async () => ({ total: { content: '正式总纲仍可读取' }, volumes: [] })
    },
    workspace: {
      timeline: async () => ({ events: [directEvent] }), realms: async () => ({ levels: [] }), powerSystem: async () => ({}),
      cheatSystem: async () => ({}), systemTemplate: async () => ({ template: '' }), foundation: async () => ({}),
      bookProfile: async () => ({}), promptProfile: async () => ({}), builtInPromptProfile: async () => ({})
    },
    aiSettings: async () => ({}), researchSettings: async () => ({}),
    researchLibrary: {
      listSources: async () => ({ sources: [] }),
      listEvents: async () => { throw new AppError('INVALID_PROJECT_STATE', '本书正式事件账本已损坏；为保护候选与正式事实，应用不会覆盖它。') }
    },
    planningDraft: async () => null, importRecoveries: async () => [], continuation: async () => ({ candidate: null })
  } as unknown as WorkspaceBootstrapDependencies

  const result = await new WorkspaceBootstrapService(dependencies).load()

  assert.equal(result.chapters[0]?.content, '正文仍可读取')
  assert.equal(result.outlines.total?.content, '正式总纲仍可读取')
  assert.deepEqual(result.timeline.events, [directEvent])
  assert.deepEqual(result.events, { events: [] })
  assert.deepEqual(result.issues, [{
    id: 'researchEventsUnreadable', area: 'researchEvents', title: '正式事件账本需要人工核对',
    message: '本书正式事件账本已损坏；为保护候选与正式事实，应用不会覆盖它。', recovery: 'manualReview'
  }])
})

test('keeps manuscript and outline text readable but marks a damaged outline version ledger locked', async () => {
  const dependencies = {
    projects: { currentPath: async () => summaryA.path, currentSummary: async () => summaryA, migrationPreview: async () => ({}) },
    documents: {
      chapters: async () => [{ id: 1, position: 1, title: '第一章', content: '正文仍可读取', word_count: 6, summary: '' }],
      outlines: async () => ({ total: { content: '总纲原文仍可读取' }, volumes: [{ volume: 1, content: '卷纲原文仍可读取' }] })
    },
    workspace: {
      timeline: async () => ({ events: [] }), realms: async () => ({ levels: [] }), powerSystem: async () => ({}),
      cheatSystem: async () => ({}), systemTemplate: async () => ({ template: '' }), foundation: async () => ({}),
      bookProfile: async () => ({}), promptProfile: async () => ({}), builtInPromptProfile: async () => ({})
    },
    outlinePlanning: {
      validateLedger: async () => { throw new AppError('INVALID_PROJECT_STATE', '大纲版本账本结构无效，已停止写入以保护现有总纲与章纲。') }
    },
    aiSettings: async () => ({}), researchSettings: async () => ({}),
    researchLibrary: { listSources: async () => ({ sources: [] }), listEvents: async () => ({ events: [] }) },
    planningDraft: async () => null, importRecoveries: async () => [], continuation: async () => ({ candidate: null })
  } as unknown as WorkspaceBootstrapDependencies

  const result = await new WorkspaceBootstrapService(dependencies).load()

  assert.equal(result.chapters[0]?.content, '正文仍可读取')
  assert.equal(result.outlines.total?.content, '总纲原文仍可读取')
  assert.equal(result.outlines.volumes[0]?.content, '卷纲原文仍可读取')
  assert.deepEqual(result.issues, [{
    id: 'outlinePlanningUnreadable', area: 'outlinePlanning', title: '大纲版本账本需要人工核对',
    message: '大纲版本账本结构无效，已停止写入以保护现有总纲与章纲。', recovery: 'manualReview'
  }])
})

test('keeps manuscript readable but marks a damaged character state ledger locked', async () => {
  const dependencies = {
    projects: { currentPath: async () => summaryA.path, currentSummary: async () => summaryA, migrationPreview: async () => ({}) },
    documents: {
      chapters: async () => [{ id: 1, position: 1, title: '第一章', content: '正文仍可读取', word_count: 6, summary: '' }],
      outlines: async () => ({ total: { content: '总纲仍可读取' }, volumes: [] })
    },
    workspace: {
      timeline: async () => ({ events: [] }), realms: async () => ({ levels: [] }), powerSystem: async () => ({}),
      cheatSystem: async () => ({}), systemTemplate: async () => ({ template: '' }), foundation: async () => ({}),
      bookProfile: async () => ({}), promptProfile: async () => ({}), builtInPromptProfile: async () => ({} )
    },
    characterStates: {
      validateLedger: async () => { throw new AppError('INVALID_PROJECT_STATE', '人物状态账本结构无效，已停止写入以保护人物锚点与正文证据。') }
    },
    aiSettings: async () => ({}), researchSettings: async () => ({}),
    researchLibrary: { listSources: async () => ({ sources: [] }), listEvents: async () => ({ events: [] }) },
    planningDraft: async () => null, importRecoveries: async () => [], continuation: async () => ({ candidate: null })
  } as unknown as WorkspaceBootstrapDependencies

  const result = await new WorkspaceBootstrapService(dependencies).load()

  assert.equal(result.chapters[0]?.content, '正文仍可读取')
  assert.equal(result.outlines.total?.content, '总纲仍可读取')
  assert.deepEqual(result.issues, [{
    id: 'characterStateUnreadable', area: 'characterState', title: '人物状态账本需要人工核对',
    message: '人物状态账本结构无效，已停止写入以保护人物锚点与正文证据。', recovery: 'manualReview'
  }])
})

test('returns an unsequenced read-only manuscript inventory when the chapter order ledger is damaged', async () => {
  let strictReads = 0
  let inventoryReads = 0
  const dependencies = {
    projects: { currentPath: async () => summaryA.path, currentSummary: async () => summaryA, migrationPreview: async () => ({}) },
    documents: {
      chapters: async () => {
        strictReads += 1
        throw new AppError('INVALID_PROJECT_STATE', '章节顺序文件损坏，未对稿件执行任何改动', { details: { area: 'chapterOrder' } })
      },
      unsequencedChapters: async () => { inventoryReads += 1; return [{ id: 7, position: 1, title: '独立正文', content: '正文文件仍可只读核对', word_count: 12, summary: '' }] },
      outlines: async () => ({ total: { content: '总纲仍可读取' }, volumes: [] })
    },
    workspace: {
      timeline: async () => ({ events: [] }), realms: async () => ({ levels: [] }), powerSystem: async () => ({}),
      cheatSystem: async () => ({}), systemTemplate: async () => ({ template: '' }), foundation: async () => ({}),
      bookProfile: async () => ({}), promptProfile: async () => ({}), builtInPromptProfile: async () => ({})
    },
    aiSettings: async () => ({}), researchSettings: async () => ({}),
    researchLibrary: { listSources: async () => ({ sources: [] }), listEvents: async () => ({ events: [] }) },
    planningDraft: async () => null, importRecoveries: async () => [], continuation: async () => ({ candidate: null })
  } as unknown as WorkspaceBootstrapDependencies

  const result = await new WorkspaceBootstrapService(dependencies).load()

  assert.equal(strictReads, 1)
  assert.equal(inventoryReads, 1)
  assert.equal(result.chapters[0]?.content, '正文文件仍可只读核对')
  assert.equal(result.outlines.total?.content, '总纲仍可读取')
  assert.deepEqual(result.issues, [{
    id: 'chapterOrderUnreadable', area: 'chapterOrder', title: '章节顺序账本需要人工核对',
    message: '章节顺序文件损坏，未对稿件执行任何改动', recovery: 'manualReview'
  }])
})

test('fails closed when the active work item changes while the bootstrap snapshot is loading', async () => {
  const summaryB = { ...summaryA, id: 'book-b', name: 'book-b', path: 'E:\\books\\b', title: '乙书' }
  let pathRead = 0
  let summaryRead = 0
  const dependencies = {
    projects: {
      currentPath: async () => (++pathRead <= 2 ? summaryA.path : summaryB.path),
      currentSummary: async () => (++summaryRead === 1 ? summaryA : summaryB),
      migrationPreview: async () => ({})
    },
    documents: { chapters: async () => [], outlines: async () => ({ total: null, volumes: [] }) },
    workspace: {
      timeline: async () => ({ events: [] }), realms: async () => ({ levels: [] }), powerSystem: async () => ({}),
      cheatSystem: async () => ({}), systemTemplate: async () => ({ template: '' }), foundation: async () => ({}),
      bookProfile: async () => ({}), promptProfile: async () => ({})
    },
    aiSettings: async () => ({}), researchSettings: async () => ({}),
    researchLibrary: { listSources: async () => ({ sources: [] }), listEvents: async () => ({ events: [] }) },
    planningDraft: async () => null, importRecoveries: async () => [], continuation: async () => ({ candidate: null })
  } as unknown as WorkspaceBootstrapDependencies

  await assert.rejects(() => new WorkspaceBootstrapService(dependencies).load(), (error: unknown) => {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'CONFLICT')
  })
})
