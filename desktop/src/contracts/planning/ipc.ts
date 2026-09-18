import type { IdeaGenerationInput, OutlineExpansionTaskInput, PlannedChapterOutlineUpdate } from '../index'
import type { PlannedChapterStartInput } from '../index'
import type { ChapterPlanningUpdate, IdeaSaveInput, PlanningPackageProposal } from '../index'
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
import { chapterId } from '../manuscript/validation'
import { bookProfileLimits } from '../worldbuilding/validation'
import { decodeChapterIdArgs } from '../manuscript/ipc'
import { outlineVolume, planningLimits } from './validation'

export const decodeChapterPlanningUpdateArgs: ArgsDecoder<[number, ChapterPlanningUpdate]> = (args) => {
  exactArgs(args, 2)
  const id = chapterId(args[0])
  const value = record(args[1], 'chapterPlanning')
  rejectUnknown(value, 'chapterPlanning', ['lifecycleStatus', 'card'])
  const update: ChapterPlanningUpdate = {}
  if (value.lifecycleStatus !== undefined) {
    const states = ['PLANNED', 'DRAFTING', 'REVIEWABLE', 'CONFIRMED', 'REVISING', 'ARCHIVED'] as const
    if (!states.includes(value.lifecycleStatus as (typeof states)[number]))
      invalid('lifecycleStatus', '不是受支持的章节状态')
    update.lifecycleStatus = value.lifecycleStatus as ChapterPlanningUpdate['lifecycleStatus']
  }
  if (value.card !== undefined) {
    const card = record(value.card, 'chapterPlanning.card')
    rejectUnknown(card, 'chapterPlanning.card', [
      'status',
      'goal',
      'entryState',
      'beats',
      'conflict',
      'characters',
      'pointOfView',
      'narrativeDistance',
      'exitChange',
      'hook'
    ])
    const result: NonNullable<ChapterPlanningUpdate['card']> = {}
    if (card.status !== undefined) {
      if (!['empty', 'draft', 'confirmed'].includes(String(card.status)))
        invalid('chapterPlanning.card.status', '不是受支持的章卡状态')
      result.status = card.status as 'empty' | 'draft' | 'confirmed'
    }
    for (const field of [
      'goal',
      'entryState',
      'conflict',
      'pointOfView',
      'narrativeDistance',
      'exitChange',
      'hook'
    ] as const) {
      if (card[field] !== undefined)
        result[field] = boundedString(card[field], `chapterPlanning.card.${field}`, 2_000).trim()
    }
    for (const field of ['beats', 'characters'] as const) {
      if (card[field] === undefined) continue
      if (!Array.isArray(card[field]) || card[field].length > 50)
        invalid(`chapterPlanning.card.${field}`, '最多包含 50 项')
      result[field] = card[field]
        .map((item, index) => boundedString(item, `chapterPlanning.card.${field}[${index}]`, 500).trim())
        .filter(Boolean)
    }
    update.card = result
  }
  return [id, update]
}

export const decodeIdeaSaveArgs: ArgsDecoder<[IdeaSaveInput]> = (args) => {
  exactArgs(args, 1)
  const value = record(args[0], 'idea')
  rejectUnknown(value, 'idea', ['id', 'title', 'content', 'status', 'generationSource'])
  const status = value.status === undefined ? undefined : requiredString(value.status, 'idea.status', 32)
  if (status !== undefined && !['candidate', 'approved', 'archived'].includes(status))
    invalid('idea.status', '不是受支持的状态')
  const result: IdeaSaveInput = {
    title: requiredString(value.title, 'idea.title', 200),
    content: requiredString(value.content, 'idea.content', 50_000)
  }
  if (value.id !== undefined) result.id = uuid(value.id, 'idea.id')
  if (value.generationSource !== undefined) {
    const source = record(value.generationSource, 'idea.generationSource')
    rejectUnknown(source, 'idea.generationSource', ['taskId', 'optionIndex'])
    result.generationSource = {
      taskId: uuid(source.taskId, 'idea.generationSource.taskId'),
      optionIndex: boundedInteger(source.optionIndex, 'idea.generationSource.optionIndex', 0, 2)
    }
  }
  if (status !== undefined) result.status = status as IdeaSaveInput['status']
  return [result]
}

export const decodeIdeaPromotionArgs: ArgsDecoder<[string, string]> = (args) => {
  exactArgs(args, 2)
  const expectedUpdatedAt = requiredString(args[1], 'idea.expectedUpdatedAt', 80)
  if (Number.isNaN(Date.parse(expectedUpdatedAt))) invalid('idea.expectedUpdatedAt', '不是有效时间')
  return [uuid(args[0], 'idea.id'), expectedUpdatedAt]
}

export const decodePlanningOutlineKeyArgs: ArgsDecoder<[string]> = (args) => {
  exactArgs(args, 1)
  const key = requiredString(args[0], 'parentKey', 80)
  if (!/^(total|volume-[1-9]\d*|stage-[1-9]\d*)$/.test(key)) invalid('parentKey', '父级类型无效')
  return [key]
}

export const decodeOutlineExpansionArgs: ArgsDecoder<[OutlineExpansionTaskInput]> = (args) => {
  exactArgs(args, 1)
  const value = record(args[0], 'expansion')
  rejectUnknown(value, 'expansion', ['operationId', 'parentKey', 'expectedRevision', 'count', 'instruction'])
  const parentKey = decodePlanningOutlineKeyArgs([value.parentKey])[0]
  const expectedRevision = requiredString(value.expectedRevision, 'expansion.expectedRevision', 64)
  if (!/^[a-f0-9]{64}$/i.test(expectedRevision)) invalid('expansion.expectedRevision', '版本无效')
  return [
    {
      operationId: uuid(value.operationId, 'expansion.operationId'),
      parentKey,
      expectedRevision,
      count: boundedInteger(value.count, 'expansion.count', 1, 12),
      instruction: boundedString(value.instruction, 'expansion.instruction', 2000)
    }
  ]
}

export const decodeIdeaGenerationArgs: ArgsDecoder<[IdeaGenerationInput]> = (args) => {
  exactArgs(args, 1)
  const value = record(args[0], 'ideaGeneration')
  rejectUnknown(value, 'ideaGeneration', ['operationId', 'ideaId', 'expectedUpdatedAt', 'mode', 'instruction'])
  const [ideaId, expectedUpdatedAt] = decodeIdeaPromotionArgs([value.ideaId, value.expectedUpdatedAt])
  if (value.mode !== 'diverge' && value.mode !== 'synopsis') invalid('ideaGeneration.mode', '不支持的生成类型')
  const instruction =
    value.instruction === '' ? '' : requiredString(value.instruction, 'ideaGeneration.instruction', 2_000)
  return [
    {
      operationId: uuid(value.operationId, 'ideaGeneration.operationId'),
      ideaId,
      expectedUpdatedAt,
      mode: value.mode as IdeaGenerationInput['mode'],
      instruction
    }
  ]
}

export const decodePlanningPackageArgs: ArgsDecoder<[PlanningPackageProposal]> = (args) => {
  exactArgs(args, 1)
  const requiredProposalFields = ['id', 'workItemId', 'createdAt', 'basedOn', 'blueprint', 'totalOutline', 'volumes']
  const value = record(args[0], 'proposal')
  rejectUnknown(value, 'proposal', [...requiredProposalFields, 'chapterSkeleton', 'chapterDetails', 'adoption'])
  for (const key of requiredProposalFields) if (!(key in value)) invalid(`proposal.${key}`, '不能为空')
  const basedOn = exactRecord(value.basedOn, 'proposal.basedOn', [
    'inputFingerprint',
    'blueprintFingerprint',
    'totalOutlineFingerprint'
  ])
  const blueprint = exactRecord(value.blueprint, 'proposal.blueprint', [
    'premise',
    'worldView',
    'characters',
    'powerSystem',
    'cheatSystem',
    'rationale'
  ])
  const totalOutline = exactRecord(value.totalOutline, 'proposal.totalOutline', ['title', 'summary', 'content'])
  if (!Array.isArray(blueprint.characters) || blueprint.characters.length < 1 || blueprint.characters.length > 50)
    invalid('proposal.blueprint.characters', '必须包含 1 到 50 个人物种子')
  if (!Array.isArray(value.volumes) || value.volumes.length < 1 || value.volumes.length > 100)
    invalid('proposal.volumes', '必须包含 1 到 100 卷')
  const characters = blueprint.characters.map((item, index) => {
    const character = exactRecord(item, `proposal.blueprint.characters[${index}]`, ['name', 'role', 'arcSeed'])
    return {
      name: requiredString(character.name, `characters[${index}].name`, 120),
      role: requiredString(character.role, `characters[${index}].role`, 1_000),
      arcSeed: requiredString(character.arcSeed, `characters[${index}].arcSeed`, 5_000)
    }
  })
  const volumes = value.volumes.map((item, index) => {
    const volume = exactRecord(item, `proposal.volumes[${index}]`, ['order', 'title', 'goal', 'summary', 'ending'])
    const order = boundedInteger(volume.order, `volumes[${index}].order`, 1, 100)
    if (order !== index + 1) invalid(`volumes[${index}].order`, '卷序必须从 1 连续排列')
    return {
      order,
      title: requiredString(volume.title, `volumes[${index}].title`, 200),
      goal: requiredString(volume.goal, `volumes[${index}].goal`, 10_000),
      summary: requiredString(volume.summary, `volumes[${index}].summary`, 100_000),
      ending: requiredString(volume.ending, `volumes[${index}].ending`, 20_000)
    }
  })
  const digest = (input: unknown, field: string) => {
    const result = requiredString(input, field, 64)
    if (!/^[0-9a-f]{64}$/i.test(result)) invalid(field, '不是有效内容指纹')
    return result
  }
  let chapterSkeleton: PlanningPackageProposal['chapterSkeleton']
  if (value.chapterSkeleton !== undefined) {
    const skeleton = exactRecord(value.chapterSkeleton, 'proposal.chapterSkeleton', [
      'generatedAt',
      'basedOn',
      'targetWordsPerChapter',
      'chapters'
    ])
    const skeletonBasedOn = exactRecord(skeleton.basedOn, 'proposal.chapterSkeleton.basedOn', [
      'totalOutlineFingerprint',
      'volumePlanFingerprint'
    ])
    if (!Array.isArray(skeleton.chapters) || skeleton.chapters.length < 1 || skeleton.chapters.length > 50_000) {
      invalid('proposal.chapterSkeleton.chapters', '必须包含 1 到 50000 章')
    }
    const chapters = skeleton.chapters.map((item, index) => {
      const entry = exactRecord(item, `proposal.chapterSkeleton.chapters[${index}]`, [
        'chapter',
        'volume',
        'volumeChapter',
        'title',
        'coreEvent',
        'characters',
        'location',
        'result'
      ])
      const chapter = boundedInteger(entry.chapter, `proposal.chapterSkeleton.chapters[${index}].chapter`, 1, 50_000)
      const volume = boundedInteger(entry.volume, `proposal.chapterSkeleton.chapters[${index}].volume`, 1, 100)
      const volumeChapter = boundedInteger(
        entry.volumeChapter,
        `proposal.chapterSkeleton.chapters[${index}].volumeChapter`,
        1,
        500
      )
      if (chapter !== index + 1)
        invalid(`proposal.chapterSkeleton.chapters[${index}].chapter`, '全书章序必须从 1 连续排列')
      if (!volumes.some((candidate) => candidate.order === volume))
        invalid(`proposal.chapterSkeleton.chapters[${index}].volume`, '引用了候选中不存在的篇卷')
      if (!Array.isArray(entry.characters) || entry.characters.length < 1 || entry.characters.length > 50)
        invalid(`proposal.chapterSkeleton.chapters[${index}].characters`, '必须包含 1 到 50 个人物')
      const names = entry.characters.map((name, nameIndex) =>
        requiredString(name, `proposal.chapterSkeleton.chapters[${index}].characters[${nameIndex}]`, 120)
      )
      if (new Set(names.map((name) => name.normalize('NFKC').toLocaleLowerCase('zh-CN'))).size !== names.length)
        invalid(`proposal.chapterSkeleton.chapters[${index}].characters`, '不能包含重复人物')
      return {
        chapter,
        volume,
        volumeChapter,
        title: requiredString(entry.title, `proposal.chapterSkeleton.chapters[${index}].title`, 200),
        coreEvent: requiredString(entry.coreEvent, `proposal.chapterSkeleton.chapters[${index}].coreEvent`, 5_000),
        characters: names,
        location: requiredString(entry.location, `proposal.chapterSkeleton.chapters[${index}].location`, 500),
        result: requiredString(entry.result, `proposal.chapterSkeleton.chapters[${index}].result`, 5_000)
      }
    })
    for (const volume of volumes) {
      const entries = chapters.filter((item) => item.volume === volume.order)
      if (!entries.length || entries.some((item, index) => item.volumeChapter !== index + 1))
        invalid('proposal.chapterSkeleton.chapters', `第 ${volume.order} 卷的卷内章序必须从 1 连续排列`)
    }
    chapterSkeleton = {
      generatedAt: requiredString(skeleton.generatedAt, 'proposal.chapterSkeleton.generatedAt', 64),
      basedOn: {
        totalOutlineFingerprint: digest(
          skeletonBasedOn.totalOutlineFingerprint,
          'proposal.chapterSkeleton.basedOn.totalOutlineFingerprint'
        ),
        volumePlanFingerprint: digest(
          skeletonBasedOn.volumePlanFingerprint,
          'proposal.chapterSkeleton.basedOn.volumePlanFingerprint'
        )
      },
      targetWordsPerChapter: boundedInteger(
        skeleton.targetWordsPerChapter,
        'proposal.chapterSkeleton.targetWordsPerChapter',
        bookProfileLimits.minWordsPerChapter,
        bookProfileLimits.maxWordsPerChapter
      ),
      chapters
    }
  }
  let chapterDetails: PlanningPackageProposal['chapterDetails']
  if (value.chapterDetails !== undefined) {
    if (!Array.isArray(value.chapterDetails) || value.chapterDetails.length > volumes.length)
      invalid('proposal.chapterDetails', '必须是每卷至多一项的数组')
    chapterDetails = value.chapterDetails.map((item, volumeIndex) => {
      const detail = exactRecord(item, `proposal.chapterDetails[${volumeIndex}]`, [
        'volume',
        'generatedAt',
        'basedOn',
        'chapters'
      ])
      const volume = boundedInteger(detail.volume, `proposal.chapterDetails[${volumeIndex}].volume`, 1, volumes.length)
      const basedOnDetail = exactRecord(detail.basedOn, `proposal.chapterDetails[${volumeIndex}].basedOn`, [
        'totalOutlineFingerprint',
        'volumeOutlineFingerprint',
        'skeletonFingerprint'
      ])
      if (!Array.isArray(detail.chapters) || detail.chapters.length < 1 || detail.chapters.length > 500)
        invalid(`proposal.chapterDetails[${volumeIndex}].chapters`, '必须包含 1 到 500 章')
      const expectedSkeleton = chapterSkeleton?.chapters.filter((chapter) => chapter.volume === volume) || []
      if (!expectedSkeleton.length || expectedSkeleton.length !== detail.chapters.length)
        invalid(`proposal.chapterDetails[${volumeIndex}].chapters`, '必须与当前章节骨架中的本卷章节一一对应')
      const chapters = detail.chapters.map((raw, chapterIndex) => {
        const entry = exactRecord(raw, `proposal.chapterDetails[${volumeIndex}].chapters[${chapterIndex}]`, [
          'chapter',
          'volume',
          'volumeChapter',
          'title',
          'entryState',
          'beats',
          'exitState',
          'allowedFacts',
          'forbiddenEvents',
          'foreshadowActions'
        ])
        const skeletonEntry = expectedSkeleton[chapterIndex]
        const chapter = boundedInteger(entry.chapter, 'chapterDetail.chapter', 1, 50_000)
        const volumeChapter = boundedInteger(entry.volumeChapter, 'chapterDetail.volumeChapter', 1, 500)
        if (
          entry.volume !== volume ||
          chapter !== skeletonEntry.chapter ||
          volumeChapter !== skeletonEntry.volumeChapter ||
          entry.title !== skeletonEntry.title
        )
          invalid('proposal.chapterDetails', '详细章纲必须保持骨架的卷章序与标题')
        const strings = (input: unknown, field: string, min: number, max: number, limit: number) => {
          if (!Array.isArray(input) || input.length < min || input.length > max)
            invalid(field, `必须包含 ${min} 到 ${max} 项`)
          return input.map((value, index) => requiredString(value, `${field}[${index}]`, limit))
        }
        if (!Array.isArray(entry.foreshadowActions) || entry.foreshadowActions.length > 8)
          invalid('chapterDetail.foreshadowActions', '最多包含 8 项')
        const foreshadowActions = entry.foreshadowActions.map((action, actionIndex) => {
          const value = exactRecord(action, `chapterDetail.foreshadowActions[${actionIndex}]`, [
            'action',
            'description'
          ])
          if (!['plant', 'advance', 'misdirect', 'resolve', 'hold', 'discard'].includes(String(value.action)))
            invalid('chapterDetail.foreshadowActions.action', '动作无效')
          return {
            action: value.action as 'plant' | 'advance' | 'misdirect' | 'resolve' | 'hold' | 'discard',
            description: requiredString(value.description, 'chapterDetail.foreshadowActions.description', 2_000)
          }
        })
        return {
          chapter,
          volume,
          volumeChapter,
          title: skeletonEntry.title,
          entryState: requiredString(entry.entryState, 'chapterDetail.entryState', 5_000),
          beats: strings(entry.beats, 'chapterDetail.beats', 2, 8, 5_000),
          exitState: requiredString(entry.exitState, 'chapterDetail.exitState', 5_000),
          allowedFacts: strings(entry.allowedFacts, 'chapterDetail.allowedFacts', 1, 12, 2_000),
          forbiddenEvents: strings(entry.forbiddenEvents, 'chapterDetail.forbiddenEvents', 1, 12, 2_000),
          foreshadowActions
        }
      })
      return {
        volume,
        generatedAt: requiredString(detail.generatedAt, 'chapterDetail.generatedAt', 64),
        basedOn: {
          totalOutlineFingerprint: digest(
            basedOnDetail.totalOutlineFingerprint,
            'chapterDetail.totalOutlineFingerprint'
          ),
          volumeOutlineFingerprint: digest(
            basedOnDetail.volumeOutlineFingerprint,
            'chapterDetail.volumeOutlineFingerprint'
          ),
          skeletonFingerprint: digest(basedOnDetail.skeletonFingerprint, 'chapterDetail.skeletonFingerprint')
        },
        chapters
      }
    })
    if (new Set(chapterDetails.map((item) => item.volume)).size !== chapterDetails.length)
      invalid('proposal.chapterDetails', '不能包含重复卷号')
  }
  let adoption: PlanningPackageProposal['adoption']
  if (value.adoption !== undefined) {
    const adoptionValue = record(value.adoption, 'proposal.adoption')
    rejectUnknown(adoptionValue, 'proposal.adoption', [
      'totalOutline',
      'volumeStructure',
      'volumeOutlines',
      'chapterOutlines',
      'characterSeeds',
      'worldSeed',
      'powerSystem',
      'cheatSystem'
    ])
    if (adoptionValue.totalOutline !== undefined) {
      const total = exactRecord(adoptionValue.totalOutline, 'proposal.adoption.totalOutline', [
        'fingerprint',
        'adoptedAt',
        'revision'
      ])
      adoption = {
        totalOutline: {
          fingerprint: digest(total.fingerprint, 'proposal.adoption.totalOutline.fingerprint'),
          adoptedAt: requiredString(total.adoptedAt, 'proposal.adoption.totalOutline.adoptedAt', 64),
          revision: boundedInteger(
            total.revision,
            'proposal.adoption.totalOutline.revision',
            0,
            Number.MAX_SAFE_INTEGER
          )
        }
      }
    } else adoption = {}
    if (adoptionValue.volumeStructure !== undefined) {
      const structure = exactRecord(adoptionValue.volumeStructure, 'proposal.adoption.volumeStructure', [
        'fingerprint',
        'initializedAt',
        'totalRevision'
      ])
      adoption.volumeStructure = {
        fingerprint: digest(structure.fingerprint, 'proposal.adoption.volumeStructure.fingerprint'),
        initializedAt: requiredString(structure.initializedAt, 'proposal.adoption.volumeStructure.initializedAt', 64),
        totalRevision: boundedInteger(
          structure.totalRevision,
          'proposal.adoption.volumeStructure.totalRevision',
          0,
          Number.MAX_SAFE_INTEGER
        )
      }
    }
    if (adoptionValue.volumeOutlines !== undefined) {
      if (!Array.isArray(adoptionValue.volumeOutlines) || adoptionValue.volumeOutlines.length > 100)
        invalid('proposal.adoption.volumeOutlines', '必须是最多 100 项的数组')
      adoption.volumeOutlines = adoptionValue.volumeOutlines.map((item, index) => {
        const outline = exactRecord(item, `proposal.adoption.volumeOutlines[${index}]`, [
          'order',
          'fingerprint',
          'adoptedAt',
          'revision',
          'totalFingerprint'
        ])
        return {
          order: boundedInteger(outline.order, `proposal.adoption.volumeOutlines[${index}].order`, 1, 100),
          fingerprint: digest(outline.fingerprint, `proposal.adoption.volumeOutlines[${index}].fingerprint`),
          adoptedAt: requiredString(outline.adoptedAt, `proposal.adoption.volumeOutlines[${index}].adoptedAt`, 64),
          revision: boundedInteger(
            outline.revision,
            `proposal.adoption.volumeOutlines[${index}].revision`,
            0,
            Number.MAX_SAFE_INTEGER
          ),
          totalFingerprint: digest(
            outline.totalFingerprint,
            `proposal.adoption.volumeOutlines[${index}].totalFingerprint`
          )
        }
      })
      if (new Set(adoption.volumeOutlines.map((item) => item.order)).size !== adoption.volumeOutlines.length)
        invalid('proposal.adoption.volumeOutlines', '不能包含重复卷号')
    }
    if (adoptionValue.chapterOutlines !== undefined) {
      if (!Array.isArray(adoptionValue.chapterOutlines) || adoptionValue.chapterOutlines.length > 50_000)
        invalid('proposal.adoption.chapterOutlines', '必须是最多 50000 项的数组')
      adoption.chapterOutlines = adoptionValue.chapterOutlines.map((item, index) => {
        const outline = exactRecord(item, `proposal.adoption.chapterOutlines[${index}]`, [
          'chapter',
          'candidateFingerprint',
          'adoptedAt',
          'totalFingerprint',
          'volumeFingerprint'
        ])
        const chapter = boundedInteger(
          outline.chapter,
          `proposal.adoption.chapterOutlines[${index}].chapter`,
          1,
          50_000
        )
        if (!chapterDetails?.some((detail) => detail.chapters.some((entry) => entry.chapter === chapter)))
          invalid(`proposal.adoption.chapterOutlines[${index}].chapter`, '引用了不存在的详细章纲候选')
        return {
          chapter,
          candidateFingerprint: digest(
            outline.candidateFingerprint,
            `proposal.adoption.chapterOutlines[${index}].candidateFingerprint`
          ),
          adoptedAt: requiredString(outline.adoptedAt, `proposal.adoption.chapterOutlines[${index}].adoptedAt`, 64),
          totalFingerprint: digest(
            outline.totalFingerprint,
            `proposal.adoption.chapterOutlines[${index}].totalFingerprint`
          ),
          volumeFingerprint: digest(
            outline.volumeFingerprint,
            `proposal.adoption.chapterOutlines[${index}].volumeFingerprint`
          )
        }
      })
      if (new Set(adoption.chapterOutlines.map((item) => item.chapter)).size !== adoption.chapterOutlines.length)
        invalid('proposal.adoption.chapterOutlines', '不能包含重复章号')
    }
    if (adoptionValue.characterSeeds !== undefined) {
      const seeds = exactRecord(adoptionValue.characterSeeds, 'proposal.adoption.characterSeeds', [
        'fingerprint',
        'adoptedAt',
        'anchorFingerprint'
      ])
      adoption.characterSeeds = {
        fingerprint: digest(seeds.fingerprint, 'proposal.adoption.characterSeeds.fingerprint'),
        adoptedAt: requiredString(seeds.adoptedAt, 'proposal.adoption.characterSeeds.adoptedAt', 64),
        anchorFingerprint: digest(seeds.anchorFingerprint, 'proposal.adoption.characterSeeds.anchorFingerprint')
      }
    }
    if (adoptionValue.worldSeed !== undefined) {
      const world = exactRecord(adoptionValue.worldSeed, 'proposal.adoption.worldSeed', [
        'fingerprint',
        'adoptedAt',
        'foundationFingerprint'
      ])
      adoption.worldSeed = {
        fingerprint: digest(world.fingerprint, 'proposal.adoption.worldSeed.fingerprint'),
        adoptedAt: requiredString(world.adoptedAt, 'proposal.adoption.worldSeed.adoptedAt', 64),
        foundationFingerprint: digest(world.foundationFingerprint, 'proposal.adoption.worldSeed.foundationFingerprint')
      }
    }
    if (adoptionValue.powerSystem !== undefined) {
      const power = exactRecord(adoptionValue.powerSystem, 'proposal.adoption.powerSystem', [
        'fingerprint',
        'adoptedAt',
        'powerSystemFingerprint'
      ])
      adoption.powerSystem = {
        fingerprint: digest(power.fingerprint, 'proposal.adoption.powerSystem.fingerprint'),
        adoptedAt: requiredString(power.adoptedAt, 'proposal.adoption.powerSystem.adoptedAt', 64),
        powerSystemFingerprint: digest(
          power.powerSystemFingerprint,
          'proposal.adoption.powerSystem.powerSystemFingerprint'
        )
      }
    }
    if (adoptionValue.cheatSystem !== undefined) {
      const cheat = exactRecord(adoptionValue.cheatSystem, 'proposal.adoption.cheatSystem', [
        'fingerprint',
        'adoptedAt',
        'cheatSystemFingerprint'
      ])
      adoption.cheatSystem = {
        fingerprint: digest(cheat.fingerprint, 'proposal.adoption.cheatSystem.fingerprint'),
        adoptedAt: requiredString(cheat.adoptedAt, 'proposal.adoption.cheatSystem.adoptedAt', 64),
        cheatSystemFingerprint: digest(
          cheat.cheatSystemFingerprint,
          'proposal.adoption.cheatSystem.cheatSystemFingerprint'
        )
      }
    }
  }
  return [
    {
      id: requiredString(value.id, 'proposal.id', 100),
      workItemId: requiredString(value.workItemId, 'proposal.workItemId', 32_767),
      createdAt: requiredString(value.createdAt, 'proposal.createdAt', 64),
      basedOn: {
        inputFingerprint: digest(basedOn.inputFingerprint, 'proposal.basedOn.inputFingerprint'),
        blueprintFingerprint: digest(basedOn.blueprintFingerprint, 'proposal.basedOn.blueprintFingerprint'),
        totalOutlineFingerprint: digest(basedOn.totalOutlineFingerprint, 'proposal.basedOn.totalOutlineFingerprint')
      },
      blueprint: {
        premise: requiredString(blueprint.premise, 'proposal.blueprint.premise', 5_000),
        worldView: requiredString(blueprint.worldView, 'proposal.blueprint.worldView', 100_000),
        characters,
        powerSystem: boundedString(blueprint.powerSystem, 'proposal.blueprint.powerSystem', 100_000),
        cheatSystem: boundedString(blueprint.cheatSystem, 'proposal.blueprint.cheatSystem', 100_000),
        rationale: requiredString(blueprint.rationale, 'proposal.blueprint.rationale', 20_000)
      },
      totalOutline: {
        title: requiredString(totalOutline.title, 'proposal.totalOutline.title', 200),
        summary: requiredString(totalOutline.summary, 'proposal.totalOutline.summary', 5_000),
        content: requiredString(totalOutline.content, 'proposal.totalOutline.content', 200_000)
      },
      volumes,
      ...(chapterSkeleton ? { chapterSkeleton } : {}),
      ...(chapterDetails ? { chapterDetails } : {}),
      ...(adoption !== undefined ? { adoption } : {})
    }
  ]
}

export const decodePlanningProposalIdArgs: ArgsDecoder<[string]> = (args) => {
  exactArgs(args, 1)
  return [requiredString(args[0], 'proposalId', 100)]
}

export const decodePlanningChapterDetailArgs: ArgsDecoder<[string, number]> = (args) => {
  exactArgs(args, 2)
  return [requiredString(args[0], 'proposalId', 100), boundedInteger(args[1], 'volume', 1, 100)]
}

export const decodePlanningTotalAdoptionArgs: ArgsDecoder<
  [{ proposalId: string; candidateFingerprint: string; currentFingerprint: string }]
> = (args) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'adoption', ['proposalId', 'candidateFingerprint', 'currentFingerprint'])
  const digest = (input: unknown, field: string) => {
    const result = requiredString(input, field, 64).toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(result)) invalid(field, '不是有效内容指纹')
    return result
  }
  return [
    {
      proposalId: requiredString(value.proposalId, 'proposalId', 100),
      candidateFingerprint: digest(value.candidateFingerprint, 'candidateFingerprint'),
      currentFingerprint: digest(value.currentFingerprint, 'currentFingerprint')
    }
  ]
}

export const decodePlanningVolumeStructureArgs: ArgsDecoder<
  [{ proposalId: string; candidateFingerprint: string; currentFingerprint: string; totalFingerprint: string }]
> = (args) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'volumeStructure', [
    'proposalId',
    'candidateFingerprint',
    'currentFingerprint',
    'totalFingerprint'
  ])
  const digest = (input: unknown, field: string) => {
    const result = requiredString(input, field, 64).toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(result)) invalid(field, '不是有效内容指纹')
    return result
  }
  return [
    {
      proposalId: requiredString(value.proposalId, 'proposalId', 100),
      candidateFingerprint: digest(value.candidateFingerprint, 'candidateFingerprint'),
      currentFingerprint: digest(value.currentFingerprint, 'currentFingerprint'),
      totalFingerprint: digest(value.totalFingerprint, 'totalFingerprint')
    }
  ]
}

export const decodePlanningVolumeOutlinePreviewArgs: ArgsDecoder<[string, number]> = (args) => {
  exactArgs(args, 2)
  return [requiredString(args[0], 'proposalId', 100), boundedInteger(args[1], 'order', 1, 100)]
}

export const decodePlanningVolumeOutlineAdoptionArgs: ArgsDecoder<
  [
    {
      proposalId: string
      order: number
      parentFingerprint: string
      candidateFingerprint: string
      currentFingerprint: string
    }
  ]
> = (args) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'volumeAdoption', [
    'proposalId',
    'order',
    'parentFingerprint',
    'candidateFingerprint',
    'currentFingerprint'
  ])
  const digest = (input: unknown, field: string) => {
    const result = requiredString(input, field, 64).toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(result)) invalid(field, '不是有效内容指纹')
    return result
  }
  return [
    {
      proposalId: requiredString(value.proposalId, 'proposalId', 100),
      order: boundedInteger(value.order, 'order', 1, 100),
      parentFingerprint: digest(value.parentFingerprint, 'parentFingerprint'),
      candidateFingerprint: digest(value.candidateFingerprint, 'candidateFingerprint'),
      currentFingerprint: digest(value.currentFingerprint, 'currentFingerprint')
    }
  ]
}

export const decodePlanningChapterDetailAdoptionPreviewArgs: ArgsDecoder<[string, number]> = (args) => {
  exactArgs(args, 2)
  return [requiredString(args[0], 'proposalId', 100), boundedInteger(args[1], 'chapterId', 1, 50_000)]
}

export const decodePlanningChapterDetailAdoptionArgs: ArgsDecoder<
  [
    {
      proposalId: string
      chapterId: number
      upstreamFingerprint: string
      candidateFingerprint: string
      currentFingerprint: string
    }
  ]
> = (args) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'chapterDetailAdoption', [
    'proposalId',
    'chapterId',
    'upstreamFingerprint',
    'candidateFingerprint',
    'currentFingerprint'
  ])
  const checkedDigest = (input: unknown, field: string) => {
    const result = requiredString(input, field, 64).toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(result)) invalid(field, '不是有效内容指纹')
    return result
  }
  return [
    {
      proposalId: requiredString(value.proposalId, 'proposalId', 100),
      chapterId: boundedInteger(value.chapterId, 'chapterId', 1, 50_000),
      upstreamFingerprint: checkedDigest(value.upstreamFingerprint, 'upstreamFingerprint'),
      candidateFingerprint: checkedDigest(value.candidateFingerprint, 'candidateFingerprint'),
      currentFingerprint: checkedDigest(value.currentFingerprint, 'currentFingerprint')
    }
  ]
}

export const decodePlanningCharacterSeedAdoptionArgs: ArgsDecoder<
  [{ proposalId: string; candidateFingerprint: string; currentFingerprint: string }]
> = (args) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'characterSeedAdoption', [
    'proposalId',
    'candidateFingerprint',
    'currentFingerprint'
  ])
  const digest = (input: unknown, field: string) => {
    const result = requiredString(input, field, 64).toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(result)) invalid(field, '不是有效内容指纹')
    return result
  }
  return [
    {
      proposalId: requiredString(value.proposalId, 'proposalId', 100),
      candidateFingerprint: digest(value.candidateFingerprint, 'candidateFingerprint'),
      currentFingerprint: digest(value.currentFingerprint, 'currentFingerprint')
    }
  ]
}

export const decodePlanningWorldSeedAdoptionArgs: ArgsDecoder<
  [{ proposalId: string; candidateFingerprint: string; currentFingerprint: string }]
> = (args) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'worldSeedAdoption', ['proposalId', 'candidateFingerprint', 'currentFingerprint'])
  const digest = (input: unknown, field: string) => {
    const result = requiredString(input, field, 64).toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(result)) invalid(field, '不是有效内容指纹')
    return result
  }
  return [
    {
      proposalId: requiredString(value.proposalId, 'proposalId', 100),
      candidateFingerprint: digest(value.candidateFingerprint, 'candidateFingerprint'),
      currentFingerprint: digest(value.currentFingerprint, 'currentFingerprint')
    }
  ]
}

export const decodePlanningPowerSystemAdoptionArgs: ArgsDecoder<
  [{ proposalId: string; candidateFingerprint: string; currentFingerprint: string }]
> = (args) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'powerSystemAdoption', [
    'proposalId',
    'candidateFingerprint',
    'currentFingerprint'
  ])
  const digest = (input: unknown, field: string) => {
    const result = requiredString(input, field, 64).toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(result)) invalid(field, '不是有效内容指纹')
    return result
  }
  return [
    {
      proposalId: requiredString(value.proposalId, 'proposalId', 100),
      candidateFingerprint: digest(value.candidateFingerprint, 'candidateFingerprint'),
      currentFingerprint: digest(value.currentFingerprint, 'currentFingerprint')
    }
  ]
}

export const decodePlanningCheatSystemAdoptionArgs: ArgsDecoder<
  [{ proposalId: string; candidateFingerprint: string; currentFingerprint: string }]
> = (args) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'cheatSystemAdoption', [
    'proposalId',
    'candidateFingerprint',
    'currentFingerprint'
  ])
  const digest = (input: unknown, field: string) => {
    const result = requiredString(input, field, 64).toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(result)) invalid(field, '不是有效内容指纹')
    return result
  }
  return [
    {
      proposalId: requiredString(value.proposalId, 'proposalId', 100),
      candidateFingerprint: digest(value.candidateFingerprint, 'candidateFingerprint'),
      currentFingerprint: digest(value.currentFingerprint, 'currentFingerprint')
    }
  ]
}

export const decodeOutlineVolumeCreateArgs: ArgsDecoder<[string]> = (args) => {
  exactArgs(args, 1)
  return [requiredString(args[0], 'title', 120)]
}

export const decodeOutlineVolumeRenameArgs: ArgsDecoder<[number, string]> = (args) => {
  exactArgs(args, 2)
  const volume = args[0]
  if (!Number.isInteger(volume) || Number(volume) < 1 || Number(volume) > 1_000)
    invalid('volume', '必须是 1 到 1000 的卷号')
  return [Number(volume), requiredString(args[1], 'title', 120)]
}

export const decodePlannedChapterUpdateArgs: ArgsDecoder<[PlannedChapterOutlineUpdate]> = (args) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'plannedChapter', ['chapterId', 'title', 'content', 'expectedRevision'])
  const chapterId = decodeChapterIdArgs([value.chapterId])[0]
  const expectedRevision = requiredString(value.expectedRevision, 'expectedRevision', 64)
  if (!/^[a-f0-9]{64}$/.test(expectedRevision)) invalid('expectedRevision', '版本指纹无效')
  return [
    {
      chapterId,
      title: requiredString(value.title, 'title', 200).trim(),
      content: boundedString(value.content, 'content', planningLimits.maxOutlineLength),
      expectedRevision
    }
  ]
}

export const decodePlannedChapterStartArgs: ArgsDecoder<[PlannedChapterStartInput]> = (args) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'plannedChapterStart', ['chapterId', 'expectedRevision'])
  const chapterId = decodeChapterIdArgs([value.chapterId])[0]
  const expectedRevision = requiredString(value.expectedRevision, 'expectedRevision', 64)
  if (!/^[a-f0-9]{64}$/.test(expectedRevision)) invalid('expectedRevision', '版本指纹无效')
  return [{ chapterId, expectedRevision }]
}

export const decodeOutlineStageCreateArgs: ArgsDecoder<[number, string]> = (args) => {
  exactArgs(args, 2)
  const volume = args[0]
  if (!Number.isSafeInteger(volume) || Number(volume) < 1 || Number(volume) > planningLimits.maxOutlineVolume)
    invalid('volume', `必须是 1 到 ${planningLimits.maxOutlineVolume} 的整数`)
  return [Number(volume), requiredString(args[1], 'title', 120)]
}

export const decodeOutlineStageUpdateArgs: ArgsDecoder<[number, string, string]> = (args) => {
  exactArgs(args, 3)
  const stage = args[0]
  if (!Number.isSafeInteger(stage) || Number(stage) < 1 || Number(stage) > planningLimits.maxOutlineVolume)
    invalid('stage', `必须是 1 到 ${planningLimits.maxOutlineVolume} 的整数`)
  return [
    Number(stage),
    requiredString(args[1], 'title', 120),
    boundedString(args[2], 'content', planningLimits.maxOutlineLength)
  ]
}

export const decodeOutlineChapterStagePlacementArgs: ArgsDecoder<[number, number | null, number | null]> = (args) => {
  exactArgs(args, 3)
  const stage = args[1]
  const volume = args[2]
  if (
    stage !== null &&
    (!Number.isSafeInteger(stage) || Number(stage) < 1 || Number(stage) > planningLimits.maxOutlineVolume)
  )
    invalid('stage', `必须是 1 到 ${planningLimits.maxOutlineVolume} 的整数或 null`)
  if (
    volume !== null &&
    (!Number.isSafeInteger(volume) || Number(volume) < 1 || Number(volume) > planningLimits.maxOutlineVolume)
  )
    invalid('volume', `必须是 1 到 ${planningLimits.maxOutlineVolume} 的整数或 null`)
  return [chapterId(args[0]), stage === null ? null : Number(stage), volume === null ? null : Number(volume)]
}

export const decodeOutlineEventPlacementArgs: ArgsDecoder<[string, number | null]> = (args) => {
  exactArgs(args, 2)
  const volume = args[1]
  if (volume !== null && (!Number.isInteger(volume) || Number(volume) < 1 || Number(volume) > 1_000))
    invalid('volume', '必须是 1 到 1000 的卷号或 null')
  return [uuid(args[0], 'eventId'), volume === null ? null : Number(volume)]
}

export const decodeOutlineChapterPlacementArgs: ArgsDecoder<[number, number | null]> = (args) => {
  exactArgs(args, 2)
  const volume = args[1]
  if (volume !== null && (!Number.isInteger(volume) || Number(volume) < 1 || Number(volume) > 1_000))
    invalid('volume', '必须是 1 到 1000 的卷号或 null')
  return [chapterId(args[0]), volume === null ? null : Number(volume)]
}

export const decodeOutlineEventChapterPlacementArgs: ArgsDecoder<[string, number]> = (args) => {
  exactArgs(args, 2)
  return [uuid(args[0], 'eventId'), chapterId(args[1])]
}

export const decodeOutlineVolumeArgs: ArgsDecoder<[number | 'total']> = (args) => {
  exactArgs(args, 1)
  return [outlineVolume(args[0])]
}

export const decodeOutlineUpdateArgs: ArgsDecoder<[number | 'total', string]> = (args) => {
  exactArgs(args, 2)
  return [outlineVolume(args[0]), boundedString(args[1], 'content', planningLimits.maxOutlineLength)]
}

export const decodeChapterOutlineUpdateArgs: ArgsDecoder<[number, string]> = (args) => {
  exactArgs(args, 2)
  return [chapterId(args[0]), boundedString(args[1], 'content', planningLimits.maxOutlineLength)]
}
