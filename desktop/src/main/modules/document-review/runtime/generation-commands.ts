import type { IpcRegistrar } from '../../../platform/ipc/validated-ipc'
import { exactArgs, uuid } from '../../../../contracts/core/validation'
import { decodeDocumentRef } from '../../../../contracts/document-review/validation'
import { decodeRevisionSelection, decodeRevisionStart, decodeRevisionResume } from '../../../../contracts/document-review/generation-validation'
import { decodeAuthorAnswerSubmission } from '../../../../contracts/assistant/author-interaction-contracts'
import { registerValidatedIpc } from '../../../platform/ipc/validated-ipc'
import type { AnnotationRevisionService } from '../application/annotation-revision-service'
const one = <T>(decode: (value: unknown) => T) => (args: unknown[]): [T] => { exactArgs(args, 1); return [decode(args[0])] }
export function registerAnnotationRevisionIpc(ipcMain: IpcRegistrar, service: AnnotationRevisionService) {
  registerValidatedIpc(ipcMain, 'annotation-revision:analyze', one(decodeRevisionSelection), input => service.analyzeRelated(input))
  registerValidatedIpc(ipcMain, 'annotation-revision:start', one(decodeRevisionStart), input => service.start(input))
  registerValidatedIpc(ipcMain, 'annotation-revision:recent', one(decodeDocumentRef), input => service.recent(input))
  registerValidatedIpc(ipcMain, 'annotation-revision:resume', one(decodeRevisionResume), input => service.resume(input))
  registerValidatedIpc(ipcMain, 'annotation-revision:answer', one(decodeAuthorAnswerSubmission), input => service.answer(input))
  registerValidatedIpc(ipcMain, 'annotation-revision:status', one(v => uuid(v, 'id')), id => service.status(id))
  registerValidatedIpc(ipcMain, 'annotation-revision:cancel', one(v => uuid(v, 'id')), id => service.cancel(id))
}
