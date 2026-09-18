import type { WorkspaceRealTrialChapterRecord, WorkspaceRealTrialConclusionRecord } from '../../../core/ports/workspace-database'

export const REAL_TRIAL_REPORT_RELATIVE_PATH = '.webnovel/evaluations/real-chapter-trial-v1.json' as const

export type RealTrialSummary = {
  chapterCount: number
  targetMinimum: 20
  targetMaximum: 30
  status: 'collecting' | 'review-ready' | 'window-complete'
  totalHumanMinutes: number
  averageHumanMinutes: number
  humanTimeRecordedChapters: number
  humanTimeCoverage: number
  autosaveCheckpoints: number
  autosaveFinalized: number
  autosaveConflicts: number
  autosavePending: number
  autosaveDiscarded: number
  autosaveConflictFreeRate: number | null
  aiTasks: number
  aiSucceeded: number
  aiCancelled: number
  aiFailed: number
  aiInterrupted: number
  aiRetries: number
  aiSuccessRate: number | null
  aiCancellationRate: number | null
  aiRetryRate: number | null
  diffAcceptedBlocks: number
  diffRejectedBlocks: number
  diffAcceptanceRate: number | null
  misappliedChanges: number
  factCandidates: number
  factDecisions: number
  factDecisionRate: number | null
  factBatchSubmittedDecisions: number
  factBatchSubmissionRate: number | null
  reviewDecisions: number
  averageReviewDecisions: number
  falsePositiveFindings: number
  usefulFindings: number
  findingFalsePositiveRate: number | null
  contextEstimatedTokens: number
  modelCostTotal: number | null
  modelCostCoverage: number
  averageSatisfaction: number
  continueNextChapterRate: number
  bypassedFeatures: Array<{ label: string; chapters: number }>
}

export type RealTrialReport = {
  version: 1
  purpose: 'product-experience-and-cost-only'
  workItemId: string
  generatedAt: string
  reportRelativePath: typeof REAL_TRIAL_REPORT_RELATIVE_PATH
  scopeNotice: string
  summary: RealTrialSummary
  conclusion: WorkspaceRealTrialConclusionRecord | null
  chapters: WorkspaceRealTrialChapterRecord[]
}

export function buildRealTrialReport(workItemId: string, chapters: WorkspaceRealTrialChapterRecord[], generatedAt: string, conclusion: WorkspaceRealTrialConclusionRecord | null = null): RealTrialReport {
  const timedChapters = chapters.filter((chapter) => chapter.planningMinutes + chapter.writingMinutes + chapter.aiEditingMinutes + chapter.factReviewMinutes > 0)
  const totalHumanMinutes = sum(chapters, (chapter) => chapter.planningMinutes + chapter.writingMinutes + chapter.aiEditingMinutes + chapter.factReviewMinutes)
  const diffAcceptedBlocks = sum(chapters, (chapter) => chapter.automatic.diffAcceptedBlocks)
  const diffRejectedBlocks = sum(chapters, (chapter) => chapter.automatic.diffRejectedBlocks)
  const factCandidates = sum(chapters, (chapter) => chapter.automatic.factCandidates)
  const factDecisions = sum(chapters, (chapter) => chapter.automatic.factDecisions)
  const factBatchSubmittedDecisions = sum(chapters, (chapter) => chapter.automatic.factBatchSubmittedDecisions)
  const reviewDecisions = sum(chapters, (chapter) => chapter.automatic.diffAcceptedBlocks + chapter.automatic.diffRejectedBlocks + chapter.automatic.factDecisions + chapter.automatic.findingDecisions)
  const falsePositiveFindings = sum(chapters, (chapter) => chapter.automatic.falsePositiveFindings)
  const usefulFindings = sum(chapters, (chapter) => chapter.automatic.usefulFindings)
  const priced = chapters.filter((chapter) => chapter.modelCost !== null)
  const bypassed = new Map<string, number>()
  for (const chapter of chapters) {
    for (const raw of chapter.bypassedFeatures.split(/[，,、;；\n]+/)) {
      const label = raw.trim()
      if (label) bypassed.set(label, (bypassed.get(label) ?? 0) + 1)
    }
  }
  const chapterCount = chapters.length
  const aiTasks = sum(chapters, (chapter) => chapter.automatic.aiTasks)
  const aiSucceeded = sum(chapters, (chapter) => chapter.automatic.aiSucceeded)
  const aiCancelled = sum(chapters, (chapter) => chapter.automatic.aiCancelled)
  const aiRetries = sum(chapters, (chapter) => chapter.automatic.aiRetries)
  const autosaveCheckpoints = sum(chapters, (chapter) => chapter.automatic.autosaveCheckpoints)
  const autosaveFinalized = sum(chapters, (chapter) => chapter.automatic.autosaveFinalized)
  const autosaveConflicts = sum(chapters, (chapter) => chapter.automatic.autosaveConflicts)
  return {
    version: 1,
    purpose: 'product-experience-and-cost-only',
    workItemId,
    generatedAt,
    reportRelativePath: REAL_TRIAL_REPORT_RELATIVE_PATH,
    scopeNotice: '本报告只评价产品体验、人工负担、误报和上下文成本，不证明作品质量、冲突检出率或商业结果。',
    summary: {
      chapterCount,
      targetMinimum: 20,
      targetMaximum: 30,
      status: chapterCount < 20 ? 'collecting' : chapterCount < 30 ? 'review-ready' : 'window-complete',
      totalHumanMinutes,
      averageHumanMinutes: average(totalHumanMinutes, timedChapters.length),
      humanTimeRecordedChapters: timedChapters.length,
      humanTimeCoverage: ratio(timedChapters.length, chapterCount) ?? 0,
      autosaveCheckpoints,
      autosaveFinalized,
      autosaveConflicts,
      autosavePending: sum(chapters, (chapter) => chapter.automatic.autosavePending),
      autosaveDiscarded: sum(chapters, (chapter) => chapter.automatic.autosaveDiscarded),
      autosaveConflictFreeRate: ratio(autosaveFinalized, autosaveFinalized + autosaveConflicts),
      aiTasks,
      aiSucceeded,
      aiCancelled,
      aiFailed: sum(chapters, (chapter) => chapter.automatic.aiFailed),
      aiInterrupted: sum(chapters, (chapter) => chapter.automatic.aiInterrupted),
      aiRetries,
      aiSuccessRate: ratio(aiSucceeded, aiTasks),
      aiCancellationRate: ratio(aiCancelled, aiTasks),
      aiRetryRate: ratio(aiRetries, aiTasks),
      diffAcceptedBlocks,
      diffRejectedBlocks,
      diffAcceptanceRate: ratio(diffAcceptedBlocks, diffAcceptedBlocks + diffRejectedBlocks),
      misappliedChanges: sum(chapters, (chapter) => chapter.misappliedChanges),
      factCandidates,
      factDecisions,
      factDecisionRate: ratio(factDecisions, factCandidates),
      factBatchSubmittedDecisions,
      factBatchSubmissionRate: ratio(factBatchSubmittedDecisions, factDecisions),
      reviewDecisions,
      averageReviewDecisions: average(reviewDecisions, chapterCount),
      falsePositiveFindings,
      usefulFindings,
      findingFalsePositiveRate: ratio(falsePositiveFindings, falsePositiveFindings + usefulFindings),
      contextEstimatedTokens: sum(chapters, (chapter) => chapter.automatic.contextEstimatedTokens),
      modelCostTotal: priced.length ? round(sum(priced, (chapter) => chapter.modelCost ?? 0)) : null,
      modelCostCoverage: ratio(priced.length, chapterCount) ?? 0,
      averageSatisfaction: average(sum(chapters, (chapter) => chapter.satisfaction), chapterCount),
      continueNextChapterRate: ratio(chapters.filter((chapter) => chapter.continueNextChapter).length, chapterCount) ?? 0,
      bypassedFeatures: [...bypassed.entries()].map(([label, count]) => ({ label, chapters: count })).sort((left, right) => right.chapters - left.chapters || left.label.localeCompare(right.label, 'zh-CN'))
    },
    conclusion,
    chapters
  }
}

function sum<T>(items: T[], select: (item: T) => number): number {
  return items.reduce((total, item) => total + select(item), 0)
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator ? round(numerator / denominator) : null
}

function average(total: number, count: number): number {
  return count ? round(total / count) : 0
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}
