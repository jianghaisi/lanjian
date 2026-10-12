import { inspirationArgs } from '../../../../contracts/inspiration/bridge'
import { registerValidatedIpc,type IpcRegistrar } from '../../../platform/ipc/validated-ipc'
import type { InspirationService } from '../application/inspiration-service'
import type { InspirationSelectionService } from '../application/selection-service'
import type { InspirationVideoService } from '../application/video-service'
export function registerInspiration(ipc:IpcRegistrar,library:InspirationService,selection:InspirationSelectionService,video:InspirationVideoService){
  registerValidatedIpc(ipc,'inspiration:listSources',inspirationArgs.listSources,()=>library.listSources())
  registerValidatedIpc(ipc,'inspiration:listClassifications',inspirationArgs.listClassifications,()=>library.listClassifications())
  registerValidatedIpc(ipc,'inspiration:setClassification',inspirationArgs.setClassification,i=>library.setClassification(i))
  registerValidatedIpc(ipc,'inspiration:importPreview',inspirationArgs.importPreview,i=>library.importPreview(i.documents))
  registerValidatedIpc(ipc,'inspiration:importCommit',inspirationArgs.importCommit,(t,c)=>library.importCommit(t,c))
  registerValidatedIpc(ipc,'inspiration:search',inspirationArgs.search,i=>library.search(i))
  registerValidatedIpc(ipc,'inspiration:readSource',inspirationArgs.readSource,i=>library.readSource(i))
  registerValidatedIpc(ipc,'inspiration:readEvidence',inspirationArgs.readEvidence,i=>library.readEvidence(i))
  registerValidatedIpc(ipc,'inspiration:readCard',inspirationArgs.readCard,i=>library.readCard(i))
  registerValidatedIpc(ipc,'inspiration:extract',inspirationArgs.extract,i=>library.extract(i))
  registerValidatedIpc(ipc,'inspiration:getJob',inspirationArgs.getJob,i=>library.getJob(i))
  registerValidatedIpc(ipc,'inspiration:listJobs',inspirationArgs.listJobs,()=>library.listJobs())
  registerValidatedIpc(ipc,'inspiration:stop',inspirationArgs.stop,i=>library.stop(i))
  registerValidatedIpc(ipc,'inspiration:resume',inspirationArgs.resume,i=>library.resume(i))
  registerValidatedIpc(ipc,'inspiration:prepareSelection',inspirationArgs.prepareSelection,i=>selection.prepare(i))
  registerValidatedIpc(ipc,'inspiration:commitSelection',inspirationArgs.commitSelection,i=>selection.commit(i))
  registerValidatedIpc(ipc,'inspiration:videoPreview',inspirationArgs.videoPreview,i=>video.start(i))
  registerValidatedIpc(ipc,'inspiration:listVideoJobs',inspirationArgs.listVideoJobs,()=>video.list())
  registerValidatedIpc(ipc,'inspiration:cancelVideoPreparation',inspirationArgs.cancelVideoPreparation,()=>video.cancelPreparation())
  registerValidatedIpc(ipc,'inspiration:videoJob',inspirationArgs.videoJob,i=>video.get(i))
  registerValidatedIpc(ipc,'inspiration:stopVideo',inspirationArgs.stopVideo,i=>video.stop(i))
  registerValidatedIpc(ipc,'inspiration:capabilities',inspirationArgs.capabilities,()=>video.capabilities())
  registerValidatedIpc(ipc,'inspiration:prepareVideoRuntime',inspirationArgs.prepareVideoRuntime,()=>video.prepare())
}
