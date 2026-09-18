import type { ConsistencyFindingDecisionInput } from '../index'
import type { FactReviewDecisionInput, RealTrialChapterInput, RealTrialConclusionInput } from '../index'
import type { ArgsDecoder } from '../core/validation'
import {
  boundedBoolean,
  boundedInteger,
  boundedNumber,
  boundedString,
  exactArgs,
  exactRecord,
  invalid,
  record,
  rejectUnknown,
  requiredString,
  uuid
} from '../core/validation'
import { chapterId, chapterLimits } from '../manuscript/validation'

export const decodeRealTrialChapterArgs: ArgsDecoder<[RealTrialChapterInput]> = (args) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'realTrialChapter', [
    'legacyChapterId',
    'bodyVersionId',
    'planningMinutes',
    'writingMinutes',
    'aiEditingMinutes',
    'factReviewMinutes',
    'diffAcceptedBlocks',
    'diffRejectedBlocks',
    'misappliedChanges',
    'falsePositiveFindings',
    'usefulFindings',
    'modelCost',
    'satisfaction',
    'continueNextChapter',
    'bypassedFeatures',
    'notes'
  ])
  return [
    {
      legacyChapterId: boundedInteger(value.legacyChapterId, 'legacyChapterId', 1, chapterLimits.maxId),
      bodyVersionId: requiredString(value.bodyVersionId, 'bodyVersionId', 200),
      planningMinutes: boundedInteger(value.planningMinutes, 'planningMinutes', 0, 1_440),
      writingMinutes: boundedInteger(value.writingMinutes, 'writingMinutes', 0, 1_440),
      aiEditingMinutes: boundedInteger(value.aiEditingMinutes, 'aiEditingMinutes', 0, 1_440),
      factReviewMinutes: boundedInteger(value.factReviewMinutes, 'factReviewMinutes', 0, 1_440),
      diffAcceptedBlocks: boundedInteger(value.diffAcceptedBlocks, 'diffAcceptedBlocks', 0, 100_000),
      diffRejectedBlocks: boundedInteger(value.diffRejectedBlocks, 'diffRejectedBlocks', 0, 100_000),
      misappliedChanges: boundedInteger(value.misappliedChanges, 'misappliedChanges', 0, 100_000),
      falsePositiveFindings: boundedInteger(value.falsePositiveFindings, 'falsePositiveFindings', 0, 100_000),
      usefulFindings: boundedInteger(value.usefulFindings, 'usefulFindings', 0, 100_000),
      modelCost: value.modelCost === null ? null : boundedNumber(value.modelCost, 'modelCost', 0, 1_000_000),
      satisfaction: boundedInteger(value.satisfaction, 'satisfaction', 1, 5),
      continueNextChapter: boundedBoolean(value.continueNextChapter, 'continueNextChapter'),
      bypassedFeatures: boundedString(value.bypassedFeatures, 'bypassedFeatures', 2_000).trim(),
      notes: boundedString(value.notes, 'notes', 10_000).trim()
    }
  ]
}

export const decodeRealTrialConclusionArgs: ArgsDecoder<[RealTrialConclusionInput]> = (args) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'realTrialConclusion', [
    'decision',
    'highPriorityProblems',
    'mediumPriorityProblems',
    'lowPriorityProblems',
    'rationale',
    'nextScope'
  ])
  const decision = requiredString(value.decision, 'decision', 20)
  if (!['continue', 'narrow', 'adjust'].includes(decision)) invalid('decision', '不是受支持的试跑结论')
  return [
    {
      decision: decision as RealTrialConclusionInput['decision'],
      highPriorityProblems: requiredString(value.highPriorityProblems, 'highPriorityProblems', 4_000),
      mediumPriorityProblems: boundedString(value.mediumPriorityProblems, 'mediumPriorityProblems', 4_000).trim(),
      lowPriorityProblems: boundedString(value.lowPriorityProblems, 'lowPriorityProblems', 4_000).trim(),
      rationale: requiredString(value.rationale, 'rationale', 10_000),
      nextScope: requiredString(value.nextScope, 'nextScope', 10_000)
    }
  ]
}

export const decodeFactReviewDecisionArgs: ArgsDecoder<[FactReviewDecisionInput]> = (args) => {
  exactArgs(args, 1)
  const value = record(args[0], 'factReview')
  rejectUnknown(value, 'factReview', ['batchId', 'decisions'])
  if (!Array.isArray(value.decisions) || value.decisions.length < 1 || value.decisions.length > 500)
    invalid('factReview.decisions', '必须包含 1 到 500 项决定')
  const decisions = value.decisions.map((item, index) => {
    const decision = record(item, `factReview.decisions[${index}]`)
    rejectUnknown(decision, `factReview.decisions[${index}]`, ['changeId', 'decision', 'decidedObjectJson'])
    if (!['APPROVED', 'REJECTED', 'DEFERRED'].includes(String(decision.decision)))
      invalid(`factReview.decisions[${index}].decision`, '不是受支持的决定')
    const result: FactReviewDecisionInput['decisions'][number] = {
      changeId: uuid(decision.changeId, `factReview.decisions[${index}].changeId`),
      decision: decision.decision as FactReviewDecisionInput['decisions'][number]['decision']
    }
    if (decision.decidedObjectJson !== undefined) {
      const json = boundedString(
        decision.decidedObjectJson,
        `factReview.decisions[${index}].decidedObjectJson`,
        100_000
      )
      try {
        JSON.parse(json)
      } catch {
        invalid(`factReview.decisions[${index}].decidedObjectJson`, '必须是有效 JSON')
      }
      result.decidedObjectJson = json
    }
    return result
  })
  if (new Set(decisions.map((decision) => decision.changeId)).size !== decisions.length)
    invalid('factReview.decisions', '不能重复决定同一条事实')
  return [{ batchId: uuid(value.batchId, 'factReview.batchId'), decisions }]
}

export const decodeConsistencyFindingDecisionArgs: ArgsDecoder<[ConsistencyFindingDecisionInput]> = (args) => {
  exactArgs(args, 1)
  const value = record(args[0], 'consistencyFindingDecision')
  const decision = String(value.decision)
  if (decision === 'fixed') {
    rejectUnknown(value, 'consistencyFindingDecision', [
      'findingId',
      'decision',
      'reason',
      'resultingBodyVersionId',
      'expectedUpdatedAt'
    ])
    const expectedUpdatedAt = boundedString(value.expectedUpdatedAt, 'consistencyFindingDecision.expectedUpdatedAt', 40)
    if (!Number.isFinite(Date.parse(expectedUpdatedAt)))
      invalid('consistencyFindingDecision.expectedUpdatedAt', '不是有效时间')
    return [
      {
        findingId: uuid(value.findingId, 'consistencyFindingDecision.findingId'),
        decision,
        resultingBodyVersionId: uuid(value.resultingBodyVersionId, 'consistencyFindingDecision.resultingBodyVersionId'),
        expectedUpdatedAt,
        ...(value.reason === undefined
          ? {}
          : { reason: boundedString(value.reason, 'consistencyFindingDecision.reason', 2_000).trim() })
      }
    ]
  }
  rejectUnknown(value, 'consistencyFindingDecision', ['findingId', 'decision', 'reason'])
  if (!['accepted', 'ignored', 'exception', 'later'].includes(decision))
    invalid('consistencyFindingDecision.decision', '不是受支持的决定')
  const result: { findingId: string; decision: 'accepted' | 'ignored' | 'exception' | 'later'; reason?: string } = {
    findingId: uuid(value.findingId, 'consistencyFindingDecision.findingId'),
    decision: decision as 'accepted' | 'ignored' | 'exception' | 'later'
  }
  if (value.reason !== undefined)
    result.reason = boundedString(value.reason, 'consistencyFindingDecision.reason', 2_000).trim()
  if (result.decision === 'exception' && !result.reason)
    invalid('consistencyFindingDecision.reason', '标记例外必须说明原因')
  return [result]
}

export const decodeChapterSummaryArgs: ArgsDecoder<[{ chapterId: number; bodyVersionId: string; content: string }]> = (
  args
) => {
  exactArgs(args, 1)
  const value = record(args[0], 'chapterSummary')
  rejectUnknown(value, 'chapterSummary', ['chapterId', 'bodyVersionId', 'content'])
  const bodyVersionId = boundedString(value.bodyVersionId, 'chapterSummary.bodyVersionId', 128).trim()
  const content = boundedString(value.content, 'chapterSummary.content', 50_000).trim()
  if (!bodyVersionId) invalid('chapterSummary.bodyVersionId', '不能为空')
  if (!content) invalid('chapterSummary.content', '不能为空')
  return [
    {
      chapterId: chapterId(value.chapterId),
      bodyVersionId,
      content
    }
  ]
}

export const decodeCharacterConflictIdArgs: ArgsDecoder<[string]> = (args) => {
  exactArgs(args, 1)
  const id = boundedString(args[0], 'conflictId', 33).trim()
  if (!/^conflict-[0-9a-f]{24}$/.test(id)) invalid('conflictId', '格式无效')
  return [id]
}
