import { localOutputOverride } from '../models/local-model-contracts'
import type {
  AiTask,
  WritingAgentArtifactApplicationInput,
  WritingAgentArtifactDecision,
  WritingAgentRequest,
  WritingAgentSkillId,
  WritingAgentTaskStart
} from '../index'
import type { ArgsDecoder } from '../core/validation'
import {
  boundedBoolean,
  boundedInteger,
  boundedString,
  enumValue,
  exactArgs,
  exactRecord,
  invalid,
  record,
  rejectUnknown,
  requiredString,
  uuid
} from '../core/validation'
import { chapterId, chapterLimits } from '../manuscript/validation'
import { aiTask } from '../models/validation'

export const decodeContextBudgetPreferencesArgs: ArgsDecoder<
  [
    {
      version: 1
      inputBudgetTokens: number
      modelContextLimit: number
      outputReservePercent: number
      systemReserveTokens: number
      recentSummaryCount: number
      structuredRepairAttempts: number
      minimumFactImportance: 'high' | 'medium' | 'low'
      showFactConfirmations: boolean
      pinnedEvidenceKeys: string[]
      excludedEvidenceKeys: string[]
      alwaysConfirmBeforeSend?: boolean
    }
  ]
> = (args) => {
  exactArgs(args, 1)
  const value = record(args[0], 'contextBudgetPreferences')
  const requiredFields = [
    'version',
    'inputBudgetTokens',
    'modelContextLimit',
    'outputReservePercent',
    'systemReserveTokens',
    'recentSummaryCount',
    'structuredRepairAttempts',
    'minimumFactImportance',
    'showFactConfirmations',
    'pinnedEvidenceKeys',
    'excludedEvidenceKeys'
  ]
  rejectUnknown(value, 'contextBudgetPreferences', [...requiredFields, 'alwaysConfirmBeforeSend'])
  for (const key of requiredFields) if (!(key in value)) invalid(`contextBudgetPreferences.${key}`, '不能为空')
  if (value.version !== 1) invalid('version', '暂不支持该上下文预算配置版本')
  const decodeEvidenceKeys = (input: unknown, field: string) => {
    if (!Array.isArray(input) || input.length > 200) invalid(field, '必须是最多 200 项的来源编号')
    const values = input.map((item, index) => boundedString(item, `${field}[${index}]`, 300).trim())
    if (new Set(values).size !== values.length) invalid(field, '不能包含重复来源编号')
    return values
  }
  const pinnedEvidenceKeys = decodeEvidenceKeys(value.pinnedEvidenceKeys, 'pinnedEvidenceKeys')
  const excludedEvidenceKeys = decodeEvidenceKeys(value.excludedEvidenceKeys, 'excludedEvidenceKeys')
  if (pinnedEvidenceKeys.some((key) => excludedEvidenceKeys.includes(key)))
    invalid('excludedEvidenceKeys', '同一来源不能同时固定和移除')
  const inputBudgetTokens = boundedInteger(value.inputBudgetTokens, 'inputBudgetTokens', 4_000, 1_000_000)
  const modelContextLimit = boundedInteger(value.modelContextLimit, 'modelContextLimit', 16_000, 2_000_000)
  const outputReservePercent = boundedInteger(value.outputReservePercent, 'outputReservePercent', 10, 60)
  const systemReserveTokens = boundedInteger(value.systemReserveTokens, 'systemReserveTokens', 1_000, 100_000)
  const recentSummaryCount = boundedInteger(value.recentSummaryCount, 'recentSummaryCount', 2, 5)
  const structuredRepairAttempts = boundedInteger(value.structuredRepairAttempts, 'structuredRepairAttempts', 0, 3)
  const minimumFactImportance = enumValue(value.minimumFactImportance, 'minimumFactImportance', [
    'high',
    'medium',
    'low'
  ])
  const showFactConfirmations = boundedBoolean(value.showFactConfirmations, 'showFactConfirmations')
  const outputReserveTokens = Math.floor((modelContextLimit * outputReservePercent) / 100)
  if (modelContextLimit - outputReserveTokens - systemReserveTokens < 4_000)
    invalid('modelContextLimit', '扣除输出与系统预留后，至少要给作品上下文留下 4000 tokens')
  return [
    {
      version: 1,
      inputBudgetTokens,
      modelContextLimit,
      outputReservePercent,
      systemReserveTokens,
      recentSummaryCount,
      structuredRepairAttempts,
      minimumFactImportance,
      showFactConfirmations,
      pinnedEvidenceKeys,
      excludedEvidenceKeys,
      ...(value.alwaysConfirmBeforeSend === undefined
        ? {}
        : { alwaysConfirmBeforeSend: boundedBoolean(value.alwaysConfirmBeforeSend, 'alwaysConfirmBeforeSend') })
    }
  ]
}

export const decodeAiCompleteArgs: ArgsDecoder<[string, string | undefined, AiTask | undefined, number | undefined]> = (
  args
) => {
  exactArgs(args, 4)
  const instruction = requiredString(args[0], 'instruction', 100_000)
  const draft = args[1] === undefined ? undefined : boundedString(args[1], 'draft', chapterLimits.maxContentLength)
  const task = args[2] === undefined ? undefined : aiTask(args[2])
  const id = args[3] === undefined ? undefined : chapterId(args[3])
  return [instruction, draft, task, id]
}

export const decodeWritingAgentArgs: ArgsDecoder<[WritingAgentRequest]> = (args) => {
  exactArgs(args, 1)
  const value = record(args[0], 'writingAgent')
  rejectUnknown(value, 'writingAgent', [
    'chapterId',
    'message',
    'currentDraft',
    'expectedContextHash',
    'model',
    'modelConnectionId',
    'maxTokensOverride',
    'preferredSkill',
    'selection',
    'insertionAnchor',
    'contextSelection'
  ])
  const input: WritingAgentRequest = {
    chapterId: chapterId(value.chapterId),
    message: requiredString(value.message, 'writingAgent.message', 10_000),
    currentDraft: boundedString(value.currentDraft, 'writingAgent.currentDraft', chapterLimits.maxContentLength)
  }
  if ('expectedContextHash' in value && value.expectedContextHash !== undefined) {
    const expectedContextHash = requiredString(value.expectedContextHash, 'writingAgent.expectedContextHash', 64)
    if (!/^[0-9a-f]{64}$/i.test(expectedContextHash))
      invalid('writingAgent.expectedContextHash', '不是有效的上下文指纹')
    input.expectedContextHash = expectedContextHash.toLowerCase()
  }
  if ('model' in value && value.model !== undefined)
    input.model = requiredString(value.model, 'writingAgent.model', 200)
  if ('modelConnectionId' in value && value.modelConnectionId !== undefined)
    input.modelConnectionId = requiredString(value.modelConnectionId, 'writingAgent.modelConnectionId', 128)
  Object.assign(input, localOutputOverride(value.maxTokensOverride, value.modelConnectionId))
  if ('preferredSkill' in value) {
    const allowed = new Set<WritingAgentSkillId>([
      'continue',
      'rewrite',
      'expand',
      'compress',
      'custom',
      'polish',
      'review',
      'query',
      'plan'
    ])
    if (!allowed.has(value.preferredSkill as WritingAgentSkillId))
      invalid('writingAgent.preferredSkill', '不是受支持的写作能力')
    input.preferredSkill = value.preferredSkill as WritingAgentSkillId
  }
  if ('selection' in value && value.selection !== undefined) {
    const selection = record(value.selection, 'writingAgent.selection')
    rejectUnknown(selection, 'writingAgent.selection', ['start', 'end', 'text'])
    const start = boundedInteger(selection.start, 'writingAgent.selection.start', 0, input.currentDraft.length)
    const end = boundedInteger(selection.end, 'writingAgent.selection.end', start, input.currentDraft.length)
    const text = boundedString(selection.text, 'writingAgent.selection.text', chapterLimits.maxContentLength)
    if (end <= start || input.currentDraft.slice(start, end) !== text)
      invalid('writingAgent.selection', '必须与当前正文中的选区完全一致')
    input.selection = { start, end, text }
  }
  if ('insertionAnchor' in value && value.insertionAnchor !== undefined) {
    const anchor = record(value.insertionAnchor, 'writingAgent.insertionAnchor')
    rejectUnknown(anchor, 'writingAgent.insertionAnchor', ['offset', 'before', 'after'])
    const offset = boundedInteger(anchor.offset, 'writingAgent.insertionAnchor.offset', 0, input.currentDraft.length)
    const before = boundedString(anchor.before, 'writingAgent.insertionAnchor.before', 120)
    const after = boundedString(anchor.after, 'writingAgent.insertionAnchor.after', 120)
    const expectedBefore = input.currentDraft.slice(Math.max(0, offset - 120), offset)
    const expectedAfter = input.currentDraft.slice(offset, offset + 120)
    if (before !== expectedBefore || after !== expectedAfter) {
      invalid('writingAgent.insertionAnchor', '必须与当前正文中的光标位置完全一致')
    }
    input.insertionAnchor = { offset, before, after }
  }
  if ('contextSelection' in value && value.contextSelection !== undefined) {
    const selection = record(value.contextSelection, 'writingAgent.contextSelection')
    rejectUnknown(selection, 'writingAgent.contextSelection', ['pinnedIds', 'excludedIds', 'temporaryAdditions'])
    const decodeIds = (raw: unknown, field: string): string[] => {
      if (!Array.isArray(raw) || raw.length > 100) invalid(field, '最多选择 100 项上下文')
      const ids = raw.map((item, index) => requiredString(item, `${field}[${index}]`, 256))
      if (new Set(ids).size !== ids.length) invalid(field, '不能包含重复项')
      return ids
    }
    const pinnedIds = decodeIds(selection.pinnedIds, 'writingAgent.contextSelection.pinnedIds')
    const excludedIds = decodeIds(selection.excludedIds, 'writingAgent.contextSelection.excludedIds')
    if (pinnedIds.some((id) => excludedIds.includes(id)))
      invalid('writingAgent.contextSelection', '同一来源不能同时固定和移除')
    if (!Array.isArray(selection.temporaryAdditions) || selection.temporaryAdditions.length > 5)
      invalid('writingAgent.contextSelection.temporaryAdditions', '最多临时加入 5 项')
    const temporaryAdditions = selection.temporaryAdditions.map((raw, index) => {
      const addition = record(raw, `writingAgent.contextSelection.temporaryAdditions[${index}]`)
      rejectUnknown(addition, `writingAgent.contextSelection.temporaryAdditions[${index}]`, ['id', 'label', 'content'])
      return {
        id: requiredString(addition.id, `writingAgent.contextSelection.temporaryAdditions[${index}].id`, 256),
        label: requiredString(addition.label, `writingAgent.contextSelection.temporaryAdditions[${index}].label`, 80),
        content: requiredString(
          addition.content,
          `writingAgent.contextSelection.temporaryAdditions[${index}].content`,
          20_000
        )
      }
    })
    if (new Set(temporaryAdditions.map((item) => item.id)).size !== temporaryAdditions.length)
      invalid('writingAgent.contextSelection.temporaryAdditions', '临时资料编号不能重复')
    input.contextSelection = { pinnedIds, excludedIds, temporaryAdditions }
  }
  return [input]
}

export const decodeWritingAgentStartArgs: ArgsDecoder<[WritingAgentTaskStart]> = (args) => {
  exactArgs(args, 1)
  const value = record(args[0], 'writingAgentTask')
  rejectUnknown(value, 'writingAgentTask', ['operationId', 'request'])
  return [
    {
      operationId: uuid(value.operationId, 'writingAgentTask.operationId'),
      request: decodeWritingAgentArgs([value.request])[0]
    }
  ]
}

export const decodeWritingAgentRetryArgs: ArgsDecoder<[string, string]> = (args) => {
  exactArgs(args, 2)
  return [uuid(args[0], 'taskId'), uuid(args[1], 'operationId')]
}

export const decodeWritingAgentArtifactDecisionArgs: ArgsDecoder<[WritingAgentArtifactDecision]> = (args) => {
  exactArgs(args, 1)
  const value = record(args[0], 'writingAgentDecision')
  rejectUnknown(value, 'writingAgentDecision', ['taskId', 'decision', 'acceptedChangeIds', 'reviewedChangeIds'])
  if (value.decision !== 'applied' && value.decision !== 'discarded')
    invalid('writingAgentDecision.decision', '不是支持的决定')
  const result: WritingAgentArtifactDecision = {
    taskId: uuid(value.taskId, 'writingAgentDecision.taskId'),
    decision: value.decision
  }
  if ('acceptedChangeIds' in value && value.acceptedChangeIds !== undefined) {
    if (!Array.isArray(value.acceptedChangeIds) || value.acceptedChangeIds.length > 500)
      invalid('writingAgentDecision.acceptedChangeIds', '格式无效')
    const ids = value.acceptedChangeIds.map((item, index) =>
      requiredString(item, `writingAgentDecision.acceptedChangeIds[${index}]`, 120)
    )
    if (new Set(ids).size !== ids.length) invalid('writingAgentDecision.acceptedChangeIds', '不能包含重复项')
    result.acceptedChangeIds = ids
  }
  if ('reviewedChangeIds' in value && value.reviewedChangeIds !== undefined) {
    if (!Array.isArray(value.reviewedChangeIds) || value.reviewedChangeIds.length > 500)
      invalid('writingAgentDecision.reviewedChangeIds', '格式无效')
    const ids = value.reviewedChangeIds.map((item, index) =>
      requiredString(item, `writingAgentDecision.reviewedChangeIds[${index}]`, 120)
    )
    if (new Set(ids).size !== ids.length) invalid('writingAgentDecision.reviewedChangeIds', '不能包含重复项')
    result.reviewedChangeIds = ids
  }
  return [result]
}

export const decodeWritingAgentArtifactApplicationArgs: ArgsDecoder<[WritingAgentArtifactApplicationInput]> = (
  args
) => {
  exactArgs(args, 1)
  const value = record(args[0], 'writingAgentApplication')
  rejectUnknown(value, 'writingAgentApplication', [
    'taskId',
    'title',
    'expectedRevision',
    'acceptedChangeIds',
    'allowFailedReview',
    'formatting',
    'rebase'
  ])
  const expectedRevision = requiredString(value.expectedRevision, 'writingAgentApplication.expectedRevision', 64)
  if (!/^[0-9a-f]{64}$/i.test(expectedRevision)) invalid('writingAgentApplication.expectedRevision', '格式无效')
  const formatting = record(value.formatting, 'writingAgentApplication.formatting')
  rejectUnknown(formatting, 'writingAgentApplication.formatting', ['firstLineIndent', 'paragraphSpacing'])
  if (typeof formatting.firstLineIndent !== 'boolean' || typeof formatting.paragraphSpacing !== 'boolean') {
    invalid('writingAgentApplication.formatting', '必须明确首行缩进和段间距设置')
  }
  const result: WritingAgentArtifactApplicationInput = {
    taskId: uuid(value.taskId, 'writingAgentApplication.taskId'),
    title: requiredString(value.title, 'writingAgentApplication.title', 500),
    expectedRevision,
    formatting: {
      firstLineIndent: formatting.firstLineIndent,
      paragraphSpacing: formatting.paragraphSpacing
    }
  }
  if (value.rebase !== undefined) {
    const rebase = record(value.rebase, 'writingAgentApplication.rebase')
    rejectUnknown(rebase, 'writingAgentApplication.rebase', ['choices'])
    const choices = record(rebase.choices, 'writingAgentApplication.rebase.choices')
    if (Object.keys(choices).length > 500) invalid('writingAgentApplication.rebase.choices', '选择过多')
    const accepted: Record<string, 'current' | 'candidate'> = {}
    for (const [id, choice] of Object.entries(choices)) {
      if (!/^conflict-[1-9]\d{0,3}$/.test(id) || (choice !== 'current' && choice !== 'candidate'))
        invalid('writingAgentApplication.rebase.choices', '合并选择无效')
      accepted[id] = choice
    }
    result.rebase = { choices: accepted }
  }
  if ('allowFailedReview' in value && value.allowFailedReview !== undefined) {
    if (typeof value.allowFailedReview !== 'boolean')
      invalid('writingAgentApplication.allowFailedReview', '必须是布尔值')
    result.allowFailedReview = value.allowFailedReview
  }
  if ('acceptedChangeIds' in value && value.acceptedChangeIds !== undefined) {
    if (!Array.isArray(value.acceptedChangeIds) || value.acceptedChangeIds.length > 500)
      invalid('writingAgentApplication.acceptedChangeIds', '格式无效')
    const ids = value.acceptedChangeIds.map((item, index) =>
      requiredString(item, `writingAgentApplication.acceptedChangeIds[${index}]`, 120)
    )
    if (new Set(ids).size !== ids.length) invalid('writingAgentApplication.acceptedChangeIds', '不能包含重复项')
    result.acceptedChangeIds = ids
  }
  return [result]
}

export const promptTask = (value: unknown, field = 'task'): AiTask => {
  if (value === 'outline' || value === 'chapterOutline' || value === 'prose' || value === 'review') return value
  invalid(field, '不是支持的提示词任务')
}

export const decodePromptOverrideArgs: ArgsDecoder<[{ task: AiTask; content: string }]> = (args) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'promptOverride', ['task', 'content'])
  return [{ task: promptTask(value.task), content: requiredString(value.content, 'content', 50_000) }]
}

export const decodePromptTaskArgs: ArgsDecoder<[AiTask]> = (args) => {
  exactArgs(args, 1)
  return [promptTask(args[0])]
}
