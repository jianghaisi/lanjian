import { dialog, ipcMain } from 'electron'
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

import { registerLibraryImportCommands } from './import-commands'
export function registerLibraryImportsIpc(dependencies: Parameters<typeof registerLibraryImportCommands>[1]): void {
  registerLibraryImportCommands(ipcMain, dependencies)
  const { bookImports } = dependencies
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
