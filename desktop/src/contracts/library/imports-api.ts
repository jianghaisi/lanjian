import type {
  DocumentImportManifest,
  DocumentImportManifestRequest,
  DocumentImportManifestResult,
  DocumentImportRecovery,
  TxtImportPreview,
  TxtImportRequest,
  TxtImportResult
} from './import-types'
import type {
  ContinuationAnalysisCandidate,
  ContinuationAnalysisEdits,
  ContinuationAnalysisState,
  ContinuationChapterOutlineAdoptionInput,
  ContinuationChapterOutlineAdoptionResult,
  ContinuationChapterOutlinePreview,
  ContinuationCharacterAdoptionInput,
  ContinuationCharacterAdoptionResult,
  ContinuationCharacterPreview,
  ContinuationCharacterPreviewInput,
  ContinuationCheatSystemAdoptionInput,
  ContinuationCheatSystemAdoptionResult,
  ContinuationCheatSystemPreview,
  ContinuationExistingPlotAdoptionInput,
  ContinuationExistingPlotAdoptionResult,
  ContinuationExistingPlotPreview,
  ContinuationPowerSystemAdoptionInput,
  ContinuationPowerSystemAdoptionResult,
  ContinuationPowerSystemPreview,
  ContinuationProjectDefinitionAdoptionInput,
  ContinuationProjectDefinitionAdoptionResult,
  ContinuationProjectDefinitionPreview,
  ContinuationTotalOutlineAdoptionInput,
  ContinuationTotalOutlineAdoptionResult,
  ContinuationTotalOutlinePreview,
  ContinuationVolumeOutlineAdoptionInput,
  ContinuationVolumeOutlineAdoptionResult,
  ContinuationVolumeOutlinePreview,
  ContinuationWorldViewAdoptionInput,
  ContinuationWorldViewAdoptionResult,
  ContinuationWorldViewPreview
} from './continuation-types'

export type DesktopImportsApi = {
  chooseText: () => Promise<TxtImportPreview | null>
  chooseDocuments: () => Promise<DocumentImportManifest | null>
  appendDocuments: (manifestId: string) => Promise<DocumentImportManifest | null>
  commitText: (input: TxtImportRequest) => Promise<TxtImportResult>
  commitManifest: (input: DocumentImportManifestRequest) => Promise<DocumentImportManifestResult>
  recoverableManifests: () => Promise<DocumentImportRecovery[]>
  resumeManifest: (id: string) => Promise<DocumentImportManifestResult>
  continuationAnalysis: () => Promise<ContinuationAnalysisState>
  generateContinuationAnalysis: (manifestId: string) => Promise<ContinuationAnalysisCandidate>
  saveContinuationAnalysis: (input: ContinuationAnalysisEdits) => Promise<ContinuationAnalysisCandidate>
  previewContinuationProjectDefinition: (candidateId: string) => Promise<ContinuationProjectDefinitionPreview>
  adoptContinuationProjectDefinition: (
    input: ContinuationProjectDefinitionAdoptionInput
  ) => Promise<ContinuationProjectDefinitionAdoptionResult>
  previewContinuationExistingPlot: (candidateId: string) => Promise<ContinuationExistingPlotPreview>
  adoptContinuationExistingPlot: (
    input: ContinuationExistingPlotAdoptionInput
  ) => Promise<ContinuationExistingPlotAdoptionResult>
  previewContinuationCharacter: (input: ContinuationCharacterPreviewInput) => Promise<ContinuationCharacterPreview>
  adoptContinuationCharacter: (
    input: ContinuationCharacterAdoptionInput
  ) => Promise<ContinuationCharacterAdoptionResult>
  previewContinuationWorldView: (candidateId: string) => Promise<ContinuationWorldViewPreview>
  adoptContinuationWorldView: (
    input: ContinuationWorldViewAdoptionInput
  ) => Promise<ContinuationWorldViewAdoptionResult>
  previewContinuationPowerSystem: (candidateId: string) => Promise<ContinuationPowerSystemPreview>
  adoptContinuationPowerSystem: (
    input: ContinuationPowerSystemAdoptionInput
  ) => Promise<ContinuationPowerSystemAdoptionResult>
  previewContinuationCheatSystem: (candidateId: string) => Promise<ContinuationCheatSystemPreview>
  adoptContinuationCheatSystem: (
    input: ContinuationCheatSystemAdoptionInput
  ) => Promise<ContinuationCheatSystemAdoptionResult>
  previewContinuationTotalOutline: (candidateId: string) => Promise<ContinuationTotalOutlinePreview>
  adoptContinuationTotalOutline: (
    input: ContinuationTotalOutlineAdoptionInput
  ) => Promise<ContinuationTotalOutlineAdoptionResult>
  previewContinuationVolumeOutline: (candidateId: string, volume: number) => Promise<ContinuationVolumeOutlinePreview>
  adoptContinuationVolumeOutline: (
    input: ContinuationVolumeOutlineAdoptionInput
  ) => Promise<ContinuationVolumeOutlineAdoptionResult>
  previewContinuationChapterOutline: (
    candidateId: string,
    chapterId: number
  ) => Promise<ContinuationChapterOutlinePreview>
  adoptContinuationChapterOutline: (
    input: ContinuationChapterOutlineAdoptionInput
  ) => Promise<ContinuationChapterOutlineAdoptionResult>
}
