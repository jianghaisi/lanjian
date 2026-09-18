import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { AppError } from '../../src/main/core/errors/app-error'
import {
  decodeAiCompleteArgs,
  decodeAiConnectionDraftArgs,
  decodeAiSettingsUpdateArgs,
  decodeChapterIdArgs,
  decodeChapterDraftRecoveryArgs,
  decodeChapterPlanningUpdateArgs,
  decodeChapterReorderArgs,
  decodeFoundationArgs,
  decodeBookProfileArgs,
  decodeImportCommitArgs,
  decodeImportManifestCommitArgs,
  decodeImportManifestIdArgs,
  decodeContinuationAnalysisEditsArgs,
  decodeContinuationCandidateIdArgs,
  decodeContinuationProjectDefinitionAdoptionArgs,
  decodeContinuationExistingPlotAdoptionArgs,
  decodeContinuationCharacterPreviewArgs,
  decodeContinuationCharacterAdoptionArgs,
  decodeContinuationWorldViewAdoptionArgs,
  decodeContinuationPowerSystemAdoptionArgs,
  decodeContinuationCheatSystemAdoptionArgs,
  decodeContinuationTotalOutlineAdoptionArgs,
  decodeContinuationVolumeOutlineAdoptionArgs,
  decodeContinuationVolumeOutlinePreviewArgs,
  decodeContinuationChapterOutlineAdoptionArgs,
  decodeContinuationChapterOutlinePreviewArgs,
  decodeCharacterConflictIdArgs,
  decodeJobIdArgs,
  decodeOutlineUpdateArgs,
  decodeOutlineVolumeCreateArgs,
  decodeOutlineVolumeRenameArgs,
  decodeOutlineStageCreateArgs,
  decodeOutlineStageUpdateArgs,
  decodeOutlineChapterStagePlacementArgs,
  decodeOutlineEventPlacementArgs,
  decodeOutlineEventChapterPlacementArgs,
  decodeWorkspaceBootstrapIssueIdArgs,
  decodeOutlineChapterPlacementArgs,
  decodeProjectCreateArgs,
  decodeProjectPathArgs,
  decodePromptOverrideArgs,
  decodePromptTaskArgs,
  decodeRealmsArgs,
  decodeResearchQueryArgs,
  decodeResearchEventIdArgs,
  decodeResearchSettingsArgs,
  decodeSourceCardCreateArgs,
  decodeSourceCardUpdateArgs,
  decodeSqliteShadowMigrationTokenArgs,
  decodeEventCandidateCreateArgs,
  decodeTimelineArgs,
  decodeAutosaveCheckpointIdArgs,
  decodeChapterMirrorRecoveryTokenArgs,
  decodeChapterAutosaveStageArgs,
  decodeChapterUpdateArgs,
  decodeChapterRevisionLabelArgs,
  decodeWritingAgentArgs,
  decodeWritingAgentArtifactDecisionArgs,
  decodeFactReviewDecisionArgs,
  decodeResourceLedgerAppendArgs,
  decodeIdeaSaveArgs,
  decodeIdeaPromotionArgs,
  decodeConsistencyFindingDecisionArgs,
  decodeContextBudgetPreferencesArgs,
  decodeAutoBackupPreferencesArgs,
  decodeAutoBackupRunArgs,
  decodeChapterSummaryArgs,
  decodeWritingAgentRetryArgs,
  decodeWritingAgentStartArgs
} from '../../src/contracts/ipc'

test('validates bounded idea edits and stale-protected promotion at the IPC boundary', () => {
  const ideaId = '10000000-0000-4000-8000-000000000001'
  assert.deepEqual(decodeIdeaSaveArgs([{ title: '月影规则', content: '月光只照见说谎者。', status: 'candidate' }]), [{
    title: '月影规则', content: '月光只照见说谎者。', status: 'candidate'
  }])
  assert.deepEqual(decodeIdeaPromotionArgs([ideaId, '2026-09-03T01:00:00.000Z']), [ideaId, '2026-09-03T01:00:00.000Z'])
  assert.throws(() => decodeIdeaSaveArgs([{ title: '空内容', content: '' }]), /不能为空/)
  assert.throws(() => decodeIdeaSaveArgs([{ title: '未知状态', content: '内容', status: 'promoted' }]), /不是受支持的状态/)
  assert.throws(() => decodeIdeaPromotionArgs([ideaId, '刚才']), /不是有效时间/)
})

test('validates the optional send-before-confirming project preference', () => {
  assert.deepEqual(decodeContextBudgetPreferencesArgs([{
    version: 1,
    inputBudgetTokens: 48_000,
    modelContextLimit: 150_000,
    outputReservePercent: 25,
    systemReserveTokens: 10_000,
    recentSummaryCount: 3,
    structuredRepairAttempts: 1,
    minimumFactImportance: 'medium',
    showFactConfirmations: false,
    pinnedEvidenceKeys: [],
    excludedEvidenceKeys: []
  }]), [{
    version: 1,
    inputBudgetTokens: 48_000,
    modelContextLimit: 150_000,
    outputReservePercent: 25,
    systemReserveTokens: 10_000,
    recentSummaryCount: 3,
    structuredRepairAttempts: 1,
    minimumFactImportance: 'medium',
    showFactConfirmations: false,
    pinnedEvidenceKeys: [],
    excludedEvidenceKeys: []
  }])
  const decoded = decodeContextBudgetPreferencesArgs([{
    version: 1,
    inputBudgetTokens: 48_000,
    modelContextLimit: 150_000,
    outputReservePercent: 25,
    systemReserveTokens: 10_000,
    recentSummaryCount: 4,
    structuredRepairAttempts: 2,
    minimumFactImportance: 'high',
    showFactConfirmations: true,
    pinnedEvidenceKeys: [],
    excludedEvidenceKeys: [],
    alwaysConfirmBeforeSend: true
  }])
  assert.equal(decoded[0].alwaysConfirmBeforeSend, true)
  assert.throws(() => decodeContextBudgetPreferencesArgs([{
    version: 1,
    inputBudgetTokens: 48_000,
    modelContextLimit: 150_000,
    outputReservePercent: 25,
    systemReserveTokens: 10_000,
    recentSummaryCount: 4,
    structuredRepairAttempts: 1,
    minimumFactImportance: 'medium',
    showFactConfirmations: false,
    pinnedEvidenceKeys: [],
    excludedEvidenceKeys: [],
    alwaysConfirmBeforeSend: 'yes'
  }]), /必须是开关值/)
  const valid = {
    version: 1 as const, inputBudgetTokens: 48_000, modelContextLimit: 150_000, outputReservePercent: 25,
    systemReserveTokens: 10_000, recentSummaryCount: 3, structuredRepairAttempts: 1, minimumFactImportance: 'medium' as const, showFactConfirmations: false, pinnedEvidenceKeys: [], excludedEvidenceKeys: []
  }
  assert.throws(() => decodeContextBudgetPreferencesArgs([{ ...valid, recentSummaryCount: 1 }]), /必须在 2 到 5 之间/)
  assert.throws(() => decodeContextBudgetPreferencesArgs([{ ...valid, recentSummaryCount: 6 }]), /必须在 2 到 5 之间/)
  assert.throws(() => decodeContextBudgetPreferencesArgs([{ ...valid, structuredRepairAttempts: 4 }]), /必须在 0 到 3 之间/)
  assert.throws(() => decodeContextBudgetPreferencesArgs([{ ...valid, minimumFactImportance: 'urgent' }]), /必须是 high、medium、low 之一/)
  assert.throws(() => decodeContextBudgetPreferencesArgs([{ ...valid, modelContextLimit: 16_000, outputReservePercent: 60, systemReserveTokens: 10_000 }]), /至少要给作品上下文留下 4000/)
})

test('bounds local automatic backup preferences at the IPC boundary', () => {
  assert.deepEqual(decodeAutoBackupPreferencesArgs([{
    enabled: true,
    targetParentPath: 'D:\\岚笺备份',
    backupOnFirstOpen: false,
    intervalMinutes: 30,
    retentionCount: 10
  }]), [{ enabled: true, targetParentPath: 'D:\\岚笺备份', backupOnFirstOpen: false, intervalMinutes: 30, retentionCount: 10 }])
  assert.throws(() => decodeAutoBackupPreferencesArgs([{ enabled: true, targetParentPath: '', backupOnFirstOpen: true, intervalMinutes: 30, retentionCount: 10 }]), /必须选择保存文件夹/)
  assert.throws(() => decodeAutoBackupPreferencesArgs([{ enabled: false, targetParentPath: '', backupOnFirstOpen: true, intervalMinutes: 5, retentionCount: 10 }]), /15/)
  assert.throws(() => decodeAutoBackupPreferencesArgs([{ enabled: false, targetParentPath: '', backupOnFirstOpen: true, intervalMinutes: 30, retentionCount: 51 }]), /50/)
  assert.throws(() => decodeAutoBackupPreferencesArgs([{ enabled: false, targetParentPath: '', intervalMinutes: 30, retentionCount: 10 }]), /backupOnFirstOpen/)
  assert.deepEqual(decodeAutoBackupRunArgs([true]), [true])
  assert.throws(() => decodeAutoBackupRunArgs(['now']), /必须是开关值/)
})

test('accepts a concise chapter version name and rejects empty or oversized labels', () => {
  assert.deepEqual(decodeChapterRevisionLabelArgs([3, '  第一幕定稿  ']), [3, '第一幕定稿'])
  assert.throws(() => decodeChapterRevisionLabelArgs([3, '   ']), /不能为空/)
  assert.throws(() => decodeChapterRevisionLabelArgs([3, '版'.repeat(81)]), /长度不能超过 80/)
})

test('accepts bounded resource ledger changes and rejects unsafe quantities or fields', () => {
  const operationKey = '20000000-0000-4000-8000-000000000001'
  const resourceEntityId = '30000000-0000-4000-8000-000000000001'
  assert.deepEqual(decodeResourceLedgerAppendArgs([{ operationKey, resourceEntityId, delta: -2, eventId: '第10章开启封印', note: '消耗钥匙' }]), [{ operationKey, resourceEntityId, delta: -2, eventId: '第10章开启封印', note: '消耗钥匙' }])
  assert.throws(() => decodeResourceLedgerAppendArgs([{ operationKey, resourceEntityId, delta: 0 }]), /不能为零/)
  assert.throws(() => decodeResourceLedgerAppendArgs([{ operationKey, resourceEntityId, delta: 1.5 }]), /必须是整数/)
  assert.throws(() => decodeResourceLedgerAppendArgs([{ operationKey, resourceEntityId, delta: 1, quantity: 99 }]), /未允许的字段/)
})

test('accepts bounded partial fact decisions and rejects duplicate or malformed JSON edits', () => {
  const batchId = '11111111-1111-4111-8111-111111111111'
  const first = '22222222-2222-4222-8222-222222222222'
  const second = '33333333-3333-4333-8333-333333333333'
  assert.deepEqual(decodeFactReviewDecisionArgs([{ batchId, decisions: [
    { changeId: first, decision: 'APPROVED' },
    { changeId: second, decision: 'DEFERRED', decidedObjectJson: '"稍后核对"' }
  ] }]), [{ batchId, decisions: [
    { changeId: first, decision: 'APPROVED' },
    { changeId: second, decision: 'DEFERRED', decidedObjectJson: '"稍后核对"' }
  ] }])
  assert.throws(() => decodeFactReviewDecisionArgs([{ batchId, decisions: [
    { changeId: first, decision: 'APPROVED' },
    { changeId: first, decision: 'REJECTED' }
  ] }]), /不能重复/)
  assert.throws(() => decodeFactReviewDecisionArgs([{ batchId, decisions: [
    { changeId: first, decision: 'APPROVED', decidedObjectJson: '{broken' }
  ] }]), /有效 JSON/)
})

test('requires a bounded reason when marking a consistency finding as an exception', () => {
  const findingId = '44444444-4444-4444-8444-444444444444'
  assert.deepEqual(decodeConsistencyFindingDecisionArgs([{ findingId, decision: 'exception', reason: '这是有意保留的悬念。' }]), [{ findingId, decision: 'exception', reason: '这是有意保留的悬念。' }])
  assert.deepEqual(decodeConsistencyFindingDecisionArgs([{ findingId, decision: 'accepted' }]), [{ findingId, decision: 'accepted' }])
  assert.deepEqual(decodeConsistencyFindingDecisionArgs([{ findingId, decision: 'ignored' }]), [{ findingId, decision: 'ignored' }])
  assert.throws(() => decodeConsistencyFindingDecisionArgs([{ findingId, decision: 'exception' }]), /必须说明原因/)
  assert.throws(() => decodeConsistencyFindingDecisionArgs([{ findingId: '../bad', decision: 'ignored' }]), /格式无效/)
})

test('finding repair decisions require an explicit version and concurrency token only for fixed', () => {
  const input = { findingId: '44444444-4444-4444-8444-444444444444', decision: 'fixed', resultingBodyVersionId: '55555555-5555-4555-8555-555555555555', expectedUpdatedAt: '2026-09-08T00:00:00.000Z' }
  assert.deepEqual(decodeConsistencyFindingDecisionArgs([input]), [input])
  for (const patch of [
    { resultingBodyVersionId: undefined }, { resultingBodyVersionId: '../file' },
    { expectedUpdatedAt: undefined }, { expectedUpdatedAt: 'yesterday' },
    { decision: 'accepted' }, { sql: 'UPDATE findings' }, { reason: 'x'.repeat(2001) }
  ]) assert.throws(() => decodeConsistencyFindingDecisionArgs([{ ...input, ...patch }]))
})

test('accepts a version-bound chapter summary and rejects empty or malformed input', () => {
  const valid = decodeChapterSummaryArgs([{ chapterId: 3, bodyVersionId: 'body-version-3', content: '本章承接摘要。' }])
  assert.deepEqual(valid, [{ chapterId: 3, bodyVersionId: 'body-version-3', content: '本章承接摘要。' }])
  assert.throws(() => decodeChapterSummaryArgs([{ chapterId: 3, bodyVersionId: '', content: '摘要' }]), /不能为空/)
  assert.throws(() => decodeChapterSummaryArgs([{ chapterId: 3, bodyVersionId: 'body-version-3', content: '' }]), /不能为空/)
  assert.throws(() => decodeChapterSummaryArgs([{ chapterId: 3, bodyVersionId: 'body-version-3', content: '摘要', ignored: true }]), /未允许/)
})

test('validates writing agent selections against the exact current draft', () => {
  const valid = decodeWritingAgentArgs([{
    chapterId: 2,
    message: '改写选中段落',
    currentDraft: '甲乙丙丁',
    model: 'dialogue-model',
    preferredSkill: 'rewrite',
    selection: { start: 1, end: 3, text: '乙丙' }
  }])
  assert.equal(valid[0].selection?.text, '乙丙')
  assert.equal(valid[0].model, 'dialogue-model')
  const anchored = decodeWritingAgentArgs([{
    chapterId: 2,
    message: '从这里继续',
    currentDraft: '甲乙丙丁',
    preferredSkill: 'continue',
    insertionAnchor: { offset: 2, before: '甲乙', after: '丙丁' }
  }])[0]
  assert.deepEqual(anchored.insertionAnchor, { offset: 2, before: '甲乙', after: '丙丁' })
  const withContext = decodeWritingAgentArgs([{
    chapterId: 2,
    message: '按本次依据继续',
    currentDraft: '甲乙丙丁',
    expectedContextHash: 'a'.repeat(64),
    contextSelection: {
      pinnedIds: ['workspace:character-state'],
      excludedIds: ['workspace:timeline'],
      temporaryAdditions: [{ id: 'temporary:note-1', label: '本次补充', content: '只考虑雨夜。' }]
    }
  }])[0]
  assert.deepEqual(withContext.contextSelection, {
    pinnedIds: ['workspace:character-state'],
    excludedIds: ['workspace:timeline'],
    temporaryAdditions: [{ id: 'temporary:note-1', label: '本次补充', content: '只考虑雨夜。' }]
  })
  assert.equal(withContext.expectedContextHash, 'a'.repeat(64))
  assert.equal(decodeWritingAgentArgs([{ chapterId: 2, message: '讨论冲突升级', currentDraft: '甲乙丙丁', preferredSkill: 'plan' }])[0].preferredSkill, 'plan')
  assert.equal(decodeWritingAgentArgs([{ chapterId: 2, message: '扩写选段', currentDraft: '甲乙丙丁', preferredSkill: 'expand' }])[0].preferredSkill, 'expand')
  assert.equal(decodeWritingAgentArgs([{ chapterId: 2, message: '压缩选段', currentDraft: '甲乙丙丁', preferredSkill: 'compress' }])[0].preferredSkill, 'compress')
  assert.equal(decodeWritingAgentArgs([{ chapterId: 2, message: '按我的要求处理', currentDraft: '甲乙丙丁', preferredSkill: 'custom' }])[0].preferredSkill, 'custom')
  assert.throws(() => decodeWritingAgentArgs([{
    chapterId: 2,
    message: '改写',
    currentDraft: '甲乙丙丁',
    selection: { start: 1, end: 3, text: '伪造' }
  }]), (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR')
  assert.throws(() => decodeWritingAgentArgs([{
    chapterId: 2,
    message: '从这里继续',
    currentDraft: '甲乙丙丁',
    insertionAnchor: { offset: 2, before: '伪造', after: '丙丁' }
  }]), (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR')
  assert.throws(() => decodeWritingAgentArgs([{
    chapterId: 2,
    message: '改写',
    currentDraft: '甲乙丙丁',
    preferredSkill: 'delete'
  }]), (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR')
  assert.throws(() => decodeWritingAgentArgs([{
    chapterId: 2,
    message: '继续写',
    currentDraft: '甲乙丙丁',
    model: 'x'.repeat(201)
  }]), (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR')
  assert.throws(() => decodeWritingAgentArgs([{
    chapterId: 2,
    message: '继续写',
    currentDraft: '甲乙丙丁',
    contextSelection: { pinnedIds: ['workspace:timeline'], excludedIds: ['workspace:timeline'], temporaryAdditions: [] }
  }]), (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR')
  assert.throws(() => decodeWritingAgentArgs([{
    chapterId: 2,
    message: '继续写',
    currentDraft: '甲乙丙丁',
    contextSelection: { pinnedIds: [], excludedIds: [], temporaryAdditions: [{ id: 'temporary:bad', label: '补充', content: '' }] }
  }]), (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR')
  assert.throws(() => decodeWritingAgentArgs([{
    chapterId: 2,
    message: '按预览发送',
    currentDraft: '甲乙丙丁',
    expectedContextHash: 'not-a-context-hash'
  }]), (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR')
})

test('requires bounded UUID identities for persisted writing tasks and artifact decisions', () => {
  const operationId = '00000000-0000-4000-8000-000000000001'
  const taskId = '00000000-0000-4000-8000-000000000002'
  const start = decodeWritingAgentStartArgs([{
    operationId,
    request: { chapterId: 1, message: '改写', currentDraft: '旧句。', selection: { start: 0, end: 3, text: '旧句。' } }
  }])
  assert.equal(start[0].operationId, operationId)
  assert.equal(start[0].request.selection?.text, '旧句。')
  assert.deepEqual(decodeWritingAgentRetryArgs([taskId, operationId]), [taskId, operationId])
  assert.deepEqual(decodeWritingAgentArtifactDecisionArgs([{ taskId, decision: 'applied', acceptedChangeIds: ['change-1'] }])[0], {
    taskId, decision: 'applied', acceptedChangeIds: ['change-1']
  })
  assert.deepEqual(decodeWritingAgentArtifactDecisionArgs([{ taskId, decision: 'discarded', acceptedChangeIds: [], reviewedChangeIds: ['change-1'] }])[0], {
    taskId, decision: 'discarded', acceptedChangeIds: [], reviewedChangeIds: ['change-1']
  })
  assert.throws(() => decodeWritingAgentStartArgs([{ operationId: '../bad', request: start[0].request }]), (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR')
  assert.throws(() => decodeWritingAgentArtifactDecisionArgs([{ taskId, decision: 'applied', acceptedChangeIds: ['same', 'same'] }]), (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR')
  assert.throws(() => decodeWritingAgentArtifactDecisionArgs([{ taskId, decision: 'discarded', reviewedChangeIds: ['same', 'same'] }]), (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR')
})

test('accepts only fixed bootstrap issue identifiers for file-manager location', () => {
  assert.deepEqual(decodeWorkspaceBootstrapIssueIdArgs(['outlinePlanningUnreadable']), ['outlinePlanningUnreadable'])
  assert.deepEqual(decodeWorkspaceBootstrapIssueIdArgs(['characterStateUnreadable']), ['characterStateUnreadable'])
  assert.deepEqual(decodeWorkspaceBootstrapIssueIdArgs(['chapterOrderUnreadable']), ['chapterOrderUnreadable'])
  assert.throws(() => decodeWorkspaceBootstrapIssueIdArgs(['../../真实书稿.txt']), (error: unknown) => (
    error instanceof AppError && error.code === 'VALIDATION_ERROR'
  ))
  assert.throws(() => decodeWorkspaceBootstrapIssueIdArgs(['unknownIssue']), (error: unknown) => (
    error instanceof AppError && error.code === 'VALIDATION_ERROR'
  ))
})

test('accepts only a UUID for explicit Markdown mirror recovery', () => {
  const token = '22222222-3333-4333-8333-444444444444'
  assert.deepEqual(decodeChapterMirrorRecoveryTokenArgs([token]), [token])
  assert.throws(() => decodeChapterMirrorRecoveryTokenArgs(['../../正文/第1章.md']), (error: unknown) => (
    error instanceof AppError && error.code === 'VALIDATION_ERROR'
  ))
})
import type { IpcResponse } from '../../src/contracts/index'
import { registeredIpcResultChannels, unwrapIpcResponse, unwrapValidatedIpcResponse } from '../../src/contracts/core/ipc-response'

test('validates bounded traceable material evidence before context preview reaches the renderer', () => {
  const value = {
    version: 1,
    workItemId: 'book-material-evidence',
    chapterId: 2,
    queryTerms: ['钟楼'],
    structured: { canonicalEvents: [], characterSnapshots: [], characterAliases: [], approvedFacts: [] },
    evidence: [],
    materials: [{
      sourceId: '11111111-2222-4333-8444-555555555555', title: '钟楼记录', provider: 'manual', sourceType: 'manual',
      contentHash: 'a'.repeat(64), excerpt: '钟声之后回声延迟七秒。', userNotes: '用于第二章。',
      reason: '与当前章匹配：钟楼', score: 64
    }],
    materialBudget: { maxCharacters: 2_400, usedCharacters: 18, omittedEvidenceCount: 0, searchMode: 'sqlite' },
    budget: { maxCharacters: 2_400, usedCharacters: 0, omittedEvidenceCount: 0 }
  }
  assert.deepEqual(unwrapValidatedIpcResponse('workspace:get-context-fact-pack', { ok: true, value }), value)
  assert.throws(() => unwrapValidatedIpcResponse('workspace:get-context-fact-pack', {
    ok: true, value: { ...value, materials: [{ ...value.materials[0], sourceType: 'remote-command' }] }
  }), (error: unknown) => (error as { code?: string }).code === 'INTERNAL_ERROR')
})
import { registerValidatedIpc } from '../../src/main/bootstrap/ipc-handler'

test('keeps every renderer IPC result behind a registered value decoder', () => {
  const preloadSource = ['index.ts', 'companion-voice-bridge.ts', 'model-connections-bridge.ts'].map(file => readFileSync(new URL(`../../src/preload/${file}`, import.meta.url), 'utf8')).join('\n')
  const invokedChannels = [...preloadSource.matchAll(/invokeValidated\('([^']+)'/g)].map((match) => match[1])
  assert.equal(new Set(invokedChannels).size, invokedChannels.length)
  assert.deepEqual([...registeredIpcResultChannels].sort(), invokedChannels.sort())
})

function harness<T>(decode: (args: unknown[]) => unknown[], listener: (...args: unknown[]) => T | Promise<T>) {
  let handler: ((_event: unknown, ...args: unknown[]) => Promise<IpcResponse<T>>) | undefined
  registerValidatedIpc({
    handle: (_channel, value) => { handler = value as typeof handler }
  }, 'test', decode, listener)
  return (...args: unknown[]) => handler!({}, ...args)
}

test('validates chapter update input once at the IPC boundary', async () => {
  const invoke = harness(decodeChapterUpdateArgs, (id, data) => ({ id, data }))
  const revision = 'a'.repeat(64)
  const valid = await invoke(7, { title: '春灯', content: '灯市初见。', reason: 'manual', expectedRevision: revision })
  assert.deepEqual(unwrapIpcResponse(valid), {
    id: 7,
    data: { title: '春灯', content: '灯市初见。', reason: 'manual', expectedRevision: revision }
  })

  const sourceTaskRunId = '00000000-0000-4000-8000-000000000005'
  const generationArtifactId = '00000000-0000-4000-8000-000000000006'
  assert.deepEqual(decodeChapterUpdateArgs([7, { content: 'AI 正文', reason: 'ai', sourceTaskRunId, generationArtifactId }])[1], {
    content: 'AI 正文', reason: 'ai', sourceTaskRunId, generationArtifactId
  })
  assert.throws(() => decodeChapterUpdateArgs([7, { content: 'AI 正文', reason: 'ai', sourceTaskRunId }]), /同时提供/)
  assert.throws(() => decodeChapterUpdateArgs([7, { content: '普通正文', reason: 'manual', sourceTaskRunId }]), (error: unknown) => (
    error instanceof AppError && error.code === 'VALIDATION_ERROR'
  ))

  for (const args of [
    ['7', { content: '正文' }],
    [1.5, { content: '正文' }],
    [0, { content: '正文' }],
    [1, { content: '正文', path: '../../越界.md' }],
    [1, { reason: 'unknown' }],
    [1, { expectedRevision: 'not-a-revision' }],
    [1, { title: '题'.repeat(201) }],
    [1, { content: '文'.repeat(2_000_001) }]
  ]) {
    const response = await invoke(...args)
    assert.equal(response.ok, false)
    if (!response.ok) {
      assert.equal(response.error.code, 'VALIDATION_ERROR')
      assert.equal(response.error.recoverable, true)
      assert.doesNotMatch(JSON.stringify(response.error), /\.\.\/\.\.\//)
    }
  }
})

test('validates IPC response envelopes and core writing DTOs before renderer use', () => {
  const chapter = {
    id: 1,
    position: 1,
    title: '雨夜追迹',
    content: '　　沈砚沿着脚印追进长街。',
    word_count: 12,
    summary: '',
    revision: 'a'.repeat(64),
    bodyVersionId: '00000000-0000-4000-8000-000000000101',
    storageMode: 'sqlite',
    mirrorStatus: 'synced'
  }
  assert.deepEqual(unwrapValidatedIpcResponse('chapters:get', { ok: true, value: chapter }), chapter)
  assert.deepEqual(unwrapValidatedIpcResponse('chapters:list', { ok: true, value: [chapter] }), [chapter])
  assert.deepEqual(unwrapValidatedIpcResponse('unregistered:future-channel', { ok: true, value: { compatible: true } }), { compatible: true })
  assert.equal(unwrapValidatedIpcResponse('projects:workspace-restore-commit', { ok: true, value: null }), null)

  const rejected = { ok: false, error: { code: 'CONFLICT', message: '正文版本已经变化', recoverable: true, details: { chapterId: 1 } } }
  assert.throws(() => unwrapValidatedIpcResponse('chapters:update', rejected), (error: unknown) => {
    const result = error as { code?: string; message?: string; recoverable?: boolean }
    return result.code === 'CONFLICT' && result.message === '正文版本已经变化' && result.recoverable === true
  })

  for (const response of [
    null,
    { ok: 'yes', value: chapter },
    { ok: true },
    { ok: false, error: { code: 'CONFLICT', message: '缺少恢复标记' } },
    { ok: true, value: { ...chapter, word_count: '12', content: 'PRIVATE-SHOULD-NOT-ECHO' } }
  ]) {
    assert.throws(() => unwrapValidatedIpcResponse('chapters:get', response), (error: unknown) => {
      const result = error as { code?: string; message?: string; recoverable?: boolean; details?: { channel?: string } }
      return result.code === 'INTERNAL_ERROR'
        && result.recoverable === true
        && result.details?.channel === 'chapters:get'
        && !JSON.stringify(result).includes('PRIVATE-SHOULD-NOT-ECHO')
    })
  }
})

test('validates chapter history and direct AI results before renderer use', () => {
  const chapter = {
    id: 1, position: 1, title: '雨夜追迹', content: '　　沈砚沿着脚印追进长街。',
    word_count: 12, summary: '', revision: 'a'.repeat(64), storageMode: 'sqlite', mirrorStatus: 'synced'
  }
  const revision = {
    id: '1788566400000-11111111-2222-4333-8444-555555555555', chapterId: 1,
    title: '雨夜追迹', content: chapter.content, word_count: 12,
    createdAt: '2026-09-05T00:00:00.000Z', reason: 'manual', label: '第一版', isCurrent: true
  }
  const profile = { connectionId: 'gemini', model: 'gemini-3.1-pro', temperature: 0.8, topP: 0.95, maxTokens: 8192 }
  const settings = {
    version: 2, connections: [{ id: 'gemini', name: 'Gemini 接口', baseUrl: 'https://example.test/v1', apiKeyConfigured: true }], apiKeyConfigured: true, routingMode: 'perTask',
    shared: profile,
    tasks: { outline: profile, chapterOutline: profile, prose: profile, review: { ...profile, temperature: 0.2 } }
  }
  const summary = {
    version: 1, suite: 'consistency-fixed-v2', modelVersion: 'gemini-3.1-pro',
    completedAt: '2026-09-05T00:00:00.000Z', reportRelativePath: '.webnovel/evaluations/consistency-fixed-v2.json',
    sampleCount: 36, evaluatedCount: 36, unableToJudgeCount: 0,
    semanticSampleCount: 12, semanticEvaluatedCount: 12, semanticTruePositive: 6,
    semanticFalsePositive: 0, semanticFalseNegative: 0, semanticUnableToJudge: 0, warningCount: 0
  }
  const runningJob = {
    id: '11111111-2222-4333-8444-555555555555', workItemId: 'E:\\作品\\星城少年们的日常录',
    status: 'running', completedBatches: 1, totalBatches: 3, message: '正在核对', startedAt: '2026-09-05T00:00:00.000Z'
  }
  const completedJob = {
    ...runningJob, status: 'completed', completedBatches: 3, message: '评测完成',
    completedAt: '2026-09-05T00:01:00.000Z', result: summary
  }
  const mirrorPreview = {
    token: '22222222-3333-4333-8333-444444444444', chapterId: 1,
    sqliteTitle: '雨夜追迹', sqliteCharacterCount: 12, sqliteExcerpt: 'SQLite 正文',
    externalTitle: '雨夜追迹', externalCharacterCount: 18, externalExcerpt: 'Markdown 外部正文',
    expiresAt: '2026-09-05T00:15:00.000Z'
  }
  const mirrorRecovery = {
    chapter, previousBodyVersionId: '00000000-0000-4000-8000-000000000101', importedExternalHash: 'b'.repeat(64)
  }
  const deletedChapter = { id: 2, position: 2, title: '旧城回声', word_count: 3200, deletedAt: '2026-09-05T00:02:00.000Z' }

  for (const [channel, value] of [
    ['chapters:delete', { success: true, recovery: 'chapter-trash' }],
    ['chapters:trash-list', [deletedChapter]],
    ['chapters:restore', chapter],
    ['chapters:stats', { total_chapters: 12, total_words: 48_000 }],
    ['chapters:revisions', [revision]],
    ['chapters:name-current-revision', revision],
    ['chapters:restore-revision', chapter],
    ['chapters:preview-external-mirror', mirrorPreview],
    ['chapters:adopt-external-mirror', mirrorRecovery],
    ['ai:get-settings', settings],
    ['ai:update-settings', settings],
    ['ai:list-models', { models: ['gemini-3.1-pro'] }],
    ['ai:test', { success: true, message: '连接可用', model: 'gemini-3.1-pro', models: ['gemini-3.1-pro'] }],
    ['ai:latest-consistency-evaluation', summary],
    ['ai:start-consistency-evaluation', runningJob],
    ['ai:consistency-evaluation-job', completedJob],
    ['ai:cancel-consistency-evaluation', { ...runningJob, status: 'cancelled', completedAt: '2026-09-05T00:00:30.000Z' }],
    ['ai:genres', { genres: [{ id: 'urban', name: '都市', aliases: [], substyles: ['娱乐文'] }] }],
    ['ai:complete', { content: '　　雨后的长街很安静。' }]
  ] as const) assert.deepEqual(unwrapValidatedIpcResponse(channel, { ok: true, value }), value)
  assert.equal(unwrapValidatedIpcResponse('ai:latest-consistency-evaluation', { ok: true, value: null }), null)

  for (const [channel, value] of [
    ['chapters:delete', { success: false, recovery: 'chapter-trash' }],
    ['chapters:trash-list', [{ ...deletedChapter, deletedAt: 'not-a-date' }]],
    ['chapters:restore', { ...chapter, word_count: '12' }],
    ['chapters:stats', { total_chapters: 12, total_words: '48000' }],
    ['chapters:revisions', [{ ...revision, id: '../../history.json' }]],
    ['chapters:name-current-revision', { ...revision, label: '   ' }],
    ['chapters:restore-revision', { ...chapter, word_count: '12' }],
    ['chapters:preview-external-mirror', { ...mirrorPreview, token: '../../bad' }],
    ['chapters:adopt-external-mirror', { ...mirrorRecovery, importedExternalHash: 'bad' }],
    ['ai:get-settings', { ...settings, apiKey: 'PRIVATE-SHOULD-NOT-ECHO' }],
    ['ai:get-settings', { ...settings, connections: [{ ...settings.connections[0], apiKey: 'PRIVATE-SHOULD-NOT-ECHO' }] }],
    ['ai:update-settings', { ...settings, tasks: { ...settings.tasks, prose: { ...profile, maxTokens: 0 } } }],
    ['ai:list-models', { models: [1] }],
    ['ai:test', { success: true, message: '连接可用', model: 'x', models: 'x' }],
    ['ai:latest-consistency-evaluation', { ...summary, reportRelativePath: '../../secret.json' }],
    ['ai:start-consistency-evaluation', { ...runningJob, completedBatches: 4 }],
    ['ai:consistency-evaluation-job', { ...runningJob, status: 'completed', completedBatches: 3 }],
    ['ai:cancel-consistency-evaluation', { ...runningJob, status: 'failed' }],
    ['ai:genres', { genres: [{ id: 'urban', name: '都市', aliases: '都市文', substyles: [] }] }],
    ['ai:complete', { content: 42 }]
  ] as const) {
    assert.throws(() => unwrapValidatedIpcResponse(channel, { ok: true, value }), (error: unknown) => {
      const result = error as { code?: string; recoverable?: boolean; details?: { channel?: string } }
      return result.code === 'INTERNAL_ERROR' && result.recoverable === true
        && result.details?.channel === channel && !JSON.stringify(result).includes('PRIVATE-SHOULD-NOT-ECHO')
    })
  }
})

test('validates project lifecycle, backup and real-trial results before renderer use', () => {
  const root = 'E:\\作品\\星城少年们的日常录'
  const project = {
    id: root, name: '星城少年们的日常录', path: root, title: '星城少年们的日常录', genre: '都市',
    updated_at: '2026-09-05T00:00:00.000Z',
    manuscript: { chapterCount: 17, fileCount: 17, wordCount: 72_000, status: 'ready' }
  }
  const migration = {
    currentVersion: 2, targetVersion: 2, required: false, format: 'lanjian-current',
    canMigrate: false, reviewRequired: false, operations: [], warnings: [], issues: []
  }
  const backup = {
    backupPath: 'E:\\备份\\怪物-岚笺备份', backupName: '怪物-岚笺备份', createdAt: '2026-09-05T00:00:00.000Z',
    projectName: '星城少年们的日常录', storageMode: 'sqlite', chapterCount: 17, fileCount: 80, verified: true
  }
  const autoBackup = {
    enabled: false, targetParentPath: '', backupOnFirstOpen: true, intervalMinutes: 60, retentionCount: 7,
    lastCheckedAt: null, lastSuccessAt: null, nextDueAt: null, lastError: null, lastResult: null, state: 'disabled'
  }
  const restore = {
    token: '11111111-2222-4333-8444-555555555555', canRestore: true, projectName: '星城少年们的日常录',
    createdAt: '2026-09-05T00:00:00.000Z', appVersion: '0.1.0', storageMode: 'sqlite', chapterCount: 17, fileCount: 80,
    expiresAt: '2026-09-05T00:15:00.000Z', blockers: []
  }
  const trial = {
    version: 1, purpose: 'product-experience-and-cost-only', workItemId: root,
    generatedAt: '2026-09-05T00:00:00.000Z', reportRelativePath: '.webnovel/evaluations/real-chapter-trial-v1.json',
    scopeNotice: '只评价产品体验与成本。',
    summary: {
      chapterCount: 0, targetMinimum: 20, targetMaximum: 30, status: 'collecting',
      totalHumanMinutes: 0, averageHumanMinutes: 0, humanTimeRecordedChapters: 0, humanTimeCoverage: 0,
      autosaveCheckpoints: 0, autosaveFinalized: 0, autosaveConflicts: 0, autosavePending: 0, autosaveDiscarded: 0, autosaveConflictFreeRate: null,
      aiTasks: 0, aiSucceeded: 0, aiCancelled: 0,
      aiFailed: 0, aiInterrupted: 0, aiRetries: 0, aiSuccessRate: null, aiCancellationRate: null, aiRetryRate: null, diffAcceptedBlocks: 0, diffRejectedBlocks: 0,
      diffAcceptanceRate: null, misappliedChanges: 0, factCandidates: 0, factDecisions: 0,
      factDecisionRate: null, factBatchSubmittedDecisions: 0, factBatchSubmissionRate: null, reviewDecisions: 0, averageReviewDecisions: 0, falsePositiveFindings: 0, usefulFindings: 0, findingFalsePositiveRate: null,
      contextEstimatedTokens: 0, modelCostTotal: null, modelCostCoverage: 0, averageSatisfaction: 0,
      continueNextChapterRate: 0, bypassedFeatures: []
    },
    conclusion: null, chapters: []
  }
  const trialChapter = {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', legacyChapterId: 17,
    bodyVersionId: '11111111-2222-4333-8444-555555555555', contentHash: 'c'.repeat(64),
    planningMinutes: 8, writingMinutes: 42, aiEditingMinutes: 6, factReviewMinutes: 2,
    diffAcceptedBlocks: 3, diffRejectedBlocks: 1, misappliedChanges: 0,
    falsePositiveFindings: 0, usefulFindings: 2, modelCost: null, satisfaction: 4,
    continueNextChapter: true, bypassedFeatures: '严格复核', notes: '快速生成符合本章节奏。',
    automatic: {
      autosaveCheckpoints: 0, autosaveFinalized: 0, autosaveConflicts: 0, autosavePending: 0, autosaveDiscarded: 0,
      aiTasks: 2, aiSucceeded: 2, aiCancelled: 0, aiFailed: 0, aiInterrupted: 0,
      aiRetries: 0, contextEstimatedTokens: 5200, factCandidates: 2, factDecisions: 2, factBatchSubmittedDecisions: 2, findings: 2, findingDecisions: 2,
      usefulFindings: 1, falsePositiveFindings: 1,
      diffAcceptedBlocks: 3, diffRejectedBlocks: 1
    },
    createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z'
  }
  const trialWithChapter = { ...trial, summary: { ...trial.summary, chapterCount: 1 }, chapters: [trialChapter] }

  for (const [channel, value] of [
    ['projects:choose-directory', 'E:\\作品'],
    ['projects:switch', { success: true, path: root }],
    ['projects:remove-recent', { success: true }],
    ['projects:trash', { success: true, recovery: 'system-trash', title: '星城少年们的日常录' }],
    ['projects:open-trash', { success: true }],
    ['projects:status', { initialized: true, project_root: root, project }],
    ['projects:migration-preview', migration],
    ['projects:migrate', { ...migration, migrated: false }],
    ['projects:workspace-backup-create', backup],
    ['projects:manuscript-export', { format: 'txt', filePath: 'E:\\导出\\怪物.txt', chapterCount: 17, characterCount: 72_500 }],
    ['projects:real-trial-report', trialWithChapter],
    ['projects:save-real-trial-chapter', trialWithChapter],
    ['projects:save-real-trial-conclusion', trialWithChapter],
    ['projects:auto-backup-get', autoBackup],
    ['projects:auto-backup-choose-directory', 'E:\\备份'],
    ['projects:auto-backup-update', autoBackup],
    ['projects:auto-backup-run', autoBackup],
    ['projects:workspace-restore-preview', restore]
  ] as const) assert.deepEqual(unwrapValidatedIpcResponse(channel, { ok: true, value }), value)
  for (const channel of ['projects:choose-directory', 'projects:workspace-backup-create', 'projects:manuscript-export', 'projects:auto-backup-choose-directory', 'projects:workspace-restore-preview']) {
    assert.equal(unwrapValidatedIpcResponse(channel, { ok: true, value: null }), null)
  }

  for (const [channel, value] of [
    ['projects:choose-directory', ''],
    ['projects:switch', { success: false, path: root }],
    ['projects:remove-recent', { success: 'yes' }],
    ['projects:trash', { success: true, recovery: 'permanent', title: '作品' }],
    ['projects:open-trash', { success: false }],
    ['projects:status', { initialized: true, project_root: 'E:\\另一部作品', project }],
    ['projects:migration-preview', { ...migration, operations: '../../secret' }],
    ['projects:migrate', { ...migration, migrated: 'yes' }],
    ['projects:workspace-backup-create', { ...backup, verified: false }],
    ['projects:manuscript-export', { format: 'pdf', filePath: 'E:\\导出\\怪物.pdf', chapterCount: 17, characterCount: 72_500 }],
    ['projects:real-trial-report', { ...trial, reportRelativePath: '../../secret.json' }],
    ['projects:save-real-trial-chapter', { ...trial, summary: { ...trial.summary, chapterCount: 1 } }],
    ['projects:save-real-trial-conclusion', { ...trial, purpose: 'quality-proof' }],
    ['projects:auto-backup-get', { ...autoBackup, enabled: true }],
    ['projects:auto-backup-choose-directory', 42],
    ['projects:auto-backup-update', { ...autoBackup, intervalMinutes: 5 }],
    ['projects:auto-backup-run', { ...autoBackup, nextDueAt: 'not-a-date' }],
    ['projects:workspace-restore-preview', { ...restore, token: null }]
  ] as const) {
    assert.throws(() => unwrapValidatedIpcResponse(channel, { ok: true, value }), (error: unknown) => {
      const result = error as { code?: string; recoverable?: boolean; details?: { channel?: string } }
      return result.code === 'INTERNAL_ERROR' && result.recoverable === true && result.details?.channel === channel
    })
  }
  for (const value of [
    { ...trial, summary: { ...trial.summary, autosaveCheckpoints: 1 } },
    { ...trial, summary: { ...trial.summary, autosaveConflictFreeRate: 2 } },
    { ...trial, summary: { ...trial.summary, aiTasks: 1, aiSucceeded: 2, aiSuccessRate: 2 } },
    { ...trial, summary: { ...trial.summary, aiTasks: 1, aiRetries: 2, aiRetryRate: 2 } }
  ]) assert.throws(() => unwrapValidatedIpcResponse('projects:real-trial-report', { ok: true, value }), (error: unknown) => {
    const result = error as { code?: string; recoverable?: boolean; details?: { channel?: string } }
    return result.code === 'INTERNAL_ERROR' && result.recoverable === true && result.details?.channel === 'projects:real-trial-report'
  })
})

test('validates workspace definition, world rules and prompt-profile results before renderer use', () => {
  const bookProfile = {
    genre: '轻小说', subgenre: '校园奇幻', coreIdea: '怪物少女同居喜剧', plannedVolumes: 8, chaptersPerVolume: 55,
    targetWordsPerChapter: 4_900, targetWords: 2_000_000, audienceScale: '轻松日常', defaultPov: '第三人称限知',
    narrativeDistance: '贴近男主', writingStyle: '自然对白、笑话和吐槽推动节奏', proseExpansionMode: 'web-serial',
    reviewStrictness: 'balanced', chapterGenerationMode: 'reviewed', autosaveEnabled: true, autosaveDelayMs: 1_500,
    autosaveMergeWindowMs: 30_000
  }
  const contextBudget = {
    version: 1, inputBudgetTokens: 48_000, modelContextLimit: 150_000, outputReservePercent: 25, systemReserveTokens: 10_000, recentSummaryCount: 3, structuredRepairAttempts: 1, minimumFactImportance: 'medium', showFactConfirmations: false, pinnedEvidenceKeys: ['workspace:character-state'],
    excludedEvidenceKeys: ['workspace:materials'], alwaysConfirmBeforeSend: true
  }
  const foundation = {
    creationPath: 'materials', sourceNotes: '男主刚转学。', worldView: '现代校园与隐秘怪物社会重叠。',
    useRealms: false, useSystem: true
  }
  const realm = { id: 'realm-1', name: '幼体', description: '能力尚未稳定，使用后需要休息。' }
  const draft = {
    worldView: foundation.worldView, useRealms: true, realms: [realm], useSystem: true,
    systemTemplate: '[状态]\n姓名：{{name}}', rationale: '固定展示方式，避免正文中的界面随机变化。'
  }
  const timeline = {
    events: [{ id: 'event-1', title: '转学', time: '第一卷第一天早晨', characters: '李远明、班主任',
      location: '教室', event: '李远明转入新班级。', result: '第一次见到怪物少女。' }]
  }
  const authorityLayers = [
    { id: 'guardrails', order: 1, label: '安全与一致性门禁', source: '产品内置', summary: '作品隔离与候选边界。' },
    { id: 'canon', order: 2, label: '本书正式事实', source: '当前作品', summary: '已确认的设定与事件。' },
    { id: 'taskContext', order: 3, label: '当前任务现场', source: '即时装配', summary: '当前章节上下文。' },
    { id: 'taskStrategy', order: 4, label: '任务写法策略', source: '题材基线', summary: '节奏与文风。' },
    { id: 'materials', order: 5, label: '素材证据', source: '作者资料', summary: '只作为证据和灵感。' }
  ]
  const promptEntry = (task: 'outline' | 'chapterOutline' | 'prose' | 'review') => ({
    task, label: task, description: `${task} 的用途`, builtIn: `${task} 内置策略`, override: '',
    effective: `${task} 内置策略`, customized: false, guardrails: ['只使用当前作品的事实。'], authorityLayers
  })
  const promptProfile = {
    version: 1, workItemId: 'E:\\作品\\星城少年们的日常录', genreLabel: '轻小说 / 校园奇幻',
    genreFingerprint: 'a'.repeat(64), storedGenreFingerprint: 'a'.repeat(64), baselineChanged: false,
    storageMode: 'sqlite', mirrorStatus: 'synced',
    entries: (['outline', 'chapterOutline', 'prose', 'review'] as const).map(promptEntry)
  }

  for (const [channel, value] of [
    ['workspace:get-book-profile', bookProfile],
    ['workspace:save-book-profile', bookProfile],
    ['workspace:get-context-budget-preferences', contextBudget],
    ['workspace:save-context-budget-preferences', contextBudget],
    ['workspace:generate-foundation-draft', draft],
    ['workspace:get-foundation', foundation],
    ['workspace:save-foundation', foundation],
    ['workspace:get-foundation-status', { readyForChapterOutline: true, readyForProse: false, missing: ['当前章节大纲'] }],
    ['workspace:get-timeline', timeline],
    ['workspace:save-timeline', timeline],
    ['workspace:get-realms', { levels: [realm] }],
    ['workspace:save-realms', { levels: [realm] }],
    ['workspace:get-power-system', { overview: '力量来自怪物特性。' }],
    ['workspace:save-power-system', { overview: '力量来自怪物特性。' }],
    ['workspace:get-cheat-system', { overview: '男主能辨认怪物情绪。' }],
    ['workspace:save-cheat-system', { overview: '男主能辨认怪物情绪。' }],
    ['workspace:get-system-template', { template: '[状态]\n姓名：{{name}}' }],
    ['workspace:save-system-template', { template: '[状态]\n姓名：{{name}}' }],
    ['workspace:get-prompt-profile', promptProfile],
    ['workspace:save-prompt-override', promptProfile],
    ['workspace:reset-prompt-override', promptProfile],
    ['workspace:recover-damaged-prompt-profile', { success: true, recoveryRelativePath: '.webnovel/config/recovery/prompt-profile.json' }],
    ['workspace:reveal-bootstrap-issue', { success: true, relativePath: '.webnovel/config/prompt-profile.json' }]
  ] as const) assert.deepEqual(unwrapValidatedIpcResponse(channel, { ok: true, value }), value)

  for (const [channel, value] of [
    ['workspace:get-book-profile', { ...bookProfile, targetWordsPerChapter: 100 }],
    ['workspace:save-book-profile', { ...bookProfile, chapterGenerationMode: 'slow' }],
    ['workspace:get-context-budget-preferences', { ...contextBudget, inputBudgetTokens: 500 }],
    ['workspace:save-context-budget-preferences', { ...contextBudget, excludedEvidenceKeys: contextBudget.pinnedEvidenceKeys }],
    ['workspace:generate-foundation-draft', { ...draft, useRealms: true, realms: [] }],
    ['workspace:get-foundation', { ...foundation, sourceNotes: '含有\0空字符' }],
    ['workspace:save-foundation', { ...foundation, creationPath: 'ai' }],
    ['workspace:get-foundation-status', { readyForChapterOutline: false, readyForProse: true, missing: [] }],
    ['workspace:get-timeline', { events: [{ ...timeline.events[0], location: '' }] }],
    ['workspace:save-timeline', { events: [{ ...timeline.events[0], characters: '' }] }],
    ['workspace:get-realms', { levels: [{ ...realm, description: '' }] }],
    ['workspace:save-realms', { levels: [{ ...realm, name: '' }] }],
    ['workspace:get-power-system', { overview: 42 }],
    ['workspace:save-power-system', { overview: 'x'.repeat(1_000_001) }],
    ['workspace:get-cheat-system', { overview: 'x'.repeat(100_001) }],
    ['workspace:save-cheat-system', { overview: null }],
    ['workspace:get-system-template', { template: 'x'.repeat(100_001) }],
    ['workspace:save-system-template', { template: 42 }],
    ['workspace:get-prompt-profile', { ...promptProfile, apiKey: 'PRIVATE-SHOULD-NOT-ECHO' }],
    ['workspace:save-prompt-override', { ...promptProfile, entries: promptProfile.entries.slice(0, 3) }],
    ['workspace:reset-prompt-override', { ...promptProfile, storageMode: 'files', mirrorStatus: 'synced' }],
    ['workspace:recover-damaged-prompt-profile', { success: false, recoveryRelativePath: '../../secret.json' }],
    ['workspace:reveal-bootstrap-issue', { success: true, relativePath: '../../secret.json' }]
  ] as const) {
    assert.throws(() => unwrapValidatedIpcResponse(channel, { ok: true, value }), (error: unknown) => {
      const result = error as { code?: string; recoverable?: boolean; details?: { channel?: string } }
      return result.code === 'INTERNAL_ERROR' && result.recoverable === true
        && result.details?.channel === channel && !JSON.stringify(result).includes('PRIVATE-SHOULD-NOT-ECHO')
    })
  }
})

test('validates the complete workspace bootstrap snapshot before opening a work item', () => {
  const root = 'E:\\作品\\星城少年们的日常录'
  const modelProfile = { connectionId: 'gemini', model: 'gemini-3.1-pro', temperature: 0.7, topP: 0.9, maxTokens: 8_000 }
  const authorityLayers = [
    { id: 'guardrails', order: 1, label: '边界', source: '产品内置', summary: '隔离当前作品。' },
    { id: 'canon', order: 2, label: '正式事实', source: '当前作品', summary: '使用已确认事实。' },
    { id: 'taskContext', order: 3, label: '任务现场', source: '即时装配', summary: '使用当前章节上下文。' },
    { id: 'taskStrategy', order: 4, label: '写法策略', source: '题材基线', summary: '保持网络小说节奏。' },
    { id: 'materials', order: 5, label: '素材证据', source: '作者资料', summary: '素材只作证据和灵感。' }
  ]
  const promptEntry = (task: 'outline' | 'chapterOutline' | 'prose' | 'review') => ({
    task, label: task, description: `${task} 的用途`, builtIn: `${task} 内置策略`, override: '',
    effective: `${task} 内置策略`, customized: false, guardrails: [], authorityLayers
  })
  const snapshot = {
    version: 1,
    workItem: { id: root, path: root },
    chapters: [],
    outlines: { total: null, volumes: [], stages: [], chapterOutlines: [] },
    timeline: { events: [] },
    realms: { levels: [] },
    powerSystem: { overview: '' },
    cheatSystem: { overview: '' },
    systemTemplate: { template: '' },
    foundation: { creationPath: 'materials', sourceNotes: '', worldView: '', useRealms: false, useSystem: false },
    bookProfile: {
      genre: '轻小说', subgenre: '校园奇幻', coreIdea: '怪物少女同居喜剧', plannedVolumes: 8,
      chaptersPerVolume: 55, targetWordsPerChapter: 4_900, targetWords: 2_000_000,
      audienceScale: '', defaultPov: '', narrativeDistance: '', writingStyle: '',
      proseExpansionMode: 'web-serial', reviewStrictness: 'balanced', chapterGenerationMode: 'reviewed',
      autosaveEnabled: true, autosaveDelayMs: 1_500, autosaveMergeWindowMs: 30_000
    },
    aiSettings: {
      version: 2, connections: [{ id: 'gemini', name: 'Gemini 接口', baseUrl: 'https://example.test/v1', apiKeyConfigured: false }], apiKeyConfigured: false, routingMode: 'shared',
      shared: modelProfile,
      tasks: { outline: modelProfile, chapterOutline: modelProfile, prose: modelProfile, review: modelProfile }
    },
    researchSettings: { baseUrl: 'https://example.test/v1', model: 'search-model', apiKeyConfigured: false },
    migration: {
      currentVersion: 2, targetVersion: 2, required: false, format: 'lanjian-current',
      canMigrate: false, reviewRequired: false, operations: [], warnings: [], issues: []
    },
    sources: { sources: [] },
    events: { events: [] },
    planningDraft: null,
    promptProfile: {
      version: 1, workItemId: root, genreLabel: '轻小说 / 校园奇幻',
      genreFingerprint: 'a'.repeat(64), storedGenreFingerprint: 'a'.repeat(64), baselineChanged: false,
      storageMode: 'sqlite', mirrorStatus: 'synced',
      entries: (['outline', 'chapterOutline', 'prose', 'review'] as const).map(promptEntry)
    },
    importRecoveries: [],
    continuation: { candidate: null },
    issues: []
  }

  assert.deepEqual(unwrapValidatedIpcResponse('workspace:bootstrap', { ok: true, value: snapshot }), snapshot)

  for (const value of [
    { ...snapshot, workItem: { id: root, path: 'E:\\作品\\另一部小说' } },
    { ...snapshot, aiSettings: { ...snapshot.aiSettings, apiKey: 'PRIVATE-SHOULD-NOT-ECHO' } },
    {
      ...snapshot,
      issues: [{
        id: 'promptProfileUnreadable', area: 'planningDraft', recovery: 'quarantinePromptProfile',
        title: '提示词配置损坏', message: '需要恢复。'
      }]
    }
  ]) {
    assert.throws(() => unwrapValidatedIpcResponse('workspace:bootstrap', { ok: true, value }), (error: unknown) => {
      const result = error as { code?: string; recoverable?: boolean; details?: { channel?: string } }
      return result.code === 'INTERNAL_ERROR' && result.recoverable === true
        && result.details?.channel === 'workspace:bootstrap' && !JSON.stringify(result).includes('PRIVATE-SHOULD-NOT-ECHO')
    })
  }
})

test('validates workspace workflow, canon ledgers and generation-task results before renderer use', () => {
  const now = '2026-09-05T01:00:00.000Z'
  const taskId = '11111111-2222-4333-8444-555555555555'
  const ideaId = '21111111-2222-4333-8444-555555555555'
  const entityId = '31111111-2222-4333-8444-555555555555'
  const relatedEntityId = '41111111-2222-4333-8444-555555555555'
  const revision = 'a'.repeat(64)
  const workflow = {
    creationPath: 'materials', completed: 5, total: 6, currentStep: 'chapterPlan',
    steps: [{ id: 'chapterPlan', label: '章纲', state: 'current', detail: '等待确认当前章纲', missing: ['当前章节大纲'], target: 'outline' }],
    readyForChapterOutline: true, readyForProse: false, missingForChapterOutline: [], missingForProse: ['当前章节大纲']
  }
  const review = {
    scope: 'total', status: 'clear', issues: [],
    metrics: { characterCount: 10, sectionCount: 1, causalCueCount: 1, eventCount: 1, chapterCount: 1 }, fingerprint: revision
  }
  const approval = { scope: 'total', status: 'ready', canConfirm: true, reason: '', fingerprint: revision }
  const planning = {
    totalRevision: 1, totalOutlineExists: true, externalChangeDetected: false, totalReview: review, totalApproval: approval,
    assignedEventIds: [], unplacedEventIds: [], volumes: [], chapterPlacements: [], eventChapterPlacements: []
  }
  const finding = {
    code: 'LOCATION_JUMP', layer: 'deterministic', severity: 'attention', message: '地点变化缺少移动说明。',
    characterId: entityId, characterName: '李远明', fromChapter: 1, toChapter: 2, evidence: ['上一章仍在教室。'],
    findingId: taskId, findingStatus: 'open', sourceBodyVersionId: taskId, sourceContentHash: revision,
    suggestedAction: '补充移动过程。', confidence: 0.9
  }
  const consistency = {
    status: 'attention', readyForProse: true, chapterId: 2, chapterPosition: 2, summary: '有一项可核对提醒。', blockers: [],
    items: [{ id: 'characterState', label: '人物状态', status: 'attention', summary: '地点承接待核对', target: 'world', issues: [], findings: [finding] }]
  }
  const derivatives = {
    bodyVersionId: taskId,
    factBatches: { current: 1, stale: 0 },
    summaries: { current: 1, stale: 0 },
    ruleRuns: { current: 2, stale: 1 }
  }
  const chapterProjection = { chapterId: 2, workflow, planning, consistency, derivatives }
  const historyEntry = { id: entityId, title: '重复段落', rationale: '原来有两段重复。', status: 'fixed', sourceBodyVersionId: relatedEntityId, resultingBodyVersionId: taskId, updatedAt: now }
  const findingHistory = { bodyVersionId: taskId, entries: [historyEntry] }
  const chapterSummary = { chapterId: 1, bodyVersionId: taskId, content: '李远明完成转学并见到同桌。', createdAt: now, status: 'approved' }
  const aliases = [{ characterId: entityId, canonicalName: '李远明', alias: '远明' }]
  const entity = { id: entityId, entityType: 'character', canonicalName: '李远明', profileJson: '{"role":"主角"}', status: 'approved', createdAt: now, updatedAt: now }
  const worldRule = { ...entity, id: relatedEntityId, entityType: 'world_rule', canonicalName: '怪物隐匿规则', profileJson: '{"rule":"不得公开身份"}' }
  const relation = { id: taskId, subjectEntityId: entityId, predicate: '受规则约束', objectEntityId: relatedEntityId, notes: '', createdAt: now, updatedAt: now }
  const baseIdea = { id: ideaId, title: '同桌异常', content: '同桌总能提前知道老师的问题。', status: 'approved', promotedToType: null, promotedToId: null, createdAt: now, updatedAt: now }
  const promotedIdea = { ...baseIdea, promotedToType: 'world_rule', promotedToId: relatedEntityId }
  const summaryIdea = { ...baseIdea, promotedToType: 'summary', promotedToId: 'summary-root' }
  const ideaTask = { id: taskId, ideaId, mode: 'diverge', status: 'queued', model: 'gemini-3.1-pro', createdAt: now, sourceStale: false, proposal: null, error: null }
  const outlineSource = { projectFingerprint: revision, key: 'total', kind: 'summary', title: '故事总纲', content: '故事从转学开始。', revision }
  const expansionRequest = { operationId: taskId, parentKey: 'total', expectedRevision: revision, count: 1, instruction: '' }
  const expansionTask = { id: taskId, status: 'queued', createdAt: now, model: 'gemini-3.1-pro', request: expansionRequest, sourceStale: false, proposal: null, error: null, adoptedKeys: [] }
  const expansionPreview = { token: taskId, taskId, parentTitle: '故事总纲', children: [{ key: 'volume-1', title: '第一卷', content: '# 第一卷' }] }
  const resourceEntry = { id: taskId, operationKey: ideaId, resourceEntityId: relatedEntityId, resourceName: '信任值', eventId: null, factId: null, delta: 1, resultingQuantity: 1, note: '', createdAt: now }
  const resourceBalance = { resourceEntityId: relatedEntityId, resourceName: '信任值', quantity: 1, isNegative: false, lastChangedAt: now }
  const foreshadow = { id: entityId, title: '同桌提前知道答案', normalizedTitle: '同桌提前知道答案', status: 'open', plantedChapterId: 1, payoffChapterId: null, dataJson: '{}', createdAt: now, updatedAt: now }
  const foreshadowAction = { id: taskId, operationKey: ideaId, foreshadowId: entityId, foreshadowTitle: foreshadow.title, chapterId: 1, action: 'plant', description: '课堂异常', evidence: '她提前写下答案。', sourceType: 'chapter_draft', createdAt: now }
  const snapshot = { characterId: entityId, name: '李远明', throughChapter: 1, present: true, location: '教室', vitality: 'alive', lastEventId: taskId }
  const stateEvent = { id: taskId, characterId: entityId, chapterId: 1, chapterPosition: 1, manuscriptRevision: revision, proposalId: ideaId, acceptedAt: now, evidence: '李远明坐在教室。', active: true, changes: { present: true, location: '教室', vitality: 'alive' }, changeEvidence: { location: '李远明坐在教室。' } }
  const characterState = { version: 1, workItemId: 'E:\\作品\\怪物少女', anchors: [{ id: entityId, name: '李远明', role: '主角', sourceRefs: ['planning:character-1'] }], events: [stateEvent], snapshots: [snapshot], pendingConflicts: [] }
  const characterLines = { version: 1, workItemId: characterState.workItemId, source: 'sqlite-approved-facts', lines: [{ characterId: entityId, name: '李远明', points: [{ ...snapshot, chapterId: 1, chapterPosition: 1, source: 'approved_fact', sourceId: taskId }] }] }
  const taskCenterItem = { id: taskId, workItemId: 'book-1', taskType: 'writing_agent', status: 'paused', label: '智能助笔', detail: '续写这一段', chapterId: 1, attempt: 1, createdAt: now, updatedAt: now, actions: ['resume', 'view', 'cancel'] }

  for (const [channel, value] of [
    ['workspace:list-task-center', [taskCenterItem]],
    ['workspace:list-task-center', [{ ...taskCenterItem, status: 'resuming', actions: ['pause', 'view', 'cancel'] }]],
    ['workspace:list-task-center', [{ ...taskCenterItem, hasContinuation: true, actions: ['view'] }]],
    ['workspace:list-task-center', [{ ...taskCenterItem, hasContinuation: false, actions: ['view', 'cancel'] }]],
    ['workspace:get-chapter-projection', chapterProjection],
    ['workspace:get-chapter-projection', { ...chapterProjection, findingHistory }],
    ['workspace:get-chapter-projection', { ...chapterProjection, findingHistory: { ...findingHistory, entries: [{ ...historyEntry, status: 'stale', resultingBodyVersionId: relatedEntityId }] } }],
    ['workspace:get-workflow-status', workflow],
    ['workspace:get-consistency-overview', consistency],
    ['workspace:decide-consistency-finding', undefined],
    ['workspace:save-chapter-summary', chapterSummary],
    ['workspace:get-chapter-summary', chapterSummary],
    ['workspace:list-character-aliases', aliases],
    ['workspace:replace-character-aliases', aliases],
    ['workspace:list-story-entities', [entity, worldRule]],
    ['workspace:save-story-entity', entity],
    ['workspace:list-ideas', [baseIdea]],
    ['workspace:save-idea', baseIdea],
    ['workspace:start-idea-generation', ideaTask],
    ['workspace:retry-idea-generation', { ...ideaTask, status: 'queued' }],
    ['workspace:list-idea-generations', [ideaTask]],
    ['workspace:idea-generation', ideaTask],
    ['workspace:cancel-idea-generation', { ...ideaTask, status: 'cancelled' }],
    ['workspace:get-planning-outline', outlineSource],
    ['workspace:start-outline-expansion', expansionTask],
    ['workspace:retry-outline-expansion', { ...expansionTask, status: 'queued' }],
    ['workspace:list-outline-expansions', [expansionTask]],
    ['workspace:cancel-outline-expansion', { ...expansionTask, status: 'cancelled' }],
    ['workspace:preview-outline-expansion-adoption', expansionPreview],
    ['workspace:adopt-outline-expansion', { keys: ['volume-1'], mirrorPending: false }],
    ['workspace:promote-idea-world-rule', { idea: promotedIdea, entity: worldRule }],
    ['workspace:promote-idea-summary', { idea: summaryIdea }],
    ['workspace:list-story-entity-relations', [relation]],
    ['workspace:save-story-entity-relation', relation],
    ['workspace:get-resource-ledger', { balances: [resourceBalance], entries: [resourceEntry] }],
    ['workspace:append-resource-ledger', { entry: resourceEntry, balance: resourceBalance, idempotent: false }],
    ['workspace:get-foreshadow-ledger', { foreshadows: [foreshadow], actions: [foreshadowAction] }],
    ['workspace:record-foreshadow-action', { foreshadow, action: foreshadowAction, idempotent: false }],
    ['workspace:get-character-state', characterState],
    ['workspace:get-character-lines', characterLines],
    ['workspace:dismiss-character-conflict', characterState]
  ] as const) assert.deepEqual(unwrapValidatedIpcResponse(channel, { ok: true, value }), value)
  const newAnchorState = {
    ...characterState,
    events: [],
    snapshots: [{ characterId: entityId, name: '李远明', throughChapter: 0, present: false, lastEventId: '' }]
  }
  assert.deepEqual(unwrapValidatedIpcResponse('workspace:get-character-state', { ok: true, value: newAnchorState }), newAnchorState)
  assert.equal(unwrapValidatedIpcResponse('workspace:get-chapter-summary', { ok: true, value: null }), null)
  assert.equal(unwrapValidatedIpcResponse('workspace:get-planning-outline', { ok: true, value: null }), null)

  for (const [channel, value] of [
    ['workspace:list-task-center', [{ ...taskCenterItem, actions: ['resume', 'resume', 'view'] }]],
    ['workspace:list-task-center', [{ ...taskCenterItem, hasContinuation: 'false' }]],
    ['workspace:list-task-center', [{ ...taskCenterItem, hasContinuation: null }]],
    ['workspace:get-chapter-projection', { ...chapterProjection, chapterId: 3 }],
    ...[
      { ...findingHistory, bodyVersionId: relatedEntityId },
      { ...findingHistory, entries: [historyEntry, historyEntry] },
      ...[{ resultingBodyVersionId: null }, { resultingBodyVersionId: undefined }, { resultingBodyVersionId: relatedEntityId }, { sourceBodyVersionId: taskId }, { updatedAt: 'not-a-date' }, { status: 'resolved' }].map(patch => ({ ...findingHistory, entries: [{ ...historyEntry, ...patch }] }))
    ].map(findingHistory => ['workspace:get-chapter-projection', { ...chapterProjection, findingHistory }] as const),
    ['workspace:get-chapter-projection', { ...chapterProjection, derivatives: { ...derivatives, ruleRuns: { current: -1, stale: 0 } } }],
    ['workspace:get-workflow-status', { ...workflow, readyForProse: true }],
    ['workspace:get-consistency-overview', { ...consistency, status: 'blocked', readyForProse: true }],
    ['workspace:decide-consistency-finding', { success: true }],
    ['workspace:save-chapter-summary', { ...chapterSummary, content: '' }],
    ['workspace:get-chapter-summary', { ...chapterSummary, status: 'current' }],
    ['workspace:list-character-aliases', [{ ...aliases[0], alias: '' }]],
    ['workspace:replace-character-aliases', [{ ...aliases[0], characterId: '' }]],
    ['workspace:list-story-entities', [{ ...entity, profileJson: 'not-json' }]],
    ['workspace:save-story-entity', { ...entity, entityType: 'unknown' }],
    ['workspace:list-ideas', [{ ...baseIdea, promotedToType: 'summary' }]],
    ['workspace:save-idea', { ...baseIdea, content: '' }],
    ['workspace:start-idea-generation', { ...ideaTask, status: 'succeeded' }],
    ['workspace:retry-idea-generation', { ...ideaTask, status: 'succeeded' }],
    ['workspace:list-idea-generations', [{ ...ideaTask, status: 'failed', error: null }]],
    ['workspace:idea-generation', { ...ideaTask, status: 'succeeded' }],
    ['workspace:cancel-idea-generation', { ...ideaTask, proposal: { options: [] } }],
    ['workspace:get-planning-outline', { ...outlineSource, revision: 'short' }],
    ['workspace:start-outline-expansion', { ...expansionTask, request: { ...expansionRequest, count: 20 } }],
    ['workspace:retry-outline-expansion', { ...expansionTask, request: { ...expansionRequest, count: 20 } }],
    ['workspace:list-outline-expansions', [{ ...expansionTask, status: 'succeeded' }]],
    ['workspace:cancel-outline-expansion', { ...expansionTask, error: 42 }],
    ['workspace:preview-outline-expansion-adoption', { ...expansionPreview, children: [] }],
    ['workspace:adopt-outline-expansion', { keys: ['volume-1', 'volume-1'], mirrorPending: false }],
    ['workspace:promote-idea-world-rule', { idea: promotedIdea, entity }],
    ['workspace:promote-idea-summary', { idea: baseIdea }],
    ['workspace:list-story-entity-relations', [{ ...relation, predicate: '' }]],
    ['workspace:save-story-entity-relation', { ...relation, updatedAt: 'not-a-date' }],
    ['workspace:get-resource-ledger', { balances: [{ ...resourceBalance, isNegative: true }], entries: [] }],
    ['workspace:append-resource-ledger', { entry: resourceEntry, balance: { ...resourceBalance, resourceEntityId: entityId }, idempotent: false }],
    ['workspace:get-foreshadow-ledger', { foreshadows: [{ ...foreshadow, dataJson: 'not-json' }], actions: [] }],
    ['workspace:record-foreshadow-action', { foreshadow, action: { ...foreshadowAction, foreshadowId: relatedEntityId }, idempotent: false }],
    ['workspace:get-character-state', { ...characterState, events: [{ ...stateEvent, manuscriptRevision: 'short' }] }],
    ['workspace:get-character-lines', { ...characterLines, source: 'mixed' }],
    ['workspace:dismiss-character-conflict', { ...characterState, pendingConflicts: [{ id: 'wrong' }] }]
  ] as const) {
    assert.throws(() => unwrapValidatedIpcResponse(channel, { ok: true, value }), (error: unknown) => {
      const result = error as { code?: string; recoverable?: boolean; details?: { channel?: string } }
      return result.code === 'INTERNAL_ERROR' && result.recoverable === true && result.details?.channel === channel
    })
  }
})

test('validates migration, outline, writing-task and fact-review result gates', () => {
  const review = {
    scope: 'total', status: 'clear', issues: [],
    metrics: { characterCount: 0, sectionCount: 1, causalCueCount: 0, eventCount: 0, chapterCount: 0 },
    fingerprint: 'outline-fingerprint'
  }
  const approval = {
    scope: 'total', status: 'ready', canConfirm: true, reason: '', fingerprint: 'outline-fingerprint'
  }
  const planning = {
    totalRevision: 1, totalOutlineExists: true, externalChangeDetected: false,
    totalReview: review, totalApproval: approval, assignedEventIds: [], unplacedEventIds: [],
    volumes: [], chapterPlacements: [], eventChapterPlacements: []
  }
  assert.deepEqual(unwrapValidatedIpcResponse('outlines:planning-status', { ok: true, value: planning }), planning)

  const task = {
    id: '00000000-0000-4000-8000-000000000201', workItemId: 'work-1', chapterId: 1,
    status: 'queued', attempt: 1, message: '续写下一场', baseDraft: '　　雨落长街。'
  }
  assert.deepEqual(unwrapValidatedIpcResponse('ai:start-writing-agent', { ok: true, value: task }), task)

  const batch = {
    id: '00000000-0000-4000-8000-000000000202', workItemId: 'work-1', chapterId: 1,
    bodyVersionId: '00000000-0000-4000-8000-000000000203', contentHash: 'b'.repeat(64),
    status: 'PENDING', extractorTaskRunId: null, countsJson: '{}', changes: [],
    createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z'
  }
  assert.deepEqual(unwrapValidatedIpcResponse('workspace:list-fact-batches', { ok: true, value: [batch] }), [batch])

  const storage = {
    storageMode: 'sqlite', databaseExists: true, chapterCount: 2, outlineCount: 4,
    outlineStorageMode: 'sqlite', promptStorageMode: 'sqlite', promptMirrorStatus: 'synced',
    outlinePendingMirrors: 0, outlineConflictMirrors: 0, outlineFailedMirrors: 0,
    pendingMirrors: 0, conflictMirrors: 0, failedMirrors: 0
  }
  assert.deepEqual(unwrapValidatedIpcResponse('projects:sqlite-storage-status', { ok: true, value: storage }), storage)
  const fileText = { ...storage, textAuthority: 'files-v1' }
  assert.deepEqual(unwrapValidatedIpcResponse('projects:sqlite-storage-status', { ok: true, value: fileText }), fileText)
  assert.throws(() => unwrapValidatedIpcResponse('projects:sqlite-storage-status', { ok: true, value: { ...storage, textAuthority: 'guess-from-file' } }))

  for (const [channel, value] of [
    ['outlines:planning-status', { ...planning, totalApproval: { ...approval, canConfirm: 'yes' } }],
    ['ai:start-writing-agent', { ...task, status: 'completed' }],
    ['workspace:list-fact-batches', [{ ...batch, countsJson: 'not-json' }]],
    ['projects:sqlite-storage-status', { ...storage, pendingMirrors: -1 }]
  ] as const) {
    assert.throws(() => unwrapValidatedIpcResponse(channel, { ok: true, value }), (error: unknown) => {
      const result = error as { code?: string; recoverable?: boolean; details?: { channel?: string } }
      return result.code === 'INTERNAL_ERROR' && result.recoverable === true && result.details?.channel === channel
    })
  }
})

test('validates multi-document import and continuation adoption results', () => {
  const preview = {
    token: '00000000-0000-4000-8000-000000000301', fileName: '旧稿.md', suggestedTitle: '旧稿',
    sourceFormat: 'Markdown', encoding: 'UTF-8', bytes: 120, characterCount: 100, wordCount: 80,
    chapterCount: 1, detectedHeadings: true,
    chapters: [{ sourceIndex: 0, order: 1, chapterNumber: 1, title: '归来', wordCount: 80, preview: '雨夜归来。', status: 'ready', issues: [], selectedByDefault: true }],
    recommendedChapterCount: 1, reviewRequired: false, warnings: []
  }
  const manifest = {
    id: '00000000-0000-4000-8000-000000000302',
    files: [{ ...preview, recommendedRole: 'manuscript', recommendationReason: '识别到章节标题' }],
    totalBytes: 120, totalWordCount: 80, warnings: []
  }
  assert.deepEqual(unwrapValidatedIpcResponse('imports:choose-documents', { ok: true, value: manifest }), manifest)

  const candidate = {
    version: 1, id: '00000000-0000-4000-8000-000000000303', workItemId: 'work-1', manifestId: manifest.id,
    sourceFingerprint: 'source-fingerprint', createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
    status: 'candidate', sections: [], gaps: [], rationale: '等待作者逐项确认。'
  }
  const definitionPreview = {
    candidateId: candidate.id, area: 'projectDefinition', currentCoreIdea: '', candidateCoreIdea: '雨夜归来后寻找真相',
    candidateFingerprint: 'candidate-fingerprint', currentProfileFingerprint: 'profile-fingerprint',
    preserved: ['已有作品标题'], canAdopt: true
  }
  assert.deepEqual(unwrapValidatedIpcResponse('imports:preview-continuation-project-definition', { ok: true, value: definitionPreview }), definitionPreview)
  assert.deepEqual(unwrapValidatedIpcResponse('imports:continuation-analysis', { ok: true, value: { candidate, availableManifestId: manifest.id } }), { candidate, availableManifestId: manifest.id })

  const adoptedCandidate = {
    ...candidate,
    adoption: { worldView: { candidateFingerprint: 'candidate-fingerprint', foundationFingerprint: 'foundation-fingerprint', adoptedAt: '2026-09-05T00:01:00.000Z' } }
  }
  assert.deepEqual(unwrapValidatedIpcResponse('imports:generate-continuation-analysis', { ok: true, value: adoptedCandidate }), adoptedCandidate)

  const totalOutlinePreview = {
    candidateId: candidate.id, area: 'totalOutline', currentOutline: '', candidateOutline: '故事总纲',
    candidateFingerprint: 'candidate-fingerprint', currentOutlineFingerprint: 'current-fingerprint', prerequisiteFingerprint: 'prerequisite-fingerprint',
    evidence: [], affected: { currentRevision: 0, totalConfirmed: false, volumeOutlines: 0, chapterOutlines: 0 },
    changes: true, canAdopt: true
  }
  assert.deepEqual(unwrapValidatedIpcResponse('imports:preview-continuation-total-outline', { ok: true, value: totalOutlinePreview }), totalOutlinePreview)

  const worldAdoption = {
    candidate,
    foundation: { creationPath: 'materials', sourceNotes: '来自旧稿', worldView: '现代都市存在隐秘异常。', useRealms: false, useSystem: false }
  }
  assert.deepEqual(unwrapValidatedIpcResponse('imports:adopt-continuation-world-view', { ok: true, value: worldAdoption }), worldAdoption)

  for (const [channel, value] of [
    ['imports:choose-documents', { ...manifest, files: [{ ...manifest.files[0], recommendedRole: 'external' }] }],
    ['imports:generate-continuation-analysis', { ...candidate, status: 'applied' }],
    ['imports:generate-continuation-analysis', { ...adoptedCandidate, adoption: { worldView: { candidateFingerprint: 'candidate-fingerprint', foundationFingerprint: 'foundation-fingerprint' } } }],
    ['imports:preview-continuation-project-definition', { ...definitionPreview, area: 'existingPlot' }],
    ['imports:preview-continuation-total-outline', { ...totalOutlinePreview, affected: { currentRevision: 0, volumeOutlines: 0, chapterOutlines: 0 } }],
    ['imports:adopt-continuation-world-view', { candidate }]
  ] as const) {
    assert.throws(() => unwrapValidatedIpcResponse(channel, { ok: true, value }), (error: unknown) => {
      const result = error as { code?: string; recoverable?: boolean; details?: { channel?: string } }
      return result.code === 'INTERNAL_ERROR' && result.recoverable === true && result.details?.channel === channel
    })
  }
})

test('validates automatic-planning proposals, adoption gates and generation jobs', () => {
  const proposal = {
    id: 'planning-proposal-1', workItemId: 'work-1', createdAt: '2026-09-05T01:00:00.000Z',
    basedOn: { inputFingerprint: 'input-fingerprint', blueprintFingerprint: 'blueprint-fingerprint', totalOutlineFingerprint: 'total-fingerprint' },
    blueprint: {
      premise: '一家人与怪物少女共同生活。', worldView: '现代城市中的隐秘异常。',
      characters: [{ name: '林知夏', role: '男主', arcSeed: '守住看似普通的日常。' }],
      powerSystem: '', cheatSystem: '', rationale: '以家庭日常串联异常事件。'
    },
    totalOutline: { title: '星城少年们的日常录', summary: '日常与异常相互碰撞。', content: '第一卷建立共同生活。' },
    volumes: [{ order: 1, title: '同桌与怪物', goal: '建立关系', summary: '发现异常。', ending: '决定共同面对。' }]
  }
  const job = {
    id: 'planning-job-1', workItemId: 'work-1', status: 'running', stage: 'blueprint',
    progress: { completed: 0, total: 3, message: '正在生成故事蓝图' }, startedAt: '2026-09-05T01:00:00.000Z'
  }
  const preview = {
    proposalId: proposal.id, candidateFingerprint: 'candidate-fingerprint', currentFingerprint: '', changes: true,
    current: { exists: false, excerpt: '', characterCount: 0, revision: 0, confirmed: false },
    candidate: { title: proposal.totalOutline.title, excerpt: proposal.totalOutline.content, characterCount: 10 },
    affected: { chapterOutlines: 0, confirmedVolumes: 0, totalConfirmation: false }
  }

  assert.deepEqual(unwrapValidatedIpcResponse('planning:draft', { ok: true, value: proposal }), proposal)
  assert.deepEqual(unwrapValidatedIpcResponse('planning:start', { ok: true, value: job }), job)
  assert.deepEqual(unwrapValidatedIpcResponse('planning:preview-total-adoption', { ok: true, value: preview }), preview)
  const adoptedPowerProposal = {
    ...proposal,
    adoption: { powerSystem: { fingerprint: 'power-candidate', adoptedAt: '2026-09-05T01:01:00.000Z', powerSystemFingerprint: 'power-formal' } }
  }
  assert.deepEqual(
    unwrapValidatedIpcResponse('planning:adopt-power-system', { ok: true, value: { proposal: adoptedPowerProposal, powerSystem: { overview: '' } } }),
    { proposal: adoptedPowerProposal, powerSystem: { overview: '' } }
  )

  for (const [channel, value] of [
    ['planning:start', { ...job, status: 'queued' }],
    ['planning:start', { ...job, progress: { ...job.progress, total: 4 } }],
    ['planning:draft', { ...proposal, basedOn: { ...proposal.basedOn, inputFingerprint: '' } }],
    ['planning:draft', { ...proposal, adoption: { worldSeed: { fingerprint: 'world', foundationFingerprint: 'foundation' } } }],
    ['planning:preview-total-adoption', { ...preview, affected: { chapterOutlines: 0, confirmedVolumes: 0 } }],
    ['planning:preview-total-adoption', { ...preview, candidateFingerprint: '' }],
    ['planning:adopt-power-system', { proposal, powerSystem: { overview: '' } }],
    ['planning:start-chapter-skeleton', { ...job, proposalId: proposal.id, stage: 'chapterDetail', progress: { completed: 0, total: 1, message: '生成骨架' } }],
    ['planning:start-chapter-detail', { ...job, proposalId: proposal.id, volume: 1, stage: 'chapterDetail', progress: { completed: 0, total: 0, message: '生成细纲' } }]
  ] as const) {
    assert.throws(() => unwrapValidatedIpcResponse(channel, { ok: true, value }), (error: unknown) => {
      const result = error as { code?: string; recoverable?: boolean; details?: { channel?: string } }
      return result.code === 'INTERNAL_ERROR' && result.recoverable === true && result.details?.channel === channel
    })
  }
})

test('validates research settings, traceable sources and four-part event results', () => {
  const settings = { baseUrl: 'https://ark.example.test/api/v3', model: 'doubao-search', apiKeyConfigured: true }
  const source = {
    id: 'source-1', provider: 'web-research', sourceType: 'web', url: 'https://example.test/article',
    title: '雨夜城市资料', capturedAt: '2026-09-05T02:00:00.000Z', excerpt: '旧城区排水系统的资料摘要。',
    userNotes: '改编为怪物藏身路径。', references: [{ title: '城市档案', url: 'https://archive.example.test/city' }],
    contentHash: 'a'.repeat(64)
  }
  const candidate = {
    id: 'event-1', time: '第一日雨夜', characters: ['林知夏', '转学生'], location: '旧城区下水道',
    event: '两人沿异常水声找到隐藏入口。', result: '确认怪物并非孤立出现。',
    evidenceRefs: [{ sourceId: source.id, excerpt: source.excerpt }], confidence: 0.85,
    status: 'candidate', createdAt: '2026-09-05T02:01:00.000Z'
  }
  const approved = { ...candidate, status: 'approved', approvedAt: '2026-09-05T02:02:00.000Z' }
  const search = {
    query: '旧城区排水系统', content: '搜索摘要', sources: [{ title: '城市档案', url: 'https://archive.example.test/city' }],
    searchedQueries: ['旧城区 排水 系统'], webSearchCalls: 1, model: 'doubao-search'
  }

  assert.deepEqual(unwrapValidatedIpcResponse('research:get-settings', { ok: true, value: settings }), settings)
  assert.deepEqual(unwrapValidatedIpcResponse('research:search', { ok: true, value: search }), search)
  assert.deepEqual(unwrapValidatedIpcResponse('research:list-sources', { ok: true, value: { sources: [source] } }), { sources: [source] })
  assert.deepEqual(unwrapValidatedIpcResponse('research:create-event-candidate', { ok: true, value: candidate }), candidate)
  assert.deepEqual(unwrapValidatedIpcResponse('research:approve-event', { ok: true, value: approved }), approved)

  for (const [channel, value] of [
    ['research:get-settings', { ...settings, apiKeyConfigured: 'yes' }],
    ['research:get-settings', { ...settings, baseUrl: 'file:///private/key' }],
    ['research:search', { ...search, sources: [{ title: '错误来源', url: 'javascript:alert(1)' }] }],
    ['research:list-sources', { sources: [{ ...source, contentHash: 'short' }] }],
    ['research:create-source', { ...source, url: undefined, references: [] }],
    ['research:create-event-candidate', { ...candidate, characters: [] }],
    ['research:create-event-candidate', { ...candidate, confidence: 2 }],
    ['research:create-event-candidate', approved],
    ['research:approve-event', { ...candidate, status: 'approved' }]
  ] as const) {
    assert.throws(() => unwrapValidatedIpcResponse(channel, { ok: true, value }), (error: unknown) => {
      const result = error as { code?: string; recoverable?: boolean; details?: { channel?: string } }
      return result.code === 'INTERNAL_ERROR' && result.recoverable === true && result.details?.channel === channel
    })
  }
})

test('requires bounded autosave baselines, operation ids and merge windows at the IPC boundary', () => {
  const operationId = '00000000-0000-4000-8000-000000000011'
  const bodyVersionId = '00000000-0000-4000-8000-000000000012'
  const revision = 'b'.repeat(64)
  assert.deepEqual(decodeChapterAutosaveStageArgs([3, {
    title: '夜航', content: '风从水面来。', clientOperationId: operationId,
    baseBodyVersionId: bodyVersionId, expectedRevision: revision, mergeWindowMs: 30_000
  }]), [3, {
    title: '夜航', content: '风从水面来。', clientOperationId: operationId,
    baseBodyVersionId: bodyVersionId, expectedRevision: revision, mergeWindowMs: 30_000
  }])
  assert.deepEqual(decodeAutosaveCheckpointIdArgs([bodyVersionId]), [bodyVersionId])
  assert.throws(() => decodeChapterAutosaveStageArgs([3, {
    title: '夜航', content: '正文', clientOperationId: '重复但不是 UUID', mergeWindowMs: 999
  }]), (error: unknown) => error instanceof AppError && error.code === 'VALIDATION_ERROR')
})

test('accepts partial bounded chapter-card updates without requiring a lifecycle transition', () => {
  const decoded = decodeChapterPlanningUpdateArgs([2, {
    card: {
      status: 'draft', goal: '找到来信来源', beats: ['检查邮戳', '询问守门人'],
      characters: ['沈砚', '守门人'], pointOfView: '第三人称限知'
    }
  }])
  assert.deepEqual(decoded, [2, {
    card: {
      status: 'draft', goal: '找到来信来源', beats: ['检查邮戳', '询问守门人'],
      characters: ['沈砚', '守门人'], pointOfView: '第三人称限知'
    }
  }])
  assert.deepEqual(decodeChapterPlanningUpdateArgs([2, { lifecycleStatus: 'REVIEWABLE' }]), [2, { lifecycleStatus: 'REVIEWABLE' }])
  assert.throws(() => decodeChapterPlanningUpdateArgs([2, { lifecycleStatus: 'DONE' }]), (error: unknown) => (
    error instanceof AppError && error.code === 'VALIDATION_ERROR'
  ))
  assert.throws(() => decodeChapterPlanningUpdateArgs([2, { card: { beats: Array(51).fill('过多') } }]), (error: unknown) => (
    error instanceof AppError && error.code === 'VALIDATION_ERROR'
  ))
})

test('validates conflict recovery drafts without accepting paths from renderer', async () => {
  assert.deepEqual(decodeChapterDraftRecoveryArgs([3, { title: '第三章', content: '未保存草稿', baseRevision: 'b'.repeat(64) }]), [
    3, { title: '第三章', content: '未保存草稿', baseRevision: 'b'.repeat(64) }
  ])
  assert.throws(() => decodeChapterDraftRecoveryArgs([3, { title: '第三章', content: '草稿', path: '../../正文.md' }]), (error: unknown) => (
    error instanceof AppError && error.code === 'VALIDATION_ERROR'
  ))
})

test('accepts only UUID draft job identifiers at the IPC boundary', async () => {
  const invoke = harness(decodeJobIdArgs, (jobId) => jobId)
  assert.equal(unwrapIpcResponse(await invoke('123e4567-e89b-42d3-a456-426614174000')), '123e4567-e89b-42d3-a456-426614174000')
  for (const value of ['', 'job-1', '../job', 42]) {
    const response = await invoke(value)
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('accepts only deterministic character conflict identifiers at the IPC boundary', async () => {
  const invoke = harness(decodeCharacterConflictIdArgs, (conflictId) => conflictId)
  const valid = 'conflict-0123456789abcdef01234567'
  assert.equal(unwrapIpcResponse(await invoke(valid)), valid)
  for (const value of ['', 'conflict-1', 'conflict-0123456789abcdef0123456g', '../conflict', 42]) {
    const response = await invoke(value)
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('accepts only a bounded integer chapter position at the IPC boundary', async () => {
  const reorder = harness(decodeChapterReorderArgs, (id, position) => ({ id, position }))
  assert.deepEqual(unwrapIpcResponse(await reorder(7, 2)), { id: 7, position: 2 })
  for (const response of [await reorder(7, 0), await reorder(7, 1.5), await reorder(7, '2'), await reorder(7, 1_000_001)]) {
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('returns a stable safe error envelope instead of leaking main-process exceptions', async () => {
  const expected = harness(decodeChapterIdArgs, () => {
    throw new AppError('NOT_FOUND', '章节不存在', { recoverable: true, details: { chapterId: 3 } })
  })
  const known = await expected(3)
  assert.deepEqual(known, {
    ok: false,
    error: { code: 'NOT_FOUND', message: '章节不存在', recoverable: true, details: { chapterId: 3 } }
  })

  const internal = harness(decodeChapterIdArgs, () => {
    throw new Error('C:\\Users\\author\\secret-work\\chapter.md')
  })
  const hidden = await internal(3)
  assert.equal(hidden.ok, false)
  if (!hidden.ok) {
    assert.equal(hidden.error.code, 'INTERNAL_ERROR')
    assert.equal(hidden.error.recoverable, true)
    assert.doesNotMatch(hidden.error.message, /Users|secret-work|chapter\.md/)
  }
})

test('rejects malformed project lifecycle input before filesystem access', async () => {
  const create = harness(decodeProjectCreateArgs, (input) => input)
  const valid = await create({ parentPath: 'C:\\书稿', name: '灯火照长安', genre: '历史' })
  assert.deepEqual(unwrapIpcResponse(valid), { parentPath: 'C:\\书稿', name: '灯火照长安', genre: '历史' })

  for (const input of [
    { parentPath: '..\\书稿', name: '越界' },
    { parentPath: 'C:\\书稿', name: '' },
    { parentPath: 'C:\\书稿', name: '作品', cloudSync: true },
    { parentPath: 'C:\\书稿', name: '书'.repeat(121) }
  ]) {
    const response = await create(input)
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }

  const path = harness(decodeProjectPathArgs, (value) => value)
  const relative = await path('.\\作品')
  assert.equal(relative.ok, false)
})

test('validates each book definition and its long-form size budget at the IPC boundary', async () => {
  const profile = harness(decodeBookProfileArgs, (value) => value)
  const valid = {
    genre: '都市', subgenre: '娱乐圈', coreIdea: '真正的 KING 穿越到三流歌手身上。',
    plannedVolumes: 4, chaptersPerVolume: 36, targetWordsPerChapter: 3200, targetWords: 2_000_000,
    audienceScale: '成年读者；不渲染血腥', defaultPov: '第三人称限知',
    narrativeDistance: '贴近主角当下感受', writingStyle: '克制，动作和对白推进',
    proseExpansionMode: 'web-serial', reviewStrictness: 'balanced', chapterGenerationMode: 'reviewed',
    autosaveEnabled: true, autosaveDelayMs: 1_500, autosaveMergeWindowMs: 30_000
  }
  assert.deepEqual(unwrapIpcResponse(await profile(valid)), valid)
  for (const input of [
    { ...valid, coreIdea: '  ' },
    { ...valid, plannedVolumes: 0 },
    { ...valid, chaptersPerVolume: 2.5 },
    { ...valid, targetWordsPerChapter: 50_001 },
    { ...valid, targetWords: 299 },
    { ...valid, targetWords: 2_500_000_001 },
    { ...valid, writingStyle: '文'.repeat(2_001) },
    { ...valid, proseExpansionMode: 'padding' },
    { ...valid, reviewStrictness: 'legal' },
    { ...valid, chapterGenerationMode: 'slow-pipeline' },
    { ...valid, autosaveEnabled: 'yes' },
    { ...valid, autosaveDelayMs: 249 },
    { ...valid, autosaveDelayMs: 1_500.5 },
    { ...valid, autosaveMergeWindowMs: 999 },
    { ...valid, autosaveMergeWindowMs: 600_001 },
    { ...valid, cloudProjectId: 'forbidden' }
  ]) {
    const response = await profile(input)
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('validates planning data and all four timeline dimensions at the IPC boundary', async () => {
  const foundation = harness(decodeFoundationArgs, (value) => value)
  assert.deepEqual(unwrapIpcResponse(await foundation({
    creationPath: 'materials', sourceNotes: '人物原型', worldView: '架空长安', useRealms: false, useSystem: false
  })), { creationPath: 'materials', sourceNotes: '人物原型', worldView: '架空长安', useRealms: false, useSystem: false })

  const timeline = harness(decodeTimelineArgs, (events) => events)
  const validEvent = { id: 'event-1', time: '冬至', characters: '沈砚', location: '长安', event: '发现密信' }
  assert.deepEqual(unwrapIpcResponse(await timeline([validEvent])), [validEvent])
  const titledEvent = { ...validEvent, title: '密信出现', result: '沈砚决定追查来处' }
  assert.deepEqual(unwrapIpcResponse(await timeline([titledEvent])), [titledEvent])

  const realms = harness(decodeRealmsArgs, (levels) => levels)
  const outline = harness(decodeOutlineUpdateArgs, (volume, content) => ({ volume, content }))
  const createVolume = harness(decodeOutlineVolumeCreateArgs, (title) => title)
  const renameVolume = harness(decodeOutlineVolumeRenameArgs, (volume, title) => ({ volume, title }))
  const createStage = harness(decodeOutlineStageCreateArgs, (volume, title) => ({ volume, title }))
  const updateStage = harness(decodeOutlineStageUpdateArgs, (stage, title, content) => ({ stage, title, content }))
  const placeChapterInStage = harness(decodeOutlineChapterStagePlacementArgs, (chapterId, stage, volume) => ({ chapterId, stage, volume }))
  const placeEvent = harness(decodeOutlineEventPlacementArgs, (eventId, volume) => ({ eventId, volume }))
  const placeEventInChapter = harness(decodeOutlineEventChapterPlacementArgs, (eventId, chapterIdValue) => ({ eventId, chapterId: chapterIdValue }))
  const placeChapter = harness(decodeOutlineChapterPlacementArgs, (chapterId, volume) => ({ chapterId, volume }))
  const eventId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  assert.deepEqual(unwrapIpcResponse(await placeEvent(eventId, 2)), { eventId, volume: 2 })
  assert.deepEqual(unwrapIpcResponse(await placeEvent(eventId, null)), { eventId, volume: null })
  assert.deepEqual(unwrapIpcResponse(await placeEventInChapter(eventId, 12)), { eventId, chapterId: 12 })
  assert.deepEqual(unwrapIpcResponse(await placeChapter(12, 2)), { chapterId: 12, volume: 2 })
  assert.deepEqual(unwrapIpcResponse(await placeChapter(12, null)), { chapterId: 12, volume: null })
  assert.deepEqual(unwrapIpcResponse(await renameVolume(2, '重返舞台')), { volume: 2, title: '重返舞台' })
  assert.deepEqual(unwrapIpcResponse(await createStage(2, '旧城追索')), { volume: 2, title: '旧城追索' })
  assert.deepEqual(unwrapIpcResponse(await updateStage(3, '钟楼回声', '这一阶段找到钟楼入口。')), { stage: 3, title: '钟楼回声', content: '这一阶段找到钟楼入口。' })
  assert.deepEqual(unwrapIpcResponse(await placeChapterInStage(12, 3, 2)), { chapterId: 12, stage: 3, volume: 2 })
  assert.deepEqual(unwrapIpcResponse(await placeChapterInStage(12, null, 2)), { chapterId: 12, stage: null, volume: 2 })
  for (const response of [
    await foundation({ creationPath: 'cloud', sourceNotes: '', worldView: '', useRealms: false, useSystem: false }),
    await foundation({ creationPath: 'materials', sourceNotes: '', worldView: '', useRealms: false, useSystem: false, login: true }),
    await timeline([{ ...validEvent, location: '  ' }]),
    await realms([{ id: 'realm-1', name: '炼体', description: '' }]),
    await outline('1', '卷纲'),
    await outline('total', '文'.repeat(2_000_001)),
    await createVolume('  '),
    await createVolume('卷'.repeat(121)),
    await renameVolume(0, '错误卷号'),
    await renameVolume(1, '  '),
    await createStage(0, '错误阶段'),
    await createStage(1, '阶'.repeat(121)),
    await updateStage(0, '错误阶段', ''),
    await updateStage(1, '  ', ''),
    await placeChapterInStage(0, 1, 1),
    await placeChapterInStage(1, 0, 1),
    await placeChapterInStage(1, 1, '1'),
    await placeEvent(eventId, 0),
    await placeEvent(eventId, '1'),
    await placeEvent('../../secret', 1),
    await placeEventInChapter(eventId, 0),
    await placeChapter(0, 1),
    await placeChapter(1, '1')
  ]) {
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('accepts only bounded one-time TXT import commit metadata', async () => {
  const commit = harness(decodeImportCommitArgs, (input) => input)
  const token = '11111111-2222-4333-8444-555555555555'
  assert.deepEqual(unwrapIpcResponse(await commit({ token, ownership: 'owned', creationMethod: 'human', title: '旧稿' })), {
    token, ownership: 'owned', creationMethod: 'human', title: '旧稿'
  })
  assert.deepEqual(unwrapIpcResponse(await commit({ token, ownership: 'owned', creationMethod: 'mixed', title: '乱稿', selectedChapterIndexes: [0, 1, 15] })), {
    token, ownership: 'owned', creationMethod: 'mixed', title: '乱稿', selectedChapterIndexes: [0, 1, 15]
  })
  assert.deepEqual(unwrapIpcResponse(await commit({ token, ownership: 'material', title: '作品相关' })), {
    token, ownership: 'material', title: '作品相关'
  })

  for (const response of [
    await commit({ token: '../../secret', ownership: 'owned', creationMethod: 'human', title: '旧稿' }),
    await commit({ token, ownership: 'external', creationMethod: 'ai', title: '外部作品' }),
    await commit({ token, ownership: 'owned', title: '旧稿' }),
    await commit({ token, ownership: 'owned', creationMethod: 'human', title: '书'.repeat(81) }),
    await commit({ token, ownership: 'owned', creationMethod: 'human', title: '旧稿', sourcePath: 'C:\\秘密.txt' }),
    await commit({ token, ownership: 'owned', creationMethod: 'human', title: '旧稿', selectedChapterIndexes: [] }),
    await commit({ token, ownership: 'owned', creationMethod: 'human', title: '旧稿', selectedChapterIndexes: [1, 1] }),
    await commit({ token, ownership: 'material', title: '资料', selectedChapterIndexes: [0] }),
    await commit({ token, ownership: 'material', creationMethod: 'human', title: '资料' })
  ]) {
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('requires a bounded explicit role for every file in an import manifest', async () => {
  const commit = harness(decodeImportManifestCommitArgs, (input) => input)
  const manuscriptToken = '11111111-2222-4333-8444-555555555555'
  const notesToken = '22222222-3333-4444-8555-666666666666'
  const id = '33333333-4444-4555-8666-777777777777'
  const valid = {
    id,
    files: [
      { token: manuscriptToken, ownership: 'owned', creationMethod: 'human', title: '正文', selectedChapterIndexes: [0, 1] },
      { token: notesToken, ownership: 'material', title: '作品相关' }
    ]
  }
  assert.deepEqual(unwrapIpcResponse(await commit(valid)), valid)
  for (const response of [
    await commit({ id, files: [] }),
    await commit({ id, files: [{ token: manuscriptToken, ownership: '', title: '未确认' }] }),
    await commit({ id, files: [{ token: manuscriptToken, ownership: 'skip', title: '略过', selectedChapterIndexes: [0] }] }),
    await commit({ id, files: [valid.files[0], { ...valid.files[0], title: '重复令牌' }] })
  ]) {
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('accepts only a UUID when resuming a persisted import manifest', async () => {
  const resume = harness(decodeImportManifestIdArgs, (id) => id)
  const id = '33333333-4444-4555-8666-777777777777'
  assert.equal(unwrapIpcResponse(await resume(id)), id)
  for (const response of [await resume('../manifest'), await resume(''), await resume(id, 'extra')]) {
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('accepts only a one-time UUID for a SQLite shadow import', async () => {
  const commit = harness(decodeSqliteShadowMigrationTokenArgs, (token) => token)
  const token = '11111111-2222-4333-8444-555555555555'
  assert.equal(unwrapIpcResponse(await commit(token)), token)
  for (const response of [await commit('../workspace.sqlite'), await commit(''), await commit(token, 'extra')]) {
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('requires exactly nine unique bounded sections when editing continuation analysis', async () => {
  const save = harness(decodeContinuationAnalysisEditsArgs, (value) => value)
  const areas = ['projectDefinition', 'existingPlot', 'characters', 'worldView', 'powerSystem', 'cheatSystem', 'totalOutline', 'volumeOutline', 'chapterOutline']
  const valid = { candidateId: '11111111-2222-4333-8444-555555555555', sections: areas.map((area) => ({ area, content: `${area}候选` })), rationale: '作者仍需逐项核对。' }
  assert.deepEqual(unwrapIpcResponse(await save(valid)), valid)
  for (const response of [
    await save({ ...valid, sections: valid.sections.slice(0, 8) }),
    await save({ ...valid, sections: valid.sections.map((item, index) => index === 8 ? { ...item, area: 'worldView' } : item) }),
    await save({ ...valid, sections: valid.sections.map((item, index) => index === 0 ? { ...item, content: '文'.repeat(100_001) } : item) }),
    await save({ ...valid, candidateId: '../candidate' })
  ]) {
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('validates continuation project-definition preview and stale-protected adoption inputs', async () => {
  const id = '11111111-2222-4333-8444-555555555555'
  const preview = harness(decodeContinuationCandidateIdArgs, (value) => value)
  assert.equal(unwrapIpcResponse(await preview(id)), id)
  assert.equal((await preview('../candidate')).ok, false)

  const adopt = harness(decodeContinuationProjectDefinitionAdoptionArgs, (value) => value)
  const valid = { candidateId: id, candidateFingerprint: 'a'.repeat(64), currentProfileFingerprint: 'b'.repeat(64) }
  assert.deepEqual(unwrapIpcResponse(await adopt(valid)), valid)
  for (const response of [
    await adopt({ ...valid, candidateFingerprint: 'a'.repeat(63) }),
    await adopt({ ...valid, currentProfileFingerprint: 'z'.repeat(64) }),
    await adopt({ ...valid, extra: true })
  ]) {
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('requires four complete dimensions and stale fingerprints for existing-plot adoption', async () => {
  const id = '11111111-2222-4333-8444-555555555555'
  const adopt = harness(decodeContinuationExistingPlotAdoptionArgs, (value) => value)
  const valid = {
    candidateId: id,
    candidateFingerprint: 'a'.repeat(64),
    currentTimelineFingerprint: 'b'.repeat(64),
    event: { time: '第一日雨夜', characters: '沈砚', location: '长安城门', event: '发现半枚脚印并开始追查。' }
  }
  assert.deepEqual(unwrapIpcResponse(await adopt(valid)), valid)
  for (const response of [
    await adopt({ ...valid, event: { ...valid.event, time: '' } }),
    await adopt({ ...valid, event: { ...valid.event, characters: '人'.repeat(2_001) } }),
    await adopt({ ...valid, currentTimelineFingerprint: 'z'.repeat(64) }),
    await adopt({ ...valid, extra: true })
  ]) {
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('requires one complete bounded person and three fingerprints for continuation-character adoption', async () => {
  const id = '11111111-2222-4333-8444-555555555555'
  const character = { name: '林知夏', role: '维持普通生活的高中生', arcSeed: '从隐瞒异常，到主动守住怪物少女们的日常。' }
  const preview = harness(decodeContinuationCharacterPreviewArgs, (value) => value)
  assert.deepEqual(unwrapIpcResponse(await preview({ candidateId: id, character })), { candidateId: id, character })
  for (const response of [
    await preview({ candidateId: id, character: { ...character, name: '' } }),
    await preview({ candidateId: id, character: { ...character, role: '角'.repeat(1001) } }),
    await preview({ candidateId: id, character, extra: true })
  ]) {
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }

  const adopt = harness(decodeContinuationCharacterAdoptionArgs, (value) => value)
  const valid = { candidateId: id, sectionFingerprint: 'a'.repeat(64), characterFingerprint: 'b'.repeat(64), currentAnchorFingerprint: 'c'.repeat(64), character }
  assert.deepEqual(unwrapIpcResponse(await adopt(valid)), valid)
  for (const response of [
    await adopt({ ...valid, sectionFingerprint: 'short' }),
    await adopt({ ...valid, character: { ...character, arcSeed: '' } }),
    await adopt({ ...valid, unknown: true })
  ]) {
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('requires candidate and full-foundation fingerprints for continuation world-view adoption', async () => {
  const id = '11111111-2222-4333-8444-555555555555'
  const adopt = harness(decodeContinuationWorldViewAdoptionArgs, (value) => value)
  const valid = { candidateId: id, candidateFingerprint: 'a'.repeat(64), currentFoundationFingerprint: 'b'.repeat(64) }
  assert.deepEqual(unwrapIpcResponse(await adopt(valid)), valid)
  for (const response of [
    await adopt({ ...valid, candidateFingerprint: 'short' }),
    await adopt({ ...valid, currentFoundationFingerprint: 'z'.repeat(64) }),
    await adopt({ ...valid, extra: true })
  ]) {
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('requires candidate and current-overview fingerprints for continuation power-system adoption', async () => {
  const id = '11111111-2222-4333-8444-555555555555'
  const adopt = harness(decodeContinuationPowerSystemAdoptionArgs, (value) => value)
  const valid = { candidateId: id, candidateFingerprint: 'a'.repeat(64), currentPowerSystemFingerprint: 'b'.repeat(64) }
  assert.deepEqual(unwrapIpcResponse(await adopt(valid)), valid)
  for (const response of [
    await adopt({ ...valid, candidateFingerprint: 'short' }),
    await adopt({ ...valid, currentPowerSystemFingerprint: 'z'.repeat(64) }),
    await adopt({ ...valid, extra: true })
  ]) {
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('requires candidate and current-overview fingerprints for continuation cheat-system adoption', async () => {
  const id = '11111111-2222-4333-8444-555555555555'
  const adopt = harness(decodeContinuationCheatSystemAdoptionArgs, (value) => value)
  const valid = { candidateId: id, candidateFingerprint: 'a'.repeat(64), currentCheatSystemFingerprint: 'b'.repeat(64) }
  assert.deepEqual(unwrapIpcResponse(await adopt(valid)), valid)
  for (const response of [
    await adopt({ ...valid, candidateFingerprint: 'short' }),
    await adopt({ ...valid, currentCheatSystemFingerprint: 'z'.repeat(64) }),
    await adopt({ ...valid, extra: true })
  ]) {
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('requires candidate, current outline and prerequisite fingerprints for continuation total-outline adoption', async () => {
  const id = '11111111-2222-4333-8444-555555555555'
  const adopt = harness(decodeContinuationTotalOutlineAdoptionArgs, (value) => value)
  const valid = { candidateId: id, candidateFingerprint: 'a'.repeat(64), currentOutlineFingerprint: 'b'.repeat(64), prerequisiteFingerprint: 'c'.repeat(64) }
  assert.deepEqual(unwrapIpcResponse(await adopt(valid)), valid)
  for (const response of [
    await adopt({ ...valid, candidateFingerprint: 'short' }),
    await adopt({ ...valid, currentOutlineFingerprint: 'z'.repeat(64) }),
    await adopt({ ...valid, prerequisiteFingerprint: 'short' }),
    await adopt({ ...valid, extra: true })
  ]) {
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('requires an explicit bounded target and fingerprints for continuation volume-outline adoption', async () => {
  const id = '11111111-2222-4333-8444-555555555555'
  const preview = harness(decodeContinuationVolumeOutlinePreviewArgs, (...values) => values)
  assert.deepEqual(unwrapIpcResponse(await preview(id, 3)), [id, 3])
  const adopt = harness(decodeContinuationVolumeOutlineAdoptionArgs, (value) => value)
  const valid = { candidateId: id, volume: 3, candidateFingerprint: 'a'.repeat(64), currentOutlineFingerprint: 'b'.repeat(64), parentTotalFingerprint: 'c'.repeat(64) }
  assert.deepEqual(unwrapIpcResponse(await adopt(valid)), valid)
  for (const response of [
    await preview(id, 0),
    await adopt({ ...valid, volume: 0 }),
    await adopt({ ...valid, parentTotalFingerprint: 'short' }),
    await adopt({ ...valid, extra: true })
  ]) {
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('requires one existing chapter and both confirmed parent fingerprints for continuation chapter-outline adoption', async () => {
  const id = '11111111-2222-4333-8444-555555555555'
  const preview = harness(decodeContinuationChapterOutlinePreviewArgs, (...values) => values)
  assert.deepEqual(unwrapIpcResponse(await preview(id, 17)), [id, 17])
  const adopt = harness(decodeContinuationChapterOutlineAdoptionArgs, (value) => value)
  const valid = {
    candidateId: id,
    chapterId: 17,
    candidateFingerprint: 'a'.repeat(64),
    currentOutlineFingerprint: 'b'.repeat(64),
    parentTotalFingerprint: 'c'.repeat(64),
    parentVolumeFingerprint: 'd'.repeat(64)
  }
  assert.deepEqual(unwrapIpcResponse(await adopt(valid)), valid)
  for (const response of [
    await preview(id, 0),
    await adopt({ ...valid, chapterId: 0 }),
    await adopt({ ...valid, parentVolumeFingerprint: 'short' }),
    await adopt({ ...valid, extra: true })
  ]) {
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('validates model routing, connection drafts and research requests before network access', async () => {
  const settings = harness(decodeAiSettingsUpdateArgs, (value) => value)
  const valid = await settings({
    baseUrl: 'https://cdn.example.test/v1', routingMode: 'perTask',
    shared: { model: 'gemini-2.5-pro', temperature: 0.7, topP: 0.9, maxTokens: 8192 },
    tasks: { prose: { model: 'gemini-2.5-pro', temperature: 0.8 } }
  })
  assert.equal(valid.ok, true)
  const multiConnection = await settings({
    connections: [
      { id: 'gpt', name: 'GPT 接口', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-gpt-test' },
      { id: 'gemini', name: 'Gemini 接口', baseUrl: 'https://generativelanguage.example/v1' }
    ],
    routingMode: 'perTask',
    tasks: { outline: { connectionId: 'gpt', model: 'gpt-4.1' }, prose: { connectionId: 'gemini', model: 'gemini-3.1-pro' } }
  })
  assert.equal(multiConnection.ok, true)
  const normalizedConnection = await settings({ baseUrl: 'https://api.example.test:443/v1///' })
  assert.equal(normalizedConnection.ok, true)
  if (normalizedConnection.ok) assert.equal((normalizedConnection.value as { baseUrl: string }).baseUrl, 'https://api.example.test/v1')

  const connection = harness(decodeAiConnectionDraftArgs, (value) => value)
  const complete = harness(decodeAiCompleteArgs, (...values) => values)
  const researchSettings = harness(decodeResearchSettingsArgs, (value) => value)
  const researchQuery = harness(decodeResearchQueryArgs, (value) => value)
  for (const response of [
    await settings({ baseUrl: 'file:///secret', shared: { model: 'x' } }),
    await settings({ baseUrl: 'https://user:password@example.test/v1' }),
    await settings({ baseUrl: 'https://example.test/v1?api_key=plaintext-secret' }),
    await settings({ baseUrl: 'https://example.test/v1#private-fragment' }),
    await settings({ shared: { temperature: 3 } }),
    await settings({ tasks: { unknown: { model: 'x' } } }),
    await settings({ connections: [{ id: '../bad', name: '错误接口', baseUrl: 'https://example.test/v1' }] }),
    await connection({ baseUrl: 'javascript:alert(1)' }),
    await connection({ connectionId: 'gpt', baseUrl: 'https://user@example.test/v1' }),
    await connection({ connectionId: 'gpt', baseUrl: 'https://example.test/v1?token=secret' }),
    await complete('', undefined, 'prose', 1),
    await complete('写正文', undefined, 'unknown', 1),
    await researchSettings({ baseUrl: 'ftp://example.test', model: 'doubao' }),
    await researchQuery('一')
  ]) {
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('validates editable prompt tasks and bounded content at the IPC boundary', async () => {
  const savePrompt = harness(decodePromptOverrideArgs, (value) => value)
  const resetPrompt = harness(decodePromptTaskArgs, (task) => task)
  assert.deepEqual(unwrapIpcResponse(await savePrompt({ task: 'prose', content: '严格服从章纲。' })), {
    task: 'prose', content: '严格服从章纲。'
  })
  assert.equal(unwrapIpcResponse(await resetPrompt('review')), 'review')

  for (const response of [
    await savePrompt({ task: 'unknown', content: '提示词' }),
    await savePrompt({ task: 'outline', content: '' }),
    await savePrompt({ task: 'outline', content: '文'.repeat(50_001) }),
    await savePrompt({ task: 'outline', content: '提示词', workItemId: '越权字段' }),
    await resetPrompt('../prose')
  ]) {
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})

test('validates local source cards and event candidates before persistence', async () => {
  const createSource = harness(decodeSourceCardCreateArgs, (value) => value)
  const updateSource = harness(decodeSourceCardUpdateArgs, (id, value) => ({ id, value }))
  const createEvent = harness(decodeEventCandidateCreateArgs, (value) => value)
  const approveEvent = harness(decodeResearchEventIdArgs, (value) => value)
  const sourceId = '11111111-2222-4333-8444-555555555555'
  const eventId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

  assert.equal((await createSource({
    title: 'KING 人物资料',
    excerpt: '用户整理的人物经历。',
    userNotes: '仅作创作素材，不等同于故事事实。'
  })).ok, true)
  const webSource = unwrapIpcResponse(await createSource({
    title: '联网采风：KING',
    sourceType: 'web',
    provider: 'gemini-research',
    excerpt: '公开网页摘要。',
    userNotes: '核对后采用。',
    references: [{ title: '人物资料', url: 'https://example.test/king' }]
  })) as { sourceType: string; references: Array<{ title: string; url: string }> }
  assert.equal(webSource.sourceType, 'web')
  assert.deepEqual(webSource.references, [{ title: '人物资料', url: 'https://example.test/king' }])
  assert.equal((await updateSource(sourceId, { title: '修改后的资料', url: 'https://example.test/note', excerpt: '保留的正文', userNotes: '新的整理判断' })).ok, true)
  assert.equal((await createEvent({
    sourceId,
    time: '平行世界成名之后',
    characters: ['KING', '三流歌手'],
    location: '另一条时间线',
    event: 'KING 穿越并接管三流歌手的人生。',
    result: '两条人生线开始交汇。'
  })).ok, true)
  assert.deepEqual(unwrapIpcResponse(await approveEvent(eventId)), eventId)

  for (const response of [
    await createSource({ title: '空资料', excerpt: '', userNotes: '' }),
    await createSource({ title: '错误链接', url: 'ftp://example.test/a', excerpt: '资料' }),
    await createSource({ title: '无证据采风', sourceType: 'web', excerpt: '资料', userNotes: '' }),
    await createSource({ title: '未知来源', sourceType: 'cloud', excerpt: '资料', userNotes: '' }),
    await createSource({ title: '错误引用', sourceType: 'web', excerpt: '资料', references: [{ title: '来源', url: 'file:///secret' }] }),
    await createSource({ title: '越界字段', excerpt: '资料', cloudSync: true }),
    await updateSource(sourceId, { title: '空资料', excerpt: '', userNotes: '' }),
    await updateSource(sourceId, { title: '错误链接', url: 'file:///secret', excerpt: '资料', userNotes: '' }),
    await updateSource(sourceId, { title: '越界字段', excerpt: '资料', userNotes: '', sourceType: 'web' }),
    await updateSource('../../secret', { title: '资料', excerpt: '正文', userNotes: '' }),
    await createEvent({ sourceId, time: '此时', characters: [], location: '长安', event: '相遇' }),
    await createEvent({ sourceId, time: '此时', characters: ['沈砚'], location: '', event: '相遇' }),
    await createEvent({ sourceId: '../../secret', time: '此时', characters: ['沈砚'], location: '长安', event: '相遇' }),
    await approveEvent('../../secret')
  ]) {
    assert.equal(response.ok, false)
    if (!response.ok) assert.equal(response.error.code, 'VALIDATION_ERROR')
  }
})
