import { isAbsolute } from 'node:path'
import type { AutoBackupPreferences, ProjectCreateInput, WorkspaceBootstrapIssue } from '../index'
import type { ArgsDecoder } from '../core/validation'
import {
  boundedBoolean,
  boundedInteger,
  boundedString,
  exactArgs,
  exactRecord,
  invalid,
  record,
  uuid
} from '../core/validation'
import { bookProfileLimits } from '../worldbuilding/validation'

export const decodeProjectPathArgs: ArgsDecoder<[string]> = (args) => {
  exactArgs(args, 1)
  const path = boundedString(args[0], 'path', 32_767).trim()
  if (!path || !isAbsolute(path)) invalid('path', '必须是绝对文件夹路径')
  return [path]
}

export const decodeProjectCreateArgs: ArgsDecoder<[ProjectCreateInput]> = (args) => {
  exactArgs(args, 1)
  const value = record(args[0], 'project')
  const allowed = new Set([
    'parentPath',
    'path',
    'name',
    'title',
    'genre',
    'subgenre',
    'coreIdea',
    'plannedVolumes',
    'chaptersPerVolume',
    'targetWordsPerChapter',
    'mode'
  ])
  if (Object.keys(value).some((key) => !allowed.has(key))) invalid('project', '包含未允许的字段')

  const input: ProjectCreateInput = {}
  for (const field of ['parentPath', 'path'] as const) {
    if (field in value) {
      const path = boundedString(value[field], field, 32_767).trim()
      if (!path || !isAbsolute(path)) invalid(field, '必须是绝对文件夹路径')
      input[field] = path
    }
  }
  for (const [field, maxLength] of [
    ['name', 120],
    ['title', 120],
    ['genre', 80],
    ['subgenre', 120],
    ['coreIdea', 5_000],
    ['mode', 40]
  ] as const) {
    if (field in value) input[field] = boundedString(value[field], field, maxLength).trim()
  }
  if ('plannedVolumes' in value)
    input.plannedVolumes = boundedInteger(value.plannedVolumes, 'plannedVolumes', 1, bookProfileLimits.maxVolumes)
  if ('chaptersPerVolume' in value)
    input.chaptersPerVolume = boundedInteger(
      value.chaptersPerVolume,
      'chaptersPerVolume',
      1,
      bookProfileLimits.maxChaptersPerVolume
    )
  if ('targetWordsPerChapter' in value)
    input.targetWordsPerChapter = boundedInteger(
      value.targetWordsPerChapter,
      'targetWordsPerChapter',
      bookProfileLimits.minWordsPerChapter,
      bookProfileLimits.maxWordsPerChapter
    )
  if (!input.path && !input.parentPath) invalid('parentPath', '不能为空')
  if (!(input.name || input.title)) invalid('name', '不能为空')
  return [input]
}

export const decodeAutoBackupPreferencesArgs: ArgsDecoder<[AutoBackupPreferences]> = (args) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'autoBackup', [
    'enabled',
    'targetParentPath',
    'backupOnFirstOpen',
    'intervalMinutes',
    'retentionCount'
  ])
  const enabled = boundedBoolean(value.enabled, 'enabled')
  const targetParentPath = boundedString(value.targetParentPath, 'targetParentPath', 32_767).trim()
  if (enabled && !targetParentPath) invalid('targetParentPath', '开启自动备份前必须选择保存文件夹')
  return [
    {
      enabled,
      targetParentPath,
      backupOnFirstOpen: boundedBoolean(value.backupOnFirstOpen, 'backupOnFirstOpen'),
      intervalMinutes: boundedInteger(value.intervalMinutes, 'intervalMinutes', 15, 1_440),
      retentionCount: boundedInteger(value.retentionCount, 'retentionCount', 1, 50)
    }
  ]
}

export const decodeAutoBackupRunArgs: ArgsDecoder<[boolean]> = (args) => {
  exactArgs(args, 1)
  return [boundedBoolean(args[0], 'force')]
}

export const decodeSqliteShadowMigrationTokenArgs: ArgsDecoder<[string]> = (args) => {
  exactArgs(args, 1)
  return [uuid(args[0], 'token')]
}

export const decodeWorkspaceBootstrapIssueIdArgs: ArgsDecoder<[WorkspaceBootstrapIssue['id']]> = (args) => {
  exactArgs(args, 1)
  const issueId = boundedString(args[0], 'issueId', 80)
  const supported: WorkspaceBootstrapIssue['id'][] = [
    'planningDraftUnreadable',
    'promptProfileUnreadable',
    'researchSourcesUnreadable',
    'researchEventsUnreadable',
    'outlinePlanningUnreadable',
    'characterStateUnreadable',
    'chapterOrderUnreadable'
  ]
  if (!supported.includes(issueId as WorkspaceBootstrapIssue['id'])) invalid('issueId', '不是可定位的作品问题')
  return [issueId as WorkspaceBootstrapIssue['id']]
}
