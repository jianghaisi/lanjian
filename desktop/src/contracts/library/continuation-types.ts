import type { BookProfile, CheatSystemData, FoundationData, PowerSystemData } from '../worldbuilding/types'
import type { TimelineEvent } from '../timeline/types'
import type { CharacterStateView } from '../characters/types'
import type { OutlinePlanningStatus } from '../planning/types'
import type { CreativePolicyRecord } from '@lanjian/writing-plugin-contracts'

export type ContinuationAnalysisArea =
  | 'projectDefinition'
  | 'existingPlot'
  | 'characters'
  | 'worldView'
  | 'powerSystem'
  | 'cheatSystem'
  | 'totalOutline'
  | 'volumeOutline'
  | 'chapterOutline'

export type ContinuationEvidenceRef = { fileName: string; excerpt: string }

export type ContinuationAnalysisSection = {
  area: ContinuationAnalysisArea
  status: 'found' | 'missing' | 'conflict'
  content: string
  evidence: ContinuationEvidenceRef[]
}

export type ContinuationGap = {
  id: string
  level: 'required' | 'recommended' | 'conflict'
  area: ContinuationAnalysisArea
  title: string
  suggestion: string
}

export type ContinuationAnalysisCandidate = {
  version: 1
  id: string
  workItemId: string
  manifestId: string
  sourceFingerprint: string
  createdAt: string
  updatedAt: string
  status: 'candidate'
  sections: ContinuationAnalysisSection[]
  gaps: ContinuationGap[]
  rationale: string
  creativePolicy?: CreativePolicyRecord[]
  adoption?: {
    projectDefinition?: {
      candidateFingerprint: string
      profileFingerprint: string
      adoptedAt: string
    }
    existingPlot?: Array<{
      candidateFingerprint: string
      eventFingerprint: string
      timelineEventId: string
      eventVersionId?: string
      operationId?: string
      sourceManifestId?: string
      sourceFingerprint?: string
      adoptedAt: string
    }>
    characters?: Array<{
      candidateFingerprint: string
      anchorFingerprint: string
      name: string
      adoptedAt: string
    }>
    worldView?: {
      candidateFingerprint: string
      foundationFingerprint: string
      adoptedAt: string
    }
    powerSystem?: {
      candidateFingerprint: string
      powerSystemFingerprint: string
      adoptedAt: string
    }
    cheatSystem?: {
      candidateFingerprint: string
      cheatSystemFingerprint: string
      adoptedAt: string
    }
    totalOutline?: {
      candidateFingerprint: string
      outlineFingerprint: string
      prerequisiteFingerprint: string
      revision: number
      adoptedAt: string
    }
    volumeOutlines?: Array<{
      volume: number
      candidateFingerprint: string
      outlineFingerprint: string
      parentTotalFingerprint: string
      revision: number
      adoptedAt: string
    }>
    chapterOutlines?: Array<{
      chapterId: number
      candidateFingerprint: string
      outlineFingerprint: string
      parentTotalFingerprint: string
      parentVolumeFingerprint: string
      adoptedAt: string
    }>
  }
}

export type ContinuationAnalysisState = {
  candidate: ContinuationAnalysisCandidate | null
  availableManifestId?: string
  blockedReason?: string
}

export type ContinuationAnalysisEdits = {
  candidateId: string
  sections: Array<{ area: ContinuationAnalysisArea; content: string }>
  rationale: string
}

export type ContinuationProjectDefinitionPreview = {
  candidateId: string
  area: 'projectDefinition'
  currentCoreIdea: string
  candidateCoreIdea: string
  candidateFingerprint: string
  currentProfileFingerprint: string
  preserved: string[]
  canAdopt: boolean
  reason?: string
}

export type ContinuationProjectDefinitionAdoptionInput = {
  candidateId: string
  candidateFingerprint: string
  currentProfileFingerprint: string
}

export type ContinuationProjectDefinitionAdoptionResult = {
  candidate: ContinuationAnalysisCandidate
  profile: BookProfile
}

export type ContinuationExistingPlotPreview = {
  candidateId: string
  area: 'existingPlot'
  candidateEvent: string
  candidateFingerprint: string
  currentTimelineFingerprint: string
  evidence: ContinuationEvidenceRef[]
  canAdopt: boolean
  reason?: string
}

export type ContinuationExistingPlotAdoptionInput = {
  candidateId: string
  candidateFingerprint: string
  currentTimelineFingerprint: string
  event: { time: string; characters: string; location: string; event: string }
}

export type ContinuationExistingPlotAdoptionResult = {
  candidate: ContinuationAnalysisCandidate
  event: TimelineEvent
  timeline: { events: TimelineEvent[] }
}

export type ContinuationCharacterDraft = { name: string; role: string; arcSeed: string }

export type ContinuationCharacterPreviewInput = {
  candidateId: string
  character: ContinuationCharacterDraft
}

export type ContinuationCharacterPreview = {
  candidateId: string
  area: 'characters'
  candidateSummary: string
  sectionFingerprint: string
  characterFingerprint: string
  currentAnchorFingerprint: string
  character: ContinuationCharacterDraft
  action: 'create' | 'enrich' | 'update' | 'keep'
  current?: { role?: string; arcSeed?: string }
  evidence: ContinuationEvidenceRef[]
  affected: { existingAnchors: number; dynamicSnapshots: number; pendingConflicts: number }
  canAdopt: boolean
  reason?: string
}

export type ContinuationCharacterAdoptionInput = {
  candidateId: string
  sectionFingerprint: string
  characterFingerprint: string
  currentAnchorFingerprint: string
  character: ContinuationCharacterDraft
}

export type ContinuationCharacterAdoptionResult = {
  candidate: ContinuationAnalysisCandidate
  characters: CharacterStateView
}

export type ContinuationWorldViewPreview = {
  candidateId: string
  area: 'worldView'
  currentWorldView: string
  candidateWorldView: string
  candidateFingerprint: string
  currentFoundationFingerprint: string
  evidence: ContinuationEvidenceRef[]
  preserved: string[]
  changes: boolean
  canAdopt: boolean
  reason?: string
}

export type ContinuationWorldViewAdoptionInput = {
  candidateId: string
  candidateFingerprint: string
  currentFoundationFingerprint: string
}

export type ContinuationWorldViewAdoptionResult = {
  candidate: ContinuationAnalysisCandidate
  foundation: FoundationData
}

export type ContinuationPowerSystemPreview = {
  candidateId: string
  area: 'powerSystem'
  currentOverview: string
  candidateOverview: string
  candidateFingerprint: string
  currentPowerSystemFingerprint: string
  evidence: ContinuationEvidenceRef[]
  preserved: { realmLevels: number; realmsEnabled: boolean }
  changes: boolean
  canAdopt: boolean
  reason?: string
}

export type ContinuationPowerSystemAdoptionInput = {
  candidateId: string
  candidateFingerprint: string
  currentPowerSystemFingerprint: string
}

export type ContinuationPowerSystemAdoptionResult = {
  candidate: ContinuationAnalysisCandidate
  powerSystem: PowerSystemData
}

export type ContinuationCheatSystemPreview = {
  candidateId: string
  area: 'cheatSystem'
  currentOverview: string
  candidateOverview: string
  candidateFingerprint: string
  currentCheatSystemFingerprint: string
  evidence: ContinuationEvidenceRef[]
  preserved: { systemEnabled: boolean; templateConfigured: boolean }
  changes: boolean
  canAdopt: boolean
  reason?: string
}

export type ContinuationCheatSystemAdoptionInput = {
  candidateId: string
  candidateFingerprint: string
  currentCheatSystemFingerprint: string
}

export type ContinuationCheatSystemAdoptionResult = {
  candidate: ContinuationAnalysisCandidate
  cheatSystem: CheatSystemData
}

export type ContinuationTotalOutlinePreview = {
  candidateId: string
  area: 'totalOutline'
  currentOutline: string
  candidateOutline: string
  candidateFingerprint: string
  currentOutlineFingerprint: string
  prerequisiteFingerprint: string
  evidence: ContinuationEvidenceRef[]
  affected: { currentRevision: number; totalConfirmed: boolean; volumeOutlines: number; chapterOutlines: number }
  changes: boolean
  canAdopt: boolean
  reason?: string
}

export type ContinuationTotalOutlineAdoptionInput = {
  candidateId: string
  candidateFingerprint: string
  currentOutlineFingerprint: string
  prerequisiteFingerprint: string
}

export type ContinuationTotalOutlineAdoptionResult = {
  candidate: ContinuationAnalysisCandidate
  planning: OutlinePlanningStatus
  content: string
}

export type ContinuationVolumeOutlinePreview = {
  candidateId: string
  area: 'volumeOutline'
  volume: number
  volumeTitle: string
  currentOutline: string
  candidateOutline: string
  candidateFingerprint: string
  currentOutlineFingerprint: string
  parentTotalFingerprint: string
  evidence: ContinuationEvidenceRef[]
  affected: {
    currentRevision: number
    volumeConfirmed: boolean
    siblingVolumeOutlines: number
    chapterOutlines: number
  }
  changes: boolean
  canAdopt: boolean
  reason?: string
}

export type ContinuationVolumeOutlineAdoptionInput = {
  candidateId: string
  volume: number
  candidateFingerprint: string
  currentOutlineFingerprint: string
  parentTotalFingerprint: string
}

export type ContinuationVolumeOutlineAdoptionResult = {
  candidate: ContinuationAnalysisCandidate
  planning: OutlinePlanningStatus
  content: string
}

export type ContinuationChapterOutlinePreview = {
  candidateId: string
  area: 'chapterOutline'
  chapterId: number
  chapterPosition: number
  chapterTitle: string
  volume: number
  volumeTitle: string
  currentOutline: string
  candidateOutline: string
  candidateFingerprint: string
  currentOutlineFingerprint: string
  parentTotalFingerprint: string
  parentVolumeFingerprint: string
  evidence: ContinuationEvidenceRef[]
  affected: { chapterConfirmed: boolean; siblingChapterOutlines: number; manuscriptWordCount: number }
  changes: boolean
  canAdopt: boolean
  reason?: string
}

export type ContinuationChapterOutlineAdoptionInput = {
  candidateId: string
  chapterId: number
  candidateFingerprint: string
  currentOutlineFingerprint: string
  parentTotalFingerprint: string
  parentVolumeFingerprint: string
}

export type ContinuationChapterOutlineAdoptionResult = {
  candidate: ContinuationAnalysisCandidate
  planning: OutlinePlanningStatus
  content: string
}
