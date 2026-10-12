import type { IpcRegistrar } from '../../../platform/ipc/validated-ipc'
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

interface Dependencies {
  projects: ProjectService
  manuscriptExports: ManuscriptExportService
  documents: DocumentService
  sqliteManuscripts: SqliteManuscriptService
  assertCurrentManuscriptTarget: (target: { workItemId?: string; workItemPath?: string }) => Promise<void>
  reconcileCharacterStates: (chapters: Chapter[], scopedChapterIds?: number[]) => Promise<void>
}

export function registerManuscriptCommands(ipcMain: IpcRegistrar, dependencies: Dependencies): void {
  const {
    projects,
    manuscriptExports,
    documents,
    sqliteManuscripts,
    assertCurrentManuscriptTarget,
    reconcileCharacterStates
  } = dependencies
  let smokeChapterSaveFailures =
    process.env.LANJIAN_SMOKE === '1' ? Math.max(0, Number(process.env.LANJIAN_SMOKE_CHAPTER_SAVE_FAILURES || 0)) : 0
  const smokeChapterSaveFailureText = process.env.LANJIAN_SMOKE_CHAPTER_SAVE_FAILURE_TEXT
  registerValidatedIpc(ipcMain, 'chapters:list', decodeNoArgs, () => documents.chapters())
  registerValidatedIpc(ipcMain, 'chapters:create', decodeNoArgs, () => documents.createChapter())
  registerValidatedIpc(ipcMain, 'chapters:get', decodeChapterIdArgs, (id) => documents.chapter(id))
  registerValidatedIpc(ipcMain, 'chapters:get-planning', decodeChapterIdArgs, async (id) => {
    const workItemId = await projects.currentPath()
    return (await sqliteManuscripts.active(workItemId)) ? sqliteManuscripts.chapterPlanning(workItemId, id) : null
  })
  registerValidatedIpc(ipcMain, 'chapters:update-planning', decodeChapterPlanningUpdateArgs, async (id, input) => {
    const workItemId = await projects.currentPath()
    return sqliteManuscripts.updateChapterPlanning(workItemId, { legacyChapterId: id, ...input })
  })
  registerValidatedIpc(ipcMain, 'chapters:update', decodeChapterUpdateArgs, async (id, data) => {
    await assertCurrentManuscriptTarget(data)
    if (
      smokeChapterSaveFailures > 0 &&
      smokeChapterSaveFailureText &&
      data.content?.includes(smokeChapterSaveFailureText)
    ) {
      smokeChapterSaveFailures -= 1
      throw new AppError('STORAGE_ERROR', '烟测模拟：章节文件暂时无法写入', { recoverable: true })
    }
    const chapter = await documents.updateChapter(id, data)
    await reconcileCharacterStates([chapter], [chapter.id])
    return chapter
  })
  registerValidatedIpc(ipcMain, 'chapters:autosave-stage', decodeChapterAutosaveStageArgs, async (id, data) => {
    await assertCurrentManuscriptTarget(data)
    if (
      smokeChapterSaveFailures > 0 &&
      smokeChapterSaveFailureText &&
      data.content?.includes(smokeChapterSaveFailureText)
    ) {
      smokeChapterSaveFailures -= 1
      throw new AppError('STORAGE_ERROR', '烟测模拟：章节文件暂时无法写入', { recoverable: true })
    }
    const result = await documents.stageAutosave(id, data)
    if (result.storageMode === 'files') await reconcileCharacterStates([result.chapter], [result.chapter.id])
    return result
  })
  registerValidatedIpc(ipcMain, 'chapters:autosave-finalize', decodeAutosaveCheckpointIdArgs, async (checkpointId) => {
    const result = await documents.finalizeAutosave(checkpointId)
    if (result.checkpoint?.status === 'finalized') await reconcileCharacterStates([result.chapter], [result.chapter.id])
    return result
  })
  registerValidatedIpc(ipcMain, 'chapters:autosave-recoveries', decodeNoArgs, () => documents.autosaveRecoveries())
  registerValidatedIpc(ipcMain, 'chapters:autosave-discard', decodeAutosaveCheckpointIdArgs, (checkpointId) =>
    documents.discardAutosaveRecovery(checkpointId)
  )
  registerValidatedIpc(ipcMain, 'chapters:preserve-draft', decodeChapterDraftRecoveryArgs, async (id, data) => {
    await assertCurrentManuscriptTarget(data)
    return documents.preserveDraft(id, data)
  })
  registerValidatedIpc(ipcMain, 'chapters:reorder', decodeChapterReorderArgs, async (id, position) => {
    const chapters = await documents.reorderChapter(id, position)
    await reconcileCharacterStates(chapters)
    return chapters
  })
  registerValidatedIpc(ipcMain, 'chapters:delete', decodeChapterIdArgs, async (id) => {
    const result = await documents.deleteChapter(id)
    await reconcileCharacterStates([], [id])
    return result
  })
  registerValidatedIpc(ipcMain, 'chapters:trash-list', decodeNoArgs, () => documents.trashedChapters())
  registerValidatedIpc(ipcMain, 'chapters:restore', decodeChapterIdArgs, async (id) => {
    const chapter = await documents.restoreChapter(id)
    await reconcileCharacterStates([chapter], [chapter.id])
    return chapter
  })
  registerValidatedIpc(ipcMain, 'chapters:stats', decodeNoArgs, () => documents.chapterStats())
  registerValidatedIpc(ipcMain, 'chapters:revisions', decodeChapterIdArgs, (id) => documents.revisions(id))
  registerValidatedIpc(ipcMain, 'chapters:name-current-revision', decodeChapterRevisionLabelArgs, (id, label) =>
    documents.nameCurrentRevision(id, label)
  )
  registerValidatedIpc(ipcMain, 'chapters:restore-revision', decodeChapterRevisionArgs, async (id, revisionId) => {
    const chapter = await documents.restoreRevision(id, revisionId)
    await reconcileCharacterStates([chapter], [chapter.id])
    return chapter
  })
  registerValidatedIpc(ipcMain, 'chapters:preview-external-mirror', decodeChapterIdArgs, (id) =>
    documents.previewExternalMirror(id)
  )
  registerValidatedIpc(
    ipcMain,
    'chapters:adopt-external-mirror',
    decodeChapterMirrorRecoveryTokenArgs,
    async (token) => {
      const result = await documents.adoptExternalMirror(token)
      await reconcileCharacterStates([result.chapter], [result.chapter.id])
      return result
    }
  )
}
