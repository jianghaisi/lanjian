import { parseTimelineCandidates, timelineEventTitle } from '../timeline-workbench'
import { activeEventRows, archivedEventRows, candidateEventRows, eventContentFromRow, eventRowChanged } from '../event-projection-view'
import { clearEventEditSession, readEventEditSession, writeEventEditSession } from '../event-edit-session'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createTimelineEditingActions(ports) {
  function timelineEntryId(kind, id) {
    return `${kind}:${id}`
  }

  function isTimelineEntryOpen(kind, id) {
    return ports.expandedTimelineEntry.value === timelineEntryId(kind, id)
  }

  function toggleTimelineEntry(kind, id) {
    const key = timelineEntryId(kind, id)
    ports.expandedTimelineEntry.value = ports.expandedTimelineEntry.value === key ? '' : key
  }

  function addTimeline() {
    if (ports.unifiedEventMode.value) {
      const event = { id: crypto.randomUUID(), title: '', time: '', characters: '', location: '', event: '', result: '',
        evidenceRefs: [], confidence: 1, granularity: 'macro', _new: true }
      ports.unifiedEvents.value.push(event)
      ports.expandedTimelineEntry.value = timelineEntryId('formal', event.id)
      persistUnifiedDraft()
      return
    }
    const event = { id: crypto.randomUUID(), title: '', time: '', characters: '', location: '', event: '', result: '' }
    ports.timeline.value.push(event)
    ports.expandedTimelineEntry.value = timelineEntryId('direct', event.id)
  }

  function updateChronicleField(kind, id, field, value) {
    if (!['title', 'time', 'characters', 'location', 'event', 'result'].includes(field)) return
    const collection = kind === 'formal' && ports.unifiedEventMode.value
      ? ports.unifiedEvents.value
      : kind === 'direct' ? ports.timeline.value : kind === 'candidate' ? ports.timelineAiCandidates.value : []
    const item = collection.find((entry) => entry.id === id)
    if (item) {
      item[field] = value
      if (kind === 'formal') persistUnifiedDraft()
    }
  }

  function removeTimelineEvent(kind, index) {
    const collection = kind === 'formal' && ports.unifiedEventMode.value ? ports.unifiedEvents.value : ports.timeline.value
    const [removed] = collection.splice(index, 1)
    if (removed && isTimelineEntryOpen(kind, removed.id)) ports.expandedTimelineEntry.value = ''
    if (kind === 'formal') persistUnifiedDraft()
  }

  function moveTimelineEvent(kind, id, direction) {
    const collection = kind === 'formal' && ports.unifiedEventMode.value ? ports.unifiedEvents.value : ports.timeline.value
    const index = collection.findIndex((item) => item.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= collection.length) return
    const [event] = collection.splice(index, 1)
    collection.splice(target, 0, event)
    if (kind === 'formal') persistUnifiedDraft()
  }

  async function generateTimelineCandidates() {
    const request = ports.workspaceRequests.capture(ports.current.value)
    ports.timelineAiGenerating.value = true
    const existing = [...ports.approvedEvents.value, ...ports.timeline.value]
      .map((item) => `${item.time}｜${timelineEventTitle(item.event, item.title)}`)
      .join('\n')
      .slice(0, 6_000)
    const context = {
      title: ports.current.value?.title || ports.current.value?.name || '',
      genre: ports.bookProfile.value.genre || '',
      subgenre: ports.bookProfile.value.subgenre || '',
      coreIdea: ports.bookProfile.value.coreIdea || '',
      plannedVolumes: Number.isSafeInteger(ports.bookProfile.value.plannedVolumes) ? ports.bookProfile.value.plannedVolumes : 0,
      chaptersPerVolume: Number.isSafeInteger(ports.bookProfile.value.chaptersPerVolume) ? ports.bookProfile.value.chaptersPerVolume : 0,
      targetWordsPerChapter: Number.isSafeInteger(ports.bookProfile.value.targetWordsPerChapter) ? ports.bookProfile.value.targetWordsPerChapter : 0,
      materials: ports.foundation.value.sourceNotes.slice(0, 6_000),
      worldView: ports.foundation.value.worldView.slice(0, 6_000),
      totalOutline: ports.totalOutline.value.slice(0, 12_000),
      existingEvents: existing
    }
    try {
      if (ports.unifiedEventMode.value) {
        const result = await ports.guard(() => ports.desktop.events.generateModelCandidates(ports.plainDto({
          operationId: crypto.randomUUID(), context
        })), 'AI 事件候选已生成并保留模型产物；逐条采用前不会进入正式时间线')
        if (!result || !ports.workspaceRequests.isCurrent(request, ports.current.value)) return
        ports.timelineAiCandidates.value = result.candidates.map(item => ({ ...item,
          _modelCandidate: { taskId: result.taskId, artifactId: result.artifactId, artifactHash: result.artifactHash,
            candidateIndex: item.candidateIndex } }))
      } else {
        const result = await ports.guard(
          () => ports.desktop.ai.complete(JSON.stringify(context), '', 'outline', undefined, 'timeline'),
          'AI 事件候选已生成；逐条采用前不会进入正式时间线'
        )
        if (!result || !ports.workspaceRequests.isCurrent(request, ports.current.value)) return
        ports.timelineAiCandidates.value = parseTimelineCandidates(result.content).map((item) => ({
          id: crypto.randomUUID(),
          ...item
        }))
      }
      ports.expandedTimelineEntry.value = ports.timelineAiCandidates.value[0]
        ? timelineEntryId('candidate', ports.timelineAiCandidates.value[0].id)
        : ''
    } catch {
      // guard has already reported the actionable model or parsing error.
    } finally {
      if (ports.workspaceRequests.isCurrent(request, ports.current.value)) ports.timelineAiGenerating.value = false
    }
  }

  async function adoptTimelineCandidate(candidate) {
    if (ports.unifiedEventMode.value) {
      if ((!candidate._unifiedCandidate && !candidate._modelCandidate) || ports.busy.value) {
        ports.notice('这条候选没有可核对的主进程来源，请重新生成或从事件提炼中选择。')
        return
      }
      if (hasUnifiedDrafts()) {
        ports.notice('请先保存当前事件编辑，再采用候选。')
        return
      }
      let projection = ports.eventProjection.value
      const request = ports.workspaceRequests.capture(ports.current.value)
      const transientCandidateId = candidate.id
      if (candidate._modelCandidate) {
        const created = await ports.guard(() => commitUnifiedOperation(null, null, () => ports.desktop.events.previewModelCandidate(
          ports.plainDto({ expectedOrderId: projection.state.order.id, taskId: candidate._modelCandidate.taskId,
            artifactId: candidate._modelCandidate.artifactId, candidateIndex: candidate._modelCandidate.candidateIndex })
        )))
        if (!created || !ports.workspaceRequests.isCurrent(request, ports.current.value)) return
        projection = created.projection
        applyProjection(projection)
        clearEventEditSession(projection.workItemId)
        ports.timelineAiCandidates.value = ports.timelineAiCandidates.value.filter(item => item.id !== transientCandidateId)
        if (isTimelineEntryOpen('candidate', transientCandidateId)) ports.expandedTimelineEntry.value = ''
        const stored = projection.candidates.find(item => item.eventId === created.receipt.eventId)
        const lifecycle = projection.state.lifecycles.find(item => item.eventId === created.receipt.eventId)
        if (!stored || !lifecycle) {
          ports.notice('模型候选已经保存，请到事件提炼中继续确认。')
          return
        }
        candidate = { ...candidate, id: stored.eventId, versionId: stored.versionId, lifecycleId: lifecycle.id, _unifiedCandidate: true }
      }
      const result = await commitImmediateUnifiedOperation({ kind: 'adopt', expectedOrderId: projection.state.order.id,
        eventId: candidate.id, expectedVersionId: candidate.versionId, expectedLifecycleId: candidate.lifecycleId })
      if (!result || !ports.workspaceRequests.isCurrent(request, ports.current.value)) return
      applyProjection(result.projection)
      clearEventEditSession(result.projection.workItemId)
      ports.timelineAiCandidates.value = ports.timelineAiCandidates.value.filter(item => item.id !== transientCandidateId)
      ports.expandedTimelineEntry.value = timelineEntryId('formal', candidate.id)
      ports.notice('候选已采用为统一正式事件，模型产物、候选版本和批准版本均已保留')
      return
    }
    const event = {
      id: crypto.randomUUID(),
      title: candidate.title,
      time: candidate.time,
      characters: candidate.characters,
      location: candidate.location,
      event: candidate.event,
      result: candidate.result
    }
    ports.timeline.value.push(event)
    ports.timelineAiCandidates.value = ports.timelineAiCandidates.value.filter((item) => item.id !== candidate.id)
    ports.expandedTimelineEntry.value = timelineEntryId('direct', event.id)
    ports.notice('候选已放入作者时间线；保存后才会进入写作上下文')
  }

  function discardTimelineCandidate(id) {
    ports.timelineAiCandidates.value = ports.timelineAiCandidates.value.filter((item) => item.id !== id)
    if (isTimelineEntryOpen('candidate', id)) ports.expandedTimelineEntry.value = ''
  }

  function reviewCanonicalEvents() {
    ports.active.value = 'research'
    ports.materialSection.value = 'events'
  }

  async function saveTimeline() {
    if (!ports.current.value || ports.busy.value) return
    if (ports.unifiedEventMode.value) return saveUnifiedEvents()
    const request = ports.workspaceRequests.capture(ports.current.value)
    const submitted = ports.plainDto(ports.timeline.value)
    const result = await ports.guard(() => ports.desktop.workspace.saveTimeline(submitted))
    if (!ports.workspaceRequests.isCurrent(request, ports.current.value)) return
    const unchanged = JSON.stringify(ports.timeline.value) === JSON.stringify(submitted)
    if (unchanged) ports.timeline.value = result.events
    ports.notice(unchanged ? '时间线已保存' : '本次提交已保存；保存期间的新修改仍保留，请再次保存。')
    await ports.refreshWorkflow()
  }

  function persistUnifiedDraft(pending = null) {
    const projection = ports.eventProjection.value
    if (!projection) return
    writeEventEditSession(projection.workItemId, projection.revision, ports.unifiedEvents.value, pending)
  }

  function applyProjection(projection, rows = activeEventRows(projection)) {
    ports.eventProjection.value = projection
    ports.unifiedEvents.value = rows
    ports.archivedUnifiedEvents.value = archivedEventRows(projection)
    ports.unifiedEventCandidates.value = candidateEventRows(projection)
  }

  function validateUnifiedRows(rows) {
    return rows.every((row) => {
      const content = eventContentFromRow(row)
      return content.time && content.characters.length && content.location && content.event
    })
  }

  function hasUnifiedDrafts() {
    return ports.unifiedEvents.value.some(eventRowChanged)
      || ports.unifiedEvents.value.map((item) => item.id).join('\n')
        !== ports.eventProjection.value?.approved.map((item) => item.eventId).join('\n')
  }

  async function waitForOperationCommit(commit, timeoutMs) {
    let timeoutId
    const outcome = Promise.resolve(commit).then(
      (value) => ({ status: 'fulfilled', value }),
      (error) => ({ status: 'rejected', error })
    )
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs)
    })
    const result = await Promise.race([outcome, timeout])
    clearTimeout(timeoutId)
    return result
  }

  function assertMatchingOperationReceipt(receipt, preview) {
    if (receipt?.operationId !== preview.operationId || receipt.requestHash !== preview.requestHash)
      throw new Error('事件操作回执与本次预览不一致。')
  }

  function projectionIncludesOperation(projection, receipt) {
    if (receipt.orderId && projection.state.order.id !== receipt.orderId) return false
    const lifecycle = receipt.eventId
      ? projection.state.lifecycles.find((item) => item.eventId === receipt.eventId)
      : null
    if (receipt.lifecycleId && lifecycle?.id !== receipt.lifecycleId) return false
    if (receipt.kind === 'archive' && lifecycle?.state !== 'archived') return false
    if (receipt.kind === 'restore' && lifecycle?.state !== 'active') return false
    if (receipt.versionId) {
      const visibleVersions = [
        ...projection.approved,
        ...projection.candidates,
        ...projection.archived.flatMap((item) => [item.approved, item.candidate].filter(Boolean))
      ]
      if (!visibleVersions.some((item) => item.eventId === receipt.eventId && item.versionId === receipt.versionId)) return false
    }
    return true
  }

  async function readCommittedProjection(receipt) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const projection = await ports.desktop.events.projection()
      if (projection.workItemId !== ports.eventProjection.value?.workItemId) throw new Error('作品已切换。')
      if (projectionIncludesOperation(projection, receipt)) return projection
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('事件已经提交，但当前投影尚未刷新。操作编号已保留，重新打开本书后可继续核对。')
  }

  async function commitUnifiedOperation(input, pending, previewOperation) {
    const preview = previewOperation
      ? await previewOperation()
      : await ports.desktop.events.previewOperation(ports.plainDto(input))
    persistUnifiedDraft({ operationId: preview.operationId, kind: preview.kind, tempId: pending?.tempId || null })
    const commit = ports.desktop.events.commitOperation(preview.token)
    const response = await waitForOperationCommit(commit, ports.eventOperationResponseTimeoutMs ?? 3_000)
    if (response.status === 'rejected') throw response.error
    const receipt = response.status === 'fulfilled'
      ? response.value.receipt
      : await ports.desktop.events.operationReceipt(preview.operationId)
    if (!receipt) throw new Error('事件操作仍在处理中。操作编号已保留，重新打开本书后可继续核对。')
    assertMatchingOperationReceipt(receipt, preview)
    const projection = await readCommittedProjection(receipt)
    return { projection, receipt }
  }

  async function commitImmediateUnifiedOperation(input) {
    try {
      return await ports.guard(() => commitUnifiedOperation(input, null))
    } catch (error) {
      const workItemId = ports.eventProjection.value?.workItemId
      const pending = workItemId ? readEventEditSession(workItemId)?.pending : null
      if (!pending?.operationId) throw error
      const receipt = await ports.desktop.events.operationReceipt(pending.operationId).catch(() => null)
      if (!receipt) throw error
      return { receipt, projection: await ports.desktop.events.projection() }
    }
  }

  async function saveUnifiedEvents() {
    const request = ports.workspaceRequests.capture(ports.current.value)
    const submitted = ports.plainDto(ports.unifiedEvents.value)
    if (!validateUnifiedRows(submitted)) {
      ports.notice('请先补齐每个事件的时间、人物、地点和事件经过。')
      return
    }
    const result = await ports.guard(async () => {
      let projection = ports.eventProjection.value
      const desiredIds = []
      let changed = false
      for (const row of submitted) {
        if (row._new) {
          const committed = await commitUnifiedOperation({ kind: 'create', expectedOrderId: projection.state.order.id,
            content: eventContentFromRow(row), granularity: row.granularity || 'macro' }, { tempId: row.id })
          projection = committed.projection
          desiredIds.push(committed.receipt.eventId)
          changed = true
        } else {
          desiredIds.push(row.id)
          if (!eventRowChanged(row)) continue
          const committed = await commitUnifiedOperation({ kind: 'edit', expectedOrderId: projection.state.order.id,
            eventId: row.id, expectedVersionId: row.versionId, expectedLifecycleId: row.lifecycleId,
            content: eventContentFromRow(row), granularity: row.granularity }, null)
          projection = committed.projection
          changed = true
        }
      }
      const active = new Set(desiredIds)
      const completeOrder = [...desiredIds, ...projection.state.order.eventIds.filter((id) => !active.has(id))]
      if (completeOrder.some((id, index) => projection.state.order.eventIds[index] !== id)) {
        projection = (await commitUnifiedOperation({ kind: 'reorder', expectedOrderId: projection.state.order.id,
          eventIds: completeOrder }, null)).projection
        changed = true
      }
      return { projection, changed, submitted }
    })
    if (!result || !ports.workspaceRequests.isCurrent(request, ports.current.value)) return
    const unchangedDuringSave = JSON.stringify(ports.unifiedEvents.value) === JSON.stringify(result.submitted)
    if (unchangedDuringSave) {
      applyProjection(result.projection)
      clearEventEditSession(result.projection.workItemId)
    } else {
      applyProjection(result.projection, ports.unifiedEvents.value)
      persistUnifiedDraft()
    }
    ports.notice(result.changed ? '统一事件版本与顺序已保存' : '事件没有需要保存的变化')
    await ports.refreshWorkflow()
  }

  async function archiveTimelineEvent(id) {
    const row = ports.unifiedEvents.value.find((item) => item.id === id)
    const projection = ports.eventProjection.value
    if (!row || !projection || row._new || ports.busy.value) return
    if (hasUnifiedDrafts()) {
      ports.notice('请先保存当前事件编辑，再归档事件。')
      return
    }
    if (!window.confirm(`归档“${timelineEventTitle(row.event, row.title)}”？历史版本会保留，也可以恢复。`)) return
    const result = await commitImmediateUnifiedOperation({ kind: 'archive', expectedOrderId: projection.state.order.id,
      eventId: row.id, expectedVersionId: row.versionId, expectedLifecycleId: row.lifecycleId })
    if (!result) return
    applyProjection(result.projection)
    clearEventEditSession(result.projection.workItemId)
    ports.expandedTimelineEntry.value = ''
    ports.notice('事件已归档，版本历史仍然保留')
  }

  async function restoreTimelineEvent(id) {
    const row = ports.archivedUnifiedEvents.value.find((item) => item.id === id)
    const projection = ports.eventProjection.value
    if (!row || !projection || ports.busy.value) return
    if (hasUnifiedDrafts()) {
      ports.notice('请先保存当前事件编辑，再恢复归档事件。')
      return
    }
    const result = await commitImmediateUnifiedOperation({ kind: 'restore', expectedOrderId: projection.state.order.id,
      eventId: row.id, expectedVersionId: row.versionId, expectedLifecycleId: row.lifecycleId })
    if (!result) return
    applyProjection(result.projection)
    clearEventEditSession(result.projection.workItemId)
    ports.expandedTimelineEntry.value = timelineEntryId('formal', id)
    ports.notice('事件已恢复到纪事顺序')
  }

  async function recoverEventOperation(request) {
    const projection = ports.eventProjection.value
    if (!projection) return
    const session = readEventEditSession(projection.workItemId)
    if (!session) return
    if (!ports.workspaceRequests.isCurrent(request, ports.current.value)) return
    if (!session.pending && session.baseRevision !== projection.revision) {
      clearEventEditSession(projection.workItemId)
      ports.notice('事件版本已变化，旧的未保存编辑没有自动套用，请重新核对。')
      return
    }
    let currentProjection = projection
    let pending = session.pending
    let committedEventId = null
    if (pending) {
      const receipt = await ports.desktop.events.operationReceipt(pending.operationId)
      if (!ports.workspaceRequests.isCurrent(request, ports.current.value)) return
      if (receipt) {
        committedEventId = receipt.eventId
        currentProjection = await ports.desktop.events.projection()
      }
      pending = null
    }
    const fresh = activeEventRows(currentProjection)
    const freshById = new Map(fresh.map((row) => [row.id, row]))
    const mappedId = session.pending?.tempId && committedEventId
    const restored = session.rows.flatMap((draft) => {
      const id = draft.id === session.pending?.tempId && mappedId ? mappedId : draft.id
      const base = freshById.get(id)
      if (base) return [{ ...draft, ...base, title: draft.title, time: draft.time, characters: draft.characters,
        location: draft.location, event: draft.event, result: draft.result }]
      return draft._new && draft.id !== session.pending?.tempId ? [draft] : []
    })
    for (const row of fresh) if (!restored.some((item) => item.id === row.id)) restored.push(row)
    applyProjection(currentProjection, restored)
    writeEventEditSession(currentProjection.workItemId, currentProjection.revision, restored, pending)
    ports.notice(session.pending ? '已核对上次事件操作回执，并恢复未保存的编辑' : '已恢复本书未保存的事件编辑')
  }

  async function createEventCandidate() {
    const input = {
      ...ports.eventDraft.value,
      characters: ports.eventDraft.value.characters
        .split(/[、,，]/)
        .map((item) => item.trim())
        .filter(Boolean)
    }
    if (ports.unifiedEventMode.value) {
      if (ports.busy.value) return
      if (hasUnifiedDrafts()) {
        ports.notice('请先保存当前事件编辑，再建立资料候选。')
        return
      }
      const projection = ports.eventProjection.value
      const request = ports.workspaceRequests.capture(ports.current.value)
      const result = await ports.guard(async () => {
        const committed = await commitUnifiedOperation(null, null, () => ports.desktop.events.previewMaterialCandidate(
          ports.plainDto({ expectedOrderId: projection.state.order.id, ...input })
        ))
        const listed = await ports.desktop.research.listEvents()
        return { ...committed, events: listed.events }
      }, '事件候选已建立，确认前不会进入作品事实')
      if (!result || !ports.workspaceRequests.isCurrent(request, ports.current.value)) return
      applyProjection(result.projection)
      clearEventEditSession(result.projection.workItemId)
      ports.canonicalEvents.value = result.events
      ports.eventDraft.value = { sourceId: '', time: '', characters: '', location: '', event: '', result: '' }
      return
    }
    const created = await ports.guard(() => ports.desktop.research.createEventCandidate(ports.plainDto(input)),
      '事件候选已建立，确认前不会进入作品事实')
    if (!created) return
    ports.canonicalEvents.value = [created, ...ports.canonicalEvents.value]
    ports.eventDraft.value = { sourceId: '', time: '', characters: '', location: '', event: '', result: '' }
  }

  async function approveCanonicalEvent(id) {
    if (ports.unifiedEventMode.value) {
      if (ports.busy.value) return
      if (hasUnifiedDrafts()) {
        ports.notice('请先保存当前事件编辑，再确认资料候选。')
        return
      }
      const projection = ports.eventProjection.value
      const candidate = projection?.candidates.find(item => item.eventId === id)
      const lifecycle = projection?.state.lifecycles.find(item => item.eventId === id)
      if (!candidate || !lifecycle) {
        ports.notice('候选版本已经变化，请重新打开事件提炼。')
        return
      }
      const request = ports.workspaceRequests.capture(ports.current.value)
      const result = await commitImmediateUnifiedOperation({ kind: 'adopt', expectedOrderId: projection.state.order.id,
        eventId: id, expectedVersionId: candidate.versionId, expectedLifecycleId: lifecycle.id })
      if (!result || !ports.workspaceRequests.isCurrent(request, ports.current.value)) return
      applyProjection(result.projection)
      clearEventEditSession(result.projection.workItemId)
      ports.canonicalEvents.value = (await ports.desktop.research.listEvents()).events
      ports.notice('候选已确认进入统一事件，资料来源与版本历史均已保留')
      return
    }
    const approved = await ports.guard(() => ports.desktop.research.approveEvent(id), '事件已确认进入本书事件库')
    if (!approved) return
    const index = ports.canonicalEvents.value.findIndex((item) => item.id === id)
    if (index >= 0) ports.canonicalEvents.value.splice(index, 1, approved)
  }

  return {
    timelineEntryId,
    isTimelineEntryOpen,
    toggleTimelineEntry,
    addTimeline,
    updateChronicleField,
    removeTimelineEvent,
    moveTimelineEvent,
    generateTimelineCandidates,
    adoptTimelineCandidate,
    discardTimelineCandidate,
    reviewCanonicalEvents,
    saveTimeline,
    createEventCandidate,
    approveCanonicalEvent,
    archiveTimelineEvent,
    restoreTimelineEvent,
    recoverEventOperation
  }
}
