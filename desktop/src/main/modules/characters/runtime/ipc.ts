import { ipcMain } from 'electron'
import { ProjectService } from '../../library/application/project-service'
import { WorkspaceService } from '../../library/application/workspace-service'
import { SqliteManuscriptService } from '../../manuscript/application/sqlite-manuscript-service'
import {
  decodeCharacterAliasesArgs,
  decodeOptionalStoryEntityIdArgs,
  decodeStoryEntityArgs,
  decodeStoryEntityRelationArgs,
  decodeResourceLedgerAppendArgs,
  decodeForeshadowActionArgs,
  decodeNoArgs
} from '../../../../contracts/ipc'
import { registerValidatedIpc } from '../../../platform/ipc/validated-ipc'

interface Dependencies {
  sqliteManuscripts: SqliteManuscriptService
  projects: ProjectService
  workspace: WorkspaceService
}

export function registerCharactersIpc(dependencies: Dependencies): void {
  const { sqliteManuscripts, projects, workspace } = dependencies
  registerValidatedIpc(ipcMain, 'workspace:list-character-aliases', decodeNoArgs, async () =>
    sqliteManuscripts.characterAliases(await projects.currentPath())
  )
  registerValidatedIpc(ipcMain, 'workspace:replace-character-aliases', decodeCharacterAliasesArgs, async (input) =>
    sqliteManuscripts.replaceCharacterAliases(await projects.currentPath(), input)
  )
  registerValidatedIpc(ipcMain, 'workspace:list-story-entities', decodeNoArgs, async () =>
    sqliteManuscripts.storyEntities(await projects.currentPath())
  )
  registerValidatedIpc(ipcMain, 'workspace:save-story-entity', decodeStoryEntityArgs, async (input) =>
    sqliteManuscripts.saveStoryEntity(await projects.currentPath(), input)
  )
  registerValidatedIpc(
    ipcMain,
    'workspace:list-story-entity-relations',
    decodeOptionalStoryEntityIdArgs,
    async (entityId) => sqliteManuscripts.storyEntityRelations(await projects.currentPath(), entityId)
  )
  registerValidatedIpc(ipcMain, 'workspace:save-story-entity-relation', decodeStoryEntityRelationArgs, async (input) =>
    sqliteManuscripts.saveStoryEntityRelation(await projects.currentPath(), input)
  )
  registerValidatedIpc(ipcMain, 'workspace:get-resource-ledger', decodeOptionalStoryEntityIdArgs, async (entityId) =>
    sqliteManuscripts.resourceLedger(await projects.currentPath(), entityId)
  )
  registerValidatedIpc(ipcMain, 'workspace:append-resource-ledger', decodeResourceLedgerAppendArgs, async (input) =>
    sqliteManuscripts.appendResourceLedger(await projects.currentPath(), input)
  )
  registerValidatedIpc(ipcMain, 'workspace:get-foreshadow-ledger', decodeNoArgs, async () =>
    sqliteManuscripts.foreshadowLedger(await projects.currentPath())
  )
  registerValidatedIpc(ipcMain, 'workspace:record-foreshadow-action', decodeForeshadowActionArgs, async (input) =>
    sqliteManuscripts.recordForeshadowAction(await projects.currentPath(), input)
  )
  registerValidatedIpc(ipcMain, 'workspace:get-character-state', decodeNoArgs, () => workspace.characterState())
}
