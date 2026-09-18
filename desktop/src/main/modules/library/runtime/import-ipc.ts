import { dialog, ipcMain } from 'electron'
import { BookImportService } from '../application/book-import-service'
import { ContinuationAnalysisService } from '../application/continuation-analysis-service'
import {
  decodeImportCommitArgs,
  decodeImportManifestCommitArgs,
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

interface Dependencies {
  bookImports: BookImportService
  continuationAnalysis: ContinuationAnalysisService
}

export function registerLibraryImportsIpc(dependencies: Dependencies): void {
  const { bookImports, continuationAnalysis } = dependencies
  let smokeDocumentSelectionIndex = 0
  registerValidatedIpc(ipcMain, 'imports:choose-text', decodeNoArgs, async () => {
    // A single-file import is intentionally exercised against the messy TXT
    // fixture. Multi-file continuation uses the separate choose-documents IPC.
    if (process.env.LANJIAN_SMOKE_TXT_PATH) return bookImports.previewFile(process.env.LANJIAN_SMOKE_TXT_PATH)
    const smokeDocumentPaths = parseSmokeDocumentPaths(process.env.LANJIAN_SMOKE_DOCUMENT_PATHS)
    if (smokeDocumentPaths.length) {
      const selected = smokeDocumentPaths[Math.min(smokeDocumentSelectionIndex, smokeDocumentPaths.length - 1)]
      smokeDocumentSelectionIndex += 1
      return bookImports.previewFile(selected)
    }
    const path = (
      await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: '小说文稿与资料', extensions: ['txt', 'md', 'docx'] }]
      })
    ).filePaths[0]
    return path ? bookImports.previewFile(path) : null
  })
  registerValidatedIpc(ipcMain, 'imports:choose-documents', decodeNoArgs, async () => {
    const smokeDocumentPaths = parseSmokeDocumentPaths(process.env.LANJIAN_SMOKE_DOCUMENT_PATHS)
    if (smokeDocumentPaths.length) {
      smokeDocumentSelectionIndex = smokeDocumentPaths.length
      return bookImports.previewFiles(smokeDocumentPaths)
    }
    const paths = (
      await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '小说文稿与资料', extensions: ['txt', 'md', 'docx'] }]
      })
    ).filePaths
    return paths.length ? bookImports.previewFiles(paths) : null
  })
  registerValidatedIpc(ipcMain, 'imports:append-documents', decodeImportManifestIdArgs, async (manifestId) => {
    const smokeAppendDocumentPaths = parseSmokeDocumentPaths(process.env.LANJIAN_SMOKE_APPEND_DOCUMENT_PATHS)
    if (smokeAppendDocumentPaths.length) return bookImports.appendFiles(manifestId, smokeAppendDocumentPaths)
    const paths = (
      await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '小说文稿与资料', extensions: ['txt', 'md', 'docx'] }]
      })
    ).filePaths
    return paths.length ? bookImports.appendFiles(manifestId, paths) : null
  })
  registerValidatedIpc(ipcMain, 'imports:commit-text', decodeImportCommitArgs, (input) => bookImports.commit(input))
  registerValidatedIpc(ipcMain, 'imports:commit-manifest', decodeImportManifestCommitArgs, (input) =>
    bookImports.commitManifest(input)
  )
  registerValidatedIpc(ipcMain, 'imports:recoverable-manifests', decodeNoArgs, () => bookImports.recoverableManifests())
  registerValidatedIpc(ipcMain, 'imports:resume-manifest', decodeImportManifestIdArgs, (id) =>
    bookImports.resumeManifest(id)
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

function parseSmokeDocumentPaths(value: string | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : []
  } catch {
    return []
  }
}
