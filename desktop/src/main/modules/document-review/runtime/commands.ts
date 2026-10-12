import type { IpcRegistrar } from '../../../platform/ipc/validated-ipc'
import type { DocumentReviewService } from '../application/document-review-service'
import { registerValidatedIpc } from '../../../platform/ipc/validated-ipc'
import { exactArgs } from '../../../../contracts/core/validation'
import { decodeAcknowledge, decodeDiscard, decodeDocumentRef, decodeDocumentTarget, decodeOpenReview, decodePrepare, decodeSave, decodeSyncDraft } from '../../../../contracts/document-review/validation'
import { decodeAnnotationList, decodeAnnotationCreate, decodeAnnotationUpdate, decodeAnnotationChange, decodeAnnotationReanchor } from '../../../../contracts/document-review/annotation-validation'
import { decodeRecovery, decodeOutlineVersionInput } from '../../../../contracts/document-review/validation'
const one = <T>(decode: (value: unknown) => T) => (args: unknown[]): [T] => { exactArgs(args, 1); return [decode(args[0])] }
export function registerDocumentReviewIpc(ipcMain: IpcRegistrar, service: DocumentReviewService) {
  registerValidatedIpc(ipcMain, 'document-annotations:list', one(decodeAnnotationList), input => service.listAnnotations(input))
  registerValidatedIpc(ipcMain, 'document-annotations:create', one(decodeAnnotationCreate), input => service.createAnnotation(input))
  registerValidatedIpc(ipcMain, 'document-annotations:update', one(decodeAnnotationUpdate), input => service.changeAnnotation('update', input))
  registerValidatedIpc(ipcMain, 'document-annotations:reanchor', one(decodeAnnotationReanchor), input => service.changeAnnotation('reanchor', input))
  for (const action of ['remove', 'resolve', 'reopen'] as const) registerValidatedIpc(ipcMain, `document-annotations:${action}`, one(decodeAnnotationChange), input => service.changeAnnotation(action, input))
  registerValidatedIpc(ipcMain, 'document-review:snapshot', one(decodeDocumentTarget), value => service.readSnapshot(value))
  registerValidatedIpc(ipcMain, 'document-review:outline-history', one(decodeDocumentRef), value => service.outlineHistory(value))
  registerValidatedIpc(ipcMain, 'document-review:outline-version', one(decodeOutlineVersionInput), value => service.outlineVersion(value))
  registerValidatedIpc(ipcMain, 'document-review:open', one(decodeOpenReview), value => service.openReview(value))
  registerValidatedIpc(ipcMain, 'document-review:list', one(decodeDocumentRef), value => service.listReviews(value))
  registerValidatedIpc(ipcMain, 'document-review:sync-draft', one(decodeSyncDraft), value => service.syncDraft(value))
  registerValidatedIpc(ipcMain, 'document-review:prepare', one(decodePrepare), value => service.prepareDecision(value))
  registerValidatedIpc(ipcMain, 'document-review:acknowledge', one(decodeAcknowledge), value => service.acknowledgeStage(value))
  registerValidatedIpc(ipcMain, 'document-review:save', one(decodeSave), value => service.saveReviewedDraft(value))
  registerValidatedIpc(ipcMain, 'document-review:discard', one(decodeDiscard), value => service.discardDecision(value))
  registerValidatedIpc(ipcMain, 'document-review:recover', one(decodeDocumentRef), value => service.recoverDraft(value))
  registerValidatedIpc(ipcMain, 'document-review:recovery-history', one(decodeDocumentRef), value => service.recoveryHistory(value))
  registerValidatedIpc(ipcMain, 'document-review:use-latest', one(decodeRecovery), value => service.useLatestDraft(value))
}
