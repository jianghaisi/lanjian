import type { IpcRegistrar } from '../../../platform/ipc/validated-ipc'
import { BookImportService } from '../application/book-import-service'
import { ContinuationAnalysisService } from '../application/continuation-analysis-service'
import {
  decodeImportManifestIdArgs,
  decodeContinuationAnalysisEditsArgs,
  decodeContinuationCandidateIdArgs,
  decodeContinuationProjectDefinitionAdoptionArgs,
  decodeContinuationExistingPlotAdoptionArgs,
  decodeContinuationCharacterPreviewArgs,
  decodeContinuationCharacterAdoptionArgs,
  decodeContinuationWorldViewAdoptionArgs,
  decodeContinuationPowerSystemAdoptionArgs,
  decodeContinuationCheatSystemAdoptionArgs,
  decodeContinuationTotalOutlineAdoptionArgs,
  decodeContinuationVolumeOutlineAdoptionArgs,
  decodeContinuationVolumeOutlinePreviewArgs,
  decodeContinuationChapterOutlineAdoptionArgs,
  decodeContinuationChapterOutlinePreviewArgs,
  decodeNoArgs
} from '../../../../contracts/ipc'
import { registerValidatedIpc } from '../../../platform/ipc/validated-ipc'
import { decodeConfirmedImportCommitArgs, decodeConfirmedImportManifestArgs, decodeImportResumeArgs } from '../../../../contracts/library/import-ipc'

interface Dependencies {
  bookImports: BookImportService
  continuationAnalysis: ContinuationAnalysisService
}

export function registerLibraryImportCommands(ipcMain: IpcRegistrar, dependencies: Dependencies): void {
  const { bookImports, continuationAnalysis } = dependencies
  registerValidatedIpc(ipcMain, 'imports:commit-text', decodeConfirmedImportCommitArgs, (input) => bookImports.commit(input))
  registerValidatedIpc(ipcMain, 'imports:commit-manifest', decodeConfirmedImportManifestArgs, (input) =>
    bookImports.commitManifest(input)
  )
  registerValidatedIpc(ipcMain, 'imports:recoverable-manifests', decodeNoArgs, () => bookImports.recoverableManifests())
  registerValidatedIpc(ipcMain, 'imports:resume-manifest', decodeImportResumeArgs, (id, expectedWorkItemId) =>
    bookImports.resumeManifest(id, expectedWorkItemId)
  )
  registerValidatedIpc(ipcMain, 'imports:continuation-analysis', decodeNoArgs, () => continuationAnalysis.state())
  registerValidatedIpc(ipcMain, 'imports:generate-continuation-analysis', decodeImportManifestIdArgs, (id) =>
    continuationAnalysis.generate(id)
  )
  registerValidatedIpc(ipcMain, 'imports:save-continuation-analysis', decodeContinuationAnalysisEditsArgs, (input) =>
    continuationAnalysis.saveEdits(input)
  )
  registerValidatedIpc(
    ipcMain,
    'imports:preview-continuation-project-definition',
    decodeContinuationCandidateIdArgs,
    (candidateId) => continuationAnalysis.previewProjectDefinition(candidateId)
  )
  registerValidatedIpc(
    ipcMain,
    'imports:adopt-continuation-project-definition',
    decodeContinuationProjectDefinitionAdoptionArgs,
    (input) => continuationAnalysis.adoptProjectDefinition(input)
  )
  registerValidatedIpc(
    ipcMain,
    'imports:preview-continuation-existing-plot',
    decodeContinuationCandidateIdArgs,
    (candidateId) => continuationAnalysis.previewExistingPlot(candidateId)
  )
  registerValidatedIpc(
    ipcMain,
    'imports:adopt-continuation-existing-plot',
    decodeContinuationExistingPlotAdoptionArgs,
    (input) => continuationAnalysis.adoptExistingPlot(input)
  )
  registerValidatedIpc(
    ipcMain,
    'imports:preview-continuation-character',
    decodeContinuationCharacterPreviewArgs,
    (input) => continuationAnalysis.previewCharacter(input)
  )
  registerValidatedIpc(
    ipcMain,
    'imports:adopt-continuation-character',
    decodeContinuationCharacterAdoptionArgs,
    (input) => continuationAnalysis.adoptCharacter(input)
  )
  registerValidatedIpc(
    ipcMain,
    'imports:preview-continuation-world-view',
    decodeContinuationCandidateIdArgs,
    (candidateId) => continuationAnalysis.previewWorldView(candidateId)
  )
  registerValidatedIpc(
    ipcMain,
    'imports:adopt-continuation-world-view',
    decodeContinuationWorldViewAdoptionArgs,
    (input) => continuationAnalysis.adoptWorldView(input)
  )
  registerValidatedIpc(
    ipcMain,
    'imports:preview-continuation-power-system',
    decodeContinuationCandidateIdArgs,
    (candidateId) => continuationAnalysis.previewPowerSystem(candidateId)
  )
  registerValidatedIpc(
    ipcMain,
    'imports:adopt-continuation-power-system',
    decodeContinuationPowerSystemAdoptionArgs,
    (input) => continuationAnalysis.adoptPowerSystem(input)
  )
  registerValidatedIpc(
    ipcMain,
    'imports:preview-continuation-cheat-system',
    decodeContinuationCandidateIdArgs,
    (candidateId) => continuationAnalysis.previewCheatSystem(candidateId)
  )
  registerValidatedIpc(
    ipcMain,
    'imports:adopt-continuation-cheat-system',
    decodeContinuationCheatSystemAdoptionArgs,
    (input) => continuationAnalysis.adoptCheatSystem(input)
  )
  registerValidatedIpc(
    ipcMain,
    'imports:preview-continuation-total-outline',
    decodeContinuationCandidateIdArgs,
    (candidateId) => continuationAnalysis.previewTotalOutline(candidateId)
  )
  registerValidatedIpc(
    ipcMain,
    'imports:adopt-continuation-total-outline',
    decodeContinuationTotalOutlineAdoptionArgs,
    (input) => continuationAnalysis.adoptTotalOutline(input)
  )
  registerValidatedIpc(
    ipcMain,
    'imports:preview-continuation-volume-outline',
    decodeContinuationVolumeOutlinePreviewArgs,
    (candidateId, volume) => continuationAnalysis.previewVolumeOutline(candidateId, volume)
  )
  registerValidatedIpc(
    ipcMain,
    'imports:adopt-continuation-volume-outline',
    decodeContinuationVolumeOutlineAdoptionArgs,
    (input) => continuationAnalysis.adoptVolumeOutline(input)
  )
  registerValidatedIpc(
    ipcMain,
    'imports:preview-continuation-chapter-outline',
    decodeContinuationChapterOutlinePreviewArgs,
    (candidateId, chapterId) => continuationAnalysis.previewChapterOutline(candidateId, chapterId)
  )
  registerValidatedIpc(
    ipcMain,
    'imports:adopt-continuation-chapter-outline',
    decodeContinuationChapterOutlineAdoptionArgs,
    (input) => continuationAnalysis.adoptChapterOutline(input)
  )
}
