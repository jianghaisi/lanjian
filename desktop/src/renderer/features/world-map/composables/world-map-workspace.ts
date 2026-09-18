import { ref } from 'vue'
import type { DesktopApi } from '../../../../contracts/index'
import type { WorldMapDocument, WorldMapImageCandidate, WorldMapStylePreset, WorldMapView } from '../../../../contracts/world-map/world-map'
import type { WorkspaceIdentity, WorkspaceRequestGuard } from '../../../../contracts/library/workspace-request-guard'

/** Map requests never own chapter text or infer formal events from renderer drafts. */
export function createWorldMapWorkspace(
  api: Pick<DesktopApi['workspace'], 'getWorldMap' | 'saveWorldMap'> & Partial<Pick<DesktopApi['workspace'], 'generateWorldMapImage' | 'cancelWorldMapImage' | 'adoptWorldMapImage' | 'getWorldMapBackground'>>,
  current: () => WorkspaceIdentity | null,
  requests: WorkspaceRequestGuard,
  notify: (message: string) => void
) {
  const view = ref<WorldMapView | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const dirty = ref(false)
  const error = ref('')
  const saveError = ref('')
  const background = ref<string | null>(null)
  const backgroundError = ref('')
  const candidate = ref<WorldMapImageCandidate | null>(null)
  const generating = ref(false)
  const adopting = ref(false)
  const generationError = ref('')
  let operationId = ''
  let generation = 0
  let readGeneration = 0

  // Read cancellation is local and never waits for IPC. Mutations have their
  // own ticket, so revisiting a page cannot strand a save/generation busy flag.
  function cancelRead() { readGeneration += 1; loading.value = false }

  function reset() {
    cancelRead()
    generation += 1
    view.value = null
    loading.value = false
    saving.value = false
    dirty.value = false
    error.value = ''
    saveError.value = ''
    background.value = null
    backgroundError.value = ''
    candidate.value = null
    generating.value = false
    adopting.value = false
    generationError.value = ''
    operationId = ''
  }

  function canLeave(): boolean {
    if (saving.value || generating.value || adopting.value || dirty.value) {
      notify(saving.value ? '地图定位正在保存，请稍候。' : generating.value ? '地图底图正在生成；可以先取消生成再离开。' : adopting.value ? '正在采用地图底图，请稍候。' : '地图定位尚未保存，请先保存，或取消本次调整后离开。')
      return false
    }
    return true
  }

  async function load(): Promise<void> {
    const identity = current()
    if (!identity || saving.value || generating.value || adopting.value) return
    const request = requests.capture(identity)
    const ticket = ++readGeneration
    const isCurrent = () => readGeneration === ticket && requests.isCurrent(request, current())
    loading.value = true
    error.value = ''
    try {
      const result = await api.getWorldMap()
      if (!isCurrent()) return
      if (result.workItemId !== request.workItemId) throw new Error('地图不属于当前作品，请重新读取。')
      view.value = result
      loading.value = false
      background.value = null
      backgroundError.value = ''
      if (result.document.version === 2 && result.document.background && api.getWorldMapBackground) {
        try {
          const asset = await api.getWorldMapBackground()
          if (!isCurrent()) return
          if (!asset || asset.workItemId !== request.workItemId || asset.assetId !== result.document.background.assetId) throw new Error('地图底图与当前作品不一致。')
          background.value = asset.dataUrl
        } catch { if (isCurrent()) backgroundError.value = '底图暂时无法读取，地点和事件仍可使用；可以重新生成。' }
      }
    } catch {
      if (!isCurrent()) return
      // Retain an existing local draft; an unreadable map is not an empty map.
      error.value = '地图读取失败，原有定位未被覆盖。请重试；仍失败时检查作品数据。'
    } finally {
      if (isCurrent()) loading.value = false
    }
  }

  async function generate(input: { connectionId: string; model: string; stylePreset: WorldMapStylePreset }): Promise<void> {
    const identity = current()
    if (!identity || !view.value || loading.value || saving.value || generating.value || adopting.value || dirty.value) return
    if (!api.generateWorldMapImage) { generationError.value = '当前版本未提供地图生图服务。'; return }
    cancelRead()
    const request = requests.capture(identity), baseline = view.value, ticket = ++generation
    const isCurrent = () => generation === ticket && requests.isCurrent(request, current())
    operationId = crypto.randomUUID(); generating.value = true; generationError.value = ''; candidate.value = null
    try {
      const result = await api.generateWorldMapImage({ ...input, operationId, workItemId: identity.id, expectedRevision: baseline.revision })
      if (!isCurrent()) return
      if (result.workItemId !== identity.id || result.expectedRevision !== baseline.revision) throw new Error('生成结果不属于当前地图。')
      candidate.value = result
    } catch (failure) {
      if (isCurrent()) generationError.value = failure instanceof Error && failure.message ? failure.message : '地图底图生成失败，请检查接口与模型后重试。'
    } finally {
      if (isCurrent()) { generating.value = false; operationId = '' }
    }
  }

  async function cancelGeneration(): Promise<void> {
    if (!operationId || !generating.value) return
    const id = operationId
    generation += 1; generating.value = false; operationId = ''; generationError.value = '已停止等待本次地图生成。'
    // Best effort remote cancellation; late completion cannot adopt or re-lock UI.
    void api.cancelWorldMapImage?.(id).catch(() => {})
  }

  async function adopt(): Promise<void> {
    const identity = current(), selected = candidate.value, baseline = view.value
    if (!identity || !selected || !baseline || loading.value || saving.value || adopting.value || generating.value || dirty.value) return
    if (!api.adoptWorldMapImage) { generationError.value = '当前版本未提供地图采用服务。'; return }
    cancelRead()
    const request = requests.capture(identity), ticket = ++generation
    const isCurrent = () => generation === ticket && requests.isCurrent(request, current())
    adopting.value = true; generationError.value = ''
    try {
      const result = await api.adoptWorldMapImage({ workItemId: identity.id, expectedRevision: baseline.revision, candidateId: selected.candidateId })
      if (!isCurrent()) return
      if (result.workItemId !== identity.id) throw new Error('采用回执不属于当前作品。')
      view.value = { ...baseline, ...result }
      background.value = selected.image.dataUrl
      candidate.value = null
      notify(result.mirrorStatus === 'conflict' || result.mirrorStatus === 'failed' ? '底图已采用；可读镜像仍需处理。' : '地图底图已采用。')
    } catch (failure) {
      if (isCurrent()) generationError.value = failure instanceof Error && failure.message ? failure.message : '底图未能采用，原地图仍然保留。'
    } finally { if (isCurrent()) adopting.value = false }
  }

  function discardCandidate() { candidate.value = null; generationError.value = '' }

  async function save(document: WorldMapDocument): Promise<void> {
    const identity = current()
    if (!identity || !view.value || saving.value || generating.value || adopting.value || loading.value || error.value) return
    cancelRead()
    const request = requests.capture(identity)
    const baseline = view.value
    const ticket = ++generation
    const isCurrent = () => generation === ticket && requests.isCurrent(request, current())
    saving.value = true
    saveError.value = ''
    try {
      const result = await api.saveWorldMap({ workItemId: identity.id, expectedRevision: baseline.revision, document })
      if (!isCurrent()) return
      if (result.workItemId !== identity.id) throw new Error('地图保存回执与作品不符。')
      // Only replace layout with its save receipt; retain the coherent event snapshot.
      view.value = { ...baseline, ...result }
      notify(result.mirrorStatus === 'conflict' || result.mirrorStatus === 'failed'
        ? '地图已存入数据库，可读 JSON 镜像需要在项目数据中处理。'
        : '地图定位已保存。')
      // The component compares the acknowledged document against its newest draft.
    } catch (failure) {
      if (!isCurrent()) return
      const conflict = typeof failure === 'object' && failure !== null && 'code' in failure && failure.code === 'CONFLICT'
      saveError.value = conflict
        ? '地图版本已变化，本次调整仍保留。请重新读取并核对后再保存。'
        : '地图定位未能保存，本次调整仍保留，请重试。'
    } finally {
      if (isCurrent()) saving.value = false
    }
  }

  return { view, loading, saving, dirty, error, saveError, background, backgroundError, candidate, generating, adopting, generationError,
    reset, canLeave, cancelRead, load, save, generate, cancelGeneration, adopt, discardCandidate }
}
