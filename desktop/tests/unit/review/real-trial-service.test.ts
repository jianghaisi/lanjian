import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildRealTrialReport } from '../../../src/main/modules/review/domain/real-trial-report'
import type { LegacyWorkspaceSnapshot, WorkspaceRealTrialChapterRecord } from '../../../src/main/core/ports/workspace-database'
import { SqliteWorkspaceDatabaseFactory } from '../../../src/main/platform/storage/workspace-database'
import { RealTrialService } from '../../../src/main/modules/review/application/real-trial-service'

test('stores one version-bound real-trial observation in SQLite and writes a readable report', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-real-trial-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, '.webnovel'), { recursive: true })
  const snapshot = trialSnapshot(root)
  const databases = new SqliteWorkspaceDatabaseFactory()
  const database = await databases.open(root)
  database.importSnapshot(snapshot)
  database.activateSqlite(snapshot)
  const chapter = database.formalChapters()[0]
  const autosave = database.stageAutosaveCheckpoint({
    legacyChapterId: chapter.legacyChapterId,
    clientOperationId: 'trial-autosave-operation',
    baseBodyVersionId: chapter.currentVersionId,
    title: chapter.title,
    content: chapter.content
  })
  database.finalizeAutosaveCheckpoint(autosave.checkpoint.id)
  database.createTaskRun({
    id: 'trial-writing-task', legacyChapterId: 1, taskType: 'writing_agent', idempotencyKey: 'trial-writing-operation',
    checkpointJson: JSON.stringify({ phase: 'queued' })
  })
  database.transitionTaskRun({ id: 'trial-writing-task', status: 'running', checkpointJson: JSON.stringify({ phase: 'model' }) })
  const turn = JSON.stringify({
    id: 'trial-turn', candidate: { diff: [
      { id: 'change-1', kind: 'change' }, { id: 'change-2', kind: 'change' }, { id: 'change-3', kind: 'change' }
    ] }
  })
  const completed = database.completeTaskRunWithArtifact('trial-writing-task', JSON.stringify({ phase: 'approval' }), {
    id: 'trial-writing-artifact', taskRunId: 'trial-writing-task', artifactType: 'writing_agent_turn', status: 'complete',
    content: turn, contentHash: hash(turn), schemaValid: true, metadataJson: '{}'
  })
  database.updateGenerationArtifactStatus(completed.artifact.id, 'applied', JSON.stringify({ acceptedChangeIds: ['change-1', 'change-3'] }))
  for (const attempt of [2, 3]) {
    const id = `trial-writing-retry-${attempt}`
    database.createTaskRun({
      id, legacyChapterId: 1, taskType: 'writing_agent', idempotencyKey: `trial-writing-operation-${attempt}`,
      parentTaskRunId: attempt === 2 ? 'trial-writing-task' : 'trial-writing-retry-2', attempt,
      checkpointJson: JSON.stringify({ phase: 'queued' })
    })
    database.transitionTaskRun({ id, status: 'running', checkpointJson: JSON.stringify({ phase: 'model' }) })
    database.transitionTaskRun({ id, status: 'failed', checkpointJson: JSON.stringify({ phase: 'failed' }) })
  }
  const findings = database.recordFindingRun({
    legacyChapterId: 1,
    bodyVersionId: chapter.currentVersionId,
    contentHash: chapter.contentHash,
    ruleLayer: 'literary',
    findings: [
      { code: 'trial.useful', severity: 'suggestion', title: '有帮助的提示', rationale: '作者准备据此修改。', evidenceJson: '{}' },
      { code: 'trial.false-positive', severity: 'suggestion', title: '误报提示', rationale: '作者确认正文并无问题。', evidenceJson: '{}' },
      { code: 'trial.intentional', severity: 'suggestion', title: '有意安排', rationale: '作者选择保留这一安排。', evidenceJson: '{}' }
    ]
  })
  database.decideFinding({ findingId: findings[0]!.id, decision: 'accepted' })
  database.decideFinding({ findingId: findings[1]!.id, decision: 'ignored' })
  database.decideFinding({ findingId: findings[2]!.id, decision: 'exception', reason: '这是有意保留的写法。' })
  database.createFactBatch({
    id: 'trial-fact-batch', legacyChapterId: 1, bodyVersionId: chapter.currentVersionId,
    contentHash: chapter.contentHash, idempotencyKey: 'trial-fact-extraction', countsJson: '{"total":2}',
    changes: [1, 2].map((index) => ({
      id: `trial-fact-change-${index}`, candidateType: 'open_state', subjectType: 'character', subjectId: null,
      subjectJson: '{"name":"试跑人物"}', predicate: `note_${index}`, objectJson: JSON.stringify(`候选${index}`),
      normalizedKey: `trial:note:${index}`, evidenceJson: JSON.stringify({ quote: chapter.content }), confidence: 0.8,
      importance: 'medium' as const, changeType: 'NEW' as const, reviewClass: 'reviewable' as const
    }))
  })
  database.decideFactChanges({
    batchId: 'trial-fact-batch',
    decisions: [1, 2].map((index) => ({ id: `trial-fact-decision-${index}`, changeId: `trial-fact-change-${index}`, decision: 'REJECTED' as const }))
  })
  database.close()

  const service = new RealTrialService(databases, { currentPath: async () => root }, () => new Date('2026-09-03T14:00:00.000Z'))
  const report = await service.saveChapter({
    legacyChapterId: 1,
    bodyVersionId: chapter.currentVersionId,
    planningMinutes: 8,
    writingMinutes: 42,
    aiEditingMinutes: 6,
    factReviewMinutes: 3,
    diffAcceptedBlocks: 2,
    diffRejectedBlocks: 1,
    misappliedChanges: 0,
    falsePositiveFindings: 99,
    usefulFindings: 99,
    modelCost: 0.25,
    satisfaction: 4,
    continueNextChapter: true,
    bypassedFeatures: '事实审批，整章精审',
    notes: '记录实际写作负担。'
  })

  assert.equal(report.purpose, 'product-experience-and-cost-only')
  assert.equal(report.summary.chapterCount, 1)
  assert.equal(report.summary.status, 'collecting')
  assert.equal(report.summary.totalHumanMinutes, 59)
  assert.equal(report.summary.averageHumanMinutes, 59)
  assert.equal(report.summary.humanTimeRecordedChapters, 1)
  assert.equal(report.summary.humanTimeCoverage, 1)
  assert.equal(report.summary.autosaveCheckpoints, 1)
  assert.equal(report.summary.autosaveFinalized, 1)
  assert.equal(report.summary.autosaveConflicts, 0)
  assert.equal(report.summary.autosaveConflictFreeRate, 1)
  assert.equal(report.summary.aiTasks, 3)
  assert.equal(report.summary.aiRetries, 2)
  assert.equal(report.summary.aiSuccessRate, 0.3333)
  assert.equal(report.summary.aiCancellationRate, 0)
  assert.equal(report.summary.aiRetryRate, 0.6667)
  assert.equal(report.summary.diffAcceptanceRate, 0.6667)
  assert.equal(report.summary.findingFalsePositiveRate, 0.5)
  assert.equal(report.summary.falsePositiveFindings, 1)
  assert.equal(report.summary.usefulFindings, 1)
  assert.equal(report.summary.factCandidates, 2)
  assert.equal(report.summary.factDecisions, 2)
  assert.equal(report.summary.factBatchSubmittedDecisions, 2)
  assert.equal(report.summary.factBatchSubmissionRate, 1)
  assert.equal(report.summary.reviewDecisions, 8)
  assert.equal(report.summary.averageReviewDecisions, 8)
  assert.equal(report.chapters[0]?.automatic.findings, 3)
  assert.equal(report.chapters[0]?.automatic.findingDecisions, 3)
  assert.deepEqual(report.summary.bypassedFeatures, [{ label: '事实审批', chapters: 1 }, { label: '整章精审', chapters: 1 }])
  const stored = JSON.parse(await readFile(join(root, '.webnovel', 'evaluations', 'real-chapter-trial-v1.json'), 'utf8'))
  assert.equal(stored.scopeNotice.includes('不证明作品质量'), true)

  const reopened = await databases.openExisting(root)
  assert.ok(reopened)
  assert.equal(reopened.listRealTrialChapters().length, 1)
  reopened.close()
  await assert.rejects(() => service.saveConclusion({
    decision: 'adjust',
    highPriorityProblems: '先减少审批负担',
    mediumPriorityProblems: '',
    lowPriorityProblems: '',
    rationale: '只有一章，证据不足。',
    nextScope: '继续记录。'
  }), /至少 20 章/)
})

test('keeps the 20–30 chapter trial decision separate from fixed conflict accuracy', () => {
  const records = Array.from({ length: 20 }, (_, index) => trialRecord(index + 1))
  const report = buildRealTrialReport('work-item', records, '2026-09-03T15:00:00.000Z')
  assert.equal(report.summary.status, 'review-ready')
  assert.equal(report.summary.chapterCount, 20)
  assert.equal(report.summary.humanTimeRecordedChapters, 20)
  assert.equal(report.summary.humanTimeCoverage, 1)
  assert.equal(report.summary.averageSatisfaction, 4)
  assert.equal(report.summary.continueNextChapterRate, 1)
  assert.equal(Object.keys(report.summary).some((key) => /accuracy|detection/i.test(key)), false)
  assert.match(report.scopeNotice, /不证明.*冲突检出率/)
})

test('does not turn omitted optional time into a false zero-minute average', () => {
  const timed = trialRecord(1)
  const omitted = {
    ...trialRecord(2),
    planningMinutes: 0,
    writingMinutes: 0,
    aiEditingMinutes: 0,
    factReviewMinutes: 0
  }
  const report = buildRealTrialReport('work-item', [timed, omitted], '2026-09-03T15:00:00.000Z')
  assert.equal(report.summary.totalHumanMinutes, 42)
  assert.equal(report.summary.averageHumanMinutes, 42)
  assert.equal(report.summary.humanTimeRecordedChapters, 1)
  assert.equal(report.summary.humanTimeCoverage, 0.5)

  const noTimes = buildRealTrialReport('work-item', [{ ...omitted, legacyChapterId: 1 }], '2026-09-03T15:00:00.000Z')
  assert.equal(noTimes.summary.averageHumanMinutes, 0)
  assert.equal(noTimes.summary.humanTimeRecordedChapters, 0)
  assert.equal(noTimes.summary.humanTimeCoverage, 0)
})

test('summarizes autosave outcomes without treating missing evidence as a failure', () => {
  const observed = trialRecord(1)
  observed.automatic = {
    ...observed.automatic,
    autosaveCheckpoints: 4,
    autosaveFinalized: 1,
    autosaveConflicts: 1,
    autosavePending: 1,
    autosaveDiscarded: 1
  }
  const report = buildRealTrialReport('work-item', [observed], '2026-09-03T15:00:00.000Z')
  assert.equal(report.summary.autosaveCheckpoints, 4)
  assert.equal(report.summary.autosaveFinalized, 1)
  assert.equal(report.summary.autosaveConflicts, 1)
  assert.equal(report.summary.autosavePending, 1)
  assert.equal(report.summary.autosaveDiscarded, 1)
  assert.equal(report.summary.autosaveConflictFreeRate, 0.5)

  const noAutosave = trialRecord(2)
  noAutosave.automatic = {
    ...noAutosave.automatic,
    autosaveCheckpoints: 0,
    autosaveFinalized: 0
  }
  const unknown = buildRealTrialReport('work-item', [noAutosave], '2026-09-03T15:00:00.000Z')
  assert.equal(unknown.summary.autosaveConflictFreeRate, null)
})

test('reports explicit AI outcome rates and keeps no-task evidence unknown', () => {
  const observed = trialRecord(1)
  observed.automatic = {
    ...observed.automatic,
    aiTasks: 4,
    aiSucceeded: 2,
    aiCancelled: 1,
    aiFailed: 1,
    aiInterrupted: 0,
    aiRetries: 1
  }
  const report = buildRealTrialReport('work-item', [observed], '2026-09-03T15:00:00.000Z')
  assert.equal(report.summary.aiSuccessRate, 0.5)
  assert.equal(report.summary.aiCancellationRate, 0.25)
  assert.equal(report.summary.aiRetryRate, 0.25)

  const unknown = trialRecord(2)
  unknown.automatic = {
    ...unknown.automatic,
    aiTasks: 0,
    aiSucceeded: 0,
    aiCancelled: 0,
    aiFailed: 0,
    aiInterrupted: 0,
    aiRetries: 0
  }
  const noTasks = buildRealTrialReport('work-item', [unknown], '2026-09-03T15:00:00.000Z')
  assert.equal(noTasks.summary.aiSuccessRate, null)
  assert.equal(noTasks.summary.aiCancellationRate, null)
  assert.equal(noTasks.summary.aiRetryRate, null)
})

test('stores an author-owned conclusion only after twenty real chapter records and mirrors it in the report', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'lanjian-real-trial-conclusion-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, '.webnovel'), { recursive: true })
  const snapshot = trialSnapshot(root, 20)
  const databases = new SqliteWorkspaceDatabaseFactory()
  const database = await databases.open(root)
  database.importSnapshot(snapshot)
  database.activateSqlite(snapshot)
  for (const chapter of database.formalChapters()) {
    database.upsertRealTrialChapter(trialInput(chapter.legacyChapterId, chapter.currentVersionId))
  }
  database.close()

  const service = new RealTrialService(databases, { currentPath: async () => root }, () => new Date('2026-09-03T16:00:00.000Z'))
  const report = await service.saveConclusion({
    decision: 'adjust',
    highPriorityProblems: '减少事实审批打断。',
    mediumPriorityProblems: '缩短首次生成等待。',
    lowPriorityProblems: '暂缓新增可视化。',
    rationale: '结合二十章人工耗时与绕开功能频次，保留写作主链但简化审批。',
    nextScope: '保留章卡、生成、diff 和版本；调整事实确认默认入口。'
  })
  assert.equal(report.conclusion?.decision, 'adjust')
  assert.equal(report.conclusion?.chapterCountAtDecision, 20)
  assert.match(report.conclusion?.highPriorityProblems ?? '', /审批/)
  const stored = JSON.parse(await readFile(join(root, '.webnovel', 'evaluations', 'real-chapter-trial-v1.json'), 'utf8'))
  assert.equal(stored.conclusion.nextScope.includes('diff'), true)

  const reopened = await databases.openExisting(root)
  assert.ok(reopened)
  assert.equal(reopened.realTrialConclusion()?.decision, 'adjust')
  reopened.close()
})

function trialSnapshot(root: string, chapterCount = 1): LegacyWorkspaceSnapshot {
  const chapters = Array.from({ length: chapterCount }, (_, index) => {
    const legacyChapterId = index + 1
    const content = `第${legacyChapterId}章的正式正文。`
    return {
      legacyChapterId,
      position: legacyChapterId,
      title: `第${legacyChapterId}章`,
      content,
      contentHash: hash(content),
      wordCount: content.length,
      mirrorRelativePath: `正文/第${String(legacyChapterId).padStart(4, '0')}章.md`
    }
  })
  const order = JSON.stringify({ version: 1, chapters: chapters.map((chapter) => chapter.legacyChapterId) })
  return {
    workItemId: root,
    projectName: '真实试跑测试',
    projectManifestHash: hash('manifest'),
    sourceFingerprint: hash('source'),
    chapters,
    totalWords: chapters.reduce((total, chapter) => total + chapter.wordCount, 0),
    chapterOrderMirror: { relativePath: '.webnovel/manuscript/chapter-order.json', content: order, contentHash: hash(order), observedHash: null }
  }
}

function trialInput(legacyChapterId: number, bodyVersionId: string) {
  return {
    legacyChapterId,
    bodyVersionId,
    planningMinutes: 5,
    writingMinutes: 30,
    aiEditingMinutes: 5,
    factReviewMinutes: 2,
    diffAcceptedBlocks: 1,
    diffRejectedBlocks: 0,
    misappliedChanges: 0,
    falsePositiveFindings: 0,
    usefulFindings: 1,
    modelCost: null,
    satisfaction: 4,
    continueNextChapter: true,
    bypassedFeatures: '',
    notes: ''
  }
}

function trialRecord(chapterId: number): WorkspaceRealTrialChapterRecord {
  return {
    id: `trial-${chapterId}`,
    legacyChapterId: chapterId,
    bodyVersionId: `version-${chapterId}`,
    contentHash: hash(`chapter-${chapterId}`),
    planningMinutes: 5,
    writingMinutes: 30,
    aiEditingMinutes: 5,
    factReviewMinutes: 2,
    diffAcceptedBlocks: 1,
    diffRejectedBlocks: 0,
    misappliedChanges: 0,
    falsePositiveFindings: 0,
    usefulFindings: 1,
    modelCost: null,
    satisfaction: 4,
    continueNextChapter: true,
    bypassedFeatures: '',
    notes: '',
    automatic: { autosaveCheckpoints: 1, autosaveFinalized: 1, autosaveConflicts: 0, autosavePending: 0, autosaveDiscarded: 0, aiTasks: 1, aiSucceeded: 1, aiCancelled: 0, aiFailed: 0, aiInterrupted: 0, aiRetries: 0, contextEstimatedTokens: 1000, factCandidates: 2, factDecisions: 2, factBatchSubmittedDecisions: 2, findings: 1, findingDecisions: 1, usefulFindings: 1, falsePositiveFindings: 0, diffAcceptedBlocks: 1, diffRejectedBlocks: 0 },
    createdAt: '2026-09-03T15:00:00.000Z',
    updatedAt: '2026-09-03T15:00:00.000Z'
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
