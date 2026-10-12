import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import type { LocalModelsApi, LocalModelView } from '../../../../contracts/models/local-model-contracts'
export function useLocalModels(api: LocalModelsApi) {
  const models = ref<LocalModelView[]>([]), loading = ref(false), starting = ref(''), error = ref('')
  const actionError = ref(''), stopping = ref(false)
  // Retain only a stop handle across read failures, never stale readiness/progress.
  const activeOperation = ref<Pick<LocalModelView, 'id' | 'name' | 'operation'> & { operationId: string }>()
  const checking = computed(() => starting.value || activeOperation.value?.id || '')
  type Inspection = { id: string; operationId?: string; cancelledId?: string; settled: boolean }
  let disposed = false, epoch = 0, operationRevision = 0, timer: ReturnType<typeof setTimeout> | undefined, ownedInspection: Inspection | undefined
  let pendingStop: { id: string; operationId: string } | undefined
  function updateActiveOperation(model?: LocalModelView) {
    const next = model?.operationId ? { id: model.id, name: model.name, operation: model.operation, operationId: model.operationId } : undefined
    if (activeOperation.value?.id !== next?.id || activeOperation.value?.operationId !== next?.operationId) operationRevision++
    activeOperation.value = next
    // A confirmed terminal/successor releases only the old operation's stop UI.
    if (pendingStop && (pendingStop.id !== next?.id || pendingStop.operationId !== next?.operationId)) {
      pendingStop = undefined; stopping.value = false
    }
  }
  function actionMessage(cause: unknown, fallback: string) {
    // The named preload API rejects with validated, structured-cloneable error DTOs.
    return cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
      && 'message' in cause && typeof cause.message === 'string' && cause.message.trim() && cause.message.length <= 500 ? cause.message : fallback
  }
  function cancelInspection(inspection: Inspection) {
    if (inspection.settled || !inspection.operationId || inspection.cancelledId === inspection.operationId) return
    inspection.cancelledId = inspection.operationId
    void api.cancel(inspection.id, inspection.operationId).catch(() => {})
  }
  function observeInspection(rows: LocalModelView[], inspection?: Inspection) {
    if (!inspection || inspection.settled) return
    const row = rows.find(m => m.id === inspection.id && m.operation === 'inspect' && m.operationId)
    if (row && (!inspection.operationId || inspection.operationId === row.operationId)) inspection.operationId = row.operationId
    if (disposed) cancelInspection(inspection)
  }
  async function refresh() {
    if (disposed) return
    const current = ++epoch, inspection = ownedInspection
    try {
      const rows = await api.list()
      observeInspection(rows, inspection)
      if (!disposed && current === epoch) {
        models.value = rows; error.value = ''
        updateActiveOperation(rows.find(m => m.operationId))
      }
      return rows
    }
    catch { if (!disposed && current === epoch) { models.value = []; error.value = '模型超市暂时无法读取，请重试。' } }
  }
  async function inspect(id: string) {
    if (disposed || checking.value) return
    starting.value = id; actionError.value = ''
    const inspection: Inspection = { id, settled: false }
    ownedInspection = inspection
    try {
      const pending = api.inspect(id)
      void refresh()
      // Attach the rejection handler immediately; a slow status read must not
      // leave an already-rejected inspection promise unhandled.
      await pending
    } catch (cause) { if (!disposed) actionError.value = actionMessage(cause, '模型检测未完成，请重试。') }
    finally {
      inspection.settled = true
      if (ownedInspection === inspection) ownedInspection = undefined
      if (!disposed) starting.value = ''
    }
    await refresh()
  }
  async function install(id: string) {
    if (disposed || checking.value) return
    starting.value = id; actionError.value = ''
    const revision = operationRevision
    try {
      const acknowledged = await api.install(id)
      // The start receipt can supply a stop ID even if listing immediately fails.
      // Never resurrect an operation already observed to finish or be superseded.
      if (!disposed && revision === operationRevision && acknowledged.id === id && acknowledged.operation === 'install' && acknowledged.operationId) updateActiveOperation(acknowledged)
    }
    catch (cause) { if (!disposed) actionError.value = actionMessage(cause, '未能启动安装，请重新读取后重试。'); return }
    finally { if (!disposed) starting.value = '' }
    // The command has acknowledged; an older read must not hold or clear a later start.
    await refresh()
  }
  async function cancel() {
    if (disposed || stopping.value) return
    const operation = activeOperation.value
    if (!operation || operation.id !== checking.value) return
    pendingStop = operation
    stopping.value = true; actionError.value = ''
    try {
      const accepted = await api.cancel(operation.id, operation.operationId)
      if (!disposed && !accepted && activeOperation.value?.id === operation.id && activeOperation.value.operationId === operation.operationId) updateActiveOperation()
    }
    catch (cause) { if (!disposed && pendingStop === operation) actionError.value = actionMessage(cause, '未能停止模型准备，请重试。') }
    finally {
      if (!disposed) {
        await refresh()
        if (!disposed && pendingStop === operation) { pendingStop = undefined; stopping.value = false }
      }
    }
  }
  function poll() {
    timer = setTimeout(async () => { await refresh(); if (!disposed) poll() }, 1000)
  }
  onMounted(async () => { loading.value = true; await refresh(); if (!disposed) { loading.value = false; poll() } })
  onBeforeUnmount(() => {
    disposed = true; epoch++; clearTimeout(timer)
    const inspection = ownedInspection
    if (!inspection) return
    if (inspection.operationId) cancelInspection(inspection)
    else void api.list().then(rows => observeInspection(rows, inspection)).catch(() => {})
  })
  return { models, loading, checking, stopping, activeOperation, error, actionError, refresh, inspect, install, cancel, dismissActionError: () => { actionError.value = '' } }
}
