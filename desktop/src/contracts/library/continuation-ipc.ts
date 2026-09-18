import type {
  ContinuationAnalysisArea,
  ContinuationAnalysisEdits,
  ContinuationChapterOutlineAdoptionInput,
  ContinuationCharacterAdoptionInput,
  ContinuationCharacterPreviewInput,
  ContinuationCheatSystemAdoptionInput,
  ContinuationExistingPlotAdoptionInput,
  ContinuationPowerSystemAdoptionInput,
  ContinuationProjectDefinitionAdoptionInput,
  ContinuationTotalOutlineAdoptionInput,
  ContinuationVolumeOutlineAdoptionInput,
  ContinuationWorldViewAdoptionInput
} from '../index'
import type { ArgsDecoder } from '../core/validation'
import {
  boundedInteger,
  boundedString,
  exactArgs,
  exactRecord,
  invalid,
  record,
  requiredString
} from '../core/validation'

export const continuationAreas = new Set<ContinuationAnalysisArea>([
  'projectDefinition',
  'existingPlot',
  'characters',
  'worldView',
  'powerSystem',
  'cheatSystem',
  'totalOutline',
  'volumeOutline',
  'chapterOutline'
])

export const decodeContinuationAnalysisEditsArgs: ArgsDecoder<[ContinuationAnalysisEdits]> = (args) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'continuationAnalysis', ['candidateId', 'sections', 'rationale'])
  const candidateId = requiredString(value.candidateId, 'continuationAnalysis.candidateId', 64)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidateId))
    invalid('continuationAnalysis.candidateId', '格式无效')
  if (!Array.isArray(value.sections) || value.sections.length !== continuationAreas.size)
    invalid('continuationAnalysis.sections', '必须包含全部九类接续分析')
  const sections = value.sections.map((item, index) => {
    const section = exactRecord(item, `continuationAnalysis.sections[${index}]`, ['area', 'content'])
    if (typeof section.area !== 'string' || !continuationAreas.has(section.area as ContinuationAnalysisArea))
      invalid(`continuationAnalysis.sections[${index}].area`, '不是支持的分析类别')
    return {
      area: section.area as ContinuationAnalysisArea,
      content: boundedString(section.content, `continuationAnalysis.sections[${index}].content`, 100_000).trim()
    }
  })
  if (new Set(sections.map((section) => section.area)).size !== continuationAreas.size)
    invalid('continuationAnalysis.sections', '包含重复或缺失类别')
  return [
    {
      candidateId,
      sections,
      rationale: boundedString(value.rationale, 'continuationAnalysis.rationale', 20_000).trim()
    }
  ]
}

export const decodeContinuationCandidateIdArgs: ArgsDecoder<[string]> = (args) => {
  exactArgs(args, 1)
  const id = requiredString(args[0], 'candidateId', 64)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    invalid('candidateId', '格式无效')
  return [id]
}

export const decodeContinuationProjectDefinitionAdoptionArgs: ArgsDecoder<
  [ContinuationProjectDefinitionAdoptionInput]
> = (args) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'adoption', ['candidateId', 'candidateFingerprint', 'currentProfileFingerprint'])
  const digest = (input: unknown, field: string) => {
    const result = requiredString(input, field, 64)
    if (!/^[0-9a-f]{64}$/i.test(result)) invalid(field, '格式无效')
    return result
  }
  const [candidateId] = decodeContinuationCandidateIdArgs([value.candidateId])
  return [
    {
      candidateId,
      candidateFingerprint: digest(value.candidateFingerprint, 'adoption.candidateFingerprint'),
      currentProfileFingerprint: digest(value.currentProfileFingerprint, 'adoption.currentProfileFingerprint')
    }
  ]
}

export const decodeContinuationExistingPlotAdoptionArgs: ArgsDecoder<[ContinuationExistingPlotAdoptionInput]> = (
  args
) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'adoption', [
    'candidateId',
    'candidateFingerprint',
    'currentTimelineFingerprint',
    'event'
  ])
  const digest = (input: unknown, field: string) => {
    const result = requiredString(input, field, 64)
    if (!/^[0-9a-f]{64}$/i.test(result)) invalid(field, '格式无效')
    return result
  }
  const [candidateId] = decodeContinuationCandidateIdArgs([value.candidateId])
  const event = exactRecord(value.event, 'adoption.event', ['time', 'characters', 'location', 'event'])
  return [
    {
      candidateId,
      candidateFingerprint: digest(value.candidateFingerprint, 'adoption.candidateFingerprint'),
      currentTimelineFingerprint: digest(value.currentTimelineFingerprint, 'adoption.currentTimelineFingerprint'),
      event: {
        time: requiredString(event.time, 'adoption.event.time', 500),
        characters: requiredString(event.characters, 'adoption.event.characters', 2_000),
        location: requiredString(event.location, 'adoption.event.location', 2_000),
        event: requiredString(event.event, 'adoption.event.event', 20_000)
      }
    }
  ]
}

export function continuationCharacter(value: Record<string, unknown>, field = 'character') {
  const character = exactRecord(value, field, ['name', 'role', 'arcSeed'])
  return {
    name: requiredString(character.name, `${field}.name`, 120),
    role: requiredString(character.role, `${field}.role`, 1_000),
    arcSeed: requiredString(character.arcSeed, `${field}.arcSeed`, 5_000)
  }
}

export const decodeContinuationCharacterPreviewArgs: ArgsDecoder<[ContinuationCharacterPreviewInput]> = (args) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'characterPreview', ['candidateId', 'character'])
  const candidateId = requiredString(value.candidateId, 'characterPreview.candidateId', 64)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidateId))
    invalid('characterPreview.candidateId', '格式无效')
  return [
    {
      candidateId,
      character: continuationCharacter(
        record(value.character, 'characterPreview.character'),
        'characterPreview.character'
      )
    }
  ]
}

export const decodeContinuationCharacterAdoptionArgs: ArgsDecoder<[ContinuationCharacterAdoptionInput]> = (args) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'characterAdoption', [
    'candidateId',
    'sectionFingerprint',
    'characterFingerprint',
    'currentAnchorFingerprint',
    'character'
  ])
  const digest = (input: unknown, field: string) => {
    const result = requiredString(input, field, 64)
    if (!/^[0-9a-f]{64}$/i.test(result)) invalid(field, '格式无效')
    return result
  }
  const candidateId = requiredString(value.candidateId, 'characterAdoption.candidateId', 64)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidateId))
    invalid('characterAdoption.candidateId', '格式无效')
  return [
    {
      candidateId,
      sectionFingerprint: digest(value.sectionFingerprint, 'characterAdoption.sectionFingerprint'),
      characterFingerprint: digest(value.characterFingerprint, 'characterAdoption.characterFingerprint'),
      currentAnchorFingerprint: digest(value.currentAnchorFingerprint, 'characterAdoption.currentAnchorFingerprint'),
      character: continuationCharacter(
        record(value.character, 'characterAdoption.character'),
        'characterAdoption.character'
      )
    }
  ]
}

export const decodeContinuationWorldViewAdoptionArgs: ArgsDecoder<[ContinuationWorldViewAdoptionInput]> = (args) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'worldViewAdoption', [
    'candidateId',
    'candidateFingerprint',
    'currentFoundationFingerprint'
  ])
  const digest = (input: unknown, field: string) => {
    const result = requiredString(input, field, 64)
    if (!/^[0-9a-f]{64}$/i.test(result)) invalid(field, '格式无效')
    return result
  }
  const [candidateId] = decodeContinuationCandidateIdArgs([value.candidateId])
  return [
    {
      candidateId,
      candidateFingerprint: digest(value.candidateFingerprint, 'worldViewAdoption.candidateFingerprint'),
      currentFoundationFingerprint: digest(
        value.currentFoundationFingerprint,
        'worldViewAdoption.currentFoundationFingerprint'
      )
    }
  ]
}

export const decodeContinuationPowerSystemAdoptionArgs: ArgsDecoder<[ContinuationPowerSystemAdoptionInput]> = (
  args
) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'powerSystemAdoption', [
    'candidateId',
    'candidateFingerprint',
    'currentPowerSystemFingerprint'
  ])
  const digest = (input: unknown, field: string) => {
    const result = requiredString(input, field, 64)
    if (!/^[0-9a-f]{64}$/i.test(result)) invalid(field, '格式无效')
    return result
  }
  const [candidateId] = decodeContinuationCandidateIdArgs([value.candidateId])
  return [
    {
      candidateId,
      candidateFingerprint: digest(value.candidateFingerprint, 'powerSystemAdoption.candidateFingerprint'),
      currentPowerSystemFingerprint: digest(
        value.currentPowerSystemFingerprint,
        'powerSystemAdoption.currentPowerSystemFingerprint'
      )
    }
  ]
}

export const decodeContinuationCheatSystemAdoptionArgs: ArgsDecoder<[ContinuationCheatSystemAdoptionInput]> = (
  args
) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'cheatSystemAdoption', [
    'candidateId',
    'candidateFingerprint',
    'currentCheatSystemFingerprint'
  ])
  const digest = (input: unknown, field: string) => {
    const result = requiredString(input, field, 64)
    if (!/^[0-9a-f]{64}$/i.test(result)) invalid(field, '格式无效')
    return result
  }
  const [candidateId] = decodeContinuationCandidateIdArgs([value.candidateId])
  return [
    {
      candidateId,
      candidateFingerprint: digest(value.candidateFingerprint, 'cheatSystemAdoption.candidateFingerprint'),
      currentCheatSystemFingerprint: digest(
        value.currentCheatSystemFingerprint,
        'cheatSystemAdoption.currentCheatSystemFingerprint'
      )
    }
  ]
}

export const decodeContinuationTotalOutlineAdoptionArgs: ArgsDecoder<[ContinuationTotalOutlineAdoptionInput]> = (
  args
) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'totalOutlineAdoption', [
    'candidateId',
    'candidateFingerprint',
    'currentOutlineFingerprint',
    'prerequisiteFingerprint'
  ])
  const digest = (input: unknown, field: string) => {
    const result = requiredString(input, field, 64)
    if (!/^[0-9a-f]{64}$/i.test(result)) invalid(field, '格式无效')
    return result
  }
  const [candidateId] = decodeContinuationCandidateIdArgs([value.candidateId])
  return [
    {
      candidateId,
      candidateFingerprint: digest(value.candidateFingerprint, 'totalOutlineAdoption.candidateFingerprint'),
      currentOutlineFingerprint: digest(
        value.currentOutlineFingerprint,
        'totalOutlineAdoption.currentOutlineFingerprint'
      ),
      prerequisiteFingerprint: digest(value.prerequisiteFingerprint, 'totalOutlineAdoption.prerequisiteFingerprint')
    }
  ]
}

export const decodeContinuationVolumeOutlinePreviewArgs: ArgsDecoder<[string, number]> = (args) => {
  exactArgs(args, 2)
  const [candidateId] = decodeContinuationCandidateIdArgs([args[0]])
  return [candidateId, boundedInteger(args[1], 'volumeOutlinePreview.volume', 1, 1_000)]
}

export const decodeContinuationVolumeOutlineAdoptionArgs: ArgsDecoder<[ContinuationVolumeOutlineAdoptionInput]> = (
  args
) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'volumeOutlineAdoption', [
    'candidateId',
    'volume',
    'candidateFingerprint',
    'currentOutlineFingerprint',
    'parentTotalFingerprint'
  ])
  const digest = (input: unknown, field: string) => {
    const result = requiredString(input, field, 64)
    if (!/^[0-9a-f]{64}$/i.test(result)) invalid(field, '格式无效')
    return result
  }
  const [candidateId] = decodeContinuationCandidateIdArgs([value.candidateId])
  return [
    {
      candidateId,
      volume: boundedInteger(value.volume, 'volumeOutlineAdoption.volume', 1, 1_000),
      candidateFingerprint: digest(value.candidateFingerprint, 'volumeOutlineAdoption.candidateFingerprint'),
      currentOutlineFingerprint: digest(
        value.currentOutlineFingerprint,
        'volumeOutlineAdoption.currentOutlineFingerprint'
      ),
      parentTotalFingerprint: digest(value.parentTotalFingerprint, 'volumeOutlineAdoption.parentTotalFingerprint')
    }
  ]
}

export const decodeContinuationChapterOutlinePreviewArgs: ArgsDecoder<[string, number]> = (args) => {
  exactArgs(args, 2)
  const [candidateId] = decodeContinuationCandidateIdArgs([args[0]])
  return [candidateId, boundedInteger(args[1], 'chapterOutlinePreview.chapterId', 1, Number.MAX_SAFE_INTEGER)]
}

export const decodeContinuationChapterOutlineAdoptionArgs: ArgsDecoder<[ContinuationChapterOutlineAdoptionInput]> = (
  args
) => {
  exactArgs(args, 1)
  const value = exactRecord(args[0], 'chapterOutlineAdoption', [
    'candidateId',
    'chapterId',
    'candidateFingerprint',
    'currentOutlineFingerprint',
    'parentTotalFingerprint',
    'parentVolumeFingerprint'
  ])
  const digest = (input: unknown, field: string) => {
    const result = requiredString(input, field, 64)
    if (!/^[0-9a-f]{64}$/i.test(result)) invalid(field, '格式无效')
    return result
  }
  const [candidateId] = decodeContinuationCandidateIdArgs([value.candidateId])
  return [
    {
      candidateId,
      chapterId: boundedInteger(value.chapterId, 'chapterOutlineAdoption.chapterId', 1, Number.MAX_SAFE_INTEGER),
      candidateFingerprint: digest(value.candidateFingerprint, 'chapterOutlineAdoption.candidateFingerprint'),
      currentOutlineFingerprint: digest(
        value.currentOutlineFingerprint,
        'chapterOutlineAdoption.currentOutlineFingerprint'
      ),
      parentTotalFingerprint: digest(value.parentTotalFingerprint, 'chapterOutlineAdoption.parentTotalFingerprint'),
      parentVolumeFingerprint: digest(value.parentVolumeFingerprint, 'chapterOutlineAdoption.parentVolumeFingerprint')
    }
  ]
}
