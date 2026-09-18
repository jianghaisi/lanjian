import { ipcMain } from 'electron'
import { ResearchLibraryService } from '../../library/application/research-library-service'
import { WorkspaceService } from '../../library/application/workspace-service'
import {
  decodeNoArgs,
  decodeResearchEventIdArgs,
  decodeEventCandidateCreateArgs,
  decodeTimelineArgs
} from '../../../../contracts/ipc'
import { registerValidatedIpc } from '../../../platform/ipc/validated-ipc'

interface Dependencies {
  researchLibrary: ResearchLibraryService
  workspace: WorkspaceService
}

export function registerTimelineIpc(dependencies: Dependencies): void {
  const { researchLibrary, workspace } = dependencies
  registerValidatedIpc(ipcMain, 'research:list-events', decodeNoArgs, () => researchLibrary.listEvents())
  registerValidatedIpc(ipcMain, 'research:create-event-candidate', decodeEventCandidateCreateArgs, (input) =>
    researchLibrary.createEventCandidate(input)
  )
  registerValidatedIpc(ipcMain, 'research:approve-event', decodeResearchEventIdArgs, (id) =>
    researchLibrary.approveEvent(id)
  )
  registerValidatedIpc(ipcMain, 'workspace:get-character-lines', decodeNoArgs, () => workspace.characterLines())
  registerValidatedIpc(ipcMain, 'workspace:get-timeline', decodeNoArgs, () => workspace.timeline())
  registerValidatedIpc(ipcMain, 'workspace:save-timeline', decodeTimelineArgs, (events) =>
    workspace.saveTimeline(events)
  )
}
