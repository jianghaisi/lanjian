import { nextTick, ref } from 'vue'
import { shouldApplyProjectLibraryRefresh } from '../services/project-library-refresh'
import { captureWorkspaceMemory, restoreWorkspaceMemory, compareWorkspaceMemory, cloneWorkspaceValue } from '../services/workspace-session-memory'

// Explicit live ports preserve the existing book/request scope and draft ownership.
export function createLibraryProjectsActions(ports) {
  const openBookTabs = ref([])
  const bookDraftConflicts = ref([])
  const bookViews = new Map()
  const loadedDrafts = new Map()
  const readyBooks = new Map()
  const encode = value => JSON.stringify(value ?? null)
  let tabTransition = false
  let openingTransition = null
  let importAfterCreation = false
  function invalidateWorkspaceSnapshot() {
    const view = bookViews.get(ports.current.value?.path)
    // A late warm-entry verification must not put pre-recovery issues back.
    // Leaving the book captures the current refs and author drafts afresh.
    if (view) view.workspace = null
  }
  function canRestoreMemory(project, preferredChapterId) {
    const snapshot = bookViews.get(project.path)?.workspace
    return Boolean(ports.sessionWorkspaceFields && snapshot?.id === project.id && snapshot.path === project.path
      && (!preferredChapterId || preferredChapterId === snapshot.fields.selectedId))
  }
  function rememberBookView() {
    const project = ports.current.value
    if (!project) return
    bookViews.set(project.path, {
      chapterId: ports.selectedId.value,
      active: ports.active.value,
      editor: ports.manuscriptEditor?.value?.viewSnapshot?.(),
      workspace: readyBooks.get(project.path) === project.id && ports.sessionWorkspaceFields
        ? captureWorkspaceMemory(project, ports.sessionWorkspaceFields, ports.lastSavedChapter, loadedDrafts.get(project.path)) : null,
      conflicts: cloneWorkspaceValue(bookDraftConflicts.value),
      drafts: Object.fromEntries(Object.entries(ports.sessionFields ?? {}).map(([key, field]) => [key,
        bookDraftConflicts.value.some(conflict => conflict.key === key) ? bookViews.get(project.path).drafts[key]
          : { value: encode(field.value), baseline: loadedDrafts.get(project.path)?.[key] }]))
    })
  }
  function resolveBookDraftConflict(key, restore) {
    const path = ports.current.value?.path, draft = bookViews.get(path)?.drafts[key], field = ports.sessionFields?.[key]
    if (!draft || !field || !bookDraftConflicts.value.some(item => item.key === key)) return
    if (restore) field.value = JSON.parse(draft.value)
    bookViews.get(path).drafts[key] = { value: encode(field.value), baseline: loadedDrafts.get(path)?.[key] }
    bookDraftConflicts.value = bookDraftConflicts.value.filter(item => item.key !== key)
  }
  async function selectBookTab(project) {
    if (tabTransition || ports.workspaceOpening.value || ports.current.value?.path === project.path) return
    await openProject(project, bookViews.get(project.path)?.chapterId)
  }
  async function closeBookTab(project) {
    if (tabTransition || ports.workspaceOpening.value) return
    if (ports.current.value?.path === project.path) {
      const other = openBookTabs.value.find(item => item.path !== project.path)
      if (other) await selectBookTab(other)
      else await closeProject()
      if (ports.current.value?.path === project.path) return
    }
    openBookTabs.value = openBookTabs.value.filter(item => item.path !== project.path)
    readyBooks.delete(project.path)
    if (bookViews.has(project.path)) bookViews.get(project.path).workspace = null
    // Closing a view does not discard its unsaved form inputs in this session.
  }
  async function openBackgroundTask(task) {
    const project = openBookTabs.value.find(item => item.path === task.bookPath) || ports.projects.value.find(item => item.path === task.bookPath)
    if (!project) return ports.notice('请从书架重新打开任务所属作品。')
    if (ports.current.value?.path !== project.path) await selectBookTab(project)
    if (ports.current.value?.path !== project.path) return
    if (task.chapterId) {
      await openLibraryChapter(project, task.chapterId)
      if (ports.current.value?.path === project.path) await ports.openTaskCenter?.()
    } else if (task.kind === '灵感生成') await ports.selectWorkspaceLeaf('ideas')
    else { ports.active.value = 'preparation'; if (ports.sessionFields?.preparationMode) ports.sessionFields.preparationMode.value = 'automatic' }
  }
  async function refreshProjects(options = {}) {
    if (!ports.desktop) return
    const requestGeneration = ++ports.projectLibraryRefreshGeneration
    const result = await ports.desktop.projects.list()
    if (
      !shouldApplyProjectLibraryRefresh({
        requestGeneration,
        currentGeneration: ports.projectLibraryRefreshGeneration,
        loaded: ports.projectsLoaded.value,
        currentCount: ports.projects.value.length,
        nextCount: result.projects.length,
        allowRemoval: options.allowRemoval === true
      })
    )
      return
    ports.projects.value = result.projects
    ports.continueProjectId.value = result.continueProjectId ?? result.projects[0]?.id ?? null
    ports.projectsLoaded.value = true
  }

  async function chooseCreateFolder() {
    ports.createForm.value.parentPath =
      (await ports.desktop.projects.chooseDirectory()) || ports.createForm.value.parentPath
    if (ports.createForm.value.parentPath) ports.createErrors.value.parentPath = ''
  }

  async function openCreateProject() {
    importAfterCreation = false
    if (ports.desktop.app.platform === 'browser') ports.createForm.value.parentPath = '账户书库'
    ports.createModelsPreview.value = null
    ports.createTrigger.value = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ports.createErrors.value = { name: '', parentPath: '' }
    ports.showCreate.value = true
    await nextTick()
    ports.createNameInput.value?.focus()
  }

  async function closeCreateProject() {
    ports.showCreate.value = false
    await nextTick()
    ports.createTrigger.value?.isConnected && ports.createTrigger.value.focus()
  }

  async function createProject() {
    ports.createErrors.value = {
      name: ports.createForm.value.name.trim() ? '' : '请先填写作品名。',
      parentPath: ports.createForm.value.parentPath ? '' : '请选择作品要保存到的本地文件夹。'
    }
    if (ports.createErrors.value.name || ports.createErrors.value.parentPath) {
      await nextTick()
      if (ports.createErrors.value.name) ports.createNameInput.value?.focus()
      else document.querySelector('[data-testid="choose-create-folder"]')?.focus()
      return
    }
    if (!(await prepareWorkItemTransition())) return
    if (!ports.createModelsPreview.value) {
      ports.notice('请先核对新书模型分配，或明确选择先手写建书。')
      return
    }
    const input = ports.partialCreation.value
      ? { token: ports.createModelsPreview.value.token, operationId: ports.partialCreation.value.operationId }
      : {
          token: ports.createModelsPreview.value.token,
          project: { name: ports.createForm.value.name.trim(), parentPath: ports.createForm.value.parentPath, genre: ports.createForm.value.genre?.trim() || '未分类' }
        }
    const result = await ports.guard(() =>
      ports.partialCreation.value
        ? ports.desktop.modelConnections.retryCreation(ports.plainDto(input))
        : ports.desktop.modelConnections.createProject(ports.plainDto(input))
    )
    if (result.status === 'partial') {
      ports.partialCreation.value = result
      ports.notice(result.message)
      return
    }
    ports.partialCreation.value = null
    ports.notice('作品已建立')
    ports.showCreate.value = false
    await activateWorkItem(result.project)
    if (importAfterCreation) {
      importAfterCreation = false
      ports.createForm.value = { ...ports.createForm.value, name: '' }
      await ports.openTxtImport('create-from-files-ready')
      return
    }
    if (ports.afterCreate) { ports.newProjectGuide.value = null; await ports.afterCreate(result.project) }
    else { ports.active.value = 'profile'; ports.newProjectGuide.value = { title: result.project.title, path: result.project.path } }
    ports.createForm.value = { ...ports.createForm.value, name: '' }
  }

  async function saveBookProfileAndContinue() {
    await ports.saveBookProfile()
    ports.newProjectGuide.value = null
    await ports.selectWorkspaceLeaf('ideas')
  }

  async function importProject() {
    if (ports.desktop.app.platform === 'browser') {
      await openCreateProject()
      importAfterCreation = true
      ports.notice('先为导入的书稿取名，建立作品后选择 TXT、Markdown 或 Word 文件。')
      return
    }
    const path = await ports.desktop.projects.chooseDirectory()
    if (!path) return
    if (!(await prepareWorkItemTransition())) return
    const result = await ports.guard(() => ports.desktop.projects.importProject(path), '项目已导入')
    await activateWorkItem(result.project)
  }

  async function openProject(project, preferredChapterId = bookViews.get(project.path)?.chapterId ?? project.manuscript?.lastEditedChapter?.id ?? null) {
    if (tabTransition && openingTransition?.generation !== undefined
      && !ports.workspaceOpening.value && !ports.current.value && !openingTransition.retry) {
      // A cancelled read still owns the serialized switch. Retain one explicit
      // retry until it settles, rather than dropping the click or racing IPC.
      const cancelled = openingTransition
      cancelled.retry = true
      await cancelled.finished
      return openProject(project, preferredChapterId)
    }
    if (tabTransition || ports.workspaceOpening.value || ports.current.value?.path === project.path) return
    tabTransition = true
    const transition = { generation: undefined, retry: false, finished: null, release: null }
    transition.finished = new Promise(resolve => { transition.release = resolve })
    openingTransition = transition
    let generation
    let deferredRequest
    let deferredSnapshot
    try {
      if (!(await prepareWorkItemTransition())) return
      const warm = readyBooks.get(project.path) === project.id
      const memoryHit = warm && canRestoreMemory(project, preferredChapterId)
      generation = ports.beginWorkspaceOpening(project, { replay: !warm, visible: !memoryHit })
      transition.generation = generation
      readyBooks.delete(project.path)
      await ports.guard(() => ports.desktop.projects.switch(project.path))
      if (!ports.isCurrentWorkspaceOpening(generation)) return
      ports.setWorkspaceOpeningPhase('database')
      const activation = await activateWorkItem(project, true, preferredChapterId, { deferWorkflow: warm, useMemory: memoryHit })
      if (warm) { deferredRequest = activation?.request; deferredSnapshot = activation?.snapshot }
      if (ports.isCurrentWorkspaceOpening(generation)) ports.setWorkspaceOpeningPhase('ready')
      if (
        ports.isCurrentWorkspaceOpening(generation) &&
        ports.workspaceOpening.value?.visible &&
        ports.workspaceOpening.value?.replay !== false &&
        !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ) {
        const visualReady = await ports.waitForWorkspaceOpeningPhase(generation, 'ready')
        if (visualReady && ports.isCurrentWorkspaceOpening(generation)) {
          await new Promise((resolve) => window.setTimeout(resolve, ports.WORKSPACE_COMPLETION_DURATION_MS))
        }
      }
    } finally {
      if (generation !== undefined) ports.finishWorkspaceOpening(generation)
      tabTransition = false
      openingTransition = null
      transition.release()
    }
    if (deferredRequest && ports.workspaceRequests.isCurrent(deferredRequest, ports.current.value)) {
      // Current manuscript/recovery data is editable. AI readiness stays unknown
      // until this fresh, generation-guarded projection returns.
      const chapterId = ports.selectedId.value
      const refresh = deferredSnapshot
        ? verifyMemoryWorkspace(deferredRequest, deferredSnapshot)
        : ports.refreshWorkflow(deferredRequest)
      const refreshGeneration = ports.workspaceRefreshGeneration
      void refresh.catch(() => {
        if (ports.workspaceRequests.isCurrent(deferredRequest, ports.current.value)
          && ports.selectedId.value === chapterId && ports.workspaceRefreshGeneration === refreshGeneration)
          ports.notice('章节检查暂未完成，正文可继续编辑；可在写作指引中重新检查。')
      })
    }
  }

  async function openLibraryChapter(project, chapterId) {
    await openProject(project, chapterId)
    if (ports.current.value?.path !== project.path || ports.workspaceOpening.value) return
    const chapter = ports.chapters.value.find((item) => item.id === chapterId)
    if (!chapter) return ports.notice('这个章节暂时不可打开，请在作品中核对目录。')
    await ports.selectActivity('desk')
    if (ports.current.value?.path !== project.path || ports.workspaceOpening.value) return
    // Bootstrap already selected the explicit target. Selecting it again repeats
    // the expensive projection and can overwrite input made after entry.
    if (ports.selectedId.value !== chapterId) await ports.selectChapter(chapter)
  }

  async function forgetProject(project) {
    await ports.guard(
      () => ports.desktop.projects.removeRecent(project.path),
      `《${project.title}》已从书架移除，磁盘文件没有改动`
    )
    readyBooks.delete(project.path)
    if (bookViews.has(project.path)) bookViews.get(project.path).workspace = null
    await refreshProjects({ allowRemoval: true })
  }

  function requestTrashProject(project) {
    if (ports.desktop.app.platform === 'browser') { ports.notice('网页版暂时没有作品删除功能。'); return }
    ports.projectTrashConfirmation.value = ''
    ports.projectTrashTarget.value = project
  }

  async function trashProject() {
    const target = ports.projectTrashTarget.value
    if (!target || ports.projectTrashConfirmation.value !== target.title) return
    if (!(await prepareWorkItemTransition())) return
    const result = await ports.guard(
      () => ports.desktop.projects.trash(target.path),
      `《${target.title}》已移入系统回收站`
    )
    ports.projectTrashTarget.value = null
    openBookTabs.value = openBookTabs.value.filter(item => item.path !== target.path)
    bookViews.delete(target.path)
    loadedDrafts.delete(target.path)
    readyBooks.delete(target.path)
    ports.projectTrashConfirmation.value = ''
    await refreshProjects({ allowRemoval: true })
    // The success sheet is also the completion signal used by keyboard users
    // and click tests. Do not expose it while the shelf still contains stale data.
    ports.recentlyTrashedProject.value = { title: result.title }
  }

  async function openSystemTrash() {
    await ports.guard(() => ports.desktop.projects.openTrash())
  }

  async function closeProject() {
    if (tabTransition || ports.workspaceOpening.value) return
    if (!(await prepareWorkItemTransition())) return
    bookDraftConflicts.value = []
    await ports.desktop.modelConnections.leaveBook()
    ports.workspaceRequests.invalidate()
    ports.chapterSelectionGeneration += 1
    ports.workspaceRefreshGeneration += 1
    ports.clearAutosaveTimer()
    ports.clearAutosaveFinalizeTimer()
    ports.activeAutosaveCheckpoint = null
    ports.stagedRecoverySnapshot = null
    ports.current.value = null
    ports.selectedId.value = null
    ports.selectedVolume.value = null
    ports.volumeOutline.value = ''
    ports.stageOutlines.value = []
    ports.selectedStage.value = null
    ports.stageTitle.value = ''
    ports.stageOutline.value = ''
    ports.lastSavedStageTitle.value = ''
    ports.lastSavedStageOutline.value = ''
    ports.stageDraftTitle.value = ''
    ports.lastSavedChapter = { id: null, title: '', content: '', revision: null, bodyVersionId: null }
    ports.resetWorkItemTransientState()
    await refreshProjects()
  }

  async function prepareWorkItemTransition() {
    if (!(await ports.prepareOutlineLeave())) return false
    ports.invalidateOutlineRead()
    if (ports.modelSettingsDirty.value) {
      ports.notice('模型设置还有未保存的输入，请先保存或放弃修改。')
      return false
    }
    if (!ports.worldMapWorkspace.canLeave()) return false
    if (!(await ports.flushPlannedChapterSave())) return false
    if (!(await ports.flushChapterSaveSafely())) return false
    await ports.flushPlanningDraftSave()
    ports.clearAutosaveTimer()
    rememberBookView()
    return true
  }

  async function activateWorkItem(
    project,
    load = true,
    preferredChapterId = project.manuscript?.lastEditedChapter?.id ?? null,
    options = {}
  ) {
    readyBooks.delete(project.path)
    let loaded = false
    const request = ports.workspaceRequests.begin(project)
    const view = bookViews.get(project.path)
    ports.resetWorkItemTransientState()
    ports.current.value = project
    const tabIndex = openBookTabs.value.findIndex(item => item.path === project.path)
    if (tabIndex < 0) openBookTabs.value.push(project)
    else openBookTabs.value[tabIndex] = project
    let restored = false
    if (load && options.useMemory && canRestoreMemory(project, preferredChapterId)) {
      // Book-change watchers clear chapter/planning/editor state. Let those
      // queued resets finish before hydrating the retained book.
      await nextTick()
      if (!ports.workspaceRequests.isCurrent(request, ports.current.value)) return
      ports.suppressManuscriptAutosave = true
      try {
        ports.lastSavedChapter = cloneWorkspaceValue(view.workspace.lastSavedChapter)
        restored = restoreWorkspaceMemory(view.workspace, project, ports.sessionWorkspaceFields)
      } finally { ports.suppressManuscriptAutosave = false }
      loaded = restored
      if (restored && preferredChapterId && preferredChapterId !== ports.selectedId.value) {
        const chapter = ports.chapters.value.find(item => item.id === preferredChapterId)
        loaded = chapter ? await ports.selectChapter(chapter, request, null, { deferWorkflow: true }) === true : false
      }
    }
    if (load && !restored) {
      try {
        loaded = await ports.loadWorkspace(request, preferredChapterId, options) === true
      } catch (error) {
        if (!ports.workspaceRequests.isCurrent(request, ports.current.value)) return
        ports.chapters.value = []
        ports.selectedId.value = null
        ports.workspaceLoadError.value = error?.message || '作品数据暂时无法读取'
        ports.migrationPreview.value = await ports.desktop.projects.migrationPreview().catch(() => null)
        ports.notice('检测到书稿结构需要核对；正文没有被当作空书处理')
      }
    }
    if (!ports.workspaceRequests.isCurrent(request, ports.current.value)) return
    bookDraftConflicts.value = restored ? cloneWorkspaceValue(view.conflicts || []) : []
    const baseline = restored ? loadedDrafts.get(project.path)
      : Object.fromEntries(Object.entries(ports.sessionFields ?? {}).map(([key, field]) => [key, encode(field.value)]))
    if (view) {
      for (const [key, draft] of Object.entries(restored ? {} : view.drafts ?? {})) {
        const field = ports.sessionFields?.[key]
        if (field && draft.value !== draft.baseline) {
          if (baseline[key] === draft.baseline || baseline[key] === draft.value || ports.sessionNavigation?.includes(key)) field.value = JSON.parse(draft.value)
          else bookDraftConflicts.value.push({ key, label: { bookProfile: '作品资料', foundation: '故事基础', realms: '境界', powerSystem: '力量体系', cheatSystem: '金手指', systemTemplate: '系统模板' }[key] ?? '资料' })
        }
      }
      // Data and selected chapter have been reloaded under the new book guard.
      ports.active.value = view.active
      await nextTick()
      if (ports.workspaceRequests.isCurrent(request, ports.current.value) && ports.selectedId.value === view.chapterId) ports.manuscriptEditor?.value?.restoreView?.(view.editor)
    }
    loadedDrafts.set(project.path, baseline)
    if (!restored) await ports.restoreBookJobs?.(project.path)
    if (loaded && ports.workspaceRequests.isCurrent(request, ports.current.value)) readyBooks.set(project.path, project.id)
    // The workspace is already usable at this point. Updating the shelf's
    // recency/word-count projection must not keep the author on a blank opening
    // state, and refreshProjects only changes the library projection.
    void refreshProjects().catch(() => undefined)
    return loaded && ports.workspaceRequests.isCurrent(request, ports.current.value)
      ? { request, snapshot: restored ? view.workspace : null } : null
  }

  async function verifyMemoryWorkspace(request, snapshot) {
    const current = () => ports.workspaceRequests.isCurrent(request, ports.current.value)
      && bookViews.get(request.path)?.workspace === snapshot
    try {
      const [bootstrap, status] = await Promise.all([
        ports.desktop.workspace.bootstrap(), ports.desktop.projects.sqliteStorageStatus()
      ])
      if (!current()) return
      // A completed local save supersedes this read; never label our own newer
      // version as an external conflict or replace its baseline.
      if (ports.lastSavedChapter.id !== snapshot.lastSavedChapter?.id
        || ports.lastSavedChapter.revision !== snapshot.lastSavedChapter?.revision) return
      const difference = compareWorkspaceMemory(snapshot, bootstrap)
      if (difference.changed) {
        readyBooks.delete(request.path)
        bookViews.get(request.path).workspace = null
        if (difference.selectedChanged && ports.selectedId.value === snapshot.lastSavedChapter.id) {
          ports.manuscriptConflict.value = {
            workItemId: request.workItemId, workItemPath: request.path, chapterId: ports.selectedId.value,
            reason: difference.selected ? 'external-change' : 'missing', externalChapter: difference.selected,
            expectedRevision: snapshot.lastSavedChapter.revision || ''
          }
        }
        ports.notice('磁盘中的作品已有变化，已保留当前输入；重新打开作品可读取最新资料。')
        return
      }
      const issues = ports.sessionWorkspaceFields?.workspaceBootstrapIssues
      const ai = ports.sessionWorkspaceFields?.ai
      if (bootstrap.aiSettings && snapshot.fields.workspaceBootstrapIssues?.some(issue => issue.id === 'modelSettingsUnreadable')
        && ai && !ports.modelSettingsDirty?.value && encode(ai.value) === encode(snapshot.fields.ai)) {
        ai.value = { ...bootstrap.aiSettings, connections: bootstrap.aiSettings.connections.map(c => ({ ...c, apiKey: '', clearApiKey: false })) }
      }
      if (issues) issues.value = cloneWorkspaceValue(bootstrap.issues)
      ports.sqliteStorageStatus.value = status
      loadedDrafts.set(request.path, { ...loadedDrafts.get(request.path), ...difference.formBaselines })
      ports.outlineStorageFeedback?.initializeFileAuthority(status, request)
      const tasks = ports.restoreBookJobs?.(request.path)
      const untouched = ports.chapterContent.value === snapshot.lastSavedChapter?.content
        && ports.chapterTitle.value === snapshot.lastSavedChapter?.title
      await Promise.all([tasks, untouched ? ports.refreshWorkflow(request) : undefined])
    } catch (error) {
      if (!current()) return
      readyBooks.delete(request.path)
      bookViews.get(request.path).workspace = null
      ports.notice('磁盘资料暂时无法核对，已保留内存中的正文；下次打开将重新读取。')
    }
  }

  return {
    invalidateWorkspaceSnapshot,
    openBookTabs,
    bookDraftConflicts,
    resolveBookDraftConflict,
    selectBookTab,
    closeBookTab,
    openBackgroundTask,
    refreshProjects,
    chooseCreateFolder,
    openCreateProject,
    closeCreateProject,
    createProject,
    saveBookProfileAndContinue,
    importProject,
    openProject,
    openLibraryChapter,
    forgetProject,
    requestTrashProject,
    trashProject,
    openSystemTrash,
    closeProject,
    prepareWorkItemTransition,
    activateWorkItem
  }
}
