// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createPlanningChapterOutlineActions(ports) {
  let savedInfoSequence = 0
  async function refreshPlannedChapterSavedInfo() {
    const saved = ports.plannedChapter.value
    if (!saved || !ports.current.value) return false
    const sequence = ++savedInfoSequence, generation = ports.plannedChapterGeneration
    const request = ports.workspaceRequests.capture(ports.current.value)
    try {
      const loaded = await ports.desktop.outlines.getPlannedChapter(saved.chapterId)
      if (sequence !== savedInfoSequence || generation !== ports.plannedChapterGeneration ||
        !ports.workspaceRequests.isCurrent(request, ports.current.value) ||
        ports.plannedChapter.value?.chapterId !== saved.chapterId || ports.plannedChapter.value.revision !== saved.revision ||
        loaded.chapterId !== saved.chapterId || loaded.revision !== saved.revision || loaded.title !== saved.title || loaded.content !== saved.content) return false
      // Only enrich the acknowledged baseline; author input is independent.
      ports.plannedChapter.value = loaded
      ports.standaloneOutlineEntries.value = ports.standaloneOutlineEntries.value.map(entry =>
        entry.chapterId === loaded.chapterId ? { ...entry, volume: loaded.volume, stage: loaded.stage, hasManuscript: loaded.hasManuscript, mirrorStatus: loaded.mirrorStatus } : entry)
      return true
    } catch {
      // An unknown file status stays visible with a read-only retry. It does
      // not turn the confirmed content save into another write attempt.
      return false
    }
  }
  function resetPlannedChapter() {
    ports.outlineRecoveryDrafts.value = []
    ports.outlineRecoveryShelfError.value = ''
    ports.plannedOutlineRecovery.value = null
    ports.plannedOutlineRecoveryError.value = ''
    if (ports.outlineMode.value === 'plannedChapter') ports.outlineMode.value = 'total'
    ports.plannedChapterGeneration++
    ports.standaloneOutlineEntries.value = []
    ports.plannedChapter.value = null
    ports.plannedChapterTitle.value = ''
    ports.plannedChapterContent.value = ''
    ports.plannedChapterError.value = ''
    ports.plannedChapterBusy.value = false
    ports.plannedChapterStarting.value = false
    ports.plannedChapterComposing.value = false
  }

  async function refreshStandaloneOutlineCatalog() {
    if (!ports.current.value) return
    const request = ports.workspaceRequests.capture(ports.current.value)
    const listed = await ports.desktop.outlines.list()
    if (!ports.workspaceRequests.isCurrent(request, ports.current.value)) return
    ports.standaloneOutlineEntries.value = listed.chapterOutlines || []
    ports.stageOutlines.value = listed.stages || []
  }

  async function openPlannedChapter(id) {
    if (
      ports.active.value === 'outline' &&
      ports.outlineMode.value === 'plannedChapter' &&
      ports.plannedChapter.value?.chapterId === id
    ) {
      ports.invalidateOutlineRead()
      return true
    }
    return ports.runOutlineNavigation('章纲', async () => {
      const loaded = await ports.desktop.outlines.getPlannedChapter(id)
      if (loaded.hasManuscript) throw new Error('本章已有正文，请从已有章节打开。')
      return () => {
        ports.plannedChapterGeneration += 1
        ports.plannedChapter.value = loaded
        ports.plannedChapterTitle.value = loaded.title
        ports.plannedChapterContent.value = loaded.content
        loadPlannedOutlineRecovery(loaded)
        ports.plannedChapterError.value = ''
        ports.outlineInspectorOpen.value = false
        ports.outlineMode.value = 'plannedChapter'
      }
    })
  }

  async function flushPlannedChapterSave() {
    if (!ports.worldMapWorkspace.canLeave()) return false
    if (!ports.plannedChapter.value) return true
    if (ports.plannedOutlineRecovery.value) return true // Leaving keeps the unresolved recovery snapshot intact.
    if (ports.plannedChapterComposing.value || ports.plannedChapterBusy.value) {
      ports.notice('请完成当前输入或等待章纲保存后再继续。')
      return false
    }
    if (!ports.plannedChapterDirty.value) return true
    if (!ports.plannedChapterTitle.value.trim()) {
      ports.plannedChapterError.value = '请填写章名后保存。'
      return false
    }
    if (!ports.current.value) return false
    const request = ports.workspaceRequests.capture(ports.current.value)
    const generation = ports.plannedChapterGeneration
    const previousDocument = ports.plannedChapter.value
    const input = {
      chapterId: ports.plannedChapter.value.chapterId,
      title: ports.plannedChapterTitle.value,
      content: ports.plannedChapterContent.value,
      expectedRevision: ports.plannedChapter.value.revision
    }
    ports.plannedChapterBusy.value = true
    ports.plannedChapterError.value = ''
    let recoverySnapshot = null
    try {
      recoverySnapshot = ports.plannedOutlineRecoveryStore.read(ports.current.value.path, input.chapterId)
    } catch (error) {
      ports.plannedOutlineRecoveryError.value = error.message
    }
    try {
      const reviewed = await ports.outlineEditor?.value?.saveReviewedDraft?.(input)
      const saved = reviewed ? { ...previousDocument, title: reviewed.snapshot.title, content: reviewed.snapshot.content,
        revision: reviewed.snapshot.revision, mirrorStatus: undefined } : await ports.desktop.outlines.updatePlannedChapter(input)
      if (
        generation !== ports.plannedChapterGeneration ||
        !ports.workspaceRequests.isCurrent(request, ports.current.value)
      )
        return false
      ports.plannedChapter.value = saved
      if (recoverySnapshot) {
        try {
          ports.plannedOutlineRecoveryStore.clearIfSnapshotMatches(recoverySnapshot)
        } catch (error) {
          ports.plannedOutlineRecoveryError.value = error.message
        }
      }
      if (ports.plannedChapterTitle.value === input.title) ports.plannedChapterTitle.value = saved.title
      // Keep edits typed while the earlier snapshot was saving; only advance the saved baseline.
      ports.standaloneOutlineEntries.value = ports.standaloneOutlineEntries.value.map((entry) =>
        entry.chapterId === saved.chapterId
          ? { ...entry, title: saved.title, revision: saved.revision, mirrorStatus: saved.mirrorStatus }
          : entry
      )
      if (reviewed) void refreshPlannedChapterSavedInfo()
      if (ports.plannedChapterDirty.value) {
        ports.notice('章纲还有新修改，请再次保存后继续。')
        return false
      }
      return true
    } catch (error) {
      if (
        generation === ports.plannedChapterGeneration &&
        ports.workspaceRequests.isCurrent(request, ports.current.value)
      )
        ports.plannedChapterError.value = error?.message || '保存失败，修改仍保留在编辑器中。'
      return false
    } finally {
      if (generation === ports.plannedChapterGeneration && ports.workspaceRequests.isCurrent(request, ports.current.value)) ports.plannedChapterBusy.value = false
    }
  }

  async function startPlannedChapter() {
    if (ports.plannedOutlineRecovery.value) return ports.notice('请先决定如何处理章纲恢复稿。')
    if (
      !(await flushPlannedChapterSave()) ||
      !(await ports.flushChapterSaveSafely()) ||
      !ports.plannedChapter.value ||
      !ports.current.value
    )
      return
    if (
      !window.confirm(
        `根据“${ports.plannedChapter.value.title}”开始写正文？将创建同一章节的空白正文，保留章纲与归属，不自动生成或确认内容。`
      )
    )
      return
    const request = ports.workspaceRequests.capture(ports.current.value)
    const generation = ports.plannedChapterGeneration
    const input = {
      chapterId: ports.plannedChapter.value.chapterId,
      expectedRevision: ports.plannedChapter.value.revision
    }
    const savedOutline = ports.plannedChapter.value
    ports.plannedChapterBusy.value = true
    ports.plannedChapterStarting.value = true
    ports.plannedChapterError.value = ''
    try {
      const result = await ports.desktop.outlines.startPlannedChapter(input)
      const written = await ports.desktop.chapters.list()
      if (
        generation !== ports.plannedChapterGeneration ||
        !ports.workspaceRequests.isCurrent(request, ports.current.value)
      )
        return
      const target = written.find((chapter) => chapter.id === input.chapterId)
      if (!target) throw new Error('正文已交接，但目录尚未刷新，请重试。')
      ports.plannedChapter.value = null
      ports.plannedChapterTitle.value = ''
      ports.plannedChapterContent.value = ''
      ports.chapters.value = written
      await ports.selectChapter(target, request)
      if (
        generation !== ports.plannedChapterGeneration ||
        !ports.workspaceRequests.isCurrent(request, ports.current.value)
      )
        return
      ports.outlineMode.value = 'chapter'
      ports.active.value = 'desk'
      ports.notice(
        result.mirrorPending ? '正文已就绪，可读文件待同步；章纲与归属已保留。' : '已进入正文编辑，章纲与归属已保留。'
      )
    } catch (error) {
      if (
        generation === ports.plannedChapterGeneration &&
        ports.workspaceRequests.isCurrent(request, ports.current.value)
      ) {
        ports.plannedChapterError.value = error?.message || '交接未完成，请重试“开始写正文”，不会覆盖已有正文。'
        if (!ports.plannedChapter.value) {
          ports.plannedChapter.value = savedOutline
          ports.plannedChapterTitle.value = savedOutline.title
          ports.plannedChapterContent.value = savedOutline.content
          ports.outlineMode.value = 'plannedChapter'
        }
        ports.notice(ports.plannedChapterError.value)
      }
    } finally {
      if (generation === ports.plannedChapterGeneration) {
        ports.plannedChapterBusy.value = false
        ports.plannedChapterStarting.value = false
      }
    }
  }

  async function reloadPlannedChapter(checkSavedOnly = false) {
    if (checkSavedOnly === true) return refreshPlannedChapterSavedInfo()
    if (
      !ports.plannedChapter.value ||
      ports.plannedChapterBusy.value ||
      ports.plannedChapterComposing.value ||
      !ports.current.value
    )
      return
    if (
      ports.plannedChapterDirty.value &&
      !window.confirm('重新读取会放弃这份章纲尚未保存的修改。需要保留的内容请先复制。确认重新读取吗？')
    )
      return
    const generation = ports.plannedChapterGeneration
    const request = ports.workspaceRequests.capture(ports.current.value)
    ports.plannedChapterBusy.value = true
    try {
      const loaded = await ports.desktop.outlines.getPlannedChapter(ports.plannedChapter.value.chapterId)
      if (
        generation !== ports.plannedChapterGeneration ||
        !ports.workspaceRequests.isCurrent(request, ports.current.value)
      )
        return
      if (loaded.hasManuscript) {
        const written = await ports.desktop.chapters.list()
        if (
          generation !== ports.plannedChapterGeneration ||
          !ports.workspaceRequests.isCurrent(request, ports.current.value)
        )
          return
        const target = written.find((chapter) => chapter.id === loaded.chapterId)
        if (!target) {
          ports.plannedChapterError.value = '正文目录正在变化，请稍后重新读取。'
          return
        }
        // The author explicitly accepted reloading/discarding above; hand off to the existing chapter flow.
        ports.plannedChapter.value = null
        ports.plannedChapterTitle.value = ''
        ports.plannedChapterContent.value = ''
        ports.chapters.value = written
        await ports.selectChapter(target)
        if (ports.workspaceRequests.isCurrent(request, ports.current.value)) ports.outlineMode.value = 'chapter'
        return
      }
      ports.plannedChapter.value = loaded
      ports.plannedChapterTitle.value = loaded.title
      ports.plannedChapterContent.value = loaded.content
      ports.plannedChapterError.value = ''
    } catch (error) {
      if (
        generation === ports.plannedChapterGeneration &&
        ports.workspaceRequests.isCurrent(request, ports.current.value)
      )
        ports.plannedChapterError.value = error?.message || '读取失败，本地修改保持不变。'
    } finally {
      if (generation === ports.plannedChapterGeneration) ports.plannedChapterBusy.value = false
    }
  }

  async function openTotalOutline() {
    if (ports.active.value === 'outline' && ports.outlineMode.value === 'total') {
      ports.invalidateOutlineRead()
      return true
    }
    return ports.runOutlineNavigation('全书总纲', async () => () => {
      ports.outlineMode.value = 'total'
    })
  }

  function loadPlannedOutlineRecovery(loaded) {
    ports.plannedOutlineRecovery.value = null
    ports.plannedOutlineRecoveryError.value = ''
    try {
      const draft = ports.plannedOutlineRecoveryStore.read(ports.current.value.path, loaded.chapterId)
      if (!draft) return
      if (draft.title === loaded.title && draft.content === loaded.content)
        ports.plannedOutlineRecoveryStore.clearIfSnapshotMatches(draft)
      else ports.plannedOutlineRecovery.value = draft
    } catch (error) {
      ports.plannedOutlineRecoveryError.value = error.message
    }
  }

  function refreshOutlineRecoveryShelf() {
    ports.outlineRecoveryDrafts.value = []
    ports.outlineRecoveryShelfError.value = ''
    if (!ports.current.value) return
    try {
      ports.outlineRecoveryDrafts.value = ports.plannedOutlineRecoveryStore.list(ports.current.value.path)
    } catch (error) {
      ports.outlineRecoveryShelfError.value = error.message
    }
  }

  async function openOutlineRecoveryShelf() {
    return ports.runOutlineNavigation('恢复稿', async () => () => {
      refreshOutlineRecoveryShelf()
      ports.outlineMode.value = 'recovery'
      ports.outlineInspectorOpen.value = false
    })
  }

  async function openShelfOutline(draft) {
    if (!ports.current.value || draft.workItemId !== ports.current.value.path) return
    const request = ports.workspaceRequests.capture(ports.current.value)
    try {
      const loaded = await ports.desktop.outlines.getPlannedChapter(draft.chapterId)
      if (!ports.workspaceRequests.isCurrent(request, ports.current.value)) return
      if (loaded.hasManuscript) {
        const written = await ports.desktop.chapters.list()
        if (!ports.workspaceRequests.isCurrent(request, ports.current.value)) return
        const target = written.find((chapter) => chapter.id === draft.chapterId)
        if (!target) throw new Error('正文目录正在变化，恢复稿仍保留，请稍后重试。')
        ports.plannedChapter.value = null
        ports.plannedChapterTitle.value = ''
        ports.plannedChapterContent.value = ''
        ports.plannedOutlineRecovery.value = null
        ports.chapters.value = written
        await ports.selectChapter(target, request)
        if (!ports.workspaceRequests.isCurrent(request, ports.current.value)) return
        ports.outlineMode.value = 'chapter'
        ports.notice('已打开现有章纲，恢复稿仍保留在“章纲恢复稿”中，可复制后手动核对。')
        return
      }
      await openPlannedChapter(draft.chapterId)
    } catch (error) {
      if (ports.workspaceRequests.isCurrent(request, ports.current.value))
        ports.notice(
          error?.code === 'NOT_FOUND'
            ? '原章纲已不在当前目录。恢复全文仍可复制，不会自动重建章节。'
            : error?.message || '暂时无法打开章纲，恢复全文仍保留。'
        )
    }
  }

  function discardShelfRecovery(draft) {
    if (
      !ports.current.value ||
      draft.workItemId !== ports.current.value.path ||
      !window.confirm('确认丢弃这份章纲恢复稿？正式稿件保持不变。')
    )
      return
    try {
      if (!ports.plannedOutlineRecoveryStore.clearIfSnapshotMatches(draft))
        throw new Error('恢复稿已经变化，请刷新后重新核对。')
      if (ports.plannedOutlineRecovery.value?.chapterId === draft.chapterId) ports.plannedOutlineRecovery.value = null
      refreshOutlineRecoveryShelf()
    } catch (error) {
      ports.outlineRecoveryShelfError.value = error.message
    }
  }

  async function restorePlannedOutlineRecovery() {
    const draft = ports.plannedOutlineRecovery.value
    if (!draft || ports.plannedChapterBusy.value || !ports.current.value) return
    const request = ports.workspaceRequests.capture(ports.current.value)
    const generation = ports.plannedChapterGeneration
    ports.plannedChapterBusy.value = true
    try {
      const latest = await ports.desktop.outlines.getPlannedChapter(draft.chapterId)
      if (
        generation !== ports.plannedChapterGeneration ||
        !ports.workspaceRequests.isCurrent(request, ports.current.value)
      )
        return
      if (latest.hasManuscript) {
        ports.plannedOutlineRecoveryError.value = '对应正文已建立，请先复制恢复内容，再从现有章节处理章纲。'
        return
      }
      if (latest.revision !== ports.plannedChapter.value.revision) {
        ports.plannedChapter.value = latest
        ports.plannedChapterTitle.value = latest.title
        ports.plannedChapterContent.value = latest.content
        ports.plannedOutlineRecoveryError.value = '正式章纲刚刚发生变化，请重新对比后再恢复。'
        return
      }
      if (
        draft.baseRevision !== latest.revision &&
        !window.confirm(
          '正式章纲已不同于恢复稿的原始版本。已对比两份内容，确认使用恢复稿继续编辑吗？保存时会产生新版本。'
        )
      )
        return
      ports.plannedChapterTitle.value = draft.title
      ports.plannedChapterContent.value = draft.content
      ports.plannedOutlineRecovery.value = null
      ports.plannedOutlineRecoveryError.value = ''
      ports.notice('恢复稿已放回编辑器，尚未覆盖正式章纲。')
    } catch (error) {
      if (generation === ports.plannedChapterGeneration) ports.plannedOutlineRecoveryError.value = error.message
    } finally {
      if (generation === ports.plannedChapterGeneration) ports.plannedChapterBusy.value = false
    }
  }

  function discardPlannedOutlineRecovery() {
    const draft = ports.plannedOutlineRecovery.value
    if (!draft || ports.plannedChapterBusy.value || !window.confirm('确认丢弃这份章纲恢复稿？正式章纲保持不变。'))
      return
    try {
      if (!ports.plannedOutlineRecoveryStore.clearIfSnapshotMatches(draft))
        throw new Error('恢复稿已经变化，请重新打开章纲后处理。')
      ports.plannedOutlineRecovery.value = null
      ports.plannedOutlineRecoveryError.value = ''
    } catch (error) {
      ports.plannedOutlineRecoveryError.value = error.message
    }
  }

  return {
    resetPlannedChapter,
    refreshStandaloneOutlineCatalog,
    openPlannedChapter,
    flushPlannedChapterSave,
    startPlannedChapter,
    reloadPlannedChapter,
    openTotalOutline,
    loadPlannedOutlineRecovery,
    refreshOutlineRecoveryShelf,
    openOutlineRecoveryShelf,
    openShelfOutline,
    discardShelfRecovery,
    restorePlannedOutlineRecovery,
    discardPlannedOutlineRecovery
  }
}
