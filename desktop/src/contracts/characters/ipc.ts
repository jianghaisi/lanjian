import { readWorldbookProfile } from './worldbook'
import type { ArgsDecoder } from '../core/validation'
import {
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
import { chapterLimits } from '../manuscript/validation'

export const decodeCharacterAliasesArgs: ArgsDecoder<[{ canonicalName: string; aliases: string[] }]> = (args) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'characterAliases', ['canonicalName', 'aliases'])
  if (!Array.isArray(value.aliases) || value.aliases.length > 100) invalid('characterAliases.aliases', '数量无效')
  return [
    {
      canonicalName: requiredString(value.canonicalName, 'characterAliases.canonicalName', 160),
      aliases: value.aliases.map((item, index) => requiredString(item, `characterAliases.aliases[${index}]`, 160))
    }
  ]
}

export const decodeStoryEntityArgs: ArgsDecoder<
  [
    {
      id?: string
      entityType: 'character' | 'location' | 'item' | 'organization' | 'world_rule'
      canonicalName: string
      profileJson?: string
      status?: 'candidate' | 'approved' | 'archived'
    }
  ]
> = (args) => {
  exactArgs(args, 1)
  const value = record(args[0], 'storyEntity')
  rejectUnknown(value, 'storyEntity', ['id', 'entityType', 'canonicalName', 'profileJson', 'status'])
  const entityType = requiredString(value.entityType, 'storyEntity.entityType', 32)
  if (!['character', 'location', 'item', 'organization', 'world_rule'].includes(entityType))
    invalid('storyEntity.entityType', '不是受支持的类型')
  const status = value.status === undefined ? undefined : requiredString(value.status, 'storyEntity.status', 32)
  if (status !== undefined && !['candidate', 'approved', 'archived'].includes(status))
    invalid('storyEntity.status', '不是受支持的状态')
  const result: {
    id?: string
    entityType: 'character' | 'location' | 'item' | 'organization' | 'world_rule'
    canonicalName: string
    profileJson?: string
    status?: 'candidate' | 'approved' | 'archived'
  } = {
    entityType: entityType as 'character' | 'location' | 'item' | 'organization' | 'world_rule',
    canonicalName: requiredString(value.canonicalName, 'storyEntity.canonicalName', 160)
  }
  if (value.id !== undefined) result.id = uuid(value.id, 'storyEntity.id')
  if (value.profileJson !== undefined) {
    const profileJson = boundedString(value.profileJson, 'storyEntity.profileJson', 500_000)
    try {
      readWorldbookProfile(JSON.parse(profileJson))
    } catch {
      invalid('storyEntity.profileJson', '必须是有效 JSON，且世界书版本、字段和引用格式正确')
    }
    result.profileJson = profileJson
  }
  if (status !== undefined) result.status = status as 'candidate' | 'approved' | 'archived'
  return [result]
}

export const decodeStoryEntityRelationArgs: ArgsDecoder<
  [{ subjectEntityId: string; predicate: string; objectEntityId: string; notes?: string }]
> = (args) => {
  exactArgs(args, 1)
  const value = record(args[0], 'storyEntityRelation')
  rejectUnknown(value, 'storyEntityRelation', ['subjectEntityId', 'predicate', 'objectEntityId', 'notes'])
  const result: { subjectEntityId: string; predicate: string; objectEntityId: string; notes?: string } = {
    subjectEntityId: uuid(value.subjectEntityId, 'storyEntityRelation.subjectEntityId'),
    predicate: requiredString(value.predicate, 'storyEntityRelation.predicate', 160),
    objectEntityId: uuid(value.objectEntityId, 'storyEntityRelation.objectEntityId')
  }
  if (value.notes !== undefined) result.notes = boundedString(value.notes, 'storyEntityRelation.notes', 5_000).trim()
  return [result]
}

export const decodeResourceLedgerAppendArgs: ArgsDecoder<
  [{ operationKey: string; resourceEntityId: string; delta: number; eventId?: string; factId?: string; note?: string }]
> = (args) => {
  exactArgs(args, 1)
  const value = record(args[0], 'resourceLedger')
  rejectUnknown(value, 'resourceLedger', ['operationKey', 'resourceEntityId', 'delta', 'eventId', 'factId', 'note'])
  const delta = boundedInteger(value.delta, 'resourceLedger.delta', -1_000_000_000, 1_000_000_000)
  if (delta === 0) invalid('resourceLedger.delta', '不能为零')
  const result: {
    operationKey: string
    resourceEntityId: string
    delta: number
    eventId?: string
    factId?: string
    note?: string
  } = {
    operationKey: uuid(value.operationKey, 'resourceLedger.operationKey'),
    resourceEntityId: uuid(value.resourceEntityId, 'resourceLedger.resourceEntityId'),
    delta
  }
  if (value.eventId !== undefined && String(value.eventId).trim())
    result.eventId = requiredString(value.eventId, 'resourceLedger.eventId', 200)
  if (value.factId !== undefined && String(value.factId).trim())
    result.factId = uuid(value.factId, 'resourceLedger.factId')
  if (value.note !== undefined) result.note = boundedString(value.note, 'resourceLedger.note', 2_000).trim()
  return [result]
}

export const decodeForeshadowActionArgs: ArgsDecoder<
  [
    {
      operationKey: string
      action: 'plant' | 'advance' | 'misdirect' | 'resolve' | 'hold' | 'discard'
      title?: string
      foreshadowId?: string
      legacyChapterId?: number
      description?: string
      evidence?: string
      sourceType: 'manual' | 'chapter_draft' | 'writing_agent'
    }
  ]
> = (args) => {
  exactArgs(args, 1)
  const value = record(args[0], 'foreshadowAction')
  rejectUnknown(value, 'foreshadowAction', [
    'operationKey',
    'action',
    'title',
    'foreshadowId',
    'legacyChapterId',
    'description',
    'evidence',
    'sourceType'
  ])
  const action = String(value.action)
  const sourceType = String(value.sourceType)
  if (!['plant', 'advance', 'misdirect', 'resolve', 'hold', 'discard'].includes(action))
    invalid('foreshadowAction.action', '不是受支持的伏笔动作')
  if (!['manual', 'chapter_draft', 'writing_agent'].includes(sourceType))
    invalid('foreshadowAction.sourceType', '不是受支持的伏笔来源')
  const result: {
    operationKey: string
    action: 'plant' | 'advance' | 'misdirect' | 'resolve' | 'hold' | 'discard'
    title?: string
    foreshadowId?: string
    legacyChapterId?: number
    description?: string
    evidence?: string
    sourceType: 'manual' | 'chapter_draft' | 'writing_agent'
  } = {
    operationKey: uuid(value.operationKey, 'foreshadowAction.operationKey'),
    action: action as 'plant' | 'advance' | 'misdirect' | 'resolve' | 'hold' | 'discard',
    sourceType: sourceType as 'manual' | 'chapter_draft' | 'writing_agent'
  }
  if (value.title !== undefined) result.title = boundedString(value.title, 'foreshadowAction.title', 500).trim()
  if (value.foreshadowId !== undefined && String(value.foreshadowId).trim())
    result.foreshadowId = uuid(value.foreshadowId, 'foreshadowAction.foreshadowId')
  if (value.legacyChapterId !== undefined)
    result.legacyChapterId = boundedInteger(
      value.legacyChapterId,
      'foreshadowAction.legacyChapterId',
      1,
      chapterLimits.maxId
    )
  if (value.description !== undefined)
    result.description = boundedString(value.description, 'foreshadowAction.description', 5_000).trim()
  if (value.evidence !== undefined)
    result.evidence = boundedString(value.evidence, 'foreshadowAction.evidence', 20_000).trim()
  return [result]
}

export const decodeOptionalStoryEntityIdArgs: ArgsDecoder<[string | undefined]> = (args) => {
  if (args.length > 1) invalid('args', '参数数量无效')
  return [args.length === 0 || args[0] === undefined ? undefined : uuid(args[0], 'storyEntity.id')]
}
