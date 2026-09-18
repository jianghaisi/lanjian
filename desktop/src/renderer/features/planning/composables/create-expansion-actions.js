import { nextTick } from 'vue'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createPlanningExpansionActions(ports) {
  function closeOutlineExpansion() {
    ports.expansionGeneration++
    if (ports.expansionTimer) window.clearTimeout(ports.expansionTimer)
    ports.expansionTimer = null
    ports.expansionOpen.value = false
    ports.expansionSource.value = null
    ports.expansionTasks.value = []
    ports.expansionLoading.value = false
    ports.expansionBusy.value = false
    ports.expansionError.value = ''
    ports.expansionPreview.value = null
    ports.expansionNotice.value = ''
  }

  async function openOutlineExpansion() {
    if (ports.expansionOpen.value) return closeOutlineExpansion()
    if (ports.planningOutlineDirty.value) return ports.notice('请先保存当前大纲，再基于这个版本拆解。')
    if (!ports.expansionParentKey.value) return
    closeOutlineExpansion()
    ports.expansionOpen.value = true
    ports.outlineInspectorOpen.value = false
    await refreshOutlineExpansions()
    await nextTick()
    if (ports.expansionOpen.value) document.querySelector('[data-testid="outline-expansion-count"]')?.focus()
  }

  async function refreshOutlineExpansions() {
    if (!ports.expansionOpen.value || !ports.current.value || !ports.expansionParentKey.value) return
    if (ports.expansionTimer) window.clearTimeout(ports.expansionTimer)
    const generation = ports.expansionGeneration
    const request = ports.workspaceRequests.capture(ports.current.value)
    const key = ports.expansionParentKey.value
    ports.expansionLoading.value = true
    ports.expansionPreview.value = null
    try {
      const [source, tasks] = await Promise.all([
        ports.desktop.workspace.getPlanningOutline(key),
        ports.desktop.workspace.listOutlineExpansions()
      ])
      if (generation !== ports.expansionGeneration || !ports.workspaceRequests.isCurrent(request, ports.current.value))
        return
      ports.expansionSource.value = source
      await ports.refreshStandaloneOutlineCatalog()
      if (generation !== ports.expansionGeneration || !ports.workspaceRequests.isCurrent(request, ports.current.value))
        return
      ports.expansionTasks.value = tasks.filter((task) => task.request.parentKey === key)
      ports.expansionError.value = source ? '' : '请先保存非空的父级大纲，再拆解下一层。'
      if (
        ports.expansionTasks.value.some((task) => ['queued', 'preparing', 'running', 'streaming'].includes(task.status))
      )
        ports.expansionTimer = window.setTimeout(refreshOutlineExpansions, 1200)
    } catch (error) {
      if (generation === ports.expansionGeneration && ports.workspaceRequests.isCurrent(request, ports.current.value))
        ports.expansionError.value = error?.message || '读取候选失败，请重试。'
    } finally {
      if (generation === ports.expansionGeneration) ports.expansionLoading.value = false
    }
  }

  async function runOutlineExpansion(input, cancelId = null) {
    if (!ports.expansionSource.value || ports.expansionBusy.value || !ports.current.value) return
    const generation = ports.expansionGeneration
    const request = ports.workspaceRequests.capture(ports.current.value)
    ports.expansionBusy.value = true
    ports.expansionError.value = ''
    ports.expansionPreview.value = null
    ports.expansionNotice.value = ''
    try {
      if (cancelId) await ports.desktop.workspace.cancelOutlineExpansion(cancelId)
      else
        await ports.desktop.workspace.startOutlineExpansion({
          operationId: crypto.randomUUID(),
          parentKey: ports.expansionSource.value.key,
          expectedRevision: ports.expansionSource.value.revision,
          count: input.count,
          instruction: input.instruction
        })
      if (generation === ports.expansionGeneration && ports.workspaceRequests.isCurrent(request, ports.current.value))
        await refreshOutlineExpansions()
    } catch (error) {
      if (generation === ports.expansionGeneration && ports.workspaceRequests.isCurrent(request, ports.current.value))
        ports.expansionError.value = error?.message || '生成未能开始，请重试。'
    } finally {
      if (generation === ports.expansionGeneration) ports.expansionBusy.value = false
    }
  }

  async function retryOutlineExpansion(id) {
    if (ports.expansionBusy.value || !ports.current.value) return
    const generation = ports.expansionGeneration
    const request = ports.workspaceRequests.capture(ports.current.value)
    ports.expansionBusy.value = true
    ports.expansionError.value = ''
    ports.expansionPreview.value = null
    ports.expansionNotice.value = ''
    try {
      await ports.desktop.workspace.retryOutlineExpansion(id, crypto.randomUUID())
      if (generation === ports.expansionGeneration && ports.workspaceRequests.isCurrent(request, ports.current.value))
        await refreshOutlineExpansions()
    } catch (error) {
      if (generation === ports.expansionGeneration && ports.workspaceRequests.isCurrent(request, ports.current.value))
        ports.expansionError.value = error?.message || '候选未能重新生成，请重试。'
    } finally {
      if (generation === ports.expansionGeneration) ports.expansionBusy.value = false
    }
  }

  async function previewOutlineExpansionAdoption(id) {
    if (ports.expansionBusy.value || !ports.current.value || !ports.expansionOpen.value) return
    if (ports.planningOutlineDirty.value) return ports.notice('请先保存父级大纲，再预览采用。')
    const generation = ports.expansionGeneration
    const request = ports.workspaceRequests.capture(ports.current.value)
    ports.expansionBusy.value = true
    ports.expansionPreview.value = null
    ports.expansionError.value = ''
    ports.expansionNotice.value = ''
    try {
      const preview = await ports.desktop.workspace.previewOutlineExpansionAdoption(id)
      if (generation !== ports.expansionGeneration || !ports.workspaceRequests.isCurrent(request, ports.current.value))
        return
      ports.expansionPreview.value = preview
      await nextTick()
      document.querySelector('[data-testid="outline-expansion-adoption-preview"]')?.focus()
    } catch (error) {
      if (generation === ports.expansionGeneration && ports.workspaceRequests.isCurrent(request, ports.current.value))
        ports.expansionError.value = error?.message || '无法预览，请重新读取候选。'
    } finally {
      if (generation === ports.expansionGeneration) ports.expansionBusy.value = false
    }
  }

  async function reloadOutlineExpansionView() {
    if (ports.expansionBusy.value || !ports.current.value || !ports.expansionOpen.value) return
    const generation = ports.expansionGeneration
    const request = ports.workspaceRequests.capture(ports.current.value)
    ports.expansionBusy.value = true
    ports.expansionPreview.value = null
    try {
      const listed = await ports.desktop.outlines.list()
      if (generation !== ports.expansionGeneration || !ports.workspaceRequests.isCurrent(request, ports.current.value))
        return
      ports.stageOutlines.value = listed.stages || []
      await ports.refreshWorkflow(request)
      if (generation === ports.expansionGeneration && ports.workspaceRequests.isCurrent(request, ports.current.value))
        await refreshOutlineExpansions()
    } catch (error) {
      if (generation === ports.expansionGeneration && ports.workspaceRequests.isCurrent(request, ports.current.value))
        ports.expansionError.value = error?.message || '读取目录失败，请重试。'
    } finally {
      if (generation === ports.expansionGeneration) ports.expansionBusy.value = false
    }
  }

  async function adoptOutlineExpansion() {
    if (!ports.expansionPreview.value || ports.expansionBusy.value || !ports.current.value) return
    if (ports.planningOutlineDirty.value) {
      ports.expansionPreview.value = null
      return ports.notice('父级有未保存修改，请保存后重新预览。')
    }
    const generation = ports.expansionGeneration
    const request = ports.workspaceRequests.capture(ports.current.value)
    const token = ports.expansionPreview.value.token
    ports.expansionBusy.value = true
    ports.expansionError.value = ''
    let committed = false
    try {
      const result = await ports.desktop.workspace.adoptOutlineExpansion(token)
      committed = true
      if (generation !== ports.expansionGeneration || !ports.workspaceRequests.isCurrent(request, ports.current.value))
        return
      ports.expansionPreview.value = null
      ports.expansionNotice.value = `已新增 ${result.keys.length} 项正式大纲，待复核。${result.mirrorPending ? '可读文件待同步，可在设置的项目数据中重试。' : '可读文件已同步。'}正文保持不变。`
      const listed = await ports.desktop.outlines.list()
      if (generation !== ports.expansionGeneration || !ports.workspaceRequests.isCurrent(request, ports.current.value))
        return
      ports.stageOutlines.value = listed.stages || []
      await ports.refreshWorkflow(request)
      if (generation === ports.expansionGeneration && ports.workspaceRequests.isCurrent(request, ports.current.value)) {
        await refreshOutlineExpansions()
        await nextTick()
        if (generation === ports.expansionGeneration)
          document.querySelector('[data-testid="outline-expansion-notice"]')?.focus()
      }
    } catch (error) {
      if (generation === ports.expansionGeneration && ports.workspaceRequests.isCurrent(request, ports.current.value)) {
        ports.expansionPreview.value = null
        ports.expansionError.value = committed
          ? '大纲已保存，但目录刷新未完成。请重新读取，不要重复采用。'
          : error?.message || '未能确认采用，请重新预览。'
      }
    } finally {
      if (generation === ports.expansionGeneration) ports.expansionBusy.value = false
    }
  }

  return {
    closeOutlineExpansion,
    openOutlineExpansion,
    refreshOutlineExpansions,
    runOutlineExpansion,
    retryOutlineExpansion,
    previewOutlineExpansionAdoption,
    reloadOutlineExpansionView,
    adoptOutlineExpansion
  }
}
