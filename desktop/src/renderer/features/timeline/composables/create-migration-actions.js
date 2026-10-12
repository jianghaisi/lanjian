import { activeEventRows, archivedEventRows, candidateEventRows } from '../event-projection-view'

async function collectPages(desktop, previewId, kind) {
  const items = []
  let offset = 0
  do {
    const page = await desktop.events.migrationPage({ previewId, kind, offset })
    items.push(...page.items)
    offset = page.nextOffset
  } while (offset !== null)
  return items
}

export function createEventMigrationActions(ports) {
  function closeEventMigration() {
    const previewId = ports.eventMigrationState.value?.preview.previewId
    ports.eventMigrationState.value = null
    ports.eventMigrationError.value = ''
    if (previewId) void ports.desktop.events.cancelMigration(previewId).catch(() => undefined)
  }

  async function openEventMigration() {
    if (ports.eventMigrationBusy.value || ports.unifiedEventMode.value) return
    ports.eventMigrationBusy.value = true
    ports.eventMigrationError.value = ''
    try {
      const preview = await ports.desktop.events.previewMigration()
      const [rows, groups, findings] = await Promise.all([
        collectPages(ports.desktop, preview.previewId, 'rows'),
        collectPages(ports.desktop, preview.previewId, 'groups'),
        collectPages(ports.desktop, preview.previewId, 'planning-findings')
      ])
      ports.eventMigrationState.value = {
        kind: 'migration',
        preview,
        rows,
        groups,
        findings,
        page: 0,
        decisions: rows.map((row) => ({ rowIndex: row.index, disposition: row.defaultDisposition })),
        acknowledgedGroups: [],
        acknowledgedPlanningFindings: [],
        acknowledgedMirrors: []
      }
    } catch (error) {
      if (error?.code === 'FEATURE_UNAVAILABLE') {
        try {
          const preview = await ports.desktop.events.previewStateInitialization()
          ports.eventMigrationState.value = { kind: 'state-initialization', preview }
          return
        } catch (recoveryError) {
          if (recoveryError?.code === 'DATABASE_INTEGRITY_FAILED') throw recoveryError
          /* retain the migration error when this is not an early migrated book */
        }
      }
      ports.eventMigrationError.value = error?.message || '统一事件迁移预览暂时无法读取。'
    } finally {
      ports.eventMigrationBusy.value = false
    }
  }

  function toggleMigrationAcknowledgement(collection, value, checked) {
    const state = ports.eventMigrationState.value
    if (!state || !['acknowledgedGroups', 'acknowledgedPlanningFindings', 'acknowledgedMirrors'].includes(collection)) return
    const current = new Set(state[collection])
    if (checked) current.add(value)
    else current.delete(value)
    state[collection] = [...current]
  }

  function migrationReady(state) {
    if (state?.kind === 'state-initialization') return true
    if (!state || state.preview.summary.blockedRowCount || state.preview.summary.blockingGroupCount
      || state.preview.summary.blockedReferenceCount || state.preview.summary.planningBlockingCount) return false
    if (state.decisions.some((item) => item.disposition === null)) return false
    const groupIds = state.groups.filter((item) => item.severity === 'review').map((item) => item.id)
    const findingIds = state.findings.flatMap((item, index) => item.severity === 'review' ? [index] : [])
    return groupIds.every((id) => state.acknowledgedGroups.includes(id))
      && findingIds.every((id) => state.acknowledgedPlanningFindings.includes(id))
      && state.preview.requiredMirrorAcknowledgements.every((kind) => state.acknowledgedMirrors.includes(kind))
  }

  function activateProjection(projection) {
    ports.eventProjection.value = projection
    ports.unifiedEvents.value = activeEventRows(projection)
    ports.archivedUnifiedEvents.value = archivedEventRows(projection)
    ports.unifiedEventCandidates.value = candidateEventRows(projection)
    ports.timeline.value = []
    ports.eventMigrationState.value = null
  }

  async function commitEventMigration() {
    const state = ports.eventMigrationState.value
    if (!migrationReady(state) || ports.eventMigrationBusy.value) return
    const request = ports.workspaceRequests.capture(ports.current.value)
    ports.eventMigrationBusy.value = true
    ports.eventMigrationError.value = ''
    try {
      if (state.kind === 'state-initialization') {
        try {
          await ports.desktop.events.commitStateInitialization(state.preview.token)
        } catch (error) {
          // The transaction may have committed before its response was lost.
          // A verified projection is the only accepted recovery signal.
          const recovered = await ports.desktop.events.projection().catch(() => null)
          if (!recovered || recovered.workItemId !== request.workItemId) throw error
          if (!ports.workspaceRequests.isCurrent(request, ports.current.value)) return
          activateProjection(recovered)
          ports.notice('事件顺序与归档状态已恢复')
          await ports.refreshWorkflow()
          return
        }
        if (!ports.workspaceRequests.isCurrent(request, ports.current.value)) return
        const projection = await ports.desktop.events.projection()
        if (!ports.workspaceRequests.isCurrent(request, ports.current.value) || projection.workItemId !== request.workItemId) return
        activateProjection(projection)
        ports.notice('事件顺序与归档状态已恢复')
        await ports.refreshWorkflow()
        return
      }
      const grant = await ports.desktop.events.reviewMigration({
        previewId: state.preview.previewId,
        fingerprint: state.preview.fingerprint,
        rows: state.decisions.map((item) => ({ rowIndex: item.rowIndex, disposition: item.disposition,
          ...(item.targetRowIndex !== undefined ? { targetRowIndex: item.targetRowIndex } : {}) })),
        acknowledgedGroups: [...state.acknowledgedGroups],
        acknowledgedPlanningFindings: [...state.acknowledgedPlanningFindings],
        acknowledgedMirrors: [...state.acknowledgedMirrors]
      })
      let committed
      try {
        committed = await ports.desktop.events.commitMigration(grant.token)
      } catch (error) {
        const receipt = await ports.desktop.events.migrationReceipt(grant.operationId).catch(() => null)
        if (!receipt) throw error
      }
      if (!ports.workspaceRequests.isCurrent(request, ports.current.value)) return
      const projection = await ports.desktop.events.projection()
      if (!ports.workspaceRequests.isCurrent(request, ports.current.value) || projection.workItemId !== request.workItemId) return
      activateProjection(projection)
      ports.notice(committed?.mirror?.status === 'synced'
        ? '统一事件迁移已完成，纪事已切换到版本化事件'
        : '统一事件迁移已完成；可读镜像稍后重试，不影响正式版本')
      await ports.refreshWorkflow()
    } catch (error) {
      ports.eventMigrationError.value = error?.message || '统一事件迁移没有完成；旧数据保持不变。'
    } finally {
      ports.eventMigrationBusy.value = false
    }
  }

  async function retryEventMirror() {
    const projection = ports.eventProjection.value
    if (!projection || ports.eventMigrationBusy.value) return
    ports.eventMigrationBusy.value = true
    ports.eventMigrationError.value = ''
    try {
      await ports.desktop.events.retryMirror(projection.operationId)
      const refreshed = await ports.desktop.events.projection()
      activateProjection(refreshed)
      ports.notice(refreshed.mirror?.status === 'synced' ? '事件可读镜像已同步' : '镜像仍需稍后重试')
    } catch (error) {
      ports.eventMigrationError.value = error?.message || '事件镜像暂时无法重试。'
    } finally { ports.eventMigrationBusy.value = false }
  }

  return { openEventMigration, closeEventMigration, toggleMigrationAcknowledgement, migrationReady,
    commitEventMigration, retryEventMirror }
}
