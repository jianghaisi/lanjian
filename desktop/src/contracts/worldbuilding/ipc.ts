import type {
  BookProfile,
  CheatSystemData,
  FoundationData,
  PowerSystemData,
  RealmLevel,
  SourceCardCreateInput,
  SourceCardUpdateInput
} from '../index'
import type { ArgsDecoder } from '../core/validation'
import {
  boundedBoolean,
  boundedInteger,
  boundedString,
  exactArgs,
  exactRecord,
  invalid,
  record,
  rejectUnknown,
  requiredString,
  uuid
} from '../core/validation'
import { bookProfileLimits } from './validation'
import { httpUrl } from '../models/validation'
import { planningLimits } from '../planning/validation'

export const decodeBookProfileArgs: ArgsDecoder<[BookProfile]> = (args) => {
  exactArgs(args, 1)
  const raw = record(args[0], 'bookProfile')
  const { revision, assistantCandidateIds, ...fields } = raw
  const value = exactRecord(fields, 'bookProfile', [
    'genre',
    'subgenre',
    'coreIdea',
    'plannedVolumes',
    'chaptersPerVolume',
    'targetWordsPerChapter',
    'targetWords',
    'audienceScale',
    'defaultPov',
    'narrativeDistance',
    'writingStyle',
    'proseExpansionMode',
    'reviewStrictness',
    'chapterGenerationMode',
    'autosaveEnabled',
    'autosaveDelayMs',
    'autosaveMergeWindowMs'
  ])
  if (revision !== undefined && (typeof revision !== 'string' || !/^[0-9a-f]{64}$/.test(revision)))
    invalid('revision', '格式无效')
  if (
    assistantCandidateIds !== undefined &&
    (!Array.isArray(assistantCandidateIds) || assistantCandidateIds.length > 50)
  )
    invalid('assistantCandidateIds', '格式无效')
  const sourceIds = (assistantCandidateIds as unknown[] | undefined)?.map((item) => uuid(item, 'assistantCandidateId'))
  const proseExpansionMode = String(value.proseExpansionMode || '')
  if (!['web-serial', 'balanced', 'compact'].includes(proseExpansionMode))
    invalid('proseExpansionMode', '不是受支持的正文展开方式')
  const reviewStrictness = String(value.reviewStrictness || '')
  if (!['balanced', 'strict'].includes(reviewStrictness)) invalid('reviewStrictness', '不是受支持的审校强度')
  const chapterGenerationMode = value.chapterGenerationMode === undefined ? 'reviewed' : value.chapterGenerationMode
  if (chapterGenerationMode !== 'reviewed') invalid('chapterGenerationMode', '快捷生成已停用，章节生成只使用完整流程')
  return [
    {
      ...(revision === undefined ? {} : { revision: revision as string }),
      ...(sourceIds === undefined ? {} : { assistantCandidateIds: sourceIds }),
      genre: requiredString(value.genre, 'genre', 80),
      subgenre: boundedString(value.subgenre, 'subgenre', 120).trim(),
      coreIdea: requiredString(value.coreIdea, 'coreIdea', 5_000),
      plannedVolumes: boundedInteger(value.plannedVolumes, 'plannedVolumes', 1, bookProfileLimits.maxVolumes),
      chaptersPerVolume: boundedInteger(
        value.chaptersPerVolume,
        'chaptersPerVolume',
        1,
        bookProfileLimits.maxChaptersPerVolume
      ),
      targetWordsPerChapter: boundedInteger(
        value.targetWordsPerChapter,
        'targetWordsPerChapter',
        bookProfileLimits.minWordsPerChapter,
        bookProfileLimits.maxWordsPerChapter
      ),
      targetWords: boundedInteger(
        value.targetWords,
        'targetWords',
        bookProfileLimits.minTotalWords,
        bookProfileLimits.maxTotalWords
      ),
      audienceScale: boundedString(
        value.audienceScale,
        'audienceScale',
        bookProfileLimits.maxWritingConstraintLength
      ).trim(),
      defaultPov: boundedString(value.defaultPov, 'defaultPov', bookProfileLimits.maxWritingConstraintLength).trim(),
      narrativeDistance: boundedString(
        value.narrativeDistance,
        'narrativeDistance',
        bookProfileLimits.maxWritingConstraintLength
      ).trim(),
      writingStyle: boundedString(
        value.writingStyle,
        'writingStyle',
        bookProfileLimits.maxWritingConstraintLength
      ).trim(),
      proseExpansionMode: proseExpansionMode as BookProfile['proseExpansionMode'],
      reviewStrictness: reviewStrictness as BookProfile['reviewStrictness'],
      chapterGenerationMode: chapterGenerationMode as BookProfile['chapterGenerationMode'],
      autosaveEnabled: boundedBoolean(value.autosaveEnabled, 'autosaveEnabled'),
      autosaveDelayMs: boundedInteger(
        value.autosaveDelayMs,
        'autosaveDelayMs',
        bookProfileLimits.minAutosaveDelayMs,
        bookProfileLimits.maxAutosaveDelayMs
      ),
      autosaveMergeWindowMs: boundedInteger(
        value.autosaveMergeWindowMs,
        'autosaveMergeWindowMs',
        bookProfileLimits.minAutosaveMergeWindowMs,
        bookProfileLimits.maxAutosaveMergeWindowMs
      )
    }
  ]
}

export const decodeResearchSettingsArgs: ArgsDecoder<
  [{ baseUrl?: string; model?: string; apiKey?: string; clearApiKey?: boolean }]
> = (args) => {
  exactArgs(args, 1)
  const value = record(args[0], 'settings')
  rejectUnknown(value, 'settings', ['baseUrl', 'model', 'apiKey', 'clearApiKey'])
  const update: { baseUrl?: string; model?: string; apiKey?: string; clearApiKey?: boolean } = {}
  if ('baseUrl' in value) update.baseUrl = httpUrl(value.baseUrl, 'baseUrl')
  if ('model' in value) update.model = requiredString(value.model, 'model', 200)
  if ('apiKey' in value) update.apiKey = boundedString(value.apiKey, 'apiKey', 4_096).trim()
  if ('clearApiKey' in value) {
    if (typeof value.clearApiKey !== 'boolean') invalid('clearApiKey', '必须是布尔值')
    update.clearApiKey = value.clearApiKey
  }
  return [update]
}

export const decodeResearchQueryArgs: ArgsDecoder<[string]> = (args) => {
  exactArgs(args, 1)
  const query = requiredString(args[0], 'query', 500)
  if (query.length < 2) invalid('query', '至少需要两个字')
  return [query]
}

export const decodeSourceCardCreateArgs: ArgsDecoder<[SourceCardCreateInput]> = (args) => {
  exactArgs(args, 1)
  const value = record(args[0], 'source')
  rejectUnknown(value, 'source', [
    'title',
    'url',
    'author',
    'publishedAt',
    'excerpt',
    'userNotes',
    'sourceType',
    'provider',
    'references'
  ])
  const sourceType = value.sourceType === undefined ? 'manual' : value.sourceType
  if (sourceType !== 'manual' && sourceType !== 'web') invalid('sourceType', '当前只允许作者资料或联网采风资料')
  const input: SourceCardCreateInput = {
    title: requiredString(value.title, 'title', 200),
    excerpt: boundedString(value.excerpt, 'excerpt', 20_000).trim(),
    userNotes: boundedString(value.userNotes, 'userNotes', 20_000).trim(),
    sourceType
  }
  if (!input.excerpt && !input.userNotes) invalid('source', '摘录和个人笔记至少填写一项')
  if ('url' in value && value.url !== '') input.url = httpUrl(value.url, 'url')
  if ('author' in value && value.author !== '') input.author = boundedString(value.author, 'author', 200).trim()
  if ('publishedAt' in value && value.publishedAt !== '')
    input.publishedAt = boundedString(value.publishedAt, 'publishedAt', 100).trim()
  if ('provider' in value && value.provider !== '')
    input.provider = boundedString(value.provider, 'provider', 200).trim()
  if ('references' in value) {
    if (!Array.isArray(value.references) || value.references.length > 100)
      invalid('references', '必须是最多 100 项来源的数组')
    input.references = value.references.map((item, index) => {
      const reference = exactRecord(item, `references[${index}]`, ['title', 'url'])
      return {
        title: requiredString(reference.title, `references[${index}].title`, 500),
        url: httpUrl(reference.url, `references[${index}].url`)
      }
    })
  }
  if (sourceType === 'web' && !input.references?.length && !input.url)
    invalid('source', '联网采风资料必须保留至少一个来源网址')
  return [input]
}

export const decodeSourceCardUpdateArgs: ArgsDecoder<[string, SourceCardUpdateInput]> = (args) => {
  exactArgs(args, 2)
  const id = uuid(args[0], 'sourceId')
  const value = record(args[1], 'source')
  rejectUnknown(value, 'source', ['title', 'url', 'author', 'publishedAt', 'excerpt', 'userNotes'])
  const input: SourceCardUpdateInput = {
    title: requiredString(value.title, 'title', 200),
    userNotes: boundedString(value.userNotes, 'userNotes', 20_000).trim()
  }
  if ('excerpt' in value) input.excerpt = boundedString(value.excerpt, 'excerpt', 20_000).trim()
  if ('url' in value) input.url = value.url === '' ? undefined : httpUrl(value.url, 'url')
  if ('author' in value) input.author = boundedString(value.author, 'author', 200).trim() || undefined
  if ('publishedAt' in value)
    input.publishedAt = boundedString(value.publishedAt, 'publishedAt', 100).trim() || undefined
  if (!input.excerpt && !input.userNotes) invalid('source', '摘录和个人笔记至少填写一项')
  return [id, input]
}

export const decodeFoundationArgs: ArgsDecoder<[FoundationData]> = (args) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'foundation', [
    'creationPath',
    'sourceNotes',
    'worldView',
    'useRealms',
    'useSystem'
  ])
  if (value.creationPath !== 'research' && value.creationPath !== 'materials')
    invalid('creationPath', '不是受支持的创作路径')
  if (typeof value.useRealms !== 'boolean') invalid('useRealms', '必须是布尔值')
  if (typeof value.useSystem !== 'boolean') invalid('useSystem', '必须是布尔值')
  return [
    {
      creationPath: value.creationPath,
      sourceNotes: boundedString(value.sourceNotes, 'sourceNotes', planningLimits.maxSourceNotesLength),
      worldView: boundedString(value.worldView, 'worldView', planningLimits.maxWorldViewLength),
      useRealms: value.useRealms,
      useSystem: value.useSystem
    }
  ]
}

export const decodeRealmsArgs: ArgsDecoder<[RealmLevel[]]> = (args) => {
  exactArgs(args, 1)
  if (!Array.isArray(args[0])) invalid('levels', '必须是数组')
  if (args[0].length > planningLimits.maxRealms) invalid('levels', `数量不能超过 ${planningLimits.maxRealms}`)
  return [
    args[0].map((item, index) => {
      const value = exactRecord(item, `levels[${index}]`, ['id', 'name', 'description'])
      return {
        id: requiredString(value.id, `levels[${index}].id`, 128),
        name: requiredString(value.name, `levels[${index}].name`, 120),
        description: requiredString(value.description, `levels[${index}].description`, 5_000)
      }
    })
  ]
}

export const decodePowerSystemArgs: ArgsDecoder<[PowerSystemData]> = (args) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'powerSystem', ['overview'])
  return [{ overview: boundedString(value.overview, 'overview', planningLimits.maxWorldViewLength) }]
}

export const decodeCheatSystemArgs: ArgsDecoder<[CheatSystemData]> = (args) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'cheatSystem', ['overview'])
  return [{ overview: boundedString(value.overview, 'cheatSystem.overview', planningLimits.maxSystemTemplateLength) }]
}

export const decodeSystemTemplateArgs: ArgsDecoder<[string]> = (args) => {
  exactArgs(args, 1)
  return [boundedString(args[0], 'template', planningLimits.maxSystemTemplateLength)]
}
