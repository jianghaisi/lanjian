import { app, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import { DocumentService } from '../application/document-service'
import { ProjectService } from '../../library/application/project-service'
import { SqliteManuscriptService } from '../application/sqlite-manuscript-service'
import { ManuscriptExportService, safeExportFileName } from '../application/manuscript-export-service'
import { AppError } from '../../../core/errors/app-error'
import type { Chapter } from '../../../../contracts/index'
import {
  decodeManuscriptExportArgs,
  decodeChapterIdArgs,
  decodeChapterPlanningUpdateArgs,
  decodeChapterDraftRecoveryArgs,
  decodeChapterRevisionArgs,
  decodeChapterRevisionLabelArgs,
  decodeChapterReorderArgs,
  decodeChapterUpdateArgs,
  decodeChapterAutosaveStageArgs,
  decodeAutosaveCheckpointIdArgs,
  decodeChapterMirrorRecoveryTokenArgs,
  decodeNoArgs
} from '../../../../contracts/ipc'
import { registerValidatedIpc } from '../../../platform/ipc/validated-ipc'

import { registerManuscriptCommands } from './commands'

export function registerManuscriptIpc(dependencies: Parameters<typeof registerManuscriptCommands>[1]): void {
  registerManuscriptCommands(ipcMain, dependencies)
  const { projects, manuscriptExports } = dependencies
  registerValidatedIpc(ipcMain, 'projects:manuscript-export', decodeManuscriptExportArgs, async (selection) => {
    // Read one captured book before opening a native dialog; never re-resolve
    // its chapters from a different active book when the dialog returns.
    const snapshot = await projects.runInCurrentBook(() => manuscriptExports.prepare(selection))
    await manuscriptExports.assertCurrent(snapshot)
    const smokeTarget = process.env.LANJIAN_SMOKE_MANUSCRIPT_EXPORT_PATH
    const target =
      smokeTarget ??
      (
        await dialog.showSaveDialog({
          title: selection ? `导出阅读稿 · 已选 ${snapshot.chapters.length} 章` : '导出整书阅读稿',
          buttonLabel: '导出阅读稿',
          defaultPath: join(app.getPath('documents'), `${safeExportFileName(snapshot.title)}-阅读稿.txt`),
          filters: [
            { name: 'TXT 纯文本', extensions: ['txt'] },
            { name: 'Markdown', extensions: ['md'] }
          ],
          properties: ['showOverwriteConfirmation', 'createDirectory']
        })
      ).filePath
    return target ? manuscriptExports.exportPrepared(snapshot, target) : null
  })
}
