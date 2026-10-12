// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createLibraryWorkflowActions(ports) {
  async function refreshWorkflow(existingRequest = null) {
    const refreshGeneration = ++ports.workspaceRefreshGeneration
    if (!ports.current.value) {
      ports.workflowStatus.value = null
      ports.consistencyOverview.value = null
      ports.chapterDerivatives.value = null
      ports.contextFactPack.value = null
      ports.factBatches.value = []
      ports.contextFactPackKey = ''
      ports.outlinePlanning.value = {
        totalRevision: 0,
        totalOutlineExists: false,
        externalChangeDetected: false,
        assignedEventIds: [],
        unplacedEventIds: [],
        volumes: [],
        chapterPlacements: [],
        eventChapterPlacements: []
      }
      return
    }
    const request = existingRequest || ports.workspaceRequests.capture(ports.current.value)
    const requestedChapterId = ports.selectedId.value
    const requestedContent = ports.chapterContent.value
    const requestedTitle = ports.chapterTitle.value
    const unchangedManuscript = () => ports.chapterContent.value === requestedContent && ports.chapterTitle.value === requestedTitle
    if (ports.chapterOrderIssue.value) {
      ports.workflowStatus.value = {
        creationPath: ports.foundation.value.creationPath,
        completed: 0,
        total: 6,
        currentStep: 'chapterPlan',
        steps: [
          {
            id: 'definition',
            label: '定书',
            target: 'profile',
            state: 'blocked',
            detail: '章序未知，暂不建立创作投影',
            missing: ['章节顺序账本待核对']
          },
          {
            id: 'materials',
            label: '素材',
            target: 'research',
            state: 'blocked',
            detail: '正文文件仍可逐份查看',
            missing: ['章节顺序账本待核对']
          },
          {
            id: 'foundation',
            label: '设定',
            target: 'world',
            state: 'blocked',
            detail: '章序恢复前不参与正文生成',
            missing: ['章节顺序账本待核对']
          },
          {
            id: 'events',
            label: '纪事',
            target: 'timeline',
            state: 'blocked',
            detail: '章序恢复前不建立章节契约',
            missing: ['章节顺序账本待核对']
          },
          {
            id: 'outline',
            label: '总纲',
            target: 'outline',
            state: 'blocked',
            detail: '原文可读，版本投影暂停',
            missing: ['章节顺序账本待核对']
          },
          {
            id: 'chapterPlan',
            label: '章纲',
            target: 'outline',
            state: 'current',
            detail: '章节叙事顺序未知，AI 与改写均已暂停',
            missing: ['章节顺序账本待核对']
          }
        ],
        readyForChapterOutline: false,
        readyForProse: false,
        missingForChapterOutline: ['章节顺序账本待核对'],
        missingForProse: ['章节顺序账本待核对']
      }
      ports.consistencyOverview.value = null
      ports.chapterDerivatives.value = null
      ports.contextFactPack.value = null
      ports.factBatches.value = []
      ports.contextFactPackKey = ''
      ports.outlinePlanning.value = {
        totalRevision: 0,
        totalOutlineExists: Boolean(ports.totalOutline.value.trim()),
        externalChangeDetected: false,
        assignedEventIds: [],
        unplacedEventIds: [],
        volumes: [],
        chapterPlacements: [],
        eventChapterPlacements: []
      }
      ports.planningSkeletonStatus.value = { exists: false, stale: true, chapterCount: 0, volumeCount: 0 }
      ports.planningDetailStatuses.value = []
      return
    }
    if (ports.outlinePlanningIssue.value) {
      const priorSteps = [
        {
          id: 'definition',
          label: '定书',
          target: 'profile',
          complete: Boolean(ports.bookProfile.value.genre?.trim() && ports.bookProfile.value.coreIdea?.trim())
        },
        {
          id: 'materials',
          label: '素材',
          target: 'research',
          complete: Boolean(ports.foundation.value.sourceNotes?.trim() || ports.sourceCards.value.length)
        },
        {
          id: 'foundation',
          label: '设定',
          target: 'world',
          complete: Boolean(ports.foundation.value.worldView?.trim())
        },
        {
          id: 'events',
          label: '纪事',
          target: 'timeline',
          complete: Boolean(
            !ports.researchEventsIssue.value && (ports.canonicalEvents.value.length || ports.timeline.value.length)
          )
        }
      ]
      const completed = priorSteps.filter((step) => step.complete).length
      ports.workflowStatus.value = {
        creationPath: ports.foundation.value.creationPath,
        completed,
        total: 6,
        currentStep: 'outline',
        steps: [
          ...priorSteps.map(({ complete, ...step }) => ({
            ...step,
            state: complete ? 'complete' : 'blocked',
            detail: complete ? '已有可读取内容' : '尚未完成',
            missing: complete ? [] : [step.label]
          })),
          {
            id: 'outline',
            label: '总纲',
            target: 'outline',
            state: 'current',
            detail: '大纲版本账本待人工核对；正文与大纲原文没有被覆盖',
            missing: ['大纲版本账本待核对']
          },
          {
            id: 'chapterPlan',
            label: '章纲',
            target: 'outline',
            state: 'blocked',
            detail: '恢复版本账本前不能确认章节契约',
            missing: ['大纲版本账本待核对']
          }
        ],
        readyForChapterOutline: false,
        readyForProse: false,
        missingForChapterOutline: ['大纲版本账本待核对'],
        missingForProse: ['大纲版本账本待核对']
      }
      ports.consistencyOverview.value = null
      ports.chapterDerivatives.value = null
      ports.contextFactPack.value = null
      ports.factBatches.value = []
      ports.contextFactPackKey = ''
      ports.outlinePlanning.value = {
        totalRevision: 0,
        totalOutlineExists: Boolean(ports.totalOutline.value.trim()),
        externalChangeDetected: false,
        assignedEventIds: [],
        unplacedEventIds: [],
        volumes: [],
        chapterPlacements: [],
        eventChapterPlacements: []
      }
      ports.planningSkeletonStatus.value = { exists: false, stale: true, chapterCount: 0, volumeCount: 0 }
      ports.planningDetailStatuses.value = []
      return
    }
    if (ports.characterStateIssue.value) {
      const [workflow, planning, skeleton, details] = await Promise.all([
        ports.desktop.workspace.getWorkflowStatus(requestedChapterId || undefined),
        ports.desktop.outlines.planningStatus(requestedChapterId || undefined),
        ports.planningDraft.value
          ? ports.desktop.planning.chapterSkeletonStatus(ports.planningDraft.value.id)
          : Promise.resolve({ exists: false, stale: false, chapterCount: 0, volumeCount: 0 }),
        ports.planningDraft.value
          ? ports.desktop.planning.chapterDetailStatuses(ports.planningDraft.value.id)
          : Promise.resolve([])
      ])
      if (
        !ports.workspaceRequests.isCurrent(request, ports.current.value) ||
        refreshGeneration !== ports.workspaceRefreshGeneration ||
        ports.selectedId.value !== requestedChapterId || !unchangedManuscript()
      )
        return
      ports.workflowStatus.value = {
        ...workflow,
        readyForProse: false,
        missingForProse: [...new Set([...(workflow.missingForProse || []), '人物状态账本待核对'])]
      }
      ports.outlinePlanning.value = planning
      ports.consistencyOverview.value = null
      ports.chapterDerivatives.value = null
      ports.contextFactPack.value = null
      ports.factBatches.value = []
      ports.contextFactPackKey = ''
      ports.planningSkeletonStatus.value = skeleton
      ports.planningDetailStatuses.value = details
      return
    }
    const [projection, skeleton, details, chapterFactBatches, chapterFactTasks] = await Promise.all([
      ports.desktop.workspace.getChapterProjection(requestedChapterId || undefined),
      ports.planningDraft.value
        ? ports.desktop.planning.chapterSkeletonStatus(ports.planningDraft.value.id)
        : Promise.resolve({ exists: false, stale: false, chapterCount: 0, volumeCount: 0 }),
      ports.planningDraft.value
        ? ports.desktop.planning.chapterDetailStatuses(ports.planningDraft.value.id)
        : Promise.resolve([]),
      // Fact review lives only in the formal SQLite ledger.  After a verified
      // rollback, do not keep issuing a request that is guaranteed to be
      // rejected; clear this SQLite-only pane with the storage-mode switch.
      requestedChapterId && ports.sqliteStorageStatus.value?.storageMode === 'sqlite'
        ? ports.desktop.workspace.listFactBatches(requestedChapterId).catch(() => [])
        : Promise.resolve([]),
      requestedChapterId && ports.sqliteStorageStatus.value?.storageMode === 'sqlite'
        ? ports.desktop.workspace.listFactExtractionJobs(requestedChapterId).catch(() => [])
        : Promise.resolve([])
    ])
    if (
      !ports.workspaceRequests.isCurrent(request, ports.current.value) ||
      refreshGeneration !== ports.workspaceRefreshGeneration ||
      ports.selectedId.value !== requestedChapterId || !unchangedManuscript()
    )
      return
    const { workflow, planning, consistency } = projection
    ports.workflowStatus.value = workflow
    ports.outlinePlanning.value = planning
    ports.consistencyOverview.value = consistency
    ports.chapterDerivatives.value = projection.derivatives || null
    ports.findingHistory.value = projection.findingHistory || null
    ports.factBatches.value = chapterFactBatches
    if (!ports.factExtractionBusy.value) {
      const recoverableFactTask = chapterFactTasks.find(
        (task) => task.status === 'failed' || task.status === 'interrupted'
      )
      ports.factExtractionRetryId.value = recoverableFactTask?.id || ''
      ports.factExtractionRawResult.value = recoverableFactTask?.rawResult || ''
    }
    ports.planningSkeletonStatus.value = skeleton
    ports.planningDetailStatuses.value = details
    const nextFactPackKey = JSON.stringify([
      ports.current.value.path,
      ports.selectedId.value || 0,
      ports.chapterOutline.value,
      planning.totalRevision,
      planning.chapterPlacements,
      planning.eventChapterPlacements,
      consistency
    ])
    if (
      ports.assistantAvailable.value &&
      ports.assistantOpen.value &&
      ports.selectedId.value &&
      !ports.researchSourcesIssue.value &&
      !ports.researchEventsIssue.value &&
      !ports.characterStateIssue.value &&
      nextFactPackKey !== ports.contextFactPackKey
    ) {
      const factPack = await ports.desktop.workspace.getContextFactPack(requestedChapterId)
      if (
        ports.workspaceRequests.isCurrent(request, ports.current.value) &&
        refreshGeneration === ports.workspaceRefreshGeneration &&
        ports.selectedId.value === requestedChapterId && unchangedManuscript()
      ) {
        ports.contextFactPack.value = factPack
        ports.contextFactPackKey = nextFactPackKey
      }
    }
  }

  return { refreshWorkflow }
}
