import { isAbsolute } from 'node:path'
import type { ChapterAutosaveStageInput, ChapterRevisionReason } from '../index'
import type { ArgsDecoder } from '../core/validation'
import { boundedInteger, boundedString, exactArgs, invalid, record, rejectUnknown, uuid } from '../core/validation'
import { chapterId, chapterLimits } from './validation'
import { bookProfileLimits } from '../worldbuilding/validation'
import type { ManuscriptExportSelection } from './types'

export const decodeManuscriptExportArgs: ArgsDecoder<[ManuscriptExportSelection | undefined]> = (args) => {
  if (!args.length) return [undefined]
  exactArgs(args, 1)
  const value = record(args[0], 'selection')
  rejectUnknown(value, 'selection', ['workItemId', 'workItemPath', 'chapterIds'])
  const workItemId = boundedString(value.workItemId, 'workItemId', 32_767).trim()
  const workItemPath = boundedString(value.workItemPath, 'workItemPath', 32_767).trim()
  if (!workItemId || !workItemPath || !isAbsolute(workItemPath)) invalid('selection', '作品身份无效')
  if (!Array.isArray(value.chapterIds) || !value.chapterIds.length || value.chapterIds.length > 100_000) {
    invalid('chapterIds', '请选择 1 到 100000 个章节')
  }
  const chapterIds = value.chapterIds.map(chapterId)
  if (new Set(chapterIds).size !== chapterIds.length) invalid('chapterIds', '不能包含重复章节')
  return [{ workItemId, workItemPath, chapterIds }]
}

export type ChapterUpdateInput = {
  title?: string
  content?: string
  reason?: ChapterRevisionReason
  expectedRevision?: string
  sourceTaskRunId?: string
  generationArtifactId?: string
  workItemId?: string
  workItemPath?: string
}

export type ChapterDraftRecoveryInput = {
  title: string
  content: string
  baseRevision?: string
  workItemId?: string
  workItemPath?: string
}

export const decodeChapterIdArgs: ArgsDecoder<[number]> = (args) => {
  exactArgs(args, 1)
  return [chapterId(args[0])]
}

export const decodeChapterReorderArgs: ArgsDecoder<[number, number]> = (args) => {
  exactArgs(args, 2)
  const position = args[1]
  if (!Number.isSafeInteger(position) || Number(position) < 1 || Number(position) > chapterLimits.maxId) {
    invalid('position', `必须是 1 到 ${chapterLimits.maxId} 的整数`)
  }
  return [chapterId(args[0]), Number(position)]
}

export const decodeChapterUpdateArgs: ArgsDecoder<[number, ChapterUpdateInput]> = (args) => {
  exactArgs(args, 2)
  const id = chapterId(args[0])
  const value = record(args[1], 'data')
  const allowed = new Set([
    'title',
    'content',
    'reason',
    'expectedRevision',
    'sourceTaskRunId',
    'generationArtifactId',
    'workItemId',
    'workItemPath'
  ])
  const unknownField = Object.keys(value).find((key) => !allowed.has(key))
  if (unknownField) invalid('data', '包含未允许的字段')

  const update: ChapterUpdateInput = {}
  if ('title' in value) update.title = boundedString(value.title, 'title', chapterLimits.maxTitleLength)
  if ('content' in value) update.content = boundedString(value.content, 'content', chapterLimits.maxContentLength)
  if ('reason' in value) {
    if (!['manual', 'autosave', 'ai', 'restore'].includes(String(value.reason)))
      invalid('reason', '不是受支持的保存来源')
    update.reason = value.reason as ChapterRevisionReason
  }
  if ('expectedRevision' in value) {
    const revision = boundedString(value.expectedRevision, 'expectedRevision', 64).trim()
    if (!/^[0-9a-f]{64}$/i.test(revision)) invalid('expectedRevision', '格式无效')
    update.expectedRevision = revision
  }
  if ('sourceTaskRunId' in value) update.sourceTaskRunId = uuid(value.sourceTaskRunId, 'sourceTaskRunId')
  if ('generationArtifactId' in value)
    update.generationArtifactId = uuid(value.generationArtifactId, 'generationArtifactId')
  if (Boolean(update.sourceTaskRunId) !== Boolean(update.generationArtifactId))
    invalid('generationArtifactId', '必须与 AI 任务来源同时提供')
  if ((update.sourceTaskRunId || update.generationArtifactId) && update.reason !== 'ai')
    invalid('sourceTaskRunId', '只能用于 AI 正文版本')
  if ('workItemId' in value) update.workItemId = boundedString(value.workItemId, 'workItemId', 200).trim()
  if ('workItemPath' in value) {
    const path = boundedString(value.workItemPath, 'workItemPath', 32_767).trim()
    if (!path || !isAbsolute(path)) invalid('workItemPath', '必须是绝对项目路径')
    update.workItemPath = path
  }
  return [id, update]
}

export const decodeChapterAutosaveStageArgs: ArgsDecoder<[number, ChapterAutosaveStageInput]> = (args) => {
  exactArgs(args, 2)
  const id = chapterId(args[0])
  const value = record(args[1], 'data')
  rejectUnknown(value, 'data', [
    'title',
    'content',
    'clientOperationId',
    'baseBodyVersionId',
    'expectedRevision',
    'mergeWindowMs',
    'workItemId',
    'workItemPath'
  ])
  const result: ChapterAutosaveStageInput = {
    title: boundedString(value.title, 'title', chapterLimits.maxTitleLength),
    content: boundedString(value.content, 'content', chapterLimits.maxContentLength),
    clientOperationId: uuid(value.clientOperationId, 'clientOperationId')
  }
  if ('baseBodyVersionId' in value) result.baseBodyVersionId = uuid(value.baseBodyVersionId, 'baseBodyVersionId')
  if ('expectedRevision' in value) {
    const revision = boundedString(value.expectedRevision, 'expectedRevision', 64).trim()
    if (!/^[0-9a-f]{64}$/i.test(revision)) invalid('expectedRevision', '格式无效')
    result.expectedRevision = revision
  }
  if ('mergeWindowMs' in value) {
    const duration = boundedInteger(
      value.mergeWindowMs,
      'mergeWindowMs',
      bookProfileLimits.minAutosaveMergeWindowMs,
      bookProfileLimits.maxAutosaveMergeWindowMs
    )
    result.mergeWindowMs = duration
  }
  if ('workItemId' in value) result.workItemId = boundedString(value.workItemId, 'workItemId', 200).trim()
  if ('workItemPath' in value) {
    const path = boundedString(value.workItemPath, 'workItemPath', 32_767).trim()
    if (!path || !isAbsolute(path)) invalid('workItemPath', '必须是绝对项目路径')
    result.workItemPath = path
  }
  return [id, result]
}

export const decodeAutosaveCheckpointIdArgs: ArgsDecoder<[string]> = (args) => {
  exactArgs(args, 1)
  return [uuid(args[0], 'checkpointId')]
}

export const decodeChapterMirrorRecoveryTokenArgs: ArgsDecoder<[string]> = (args) => {
  exactArgs(args, 1)
  return [uuid(args[0], 'mirrorRecoveryToken')]
}

export const decodeChapterDraftRecoveryArgs: ArgsDecoder<[number, ChapterDraftRecoveryInput]> = (args) => {
  exactArgs(args, 2)
  const id = chapterId(args[0])
  const value = record(args[1], 'draft')
  rejectUnknown(value, 'draft', ['title', 'content', 'baseRevision', 'workItemId', 'workItemPath'])
  const input: ChapterDraftRecoveryInput = {
    title: boundedString(value.title, 'title', chapterLimits.maxTitleLength),
    content: boundedString(value.content, 'content', chapterLimits.maxContentLength)
  }
  if (value.baseRevision !== undefined) {
    const revision = boundedString(value.baseRevision, 'baseRevision', 64).trim()
    if (!/^[0-9a-f]{64}$/i.test(revision)) invalid('baseRevision', '格式无效')
    input.baseRevision = revision
  }
  if (value.workItemId !== undefined) input.workItemId = boundedString(value.workItemId, 'workItemId', 200).trim()
  if (value.workItemPath !== undefined) {
    const path = boundedString(value.workItemPath, 'workItemPath', 32_767).trim()
    if (!path || !isAbsolute(path)) invalid('workItemPath', '必须是绝对项目路径')
    input.workItemPath = path
  }
  return [id, input]
}

export const decodeChapterRevisionArgs: ArgsDecoder<[number, string]> = (args) => {
  exactArgs(args, 2)
  const revisionId = boundedString(args[1], 'revisionId', 64)
  if (!/^\d{13}-[0-9a-f-]{36}$/i.test(revisionId)) invalid('revisionId', '格式无效')
  return [chapterId(args[0]), revisionId]
}

export const decodeChapterRevisionLabelArgs: ArgsDecoder<[number, string]> = (args) => {
  exactArgs(args, 2)
  const label = boundedString(args[1], 'label', 80).trim()
  if (!label) invalid('label', '不能为空')
  return [chapterId(args[0]), label]
}

export const decodeOptionalChapterIdArgs: ArgsDecoder<[number | undefined]> = (args) => {
  exactArgs(args, 1)
  return [args[0] === undefined ? undefined : chapterId(args[0])]
}
