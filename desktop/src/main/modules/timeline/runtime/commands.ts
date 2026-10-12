import type { IpcRegistrar } from '../../../platform/ipc/validated-ipc'
import { ResearchLibraryService } from '../../library/application/research-library-service'
import { WorkspaceService } from '../../library/application/workspace-service'
import {
  decodeNoArgs,
  decodeSettlementChapterArgs, decodeSettlementIdArgs, decodeSettlementDraftArgs, decodeSettlementPreviewArgs, decodeSettlementWithdrawArgs, decodeSettlementStartArgs,
  decodeResearchEventIdArgs,
  decodeEventCandidateCreateArgs,
  decodeTimelineArgs,
  decodeEventOperationPreviewArgs,
  decodeEventMaterialCandidatePreviewArgs,
  decodeEventModelCandidateGenerationArgs,
  decodeEventModelCandidatePreviewArgs,
  decodeEventOperationTokenArgs,
  decodeEventOperationReceiptArgs,
  decodeEventMigrationPageArgs,
  decodeEventMigrationReviewArgs,
  decodeEventMigrationCancelArgs,
  decodeOptionalEventOperationIdArgs
} from '../../../../contracts/ipc'
import { registerValidatedIpc } from '../../../platform/ipc/validated-ipc'
import type { createEventRuntime } from './event-runtime'
import { AppError } from '../../../core/errors/app-error'

interface Dependencies {
  researchLibrary: ResearchLibraryService
  workspace: WorkspaceService
  events: ReturnType<typeof createEventRuntime>
}

export function registerTimelineIpc(ipcMain: IpcRegistrar, dependencies: Dependencies): void {
  const { researchLibrary, workspace, events } = dependencies
  const extraction = () => { if(!events.extraction)throw new AppError('FEATURE_UNAVAILABLE','事件提取暂不可用。',{recoverable:true});return events.extraction }
  registerValidatedIpc(ipcMain,'events:settlement-page',decodeSettlementChapterArgs,async id=>{
    return events.settlements.page(id,()=>events.extraction?events.extraction.recent(id):Promise.resolve([]))
  })
  registerValidatedIpc(ipcMain,'events:settlement-draft',decodeSettlementDraftArgs,input=>events.settlements.saveDraft(input))
  registerValidatedIpc(ipcMain,'events:settlement-preview',decodeSettlementPreviewArgs,input=>events.settlements.preview(input))
  registerValidatedIpc(ipcMain,'events:settlement-withdraw',decodeSettlementWithdrawArgs,input=>events.settlements.previewWithdrawal(input))
  registerValidatedIpc(ipcMain,'events:settlement-commit',decodeSettlementIdArgs,token=>events.settlements.commit(token))
  registerValidatedIpc(ipcMain,'events:settlement-cancel',decodeNoArgs,()=>events.settlements.cancel())
  registerValidatedIpc(ipcMain,'events:settlement-receipt',decodeSettlementIdArgs,id=>events.settlements.receipt(id))
  registerValidatedIpc(ipcMain,'events:settlement-start',decodeSettlementStartArgs,input=>extraction().start(input))
  registerValidatedIpc(ipcMain,'events:settlement-task',decodeSettlementIdArgs,id=>extraction().status(id))
  registerValidatedIpc(ipcMain,'events:settlement-stop',decodeSettlementIdArgs,id=>extraction().stop(id))
  registerValidatedIpc(ipcMain, 'events:projection', decodeNoArgs, () => events.projection.read())
  registerValidatedIpc(ipcMain, 'events:migration-preview', decodeNoArgs, () => events.reviews.preview())
  registerValidatedIpc(ipcMain, 'events:migration-page', decodeEventMigrationPageArgs, async (input) => {
    const inspection = await events.reviews.inspection(input.previewId)
    const page = input.kind === 'rows' ? inspection.rowsPage(input.offset)
      : input.kind === 'groups' ? inspection.groupsPage(input.offset)
        : input.kind === 'group-members' ? inspection.groupMembersPage(input.groupId!, input.offset)
          : input.kind === 'references' ? inspection.referencesPage(input.offset)
            : inspection.planningFindingsPage(input.offset)
    return Object.freeze({ kind: input.kind, ...page })
  })
  registerValidatedIpc(ipcMain, 'events:migration-review', decodeEventMigrationReviewArgs, (input) => {
    const { previewId, ...decisions } = input
    return events.reviews.review(previewId, decisions)
  })
  registerValidatedIpc(ipcMain, 'events:migration-commit', decodeEventOperationTokenArgs, (token) =>
    events.migrations.commit(token)
  )
  registerValidatedIpc(ipcMain, 'events:state-initialization-preview', decodeNoArgs, () =>
    events.stateInitialization.preview()
  )
  registerValidatedIpc(ipcMain, 'events:state-initialization-commit', decodeEventOperationTokenArgs, (token) =>
    events.stateInitialization.commit(token)
  )
  registerValidatedIpc(ipcMain, 'events:migration-cancel', decodeEventMigrationCancelArgs, (previewId) => {
    events.reviews.cancel(previewId)
    return true
  })
  registerValidatedIpc(ipcMain, 'events:migration-receipt', decodeOptionalEventOperationIdArgs, (operationId) =>
    events.migrationReceipts.read(operationId)
  )
  registerValidatedIpc(ipcMain, 'events:mirror-retry', decodeOptionalEventOperationIdArgs, (operationId) =>
    events.mirrors.retry(operationId)
  )
  registerValidatedIpc(ipcMain, 'events:operation-preview', decodeEventOperationPreviewArgs, (input) =>
    events.operations.preview(input)
  )
  registerValidatedIpc(ipcMain, 'events:material-candidate-preview', decodeEventMaterialCandidatePreviewArgs, (input) =>
    events.operations.previewMaterialCandidate(input)
  )
  registerValidatedIpc(ipcMain, 'events:model-candidates-generate', decodeEventModelCandidateGenerationArgs, (input) =>
    events.operations.generateModelCandidates(input)
  )
  registerValidatedIpc(ipcMain, 'events:model-candidate-preview', decodeEventModelCandidatePreviewArgs, (input) =>
    events.operations.previewModelCandidate(input)
  )
  registerValidatedIpc(ipcMain, 'events:operation-commit', decodeEventOperationTokenArgs, (token) =>
    events.operations.commit(token)
  )
  registerValidatedIpc(ipcMain, 'events:operation-cancel', decodeNoArgs, () => {
    events.operations.cancel()
    return true
  })
  registerValidatedIpc(ipcMain, 'events:operation-receipt', decodeEventOperationReceiptArgs, (operationId) =>
    events.operations.receipt(operationId)
  )
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
